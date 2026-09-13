import type { BriefingRoutine } from '@gosu/briefing-core';
import { ImportanceIcon } from './importance-icon';
import type { AnalysisResult } from './briefing-analysis-client';
import type { CalendarEvent } from './workspace-contracts';
import type { LiveSourceResult } from './live-types';
import type { SummaryProgress } from './automatic-summary';
import { briefingCacheLabel } from './briefing-cache';
import { EmailDeliveryMeta } from './email-delivery-meta';
import { BriefingMarkdown } from './briefing-insight-card';
import type { ReactNode } from 'react';
import { briefingTargetId, type BriefingJumpTarget } from './briefing-jump';
import { isGosuEmbedded } from './desktop-bridge';
import { openBriefingItem } from './briefing-item-navigation';

export function sortSummaryPriority<T extends { importance: string }>(items: readonly T[]) {
  const rank: Record<string, number> = { high: 0, medium: 1, uncertain: 2, low: 3 };
  return [...items].sort((a, b) => (rank[a.importance] ?? 2) - (rank[b.importance] ?? 2));
}
export function SummaryHighlight({
  target,
  title,
  scope,
  onNavigate,
  navigationHint,
  children,
}: {
  target: BriefingJumpTarget;
  title: string;
  scope?: string | undefined;
  onNavigate?: ((target: BriefingJumpTarget) => void) | undefined;
  navigationHint?: string | undefined;
  children: ReactNode;
}) {
  const className = `briefing-assistant-highlight ${target.kind}`;
  return onNavigate ? (
    <button
      type="button"
      className={className}
      title={`${title} 상세로 이동`}
      aria-controls={scope ? briefingTargetId(scope, target.kind, target.id) : undefined}
      onClick={() => onNavigate(target)}
    >
      {children}
      <span className="briefing-summary-jump-hint" aria-hidden="true">
        {navigationHint ?? '상세 보기 ↓'}
      </span>
    </button>
  ) : (
    <article className={className}>{children}</article>
  );
}

