import { useRef, useState } from 'react';
import { alignedPreparedActions } from './email-action-weekday';
import { calendarInstant, calendarLocal } from './calendar-dates';
import type { EmailPreparedActions } from './email-prepared-actions';
import { sourceRequest } from './live-client';
import { openBriefingItem } from './briefing-item-navigation';
import { isGosuEmbedded } from './desktop-bridge';
import type { BriefingTaskOptions, BriefingTaskResult } from './briefing-task-actions';
export function BriefingTodoButton({
  routineId,
  title,
  text,
  sourceKey,
  preparedTask,
}: {
  routineId: string;
  title: string;
  text: string;
  sourceKey?: string | undefined;
  receivedAt?: string | undefined;
  preparedTask?: EmailPreparedActions['task'] | undefined;
}) {
  const [open, setOpen] = useState(false),
    [options, setOptions] = useState<BriefingTaskOptions | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [notice, setNotice] = useState(''),
    [prepared, setPrepared] = useState(false);
  const [name, setName] = useState(''),
    [notes, setNotes] = useState(''),
    [projectId, setProjectId] = useState(''),
    [dueDate, setDueDate] = useState(''),
    [dueTime, setDueTime] = useState(''),
    [mirror, setMirror] = useState(false),
    [listId, setListId] = useState(''),
    [result, setResult] = useState<BriefingTaskResult | null>(null);
  const requestId = useRef(''),
    lock = useRef(false);
  const timeZone = preparedTask?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Saved drafts are reused without another model call; an old one-day-off deadline is realigned here.
  const savedTask = preparedTask
    ? alignedPreparedActions({ event: null, task: preparedTask }, timeZone)!.task
    : preparedTask;
  const load = async (authorize = false) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const [next, value] = await Promise.all([
        sourceRequest<BriefingTaskOptions>(authorize ? '/todo/authorize' : '/todo/options', {
          routineId,
        }),
        !authorize && !prepared && !result
          ? Promise.resolve({
              draft: savedTask ?? {
                title: title.slice(0, 240),
                notes: text.slice(0, 4000),
                dueDate: null,
              },
              notice: savedTask
                ? `${savedTask.notice} · 저장된 할 일 정보를 사용합니다. 추가 AI 호출 없음.`
                : preparedTask === null
                  ? '요약에서 확정된 할 일 초안을 찾지 못했습니다. 내용과 기한을 직접 확인해주세요. 추가 AI 호출은 하지 않습니다.'
                  : '이전 요약에는 저장된 할 일 초안이 없습니다. 내용과 마감일을 확인해주세요. 추가 AI 호출은 하지 않습니다.',
            })
          : Promise.resolve(null),
      ]);
      setOptions(next);
      if (!authorize && !prepared && !result)
        setMirror(
          next.reminderDefaults?.enabled ?? (next.authorized && next.lists.some((l) => l.writable)),
        );
      setListId((current) =>
        next.lists.some((l) => l.id === current && l.writable)
          ? current
          : next.reminderDefaults?.listId
            ? next.lists.some((l) => l.id === next.reminderDefaults!.listId && l.writable)
              ? next.reminderDefaults.listId
              : ''
            : (next.lists.find(
                (l) => l.id === next.defaultListId && l.writable && /icloud/i.test(l.source),
              )?.id ??
              next.lists.find((l) => l.writable && /icloud/i.test(l.source))?.id ??
              next.lists.find((l) => l.id === next.defaultListId && l.writable)?.id ??
              next.lists.find((l) => l.writable)?.id ??
              ''),
      );
      if (value) {
        setName(value.draft.title);
        setNotes(value.draft.notes);
        setDueDate(value.draft.dueDate ?? '');
        setDueTime(
          preparedTask?.dueAt ? calendarLocal(preparedTask.dueAt, timeZone).slice(11, 16) : '',
        );
        setNotice(value.notice);
        setPrepared(true);
      }
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '할 일 연결을 확인하지 못했습니다.');
      if (authorize) {
        setMirror(false);
        setOpen(true);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const save = async () => {
    if (
      lock.current ||
      !prepared ||
      name.trim().length < 2 ||
      (mirror && (!options?.authorized || !listId))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      const receipt = await sourceRequest<BriefingTaskResult>('/todo/create', {
        routineId,
        requestId: requestId.current,
        sourceKey: sourceKey ?? requestId.current,
        projectId: projectId || null,
        title: name,
        notes,
        dueDate: dueDate || null,
        ...(dueDate && dueTime
          ? { dueAt: calendarInstant(`${dueDate}T${dueTime}`, timeZone) }
          : {}),
        reminderListId: mirror ? listId : null,
      });
      setResult(receipt);
      if (['created', 'existing', 'skipped'].includes(receipt.reminderState)) setOpen(false);
      if (isGosuEmbedded()) window.parent.postMessage({ type: 'gosu-briefing-todo-created' }, '*');
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : '처리 결과를 확인하지 못했습니다.'} 같은 요청으로 다시 시도하면 저장된 할 일을 먼저 확인합니다.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const complete = result && ['created', 'existing', 'skipped'].includes(result.reminderState);
  return (
    <div className="briefing-todo-action">
      <button
        type="button"
        disabled={busy || !!complete}
        onClick={() => {
          void load();
        }}
      >
        {complete
          ? '✓ 할 일 추가됨'
          : busy
            ? '준비 중…'
            : result
              ? '미리 알림 다시 확인'
              : '＋ 할 일 추가'}
      </button>
      {!open && error && <small role="alert">{error}</small>}
      {result && (
        <button type="button" onClick={() => openBriefingItem({ kind: 'task', id: result.taskId })}>
          할 일 보기
        </button>
      )}
      {open && (
        <div className="briefing-modal-backdrop">
          <section
            className="briefing-event-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="할 일 추가"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !busy) {
                e.preventDefault();
                setOpen(false);
              }
              if (e.key === 'Tab') {
                const items = [
                  ...e.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
                  ),
                ];
                const target = e.shiftKey ? items.at(-1) : items[0];
                if (
                  (e.shiftKey && document.activeElement === items[0]) ||
                  (!e.shiftKey && document.activeElement === items.at(-1))
                ) {
                  e.preventDefault();
                  target?.focus();
                }
              }
            }}
          >
            <header>
              <h2>할 일에 추가할까요?</h2>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="briefing-icon-button"
              >
                ×
              </button>
            </header>
            <div className="briefing-event-fields">
              {options?.warning && <p role="alert">{options.warning}</p>}
              <p className="briefing-event-notice">
                {notice ||
                  'AI가 이메일에서 해야 할 일과 마감일을 정리합니다. 확인 후 저장해주세요.'}
              </p>
              <label className="briefing-field">
                <span>제목</span>
                <input
                  autoFocus
                  maxLength={240}
                  value={name}
                  disabled={busy || !!result || !prepared}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="briefing-field">
                <span>프로젝트 · 선택</span>
                <select
                  aria-label="GOSU 프로젝트"
                  value={projectId}
                  disabled={busy || !!result || !prepared}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">프로젝트 없음 · 개인 할 일</option>
                  {options?.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="briefing-field">
                <span>마감일 · 선택</span>
                <input
                  type="date"
                  value={dueDate}
                  disabled={busy || !!result || !prepared}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </label>
              <label className="briefing-field">
                <span>마감 시간 · 선택 ({timeZone})</span>
                <input
                  type="time"
                  value={dueTime}
                  disabled={busy || !!result || !prepared || !dueDate}
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </label>
              <label className="briefing-field">
                <span>메모</span>
                <textarea
                  maxLength={4000}
                  value={notes}
                  disabled={busy || !!result || !prepared}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={mirror}
                  disabled={busy || !!complete}
                  onChange={(e) => setMirror(e.target.checked)}
                />{' '}
                Apple 미리 알림에도 함께 추가
              </label>
              {options && !options.authorized && (
                <small>
                  Apple 미리 알림 권한 없이도 GOSU에 저장할 수 있습니다. 휴대폰 연동을 원하면 위
                  옵션을 켜고 접근을 허용해주세요.
                </small>
              )}
              {mirror && (
                <>
                  <label className="briefing-field">
                    <span>미리 알림 목록</span>
                    <select
                      aria-label="미리 알림 목록"
                      value={listId}
                      disabled={busy || !options?.authorized || !!complete}
                      onChange={(e) => setListId(e.target.value)}
                    >
                      <option value="">
                        iCloud 목록을 선택하면 휴대폰에서도 확인할 수 있습니다
                      </option>
                      {options?.lists.map((l) => (
                        <option key={l.id} value={l.id} disabled={!l.writable}>
                          {l.name} · {l.source}
                        </option>
                      ))}
                    </select>
                  </label>
                  {options && !options.authorized && (
                    <button type="button" disabled={busy} onClick={() => void load(true)}>
                      미리 알림 접근 허용
                    </button>
                  )}
                  <small className="briefing-todo-help">
                    macOS는 미리 알림 전체 접근 권한을 요청합니다. GOSU는 선택한 목록에 추가하고
                    중복을 확인합니다. iPhone과 같은 Apple 계정의 iCloud 미리 알림을 켜주세요. 이후
                    수정·완료는 각 앱에서 별도로 관리합니다.
                  </small>
                </>
              )}
              {busy && <p role="status">처리 중…</p>}
              {result && <p role="status">{result.message}</p>}
              {error && <p role="alert">{error}</p>}
              {error && !prepared && !busy && (
                <button type="button" onClick={() => void load()}>
                  AI 초안 다시 준비
                </button>
              )}
            </div>
            <footer>
              <button
                type="button"
                className="briefing-button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                닫기
              </button>
              <button
                type="button"
                className="briefing-primary"
                disabled={
                  busy ||
                  !prepared ||
                  !!complete ||
                  !options ||
                  name.trim().length < 2 ||
                  (mirror && (!options.authorized || !listId))
                }
                onClick={() => void save()}
              >
                {complete
                  ? '추가됨'
                  : result
                    ? '미리 알림 다시 확인'
                    : mirror
                      ? 'GOSU · 미리 알림에 추가'
                      : 'GOSU 할 일에 추가'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
