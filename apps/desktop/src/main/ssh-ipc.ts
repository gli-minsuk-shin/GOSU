import type { ZodType } from 'zod';

import {
  CancelSshScopeInputSchema,
  CreateSshConnectionInputSchema,
  ImportSshCommandInputSchema,
  ListProjectSshResourceSnapshotsInputSchema,
  ReadProjectSshResourceSnapshotInputSchema,
  ReadSshResourceSnapshotInputSchema,
  RemoveSshConnectionInputSchema,
  ResolveSshApprovalInputSchema,
  TestSshConnectionInputSchema,
  UpdateSshConnectionInputSchema,
} from '../shared/ssh-contracts';
import { SSH_IPC_CHANNELS } from '../shared/ssh-channels';
import type { SshIpcResult } from '../shared/ssh-ipc-result';
import {
  CreateRemoteWorkspaceGrantInputSchema,
  ListRemoteWorkspaceGrantsInputSchema,
  RemoveRemoteWorkspaceGrantInputSchema,
  UpdateRemoteWorkspaceGrantInputSchema,
} from '../shared/ssh-workspace-contracts';
import { SshConnectionServiceError, type SshConnectionService } from './ssh-connection-service';
import type { WorkspaceService } from './workspace-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerSshIpc(
  register: RegisterHandler,
  service: SshConnectionService,
  reportUnexpected: (error: unknown) => void = () => undefined,
  workspace?: WorkspaceService,
) {
  register(SSH_IPC_CHANNELS.listConnections, () =>
    safely(() => service.listConnections(), reportUnexpected),
  );
  register(SSH_IPC_CHANNELS.createConnection, (input) =>
    withInput(
      input,
      CreateSshConnectionInputSchema,
      (command) => service.createConnection(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.importCommand, (input) =>
    withInput(
      input,
      ImportSshCommandInputSchema,
      (command) => service.importCommand(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.updateConnection, (input) =>
    withInput(
      input,
      UpdateSshConnectionInputSchema,
      (command) => service.updateConnection(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.removeConnection, (input) =>
    withInput(
      input,
      RemoveSshConnectionInputSchema,
      (command) => service.removeConnection(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.testConnection, (input) =>
    withInput(
      input,
      TestSshConnectionInputSchema,
      (command) => service.testConnection(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.readResourceSnapshot, (input) =>
    withInput(
      input,
      ReadSshResourceSnapshotInputSchema,
      (command) => service.readResourceSnapshot(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.readProjectResourceSnapshot, (input) =>
    withActiveProjectInput(
      input,
      ReadProjectSshResourceSnapshotInputSchema,
      workspace,
      (command) => service.readProjectResourceSnapshot(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.listProjectResourceSnapshots, (input) =>
    withActiveProjectInput(
      input,
      ListProjectSshResourceSnapshotsInputSchema,
      workspace,
      (command) => service.listProjectResourceSnapshots(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.listWorkspaceGrants, (input) =>
    withActiveProjectInput(
      input,
      ListRemoteWorkspaceGrantsInputSchema,
      workspace,
      (command) => service.listWorkspaceGrants(command.projectId),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.createWorkspaceGrant, (input) =>
    withActiveProjectInput(
      input,
      CreateRemoteWorkspaceGrantInputSchema,
      workspace,
      (command) => service.createWorkspaceGrant(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.updateWorkspaceGrant, (input) =>
    withActiveProjectInput(
      input,
      UpdateRemoteWorkspaceGrantInputSchema,
      workspace,
      (command) => service.updateWorkspaceGrant(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.removeWorkspaceGrant, (input) =>
    withActiveProjectInput(
      input,
      RemoveRemoteWorkspaceGrantInputSchema,
      workspace,
      (command) => service.removeWorkspaceGrant(command),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.resolveApproval, (input) =>
    withInput(
      input,
      ResolveSshApprovalInputSchema,
      (command) => Promise.resolve(service.resolveApproval(command)),
      reportUnexpected,
    ),
  );
  register(SSH_IPC_CHANNELS.cancelScope, (input) =>
    withInput(
      input,
      CancelSshScopeInputSchema,
      (command) =>
        Promise.resolve({
          cancelled: command.sessionId
            ? service.cancelSession(command.projectId, command.sessionId)
            : service.cancelProject(command.projectId),
        }),
      reportUnexpected,
    ),
  );
}

function withActiveProjectInput<TInput extends { projectId: string }, TOutput>(
  input: unknown,
  schema: ZodType<TInput>,
  workspace: WorkspaceService | undefined,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return Promise.resolve<SshIpcResult<TOutput>>({
      ok: false,
      error: { code: 'invalid_ssh_input' },
    });
  }
  return safely(async () => {
    if (!workspace) throw new SshConnectionServiceError('ssh_workspace_project_unavailable');
    const snapshot = await workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === parsed.data.projectId);
    if (!project || project.archivedAt !== undefined || project.trashedAt !== undefined) {
      throw new SshConnectionServiceError('ssh_workspace_project_unavailable');
    }
    return operation(parsed.data);
  }, reportUnexpected);
}

function withInput<TInput, TOutput>(
  input: unknown,
  schema: ZodType<TInput>,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return Promise.resolve<SshIpcResult<TOutput>>({
      ok: false,
      error: { code: 'invalid_ssh_input' },
    });
  }
  return safely(() => operation(parsed.data), reportUnexpected);
}

async function safely<T>(
  operation: () => Promise<T>,
  reportUnexpected: (error: unknown) => void,
): Promise<SshIpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof SshConnectionServiceError) {
      return { ok: false, error: { code: error.code } };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not turn a bounded SSH response into a rejected invoke call.
    }
    return { ok: false, error: { code: 'ssh_unavailable' } };
  }
}
