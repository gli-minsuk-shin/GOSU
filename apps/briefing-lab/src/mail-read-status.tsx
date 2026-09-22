import { useEffect, useId, useRef, useState } from 'react';
import { sourceRequest } from './live-client';
import { safeAppleMailUrl } from './apple-mail-url';
import { MailOpenRequestSchema, type MailOpenTarget } from './mail-open-contract';

// Retain acknowledgments for the same displayed snapshot, not a blanket override for future reads.
const listeners = new Set<(key: string, at: string) => void>();
const confirmedSnapshots = new Map<string, string>();
// Marks started elsewhere (the interest buttons) report here, so the status beside the title follows.
type MarkEvent = { pending: boolean; error?: string; uncertain?: boolean };
const markListeners = new Set<(key: string, event: MarkEvent) => void>();
const marking = new Set<string>();
const markedThisSession = new Set<string>();
export function resetMailReadSession() {
  confirmedSnapshots.clear();
  markedThisSession.clear();
}
const mailReadKey = (target: MailOpenTarget | undefined, url: string | undefined) =>
  JSON.stringify([target?.routineId, target?.itemId, url]);
function announceRead(key: string, at: string) {
  markedThisSession.add(key);
  for (const notify of listeners) notify(key, at);
}
/**
 * Marks one displayed email read in Apple Mail through the same single-message route as the
 * "읽음으로 변환" button (same message check and confirmation policy). Used when the user rates an
 * unread email; a message already marked in this session is not written again.
 */
export async function markMailReadFor(target: MailOpenTarget | undefined, url: string | undefined) {
  if (!safeAppleMailUrl(url) || !MailOpenRequestSchema.safeParse(target).success) return;
  const key = mailReadKey(target, url);
  if (marking.has(key) || markedThisSession.has(key)) return;
  marking.add(key);
  const report = (event: MarkEvent) => {
    for (const notify of markListeners) notify(key, event);
  };
  report({ pending: true });
  try {
    const result = await sourceRequest<{
      status: string;
      markedAt: string;
      historyWarning?: string;
      error?: string;
    }>('/mail/mark-read', target);
    if (result.status === 'unconfirmed') {
      report({
        pending: false,
        uncertain: true,
        error: result.error ?? '읽음 상태를 다시 확인해주세요.',
      });
      return;
    }
    if (result.status !== 'read' || !Number.isFinite(Date.parse(result.markedAt)))
      throw new Error('읽음 처리 결과를 확인하지 못했습니다. Apple Mail에서 상태를 확인해주세요.');
    announceRead(key, result.markedAt);
    report({ pending: false, ...(result.historyWarning ? { error: result.historyWarning } : {}) });
  } catch (error) {
    report({
      pending: false,
      error: error instanceof Error ? error.message : '읽음 처리 결과를 확인하지 못했습니다.',
    });
  } finally {
    marking.delete(key);
  }
}
export type MailBatchTarget = { historyId: string; itemId: string; url: string | undefined };
/** Whether this session already marked the displayed mail read (by its button, a rating or a batch). */
export const mailMarkedThisSession = (routineId: string, mail: MailBatchTarget) =>
  markedThisSession.has(
    mailReadKey({ routineId, historyId: mail.historyId, itemId: mail.itemId }, mail.url),
  );
/**
 * "모두 읽음" of one saved briefing: one request for all of its unread mail. The server still marks
 * one message at a time through the single-message writer and answers per mail, so every card
 * follows its own result and a failure is shown on the mail it belongs to.
 */
