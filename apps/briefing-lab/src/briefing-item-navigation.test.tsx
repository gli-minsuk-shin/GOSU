import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, create } from 'react-test-renderer';
import { BriefingHistoryFeed } from './briefing-history-view';
import { BriefingSnapshotSchema } from './briefing-history-snapshot';
import { parseBriefingItemTarget } from './briefing-item-navigation';
afterEach(() => vi.unstubAllGlobals());
const event = {
  id: 'event-a',
  title: 'Meeting',
  start: '2026-09-11T00:00:00Z',
  end: '2026-09-11T01:00:00Z',
  timeZone: 'Asia/Seoul',
  allDay: false,
  location: '',
};
it('retains native event identity in new snapshots and accepts legacy records without an ID', () => {
  expect(BriefingSnapshotSchema.shape.calendar.parse([event])?.[0]?.id).toBe('event-a');
  const { id: _id, ...legacy } = event;
  expect(BriefingSnapshotSchema.shape.calendar.safeParse([legacy]).success).toBe(true);
});
it('keeps history scroll anchors separate from native Calendar IDs', () => {
  const source = readFileSync(new URL('./briefing-history-view.tsx', import.meta.url), 'utf8');
  expect(source).toContain("jumpId: JSON.stringify([h.id, 'calendar', index])");
  expect(source).not.toContain("id: JSON.stringify([h.id, 'calendar', index])");
});
it('rejects arbitrary commands, malformed times and oversized identities', () => {
  expect(parseBriefingItemTarget({ kind: 'task', id: 't' })).toEqual({ kind: 'task', id: 't' });
  for (const value of [
    { kind: 'delete', id: 't' },
    { kind: 'task', id: 't', command: 'delete' },
    { kind: 'calendar', id: 'c', start: 'invalid' },
    { kind: 'task', id: 'a'.repeat(301) },
  ])
    expect(parseBriefingItemTarget(value)).toBeNull();
});
it('posts exact item references on explicit clicks without writing Calendar or tasks', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const postMessage = vi.fn();
  vi.stubGlobal('window', { location: { search: '?embedded=gosu' }, parent: { postMessage } });
  let ui: ReturnType<typeof create>;
  await act(() => {
    ui = create(
      <BriefingHistoryFeed
        history={[
          {
            id: 'history-a',
            routineId: 'r',
            createdAt: event.start,
            kind: 'briefing',
            answer: '',
            private: true,
            items: [],
            snapshot: {
              collectedAt: event.start,
              timeZone: 'Asia/Seoul',
              routineName: 'Research',
              sources: [],
              calendar: [event],
              todos: {
                fetchedAt: event.start,
                limited: false,
                items: [{ id: 'task-a', title: 'Task', projectName: 'P', status: 'planned' }],
              },
            },
          },
        ]}
      />,
    );
  });
  expect(postMessage).not.toHaveBeenCalled();
  await act(() => ui!.root.findByProps({ title: 'Meeting 상세로 이동' }).props.onClick());
  expect(postMessage).toHaveBeenLastCalledWith(
    {
      type: 'gosu-briefing-open-item',
      target: { kind: 'calendar', id: event.id, start: event.start },
    },
    '*',
  );
  expect(JSON.stringify(ui!.toJSON())).toContain('Calendar에서 열기 ↗');
  await act(() => ui!.root.findByProps({ title: 'Calendar에서 일정 열기' }).props.onClick());
  expect(postMessage).toHaveBeenLastCalledWith(
    {
      type: 'gosu-briefing-open-item',
      target: { kind: 'calendar', id: event.id, start: event.start },
    },
    '*',
  );
  await act(() => ui!.root.findByProps({ title: 'To-do list에서 할 일 열기' }).props.onClick());
  expect(postMessage).toHaveBeenLastCalledWith(
    { type: 'gosu-briefing-open-item', target: { kind: 'task', id: 'task-a' } },
    '*',
  );
  await act(() => ui!.unmount());
});
