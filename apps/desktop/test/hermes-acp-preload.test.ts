import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { HERMES_ACP_APPROVAL_CHANNELS } from '../src/shared/hermes-acp-approval-channels';
import type { HermesAcpApprovalRequest } from '../src/shared/hermes-acp-approval-contracts';

const electron = vi.hoisted(() => {
  const exposed: unknown[][] = [];
  const listeners = new Map<string, (...arguments_: unknown[]) => void>();
  return {
    exposed,
    listeners,
    contextBridge: {
      exposeInMainWorld: vi.fn((...arguments_: unknown[]) => exposed.push(arguments_)),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn((channel: string, listener: (...arguments_: unknown[]) => void) => {
        listeners.set(channel, listener);
      }),
      removeListener: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
}));

const request: HermesAcpApprovalRequest = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  sessionId: '33333333-3333-4333-8333-333333333333',
  acpSessionId: 'acp-session-fixture',
  toolCallId: 'tool-call-fixture',
  title: 'Run project tests',
  kind: 'execute',
  safeSummary: { text: 'Run the selected test target.' },
  options: ['allow_once', 'allow_session', 'deny'],
  createdAt: '2026-08-11T08:00:00.000Z',
  expiresAt: '2026-08-11T08:05:00.000Z',
};

let api: GosuDesktopApi;

beforeAll(async () => {
  await import('../src/preload/index');
  api = electron.exposed[0]?.[1] as GosuDesktopApi;
});

beforeEach(() => {
  electron.ipcRenderer.invoke.mockReset();
  electron.ipcRenderer.on.mockClear();
  electron.ipcRenderer.removeListener.mockClear();
  electron.listeners.clear();
});

describe('Hermes ACP approval preload bridge', () => {
  it('maps only scoped list and resolve operations to fixed channels', async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce([request]).mockResolvedValueOnce({
      outcome: 'allowed',
    });

    await expect(
      api.hermesAcp.listPendingApprovals({
        projectId: request.projectId,
        sessionId: request.sessionId,
      }),
    ).resolves.toEqual([request]);
    await expect(
      api.hermesAcp.resolveApproval({ approvalId: request.id, decision: 'allow_session' }),
    ).resolves.toEqual({ outcome: 'allowed' });

    expect(Object.keys(api.hermesAcp)).toEqual([
      'listPendingApprovals',
      'resolveApproval',
      'onEvent',
    ]);
    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      [
        HERMES_ACP_APPROVAL_CHANNELS.listPendingApprovals,
        {
          projectId: request.projectId,
          sessionId: request.sessionId,
        },
      ],
      [
        HERMES_ACP_APPROVAL_CHANNELS.resolveApproval,
        {
          approvalId: request.id,
          decision: 'allow_session',
        },
      ],
    ]);
  });

  it('rejects malformed hydrated requests and ignores malformed events', async () => {
    electron.ipcRenderer.invoke.mockResolvedValue([{ ...request, projectId: 'not-a-uuid' }]);
    await expect(
      api.hermesAcp.listPendingApprovals({
        projectId: request.projectId,
        sessionId: request.sessionId,
      }),
    ).rejects.toThrow();

    const listener = vi.fn();
    const unsubscribe = api.hermesAcp.onEvent(listener);
    const handler = electron.listeners.get(HERMES_ACP_APPROVAL_CHANNELS.event)!;
    handler({}, { type: 'approval.requested', request });
    handler({}, { type: 'approval.requested', request: { ...request, rawInput: 'secret' } });

    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'approval.requested', request });
    unsubscribe();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledExactlyOnceWith(
      HERMES_ACP_APPROVAL_CHANNELS.event,
      expect.any(Function),
    );
  });
});
