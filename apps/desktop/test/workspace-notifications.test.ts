import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildWorkspaceNotifications,
  emptyNotificationInbox,
  markNotifications,
  notificationCounts,
  parseNotificationInbox,
  readChatNotificationOnArrival,
  recordChatNotification,
  taskNotificationSearchHit,
  personalNotifications,
} from '../src/renderer/src/workspace-notifications';
import type { ProjectRecord, WorkspaceTask } from '../src/shared/workspace-contracts';
import type { BriefingNotificationSnapshot } from '../../briefing-lab/src/briefing-notifications';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-09-08T03:00:00.000Z';
it('links personal deadline notifications to the global task rather than a fabricated project', () => {
  const task: WorkspaceTask = {
    id: id(1),
    projectId: null,
    title: 'Personal deadline',
    status: 'planned',
    dueDate: '2026-09-14',
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const notices = buildWorkspaceNotifications({
    projects: [],
    tasks: [task],
    inbox: emptyNotificationInbox(),
    now: new Date('2026-09-14T03:00:00Z'),
  });
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({
    projectName: '개인 할 일',
    target: { kind: 'personal-task', taskId: task.id },
  });
});
it('combines live calendar phases and completed briefing counts without repeating the same alert', () => {
  const at = new Date('2026-09-14T02:40:00Z');
  const personal: BriefingNotificationSnapshot = {
    calendarState: 'ready',
    calendarLimited: false,
    calendar: [
      {
        id: 'event-1',
        calendarId: 'cal',
        routineId: 'r',
        title: 'Research meeting',
        start: '2026-09-14T03:00:00Z',
        end: '2026-09-14T04:00:00Z',
        allDay: false,
        timeZone: 'Asia/Seoul',
        alarmMinutes: 30,
      },
    ],
    briefings: [
      {
        id: id(30),
        routineId: 'r',
        runId: id(31),
        createdAt: '2026-09-14T02:35:00Z',
        newEmails: 3,
        emailSourceState: 'ready',
        importantEmails: 1,
        unclassifiedEmails: 1,
        newPapers: 2,
        partial: true,
      },
    ],
  };
  const first = buildWorkspaceNotifications({
    projects: [],
    tasks: [],
    inbox: emptyNotificationInbox(),
    personal,
    now: at,
  });
  expect(first).toHaveLength(2);
  expect(first.find((n) => n.kind === 'calendar')).toMatchObject({
    calendarPhase: 'soon',
    target: { kind: 'calendar', eventId: 'event-1', routineId: 'r' },
  });
  expect(first.find((n) => n.kind === 'briefing')).toMatchObject({
    emailCounts: { total: 3, important: 1, unclassified: 1, partial: true },
    target: { kind: 'briefing', runId: id(31) },
  });
  const inbox = markNotifications(
    emptyNotificationInbox(),
    first.map((n) => n.id),
    'read',
    at.toISOString(),
  );
  expect(
    notificationCounts(
      buildWorkspaceNotifications({ projects: [], tasks: [], inbox, personal, now: at }),
      inbox,
    ).unread,
  ).toBe(0);
  const later = personalNotifications(personal, new Date('2026-09-14T03:05:00Z'));
  expect(later.find((n) => n.kind === 'calendar')?.calendarPhase).toBe('ongoing');
  expect(notificationCounts(later, inbox).unread).toBe(1);
  expect(
    personalNotifications({ ...personal, calendar: [] }, at).some((n) => n.kind === 'calendar'),
  ).toBe(false);
  expect(
    personalNotifications(personal, new Date('2026-09-14T04:01:00Z')).some(
      (n) => n.kind === 'calendar',
    ),
  ).toBe(false);
});
it('handles all-day calendar dates across daylight saving changes without 24-hour assumptions', () => {
  const records = personalNotifications(
    {
      calendarState: 'ready',
      calendarLimited: false,
      briefings: [],
      calendar: [
        {
          id: 'dst',
          calendarId: 'cal',
          routineId: 'r',
          title: 'All day',
          start: '2026-03-08T05:00:00Z',
          end: '2026-03-09T04:00:00Z',
          timeZone: 'America/New_York',
          allDay: true,
          alarmMinutes: null,
        },
      ],
    },
    new Date('2026-03-07T23:00:00Z'),
  );
  expect(records[0]?.calendarPhase).toBe('tomorrow');
  expect(records[0]?.allDay).toBe(true);
});
const now = new Date(2026, 8, 8, 12);
const project: ProjectRecord = {
  id: id(1),
  name: 'Research A',
  slug: 'research-a',
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
const task = (n: number, dueDate?: string, patch: Partial<WorkspaceTask> = {}): WorkspaceTask => ({
  id: id(n),
  projectId: project.id,
  title: `Task ${n}`,
  status: 'planned',
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  ...(dueDate ? { dueDate } : {}),
  ...patch,
});
const build = (tasks: readonly WorkspaceTask[], inbox = emptyNotificationInbox(), at = now) =>
  buildWorkspaceNotifications({ projects: [project], tasks, inbox, now: at });

describe('Workspace notification facts and read state', () => {
  it('refreshes the observation clock on a newly completed turn, not only on the minute timer', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(
      /recordNotificationTurn\([\s\S]*?\);\s*setNotificationNow\(new Date\(\)\);/u,
    );
    expect(source).toMatch(
      /onRefresh: \(\) => \{\s*setNotificationNow\(new Date\(\)\);\s*void personalNotifications.refresh\(\);/u,
    );
  });
  it('includes only incomplete active task deadlines through the next seven calendar days', () => {
    const tasks = [
      task(2, '2026-09-07'),
      task(3, '2026-09-08'),
      task(4, '2026-09-09'),
      task(5, '2026-09-15'),
      task(6, '2026-09-16'),
      task(7),
      task(8, '2026-09-08', { status: 'done' }),
      task(9, '2026-09-08', { archivedAt: stamp }),
      task(10, '2026-09-08', { projectId: id(99) }),
      task(11, '2026-02-30'),
    ];
    const before = structuredClone(tasks);
    const items = build(tasks);
    expect(items.map((item) => item.phase)).toEqual(['overdue', 'today', 'tomorrow', 'upcoming']);
    expect(items.map((item) => item.daysUntilDue)).toEqual([-1, 0, 1, 7]);
    expect(items.every((item) => item.dueDate?.length === 10)).toBe(true);
    expect(tasks).toEqual(before);
    expect(notificationCounts(items, emptyNotificationInbox())).toEqual({
      total: 4,
      unread: 4,
      hidden: 0,
      badge: '4',
    });
  });
  it.each(['archivedAt', 'trashedAt'] as const)(
    'excludes tasks from a project with %s',
    (field) => {
      expect(
        buildWorkspaceNotifications({
          projects: [{ ...project, [field]: stamp }],
          tasks: [task(2, '2026-09-08')],
          inbox: emptyNotificationInbox(),
          now,
        }),
      ).toEqual([]);
    },
  );
  it('hides resolved tasks and re-arms only a changed date or urgency phase', () => {
    const tasks = [task(2, '2026-09-08')];
    const today = build(tasks);
    const inbox = markNotifications(
      emptyNotificationInbox(),
      today.map((item) => item.id),
      'read',
      stamp,
    );
    expect(notificationCounts(build(tasks, inbox), inbox).unread).toBe(0);
    expect(notificationCounts(build(tasks, inbox, new Date(2026, 8, 9, 12)), inbox).unread).toBe(1);
    expect(notificationCounts(build([task(2, '2026-09-10')], inbox), inbox).unread).toBe(1);
    expect(build([task(2, '2026-09-08', { status: 'done' })], inbox)).toEqual([]);
    expect(build([task(2, undefined)], inbox)).toEqual([]);
    const overdue = build(tasks, inbox, new Date(2026, 8, 9, 12));
    const read = markNotifications(
      inbox,
      overdue.map((item) => item.id),
      'read',
      stamp,
    );
    expect(notificationCounts(build(tasks, read, new Date(2026, 8, 10, 12)), read).unread).toBe(0);
  });
  it('marks read/unread, hides and restores without changing the task', () => {
    const tasks = [task(2, '2026-09-08')];
    const items = build(tasks);
    const ids = items.map((item) => item.id);
    let inbox = markNotifications(emptyNotificationInbox(), ids, 'read', stamp);
    expect(notificationCounts(items, inbox).unread).toBe(0);
    inbox = markNotifications(inbox, ids, 'unread', stamp);
    expect(notificationCounts(items, inbox).unread).toBe(1);
    inbox = markNotifications(inbox, ids, 'dismiss', stamp);
    expect(notificationCounts(items, inbox)).toMatchObject({ total: 0, unread: 0, hidden: 1 });
    inbox = markNotifications(inbox, ids, 'restore', stamp);
    expect(notificationCounts(items, inbox).unread).toBe(1);
    expect(tasks[0]?.status).toBe('planned');
    expect(parseNotificationInbox(JSON.parse(JSON.stringify(inbox)))).toEqual(inbox);
    expect(JSON.stringify(inbox)).not.toContain('Task 2');
  });
  it('caps only the badge label and marks a large current set all read', () => {
    const items = build(Array.from({ length: 2500 }, (_, i) => task(i + 2, '2026-09-08')));
    const inbox = markNotifications(
      emptyNotificationInbox(),
      items.map((item) => item.id),
      'read',
      stamp,
    );
    expect(notificationCounts(items, emptyNotificationInbox()).badge).toBe('99+');
    expect(notificationCounts(items, inbox).unread).toBe(0);
    expect(parseNotificationInbox(inbox)).not.toBeNull();
  });
  it('records completion metadata once, scoped by project and session, without response content', () => {
    const event = {
      type: 'turn.completed' as const,
      projectId: project.id,
      sessionId: id(90),
      turnId: 'provider-turn',
      status: 'complete' as const,
    };
    const inbox = recordChatNotification(emptyNotificationInbox(), event, stamp);
    expect(recordChatNotification(inbox, event, stamp)).toBe(inbox);
    const other = recordChatNotification(inbox, { ...event, sessionId: id(91) }, stamp);
    expect(other.events).toHaveLength(2);
    expect(build([], other)).toHaveLength(2);
    expect(build([], other, new Date(2026, 9, 10, 12))).toEqual([]);
    expect(Object.keys(inbox.events[0]!)).toEqual([
      'projectId',
      'sessionId',
      'turnId',
      'status',
      'receivedAt',
    ]);
  });
  it('counts failures as unread and auto-reads only a focused, visible completed chat', () => {
    expect(readChatNotificationOnArrival('p:s', 'p:s', true, 'complete')).toBe(true);
    for (const [source, visible, focused, status] of [
      ['p:s', 'p:t', true, 'complete'],
      ['p:s', 'q:s', true, 'complete'],
      ['p:s', 'p:s', false, 'complete'],
      ['p:s', 'p:s', true, 'failed'],
    ] as const)
      expect(readChatNotificationOnArrival(source, visible, focused, status)).toBe(false);
    const event = {
      type: 'turn.completed' as const,
      projectId: project.id,
      sessionId: id(90),
      turnId: 'turn',
      status: 'failed' as const,
    };
    const inbox = recordChatNotification(emptyNotificationInbox(), event, stamp);
    expect(build([], inbox)[0]).toMatchObject({ severity: 'error', chatStatus: 'failed' });
    expect(notificationCounts(build([], inbox), inbox).unread).toBe(1);
  });
  it('bounds retained chat events and rejects unsupported storage payloads', () => {
    let inbox = emptyNotificationInbox();
    for (let i = 0; i < 120; i++)
      inbox = recordChatNotification(
        inbox,
        {
          type: 'turn.completed',
          projectId: project.id,
          sessionId: id(90),
          turnId: `turn-${i}`,
          status: 'complete',
        },
        stamp,
      );
    expect(inbox.events).toHaveLength(100);
    expect(parseNotificationInbox({ ...inbox, rawMessages: ['private'] })).toBeNull();
    expect(parseNotificationInbox({ schemaVersion: 2, marks: {}, events: [] })).toBeNull();
    expect(
      parseNotificationInbox({
        schemaVersion: 1,
        marks: {},
        events: [{ ...inbox.events[0], content: 'private' }],
      }),
    ).toBeNull();
  });
  it('keeps issue identity stable across language changes and removes resolved issues', () => {
    const issue = {
      key: 'server',
      title: 'Server connection needs attention',
      detail: 'English copy',
      revision: 'stable-code',
      target: { kind: 'connections' as const },
      severity: 'warning' as const,
    };
    const make = (detail: string) =>
      buildWorkspaceNotifications({
        projects: [project],
        tasks: [],
        inbox: emptyNotificationInbox(),
        issues: [{ ...issue, detail }],
        now,
      });
    expect(make('English copy')[0]?.id).toBe(make('한글 설명')[0]?.id);
    expect(
      buildWorkspaceNotifications({
        projects: [project],
        tasks: [],
        inbox: emptyNotificationInbox(),
        issues: [],
        now,
      }),
    ).toEqual([]);
  });
  it('navigates to exactly the current task and refuses stale or resolved targets', () => {
    const tasks = [task(2, '2026-09-08')];
    const target = build(tasks)[0]!.target;
    expect(taskNotificationSearchHit(target, [project], tasks)?.target).toEqual({
      kind: 'board-task',
      taskId: id(2),
    });
    expect(taskNotificationSearchHit(target, [project], [task(2, '2026-09-09')])).toBeNull();
    expect(
      taskNotificationSearchHit(target, [{ ...project, archivedAt: stamp }], tasks),
    ).toBeNull();
    expect(taskNotificationSearchHit(target, [project], [])).toBeNull();
  });
});
