import type { ZodType } from 'zod';

import {
  GitCommitDetailInputSchema,
  GitCommitInputSchema,
  GitCreateBranchInputSchema,
  GitDiffInputSchema,
  GitFileInputSchema,
  GitHeadCommandSchema,
  GitPathsCommandSchema,
  GitProjectInputSchema,
  GitSwitchBranchInputSchema,
  type GitHeadCommand,
} from '../shared/git-workspace-contracts';
import { GIT_WORKSPACE_IPC_CHANNELS } from '../shared/git-workspace-channels';
import type { GitWorkspaceIpcResult } from '../shared/git-workspace-ipc-result';
import { GitWorkspaceServiceError, type GitWorkspaceService } from './git-workspace-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerGitWorkspaceIpc(
  register: RegisterHandler,
  service: GitWorkspaceService,
  platform: Readonly<{ reveal(path: string): Promise<void> | void }>,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(GIT_WORKSPACE_IPC_CHANNELS.snapshot, (input) =>
    withValidatedInput(
      input,
      GitProjectInputSchema,
      (command) => service.snapshot(command.projectId),
      reportUnexpected,
    ),
  );
  register(GIT_WORKSPACE_IPC_CHANNELS.clone, (input) =>
    withValidatedInput(
      input,
      GitProjectInputSchema,
      (command) => service.clone(command.projectId),
      reportUnexpected,
    ),
  );
  register(GIT_WORKSPACE_IPC_CHANNELS.readFile, (input) =>
    withValidatedInput(
      input,
      GitFileInputSchema,
      (command) => service.readFile(command),
      reportUnexpected,
    ),
  );
  register(GIT_WORKSPACE_IPC_CHANNELS.diff, (input) =>
    withValidatedInput(
      input,
      GitDiffInputSchema,
      (command) => service.diff(command),
      reportUnexpected,
    ),
  );
  register(GIT_WORKSPACE_IPC_CHANNELS.commitDetail, (input) =>
    withValidatedInput(
      input,
      GitCommitDetailInputSchema,
      (command) => service.commitDetail(command.projectId, command.commitSha),
      reportUnexpected,
    ),
  );
  register(GIT_WORKSPACE_IPC_CHANNELS.stage, (input) =>
    withValidatedInput(
      input,
      GitPathsCommandSchema,
      (command) => service.stage(command),
      reportUnexpected,
    ),
  );
  register(GIT_WORKSPACE_IPC_CHANNELS.unstage, (input) =>
    withValidatedInput(
      input,
      GitPathsCommandSchema,
      (command) => service.unstage(command),
      reportUnexpected,
    ),
  );
  register(GIT_WORKSPACE_IPC_CHANNELS.commit, (input) =>
    withValidatedInput(
      input,
      GitCommitInputSchema,
      (command) => service.commit(command),
      reportUnexpected,
    ),
  );
  register(GIT_WORKSPACE_IPC_CHANNELS.createBranch, (input) =>
    withValidatedInput(
      input,
      GitCreateBranchInputSchema,
      (command) => service.createBranch(command),
      reportUnexpected,
    ),
  );
  register(GIT_WORKSPACE_IPC_CHANNELS.switchBranch, (input) =>
    withValidatedInput(
      input,
      GitSwitchBranchInputSchema,
      (command) => service.switchBranch(command),
      reportUnexpected,
    ),
  );
  for (const [channel, operation] of [
    [GIT_WORKSPACE_IPC_CHANNELS.fetch, (command: GitHeadCommand) => service.fetch(command)],
    [GIT_WORKSPACE_IPC_CHANNELS.pull, (command: GitHeadCommand) => service.pull(command)],
    [GIT_WORKSPACE_IPC_CHANNELS.push, (command: GitHeadCommand) => service.push(command)],
  ] as const) {
    register(channel, (input) =>
      withValidatedInput(input, GitHeadCommandSchema, operation, reportUnexpected),
    );
  }
  register(GIT_WORKSPACE_IPC_CHANNELS.reveal, (input) =>
    withValidatedInput(
      input,
      GitProjectInputSchema,
      async (command) => {
        await platform.reveal(await service.revealPath(command.projectId));
        return { revealed: true as const };
      },
      reportUnexpected,
    ),
  );
}

async function withValidatedInput<TInput, TOutput>(
  input: unknown,
  schema: ZodType<TInput>,
  operation: (command: TInput) => Promise<TOutput>,
  reportUnexpected: (error: unknown) => void,
): Promise<GitWorkspaceIpcResult<TOutput>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid_git_workspace_input' } };
  }
  try {
    return { ok: true, value: await operation(parsed.data) };
  } catch (error) {
    if (error instanceof GitWorkspaceServiceError) {
      return {
        ok: false,
        error: {
          code: error.code,
          ...(error.details.currentHead ? { currentHead: error.details.currentHead } : {}),
        },
      };
    }
    try {
      reportUnexpected(error);
    } catch {
      // Diagnostics must not turn a bounded Git result into a rejected invoke call.
    }
    return { ok: false, error: { code: 'git_workspace_unavailable' } };
  }
}
