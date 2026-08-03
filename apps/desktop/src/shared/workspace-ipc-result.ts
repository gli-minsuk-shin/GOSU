export const WORKSPACE_IPC_ERROR_CODES = [
  'project_not_found',
  'project_trashed',
  'project_not_trashed',
  'chat_busy',
  'task_not_found',
  'cross_project_access_denied',
  'objective_not_found',
  'objective_locked',
  'objective_not_locked',
  'version_conflict',
  'invalid_workspace_input',
  'workspace_data_requires_recovery',
  'workspace_unavailable',
] as const;

export type WorkspaceIpcErrorCode = (typeof WORKSPACE_IPC_ERROR_CODES)[number];

export type WorkspaceIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: WorkspaceIpcErrorCode;
        currentVersion?: number | undefined;
      }>;
    }>;

const knownErrorCodes = new Set<string>(WORKSPACE_IPC_ERROR_CODES);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapWorkspaceIpcResult<T>(result: unknown): T {
  if (record(result) && result.ok === true && 'value' in result) return result.value as T;

  if (record(result) && result.ok === false && record(result.error)) {
    const code = result.error.code;
    if (typeof code === 'string' && knownErrorCodes.has(code)) {
      const currentVersion = result.error.currentVersion;
      throw new Error(
        code === 'version_conflict' &&
          typeof currentVersion === 'number' &&
          Number.isSafeInteger(currentVersion) &&
          currentVersion >= 0
          ? `${code}:${currentVersion}`
          : code,
      );
    }
  }

  throw new Error('workspace_unavailable');
}
