export const GIT_WORKSPACE_IPC_ERROR_CODES = [
  'project_not_found',
  'project_archived',
  'project_trashed',
  'repository_identifier_required',
  'repository_not_cloned',
  'repository_already_cloned',
  'repository_root_changed',
  'repository_unsafe',
  'git_unavailable',
  'git_operation_failed',
  'git_auth_required',
  'git_dirty_worktree',
  'git_head_changed',
  'git_index_changed',
  'git_detached_head',
  'git_no_commits',
  'git_no_remote',
  'git_no_upstream',
  'git_nothing_to_commit',
  'git_identity_required',
  'git_commit_not_available',
  'git_branch_exists',
  'git_branch_not_found',
  'git_conflict',
  'git_path_blocked',
  'git_file_too_large',
  'git_binary_file',
  'git_output_too_large',
  'invalid_git_workspace_input',
  'git_workspace_unavailable',
] as const;

export type GitWorkspaceIpcErrorCode = (typeof GIT_WORKSPACE_IPC_ERROR_CODES)[number];

export type GitWorkspaceIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: GitWorkspaceIpcErrorCode;
        currentHead?: string | undefined;
      }>;
    }>;

const knownErrorCodes = new Set<string>(GIT_WORKSPACE_IPC_ERROR_CODES);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapGitWorkspaceIpcResult<T>(result: unknown): T {
  if (record(result) && result.ok === true && 'value' in result) return result.value as T;
  if (record(result) && result.ok === false && record(result.error)) {
    const code = result.error.code;
    if (typeof code === 'string' && knownErrorCodes.has(code)) {
      const currentHead = result.error.currentHead;
      throw new Error(
        code === 'git_head_changed' && typeof currentHead === 'string'
          ? `${code}:${currentHead}`
          : code,
      );
    }
  }
  throw new Error('git_workspace_unavailable');
}
