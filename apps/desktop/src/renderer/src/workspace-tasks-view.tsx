import { useEffect, useMemo, useState, type DragEventHandler } from 'react';

import {
  resolveWorkspaceBoardSettings,
  type CreateTaskInput,
  type ProjectRecord,
  type SetTaskArchivedInput,
  type UpdateTaskInput,
  type WorkspaceTaskPriority,
  type WorkspaceTaskStatus,
} from '../../shared/workspace-contracts';
import {
  EMPTY_KANBAN_FILTERS,
  activeKanbanFilterCount,
  parseTaskLabels,
  projectTaskLabels,
  taskDueState,
} from './kanban-board-model';
import {
  EMPTY_WORKSPACE_GLOBAL_BOARD_FILTERS,
  WORKSPACE_GLOBAL_BOARD_COLUMNS,
  WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP,
  WORKSPACE_GLOBAL_BOARD_SHOW_MORE_STEP,
  activeWorkspaceGlobalProjects,
  buildWorkspaceGlobalBoardColumns,
  filterWorkspaceGlobalBoardTasks,
  joinWorkspaceGlobalBoardTasks,
  nextWorkspaceGlobalBoardGroupLimit,
  resolveWorkspaceGlobalInitialStatus,
  resolveWorkspaceGlobalReopenStatus,
  resolveWorkspaceGlobalStatusLabel,
  sliceWorkspaceGlobalBoardGroup,
  type WorkspaceGlobalBoardFilters,
  type WorkspaceGlobalBoardTask,
  type WorkspaceGlobalBoardVisibleLimits,
} from './workspace-global-board-model';
import './workspace-tasks-view.css';

