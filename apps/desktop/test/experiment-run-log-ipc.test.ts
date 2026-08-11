import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerExperimentRunLogIpc } from '../src/main/experiment-run-log-ipc';
import type { ExperimentRunLogService } from '../src/main/experiment-run-log-service';
import { ExperimentWorkspaceServiceError } from '../src/main/experiment-workspace-service';
import { EXPERIMENT_WORKSPACE_IPC_CHANNELS } from '../src/shared/experiment-workspace-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function fixture(service: Partial<ExperimentRunLogService>, reportUnexpected = vi.fn()) {
  const handlers = new Map<string, Handler>();
  registerExperimentRunLogIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as ExperimentRunLogService,
    reportUnexpected,
  );
  return { handlers, reportUnexpected };
}

describe('Experiment run log IPC boundary', () => {
  it('exposes only the bounded read query and rejects extra path input', async () => {
    const read = vi.fn();
    const { handlers } = fixture({ read });
    const projectId = randomUUID();
    const runId = randomUUID();
    const referenceId = randomUUID();

    expect([...handlers.keys()]).toEqual([EXPERIMENT_WORKSPACE_IPC_CHANNELS.readRunLog]);
    await expect(
      handlers.get(EXPERIMENT_WORKSPACE_IPC_CHANNELS.readRunLog)?.({
        projectId,
        runId,
        referenceId,
        relativePath: '../../secret',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_experiment_input' } });
    expect(read).not.toHaveBeenCalled();
  });

  it('returns a bounded access error without remote diagnostics', async () => {
    const read = vi.fn(async () => {
      throw new ExperimentWorkspaceServiceError('experiment_run_log_access_required');
    });
    const { handlers, reportUnexpected } = fixture({ read });
    const input = {
      projectId: randomUUID(),
      runId: randomUUID(),
      referenceId: randomUUID(),
    };

    await expect(
      handlers.get(EXPERIMENT_WORKSPACE_IPC_CHANNELS.readRunLog)?.(input),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'experiment_run_log_access_required' },
    });
    expect(read).toHaveBeenCalledWith(input);
    expect(reportUnexpected).not.toHaveBeenCalled();
  });
});
