import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import type {
  CreateExperimentIdeaInput,
  ExperimentIdea,
  ExperimentIdeaOutcome,
  ExperimentLoggingCustomField,
  ExperimentLoggingFieldCategory,
  ExperimentLoggingFieldType,
  ExperimentLoggingRequiredAt,
  ExperimentLoggingTemplate,
  ExperimentMetricPoint,
  ExperimentRun,
  ExperimentRunLogChunk,
  ExperimentRunStatus,
  ExperimentWorkspaceEvent,
  ExperimentWorkspaceSnapshot,
  ListExperimentWorkspaceInput,
  ReadExperimentRunLogInput,
  RecordExperimentMetricInput,
  ReviseExperimentLoggingTemplateInput,
  UpdateExperimentIdeaInput,
} from '../../shared/experiment-workspace-contracts';
import {
  EXPERIMENT_IDEA_OUTCOMES,
  EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  EXPERIMENT_MAX_LOGGING_FIELDS,
  ExperimentLoggingCustomFieldsSchema,
} from '../../shared/experiment-workspace-contracts';
import type { ProjectRecord, WorkspaceObjective } from '../../shared/workspace-contracts';
import {
  buildExperimentReportSummary,
  buildExperimentTrajectory,
  buildIdeaLineageLabels,
  formatExperimentElapsed,
  formatExperimentMetric,
  groupExperimentMetricSeries,
  layoutIdeaLineage,
  type ExperimentMetricSeries,
} from './experiment-trajectory-model';
import type { SearchTargetRequest } from './search-results-model';
import './experiments-view.css';

export interface ExperimentsViewAdapter {
  list: (input: ListExperimentWorkspaceInput) => Promise<ExperimentWorkspaceSnapshot>;
  createIdea: (input: CreateExperimentIdeaInput) => Promise<ExperimentIdea>;
  updateIdea: (input: UpdateExperimentIdeaInput) => Promise<ExperimentIdea>;
  recordMetric: (input: RecordExperimentMetricInput) => Promise<ExperimentMetricPoint>;
  reviseLoggingTemplate: (
    input: ReviseExperimentLoggingTemplateInput,
  ) => Promise<ExperimentLoggingTemplate>;
  readRunLog?: (input: ReadExperimentRunLogInput) => Promise<ExperimentRunLogChunk>;
  onEvent: (listener: (event: ExperimentWorkspaceEvent) => void) => () => void;
}

export interface ExperimentsViewProps {
  project: ProjectRecord;
  objective: WorkspaceObjective | undefined;
  adapter: ExperimentsViewAdapter;
  onOpenObjective: () => void;
  searchTarget?: SearchTargetRequest | null;
  onSearchTargetHandled?: (requestId: number) => void;
}

type ExperimentTab = 'overview' | 'runs' | 'logging' | 'ideas' | 'report';

const EXPERIMENT_TABS: ReadonlyArray<{ id: ExperimentTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs' },
  { id: 'logging', label: 'Logging' },
  { id: 'ideas', label: 'Idea map' },
  { id: 'report', label: 'Report' },
];

const LOGGING_FIELD_TYPES: readonly ExperimentLoggingFieldType[] = [
  'number',
  'integer',
  'string',
  'boolean',
];
const LOGGING_FIELD_CATEGORIES: readonly ExperimentLoggingFieldCategory[] = [
  'metric',
  'parameter',
  'progress',
  'resource',
  'artifact',
  'note',
];
const LOGGING_REQUIRED_AT: readonly ExperimentLoggingRequiredAt[] = [
  'run-start',
  'progress',
  'run-end',
  'summary',
];

const OUTCOME_PRESENTATION: Readonly<
  Record<ExperimentIdeaOutcome, { label: string; symbol: string; description: string }>
> = {
  planned: { label: 'Planned', symbol: '○', description: 'Not started' },
  running: { label: 'Running', symbol: '↻', description: 'Work is in progress' },
  success: { label: 'Success', symbol: '✓', description: 'Met the reviewed success rule' },
  partial: {
    label: 'Partial',
    symbol: '◐',
    description: 'Improved, but did not fully meet the rule',
  },
  failed: { label: 'Failed', symbol: '×', description: 'Did not meet the reviewed rule' },
  inconclusive: { label: 'Inconclusive', symbol: '?', description: 'Evidence is insufficient' },
};

function experimentErrorMessage(error: unknown) {
  const code = error instanceof Error ? (error.message.split(':')[0] ?? '') : '';
  const messages: Record<string, string> = {
    invalid_experiment_input: 'Check the experiment fields and try again.',
    experiment_unavailable:
      'The local experiment workspace is unavailable. Existing project work was not replaced.',
    experiment_project_not_found: 'This project no longer exists. Reload the workspace.',
    experiment_project_unavailable: 'Restore this project before changing experiments.',
    experiment_idea_not_found: 'This idea no longer exists. Refresh the experiment workspace.',
    experiment_parent_not_found: 'The parent idea no longer exists. Choose another parent.',
    experiment_idea_conflict:
      'This idea changed since it was opened. GOSU did not overwrite the newer version.',
    experiment_idea_limit_reached: 'This project has reached its local idea limit.',
    experiment_metric_limit_reached: 'This project has reached its local metric-record limit.',
    experiment_objective_required:
      'Freeze a Goal & Metrics objective before recording comparable results.',
    experiment_logging_template_conflict:
      'The logging template changed while you were editing. GOSU did not overwrite the newer version.',
    experiment_logging_template_limit_reached:
      'This project has reached its local logging-template revision limit.',
    experiment_run_not_found: 'This run no longer exists. Refresh the experiment workspace.',
    experiment_run_conflict:
      'This run changed since it was opened. GOSU did not overwrite the newer state.',
    experiment_run_limit_reached: 'This project has reached its local run limit.',
    experiment_run_transition_invalid: 'That run state change is not valid from its current state.',
    experiment_run_log_source_invalid:
      'The log reference could not be validated. Raw log content was not imported.',
    experiment_run_log_access_required:
      'Enable Trusted workspace for this project server before opening logs in Experiments. The read remains project-scoped and audited.',
    experiment_run_log_changed:
      'The server log changed after validation. GOSU did not display it as the recorded experiment evidence.',
    experiment_run_log_unavailable:
      'The referenced server log is unavailable. The saved run summary remains unchanged.',
  };
  return messages[code] ?? 'The experiment operation could not be completed.';
}

function outcomeLabel(outcome: ExperimentIdeaOutcome) {
  return OUTCOME_PRESENTATION[outcome].label;
}

function outcomeClass(outcome: ExperimentIdeaOutcome) {
  return `experiment-outcome-${outcome}`;
}

