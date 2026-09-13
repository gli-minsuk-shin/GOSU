import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import FullCalendar from '@fullcalendar/react';
import { CalendarView } from './calendar-view';
import { initialRealWorkspace } from './workspace-defaults';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { sourceRequest } from './live-client';
import { CalendarEventEditor } from './calendar-event-editor';
vi.mock('./calendar-event-editor', () => ({ CalendarEventEditor: () => null }));
vi.mock('@fullcalendar/react', () => ({ default: () => null }));
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('opens the exact fetched occurrence at the requested date, never a same-title event', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-11T00:00:00Z').routines[0]!;
  const event = {
    id: 'c',
    title: 'Meeting',
    start: '2026-10-30T09:00:00+09:00',
    end: '2026-10-30T10:00:00+09:00',
    allDay: false,
    timeZone: 'Asia/Seoul',
    location: '',
    hasAttendees: false,
  };
  vi.mocked(sourceRequest).mockResolvedValue({ events: [event], limited: false });
  const props = {
    routine: {
      ...routine,
      live: {
        ...defaultLiveSettings(),
        assistant: { ...defaultAssistantPreferences(), calendarRead: true, calendarIds: ['cal'] },
      },
    },
    onSettings: vi.fn(),
  };
  await act(() => {
    ui = create(<CalendarView {...props} target={{ id: 'c', start: event.start, requestId: 1 }} />);
  });
  expect(ui.root.findByType(FullCalendar).props.initialDate).toBe(event.start);
  await act(() =>
    ui.root
      .findByType(FullCalendar)
      .props.datesSet({ startStr: '2026-10-01', endStr: '2026-11-01' }),
  );
  expect(ui.root.findByType(CalendarEventEditor).props.event.id).toBe('c');
  await act(() =>
    ui.update(
      <CalendarView
        key="missing"
        {...props}
        target={{ id: 'not-c', start: event.start, requestId: 2 }}
      />,
    ),
  );
  await act(() =>
    ui.root
      .findByType(FullCalendar)
      .props.datesSet({ startStr: '2026-10-01', endStr: '2026-11-01' }),
  );
  expect(ui.root.findAllByType(CalendarEventEditor)).toHaveLength(0);
  expect(ui.root.findByProps({ role: 'alert' }).children.join('')).toContain('찾을 수 없습니다');
});
it('constrains month events to equal-height week cells and exposes overflow in a popover without dropping events', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-11T00:00:00Z').routines[0]!;
  const events = Array.from({ length: 14 }, (_, i) => ({
    id: `event-${i}`,
    title: 'Fixture',
    start: '2026-10-30T09:00:00+09:00',
    end: '2026-10-30T10:00:00+09:00',
    allDay: false,
    timeZone: 'Asia/Seoul',
    location: '',
    hasAttendees: false,
  }));
  vi.mocked(sourceRequest).mockResolvedValue({ events, limited: false });
  await act(() => {
    ui = create(
      <CalendarView
        routine={{
          ...routine,
          live: {
            ...defaultLiveSettings(),
            assistant: { ...defaultAssistantPreferences(), calendarRead: true, calendarIds: ['c'] },
          },
        }}
        onSettings={vi.fn()}
      />,
    );
  });
  await act(() =>
    ui.root
      .findByType(FullCalendar)
      .props.datesSet({ startStr: '2026-09-27', endStr: '2026-11-08' }),
  );
  const props = ui.root.findByType(FullCalendar).props;
  expect(props.height).toBe('100%');
  expect(props.views.dayGridMonth).toMatchObject({
    fixedWeekCount: true,
    dayMaxEvents: true,
    moreLinkClick: 'popover',
  });
  expect(props.events).toHaveLength(14);
  expect(props.views.timeGridWeek).toBeUndefined();
  expect(props.views.timeGridDay).toBeUndefined();
});
