import {
  DEFAULT_WORKSPACE_BOARD_SETTINGS,
  WORKSPACE_TASK_STATUSES,
  resolveWorkspaceBoardSettings,
  type ProjectRecord,
  type WorkspaceTask,
  type WorkspaceTaskStatus,
} from '../../shared/workspace-contracts';
import { EMPTY_KANBAN_FILTERS, filterKanbanTasks, type KanbanFilters } from './kanban-board-model';

export const WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP = 40;
export const WORKSPACE_GLOBAL_BOARD_SHOW_MORE_STEP = 40;

export const WORKSPACE_GLOBAL_BOARD_COLUMNS = Object.freeze(
  WORKSPACE_TASK_STATUSES.map((status) =>
    Object.freeze({
      status,
      label: DEFAULT_WORKSPACE_BOARD_SETTINGS.columnLabels[status],
    }),
  ),
);

export type WorkspaceGlobalBoardTask = Readonly<{
  task: WorkspaceTask;
  project: ProjectRecord;
  statusLabel: string;
}>;

export type WorkspaceGlobalBoardFilters = KanbanFilters &
  Readonly<{
    /** A null project ID means every active project, including locally hidden projects. */
    projectId: string | null;
  }>;

export const EMPTY_WORKSPACE_GLOBAL_BOARD_FILTERS: WorkspaceGlobalBoardFilters = Object.freeze({
  ...EMPTY_KANBAN_FILTERS,
  projectId: null,
});

export type WorkspaceGlobalBoardVisibleLimits = Readonly<
  Partial<Record<WorkspaceTaskStatus, number>>
>;

export type WorkspaceGlobalBoardGroupWindow<T> = Readonly<{
  items: readonly T[];
  totalCount: number;
  visibleCount: number;
  remainingCount: number;
  hasMore: boolean;
  nextVisibleLimit: number;
}>;

export type WorkspaceGlobalBoardColumn = Readonly<{
  status: WorkspaceTaskStatus;
  label: string;
  tasks: readonly WorkspaceGlobalBoardTask[];
  totalCount: number;
  visibleCount: number;
  remainingCount: number;
  hasMore: boolean;
  nextVisibleLimit: number;
}>;

export type WorkspaceGlobalProjectWipInfo = Readonly<{
  projectId: string;
  status: WorkspaceTaskStatus;
  statusLabel: string;
  activeCount: number;
  wipLimit: number | null;
  exceeded: boolean;
}>;

/**
 * Returns every domain-active project. Local sidebar hiding is deliberately not an input, so it
 * cannot make work disappear from the all-project view.
 */
export function activeWorkspaceGlobalProjects(projects: readonly ProjectRecord[]) {
  return projects
    .filter((project) => project.archivedAt === undefined && project.trashedAt === undefined)
    .sort(compareCreatedEntities);
}

/**
 * Joins Tasks to their authoritative active Project owner. Tasks for archived, trashed, or unknown
 * projects are excluded. Task archive state is retained so active and Task-trash projections can
 * share the same joined records.
 */
export function joinWorkspaceGlobalBoardTasks(
  projects: readonly ProjectRecord[],
  tasks: readonly WorkspaceTask[],
): readonly WorkspaceGlobalBoardTask[] {
  const activeProjects = new Map(
    activeWorkspaceGlobalProjects(projects).map((project) => [project.id, project]),
  );

  return tasks
    .flatMap((task) => {
      const project = activeProjects.get(task.projectId);
      return project
        ? [
            {
              task,
              project,
              statusLabel: resolveWorkspaceGlobalStatusLabel(project, task.status),
            },
          ]
        : [];
    })
    .sort((left, right) => compareRecentlyChangedTasks(left.task, right.task));
}

export function filterWorkspaceGlobalBoardTasks(
  tasks: readonly WorkspaceGlobalBoardTask[],
  filters: WorkspaceGlobalBoardFilters,
  today?: string,
): readonly WorkspaceGlobalBoardTask[] {
  const projectTasks =
    filters.projectId === null
      ? tasks
      : tasks.filter(({ project }) => project.id === filters.projectId);
  const matchingTasks = new Set(
    filterKanbanTasks(
      projectTasks.map(({ task }) => task),
      filters,
      today,
    ),
  );
  return projectTasks.filter(({ task }) => matchingTasks.has(task));
}

