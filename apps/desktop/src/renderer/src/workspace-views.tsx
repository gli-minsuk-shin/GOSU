import { uiText, useUiText } from '@gosu/ui/language';

import { useEffect, useState, type ReactNode } from 'react';

import type {
  ProjectRecord,
  SaveObjectiveInput,
  WorkspaceObjective,
  ObjectiveCommand,
} from '../../shared/workspace-contracts';
import { CardHead, describeError } from './ui-primitives';
import { hasPendingObjectiveIdentity } from '../../shared/project-research-plan-contracts';

export type WorkspaceTabId =
  | 'review'
  | 'chat'
  | 'model-lab'
  | 'calendar'
  | 'briefing-lab'
  | 'repository'
  | 'manuscript'
  | 'board'
  | 'objective'
  | 'experiments'
  | 'literature'
  | 'tasks'
  | 'lecture'
  | 'search'
  | 'connections'
  | 'usage'
  | 'notes';

export type ObjectiveDraft = {
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
  { id: 'model-lab', label: 'Model Lab', icon: '▰' },
  { id: 'calendar', label: 'Calendar', icon: '▦' },
  { id: 'briefing-lab', label: 'Briefing Lab', icon: '▤' },
  { id: 'repository', label: 'Repository', icon: '⌘' },
  { id: 'manuscript', label: 'Manuscript', icon: '¶' },
  { id: 'review', label: 'Critical Review', icon: '✓' },
  { id: 'board', label: 'Board', icon: '▦' },
  { id: 'objective', label: 'Goal & Metrics', icon: '◎' },
  { id: 'experiments', label: 'Experiments', icon: '⌁' },
  { id: 'literature', label: 'Literature', icon: '▤' },
  { id: 'tasks', label: 'Tasks', icon: '▦' },
  { id: 'lecture', label: 'Lecture notes & slides', icon: '▹' },
  { id: 'search', label: 'Search', icon: '⌕' },
  { id: 'connections', label: 'Connections', icon: '⌁' },
  { id: 'usage', label: 'Usage', icon: '◴' },
  { id: 'notes', label: 'Research Notes', icon: '◇' },
];

export const FUTURE_MODULES: ReadonlyArray<readonly [string, string]> = [];

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
  stopWhenTargetReached: false,
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
  onNewProject: (() => void) | null;
}) {
  const tab = WORKSPACE_TABS.find((item) => item.id === activeTab)!;
  const subtitles: Record<WorkspaceTabId, string> = {
    review: 'Evidence-grounded feedback on research direction and manuscript readiness.',
    calendar: 'Your shared personal calendar across projects.',
    'briefing-lab': 'Your shared personal briefing and saved paper library.',
    'model-lab': 'Design, inspect and discuss models in this project workspace.',
    chat: 'Talk with the linked Codex model and turn the conversation into reviewed project work.',
    repository:
      'Browse project files, review changes and history, and use bounded Git operations without a terminal.',
    manuscript:
      'Connect replaceable writing engines and capture immutable inbound checkpoints for future import and review.',
    board: 'Create work, move it through the research workflow, and keep every change locally.',
    objective:
      'Define a versioned goal, evaluation metric, reproducibility hashes, and hard experiment budget.',
    experiments:
      'Trace ideas into experiments, follow metric progress, and build a report from stored evidence.',
    literature:
      'Build a living evidence table, enrich it with AI, and move records safely between JSON, CSV, and BibTeX.',
    tasks:
      'Review and update the active tasks from every project in one Kanban board or To-do list.',
    lecture:
      'Combine papers and experiments across projects into editable lecture notes and timed talk slides.',
    search:
      'Search every non-trashed project locally and return to the original conversation, note, or workspace tab.',
    connections: 'Inspect real local capabilities. No connection state on this page is simulated.',
    usage:
      'Analyze locally recorded input and output tokens by project, Lecture generation, provider, and model.',
    notes:
      'Browse this project’s managed Obsidian research workspace. Note contents stay on this Mac.',
  };
  return (
    <header className={`page-heading page-heading-${activeTab}`}>
      <div>
        <span className="eyebrow">
          {activeProject?.name ?? uiText('Local workspace')} / {uiText(tab.label)}
        </span>
        <h1>{uiText(tab.label)}</h1>
        <p>{uiText(subtitles[activeTab])}</p>
      </div>
      {onNewProject && (
        <button type="button" className="secondary-button" onClick={onNewProject}>
          {uiText('＋ New project')}
        </button>
      )}
    </header>
  );
}