export async function markAllMailRead(routineId: string, mails: readonly MailBatchTarget[]) {
  const targets = mails
    .map((mail) => ({
      mail,
      key: mailReadKey({ routineId, historyId: mail.historyId, itemId: mail.itemId }, mail.url),
    }))
    .filter(
      ({ mail, key }) =>
        safeAppleMailUrl(mail.url) && !marking.has(key) && !markedThisSession.has(key),
    );
  if (!targets.length) return { marked: 0, failures: [] as { itemId: string; error: string }[] };
  const report = (key: string, event: MarkEvent) => {
    for (const notify of markListeners) notify(key, event);
  };
  for (const { key } of targets) {
    marking.add(key);
    report(key, { pending: true });
  }
  try {
    const response = await sourceRequest<{
      marked: number;
      results: {
        historyId: string;
        itemId: string;
        status: string;
        markedAt?: string;
        error?: string;
        historyWarning?: string;
      }[];
    }>('/mail/mark-read-all', {
      routineId,
      items: targets.map(({ mail }) => ({ historyId: mail.historyId, itemId: mail.itemId })),
    });
    const failures: { itemId: string; error: string }[] = [];
    let marked = 0;
    for (const { mail, key } of targets) {
      const result = response.results.find(
        (value) => value.historyId === mail.historyId && value.itemId === mail.itemId,
      );
      if (result?.status === 'read' && Number.isFinite(Date.parse(result.markedAt ?? ''))) {
        marked += 1;
        announceRead(key, result.markedAt!);
        report(key, {
          pending: false,
          ...(result.historyWarning ? { error: result.historyWarning } : {}),
        });
        continue;
      }
      const error =
        result?.error ??
        (result?.status === 'unread'
          ? 'Apple Mail에서 아직 읽지 않음으로 남아 있습니다.'
          : '읽음 처리 결과를 확인하지 못했습니다. Apple Mail에서 상태를 확인해주세요.');
      failures.push({ itemId: mail.itemId, error });
      report(key, { pending: false, error, uncertain: result?.status === 'unconfirmed' });
    }
    return { marked, failures };
  } catch (error) {
    const message = error instanceof Error ? error.message : '읽음 처리 요청에 실패했습니다.';
    for (const { key } of targets) report(key, { pending: false, error: message });
    throw error;
  } finally {
    for (const { key } of targets) marking.delete(key);
  }
}
function remember(key: string, at: string) {
  confirmedSnapshots.delete(key);
  confirmedSnapshots.set(key, at);
  while (confirmedSnapshots.size > 256)
    confirmedSnapshots.delete(confirmedSnapshots.keys().next().value!);
}
export function MailReadStatus({
  unread,
  historical = false,
  target,
  url,
  markedReadAt,
}: {
  unread?: boolean | undefined;
  historical?: boolean | undefined;
  target?: MailOpenTarget | undefined;
  url?: string | undefined;
  markedReadAt?: string | undefined;
}) {
  const key = mailReadKey(target, url);
  const observation = JSON.stringify([
    key,
    target && ('receiptId' in target ? target.receiptId : target.historyId),
    unread,
  ]);
  const [confirmedAt, setConfirmedAt] = useState(
      markedReadAt ?? confirmedSnapshots.get(observation) ?? '',
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false),
    [checkedNow, setCheckedNow] = useState(false);
  const controller = useRef<AbortController | null>(null),
    lock = useRef(false),
    confirmed = useRef(confirmedAt),
    tooltip = useId();
  useEffect(() => {
    confirmed.current = markedReadAt ?? confirmedSnapshots.get(observation) ?? '';
    setConfirmedAt(confirmed.current);
    setError('');
    setUncertain(false);
    setCheckedNow(false);
  }, [observation, markedReadAt]);
  useEffect(() => {
    lock.current = false;
    controller.current = null;
    setPending(false);
    const notify = (value: string, at: string) => {
      if (value === key) {
        remember(observation, at);
        confirmed.current = at;
        setConfirmedAt(at);
        setUncertain(false);
        setError('');
      }
    };
    const follow = (value: string, event: MarkEvent) => {
      if (value !== key) return;
      setPending(event.pending);
      if (event.pending) return;
      if (event.uncertain) setUncertain(true);
      setError(event.error ?? '');
    };
    listeners.add(notify);
    markListeners.add(follow);
    return () => {
      listeners.delete(notify);
      markListeners.delete(follow);
      controller.current?.abort();
    };
  }, [key, observation]);
  const isUnread = !confirmedAt && !uncertain && unread === true;
  const state = confirmedAt
    ? 'read'
    : uncertain
      ? 'unknown'
      : unread === false
        ? 'read'
        : unread === true
          ? 'unread'
          : 'unknown';
  const label =
    state === 'read'
      ? '읽음'
      : state === 'unread'
        ? '읽지 않음'
        : uncertain
          ? '확인 필요'
          : '상태 미확인';
  const context = confirmedAt
    ? '읽음 처리 확인'
    : uncertain
      ? '읽음 적용 여부'
      : checkedNow
        ? '방금 상태 확인'
        : historical
          ? '브리핑 당시'
          : '마지막 메일 조회 당시';
  const available = Boolean(
    safeAppleMailUrl(url) && MailOpenRequestSchema.safeParse(target).success,
  );
  if (confirmedAt)
    return (
      <span className="briefing-mail-read-feedback">
        <span className="briefing-sr-only" role="status">
          읽음 처리를 완료했습니다.
        </span>
        {error && (
          <small role="alert" className="briefing-mail-open-error">
            {error}
          </small>
        )}
      </span>
    );
  return (
    <span className="briefing-mail-read-feedback">
      <span className="briefing-mail-state-control">
        {!pending && (
          <span
            className={`briefing-mail-read-status is-${state}`}
            aria-label={`${context} · ${label}`}
            title={
              uncertain
                ? '읽음 변경이 적용됐는지 아직 확인하지 못했습니다. 옆의 확인 아이콘은 상태만 읽고 메일을 변경하지 않습니다.'
                : confirmedAt
                  ? `Apple Mail 읽음 처리 확인 · ${new Date(confirmedAt).toLocaleString('ko-KR')}. 이후 Mail에서 바꾼 상태는 새 조회에서 확인합니다.`
                  : `${context}의 읽음 상태입니다. 지금 Apple Mail의 상태와 다를 수 있으며, 요약을 펼쳐도 실제 메일은 읽음 처리하지 않습니다.`
            }
          >
            <span aria-hidden="true">
              {state === 'read' ? '✓' : state === 'unread' ? '●' : '–'}
            </span>
            {label}
          </span>
        )}
        {(isUnread || uncertain) && available && (
          <span className="briefing-mail-mark-control">
            <button
              type="button"
              className="briefing-mail-mark-read"
              aria-label={uncertain ? '읽음 상태 다시 확인' : '읽음으로 변환'}
              aria-describedby={tooltip}
              disabled={pending}
              aria-busy={pending}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (lock.current) return;
                lock.current = true;
                setPending(true);
                setError('');
                const cancel = new AbortController();
                const readOnly = uncertain;
                controller.current = cancel;
                try {
                  const result = await sourceRequest<{
                    status: string;
                    markedAt: string;
                    historyWarning?: string;
                    error?: string;
                  }>(readOnly ? '/mail/read-status' : '/mail/mark-read', target, cancel.signal);
                  if (cancel.signal.aborted || confirmed.current) return;
                  if (result.status === 'unconfirmed') {
                    setUncertain(true);
                    setError(result.error ?? '읽음 상태를 다시 확인해주세요.');
                    return;
                  }
                  if (readOnly && result.status === 'unread') {
                    setUncertain(false);
                    setCheckedNow(true);
                    setError('');
                    return;
                  }
                  if (result.status !== 'read' || !Number.isFinite(Date.parse(result.markedAt)))
                    throw new Error(
                      '읽음 처리 결과를 확인하지 못했습니다. Apple Mail에서 상태를 확인해주세요.',
                    );
                  if (!cancel.signal.aborted) {
                    announceRead(key, result.markedAt);
                    setError(result.historyWarning ?? '');
                  }
                } catch (e) {
                  if (!cancel.signal.aborted && !confirmed.current)
                    setError(
                      e instanceof Error ? e.message : '읽음 처리 결과를 확인하지 못했습니다.',
                    );
                } finally {
                  if (controller.current === cancel) {
                    lock.current = false;
                    if (!cancel.signal.aborted) setPending(false);
                  }
                }
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
                {pending ? (
                  <circle cx="12" cy="12" r="8" strokeDasharray="36 16" />
                ) : uncertain ? (
                  <path d="M20 5v6h-6M20 11a8 8 0 1 0-1 7" />
                ) : (
                  <path d="M13 5H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6M3 7l9 6 2-1M16 5l2 2 4-4" />
                )}
              </svg>
            </button>
            <span role="tooltip" id={tooltip} className="briefing-mail-mark-tooltip">
              {pending
                ? uncertain
                  ? '상태 확인 중…'
                  : '읽음 처리 중…'
                : uncertain
                  ? '읽음 상태 다시 확인'
                  : '읽음으로 변환'}
            </span>
          </span>
        )}
        <span className="briefing-sr-only" role="status">
          {pending ? (uncertain ? '상태 확인 중…' : '읽음 처리 중…') : ''}
        </span>
      </span>
      {error && (
        <small role="alert" className="briefing-mail-open-error">
          {error}
        </small>
      )}
    </span>
  );
}
