import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import {
  MODEL_USAGE_WORKLOAD_KINDS,
  type ModelUsageAggregate,
  type ModelUsageAnalyticsQuery,
  type ModelUsageAnalyticsReport,
  type ModelUsageConnectionRow,
  type ModelUsageCoverage,
  type ModelUsageLectureGenerationRow,
  type ModelUsageModelRow,
  type ModelUsageProjectRow,
  type ModelUsageTokenTotals,
  type ModelUsageWorkloadKind,
} from '../../shared/model-usage-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import { describeError } from './ui-primitives';
import {
  USAGE_BREAKDOWNS,
  USAGE_PERIODS,
  aggregateTokenValue,
  buildUsageTokenChart,
  describeAggregateCoverage,
  formatCompactTokenCount,
  formatTokenCount,
  formatUsageRange,
  localCalendarDate,
  reportedUsageTurnCount,
  usageBreakdownLabel,
  usagePeriodLabel,
  usageSeriesChartBuckets,
  type UsageBreakdown,
  type UsagePeriod,
} from './usage-view-model';
import './usage-view.css';

const LECTURE_PAGE_SIZE = 25;

const WORKLOAD_LABELS: Readonly<Record<ModelUsageWorkloadKind, string>> = {
  project_chat: 'Project Chat',
  project_chat_title: 'Chat titles',
  lecture_generation: 'Lecture generation',
  literature_organize: 'Literature organize',
  experiment_evaluation: 'Experiment evaluation',
  hermes_delegation: 'Hermes delegation',
};

type UsagePhase = 'loading' | 'refreshing' | 'ready';

export type UsageViewAdapter = Readonly<{
  query: (input: ModelUsageAnalyticsQuery) => Promise<ModelUsageAnalyticsReport>;
}>;

export type UsageViewProps = Readonly<{
  adapter: UsageViewAdapter;
  projects: readonly ProjectRecord[];
  initialReport?: ModelUsageAnalyticsReport | null;
  initialBreakdown?: UsageBreakdown;
}>;

function resolvedTimeZone() {
  const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return candidate || 'UTC';
}

function sameQuery(left: ModelUsageAnalyticsQuery, right: ModelUsageAnalyticsQuery) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildUsageAnalyticsQueries(
  input: Readonly<{
    period: UsagePeriod;
    anchorDate: string;
    timeZone: string;
    projectId: string | null;
    connectionKey: string | null;
    modelId: string | null;
    workloadKind: ModelUsageWorkloadKind | null;
    lectureOffset: number;
    lectureSnapshotAt: string | null;
  }>,
) {
  const base: ModelUsageAnalyticsQuery = {
    period: input.period,
    anchorDate: input.anchorDate,
    timeZone: input.timeZone,
    lecturePage: { offset: 0, limit: LECTURE_PAGE_SIZE },
  };
  const selected: ModelUsageAnalyticsQuery = {
    period: input.period,
    anchorDate: input.anchorDate,
    timeZone: input.timeZone,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.connectionKey ? { connectionKey: input.connectionKey } : {}),
    ...(input.connectionKey && input.modelId ? { modelId: input.modelId } : {}),
    ...(input.workloadKind ? { workloadKind: input.workloadKind } : {}),
    lecturePage: {
      offset: input.lectureOffset,
      limit: LECTURE_PAGE_SIZE,
      ...(input.lectureSnapshotAt ? { snapshotAt: input.lectureSnapshotAt } : {}),
    },
  };
  return { base, selected } as const;
}

export function shouldRetainUsageReport(
  successfulQueryKey: string | null,
  nextQuery: ModelUsageAnalyticsQuery,
) {
  return successfulQueryKey === JSON.stringify(nextQuery);
}

function providerIdentity(row: Pick<ModelUsageConnectionRow, 'providerId' | 'upstreamProviderId'>) {
  return row.upstreamProviderId
    ? `${providerDisplayName(row.upstreamProviderId)} via ${providerDisplayName(row.providerId)}`
    : providerDisplayName(row.providerId);
}

function providerDisplayName(providerId: string) {
  const established: Readonly<Record<string, string>> = {
    anthropic: 'Anthropic',
    chatgpt: 'ChatGPT',
    codex: 'Codex',
    openai: 'OpenAI',
  };
  return (
    established[providerId.toLocaleLowerCase()] ??
    providerId
      .replaceAll(/[_-]+/gu, ' ')
      .replaceAll(/\b[a-z]/gu, (character) => character.toLocaleUpperCase())
  );
}

