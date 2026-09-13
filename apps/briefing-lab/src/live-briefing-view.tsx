import { useRef, useState } from 'react';
import { useLiveFeedback } from './live-feedback';
import {
  briefingSectionOrder,
  defaultLiveSettings,
  type BriefingRoutine,
} from '@gosu/briefing-core';
import { collectSources } from './live-client';
import type { LiveProgress, LiveSourceResult } from './live-types';
import { WeatherCard } from './weather-card';
import { sourceRequest } from './live-client';
import { BriefingInsightCard } from './briefing-insight-card';
import type { AnalysisResult } from './briefing-analysis-client';
import { prioritizeBriefingItems } from './briefing-intelligence';
import { AutomaticSummary, mergeAnalyses } from './automatic-summary';
import { CalendarAgenda } from './calendar-view';
import { BriefingAssistantSummary } from './briefing-assistant-summary';
import type { SummaryProgress } from './automatic-summary';
import type { CalendarEvent } from './workspace-contracts';
import { SummaryFooter } from './summary-footer';
import { refreshBriefingSummary } from './briefing-analysis-client';
import { briefingTargetId, useBriefingJump } from './briefing-jump';
import { BriefingHistoryView } from './briefing-history-view';
import { BriefingRunDelete } from './briefing-history-delete';
import { briefingDate } from './briefing-agenda-days';
import { BriefingSectionNavigation } from './briefing-section-navigation';
import { BriefingBottomCollapse } from './briefing-disclosure-collapse';
const labels = { weather: '날씨', email: '이메일', papers: '연구 논문' };
export function LiveBriefingView({
  routine,
  onSettings,
  collect = collectSources,
  initialResults,
  onResultsChange,
}: {
  routine: BriefingRoutine;
  onSettings: () => void;
  collect?: typeof collectSources;
  initialResults?: LiveSourceResult[];
  onResultsChange?: (results: LiveSourceResult[]) => void;
}) {
  const [results, setResultsState] = useState<LiveSourceResult[]>(initialResults ?? []),
    [progress, setProgress] = useState<LiveProgress[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const resultsRef = useRef<LiveSourceResult[]>(initialResults ?? []);
  const navigation = useBriefingJump();
  const feedback = useLiveFeedback(routine.id, results);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [summaryProgress, setSummaryProgress] = useState<SummaryProgress | null>(null),
    [agendaEvents, setAgendaEvents] = useState<CalendarEvent[]>([]);
  const setResults = (
    next: LiveSourceResult[] | ((current: LiveSourceResult[]) => LiveSourceResult[]),
  ) => {
    const value = typeof next === 'function' ? next(resultsRef.current) : next;
    resultsRef.current = value;
    onResultsChange?.(value);
    setResultsState(value);
  };
  const start = async () => {
    if (busy || routine.kind === 'funding') return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setStartedAt(new Date().toISOString());
    setResults([]);
    setAnalysis(null);
    setSummaryProgress(null);
    setProgress([]);
    setError('');
    try {
      const result = await collect(
        {
          routineId: routine.id,
          live: routine.live ?? defaultLiveSettings(),
          interest: routine.interest,
        },
        c.signal,
        (item) => {
          if (!c.signal.aborted)
            setProgress((current) => [...current.filter((p) => p.kind !== item.kind), item]);
        },
      );
      if (!c.signal.aborted) setResults(result);
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      if (controller.current === c) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  const sorted = briefingSectionOrder(routine.sectionOrder).flatMap((kind) =>
    results.filter((result) => result.kind === kind),
  );
  const sourceKinds = [
    routine.live?.weather ? 'weather' : null,
    routine.live?.papers.enabled ? 'papers' : null,
    routine.live?.mail ? 'email' : null,
  ].filter((kind): kind is 'weather' | 'papers' | 'email' => Boolean(kind));
  const sourceCompleted = sourceKinds.filter((kind) =>
    progress.some((entry) => entry.kind === kind && entry.state === 'completed'),
  ).length;
  const sourceActive = progress.find((entry) => entry.state === 'started')?.kind;
  if (routine.kind === 'funding')
    return (
      <div className="briefing-run-intro">
        <h2>연구과제 실제 수집은 아직 미연결입니다.</h2>
        <p>
          현재 실제 조회는 개인·연구 루틴의 이메일·날씨·arXiv 논문을 지원합니다. 연구과제 결과를
          다른 자료로 대체하지 않습니다.
        </p>
      </div>
    );
  return (
    <div className="briefing-live-view" ref={navigation.root}>
      <header className="briefing-history-run-header">
        <h2>
          <time dateTime={results[0]?.fetchedAt ?? startedAt}>
            {briefingDate(results[0]?.fetchedAt ?? startedAt, routine.schedule.timeZone)}
          </time>{' '}
          브리핑
        </h2>
        {results[0]?.receiptId && (
          <BriefingRunDelete
            target={{ routineId: routine.id, runId: results[0].receiptId }}
            onDeleted={(receipt) => {
              if (!resultsRef.current.some((r) => r.receiptId === receipt.runId)) return;
              setResults([]);
              setAnalysis(null);
              setAgendaEvents([]);
              setSummaryProgress(null);
            }}
          />
        )}
      </header>
      <div className="briefing-live-actions">
        <button
          type="button"
          className="briefing-button primary"
          disabled={busy}
          onClick={() => void start()}
        >
          지금 실제 자료 조회
        </button>
        <button type="button" className="briefing-button" disabled={busy} onClick={onSettings}>
          도시·메일·검색 조건 설정
        </button>
        {busy && (
          <button
            type="button"
            className="briefing-button"
            onClick={() => {
              controller.current?.abort();
              controller.current = null;
              setBusy(false);
              setError('조회를 중단했습니다.');
            }}
          >
            조회 중단
          </button>
        )}
      </div>
      <BriefingSectionNavigation
        scope={navigation.scope}
        onNavigate={navigation.jump}
        sections={(['papers', 'email'] as const).flatMap((kind) => {
          const result = results.find((r) => r.kind === kind);
          return result
            ? [{ kind, count: result.items.length, id: JSON.stringify(['live-section', kind]) }]
            : [];
        })}
      />
      {progress.length > 0 && (
        <ul className="briefing-source-status" aria-live="polite">
          {progress.map((item) => (
            <li key={item.kind}>
              {labels[item.kind]} ·{' '}
              {item.state === 'started'
                ? (item.detail ?? '실제 소스 조회 중…')
                : `처리 완료 (${item.count ?? 0}건)`}
            </li>
          ))}
        </ul>
      )}
      {busy && sourceKinds.length > 0 && (
        <div
          className="briefing-progress briefing-collection-progress"
          aria-label={`실제 소스 조회 ${Math.round((sourceCompleted / sourceKinds.length) * 100)}%`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((sourceCompleted / sourceKinds.length) * 100)}
        >
          <span style={{ width: `${(sourceCompleted / sourceKinds.length) * 100}%` }} />
          <p>
            {Math.round((sourceCompleted / sourceKinds.length) * 100)}% ·{' '}
            {sourceActive ? `${labels[sourceActive]} 실제 소스 조회 중…` : '실제 소스 준비 중…'} ·{' '}
            {sourceCompleted}/{sourceKinds.length}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="briefing-alert">
          {error}
        </p>
      )}
      {feedback.warning && (
        <p className="briefing-muted" role="status">
          {feedback.warning}
        </p>
      )}
      {results.find((result) => result.historyWarning)?.historyWarning && (
        <p role="alert" className="briefing-alert">
          {results.find((result) => result.historyWarning)!.historyWarning}
        </p>
      )}
      {!busy && !results.length && !error && (
        <p className="briefing-muted">
          설정은 루틴별로 저장합니다. 실제로 조회한 결과만 표시합니다. 메일 연결이 없으면
          날씨·논문만 조회할 수 있습니다.
        </p>
      )}
      <BriefingAssistantSummary
        routine={routine}
        results={results}
        analysis={analysis}
        calendar={routine.live?.assistant?.calendarRead ? agendaEvents : []}
        progress={summaryProgress}
        navigationScope={navigation.scope}
        onNavigate={navigation.jump}
      />
      {navigation.notice && (
        <p className="briefing-alert" role="status">
          {navigation.notice}
        </p>
      )}
      <AutomaticSummary
        routine={routine}
        results={results}
        onResult={(value) => setAnalysis((current) => mergeAnalyses(current, value))}
        onProgress={setSummaryProgress}
      />
      <CalendarAgenda
        routine={routine}
        navigationScope={navigation.scope}
        onEvents={setAgendaEvents}
        {...(results[0]?.receiptId ? { receiptId: results[0].receiptId } : {})}
      />
      {sorted
        .filter((result) => result === sorted[0] && result.kind === 'weather')
        .flatMap((result) => result.items)
        .filter((item) => item.weather)
        .map((item) => (
          <WeatherCard key={item.id} weather={item.weather!} />
        ))}
      {analysis && (
        <p className="briefing-analysis-overview">
          {analysis.items.length}개 AI 요약 ·{' '}
          {analysis.invocation.model === 'cached'
            ? '저장된 요약'
            : `${analysis.invocation.model} · ${analysis.invocation.reasoning || '기본 reasoning'}`}{' '}
          ·{' '}
          {analysis.memorySave?.state === 'saved'
            ? 'backend 기억 저장됨'
            : '기억 저장 상태 확인 필요'}
        </p>
      )}
      {analysis?.memorySave?.warning && (
        <p role="alert" className="briefing-alert">
          {analysis.memorySave.warning}
        </p>
      )}
      <div className="briefing-section-list">
        {sorted.map((result) =>
          result.kind === 'weather' && result.status === 'ready' ? (
            result === sorted[0] ? null : (
              result.items
                .filter((item) => item.weather)
                .map((item) => <WeatherCard key={item.id} weather={item.weather!} />)
            )
          ) : (
            <details
              className={`briefing-content-section ${result.kind}`}
              key={result.kind}
              open
              {...(result.kind !== 'weather'
                ? {
                    id: briefingTargetId(
                      navigation.scope,
                      result.kind,
                      JSON.stringify(['live-section', result.kind]),
                    ),
                    'data-briefing-jump-target': 'true',
                    tabIndex: -1,
                  }
                : {})}
            >
              <summary>
                <div className="briefing-section-heading">
                  <h3>{labels[result.kind]}</h3>
                  <span className="briefing-section-count">
                    {result.status === 'failed' ? '실패' : `${result.items.length}건`}
                  </span>
                </div>
                <small>실제 조회 · {new Date(result.fetchedAt).toLocaleString()}</small>
                <span className="briefing-source-toggle" aria-hidden="true" />
              </summary>
              <div className="briefing-live-source-body">
                {result.notice && (
                  <p className="briefing-mail-collection-notice" role="note">
                    {result.notice}
                  </p>
                )}
                <p className="briefing-muted">{result.note}</p>
                {result.status === 'empty' && <p>조건에 맞는 결과가 없습니다.</p>}
                {result.error && (
                  <p role="alert" className="briefing-alert">
                    {result.error}
                  </p>
                )}
                {result.items.length > 0 && (
                  <div className="briefing-reading-list">
                    {prioritizeBriefingItems(result.items, analysis).map((item) =>
                      item.kind !== 'weather' ? (
                        <BriefingInsightCard
                          key={item.id}
                          savedFeedbackChoice={feedback.choices[item.id] ?? null}
                          item={item}
                          mailOpenTarget={
                            item.kind === 'email' && result.receiptId
                              ? {
                                  routineId: routine.id,
                                  receiptId: result.receiptId,
                                  itemId: item.id,
                                }
                              : undefined
                          }
                          navigationId={briefingTargetId(navigation.scope, item.kind, item.id)}
                          timeZone={routine.schedule.timeZone}
                          insight={analysis?.items.find((i) => i.id === item.id)}
                          paper={analysis?.evidence.find((e) => e.id === item.id)?.paper}
                          memory={null}
                          summaryFooter={
                            analysis?.items.some((i) => i.id === item.id) ? (
                              <SummaryFooter
                                compactRefresh={item.kind === 'papers'}
                                provenance={analysis.provenance?.[item.id]}
                                disabled={
                                  summaryProgress !== null && summaryProgress.kind !== 'done'
                                }
                                onRefresh={async (progress) => {
                                  if (!result.receiptId)
                                    throw new Error('자료를 다시 조회해주세요.');
                                  const next = await refreshBriefingSummary(
                                    {
                                      routineId: routine.id,
                                      receiptId: result.receiptId,
                                      itemId: item.id,
                                    },
                                    new AbortController().signal,
                                    progress,
                                  );
                                  setAnalysis((current) => mergeAnalyses(current, next));
                                }}
                              />
                            ) : null
                          }
                          onFeedback={async (decision, keywords) => {
                            if (!result.receiptId) throw new Error('자료를 다시 조회해주세요.');
                            await sourceRequest(
                              '/memory/feedback',
                              {
                                routineId: routine.id,
                                receiptId: result.receiptId,
                                itemId: item.id,
                                decision,
                                ...(keywords?.length ? { keywords: keywords.slice(0, 12) } : {}),
                              },
                              new AbortController().signal,
                            );
                            feedback.saved(item.id, decision);
                          }}
                          routineId={routine.id}
                        />
                      ) : (
                        <article key={item.id} className="briefing-card">
                          <div className="briefing-card-top">
                            <span>{item.source}</span>
                            {item.publishedAt && (
                              <small>{new Date(item.publishedAt).toLocaleString()}</small>
                            )}
                          </div>
                          <h3>{item.title}</h3>
                          {item.matchedKeywords && (
                            <div className="briefing-tags">
                              {item.matchedKeywords.map((word) => (
                                <span key={word}>{word}</span>
                              ))}
                              <span>관련성 {item.score}점</span>
                            </div>
                          )}
                          <p className="briefing-live-text">{item.text}</p>
                          <ul>
                            {item.details.filter(Boolean).map((detail, index) => (
                              <li key={index}>{detail}</li>
                            ))}
                          </ul>
                          <small>
                            {
                              (
                                {
                                  forecast: '기상 모델·예보',
                                  abstract: '초록 원문 · LLM 요약 아님',
                                  'paper-metadata': '메타데이터만 · 초록 없음',
                                  'mail-metadata': '메일 메타데이터만 읽음',
                                  'mail-preview': '메일 본문 앞부분 · LLM 전송 없음',
                                } as const
                              )[item.readScope]
                            }
                          </small>
                          {item.sourceUrl && (
                            <p>
                              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                원문 / 제공자 열기 ↗
                              </a>
                            </p>
                          )}
                        </article>
                      ),
                    )}
                  </div>
                )}
                {result.kind !== 'weather' && (
                  <BriefingBottomCollapse
                    label={result.kind === 'email' ? '이메일 목록 접기' : '논문 목록 접기'}
                  />
                )}
              </div>
            </details>
          ),
        )}
      </div>
      <BriefingHistoryView
        routineId={routine.id}
        embedded
        excludeRunIds={results.flatMap((r) => (r.receiptId ? [r.receiptId] : []))}
        refreshKey={`${results[0]?.receiptId ?? 'none'}:${busy}:${analysis?.historyId ?? ''}`}
      />
    </div>
  );
}
