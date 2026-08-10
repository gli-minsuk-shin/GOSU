import {
  WORKSPACE_TASK_STATUSES,
  resolveWorkspaceBoardSettings,
  type ProjectRecord,
  type WorkspaceTask,
  type WorkspaceTaskPriority,
  type WorkspaceTaskStatus,
} from '../../shared/workspace-contracts';

export type KanbanDueFilter = 'all' | 'overdue' | 'today' | 'this_week' | 'no_due_date';
export type KanbanPriorityFilter = 'all' | 'none' | WorkspaceTaskPriority;
export type KanbanTaskMode = 'active' | 'archived';

export type KanbanFilters = Readonly<{
  query: string;
  priority: KanbanPriorityFilter;
  label: string;
  due: KanbanDueFilter;
  mode: KanbanTaskMode;
}>;

export const EMPTY_KANBAN_FILTERS: KanbanFilters = {
  query: '',
  priority: 'all',
  label: '',
  due: 'all',
  mode: 'active',
};

export function resolveKanbanColumns(project: ProjectRecord) {
  const board = resolveWorkspaceBoardSettings(project.board);
  return board.columnOrder.map((status) => ({
    status,
    label: board.columnLabels[status],
    wipLimit: board.wipLimits[status],
  }));
}

export function groupTodoTasksByStatus(project: ProjectRecord, tasks: readonly WorkspaceTask[]) {
  return resolveKanbanColumns(project).map((column) => ({
    ...column,
    tasks: tasks.filter((task) => task.status === column.status),
  }));
}

export function resolveTodoReopenStatus(project: ProjectRecord): WorkspaceTaskStatus {
  return (
    resolveKanbanColumns(project).find((column) => column.status !== 'done')?.status ?? 'backlog'
  );
}

export function filterKanbanTasks(
  tasks: readonly WorkspaceTask[],
  filters: KanbanFilters,
  today = localDateString(),
) {
  const normalizedQuery = normalizeSearch(filters.query);
  const normalizedLabel = normalizeSearch(filters.label);
  return tasks.filter((task) => {
    if (filters.mode === 'active' ? task.archivedAt !== undefined : task.archivedAt === undefined) {
      return false;
    }
    if (
      normalizedQuery &&
      !normalizeSearch(`${task.title}\n${task.description ?? ''}`).includes(normalizedQuery)
    ) {
      return false;
    }
    if (filters.priority === 'none' && task.priority !== undefined) return false;
    if (
      filters.priority !== 'all' &&
      filters.priority !== 'none' &&
      task.priority !== filters.priority
    ) {
      return false;
    }
    if (
      normalizedLabel &&
      !(task.labels ?? []).some((label) => normalizeSearch(label) === normalizedLabel)
    ) {
      return false;
    }
    return matchesDueFilter(task.dueDate, filters.due, today);
  });
}

export function projectTaskLabels(tasks: readonly WorkspaceTask[]) {
  const labels = new Map<string, string>();
  for (const task of tasks) {
    for (const label of task.labels ?? []) {
      const normalized = normalizeSearch(label);
      if (normalized && !labels.has(normalized)) labels.set(normalized, label);
    }
  }
  return [...labels.values()].sort((left, right) => left.localeCompare(right));
}

export function kanbanColumnProgress(
  tasks: readonly WorkspaceTask[],
  status: WorkspaceTaskStatus,
  wipLimit: number | null,
) {
  const activeTasks = tasks.filter(
    (task) => task.archivedAt === undefined && task.status === status,
  );
  return {
    activeTasks,
    activeCount: activeTasks.length,
    exceeded: wipLimit !== null && activeTasks.length > wipLimit,
  } as const;
}

export function activeKanbanFilterCount(filters: KanbanFilters) {
  return [
    filters.query.trim().length > 0,
    filters.priority !== 'all',
    filters.label.length > 0,
    filters.due !== 'all',
  ].filter(Boolean).length;
}

export function parseTaskLabels(value: string) {
  const labels = new Map<string, string>();
  for (const part of value.split(',')) {
    const label = part.trim();
    const normalized = normalizeSearch(label);
    if (normalized && !labels.has(normalized)) labels.set(normalized, label);
  }
  return [...labels.values()];
}

export function canDropKanbanTask(input: {
  projectId: string;
  taskId: string | null;
  targetStatus: WorkspaceTaskStatus;
  tasks: readonly WorkspaceTask[];
}) {
  if (!input.taskId || !WORKSPACE_TASK_STATUSES.includes(input.targetStatus)) return null;
  const task = input.tasks.find((candidate) => candidate.id === input.taskId);
  if (
    !task ||
    task.projectId !== input.projectId ||
    task.archivedAt !== undefined ||
    task.status === input.targetStatus
  ) {
    return null;
  }
  return task;
}

export function taskDueState(dueDate: string | undefined, today = localDateString()) {
  if (!dueDate) return 'none' as const;
  if (dueDate < today) return 'overdue' as const;
  if (dueDate === today) return 'today' as const;
  return 'upcoming' as const;
}

export function localDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function matchesDueFilter(dueDate: string | undefined, filter: KanbanDueFilter, today: string) {
  if (filter === 'all') return true;
  if (filter === 'no_due_date') return dueDate === undefined;
  if (!dueDate) return false;
  if (filter === 'overdue') return dueDate < today;
  if (filter === 'today') return dueDate === today;
  const todayOrdinal = dateOrdinal(today);
  const dueOrdinal = dateOrdinal(dueDate);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = todayOrdinal - ((weekday + 6) % 7);
  return dueOrdinal >= monday && dueOrdinal <= monday + 6;
}

function dateOrdinal(value: string) {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000;
}

function normalizeSearch(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}
