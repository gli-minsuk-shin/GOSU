import { z } from 'zod';
import type { ProjectRecord, WorkspaceTask } from '../../shared/workspace-contracts';
import type { SearchHit } from '../../shared/search-contracts';
import type { ProjectChatEvent } from '../../shared/project-chat-contracts';
import type { BriefingNotificationSnapshot } from '../../../../briefing-lab/src/briefing-notifications';

export type NotificationTarget =
  | Readonly<{ kind: 'task'; projectId: string; taskId: string; dueDate: string }>
  | Readonly<{ kind: 'chat'; projectId: string; sessionId: string }>
  | Readonly<{ kind: 'connections' }>
  | Readonly<{ kind: 'briefing-settings' }>
  | Readonly<{ kind: 'notes'; projectId: string }>
  | Readonly<{ kind: 'workspace' }>;
export type PersonalNotificationTarget =
  | Readonly<{ kind: 'calendar'; eventId: string; start: string; routineId: string }>
  | Readonly<{ kind: 'briefing'; routineId: string; runId: string }>;
export type WorkspaceNotification = Readonly<{
  id: string;
  kind: 'deadline' | 'chat' | 'issue' | 'calendar' | 'briefing';
  title: string;
  detail: string;
  projectName?: string;
  severity: 'info' | 'warning' | 'error';
  target: NotificationTarget | PersonalNotificationTarget;
  calendarPhase?: 'upcoming' | 'tomorrow' | 'today' | 'soon' | 'ongoing';
  calendarStart?: string;
  calendarTimeZone?: string;
  allDay?: boolean;
  emailCounts?: {
    total: number;
    important: number;
    unclassified: number;
    partial: boolean;
    state?: 'ready' | 'empty' | 'failed' | 'disabled';
  };
  dueDate?: string;
  daysUntilDue?: number;
  phase?: 'upcoming' | 'tomorrow' | 'today' | 'overdue';
  chatStatus?: 'complete' | 'failed' | 'interrupted';
  createdAt?: string;
}>;
export type WorkspaceNoticeIssue = Readonly<{
  key: string;
  title: string;
  detail: string;
  revision?: string;
  target: NotificationTarget;
  severity: 'warning' | 'error';
}>;
const MarkSchema = z
  .object({ read: z.boolean(), dismissed: z.boolean(), updatedAt: z.string().datetime() })
  .strict();
const ChatNoticeSchema = z
  .object({
    projectId: z.string().uuid(),
    sessionId: z.string().uuid(),
    turnId: z.string().min(1).max(256),
    status: z.enum(['complete', 'failed', 'interrupted']),
    receivedAt: z.string().datetime(),
  })
  .strict();
const InboxSchema = z
  .object({
    schemaVersion: z.literal(1),
    marks: z
      .record(z.string().min(1).max(512), MarkSchema)
      .refine((v) => Object.keys(v).length <= 20000),
    events: z.array(ChatNoticeSchema).max(100),
  })
  .strict();
export type NotificationInbox = z.infer<typeof InboxSchema>;
export type NotificationMarkAction = 'read' | 'unread' | 'dismiss' | 'restore';
export const NOTIFICATION_STORAGE_KEY = 'gosu:notification-inbox:v1';
export const emptyNotificationInbox = (): NotificationInbox => ({
  schemaVersion: 1,
  marks: {},
  events: [],
});
export const readChatNotificationOnArrival = (
  sourceKey: string,
  visibleKey: string | null,
  focused: boolean,
  status: string,
) => status === 'complete' && focused && sourceKey === visibleKey;
export const parseNotificationInbox = (value: unknown): NotificationInbox | null => {
  const result = InboxSchema.safeParse(value);
  return result.success ? result.data : null;
};

