import { afterEach, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { defaultAssistantPreferences } from '@gosu/briefing-core';
import { EmailCalendarButton, emailCalendarDraft } from './email-calendar';
import { CalendarEventEditor } from './calendar-event-editor';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
vi.mock('./calendar-event-editor', () => ({ CalendarEventEditor: () => null }));
vi.mock('./briefing-todo-button', () => ({ BriefingTodoButton: () => null }));
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
it('does not call the LLM or invent today when older summaries lack a prepared event', async () => {
  vi.mocked(sourceRequest).mockResolvedValue({
    preferences: { ...defaultAssistantPreferences(), calendarRead: true, calendarIds: ['c'] },
  });
  let ui!: ReturnType<typeof create>;
  await act(() => {
    ui = create(<EmailCalendarButton routineId="r" title="일정" text="시간 미확인" />);
  });
  await act(() => ui.root.findByType('button').props.onClick({ preventDefault() {} }));
  expect(ui.root.findAllByType(CalendarEventEditor)).toHaveLength(0);
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/assistant/settings/get']);
  expect(ui.root.findByProps({ role: 'alert' }).children.join('')).toContain(
    '저장된 일정 초안이 없습니다',
  );
  await act(() => ui.unmount());
});
it('opens an editable confirmation without writing an event and blocks duplicate clicks after success', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest)
    .mockResolvedValueOnce({
      preferences: { ...defaultAssistantPreferences(), calendarRead: true, calendarIds: ['c'] },
    })
    .mockResolvedValueOnce({
      ...emailCalendarDraft('Submit', '2026-09-16 신청 마감')!,
      notice: 'AI가 이메일에서 추출한 일정입니다.',
    });
  let ui: ReturnType<typeof create>;
  await act(() => {
    ui = create(
      <EmailCalendarButton
        routineId="r"
        title="Submit"
        text="2026-09-16 신청 마감"
        preparedActions={{
          event: {
            ...emailCalendarDraft('Submit', '2026-09-16 신청 마감')!.draft,
            start: '2026-09-20T14:30:00Z',
            end: '2026-09-20T15:30:00Z',
            allDay: false,
            timeZone: 'Asia/Seoul',
            location: '회의실',
            evidenceQuote: '2026-09-16 신청 마감',
            notice: '저장된 일정',
          },
          task: null,
        }}
      />,
    );
  });
  expect(sourceRequest).not.toHaveBeenCalled();
  await act(() => ui!.root.findByType('button').props.onClick({ preventDefault() {} }));
  const editor = ui!.root.findByType(CalendarEventEditor);
  expect(editor.props.heading).toBe('일정으로 등록할까요?');
  expect(editor.props.initial.notes).toContain('신청 마감');
  expect(editor.props.initial).toMatchObject({
    start: '2026-09-20T14:30:00Z',
    end: '2026-09-20T15:30:00Z',
    allDay: false,
    timeZone: 'Asia/Seoul',
    location: '회의실',
  });
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/assistant/settings/get']);
  await act(() => editor.props.onSaved());
  expect(ui!.root.findByType('button').props.disabled).toBe(true);
  await act(() => ui!.unmount());
});
it('opens a draft saved one day off on the weekday its evidence names', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // An earlier test leaves a queued response behind; start from a clean mock.
  vi.mocked(sourceRequest)
    .mockReset()
    .mockResolvedValueOnce({
      preferences: { ...defaultAssistantPreferences(), calendarRead: true, calendarIds: ['c'] },
    });
  let ui: ReturnType<typeof create>;
  const saved = {
    title: '저녁 식사',
    start: '2026-09-20T19:00:00+09:00',
    end: '2026-09-20T21:00:00+09:00',
    allDay: false,
    timeZone: 'Asia/Seoul',
    location: '',
    notes: '',
    alarmMinutes: null,
    evidenceQuote: 'See you soon on Saturday.',
    notice: '시간 확인 필요',
  };
  await act(() => {
    ui = create(
      <EmailCalendarButton
        routineId="r"
        title="Dinner"
        text="See you soon on Saturday."
        preparedActions={{ event: saved, task: null }}
      />,
    );
  });
  await act(() => ui!.root.findByType('button').props.onClick({ preventDefault() {} }));
  const editor = ui!.root.findByType(CalendarEventEditor);
  expect(editor.props.initial).toMatchObject({
    start: '2026-09-19T10:00:00Z',
    end: '2026-09-19T12:00:00Z',
  });
  expect(editor.props.notice).toContain('토요일');
  // The saved summary itself is not rewritten by opening it.
  expect(saved.start).toBe('2026-09-20T19:00:00+09:00');
});
