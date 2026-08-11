import type { ZodType } from 'zod';

import { EXPERIMENT_WORKSPACE_IPC_CHANNELS } from '../shared/experiment-workspace-channels';
import {
  CreateExperimentIdeaInputSchema,
  ListExperimentWorkspaceInputSchema,
  RecordExperimentMetricInputSchema,
  ReviseExperimentLoggingTemplateInputSchema,
  UpdateExperimentIdeaInputSchema,
  type ExperimentIpcResult,
} from '../shared/experiment-workspace-contracts';
import {
  ExperimentWorkspaceServiceError,
  type ExperimentWorkspaceService,
} from './experiment-workspace-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerExperimentWorkspaceIpc(
  register: RegisterHandler,
  service: ExperimentWorkspaceService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(EXPERIMENT_WORKSPACE_IPC_CHANNELS.list, (input) =>
    withInput(
      input,
      ListExperimentWorkspaceInputSchema,
      (command) => service.list(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_WORKSPACE_IPC_CHANNELS.createIdea, (input) =>
    withInput(
      input,
      CreateExperimentIdeaInputSchema,
      (command) => service.createIdea(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_WORKSPACE_IPC_CHANNELS.updateIdea, (input) =>
    withInput(
      input,
      UpdateExperimentIdeaInputSchema,
      (command) => service.updateIdea(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_WORKSPACE_IPC_CHANNELS.recordMetric, (input) =>
    withInput(
      input,
      RecordExperimentMetricInputSchema,
      (command) => service.recordMetric(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_WORKSPACE_IPC_CHANNELS.reviseLoggingTemplate, (input) =>
    withInput(
      input,
      ReviseExperimentLoggingTemplateInputSchema,
      (command) => service.reviseLoggingTemplate(command),
      reportUnexpected,
    ),
  );
}

function withInput<TInput, TOutput>(
  input: unknown,
  schema: ZodType<TInput>,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return Promise.resolve<ExperimentIpcResult<TOutput>>({
      ok: false,
      error: { code: 'invalid_experiment_input' },
    });
  }
  return safely(() => operation(parsed.data), reportUnexpected);
}

async function safely<T>(
  operation: () => Promise<T>,
  reportUnexpected: (error: unknown) => void,
): Promise<ExperimentIpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
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
}
