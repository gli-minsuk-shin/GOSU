import type { ZodType } from 'zod';

import {
  ConnectOverleafGitInputSchema,
  CreateManuscriptInputSchema,
  FetchManuscriptCheckpointInputSchema,
  ManuscriptBindingCommandSchema,
  ManuscriptProjectInputSchema,
  UpdateManuscriptInputSchema,
} from '../shared/manuscript-workspace-contracts';
import { MANUSCRIPT_WORKSPACE_IPC_CHANNELS } from '../shared/manuscript-workspace-channels';
import type { ManuscriptWorkspaceIpcResult } from '../shared/manuscript-workspace-ipc-result';
import {
  ManuscriptWorkspaceServiceError,
  type ManuscriptWorkspaceService,
} from './manuscript-workspace-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerManuscriptWorkspaceIpc(
  register: RegisterHandler,
  service: ManuscriptWorkspaceService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.list, (input) =>
    withValidatedInput(
      input,
      ManuscriptProjectInputSchema,
      (command) => service.list(command),
      reportUnexpected,
    ),
  );
  register(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.create, (input) =>
    withValidatedInput(
      input,
      CreateManuscriptInputSchema,
      (command) => service.create(command),
      reportUnexpected,
    ),
  );
  register(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.update, (input) =>
    withValidatedInput(
      input,
      UpdateManuscriptInputSchema,
      (command) => service.update(command),
      reportUnexpected,
    ),
  );
  register(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.connectOverleafGit, (input) =>
    withValidatedInput(
      input,
      ConnectOverleafGitInputSchema,
      (command) => service.connectOverleafGit(command),
      reportUnexpected,
    ),
  );
  register(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.inspect, (input) =>
    withValidatedInput(
      input,
      ManuscriptBindingCommandSchema,
      (command) => service.inspect(command),
      reportUnexpected,
    ),
  );
  register(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.fetchCheckpoint, (input) =>
    withValidatedInput(
      input,
      FetchManuscriptCheckpointInputSchema,
      (command) => service.fetchCheckpoint(command),
      reportUnexpected,
    ),
  );
  register(MANUSCRIPT_WORKSPACE_IPC_CHANNELS.disconnect, (input) =>
    withValidatedInput(
      input,
      ManuscriptBindingCommandSchema,
      (command) => service.disconnect(command),
      reportUnexpected,
    ),
  );
}

async function withValidatedInput<TInput, TOutput>(
  input: unknown,
  schema: ZodType<TInput>,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
): Promise<ManuscriptWorkspaceIpcResult<TOutput>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid_manuscript_workspace_input' } };
  }
  try {
    return { ok: true, value: await operation(parsed.data) };
  } catch (error) {
    if (error instanceof ManuscriptWorkspaceServiceError) {
      return { ok: false, error: { code: error.code } };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not turn a bounded connector result into a rejected invoke call.
    }
    return { ok: false, error: { code: 'manuscript_workspace_unavailable' } };
  }
}
