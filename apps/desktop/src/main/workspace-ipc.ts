import { ZodError } from 'zod';

import {
  type CreateProjectInput,
  type CreateTaskInput,
  type ObjectiveCommand,
  type SaveObjectiveInput,
  type UpdateTaskInput,
} from '../shared/workspace-contracts';
import { WORKSPACE_IPC_CHANNELS } from '../shared/workspace-channels';
import { WorkspaceServiceError, type WorkspaceService } from './workspace-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerWorkspaceIpc(register: RegisterHandler, workspace: WorkspaceService) {
  register(WORKSPACE_IPC_CHANNELS.snapshot, () => safely(() => workspace.snapshot()));
  register(WORKSPACE_IPC_CHANNELS.pendingSummary, () => safely(() => workspace.pendingSummary()));
  register(WORKSPACE_IPC_CHANNELS.createProject, (input) =>
    safely(() => workspace.createProject(input as CreateProjectInput)),
  );
  register(WORKSPACE_IPC_CHANNELS.createTask, (input) =>
    safely(() => workspace.createTask(input as CreateTaskInput)),
  );
  register(WORKSPACE_IPC_CHANNELS.updateTask, (input) =>
    safely(() => workspace.updateTask(input as UpdateTaskInput)),
  );
  register(WORKSPACE_IPC_CHANNELS.saveObjective, (input) =>
    safely(() => workspace.saveObjective(input as SaveObjectiveInput)),
  );
  register(WORKSPACE_IPC_CHANNELS.lockObjective, (input) =>
    safely(() => workspace.lockObjective(input as ObjectiveCommand)),
  );
  register(WORKSPACE_IPC_CHANNELS.startObjectiveVersion, (input) =>
    safely(() => workspace.startObjectiveVersion(input as ObjectiveCommand)),
  );
}

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspaceServiceError) {
      const currentVersion = error.details.currentVersion;
      throw new Error(
        typeof currentVersion === 'number' ? `${error.code}:${currentVersion}` : error.code,
        { cause: error },
      );
    }
    if (error instanceof ZodError) throw new Error('invalid_workspace_input', { cause: error });
    throw new Error('workspace_unavailable', { cause: error });
  }
}