export function sliceWorkspaceGlobalBoardGroup<T>(
  items: readonly T[],
  requestedLimit = WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP,
): WorkspaceGlobalBoardGroupWindow<T> {
  const visibleLimit = boundedGroupLimit(requestedLimit, items.length);
  const visibleItems = items.slice(0, visibleLimit);
  const remainingCount = items.length - visibleItems.length;
  return {
    items: visibleItems,
    totalCount: items.length,
    visibleCount: visibleItems.length,
    remainingCount,
    hasMore: remainingCount > 0,
    nextVisibleLimit: nextWorkspaceGlobalBoardGroupLimit(visibleItems.length, items.length),
  };
}

export function nextWorkspaceGlobalBoardGroupLimit(currentLimit: number, totalCount: number) {
  const boundedTotal = nonnegativeInteger(totalCount);
  if (boundedTotal === 0) return 0;
  const boundedCurrent = boundedGroupLimit(currentLimit, boundedTotal);
  return Math.min(boundedTotal, boundedCurrent + WORKSPACE_GLOBAL_BOARD_SHOW_MORE_STEP);
}

export function buildWorkspaceGlobalBoardColumns(
  tasks: readonly WorkspaceGlobalBoardTask[],
  visibleLimits: WorkspaceGlobalBoardVisibleLimits = {},
): readonly WorkspaceGlobalBoardColumn[] {
  return WORKSPACE_GLOBAL_BOARD_COLUMNS.map((column) => {
    const group = tasks.filter(({ task }) => task.status === column.status);
    const window = sliceWorkspaceGlobalBoardGroup(group, visibleLimits[column.status]);
    return {
      ...column,
      tasks: window.items,
      totalCount: window.totalCount,
      visibleCount: window.visibleCount,
      remainingCount: window.remainingCount,
      hasMore: window.hasMore,
      nextVisibleLimit: window.nextVisibleLimit,
    };
  });
}

export function resolveWorkspaceGlobalInitialStatus(project: ProjectRecord): WorkspaceTaskStatus {
  return resolveWorkspaceBoardSettings(project.board).columnOrder[0] ?? 'backlog';
}

export function resolveWorkspaceGlobalReopenStatus(project: ProjectRecord): WorkspaceTaskStatus {
  return (
    resolveWorkspaceBoardSettings(project.board).columnOrder.find((status) => status !== 'done') ??
    'backlog'
  );
}

export function resolveWorkspaceGlobalStatusLabel(
  project: ProjectRecord,
  status: WorkspaceTaskStatus,
) {
  return resolveWorkspaceBoardSettings(project.board).columnLabels[status];
}

/** WIP is project-scoped and always counts the owning project's full active Task set. */
export function workspaceGlobalProjectWipInfo(
  project: ProjectRecord,
  tasks: readonly WorkspaceTask[],
  status: WorkspaceTaskStatus,
): WorkspaceGlobalProjectWipInfo {
  const board = resolveWorkspaceBoardSettings(project.board);
  const activeCount = tasks.filter(
    (task) =>
      task.projectId === project.id && task.status === status && task.archivedAt === undefined,
  ).length;
  const wipLimit = board.wipLimits[status];
  return {
    projectId: project.id,
    status,
    statusLabel: board.columnLabels[status],
    activeCount,
    wipLimit,
    exceeded: wipLimit !== null && activeCount > wipLimit,
  };
}

function compareCreatedEntities(
  left: Readonly<{ createdAt: string; id: string }>,
  right: Readonly<{ createdAt: string; id: string }>,
) {
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
}

function compareRecentlyChangedTasks(left: WorkspaceTask, right: WorkspaceTask) {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);
  return updatedAtOrder === 0 ? right.id.localeCompare(left.id) : updatedAtOrder;
}

function boundedGroupLimit(requestedLimit: number, totalCount: number) {
  const boundedTotal = nonnegativeInteger(totalCount);
  if (boundedTotal === 0) return 0;
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) {
    return Math.min(boundedTotal, WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP);
  }
  return Math.min(boundedTotal, Math.trunc(requestedLimit));
}

function nonnegativeInteger(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}
