import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { mailStillUnread } from './mail-read-state';
import { MarkAllMailRead } from './mail-mark-all';
import { sourceRequest } from './live-client';
import { sortEmails } from './email-presentation';
import {
  BRIEFING_GUIDANCE_CHANGED,
  guidanceSenderRules,
  matchesGuidanceSender,
} from './briefing-guidance';
import { readBriefingGuidance } from './briefing-guidance-panel';
import {
  briefingNotificationAnchor,
  type BriefingNotificationTarget,
} from './briefing-notifications';
import type { BriefingHistory } from '../briefing-workspace-store';
import { WeatherCard } from './weather-card';
import { ImportanceIcon } from './importance-icon';
import { newestSummaryFirst } from './paper-bibliography';
import { importanceFirst, PaperChatButton, type PaperChatReference } from './paper-chat-reference';
import { BriefingWeatherPeek, BriefingAgendaPeek } from './briefing-collapsed-peek';
import { BriefingRunDelete, BriefingTrash, restoreBriefing } from './briefing-history-delete';
import { BRIEFING_HISTORY_CHANGED, type HistoryRemovalReceipt } from './briefing-history-removal';
import type { BriefingSnapshot } from './briefing-history-snapshot';
import type { MailOpenTarget } from './mail-open-contract';
import { SummaryFooter } from './summary-footer';
import { useBriefingNewItems } from './briefing-new-items';
import { BriefingNarrative } from './briefing-narrative';
import { isGosuEmbedded } from './desktop-bridge';
import { openBriefingItem } from './briefing-item-navigation';
import { refreshBriefingSummary } from './briefing-analysis-client';
import { BriefingAgendaDays, briefingDate } from './briefing-agenda-days';
import { upcomingTodos } from './briefing-todos';
import { briefingLocalDay } from './briefing-generation-contract';
import { BriefingQuickFirst } from './briefing-quick-first';
import { SummaryHighlight, sortSummaryPriority } from './briefing-assistant-summary';
import { BriefingSectionNavigation } from './briefing-section-navigation';
import { briefingTargetId, useBriefingJump } from './briefing-jump';
import { useBriefingNotificationJump } from './briefing-notification-jump';
import { EmailDeliveryMeta } from './email-delivery-meta';
import { BriefingBottomCollapse, BriefingSectionRail } from './briefing-disclosure-collapse';
import { BRIEFING_COLLAPSE_EVENT } from './briefing-collapse-all';
import { paperLabels } from './paper-library-index';
import { deduplicateVerifiedMail } from './mail-duplicates';
import { deduplicateHistoryPapers } from './deduplicate-history-papers';
import {
  BriefingMarkdown,
  PaperBriefingDisclosure,
  EmailBriefingDisclosure,
  MathText,
  PaperSummaryTemplate,
  type FeedbackDecision,
} from './briefing-insight-card';
const importance = (value: string): 'high' | 'medium' | 'low' | 'uncertain' =>
  ['high', 'medium', 'low'].includes(value) ? (value as 'high' | 'medium' | 'low') : 'uncertain';
