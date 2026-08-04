import {
  LITERATURE_IPC_ERROR_CODES,
  type LiteratureIpcErrorCode,
  type LiteratureIpcResult,
} from './literature-contracts';

export type { LiteratureIpcErrorCode, LiteratureIpcResult } from './literature-contracts';

const knownCodes = new Set<string>(LITERATURE_IPC_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapLiteratureIpcResult<T>(result: unknown): T {
  if (isRecord(result) && result.ok === true && 'value' in result) return result.value as T;
  if (isRecord(result) && result.ok === false && isRecord(result.error)) {
    const code = result.error.code;
    if (typeof code === 'string' && knownCodes.has(code)) throw new Error(code);
  }
  throw new Error('literature_unavailable');
}

export function literatureIpcFailure(code: LiteratureIpcErrorCode): LiteratureIpcResult<never> {
  return { ok: false, error: { code } };
}
