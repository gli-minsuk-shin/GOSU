import { useEffect, useRef, useState } from 'react';
import { sourceRequest } from './live-client';
import { BRIEFING_HISTORY_CHANGED } from './briefing-history-removal';
import type { GenerationView } from './briefing-generation-contract';
import { BriefingGenerationProgress } from './briefing-generation-progress';
const empty: GenerationView = { intervalHours: 0, nextDueAt: null, scheduleError: null, job: null };
export function BriefingGenerationControls({ routineId }: { routineId: string }) {
  const [view, setView] = useState(empty),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    request = useRef<AbortController | null>(null),
    stamp = useRef(''),
    revision = useRef(0);
  const apply = (next: GenerationView) => {
    if (!next || typeof next.intervalHours !== 'number') return;
    setView(next);
    const current = JSON.stringify([
      next.job?.id,
      next.job?.runId,
      next.job?.newCount,
      next.job?.state,
    ]);
    if (next.job && stamp.current !== current) {
      stamp.current = current;
      if (typeof window !== 'undefined')
        window.dispatchEvent?.(new Event(BRIEFING_HISTORY_CHANGED));
    }
  };
  useEffect(() => {
    const c = new AbortController();
    let checking = false;
    const check = async () => {
      if (checking || lock.current) return;
      checking = true;
      const version = ++revision.current;
      try {
        const next = await sourceRequest<GenerationView>(
          '/generation/status',
          { routineId },
          c.signal,
        );
        if (!c.signal.aborted && !lock.current && version === revision.current) apply(next);
      } catch {
        /* An explicit action reports setup errors; polling never initiates generation. */
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => {
      c.abort();
      revision.current++;
      request.current?.abort();
      clearInterval(timer);
    };
  }, [routineId]);
  const action = async (path: string, extra = {}) => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError('');
    const c = new AbortController();
    const version = ++revision.current;
    request.current = c;
    try {
      const next = await sourceRequest<GenerationView>(path, { routineId, ...extra }, c.signal);
      if (!c.signal.aborted && version === revision.current) apply(next);
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : '브리핑 생성 요청에 실패했습니다.');
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  const running = view.job?.state === 'running';
  return (
    <div className="briefing-generation-controls">
      <div className="briefing-generation-buttons">
        <label title="Mac이 깨어 있고 Briefing Lab 서버가 실행 중일 때 생성합니다. 브라우저를 닫아도 계속되며 새 자료의 AI 요약에는 사용량이 발생합니다.">
          <span>자동 브리핑</span>
          <select
            aria-label="자동 브리핑 간격"
            value={view.intervalHours}
            disabled={pending}
            onChange={(e) =>
              void action('/generation/schedule', { intervalHours: Number(e.target.value) })
            }
          >
            <option value={0}>끔</option>
            {[1, 2, 4, 6, 12, 24].map((h) => (
              <option key={h} value={h}>
                {h}시간마다
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="briefing-generate-icon"
          aria-label="브리핑 생성"
          title="지금 브리핑 생성 · 오늘 날씨·일정은 유지하고 새 이메일·논문 추가"
          disabled={pending || running}
          onClick={() => void action('/generation/start')}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 3H5v18h14v-9M8 9h3M8 13h7M8 17h5M19 2v6M16 5h6" />
          </svg>
        </button>
        {running && (
          <button
            type="button"
            className="briefing-generation-stop"
            title="생성 중단 · 저장된 항목 유지"
            aria-label="브리핑 생성 중단"
            disabled={pending}
            onClick={() => void action('/generation/cancel')}
          >
            ■
          </button>
        )}
      </div>
      {running && view.job && <BriefingGenerationProgress key={view.job.id} job={view.job} />}
      {((view.job && !running) || view.nextDueAt) && (
        <small role="status" className="briefing-generation-status">
          {!running && view.job?.detail}
          {view.nextDueAt
            ? ` · 다음 ${new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(view.nextDueAt))}`
            : ''}
        </small>
      )}
      {(error || view.scheduleError || view.job?.error) && (
        <small role="alert">{error || view.scheduleError || view.job?.error}</small>
      )}
    </div>
  );
}