function shortHash(hash: string | null) {
  if (hash === null) return 'None';
  return hash.length <= 14 ? hash : `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function ideaTitle(ideas: readonly ExperimentIdea[], ideaId: string) {
  return ideas.find(({ id }) => id === ideaId)?.title ?? 'Unknown idea';
}

function markerKeyDown(event: KeyboardEvent<SVGGElement>, select: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select();
}

const RUN_PRESENTATION: Readonly<
  Record<ExperimentRunStatus, { label: string; tone: 'neutral' | 'active' | 'good' | 'bad' }>
> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'active' },
  verifying: { label: 'Verifying', tone: 'active' },
  succeeded: { label: 'Succeeded', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  lost: { label: 'Lost', tone: 'bad' },
};

export function formatExperimentRunProgress(run: ExperimentRun) {
  if (run.progressCurrent === null) return 'Not reported';
  if (run.progressTotal === null) return `${run.progressCurrent} · total not reported`;
  const percentage = Math.round((run.progressCurrent / run.progressTotal) * 100);
  return `${run.progressCurrent} / ${run.progressTotal} (${percentage}%)`;
}

export function summarizeExperimentRuns(runs: readonly ExperimentRun[]) {
  return {
    active: runs.filter(({ status }) => status === 'running' || status === 'verifying').length,
    queued: runs.filter(({ status }) => status === 'queued').length,
    completed: runs.filter(({ status }) => status === 'succeeded' || status === 'cancelled').length,
    needsAttention: runs.filter(({ status }) => status === 'failed' || status === 'lost').length,
  };
}

function loggingExampleValue(field: ExperimentLoggingCustomField): string | number | boolean {
  if (field.type === 'number') return 0.875;
  if (field.type === 'integer') return 12;
  if (field.type === 'boolean') return true;
  if (field.category === 'artifact') return 'artifact-reference';
  return `example-${field.key}`;
}

export function buildExperimentLoggingExample(template: ExperimentLoggingTemplate) {
  const lifecycles = ['run-start', 'progress', 'run-end', 'summary'] as const;
  return lifecycles
    .map((eventType, index) => {
      const example: Record<string, string | number | boolean | null> = {
        schema_version: 1,
        template_version: template.version,
        objective_version: null,
        occurred_at: `2026-01-01T00:00:0${index}.000Z`,
        event_type: eventType,
        sequence: index + 1,
        run_id: 'run-example',
        trial_id: 'trial-example',
        status: eventType === 'run-start' || eventType === 'progress' ? 'running' : 'succeeded',
        server_label: 'linked-server',
      };
      for (const field of template.customFields) {
        if (field.requiredAt.includes(eventType)) example[field.key] = loggingExampleValue(field);
      }
      return JSON.stringify(example);
    })
    .join('\n');
}

export function validateExperimentLoggingFields(fields: readonly ExperimentLoggingCustomField[]) {
  const issues: string[] = [];
  if (fields.length > EXPERIMENT_MAX_LOGGING_FIELDS) {
    issues.push(`A template can contain at most ${EXPERIMENT_MAX_LOGGING_FIELDS} custom fields.`);
  }
  const counts = new Map<string, number>();
  for (const field of fields) counts.set(field.key, (counts.get(field.key) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicates.length > 0) {
    issues.push(`Field keys must be unique: ${duplicates.join(', ')}.`);
  }
  const parsed = ExperimentLoggingCustomFieldsSchema.safeParse(fields);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const location = typeof issue.path[0] === 'number' ? `Field ${issue.path[0] + 1}: ` : '';
      const message = `${location}${issue.message}.`;
      if (!issues.includes(message)) issues.push(message);
    }
  }
  return issues;
}

export function ExperimentsView({
  project,
  objective,
  adapter,
  onOpenObjective,
  searchTarget = null,
  onSearchTargetHandled = () => undefined,
}: ExperimentsViewProps) {
  const [snapshot, setSnapshot] = useState<ExperimentWorkspaceSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ExperimentTab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [selectedMetricPointId, setSelectedMetricPointId] = useState<string | null>(null);
  const [selectedSeriesKey, setSelectedSeriesKey] = useState<string | null>(null);
  const [ideaComposer, setIdeaComposer] = useState<
    { kind: 'root'; parent: null } | { kind: 'child'; parent: ExperimentIdea } | null
  >(null);
  const [pendingSearchFocus, setPendingSearchFocus] = useState<SearchTargetRequest | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const next = await adapter.list({ projectId: project.id });
        setSnapshot(next);
        setError(null);
        setSelectedIdeaId((current) =>
          current && next.ideas.some(({ id }) => id === current)
            ? current
            : (next.ideas[0]?.id ?? null),
        );
      } catch (loadError) {
        setError(experimentErrorMessage(loadError));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [adapter, project.id],
  );

  useEffect(() => {
    setSnapshot(null);
    setSelectedIdeaId(null);
    setSelectedMetricPointId(null);
    setSelectedSeriesKey(null);
    setIdeaComposer(null);
    void load(true);
  }, [load, project.id]);

  useEffect(
    () =>
      adapter.onEvent((event) => {
        if (event.projectId === project.id) void load();
      }),
    [adapter, load, project.id],
  );

  const ideas = snapshot?.ideas ?? [];
  const runs = snapshot?.runs ?? [];
  const metricSeries = useMemo(
    () => groupExperimentMetricSeries(snapshot?.metricPoints ?? []),
    [snapshot?.metricPoints],
  );

  useEffect(() => {
    if (metricSeries.length === 0) {
      setSelectedSeriesKey(null);
      return;
    }
    if (selectedSeriesKey && metricSeries.some(({ key }) => key === selectedSeriesKey)) return;
    const objectiveSeries = objective
      ? metricSeries.find(
          (series) =>
            series.objectiveId === objective.id &&
            series.objectiveVersion === objective.objectiveVersion &&
            series.metricKey === objective.primaryMetric.key &&
            series.evaluatorHash === objective.primaryMetric.evaluatorHash &&
            series.datasetHash === objective.primaryMetric.datasetHash &&
            series.holdoutHash === objective.primaryMetric.holdoutHash,
        )
      : undefined;
    setSelectedSeriesKey((objectiveSeries ?? metricSeries[0]!).key);
  }, [metricSeries, objective, selectedSeriesKey]);

  const selectedSeries =
    metricSeries.find(({ key }) => key === selectedSeriesKey) ?? metricSeries[0] ?? null;
  const selectedIdea = ideas.find(({ id }) => id === selectedIdeaId) ?? null;

  useEffect(() => {
    if (!searchTarget || !snapshot) return;
    if (!ideas.some(({ id }) => id === searchTarget.targetId)) {
      setError(
        'The searched experiment idea is no longer available. Refresh Search and try again.',
      );
      onSearchTargetHandled(searchTarget.requestId);
      return;
    }
    setActiveTab('ideas');
    setSelectedIdeaId(searchTarget.targetId);
    setPendingSearchFocus(searchTarget);
  }, [ideas, onSearchTargetHandled, searchTarget, snapshot]);

  useLayoutEffect(() => {
    if (!pendingSearchFocus || activeTab !== 'ideas') return;
    const element = document.getElementById(
      `experiment-idea-inspector-${pendingSearchFocus.targetId}`,
    );
    if (!element) return;
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    element.focus({ preventScroll: true });
    onSearchTargetHandled(pendingSearchFocus.requestId);
    setPendingSearchFocus(null);
  }, [activeTab, onSearchTargetHandled, pendingSearchFocus, selectedIdeaId]);

  const createIdea = async (draft: {
    parentIdeaId: string | null;
    title: string;
    hypothesis: string;
    phase: string;
  }) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const created = await adapter.createIdea({
        projectId: project.id,
        parentIdeaId: draft.parentIdeaId,
        title: draft.title,
        hypothesis: draft.hypothesis,
        phase: draft.phase,
      });
      await load();
      setSelectedIdeaId(created.id);
      setIdeaComposer(null);
      setNotice(
        draft.parentIdeaId
          ? `Created a child idea: ${created.title}.`
          : `Created ${created.title}.`,
      );
      return true;
    } catch (createError) {
      setError(experimentErrorMessage(createError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateIdea = async (input: UpdateExperimentIdeaInput) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const updated = await adapter.updateIdea(input);
      await load();
      setSelectedIdeaId(updated.id);
      setNotice(`Updated ${updated.title}.`);
      return true;
    } catch (updateError) {
      setError(experimentErrorMessage(updateError));
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const recordMetric = async (value: number, trialId: string) => {
    if (busy || !selectedIdea) return false;
    setBusy(true);
    setError(null);
    try {
      const point = await adapter.recordMetric({
        projectId: project.id,
        ideaId: selectedIdea.id,
        value,
        ...(trialId.trim() ? { trialId: trialId.trim() } : {}),
      });
      await load();
      setSelectedMetricPointId(point.id);
      setSelectedSeriesKey(groupExperimentMetricSeries([point])[0]?.key ?? selectedSeriesKey);
      setNotice(`Recorded ${point.metricDisplayName} for ${selectedIdea.title}.`);
      return true;
    } catch (recordError) {
      setError(experimentErrorMessage(recordError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reviseLoggingTemplate = async (customFields: readonly ExperimentLoggingCustomField[]) => {
    if (busy || !snapshot) return false;
    setBusy(true);
    setError(null);
    try {
      const revised = await adapter.reviseLoggingTemplate({
        projectId: project.id,
        expectedVersion: snapshot.loggingTemplate.version,
        customFields: [...customFields],
      });
      await load();
      setNotice(`Saved logging template version ${revised.version}.`);
      return true;
    } catch (revisionError) {
      setError(experimentErrorMessage(revisionError));
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const selectTabFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: ExperimentTab,
  ) => {
    const currentIndex = EXPERIMENT_TABS.findIndex(({ id }) => id === current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % EXPERIMENT_TABS.length;
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + EXPERIMENT_TABS.length) % EXPERIMENT_TABS.length;
    }
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = EXPERIMENT_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = EXPERIMENT_TABS[nextIndex]!;
    setActiveTab(next.id);
    requestAnimationFrame(() => {
      tabListRef.current?.querySelector<HTMLButtonElement>(`#experiment-tab-${next.id}`)?.focus();
    });
  };

  const runSummary = summarizeExperimentRuns(runs);

  return (
    <section className="experiments-shell" aria-label={`${project.name} experiments`}>
      <header className="experiments-runtime-card">
        <div className="experiments-runtime-copy">
          <span className="eyebrow">LOCAL EXPERIMENT WORKSPACE</span>
          <h2>Experiment workspace</h2>
        </div>
        <div className="experiments-runtime-status" aria-label="Experiment connection status">
          <span className="experiment-status-pill local">
            <i />
            Local live
          </span>
          <span className="experiment-status-pill runner">
            <i />
            Runner not connected
          </span>
          <span className="experiment-status-pill">
            {runSummary.active} active · {runSummary.queued} queued
          </span>
          {objective?.locked && (
            <span
              className="experiment-status-pill"
              title={
                objective.primaryMetric.target === null
                  ? 'A target threshold is optional. Saved campaign budgets and stop policies are enforced after the Runner is connected.'
                  : undefined
              }
            >
              {objective.primaryMetric.displayName} ·{' '}
              {objective.primaryMetric.target === null
                ? 'No target'
                : `Target ${formatExperimentMetric(objective.primaryMetric.target, objective.primaryMetric.unit)}`}
            </span>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() => void load(true)}
          >
            Refresh
          </button>
        </div>
      </header>

      {!objective?.locked && (
        <div className="experiments-objective-notice" role="status">
          <div>
            <strong>
              {objective
                ? 'Objective not frozen — comparable runs unavailable'
                : 'No objective — exploratory runs remain available'}
            </strong>
            <span>
              A numeric target value is optional, and exploratory runs do not need a frozen
              objective. Comparable results still require a frozen primary metric, evaluator,
              dataset, and holdout snapshot.
            </span>
          </div>
          <button type="button" className="secondary-button" onClick={onOpenObjective}>
            Open Goal & Metrics
          </button>
        </div>
      )}

      {error && (
        <div className="notice error experiments-error" role="alert">
          <span>{error}</span>
          <button type="button" className="ghost-button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>

      <div
        ref={tabListRef}
        className="experiment-tabs"
        role="tablist"
        aria-label="Experiment views"
      >
        {EXPERIMENT_TABS.map((tab) => (
          <button
            key={tab.id}
            id={`experiment-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-controls={`experiment-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => selectTabFromKeyboard(event, tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && !snapshot ? (
        <div className="experiments-loading" role="status">
          Opening local experiment records…
        </div>
      ) : (
        <>
          {activeTab === 'overview' && (
            <TrajectoryPanel
              project={project}
              objective={objective}
              ideas={ideas}
              series={metricSeries}
              selectedSeries={selectedSeries}
              selectedSeriesKey={selectedSeriesKey}
              selectedIdeaId={selectedIdeaId}
              selectedMetricPointId={selectedMetricPointId}
              busy={busy}
              runs={runs}
              onSelectSeries={setSelectedSeriesKey}
              onSelectIdea={setSelectedIdeaId}
              onSelectMetricPoint={setSelectedMetricPointId}
              onRecordMetric={recordMetric}
              onOpenObjective={onOpenObjective}
              onOpenRuns={() => setActiveTab('runs')}
            />
          )}
          {activeTab === 'runs' && (
            <ExperimentRunsPanel
              projectId={project.id}
              ideas={ideas}
              runs={runs}
              readRunLog={adapter.readRunLog}
            />
          )}
          {activeTab === 'logging' && snapshot && (
            <ExperimentLoggingPanel
              key={`${snapshot.loggingTemplate.id}:${snapshot.loggingTemplate.version}`}
              template={snapshot.loggingTemplate}
              busy={busy}
              onSave={reviseLoggingTemplate}
            />
          )}
          {activeTab === 'ideas' && (
            <IdeaMapPanel
              ideas={ideas}
              selectedIdea={selectedIdea}
              busy={busy}
              composer={ideaComposer}
              onComposer={setIdeaComposer}
              onSelectIdea={setSelectedIdeaId}
              onCreateIdea={createIdea}
              onUpdateIdea={updateIdea}
            />
          )}
          {activeTab === 'report' && (
            <ExperimentReportPanel
              ideas={ideas}
              series={metricSeries}
              selectedSeries={selectedSeries}
            />
          )}
        </>
      )}
    </section>
  );
}

function SeriesPicker({
  series,
  selectedKey,
  onSelect,
}: {
  series: readonly ExperimentMetricSeries[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (series.length === 0) return null;
  return (
    <label className="experiment-series-picker">
      Comparable series
      <select
        value={selectedKey ?? series[0]!.key}
        onChange={(event) => onSelect(event.target.value)}
      >
        {series.map((item) => (
          <option key={item.key} value={item.key}>
            {item.metricDisplayName} · Objective v{item.objectiveVersion} · {item.aggregation} ·{' '}
            {new Date(item.latestRecordedAt).toLocaleDateString()}
          </option>
        ))}
      </select>
    </label>
  );
}

function TrajectoryPanel({
  project,
  objective,
  ideas,
  series,
  selectedSeries,
  selectedSeriesKey,
  selectedIdeaId,
  selectedMetricPointId,
  busy,
  runs,
  onSelectSeries,
  onSelectIdea,
  onSelectMetricPoint,
  onRecordMetric,
  onOpenObjective,
  onOpenRuns,
}: {
  project: ProjectRecord;
  objective: WorkspaceObjective | undefined;
  ideas: readonly ExperimentIdea[];
  series: readonly ExperimentMetricSeries[];
  selectedSeries: ExperimentMetricSeries | null;
  selectedSeriesKey: string | null;
  selectedIdeaId: string | null;
  selectedMetricPointId: string | null;
  busy: boolean;
  runs: readonly ExperimentRun[];
  onSelectSeries: (key: string) => void;
  onSelectIdea: (ideaId: string) => void;
  onSelectMetricPoint: (pointId: string) => void;
  onRecordMetric: (value: number, trialId: string) => Promise<boolean>;
  onOpenObjective: () => void;
  onOpenRuns: () => void;
}) {
  const chart = useMemo(() => buildExperimentTrajectory(selectedSeries), [selectedSeries]);
  const ideaById = useMemo(() => new Map(ideas.map((idea) => [idea.id, idea])), [ideas]);
  const selectedPoint =
    selectedSeries?.points.find(({ id }) => id === selectedMetricPointId) ?? null;

  return (
    <div
      id="experiment-panel-overview"
      role="tabpanel"
      aria-labelledby="experiment-tab-overview"
      className="experiment-panel experiment-trajectory-layout"
    >
      <article className="experiment-card experiment-chart-card">
        <header className="experiment-card-head">
          <div>
            <span className="eyebrow">PRIMARY METRIC OVER TIME</span>
            <h2>
              {selectedSeries?.metricDisplayName ??
                objective?.primaryMetric.displayName ??
                'No recorded metric'}
            </h2>
            <p>
              Solid line: recorded result · dashed line: direction-aware best so far. Select a point
              for its idea and provenance.
            </p>
          </div>
          <SeriesPicker series={series} selectedKey={selectedSeriesKey} onSelect={onSelectSeries} />
        </header>

        {selectedSeries ? (
          <TrajectorySvg
            chart={chart}
            series={selectedSeries}
            ideaById={ideaById}
            selectedPointId={selectedMetricPointId}
            onSelectPoint={(point) => {
              onSelectMetricPoint(point.id);
              onSelectIdea(point.ideaId);
            }}
          />
        ) : (
          <div className="experiment-chart-empty">
            <strong>No comparable results yet</strong>
            <span>
              Create an idea, freeze Goal & Metrics, then record a result. GOSU does not insert
              demonstration values into a real project.
            </span>
          </div>
        )}

        {selectedSeries && (
          <details className="experiment-data-disclosure">
            <summary>View metric data table</summary>
            <div className="experiment-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Idea</th>
                    <th scope="col">Result</th>
                    <th scope="col">Source</th>
                    <th scope="col">Trial</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSeries.points.map((point) => (
                    <tr key={point.id} className={selectedPoint?.id === point.id ? 'selected' : ''}>
                      <td>{formatDateTime(point.recordedAt)}</td>
                      <td>{ideaTitle(ideas, point.ideaId)}</td>
                      <td>{formatExperimentMetric(point.value, point.unit)}</td>
                      <td>
                        {point.source === 'manual'
                          ? 'Manual local entry'
                          : 'Verified tracked-run summary'}
                      </td>
                      <td>{point.trialId ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </article>

      <aside className="experiment-trajectory-side">
        <ExperimentRunStack runs={runs} ideas={ideas} onOpenRuns={onOpenRuns} />
        <MetricRecorder
          project={project}
          objective={objective}
          ideas={ideas}
          selectedIdeaId={selectedIdeaId}
          busy={busy}
          onSelectIdea={onSelectIdea}
          onRecord={onRecordMetric}
          onOpenObjective={onOpenObjective}
        />
        {selectedPoint && (
          <article className="experiment-card experiment-selection-card">
            <span className="eyebrow">SELECTED RESULT</span>
            <h3>{ideaTitle(ideas, selectedPoint.ideaId)}</h3>
            <strong>{formatExperimentMetric(selectedPoint.value, selectedPoint.unit)}</strong>
            <dl>
              <div>
                <dt>Recorded</dt>
                <dd>{formatDateTime(selectedPoint.recordedAt)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  {selectedPoint.source === 'manual'
                    ? 'Manual local entry'
                    : 'Verified tracked-run summary'}
                </dd>
              </div>
              <div>
                <dt>Objective</dt>
                <dd>v{selectedPoint.objectiveVersion}</dd>
              </div>
              <div>
                <dt>Trial</dt>
                <dd>{selectedPoint.trialId ?? 'Not linked'}</dd>
              </div>
            </dl>
          </article>
        )}
      </aside>
    </div>
  );
}

function runIdeaTitle(ideas: readonly ExperimentIdea[], ideaId: string | null) {
  if (ideaId === null) return 'Exploratory · no linked idea';
  return ideaTitle(ideas, ideaId);
}

function ExperimentRunStack({
  runs,
  ideas,
  onOpenRuns,
}: {
  runs: readonly ExperimentRun[];
  ideas: readonly ExperimentIdea[];
  onOpenRuns: () => void;
}) {
  const recentRuns = [...runs]
    .sort((left, right) => {
      const leftActive =
        left.status === 'running' || left.status === 'verifying' || left.status === 'queued'
          ? 1
          : 0;
      const rightActive =
        right.status === 'running' || right.status === 'verifying' || right.status === 'queued'
          ? 1
          : 0;
      return rightActive - leftActive || right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, 5);

  return (
    <article className="experiment-card experiment-run-stack">
      <header>
        <div>
          <span className="eyebrow">ACTIVE &amp; RECENT</span>
          <h3>Tracked runs</h3>
        </div>
        <button type="button" className="ghost-button" onClick={onOpenRuns}>
          View all
        </button>
      </header>
      {recentRuns.length === 0 ? (
        <p className="experiment-inline-empty">
          No tracked runs yet. Runs created by Project Chat or a connected Runner will appear here.
        </p>
      ) : (
        <ol>
          {recentRuns.map((run) => (
            <li key={run.id}>
              <span className={`experiment-run-status ${RUN_PRESENTATION[run.status].tone}`}>
                {RUN_PRESENTATION[run.status].label}
              </span>
              <div>
                <strong>{run.title}</strong>
                <small>
                  {runIdeaTitle(ideas, run.ideaId)} · {formatExperimentRunProgress(run)}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function runLogValidation(run: ExperimentRun) {
  if (!run.logReference) return 'Not linked';
  if (run.logReference.validationState === 'valid') return 'Valid';
  if (run.logReference.validationState === 'pending') return 'Pending validation';
  if (run.logReference.validationState === 'invalid') return 'Invalid';
  return `Incomplete · missing ${run.logReference.missingFields.join(', ')}`;
}

function formatLogSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatProcessReceipt(run: ExperimentRun) {
  if (run.processExitCode === null && run.processDurationMs === null) return null;
  const parts: string[] = [];
  if (run.processExitCode !== null) parts.push(`Exit ${run.processExitCode}`);
  if (run.processDurationMs !== null) {
    const seconds = run.processDurationMs / 1000;
    const duration =
      seconds < 60
        ? `${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)} sec`
        : formatExperimentElapsed(run.processDurationMs);
    parts.push(`${duration} process`);
  }
  return parts.join(' · ');
}

export function ExperimentRunsPanel({
  projectId,
  ideas,
  runs,
  readRunLog,
}: {
  projectId: string;
  ideas: readonly ExperimentIdea[];
  runs: readonly ExperimentRun[];
  readRunLog?: ExperimentsViewAdapter['readRunLog'];
}) {
  const summary = summarizeExperimentRuns(runs);
  const orderedRuns = [...runs].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const logHelpId = `experiment-log-opening-${projectId}`;
  const logReadGeneration = useRef(0);
  const [logViewer, setLogViewer] = useState<Readonly<{
    runId: string;
    referenceId: string;
    displayName: string;
    contentHash: string;
    content: string;
    nextOffset: number | null;
    totalCharacters: number;
    validationState: ExperimentRunLogChunk['validationState'];
    missingFields: readonly string[];
    loadedAt: string | null;
    loading: boolean;
    error: string | null;
  }> | null>(null);

  useEffect(() => {
    logReadGeneration.current += 1;
    setLogViewer(null);
  }, [projectId]);

  const loadRunLog = async (run: ExperimentRun, append: boolean) => {
    if (!readRunLog || !run.logReference) return;
    const previous = logViewer;
    const canAppend =
      append &&
      previous?.runId === run.id &&
      previous.referenceId === run.logReference.referenceId &&
      previous.nextOffset !== null;
    const offset = canAppend ? previous.nextOffset! : 0;
    const generation = ++logReadGeneration.current;
    setLogViewer(
      canAppend
        ? { ...previous, loading: true, error: null }
        : {
            runId: run.id,
            referenceId: run.logReference.referenceId,
            displayName: run.logReference.displayName,
            contentHash: run.logReference.contentHash,
            content: '',
            nextOffset: null,
            totalCharacters: 0,
            validationState: run.logReference.validationState,
            missingFields: run.logReference.missingFields,
            loadedAt: null,
            loading: true,
            error: null,
          },
    );
    try {
      const chunk = await readRunLog({
        projectId,
        runId: run.id,
        referenceId: run.logReference.referenceId,
        offset,
      });
      if (generation !== logReadGeneration.current) return;
      setLogViewer((current) => {
        if (!current || current.referenceId !== chunk.referenceId) return current;
        return {
          runId: chunk.runId,
          referenceId: chunk.referenceId,
          displayName: chunk.displayName,
          contentHash: chunk.contentHash,
          content: offset === 0 ? chunk.content : `${current.content}${chunk.content}`,
          nextOffset: chunk.nextOffset,
          totalCharacters: chunk.totalCharacters,
          validationState: chunk.validationState,
          missingFields: chunk.missingFields,
          loadedAt: chunk.loadedAt,
          loading: false,
          error: null,
        };
      });
    } catch (error) {
      if (generation !== logReadGeneration.current) return;
      setLogViewer((current) =>
        current && current.runId === run.id
          ? { ...current, loading: false, error: experimentErrorMessage(error) }
          : current,
      );
    }
  };

  return (
    <div
      id="experiment-panel-runs"
      role="tabpanel"
      aria-labelledby="experiment-tab-runs"
      className="experiment-panel experiment-runs-panel"
    >
      <section className="experiment-run-summary" aria-label="Run status summary">
        <div>
          <span>Active</span>
          <strong>{summary.active}</strong>
        </div>
        <div>
          <span>Queued</span>
          <strong>{summary.queued}</strong>
        </div>
        <div>
          <span>Completed</span>
          <strong>{summary.completed}</strong>
        </div>
        <div className={summary.needsAttention > 0 ? 'attention' : ''}>
          <span>Needs attention</span>
          <strong>{summary.needsAttention}</strong>
        </div>
      </section>

      <article className="experiment-card experiment-runs-card">
        <header className="experiment-card-head">
          <div>
            <span className="eyebrow">MLOPS RUN TRACKING</span>
            <h2>Runs and logging health</h2>
            <p>
              Project Chat and the Runner create these records. The current Project Chat foreground
              path records start and verified final-log state; live per-step streaming begins when a
              Runner is connected. This table never invents missing progress or a total.
            </p>
          </div>
        </header>

        {orderedRuns.length === 0 ? (
          <div className="experiment-run-empty">
            <strong>No tracked runs</strong>
            <span>
              Design an exploratory or comparable experiment in Project Chat. Its server, step,
              metric summary, and validated log reference will appear here.
            </span>
          </div>
        ) : (
          <div className="experiment-runs-table-scroll" tabIndex={0}>
            <table>
              <caption className="sr-only">
                Runs for this project with status, progress, metric, and logging validation
              </caption>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Run / trial</th>
                  <th scope="col">Idea</th>
                  <th scope="col">Server</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Current step</th>
                  <th scope="col">Latest metric</th>
                  <th scope="col">Started / updated</th>
                  <th scope="col">Logging validation</th>
                  <th scope="col">Log</th>
                </tr>
              </thead>
              <tbody>
                {orderedRuns.map((run) => {
                  const canOpenLog = Boolean(
                    run.logReference &&
                    run.logReference.validationState !== 'pending' &&
                    readRunLog,
                  );
                  const processReceipt = formatProcessReceipt(run);
                  return (
                    <tr
                      key={run.id}
                      className={logViewer?.runId === run.id ? 'selected' : undefined}
                    >
                      <td>
                        <span
                          className={`experiment-run-status ${RUN_PRESENTATION[run.status].tone}`}
                        >
                          {RUN_PRESENTATION[run.status].label}
                        </span>
                      </td>
                      <td>
                        <strong>{run.title}</strong>
                        <small>{run.trialId}</small>
                      </td>
                      <td>{runIdeaTitle(ideas, run.ideaId)}</td>
                      <td>{run.serverLabel}</td>
                      <td>{formatExperimentRunProgress(run)}</td>
                      <td>{run.currentStep ?? 'Not reported'}</td>
                      <td>
                        {run.latestMetric ? (
                          <>
                            <strong>{run.latestMetric.displayName}</strong>
                            <span>
                              {formatExperimentMetric(
                                run.latestMetric.value,
                                run.latestMetric.unit,
                              )}
                            </span>
                          </>
                        ) : (
                          'Not reported'
                        )}
                      </td>
                      <td>
                        <span>{run.startedAt ? formatDateTime(run.startedAt) : 'Not started'}</span>
                        {processReceipt && <small>{processReceipt}</small>}
                        <small>Updated {formatDateTime(run.updatedAt)}</small>
                      </td>
                      <td>
                        <span>{runLogValidation(run)}</span>
                        <small>
                          {run.logReference
                            ? `${run.logReference.displayName} · ${formatLogSize(run.logReference.sizeBytes)} · ${shortHash(run.logReference.contentHash)} · template v${run.loggingTemplate.version}`
                            : `Template v${run.loggingTemplate.version}`}
                        </small>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary-button compact"
                          disabled={!canOpenLog}
                          aria-describedby={logHelpId}
                          title={
                            !run.logReference
                              ? 'No validated log reference is linked to this run.'
                              : run.logReference.validationState === 'pending'
                                ? 'The process receipt is saved, but log verification has not finished.'
                                : !readRunLog
                                  ? 'Opening raw logs is not connected in this build.'
                                  : undefined
                          }
                          onClick={() => {
                            void loadRunLog(run, false);
                          }}
                        >
                          {logViewer?.runId === run.id ? 'Refresh log' : 'Open log'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p id={logHelpId} className="experiment-log-boundary">
          Raw JSONL stays on the linked server. GOSU reads it into this view only on demand and
          refuses content whose full-file hash differs from the validated run reference.
          {!readRunLog && ' Raw log opening is not connected in this build.'}
        </p>

        {logViewer && (
          <section className="experiment-log-viewer" aria-labelledby="experiment-log-viewer-title">
            <header>
              <div>
                <span className="eyebrow">SERVER JSONL · ON-DEMAND</span>
                <h3 id="experiment-log-viewer-title">{logViewer.displayName}</h3>
                <p>
                  {logViewer.validationState === 'valid'
                    ? 'Validated against the run template'
                    : logViewer.validationState === 'incomplete'
                      ? `Incomplete · missing ${logViewer.missingFields.join(', ')}`
                      : logViewer.validationState === 'invalid'
                        ? 'Invalid experiment log'
                        : 'Validation pending'}
                  {' · '}hash {shortHash(logViewer.contentHash)}
                </p>
              </div>
              <div className="experiment-log-viewer-actions">
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={logViewer.loading}
                  onClick={() => {
                    const run = runs.find(({ id }) => id === logViewer.runId);
                    if (run) void loadRunLog(run, false);
                  }}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    logReadGeneration.current += 1;
                    setLogViewer(null);
                  }}
                >
                  Close
                </button>
              </div>
            </header>
            {logViewer.error && (
              <div className="notice error" role="alert">
                {logViewer.error}
              </div>
            )}
            {logViewer.loading && logViewer.content === '' ? (
              <p className="experiment-inline-empty" role="status">
                Reading the verified server log…
              </p>
            ) : (
              <pre tabIndex={0} role="log" aria-live="off">
                <code>{logViewer.content}</code>
              </pre>
            )}
            <footer>
              <span>
                {logViewer.loadedAt
                  ? `Loaded ${formatDateTime(logViewer.loadedAt)} · ${[
                      ...logViewer.content,
                    ].length.toLocaleString()} / ${logViewer.totalCharacters.toLocaleString()} characters`
                  : 'No raw content was retained locally.'}
              </span>
              {logViewer.nextOffset !== null && (
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={logViewer.loading}
                  onClick={() => {
                    const run = runs.find(({ id }) => id === logViewer.runId);
                    if (run) void loadRunLog(run, true);
                  }}
                >
                  {logViewer.loading ? 'Loading…' : 'Load more'}
                </button>
              )}
            </footer>
          </section>
        )}
      </article>
    </div>
  );
}

function copyLoggingFields(fields: readonly ExperimentLoggingCustomField[]) {
  return fields.map((field) => ({ ...field, requiredAt: [...field.requiredAt] }));
}

function nextLoggingFieldKey(fields: readonly ExperimentLoggingCustomField[]) {
  const keys = new Set(fields.map(({ key }) => key));
  let index = 1;
  while (keys.has(`field_${index}`)) index += 1;
  return `field_${index}`;
}

export function ExperimentLoggingPanel({
  template,
  busy,
  onSave,
}: {
  template: ExperimentLoggingTemplate;
  busy: boolean;
  onSave: (fields: readonly ExperimentLoggingCustomField[]) => Promise<boolean>;
}) {
  const [fields, setFields] = useState<ExperimentLoggingCustomField[]>(() =>
    copyLoggingFields(template.customFields),
  );

  const issues = validateExperimentLoggingFields(fields);
  const dirty = JSON.stringify(fields) !== JSON.stringify(template.customFields);
  const atLimit = fields.length >= EXPERIMENT_MAX_LOGGING_FIELDS;

  const replaceField = (index: number, next: ExperimentLoggingCustomField) => {
    setFields((current) => current.map((field, itemIndex) => (itemIndex === index ? next : field)));
  };

  const addField = () => {
    if (atLimit) return;
    const key = nextLoggingFieldKey(fields);
    setFields((current) => [
      ...current,
      {
        key,
        label: 'New field',
        type: 'string',
        category: 'note',
        requiredAt: ['summary'],
        unit: null,
      },
    ]);
  };

  const save = async () => {
    const normalized = fields.map((field) => ({
      ...field,
      key: field.key.trim(),
      label: field.label.trim(),
      unit: field.unit?.trim() ? field.unit.trim() : null,
      requiredAt: LOGGING_REQUIRED_AT.filter((stage) => field.requiredAt.includes(stage)),
    }));
    if (validateExperimentLoggingFields(normalized).length > 0) return;
    await onSave(normalized);
  };

  return (
    <div
      id="experiment-panel-logging"
      role="tabpanel"
      aria-labelledby="experiment-tab-logging"
      className="experiment-panel experiment-logging-layout"
    >
      <article className="experiment-card experiment-logging-editor">
        <header className="experiment-card-head">
          <div>
            <span className="eyebrow">REQUIRED LOGGING TEMPLATE</span>
            <h2>Template version {template.version}</h2>
            <p>
              Project Chat must include these fields when it designs and launches experiments. Save
              changes as a new immutable version; existing runs keep their original snapshot.
            </p>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={atLimit}
            title={atLimit ? `Maximum ${EXPERIMENT_MAX_LOGGING_FIELDS} custom fields` : undefined}
            onClick={addField}
          >
            ＋ Add field
          </button>
        </header>

        <section className="experiment-system-fields" aria-labelledby="system-logging-fields">
          <div>
            <h3 id="system-logging-fields">System fields</h3>
            <span>Always present and locked</span>
          </div>
          <ul>
            {EXPERIMENT_LOGGING_SYSTEM_FIELDS.map((field) => (
              <li key={field}>
                <span aria-hidden="true">🔒</span> {field}
              </li>
            ))}
          </ul>
        </section>

        <section className="experiment-custom-fields" aria-labelledby="custom-logging-fields">
          <div className="experiment-custom-fields-heading">
            <div>
              <h3 id="custom-logging-fields">Custom required fields</h3>
              <span>
                {fields.length} / {EXPERIMENT_MAX_LOGGING_FIELDS}
              </span>
            </div>
          </div>

          {fields.length === 0 ? (
            <p className="experiment-inline-empty">
              No custom fields. System provenance is still required for every run event.
            </p>
          ) : (
            <ol className="experiment-logging-field-list">
              {fields.map((field, index) => (
                <li key={`${template.id}:${index}`} className="experiment-logging-field-row">
                  <div className="experiment-logging-field-basics">
                    <label>
                      Key
                      <input
                        value={field.key}
                        spellCheck={false}
                        maxLength={64}
                        onChange={(event) =>
                          replaceField(index, { ...field, key: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Label
                      <input
                        value={field.label}
                        maxLength={80}
                        onChange={(event) =>
                          replaceField(index, { ...field, label: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Type
                      <select
                        value={field.type}
                        onChange={(event) =>
                          replaceField(index, {
                            ...field,
                            type: event.target.value as ExperimentLoggingFieldType,
                          })
                        }
                      >
                        {LOGGING_FIELD_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Category
                      <select
                        value={field.category}
                        onChange={(event) =>
                          replaceField(index, {
                            ...field,
                            category: event.target.value as ExperimentLoggingFieldCategory,
                          })
                        }
                      >
                        {LOGGING_FIELD_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Unit <small>optional</small>
                      <input
                        value={field.unit ?? ''}
                        maxLength={32}
                        placeholder="e.g. %, sec"
                        onChange={(event) =>
                          replaceField(index, {
                            ...field,
                            unit: event.target.value === '' ? null : event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <fieldset>
                    <legend>Required at</legend>
                    {LOGGING_REQUIRED_AT.map((stage) => (
                      <label key={stage}>
                        <input
                          type="checkbox"
                          checked={field.requiredAt.includes(stage)}
                          onChange={(event) => {
                            const requiredAt = event.target.checked
                              ? [...field.requiredAt, stage]
                              : field.requiredAt.filter((value) => value !== stage);
                            replaceField(index, { ...field, requiredAt });
                          }}
                        />
                        {stage}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    type="button"
                    className="ghost-button experiment-delete-logging-field"
                    aria-label={`Delete ${field.label || field.key || `field ${index + 1}`}`}
                    onClick={() =>
                      setFields((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        {issues.length > 0 && (
          <div className="experiment-logging-errors" role="alert">
            <strong>Fix the template before saving</strong>
            <ul>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        <footer className="experiment-logging-actions">
          <span>
            {dirty ? 'Unsaved template changes' : `Version ${template.version} is current`}
          </span>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !dirty || issues.length > 0}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : `Save as version ${template.version + 1}`}
          </button>
        </footer>
      </article>

      <aside className="experiment-logging-preview">
        <article className="experiment-card">
          <span className="eyebrow">CURRENT TEMPLATE · VERSION {template.version}</span>
          <h2>JSONL example</h2>
          <p className="experiment-example-warning">Example only — not an actual run</p>
          <pre
            tabIndex={0}
            aria-label={`Logging template version ${template.version} JSONL example`}
          >
            <code>{buildExperimentLoggingExample(template)}</code>
          </pre>
          <dl>
            <div>
              <dt>Template hash</dt>
              <dd title={template.templateHash}>{shortHash(template.templateHash)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDateTime(template.createdAt)}</dd>
            </div>
          </dl>
        </article>
        <article className="experiment-card experiment-log-policy-card">
          <span className="eyebrow">LOG STORAGE BOUNDARY</span>
          <h3>References, not raw logs</h3>
          <p>
            Run records keep validation state, missing required fields, size, and content hash. Raw
            logs remain at their approved server or Runner source. The Runs tab reads a verified
            copy into memory only when you choose Open log.
          </p>
        </article>
      </aside>
    </div>
  );
}

function TrajectorySvg({
  chart,
  series,
  ideaById,
  selectedPointId,
  onSelectPoint,
}: {
  chart: ReturnType<typeof buildExperimentTrajectory>;
  series: ExperimentMetricSeries;
  ideaById: ReadonlyMap<string, ExperimentIdea>;
  selectedPointId: string | null;
  onSelectPoint: (point: ExperimentMetricPoint) => void;
}) {
  return (
    <figure className="experiment-chart-figure">
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-labelledby="experiment-chart-title experiment-chart-description"
      >
        <title id="experiment-chart-title">{series.metricDisplayName} progress trajectory</title>
        <desc id="experiment-chart-description">
          {series.points.length} saved results for objective version {series.objectiveVersion}. The
          accompanying data table contains the same values.
        </desc>
        {chart.valueTicks.map((tick) => (
          <g key={tick.value}>
            <line
              className="experiment-chart-gridline"
              x1={chart.plotLeft}
              x2={chart.plotRight}
              y1={tick.y}
              y2={tick.y}
            />
            <text
              className="experiment-chart-axis-label"
              x={chart.plotLeft - 12}
              y={tick.y + 4}
              textAnchor="end"
            >
              {formatExperimentMetric(tick.value, series.unit)}
            </text>
          </g>
        ))}
        {chart.timeTicks.map((tick, index) => (
          <text
            key={`${tick.label}:${index}`}
            className="experiment-chart-axis-label"
            x={tick.x}
            y={chart.height - 17}
            textAnchor={
              index === 0 ? 'start' : index === chart.timeTicks.length - 1 ? 'end' : 'middle'
            }
          >
            {tick.label}
          </text>
        ))}
        {chart.baselineY !== null && (
          <g>
            <line
              className="experiment-chart-guide baseline"
              x1={chart.plotLeft}
              x2={chart.plotRight}
              y1={chart.baselineY}
              y2={chart.baselineY}
            />
            <text
              className="experiment-chart-guide-label"
              x={chart.plotRight}
              y={chart.baselineY - 7}
              textAnchor="end"
            >
              Baseline
            </text>
          </g>
        )}
        {chart.targetY !== null && (
          <g>
            <line
              className="experiment-chart-guide target"
              x1={chart.plotLeft}
              x2={chart.plotRight}
              y1={chart.targetY}
              y2={chart.targetY}
            />
            <text
              className="experiment-chart-guide-label target"
              x={chart.plotRight}
              y={chart.targetY - 7}
              textAnchor="end"
            >
              Target
            </text>
          </g>
        )}
        <path className="experiment-chart-best-line" d={chart.bestPath} />
        <path className="experiment-chart-value-line" d={chart.valuePath} />
        {chart.points.map(({ point, x, y }) => {
          const idea = ideaById.get(point.ideaId);
          const outcome = idea?.outcome ?? 'inconclusive';
          const presentation = OUTCOME_PRESENTATION[outcome];
          const selected = selectedPointId === point.id;
          return (
            <g
              key={point.id}
              className={`experiment-chart-marker ${outcomeClass(outcome)}${selected ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${idea?.title ?? 'Unknown idea'}, ${presentation.label}, ${formatExperimentMetric(point.value, point.unit)}, ${formatDateTime(point.recordedAt)}`}
              onClick={() => onSelectPoint(point)}
              onKeyDown={(event) => markerKeyDown(event, () => onSelectPoint(point))}
            >
              <circle cx={x} cy={y} r={selected ? 10 : 8} />
              <text x={x} y={y + 4} textAnchor="middle" aria-hidden="true">
                {presentation.symbol}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="experiment-chart-legend">
        {EXPERIMENT_IDEA_OUTCOMES.map((outcome) => (
          <span key={outcome} className={outcomeClass(outcome)}>
            <i aria-hidden="true">{OUTCOME_PRESENTATION[outcome].symbol}</i>
            {OUTCOME_PRESENTATION[outcome].label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function MetricRecorder({
  project,
  objective,
  ideas,
  selectedIdeaId,
  busy,
  onSelectIdea,
  onRecord,
  onOpenObjective,
}: {
  project: ProjectRecord;
  objective: WorkspaceObjective | undefined;
  ideas: readonly ExperimentIdea[];
  selectedIdeaId: string | null;
  busy: boolean;
  onSelectIdea: (ideaId: string) => void;
  onRecord: (value: number, trialId: string) => Promise<boolean>;
  onOpenObjective: () => void;
}) {
  const [value, setValue] = useState('');
  const [trialId, setTrialId] = useState('');
  const canRecord = Boolean(objective?.locked && selectedIdeaId && ideas.length > 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim() === '') return;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || !canRecord) return;
    if (await onRecord(numericValue, trialId)) {
      setValue('');
      setTrialId('');
    }
  };

  return (
    <article className="experiment-card experiment-recorder-card">
      <span className="eyebrow">LOCAL RESULT ENTRY</span>
      <h3>Record a comparable result</h3>
      <p>
        This form records a manual local summary. It does not claim that a Runner executed the
        experiment.
      </p>
      {ideas.length === 0 ? (
        <div className="experiment-inline-empty">Create an idea in Idea map first.</div>
      ) : !objective?.locked ? (
        <button type="button" className="secondary-button" onClick={onOpenObjective}>
          Freeze Goal & Metrics
        </button>
      ) : (
        <form className="experiment-stack-form" onSubmit={submit}>
          <label>
            Idea
            <select
              value={selectedIdeaId ?? ''}
              onChange={(event) => onSelectIdea(event.target.value)}
              required
            >
              <option value="" disabled>
                Select an idea
              </option>
              {ideas.map((idea) => (
                <option key={idea.id} value={idea.id}>
                  {idea.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {objective.primaryMetric.displayName}
            <input
              type="number"
              step="any"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={
                objective.primaryMetric.unit
                  ? `Value in ${objective.primaryMetric.unit}`
                  : 'Numeric value'
              }
              required
            />
          </label>
          <label>
            Trial ID <small>Optional provenance label</small>
            <input
              value={trialId}
              onChange={(event) => setTrialId(event.target.value)}
              maxLength={128}
              placeholder="trial-08"
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || !canRecord || value.trim() === '' || !Number.isFinite(Number(value))}
          >
            {busy ? 'Saving…' : 'Record local result'}
          </button>
        </form>
      )}
      <small className="experiment-project-scope">Stored only in {project.name}.</small>
    </article>
  );
}

function IdeaMapPanel({
  ideas,
  selectedIdea,
  busy,
  composer,
  onComposer,
  onSelectIdea,
  onCreateIdea,
  onUpdateIdea,
}: {
  ideas: readonly ExperimentIdea[];
  selectedIdea: ExperimentIdea | null;
  busy: boolean;
  composer: { kind: 'root'; parent: null } | { kind: 'child'; parent: ExperimentIdea } | null;
  onComposer: (
    value: { kind: 'root'; parent: null } | { kind: 'child'; parent: ExperimentIdea } | null,
  ) => void;
  onSelectIdea: (ideaId: string) => void;
  onCreateIdea: (draft: {
    parentIdeaId: string | null;
    title: string;
    hypothesis: string;
    phase: string;
  }) => Promise<boolean>;
  onUpdateIdea: (input: UpdateExperimentIdeaInput) => Promise<boolean>;
}) {
  const layout = useMemo(() => layoutIdeaLineage(ideas), [ideas]);
  const labels = useMemo(() => buildIdeaLineageLabels(ideas), [ideas]);
  const [outcomeFilter, setOutcomeFilter] = useState<ExperimentIdeaOutcome | 'all'>('all');
  const visibleIds = new Set(
    ideas
      .filter((idea) => outcomeFilter === 'all' || idea.outcome === outcomeFilter)
      .map(({ id }) => id),
  );

  return (
    <div
      id="experiment-panel-ideas"
      role="tabpanel"
      aria-labelledby="experiment-tab-ideas"
      className="experiment-panel experiment-idea-layout"
    >
      <article className="experiment-card experiment-graph-card">
        <header className="experiment-card-head experiment-graph-toolbar">
          <div>
            <span className="eyebrow">IDEA LINEAGE</span>
            <h2>How each hypothesis developed</h2>
            <p>Select a node to review its hypothesis, outcome, and next branch.</p>
          </div>
          <div className="experiment-graph-actions">
            <label>
              Outcome
              <select
                value={outcomeFilter}
                onChange={(event) =>
                  setOutcomeFilter(event.target.value as ExperimentIdeaOutcome | 'all')
                }
              >
                <option value="all">All outcomes</option>
                {EXPERIMENT_IDEA_OUTCOMES.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {outcomeLabel(outcome)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onComposer({ kind: 'root', parent: null })}
            >
              ＋ New idea
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!selectedIdea}
              onClick={() => selectedIdea && onComposer({ kind: 'child', parent: selectedIdea })}
            >
              Branch selected
            </button>
          </div>
        </header>

        {composer && (
          <IdeaComposer
            parent={composer.parent}
            busy={busy}
            onCancel={() => onComposer(null)}
            onCreate={onCreateIdea}
          />
        )}

        {layout.issues.length > 0 && (
          <div className="experiments-integrity-warning" role="alert">
            Some lineage links are incomplete or cyclic. The list remains available; no record was
            silently reassigned.
          </div>
        )}

        {ideas.length === 0 ? (
          <div className="experiment-graph-empty">
            <strong>No ideas yet</strong>
            <span>
              Create the first falsifiable hypothesis. Results are never generated automatically in
              this local view.
            </span>
            <button
              type="button"
              className="primary-button"
              onClick={() => onComposer({ kind: 'root', parent: null })}
            >
              Create first idea
            </button>
          </div>
        ) : (
          <>
            <div
              className="experiment-graph-scroll"
              tabIndex={0}
              aria-label="Scrollable idea lineage graph"
            >
              <svg
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="group"
                aria-label={`${ideas.length} experiment ideas connected by parent relationships`}
              >
                {layout.edges.map((edge) => (
                  <path
                    key={edge.id}
                    className={`experiment-lineage-edge${visibleIds.has(edge.parentId) && visibleIds.has(edge.childId) ? '' : ' filtered'}`}
                    d={edge.path}
                  />
                ))}
                {layout.nodes.map((node) => {
                  const presentation = OUTCOME_PRESENTATION[node.idea.outcome];
                  const selected = selectedIdea?.id === node.idea.id;
                  const filtered = !visibleIds.has(node.idea.id);
                  const title =
                    node.idea.title.length > 25
                      ? `${node.idea.title.slice(0, 24)}…`
                      : node.idea.title;
                  return (
                    <g
                      key={node.idea.id}
                      className={`experiment-lineage-node ${outcomeClass(node.idea.outcome)}${selected ? ' selected' : ''}${filtered ? ' filtered' : ''}`}
                      role="button"
                      tabIndex={filtered ? -1 : 0}
                      aria-label={`${node.label}, ${node.idea.title}, ${presentation.label}. ${presentation.description}`}
                      aria-pressed={selected}
                      onClick={() => !filtered && onSelectIdea(node.idea.id)}
                      onKeyDown={(event) =>
                        markerKeyDown(event, () => !filtered && onSelectIdea(node.idea.id))
                      }
                    >
                      <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="12" />
                      <text className="experiment-node-label" x={node.x + 14} y={node.y + 23}>
                        {node.label}
                      </text>
                      <text className="experiment-node-title" x={node.x + 14} y={node.y + 46}>
                        {title}
                      </text>
                      <text className="experiment-node-outcome" x={node.x + 14} y={node.y + 65}>
                        {presentation.symbol} {presentation.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <details className="experiment-data-disclosure experiment-idea-list-disclosure">
              <summary>View accessible idea list</summary>
              <ul className="experiment-accessible-idea-list">
                {ideas.map((idea) => (
                  <li key={idea.id}>
                    <button
                      type="button"
                      onClick={() => onSelectIdea(idea.id)}
                      aria-current={selectedIdea?.id === idea.id ? 'true' : undefined}
                    >
                      <strong>
                        {labels.get(idea.id)} · {idea.title}
                      </strong>
                      <span>
                        {OUTCOME_PRESENTATION[idea.outcome].symbol} {outcomeLabel(idea.outcome)}
                        {idea.phase ? ` · ${idea.phase}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </article>

      <aside>
        {selectedIdea ? (
          <IdeaInspector
            key={`${selectedIdea.id}:${selectedIdea.version}`}
            idea={selectedIdea}
            label={labels.get(selectedIdea.id) ?? '?'}
            parent={
              selectedIdea.parentIdeaId
                ? (ideas.find(({ id }) => id === selectedIdea.parentIdeaId) ?? null)
                : null
            }
            busy={busy}
            onUpdate={onUpdateIdea}
            onBranch={() => onComposer({ kind: 'child', parent: selectedIdea })}
          />
        ) : (
          <article className="experiment-card experiment-inline-empty">
            Select an idea to inspect and edit it.
          </article>
        )}
      </aside>
    </div>
  );
}

function IdeaComposer({
  parent,
  busy,
  onCancel,
  onCreate,
}: {
  parent: ExperimentIdea | null;
  busy: boolean;
  onCancel: () => void;
  onCreate: (draft: {
    parentIdeaId: string | null;
    title: string;
    hypothesis: string;
    phase: string;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [phase, setPhase] = useState(parent?.phase ?? '');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onCreate({
      parentIdeaId: parent?.id ?? null,
      title: title.trim(),
      hypothesis: hypothesis.trim(),
      phase: phase.trim(),
    });
  };

  return (
    <form className="experiment-idea-composer" onSubmit={submit}>
      <header>
        <div>
          <strong>{parent ? `Develop a child of “${parent.title}”` : 'Create a root idea'}</strong>
          <span>Describe a falsifiable change; the outcome remains planned until reviewed.</span>
        </div>
        <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </header>
      <div className="experiment-idea-form-grid">
        <label>
          Idea title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={1}
            maxLength={160}
            required
            autoFocus
          />
        </label>
        <label>
          Phase
          <input
            value={phase}
            onChange={(event) => setPhase(event.target.value)}
            maxLength={80}
            placeholder="Phase 1 · Reproduce"
          />
        </label>
        <label className="full-width">
          Hypothesis
          <textarea
            value={hypothesis}
            onChange={(event) => setHypothesis(event.target.value)}
            maxLength={4_000}
            placeholder="If we change…, then the frozen metric should… because…"
          />
        </label>
      </div>
      <button type="submit" className="primary-button" disabled={busy || title.trim() === ''}>
        {busy ? 'Saving…' : parent ? 'Create child idea' : 'Create idea'}
      </button>
    </form>
  );
}

function IdeaInspector({
  idea,
  label,
  parent,
  busy,
  onUpdate,
  onBranch,
}: {
  idea: ExperimentIdea;
  label: string;
  parent: ExperimentIdea | null;
  busy: boolean;
  onUpdate: (input: UpdateExperimentIdeaInput) => Promise<boolean>;
  onBranch: () => void;
}) {
  const [title, setTitle] = useState(idea.title);
  const [hypothesis, setHypothesis] = useState(idea.hypothesis);
  const [phase, setPhase] = useState(idea.phase);
  const [outcome, setOutcome] = useState<ExperimentIdeaOutcome>(idea.outcome);
  const [resultSummary, setResultSummary] = useState(idea.resultSummary);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onUpdate({
      projectId: idea.projectId,
      ideaId: idea.id,
      expectedVersion: idea.version,
      title: title.trim(),
      hypothesis: hypothesis.trim(),
      phase: phase.trim(),
      outcome,
      resultSummary: resultSummary.trim(),
    });
  };

  return (
    <article
      id={`experiment-idea-inspector-${idea.id}`}
      tabIndex={-1}
      className="experiment-card experiment-idea-inspector"
    >
      <header>
        <div>
          <span className="eyebrow">SELECTED IDEA {label}</span>
          <h2>{idea.title}</h2>
          <p>{parent ? `Developed from ${parent.title}` : 'Root idea'}</p>
        </div>
        <span className={`experiment-outcome-badge ${outcomeClass(idea.outcome)}`}>
          {OUTCOME_PRESENTATION[idea.outcome].symbol} {outcomeLabel(idea.outcome)}
        </span>
      </header>
      <form className="experiment-stack-form" onSubmit={submit}>
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            required
          />
        </label>
        <label>
          Phase
          <input value={phase} onChange={(event) => setPhase(event.target.value)} maxLength={80} />
        </label>
        <label>
          Hypothesis
          <textarea
            value={hypothesis}
            onChange={(event) => setHypothesis(event.target.value)}
            maxLength={4_000}
          />
        </label>
        <label>
          Reviewed outcome
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as ExperimentIdeaOutcome)}
          >
            {EXPERIMENT_IDEA_OUTCOMES.map((item) => (
              <option key={item} value={item}>
                {outcomeLabel(item)} — {OUTCOME_PRESENTATION[item].description}
              </option>
            ))}
          </select>
        </label>
        <label>
          Result summary
          <textarea
            value={resultSummary}
            onChange={(event) => setResultSummary(event.target.value)}
            maxLength={4_000}
            placeholder="State evidence, uncertainty, guardrail result, and what should happen next."
          />
        </label>
        <div className="experiment-form-actions">
          <button type="submit" className="primary-button" disabled={busy || title.trim() === ''}>
            {busy ? 'Saving…' : 'Save reviewed state'}
          </button>
          <button type="button" className="secondary-button" onClick={onBranch} disabled={busy}>
            Develop child
          </button>
        </div>
      </form>
      <small>
        Version {idea.version} · Updated {formatDateTime(idea.updatedAt)}
      </small>
    </article>
  );
}

function ExperimentReportPanel({
  ideas,
  series,
  selectedSeries,
}: {
  ideas: readonly ExperimentIdea[];
  series: readonly ExperimentMetricSeries[];
  selectedSeries: ExperimentMetricSeries | null;
}) {
  const [reportSeriesKey, setReportSeriesKey] = useState<string | null>(
    selectedSeries?.key ?? null,
  );
  useEffect(() => {
    if (reportSeriesKey && series.some(({ key }) => key === reportSeriesKey)) return;
    setReportSeriesKey(selectedSeries?.key ?? series[0]?.key ?? null);
  }, [reportSeriesKey, selectedSeries, series]);
  const reportSeries = series.find(({ key }) => key === reportSeriesKey) ?? selectedSeries;
  const report = useMemo(
    () => buildExperimentReportSummary(ideas, reportSeries),
    [ideas, reportSeries],
  );
  const bestIdea = report.bestPoint
    ? (ideas.find(({ id }) => id === report.bestPoint!.ideaId) ?? null)
    : null;

  return (
    <article
      id="experiment-panel-report"
      role="tabpanel"
      aria-labelledby="experiment-tab-report"
      className="experiment-panel experiment-report"
    >
      <header className="experiment-report-hero">
        <div>
          <span className="eyebrow">LOCAL EVIDENCE REPORT · LIVE DRAFT</span>
          <h2>
            {report.bestPoint && reportSeries
              ? `Best result: ${reportSeries.metricDisplayName} ${formatExperimentMetric(report.bestPoint.value, report.bestPoint.unit)}`
              : 'No metric result has been recorded yet'}
          </h2>
          <p>
            {report.improvementFromBaseline === null
              ? `${report.ideaCount} saved ideas and ${report.resultCount} comparable results.`
              : `${formatExperimentMetric(report.improvementFromBaseline, reportSeries?.unit ?? null)} improvement in the objective direction versus baseline.`}{' '}
            This report contains saved facts only and is not a final scientific conclusion.
          </p>
        </div>
        <div className="experiment-report-actions">
          <SeriesPicker
            series={series}
            selectedKey={reportSeriesKey}
            onSelect={setReportSeriesKey}
          />
          <button type="button" className="secondary-button" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </header>

      <div className="experiment-report-stats">
        <ReportStat
          value={formatExperimentElapsed(report.elapsedMilliseconds)}
          label="Elapsed local record span"
        />
        <ReportStat value={String(report.ideaCount)} label="Ideas developed" />
        <ReportStat value={String(report.resultCount)} label="Metric results" />
        <ReportStat value={String(report.trialCount)} label="Linked trial IDs" />
      </div>

      <section className="experiment-report-section">
        <div className="experiment-report-section-heading">
          <span className="eyebrow">OUTCOME</span>
          <h3>
            {bestIdea ? `Best recorded idea: ${bestIdea.title}` : 'Awaiting a comparable result'}
          </h3>
        </div>
        <div className="experiment-report-outcomes">
          {EXPERIMENT_IDEA_OUTCOMES.map((outcome) => (
            <div key={outcome} className={outcomeClass(outcome)}>
              <i aria-hidden="true">{OUTCOME_PRESENTATION[outcome].symbol}</i>
              <strong>{report.outcomeCounts[outcome]}</strong>
              <span>{outcomeLabel(outcome)}</span>
            </div>
          ))}
        </div>
        {report.bestIdeaPath.length > 0 && (
          <div className="experiment-best-path">
            <strong>Best recorded lineage</strong>
            <ol>
              {report.bestIdeaPath.map((idea) => (
                <li key={idea.id}>
                  <span className={outcomeClass(idea.outcome)}>
                    {OUTCOME_PRESENTATION[idea.outcome].symbol}
                  </span>
                  {idea.title}
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className="experiment-report-section">
        <div className="experiment-report-section-heading">
          <span className="eyebrow">PHASES</span>
          <h3>Exploration by recorded phase</h3>
        </div>
        {report.phases.length === 0 ? (
          <p className="experiment-inline-empty">No phase names have been recorded.</p>
        ) : (
          <div className="experiment-phase-list">
            {report.phases.map((phase) => (
              <div key={phase.phase}>
                <strong>{phase.phase}</strong>
                <span>
                  {phase.ideaCount} ideas · {phase.resultCount} results
                </span>
                <b>
                  {phase.bestValue === null
                    ? 'No metric'
                    : formatExperimentMetric(phase.bestValue, reportSeries?.unit ?? null)}
                </b>
              </div>
            ))}
          </div>
        )}
      </section>

      {reportSeries && (
        <section className="experiment-report-section experiment-provenance-receipt">
          <div className="experiment-report-section-heading">
            <span className="eyebrow">REPRODUCIBILITY RECEIPT</span>
            <h3>Comparable metric boundary</h3>
          </div>
          <dl>
            <div>
              <dt>Objective</dt>
              <dd>v{reportSeries.objectiveVersion}</dd>
            </div>
            <div>
              <dt>Metric</dt>
              <dd>
                {reportSeries.metricDisplayName} · {reportSeries.aggregation} ·{' '}
                {reportSeries.direction}
              </dd>
            </div>
            <div>
              <dt>Evaluator</dt>
              <dd title={reportSeries.evaluatorHash}>{shortHash(reportSeries.evaluatorHash)}</dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd title={reportSeries.datasetHash}>{shortHash(reportSeries.datasetHash)}</dd>
            </div>
            <div>
              <dt>Holdout</dt>
              <dd title={reportSeries.holdoutHash ?? undefined}>
                {shortHash(reportSeries.holdoutHash)}
              </dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>
                {reportSeries.target === null
                  ? 'Not set'
                  : formatExperimentMetric(reportSeries.target, reportSeries.unit)}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </article>
  );
}

function ReportStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
