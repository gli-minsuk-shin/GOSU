import { useMemo, useState, type DragEventHandler } from 'react';

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
import {
  EMPTY_KANBAN_FILTERS,
  activeKanbanFilterCount,
  canDropKanbanTask,
  filterKanbanTasks,
  kanbanColumnProgress,
  parseTaskLabels,
  projectTaskLabels,
  resolveKanbanColumns,
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
};

export function BoardView({
  project,
  tasks,
  busyAction,
  onCreateTask,
  onUpdateTask,
  onUpdateBoardSettings,
  onSetTaskArchived,
}: BoardViewProps) {
  const columns = useMemo(() => resolveKanbanColumns(project), [project]);
  const board = useMemo(() => resolveWorkspaceBoardSettings(project.board), [project.board]);
  const [filters, setFilters] = useState<KanbanFilters>(EMPTY_KANBAN_FILTERS);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsFocusStatus, setSettingsFocusStatus] = useState<WorkspaceTaskStatus | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<WorkspaceTaskStatus | null>(null);
  const filteredTasks = useMemo(() => filterKanbanTasks(tasks, filters), [filters, tasks]);
  const availableLabels = useMemo(() => projectTaskLabels(tasks), [tasks]);
  const trashedTaskCount = tasks.filter((task) => task.archivedAt !== undefined).length;
  const filterCount = activeKanbanFilterCount(filters);
  const busy = busyAction !== null;

  return (
    <section className="kanban-workspace" aria-label={`${board.title} Kanban workspace`}>
      <header className="kanban-command-bar">
        <div className="kanban-title-block">
          <span>PROJECT BOARD</span>
          <h2>{board.title}</h2>
          <p>
            {tasks.filter((task) => task.archivedAt === undefined).length} active research tasks
          </p>
        </div>
        <div className="kanban-view-actions">
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
            {filters.mode === 'active' ? `Task trash (${trashedTaskCount})` : 'Back to board'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setSettingsFocusStatus(null);
              setShowSettings((current) => !current);
            }}
          >
            {showSettings ? 'Close settings' : 'Rename columns & settings'}
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
        />
      ) : (
        <>
          <TaskComposer
            project={project}
            columns={columns}
            busyAction={busyAction}
            onCreate={onCreateTask}
          />
          <div className="kanban-board" aria-label={`${board.title} columns`}>
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
                        <strong id={`column-${column.status}`}>{column.label}</strong>
                        <button
                          type="button"
                          className="column-rename-button"
                          onClick={() => {
                            setSettingsFocusStatus(column.status);
                            setShowSettings(true);
                          }}
                          disabled={busy}
                          aria-label={`Rename ${column.label} column`}
                          title={`Rename ${column.label}`}
                        >
                          Rename
                        </button>
                      </div>
                      {column.wipLimit !== null && (
                        <small className={exceeded ? 'wip-warning' : ''}>
                          WIP {allColumnTasks.length}/{column.wipLimit}
                        </small>
                      )}
                    </div>
                    <span aria-label={`${allColumnTasks.length} tasks`}>
                      {filterCount > 0
                        ? `${visibleColumnTasks.length}/${allColumnTasks.length}`
                        : allColumnTasks.length}
                    </span>
                  </header>
                  {visibleColumnTasks.length === 0 && (
                    <p className="column-empty">
                      {allColumnTasks.length > 0 ? 'No matching tasks' : 'Drop or add a task'}
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
                            `Delete “${task.title}” from the board? It will move to Task trash and can be restored later.`,
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
    <section className="board-filter-bar" aria-label="Filter board tasks">
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
            onChange({ ...filters, priority: event.target.value as KanbanFilters['priority'] })
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
            onChange({ ...filters, due: event.target.value as KanbanFilters['due'] })
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
        onClick={() => onChange({ ...EMPTY_KANBAN_FILTERS, mode: filters.mode })}
      >
        Clear all{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>
    </section>
  );
}

function TaskComposer({
  project,
  columns,
  busyAction,
  onCreate,
}: {
  project: ProjectRecord;
  columns: ReturnType<typeof resolveKanbanColumns>;
  busyAction: string | null;
  onCreate: (input: CreateTaskInput) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<WorkspaceTaskStatus>(columns[0]?.status ?? 'backlog');
  const [showDetails, setShowDetails] = useState(false);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<WorkspaceTaskPriority | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [labels, setLabels] = useState('');
  const busy = busyAction !== null;

  return (
    <section className="board-toolbar" aria-label="Add task">
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
          Initial column
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkspaceTaskStatus)}
            disabled={busy}
          >
            {columns.map((column) => (
              <option value={column.status} key={column.status}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary-button" disabled={busy || title.trim().length < 2}>
          {busyAction === 'task:create' ? 'Adding…' : 'Add task'}
        </button>
        <button
          type="button"
          className="ghost-button task-details-toggle"
          onClick={() => setShowDetails((current) => !current)}
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
      <p className="board-help">Drag cards between columns or use the move controls.</p>
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
      className={`task-card priority-${task.priority ?? 'none'}`}
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="task-card-heading">
        {task.priority && (
          <span className={`priority-badge ${task.priority}`}>{task.priority}</span>
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
          {dueState === 'overdue' ? 'Overdue · ' : dueState === 'today' ? 'Today · ' : 'Due · '}
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
            aria-label={`Move ${task.title} left`}
            title={previous ? `Move to ${previous.label}` : 'Already in the first column'}
          >
            ←
          </button>
          <button type="button" onClick={onEdit} disabled={busy} aria-label={`Edit ${task.title}`}>
            Edit
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
            aria-label={`Move ${task.title} right`}
            title={next ? `Move to ${next.label}` : 'Already in the final column'}
          >
            →
          </button>
          <button
            type="button"
            className="task-delete-button"
            onClick={onDelete}
            disabled={busy}
            aria-label={`Delete ${task.title}`}
            title="Delete from board; restorable from Task trash"
          >
            Delete
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
          Column
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkspaceTaskStatus)}
            disabled={busy}
          >
            {columns.map((column) => (
              <option value={column.status} key={column.status}>
                {column.label}
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
    <section className="board-settings-panel" aria-label="Board settings">
      <header>
        <div>
          <span>WORKFLOW DISPLAY</span>
          <h3>Customize this project board</h3>
        </div>
        <p>Canonical status IDs remain stable for experiments, chat actions, and sync.</p>
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
}: {
  tasks: readonly WorkspaceTask[];
  busy: boolean;
  onRestore: (task: WorkspaceTask) => Promise<boolean>;
}) {
  return (
    <section className="archived-task-view" aria-label="Task trash">
      <header>
        <div>
          <span>RESTORABLE DELETIONS</span>
          <h3>Task trash</h3>
        </div>
        <p>{tasks.length} matching deleted tasks</p>
      </header>
      {tasks.length === 0 ? (
        <p className="archive-empty">No deleted tasks match the current filters.</p>
      ) : (
        <div className="archived-task-grid">
          {tasks.map((task) => (
            <article className="task-card archived" key={`${task.id}:${task.version}`}>
              <h3>{task.title}</h3>
              {task.description && <p className="task-description">{task.description}</p>}
              <footer>
                <span className="task-version">
                  Deleted {task.archivedAt ? formatUpdated(task.archivedAt) : ''}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void onRestore(task)}
                  disabled={busy}
                  aria-label={`Restore ${task.title}`}
                >
                  Restore
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
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}
