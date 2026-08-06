import { ZodError } from 'zod';

import {
  ApplyProjectChatActionInputSchema,
  BranchProjectChatSessionInputSchema,
  CreateProjectChatSessionInputSchema,
  ProjectChatProjectInputSchema,
  ProjectChatQueuedTurnInputSchema,
  ProjectChatSessionInputSchema,
  ProjectChatSnapshotInputSchema,
  RenameProjectChatSessionInputSchema,
  SendProjectChatMessageInputSchema,
  UpdateProjectChatQueuedTurnInputSchema,
  UpdateProjectChatProfileInputSchema,
} from '../shared/project-chat-contracts';
import { PROJECT_CHAT_IPC_CHANNELS } from '../shared/project-chat-channels';
import type { ProjectChatIpcResult } from '../shared/project-chat-ipc-result';
import { ProjectChatServiceError, type ProjectChatService } from './project-chat-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;
type InputSchema<T> = Readonly<{
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}>;

export function registerProjectChatIpc(
  register: RegisterHandler,
  chat: ProjectChatService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(PROJECT_CHAT_IPC_CHANNELS.snapshot, (input) =>
    withInput(
      input,
      ProjectChatSnapshotInputSchema,
      (command) => chat.snapshot(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.listSessions, (input) =>
    withInput(
      input,
      ProjectChatProjectInputSchema,
      (command) => chat.listSessions(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.createSession, (input) =>
    withInput(
      input,
      CreateProjectChatSessionInputSchema,
      (command) => chat.createSession(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.branchSession, (input) =>
    withInput(
      input,
      BranchProjectChatSessionInputSchema,
      (command) => chat.branchSession(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.renameSession, (input) =>
    withInput(
      input,
      RenameProjectChatSessionInputSchema,
      (command) => chat.renameSession(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.send, (input) =>
    withInput(
      input,
      SendProjectChatMessageInputSchema,
      (command) => chat.send(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.updateQueuedTurn, (input) =>
    withInput(
      input,
      UpdateProjectChatQueuedTurnInputSchema,
      (command) => chat.updateQueuedTurn(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.removeQueuedTurn, (input) =>
    withInput(
      input,
      ProjectChatQueuedTurnInputSchema,
      (command) => chat.removeQueuedTurn(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.runQueuedTurnNow, (input) =>
    withInput(
      input,
      ProjectChatQueuedTurnInputSchema,
      (command) => chat.runQueuedTurnNow(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.updateProfile, (input) =>
    withInput(
      input,
      UpdateProjectChatProfileInputSchema,
      (command) => chat.updateProfile(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.cancel, (input) =>
    withInput(
      input,
      ProjectChatSessionInputSchema,
      (command) => chat.cancel(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.revokeSsh, (input) =>
    withInput(
      input,
      ProjectChatSessionInputSchema,
      (command) => chat.revokeSsh(command),
      reportUnexpected,
    ),
  );
  register(PROJECT_CHAT_IPC_CHANNELS.applyAction, (input) =>
    withInput(
      input,
      ApplyProjectChatActionInputSchema,
      (command) => chat.applyAction(command),
      reportUnexpected,
    ),
  );
}

function withInput<TInput, TOutput>(
  input: unknown,
  schema: InputSchema<TInput>,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return Promise.resolve<ProjectChatIpcResult<TOutput>>({
      ok: false,
      error: { code: 'invalid_chat_input' },
    });
  }
  return safely(() => operation(parsed.data), reportUnexpected);
}

async function safely<T>(
  operation: () => Promise<T>,
  reportUnexpected: (error: unknown) => void,
): Promise<ProjectChatIpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof ProjectChatServiceError) {
      return { ok: false, error: { code: error.code } };
    }
    if (error instanceof ZodError) {
      return { ok: false, error: { code: 'invalid_chat_input' } };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not change the bounded IPC response.
    }
    return { ok: false, error: { code: 'chat_unavailable' } };
  }
}
