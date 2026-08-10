import type { SearchIpcErrorCode } from './search-contracts';

export type SearchIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: SearchIpcErrorCode }> }>;

export function unwrapSearchIpcResult<T>(result: SearchIpcResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(result.error.code);
}
