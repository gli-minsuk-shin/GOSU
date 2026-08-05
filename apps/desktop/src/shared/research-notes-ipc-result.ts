import {
  RESEARCH_NOTES_IPC_ERROR_CODES,
  type ResearchNotesIpcErrorCode,
} from './research-notes-contracts';

export type ResearchNotesIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: ResearchNotesIpcErrorCode }> }>;

const knownCodes = new Set<string>(RESEARCH_NOTES_IPC_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapResearchNotesIpcResult<T>(result: unknown): T {
  if (isRecord(result) && result.ok === true && 'value' in result) return result.value as T;
  if (isRecord(result) && result.ok === false && isRecord(result.error)) {
    const code = result.error.code;
    if (typeof code === 'string' && knownCodes.has(code)) throw new Error(code);
  }
  throw new Error('research_notes_unavailable');
}