export function BriefingHistoryItem({
  item: i,
  feedbackChoice,
  onFeedback,
  savedAt,
  onRefresh,
  timeZone,
  mailOpenTarget,
  navigationId,
  classificationControl,
  isNew = false,
  askedAi = false,
  paperReference,
  deferBody,
}: {
  item: BriefingHistory['items'][number];
  feedbackChoice?: FeedbackDecision | null;
  onFeedback?: ((decision: FeedbackDecision) => Promise<void>) | undefined;
  savedAt?: string | undefined;
  onRefresh?: ((progress: (detail: string) => void) => Promise<void>) | undefined;
  timeZone?: string | undefined;
  mailOpenTarget?: MailOpenTarget | undefined;
  navigationId?: string | undefined;
  classificationControl?: ReactNode;
  isNew?: boolean;
  /** The 논문 요약 AI has been asked about this paper. A counter in the row's tool strip was easy to
   *  miss in a library of a hundred, so the card itself carries the mark and takes its own border. */
  askedAi?: boolean;
  paperReference?: PaperChatReference;
  /** Build a paper's body only once it is opened. The 논문 요약 library sets it; briefings do not. */
  deferBody?: boolean;
}) {
  const [choice, setChoice] = useState(feedbackChoice ?? null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const saveLock = useRef(false);
  useEffect(() => setChoice(feedbackChoice ?? null), [feedbackChoice, i.id]);
  const choose = async (decision: FeedbackDecision) => {
    if (!onFeedback || saveLock.current || choice === decision) return;
    saveLock.current = true;
    setPending(true);
    setStatus('');
    try {
      await onFeedback(decision);
      setChoice(decision);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '선택을 저장하지 못했습니다.');
    } finally {
      saveLock.current = false;
      setPending(false);
    }
  };
  const isPaper = i.kind ? i.kind === 'papers' : !i.readScope.startsWith('mail');
  // An email kept without a summary: the AI summary failed, and the run recorded that the mail
  // arrived (subject, sender, received time) so it is not invisible until the next briefing.
  const unsummarizedMail = !isPaper && !i.summary.trim();
  const body = unsummarizedMail ? (
    <>
      <p role="status">
        이 메일은 AI 요약에 실패해 제목·보낸 사람·받은 시각만 기록했습니다. 다음 브리핑에서 다시
        요약합니다. 지금 확인하려면 위의 Apple Mail 아이콘으로 원본을 열거나, 아래 ‘다시 요약’을
        눌러주세요.
      </p>
    </>
  ) : (
    <>
      {isPaper && <h3>{i.title}</h3>}
      <BriefingMarkdown text={i.summary} keywords={isPaper ? (i.keywords ?? []) : []} />
      {isPaper && i.readScope !== 'chat-analysis' && <PaperSummaryTemplate insight={i} />}
      {i.readScope === 'chat-analysis' && <h4>저장한 대화 분석 원문</h4>}
      {isPaper && i.detail && <BriefingMarkdown text={i.detail} />}
      {isPaper && i.relevance && (
        <div className="briefing-relevance">
          <strong>내 연구와의 연결</strong>
          <BriefingMarkdown text={i.relevance} />
        </div>
      )}
      {i.importanceReason && <BriefingMarkdown text={i.importanceReason} />}
      {i.action && (
        <p>
          <strong>다음 행동 · </strong>
          <BriefingMarkdown inline text={i.action} />
        </p>
      )}
      {isPaper &&
        i.equations?.map((eq, index) => (
          <div className="briefing-equation-explained" key={index}>
            <MathText latex={eq.latex} />
            {eq.explanation && <BriefingMarkdown text={eq.explanation} />}
          </div>
        ))}
      {isPaper &&
        i.figures?.map((figure) => (
          <figure className="briefing-paper-figure" key={figure.id}>
            {figure.imageData ? (
              <img src={figure.imageData} alt={figure.caption} loading="lazy" />
            ) : (
              <small>
                이전 그림 이미지가 저장되어 있지 않습니다. 캡션과 원문 링크를 확인해주세요.
              </small>
            )}
            <figcaption>{figure.caption}</figcaption>
          </figure>
        ))}
      <small>이전에 저장한 AI 요약 · 현재 원문을 다시 조회하지 않았습니다.</small>
      {i.sourceUrl?.startsWith('https://') && (
        <p>
          <a href={i.sourceUrl} target="_blank" rel="noreferrer">
            원문 열기 ↗
          </a>
        </p>
      )}
    </>
  );
  const titleBadges =
    isNew || askedAi ? (
      <>
        {isNew && <span className="briefing-new-badge">New</span>}
        {askedAi && (
          <span className="briefing-asked-ai-badge" title="논문 요약 AI와 질의응답한 논문">
            AI
          </span>
        )}
      </>
    ) : undefined;
  return (
    <article
      className={`briefing-card briefing-insight-card ${isPaper ? 'is-paper' : 'is-email'}${askedAi ? ' is-asked-ai' : ''}`}
      id={navigationId}
      data-briefing-jump-target={navigationId ? 'true' : undefined}
      tabIndex={navigationId ? -1 : undefined}
    >
      {isPaper ? (
        <PaperBriefingDisclosure
          {...(deferBody ? { deferBody } : {})}
          sourceUrl={i.sourceUrl}
          chatAction={paperReference ? <PaperChatButton reference={paperReference} /> : undefined}
          title={i.title}
          titleBadge={titleBadges}
          discoverySource={i.discoverySource}
          bibliography={i.bibliography}
          publishedAt={i.paperPublishedAt}
          keywords={paperLabels(i).tags}
          importance={importance(i.importance)}
          feedbackChoice={choice}
          {...(onFeedback
            ? { onFeedback: (decision: FeedbackDecision) => void choose(decision) }
            : {})}
          feedbackDisabled={pending}
          feedbackStatus={status}
        >
          <div className="briefing-reading-body">{body}</div>
        </PaperBriefingDisclosure>
      ) : (
        <EmailBriefingDisclosure
          preparedActions={i.preparedActions}
          calendarText={`${i.action ?? ''}\n${i.summary}`}
          title={i.title}
          titleBadge={titleBadges}
          summary={i.summary}
          sender={i.mailSender}
          mailMessageUrl={i.mailMessageUrl}
          mailOpenTarget={mailOpenTarget}
          mailAccount={i.mailAccount}
          mailCopies={i.mailCopies}
          bodyUnavailable={i.readScope === 'mail-metadata'}
          receivedAt={i.receivedAt}
          unread={i.mailUnread}
          markedReadAt={i.mailMarkedReadAt}
          historical
          timeZone={timeZone}
          importance={importance(i.importance)}
          feedbackChoice={choice}
          onFeedback={onFeedback ? (decision) => void choose(decision) : undefined}
          feedbackDisabled={pending}
          feedbackStatus={status}
        >
          <div className="briefing-reading-body">{body}</div>
        </EmailBriefingDisclosure>
      )}
      {classificationControl}
      <SummaryFooter
        provenance={i.provenance}
        publishedAt={isPaper ? i.paperPublishedAt : undefined}
        savedAt={savedAt}
        onRefresh={onRefresh}
        compactRefresh={isPaper}
      />
    </article>
  );
}
const historyRunKey = (h: BriefingHistory) => JSON.stringify([h.routineId, h.runId ?? h.id]);
export function groupBriefingHistory(history: BriefingHistory[]) {
  const groups = new Map<
    string,
    {
      id: string;
      routineId: string;
      runId: string;
      createdAt: string;
      private: boolean;
      snapshot?: BriefingSnapshot;
      batches: BriefingHistory[];
    }
  >();
  for (const h of [...history]
    .reverse()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    if (h.kind !== 'briefing') continue;
    const id = historyRunKey(h);
    const group = groups.get(id) ?? {
      id,
      routineId: h.routineId,
      runId: h.runId ?? h.id,
      createdAt: h.createdAt,
      private: false,
      batches: [],
    };
    group.private ||= h.private;
    if (h.snapshot) {
      group.snapshot = h.snapshot;
      group.createdAt = h.snapshot.collectedAt;
    }
    group.batches.push(h);
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => {
      const items = new Map<string, BriefingHistory['items'][number]>();
      const itemHistoryIds: Record<string, string> = {};
      const answers = new Map<string, string>();
      for (const h of group.batches) {
        for (const item of h.items) {
          items.set(item.id, item);
          itemHistoryIds[item.id] = h.id;
        }
        if (h.answer)
          answers.set(
            h.items
              .map((i) => i.id)
              .sort()
              .join('|') || h.id,
            h.answer,
          );
      }
      return {
        ...group,
        // Discovery can fail or return no new papers; it must never hide saved summaries.
        // Ignore legacy visiblePaperKeys, including already-persisted empty selections.
        items: deduplicateHistoryPapers(deduplicateVerifiedMail([...items.values()])),
        itemHistoryIds,
        answers: [...new Set(answers.values())],
      };
    })
    .sort(
      (a, b) =>
        Date.parse(b.snapshot?.daily?.updatedAt ?? b.createdAt) -
        Date.parse(a.snapshot?.daily?.updatedAt ?? a.createdAt),
    );
}
function historyDate(value: string, timeZone = 'Asia/Seoul', includeTime = true) {
  return briefingDate(value, timeZone, includeTime);
}
type HistoryFeedback = Record<string, Record<string, FeedbackDecision>>;
type SaveHistoryFeedback = (
  routineId: string,
  historyId: string,
  itemId: string,
  decision: FeedbackDecision,
) => Promise<void>;
async function loadAllHistory(routineId: string, signal: AbortSignal) {
  const history = new Map<string, BriefingHistory>();
  let feedback: Record<string, FeedbackDecision> = {},
    offset = 0;
  const warnings = new Set<string>();
  while (!signal.aborted) {
    const page = await sourceRequest<{
      history: BriefingHistory[];
      feedback?: Record<string, FeedbackDecision>;
      feedbackWarning?: string;
      nextOffset?: number | null;
    }>('/history/list', { routineId, ...(offset ? { offset } : {}) }, signal);
    for (const h of page.history ?? []) history.set(h.id, h);
    feedback = { ...feedback, ...page.feedback };
    if (page.feedbackWarning) warnings.add(page.feedbackWarning);
    if (page.nextOffset == null) break;
    if (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset || page.nextOffset > 10000)
      throw new Error('브리핑 이력 페이지를 확인하지 못했습니다.');
    offset = page.nextOffset;
  }
  return { history: [...history.values()], feedback, feedbackWarning: [...warnings].join(' ') };
}
type GuidanceByRoutine = Readonly<Record<string, readonly { id: string; text: string }[]>>;
/** Pinned mail shown at most, so a broad domain cannot push everything else out. */
const MAX_PINNED_HIGHLIGHTS = 5;
/**
 * Briefings kept in the page at once. Every retained briefing is loaded, but rendering them all
 * makes each re-render of this feed cost hundreds of milliseconds, which is felt as a freeze while
 * scrolling. The rest arrive as the reader reaches the end, and a notification always reaches its
 * own briefing (see `runsToShow`).
 */
