import { uiText, useUiText, uiLocale } from '@gosu/ui/language';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEventHandler,
} from 'react';

import {
  resolveWorkspaceBoardSettings,
  type CreateTaskInput,
  type ProjectRecord,
  type SetTaskArchivedInput,
  type UpdateBoardSettingsInput,
  type UpdateTaskInput,
  type WorkspaceTask,
  type WorkspaceTaskPriority,
  type WorkspaceTaskStatus,
} from '../../shared/workspace-contracts';
import { BoardSettingsForm } from './board-settings-form';
import { boardColumnDisplayLabel, boardTitleDisplayLabel } from './domain-ui-labels';
import type { SearchTargetRequest } from './search-results-model';
import {
  EMPTY_KANBAN_FILTERS,
  activeKanbanFilterCount,
  canDropKanbanTask,
  filterKanbanTasks,
  groupTodoTasksByStatus,
  kanbanColumnProgress,
  parseTaskLabels,
  projectTaskLabels,
  resolveKanbanColumns,
  resolveTodoReopenStatus,
  taskDueState,
  type KanbanFilters,
} from './kanban-board-model';

const PRIORITIES: ReadonlyArray<{ value: WorkspaceTaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

type BoardViewProps = {
  project: ProjectRecord;
  tasks: readonly WorkspaceTask[];
  busyAction: string | null;
  onCreateTask: (input: CreateTaskInput) => Promise<boolean>;
  onUpdateTask: (input: UpdateTaskInput) => Promise<boolean>;
  onUpdateBoardSettings: (input: UpdateBoardSettingsInput) => Promise<boolean>;
  onSetTaskArchived: (input: SetTaskArchivedInput) => Promise<boolean>;
  searchTarget?: SearchTargetRequest | null;
  onSearchTargetHandled?: (requestId: number) => void;
};

export function BoardView({
  project,
  tasks,
  busyAction,
  onCreateTask,
  onUpdateTask,
  onUpdateBoardSettings,
  onSetTaskArchived,
  searchTarget = null,
  onSearchTargetHandled = () => undefined,
}: BoardViewProps) {
  useUiText();
  const columns = useMemo(() => resolveKanbanColumns(project), [project]);
  const board = useMemo(() => resolveWorkspaceBoardSettings(project.board), [project.board]);
  const [filters, setFilters] = useState<KanbanFilters>(EMPTY_KANBAN_FILTERS);
  const [viewMode, setViewMode] = useState<'kanban' | 'todo'>('kanban');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsFocusStatus, setSettingsFocusStatus] = useState<WorkspaceTaskStatus | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<WorkspaceTaskStatus | null>(null);
  const [selectedSearchTaskId, setSelectedSearchTaskId] = useState<string | null>(null);
  const [pendingSearchFocus, setPendingSearchFocus] = useState<SearchTargetRequest | null>(null);
  const taskElementsRef = useRef(new Map<string, HTMLElement>());
  const filteredTasks = useMemo(() => filterKanbanTasks(tasks, filters), [filters, tasks]);
  const availableLabels = useMemo(() => projectTaskLabels(tasks), [tasks]);
  const trashedTaskCount = tasks.filter((task) => task.archivedAt !== undefined).length;
  const filterCount = activeKanbanFilterCount(filters);
  const busy = busyAction !== null;

  useEffect(() => {
    if (!searchTarget) return;
    const task = tasks.find(({ id }) => id === searchTarget.targetId);
    if (!task) {
      onSearchTargetHandled(searchTarget.requestId);
      return;
    }
    setFilters({ ...EMPTY_KANBAN_FILTERS, mode: task.archivedAt ? 'archived' : 'active' });
    setShowSettings(false);
    setEditingTaskId(null);
    setSelectedSearchTaskId(task.id);
    setPendingSearchFocus(searchTarget);
  }, [onSearchTargetHandled, searchTarget, tasks]);

  useLayoutEffect(() => {
    if (!pendingSearchFocus) return;
    const element = taskElementsRef.current.get(pendingSearchFocus.targetId);
    if (!element) return;
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    element.focus({ preventScroll: true });
    onSearchTargetHandled(pendingSearchFocus.requestId);
    setPendingSearchFocus(null);
  }, [filteredTasks, onSearchTargetHandled, pendingSearchFocus]);

  return (
    <section
      className="kanban-workspace"
      aria-label={uiText('{title} task workspace', { title: board.title })}
    >
      <header className="kanban-command-bar">
        <div className="kanban-title-block">
          <span>{uiText('PROJECT BOARD')}</span>
          <h2>{boardTitleDisplayLabel(board.title)}</h2>
          <p>
            {tasks.filter((task) => task.archivedAt === undefined).length}{' '}
            {uiText('active research tasks')}
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
              ? uiText('Task trash ({trashedTaskCount})', { trashedTaskCount: trashedTaskCount })
              : uiText('Back to tasks')}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setSettingsFocusStatus(null);
              setShowSettings((current) => !current);
            }}
          >
            {showSettings ? uiText('Close settings') : uiText('Rename columns & settings')}
          </button>
        </div>
      </header>

      <BoardFilters
        filters={filters}
        labels={availableLabels}
        activeCount={filterCount}
        onChange={setFilters}
      />

      {showSettings && (
        <BoardSettingsPanel
          key={`${project.id}:${project.version}:${settingsFocusStatus ?? 'general'}`}
          project={project}
          busy={busy}
          focusStatus={settingsFocusStatus}
          onCancel={() => {
            setSettingsFocusStatus(null);
            setShowSettings(false);
          }}
          onSave={async (input) => {
            const saved = await onUpdateBoardSettings(input);
            if (saved) {
              setSettingsFocusStatus(null);
              setShowSettings(false);
            }
            return saved;
          }}
        />
      )}

      {filters.mode === 'archived' ? (
        <TaskTrash
          tasks={filteredTasks}
          busy={busy}
          onRestore={(task) =>
            onSetTaskArchived({
              projectId: project.id,
              taskId: task.id,
              expectedVersion: task.version,
              archived: false,
            })
          }
          selectedSearchTaskId={selectedSearchTaskId}
          onTaskElement={(taskId, element) => {
            if (element) taskElementsRef.current.set(taskId, element);
            else taskElementsRef.current.delete(taskId);
          }}
        />
      ) : (
        <>
          <TaskComposer
            project={project}
            columns={columns}
            viewMode={viewMode}
            busyAction={busyAction}
            onCreate={onCreateTask}
          />
          {viewMode === 'todo' ? (
            <TodoTaskList
              project={project}
              tasks={filteredTasks}
              busy={busy}
              editingTaskId={editingTaskId}
              selectedSearchTaskId={selectedSearchTaskId}
              onTaskElement={(taskId, element) => {
                if (element) taskElementsRef.current.set(taskId, element);
                else taskElementsRef.current.delete(taskId);
              }}
              onEdit={setEditingTaskId}
              onCancelEdit={() => setEditingTaskId(null)}
              onDelete={(task) => {
                if (
                  !window.confirm(
                    uiText(
                      'Delete “{title}” from project tasks? It will move to Task trash and can be restored later.',
                      { title: task.title },
                    ),
                  )
                ) {
                  return;
                }
                void onSetTaskArchived({
                  projectId: project.id,
                  taskId: task.id,
                  expectedVersion: task.version,
                  archived: true,
                });
              }}
              onUpdate={async (input) => {
                const saved = await onUpdateTask(input);
                if (saved) setEditingTaskId(null);
                return saved;
              }}
            />
          ) : (
            <div
              className="kanban-board"
              role="region"
              tabIndex={0}
              aria-label={uiText('{title} columns. Scroll horizontally when needed.', {
                title: board.title,
              })}
            >
              {columns.map((column, columnIndex) => {
                const progress = kanbanColumnProgress(tasks, column.status, column.wipLimit);
                const allColumnTasks = progress.activeTasks;
                const visibleColumnTasks = filteredTasks.filter(
                  (task) => task.status === column.status,
                );
                const exceeded = progress.exceeded;
                const canDrop =
                  canDropKanbanTask({
                    projectId: project.id,
                    taskId: draggedTaskId,
                    targetStatus: column.status,
                    tasks,
                  }) !== null;
                return (
                  <section
                    className={`kanban-column${exceeded ? ' wip-exceeded' : ''}${dropStatus === column.status && canDrop ? ' drop-target' : ''}`}
                    key={column.status}
                    aria-labelledby={`column-${column.status}`}
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
                      const task = canDropKanbanTask({
                        projectId: project.id,
                        taskId: draggedTaskId,
                        targetStatus: column.status,
                        tasks,
                      });
                      setDropStatus(null);
                      setDraggedTaskId(null);
                      if (!task || busy) return;
                      void onUpdateTask({
                        projectId: project.id,
                        taskId: task.id,
                        expectedVersion: task.version,
                        status: column.status,
                      });
                    }}
                  >
                    <header>
                      <div>
                        <div className="column-title-row">
                          <strong id={`column-${column.status}`}>
                            {boardColumnDisplayLabel(column.status, column.label)}
                          </strong>
                          <button
                            type="button"
                            className="column-rename-button"
                            onClick={() => {
                              setSettingsFocusStatus(column.status);
                              setShowSettings(true);
                            }}
                            disabled={busy}
                            aria-label={uiText('Rename {label} column', { label: column.label })}
                            title={uiText('Rename {label}', { label: column.label })}
                          >
                            {uiText('Rename')}
                          </button>
                        </div>
                        {column.wipLimit !== null && (
                          <small className={exceeded ? 'wip-warning' : ''}>
                            {uiText('WIP')} {allColumnTasks.length}/{column.wipLimit}
                          </small>
                        )}
                      </div>
                      <span
                        aria-label={uiText('{length} tasks', { length: allColumnTasks.length })}
                      >
                        {filterCount > 0
                          ? `${visibleColumnTasks.length}/${allColumnTasks.length}`
                          : allColumnTasks.length}
                      </span>
                    </header>
                    {visibleColumnTasks.length === 0 && (
                      <p className="column-empty">
                        {allColumnTasks.length > 0
                          ? uiText('No matching tasks')
                          : uiText('Drop or add a task')}
                      </p>
                    )}
                    {visibleColumnTasks.map((task) => (
                      <TaskCard
                        key={`${task.id}:${task.version}`}
                        task={task}
                        columns={columns}
                        columnIndex={columnIndex}
                        editing={editingTaskId === task.id}
                        busy={busy}
                        searchSelected={selectedSearchTaskId === task.id}
                        elementRef={(element) => {
                          if (element) taskElementsRef.current.set(task.id, element);
                          else taskElementsRef.current.delete(task.id);
                        }}
                        onEdit={() => setEditingTaskId(task.id)}
                        onCancel={() => setEditingTaskId(null)}
                        onDragStart={(event) => {
                          setDraggedTaskId(task.id);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('application/x-gosu-task', 'active');
                        }}
                        onDragEnd={() => {
                          setDraggedTaskId(null);
                          setDropStatus(null);
                        }}
                        onDelete={() => {
                          if (
                            !window.confirm(
                              uiText(
                                'Delete “{title}” from project tasks? It will move to Task trash and can be restored later.',
                                { title: task.title },
                              ),
                            )
                          ) {
                            return;
                          }
                          void onSetTaskArchived({
                            projectId: project.id,
                            taskId: task.id,
                            expectedVersion: task.version,
                            archived: true,
                          });
                        }}
                        onUpdate={async (input) => {
                          const saved = await onUpdateTask(input);
                          if (saved) setEditingTaskId(null);
                          return saved;
                        }}
                      />
                    ))}
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

function BoardFilters({
  filters,
  labels,
  activeCount,
  onChange,
}: {
  filters: KanbanFilters;
  labels: readonly string[];
  activeCount: number;
  onChange: (filters: KanbanFilters) => void;
}) {
  return (
    <section className="board-filter-bar" aria-label={uiText('Filter project tasks')}>
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
            onChange({ ...filters, priority: event.target.value as KanbanFilters['priority'] })
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
            onChange({ ...filters, due: event.target.value as KanbanFilters['due'] })
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
        onClick={() => onChange({ ...EMPTY_KANBAN_FILTERS, mode: filters.mode })}
      >
        {uiText('Clear all')}
        {activeCount > 0 ? ` (${activeCount})` : ''}
      </button>
    </section>
  );
}

export function TodoTaskList({
  project,
  tasks,
  busy,
  editingTaskId,
  selectedSearchTaskId,
  onTaskElement,
  onEdit,
  onCancelEdit,
  onUpdate,
  onDelete,
}: {
  project: ProjectRecord;
  tasks: readonly WorkspaceTask[];
  busy: boolean;
  editingTaskId: string | null;
  selectedSearchTaskId?: string | null;
  onTaskElement?: (taskId: string, element: HTMLElement | null) => void;
  onEdit: (taskId: string) => void;
  onCancelEdit: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<boolean>;
  onDelete: (task: WorkspaceTask) => void;
}) {
  const groups = groupTodoTasksByStatus(project, tasks);
  const columns = resolveKanbanColumns(project);
  const reopenStatus = resolveTodoReopenStatus(project);
  const reopenLabel = columns.find((column) => column.status === reopenStatus)?.label ?? 'Backlog';

  return (
    <section className="todo-task-list" aria-label={uiText('To-do list')}>
      <header className="todo-list-summary">
        <div>
          <span>{uiText('TO-DO VIEW')}</span>
          <h3>{uiText('Tasks by workflow stage')}</h3>
        </div>
        <p>
          {tasks.length} {uiText('matching tasks · changes also appear on Kanban')}
        </p>
      </header>
      <div className="todo-status-groups">
        {groups.map((group) => (
          <section className="todo-status-group" key={group.status}>
            <header>
              <strong>{boardColumnDisplayLabel(group.status, group.label)}</strong>
              <span aria-label={uiText('{length} tasks', { length: group.tasks.length })}>
                {group.tasks.length}
              </span>
            </header>
            {group.tasks.length === 0 ? (
              <p className="todo-group-empty">{uiText('No matching tasks')}</p>
            ) : (
              <div className="todo-group-items">
                {group.tasks.map((task) =>
                  editingTaskId === task.id ? (
                    <TaskEditForm
                      key={`${task.id}:${task.version}:editing`}
                      task={task}
                      columns={columns}
                      busy={busy}
                      onCancel={onCancelEdit}
                      onUpdate={onUpdate}
                    />
                  ) : (
                    <TodoTaskRow
                      key={`${task.id}:${task.version}`}
                      task={task}
                      statusLabel={group.label}
                      reopenLabel={reopenLabel}
                      reopenStatus={reopenStatus}
                      busy={busy}
                      searchSelected={selectedSearchTaskId === task.id}
                      elementRef={(element) => onTaskElement?.(task.id, element)}
                      onEdit={() => onEdit(task.id)}
                      onDelete={() => onDelete(task)}
                      onUpdate={onUpdate}
                    />
                  ),
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

export function TodoTaskRow({
  task,
  statusLabel,
  reopenLabel,
  reopenStatus,
  busy,
  searchSelected,
  elementRef,
  onEdit,
  onDelete,
  onUpdate,
}: {
  task: WorkspaceTask;
  statusLabel: string;
  reopenLabel: string;
  reopenStatus: WorkspaceTaskStatus;
  busy: boolean;
  searchSelected: boolean;
  elementRef: (element: HTMLElement | null) => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<boolean>;
}) {
  const completed = task.status === 'done';
  const dueState = taskDueState(task.dueDate);
  const completionLabel = completed
    ? `Reopen ${task.title} in ${reopenLabel}`
    : `Mark ${task.title} done`;

  return (
    <article
      ref={elementRef}
      tabIndex={searchSelected ? -1 : undefined}
      className={`todo-task-row priority-${task.priority ?? 'none'}${completed ? ' completed' : ''}${searchSelected ? ' search-target' : ''}`}
    >
      <input
        className="todo-complete-checkbox"
        type="checkbox"
        checked={completed}
        disabled={busy}
        aria-label={completionLabel}
        title={completionLabel}
        onChange={() =>
          void onUpdate({
            projectId: task.projectId,
            taskId: task.id,
            expectedVersion: task.version,
            status: completed ? reopenStatus : 'done',
          })
        }
      />
      <div className="todo-task-content">
        <div className="todo-task-heading">
          <h4>{task.title}</h4>
          <span className="todo-status-badge">{statusLabel}</span>
          {task.priority && (
            <span className={`priority-badge ${uiText(task.priority)}`}>
              {uiText(task.priority)}
            </span>
          )}
        </div>
        {task.description && <p className="todo-task-description">{task.description}</p>}
        <div className="todo-task-metadata">
          {task.dueDate && (
            <time className={`task-due ${dueState}`} dateTime={task.dueDate}>
              {dueState === 'overdue'
                ? uiText('Overdue · ')
                : dueState === 'today'
                  ? uiText('Today · ')
                  : uiText('Due · ')}
              {task.dueDate}
            </time>
          )}
          {(task.labels?.length ?? 0) > 0 && (
            <div className="task-labels">
              {task.labels?.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="todo-task-actions">
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          aria-label={uiText('Edit {title}', { title: task.title })}
        >
          {uiText('Edit')}
        </button>
        <button
          type="button"
          className="task-delete-button"
          onClick={onDelete}
          disabled={busy}
          aria-label={uiText('Delete {title}', { title: task.title })}
          title={uiText('Delete task; restorable from Task trash')}
        >
          {uiText('Delete')}
        </button>
      </div>
    </article>
  );
}

function TaskComposer({
  project,
  columns,
  viewMode,
  busyAction,
  onCreate,
}: {
  project: ProjectRecord;
  columns: ReturnType<typeof resolveKanbanColumns>;
  viewMode: 'kanban' | 'todo';
  busyAction: string | null;
  onCreate: (input: CreateTaskInput) => Promise<boolean>;
}) {
  useUiText();
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<WorkspaceTaskStatus>(columns[0]?.status ?? 'backlog');
  const [showDetails, setShowDetails] = useState(false);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<WorkspaceTaskPriority | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [labels, setLabels] = useState('');
  const busy = busyAction !== null;

  return (
    <section className="board-toolbar" aria-label={uiText('Add task')}>
      <form
        className={`task-composer${showDetails ? ' expanded' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          void onCreate({
            projectId: project.id,
            title: title.trim(),
            status,
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(priority ? { priority } : {}),
            ...(dueDate ? { dueDate } : {}),
            ...(parseTaskLabels(labels).length ? { labels: parseTaskLabels(labels) } : {}),
          }).then((saved) => {
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
          {uiText('Initial column')}
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkspaceTaskStatus)}
            disabled={busy}
          >
            {columns.map((column) => (
              <option value={column.status} key={column.status}>
                {boardColumnDisplayLabel(column.status, column.label)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary-button" disabled={busy || title.trim().length < 2}>
          {busyAction === 'task:create' ? uiText('Adding…') : uiText('Add task')}
        </button>
        <button
          type="button"
          className="ghost-button task-details-toggle"
          onClick={() => setShowDetails((current) => !current)}
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
            <TaskMetadataFields
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
        {viewMode === 'kanban'
          ? uiText('Drag cards between columns or use the move controls.')
          : uiText('Check a task to complete it; uncheck a completed task to reopen it.')}
      </p>
    </section>
  );
}

function TaskCard({
  task,
  columns,
  columnIndex,
  editing,
  busy,
  onEdit,
  onCancel,
  onUpdate,
  onDelete,
  onDragStart,
  onDragEnd,
  searchSelected = false,
  elementRef,
}: {
  task: WorkspaceTask;
  columns: ReturnType<typeof resolveKanbanColumns>;
  columnIndex: number;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<boolean>;
  onDelete: () => void;
  onDragStart: DragEventHandler<HTMLElement>;
  onDragEnd: DragEventHandler<HTMLElement>;
  searchSelected?: boolean;
  elementRef?: (element: HTMLElement | null) => void;
}) {
  if (editing) {
    return (
      <TaskEditForm
        task={task}
        columns={columns}
        busy={busy}
        onCancel={onCancel}
        onUpdate={onUpdate}
      />
    );
  }
  const previous = columns[columnIndex - 1];
  const next = columns[columnIndex + 1];
  const dueState = taskDueState(task.dueDate);
  return (
    <article
      ref={elementRef}
      tabIndex={searchSelected ? -1 : undefined}
      className={`task-card priority-${task.priority ?? 'none'}${searchSelected ? ' search-target' : ''}`}
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="task-card-heading">
        {task.priority && (
          <span className={`priority-badge ${uiText(task.priority)}`}>{uiText(task.priority)}</span>
        )}
        <h3>{task.title}</h3>
      </div>
      {task.description && <p className="task-description">{task.description}</p>}
      {(task.labels?.length ?? 0) > 0 && (
        <div className="task-labels">
          {task.labels?.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
      {task.dueDate && (
        <time className={`task-due ${dueState}`} dateTime={task.dueDate}>
          {dueState === 'overdue'
            ? uiText('Overdue · ')
            : dueState === 'today'
              ? uiText('Today · ')
              : uiText('Due · ')}
          {task.dueDate}
        </time>
      )}
      <footer>
        <span className="task-version">
          v{task.version} · {formatUpdated(task.updatedAt)}
        </span>
        <div className="task-actions">
          <button
            type="button"
            onClick={() =>
              previous &&
              void onUpdate({
                projectId: task.projectId,
                taskId: task.id,
                expectedVersion: task.version,
                status: previous.status,
              })
            }
            disabled={busy || !previous}
            aria-label={uiText('Move {title} left', { title: task.title })}
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
            aria-label={uiText('Edit {title}', { title: task.title })}
          >
            {uiText('Edit')}
          </button>
          <button
            type="button"
            onClick={() =>
              next &&
              void onUpdate({
                projectId: task.projectId,
                taskId: task.id,
                expectedVersion: task.version,
                status: next.status,
              })
            }
            disabled={busy || !next}
            aria-label={uiText('Move {title} right', { title: task.title })}
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
            aria-label={uiText('Delete {title}', { title: task.title })}
            title={uiText('Delete task; restorable from Task trash')}
          >
            {uiText('Delete')}
          </button>
        </div>
      </footer>
    </article>
  );
}

function TaskEditForm({
  task,
  columns,
  busy,
  onCancel,
  onUpdate,
}: {
  task: WorkspaceTask;
  columns: ReturnType<typeof resolveKanbanColumns>;
  busy: boolean;
  onCancel: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<boolean>;
}) {
  useUiText();
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState(task.status);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<WorkspaceTaskPriority | ''>(task.priority ?? '');
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [labels, setLabels] = useState((task.labels ?? []).join(', '));
  return (
    <article className="task-card editing">
      <form
        className="task-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const nextTitle = title.trim();
          const nextDescription = description.trim();
          const nextLabels = parseTaskLabels(labels);
          const labelsChanged =
            nextLabels.length !== (task.labels?.length ?? 0) ||
            nextLabels.some((label, index) => label !== task.labels?.[index]);
          const update: UpdateTaskInput = {
            projectId: task.projectId,
            taskId: task.id,
            expectedVersion: task.version,
            ...(nextTitle === task.title ? {} : { title: nextTitle }),
            ...(status === task.status ? {} : { status }),
            ...(nextDescription === (task.description ?? '')
              ? {}
              : { description: nextDescription || null }),
            ...(priority === (task.priority ?? '') ? {} : { priority: priority || null }),
            ...(dueDate === (task.dueDate ?? '') ? {} : { dueDate: dueDate || null }),
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
          {uiText('Column')}
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkspaceTaskStatus)}
            disabled={busy}
          >
            {columns.map((column) => (
              <option value={column.status} key={column.status}>
                {boardColumnDisplayLabel(column.status, column.label)}
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
        <TaskMetadataFields
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

function TaskMetadataFields({
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

function BoardSettingsPanel({
  project,
  busy,
  focusStatus,
  onCancel,
  onSave,
}: {
  project: ProjectRecord;
  busy: boolean;
  focusStatus: WorkspaceTaskStatus | null;
  onCancel: () => void;
  onSave: (input: UpdateBoardSettingsInput) => Promise<boolean>;
}) {
  const initial = resolveWorkspaceBoardSettings(project.board);

  return (
    <section className="board-settings-panel" aria-label={uiText('Board settings')}>
      <header>
        <div>
          <span>{uiText('WORKFLOW DISPLAY')}</span>
          <h3>{uiText('Customize this project board')}</h3>
        </div>
        <p>
          {uiText('Canonical status IDs remain stable for experiments, chat actions, and sync.')}
        </p>
      </header>
      <BoardSettingsForm
        initial={initial}
        busy={busy}
        saveLabel="Save board"
        focusStatus={focusStatus}
        onCancel={onCancel}
        onSave={(board) =>
          onSave({
            projectId: project.id,
            expectedVersion: project.version,
            board,
          })
        }
      />
    </section>
  );
}

export function TaskTrash({
  tasks,
  busy,
  onRestore,
  selectedSearchTaskId = null,
  onTaskElement = () => undefined,
}: {
  tasks: readonly WorkspaceTask[];
  busy: boolean;
  onRestore: (task: WorkspaceTask) => Promise<boolean>;
  selectedSearchTaskId?: string | null;
  onTaskElement?: (taskId: string, element: HTMLElement | null) => void;
}) {
  return (
    <section className="archived-task-view" aria-label={uiText('Task trash')}>
      <header>
        <div>
          <span>{uiText('RESTORABLE DELETIONS')}</span>
          <h3>{uiText('Task trash')}</h3>
        </div>
        <p>
          {tasks.length} {uiText('matching deleted tasks')}
        </p>
      </header>
      {tasks.length === 0 ? (
        <p className="archive-empty">{uiText('No deleted tasks match the current filters.')}</p>
      ) : (
        <div className="archived-task-grid">
          {tasks.map((task) => (
            <article
              ref={(element) => onTaskElement(task.id, element)}
              tabIndex={selectedSearchTaskId === task.id ? -1 : undefined}
              className={`task-card archived${selectedSearchTaskId === task.id ? ' search-target' : ''}`}
              key={`${task.id}:${task.version}`}
            >
              <h3>{task.title}</h3>
              {task.description && <p className="task-description">{task.description}</p>}
              <footer>
                <span className="task-version">
                  {uiText('Deleted')} {task.archivedAt ? formatUpdated(task.archivedAt) : ''}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void onRestore(task)}
                  disabled={busy}
                  aria-label={uiText('Restore {title}', { title: task.title })}
                >
                  {uiText('Restore')}
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat(uiLocale(), { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}
