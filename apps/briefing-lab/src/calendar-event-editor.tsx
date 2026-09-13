import { useEffect, useRef, useState } from 'react';
import { sourceRequest } from './live-client';
import {
  EventDraftSchema,
  type EventDraft,
  type CalendarEvent,
  type CalendarInfo,
} from './workspace-contracts';
import { calendarInstant, calendarLocal, setEventAllDay } from './calendar-dates';
import { CalendarAccessRepair } from './calendar-access-repair';
function eventDraft(value: EventDraft): EventDraft {
  return {
    calendarId: value.calendarId,
    title: value.title,
    start: value.start,
    end: value.end,
    allDay: value.allDay,
    timeZone: value.timeZone,
    location: value.location,
    notes: value.notes,
    alarmMinutes: value.alarmMinutes,
  };
}

export function CalendarEventEditor({
  routineId,
  initial,
  event,
  calendarIds,
  onClose,
  onSaved,
  heading,
  notice,
}: {
  routineId: string;
  initial: EventDraft;
  event?: CalendarEvent;
  calendarIds: string[];
  onClose: () => void;
  onSaved: () => void;
  heading?: string;
  notice?: string;
}) {
  const [draft, setDraft] = useState<EventDraft>(() => ({
      calendarId: initial.calendarId,
      title: initial.title,
      start: initial.start,
      end: initial.end,
      allDay: initial.allDay,
      timeZone: initial.timeZone,
      location: initial.location,
      notes: initial.notes,
      alarmMinutes: initial.alarmMinutes,
    })),
    [calendars, setCalendars] = useState<CalendarInfo[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loadingCalendars, setLoadingCalendars] = useState(true);
  const requestLock = useRef(false);
  const uncertainRef = useRef(false);
  const [writeUncertain, setWriteUncertain] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setLoadingCalendars(true);
    setError('');
    void sourceRequest<{ calendars: CalendarInfo[] }>('/calendar/catalog', { routineId }, c.signal)
      .then((v) => {
        if (c.signal.aborted) return;
        const choices = v.calendars.filter((v) => calendarIds.includes(v.id));
        setCalendars(choices);
        setDraft((d) => ({
          ...d,
          calendarId: event
            ? d.calendarId
            : choices.some((c) => c.id === d.calendarId && c.writable)
              ? d.calendarId
              : (choices.find((c) => c.writable)?.id ?? ''),
        }));
        if (!event && !choices.some((c) => c.writable))
          setError(
            '연결된 캘린더에 일정을 추가할 수 없습니다. Briefing Lab 설정에서 쓰기 가능한 캘린더를 선택해주세요.',
          );
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoadingCalendars(false);
      });
    return () => c.abort();
  }, [routineId, catalogRevision]);
  const update = (patch: Partial<EventDraft>) => {
    setDraft({ ...draft, ...patch });
    setError((current) => (/권한|접근|permission/i.test(current) ? current : ''));
  };
  const prepare = async (kind: 'create' | 'update' | 'delete') => {
    if (requestLock.current || uncertainRef.current) return;
    requestLock.current = true;
    let applying = false;
    setBusy(true);
    setError('');
    try {
      if (loadingCalendars)
        throw new Error('캘린더 연결을 확인 중입니다. 잠시 후 다시 시도해주세요.');
      const data = EventDraftSchema.parse(kind === 'delete' && event ? eventDraft(event) : draft);
      if (!calendars.some((c) => c.id === data.calendarId && c.writable))
        throw new Error('쓰기 가능한 캘린더를 선택해주세요.');
      const result = await sourceRequest<{ action: { id: string } }>(
        '/calendar/prepare',
        {
          routineId,
          kind,
          draft: data,
          eventId: event?.id ?? null,
          fingerprint: event?.fingerprint ?? null,
        },
        new AbortController().signal,
      );
      applying = true;
      await sourceRequest(
        '/calendar/apply',
        { routineId, actionId: result.action.id, direct: true },
        new AbortController().signal,
      );
      onSaved();
      onClose();
    } catch (e) {
      if (applying) {
        uncertainRef.current = true;
        setWriteUncertain(true);
      }
      setError(
        e instanceof Error
          ? e.name === 'ZodError'
            ? '제목·캘린더·시작/종료 시각을 확인해주세요.'
            : e.message
          : '일정 처리 실패',
      );
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  };
  const readonly =
    Boolean(event?.hasAttendees || event?.contentTruncated) ||
    Boolean(event && !calendars.some((c) => c.id === event.calendarId && c.writable));
  return (
    <div className="briefing-modal-backdrop">
      <section
        className="briefing-event-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={event ? '일정 상세 및 수정' : '새 일정'}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault();
            onClose();
          }
          if (e.key === 'Tab') {
            const elements = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
              ),
            );
            const at = elements.indexOf(document.activeElement as HTMLElement);
            if (e.shiftKey && at <= 0) {
              e.preventDefault();
              elements.at(-1)?.focus();
            } else if (!e.shiftKey && at === elements.length - 1) {
              e.preventDefault();
              elements[0]?.focus();
            }
          }
        }}
      >
        <header>
          <h2>
            {heading ?? (event ? '일정 상세' : '새 일정')} <small>Apple Calendar</small>
          </h2>
          <button
            type="button"
            className="briefing-icon-button"
            disabled={busy}
            aria-label="일정 창 닫기"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="briefing-event-fields">
          {loadingCalendars && (
            <p role="status" className="briefing-event-notice">
              쓰기 가능한 캘린더를 확인 중입니다…
            </p>
          )}
          {notice && <p className="briefing-event-notice">{notice}</p>}
          <label className="briefing-field">
            <span>제목</span>
            <input
              autoFocus
              value={draft.title}
              maxLength={300}
              disabled={busy || readonly}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <label className="briefing-field">
            <span>캘린더</span>
            <select
              value={draft.calendarId}
              disabled={busy || loadingCalendars || Boolean(event)}
              onChange={(e) => update({ calendarId: e.target.value })}
            >
              <option value="">캘린더 선택</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.writable}>
                  {c.name} · {c.source}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.allDay}
              disabled={busy || readonly}
              onChange={(e) => update(setEventAllDay(draft, e.target.checked))}
            />{' '}
            하루 종일
          </label>
          <div className="briefing-form-grid">
            {(['start', 'end'] as const).map((k) => (
              <label className="briefing-field" key={k}>
                <span>
                  {k === 'start'
                    ? '시작'
                    : draft.allDay
                      ? '종료 (이 날짜는 포함하지 않음)'
                      : '종료'}
                </span>
                <input
                  type={draft.allDay ? 'date' : 'datetime-local'}
                  value={calendarLocal(draft[k], draft.timeZone, draft.allDay)}
                  disabled={busy || readonly}
                  onChange={(e) => {
                    try {
                      update({ [k]: calendarInstant(e.target.value, draft.timeZone) });
                    } catch {
                      setError(
                        '유효한 날짜를 입력하세요. DST 전환으로 중복/존재하지 않는 시각은 선택할 수 없습니다.',
                      );
                    }
                  }}
                />
              </label>
            ))}
          </div>
          <small>
            시간대: {draft.timeZone}
            {event?.recurring ? ' · 반복 일정의 이번 발생만 변경합니다.' : ''}
          </small>
          <label className="briefing-field">
            <span>장소</span>
            <input
              value={draft.location}
              maxLength={1000}
              disabled={busy || readonly}
              onChange={(e) => update({ location: e.target.value })}
            />
          </label>
          <label className="briefing-field">
            <span>메모</span>
            <textarea
              value={draft.notes}
              maxLength={6000}
              disabled={busy || readonly}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </label>
          <label className="briefing-field">
            <span>알림</span>
            <select
              value={draft.alarmMinutes ?? 'none'}
              disabled={busy || readonly}
              onChange={(e) =>
                update({ alarmMinutes: e.target.value === 'none' ? null : Number(e.target.value) })
              }
            >
              <option value="none">없음</option>
              {[
                ...new Set([
                  0,
                  5,
                  10,
                  15,
                  30,
                  60,
                  1440,
                  ...(draft.alarmMinutes === null ? [] : [draft.alarmMinutes]),
                ]),
              ].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? '일정 시작 시' : `${m}분 전`}
                </option>
              ))}
            </select>
            <small>
              Apple Calendar의 OS 알림 설정을 따릅니다. 기존 알림을 바꾸면 알림 목록을 이 선택으로
              대체합니다.
            </small>
          </label>
          {readonly && (
            <p role="note">
              초대 참석자가 있거나 읽기 전용/긴 내용이 생략된 일정입니다. 변경은 Apple Calendar에서
              확인해주세요.
            </p>
          )}
          {writeUncertain && (
            <div role="status" className="briefing-event-notice">
              처리 결과를 확인하지 못했습니다. 중복 실행하지 말고 최신 Calendar를 확인해주세요.
              <button
                type="button"
                onClick={() => {
                  onSaved();
                  onClose();
                }}
              >
                최신 일정 불러오기
              </button>
            </div>
          )}
          {error && (
            <p className="briefing-alert" role="alert">
              {error}
            </p>
          )}
          {/권한|접근|permission/i.test(error) && (
            <CalendarAccessRepair onRestored={() => setCatalogRevision((n) => n + 1)} />
          )}
        </div>
        <footer>
          <button type="button" className="briefing-button" disabled={busy} onClick={onClose}>
            닫기
          </button>
          {!readonly && (
            <>
              {event && (
                <button
                  type="button"
                  className="briefing-text-button danger"
                  disabled={busy || loadingCalendars || writeUncertain}
                  onClick={() => void prepare('delete')}
                >
                  삭제
                </button>
              )}
              <button
                type="button"
                className="briefing-primary"
                disabled={
                  busy ||
                  writeUncertain ||
                  loadingCalendars ||
                  !calendars.some((c) => c.id === draft.calendarId && c.writable)
                }
                onClick={() => void prepare(event ? 'update' : 'create')}
              >
                {busy ? '처리 중…' : event ? '저장' : '일정 생성'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
