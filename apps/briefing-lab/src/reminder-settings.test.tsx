import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ReminderSettings } from './reminder-settings';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let view: ReactTestRenderer;
afterEach(async () => {
  await act(() => view?.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it('loads saved defaults without authorizing and saves the selected list explicitly', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    authorized: true,
    lists: [{ id: 'saved', name: 'Tasks', source: 'iCloud', writable: true }],
    defaultListId: 'saved',
    projects: [],
    reminderDefaults: { enabled: true, listId: 'saved' },
  });
  await act(async () => {
    view = create(<ReminderSettings routineId="r" />);
  });
  expect(view.root.findByType('select').props.value).toBe('saved');
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/todo/options']);
  await act(() => view.root.findAllByType('button').at(-1)!.props.onClick());
  expect(sourceRequest).toHaveBeenLastCalledWith(
    '/todo/preferences',
    { routineId: 'r', enabled: true, listId: 'saved' },
    expect.any(AbortSignal),
  );
});
it('never requests macOS approval on mount and blocks export setup until permission exists', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    authorized: false,
    lists: [],
    defaultListId: '',
    projects: [],
  });
  await act(async () => {
    view = create(<ReminderSettings routineId="r" />);
  });
  await act(() => view.root.findByType('input').props.onChange({ target: { checked: true } }));
  expect(view.root.findAllByType('button').at(-1)!.props.disabled).toBe(true);
  expect(vi.mocked(sourceRequest).mock.calls.map((c) => c[0])).toEqual(['/todo/options']);
});
