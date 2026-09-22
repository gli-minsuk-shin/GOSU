import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BriefingTodoButton } from './briefing-todo-button';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
vi.mock('./desktop-bridge', () => ({ isGosuEmbedded: () => false }));
let view: ReactTestRenderer | undefined;
const task = {
  title: '검토 의견 보내기',
  notes: '자료 검토 후 의견 전달',
  dueDate: '2026-09-20',
  dueAt: '2026-09-20T04:30:00Z',
  timeZone: 'Asia/Seoul',
  evidenceQuote: '의견 전달',
  deadlineQuote: '9월 20일',
  notice: '명시된 마감일',
};
const options = { projects: [], authorized: false, lists: [], defaultListId: '' };
it('uses the saved default for each task and does not authorize again or substitute a deleted list', async () => {
  vi.mocked(sourceRequest).mockResolvedValue({
    ...options,
    authorized: true,
    defaultListId: 'other',
    lists: [
      { id: 'saved', writable: true, name: 'Saved', source: 'iCloud' },
      { id: 'other', writable: true, name: 'Other', source: 'iCloud' },
    ],
    reminderDefaults: { enabled: true, listId: 'saved' },
  });
  await open();
  expect(view!.root.findByProps({ 'aria-label': '미리 알림 목록' }).props.value).toBe('saved');
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/todo/options']);
  await act(() => view!.root.findByProps({ 'aria-label': '닫기' }).props.onClick());
  vi.mocked(sourceRequest).mockResolvedValue({
    ...options,
    authorized: true,
    defaultListId: 'other',
    lists: [{ id: 'other', writable: true, name: 'Other', source: 'iCloud' }],
    reminderDefaults: { enabled: true, listId: 'saved' },
  });
  await act(() => view!.root.findByType('button').props.onClick());
  expect(view!.root.findByProps({ 'aria-label': '미리 알림 목록' }).props.value).toBe('');
  expect(view!.root.findByProps({ className: 'briefing-primary' }).props.disabled).toBe(true);
});
const button = (label: string) =>
  view!.root.findAllByType('button').find((b) => b.children.join('') === label)!;
async function open(prepared = true) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await act(() => {
    view = create(
      <BriefingTodoButton
        routineId="r"
        title="Re: source"
        text="이메일 내용"
        {...(prepared ? { preparedTask: task } : {})}
      />,
    );
  });
  await act(() => view!.root.findByType('button').props.onClick());
}
afterEach(async () => {
  await act(() => view?.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it('reuses prepared fields and saves a personal GOSU task without Reminders permission or an LLM call', async () => {
  vi.mocked(sourceRequest)
    .mockResolvedValueOnce(options)
    .mockResolvedValueOnce({ taskId: 't', reminderState: 'skipped', message: 'Saved' });
  await open();
  expect(view!.root.findByProps({ maxLength: 240 }).props.value).toBe(task.title);
  expect(view!.root.findByProps({ type: 'time' }).props.value).toBe('13:30');
  expect(view!.root.findByProps({ className: 'briefing-primary' }).props.disabled).toBe(false);
  await act(() => button('GOSU 할 일에 추가').props.onClick());
  expect(sourceRequest).toHaveBeenLastCalledWith(
    '/todo/create',
    expect.objectContaining({
      projectId: null,
      title: task.title,
      dueDate: task.dueDate,
      dueAt: task.dueAt,
      reminderListId: null,
    }),
  );
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual([
    '/todo/options',
    '/todo/create',
  ]);
  expect(view!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
});
it.each([
  ['00:15', '2026-09-19T15:15:00Z'],
  ['', undefined],
])('edits or clears saved time without AI: %s', async (clock, dueAt) => {
  vi.mocked(sourceRequest)
    .mockResolvedValueOnce(options)
    .mockResolvedValueOnce({ taskId: 't', reminderState: 'skipped', message: 'Saved' });
  await open();
  await act(() =>
    view!.root.findByProps({ type: 'time' }).props.onChange({ target: { value: clock } }),
  );
  await act(() => button('GOSU 할 일에 추가').props.onClick());
  const request = vi.mocked(sourceRequest).mock.calls.at(-1)!;
  expect(request[0]).toBe('/todo/create');
  expect((request[1] as { dueAt?: string }).dueAt).toBe(dueAt);
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual([
    '/todo/options',
    '/todo/create',
  ]);
});

it('exports to an authorized writable list and prevents duplicate creates', async () => {
  let finish!: (v: unknown) => void;
  vi.mocked(sourceRequest)
    .mockResolvedValueOnce({
      ...options,
      authorized: true,
      lists: [{ id: 'l', name: 'Tasks', source: 'iCloud', writable: true }],
      defaultListId: 'l',
    })
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
  await open();
  const save = button('GOSU · 미리 알림에 추가');
  await act(() => {
    save.props.onClick();
    save.props.onClick();
  });
  expect(vi.mocked(sourceRequest).mock.calls.filter((c) => c[0] === '/todo/create')).toHaveLength(
    1,
  );
  expect(sourceRequest).toHaveBeenLastCalledWith(
    '/todo/create',
    expect.objectContaining({ reminderListId: 'l' }),
  );
  await act(() => finish({ taskId: 't', reminderState: 'created', message: 'Saved' }));
  expect(view!.root.findAllByType('button')[0]!.props.disabled).toBe(true);
});
it('requests Apple permission only explicitly and preserves edits after denial while allowing local save', async () => {
  vi.mocked(sourceRequest)
    .mockResolvedValueOnce(options)
    .mockRejectedValueOnce(Error('미리 알림 권한 필요'));
  await open();
  await act(() =>
    view!.root.findByProps({ maxLength: 240 }).props.onChange({ target: { value: '수정한 제목' } }),
  );
  await act(() =>
    view!.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }),
  );
  expect(view!.root.findByProps({ className: 'briefing-primary' }).props.disabled).toBe(true);
  await act(() => button('미리 알림 접근 허용').props.onClick());
  expect(view!.root.findByProps({ maxLength: 240 }).props.value).toBe('수정한 제목');
  expect(view!.root.findByProps({ className: 'briefing-primary' }).props.disabled).toBe(false);
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual([
    '/todo/options',
    '/todo/authorize',
  ]);
});
it('old summaries remain editable with an unknown deadline, without triggering drafting', async () => {
  vi.mocked(sourceRequest).mockResolvedValue(options);
  await open(false);
  expect(view!.root.findByProps({ type: 'date' }).props.value).toBe('');
  expect(view!.root.findByProps({ type: 'time' }).props.value).toBe('');
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/todo/options']);
});
it('reopening preserves edited fields without another model call', async () => {
  vi.mocked(sourceRequest).mockResolvedValue(options);
  await open();
  await act(() =>
    view!.root.findByProps({ maxLength: 240 }).props.onChange({ target: { value: '수정한 제목' } }),
  );
  await act(() =>
    view!.root.findByProps({ type: 'time' }).props.onChange({ target: { value: '16:45' } }),
  );
  await act(() => view!.root.findByProps({ 'aria-label': '닫기' }).props.onClick());
  await act(() => view!.root.findByType('button').props.onClick());
  expect(view!.root.findByProps({ maxLength: 240 }).props.value).toBe('수정한 제목');
  expect(view!.root.findByProps({ type: 'time' }).props.value).toBe('16:45');
  expect(vi.mocked(sourceRequest).mock.calls.every((c) => c[0] === '/todo/options')).toBe(true);
});
