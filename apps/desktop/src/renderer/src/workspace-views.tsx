import { useEffect, useState, type ReactNode } from 'react';

import type {
  ProjectRecord,
  SaveObjectiveInput,
  WorkspaceObjective,
  WorkspaceTask,
  WorkspaceTaskStatus,
} from '../../shared/workspace-contracts';
import { CardHead, describeError } from './ui-primitives';

export type WorkspaceTabId = 'chat' | 'board' | 'objective' | 'connections' | 'notes';

type ObjectiveDraft = {
  goal: string;
  metricKey: string;
  metricDisplayName: string;
  direction: 'maximize' | 'minimize';
  unit: string;
  aggregation: 'mean' | 'median' | 'minimum' | 'maximum' | 'last';
  evaluatorHash: string;
  datasetHash: string;
  holdoutHash: string;
  baseline: string;
  target: string;
  maxTrials: string;
  maxConcurrentTrials: string;
  maxWallTimeSeconds: string;
  maxGpuHours: string;
  maxFailures: string;
  stopWhenTargetReached: boolean;
  guardrailAction: 'pause' | 'stop' | 'fail';
  maxConsecutiveNoImprovement: string;
};

export const WORKSPACE_TABS: ReadonlyArray<{
  id: WorkspaceTabId;
  label: string;
  icon: string;
}> = [
  { id: 'chat', label: 'Project chat', icon: '◈' },
  { id: 'board', label: 'Board', icon: '▦' },
  { id: 'objective', label: 'Goal & Metrics', icon: '◎' },
  { id: 'connections', label: 'Connections', icon: '⌁' },
  { id: 'notes', label: 'Local notes', icon: '◇' },
];

export const FUTURE_MODULES = [
  ['Experiments', '⌁'],
  ['Manuscript', '¶'],
  ['Review', '✓'],
  ['References', '⌘'],
  ['Lecture slides', '▹'],
] as const;

const KANBAN_COLUMNS: ReadonlyArray<{ status: WorkspaceTaskStatus; label: string }> = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'planned', label: 'Planned' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
];

const EMPTY_OBJECTIVE: ObjectiveDraft = {
  goal: '',
  metricKey: '',
  metricDisplayName: '',
  direction: 'maximize',
  unit: '',
  aggregation: 'mean',
  evaluatorHash: '',
  datasetHash: '',
  holdoutHash: '',
  baseline: '',
  target: '',
  maxTrials: '10',
  maxConcurrentTrials: '1',
  maxWallTimeSeconds: '3600',
  maxGpuHours: '0',
  maxFailures: '3',
  stopWhenTargetReached: true,
  guardrailAction: 'pause',
  maxConsecutiveNoImprovement: '',
};

export function WorkspacePageHeading({
  activeTab,
  activeProject,
  onNewProject,
}: {
  activeTab: WorkspaceTabId;
  activeProject: ProjectRecord | undefined;
  onNewProject: () => void;
}) {
  const tab = WORKSPACE_TABS.find((item) => item.id === activeTab)!;
  const subtitles: Record<WorkspaceTabId, string> = {
    chat: 'Talk with the linked Codex model and turn the conversation into reviewed project work.',
    board: 'Create work, move it through the research workflow, and keep every change locally.',
    objective:
      'Define a versioned goal, evaluation metric, reproducibility hashes, and hard experiment budget.',
    connections: 'Inspect real local capabilities. No connection state on this page is simulated.',
    notes: 'Read Markdown from a folder you explicitly select. Note contents stay on this Mac.',
  };
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">
          {activeProject?.name ?? 'Local workspace'} / {tab.label}
        </span>
        <h1>{tab.label}</h1>
        <p>{subtitles[activeTab]}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onNewProject}>
        ＋ New project
      </button>
    </header>
  );
}

export function WorkspaceUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-card">
        <div className="empty-mark">!</div>
        <h1>The local workspace could not be opened</h1>
        <p>Your project data was not replaced or reset. Retry after checking local storage.</p>
        <button type="button" className="secondary-button" onClick={onRetry}>
          Retry
        </button>
      </div>
    </section>
  );
}

export function EmptyWorkspace({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (input: { name: string; repository?: string }) => Promise<boolean>;
}) {
  return (
    <section className="empty-state">
      <div className="empty-card">
        <div className="empty-mark">＋</div>
        <h1>Create your first research project</h1>
        <p>
          Projects and tasks are stored in the encrypted local workspace. You can start offline;
          pending collaboration changes remain visible.
        </p>
        <ProjectForm busy={busy} submitLabel="Create project" onCreate={onCreate} />
      </div>
    </section>
  );
}

