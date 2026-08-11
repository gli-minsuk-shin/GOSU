import type { ExperimentEvaluationIpcErrorCode } from './experiment-evaluation-contracts';
import { EXPERIMENT_EVALUATION_IPC_ERROR_CODES } from './experiment-evaluation-contracts';

const knownCodes = new Set<string>(EXPERIMENT_EVALUATION_IPC_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ExperimentEvaluationIpcError extends Error {
  constructor(readonly code: ExperimentEvaluationIpcErrorCode) {
    super(code);
    this.name = 'ExperimentEvaluationIpcError';
  }
}

export function unwrapExperimentEvaluationIpcResult<T>(result: unknown): T {
  if (isRecord(result) && result.ok === true && 'value' in result) return result.value as T;
  if (isRecord(result) && result.ok === false && isRecord(result.error)) {
    const code = result.error.code;
    if (typeof code === 'string' && knownCodes.has(code)) {
      throw new ExperimentEvaluationIpcError(code as ExperimentEvaluationIpcErrorCode);
    }
  }
  throw new ExperimentEvaluationIpcError('experiment_evaluation_unavailable');
}
