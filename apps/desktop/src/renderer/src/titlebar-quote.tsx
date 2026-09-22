import { uiLocale, uiText, useUiLanguage } from '@gosu/ui/language';
import { useEffect, useId, useRef, useState } from 'react';

import { AiActivityStar } from './sidebar-ai-activity';
import type { DailyQuoteHistory, DailyQuoteView } from '../../shared/daily-quote-contracts';

export type DailyQuoteApi = Readonly<{
  get: () => Promise<DailyQuoteView | null>;
  refresh?: () => Promise<DailyQuoteView | null>;
  history?: () => Promise<DailyQuoteHistory | null>;
}>;

const hostApi: DailyQuoteApi = {
  get: () =>
    (typeof window === 'undefined' ? undefined : window.gosu?.dailyQuote)?.get() ??
    Promise.resolve(null),
  refresh: () =>
    (typeof window === 'undefined' ? undefined : window.gosu?.dailyQuote)?.refresh?.() ??
    Promise.resolve(null),
  history: () =>
    (typeof window === 'undefined' ? undefined : window.gosu?.dailyQuote)?.history?.() ??
    Promise.resolve(null),
};

const PENDING_POLL_MS = 15_000;
/** A line the reader asked for by hand: looked for often, because someone is waiting for it. */
const ASKED_POLL_MS = 2_000;
const PENDING_POLLS = 8;
const ASKED_POLLS = 40;
const DAY_CHECK_MS = 30 * 60_000;
/** How long the refusal stands in the quote's place before the quote comes back. */
const REFUSAL_MS = 8_000;

function failureNote(failure: string | null) {
  if (!failure) return '';
  return failure === 'daily_quote_model_unassigned'
    ? uiText(
        'Assign a model to “lightweight tasks” in Settings → Agent and AI writes a new quote every day.',
      )
    : uiText('AI could not write today’s quote ({reason}), so a built-in one is shown.', {
        reason: failure,
      });
}

export function quoteLine(quote: Pick<DailyQuoteView, 'text' | 'author'>) {
  return quote.author ? `“${quote.text}” — ${quote.author}` : `“${quote.text}”`;
}

/** The day and time a line was written, in the reader's locale. */
export function quoteWrittenAt(createdAt: string) {
  const at = new Date(createdAt);
  if (!Number.isFinite(at.getTime())) return createdAt;
  return new Intl.DateTimeFormat(uiLocale(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/**
 * The quote of the day, to the right of the app name. It is one quiet line: it never shows an
 * error, and the reason for a built-in line lives in the tooltip. The text comes from a model or
 * from GOSU's own list, so it is rendered as plain text and never looked up in the message catalog.
 * The line opens the history of every quote still kept; the button beside it asks for one more,
 * up to the day's allowance, and shows the same working star as the rest of GOSU while AI writes.
 */
export function TitlebarQuote({ api = hostApi }: { api?: DailyQuoteApi }) {
  const language = useUiLanguage();
  const [quote, setQuote] = useState<DailyQuoteView | null>(null);
  const [history, setHistory] = useState<DailyQuoteHistory | null>(null);
  const [refused, setRefused] = useState(false);
  const generatedId = useId().replaceAll(':', '');
  const historyId = `titlebar-quote-history-${generatedId}`;
  const panel = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLButtonElement>(null);
  const reload = useRef<(asked?: boolean) => void>(() => undefined);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    let asked = false;
    const load = async () => {
      const next = await api.get().catch(() => null);
      if (!active) return;
      setQuote(next);
      // A model line is on its way: look again soon, a few times. Otherwise wait for the next day.
      const soon = Boolean(next?.pending) && polls < (asked ? ASKED_POLLS : PENDING_POLLS);
      polls = soon ? polls + 1 : 0;
      if (!soon) asked = false;
      timer = setTimeout(
        () => void load(),
        soon ? (asked ? ASKED_POLL_MS : PENDING_POLL_MS) : DAY_CHECK_MS,
      );
    };
    reload.current = (wasAsked = false) => {
      polls = 0;
      asked = wasAsked;
      if (timer) clearTimeout(timer);
      void load();
    };
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, language]);

  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => setRefused(false), REFUSAL_MS);
    return () => clearTimeout(timer);
  }, [refused]);

  if (!quote || quote.language !== language) return null;
  const text = quoteLine(quote);
  const note = failureNote(quote.failure);
  const left = Math.max(0, quote.refreshLimit - quote.refreshesUsed);
  const refusal = uiText('That’s today’s ten. The rest is doing the work.');
  const askAgain = async () => {
    if (quote.pending) return;
    if (quote.capped) {
      setRefused(true);
      return;
    }
    const next = await api.refresh?.().catch(() => null);
    if (next) setQuote(next);
    // The answer comes back pending; the poll above turns it into the written line.
    reload.current(true);
  };
  const openHistory = () => {
    void api
      .history?.()
      .catch(() => null)
      .then((value) => setHistory(value));
    if (panel.current && line.current) {
      const at = line.current.getBoundingClientRect();
      panel.current.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - 388))}px`;
      panel.current.style.top = `${at.bottom + 8}px`;
    }
  };

  return (
    <span className="titlebar-quote">
      <button
        ref={line}
        type="button"
        className="titlebar-quote-line"
        title={refused ? refusal : note ? `${text}\n${note}` : text}
        popoverTarget={historyId}
        onClick={openHistory}
      >
        {refused ? refusal : text}
      </button>
      {quote.pending ? (
        <AiActivityStar status="running" />
      ) : (
        <button
          type="button"
          className="titlebar-quote-refresh"
          aria-label={uiText('New quote')}
          title={
            quote.capped
              ? uiText('Today’s ten quotes are used. A new one comes tomorrow.')
              : `${uiText('New quote')} · ${uiText('{count} left today', { count: left })}`
          }
          data-capped={quote.capped ? '' : undefined}
          onClick={() => void askAgain()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              d="M13.6 1.9v2.9h-2.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      <div
        ref={panel}
        id={historyId}
        popover="auto"
        role="dialog"
        aria-label={uiText('Quote history')}
        className="titlebar-quote-history"
      >
        <strong>{uiText('Quote history')}</strong>
        {history?.entries.length ? (
          <ol>
            {history.entries.map((entry) => (
              <li key={`${entry.createdAt}:${entry.text}`}>
                <span>{quoteLine(entry)}</span>
                <small>{quoteWrittenAt(entry.createdAt)}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p>{uiText('No quotes have been written yet.')}</p>
        )}
      </div>
    </span>
  );
}