export function ProjectComposer({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: { name: string; repository?: string }) => Promise<boolean>;
}) {
  return (
    <section className="card" aria-labelledby="new-project-title">
      <CardHead title="New project" detail="Stored locally first" id="new-project-title" />
      <ProjectForm busy={busy} submitLabel="Create project" onCreate={onCreate}>
        <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </ProjectForm>
    </section>
  );
}

function ProjectForm({
  busy,
  submitLabel,
  onCreate,
  children,
}: {
  busy: boolean;
  submitLabel: string;
  onCreate: (input: { name: string; repository?: string }) => Promise<boolean>;
  children?: ReactNode;
}) {
  const [name, setName] = useState('');
  const [repository, setRepository] = useState('');
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const trimmedRepository = repository.trim();
        void onCreate({
          name: name.trim(),
          ...(trimmedRepository === '' ? {} : { repository: trimmedRepository }),
        }).then((succeeded) => {
          if (succeeded) {
            setName('');
            setRepository('');
          }
        });
      }}
    >
      <label>
        Project name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={120}
          placeholder="e.g. Robust retrieval evaluation"
          autoFocus
          required
          disabled={busy}
        />
      </label>
      <label>
        GitHub repository <span className="sr-only">optional</span>
        <input
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
          maxLength={500}
          placeholder="owner/repository · optional"
          disabled={busy}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy || name.trim().length < 2}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}

