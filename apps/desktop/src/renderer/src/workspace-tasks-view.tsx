import { uiText, useUiText, uiLocale } from '@gosu/ui/language';

import { useEffect, useMemo, useRef, useState, type DragEventHandler } from 'react';

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
import { boardColumnDisplayLabel } from './domain-ui-labels';

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
  briefingTarget?: { id: string; requestId: number } | null;
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
  briefingTarget,
  projects,
  tasks,
  busyAction,
  onCreateTask,
  onUpdateTask,
  onSetTaskArchived,
  onOpenProjectBoard,
  initialViewMode = 'kanban',
}: WorkspaceTasksViewProps) {
  useUiText();
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
  const [dismissedTarget, setDismissedTarget] = useState<number | null>(null);
  const destination = useRef<HTMLDivElement>(null);
  const linkedTask =
    briefingTarget &&
    joinedTasks.find((item) => item.task.id === briefingTarget.id && !item.task.archivedAt);
  useEffect(() => {
    if (briefingTarget) destination.current?.focus();
  }, [briefingTarget?.requestId]);
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
        uiText(
          'Delete “{title}” from {projectLabel}? It will move to Task trash and can be restored later.',
          { title: item.task.title, projectLabel: projectLabel },
        ),
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
      aria-label={uiText('All-project task workspace')}
    >
      {briefingTarget && dismissedTarget !== briefingTarget.requestId && (
        <div
          ref={destination}
          tabIndex={-1}
          className="briefing-task-destination"
          aria-label="브리핑에서 선택한 할 일"
        >
          {linkedTask ? (
            <WorkspaceTaskEditForm
              item={linkedTask}
              projectLabel={projectLabels.get(linkedTask.project.id) ?? linkedTask.project.name}
              busy={busy}
              onCancel={() => setDismissedTarget(briefingTarget.requestId)}
              onUpdate={async (input) => {
                const saved = await onUpdateTask(input);
                if (saved) setDismissedTarget(briefingTarget.requestId);
                return saved;
              }}
            />
          ) : (
            <p role="status">이 할 일은 삭제·보관되었거나 현재 접근할 수 없습니다.</p>
          )}
        </div>
      )}
      <header className="kanban-command-bar">
        <div className="kanban-title-block">
          <span>{uiText('WORKSPACE TASKS')}</span>
          <h2>{uiText('All project tasks')}</h2>
          <p>
            {activeTaskCount} {uiText('active')}{' '}
            {activeTaskCount === 1 ? uiText('task') : uiText('tasks')} {uiText('across')}{' '}
            {activeProjects.length} {uiText('active')}{' '}
            {activeProjects.length === 1 ? uiText('project') : uiText('projects')}
          </p>
        </div>
        <div className="kanban-view-actions">
          <div className="board-layout-switch" role="group" aria-label={uiText('Task layout')}>
            <button
              type="button"
              className={viewMode === 'kanban' ? 'active' : ''}
              aria-pressed={viewMode === 'kanban'}
              onClick={() => {
                setViewMode('kanban');
                setFilters((current) => ({ ...current, mode: 'active' }));
              }}
            >
              {uiText('Kanban')}
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
              {uiText('To-do')}
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
              ? uiText('Task trash ({scopedTrashCount})', { scopedTrashCount: scopedTrashCount })
              : uiText('Back to active tasks')}
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
            <section className="workspace-task-empty" aria-label={uiText('No active projects')}>
              <strong>{uiText('Create or restore an active project first')}</strong>
              <p>
                {uiText(
                  'Every task belongs to one project, so GOSU never creates an unassigned task.',
                )}
              </p>
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
              aria-label={uiText('All-project task columns. Scroll horizontally when needed.')}
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
                            {boardColumnDisplayLabel(column.status, column.label)}
                          </strong>
                        </div>
                        <small>{uiText('Across active projects')}</small>
                      </div>
                      <span
                        aria-label={uiText('{totalCount} tasks', { totalCount: column.totalCount })}
                      >
                        {activeFilterCount > 0
                          ? `${column.visibleCount}/${column.totalCount}`
                          : column.totalCount}
                      </span>
                    </header>
                    {column.totalCount === 0 && (
                      <p className="column-empty">
                        {activeFilterCount > 0
                          ? uiText('No matching tasks')
                          : uiText('Drop or add a task')}
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
      aria-label={uiText('Filter tasks across projects')}
    >
      <label>
        {uiText('Project')}
        <select
          value={filters.projectId ?? ''}
          onChange={(event) => onChange({ ...filters, projectId: event.target.value || null })}
        >
          <option value="">{uiText('All active projects')}</option>
          {projects.map((project) => (
            <option value={project.id} key={project.id}>
              {projectLabels.get(project.id) ?? project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="board-search">
        {uiText('Search')}
        <input
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder={uiText('Title or description')}
        />
      </label>
      <label>
        {uiText('Priority')}
        <select
          value={filters.priority}
          onChange={(event) =>
            onChange({
              ...filters,
              priority: event.target.value as WorkspaceGlobalBoardFilters['priority'],
            })
          }
        >
          <option value="all">{uiText('All priorities')}</option>
          <option value="none">{uiText('No priority')}</option>
          {PRIORITIES.map((priority) => (
            <option value={priority.value} key={priority.value}>
              {uiText(priority.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {uiText('Label')}
        <select
          value={filters.label}
          onChange={(event) => onChange({ ...filters, label: event.target.value })}
        >
          <option value="">{uiText('All labels')}</option>
          {labels.map((label) => (
            <option value={label} key={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {uiText('Due')}
        <select
          value={filters.due}
          onChange={(event) =>
            onChange({ ...filters, due: event.target.value as WorkspaceGlobalBoardFilters['due'] })
          }
        >
          <option value="all">{uiText('Any date')}</option>
          <option value="overdue">{uiText('Overdue')}</option>
          <option value="today">{uiText('Today')}</option>
          <option value="this_week">{uiText('This week')}</option>
          <option value="no_due_date">{uiText('No due date')}</option>
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
        {uiText('Clear all')}
        {activeCount > 0 ? ` (${activeCount})` : ''}
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
  useUiText();
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
    <section
      className="board-toolbar workspace-task-toolbar"
      aria-label={uiText('Add task to a project')}
    >
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
          {uiText('Project')}
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
            <option value="">{uiText('Choose a project')}</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {projectLabels.get(project.id) ?? project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {uiText('Task title')}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={2}
            maxLength={240}
            placeholder={uiText('Add a concrete research task')}
            required
            disabled={busy}
          />
        </label>
        <label>
          {uiText('Initial stage')}
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
              <option value="backlog">{uiText('Choose a project first')}</option>
            )}
          </select>
        </label>
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !selectedProject || title.trim().length < 2}
        >
          {busyAction === 'task:create' ? uiText('Adding…') : uiText('Add task')}
        </button>
        <button
          type="button"
          className="ghost-button task-details-toggle"
          onClick={() => setShowDetails((current) => !current)}
          disabled={busy}
        >
          {showDetails ? uiText('Fewer details') : uiText('More details')}
        </button>
        {showDetails && (
          <div className="task-details-grid">
            <label className="task-description-field">
              {uiText('Description')}
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={4_000}
                placeholder={uiText('Method, acceptance criteria, or research context')}
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
        {uiText('Choose the owning project explicitly. Global tasks never become unassigned.')}
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
        <span className="workspace-task-stage">
          {boardColumnDisplayLabel(item.task.status, item.statusLabel)}
        </span>
      </div>
      <div className="task-card-heading">
        {item.task.priority && (
          <span className={`priority-badge ${uiText(item.task.priority)}`}>
            {uiText(item.task.priority)}
          </span>
        )}
        <h3>{item.task.title}</h3>
      </div>
      {item.task.description && <p className="task-description">{item.task.description}</p>}
      <WorkspaceTaskLabels labels={item.task.labels} />
      {item.task.dueDate && (
        <time className={`task-due ${dueState}`} dateTime={item.task.dueDate}>
          {dueState === 'overdue'
            ? uiText('Overdue · ')
            : dueState === 'today'
              ? uiText('Today · ')
              : uiText('Due · ')}
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
            aria-label={uiText('Move {context} left', { context: context })}
            title={
              previous
                ? uiText('Move to {label}', { label: previous.label })
                : uiText('Already in the first column')
            }
          >
            ←
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            aria-label={uiText('Edit {context}', { context: context })}
          >
            {uiText('Edit')}
          </button>
          <button
            type="button"
            onClick={() =>
              next && void onUpdate(workspaceGlobalTaskStatusUpdate(item, next.status))
            }
            disabled={busy || !next}
            aria-label={uiText('Move {context} right', { context: context })}
            title={
              next
                ? uiText('Move to {label}', { label: next.label })
                : uiText('Already in the final column')
            }
          >
            →
          </button>
          <button
            type="button"
            className="task-delete-button"
            onClick={onDelete}
            disabled={busy}
            aria-label={uiText('Delete {context}', { context: context })}
            title={uiText('Delete task; restorable from Task trash')}
          >
            {uiText('Delete')}
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
    <section
      className="todo-task-list workspace-todo-list"
      aria-label={uiText('All-project To-do list')}
    >
      <header className="todo-list-summary">
        <div>
          <span>{uiText('TO-DO VIEW')}</span>
          <h3>{uiText('Tasks by workflow stage')}</h3>
        </div>
        <p>
          {matchingCount} {uiText('matching tasks · project ownership stays unchanged')}
        </p>
      </header>
      <div className="todo-status-groups">
        {columns.map((column) => (
          <section className="todo-status-group" key={column.status}>
            <header>
              <strong>{boardColumnDisplayLabel(column.status, column.label)}</strong>
              <span aria-label={uiText('{totalCount} tasks', { totalCount: column.totalCount })}>
                {column.totalCount}
              </span>
            </header>
            {column.totalCount === 0 ? (
              <p className="todo-group-empty">{uiText('No matching tasks')}</p>
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
          <span className="todo-status-badge">
            {boardColumnDisplayLabel(item.task.status, item.statusLabel)}
          </span>
          {item.task.priority && (
            <span className={`priority-badge ${uiText(item.task.priority)}`}>
              {uiText(item.task.priority)}
            </span>
          )}
        </div>
        <div className="todo-task-heading">
          <h4>{item.task.title}</h4>
        </div>
        {item.task.description && <p className="todo-task-description">{item.task.description}</p>}
        <div className="todo-task-metadata">
          {item.task.dueDate && (
            <time className={`task-due ${dueState}`} dateTime={item.task.dueDate}>
              {dueState === 'overdue'
                ? uiText('Overdue · ')
                : dueState === 'today'
                  ? uiText('Today · ')
                  : uiText('Due · ')}
              {item.task.dueDate}
            </time>
          )}
          <WorkspaceTaskLabels labels={item.task.labels} />
        </div>
      </div>
      <div className="todo-task-actions">
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          aria-label={uiText('Edit {context}', { context: context })}
        >
          {uiText('Edit')}
        </button>
        <button
          type="button"
          className="task-delete-button"
          onClick={onDelete}
          disabled={busy}
          aria-label={uiText('Delete {context}', { context: context })}
          title={uiText('Delete task; restorable from Task trash')}
        >
          {uiText('Delete')}
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
  useUiText();
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
      aria-label={uiText('Edit {title} in {projectLabel}', {
        title: item.task.title,
        projectLabel: projectLabel,
      })}
    >
      <div className="workspace-task-context-row">
        <WorkspaceProjectBadge project={item.project} label={projectLabel} />
        <span className="workspace-task-owner-note">
          {uiText('Project ownership stays unchanged')}
        </span>
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
          {uiText('Task title')}
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
          {uiText('Stage in')} {projectLabel}
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
          {uiText('Description')}
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
            {uiText('Save')}
          </button>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
            {uiText('Cancel')}
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
    <section className="archived-task-view" aria-label={uiText('All-project Task trash')}>
      <header>
        <div>
          <span>{uiText('RESTORABLE DELETIONS')}</span>
          <h3>{uiText('Task trash across projects')}</h3>
        </div>
        <p>
          {window.totalCount} {uiText('matching deleted tasks')}
        </p>
      </header>
      {window.totalCount === 0 ? (
        <p className="archive-empty">{uiText('No deleted tasks match the current filters.')}</p>
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
                    {uiText('Deleted')}{' '}
                    {item.task.archivedAt ? formatUpdated(item.task.archivedAt) : ''}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void onRestore(item)}
                    disabled={busy}
                    aria-label={uiText('Restore {context}', { context: context })}
                  >
                    {uiText('Restore')}
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
      title={uiText('Open {label} Board', { label: label })}
      aria-label={uiText('Open {label} Board', { label: label })}
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
        {uiText('Priority')}
        <select
          value={priority}
          onChange={(event) => onPriority(event.target.value as WorkspaceTaskPriority | '')}
          disabled={busy}
        >
          <option value="">{uiText('No priority')}</option>
          {PRIORITIES.map((option) => (
            <option value={option.value} key={option.value}>
              {uiText(option.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {uiText('Due date')}
        <input
          type="date"
          value={dueDate}
          onChange={(event) => onDueDate(event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        {uiText('Labels')}
        <input
          value={labels}
          onChange={(event) => onLabels(event.target.value)}
          placeholder={uiText('baseline, paper, ablation')}
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
      {uiText('Show')} {Math.min(remainingCount, WORKSPACE_GLOBAL_BOARD_SHOW_MORE_STEP)}{' '}
      {uiText('more')}
      <span className="sr-only">
        {' '}
        {uiText('of')} {remainingCount} {uiText('remaining tasks')}
      </span>
    </button>
  );
}

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat(uiLocale(), { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

function normalizeProjectName(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}
