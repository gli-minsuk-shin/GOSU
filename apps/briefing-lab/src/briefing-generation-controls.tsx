import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { sourceRequest } from './live-client';
import {
  isBriefingRunShortcut,
  isDesktopBriefingRun,
  isDesktopNavigation,
  isGosuEmbedded,
} from './desktop-bridge';
import { BRIEFING_HISTORY_CHANGED } from './briefing-history-removal';
import type { BriefingRoutineScheduleView, GenerationView } from './briefing-generation-contract';
import { BriefingGenerationProgress } from './briefing-generation-progress';
const empty: GenerationView = {
  intervalHours: 0,
  routineSchedule: null,
  nextDueAt: null,
  scheduleError: null,
  job: null,
};
/** "매일 08:00, 18:00" — the routine's own delivery times, as the settings screen shows them. */
export function routineScheduleLabel(schedule: BriefingRoutineScheduleView) {
  const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const every = schedule.interval > 1 ? `${schedule.interval}` : '';
  const when =
    schedule.frequency === 'weekly'
      ? `${every}주마다 ${[...schedule.weekdays]
          .sort()
          .map((day) => weekdayNames[day] ?? '')
          .join('·')}요일`
      : schedule.frequency === 'monthly'
        ? `${every}개월마다 ${schedule.monthDay}일`
        : `${every ? `${every}일마다` : '매일'}`;
  return `${when} ${schedule.times.join(', ')}`;
}
export function BriefingGenerationControls({
  routineId,
  routineSchedule,
  leadingControls,
  progressSlot,
}: {
  routineId: string;
  /** The routine's saved delivery times, offered as an automatic run at those clock times. */
  routineSchedule?: BriefingRoutineScheduleView | undefined;
  leadingControls?: ReactNode;
  /**
   * Where the running progress and the collapsed run warnings render, beside the page title, so the
   * title, that status and the buttons share one horizontal row.
   */
  progressSlot?: HTMLElement | null;
}) {
  const [view, setView] = useState(empty),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null),
    [loadError, setLoadError] = useState('');
  const lock = useRef(false),
    synced = useRef<string | null>(null),
    request = useRef<AbortController | null>(null),
    stamp = useRef(''),
    revision = useRef(0);
  const apply = (next: GenerationView) => {
    if (!next || typeof next.intervalHours !== 'number') return;
    setView(next);
    setLoadedFor(routineId);
    setLoadError('');
    const current = JSON.stringify([
      next.job?.id,
      next.job?.runId,
      next.job?.newCount,
      next.job?.quickBriefingAt,
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
        if (!c.signal.aborted && version === revision.current)
          setLoadError(
            '자동 브리핑 설정을 불러오지 못했습니다. 저장된 간격은 변경하지 않고 다시 확인합니다.',
          );
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
  // The "run a new briefing" shortcut does what the "브리핑 생성" button does, under the same
  // conditions (loaded, nothing pending, no run in progress). Inside GOSU the chord is the user's
  // setting: the shell catches it and sends `gosu-briefing-run-now`, and tells this frame which
  // chord it is for the tooltip. On its own, Briefing Lab listens for the default ⇧⌘Enter.
  const [runShortcut, setRunShortcut] = useState<string | null>(() =>
    isGosuEmbedded() ? null : '⇧⌘Enter',
  );
  const runNow = useRef<() => void>(() => undefined);
  runNow.current = () => {
    if (loadedFor === routineId && !pending && !running) void action('/generation/start');
  };
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (isGosuEmbedded() || !isBriefingRunShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      runNow.current();
    };
    const onMessage = (event: MessageEvent) => {
      if (isDesktopBriefingRun(event)) runNow.current();
      else if (isDesktopNavigation(event)) {
        const label: unknown = event.data?.runShortcut;
        setRunShortcut(typeof label === 'string' && label.length <= 40 ? label : null);
      }
    };
    // Held in a constant: the cleanup must reach the same window even if the global is gone by then.
    const target = window;
    target.addEventListener?.('keydown', onKey, true);
    target.addEventListener?.('message', onMessage);
    return () => {
      target.removeEventListener?.('keydown', onKey, true);
      target.removeEventListener?.('message', onMessage);
    };
  }, []);
  const nextRunText =
    view.nextDueAt && !running
      ? ` 다음 실행 ${new Intl.DateTimeFormat('ko-KR', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          ...(routineSchedule ? { timeZone: routineSchedule.timeZone } : {}),
        }).format(new Date(view.nextDueAt))}.`
      : '';
  // The routine's times can be edited in settings; the saved schedule follows them, once per edit.
  useEffect(() => {
    if (loadedFor !== routineId || pending || lock.current) return;
    if (!view.routineSchedule || !routineSchedule) return;
    const edited = JSON.stringify(routineSchedule);
    if (JSON.stringify(view.routineSchedule) === edited || synced.current === edited) return;
    synced.current = edited;
    void action('/generation/schedule', { intervalHours: view.intervalHours, routineSchedule });
  }, [loadedFor, routineId, pending, view.routineSchedule, view.intervalHours, routineSchedule]);
  const inSlot = (node: ReactNode) => (progressSlot ? createPortal(node, progressSlot) : node);
  return (
    <div className="briefing-generation-controls">
      <div className="briefing-generation-buttons">
        {leadingControls}
        <label
          title={`Mac이 깨어 있고 Briefing Lab 서버가 실행 중일 때 생성합니다. 브라우저를 닫아도 계속되며 새 자료의 AI 요약에는 사용량이 발생합니다.${nextRunText}`}
        >
          <span>자동 브리핑</span>
          <select
            aria-label="자동 브리핑 간격"
            value={loadedFor === routineId ? view.intervalHours : ''}
            disabled={pending || loadedFor !== routineId}
            onChange={(e) =>
              void action('/generation/schedule', { intervalHours: Number(e.target.value) })
            }
          >
            {loadedFor !== routineId && (
              <option value="">{loadError ? '설정 확인 필요' : '불러오는 중…'}</option>
            )}
            <option value={0}>끔</option>
            {[1, 2, 4, 6, 12, 24].map((h) => (
              <option key={h} value={h}>
                {h}시간마다
              </option>
            ))}
          </select>
        </label>
        {routineSchedule && routineSchedule.times.length > 0 ? (
          <label
            className="briefing-routine-time-toggle"
            title={`루틴에 지정한 시각(${routineScheduleLabel(routineSchedule)})에도 브리핑을 만듭니다. 그 시각에 Mac이 잠들어 있었다면 깨어난 뒤 한 번 실행합니다.${nextRunText}`}
          >
            <input
              type="checkbox"
              checked={Boolean(view.routineSchedule)}
              disabled={pending || loadedFor !== routineId}
              onChange={(e) =>
                void action('/generation/schedule', {
                  intervalHours: view.intervalHours,
                  routineSchedule: e.target.checked ? routineSchedule : null,
                })
              }
            />
            <span>루틴 시각 ({routineSchedule.times.join(', ')})</span>
          </label>
        ) : null}

        <button
          type="button"
          className="briefing-generate-icon"
          aria-label="브리핑 생성"
          title={`지금 브리핑 생성${runShortcut ? ` (${runShortcut})` : ''} · 오늘 날씨 유지 · 일정 새로 확인 · 새 이메일·논문 추가`}
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
      {running &&
        view.job &&
        inSlot(<BriefingGenerationProgress key={view.job.id} job={view.job} />)}
      {/* A failed run's reason is stored on the job; without this it vanished once the progress
          view closed, leaving "10 new papers, 0 summaries" with no reason. Completed runs keep
          the compact header. */}
      {/* Every reason a run recorded stays readable here: a failed run, an interrupted one, and a
          completed run whose warnings name what went wrong (2026-09-21: a completed run whose only
          problem was an unread email source showed nothing at all). */}
      {!running &&
        view.job?.error &&
        inSlot(
          <BriefingCollapsibleAlert
            className="briefing-generation-job-error"
            summary={
              view.job.state === 'complete'
                ? `최근 브리핑 · ${
                    [
                      view.job.summaryFailures
                        ? `AI 요약 ${view.job.summaryFailures}묶음 실패`
                        : '',
                      view.job.summaryRejectedItems
                        ? `요약 검증 실패 ${view.job.summaryRejectedItems}개`
                        : '',
                      view.job.emailSourceState === 'failed' ? '이메일 조회 실패' : '',
                      view.job.mailCoverageGaps
                        ? `메일 미확인 구간 ${view.job.mailCoverageGaps}곳`
                        : '',
                      view.job.mailIndexFallback ? '메일 빠른 조회 불가' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || '확인할 내용 있음'
                  }`
                : view.job.state === 'cancelled'
                  ? '최근 브리핑 중단'
                  : '최근 브리핑 실패'
            }
            detail={view.job.error}
          />,
        )}
      {(error || loadError) && <small role="alert">{error || loadError}</small>}
      {!error &&
        !loadError &&
        view.scheduleError &&
        inSlot(
          <BriefingCollapsibleAlert
            className="briefing-generation-schedule-error"
            summary="자동 브리핑 일시 중지 · 설정 확인 필요"
            detail={view.scheduleError}
          />,
        )}
    </div>
  );
}

/**
 * A run's warnings can be many lines (every failed batch with its reason). They stay one line until
 * opened, so they never take over the header; the full text is one click away. The text is a div on
 * purpose: this renders inside the main header, whose compact layout hides every `<p>`
 * (`.briefing-main-header p { display: none }`), so as a paragraph the opened reason was invisible
 * (2026-09-21: "error 가 떠도 … 클릭해도 안보여줌").
 */
function BriefingCollapsibleAlert({
  summary,
  detail,
  className,
}: {
  summary: string;
  detail: string;
  className: string;
}) {
  return (
    <details className={`briefing-generation-alert ${className}`}>
      <summary role="alert" title={`${summary} · 눌러서 자세한 이유 보기 또는 접기`}>
        <span>{summary}</span>
        <svg className="briefing-progress-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="briefing-generation-alert-detail">{detail}</div>
    </details>
  );
}