export function BoardView({
  project,
  tasks,
  busyAction,
  onCreateTask,
  onUpdateTask,
}: {
  project: ProjectRecord;
  tasks: readonly WorkspaceTask[];
  busyAction: string | null;
  onCreateTask: (input: {
    projectId: string;
    title: string;
    status: WorkspaceTaskStatus;
  }) => Promise<boolean>;
  onUpdateTask: (input: {
    projectId: string;
    taskId: string;
    expectedVersion: number;
    title?: string;
    status?: WorkspaceTaskStatus;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<WorkspaceTaskStatus>('backlog');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  return (
    <>
      <section className="board-toolbar" aria-label="Add task">
        <form
          className="task-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (busyAction !== null) return;
            void onCreateTask({ projectId: project.id, title: title.trim(), status }).then(
              (succeeded) => {
                if (succeeded) setTitle('');
              },
            );
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
              disabled={busyAction !== null}
            />
          </label>
          <label>
            Initial status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as WorkspaceTaskStatus)}
              disabled={busyAction !== null}
            >
              {KANBAN_COLUMNS.map((column) => (
                <option value={column.status} key={column.status}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={busyAction !== null || title.trim().length < 2}
          >
            {busyAction === 'task:create' ? 'Adding…' : 'Add task'}
          </button>
        </form>
        <p className="board-help">Move controls use the task’s current optimistic version.</p>
      </section>

      <div className="kanban-board" aria-label={`${project.name} Kanban board`}>
        {KANBAN_COLUMNS.map((column, columnIndex) => {
          const columnTasks = tasks.filter((task) => task.status === column.status);
          return (
            <section className="kanban-column" key={column.status} aria-labelledby={column.status}>
              <header>
                <strong id={column.status}>{column.label}</strong>
                <span aria-label={`${columnTasks.length} tasks`}>{columnTasks.length}</span>
              </header>
              {columnTasks.length === 0 && <p className="column-empty">No tasks</p>}
              {columnTasks.map((task) => (
                <TaskCard
                  key={`${task.id}:${task.version}`}
                  task={task}
                  columnIndex={columnIndex}
                  editing={editingTaskId === task.id}
                  busy={busyAction !== null}
                  onEdit={() => setEditingTaskId(task.id)}
                  onCancel={() => setEditingTaskId(null)}
                  onUpdate={async (input) => {
                    const succeeded = await onUpdateTask(input);
                    if (succeeded) setEditingTaskId(null);
                    return succeeded;
                  }}
                />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

function TaskCard({
  task,
  columnIndex,
  editing,
  busy,
  onEdit,
  onCancel,
  onUpdate,
}: {
  task: WorkspaceTask;
  columnIndex: number;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onUpdate: (input: {
    projectId: string;
    taskId: string;
    expectedVersion: number;
    title?: string;
    status?: WorkspaceTaskStatus;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState(task.status);

  useEffect(() => {
    setTitle(task.title);
    setStatus(task.status);
  }, [task.status, task.title]);

  if (editing) {
    return (
      <article className="task-card">
        <form
          className="task-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const nextTitle = title.trim();
            if (nextTitle === task.title && status === task.status) {
              onCancel();
              return;
            }
            void onUpdate({
              projectId: task.projectId,
              taskId: task.id,
              expectedVersion: task.version,
              ...(nextTitle === task.title ? {} : { title: nextTitle }),
              ...(status === task.status ? {} : { status }),
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
              required
              autoFocus
              disabled={busy}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as WorkspaceTaskStatus)}
              disabled={busy}
            >
              {KANBAN_COLUMNS.map((column) => (
                <option value={column.status} key={column.status}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <div className="task-edit-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={busy || title.trim().length < 2}
            >
              Save
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setTitle(task.title);
                setStatus(task.status);
                onCancel();
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      </article>
    );
  }

  const previous = KANBAN_COLUMNS[columnIndex - 1];
  const next = KANBAN_COLUMNS[columnIndex + 1];
  return (
    <article className="task-card">
      <h3>{task.title}</h3>
      <footer>
        <span className="task-version">Version {task.version} · saved locally</span>
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
        </div>
      </footer>
    </article>
  );
}

export function ObjectiveEditor({
  project,
  objective,
  busy,
  onSave,
  onLock,
  onStartVersion,
}: {
  project: ProjectRecord;
  objective: WorkspaceObjective | undefined;
  busy: boolean;
  onSave: (input: SaveObjectiveInput) => Promise<boolean>;
  onLock: (input: { projectId: string; expectedEntityVersion: number }) => Promise<boolean>;
  onStartVersion: (input: { projectId: string; expectedEntityVersion: number }) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<ObjectiveDraft>(() => objectiveToDraft(objective));

  const setField = <Key extends keyof ObjectiveDraft>(key: Key, value: ObjectiveDraft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <section className="workspace-grid">
      <article className="card">
        <CardHead
          title="Versioned research objective"
          detail={
            objective
              ? `Objective v${objective.objectiveVersion} · entity v${objective.entityVersion}`
              : 'No objective saved yet'
          }
        />
        <form
          className="objective-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || objective?.locked) return;
            try {
              void onSave(objectiveInput(project.id, objective, draft));
            } catch (error) {
              const target = event.currentTarget;
              target.setAttribute('data-error', describeError(error));
              target.reportValidity();
            }
          }}
        >
          <label className="full-width">
            Research goal
            <textarea
              value={draft.goal}
              onChange={(event) => setField('goal', event.target.value)}
              minLength={10}
              maxLength={4_000}
              placeholder="State the outcome the experiment should improve and the boundary it must preserve."
              required
              disabled={busy || objective?.locked}
            />
          </label>

          <fieldset className="objective-section full-width">
            <legend className="sr-only">Primary metric</legend>
            <h3>Primary metric</h3>
            <div className="field-grid">
              <label>
                Metric key
                <input
                  value={draft.metricKey}
                  onChange={(event) => setField('metricKey', event.target.value)}
                  maxLength={128}
                  placeholder="validation_accuracy"
                  required
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                Display name
                <input
                  value={draft.metricDisplayName}
                  onChange={(event) => setField('metricDisplayName', event.target.value)}
                  maxLength={256}
                  placeholder="Validation accuracy"
                  required
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                Direction
                <select
                  value={draft.direction}
                  onChange={(event) =>
                    setField('direction', event.target.value as ObjectiveDraft['direction'])
                  }
                  disabled={busy || objective?.locked}
                >
                  <option value="maximize">Maximize</option>
                  <option value="minimize">Minimize</option>
                </select>
              </label>
              <label>
                Aggregation
                <select
                  value={draft.aggregation}
                  onChange={(event) =>
                    setField('aggregation', event.target.value as ObjectiveDraft['aggregation'])
                  }
                  disabled={busy || objective?.locked}
                >
                  <option value="mean">Mean</option>
                  <option value="median">Median</option>
                  <option value="minimum">Minimum</option>
                  <option value="maximum">Maximum</option>
                  <option value="last">Last</option>
                </select>
              </label>
              <label>
                Unit <span className="sr-only">optional</span>
                <input
                  value={draft.unit}
                  onChange={(event) => setField('unit', event.target.value)}
                  maxLength={64}
                  placeholder="%, ms, score · optional"
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                Baseline <span className="sr-only">optional</span>
                <input
                  type="number"
                  step="any"
                  value={draft.baseline}
                  onChange={(event) => setField('baseline', event.target.value)}
                  placeholder="Optional"
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                Target <span className="sr-only">optional</span>
                <input
                  type="number"
                  step="any"
                  value={draft.target}
                  onChange={(event) => setField('target', event.target.value)}
                  placeholder="Optional"
                  disabled={busy || objective?.locked}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="objective-section full-width">
            <legend className="sr-only">Reproducibility hashes</legend>
            <h3>Reproducibility hashes</h3>
            <p>Use immutable content identifiers. GOSU does not upload the underlying files.</p>
            <div className="field-grid">
              <label>
                Evaluator hash
                <input
                  value={draft.evaluatorHash}
                  onChange={(event) => setField('evaluatorHash', event.target.value)}
                  minLength={8}
                  maxLength={160}
                  placeholder="sha256:… or commit hash"
                  required
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                Dataset hash
                <input
                  value={draft.datasetHash}
                  onChange={(event) => setField('datasetHash', event.target.value)}
                  minLength={8}
                  maxLength={160}
                  placeholder="sha256:…"
                  required
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                Holdout hash <span className="sr-only">optional</span>
                <input
                  value={draft.holdoutHash}
                  onChange={(event) => setField('holdoutHash', event.target.value)}
                  minLength={8}
                  maxLength={160}
                  placeholder="Optional"
                  disabled={busy || objective?.locked}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="objective-section">
            <legend className="sr-only">Experiment budget</legend>
            <h3>Hard experiment budget</h3>
            <div className="field-grid">
              <NumberField
                label="Max trials"
                value={draft.maxTrials}
                onChange={(value) => setField('maxTrials', value)}
                min={1}
                integer
                disabled={busy || Boolean(objective?.locked)}
              />
              <NumberField
                label="Concurrent trials"
                value={draft.maxConcurrentTrials}
                onChange={(value) => setField('maxConcurrentTrials', value)}
                min={1}
                max={Number(draft.maxTrials) || undefined}
                integer
                disabled={busy || Boolean(objective?.locked)}
              />
              <NumberField
                label="Wall time · seconds"
                value={draft.maxWallTimeSeconds}
                onChange={(value) => setField('maxWallTimeSeconds', value)}
                min={1}
                integer
                disabled={busy || Boolean(objective?.locked)}
              />
              <NumberField
                label="GPU hours"
                value={draft.maxGpuHours}
                onChange={(value) => setField('maxGpuHours', value)}
                min={0}
                disabled={busy || Boolean(objective?.locked)}
              />
              <NumberField
                label="Max failures"
                value={draft.maxFailures}
                onChange={(value) => setField('maxFailures', value)}
                min={0}
                integer
                disabled={busy || Boolean(objective?.locked)}
              />
            </div>
          </fieldset>

          <fieldset className="objective-section">
            <legend className="sr-only">Stop policy</legend>
            <h3>Stop policy</h3>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.stopWhenTargetReached}
                onChange={(event) => setField('stopWhenTargetReached', event.target.checked)}
                disabled={busy || objective?.locked}
              />
              Stop when the target is reached
            </label>
            <label>
              Guardrail action
              <select
                value={draft.guardrailAction}
                onChange={(event) =>
                  setField(
                    'guardrailAction',
                    event.target.value as ObjectiveDraft['guardrailAction'],
                  )
                }
                disabled={busy || objective?.locked}
              >
                <option value="pause">Pause</option>
                <option value="stop">Stop</option>
                <option value="fail">Fail</option>
              </select>
            </label>
            <NumberField
              label="No-improvement limit · optional"
              value={draft.maxConsecutiveNoImprovement}
              onChange={(value) => setField('maxConsecutiveNoImprovement', value)}
              min={1}
              integer
              required={false}
              disabled={busy || Boolean(objective?.locked)}
            />
          </fieldset>

          <div className="objective-actions">
            <button type="submit" className="primary-button" disabled={busy || objective?.locked}>
              {busy ? 'Saving…' : objective ? 'Save changes' : 'Save objective'}
            </button>
            <span className="task-version">Saved in encrypted local storage</span>
          </div>
        </form>
      </article>

      <aside className="card">
        <CardHead title="Revision control" detail="Explicit, versioned changes" />
        <div className="objective-status">
          <div>
            <strong>
              {objective ? `Objective v${objective.objectiveVersion}` : 'Not configured'}
            </strong>
            <p>
              {objective?.locked
                ? 'Frozen revisions cannot be edited. Start a new revision to change the metric or budget.'
                : 'An editable local revision. Review every field before freezing it.'}
            </p>
          </div>
          {objective && (
            <span className={objective.locked ? 'locked-label' : 'task-version'}>
              {objective.locked ? 'FROZEN LOCALLY' : `ENTITY V${objective.entityVersion}`}
            </span>
          )}
        </div>
        <div className="objective-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !objective || objective.locked}
            onClick={() =>
              objective &&
              void onLock({
                projectId: project.id,
                expectedEntityVersion: objective.entityVersion,
              })
            }
          >
            Freeze local revision
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !objective?.locked}
            onClick={() =>
              objective &&
              void onStartVersion({
                projectId: project.id,
                expectedEntityVersion: objective.entityVersion,
              })
            }
          >
            Start new revision
          </button>
        </div>
        <div className="boundary-note">
          Guardrails default to an empty list in this first usable slice. Metric, hashes, budget and
          stop policy are still persisted as one versioned objective.
        </div>
      </aside>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  integer = false,
  required = true,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max?: number | undefined;
  integer?: boolean;
  required?: boolean;
  disabled: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        min={min}
        max={max}
        step={integer ? 1 : 'any'}
        required={required}
        disabled={disabled}
      />
    </label>
  );
}

export function latestObjective(
  objectives: readonly WorkspaceObjective[],
  projectId: string,
): WorkspaceObjective | undefined {
  return objectives
    .filter((objective) => objective.projectId === projectId)
    .sort((left, right) => right.objectiveVersion - left.objectiveVersion)[0];
}

function objectiveToDraft(objective: WorkspaceObjective | undefined): ObjectiveDraft {
  if (!objective) return { ...EMPTY_OBJECTIVE };
  return {
    goal: objective.goal,
    metricKey: objective.primaryMetric.key,
    metricDisplayName: objective.primaryMetric.displayName,
    direction: objective.primaryMetric.direction,
    unit: objective.primaryMetric.unit ?? '',
    aggregation: objective.primaryMetric.aggregation,
    evaluatorHash: objective.primaryMetric.evaluatorHash,
    datasetHash: objective.primaryMetric.datasetHash,
    holdoutHash: objective.primaryMetric.holdoutHash ?? '',
    baseline: objective.primaryMetric.baseline?.toString() ?? '',
    target: objective.primaryMetric.target?.toString() ?? '',
    maxTrials: objective.budget.maxTrials.toString(),
    maxConcurrentTrials: objective.budget.maxConcurrentTrials.toString(),
    maxWallTimeSeconds: objective.budget.maxWallTimeSeconds.toString(),
    maxGpuHours: objective.budget.maxGpuHours.toString(),
    maxFailures: objective.budget.maxFailures.toString(),
    stopWhenTargetReached: objective.stopPolicy.stopWhenTargetReached,
    guardrailAction: objective.stopPolicy.guardrailAction,
    maxConsecutiveNoImprovement: objective.stopPolicy.maxConsecutiveNoImprovement?.toString() ?? '',
  };
}

function objectiveInput(
  projectId: string,
  objective: WorkspaceObjective | undefined,
  draft: ObjectiveDraft,
): SaveObjectiveInput {
  return {
    projectId,
    expectedEntityVersion: objective?.entityVersion ?? 0,
    goal: draft.goal.trim(),
    primaryMetric: {
      key: draft.metricKey.trim(),
      displayName: draft.metricDisplayName.trim(),
      direction: draft.direction,
      unit: draft.unit.trim() || null,
      aggregation: draft.aggregation,
      evaluatorHash: draft.evaluatorHash.trim(),
      datasetHash: draft.datasetHash.trim(),
      holdoutHash: draft.holdoutHash.trim() || null,
      baseline: optionalNumber(draft.baseline, 'Baseline'),
      target: optionalNumber(draft.target, 'Target'),
    },
    guardrails: [...(objective?.guardrails ?? [])],
    budget: {
      maxTrials: requiredNumber(draft.maxTrials, 'Max trials'),
      maxConcurrentTrials: requiredNumber(draft.maxConcurrentTrials, 'Max concurrent trials'),
      maxWallTimeSeconds: requiredNumber(draft.maxWallTimeSeconds, 'Max wall time'),
      maxGpuHours: requiredNumber(draft.maxGpuHours, 'Max GPU hours'),
      maxFailures: requiredNumber(draft.maxFailures, 'Max failures'),
    },
    stopPolicy: {
      stopWhenTargetReached: draft.stopWhenTargetReached,
      guardrailAction: draft.guardrailAction,
      maxConsecutiveNoImprovement: optionalNumber(
        draft.maxConsecutiveNoImprovement,
        'No-improvement limit',
      ),
    },
  };
}

function requiredNumber(value: string, label: string) {
  const parsed = Number(value);
  if (value.trim() === '' || !Number.isFinite(parsed))
    throw new Error(`${label} must be a number.`);
  return parsed;
}

function optionalNumber(value: string, label: string) {
  if (value.trim() === '') return null;
  return requiredNumber(value, label);
}
