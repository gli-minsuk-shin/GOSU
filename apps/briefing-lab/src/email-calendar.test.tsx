import { afterEach, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { defaultAssistantPreferences } from '@gosu/briefing-core';
import { EmailCalendarButton, emailCalendarDraft } from './email-calendar';
import { CalendarEventEditor } from './calendar-event-editor';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
vi.mock('./calendar-event-editor', () => ({ CalendarEventEditor: () => null }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('uses explicit deadline dates, handles Korean times, and does not invent a time for date-only deadlines', () => {
  const due = emailCalendarDraft('Submit', '2026년 9월 16일 오후 3시 30분까지 회신');
  expect(due?.draft.start).toBe('2026-09-16T06:30:00Z');
  expect(due?.draft.allDay).toBe(false);
  expect(emailCalendarDraft('Submit', '9/16 신청 마감', '2026-09-11T00:00:00Z')?.draft.allDay).toBe(
    true,
  );
  expect(emailCalendarDraft('Submit', '9/16 신청 마감')).toBeNull();
  expect(emailCalendarDraft('Submit', '2026-02-30 신청 마감')).toBeNull();
  expect(emailCalendarDraft('Submit', '곧 마감입니다')).toBeNull();
  expect(emailCalendarDraft('Submit', '2026-09-16 수신')).toBeNull();
});
it('does not borrow a later event time for an earlier deadline', () => {
  expect(emailCalendarDraft('Submit', '2026-09-16 마감, 9/20 오후 3시 행사')?.draft.allDay).toBe(
    true,
  );
});
it('opens an editable confirmation without writing an event and blocks duplicate clicks after success', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    preferences: { ...defaultAssistantPreferences(), calendarRead: true, calendarIds: ['c'] },
  });
  let ui: ReturnType<typeof create>;
  await act(() => {
    ui = create(<EmailCalendarButton routineId="r" title="Submit" text="2026-09-16 신청 마감" />);
  });
  expect(sourceRequest).not.toHaveBeenCalled();
  await act(() => ui!.root.findByType('button').props.onClick({ preventDefault() {} }));
  const editor = ui!.root.findByType(CalendarEventEditor);
  expect(editor.props.heading).toBe('일정으로 등록할까요?');
  expect(editor.props.initial.notes).toContain('신청 마감');
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/assistant/settings/get']);
  await act(() => editor.props.onSaved());
  expect(ui!.root.findByType('button').props.disabled).toBe(true);
  await act(() => ui!.unmount());
});