export function shouldShowActiveProjectPageHeading(activeTab: WorkspaceTabId) {
  return (
    activeTab !== 'chat' &&
    activeTab !== 'review' &&
    activeTab !== 'model-lab' &&
    activeTab !== 'calendar' &&
    activeTab !== 'briefing-lab' &&
    activeTab !== 'manuscript' &&
    activeTab !== 'notes' &&
    activeTab !== 'literature' &&
    activeTab !== 'lecture' &&
    activeTab !== 'search' &&
    activeTab !== 'connections'
  );
}

export function WorkspaceUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-card">
        <div className="empty-mark">!</div>
        <h1>{uiText('The local workspace could not be opened')}</h1>
        <p>
          {uiText(
            'Your project data was not replaced or reset. Retry after checking local storage.',
          )}
        </p>
        <button type="button" className="secondary-button" onClick={onRetry}>
          {uiText('Retry')}
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
        <h1>{uiText('Create your first research project')}</h1>
        <p>
          {uiText(
            'Projects and tasks are stored in the encrypted local workspace. You can start offline; pending collaboration changes remain visible.',
          )}
        </p>
        <ProjectForm busy={busy} submitLabel={uiText('Create project')} onCreate={onCreate} />
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
      <CardHead
        title={uiText('New project')}
        detail={uiText('Stored locally first')}
        id="new-project-title"
      />
      <ProjectForm busy={busy} submitLabel={uiText('Create project')} onCreate={onCreate}>
        <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
          {uiText('Cancel')}
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
  useUiText();
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
        {uiText('Project name')}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={120}
          placeholder={uiText('e.g. Robust retrieval evaluation')}
          autoFocus
          required
          disabled={busy}
        />
      </label>
      <label>
        {uiText('GitHub repository')} <span className="sr-only">{uiText('optional')}</span>
        <input
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
          maxLength={201}
          pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"
          placeholder={uiText('owner/repository · optional')}
          title={uiText(
            'Use the GitHub owner/repository format without a URL, token, or SSH address.',
          )}
          disabled={busy}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy || name.trim().length < 2}>
          {busy ? uiText('Saving…') : submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}

