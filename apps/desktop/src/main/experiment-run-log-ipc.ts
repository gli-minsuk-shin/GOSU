import { EXPERIMENT_WORKSPACE_IPC_CHANNELS } from '../shared/experiment-workspace-channels';
import {
  ReadExperimentRunLogInputSchema,
  type ExperimentIpcResult,
} from '../shared/experiment-workspace-contracts';
import type { ExperimentRunLogService } from './experiment-run-log-service';
import { ExperimentWorkspaceServiceError } from './experiment-workspace-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerExperimentRunLogIpc(
  register: RegisterHandler,
  service: ExperimentRunLogService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(EXPERIMENT_WORKSPACE_IPC_CHANNELS.readRunLog, async (input) => {
    const parsed = ReadExperimentRunLogInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'invalid_experiment_input' },
      } satisfies ExperimentIpcResult<never>;
    }
    try {
      return { ok: true, value: await service.read(parsed.data) };
    } catch (error) {
      if (error instanceof ExperimentWorkspaceServiceError) {
        return { ok: false, error: { code: error.code } };
      }
      try {
        reportUnexpected(error);
      } catch {
        // Diagnostics must not convert a bounded result into a rejected invoke call.
      }
      return { ok: false, error: { code: 'experiment_unavailable' } };
    }
  });
}