export function BriefingAssistantSummary({
  routine,
  results,
  analysis,
  calendar,
  progress,
  onNavigate,
  navigationScope,
}: {
  routine: BriefingRoutine;
  results: LiveSourceResult[];
  analysis: AnalysisResult | null;
  calendar: CalendarEvent[];
  progress: SummaryProgress | null;
  onNavigate?: (target: BriefingJumpTarget) => void;
  navigationScope?: string;
}) {
  const prioritized = (kind: 'email' | 'papers') =>
    results
      .flatMap((result) => result.items)
      .filter((item) => item.kind === kind)
      .map((item) => ({
        item,
        insight: analysis?.items.find((candidate) => candidate.id === item.id),
      }))
      .filter(({ insight }) => insight)
      .sort((a, b) => {
        const rank = { high: 0, medium: 1, uncertain: 2, low: 3 } as const;
        return rank[a.insight!.importance] - rank[b.insight!.importance];
      });
  const emailInsights = prioritized('email'),
    paperInsights = prioritized('papers');
  const highlights = sortSummaryPriority([
    ...emailInsights.slice(0, 3).map((entry) => ({
      ...entry,
      kind: 'email' as const,
      importance: entry.insight!.importance,
    })),
    ...paperInsights.slice(0, 3).map((entry) => ({
      ...entry,
      kind: 'papers' as const,
      importance: entry.insight!.importance,
    })),
  ]);
  const hasBriefing = emailInsights.length > 0 || calendar.length > 0 || Boolean(analysis);
  const cacheLabel = analysis
    ? briefingCacheLabel(analysis, Boolean(progress && progress.completed < progress.total))
    : '';
  return (
    <section className="briefing-assistant-summary" aria-label="AI 비서의 오늘 요약">
      <header className="briefing-assistant-summary-header">
        <div>
          <span className="briefing-section-caption">AI ASSISTANT SUMMARY</span>
          <h2>오늘 먼저 확인할 내용</h2>
        </div>
        <small>
          {progress && progress.total === 0
            ? progress.detail
            : progress
              ? `${progress.percent}% · ${progress.completed}/${progress.total} 처리 · ${progress.kind === 'email' ? '이메일 우선' : progress.kind === 'papers' ? '논문 처리' : '완료'}`
              : '일정 · 이메일 · 연구 논문'}
        </small>
      </header>
      {cacheLabel && (
        <p className="briefing-cache-badge" role="status">
          {cacheLabel}
        </p>
      )}
      {progress && progress.total > 0 && (
        <div
          className="briefing-progress"
          aria-label={`자동 요약 ${progress.percent}%`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <span style={{ width: `${progress.percent}%` }} />
          <p>
            {progress.detail}
            {progress.range ? ` · ${progress.range}` : ''}
          </p>
        </div>
      )}
      {analysis?.overviewByKind?.email && (
        <p className="briefing-assistant-overview">
          <BriefingMarkdown inline text={analysis.overviewByKind.email} />
        </p>
      )}
      {!hasBriefing && (
        <p className="briefing-muted">
          실제 자료를 조회하면 중요한 일정과 이메일을 이곳에 짧게 정리합니다.
        </p>
      )}
      {(calendar.length > 0 || emailInsights.length > 0 || paperInsights.length > 0) && (
        <div className="briefing-assistant-highlights">
          {highlights.map(({ item, insight, kind }) => (
            <SummaryHighlight
              key={`${kind}:${item.id}`}
              target={{ kind, id: item.id }}
              title={item.title}
              scope={navigationScope}
              onNavigate={onNavigate}
            >
              <span>
                {kind === 'email' ? '이메일' : '논문'}{' '}
                <ImportanceIcon level={insight!.importance} paper={kind !== 'email'} />
              </span>
              <strong>{item.title}</strong>
              {kind === 'email' && (
                <EmailDeliveryMeta
                  account={item.mailAccount}
                  receivedAt={item.publishedAt}
                  timeZone={routine.schedule.timeZone}
                />
              )}
              <small>
                <BriefingMarkdown
                  inline
                  text={
                    kind === 'email'
                      ? insight!.action || insight!.importanceReason || insight!.summary
                      : insight!.summary
                  }
                />
              </small>
            </SummaryHighlight>
          ))}
          {calendar.slice(0, 3).map((event) => (
            <SummaryHighlight
              key={event.id}
              target={{ kind: 'calendar', id: event.id }}
              title={event.title}
              scope={isGosuEmbedded() ? undefined : navigationScope}
              onNavigate={
                isGosuEmbedded()
                  ? () => openBriefingItem({ kind: 'calendar', id: event.id, start: event.start })
                  : onNavigate
              }
              navigationHint={isGosuEmbedded() ? 'Calendar에서 열기 ↗' : undefined}
            >
              <span>일정</span>
              <strong>{event.title}</strong>
              <small>
                <strong>
                  {new Date(event.start).toLocaleString('ko-KR', {
                    timeZone: event.timeZone,
                    hour: '2-digit',
                    minute: '2-digit',
                    month: 'short',
                    day: 'numeric',
                  })}
                </strong>
                {event.location ? ` · ${event.location}` : ''}
              </small>
            </SummaryHighlight>
          ))}
        </div>
      )}
      <p className="briefing-assistant-footnote">
        {progress?.kind === 'email' || (progress && progress.completed < progress.total)
          ? '이메일 요약을 먼저 끝낸 뒤 논문 요약을 이어갑니다.'
          : onNavigate
            ? '요약 박스를 누르면 해당 항목의 상세로 이동합니다.'
            : '논문 상세·수식은 아래 연구 논문 항목을 펼치면 확인할 수 있습니다.'}{' '}
        {routine.name}
      </p>
    </section>
  );
}
