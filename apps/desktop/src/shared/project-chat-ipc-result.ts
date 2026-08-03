export const PROJECT_CHAT_IPC_ERROR_CODES = [
  'project_not_found',
  'project_trashed',
  'chat_busy',
  'chat_not_active',
  'chat_attempt_not_found',
  'chat_attempt_not_retryable',
  'chat_profile_conflict',
  'action_not_found',
  'action_not_proposed',
  'invalid_chat_input',
  'codex_unavailable',
  'chat_unavailable',
] as const;

export type ProjectChatIpcErrorCode = (typeof PROJECT_CHAT_IPC_ERROR_CODES)[number];

export type ProjectChatIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: ProjectChatIpcErrorCode }> }>;

const knownCodes = new Set<string>(PROJECT_CHAT_IPC_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapProjectChatIpcResult<T>(result: unknown): T {
  if (isRecord(result) && result.ok === true && 'value' in result) return result.value as T;
  if (isRecord(result) && result.ok === false && isRecord(result.error)) {
    const code = result.error.code;
    if (typeof code === 'string' && knownCodes.has(code)) throw new Error(code);
  }
  throw new Error('chat_unavailable');
}
