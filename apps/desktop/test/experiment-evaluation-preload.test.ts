import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { EXPERIMENT_EVALUATION_IPC_CHANNELS } from '../src/shared/experiment-evaluation-channels';

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

describe('Experiment Evaluation preload bridge', () => {
  it('maps the complete typed surface to fixed channels', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const profileId = '33333333-3333-4333-8333-333333333333';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.experimentEvaluation.list({ projectId });
    await api.experimentEvaluation.detail({ projectId, sessionId });
    await api.experimentEvaluation.createSession({ projectId, title: 'Holdout evaluation' });
    await api.experimentEvaluation.send({
      projectId,
      sessionId,
      expectedVersion: 1,
      message: 'Evaluate every 500 steps.',
      requestedModelId: null,
      reasoningOptionId: 'medium',
    });
    await api.experimentEvaluation.approve({
      projectId,
      sessionId,
      expectedVersion: 3,
      revision: 1,
      profileName: 'Holdout recipe',
    });
    await api.experimentEvaluation.reuseProfile({ projectId, profileId });

    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      [EXPERIMENT_EVALUATION_IPC_CHANNELS.list, { projectId }],
      [EXPERIMENT_EVALUATION_IPC_CHANNELS.detail, { projectId, sessionId }],
      [
        EXPERIMENT_EVALUATION_IPC_CHANNELS.createSession,
        { projectId, title: 'Holdout evaluation' },
      ],
      [
        EXPERIMENT_EVALUATION_IPC_CHANNELS.send,
        {
          projectId,
          sessionId,
          expectedVersion: 1,
          message: 'Evaluate every 500 steps.',
          requestedModelId: null,
          reasoningOptionId: 'medium',
        },
      ],
      [
        EXPERIMENT_EVALUATION_IPC_CHANNELS.approve,
        {
          projectId,
          sessionId,
          expectedVersion: 3,
          revision: 1,
          profileName: 'Holdout recipe',
        },
      ],
      [EXPERIMENT_EVALUATION_IPC_CHANNELS.reuseProfile, { projectId, profileId }],
    ]);
  });

  it('validates events and bounds rejected or undeclared errors', async () => {
    const listener = vi.fn();
    const unsubscribe = api.experimentEvaluation.onEvent(listener);
    const registered = electron.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === EXPERIMENT_EVALUATION_IPC_CHANNELS.event,
    );
    const handler = registered?.[1] as ((event: unknown, value: unknown) => void) | undefined;
    handler?.(null, { type: 'malformed', projectId: '/private/path' });
    expect(listener).not.toHaveBeenCalled();

    const event = {
      schemaVersion: 1,
      type: 'experiment.evaluation.changed',
      projectId: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
      entityType: 'revision',
      entityId: '33333333-3333-4333-8333-333333333333',
      occurredAt: '2026-08-12T00:00:00.000Z',
    } as const;
    handler?.(null, event);
    expect(listener).toHaveBeenCalledWith(event);
    unsubscribe();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      EXPERIMENT_EVALUATION_IPC_CHANNELS.event,
      handler,
    );

    electron.ipcRenderer.invoke
      .mockRejectedValueOnce(new Error('/Users/researcher/private-evaluator.py'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'undeclared_error' } });
    await expect(api.experimentEvaluation.list({ projectId: crypto.randomUUID() })).rejects.toThrow(
      'experiment_evaluation_unavailable',
    );
    await expect(api.experimentEvaluation.list({ projectId: crypto.randomUUID() })).rejects.toThrow(
      'experiment_evaluation_unavailable',
    );
  });
});
