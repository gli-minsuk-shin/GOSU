import {
  LECTURE_STUDIO_IPC_ERROR_CODES,
  type LectureStudioIpcErrorCode,
  type LectureStudioIpcResult,
} from './lecture-studio-contracts';

const knownCodes = new Set<string>(LECTURE_STUDIO_IPC_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapLectureStudioIpcResult<T>(result: unknown): T {
  if (isRecord(result) && result.ok === true && 'value' in result) return result.value as T;
  if (isRecord(result) && result.ok === false && isRecord(result.error)) {
    const code = result.error.code;
    if (typeof code === 'string' && knownCodes.has(code)) throw new Error(code);
  }
  throw new Error('lecture_unavailable');
}

export function lectureStudioIpcFailure(
  code: LectureStudioIpcErrorCode,
): LectureStudioIpcResult<never> {
  return { ok: false, error: { code } };
}
