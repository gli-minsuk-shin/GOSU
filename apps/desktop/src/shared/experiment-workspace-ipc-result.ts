import {
  EXPERIMENT_IPC_ERROR_CODES,
  type ExperimentIpcErrorCode,
  type ExperimentIpcResult,
} from './experiment-workspace-contracts';

const knownCodes = new Set<string>(EXPERIMENT_IPC_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapExperimentIpcResult<T>(result: unknown): T {
  if (isRecord(result) && result.ok === true && 'value' in result) return result.value as T;
  if (isRecord(result) && result.ok === false && isRecord(result.error)) {
    const code = result.error.code;
    if (typeof code === 'string' && knownCodes.has(code)) throw new Error(code);
  }
  throw new Error('experiment_unavailable');
}

export function experimentIpcFailure(code: ExperimentIpcErrorCode): ExperimentIpcResult<never> {
  return { ok: false, error: { code } };
}
