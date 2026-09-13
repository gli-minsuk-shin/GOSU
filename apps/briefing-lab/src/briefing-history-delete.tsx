import { useEffect, useRef, useState } from 'react';
import { sourceRequest } from './live-client';
import { briefingDate } from './briefing-agenda-days';
import {
  announceHistoryChange,
  HistoryRemovalReceiptSchema,
  RemovedBriefingSchema,
  type HistoryRemovalTarget,
  type HistoryRemovalReceipt,
  type RemovedBriefing,
} from './briefing-history-removal';

export async function restoreBriefing(routineId: string, deletionId: string) {
  const result = HistoryRemovalReceiptSchema.parse(
    await sourceRequest(
      '/history/restore',
      { routineId, deletionId },
      new AbortController().signal,
    ),
  );
  if (result.routineId !== routineId || result.deletionId !== deletionId)
    throw Error('브리핑 복원 결과를 확인하지 못했습니다.');
  announceHistoryChange(result, true);
  return result;
}
export function BriefingRunDelete({
  target,
  onDeleted,
}: {
  target: HistoryRemovalTarget;
  onDeleted?: ((receipt: HistoryRemovalReceipt) => void) | undefined;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const remove = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = HistoryRemovalReceiptSchema.parse(
        await sourceRequest(
          '/history/delete',
          { ...target, confirmed: true },
          new AbortController().signal,
        ),
      );
      if (
        result.routineId !== target.routineId ||
        ('historyId' in target
          ? !result.historyIds.includes(target.historyId)
          : result.runId !== target.runId)
      )
        throw Error('삭제 결과를 확인하지 못했습니다. 새로고침 후 확인해주세요.');
      announceHistoryChange(result);
      onDeleted?.(result);
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '브리핑을 삭제하지 못했습니다.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="briefing-run-delete"
        aria-label="브리핑 전체 삭제"
        title="이 회차 브리핑을 휴지통으로 이동"
        onClick={() => setConfirm(true)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7m4-7v7" />
        </svg>
      </button>
      {confirm && (
        <div className="briefing-delete-confirm" role="group" aria-label="브리핑 전체 삭제 확인">
          <strong>이 회차 브리핑 전체를 삭제할까요?</strong>
          <p>
            AI 요약·날씨·일정·이메일·논문 블록을 이력에서 함께 제거합니다. 원본 메일·Calendar
            일정·논문 보관함·관심 설정은 유지하며, 삭제한 브리핑에서 복원할 수 있습니다.
          </p>
          <div>
            <button
              type="button"
              className="briefing-button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              취소
            </button>
            <button
              type="button"
              className="briefing-button danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? '삭제 중…' : '이 회차 삭제'}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </>
  );
}
export function BriefingTrash({
  routineIds,
  revision,
}: {
  routineIds: readonly string[];
  revision: number;
}) {
  const [open, setOpen] = useState(false),
    [entries, setEntries] = useState<RemovedBriefing[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  const scope = JSON.stringify(routineIds);
  const lock = useRef(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setEntries([]);
    void Promise.all(
      routineIds.map((routineId) =>
        sourceRequest<{ removed: RemovedBriefing[] }>(
          '/history/deleted',
          { routineId },
          controller.signal,
        ),
      ),
    )
      .then((values) => {
        if (!controller.signal.aborted)
          setEntries(
            RemovedBriefingSchema.array()
              .parse(values.flatMap((v) => v.removed ?? []))
              .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
          );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, scope, revision, refresh]);
  return (
    <section className="briefing-trash">
      <button
        type="button"
        className="briefing-text-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        삭제한 브리핑 {open ? '닫기' : '보기'}
      </button>
      {open && (
        <div className="briefing-trash-list">
          <p>
            복원하면 원래 날짜 위치로 돌아갑니다. 이 기능은 이력 정리용이며 저장 공간을 영구적으로
            비우지는 않습니다.
          </p>
          {loading && <p role="status">삭제한 브리핑 확인 중…</p>}
          {!loading && !entries.length && !error && <p>삭제한 브리핑이 없습니다.</p>}
          {entries.map((entry) => (
            <div className="briefing-trash-entry" key={entry.id}>
              <div>
                <strong>{briefingDate(entry.createdAt, entry.timeZone)}</strong>
                <small>{entry.routineName}</small>
              </div>
              <button
                type="button"
                className="briefing-button"
                disabled={busy !== null}
                aria-label={`${briefingDate(entry.createdAt, entry.timeZone)} 브리핑 복원`}
                onClick={async () => {
                  if (lock.current) return;
                  lock.current = true;
                  setBusy(entry.id);
                  setError('');
                  try {
                    await restoreBriefing(entry.routineId, entry.id);
                    setEntries((items) => items.filter((e) => e.id !== entry.id));
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '복원 실패');
                  } finally {
                    lock.current = false;
                    setBusy(null);
                  }
                }}
              >
                {busy === entry.id ? '복원 중…' : '복원'}
              </button>
            </div>
          ))}
          {error && (
            <p role="alert">
              {error}{' '}
              <button
                type="button"
                className="briefing-text-button"
                onClick={() => setRefresh((n) => n + 1)}
              >
                다시 확인
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
