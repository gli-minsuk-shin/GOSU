import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerExperimentEvaluationIpc } from '../src/main/experiment-evaluation-ipc';
import {
  ExperimentEvaluationServiceError,
  type ExperimentEvaluationService,
} from '../src/main/experiment-evaluation-service';
import { EXPERIMENT_EVALUATION_IPC_CHANNELS } from '../src/shared/experiment-evaluation-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function fixture(service: Partial<ExperimentEvaluationService>, reportUnexpected = vi.fn()) {
  const handlers = new Map<string, Handler>();
  registerExperimentEvaluationIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as ExperimentEvaluationService,
    reportUnexpected,
  );
  return { handlers, reportUnexpected };
}

describe('Experiment Evaluation IPC boundary', () => {
  it('registers only the fixed evaluation command surface', () => {
    const { handlers } = fixture({});

    expect([...handlers.keys()].sort()).toEqual(
      [
        EXPERIMENT_EVALUATION_IPC_CHANNELS.list,
        EXPERIMENT_EVALUATION_IPC_CHANNELS.detail,
        EXPERIMENT_EVALUATION_IPC_CHANNELS.createSession,
        EXPERIMENT_EVALUATION_IPC_CHANNELS.send,
        EXPERIMENT_EVALUATION_IPC_CHANNELS.cancel,
        EXPERIMENT_EVALUATION_IPC_CHANNELS.approve,
        EXPERIMENT_EVALUATION_IPC_CHANNELS.reuseProfile,
      ].sort(),
    );
    expect([...handlers.keys()]).not.toContain(EXPERIMENT_EVALUATION_IPC_CHANNELS.event);
  });

  it('rejects malformed identifiers, nonpositive versions, and extra renderer fields', async () => {
    const list = vi.fn();
    const send = vi.fn();
    const approve = vi.fn();
    const { handlers } = fixture({ list, send, approve });
    const projectId = randomUUID();
    const sessionId = randomUUID();

    await expect(
      handlers.get(EXPERIMENT_EVALUATION_IPC_CHANNELS.list)?.({ projectId: 'not-a-uuid' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_experiment_evaluation_input' } });
    await expect(
      handlers.get(EXPERIMENT_EVALUATION_IPC_CHANNELS.send)?.({
        projectId,
        sessionId,
        expectedVersion: 0,
        message: 'Draft it.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_experiment_evaluation_input' } });
    await expect(
      handlers.get(EXPERIMENT_EVALUATION_IPC_CHANNELS.approve)?.({
        projectId,
        sessionId,
        expectedVersion: 1,
        revision: 1,
        profileName: 'Safe profile',
        dynamicTools: [{ name: 'shell' }],
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_experiment_evaluation_input' } });
    expect(list).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it('returns bounded service errors without leaking diagnostics', async () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const send = vi.fn(async () => {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_busy');
    });
    const { handlers, reportUnexpected } = fixture({ send });

    await expect(
      handlers.get(EXPERIMENT_EVALUATION_IPC_CHANNELS.send)?.({
        projectId,
        sessionId,
        expectedVersion: 1,
        message: 'Draft it.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'experiment_evaluation_busy' } });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it('maps unexpected failures to one generic unavailable result', async () => {
    const projectId = randomUUID();
    const list = vi.fn(async () => {
      throw new Error('/Users/researcher/private-evaluator.py');
    });
    const { handlers, reportUnexpected } = fixture({ list });

    const result = await handlers.get(EXPERIMENT_EVALUATION_IPC_CHANNELS.list)?.({ projectId });
    expect(result).toEqual({
      ok: false,
      error: { code: 'experiment_evaluation_unavailable' },
    });
    expect(JSON.stringify(result)).not.toContain('private-evaluator');
    expect(reportUnexpected).toHaveBeenCalledOnce();
  });
});
