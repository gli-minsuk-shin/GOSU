import { useEffect, useRef, useState } from 'react';
import { sourceRequest } from './live-client';
import './briefing-guidance.css';
import {
  BRIEFING_GUIDANCE_CHANGED,
  guidanceSenderRules,
  MAX_GUIDANCE_ITEMS,
  MAX_GUIDANCE_TEXT,
  type BriefingGuidanceItem,
} from './briefing-guidance';

type Items = { items: BriefingGuidanceItem[] };
const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : '브리핑 지침을 저장하지 못했습니다.';

const reading = new Map<string, Promise<BriefingGuidanceItem[]>>();
/**
 * One guidance read per routine at a time, shared by the header button and the saved briefing view:
 * separate copies pushed the Briefing Lab server past its three concurrent requests (routine_busy).
 * A read that has finished is not reused, so a saved change is always read again.
 */
export function readBriefingGuidance(routineId: string) {
  const pending = reading.get(routineId);
  if (pending) return pending;
  const next = sourceRequest<Partial<Items>>('/assistant/guidance/list', { routineId })
    .then((value) => (Array.isArray(value?.items) ? value.items : []))
    .finally(() => reading.delete(routineId));
  reading.set(routineId, next);
  return next;
}

function pinnedLabel(item: BriefingGuidanceItem) {
  const rules = guidanceSenderRules([item]);
  return rules.length ? `${rules.map((rule) => rule.value).join(', ')} 메일 고정` : null;
}

/**
 * The user's standing instructions for AI summaries, one line each. They are sent with every new
 * email, paper and quick-first summary; a mail address or domain in a line also pins that mail to the
 * front of "먼저 확인할 내용".
 */
export function BriefingGuidanceButton({ routineId }: { routineId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BriefingGuidanceItem[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Reopening the panel after a failed load reads the list again.
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setError('');
    readBriefingGuidance(routineId)
      .then((value) => {
        if (!controller.signal.aborted) setItems(value);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(message(reason));
      });
    return () => controller.abort();
  }, [routineId, attempt]);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const save = async (path: string, body: object) => {
    setBusy(true);
    setError('');
    try {
      const value = await sourceRequest<Items>(path, { routineId, ...body });
      setItems(value.items);
      if (typeof window !== 'undefined')
        window.dispatchEvent(
          new CustomEvent(BRIEFING_GUIDANCE_CHANGED, {
            detail: { routineId, items: value.items },
          }),
        );
      return true;
    } catch (reason) {
      setError(message(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!draft.trim() || busy) return;
    if (await save('/assistant/guidance/add', { text: draft })) setDraft('');
  };
  const saveEdit = async () => {
    if (!editing || !editing.text.trim() || busy) return;
    if (await save('/assistant/guidance/edit', editing)) setEditing(null);
  };
  const count = items?.length ?? 0;
  const full = count >= MAX_GUIDANCE_ITEMS;

  return (
    <span className="briefing-guidance-control" ref={root}>
      <button
        type="button"
        className="briefing-icon-button briefing-guidance-toggle"
        aria-label={count ? `브리핑 지침 (${count}개)` : '브리핑 지침'}
        aria-expanded={open}
        title="AI 요약이 참고할 브리핑 지침"
        onClick={() => {
          if (!open && items === null && error) setAttempt((n) => n + 1);
          setOpen((value) => !value);
        }}
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
          <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
        </svg>
        {count > 0 && <span className="briefing-guidance-count">{count}</span>}
      </button>
      {open && (
        <section className="briefing-guidance-panel" aria-label="브리핑 지침 목록">
          <header>
            <strong>브리핑 지침</strong>
            <small>
              AI 요약을 만들 때 참고합니다. 메일 주소나 도메인(예: @yonsei.ac.kr)을 적으면 그 메일은
              ‘먼저 확인할 내용’ 맨 앞에 고정됩니다. 저장 뒤 새로 요약하는 메일·논문부터 반영됩니다.
            </small>
          </header>
          {/* Not paragraphs: the Briefing header hides its <p> elements in the compact layout. */}
          {items === null && !error && (
            <div role="status" className="briefing-guidance-empty">
              지침을 불러오는 중…
            </div>
          )}
          {items !== null && !items.length && (
            <div className="briefing-guidance-empty">아직 지침이 없습니다.</div>
          )}
          {!!items?.length && (
            <ol className="briefing-guidance-list">
              {items.map((item) =>
                editing?.id === item.id ? (
                  <li key={item.id} className="editing">
                    <textarea
                      aria-label="지침 내용 수정"
                      value={editing.text}
                      maxLength={MAX_GUIDANCE_TEXT}
                      rows={2}
                      autoFocus
                      onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Enter' &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          void saveEdit();
                        }
                        if (event.key === 'Escape') {
                          event.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                    <span className="briefing-guidance-actions">
                      <button
                        type="button"
                        aria-label="수정 저장"
                        disabled={busy || !editing.text.trim()}
                        onClick={() => void saveEdit()}
                      >
                        저장
                      </button>
                      <button type="button" aria-label="수정 취소" onClick={() => setEditing(null)}>
                        취소
                      </button>
                    </span>
                  </li>
                ) : (
                  <li key={item.id}>
                    <span className="briefing-guidance-text">
                      {item.text}
                      {pinnedLabel(item) && (
                        <small className="briefing-guidance-pin">{pinnedLabel(item)}</small>
                      )}
                    </span>
                    <span className="briefing-guidance-actions">
                      <button
                        type="button"
                        aria-label={`지침 수정: ${item.text}`}
                        disabled={busy}
                        onClick={() => setEditing({ id: item.id, text: item.text })}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        aria-label={`지침 삭제: ${item.text}`}
                        disabled={busy}
                        onClick={() => void save('/assistant/guidance/delete', { id: item.id })}
                      >
                        삭제
                      </button>
                    </span>
                  </li>
                ),
              )}
            </ol>
          )}
          <div className="briefing-guidance-add">
            <input
              aria-label="새 브리핑 지침"
              placeholder={
                full ? '지침은 최대 20개입니다' : '예: nrf.re.kr 메일은 반드시 요약에 포함'
              }
              value={draft}
              maxLength={MAX_GUIDANCE_TEXT}
              disabled={full || items === null}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void add();
                }
              }}
            />
            <button
              type="button"
              aria-label="지침 추가"
              disabled={busy || full || !draft.trim() || items === null}
              onClick={() => void add()}
            >
              추가
            </button>
            <small>
              {count}/{MAX_GUIDANCE_ITEMS}
            </small>
          </div>
          {error && (
            <div role="alert" className="briefing-guidance-error">
              {error}
            </div>
          )}
        </section>
      )}
    </span>
  );
}
