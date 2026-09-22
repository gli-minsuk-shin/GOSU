import type { AnalysisRequestSchema } from '../briefing-analysis';
import { trackAiActivity } from '@gosu/ui/ai-activity';
import type { z } from 'zod';
import type { BriefingInsight } from './briefing-intelligence';
import type { LiveItem } from './live-types';
import { sourceResponse } from './live-client';
import type { AnalysisCacheReceipt } from './briefing-cache';
import type { SummaryProvenance } from './summary-provenance';
export type AnalysisResult = BriefingInsight & {
  cache?: AnalysisCacheReceipt;
  provenance?: Record<string, SummaryProvenance>;
  historyId?: string | null;
  kind?: 'papers' | 'email';
  overviewByKind?: Partial<Record<'papers' | 'email', string>>;
  invocation: { providerId: string; model: string; reasoning: string | null };
  memoryUsed: string[];
  memorySave?: {
    state: 'saved' | 'failed';
    saved: number;
    revision: number | null;
    warning: string;
  };
  evidence: { id: string; paper?: LiveItem['paper'] }[];
};
export async function requestBriefingAnalysis(
  input: z.infer<typeof AnalysisRequestSchema>,
  signal: AbortSignal,
  onProgress: (detail: string) => void,
): Promise<AnalysisResult> {
  return trackAiActivity(
    'briefing',
    () => readAnalysisResponse('/analyze', input, signal, onProgress),
    signal,
  );
}
export function refreshBriefingSummary(
  input: { routineId: string; itemId: string; receiptId?: string; historyId?: string },
  signal: AbortSignal,
  onProgress: (detail: string) => void,
  workload: 'briefing' | 'papers' = 'briefing',
) {
  return trackAiActivity(
    workload,
    () => readAnalysisResponse('/summary/refresh', input, signal, onProgress),
    signal,
  );
}
async function readAnalysisResponse(
  path: string,
  input: unknown,
  signal: AbortSignal,
  onProgress: (detail: string) => void,
): Promise<AnalysisResult> {
  const response = await sourceResponse(path, input, signal);
  if (!response.body) throw new Error('분석 응답이 없습니다.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    result: AnalysisResult | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 8_000_000) throw new Error('분석 응답 용량 제한');
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line) as {
          type: string;
          detail: string;
          result: AnalysisResult;
          message: string;
        };
        if (event.type === 'analysis-progress') onProgress(event.detail);
        if (event.type === 'result') result = event.result;
        if (event.type === 'error') throw new Error(event.message);
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!result) throw new Error('분석이 완료되지 않았습니다.');
  return result;
}
