import type { AnalysisResult } from './briefing-analysis-client';

export type AnalysisCacheReceipt = {
  feedbackProfileRevision: number | null;
  reusedItemIds: string[];
  generatedItemIds: string[];
};

export function briefingCacheLabel(analysis: AnalysisResult, pending = false) {
  if (!analysis.cache || !analysis.items.length) return '';
  const ids = new Set(analysis.items.map((item) => item.id));
  const reused = new Set(analysis.cache.reusedItemIds.filter((id) => ids.has(id)));
  const generated = new Set(analysis.cache.generatedItemIds.filter((id) => ids.has(id)));
  if (!reused.size) return '';
  if (pending) return `캐시 ${reused.size}건 재사용 · 나머지 처리 중`;
  if (reused.size === ids.size && generated.size === 0) return '캐시 재사용 · LLM 호출 없음';
  return `캐시 ${reused.size}건 재사용${generated.size ? ` · ${generated.size}건 새로 요약` : ''}`;
}

export function mergeCacheReceipts(
  current: AnalysisResult | null,
  next: AnalysisResult,
): AnalysisCacheReceipt | undefined {
  if (!current?.cache && !next.cache) return undefined;
  const replaced = new Set(next.items.map((item) => item.id));
  const merge = (key: 'reusedItemIds' | 'generatedItemIds') => [
    ...new Set([
      ...(current?.cache?.[key] ?? []).filter((id) => !replaced.has(id)),
      ...(next.cache?.[key] ?? []),
    ]),
  ];
  return {
    feedbackProfileRevision: !current
      ? (next.cache?.feedbackProfileRevision ?? null)
      : current.cache?.feedbackProfileRevision === next.cache?.feedbackProfileRevision
        ? (next.cache?.feedbackProfileRevision ?? null)
        : null,
    reusedItemIds: merge('reusedItemIds'),
    generatedItemIds: merge('generatedItemIds'),
  };
}
