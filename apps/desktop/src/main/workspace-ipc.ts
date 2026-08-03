import { ZodError } from 'zod';

import {
  CreateProjectInputSchema,
  CreateTaskInputSchema,
  ObjectiveCommandSchema,
  SaveObjectiveInputSchema,
  UpdateTaskInputSchema,
} from '../shared/workspace-contracts';
import { WORKSPACE_IPC_CHANNELS } from '../shared/workspace-channels';
import type { WorkspaceIpcResult } from '../shared/workspace-ipc-result';
import { WorkspaceServiceError, type WorkspaceService } from './workspace-service';
import { WorkspaceDataRecoveryError } from './workspace-storage-error';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;
type InputSchema<T> = Readonly<{
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}>;

export function registerWorkspaceIpc(
  register: RegisterHandler,
  workspace: WorkspaceService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(WORKSPACE_IPC_CHANNELS.snapshot, () =>
    safely(() => workspace.snapshot(), reportUnexpected),
  );
  register(WORKSPACE_IPC_CHANNELS.pendingSummary, () =>
    safely(() => workspace.pendingSummary(), reportUnexpected),
  );
  register(WORKSPACE_IPC_CHANNELS.createProject, (input) =>
    withValidatedInput(
      input,
      CreateProjectInputSchema,
      (command) => workspace.createProject(command),
      reportUnexpected,
    ),
  );
  register(WORKSPACE_IPC_CHANNELS.createTask, (input) =>
    withValidatedInput(
      input,
      CreateTaskInputSchema,
      (command) => workspace.createTask(command),
      reportUnexpected,
    ),
  );
  register(WORKSPACE_IPC_CHANNELS.updateTask, (input) =>
    withValidatedInput(
      input,
      UpdateTaskInputSchema,
      (command) => workspace.updateTask(command),
      reportUnexpected,
    ),
  );
  register(WORKSPACE_IPC_CHANNELS.saveObjective, (input) =>
    withValidatedInput(
      input,
      SaveObjectiveInputSchema,
      (command) => workspace.saveObjective(command),
      reportUnexpected,
    ),
  );
  register(WORKSPACE_IPC_CHANNELS.lockObjective, (input) =>
    withValidatedInput(
      input,
      ObjectiveCommandSchema,
      (command) => workspace.lockObjective(command),
      reportUnexpected,
    ),
  );
  register(WORKSPACE_IPC_CHANNELS.startObjectiveVersion, (input) =>
    withValidatedInput(
      input,
      ObjectiveCommandSchema,
      (command) => workspace.startObjectiveVersion(command),
      reportUnexpected,
    ),
  );
}

function withValidatedInput<TInput, TOutput>(
  input: unknown,
  schema: InputSchema<TInput>,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
): Promise<WorkspaceIpcResult<TOutput>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return Promise.resolve({ ok: false, error: { code: 'invalid_workspace_input' } });
  }
  return safely(() => operation(parsed.data), reportUnexpected);
}

async function safely<T>(
  operation: () => Promise<T>,
  reportUnexpected: (error: unknown) => void,
): Promise<WorkspaceIpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof WorkspaceServiceError) {
      const currentVersion = error.details.currentVersion;
      return {
        ok: false,
        error: {
          code: error.code,
          ...(typeof currentVersion === 'number' ? { currentVersion } : {}),
        },
      };
    }
    if (error instanceof ZodError || error instanceof WorkspaceDataRecoveryError) {
      return { ok: false, error: { code: 'workspace_data_requires_recovery' } };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must never turn a bounded IPC response into a rejected invoke call.
    }
    return { ok: false, error: { code: 'workspace_unavailable' } };
  }
}
