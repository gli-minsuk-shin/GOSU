import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { CalendarEventEditor } from './calendar-event-editor';
import { initialEvent } from './calendar-dates';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const catalog = [
  { id: 'holiday', name: 'Holiday', source: 'Subscription', writable: false, color: '#888' },
  { id: 'personal', name: 'Personal', source: 'Local', writable: true, color: '#527d0b' },
];
const draft = {
  ...initialEvent('Asia/Seoul', 'holiday', '2026-09-12T10:00'),
  title: 'New meeting',
};
const button = (text: string) =>
  ui.root.findAllByType('button').find((b) => b.children.join('') === text)!;
it('deletes the observed event even when the edited form is incomplete', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const event = {
    ...draft,
    calendarId: 'personal',
    title: 'Original',
    id: 'e',
    fingerprint: 'f',
    hasAttendees: false,
    recurring: false,
  };
  const saved = vi.fn();
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/calendar/catalog'
      ? { calendars: catalog }
      : { action: { id: 'action' }, id: 'deleted' },
  );
  await act(() => {
    ui = create(
      <CalendarEventEditor
        routineId="r"
        initial={event}
        event={event}
        calendarIds={['personal']}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
  });
  await act(() => ui.root.findAllByType('input')[0]!.props.onChange({ target: { value: '' } }));
  await act(() => button('삭제').props.onClick());
  expect(sourceRequest).toHaveBeenCalledWith(
    '/calendar/prepare',
    expect.objectContaining({
      kind: 'delete',
      eventId: 'e',
      draft: expect.objectContaining({ title: 'Original' }),
    }),
    expect.any(AbortSignal),
  );
  expect(saved).toHaveBeenCalledOnce();
});
it('blocks duplicate clicks and uncertain-write retries even through a stale handler', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let fail!: (e: Error) => void;
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/calendar/catalog'
      ? { calendars: catalog }
      : path === '/calendar/prepare'
        ? { action: { id: 'action' } }
        : new Promise((_resolve, reject) => {
            fail = reject;
          }),
  );
  await act(() => {
    ui = create(
      <CalendarEventEditor
        routineId="r"
        initial={draft}
        calendarIds={['personal']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  });
  const submit = button('일정 생성').props.onClick;
  await act(() => {
    submit();
    submit();
  });
  expect(
    vi.mocked(sourceRequest).mock.calls.filter((c) => c[0] === '/calendar/apply'),
  ).toHaveLength(1);
  await act(() => fail(Error('timeout')));
  await act(() => submit());
  expect(
    vi.mocked(sourceRequest).mock.calls.filter((c) => c[0] === '/calendar/apply'),
  ).toHaveLength(1);
  expect(button('일정 생성').props.disabled).toBe(true);
});
it('creates in an allowed writable calendar when the first configured calendar is read-only', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onSaved = vi.fn(),
    onClose = vi.fn();
  vi.mocked(sourceRequest).mockImplementation(async (path) =>
    path === '/calendar/catalog'
      ? { calendars: catalog }
      : path === '/calendar/prepare'
        ? { action: { id: '00000000-0000-4000-8000-000000000001' } }
        : { id: 'created-event' },
  );
  await act(() => {
    ui = create(
      <CalendarEventEditor
        routineId="r"
        initial={draft}
        calendarIds={['holiday', 'personal']}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
  });
  expect(ui.root.findAllByType('select')[0]!.props.value).toBe('personal');
  expect(button('일정 생성').props.disabled).toBe(false);
  await act(() => button('일정 생성').props.onClick());
  expect(sourceRequest).toHaveBeenCalledWith(
    '/calendar/prepare',
    expect.objectContaining({
      kind: 'create',
      draft: expect.objectContaining({ calendarId: 'personal' }),
    }),
    expect.any(AbortSignal),
  );
  expect(sourceRequest).toHaveBeenLastCalledWith(
    '/calendar/apply',
    expect.objectContaining({ direct: true }),
    expect.any(AbortSignal),
  );
  expect(onSaved).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});
it('does not select an unapproved writable calendar or submit while no writable choice exists', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({ calendars: catalog });
  await act(() => {
    ui = create(
      <CalendarEventEditor
        routineId="r"
        initial={draft}
        calendarIds={['holiday']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  });
  expect(ui.root.findAllByType('select')[0]!.props.value).toBe('');
  expect(button('일정 생성').props.disabled).toBe(true);
  await act(() => button('일정 생성').props.onClick());
  expect(sourceRequest).toHaveBeenCalledTimes(1);
  expect(ui.root.findByProps({ role: 'alert' }).children.join('')).toContain('쓰기 가능한 캘린더');
});
it('disables submission until catalog loading finishes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockImplementation(() => new Promise(() => {}));
  await act(() => {
    ui = create(
      <CalendarEventEditor
        routineId="r"
        initial={draft}
        calendarIds={['holiday', 'personal']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  });
  expect(button('일정 생성').props.disabled).toBe(true);
  expect(ui.root.findByProps({ role: 'status' }).children.join('')).toContain('확인 중');
});
it('requests OS access explicitly and reloads choices without losing the typed draft or saving settings', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let reads = 0;
  vi.mocked(sourceRequest).mockImplementation(async (path) => {
    if (path === '/calendar/catalog') {
      if (++reads === 1) throw Error('macOS Calendar 접근을 허용해주세요.');
      return { calendars: catalog };
    }
    if (path === '/calendar/authorize') return { authorized: true };
    throw Error('unexpected write');
  });
  await act(() => {
    ui = create(
      <CalendarEventEditor
        routineId="r"
        initial={draft}
        calendarIds={['holiday', 'personal']}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  });
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/calendar/catalog']);
  await act(() =>
    ui.root.findByType('textarea').props.onChange({ target: { value: 'Keep these notes' } }),
  );
  await act(() => button('Calendar 접근 다시 허용').props.onClick());
  expect(ui.root.findByType('textarea').props.value).toBe('Keep these notes');
  expect(ui.root.findAllByType('select')[0]!.props.value).toBe('personal');
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual([
    '/calendar/catalog',
    '/calendar/authorize',
    '/calendar/catalog',
  ]);
});
