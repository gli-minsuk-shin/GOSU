import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { PROJECT_CHAT_IPC_CHANNELS } from '../src/shared/project-chat-channels';
import { SSH_IPC_CHANNELS } from '../src/shared/ssh-channels';

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

let api: GosuDesktopApi;

beforeAll(async () => {
  await import('../src/preload/index');
  api = electron.exposed[0]?.[1] as GosuDesktopApi;
});

beforeEach(() => {
  electron.ipcRenderer.invoke.mockReset();
  electron.ipcRenderer.removeListener.mockClear();
});

describe('SSH preload bridge', () => {
  it('exposes only a scoped Project Chat SSH revocation command to navigation', async () => {
    const projectId = '33333333-3333-4333-8333-333333333333';
    const sessionId = '44444444-4444-4444-8444-444444444444';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: { revoked: true } });

    await expect(api.projectChat.revokeSsh(projectId, sessionId)).resolves.toEqual({
      revoked: true,
    });
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(
      PROJECT_CHAT_IPC_CHANNELS.revokeSsh,
      { projectId, sessionId },
    );
  });

  it('exposes fixed connection and approval methods without a renderer execute channel', () => {
    expect(Object.keys(api.ssh)).toEqual([
      'listConnections',
      'createConnection',
      'updateConnection',
      'removeConnection',
      'testConnection',
      'resolveApproval',
      'cancelScope',
      'onEvent',
    ]);
    expect(api.ssh).not.toHaveProperty('execute');
    expect(api.ssh).not.toHaveProperty('run');
    expect(api.ssh).not.toHaveProperty('invoke');
  });

  it('maps every renderer command to its fixed IPC channel and exact payload', async () => {
    const connectionId = '11111111-1111-4111-8111-111111111111';
    const approvalId = '22222222-2222-4222-8222-222222222222';
    const projectId = '33333333-3333-4333-8333-333333333333';
    const sessionId = '44444444-4444-4444-8444-444444444444';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.ssh.listConnections();
    await api.ssh.createConnection({ label: 'Lab GPU', hostAlias: 'lab-gpu' });
    await api.ssh.updateConnection({
      connectionId,
      expectedVersion: 1,
      label: 'Lab GPU 2',
      hostAlias: 'lab-gpu-2',
    });
    await api.ssh.removeConnection({ connectionId, expectedVersion: 2 });
    await api.ssh.testConnection(connectionId);
    await api.ssh.resolveApproval({ approvalId, decision: 'allow_once' });
    await api.ssh.cancelScope({ projectId, sessionId });

    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      [SSH_IPC_CHANNELS.listConnections],
      [SSH_IPC_CHANNELS.createConnection, { label: 'Lab GPU', hostAlias: 'lab-gpu' }],
      [
        SSH_IPC_CHANNELS.updateConnection,
        {
          connectionId,
          expectedVersion: 1,
          label: 'Lab GPU 2',
          hostAlias: 'lab-gpu-2',
        },
      ],
      [SSH_IPC_CHANNELS.removeConnection, { connectionId, expectedVersion: 2 }],
      [SSH_IPC_CHANNELS.testConnection, { connectionId }],
      [SSH_IPC_CHANNELS.resolveApproval, { approvalId, decision: 'allow_once' }],
      [SSH_IPC_CHANNELS.cancelScope, { projectId, sessionId }],
    ]);
  });

  it('validates approval events and removes the exact subscription', () => {
    const listener = vi.fn();
    const unsubscribe = api.ssh.onEvent(listener);
    const handler = electron.listeners.get(SSH_IPC_CHANNELS.event)!;
    const request = {
      schemaVersion: 1,
      id: '22222222-2222-4222-8222-222222222222',
      projectId: '33333333-3333-4333-8333-333333333333',
      sessionId: '44444444-4444-4444-8444-444444444444',
      attemptId: '55555555-5555-4555-8555-555555555555',
      turnId: 'turn-fixture',
      toolCallId: 'tool-call-fixture',
      connectionId: '11111111-1111-4111-8111-111111111111',
      connectionLabel: 'Lab GPU',
      hostAlias: 'lab-gpu',
      commandPreview: "exec 'true'",
      requestedAt: '2026-08-04T00:00:00.000Z',
      expiresAt: '2026-08-04T00:00:30.000Z',
    };

    handler({}, { type: 'approval.requested', request });
    handler({}, { type: 'approval.requested', request: { ...request, hostAlias: 'bad alias' } });

    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'approval.requested', request });
    unsubscribe();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledExactlyOnceWith(
      SSH_IPC_CHANNELS.event,
      expect.any(Function),
    );
  });

  it('maps rejected invokes and undeclared errors to ssh_unavailable', async () => {
    electron.ipcRenderer.invoke
      .mockRejectedValueOnce(new Error('/Users/researcher/.ssh/private-key'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'private_host_resolution' } });

    await expect(api.ssh.listConnections()).rejects.toThrow('ssh_unavailable');
    await expect(
      api.ssh.createConnection({ label: 'Lab GPU', hostAlias: 'lab-gpu' }),
    ).rejects.toThrow('ssh_unavailable');
  });
});
