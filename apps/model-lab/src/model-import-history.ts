import type { ModelBuildProgressPhase } from './model-lab-builder';

export const MODEL_IMPORT_HISTORY_STORAGE_KEY = 'gosu.model-lab.import-history.v1';
export const MODEL_IMPORT_HISTORY_MAX_JOBS = 8;

export type ModelImportPhase =
  ModelBuildProgressPhase | 'local-validation' | 'registering-session' | 'complete' | 'cancelled';

export type ModelImportJob = Readonly<{
  id: string;
  name: string;
  status: 'session-created' | 'model-building' | 'rejected';
  phase: ModelImportPhase;
  detail: string;
  runLabel: string;
  events: readonly string[];
}>;

type ImportHistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

const phases = new Set<ModelImportPhase>([
  'cache-checking',
  'cache-hit',
  'cache-miss',
  'request-validated',
  'selection-resolved',
  'sources-preparing',
  'sources-prepared',
  'llm-running',
  'model-ir-validating',
  'model-ir-repairing',
  'model-ir-validated',
  'failed',
  'local-validation',
  'registering-session',
  'complete',
  'cancelled',
]);

function boundedString(value: unknown, maximum: number) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function parsedJob(value: unknown): ModelImportJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ModelImportJob>;
  const id = boundedString(candidate.id, 160);
  const name = boundedString(candidate.name, 1_000);
  const detail = boundedString(candidate.detail, 20_000);
  const runLabel = boundedString(candidate.runLabel, 2_000);
  if (
    !id ||
    !name ||
    !detail ||
    !runLabel ||
    !candidate.phase ||
    !phases.has(candidate.phase) ||
    !candidate.status ||
    !['session-created', 'model-building', 'rejected'].includes(candidate.status) ||
    !Array.isArray(candidate.events) ||
    !candidate.events.every((event) => boundedString(event, 20_000) !== null)
  ) {
    return null;
  }
  if (candidate.status === 'model-building') {
    const interrupted =
      'Import was interrupted by a page reload before a validated ModelIR was saved.';
    return {
      id,
      name,
      status: 'rejected',
      phase: 'failed',
      detail: interrupted,
      runLabel,
      events: [...candidate.events, interrupted].slice(-4),
    };
  }
  return {
    id,
    name,
    status: candidate.status,
    phase: candidate.phase,
    detail,
    runLabel,
    events: candidate.events.slice(-4),
  };
}

export function readModelImportHistory(storage: ImportHistoryStorage | undefined) {
  if (!storage) return [] as readonly ModelImportJob[];
  try {
    const text = storage.getItem(MODEL_IMPORT_HISTORY_STORAGE_KEY);
    if (!text || text.length > 200_000) return [];
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value
      .map(parsedJob)
      .filter((job): job is ModelImportJob => job !== null)
      .slice(-MODEL_IMPORT_HISTORY_MAX_JOBS);
  } catch {
    return [];
  }
}

export function writeModelImportHistory(
  storage: ImportHistoryStorage | undefined,
  jobs: readonly ModelImportJob[],
) {
  if (!storage) return false;
  try {
    storage.setItem(
      MODEL_IMPORT_HISTORY_STORAGE_KEY,
      JSON.stringify(jobs.slice(-MODEL_IMPORT_HISTORY_MAX_JOBS)),
    );
    return true;
  } catch {
    return false;
  }
}
