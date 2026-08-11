import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerExperimentWorkspaceIpc } from '../src/main/experiment-workspace-ipc';
import {
  ExperimentWorkspaceServiceError,
  type ExperimentWorkspaceService,
} from '../src/main/experiment-workspace-service';
import { EXPERIMENT_WORKSPACE_IPC_CHANNELS } from '../src/shared/experiment-workspace-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function fixture(service: Partial<ExperimentWorkspaceService>, reportUnexpected = vi.fn()) {
  const handlers = new Map<string, Handler>();
  registerExperimentWorkspaceIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as ExperimentWorkspaceService,
    reportUnexpected,
  );
  return { handlers, reportUnexpected };
}

describe('Experiment workspace IPC boundary', () => {
  it('registers only the fixed experiment command and query surface', () => {
    const { handlers } = fixture({});

    expect([...handlers.keys()].sort()).toEqual(
      [
        EXPERIMENT_WORKSPACE_IPC_CHANNELS.list,
        EXPERIMENT_WORKSPACE_IPC_CHANNELS.createIdea,
        EXPERIMENT_WORKSPACE_IPC_CHANNELS.updateIdea,
        EXPERIMENT_WORKSPACE_IPC_CHANNELS.recordMetric,
        EXPERIMENT_WORKSPACE_IPC_CHANNELS.reviseLoggingTemplate,
      ].sort(),
    );
    expect([...handlers.keys()]).not.toContain(EXPERIMENT_WORKSPACE_IPC_CHANNELS.event);
    expect([...handlers.keys()]).not.toContain('gosu:experiment-workspace:runner-event');
    expect([...handlers.keys()]).not.toContain('gosu:experiment-workspace:create-run');
    expect([...handlers.keys()]).not.toContain('gosu:experiment-workspace:update-run');
  });

  it('rejects malformed IDs, unbounded text, and renderer-selected metric provenance', async () => {
    const createIdea = vi.fn();
    const recordMetric = vi.fn();
    const { handlers } = fixture({ createIdea, recordMetric });

    await expect(
      handlers.get(EXPERIMENT_WORKSPACE_IPC_CHANNELS.createIdea)?.({
        projectId: 'not-a-project',
        title: 'x'.repeat(161),
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_experiment_input' } });
    await expect(
      handlers.get(EXPERIMENT_WORKSPACE_IPC_CHANNELS.recordMetric)?.({
        projectId: randomUUID(),
        ideaId: randomUUID(),
        value: 1,
        source: 'runner-summary',
        objectiveId: randomUUID(),
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_experiment_input' } });
    expect(createIdea).not.toHaveBeenCalled();
    expect(recordMetric).not.toHaveBeenCalled();
  });

  it('passes validated commands and returns bounded service failures', async () => {
    const projectId = randomUUID();
    const list = vi.fn(async () => {
      throw new ExperimentWorkspaceServiceError('experiment_project_unavailable');
    });
    const { handlers, reportUnexpected } = fixture({ list });

    await expect(
      handlers.get(EXPERIMENT_WORKSPACE_IPC_CHANNELS.list)?.({ projectId }),
    ).resolves.toEqual({ ok: false, error: { code: 'experiment_project_unavailable' } });
    expect(list).toHaveBeenCalledWith({ projectId });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it('does not reflect unexpected local diagnostics into renderer results', async () => {
    const list = vi.fn(async () => {
      throw new Error('/Users/researcher/private-experiment.json');
    });
    const { handlers, reportUnexpected } = fixture({ list });

    const result = await handlers.get(EXPERIMENT_WORKSPACE_IPC_CHANNELS.list)?.({
      projectId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, error: { code: 'experiment_unavailable' } });
    expect(JSON.stringify(result)).not.toContain('private-experiment');
    expect(reportUnexpected).toHaveBeenCalledOnce();
  });
});
