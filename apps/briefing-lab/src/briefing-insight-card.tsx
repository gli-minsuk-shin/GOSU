import ReactMarkdown from 'react-markdown';
import { PaperChatButton } from './paper-chat-reference';
import { PaperSourceLink } from './paper-source-link';
import { AssistantWebImage, AssistantWebLink } from './assistant-web-media';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { LiveItem } from './live-types';
import type { PaperInsight } from './briefing-intelligence';
import type { BriefingMemorySession } from './briefing-memory-panel';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppleMailLink } from './apple-mail-link';
import { safeAppleMailUrl } from './apple-mail-url';
import { remarkBriefingTitles } from './briefing-title-emphasis';
import { remarkBriefingEmphasis } from './briefing-emphasis';
import { observedMailUnread } from './mail-read-state';
import { MailReadStatus, markMailReadFor } from './mail-read-status';
import { EmailDeliveryMeta } from './email-delivery-meta';
import type { MailOpenTarget } from './mail-open-contract';
import { BriefingBottomCollapse, BriefingSectionRail } from './briefing-disclosure-collapse';
import { cleanPaperTags } from './paper-tags';
import { ImportanceIcon } from './importance-icon';
import { PaperByline, PaperAuthors, type PaperBibliography } from './paper-bibliography';
import { EmailCalendarButton } from './email-calendar';
import type { EmailPreparedActions } from './email-prepared-actions';
export type FeedbackDecision = 'important' | 'not-interested' | null;
export function FeedbackControls({
  choice,
  onChoose,
  compact = false,
  disabled = false,
}: {
  choice: FeedbackDecision | null;
  onChoose: (decision: FeedbackDecision) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const button = (decision: FeedbackDecision, label: string, title: string) => (
    <button
      type="button"
      className={choice === decision ? 'selected' : ''}
      data-decision={decision}
      aria-pressed={choice === decision}
      aria-label={label}
      title={`${label}${choice === decision ? ' · 저장됨 · 다시 누르면 해제' : ''} · ${title}`}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onChoose(choice === decision ? null : decision);
      }}
    >
      <span className="briefing-feedback-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          data-feedback-icon={decision === 'important' ? 'thumb-up' : 'thumb-down'}
          fill={choice === decision ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <g transform={decision === 'not-interested' ? 'translate(0 24) scale(1 -1)' : undefined}>
            <path d="M7 10H3v10h4V10Zm0 0 4-7c2 0 3 1 2 4l-1 3h7c1.3 0 2.2 1.1 2 2.3l-1 5.9c-.2 1.1-1.1 1.8-2.2 1.8H7" />
          </g>
        </svg>
      </span>
      <span className={compact ? 'briefing-sr-only' : undefined}>{label}</span>
    </button>
  );
  return (
    <div
      className={`briefing-feedback${compact ? ' briefing-feedback-compact' : ''}`}
      aria-busy={disabled}
    >
      {button('important', '관심 있음', '다음 Briefing에서 비슷한 자료의 우선순위를 높입니다')}
      {button('not-interested', '관심 없음', '다음 Briefing에서 비슷한 자료의 우선순위를 낮춥니다')}
      <span className="briefing-feedback-receipt" role="status">
        {disabled
          ? '저장 중…'
          : choice
            ? `${choice === 'important' ? '관심 있음' : '관심 없음'} · 저장됨`
            : ''}
      </span>
    </div>
  );
}
export function PaperBriefingDisclosure({
  sourceUrl,
  chatAction,
  title,
  titleBadge,
  bibliography,
  publishedAt,
  keywords,
  importance,
  keywordHint,
  discoverySource,
  feedbackChoice,
  onFeedback,
  feedbackDisabled,
  feedbackStatus,
  children,
}: {
  title: string;
  sourceUrl?: string | undefined;
  chatAction?: ReactNode;
  titleBadge?: ReactNode;
  bibliography?: PaperBibliography | undefined;
  publishedAt?: string | undefined;
  keywords: readonly string[];
  importance?: PaperInsight['importance'];
  keywordHint?: string;
  discoverySource?: LiveItem['discoverySource'];
  feedbackChoice?: FeedbackDecision | null;
  onFeedback?: (decision: FeedbackDecision) => void;
  feedbackDisabled?: boolean;
  feedbackStatus?: string;
  children: ReactNode;
}) {
  const unique = [...new Map(keywords.map((k) => [k.trim().toLowerCase(), k.trim()])).values()]
    .filter(Boolean)
    .slice(0, 6);
  return (
    <>
      <details className="briefing-paper-disclosure">
        <summary className="briefing-paper-summary">
          <span className="briefing-paper-chevron" aria-hidden="true">
            ›
          </span>
          <div className="briefing-paper-heading">
            <h3 title={title}>
              {title}
              {titleBadge}
              <PaperSourceLink url={sourceUrl} title={title} />
              <PaperByline publishedAt={publishedAt} bibliography={bibliography} />
            </h3>
            <div className="briefing-item-meta">
              <ImportanceIcon level={importance ?? 'pending'} paper />
              {chatAction}
              {discoverySource === 'google-scholar-alert' && (
                <small className="briefing-paper-origin">Google Scholar 알림</small>
              )}
              <div className="briefing-paper-keywords" aria-label={keywordHint ?? '핵심 키워드'}>
                {keywordHint && <small>{keywordHint}</small>}
                {unique.length ? (
                  unique.map((k) => <span key={k}>{k}</span>)
                ) : (
                  <small>키워드 정보 없음</small>
                )}
              </div>
              {onFeedback && (
                <FeedbackControls
                  choice={feedbackChoice ?? null}
                  onChoose={onFeedback}
                  compact
                  disabled={feedbackDisabled ?? false}
                />
              )}
            </div>
          </div>
        </summary>
        {/* The open paper's left bar closes it, like a Briefing section's accent bar. */}
        <BriefingSectionRail label="이 논문 접기" className="briefing-item-rail" />
        <div className="briefing-paper-expanded">
          <PaperAuthors bibliography={bibliography} />
          {children}
          <BriefingBottomCollapse label="논문 요약 접기" leadingAction={chatAction} />
        </div>
      </details>
      {feedbackStatus && (
        <p className="briefing-feedback-status" role="status">
          {feedbackStatus}
        </p>
      )}
    </>
  );
}
export function EmailBriefingDisclosure({
  preparedActions,
  calendarText,
  title,
  titleBadge,
  summary,
  sender,
  mailMessageUrl,
  mailOpenTarget,
  mailAccount,
  mailCopies,
  bodyUnavailable,
  receivedAt,
  unread,
  markedReadAt,
  historical,
  timeZone,
  importance,
  feedbackChoice,
  onFeedback,
  feedbackDisabled,
  feedbackStatus,
  children,
}: {
  calendarText?: string | undefined;
  preparedActions?: EmailPreparedActions | null | undefined;
  title: string;
  titleBadge?: ReactNode;
  summary?: string | undefined;
  sender?: string | undefined;
  mailMessageUrl?: string | undefined;
  mailOpenTarget?: MailOpenTarget | undefined;
  mailAccount?: LiveItem['mailAccount'];
  mailCopies?: LiveItem['mailCopies'];
  /** The summary was written without the message body; the original must be checked. */
  bodyUnavailable?: boolean | undefined;
  receivedAt?: string | undefined;
  unread?: boolean | undefined;
  markedReadAt?: string | undefined;
  historical?: boolean | undefined;
  timeZone?: string | undefined;
  importance?: PaperInsight['importance'] | undefined;
  feedbackChoice?: FeedbackDecision | null;
  onFeedback?: ((decision: FeedbackDecision) => void) | undefined;
  feedbackDisabled?: boolean;
  feedbackStatus?: string;
  children: ReactNode;
}) {
  return (
    <>
      <details className="briefing-email-disclosure">
        <summary className="briefing-email-summary">
          <span className="briefing-paper-chevron" aria-hidden="true">
            ›
          </span>
          <div className="briefing-email-heading">
            <div className="briefing-email-title-row">
              <h3 title={title}>
                {title}
                {titleBadge}
                {historical && !summary?.trim() && (
                  <span
                    className="briefing-body-unavailable-badge"
                    title="AI 요약에 실패해 제목·보낸 사람·받은 시각만 기록했습니다. 다음 브리핑에서 다시 요약하며, 펼쳐서 ‘다시 요약’으로 바로 시도할 수 있습니다."
                  >
                    요약 실패 · 원본 확인
                  </span>
                )}
                {bodyUnavailable && (
                  <span
                    className="briefing-body-unavailable-badge"
                    title="본문을 읽지 못해 제목·발신자만으로 요약했습니다. 중요한 내용이 빠졌을 수 있으니 원본을 확인해주세요. 다음 브리핑에서 본문을 다시 읽습니다."
                  >
                    본문 미확인 · 원본 확인
                  </span>
                )}
              </h3>
              <AppleMailLink
                url={mailMessageUrl}
                target={mailOpenTarget}
                onOpened={() => {
                  // An email opened in Apple Mail has been read: keep GOSU and Mail in step.
                  if (unread === true && !markedReadAt)
                    void markMailReadFor(mailOpenTarget, mailMessageUrl);
                }}
              />
              <MailReadStatus
                unread={unread}
                historical={historical}
                target={mailOpenTarget}
                url={mailMessageUrl}
                markedReadAt={markedReadAt}
              />
            </div>
            <EmailDeliveryMeta
              sender={sender}
              senderTarget={safeAppleMailUrl(mailMessageUrl) ? mailOpenTarget : undefined}
              account={mailAccount}
              receivedAt={receivedAt}
              timeZone={timeZone}
            />
            {mailCopies && mailCopies.length > 1 && (
              <small className="briefing-duplicate-accounts">
                같은 메일 · {mailCopies.length}개 계정 수신:{' '}
                {mailCopies
                  .map(
                    (copy) =>
                      [copy.account.name, ...copy.account.addresses].filter(Boolean).join(' · ') ||
                      '연결 계정',
                  )
                  .join(' · ')}{' '}
                (읽음 표시·원본 열기는 대표 메일 기준)
              </small>
            )}
            <div className="briefing-item-meta briefing-email-meta">
              {importance && <ImportanceIcon level={importance} />}
              {onFeedback && (
                <FeedbackControls
                  choice={feedbackChoice ?? null}
                  onChoose={(decision) => {
                    onFeedback(decision);
                    // Rating an email means it has been seen: mark an unread one read in Apple Mail.
                    if (decision && unread === true && !markedReadAt)
                      void markMailReadFor(mailOpenTarget, mailMessageUrl);
                  }}
                  compact
                  disabled={feedbackDisabled ?? false}
                />
              )}
            </div>
            <div className="briefing-email-preview">
              {summary?.trim() ? (
                <BriefingMarkdown text={summary} />
              ) : historical ? (
                // A saved entry without a summary: the summary failed, the mail is shown anyway.
                <span>AI 요약 실패 · 메일이 온 것만 표시합니다 · 다음 브리핑에서 다시 요약</span>
              ) : (
                <span>AI 요약 전 · 펼쳐서 수집한 메일 확인</span>
              )}
            </div>
          </div>
        </summary>
        <div className="briefing-email-expanded">
          {children}
          <BriefingBottomCollapse label="이메일 요약 접기" />
        </div>
      </details>
      {mailOpenTarget && (
        <EmailCalendarButton
          preparedActions={preparedActions}
          routineId={mailOpenTarget.routineId}
          sourceKey={mailOpenTarget.itemId}
          title={title}
          text={calendarText || summary || title}
          receivedAt={receivedAt}
          timeZone={timeZone}
        />
      )}
      {feedbackStatus && (
        <p className="briefing-feedback-status" role="status">
          {feedbackStatus}
        </p>
      )}
    </>
  );
}
function sourceHref(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function MathText({ latex }: { latex: string }) {
  try {
    return (
      <div
        className="briefing-equation"
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(latex, {
            displayMode: true,
            throwOnError: true,
            trust: false,
            maxExpand: 1000,
            maxSize: 10,
          }),
        }}
      />
    );
  } catch {
    return <pre className="briefing-equation">{latex}</pre>;
  }
}
export function BriefingMarkdown({
  webMedia = false,
  text,
  emphasizedTitles = [],
  keywords = [],
  restrained = true,
  inline = false,
}: {
  webMedia?: boolean;
  text: string;
  emphasizedTitles?: readonly string[];
  keywords?: readonly string[];
  restrained?: boolean;
  inline?: boolean;
}) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[
        remarkGfm,
        remarkMath,
        [remarkBriefingEmphasis, { titles: emphasizedTitles, keywords, enabled: restrained }],
        [remarkBriefingTitles, { titles: emphasizedTitles }],
      ]}
      rehypePlugins={[[rehypeKatex, { trust: false, maxExpand: 1000, maxSize: 10 }]]}
      components={{
        ...(inline ? inlineContainers : {}),
        a: ({ children, href }) =>
          webMedia ? (
            <AssistantWebLink href={href}>{children}</AssistantWebLink>
          ) : (
            <span>{children}</span>
          ),
        img: ({ src, alt }) =>
          webMedia ? (
            <AssistantWebImage src={typeof src === 'string' ? src : undefined} alt={alt} />
          ) : null,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
// Inline fields live inside <p>, <small> and navigation buttons: never nest block containers.
const inlineContainers = Object.fromEntries(
  [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'pre',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'div',
  ].map((tag) => [tag, ({ children }: { children?: ReactNode }) => <span>{children}</span>]),
);
const paperTemplateFallback =
  '현재 확보된 초록·본문 범위에서 이 항목을 별도로 확인할 수 없습니다. 원문 범위를 넓혀 다시 요약해 주세요.';
export function PaperSummaryTemplate({
  insight,
}: {
  insight: Pick<
    PaperInsight,
    | 'researchQuestion'
    | 'strengths'
    | 'limitations'
    | 'methodsAndAssumptions'
    | 'reportedResults'
    | 'keywords'
  >;
}) {
  const sections = [
    ['1. 연구 질문', insight.researchQuestion],
    ['2. 강점', insight.strengths],
    ['3. 약점과 한계', insight.limitations],
    ['4. 방법과 가정', insight.methodsAndAssumptions],
    ['5. 보고된 결과', insight.reportedResults],
  ] as const;
  return (
    <section className="briefing-paper-template" aria-label="논문 요약 템플릿">
      {sections.map(([heading, text]) => (
        <section className="briefing-paper-template-section" key={heading}>
          <h4>{heading}</h4>
          <BriefingMarkdown
            text={text?.trim() || paperTemplateFallback}
            keywords={insight.keywords ?? []}
          />
        </section>
      ))}
    </section>
  );
}
export function BriefingInsightCard({
  item,
  insight,
  paper,
  memory,
  routineId,
  onFeedback,
  summaryFooter,
  timeZone,
  navigationId,
  savedFeedbackChoice,
  mailOpenTarget,
}: {
  item: LiveItem;
  insight?: PaperInsight | undefined;
  paper?: LiveItem['paper'];
  memory: BriefingMemorySession | null;
  routineId: string;
  onFeedback?: (decision: FeedbackDecision, keywords?: readonly string[]) => Promise<void>;
  summaryFooter?: React.ReactNode;
  timeZone?: string | undefined;
  navigationId?: string | undefined;
  savedFeedbackChoice?: FeedbackDecision | null | undefined;
  mailOpenTarget?: MailOpenTarget | undefined;
}) {
  const [feedback, setFeedback] = useState('');
  const [feedbackChoice, setFeedbackChoice] = useState<FeedbackDecision | null>(
    savedFeedbackChoice ?? null,
  );
  const feedbackLock = useRef(false);
  useEffect(
    () => setFeedbackChoice(savedFeedbackChoice ?? null),
    [item.id, routineId, savedFeedbackChoice],
  );
  const [feedbackPending, setFeedbackPending] = useState(false);
  const originalUrl = sourceHref(item.sourceUrl);
  const remember = async (
    text: string,
    kind: 'feedback' | 'finding',
    decision?: FeedbackDecision,
  ) => {
    if (feedbackLock.current || (kind === 'feedback' && decision === feedbackChoice)) return;
    feedbackLock.current = true;
    setFeedbackPending(true);
    try {
      if (kind === 'feedback' && decision !== undefined && onFeedback) {
        await onFeedback(
          decision,
          insight?.tags ?? insight?.keywords ?? item.matchedKeywords ?? [],
        );
        setFeedbackChoice(decision);
        setFeedback('');
        return;
      }
      if (!memory) throw new Error('Briefing memory를 먼저 열어주세요.');
      if (kind === 'feedback' && decision === null)
        throw new Error('저장된 브리핑에서 관심 선택을 해제해주세요.');
      await memory.remember({ routineId, kind, text, sourceId: `${kind}:${item.id}` });
      if (kind === 'feedback' && decision) setFeedbackChoice(decision);
      setFeedback(kind === 'feedback' ? '' : 'Memory에 저장했습니다. 다음 분석에서 참조합니다.');
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Memory 저장 실패');
    } finally {
      feedbackLock.current = false;
      setFeedbackPending(false);
    }
  };
  const isPaper = item.kind === 'papers';
  const chooseFeedback = (decision: FeedbackDecision) =>
    void remember(
      `${decision === 'important' ? '중요한 자료로' : '관심이 낮은 자료로'} 선택: ${item.title}. 관련 키워드: ${(insight?.keywords ?? item.matchedKeywords ?? []).join(', ')}`,
      'feedback',
      decision,
    );
  const body = (
    <>
      <div className="briefing-card-top">
        <span>{item.source}</span>
      </div>
      {isPaper && (
        <h3>
          {isPaper && originalUrl ? (
            <a
              className="briefing-paper-title-link"
              href={originalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h3>
      )}
      {item.kind === 'papers' && !originalUrl && <p className="briefing-muted">원문 링크 미확인</p>}
      {insight ? (
        <>
          <div className="briefing-insight-summary">
            <BriefingMarkdown
              text={insight.summary}
              keywords={isPaper ? (insight.keywords ?? []) : []}
            />
          </div>
          {isPaper && <PaperSummaryTemplate insight={insight} />}
          {isPaper && insight.detail && (
            <section className="briefing-paper-detail">
              <h4>보충 설명</h4>
              <BriefingMarkdown text={insight.detail} />
            </section>
          )}
          {isPaper && insight.relevance && (
            <div className="briefing-relevance">
              <strong>내 연구와의 연결</strong>
              <BriefingMarkdown text={insight.relevance} />
            </div>
          )}
          <p>
            <strong>{isPaper ? '이 우선순위인 이유 · ' : '왜 중요한가 · '}</strong>
            <BriefingMarkdown inline text={insight.importanceReason} />
          </p>
          {insight.action && (
            <p>
              <strong>다음 행동 · </strong>
              <BriefingMarkdown inline text={insight.action} />
            </p>
          )}
          {isPaper && insight.equationIds.length > 0 && <h4>핵심 수식</h4>}
          {isPaper &&
            insight.equationIds.map((id) => {
              const equation = paper?.equations.find((e) => e.id === id);
              const explanation = insight.equationExplanations?.find(
                (note) => note.equationId === id,
              )?.explanation;
              return equation ? (
                <div className="briefing-equation-explained" key={id}>
                  <MathText latex={equation.latex} />
                  {explanation && <BriefingMarkdown text={explanation} />}
                </div>
              ) : null;
            })}
          {isPaper &&
            insight.figureIds.map((id) => {
              const figure = paper?.figures.find((f) => f.id === id);
              return figure ? (
                <figure className="briefing-paper-figure" key={id}>
                  {figure.imageData ? (
                    <img src={figure.imageData} alt={figure.caption} />
                  ) : (
                    <p>선택된 그림을 안전하게 불러오지 못했습니다. 원문에서 확인하세요.</p>
                  )}
                  <figcaption>
                    {figure.caption.slice(0, 320)}
                    <small>
                      원문 그림 · 캡션을 근거로 선정 ·{' '}
                      <a href={paper?.sourceUrl} target="_blank" rel="noreferrer">
                        출처
                      </a>
                    </small>
                  </figcaption>
                </figure>
              ) : null;
            })}
          <details>
            <summary>분석 근거와 읽은 범위</summary>
            <blockquote>{insight.evidenceQuote}</blockquote>
            <p>{paper?.note ?? `${item.readScope} 범위의 자료를 사용했습니다.`}</p>
          </details>
          {insight.memorySuggestion && !onFeedback && (
            <details>
              <summary>AI가 제안한 기억 검토</summary>
              <p>{insight.memorySuggestion}</p>
              <button
                type="button"
                onClick={() => void remember(insight.memorySuggestion!, 'finding')}
              >
                확인하고 기억하기
              </button>
            </details>
          )}
        </>
      ) : (
        <p className="briefing-muted">
          AI 요약 전입니다.{' '}
          {isPaper
            ? '자동 분석 후 연구 우선순위와 자세한 설명을 표시합니다.'
            : '루틴 설정에서 메일 AI 요약을 허용하면 핵심 내용·기한·필요한 행동을 정리합니다.'}
        </p>
      )}
      <details className="briefing-original-evidence">
        <summary>원문 발췌 보기 · {item.readScope}</summary>
        <p>{item.text}</p>
        <ul>
          {item.details.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      </details>
      {originalUrl && (
        <a href={originalUrl} target="_blank" rel="noopener noreferrer">
          원문 열기 ↗
        </a>
      )}
    </>
  );
  return (
    <article
      className={`briefing-card briefing-insight-card ${isPaper ? 'is-paper' : 'is-email'}`}
      id={navigationId}
      data-briefing-jump-target={navigationId ? 'true' : undefined}
      tabIndex={navigationId ? -1 : undefined}
      aria-label={navigationId ? item.title : undefined}
    >
      {isPaper ? (
        <PaperBriefingDisclosure
          sourceUrl={item.sourceUrl}
          title={item.title}
          chatAction={
            insight ? (
              <PaperChatButton
                reference={{ routineId, historyId: '', paperId: item.id, title: item.title }}
              />
            ) : undefined
          }
          discoverySource={item.discoverySource}
          bibliography={item.bibliography}
          publishedAt={item.publishedAt}
          keywords={
            insight
              ? (insight.tags ?? cleanPaperTags([insight])[0]!.tags)
              : (item.matchedKeywords ?? [])
          }
          {...(insight ? { importance: insight.importance } : {})}
          {...(isPaper && (onFeedback || memory)
            ? { feedbackChoice, onFeedback: chooseFeedback }
            : {})}
          feedbackDisabled={feedbackPending}
          feedbackStatus={feedback}
          {...(!insight?.keywords?.length && item.matchedKeywords?.length
            ? { keywordHint: '검색어' }
            : {})}
        >
          <div className="briefing-reading-body">{body}</div>
        </PaperBriefingDisclosure>
      ) : (
        <EmailBriefingDisclosure
          preparedActions={insight?.preparedActions}
          calendarText={`${insight?.action ?? ''}\n${insight?.summary ?? ''}`}
          title={item.title}
          summary={insight?.summary}
          sender={item.details[0]}
          mailMessageUrl={item.mailMessageUrl}
          mailOpenTarget={mailOpenTarget}
          mailAccount={item.mailAccount}
          mailCopies={item.mailCopies}
          bodyUnavailable={item.readScope === 'mail-metadata'}
          receivedAt={item.publishedAt}
          unread={observedMailUnread(item)}
          markedReadAt={item.mailMarkedReadAt}
          timeZone={timeZone}
          importance={insight?.importance}
          feedbackChoice={feedbackChoice}
          onFeedback={onFeedback || memory ? chooseFeedback : undefined}
          feedbackDisabled={feedbackPending}
          feedbackStatus={feedback}
        >
          <div className="briefing-reading-body">{body}</div>
        </EmailBriefingDisclosure>
      )}
      {summaryFooter}
    </article>
  );
}
