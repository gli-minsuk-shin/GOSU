export const OVERLEAF_PERSONAL_TOKEN_IPC_ERROR_CODES = [
  'overleaf_token_invalid',
  'overleaf_keychain_unavailable',
  'invalid_overleaf_personal_token_input',
  'overleaf_personal_token_unavailable',
] as const;

export type OverleafPersonalTokenIpcErrorCode =
  (typeof OVERLEAF_PERSONAL_TOKEN_IPC_ERROR_CODES)[number];

export type OverleafPersonalTokenIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: OverleafPersonalTokenIpcErrorCode }> }>;

const knownErrorCodes = new Set<string>(OVERLEAF_PERSONAL_TOKEN_IPC_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapOverleafPersonalTokenIpcResult<T>(result: unknown): T {
  if (isRecord(result) && result.ok === true && 'value' in result) return result.value as T;
  if (
    isRecord(result) &&
    result.ok === false &&
    isRecord(result.error) &&
    typeof result.error.code === 'string' &&
    knownErrorCodes.has(result.error.code)
  ) {
    throw new Error(result.error.code);
  }
  throw new Error('overleaf_personal_token_unavailable');
}