export function notificationLocalDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dayNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed / 86_400_000
    : null;
}
/** A UI identity fingerprint, not a security hash. Raw warning text is never persisted. */
function fingerprint(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
export function chatNotificationId(
  event: Pick<NotificationInbox['events'][number], 'projectId' | 'sessionId' | 'turnId'>,
) {
  return `chat:${event.projectId}:${event.sessionId}:${fingerprint(event.turnId)}`;
}
export function recordChatNotification(
  inbox: NotificationInbox,
  event: Extract<ProjectChatEvent, { type: 'turn.completed' }>,
  now: string,
  read = false,
): NotificationInbox {
  const entry = ChatNoticeSchema.parse({
    projectId: event.projectId,
    sessionId: event.sessionId,
    turnId: event.turnId,
    status: event.status,
    receivedAt: now,
  });
  const id = chatNotificationId(entry);
  if (inbox.events.some((item) => chatNotificationId(item) === id)) return inbox;
  const next = { ...inbox, events: [...inbox.events, entry].slice(-100) };
  return read ? markNotifications(next, [id], 'read', now) : next;
}
export function markNotifications(
  inbox: NotificationInbox,
  ids: readonly string[],
  action: NotificationMarkAction,
  now: string,
): NotificationInbox {
  const marks = { ...inbox.marks };
  for (const id of ids) {
    if (!id || id.length > 512) continue;
    const previous = marks[id] ?? { read: false, dismissed: false, updatedAt: now };
    marks[id] = {
      read: action === 'read' ? true : action === 'unread' ? false : previous.read,
      dismissed: action === 'dismiss' ? true : action === 'restore' ? false : previous.dismissed,
      updatedAt: now,
    };
  }
  const newest = Object.entries(marks)
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
    .slice(0, 20000);
  return { ...inbox, marks: Object.fromEntries(newest) };
}

export function buildWorkspaceNotifications(
  input: Readonly<{
    projects: readonly ProjectRecord[];
    tasks: readonly WorkspaceTask[];
    inbox: NotificationInbox;
    issues?: readonly WorkspaceNoticeIssue[];
    now?: Date;
    personal?: BriefingNotificationSnapshot | undefined;
  }>,
): WorkspaceNotification[] {
  const now = input.now ?? new Date();
  const today = dayNumber(notificationLocalDate(now));
  if (today === null) return [];
  const projects = new Map(
    input.projects.filter((p) => !p.archivedAt && !p.trashedAt).map((p) => [p.id, p]),
  );
  const deadlines = input.tasks.flatMap((task): WorkspaceNotification[] => {
    const project = projects.get(task.projectId);
    const due = task.dueDate ? dayNumber(task.dueDate) : null;
    if (!project || task.archivedAt || task.status === 'done' || due === null || due - today > 7)
      return [];
    const days = due - today;
    const phase =
      days < 0 ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'upcoming';
    return [
      {
        id: `deadline:${task.projectId}:${task.id}:${task.dueDate}:${phase}`,
        kind: 'deadline',
        title: task.title,
        detail: '',
        projectName: project.name,
        severity: days < 0 ? 'error' : days <= 1 ? 'warning' : 'info',
        target: { kind: 'task', projectId: project.id, taskId: task.id, dueDate: task.dueDate! },
        dueDate: task.dueDate!,
        daysUntilDue: days,
        phase,
      },
    ];
  });
  const events = input.inbox.events.flatMap((event): WorkspaceNotification[] => {
    const project = projects.get(event.projectId);
    const elapsed = now.getTime() - Date.parse(event.receivedAt);
    if (!project || elapsed < 0 || elapsed > 30 * 86_400_000) return [];
    return [
      {
        id: chatNotificationId(event),
        kind: 'chat',
        title:
          event.status === 'complete'
            ? 'Project Chat response ready'
            : event.status === 'failed'
              ? 'Project Chat needs attention'
              : 'Project Chat was stopped',
        detail: '',
        projectName: project.name,
        severity:
          event.status === 'failed' ? 'error' : event.status === 'interrupted' ? 'warning' : 'info',
        target: { kind: 'chat', projectId: event.projectId, sessionId: event.sessionId },
        chatStatus: event.status,
        createdAt: event.receivedAt,
      },
    ];
  });
  const issues = (input.issues ?? [])
    .filter((issue) => !('projectId' in issue.target) || projects.has(issue.target.projectId))
    .map((issue): WorkspaceNotification => ({
      id: `issue:${issue.key}:${fingerprint(issue.revision ?? issue.detail)}`,
      kind: 'issue',
      title: issue.title,
      detail: issue.detail,
      severity: issue.severity,
      target: issue.target,
    }));
  const priority = (item: WorkspaceNotification) =>
    item.severity === 'error'
      ? 0
      : item.severity === 'warning'
        ? 1
        : item.kind === 'deadline' || item.kind === 'calendar'
          ? 2
          : 3;
  return [
    ...new Map(
      [...issues, ...deadlines, ...events, ...personalNotifications(input.personal, now)].map(
        (item) => [item.id, item],
      ),
    ).values(),
  ].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      (a.calendarStart
        ? Date.parse(a.calendarStart)
        : a.dueDate
          ? Date.parse(a.dueDate)
          : Number.MAX_SAFE_INTEGER) -
        (b.calendarStart
          ? Date.parse(b.calendarStart)
          : b.dueDate
            ? Date.parse(b.dueDate)
            : Number.MAX_SAFE_INTEGER) ||
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
      a.id.localeCompare(b.id),
  );
}
export function personalNotifications(
  snapshot: BriefingNotificationSnapshot | undefined,
  now: Date,
): WorkspaceNotification[] {
  if (!snapshot) return [];
  const calendar = snapshot.calendar.flatMap((event): WorkspaceNotification[] => {
    const start = Date.parse(event.start),
      end = Date.parse(event.end),
      clock = now.getTime();
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= clock ||
      start - clock > 8 * 86400000
    )
      return [];
    let days: number;
    try {
      const day = (date: Date) =>
        dayNumber(
          event.allDay
            ? new Intl.DateTimeFormat('en-CA', {
                timeZone: event.timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(date)
            : notificationLocalDate(date),
        );
      days = day(new Date(start))! - day(now)!;
    } catch {
      return [];
    }
    if (days > 7) return [];
    const phase =
      !event.allDay && start <= clock
        ? 'ongoing'
        : !event.allDay &&
            event.alarmMinutes !== null &&
            start - clock <= event.alarmMinutes * 60000
          ? 'soon'
          : days <= 0
            ? 'today'
            : days === 1
              ? 'tomorrow'
              : 'upcoming';
    return [
      {
        id: `calendar:${event.id}:${phase}`,
        kind: 'calendar',
        title: event.title,
        detail: '',
        target: {
          kind: 'calendar',
          eventId: event.id,
          start: event.start,
          routineId: event.routineId,
        },
        calendarPhase: phase,
        calendarStart: event.start,
        calendarTimeZone: event.timeZone,
        allDay: event.allDay,
        severity: phase === 'soon' || phase === 'ongoing' ? 'warning' : 'info',
        createdAt: event.start,
      },
    ];
  });
  const briefings = snapshot.briefings
    .filter(
      (event) =>
        Date.parse(event.createdAt) <= now.getTime() &&
        now.getTime() - Date.parse(event.createdAt) <= 30 * 86400000,
    )
    .map((event): WorkspaceNotification => ({
      id: `briefing:${event.id}`,
      kind: 'briefing',
      title: event.partial ? 'Briefing updated; some sources need checking' : 'New briefing ready',
      detail: '',
      severity: event.importantEmails > 0 || event.partial ? 'warning' : 'info',
      createdAt: event.createdAt,
      target: { kind: 'briefing', routineId: event.routineId, runId: event.runId },
      emailCounts: {
        state: event.emailSourceState,
        total: event.newEmails,
        important: event.importantEmails,
        unclassified: event.unclassifiedEmails,
        partial: event.partial,
      },
    }));
  return [...calendar, ...briefings];
}
export function notificationCounts(
  items: readonly WorkspaceNotification[],
  inbox: NotificationInbox,
) {
  const visible = items.filter((item) => !inbox.marks[item.id]?.dismissed);
  const unread = visible.filter((item) => !inbox.marks[item.id]?.read).length;
  return {
    total: visible.length,
    unread,
    hidden: items.length - visible.length,
    badge: unread > 99 ? '99+' : String(unread),
  };
}
export function taskNotificationSearchHit(
  target: NotificationTarget | PersonalNotificationTarget,
  projects: readonly ProjectRecord[],
  tasks: readonly WorkspaceTask[],
): SearchHit | null {
  if (target.kind !== 'task') return null;
  const project = projects.find((p) => p.id === target.projectId && !p.archivedAt && !p.trashedAt);
  const task = tasks.find(
    (t) =>
      t.id === target.taskId &&
      t.projectId === target.projectId &&
      !t.archivedAt &&
      t.status !== 'done' &&
      t.dueDate === target.dueDate,
  );
  if (!project || !task) return null;
  return {
    id: `notification:${task.id}`,
    category: 'board',
    projectId: project.id,
    projectName: project.name,
    title: task.title,
    snippet: '',
    updatedAt: task.updatedAt,
    matchedFields: ['dueDate'],
    target: { kind: 'board-task', taskId: task.id },
  };
}