export function usageModelDisplayName(modelId: string) {
  const leaf = modelId.split('/').at(-1) ?? modelId;
  const gpt = /^gpt-(\d{1,2})(?:[.-](\d{1,2}))?(?:-(sol|terra|luna))?$/iu.exec(leaf);
  if (gpt) {
    const version = gpt[2] ? `${gpt[1]}.${gpt[2]}` : gpt[1];
    const variant = gpt[3]
      ? ` ${gpt[3].charAt(0).toLocaleUpperCase()}${gpt[3].slice(1).toLocaleLowerCase()}`
      : '';
    return `GPT ${version}${variant}`;
  }
  const claude = /^claude-(opus|sonnet|haiku)-(\d{1,2})(?:[.-](\d{1,2}))?$/iu.exec(leaf);
  if (claude) {
    const familyToken = claude[1]!;
    const family = `${familyToken.charAt(0).toLocaleUpperCase()}${familyToken.slice(1).toLocaleLowerCase()}`;
    const version = claude[3] ? `${claude[2]}.${claude[3]}` : claude[2];
    return `Claude ${family} ${version}`;
  }
  const familyOnly = /^(opus|sonnet|haiku)-(\d{1,2})(?:[.-](\d{1,2}))?$/iu.exec(leaf);
  if (familyOnly) {
    const familyToken = familyOnly[1]!;
    const family = `${familyToken.charAt(0).toLocaleUpperCase()}${familyToken.slice(1).toLocaleLowerCase()}`;
    const version = familyOnly[3] ? `${familyOnly[2]}.${familyOnly[3]}` : familyOnly[2];
    return `${family} ${version}`;
  }
  const openAiReasoning = /^o(\d{1,2})(?:-(mini))?$/iu.exec(leaf);
  if (openAiReasoning) return `O${openAiReasoning[1]}${openAiReasoning[2] ? ' Mini' : ''}`;
  return modelId;
}

function workloadLabel(kind: ModelUsageWorkloadKind) {
  return WORKLOAD_LABELS[kind];
}

function shortIdentifier(id: string) {
  return id.slice(0, 8);
}

function projectRowLabel(row: ModelUsageProjectRow) {
  return row.projectName ?? `Unavailable project · ${shortIdentifier(row.projectId)}`;
}

function formatDateTime(value: string | null, timeZone: string) {
  if (value === null) return 'In progress';
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function useUsageQueries({
  adapter,
  period,
  anchorDate,
  timeZone,
  projectId,
  connectionKey,
  modelId,
  workloadKind,
  lectureOffset,
  lectureSnapshotAt,
  refreshVersion,
  initialReport,
}: Readonly<{
  adapter: UsageViewAdapter;
  period: UsagePeriod;
  anchorDate: string;
  timeZone: string;
  projectId: string | null;
  connectionKey: string | null;
  modelId: string | null;
  workloadKind: ModelUsageWorkloadKind | null;
  lectureOffset: number;
  lectureSnapshotAt: string | null;
  refreshVersion: number;
  initialReport?: ModelUsageAnalyticsReport | null;
}>) {
  const [report, setReport] = useState<ModelUsageAnalyticsReport | null>(initialReport ?? null);
  const [optionsReport, setOptionsReport] = useState<ModelUsageAnalyticsReport | null>(
    initialReport ?? null,
  );
  const [phase, setPhase] = useState<UsagePhase>(initialReport ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const successfulQueryKey = useRef<string | null>(null);
  const successfulBaseQueryKey = useRef<string | null>(null);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    const queries = buildUsageAnalyticsQueries({
      period,
      anchorDate,
      timeZone,
      projectId,
      connectionKey,
      modelId,
      workloadKind,
      lectureOffset,
      lectureSnapshotAt,
    });
    const baseQueryKey = JSON.stringify(queries.base);
    const selectedQueryKey = JSON.stringify(queries.selected);
    const sameSuccessfulQuery = shouldRetainUsageReport(
      successfulQueryKey.current,
      queries.selected,
    );
    if (!sameSuccessfulQuery) setReport(null);
    if (successfulBaseQueryKey.current !== baseQueryKey) setOptionsReport(null);
    setPhase(sameSuccessfulQuery ? 'refreshing' : 'loading');
    setError(null);

    const baseRequest = adapter.query(queries.base);
    const selectedRequest = sameQuery(queries.base, queries.selected)
      ? baseRequest
      : adapter.query(queries.selected);
    void Promise.all([baseRequest, selectedRequest])
      .then(([base, selected]) => {
        if (generation.current !== requestGeneration) return;
        setOptionsReport(base);
        setReport(selected);
        successfulBaseQueryKey.current = baseQueryKey;
        successfulQueryKey.current = selectedQueryKey;
        setPhase('ready');
      })
      .catch((queryError: unknown) => {
        if (generation.current !== requestGeneration) return;
        setError(describeError(queryError));
        setPhase('ready');
      });

    return () => {
      if (generation.current === requestGeneration) generation.current += 1;
    };
  }, [
    adapter,
    anchorDate,
    connectionKey,
    lectureOffset,
    lectureSnapshotAt,
    modelId,
    period,
    projectId,
    refreshVersion,
    timeZone,
    workloadKind,
  ]);

  return { report, optionsReport, phase, error };
}

