import type { ZodType } from 'zod';

import { EXPERIMENT_EVALUATION_IPC_CHANNELS } from '../shared/experiment-evaluation-channels';
import {
  ApproveExperimentEvaluationInputSchema,
  CancelExperimentEvaluationInputSchema,
  CreateExperimentEvaluationSessionInputSchema,
  ExperimentEvaluationDetailInputSchema,
  ListExperimentEvaluationsInputSchema,
  ReuseExperimentEvaluationProfileInputSchema,
  SendExperimentEvaluationMessageInputSchema,
  type ExperimentEvaluationIpcResult,
} from '../shared/experiment-evaluation-contracts';
import {
  ExperimentEvaluationServiceError,
  type ExperimentEvaluationService,
} from './experiment-evaluation-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerExperimentEvaluationIpc(
  register: RegisterHandler,
  service: ExperimentEvaluationService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(EXPERIMENT_EVALUATION_IPC_CHANNELS.list, (input) =>
    withInput(
      input,
      ListExperimentEvaluationsInputSchema,
      (command) => service.list(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_EVALUATION_IPC_CHANNELS.detail, (input) =>
    withInput(
      input,
      ExperimentEvaluationDetailInputSchema,
      (command) => service.detail(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_EVALUATION_IPC_CHANNELS.createSession, (input) =>
    withInput(
      input,
      CreateExperimentEvaluationSessionInputSchema,
      (command) => service.createSession(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_EVALUATION_IPC_CHANNELS.send, (input) =>
    withInput(
      input,
      SendExperimentEvaluationMessageInputSchema,
      (command) => service.send(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_EVALUATION_IPC_CHANNELS.cancel, (input) =>
    withInput(
      input,
      CancelExperimentEvaluationInputSchema,
      (command) => service.cancel(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_EVALUATION_IPC_CHANNELS.approve, (input) =>
    withInput(
      input,
      ApproveExperimentEvaluationInputSchema,
      (command) => service.approve(command),
      reportUnexpected,
    ),
  );
  register(EXPERIMENT_EVALUATION_IPC_CHANNELS.reuseProfile, (input) =>
    withInput(
      input,
      ReuseExperimentEvaluationProfileInputSchema,
      (command) => service.reuseProfile(command),
      reportUnexpected,
    ),
  );
}

async function withInput<TInput, TOutput>(
  input: unknown,
  schema: ZodType<TInput>,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
): Promise<ExperimentEvaluationIpcResult<TOutput>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid_experiment_evaluation_input' } };
  }
  try {
    return { ok: true, value: await operation(parsed.data) };
  } catch (error) {
    if (error instanceof ExperimentEvaluationServiceError) {
      return { ok: false, error: { code: error.code } };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not turn a bounded invoke result into a rejected renderer call.
    }
    return { ok: false, error: { code: 'experiment_evaluation_unavailable' } };
  }
}
