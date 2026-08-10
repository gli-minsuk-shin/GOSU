import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import type {
  CreateExperimentIdeaInput,
  ExperimentIdea,
  ExperimentIdeaOutcome,
  ExperimentMetricPoint,
  ExperimentWorkspaceEvent,
  ExperimentWorkspaceSnapshot,
  ListExperimentWorkspaceInput,
  RecordExperimentMetricInput,
  UpdateExperimentIdeaInput,
} from '../../shared/experiment-workspace-contracts';
import { EXPERIMENT_IDEA_OUTCOMES } from '../../shared/experiment-workspace-contracts';
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

type ExperimentTab = 'trajectory' | 'ideas' | 'report';

const EXPERIMENT_TABS: ReadonlyArray<{ id: ExperimentTab; label: string }> = [
  { id: 'trajectory', label: 'Trajectory' },
  { id: 'ideas', label: 'Idea map' },
  { id: 'report', label: 'Report' },
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

export function ExperimentsView({
  project,
  objective,
  adapter,
  onOpenObjective,
  searchTarget = null,
  onSearchTargetHandled = () => undefined,
}: ExperimentsViewProps) {
  const [snapshot, setSnapshot] = useState<ExperimentWorkspaceSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ExperimentTab>('trajectory');
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

  return (
    <section className="experiments-shell" aria-label={`${project.name} experiments`}>
      <header className="experiments-runtime-card">
        <div className="experiments-runtime-copy">
          <span className="eyebrow">LOCAL EXPERIMENT WORKSPACE</span>
          <h2>Idea development and measurable progress</h2>
          <p>
            Saved local changes appear immediately. Metric lines never connect different objective,
            evaluator, dataset, or holdout versions.
          </p>
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
              {objective ? 'Freeze the current objective' : 'Define Goal & Metrics first'}
            </strong>
            <span>
              Comparable metric records require a frozen metric, evaluator, dataset, and holdout
              snapshot. Ideas can still be developed locally.
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

      <div className="experiment-tabs" role="tablist" aria-label="Experiment views">
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
          {activeTab === 'trajectory' && (
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
              onSelectSeries={setSelectedSeriesKey}
              onSelectIdea={setSelectedIdeaId}
              onSelectMetricPoint={setSelectedMetricPointId}
              onRecordMetric={recordMetric}
              onOpenObjective={onOpenObjective}
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
  onSelectSeries,
  onSelectIdea,
  onSelectMetricPoint,
  onRecordMetric,
  onOpenObjective,
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
  onSelectSeries: (key: string) => void;
  onSelectIdea: (ideaId: string) => void;
  onSelectMetricPoint: (pointId: string) => void;
  onRecordMetric: (value: number, trialId: string) => Promise<boolean>;
  onOpenObjective: () => void;
}) {
  const chart = useMemo(() => buildExperimentTrajectory(selectedSeries), [selectedSeries]);
  const ideaById = useMemo(() => new Map(ideas.map((idea) => [idea.id, idea])), [ideas]);
  const selectedPoint =
    selectedSeries?.points.find(({ id }) => id === selectedMetricPointId) ?? null;

  return (
    <div
      id="experiment-panel-trajectory"
      role="tabpanel"
      aria-labelledby="experiment-tab-trajectory"
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
                        {point.source === 'manual' ? 'Manual local entry' : 'Saved Runner summary'}
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
                    : 'Saved Runner summary'}
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
