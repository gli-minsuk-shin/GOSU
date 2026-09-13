import { useEffect, useRef, useState } from 'react';
import { defaultAssistantPreferences, type BriefingRoutine } from '@gosu/briefing-core';
import type { LiveSourceResult } from './live-types';
import type { AnalysisResult } from './briefing-analysis-client';
import { mergeCacheReceipts } from './briefing-cache';
import {
  automaticSummaryStatus,
  cancelAutomaticSummary,
  startAutomaticSummary,
  type AutomaticSummaryJobStatus,
} from './automatic-summary-client';

export type SummaryProgress = {
  percent: number;
  completed: number;
  total: number;
  kind: 'email' | 'papers' | 'done';
  range: string;
  detail: string;
};

export function mergeAnalyses(
  current: AnalysisResult | null,
  next: AnalysisResult,
): AnalysisResult {
  const overviewByKind = {
    ...(current?.overviewByKind ?? {}),
    ...(next.overviewByKind ?? {}),
    ...(next.kind ? { [next.kind]: next.overview } : {}),
  };
  const cache = mergeCacheReceipts(current, next);
  return {
    ...next,
    provenance: { ...current?.provenance, ...next.provenance },
    ...(cache ? { cache } : {}),
    overview: overviewByKind.email ?? overviewByKind.papers ?? next.overview,
    overviewByKind,
    items: [
      ...(current?.items ?? []).filter((i) => !next.items.some((n) => n.id === i.id)),
      ...next.items,
    ],
    evidence: [
      ...(current?.evidence ?? []).filter((i) => !next.evidence.some((n) => n.id === i.id)),
      ...next.evidence,
    ],
  };
}

export function AutomaticSummary({
  routine,
  results,
  onResult,
  onProgress,
}: {
  routine: BriefingRoutine;
  results: LiveSourceResult[];
  onResult: (result: AnalysisResult) => void;
  onProgress?: (progress: SummaryProgress) => void;
}) {
  const prefs = routine.live?.assistant ?? defaultAssistantPreferences();
  const receipt = results[0]?.receiptId;
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [retry, setRetry] = useState(0);
  const emit = useRef(onResult);
  const progressListener = useRef(onProgress);
  const control = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  const stopRequested = useRef(false);
  const seenResultIds = useRef(new Set<string>());
  emit.current = onResult;
  progressListener.current = onProgress;

  useEffect(() => {
    if (!receipt) return;
    const hasEmail =
      prefs.mailRead &&
      prefs.mailAi &&
      results.some((result) => result.items.some((item) => item.kind === 'email'));
    const hasPapers =
      prefs.autoPaperSummary &&
      results.some((result) =>
        result.items.some(
          (item) => item.kind === 'papers' && (!item.privateOrigin || prefs.mailAi),
        ),
      );
    if (!hasEmail && !hasPapers) {
      const failed = results.some(
        (result) => result.kind !== 'weather' && result.status === 'failed',
      );
      const detail = failed
        ? '자료 조회가 실패해 AI 요약을 시작하지 못했습니다. 아래 소스별 오류를 확인해주세요.'
        : '자동 요약할 항목 없음 · 설정된 AI 권한/논문 요약 상태를 확인하세요.';
      setStatus(detail);
      progressListener.current?.({
        percent: 0,
        completed: 0,
        total: 0,
        kind: 'done',
        range: '0/0',
        detail,
      });
      return;
    }
    const requestController = new AbortController();
    control.current = requestController;
    let alive = true;
    stopRequested.current = false;
    const apply = (job: AutomaticSummaryJobStatus) => {
      if (!alive || requestController.signal.aborted) return;
      progressListener.current?.({
        percent: job.percent,
        completed: job.completed,
        total: job.total,
        kind: job.kind,
        range: job.range,
        detail: job.detail,
      });
      setStatus(
        `${job.percent}% · ${job.kind === 'email' ? '이메일' : job.kind === 'papers' ? '논문' : '요약'} ${job.range} · ${job.detail}`,
      );
      for (const result of job.results) {
        const key = `${job.id}:${result.kind}:${result.historyId ?? result.items.map((i) => i.id).join(',')}`;
        if (seenResultIds.current.has(key)) continue;
        seenResultIds.current.add(key);
        emit.current({
          ...result,
          kind: result.kind,
          overviewByKind: { ...(result.overviewByKind ?? {}), [result.kind]: result.overview },
        });
      }
      if (job.error) setStatus(`${job.percent}% · ${job.detail} · ${job.error}`);
    };
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        requestController.signal.addEventListener('abort', () => clearTimeout(timer), {
          once: true,
        });
      });
    const run = async () => {
      setBusy(true);
      try {
        const started = await startAutomaticSummary(
          routine.id,
          receipt,
          requestController.signal,
          retry > 0,
        );
        jobId.current = started.id;
        if (stopRequested.current) {
          await cancelAutomaticSummary(routine.id, started.id, new AbortController().signal).catch(
            () => undefined,
          );
          requestController.abort();
          return;
        }
        apply(started);
        let current = started;
        while (alive && !requestController.signal.aborted && current.state === 'running') {
          await wait(500);
          if (!alive || requestController.signal.aborted) return;
          current = await automaticSummaryStatus(routine.id, started.id, requestController.signal);
          apply(current);
        }
      } catch (e) {
        if (alive && !requestController.signal.aborted)
          setStatus(e instanceof Error ? e.message : '자동 요약을 시작하지 못했습니다.');
      } finally {
        if (alive) setBusy(false);
      }
    };
    void run();
    return () => {
      alive = false;
      requestController.abort();
      // A tab switch unmounts this component; the backend job deliberately keeps running.
      if (control.current === requestController) control.current = null;
    };
  }, [receipt, routine.id, prefs.autoPaperSummary, prefs.mailAi, prefs.mailRead, retry]);

  useEffect(() => {
    if (!busy) return;
    const began = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - began) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  if (!receipt) return null;
  return (
    <div className="briefing-auto-summary" aria-live="polite">
      <span className={busy ? 'briefing-busy-dot' : ''} />
      <small>
        {status || '자동 요약 준비'}
        {busy ? ` · ${elapsed}초` : ''}
      </small>
      {busy ? (
        <button
          type="button"
          className="briefing-text-button"
          onClick={() => {
            stopRequested.current = true;
            const id = jobId.current;
            if (id)
              void cancelAutomaticSummary(routine.id, id, new AbortController().signal).catch(
                () => undefined,
              );
            control.current?.abort();
            setBusy(false);
            setStatus('사용자가 자동 요약을 중단했습니다.');
          }}
        >
          중단
        </button>
      ) : (
        <button
          type="button"
          className="briefing-text-button"
          onClick={() => setRetry((n) => n + 1)}
        >
          요약 다시 확인
        </button>
      )}
    </div>
  );
}
