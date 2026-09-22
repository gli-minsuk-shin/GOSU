import { describe, expect, it } from 'vitest';
import {
  MODEL_IMPORT_HISTORY_STORAGE_KEY,
  readModelImportHistory,
  writeModelImportHistory,
  type ModelImportJob,
} from './model-import-history';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(MODEL_IMPORT_HISTORY_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

const failedJob: ModelImportJob = {
  id: 'build-1',
  name: 'mochi_single.py',
  status: 'rejected',
  phase: 'failed',
  detail: 'Builder audit failed: exact port mismatch.',
  runLabel: 'Codex · GPT-5.6-Sol · high',
  events: ['AST selected MochiYuzuSolver.solve_path.', 'Audit rejected the final ModelIR.'],
};
it('persists an explicitly cancelled import without restoring it as running or complete', () => {
  const storage = memoryStorage();
  const job = { ...failedJob, phase: 'cancelled' as const, detail: 'Stopped by user' };
  writeModelImportHistory(storage, [job]);
  expect(readModelImportHistory(storage)).toEqual([job]);
});

describe('model import history', () => {
  it('persists the exact failed import receipt across a reload', () => {
    const storage = memoryStorage();
    expect(writeModelImportHistory(storage, [failedJob])).toBe(true);
    expect(readModelImportHistory(storage)).toEqual([failedJob]);
  });

  it('marks an in-flight import as interrupted after a reload', () => {
    const storage = memoryStorage(
      JSON.stringify([{ ...failedJob, status: 'model-building', phase: 'llm-running' }]),
    );
    expect(readModelImportHistory(storage)[0]).toMatchObject({
      status: 'rejected',
      phase: 'failed',
      detail: expect.stringContaining('page reload'),
    });
  });

  it('ignores malformed or oversized persisted values', () => {
    expect(readModelImportHistory(memoryStorage('{bad'))).toEqual([]);
    expect(readModelImportHistory(memoryStorage('x'.repeat(200_001)))).toEqual([]);
  });
});