const PRIORITIES: ReadonlyArray<{ value: WorkspaceTaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

type WorkspaceTasksViewMode = 'kanban' | 'todo';

type DraggedWorkspaceTask = Readonly<{
  taskId: string;
  projectId: string;
  expectedVersion: number;
}>;

export type WorkspaceTasksViewProps = {
  projects: readonly ProjectRecord[];
  tasks: readonly WorkspaceGlobalBoardTask['task'][];
  busyAction: string | null;
  onCreateTask: (input: CreateTaskInput) => Promise<boolean>;
  onUpdateTask: (input: UpdateTaskInput) => Promise<boolean>;
  onSetTaskArchived: (input: SetTaskArchivedInput) => Promise<boolean>;
  onOpenProjectBoard?: ((projectId: string) => void) | undefined;
  initialViewMode?: WorkspaceTasksViewMode | undefined;
};

export function workspaceGlobalTaskStatusUpdate(
  item: WorkspaceGlobalBoardTask,
  status: WorkspaceTaskStatus,
): UpdateTaskInput {
  return {
    projectId: item.task.projectId,
    taskId: item.task.id,
    expectedVersion: item.task.version,
    status,
  };
}

export function workspaceGlobalTaskArchiveInput(
  item: WorkspaceGlobalBoardTask,
  archived: boolean,
): SetTaskArchivedInput {
  return {
    projectId: item.task.projectId,
    taskId: item.task.id,
    expectedVersion: item.task.version,
    archived,
  };
}

export function workspaceGlobalTaskCreateInput(
  input: Readonly<{
    projectId: string;
    title: string;
    status: WorkspaceTaskStatus;
    description: string;
    priority: WorkspaceTaskPriority | '';
    dueDate: string;
    labels: string;
  }>,
): CreateTaskInput {
  const description = input.description.trim();
  const labels = parseTaskLabels(input.labels);
  return {
    projectId: input.projectId,
    title: input.title.trim(),
    status: input.status,
    ...(description ? { description } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(labels.length ? { labels } : {}),
  };
}

export function workspaceGlobalTaskCompletionUpdate(
  item: WorkspaceGlobalBoardTask,
): UpdateTaskInput {
  return workspaceGlobalTaskStatusUpdate(
    item,
    item.task.status === 'done' ? resolveWorkspaceGlobalReopenStatus(item.project) : 'done',
  );
}

export function workspaceGlobalProjectLabels(projects: readonly ProjectRecord[]) {
  const uniqueProjects = [...new Map(projects.map((project) => [project.id, project])).values()];
  const nameCounts = new Map<string, number>();
  for (const project of uniqueProjects) {
    const key = normalizeProjectName(project.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  return new Map(
    uniqueProjects.map((project) => [
      project.id,
      (nameCounts.get(normalizeProjectName(project.name)) ?? 0) > 1
        ? `${project.name} · ${project.slug}`
        : project.name,
    ]),
  );
}

export function WorkspaceTasksView({
  projects,
  tasks,
  busyAction,
  onCreateTask,
  onUpdateTask,
  onSetTaskArchived,
  onOpenProjectBoard,
  initialViewMode = 'kanban',
}: WorkspaceTasksViewProps) {
  const activeProjects = useMemo(() => activeWorkspaceGlobalProjects(projects), [projects]);
  const joinedTasks = useMemo(
    () => joinWorkspaceGlobalBoardTasks(activeProjects, tasks),
    [activeProjects, tasks],
  );
  const projectLabels = useMemo(
    () => workspaceGlobalProjectLabels(activeProjects),
    [activeProjects],
  );
  const [viewMode, setViewMode] = useState<WorkspaceTasksViewMode>(initialViewMode);
  const [filters, setFilters] = useState<WorkspaceGlobalBoardFilters>(
    EMPTY_WORKSPACE_GLOBAL_BOARD_FILTERS,
  );
  const [visibleLimits, setVisibleLimits] = useState<WorkspaceGlobalBoardVisibleLimits>({});
  const [trashVisibleLimit, setTrashVisibleLimit] = useState<number | undefined>();
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draggedTask, setDraggedTask] = useState<DraggedWorkspaceTask | null>(null);
  const [dropStatus, setDropStatus] = useState<WorkspaceTaskStatus | null>(null);
  const filteredTasks = useMemo(
    () => filterWorkspaceGlobalBoardTasks(joinedTasks, filters),
    [filters, joinedTasks],
  );
  const columns = useMemo(
    () => buildWorkspaceGlobalBoardColumns(filteredTasks, visibleLimits),
    [filteredTasks, visibleLimits],
  );
  const availableLabels = useMemo(
    () => projectTaskLabels(joinedTasks.map(({ task }) => task)),
    [joinedTasks],
  );
  const scopedTrashCount = joinedTasks.filter(
    ({ task }) =>
      task.archivedAt !== undefined &&
      (filters.projectId === null || task.projectId === filters.projectId),
  ).length;
  const activeTaskCount = joinedTasks.filter(({ task }) => task.archivedAt === undefined).length;
  const activeFilterCount = activeKanbanFilterCount(filters) + (filters.projectId === null ? 0 : 1);
  const busy = busyAction !== null;

  useEffect(() => {
    if (
      filters.projectId !== null &&
      !activeProjects.some((project) => project.id === filters.projectId)
    ) {
      setFilters((current) => ({ ...current, projectId: null }));
    }
  }, [activeProjects, filters.projectId]);

  useEffect(() => {
    setVisibleLimits({});
    setTrashVisibleLimit(undefined);
    setEditingTaskId(null);
  }, [
    filters.due,
    filters.label,
    filters.mode,
    filters.priority,
    filters.projectId,
    filters.query,
    viewMode,
  ]);

  useEffect(() => {
    if (!draggedTask) return;
    const current = joinedTasks.find(
      ({ task }) => task.id === draggedTask.taskId && task.projectId === draggedTask.projectId,
    );
    if (!current || current.task.version !== draggedTask.expectedVersion) {
      setDraggedTask(null);
      setDropStatus(null);
    }
  }, [draggedTask, joinedTasks]);

  const archiveTask = (item: WorkspaceGlobalBoardTask) => {
    const projectLabel = projectLabels.get(item.project.id) ?? item.project.name;
    if (
      !window.confirm(
        `Delete “${item.task.title}” from ${projectLabel}? It will move to Task trash and can be restored later.`,
      )
    ) {
      return;
    }
    void onSetTaskArchived(workspaceGlobalTaskArchiveInput(item, true));
  };

  const updateAndClose = async (input: UpdateTaskInput) => {
    const saved = await onUpdateTask(input);
    if (saved) setEditingTaskId(null);
    return saved;
  };

  return (
    <section
      className="kanban-workspace workspace-tasks-view"
      aria-label="All-project task workspace"
    >
      <header className="kanban-command-bar">
        <div className="kanban-title-block">
          <span>WORKSPACE TASKS</span>
          <h2>All project tasks</h2>
          <p>
            {activeTaskCount} active {activeTaskCount === 1 ? 'task' : 'tasks'} across{' '}
            {activeProjects.length} active {activeProjects.length === 1 ? 'project' : 'projects'}
          </p>
        </div>
        <div className="kanban-view-actions">
          <div className="board-layout-switch" role="group" aria-label="Task layout">
            <button
              type="button"
              className={viewMode === 'kanban' ? 'active' : ''}
              aria-pressed={viewMode === 'kanban'}
              onClick={() => {
                setViewMode('kanban');
                setFilters((current) => ({ ...current, mode: 'active' }));
              }}
            >
              Kanban
            </button>
            <button
              type="button"
              className={viewMode === 'todo' ? 'active' : ''}
              aria-pressed={viewMode === 'todo'}
              onClick={() => {
                setViewMode('todo');
                setFilters((current) => ({ ...current, mode: 'active' }));
              }}
            >
              To-do
            </button>
          </div>
          <button
            type="button"
            className={filters.mode === 'archived' ? 'secondary-button active' : 'ghost-button'}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                mode: current.mode === 'active' ? 'archived' : 'active',
              }))
            }
          >
            {filters.mode === 'active'
              ? `Task trash (${scopedTrashCount})`
              : 'Back to active tasks'}
          </button>
        </div>
      </header>

      <WorkspaceTaskFilters
        projects={activeProjects}
        projectLabels={projectLabels}
        labels={availableLabels}
        filters={filters}
        activeCount={activeFilterCount}
        onChange={setFilters}
      />

      {filters.mode === 'archived' ? (
        <WorkspaceTaskTrash
          items={filteredTasks}
          busy={busy}
          visibleLimit={trashVisibleLimit}
          onShowMore={(totalCount) =>
            setTrashVisibleLimit((current) =>
              nextWorkspaceGlobalBoardGroupLimit(
                current ?? WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP,
                totalCount,
              ),
            )
          }
          onRestore={(item) => onSetTaskArchived(workspaceGlobalTaskArchiveInput(item, false))}
          onOpenProjectBoard={onOpenProjectBoard}
          projectLabels={projectLabels}
        />
      ) : (
        <>
          <WorkspaceTaskComposer
            projects={activeProjects}
            scopedProjectId={filters.projectId}
            busyAction={busyAction}
            onCreate={onCreateTask}
          />

          {activeProjects.length === 0 ? (
            <section className="workspace-task-empty" aria-label="No active projects">
              <strong>Create or restore an active project first</strong>
              <p>Every task belongs to one project, so GOSU never creates an unassigned task.</p>
            </section>
          ) : viewMode === 'todo' ? (
            <WorkspaceTodoList
              columns={columns}
              busy={busy}
              editingTaskId={editingTaskId}
              onEdit={setEditingTaskId}
              onCancelEdit={() => setEditingTaskId(null)}
              onUpdate={updateAndClose}
              onDelete={archiveTask}
              onOpenProjectBoard={onOpenProjectBoard}
              projectLabels={projectLabels}
              onShowMore={(status, totalCount) =>
                setVisibleLimits((current) => ({
                  ...current,
                  [status]: nextWorkspaceGlobalBoardGroupLimit(
                    current[status] ?? WORKSPACE_GLOBAL_BOARD_INITIAL_TASKS_PER_GROUP,
                    totalCount,
                  ),
                }))
              }
            />
          ) : (
            <div
              className="kanban-board"
              role="region"
              tabIndex={0}
              aria-label="All-project task columns. Scroll horizontally when needed."
            >
              {columns.map((column, columnIndex) => {
                const draggedItem = draggedTask
                  ? joinedTasks.find(
                      ({ task }) =>
                        task.id === draggedTask.taskId &&
                        task.projectId === draggedTask.projectId &&
                        task.version === draggedTask.expectedVersion,
                    )
                  : undefined;
                const canDrop = Boolean(
                  draggedItem &&
                  draggedItem.task.archivedAt === undefined &&
                  draggedItem.task.status !== column.status,
                );
                return (
                  <section
                    className={`kanban-column${dropStatus === column.status && canDrop ? ' drop-target' : ''}`}
                    key={column.status}
                    aria-labelledby={`workspace-task-column-${column.status}`}
                    onDragOver={(event) => {
                      if (!canDrop || busy) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDropStatus(column.status);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDropStatus((current) => (current === column.status ? null : current));
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDropStatus(null);
                      setDraggedTask(null);
                      if (!draggedItem || !canDrop || busy) return;
                      void onUpdateTask(
                        workspaceGlobalTaskStatusUpdate(draggedItem, column.status),
                      );
                    }}
                  >
                    <header>
                      <div>
                        <div className="column-title-row">
                          <strong id={`workspace-task-column-${column.status}`}>
                            {column.label}
                          </strong>
                        </div>
                        <small>Across active projects</small>
                      </div>
                      <span aria-label={`${column.totalCount} tasks`}>
                        {activeFilterCount > 0
                          ? `${column.visibleCount}/${column.totalCount}`
                          : column.totalCount}
                      </span>
                    </header>
                    {column.totalCount === 0 && (
                      <p className="column-empty">
                        {activeFilterCount > 0 ? 'No matching tasks' : 'Drop or add a task'}
                      </p>
                    )}
                    {column.tasks.map((item) =>
                      editingTaskId === item.task.id ? (
                        <WorkspaceTaskEditForm
                          key={`${item.task.projectId}:${item.task.id}:${item.task.version}:editing`}
                          item={item}
                          projectLabel={projectLabels.get(item.project.id) ?? item.project.name}
                          busy={busy}
                          onCancel={() => setEditingTaskId(null)}
                          onUpdate={updateAndClose}
                        />
                      ) : (
                        <WorkspaceTaskCard
                          key={`${item.task.projectId}:${item.task.id}:${item.task.version}`}
                          item={item}
                          columnIndex={columnIndex}
                          busy={busy}
                          onEdit={() => setEditingTaskId(item.task.id)}
                          onDelete={() => archiveTask(item)}
                          onUpdate={onUpdateTask}
                          onOpenProjectBoard={onOpenProjectBoard}
                          projectLabel={projectLabels.get(item.project.id) ?? item.project.name}
                          onDragStart={(event) => {
                            setDraggedTask({
                              taskId: item.task.id,
                              projectId: item.task.projectId,
                              expectedVersion: item.task.version,
                            });
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData(
                              'application/x-gosu-workspace-task',
                              'active',
                            );
                          }}
                          onDragEnd={() => {
                            setDraggedTask(null);
                            setDropStatus(null);
                          }}
                        />
                      ),
                    )}
                    {column.hasMore && (
                      <WorkspaceShowMore
                        remainingCount={column.remainingCount}
                        onClick={() =>
                          setVisibleLimits((current) => ({
                            ...current,
                            [column.status]: column.nextVisibleLimit,
                          }))
                        }
                      />
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function WorkspaceTaskFilters({
  projects,
  projectLabels,
  labels,
  filters,
  activeCount,
  onChange,
}: {
  projects: readonly ProjectRecord[];
  projectLabels: ReadonlyMap<string, string>;
  labels: readonly string[];
  filters: WorkspaceGlobalBoardFilters;
  activeCount: number;
  onChange: (filters: WorkspaceGlobalBoardFilters) => void;
}) {
  return (
    <section
      className="board-filter-bar workspace-task-filter-bar"
      aria-label="Filter tasks across projects"
    >
      <label>
        Project
        <select
          value={filters.projectId ?? ''}
          onChange={(event) => onChange({ ...filters, projectId: event.target.value || null })}
        >
          <option value="">All active projects</option>
          {projects.map((project) => (
            <option value={project.id} key={project.id}>
              {projectLabels.get(project.id) ?? project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="board-search">
        Search
        <input
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Title or description"
        />
      </label>
      <label>
        Priority
        <select
          value={filters.priority}
          onChange={(event) =>
            onChange({
              ...filters,
              priority: event.target.value as WorkspaceGlobalBoardFilters['priority'],
            })
          }
        >
          <option value="all">All priorities</option>
          <option value="none">No priority</option>
          {PRIORITIES.map((priority) => (
            <option value={priority.value} key={priority.value}>
              {priority.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Label
        <select
          value={filters.label}
          onChange={(event) => onChange({ ...filters, label: event.target.value })}
        >
          <option value="">All labels</option>
          {labels.map((label) => (
            <option value={label} key={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due
        <select
          value={filters.due}
          onChange={(event) =>
            onChange({ ...filters, due: event.target.value as WorkspaceGlobalBoardFilters['due'] })
          }
        >
          <option value="all">Any date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Today</option>
          <option value="this_week">This week</option>
          <option value="no_due_date">No due date</option>
        </select>
      </label>
      <button
        type="button"
        className="ghost-button clear-board-filters"
        disabled={activeCount === 0}
        onClick={() =>
          onChange({
            ...EMPTY_KANBAN_FILTERS,
            mode: filters.mode,
            projectId: null,
          })
        }
      >
        Clear all{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>
    </section>
  );
}

export function WorkspaceTaskComposer({
  projects,
  scopedProjectId,
  busyAction,
  onCreate,
}: {
  projects: readonly ProjectRecord[];
  scopedProjectId: string | null;
  busyAction: string | null;
  onCreate: (input: CreateTaskInput) => Promise<boolean>;
}) {
  const initialProjectId =
    scopedProjectId && projects.some((project) => project.id === scopedProjectId)
      ? scopedProjectId
      : '';
  const [projectId, setProjectId] = useState(initialProjectId);
  const selectedProject = projects.find((project) => project.id === projectId);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<WorkspaceTaskStatus>(() =>
    selectedProject ? resolveWorkspaceGlobalInitialStatus(selectedProject) : 'backlog',
  );
  const [showDetails, setShowDetails] = useState(false);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<WorkspaceTaskPriority | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [labels, setLabels] = useState('');
  const busy = busyAction !== null;
  const selectedBoard = selectedProject
    ? resolveWorkspaceBoardSettings(selectedProject.board)
    : null;
  const projectLabels = useMemo(() => workspaceGlobalProjectLabels(projects), [projects]);

  useEffect(() => {
    if (scopedProjectId && projects.some((project) => project.id === scopedProjectId)) {
      setProjectId(scopedProjectId);
      const project = projects.find((candidate) => candidate.id === scopedProjectId);
      if (project) setStatus(resolveWorkspaceGlobalInitialStatus(project));
      return;
    }
    if (projectId && !projects.some((project) => project.id === projectId)) {
      setProjectId('');
      setStatus('backlog');
    }
  }, [projectId, projects, scopedProjectId]);

  return (
    <section className="board-toolbar workspace-task-toolbar" aria-label="Add task to a project">
      <form
        className={`task-composer workspace-task-composer${showDetails ? ' expanded' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedProject || busy) return;
          void onCreate(
            workspaceGlobalTaskCreateInput({
              projectId: selectedProject.id,
              title,
              status,
              description,
              priority,
              dueDate,
              labels,
            }),
          ).then((saved) => {
            if (!saved) return;
            setTitle('');
            setDescription('');
            setPriority('');
            setDueDate('');
            setLabels('');
          });
        }}
      >
        <label>
          Project
          <select
            value={projectId}
            required
            disabled={busy || projects.length === 0}
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setProjectId(nextProjectId);
              const project = projects.find((candidate) => candidate.id === nextProjectId);
              setStatus(project ? resolveWorkspaceGlobalInitialStatus(project) : 'backlog');
            }}
          >
            <option value="">Choose a project</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {projectLabels.get(project.id) ?? project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Task title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={2}
            maxLength={240}
            placeholder="Add a concrete research task"
            required
            disabled={busy}
          />
        </label>
        <label>
          Initial stage
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkspaceTaskStatus)}
            disabled={busy || !selectedBoard}
          >
            {selectedBoard ? (
              selectedBoard.columnOrder.map((candidateStatus) => (
                <option value={candidateStatus} key={candidateStatus}>
                  {selectedBoard.columnLabels[candidateStatus]}
                </option>
              ))
            ) : (
              <option value="backlog">Choose a project first</option>
            )}
          </select>
        </label>
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !selectedProject || title.trim().length < 2}
        >
          {busyAction === 'task:create' ? 'Adding…' : 'Add task'}
        </button>
        <button
          type="button"
          className="ghost-button task-details-toggle"
          onClick={() => setShowDetails((current) => !current)}
          disabled={busy}
        >
          {showDetails ? 'Fewer details' : 'More details'}
        </button>
        {showDetails && (
          <div className="task-details-grid">
            <label className="task-description-field">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={4_000}
                placeholder="Method, acceptance criteria, or research context"
                disabled={busy}
              />
            </label>
            <WorkspaceTaskMetadataFields
              priority={priority}
              dueDate={dueDate}
              labels={labels}
              busy={busy}
              onPriority={setPriority}
              onDueDate={setDueDate}
              onLabels={setLabels}
            />
          </div>
        )}
      </form>
      <p className="board-help">
        Choose the owning project explicitly. Global tasks never become unassigned.
      </p>
    </section>
  );
}

function WorkspaceTaskCard({
  item,
  projectLabel,
  columnIndex,
  busy,
  onEdit,
  onDelete,
  onUpdate,
  onOpenProjectBoard,
  onDragStart,
  onDragEnd,
}: {
  item: WorkspaceGlobalBoardTask;
  projectLabel: string;
  columnIndex: number;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<boolean>;
  onOpenProjectBoard?: ((projectId: string) => void) | undefined;
  onDragStart: DragEventHandler<HTMLElement>;
  onDragEnd: DragEventHandler<HTMLElement>;
}) {
  const previous = WORKSPACE_GLOBAL_BOARD_COLUMNS[columnIndex - 1];
  const next = WORKSPACE_GLOBAL_BOARD_COLUMNS[columnIndex + 1];
  const dueState = taskDueState(item.task.dueDate);
  const context = `${item.task.title} in ${projectLabel}`;

  return (
    <article
      className={`task-card workspace-task-card priority-${item.task.priority ?? 'none'}`}
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={context}
    >
      <div className="workspace-task-context-row">
        <WorkspaceProjectBadge
          project={item.project}
          label={projectLabel}
          onOpenProjectBoard={onOpenProjectBoard}
        />
        <span className="workspace-task-stage">{item.statusLabel}</span>
      </div>
      <div className="task-card-heading">
        {item.task.priority && (
          <span className={`priority-badge ${item.task.priority}`}>{item.task.priority}</span>
        )}
        <h3>{item.task.title}</h3>
      </div>
      {item.task.description && <p className="task-description">{item.task.description}</p>}
      <WorkspaceTaskLabels labels={item.task.labels} />
      {item.task.dueDate && (
        <time className={`task-due ${dueState}`} dateTime={item.task.dueDate}>
          {dueState === 'overdue' ? 'Overdue · ' : dueState === 'today' ? 'Today · ' : 'Due · '}
          {item.task.dueDate}
        </time>
      )}
      <footer>
        <span className="task-version">
          v{item.task.version} · {formatUpdated(item.task.updatedAt)}
        </span>
        <div className="task-actions">
          <button
            type="button"
            onClick={() =>
              previous && void onUpdate(workspaceGlobalTaskStatusUpdate(item, previous.status))
            }
            disabled={busy || !previous}
            aria-label={`Move ${context} left`}
            title={previous ? `Move to ${previous.label}` : 'Already in the first column'}
          >
            ←
          </button>
          <button type="button" onClick={onEdit} disabled={busy} aria-label={`Edit ${context}`}>
            Edit
          </button>
          <button
            type="button"
            onClick={() =>
              next && void onUpdate(workspaceGlobalTaskStatusUpdate(item, next.status))
            }
            disabled={busy || !next}
            aria-label={`Move ${context} right`}
            title={next ? `Move to ${next.label}` : 'Already in the final column'}
          >
            →
          </button>
          <button
            type="button"
            className="task-delete-button"
            onClick={onDelete}
            disabled={busy}
            aria-label={`Delete ${context}`}
            title="Delete task; restorable from Task trash"
          >
            Delete
          </button>
        </div>
      </footer>
    </article>
  );
}

function WorkspaceTodoList({
  columns,
  projectLabels,
  busy,
  editingTaskId,
  onEdit,
  onCancelEdit,
  onUpdate,
  onDelete,
  onOpenProjectBoard,
  onShowMore,
}: {
  columns: ReturnType<typeof buildWorkspaceGlobalBoardColumns>;
  projectLabels: ReadonlyMap<string, string>;
  busy: boolean;
  editingTaskId: string | null;
  onEdit: (taskId: string) => void;
  onCancelEdit: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<boolean>;
  onDelete: (item: WorkspaceGlobalBoardTask) => void;
  onOpenProjectBoard?: ((projectId: string) => void) | undefined;
  onShowMore: (status: WorkspaceTaskStatus, totalCount: number) => void;
}) {
  const matchingCount = columns.reduce((total, column) => total + column.totalCount, 0);
  return (
    <section className="todo-task-list workspace-todo-list" aria-label="All-project To-do list">
      <header className="todo-list-summary">
        <div>
          <span>TO-DO VIEW</span>
          <h3>Tasks by workflow stage</h3>
        </div>
        <p>{matchingCount} matching tasks · project ownership stays unchanged</p>
      </header>
      <div className="todo-status-groups">
        {columns.map((column) => (
          <section className="todo-status-group" key={column.status}>
            <header>
              <strong>{column.label}</strong>
              <span aria-label={`${column.totalCount} tasks`}>{column.totalCount}</span>
            </header>
            {column.totalCount === 0 ? (
              <p className="todo-group-empty">No matching tasks</p>
            ) : (
              <div className="todo-group-items">
                {column.tasks.map((item) =>
                  editingTaskId === item.task.id ? (
                    <WorkspaceTaskEditForm
                      key={`${item.task.projectId}:${item.task.id}:${item.task.version}:editing`}
                      item={item}
                      projectLabel={projectLabels.get(item.project.id) ?? item.project.name}
                      busy={busy}
                      onCancel={onCancelEdit}
                      onUpdate={onUpdate}
                    />
                  ) : (
                    <WorkspaceTodoRow
                      key={`${item.task.projectId}:${item.task.id}:${item.task.version}`}
                      item={item}
                      projectLabel={projectLabels.get(item.project.id) ?? item.project.name}
                      busy={busy}
                      onEdit={() => onEdit(item.task.id)}
                      onDelete={() => onDelete(item)}
                      onUpdate={onUpdate}
                      onOpenProjectBoard={onOpenProjectBoard}
                    />
                  ),
                )}
                {column.hasMore && (
                  <WorkspaceShowMore
                    remainingCount={column.remainingCount}
                    onClick={() => onShowMore(column.status, column.totalCount)}
                  />
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function WorkspaceTodoRow({
  item,
  projectLabel,
  busy,
  onEdit,
  onDelete,
  onUpdate,
  onOpenProjectBoard,
}: {
  item: WorkspaceGlobalBoardTask;
  projectLabel: string;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<boolean>;
  onOpenProjectBoard?: ((projectId: string) => void) | undefined;
}) {
  const completed = item.task.status === 'done';
  const dueState = taskDueState(item.task.dueDate);
  const context = `${item.task.title} in ${projectLabel}`;
  const reopenStatus = resolveWorkspaceGlobalReopenStatus(item.project);
  const reopenLabel = resolveWorkspaceGlobalStatusLabel(item.project, reopenStatus);
  const completionLabel = completed
    ? `Reopen ${context} in ${reopenLabel}`
    : `Mark ${context} done`;

  return (
    <article
      className={`todo-task-row workspace-todo-row priority-${item.task.priority ?? 'none'}${completed ? ' completed' : ''}`}
      aria-label={context}
    >
      <input
        className="todo-complete-checkbox"
        type="checkbox"
        checked={completed}
        disabled={busy}
        aria-label={completionLabel}
        title={completionLabel}
        onChange={() => void onUpdate(workspaceGlobalTaskCompletionUpdate(item))}
      />
      <div className="todo-task-content">
        <div className="workspace-task-context-row">
          <WorkspaceProjectBadge
            project={item.project}
            label={projectLabel}
            onOpenProjectBoard={onOpenProjectBoard}
          />
          <span className="todo-status-badge">{item.statusLabel}</span>
          {item.task.priority && (
            <span className={`priority-badge ${item.task.priority}`}>{item.task.priority}</span>
          )}
        </div>
        <div className="todo-task-heading">
          <h4>{item.task.title}</h4>
        </div>
        {item.task.description && <p className="todo-task-description">{item.task.description}</p>}
        <div className="todo-task-metadata">
          {item.task.dueDate && (
            <time className={`task-due ${dueState}`} dateTime={item.task.dueDate}>
              {dueState === 'overdue' ? 'Overdue · ' : dueState === 'today' ? 'Today · ' : 'Due · '}
              {item.task.dueDate}
            </time>
          )}
          <WorkspaceTaskLabels labels={item.task.labels} />
        </div>
      </div>
      <div className="todo-task-actions">
        <button type="button" onClick={onEdit} disabled={busy} aria-label={`Edit ${context}`}>
          Edit
        </button>
        <button
          type="button"
          className="task-delete-button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete ${context}`}
          title="Delete task; restorable from Task trash"
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function WorkspaceTaskEditForm({
  item,
  projectLabel,
  busy,
  onCancel,
  onUpdate,
}: {
  item: WorkspaceGlobalBoardTask;
  projectLabel: string;
  busy: boolean;
  onCancel: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(item.task.title);
  const [status, setStatus] = useState(item.task.status);
  const [description, setDescription] = useState(item.task.description ?? '');
  const [priority, setPriority] = useState<WorkspaceTaskPriority | ''>(item.task.priority ?? '');
  const [dueDate, setDueDate] = useState(item.task.dueDate ?? '');
  const [labels, setLabels] = useState((item.task.labels ?? []).join(', '));
  const board = resolveWorkspaceBoardSettings(item.project.board);

  return (
    <article
      className="task-card editing workspace-task-card"
      aria-label={`Edit ${item.task.title} in ${projectLabel}`}
    >
      <div className="workspace-task-context-row">
        <WorkspaceProjectBadge project={item.project} label={projectLabel} />
        <span className="workspace-task-owner-note">Project ownership stays unchanged</span>
      </div>
      <form
        className="task-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const nextTitle = title.trim();
          const nextDescription = description.trim();
          const nextLabels = parseTaskLabels(labels);
          const labelsChanged =
            nextLabels.length !== (item.task.labels?.length ?? 0) ||
            nextLabels.some((label, index) => label !== item.task.labels?.[index]);
          const update: UpdateTaskInput = {
            projectId: item.task.projectId,
            taskId: item.task.id,
            expectedVersion: item.task.version,
            ...(nextTitle === item.task.title ? {} : { title: nextTitle }),
            ...(status === item.task.status ? {} : { status }),
            ...(nextDescription === (item.task.description ?? '')
              ? {}
              : { description: nextDescription || null }),
            ...(priority === (item.task.priority ?? '') ? {} : { priority: priority || null }),
            ...(dueDate === (item.task.dueDate ?? '') ? {} : { dueDate: dueDate || null }),
            ...(labelsChanged ? { labels: nextLabels } : {}),
          };
          if (Object.keys(update).length === 3) {
            onCancel();
            return;
          }
          void onUpdate(update);
        }}
      >
        <label>
          Task title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={2}
            maxLength={240}
            required
            autoFocus
            disabled={busy}
          />
        </label>
        <label>
          Stage in {projectLabel}
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkspaceTaskStatus)}
            disabled={busy}
          >
            {board.columnOrder.map((candidateStatus) => (
              <option value={candidateStatus} key={candidateStatus}>
                {board.columnLabels[candidateStatus]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4_000}
            disabled={busy}
          />
        </label>
        <WorkspaceTaskMetadataFields
          priority={priority}
          dueDate={dueDate}
          labels={labels}
          busy={busy}
          onPriority={setPriority}
          onDueDate={setDueDate}
          onLabels={setLabels}
        />
        <div className="task-edit-actions">
          <button
            type="submit"
            className="primary-button"
            disabled={busy || title.trim().length < 2}
          >
            Save
          </button>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </article>
  );
}

export function WorkspaceTaskTrash({
  items,
  busy,
  visibleLimit,
  onShowMore,
  onRestore,
  onOpenProjectBoard,
  projectLabels: providedProjectLabels,
}: {
  items: readonly WorkspaceGlobalBoardTask[];
  busy: boolean;
  visibleLimit: number | undefined;
  onShowMore: (totalCount: number) => void;
  onRestore: (item: WorkspaceGlobalBoardTask) => Promise<boolean>;
  onOpenProjectBoard?: ((projectId: string) => void) | undefined;
  projectLabels?: ReadonlyMap<string, string> | undefined;
}) {
  const window = sliceWorkspaceGlobalBoardGroup(items, visibleLimit);
  const projectLabels =
    providedProjectLabels ?? workspaceGlobalProjectLabels(items.map(({ project }) => project));
  return (
    <section className="archived-task-view" aria-label="All-project Task trash">
      <header>
        <div>
          <span>RESTORABLE DELETIONS</span>
          <h3>Task trash across projects</h3>
        </div>
        <p>{window.totalCount} matching deleted tasks</p>
      </header>
      {window.totalCount === 0 ? (
        <p className="archive-empty">No deleted tasks match the current filters.</p>
      ) : (
        <div className="archived-task-grid workspace-task-trash-grid">
          {window.items.map((item) => {
            const projectLabel = projectLabels.get(item.project.id) ?? item.project.name;
            const context = `${item.task.title} in ${projectLabel}`;
            return (
              <article
                className="task-card archived workspace-task-card"
                key={`${item.task.projectId}:${item.task.id}:${item.task.version}`}
                aria-label={context}
              >
                <WorkspaceProjectBadge
                  project={item.project}
                  label={projectLabel}
                  onOpenProjectBoard={onOpenProjectBoard}
                />
                <h3>{item.task.title}</h3>
                {item.task.description && (
                  <p className="task-description">{item.task.description}</p>
                )}
                <footer>
                  <span className="task-version">
                    Deleted {item.task.archivedAt ? formatUpdated(item.task.archivedAt) : ''}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void onRestore(item)}
                    disabled={busy}
                    aria-label={`Restore ${context}`}
                  >
                    Restore
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}
      {window.hasMore && (
        <WorkspaceShowMore
          remainingCount={window.remainingCount}
          onClick={() => onShowMore(window.totalCount)}
        />
      )}
    </section>
  );
}

function WorkspaceProjectBadge({
  project,
  label,
  onOpenProjectBoard,
}: {
  project: ProjectRecord;
  label: string;
  onOpenProjectBoard?: ((projectId: string) => void) | undefined;
}) {
  if (!onOpenProjectBoard) {
    return (
      <span className="workspace-project-badge" title={label}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="workspace-project-badge workspace-project-badge-button"
      title={`Open ${label} Board`}
      aria-label={`Open ${label} Board`}
      onClick={() => onOpenProjectBoard(project.id)}
    >
      {label}
    </button>
  );
}

function WorkspaceTaskLabels({ labels }: { labels: readonly string[] | undefined }) {
  if (!labels?.length) return null;
  return (
    <div className="task-labels">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

function WorkspaceTaskMetadataFields({
  priority,
  dueDate,
  labels,
  busy,
  onPriority,
  onDueDate,
  onLabels,
}: {
  priority: WorkspaceTaskPriority | '';
  dueDate: string;
  labels: string;
  busy: boolean;
  onPriority: (value: WorkspaceTaskPriority | '') => void;
  onDueDate: (value: string) => void;
  onLabels: (value: string) => void;
}) {
  return (
    <>
      <label>
        Priority
        <select
          value={priority}
          onChange={(event) => onPriority(event.target.value as WorkspaceTaskPriority | '')}
          disabled={busy}
        >
          <option value="">No priority</option>
          {PRIORITIES.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input
          type="date"
          value={dueDate}
          onChange={(event) => onDueDate(event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        Labels
        <input
          value={labels}
          onChange={(event) => onLabels(event.target.value)}
          placeholder="baseline, paper, ablation"
          maxLength={271}
          disabled={busy}
        />
      </label>
    </>
  );
}

function WorkspaceShowMore({
  remainingCount,
  onClick,
}: {
  remainingCount: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="workspace-task-show-more" onClick={onClick}>
      Show {Math.min(remainingCount, WORKSPACE_GLOBAL_BOARD_SHOW_MORE_STEP)} more
      <span className="sr-only"> of {remainingCount} remaining tasks</span>
    </button>
  );
}

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

function normalizeProjectName(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}
