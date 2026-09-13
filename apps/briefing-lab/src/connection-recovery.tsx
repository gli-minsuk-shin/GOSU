import { useEffect, useState } from 'react';
import type { BriefingRoutine } from '@gosu/briefing-core';
import { sourceRequest } from './live-client';
import { isGosuEmbedded } from './desktop-bridge';

export function ConnectionRecovery({
  routines,
  revision,
}: {
  routines: readonly BriefingRoutine[];
  revision: boolean;
}) {
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const ids = routines.map((r) => `${r.id}:${r.updatedAt}`).join('|');
  useEffect(() => {
    if (!isGosuEmbedded()) return;
    const controller = new AbortController();
    setError('');
    void Promise.all(
      routines.map(async (r) => {
        const status = await sourceRequest<{ needsApproval: boolean }>(
          '/assistant/settings/connection-status',
          { routineId: r.id },
          controller.signal,
        );
        return status.needsApproval ? r.id : null;
      }),
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setPending(result.filter((id): id is string => id !== null));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('기존 연결의 승인 상태를 확인하지 못했습니다. 설정은 유지되어 있습니다.');
      });
    return () => controller.abort();
  }, [ids, revision, retry]);
  if (!pending.length && !error) return null;
  return (
    <div className="briefing-desktop-import-note" role="status">
      {pending.length > 0 && (
        <>
          <strong>기존 연결을 다시 허용할까요?</strong>
          <span>
            {routines
              .filter((r) => pending.includes(r.id))
              .map((r) => r.name)
              .join(', ')}{' '}
            · 저장된 계정·메일함·캘린더 범위를 그대로 사용합니다. macOS 승인은 별도입니다.
          </span>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                for (const routineId of pending) {
                  await sourceRequest(
                    '/assistant/settings/reconnect',
                    { routineId },
                    new AbortController().signal,
                  );
                  setPending((current) => current.filter((id) => id !== routineId));
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : '연결 승인 실패');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '승인 확인 중…' : '저장된 연결 다시 허용'}
          </button>
        </>
      )}
      {error && (
        <>
          <span>{error}</span>
          <button disabled={busy} onClick={() => setRetry((n) => n + 1)}>
            다시 확인
          </button>
        </>
      )}
    </div>
  );
}