export const BRIEFING_FEED_PAGE = 8;

/**
 * How many of the newest runs to render: at least one page, always enough to include the run a
 * notification points at, and never fewer than the reader has already scrolled past.
 */
export function runsToShow(
  runs: readonly { routineId: string; runId?: string | undefined; id: string }[],
  shown: number,
  target?: BriefingNotificationTarget | undefined,
) {
  const wanted = Math.max(BRIEFING_FEED_PAGE, shown);
  if (!target) return Math.min(runs.length, wanted);
  const index = runs.findIndex(
    (run) => run.routineId === target.routineId && (run.runId ?? run.id) === target.runId,
  );
  return Math.min(runs.length, index < 0 ? wanted : Math.max(wanted, index + 1));
}
export function BriefingHistoryFeed({
  notificationTarget,
  history,
  guidance,
  feedback,
  onFeedback,
  onRefresh,
  onDeleted,
  unreadMailOnly = false,
  deferBody = true,
}: {
  notificationTarget?: BriefingNotificationTarget | undefined;
  history: BriefingHistory[];
  /** Show only mail that is still unread by its saved state; papers and agenda are not affected. */
  unreadMailOnly?: boolean | undefined;
  /**
   * Build a paper's body only once it is opened, which is what the app wants: a feed holds every
   * run's items at once and a collapsed paper's body is 242 of its 296 tags. Set it false to render
   * the feed as it looks with every paper open -- what a test asserting the summary text needs,
   * because a static render cannot open one.
   */
  deferBody?: boolean | undefined;
  /** Briefing guidance per routine; a listed mail address or domain pins that mail first. */
  guidance?: GuidanceByRoutine | undefined;
  feedback?: HistoryFeedback;
  onFeedback?: SaveHistoryFeedback;
  onDeleted?: ((receipt: HistoryRemovalReceipt) => void) | undefined;
  onRefresh?: (
    routineId: string,
    historyId: string,
    itemId: string,
    progress: (detail: string) => void,
  ) => Promise<void>;
}) {
  const navigation = useBriefingJump();
  useBriefingNotificationJump(navigation.root, notificationTarget, history);
  const unreadUpdates = useBriefingNewItems();
  const [sectionsOpen, setSectionsOpen] = useState(true);
  const [shown, setShown] = useState(BRIEFING_FEED_PAGE);
  // Grouping walks every item of every briefing; doing it again on an unrelated re-render is the
  // largest avoidable cost in this view.
  const runs = useMemo(() => groupBriefingHistory(history), [history]);
  const visible = runsToShow(runs, shown, notificationTarget);
  const more = runs.length - visible;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || more <= 0 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting))
        setShown((count) => Math.max(count, visible) + BRIEFING_FEED_PAGE);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, visible]);
  useEffect(() => {
    const pane = navigation.root.current?.closest('.briefing-main-scroll');
    const collapse = () => setSectionsOpen(false);
    pane?.addEventListener(BRIEFING_COLLAPSE_EVENT, collapse);
    return () => pane?.removeEventListener(BRIEFING_COLLAPSE_EVENT, collapse);
  }, [navigation.root]);
  return (
    <div className="briefing-history-feed" ref={navigation.root}>
      {navigation.notice && (
        <p role="status" className="briefing-alert">
          {navigation.notice}
        </p>
      )}
      {runs.slice(0, visible).map((h) => (
        <article
          className="briefing-history-run"
          id={briefingNotificationAnchor(h.routineId, h.runId ?? h.id)}
          tabIndex={-1}
          key={h.id}
          aria-label={`${historyDate(h.createdAt, h.snapshot?.timeZone)} 브리핑`}
        >
          <header className="briefing-history-run-header">
            <h2>
              <time dateTime={h.createdAt}>
                {historyDate(h.createdAt, h.snapshot?.timeZone, !h.snapshot?.daily)}
              </time>{' '}
              브리핑
            </h2>
            <span>
              {h.snapshot?.routineName ?? '개인 연구 브리핑'}
              {h.private ? ' · 비공개' : ''}
            </span>
            {h.snapshot?.daily && (
              <small>업데이트 {historyDate(h.snapshot.daily.updatedAt, h.snapshot.timeZone)}</small>
            )}
            {h.items.some((i) =>
              unreadUpdates.isNew(h.id, i.addedAt, h.snapshot?.newItemsSince),
            ) && (
              <button
                className="briefing-new-ack"
                type="button"
                title="현재 보이는 새 항목의 New 표시 지우기"
                onClick={() =>
                  unreadUpdates.acknowledge(
                    h.id,
                    h.items.flatMap((i) => (i.addedAt ? [i.addedAt] : [])),
                  )
                }
              >
                New{' '}
                {
                  h.items.filter((i) =>
                    unreadUpdates.isNew(h.id, i.addedAt, h.snapshot?.newItemsSince),
                  ).length
                }{' '}
                · 확인
              </button>
            )}
            {onDeleted && (
              <BriefingRunDelete
                target={{ routineId: h.routineId, historyId: h.batches[0]!.id }}
                onDeleted={onDeleted}
              />
            )}
          </header>
          <BriefingSectionNavigation
            scope={navigation.scope}
            onNavigate={navigation.jump}
            sections={(['email', 'papers'] as const).flatMap((kind) => {
              const count = h.items.filter(
                (i) =>
                  (i.kind ?? (i.readScope.startsWith('mail') ? 'email' : 'papers')) === kind &&
                  (kind !== 'email' || !unreadMailOnly || mailStillUnread(i) === true),
              ).length;
              return count || h.snapshot?.sources.some((s) => s.kind === kind)
                ? [{ kind, count, id: JSON.stringify([h.id, 'section', kind]) }]
                : [];
            })}
          />
          <section
            className="briefing-assistant-summary briefing-history-summary"
            aria-label="이 회차 AI 요약"
          >
            <header className="briefing-assistant-summary-header">
              <div>
                <span className="briefing-section-caption">AI ASSISTANT SUMMARY</span>
                <h3>먼저 확인할 내용</h3>
              </div>
              <small>저장된 중요도 순 · 종류별 최대 3건</small>
            </header>
            {h.snapshot?.quickBriefing && (
              <BriefingQuickFirst value={h.snapshot.quickBriefing} timeZone={h.snapshot.timeZone} />
            )}
            <div className="briefing-assistant-highlights">
              {(() => {
                const rules = guidanceSenderRules(guidance?.[h.routineId] ?? []);
                type Picked = (typeof h.items)[number] & {
                  kind: 'email' | 'papers';
                  pinned: boolean;
                };
                const picked = (['email', 'papers'] as const).flatMap((kind): Picked[] => {
                  const scoped = h.items.filter(
                    (i) =>
                      (i.kind ?? (i.readScope.startsWith('mail') ? 'email' : 'papers')) === kind,
                  );
                  if (kind !== 'email')
                    return sortSummaryPriority(scoped)
                      .slice(0, 3)
                      .map((item) => ({ ...item, kind, pinned: false }));
                  // Mail from a sender listed in the briefing guidance is always shown, first.
                  // With "안 읽은 메일만" on, a highlight must not point at a card that is hidden.
                  const sorted = sortEmails(
                    unreadMailOnly ? scoped.filter((i) => mailStillUnread(i) === true) : scoped,
                    (i) => i,
                  );
                  const pinned = sorted
                    .filter((i) => matchesGuidanceSender(i.mailSender, rules))
                    .slice(0, MAX_PINNED_HIGHLIGHTS);
                  const rest = sorted
                    .filter((i) => !pinned.includes(i))
                    .slice(0, Math.max(0, 3 - pinned.length));
                  return [
                    ...pinned.map((item) => ({ ...item, kind, pinned: true })),
                    ...rest.map((item) => ({ ...item, kind, pinned: false })),
                  ];
                });
                return [
                  ...picked.filter((item) => item.pinned),
                  ...sortSummaryPriority(picked.filter((item) => !item.pinned)),
                ];
              })().map((item) => (
                <SummaryHighlight
                  key={`${item.kind}:${item.id}`}
                  target={{ kind: item.kind, id: JSON.stringify([h.id, 'item', item.id]) }}
                  title={item.title}
                  scope={navigation.scope}
                  onNavigate={navigation.jump}
                >
                  <span>
                    {item.kind === 'email' ? '이메일' : '논문'}{' '}
                    <ImportanceIcon
                      level={importance(item.importance)}
                      paper={item.kind !== 'email'}
                    />
                    {item.pinned && (
                      <small
                        className="briefing-guidance-pinned"
                        title="브리핑 지침에 적은 보낸 사람의 메일이라 맨 앞에 고정했습니다."
                      >
                        지침
                      </small>
                    )}
                  </span>
                  <strong>{item.title}</strong>
                  {item.kind === 'email' && (
                    <EmailDeliveryMeta
                      sender={item.mailSender}
                      account={item.mailAccount}
                      receivedAt={item.receivedAt}
                      timeZone={h.snapshot?.timeZone}
                    />
                  )}
                  <small>
                    <BriefingMarkdown
                      inline
                      text={
                        item.kind === 'email'
                          ? item.action || item.summary || 'AI 요약 실패 · 원본 메일을 확인하세요'
                          : item.summary
                      }
                    />
                  </small>
                </SummaryHighlight>
              ))}
              {[...(h.snapshot?.calendar ?? [])]
                .map((event, index) => ({ ...event, index }))
                .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
                .slice(0, 2)
                .map((event) => (
                  <SummaryHighlight
                    key={`calendar:${event.index}`}
                    target={{
                      kind: 'calendar',
                      id: JSON.stringify([h.id, 'calendar', event.index]),
                    }}
                    title={event.title}
                    scope={isGosuEmbedded() && event.id ? undefined : navigation.scope}
                    onNavigate={(target) => {
                      if (isGosuEmbedded() && event.id)
                        openBriefingItem({ kind: 'calendar', id: event.id, start: event.start });
                      else navigation.jump(target);
                    }}
                    navigationHint={
                      isGosuEmbedded() && event.id ? 'Calendar에서 열기 ↗' : undefined
                    }
                  >
                    <span>일정 · 시간순</span>
                    <strong>{event.title}</strong>
                    <small>
                      {briefingDate(event.start, event.timeZone, !event.allDay)}
                      {event.allDay ? ' · 종일' : ''}
                      {event.location ? ` · ${event.location}` : ''}
                    </small>
                  </SummaryHighlight>
                ))}
              {upcomingTodos(
                h.snapshot?.todos?.items ?? [],
                briefingLocalDay(
                  Date.parse(h.snapshot?.collectedAt ?? h.createdAt) + 86400000,
                  h.snapshot?.timeZone ?? 'Asia/Seoul',
                ),
              )
                .slice(0, 2)
                .map((task) => (
                  <SummaryHighlight
                    key={`task:${task.id}`}
                    target={{ kind: 'task', id: task.id }}
                    title={task.title}
                    {...(isGosuEmbedded()
                      ? {
                          onNavigate: () => openBriefingItem({ kind: 'task', id: task.id }),
                          navigationHint: 'GOSU 할 일에서 열기 ↗',
                        }
                      : {})}
                  >
                    <span>할 일 · 기한순</span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.dueDate ? `${task.dueDate.slice(0, 10)} 기한` : '기한 없음'}
                      {task.projectName ? ` · ${task.projectName}` : ''}
                    </small>
                  </SummaryHighlight>
                ))}
            </div>
            {!h.items.length && !h.answers.length && !h.snapshot?.quickBriefing && (
              <p>이 회차에 저장된 AI 요약이 없습니다.</p>
            )}
            {h.answers.length > 0 && (
              <details className="briefing-summary-narrative">
                <summary>전체 요약 문장 보기</summary>
                <BriefingSectionRail
                  label="전체 요약 문장 접기"
                  className="briefing-narrative-rail"
                />
                <div className="briefing-narrative-body">
                  {h.answers.map((answer, index) => (
                    <BriefingNarrative
                      key={index}
                      text={answer}
                      items={h.batches.filter((b) => b.answer === answer).flatMap((b) => b.items)}
                      agendaTitles={[
                        ...(h.snapshot?.calendar ?? []).map((e) => e.title),
                        ...(h.snapshot?.todos?.items ?? []).map((t) => t.title),
                      ]}
                    />
                  ))}
                </div>
              </details>
            )}
          </section>
          <details
            className="briefing-content-section weather briefing-history-weather"
            open={sectionsOpen}
          >
            <summary>
              <div className="briefing-section-heading">
                <h3>날씨</h3>
              </div>
              <BriefingWeatherPeek weather={h.snapshot?.weather} />
              <span className="briefing-source-toggle" aria-hidden="true" />
            </summary>
            <div className="briefing-live-source-body">
              {h.snapshot?.weather ? (
                <WeatherCard weather={h.snapshot.weather} historical />
              ) : (
                <p className="briefing-muted">
                  {h.snapshot?.sources.find((s) => s.kind === 'weather')?.error ??
                    '이 회차에는 당시 날씨가 저장되어 있지 않습니다.'}
                </p>
              )}
              <BriefingBottomCollapse label="날씨 접기" />
            </div>
          </details>
          {h.snapshot && (h.snapshot.calendar || h.snapshot.todos || h.snapshot.todoError) && (
            <details
              className="briefing-content-section calendar briefing-history-calendar"
              open={sectionsOpen}
            >
              <summary>
                <div className="briefing-section-heading">
                  <h3>
                    {h.snapshot.todos || h.snapshot.todoError
                      ? '오늘·내일 일정 · 할 일'
                      : '오늘·내일 일정'}
                  </h3>
                  <span className="briefing-section-count">
                    {h.snapshot.todos ? '일정 ' : ''}
                    {h.snapshot.calendar?.length ?? 0}개
                  </span>
                </div>
                <small>
                  {historyDate(
                    h.snapshot.calendarReferenceAt ?? h.createdAt,
                    h.snapshot.timeZone,
                    false,
                  )}{' '}
                  기준
                </small>
                <BriefingAgendaPeek
                  events={h.snapshot.calendar ?? []}
                  referenceAt={h.snapshot.calendarReferenceAt ?? h.createdAt}
                  timeZone={h.snapshot.timeZone}
                />
                {h.snapshot.todos && (
                  <small className="briefing-collapsed-peek">
                    미완료 할 일 {h.snapshot.todos.items.length}개
                  </small>
                )}
                <span className="briefing-source-toggle" aria-hidden="true" />
              </summary>
              <div className="briefing-live-source-body briefing-history-agenda">
                <BriefingAgendaDays
                  events={(h.snapshot.calendar ?? []).map((event, index) => ({
                    ...event,
                    jumpId: JSON.stringify([h.id, 'calendar', index]),
                  }))}
                  navigationScope={navigation.scope}
                  referenceAt={h.snapshot.calendarReferenceAt ?? h.createdAt}
                  timeZone={h.snapshot.timeZone}
                  todos={h.snapshot.todos?.items}
                />
                {h.snapshot.todoError && (
                  <p role="alert">할 일을 새로 확인하지 못했습니다. {h.snapshot.todoError}</p>
                )}
                {/* Only an incomplete task read is worth a line; the standing explanation was removed. */}
                {h.snapshot.todos?.limited && (
                  <small role="note">
                    일부 할 일만 조회했습니다. 전체 목록은 GOSU To-do list에서 확인하세요.
                  </small>
                )}
                <BriefingBottomCollapse label="일정 접기" />
              </div>
            </details>
          )}
          {(['email', 'papers'] as const).map((kind) => {
            const sectionItems = h.items.filter(
              (i) => (i.kind ?? (i.readScope.startsWith('mail') ? 'email' : 'papers')) === kind,
            );
            const chronological = newestSummaryFirst(
              sectionItems,
              (i) =>
                i.provenance?.summarizedAt ??
                i.addedAt ??
                h.batches.find((b) => b.id === h.itemHistoryIds[i.id])?.createdAt,
            );
            const sorted =
              kind === 'papers'
                ? importanceFirst(chronological, (i) => i.importance)
                : sortEmails(sectionItems, (i) => i);
            // "안 읽은 메일만": a display filter over the saved read state. A mail whose state was
            // never recorded is hidden too, and counted below so that nothing disappears silently.
            const filtering = kind === 'email' && unreadMailOnly;
            const items = filtering ? sorted.filter((i) => mailStillUnread(i) === true) : sorted;
            const unknownHidden = filtering
              ? sorted.filter((i) => mailStillUnread(i) === undefined).length
              : 0;
            const source = h.snapshot?.sources.find((s) => s.kind === kind);
            // The routine email read notice only restated the read range ("이미 요약한 메일은 제외하고 …")
            // and is no longer written; runs saved before still carry it, so it is hidden here too.
            // A first-connection notice stays: it explains why few messages appear.
            const notice =
              kind === 'email' && source?.notice?.startsWith('이미 요약한 메일은 제외하고')
                ? undefined
                : source?.notice;
            if (!sorted.length && !source) return null;
            return (
              <details
                className={`briefing-content-section ${kind} briefing-history-source`}
                key={kind}
                open={sectionsOpen}
                id={briefingTargetId(
                  navigation.scope,
                  kind,
                  JSON.stringify([h.id, 'section', kind]),
                )}
                data-briefing-jump-target="true"
                tabIndex={-1}
              >
                <summary>
                  <div className="briefing-section-heading">
                    <h3>
                      {kind === 'email' ? '이메일' : '연구 논문'} ·{' '}
                      {sorted.length === 0 && source?.status === 'failed'
                        ? '조회 미완료'
                        : filtering
                          ? `안 읽은 ${items.length} / ${sorted.length}개`
                          : `${items.length}개 요약`}
                      {items.some((i) =>
                        unreadUpdates.isNew(h.id, i.addedAt, h.snapshot?.newItemsSince),
                      ) && (
                        <span className="briefing-new-badge">
                          New{' '}
                          {
                            items.filter((i) =>
                              unreadUpdates.isNew(h.id, i.addedAt, h.snapshot?.newItemsSince),
                            ).length
                          }
                        </span>
                      )}
                    </h3>
                    {kind === 'email' && (
                      <MarkAllMailRead
                        routineId={h.routineId}
                        mails={sorted
                          .filter((i) => mailStillUnread(i) === true && h.itemHistoryIds[i.id])
                          .map((i) => ({
                            historyId: h.itemHistoryIds[i.id]!,
                            itemId: i.id,
                            url: i.mailMessageUrl,
                          }))}
                      />
                    )}
                  </div>
                  <span className="briefing-source-toggle" aria-hidden="true" />
                </summary>
                <BriefingSectionRail
                  label={`${kind === 'email' ? '이메일' : '연구 논문'} 섹션 접기`}
                />
                <div className="briefing-live-source-body">
                  {kind === 'papers' &&
                    items.length > 0 &&
                    (source?.status === 'failed' || source?.status === 'empty') && (
                      <p className="briefing-mail-collection-notice" role="note">
                        저장된 논문 요약 {items.length}개를 그대로 표시합니다. 저장본 보기에는 원문
                        조회나 AI 재요약이 없습니다.
                      </p>
                    )}
                  {notice && (
                    <p className="briefing-mail-collection-notice" role="note">
                      {notice}
                    </p>
                  )}
                  {source?.status === 'failed' && (
                    <p className="briefing-alert">{source.error ?? '당시 조회에 실패했습니다.'}</p>
                  )}
                  {!sorted.length && source?.status !== 'failed' && !notice && (
                    <p>
                      {source?.status === 'empty'
                        ? '당시 조회 결과가 없었습니다.'
                        : '조회 결과의 AI 요약이 아직 저장되지 않았습니다.'}
                    </p>
                  )}
                  {filtering && sorted.length > 0 && !items.length && (
                    <p className="briefing-muted">이 브리핑에는 안 읽은 메일이 없습니다.</p>
                  )}
                  {unknownHidden > 0 && (
                    <p className="briefing-mail-collection-notice" role="note">
                      {`읽음 상태를 모르는 메일 ${unknownHidden}통은 숨겼습니다. 읽음 상태를 기록하기 전에 저장된 브리핑입니다.`}
                    </p>
                  )}
                  {items.length > 0 && (
                    <div className="briefing-reading-list">
                      {items.map((item) => (
                        <BriefingHistoryItem
                          key={item.id}
                          item={item}
                          // Same reason as the 논문 요약 library: a collapsed paper's body is 242
                          // of its 296 tags, and the Markdown parse and KaTeX typesetting behind
                          // them cost more than the tags do. A briefing feed holds every run's
                          // items at once, so the saving grows with the history rather than with
                          // one screen.
                          {...(deferBody ? { deferBody } : {})}
                          paperReference={{
                            routineId: h.routineId,
                            historyId: h.itemHistoryIds[item.id]!,
                            paperId: item.id,
                            title: item.title,
                          }}
                          isNew={unreadUpdates.isNew(h.id, item.addedAt, h.snapshot?.newItemsSince)}
                          navigationId={briefingTargetId(
                            navigation.scope,
                            kind,
                            JSON.stringify([h.id, 'item', item.id]),
                          )}
                          mailOpenTarget={{
                            routineId: h.routineId,
                            historyId: h.itemHistoryIds[item.id]!,
                            itemId: item.id,
                          }}
                          timeZone={h.snapshot?.timeZone}
                          savedAt={
                            h.batches.find((b) => b.id === h.itemHistoryIds[item.id])?.createdAt
                          }
                          onRefresh={
                            onRefresh
                              ? (progress) =>
                                  onRefresh(
                                    h.routineId,
                                    h.itemHistoryIds[item.id]!,
                                    item.id,
                                    progress,
                                  )
                              : undefined
                          }
                          feedbackChoice={feedback?.[h.routineId]?.[item.id] ?? null}
                          {...(onFeedback
                            ? {
                                onFeedback: (decision: FeedbackDecision) =>
                                  onFeedback(
                                    h.routineId,
                                    h.itemHistoryIds[item.id]!,
                                    item.id,
                                    decision,
                                  ),
                              }
                            : {})}
                        />
                      ))}
                    </div>
                  )}
                  <BriefingBottomCollapse
                    label={kind === 'email' ? '이메일 목록 접기' : '논문 목록 접기'}
                  />
                </div>
              </details>
            );
          })}
        </article>
      ))}
      {more > 0 && (
        <div className="briefing-history-more" ref={sentinel}>
          <button type="button" onClick={() => setShown(visible + BRIEFING_FEED_PAGE)}>
            {`이전 브리핑 ${more}개 더 보기`}
          </button>
        </div>
      )}
    </div>
  );
}
export function BriefingHistoryView({
  notificationTarget,
  routineId,
  routineIds,
  excludeRunIds = [],
  refreshKey = '',
  embedded = false,
}: {
  notificationTarget?: BriefingNotificationTarget | undefined;
  routineId?: string;
  routineIds?: readonly string[];
  excludeRunIds?: readonly string[];
  refreshKey?: string;
  embedded?: boolean;
}) {
  const [history, setHistory] = useState<BriefingHistory[]>([]),
    [query, setQuery] = useState(''),
    // Not kept between visits: a forgotten filter would silently show a fraction of a briefing.
    [unreadMailOnly, setUnreadMailOnly] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<HistoryFeedback>({});
  const [revision, setRevision] = useState(0),
    [removed, setRemoved] = useState<HistoryRemovalReceipt | null>(null),
    [restoring, setRestoring] = useState(false);
  useEffect(() => {
    if (notificationTarget) {
      setQuery('');
      setRevision((n) => n + 1);
    }
  }, [notificationTarget]);
  const ids = [...new Set(routineIds ?? (routineId ? [routineId] : []))];
  const scope = JSON.stringify(ids),
    previousScope = useRef(scope);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<HistoryRemovalReceipt & { restored: boolean }>).detail;
      if (detail?.restored)
        setRemoved((current) => (current?.deletionId === detail.deletionId ? null : current));
      setRevision((n) => n + 1);
    };
    if (typeof window !== 'undefined') window.addEventListener?.(BRIEFING_HISTORY_CHANGED, changed);
    return () => {
      if (typeof window !== 'undefined')
        window.removeEventListener?.(BRIEFING_HISTORY_CHANGED, changed);
    };
  }, []);
  const [guidance, setGuidance] = useState<GuidanceByRoutine>({}),
    [guidanceError, setGuidanceError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    setGuidanceError('');
    for (const id of ids)
      readBriefingGuidance(id)
        .then((items) => {
          if (!c.signal.aborted) setGuidance((current) => ({ ...current, [id]: items }));
        })
        .catch((reason: unknown) => {
          if (!c.signal.aborted)
            setGuidanceError(
              `브리핑 지침을 읽지 못해 지침 메일 고정을 적용하지 못했습니다. ${reason instanceof Error ? reason.message : ''}`.trim(),
            );
        });
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ routineId?: string; items?: unknown }>).detail;
      if (detail?.routineId && Array.isArray(detail.items))
        setGuidance((current) => ({
          ...current,
          [detail.routineId!]: detail.items as { id: string; text: string }[],
        }));
    };
    if (typeof window !== 'undefined')
      window.addEventListener?.(BRIEFING_GUIDANCE_CHANGED, changed);
    return () => {
      c.abort();
      if (typeof window !== 'undefined')
        window.removeEventListener?.(BRIEFING_GUIDANCE_CHANGED, changed);
    };
    // The scope string stands for the routine ids.
  }, [scope]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError('');
    if (previousScope.current !== scope) {
      setHistory([]);
      setFeedback({});
      setRemoved(null);
      previousScope.current = scope;
    }
    void Promise.all(ids.map((id) => loadAllHistory(id, c.signal)))
      .then((values) => {
        if (!c.signal.aborted) {
          setFeedback(
            Object.fromEntries(values.map((value, index) => [ids[index]!, value.feedback ?? {}])),
          );
          setError(
            values
              .map((v) => v.feedbackWarning)
              .filter(Boolean)
              .join(' '),
          );
        }
        if (!c.signal.aborted)
          setHistory(
            values
              .flatMap((value) => value.history)
              .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
          );
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [scope, refreshKey, revision]);
  const matchingRuns = new Set(
    history
      .filter((h) => JSON.stringify(h).toLowerCase().includes(query.toLowerCase()))
      .map(historyRunKey),
  );
  return (
    <div className="briefing-real-history">
      <div className="briefing-live-actions">
        <h2>{embedded ? '이전 브리핑' : '저장된 AI 브리핑'}</h2>
        <input
          aria-label="브리핑 이력 검색"
          placeholder="요약 내용 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {history.some((h) =>
          h.items.some(
            (i) => (i.kind ?? (i.readScope.startsWith('mail') ? 'email' : 'papers')) === 'email',
          ),
        ) && (
          <button
            type="button"
            className="briefing-button briefing-unread-filter"
            aria-pressed={unreadMailOnly}
            title="브리핑이 메일을 읽어 온 때의 Apple Mail 읽음 상태 기준입니다. GOSU에서 읽음 처리한 메일은 빠집니다. Mail을 다시 조회하지 않습니다."
            onClick={() => setUnreadMailOnly((on) => !on)}
          >
            안 읽은 메일만
          </button>
        )}
      </div>
      {loading && <p role="status">저장된 이력 확인 중…</p>}
      <BriefingTrash routineIds={ids} revision={revision} />
      {removed && (
        <p className="briefing-removal-notice" role="status">
          브리핑을 삭제했습니다.{' '}
          <button
            type="button"
            className="briefing-text-button"
            disabled={restoring}
            onClick={async () => {
              setRestoring(true);
              try {
                await restoreBriefing(removed.routineId, removed.deletionId);
                setRemoved(null);
                setRevision((n) => n + 1);
              } catch (e) {
                setError(e instanceof Error ? e.message : '복원 실패');
              } finally {
                setRestoring(false);
              }
            }}
          >
            {restoring ? '복원 중…' : '삭제 취소'}
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!loading &&
        notificationTarget &&
        !history.some(
          (h) =>
            h.routineId === notificationTarget.routineId && h.runId === notificationTarget.runId,
        ) && (
          <p role="status">
            알림의 브리핑을 찾지 못했습니다. 삭제되었거나 현재 연결에서 열 수 없는 기록입니다.
          </p>
        )}
      {!loading && !history.length && !error && (
        <p>아직 저장된 AI 요약이 없습니다. 실제 자료를 조회해 요약하면 자동으로 쌓입니다.</p>
      )}
      {guidanceError && (
        <p role="status" className="briefing-alert">
          {guidanceError}
        </p>
      )}
      <BriefingHistoryFeed
        notificationTarget={notificationTarget}
        guidance={guidance}
        unreadMailOnly={unreadMailOnly}
        history={history.filter(
          (h) =>
            !excludeRunIds.includes(h.runId ?? h.id) &&
            (!query || matchingRuns.has(historyRunKey(h))),
        )}
        feedback={feedback}
        onDeleted={(receipt) => {
          setRemoved(receipt);
          setHistory((current) =>
            current.filter(
              (h) => h.routineId !== receipt.routineId || !receipt.historyIds.includes(h.id),
            ),
          );
          setRevision((n) => n + 1);
        }}
        onRefresh={async (routineId, historyId, itemId, progress) => {
          const refreshed = await refreshBriefingSummary(
            { routineId, historyId, itemId },
            new AbortController().signal,
            progress,
          );
          if (!refreshed.historyId)
            throw new Error('새 AI 요약을 이력에 저장하지 못했습니다. 기존 요약은 유지했습니다.');
          const updated = await loadAllHistory(routineId, new AbortController().signal);
          setHistory((current) => [
            ...current.filter((h) => h.routineId !== routineId),
            ...updated.history,
          ]);
        }}
        onFeedback={async (routineId, historyId, itemId, decision) => {
          const result = await sourceRequest<{ decision: FeedbackDecision }>(
            '/history/feedback',
            { routineId, historyId, itemId, decision },
            new AbortController().signal,
          );
          if (result.decision !== decision)
            throw new Error('선택 저장 결과를 확인하지 못했습니다.');
          setFeedback((current) => ({
            ...current,
            [routineId]: { ...current[routineId], [itemId]: decision },
          }));
        }}
      />
    </div>
  );
}
