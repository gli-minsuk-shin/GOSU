import type { ZodType } from 'zod';

import {
  CancelSshScopeInputSchema,
  CreateSshConnectionInputSchema,
  RemoveSshConnectionInputSchema,
  ResolveSshApprovalInputSchema,
  TestSshConnectionInputSchema,
  UpdateSshConnectionInputSchema,
} from '../shared/ssh-contracts';
import { SSH_IPC_CHANNELS } from '../shared/ssh-channels';
import type { SshIpcResult } from '../shared/ssh-ipc-result';
import { SshConnectionServiceError, type SshConnectionService } from './ssh-connection-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerSshIpc(
  register: RegisterHandler,
  service: SshConnectionService,
  reportUnexpected: (error: unknown) => void = () => undefined,
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
