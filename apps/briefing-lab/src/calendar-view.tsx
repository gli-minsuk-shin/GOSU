import { useCallback, useEffect, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGrid from '@fullcalendar/react/daygrid';
import timeGrid from '@fullcalendar/react/timegrid';
import interaction from '@fullcalendar/react/interaction';
import theme from '@fullcalendar/react/themes/monarch';
import ko from '@fullcalendar/react/locales/ko';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/monarch/theme.css';
import '@fullcalendar/react/themes/monarch/palettes/green.css';
import type { BriefingRoutine } from '@gosu/briefing-core';
import type { CalendarEvent, EventDraft } from './workspace-contracts';
import { BriefingAgendaDays } from './briefing-agenda-days';
import { sourceRequest } from './live-client';
import { CalendarEventEditor } from './calendar-event-editor';
import { calendarInstant, calendarLocal, initialEvent } from './calendar-dates';
import { CalendarAccessRepair } from './calendar-access-repair';

export function CalendarView({
  routine,
  onSettings,
  target,
}: {
  routine: BriefingRoutine;
  onSettings: () => void;
  target?: { id: string; start: string; requestId: number } | null;
}) {
  const prefs = routine.live?.assistant;
  const [range, setRange] = useState({ start: '', end: '' }),
    [events, setEvents] = useState<CalendarEvent[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ initial: EventDraft; event?: CalendarEvent } | null>(null);
  const rangeChanged = useCallback((info: { startStr: string; endStr: string }) => {
    setRange((current) =>
      current.start === info.startStr && current.end === info.endStr
        ? current
        : { start: info.startStr, end: info.endStr },
    );
  }, []);
  useEffect(() => {
    if (!prefs?.calendarRead || !range.start) return;
    const c = new AbortController();
    setBusy(true);
    setError('');
    void sourceRequest<{ events: CalendarEvent[]; limited: boolean }>(
      '/calendar/events',
      { routineId: routine.id, ...range },
      c.signal,
    )
      .then((v) => {
        if (!c.signal.aborted) {
          setEvents(v.events);
          if (target) {
            const event = v.events.find(
              (e) => e.id === target.id && Date.parse(e.start) === Date.parse(target.start),
            );
            if (event) setEditor({ event, initial: event });
            else setError('이 일정은 변경·삭제되었거나 현재 허용된 캘린더에서 찾을 수 없습니다.');
          }
          if (v.limited) setError('최대 500개까지만 표시합니다. 기간을 좁혀주세요.');
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setEvents([]);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [routine.id, routine.updatedAt, range.start, range.end, revision, prefs?.calendarRead]);
  if (!prefs?.calendarRead)
    return (
      <div className="briefing-empty">
        <h2>Apple Calendar 연결</h2>
        <p>
          설정에서 캘린더를 선택하고 조회를 켜면 월·주·일 보기와 오늘/내일 일정을 사용할 수
          있습니다.
        </p>
        <button type="button" className="briefing-primary" onClick={onSettings}>
          Calendar 설정
        </button>
      </div>
    );
  const openNew = (start?: string, end?: string, allDay = false) =>
    setEditor({
      initial: initialEvent(
        routine.schedule.timeZone,
        prefs.calendarIds[0] ?? '',
        start,
        end,
        allDay,
      ),
    });
  const stageMove = (info: {
    event: { id: string; startStr: string; endStr: string; allDay: boolean };
    revert: () => void;
  }) => {
    const original = events.find((e) => e.id === info.event.id);
    const next = { ...info.event };
    info.revert();
    if (original)
      setEditor({
        event: original,
        initial: {
          ...original,
          start: calendarInstant(next.startStr, original.timeZone),
          end: calendarInstant(next.endStr, original.timeZone),
          allDay: next.allDay,
        },
      });
  };
  return (
    <div className="briefing-calendar-view">
      <div className="briefing-live-actions briefing-calendar-actions">
        <h1>Apple Calendar</h1>
        <input
          aria-label="일정 검색"
          placeholder="현재 기간 일정 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="briefing-button"
          disabled={busy}
          onClick={() => setRevision((r) => r + 1)}
        >
          새로고침
        </button>
        <button type="button" className="briefing-primary" onClick={() => openNew()}>
          ＋ 일정
        </button>
        <small>
          {busy ? '일정 조회 중…' : `${events.length}개 · ${routine.schedule.timeZone}`}
        </small>
      </div>
      {error && (
        <p role="alert" className="briefing-alert">
          {error}
        </p>
      )}
      {/권한|접근|permission/i.test(error) && (
        <CalendarAccessRepair onRestored={() => setRevision((n) => n + 1)} />
      )}
      <div className="briefing-calendar-grid">
        <FullCalendar
          plugins={[dayGrid, timeGrid, interaction, theme]}
          locale={ko}
          initialView="dayGridMonth"
          {...(target ? { initialDate: target.start } : {})}
          timeZone={routine.schedule.timeZone}
          height="100%"
          views={{
            dayGridMonth: {
              fixedWeekCount: true,
              dayMaxEvents: true,
              moreLinkClick: 'popover',
            },
          }}
          headerToolbarClass="briefing-calendar-toolbar"
          toolbarTitleClass="briefing-calendar-title"
          headerToolbar={{
            start: 'prev,next today',
            center: 'title',
            end: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          nowIndicator
          selectable
          editable
          datesSet={rangeChanged}
          select={(info) => openNew(info.startStr, info.endStr, info.allDay)}
          events={events
            .filter((e) => `${e.title} ${e.location}`.toLowerCase().includes(query.toLowerCase()))
            .map((e) => ({
              id: e.id,
              title: e.title,
              start: e.allDay ? calendarLocal(e.start, e.timeZone, true) : e.start,
              end: e.allDay ? calendarLocal(e.end, e.timeZone, true) : e.end,
              allDay: e.allDay,
              editable: !e.hasAttendees,
              color: '#527d0b',
            }))}
          eventClick={(info) => {
            const event = events.find((e) => e.id === info.event.id);
            if (event) setEditor({ event, initial: event });
          }}
          eventDrop={stageMove}
          eventResize={stageMove}
        />
      </div>
      {editor && (
        <CalendarEventEditor
          routineId={routine.id}
          initial={editor.initial}
          {...(editor.event ? { event: editor.event } : {})}
          calendarIds={prefs.calendarIds}
          onClose={() => setEditor(null)}
          onSaved={() => setRevision((n) => n + 1)}
        />
      )}
    </div>
  );
}
export function CalendarAgenda({
  routine,
  onEvents,
  receiptId,
  navigationScope,
}: {
  routine: BriefingRoutine;
  onEvents?: (events: CalendarEvent[]) => void;
  receiptId?: string;
  navigationScope?: string;
}) {
  const [events, setEvents] = useState<CalendarEvent[]>([]),
    [status, setStatus] = useState('오늘·내일 일정 조회 중…');
  const [referenceAt, setReferenceAt] = useState(() => new Date().toISOString());
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!routine.live?.assistant?.calendarRead) return;
    const c = new AbortController();
    const requestedAt = new Date().toISOString();
    setEvents([]);
    onEvents?.([]);
    setLoaded(false);
    setStatus('오늘·내일 일정 조회 중…');
    void sourceRequest<{ events: CalendarEvent[]; historyWarning?: string; referenceAt?: string }>(
      '/calendar/agenda',
      { routineId: routine.id, ...(receiptId ? { receiptId } : {}) },
      c.signal,
    )
      .then((v) => {
        if (!c.signal.aborted) {
          setEvents(v.events);
          setReferenceAt(v.referenceAt ?? requestedAt);
          setLoaded(true);
          onEvents?.(v.events);
          setStatus(
            v.historyWarning ?? (v.events.length ? '' : '오늘·내일 등록된 일정이 없습니다.'),
          );
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setStatus(e.message);
      });
    return () => c.abort();
  }, [routine.id, routine.updatedAt, onEvents, receiptId]);
  if (!routine.live?.assistant?.calendarRead) return null;
  return (
    <section className="briefing-agenda">
      {status && <p role="status">{status}</p>}
      <BriefingAgendaDays
        events={events}
        referenceAt={referenceAt}
        timeZone={routine.schedule.timeZone}
        navigationScope={navigationScope}
        showEmpty={loaded}
      />
    </section>
  );
}
