import { useEffect, useId, useRef, useState } from 'react';
import { sourceRequest } from './live-client';
import { safeAppleMailUrl } from './apple-mail-url';
import { MailOpenRequestSchema, type MailOpenTarget } from './mail-open-contract';

// Retain acknowledgments for the same displayed snapshot, not a blanket override for future reads.
const listeners = new Set<(key: string, at: string) => void>();
const confirmedSnapshots = new Map<string, string>();
export function resetMailReadSession() {
  confirmedSnapshots.clear();
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
  const key = JSON.stringify([target?.routineId, target?.itemId, url]);
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
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
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
                    for (const notify of listeners) notify(key, result.markedAt);
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
