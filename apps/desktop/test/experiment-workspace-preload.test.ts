import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { EXPERIMENT_WORKSPACE_IPC_CHANNELS } from '../src/shared/experiment-workspace-channels';

const electron = vi.hoisted(() => {
  const exposed: unknown[][] = [];
  return {
    exposed,
    contextBridge: {
      exposeInMainWorld: vi.fn((...arguments_: unknown[]) => exposed.push(arguments_)),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
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
  electron.ipcRenderer.on.mockClear();
  electron.ipcRenderer.removeListener.mockClear();
});

describe('Experiment workspace preload bridge', () => {
  it('maps the typed surface to fixed IPC channels', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const ideaId = '22222222-2222-4222-8222-222222222222';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.experiments.list({ projectId });
    await api.experiments.createIdea({ projectId, title: 'Idea A' });
    await api.experiments.updateIdea({
      projectId,
      ideaId,
      expectedVersion: 1,
      title: 'Idea A-1',
      hypothesis: 'Change one controlled variable.',
      phase: 'Improve',
      outcome: 'running',
      resultSummary: '',
    });
    await api.experiments.recordMetric({ projectId, ideaId, value: 52.29 });
    await api.experiments.reviseLoggingTemplate({
      projectId,
      expectedVersion: 1,
      customFields: [],
    });

    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      [EXPERIMENT_WORKSPACE_IPC_CHANNELS.list, { projectId }],
      [EXPERIMENT_WORKSPACE_IPC_CHANNELS.createIdea, { projectId, title: 'Idea A' }],
      [
        EXPERIMENT_WORKSPACE_IPC_CHANNELS.updateIdea,
        {
          projectId,
          ideaId,
          expectedVersion: 1,
          title: 'Idea A-1',
          hypothesis: 'Change one controlled variable.',
          phase: 'Improve',
          outcome: 'running',
          resultSummary: '',
        },
      ],
      [EXPERIMENT_WORKSPACE_IPC_CHANNELS.recordMetric, { projectId, ideaId, value: 52.29 }],
      [
        EXPERIMENT_WORKSPACE_IPC_CHANNELS.reviseLoggingTemplate,
        { projectId, expectedVersion: 1, customFields: [] },
      ],
    ]);
    expect(api.experiments).not.toHaveProperty('createRun');
    expect(api.experiments).not.toHaveProperty('updateRun');
  });

  it('validates renderer events and removes the exact listener', () => {
    const listener = vi.fn();
    const unsubscribe = api.experiments.onEvent(listener);
    const registered = electron.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === EXPERIMENT_WORKSPACE_IPC_CHANNELS.event,
    );
    const handler = registered?.[1] as ((event: unknown, value: unknown) => void) | undefined;

    handler?.(null, { type: 'malformed', projectId: 'private-path' });
    expect(listener).not.toHaveBeenCalled();
    const event = {
      schemaVersion: 1,
      type: 'experiment.workspace.changed',
      projectId: '11111111-1111-4111-8111-111111111111',
      entityType: 'metric-point',
      entityId: '22222222-2222-4222-8222-222222222222',
      occurredAt: '2026-08-06T00:00:00.000Z',
    } as const;
    handler?.(null, event);
    expect(listener).toHaveBeenCalledWith(event);

    unsubscribe();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      EXPERIMENT_WORKSPACE_IPC_CHANNELS.event,
      handler,
    );
  });

  it('maps rejected or undeclared results to the bounded unavailable error', async () => {
    electron.ipcRenderer.invoke
      .mockRejectedValueOnce(new Error('/Users/researcher/private-run.log'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'undeclared_error' } });

    await expect(api.experiments.list({ projectId: crypto.randomUUID() })).rejects.toThrow(
      'experiment_unavailable',
    );
    await expect(
      api.experiments.createIdea({ projectId: crypto.randomUUID(), title: 'Safe error' }),
    ).rejects.toThrow('experiment_unavailable');
  });
});
