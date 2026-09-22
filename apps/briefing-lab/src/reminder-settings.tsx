import { useEffect, useRef, useState } from 'react';
import { sourceRequest } from './live-client';
import type { BriefingTaskOptions } from './briefing-task-actions';
function checkedOptions(value: BriefingTaskOptions) {
  if (
    !value ||
    typeof value.authorized !== 'boolean' ||
    !Array.isArray(value.lists) ||
    !Array.isArray(value.projects)
  )
    throw Error('미리 알림 연결 상태를 확인하지 못했습니다. 다시 확인해주세요.');
  return value;
}
export function ReminderSettings({ routineId }: { routineId: string }) {
  const [options, setOptions] = useState<BriefingTaskOptions | null>(null),
    [enabled, setEnabled] = useState(false),
    [listId, setListId] = useState(''),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState('');
  const life = useRef<AbortController | null>(null);
  const working = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    life.current = c;
    setBusy(true);
    void sourceRequest<BriefingTaskOptions>('/todo/options', { routineId }, c.signal)
      .then((v) => {
        if (c.signal.aborted) return;
        checkedOptions(v);
        setOptions(v);
        setEnabled(v.reminderDefaults?.enabled ?? false);
        setListId(v.reminderDefaults?.listId ?? '');
      })
      .catch(() => {
        if (!c.signal.aborted) setMessage('루틴 설정을 저장한 뒤 미리 알림 연결을 확인해주세요.');
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [routineId]);
  const connect = async () => {
    if (working.current || busy) return;
    working.current = true;
    const signal = life.current!.signal;
    setBusy(true);
    setMessage('macOS 접근 요청이 표시되면 한 번 허용해주세요.');
    try {
      const v = await sourceRequest<BriefingTaskOptions>('/todo/authorize', { routineId }, signal);
      if (signal.aborted) return;
      checkedOptions(v);
      setOptions(v);
      setMessage(
        v.authorized
          ? '연결되었습니다. 사용할 기본 목록을 선택하고 저장해주세요.'
          : 'macOS 미리 알림 권한을 확인해주세요.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '연결 확인 실패');
    } finally {
      working.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  return (
    <fieldset>
      <legend>Apple 미리 알림 · 할 일 기본 설정</legend>
      <p>
        한 번 연결하고 기본 목록을 저장하면 이후 할 일 추가에서 그대로 사용합니다. 이 설정은 아래
        버튼으로 즉시 저장됩니다.
      </p>
      <button
        type="button"
        className="briefing-button"
        disabled={busy}
        onClick={() => void connect()}
      >
        {options?.authorized ? '연결 상태 확인' : '미리 알림 연결 · 접근 허용'}
      </button>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => setEnabled(e.target.checked)}
        />{' '}
        할 일 추가 시 Apple 미리 알림에도 함께 추가
      </label>
      <label className="briefing-field">
        <span>기본 미리 알림 목록</span>
        <select
          aria-label="기본 미리 알림 목록"
          value={listId}
          disabled={busy || !options?.authorized}
          onChange={(e) => setListId(e.target.value)}
        >
          <option value="">목록을 선택하세요</option>
          {options?.lists.map((l) => (
            <option key={l.id} value={l.id} disabled={!l.writable}>
              {l.name} · {l.source}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="briefing-button"
        disabled={busy || (enabled && (!options?.authorized || !listId))}
        onClick={async () => {
          if (working.current || busy) return;
          working.current = true;
          setBusy(true);
          try {
            await sourceRequest(
              '/todo/preferences',
              { routineId, enabled, listId },
              life.current!.signal,
            );
            setMessage('기본 미리 알림 설정을 저장했습니다. 다음 할 일부터 적용됩니다.');
          } catch (e) {
            setMessage(e instanceof Error ? e.message : '저장 실패');
          } finally {
            working.current = false;
            setBusy(false);
          }
        }}
      >
        미리 알림 기본 설정 저장
      </button>
      <p role="status">
        {message ||
          (options?.authorized
            ? 'macOS 접근 허용됨'
            : '아직 연결하지 않았습니다. macOS 권한은 직접 한 번 허용해야 합니다.')}
      </p>
    </fieldset>
  );
}