export function UsageView({
  adapter,
  projects,
  initialReport = null,
  initialBreakdown = 'projects',
}: UsageViewProps) {
  const timeZone = useMemo(resolvedTimeZone, []);
  const [period, setPeriod] = useState<UsagePeriod>('day');
  const [anchorDate, setAnchorDate] = useState(() => localCalendarDate(new Date(), timeZone));
  const [projectId, setProjectId] = useState<string | null>(null);
  const [connectionKey, setConnectionKey] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [workloadKind, setWorkloadKind] = useState<ModelUsageWorkloadKind | null>(null);
  const [lectureOffset, setLectureOffset] = useState(0);
  const [lectureSnapshotAt, setLectureSnapshotAt] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<UsageBreakdown>(initialBreakdown);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const { report, optionsReport, phase, error } = useUsageQueries({
    adapter,
    period,
    anchorDate,
    timeZone,
    projectId,
    connectionKey,
    modelId,
    workloadKind,
    lectureOffset,
    lectureSnapshotAt,
    refreshVersion,
    initialReport,
  });
  const filtersActive = Boolean(projectId || connectionKey || modelId || workloadKind);

  const resetLecturePage = () => {
    setLectureOffset(0);
    setLectureSnapshotAt(null);
  };
  const clearFilters = () => {
    setProjectId(null);
    setConnectionKey(null);
    setModelId(null);
    setWorkloadKind(null);
    resetLecturePage();
  };

  return (
    <section
      className="usage-dashboard"
      aria-label="Local model token usage"
      aria-busy={phase !== 'ready'}
    >
      <header className="usage-command-bar">
        <div>
          <span className="eyebrow">LOCAL PROVIDER-REPORTED USAGE</span>
          <h2>Token overview</h2>
          <p>
            Known tokens come only from local provider receipts. Missing usage is never estimated or
            displayed as zero.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={phase === 'refreshing'}
          onClick={() => {
            setAnchorDate(localCalendarDate(new Date(), timeZone));
            resetLecturePage();
            setRefreshVersion((version) => version + 1);
          }}
        >
          {phase === 'refreshing' ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <UsageFilters
        period={period}
        projectId={projectId}
        connectionKey={connectionKey}
        modelId={modelId}
        workloadKind={workloadKind}
        projects={projects}
        optionsReport={optionsReport}
        filtersActive={filtersActive}
        onPeriod={(next) => {
          setPeriod(next);
          resetLecturePage();
        }}
        onProject={(next) => {
          setProjectId(next);
          resetLecturePage();
        }}
        onConnection={(next) => {
          setConnectionKey(next);
          setModelId(null);
          resetLecturePage();
        }}
        onModel={(next) => {
          if (next) setConnectionKey(next.connectionKey);
          setModelId(next?.modelId ?? null);
          resetLecturePage();
        }}
        onWorkload={(next) => {
          setWorkloadKind(next);
          resetLecturePage();
        }}
        onClear={clearFilters}
      />

      {error && (
        <div className="notice error usage-error" role="alert">
          <span>
            {report
              ? `${error} Showing the last locally loaded report.`
              : 'GOSU could not read the local usage report.'}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setRefreshVersion((version) => version + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {!report ? (
        <div className="usage-loading" role="status">
          {error ? 'No usage report is available.' : 'Reading locally recorded token usage…'}
        </div>
      ) : (
        <UsageReport
          report={report}
          filtersActive={filtersActive}
          breakdown={breakdown}
          onBreakdown={setBreakdown}
          onLectureOffset={(offset) => {
            setLectureSnapshotAt(report.lectureGenerations.snapshotAt);
            setLectureOffset(offset);
          }}
        />
      )}
    </section>
  );
}

function UsageFilters({
  period,
  projectId,
  connectionKey,
  modelId,
  workloadKind,
  projects,
  optionsReport,
  filtersActive,
  onPeriod,
  onProject,
  onConnection,
  onModel,
  onWorkload,
  onClear,
}: Readonly<{
  period: UsagePeriod;
  projectId: string | null;
  connectionKey: string | null;
  modelId: string | null;
  workloadKind: ModelUsageWorkloadKind | null;
  projects: readonly ProjectRecord[];
  optionsReport: ModelUsageAnalyticsReport | null;
  filtersActive: boolean;
  onPeriod: (period: UsagePeriod) => void;
  onProject: (projectId: string | null) => void;
  onConnection: (connectionKey: string | null) => void;
  onModel: (selection: Readonly<{ connectionKey: string; modelId: string }> | null) => void;
  onWorkload: (kind: ModelUsageWorkloadKind | null) => void;
  onClear: () => void;
}>) {
  const projectOptions = useMemo(
    () => buildProjectOptions(projects, optionsReport?.byProject ?? []),
    [optionsReport?.byProject, projects],
  );
  const connections = optionsReport?.byConnection ?? [];
  const models = buildModelOptions(optionsReport?.byModel ?? [], connectionKey);
  const observedWorkloads = new Set(
    (optionsReport?.byWorkload ?? []).map(({ workloadKind: kind }) => kind),
  );

  return (
    <section className="usage-filter-bar" aria-label="Filter token usage">
      <div className="usage-period-control" role="group" aria-label="Usage period">
        {USAGE_PERIODS.map((option) => (
          <button
            type="button"
            key={option}
            className={period === option ? 'active' : ''}
            aria-pressed={period === option}
            onClick={() => onPeriod(option)}
          >
            {usagePeriodLabel(option)}
          </button>
        ))}
      </div>
      <label>
        Project owner
        <select value={projectId ?? ''} onChange={(event) => onProject(event.target.value || null)}>
          <option value="">All project owners</option>
          {projectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Workload
        <select
          value={workloadKind ?? ''}
          onChange={(event) =>
            onWorkload((event.target.value || null) as ModelUsageWorkloadKind | null)
          }
        >
          <option value="">All workloads</option>
          {MODEL_USAGE_WORKLOAD_KINDS.filter((kind) => observedWorkloads.has(kind)).map((kind) => (
            <option key={kind} value={kind}>
              {workloadLabel(kind)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Connection / provider
        <select
          value={connectionKey ?? ''}
          onChange={(event) => onConnection(event.target.value || null)}
        >
          <option value="">All observed connections</option>
          {connections.map((row) => (
            <option key={row.connectionKey} value={row.connectionKey}>
              {row.connectionLabel} · {providerIdentity(row)}
            </option>
          ))}
          {connectionKey && !connections.some((row) => row.connectionKey === connectionKey) && (
            <option value={connectionKey}>{connectionKey} · no usage in base range</option>
          )}
        </select>
      </label>
      <label>
        Model
        <select
          value={modelId && connectionKey ? qualifiedModelOptionValue(connectionKey, modelId) : ''}
          onChange={(event) => {
            const option = models.find(({ value }) => value === event.target.value);
            onModel(option ? { connectionKey: option.connectionKey, modelId: option.id } : null);
          }}
        >
          <option value="">All observed models</option>
          {models.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {modelId &&
            connectionKey &&
            !models.some(
              (option) => option.id === modelId && option.connectionKey === connectionKey,
            ) && (
              <option value={qualifiedModelOptionValue(connectionKey, modelId)}>
                {modelId} · selected connection has no usage in base range
              </option>
            )}
        </select>
      </label>
      <button type="button" className="ghost-button" disabled={!filtersActive} onClick={onClear}>
        Clear filters
      </button>
    </section>
  );
}

function buildProjectOptions(
  projects: readonly ProjectRecord[],
  rows: readonly ModelUsageProjectRow[],
) {
  const names = new Map<string, number>();
  projects.forEach((project) => names.set(project.name, (names.get(project.name) ?? 0) + 1));
  const options = new Map<string, string>();
  projects.forEach((project) => {
    const disambiguated =
      (names.get(project.name) ?? 0) > 1 ? `${project.name} · ${project.slug}` : project.name;
    const state = project.trashedAt ? 'Trash' : project.archivedAt ? 'Archived' : null;
    options.set(project.id, state ? `${disambiguated} · ${state}` : disambiguated);
  });
  rows.forEach((row) => {
    if (!options.has(row.projectId)) options.set(row.projectId, projectRowLabel(row));
  });
  return [...options.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    );
}

function buildModelOptions(rows: readonly ModelUsageModelRow[], connectionKey: string | null) {
  const scoped = connectionKey ? rows.filter((row) => row.connectionKey === connectionKey) : rows;
  return scoped
    .map((row) => ({
      id: row.resolvedModelId,
      connectionKey: row.connectionKey,
      value: qualifiedModelOptionValue(row.connectionKey, row.resolvedModelId),
      label: connectionKey
        ? usageModelDisplayName(row.resolvedModelId)
        : `${usageModelDisplayName(row.resolvedModelId)} · ${row.connectionLabel}`,
    }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.connectionKey.localeCompare(right.connectionKey),
    );
}

function qualifiedModelOptionValue(connectionKey: string, modelId: string) {
  return JSON.stringify([connectionKey, modelId]);
}

function UsageReport({
  report,
  filtersActive,
  breakdown,
  onBreakdown,
  onLectureOffset,
}: Readonly<{
  report: ModelUsageAnalyticsReport;
  filtersActive: boolean;
  breakdown: UsageBreakdown;
  onBreakdown: (breakdown: UsageBreakdown) => void;
  onLectureOffset: (offset: number) => void;
}>) {
  const reportedTurns = reportedUsageTurnCount(report.totals);
  const noTurns = report.totals.turnCount === 0;
  const noReportedTokens = report.totals.turnCount > 0 && reportedTurns === 0;
  const lowerBoundReporting =
    reportedTurns > 0 &&
    (report.totals.partialTurnCount > 0 || report.totals.unavailableTurnCount > 0);

  return (
    <>
      <div className="usage-source-note" role="status">
        <div>
          <strong>
            {formatUsageRange(
              report.range.fromInclusive,
              report.range.toExclusive,
              report.range.timeZone,
            )}
          </strong>
          <span>
            Updated {formatDateTime(report.generatedAt, report.range.timeZone)} · Tracked since{' '}
            {formatDateTime(report.trackingStartedAt, report.range.timeZone)} · Local only
          </span>
        </div>
        <small>
          Project totals use the recorded output owner. Linked Lecture source projects are not
          duplicated.
        </small>
      </div>

      {report.rangeCoverage === 'partial' && (
        <div className="usage-coverage-notice" role="status">
          <strong>Partial history</strong>
          <span>
            Tracking started inside this range. Earlier turns are not estimated or counted as zero.
          </span>
        </div>
      )}
      {report.rangeCoverage === 'not_tracked' && (
        <div className="usage-coverage-notice" role="status">
          <strong>Not tracked in this range</strong>
          <span>
            This entire range predates local usage tracking. GOSU does not estimate earlier turns or
            substitute zero.
          </span>
        </div>
      )}
      {(noReportedTokens || lowerBoundReporting) && (
        <div className="usage-coverage-notice" role="status">
          <strong>
            {noReportedTokens ? 'Token counts not reported' : 'Known totals are a lower bound'}
          </strong>
          <span>
            {describeAggregateCoverage(report.totals)}. Partial reports may be lower bounds;
            unavailable turns remain visible in coverage and are excluded from token totals.
          </span>
        </div>
      )}

      <UsageSummary aggregate={report.totals} />

      <UsageModelSummary rows={report.byModel} />

      {noTurns ? (
        <div className="usage-empty">
          <strong>
            {report.rangeCoverage === 'not_tracked'
              ? 'Usage was not tracked in this range'
              : filtersActive
                ? 'No usage matches these filters'
                : 'No recorded usage in this range'}
          </strong>
          <span>
            {report.rangeCoverage === 'not_tracked'
              ? 'Choose a current range to review locally reported token usage.'
              : filtersActive
                ? 'Change or clear a project, workload, connection, or model filter.'
                : 'A finalized model turn will appear here when its local usage receipt is recorded.'}
          </span>
        </div>
      ) : reportedTurns === 0 ? (
        <div className="usage-empty">
          <strong>Turns were recorded, but token counts were not reported</strong>
          <span>GOSU keeps these turns in coverage and does not substitute estimated values.</span>
        </div>
      ) : report.series.length === 0 ? (
        <div className="usage-empty">
          <strong>Known totals are available, but trend buckets are unavailable</strong>
          <span>The breakdown tables still show the locally reported totals for this range.</span>
        </div>
      ) : (
        <UsageTokenChart report={report} />
      )}

      <UsageBreakdownTabs
        report={report}
        active={breakdown}
        onActive={onBreakdown}
        onLectureOffset={onLectureOffset}
      />
    </>
  );
}

function UsageSummary({ aggregate }: { aggregate: ModelUsageAggregate }) {
  const reported = reportedUsageTurnCount(aggregate);
  return (
    <section className="usage-summary-grid" aria-label="Usage summary">
      <UsageSummaryCard
        label="Known input tokens"
        value={aggregateTokenValue(aggregate, 'inputTokens')}
        detail="Provider-reported input only"
      />
      <UsageSummaryCard
        label="Known output tokens"
        value={aggregateTokenValue(aggregate, 'outputTokens')}
        detail="Provider-reported output only"
      />
      <UsageSummaryCard
        label="Known total tokens"
        value={aggregateTokenValue(aggregate, 'totalTokens')}
        detail="Known input + output"
      />
      <article className="usage-summary-card coverage">
        <span>Reporting coverage</span>
        <strong>
          {reported.toLocaleString()} / {aggregate.turnCount.toLocaleString()}
        </strong>
        <small>{describeAggregateCoverage(aggregate)}</small>
      </article>
    </section>
  );
}

function UsageSummaryCard({
  label,
  value,
  detail,
}: Readonly<{ label: string; value: number | null; detail: string }>) {
  return (
    <article className="usage-summary-card">
      <span>{label}</span>
      <strong
        aria-label={
          value === null ? `${label}: Not reported` : `${label}: ${formatTokenCount(value)} tokens`
        }
      >
        {formatCompactTokenCount(value)}
      </strong>
      <small>{value === null ? 'Not reported' : detail}</small>
    </article>
  );
}

function UsageModelSummary({ rows }: { rows: readonly ModelUsageModelRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, 8);
  return (
    <section className="usage-model-summary" aria-labelledby="usage-model-summary-heading">
      <header>
        <div>
          <span className="eyebrow">MODEL MIX</span>
          <h3 id="usage-model-summary-heading">Usage by model</h3>
          <p>
            Each resolved model is counted separately. The connection remains visible so usage from
            different accounts or providers is not silently merged.
          </p>
        </div>
        {rows.length > 8 && (
          <button
            type="button"
            className="ghost-button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Show top 8' : `Show all ${rows.length.toLocaleString()} models`}
          </button>
        )}
      </header>
      {rows.length === 0 ? (
        <div className="usage-model-summary-empty">
          No finalized turn in this report included a resolved model identity.
        </div>
      ) : (
        <div className="usage-model-card-grid">
          {visibleRows.map((row) => (
            <article
              className="usage-model-card"
              key={`${row.connectionKey}:${row.resolvedModelId}`}
            >
              <header>
                <div>
                  <strong>{usageModelDisplayName(row.resolvedModelId)}</strong>
                  <small>{row.resolvedModelId}</small>
                </div>
                <span>{row.connectionLabel}</span>
              </header>
              <dl>
                <ModelTokenMetric label="Input" value={aggregateTokenValue(row, 'inputTokens')} />
                <ModelTokenMetric label="Output" value={aggregateTokenValue(row, 'outputTokens')} />
                <ModelTokenMetric label="Total" value={aggregateTokenValue(row, 'totalTokens')} />
              </dl>
              <footer>
                <span>{providerIdentity(row)}</span>
                <span>{describeAggregateCoverage(row)}</span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ModelTokenMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd
        aria-label={`${label}: ${value === null ? 'Not reported' : `${formatTokenCount(value)} tokens`}`}
      >
        {formatCompactTokenCount(value)}
      </dd>
    </div>
  );
}

function UsageTokenChart({ report }: { report: ModelUsageAnalyticsReport }) {
  const generatedId = useId().replaceAll(':', '');
  const titleId = `usage-chart-title-${generatedId}`;
  const descriptionId = `usage-chart-description-${generatedId}`;
  const helpId = `usage-chart-table-help-${generatedId}`;
  const patternId = `usage-chart-incomplete-${generatedId}`;
  const buckets = usageSeriesChartBuckets(report.series, report.range.timeZone);
  const chart = buildUsageTokenChart(buckets);
  const labelIndexes = new Set(
    buckets.length <= 10
      ? buckets.map((_, index) => index)
      : [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1],
  );

  return (
    <article className="usage-chart-card">
      <header>
        <div>
          <span className="eyebrow">KNOWN TOKENS OVER TIME</span>
          <h3>Input and output trend</h3>
          <p>Hatched bars include partial or unavailable turns and are known lower bounds.</p>
        </div>
        <div className="usage-chart-legend" aria-label="Chart legend">
          <span className="input">
            <i />
            Input
          </span>
          <span className="output">
            <i />
            Output
          </span>
          <span className="incomplete">
            <i />
            Lower bound
          </span>
        </div>
      </header>
      <figure className="usage-chart-figure">
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <title id={titleId}>Known input and output tokens over time</title>
          <desc id={descriptionId}>
            Provider-reported input and output tokens for {report.series.length} calendar buckets.
            The accompanying data table contains the same values and reporting coverage.
          </desc>
          <defs>
            <pattern
              id={patternId}
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="7" className="usage-chart-pattern-line" />
            </pattern>
          </defs>
          {chart.ticks.map((tick) => (
            <g key={tick.value}>
              <line
                className="usage-chart-gridline"
                x1={chart.plotLeft}
                x2={chart.plotRight}
                y1={tick.y}
                y2={tick.y}
              />
              <text
                className="usage-chart-axis-label"
                x={chart.plotLeft - 10}
                y={tick.y + 4}
                textAnchor="end"
              >
                {formatCompactTokenCount(Math.round(tick.value))}
              </text>
            </g>
          ))}
          {chart.bars.map((bar, index) => (
            <g
              key={bar.id}
              role="img"
              tabIndex={0}
              aria-label={bar.accessibleLabel}
              className="usage-chart-bucket"
            >
              <rect
                className="usage-chart-bar input"
                x={bar.x}
                y={bar.inputY}
                width={bar.width}
                height={bar.inputHeight}
              />
              <rect
                className="usage-chart-bar output"
                x={bar.x}
                y={bar.outputY}
                width={bar.width}
                height={bar.outputHeight}
              />
              {bar.incomplete && (
                <rect
                  className="usage-chart-lower-bound"
                  x={bar.x}
                  y={bar.outputY}
                  width={bar.width}
                  height={bar.inputHeight + bar.outputHeight}
                  fill={`url(#${patternId})`}
                />
              )}
              {labelIndexes.has(index) && (
                <text
                  className="usage-chart-axis-label"
                  x={bar.x + bar.width / 2}
                  y={chart.height - 18}
                  textAnchor="middle"
                >
                  {bar.label}
                </text>
              )}
            </g>
          ))}
        </svg>
        <figcaption>
          Known totals exclude turns whose provider did not report token counts.
        </figcaption>
      </figure>
      <details className="usage-data-disclosure">
        <summary>View token data table</summary>
        <p id={helpId} className="sr-only">
          This table scrolls horizontally when all columns do not fit.
        </p>
        <div
          className="usage-table-scroll"
          tabIndex={0}
          aria-label="Token trend data"
          aria-describedby={helpId}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Turns</th>
                <th scope="col">Coverage</th>
                <th scope="col">Known input</th>
                <th scope="col">Known output</th>
                <th scope="col">Known total</th>
              </tr>
            </thead>
            <tbody>
              {report.series.map((row) => (
                <tr key={row.bucketKey}>
                  <td>{row.bucketKey}</td>
                  <td>{row.turnCount.toLocaleString()}</td>
                  <td>{describeAggregateCoverage(row)}</td>
                  <TokenAggregateCell aggregate={row} field="inputTokens" />
                  <TokenAggregateCell aggregate={row} field="outputTokens" />
                  <TokenAggregateCell aggregate={row} field="totalTokens" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

function UsageBreakdownTabs({
  report,
  active,
  onActive,
  onLectureOffset,
}: Readonly<{
  report: ModelUsageAnalyticsReport;
  active: UsageBreakdown;
  onActive: (breakdown: UsageBreakdown) => void;
  onLectureOffset: (offset: number) => void;
}>) {
  const generatedId = useId().replaceAll(':', '');
  const tabListRef = useRef<HTMLDivElement>(null);
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, current: UsageBreakdown) => {
    const currentIndex = USAGE_BREAKDOWNS.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % USAGE_BREAKDOWNS.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + USAGE_BREAKDOWNS.length) % USAGE_BREAKDOWNS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = USAGE_BREAKDOWNS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = USAGE_BREAKDOWNS[nextIndex]!;
    onActive(next);
    requestAnimationFrame(() =>
      tabListRef.current
        ?.querySelector<HTMLButtonElement>(`#usage-tab-${generatedId}-${next}`)
        ?.focus(),
    );
  };
  const panelId = `usage-panel-${generatedId}`;

  return (
    <section className="usage-breakdown-card" aria-label="Usage breakdown">
      <div
        ref={tabListRef}
        className="usage-breakdown-tabs"
        role="tablist"
        aria-label="Usage breakdown views"
      >
        {USAGE_BREAKDOWNS.map((option) => (
          <button
            key={option}
            id={`usage-tab-${generatedId}-${option}`}
            type="button"
            role="tab"
            aria-selected={active === option}
            aria-controls={panelId}
            tabIndex={active === option ? 0 : -1}
            className={active === option ? 'active' : ''}
            onClick={() => onActive(option)}
            onKeyDown={(event) => selectFromKeyboard(event, option)}
          >
            {usageBreakdownLabel(option)}
          </button>
        ))}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={`usage-tab-${generatedId}-${active}`}>
        {active === 'projects' && <ProjectUsageTable rows={report.byProject} />}
        {active === 'lectures' && <LectureUsageTable report={report} onOffset={onLectureOffset} />}
        {active === 'providers' && (
          <ProviderUsageTables connections={report.byConnection} models={report.byModel} />
        )}
      </div>
    </section>
  );
}

function ProjectUsageTable({ rows }: { rows: readonly ModelUsageProjectRow[] }) {
  if (rows.length === 0)
    return <BreakdownEmpty>No project-owned usage matches this report.</BreakdownEmpty>;
  return (
    <UsageTable label="Usage by output project owner">
      <table>
        <thead>
          <tr>
            <th scope="col">Output project owner</th>
            <th scope="col">Turns</th>
            <th scope="col">Coverage</th>
            <th scope="col">Known input</th>
            <th scope="col">Known output</th>
            <th scope="col">Known total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.projectId}>
              <td>
                <strong>{projectRowLabel(row)}</strong>
                <small>{shortIdentifier(row.projectId)}</small>
              </td>
              <td>{row.turnCount.toLocaleString()}</td>
              <td>{describeAggregateCoverage(row)}</td>
              <TokenAggregateCell aggregate={row} field="inputTokens" />
              <TokenAggregateCell aggregate={row} field="outputTokens" />
              <TokenAggregateCell aggregate={row} field="totalTokens" />
            </tr>
          ))}
        </tbody>
      </table>
    </UsageTable>
  );
}

function LectureUsageTable({
  report,
  onOffset,
}: {
  report: ModelUsageAnalyticsReport;
  onOffset: (offset: number) => void;
}) {
  const page = report.lectureGenerations;
  if (page.total === 0)
    return <BreakdownEmpty>No Lecture generations match this report.</BreakdownEmpty>;
  const first = page.offset + 1;
  const last = Math.min(page.total, page.offset + page.items.length);
  return (
    <>
      <UsageTable label="Usage by Lecture generation">
        <table>
          <thead>
            <tr>
              <th scope="col">Lecture generation</th>
              <th scope="col">Output project owner</th>
              <th scope="col">Status</th>
              <th scope="col">Connection / model</th>
              <th scope="col">Turns</th>
              <th scope="col">Coverage</th>
              <th scope="col">Known input</th>
              <th scope="col">Known output</th>
              <th scope="col">Known total</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((row) => (
              <LectureUsageRow key={row.attemptId} row={row} timeZone={report.range.timeZone} />
            ))}
          </tbody>
        </table>
      </UsageTable>
      <footer className="usage-pagination">
        <span>
          {first.toLocaleString()}–{last.toLocaleString()} of {page.total.toLocaleString()}{' '}
          generations
        </span>
        <div>
          <button
            type="button"
            className="secondary-button"
            disabled={page.offset === 0}
            onClick={() => onOffset(Math.max(0, page.offset - page.limit))}
          >
            Previous
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={page.offset + page.items.length >= page.total}
            onClick={() => onOffset(page.offset + page.limit)}
          >
            Next
          </button>
        </div>
      </footer>
    </>
  );
}

function LectureUsageRow({
  row,
  timeZone,
}: {
  row: ModelUsageLectureGenerationRow;
  timeZone: string;
}) {
  return (
    <tr>
      <td>
        <strong>{row.studioTitle}</strong>
        <small>
          {formatDateTime(row.completedAt ?? row.startedAt, timeZone)} ·{' '}
          {shortIdentifier(row.attemptId)}
        </small>
      </td>
      <td>
        <strong>
          {row.projectName ?? `Unavailable project · ${shortIdentifier(row.projectId)}`}
        </strong>
      </td>
      <td>
        <span className={`usage-status-chip ${row.status}`}>{row.status}</span>
      </td>
      <td>
        <div className="usage-connection-list">
          {row.byConnection.length === 0 ? (
            <span>— Not recorded</span>
          ) : (
            row.byConnection.map((connection) => (
              <span key={`${connection.connectionKey}:${connection.resolvedModelId ?? 'unknown'}`}>
                <strong>{connection.connectionLabel}</strong>
                <small>
                  {providerIdentity(connection)} ·{' '}
                  {connection.resolvedModelId
                    ? usageModelDisplayName(connection.resolvedModelId)
                    : 'Model not reported'}
                </small>
              </span>
            ))
          )}
        </div>
      </td>
      <td>{row.turnCount.toLocaleString()}</td>
      <td>{lectureCoverageLabel(row.coverage)}</td>
      <LectureTokenCell tokens={row.tokens} field="inputTokens" />
      <LectureTokenCell tokens={row.tokens} field="outputTokens" />
      <LectureTokenCell tokens={row.tokens} field="totalTokens" />
    </tr>
  );
}

function lectureCoverageLabel(coverage: ModelUsageCoverage) {
  if (coverage === 'pending') return 'Pending';
  if (coverage === 'exact') return 'Exact provider report';
  if (coverage === 'partial') return 'Partial · known lower bound';
  if (coverage === 'not_tracked') return 'Not tracked';
  return '— Not reported';
}

function ProviderUsageTables({
  connections,
  models,
}: {
  connections: readonly ModelUsageConnectionRow[];
  models: readonly ModelUsageModelRow[];
}) {
  if (connections.length === 0 && models.length === 0)
    return <BreakdownEmpty>No provider or model usage matches this report.</BreakdownEmpty>;
  return (
    <div className="usage-provider-sections">
      <section>
        <header>
          <h3>Observed connections</h3>
          <p>Connection labels and provider identity are preserved from local turn receipts.</p>
        </header>
        {connections.length === 0 ? (
          <BreakdownEmpty>No observed connections match.</BreakdownEmpty>
        ) : (
          <UsageTable label="Usage by observed connection">
            <table>
              <thead>
                <tr>
                  <th scope="col">Connection</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Turns</th>
                  <th scope="col">Coverage</th>
                  <th scope="col">Known input</th>
                  <th scope="col">Known output</th>
                  <th scope="col">Known total</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((row) => (
                  <tr key={row.connectionKey}>
                    <td>
                      <strong>{row.connectionLabel}</strong>
                      <small>{row.connectionKey}</small>
                    </td>
                    <td>{providerIdentity(row)}</td>
                    <td>{row.turnCount.toLocaleString()}</td>
                    <td>{describeAggregateCoverage(row)}</td>
                    <TokenAggregateCell aggregate={row} field="inputTokens" />
                    <TokenAggregateCell aggregate={row} field="outputTokens" />
                    <TokenAggregateCell aggregate={row} field="totalTokens" />
                  </tr>
                ))}
              </tbody>
            </table>
          </UsageTable>
        )}
      </section>
      <section>
        <header>
          <h3>Observed models</h3>
          <p>Models stay qualified by the connection and provider that reported them.</p>
        </header>
        {models.length === 0 ? (
          <BreakdownEmpty>No observed models match.</BreakdownEmpty>
        ) : (
          <UsageTable label="Usage by observed model">
            <table>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Connection / provider</th>
                  <th scope="col">Turns</th>
                  <th scope="col">Coverage</th>
                  <th scope="col">Known input</th>
                  <th scope="col">Known output</th>
                  <th scope="col">Known total</th>
                </tr>
              </thead>
              <tbody>
                {models.map((row) => (
                  <tr key={`${row.connectionKey}:${row.resolvedModelId}`}>
                    <td>
                      <strong>{usageModelDisplayName(row.resolvedModelId)}</strong>
                      <small>{row.resolvedModelId}</small>
                    </td>
                    <td>
                      <strong>{row.connectionLabel}</strong>
                      <small>{providerIdentity(row)}</small>
                    </td>
                    <td>{row.turnCount.toLocaleString()}</td>
                    <td>{describeAggregateCoverage(row)}</td>
                    <TokenAggregateCell aggregate={row} field="inputTokens" />
                    <TokenAggregateCell aggregate={row} field="outputTokens" />
                    <TokenAggregateCell aggregate={row} field="totalTokens" />
                  </tr>
                ))}
              </tbody>
            </table>
          </UsageTable>
        )}
      </section>
    </div>
  );
}

function UsageTable({ label, children }: { label: string; children: ReactNode }) {
  const helpId = `usage-table-help-${useId().replaceAll(':', '')}`;
  return (
    <>
      <p id={helpId} className="sr-only">
        This table scrolls horizontally when all columns do not fit.
      </p>
      <div className="usage-table-scroll" tabIndex={0} aria-label={label} aria-describedby={helpId}>
        {children}
      </div>
    </>
  );
}

function TokenAggregateCell({
  aggregate,
  field,
}: {
  aggregate: ModelUsageAggregate;
  field: 'inputTokens' | 'outputTokens' | 'totalTokens';
}) {
  return <TokenCell value={aggregateTokenValue(aggregate, field)} />;
}

function LectureTokenCell({
  tokens,
  field,
}: {
  tokens: ModelUsageTokenTotals | null;
  field: 'inputTokens' | 'outputTokens' | 'totalTokens';
}) {
  return <TokenCell value={tokens?.[field] ?? null} />;
}

function TokenCell({ value }: { value: number | null }) {
  return value === null ? (
    <td className="usage-token-unavailable">
      — <small>Not reported</small>
    </td>
  ) : (
    <td>{formatTokenCount(value)}</td>
  );
}

function BreakdownEmpty({ children }: { children: ReactNode }) {
  return <div className="usage-breakdown-empty">{children}</div>;
}