export function ObjectiveEditor({
  project,
  objective: incomingObjective,
  busy,
  onSave,
  onLock,
  onStartVersion,
}: {
  project: ProjectRecord;
  objective: WorkspaceObjective | undefined;
  busy: boolean;
  onSave: (input: SaveObjectiveInput) => Promise<boolean>;
  onLock: (input: ObjectiveCommand) => Promise<boolean>;
  onStartVersion: (input: ObjectiveCommand) => Promise<boolean>;
}) {
  useUiText();
  const [objective, setObjective] = useState(incomingObjective);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<ObjectiveDraft>(() => objectiveToDraft(objective));
  const revisionChanged =
    (incomingObjective?.id ?? null) !== (objective?.id ?? null) ||
    (incomingObjective?.entityVersion ?? 0) !== (objective?.entityVersion ?? 0);
  useEffect(() => {
    if (revisionChanged && !dirty) {
      setObjective(incomingObjective);
      setDraft(objectiveToDraft(incomingObjective));
    }
  }, [revisionChanged, dirty, incomingObjective]);
  const hasTarget = draft.target.trim() !== '';
  const pendingIdentity = objective ? hasPendingObjectiveIdentity(objective.primaryMetric) : false;

  const setField = <Key extends keyof ObjectiveDraft>(key: Key, value: ObjectiveDraft[Key]) => {
    setDirty(true);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="workspace-grid">
      <article className="card">
        <CardHead
          title={uiText('Versioned research objective')}
          detail={
            objective
              ? uiText('Objective v{objectiveVersion} · entity v{entityVersion}', {
                  objectiveVersion: objective.objectiveVersion,
                  entityVersion: objective.entityVersion,
                })
              : uiText('No objective saved yet')
          }
        />
        {revisionChanged && dirty && (
          <div className="notice" role="status">
            <span>
              {uiText('A newer plan changed this objective. Your unsaved draft is preserved.')}
            </span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setObjective(incomingObjective);
                setDraft(objectiveToDraft(incomingObjective));
                setDirty(false);
              }}
            >
              {uiText('Discard draft and load latest')}
            </button>
          </div>
        )}
        <form
          className="objective-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || objective?.locked || revisionChanged) return;
            try {
              void onSave(buildObjectiveInput(project.id, objective, draft)).then((saved) => {
                if (saved) setDirty(false);
              });
            } catch (error) {
              const target = event.currentTarget;
              target.setAttribute('data-error', describeError(error));
              target.reportValidity();
            }
          }}
        >
          <label className="full-width">
            {uiText('Research goal')}
            <textarea
              value={draft.goal}
              onChange={(event) => setField('goal', event.target.value)}
              minLength={10}
              maxLength={4_000}
              placeholder={uiText(
                'State the outcome the experiment should improve and the boundary it must preserve.',
              )}
              required
              disabled={busy || objective?.locked}
            />
          </label>

          <fieldset className="objective-section full-width">
            <legend className="sr-only">{uiText('Primary metric')}</legend>
            <h3>{uiText('Primary metric')}</h3>
            <div className="field-grid">
              <label>
                {uiText('Metric key')}
                <input
                  value={draft.metricKey}
                  onChange={(event) => setField('metricKey', event.target.value)}
                  maxLength={128}
                  placeholder={uiText('validation_accuracy')}
                  required
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                {uiText('Display name')}
                <input
                  value={draft.metricDisplayName}
                  onChange={(event) => setField('metricDisplayName', event.target.value)}
                  maxLength={256}
                  placeholder={uiText('Validation accuracy')}
                  required
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                {uiText('Direction')}
                <select
                  value={draft.direction}
                  onChange={(event) =>
                    setField('direction', event.target.value as ObjectiveDraft['direction'])
                  }
                  disabled={busy || objective?.locked}
                >
                  <option value="maximize">{uiText('Maximize')}</option>
                  <option value="minimize">{uiText('Minimize objective')}</option>
                </select>
              </label>
              <label>
                {uiText('Aggregation')}
                <select
                  value={draft.aggregation}
                  onChange={(event) =>
                    setField('aggregation', event.target.value as ObjectiveDraft['aggregation'])
                  }
                  disabled={busy || objective?.locked}
                >
                  <option value="mean">{uiText('Mean')}</option>
                  <option value="median">{uiText('Median')}</option>
                  <option value="minimum">{uiText('Minimum')}</option>
                  <option value="maximum">{uiText('Maximum')}</option>
                  <option value="last">{uiText('Last')}</option>
                </select>
              </label>
              <label>
                {uiText('Unit')} <span className="sr-only">{uiText('optional')}</span>
                <input
                  value={draft.unit}
                  onChange={(event) => setField('unit', event.target.value)}
                  maxLength={64}
                  placeholder={uiText('%, ms, score · optional')}
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                {uiText('Baseline')} <span className="sr-only">{uiText('optional')}</span>
                <input
                  type="number"
                  step="any"
                  value={draft.baseline}
                  onChange={(event) => setField('baseline', event.target.value)}
                  placeholder={uiText('Optional')}
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                {uiText('Target')} <span className="sr-only">{uiText('optional')}</span>
                <input
                  type="number"
                  step="any"
                  value={draft.target}
                  onChange={(event) => {
                    const target = event.target.value;
                    setDirty(true);
                    setDraft((current) => ({
                      ...current,
                      target,
                      stopWhenTargetReached:
                        target.trim() === '' ? false : current.stopWhenTargetReached,
                    }));
                  }}
                  placeholder={uiText('Optional')}
                  disabled={busy || objective?.locked}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="objective-section full-width">
            <legend className="sr-only">{uiText('Reproducibility hashes')}</legend>
            <h3>{uiText('Reproducibility hashes')}</h3>
            <p>
              {uiText(
                'Use immutable content identifiers. GOSU does not upload the underlying files.',
              )}
            </p>
            <div className="field-grid">
              <label>
                {uiText('Evaluator hash')}
                <input
                  value={draft.evaluatorHash}
                  onChange={(event) => setField('evaluatorHash', event.target.value)}
                  minLength={8}
                  maxLength={160}
                  placeholder={uiText('sha256:… or commit hash')}
                  required
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                {uiText('Dataset hash')}
                <input
                  value={draft.datasetHash}
                  onChange={(event) => setField('datasetHash', event.target.value)}
                  minLength={8}
                  maxLength={160}
                  placeholder={uiText('sha256:…')}
                  required
                  disabled={busy || objective?.locked}
                />
              </label>
              <label>
                {uiText('Holdout hash')} <span className="sr-only">{uiText('optional')}</span>
                <input
                  value={draft.holdoutHash}
                  onChange={(event) => setField('holdoutHash', event.target.value)}
                  minLength={8}
                  maxLength={160}
                  placeholder={uiText('Optional')}
                  disabled={busy || objective?.locked}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="objective-section">
            <legend className="sr-only">{uiText('Experiment budget')}</legend>
            <h3>{uiText('Campaign budget')}</h3>
            <p>
              {uiText(
                'Saved with the objective. The Runner will enforce these campaign-wide limits; the current Project Chat foreground path only enforces its per-run timeout.',
              )}
            </p>
            <div className="field-grid">
              <NumberField
                label={uiText('Max trials')}
                value={draft.maxTrials}
                onChange={(value) => setField('maxTrials', value)}
                min={1}
                integer
                disabled={busy || Boolean(objective?.locked)}
              />
              <NumberField
                label={uiText('Concurrent trials')}
                value={draft.maxConcurrentTrials}
                onChange={(value) => setField('maxConcurrentTrials', value)}
                min={1}
                max={Number(draft.maxTrials) || undefined}
                integer
                disabled={busy || Boolean(objective?.locked)}
              />
              <NumberField
                label={uiText('Wall time · seconds')}
                value={draft.maxWallTimeSeconds}
                onChange={(value) => setField('maxWallTimeSeconds', value)}
                min={1}
                integer
                disabled={busy || Boolean(objective?.locked)}
              />
              <NumberField
                label={uiText('GPU hours')}
                value={draft.maxGpuHours}
                onChange={(value) => setField('maxGpuHours', value)}
                min={0}
                disabled={busy || Boolean(objective?.locked)}
              />
              <NumberField
                label={uiText('Max failures')}
                value={draft.maxFailures}
                onChange={(value) => setField('maxFailures', value)}
                min={0}
                integer
                disabled={busy || Boolean(objective?.locked)}
              />
            </div>
          </fieldset>

          <fieldset className="objective-section">
            <legend className="sr-only">{uiText('Stop policy')}</legend>
            <h3>{uiText('Stop policy')}</h3>
            <label className="checkbox-label">
              <input
                id="objective-stop-when-target-reached"
                type="checkbox"
                checked={hasTarget && draft.stopWhenTargetReached}
                onChange={(event) => setField('stopWhenTargetReached', event.target.checked)}
                disabled={busy || objective?.locked || !hasTarget}
                aria-describedby="objective-stop-when-target-reached-help"
              />
              {uiText('Stop when the target is reached')}
            </label>
            <p id="objective-stop-when-target-reached-help">
              {hasTarget
                ? uiText(
                    'Optional. The Runner applies this policy when it schedules campaign trials.',
                  )
                : uiText(
                    'No target is set, so exploratory and comparable runs can still proceed. Campaign budgets, guardrails, no-improvement limits, and Stop or Kill are enforced after the Runner is connected; the current Project Chat path only enforces its per-run timeout.',
                  )}
            </p>
            <label>
              {uiText('Guardrail action')}
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
                <option value="pause">{uiText('Pause')}</option>
                <option value="stop">{uiText('Stop')}</option>
                <option value="fail">{uiText('Fail')}</option>
              </select>
            </label>
            <NumberField
              label={uiText('No-improvement limit · optional')}
              value={draft.maxConsecutiveNoImprovement}
              onChange={(value) => setField('maxConsecutiveNoImprovement', value)}
              min={1}
              integer
              required={false}
              disabled={busy || Boolean(objective?.locked)}
            />
          </fieldset>

          <div className="objective-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={busy || objective?.locked || revisionChanged}
            >
              {busy
                ? uiText('Saving…')
                : objective
                  ? uiText('Save changes')
                  : uiText('Save objective')}
            </button>
            <span className="task-version">{uiText('Saved in encrypted local storage')}</span>
          </div>
        </form>
      </article>

      <aside className="card">
        <CardHead
          title={uiText('Revision control')}
          detail={uiText('Explicit, versioned changes')}
        />
        <div className="objective-status">
          <div>
            <strong>
              {objective
                ? uiText('Objective v{objectiveVersion}', {
                    objectiveVersion: objective.objectiveVersion,
                  })
                : uiText('Not configured')}
            </strong>
            <p>
              {objective?.locked
                ? uiText(
                    'Frozen revisions cannot be edited. Start a new revision to change the metric or budget.',
                  )
                : uiText('An editable local revision. Review every field before freezing it.')}
            </p>
          </div>
          {objective && (
            <span className={objective.locked ? 'locked-label' : 'task-version'}>
              {objective.locked
                ? uiText('FROZEN LOCALLY')
                : uiText('ENTITY V{entityVersion}', { entityVersion: objective.entityVersion })}
            </span>
          )}
        </div>
        <div className="objective-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={
              busy || !objective || objective.locked || pendingIdentity || dirty || revisionChanged
            }
            onClick={() =>
              objective &&
              void onLock({
                projectId: project.id,
                expectedEntityVersion: objective.entityVersion,
                expectedObjectiveId: objective.id,
                expectedObjectiveVersion: objective.objectiveVersion,
              })
            }
          >
            {uiText('Freeze local revision')}
          </button>
          {pendingIdentity && (
            <small role="status">
              {uiText(
                'Plan saved. Supply evaluator and dataset identities, then reapply and activate the plan from Project Chat before comparable runs.',
              )}
            </small>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !objective?.locked || dirty || revisionChanged}
            onClick={() =>
              objective &&
              void onStartVersion({
                projectId: project.id,
                expectedEntityVersion: objective.entityVersion,
                expectedObjectiveId: objective.id,
                expectedObjectiveVersion: objective.objectiveVersion,
              })
            }
          >
            {uiText('Start new revision')}
          </button>
        </div>
        <div className="boundary-note">
          {uiText(
            'Guardrails default to an empty list in this first usable slice. Metric, hashes, budget and stop policy are still persisted as one versioned objective.',
          )}
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
    stopWhenTargetReached:
      objective.primaryMetric.target !== null && objective.stopPolicy.stopWhenTargetReached,
    guardrailAction: objective.stopPolicy.guardrailAction,
    maxConsecutiveNoImprovement: objective.stopPolicy.maxConsecutiveNoImprovement?.toString() ?? '',
  };
}

export function buildObjectiveInput(
  projectId: string,
  objective: WorkspaceObjective | undefined,
  draft: ObjectiveDraft,
): SaveObjectiveInput {
  const target = optionalNumber(draft.target, 'Target');
  return {
    projectId,
    expectedEntityVersion: objective?.entityVersion ?? 0,
    expectedObjectiveId: objective?.id ?? null,
    expectedObjectiveVersion: objective?.objectiveVersion ?? null,
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
      target,
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
      stopWhenTargetReached: target !== null && draft.stopWhenTargetReached,
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
