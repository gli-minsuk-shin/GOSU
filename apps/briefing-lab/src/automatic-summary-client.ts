import { sourceRequest } from './live-client';
import type { AnalysisResult } from './briefing-analysis-client';

export type AutomaticSummaryJobStatus = {
  id: string;
  routineId: string;
  receiptId: string;
  state: 'running' | 'complete' | 'failed' | 'cancelled';
  percent: number;
  completed: number;
  total: number;
  kind: 'email' | 'papers' | 'done';
  range: string;
  detail: string;
  results: (AnalysisResult & { kind: 'email' | 'papers' })[];
  error: string | null;
  updatedAt: number;
};

export function startAutomaticSummary(
  routineId: string,
  receiptId: string,
  signal: AbortSignal,
  force = false,
) {
  return sourceRequest<AutomaticSummaryJobStatus>(
    '/assistant/auto-summary/start',
    { routineId, receiptId, ...(force ? { force: true } : {}) },
    signal,
  );
}

export function automaticSummaryStatus(routineId: string, jobId: string, signal: AbortSignal) {
  return sourceRequest<AutomaticSummaryJobStatus>(
    '/assistant/auto-summary/status',
    { routineId, jobId },
    signal,
  );
}

export function cancelAutomaticSummary(routineId: string, jobId: string, signal: AbortSignal) {
  return sourceRequest<AutomaticSummaryJobStatus>(
    '/assistant/auto-summary/cancel',
    { routineId, jobId },
    signal,
  );
}
