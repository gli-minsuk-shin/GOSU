import { uiText, useUiText, uiLocale } from '@gosu/ui/language';

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
  MODEL_PRICE_SOURCE_LABEL,
  estimateUsageCostUsd,
  modelPriceKey,
  type ModelPrice,
  type ModelPriceStatus,
  type UsageCostSummary,
} from '../../shared/model-price-contracts';
import {
  type MODEL_USAGE_DETAIL_WORKLOADS,
  MODEL_USAGE_WORKLOAD_KINDS,
  type ModelUsageAggregate,
  type ModelUsageAnalyticsQuery,
  type ModelUsageAnalyticsReport,
  type ModelUsageConnectionRow,
  type ModelUsageCoverage,
  type ModelUsageLectureGenerationRow,
  type ModelUsageModelRow,
  type ModelUsageProjectRow,
  type ModelUsageProjectModelRow,
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
  formatUsd,
  localCalendarDate,
  reportedUsageTurnCount,
  usageBreakdownLabel,
  usagePeriodLabel,
  usageSeriesChartBuckets,
  type UsageBreakdown,
  type UsagePeriod,
} from './usage-view-model';
import './usage-view.css';
import { UsageLimitsPanel } from './usage-limits-panel';
import { UsageDistribution } from './usage-distribution';
import {
  buildUsageDistribution,
  type UsageCostState,
  type UsageDistributionMetric,
} from './usage-distribution-model';
import type { UsageLimitSettings, UsageLimitStatus } from '../../shared/usage-limit-contracts';

const LECTURE_PAGE_SIZE = 25;

const WORKLOAD_LABELS: Readonly<Record<ModelUsageWorkloadKind, string>> = {
  briefing_assistant: 'AI 비서',
  briefing_summary: '브리핑·요약',
  paper_summary: '논문 요약',
  context_compaction: '대화 문맥 압축',
  daily_quote: '오늘의 격언',
  model_lab: 'Model Lab',
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
  /** The public API price list GOSU keeps; without it the view shows tokens only. */
  prices?: () => Promise<ModelPriceStatus>;
  refreshPrices?: () => Promise<ModelPriceStatus>;
}>;

export type UsageViewProps = Readonly<{
  adapter: UsageViewAdapter;
  projects: readonly ProjectRecord[];
  initialReport?: ModelUsageAnalyticsReport | null;
  initialBreakdown?: UsageBreakdown;
  /** A price list already in hand (tests, or a caller that loaded it), shown before the first load. */
  initialPriceStatus?: ModelPriceStatus | null;
  /** What the distribution lists compare by. Cost first: the user asked "how much money". */
  initialDistributionMetric?: UsageDistributionMetric;
  /** Remaining plan limits of the connected CLIs, kept by the app shell (the title bar shows them too). */
  limits?: Readonly<{
    status: UsageLimitStatus | null;
    now: number;
    failure?: string | null;
    onRefresh: () => void;
    onConfigure: (settings: UsageLimitSettings) => void;
  }>;
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
  const gpt = /^gpt-(\d{1,2})(?:[.-](\d{1,2}))?(?:-(sol|terra|luna|astra))?$/iu.exec(leaf);
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
  return uiText(WORKLOAD_LABELS[kind]);
}

function shortIdentifier(id: string) {
  return id.slice(0, 8);
}

function projectRowLabel(row: ModelUsageProjectRow) {
  return row.projectName ?? `Unavailable project · ${shortIdentifier(row.projectId)}`;
}

function formatDateTime(value: string | null, timeZone: string) {
  if (value === null) return uiText('In progress');
  return new Intl.DateTimeFormat(uiLocale(), {
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
  initialBreakdown = 'briefing',
  initialPriceStatus = null,
  initialDistributionMetric = 'usd',
  limits,
}: UsageViewProps) {
  useUiText();
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
  // Kept here, not in the report: the report remounts on every period or filter change.
  const [distributionMetric, setDistributionMetric] =
    useState<UsageDistributionMetric>(initialDistributionMetric);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [priceStatus, setPriceStatus] = useState<ModelPriceStatus | null>(initialPriceStatus);
  const [pricesRefreshing, setPricesRefreshing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void adapter
      .prices?.()
      .then((status) => {
        if (!cancelled) setPriceStatus(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [adapter]);
  const refreshPrices = adapter.refreshPrices
    ? () => {
        setPricesRefreshing(true);
        void adapter.refreshPrices!()
          .then(setPriceStatus)
          .catch(() => undefined)
          .finally(() => setPricesRefreshing(false));
      }
    : undefined;
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
      aria-label={uiText('Local model token usage')}
      aria-busy={phase !== 'ready'}
    >
      <header className="usage-command-bar">
        <div>
          <span className="eyebrow">{uiText('LOCAL PROVIDER-REPORTED USAGE')}</span>
          <h2>{uiText('Token overview')}</h2>
          <p>
            {uiText(
              'Known tokens come only from local provider receipts. Missing usage is never estimated or displayed as zero.',
            )}
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
          {phase === 'refreshing' ? uiText('Refreshing…') : uiText('Refresh')}
        </button>
      </header>

      {limits?.status && (
        <UsageLimitsPanel
          status={limits.status}
          now={limits.now}
          timeZone={timeZone}
          failure={limits.failure ?? null}
          onRefresh={limits.onRefresh}
          onConfigure={limits.onConfigure}
        />
      )}

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
              ? uiText('{error} Showing the last locally loaded report.', { error: error })
              : uiText('GOSU could not read the local usage report.')}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setRefreshVersion((version) => version + 1)}
          >
            {uiText('Retry')}
          </button>
        </div>
      )}

      {!report ? (
        <div className="usage-loading" role="status">
          {error
            ? uiText('No usage report is available.')
            : uiText('Reading locally recorded token usage…')}
        </div>
      ) : (
        <UsageReport
          report={report}
          priceStatus={priceStatus}
          pricesRefreshing={pricesRefreshing}
          onRefreshPrices={refreshPrices}
          filtersActive={filtersActive}
          breakdown={breakdown}
          onBreakdown={setBreakdown}
          distributionMetric={distributionMetric}
          onDistributionMetric={setDistributionMetric}
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
  useUiText();
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
    <section className="usage-filter-bar" aria-label={uiText('Filter token usage')}>
      <div className="usage-period-control" role="group" aria-label={uiText('Usage period')}>
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
        {uiText('Project owner')}
        <select value={projectId ?? ''} onChange={(event) => onProject(event.target.value || null)}>
          <option value="">{uiText('All project owners')}</option>
          {projectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {uiText('Workload')}
        <select
          value={workloadKind ?? ''}
          onChange={(event) =>
            onWorkload((event.target.value || null) as ModelUsageWorkloadKind | null)
          }
        >
          <option value="">{uiText('All workloads')}</option>
          {MODEL_USAGE_WORKLOAD_KINDS.filter((kind) => observedWorkloads.has(kind)).map((kind) => (
            <option key={kind} value={kind}>
              {workloadLabel(kind)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {uiText('Connection / provider')}
        <select
          value={connectionKey ?? ''}
          onChange={(event) => onConnection(event.target.value || null)}
        >
          <option value="">{uiText('All observed connections')}</option>
          {connections.map((row) => (
            <option key={row.connectionKey} value={row.connectionKey}>
              {row.connectionLabel} · {providerIdentity(row)}
            </option>
          ))}
          {connectionKey && !connections.some((row) => row.connectionKey === connectionKey) && (
            <option value={connectionKey}>
              {connectionKey} {uiText('· no usage in base range')}
            </option>
          )}
        </select>
      </label>
      <label>
        {uiText('Model')}
        <select
          value={modelId && connectionKey ? qualifiedModelOptionValue(connectionKey, modelId) : ''}
          onChange={(event) => {
            const option = models.find(({ value }) => value === event.target.value);
            onModel(option ? { connectionKey: option.connectionKey, modelId: option.id } : null);
          }}
        >
          <option value="">{uiText('All observed models')}</option>
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
                {modelId} {uiText('· selected connection has no usage in base range')}
              </option>
            )}
        </select>
      </label>
      <button type="button" className="ghost-button" disabled={!filtersActive} onClick={onClear}>
        {uiText('Clear filters')}
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
  priceStatus = null,
  pricesRefreshing = false,
  onRefreshPrices,
  filtersActive,
  breakdown,
  onBreakdown,
  distributionMetric = 'usd',
  onDistributionMetric = () => undefined,
  onLectureOffset,
}: Readonly<{
  report: ModelUsageAnalyticsReport;
  priceStatus?: ModelPriceStatus | null;
  pricesRefreshing?: boolean;
  onRefreshPrices?: (() => void) | undefined;
  filtersActive: boolean;
  breakdown: UsageBreakdown;
  onBreakdown: (breakdown: UsageBreakdown) => void;
  distributionMetric?: UsageDistributionMetric;
  onDistributionMetric?: (metric: UsageDistributionMetric) => void;
  onLectureOffset: (offset: number) => void;
}>) {
  // One source for every amount on the screen (summary card, model cards, both lists, the feature
  // table): cost does not add up across different groupings, see buildUsageDistribution.
  const distribution = useMemo(
    () => buildUsageDistribution(report, priceStatus?.catalog?.models ?? null),
    [report, priceStatus?.catalog],
  );
  const workloadCosts = new Map(distribution.workloads.map((row) => [row.id, row.cost]));
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
            {uiText('Updated')} {formatDateTime(report.generatedAt, report.range.timeZone)}{' '}
            {uiText('· Tracked since')}{' '}
            {formatDateTime(report.trackingStartedAt, report.range.timeZone)}{' '}
            {uiText('· Local only')}
          </span>
        </div>
        <small>
          {uiText(
            'Project totals use the recorded output owner. Linked Lecture source projects are not duplicated.',
          )}
        </small>
      </div>

      {report.rangeCoverage === 'partial' && (
        <div className="usage-coverage-notice" role="status">
          <strong>{uiText('Partial history')}</strong>
          <span>
            {uiText(
              'Tracking started inside this range. Earlier turns are not estimated or counted as zero.',
            )}
          </span>
        </div>
      )}
      {report.rangeCoverage === 'not_tracked' && (
        <div className="usage-coverage-notice" role="status">
          <strong>{uiText('Not tracked in this range')}</strong>
          <span>
            {uiText(
              'This entire range predates local usage tracking. GOSU does not estimate earlier turns or substitute zero.',
            )}
          </span>
        </div>
      )}
      {(noReportedTokens || lowerBoundReporting) && (
        <div className="usage-coverage-notice" role="status">
          <strong>
            {noReportedTokens
              ? uiText('Token counts not reported')
              : uiText('Known totals are a lower bound')}
          </strong>
          <span>
            {describeAggregateCoverage(report.totals)}
            {uiText(
              '. Partial reports may be lower bounds; unavailable turns remain visible in coverage and are excluded from token totals.',
            )}
          </span>
        </div>
      )}

      <UsageSummary aggregate={report.totals} cost={distribution.total} />
      {priceStatus && (
        <UsagePriceNote
          status={priceStatus}
          timeZone={report.range.timeZone}
          refreshing={pricesRefreshing}
          onRefresh={onRefreshPrices}
        />
      )}

      <UsageDistribution
        models={distribution.models}
        workloads={distribution.workloads}
        metric={distributionMetric}
        onMetric={onDistributionMetric}
        modelLabel={usageModelDisplayName}
        workloadLabel={(kind) => workloadLabel(kind as ModelUsageWorkloadKind)}
      />
      <p className="usage-coverage-notice">
        AI 비서·브리핑 기록은 수집 기능 적용 후부터 보입니다. 과거 미수집 사용량은 추측해 채우지
        않습니다. 모델 표는 위의 프로젝트·작업 종류 필터와 함께 사용할 수 있습니다. 캐시 읽기는
        입력의 일부이며 중복 합산하지 않습니다. 토큰 수는 청구 금액이나 구독 잔액이 아닙니다.
      </p>
      {report.byWorkload.length > 0 && (
        <UsageTable label={uiText('Usage by feature')}>
          <table>
            <thead>
              <tr>
                <th scope="col">{uiText('Feature')}</th>
                <th scope="col">{uiText('Calls')}</th>
                <th scope="col">{uiText('Input')}</th>
                <th scope="col">{uiText('Output')}</th>
                <th scope="col">{uiText('Cached read')}</th>
                <th scope="col">{uiText('Total')}</th>
                {distribution.total && <th scope="col">{uiText('API-equivalent')}</th>}
              </tr>
            </thead>
            <tbody>
              {report.byWorkload.map((row) => (
                <tr key={row.workloadKind}>
                  <td>{uiText(WORKLOAD_LABELS[row.workloadKind])}</td>
                  <td>{row.turnCount}</td>
                  <TokenAggregateCell aggregate={row} field="inputTokens" />
                  <TokenAggregateCell aggregate={row} field="outputTokens" />
                  <TokenAggregateCell aggregate={row} field="cachedReadTokens" />
                  <TokenAggregateCell aggregate={row} field="totalTokens" />
                  {distribution.total && (
                    <WorkloadCostCell cost={workloadCosts.get(row.workloadKind) ?? null} />
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </UsageTable>
      )}

      {noTurns ? (
        <div className="usage-empty">
          <strong>
            {report.rangeCoverage === 'not_tracked'
              ? uiText('Usage was not tracked in this range')
              : filtersActive
                ? uiText('No usage matches these filters')
                : uiText('No recorded usage in this range')}
          </strong>
          <span>
            {report.rangeCoverage === 'not_tracked'
              ? uiText('Choose a current range to review locally reported token usage.')
              : filtersActive
                ? uiText('Change or clear a project, workload, connection, or model filter.')
                : uiText(
                    'A finalized model turn will appear here when its local usage receipt is recorded.',
                  )}
          </span>
        </div>
      ) : reportedTurns === 0 ? (
        <div className="usage-empty">
          <strong>{uiText('Turns were recorded, but token counts were not reported')}</strong>
          <span>
            {uiText('GOSU keeps these turns in coverage and does not substitute estimated values.')}
          </span>
        </div>
      ) : report.series.length === 0 ? (
        <div className="usage-empty">
          <strong>{uiText('Known totals are available, but trend buckets are unavailable')}</strong>
          <span>
            {uiText('The breakdown tables still show the locally reported totals for this range.')}
          </span>
        </div>
      ) : (
        <UsageTokenChart report={report} />
      )}

      <UsageBreakdownTabs
        report={report}
        prices={priceStatus?.catalog?.models ?? null}
        active={breakdown}
        onActive={onBreakdown}
        onLectureOffset={onLectureOffset}
      />
    </>
  );
}

function UsageSummary({
  aggregate,
  cost = null,
}: {
  aggregate: ModelUsageAggregate;
  cost?: UsageCostSummary | null;
}) {
  const reported = reportedUsageTurnCount(aggregate);
  return (
    <section
      className={`usage-summary-grid${cost ? ' with-cost' : ''}`}
      aria-label={uiText('Usage summary')}
    >
      {cost && (
        <article className="usage-summary-card cost">
          <span>{uiText('API-equivalent cost')}</span>
          <strong>{cost.usd === null ? '—' : formatUsd(cost.usd)}</strong>
          <small>
            {cost.unpricedModelIds.length > 0
              ? uiText('{count} models without a price are left out', {
                  count: cost.unpricedModelIds.length,
                })
              : uiText('Estimate at standard API prices · not a bill')}
          </small>
        </article>
      )}
      <UsageSummaryCard
        label={uiText('Known input tokens')}
        value={aggregateTokenValue(aggregate, 'inputTokens')}
        detail={uiText('Provider-reported input only')}
      />
      <UsageSummaryCard
        label={uiText('Known output tokens')}
        value={aggregateTokenValue(aggregate, 'outputTokens')}
        detail={uiText('Provider-reported output only')}
      />
      <UsageSummaryCard
        label={uiText('Known total tokens')}
        value={aggregateTokenValue(aggregate, 'totalTokens')}
        detail={uiText('Known input + output')}
      />
      <article className="usage-summary-card coverage">
        <span>{uiText('Reporting coverage')}</span>
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
          value === null
            ? uiText('{label}: Not reported', { label: label })
            : uiText('{label}: {value2} tokens', { label: label, value2: formatTokenCount(value) })
        }
      >
        {formatCompactTokenCount(value)}
      </strong>
      <small>{value === null ? uiText('Not reported') : detail}</small>
    </article>
  );
}

/** Where the prices come from, how fresh they are, and a way to fetch them now. */
function UsagePriceNote({
  status,
  timeZone,
  refreshing,
  onRefresh,
}: Readonly<{
  status: ModelPriceStatus;
  timeZone: string;
  refreshing: boolean;
  onRefresh?: (() => void) | undefined;
}>) {
  return (
    <div className="usage-price-note" role="status">
      <span>
        {status.catalog
          ? uiText('Prices: {source} · updated {time}', {
              source: MODEL_PRICE_SOURCE_LABEL,
              time: formatDateTime(status.catalog.fetchedAt, timeZone),
            })
          : uiText('No price list yet · token counts only')}
        {status.lastError
          ? ` · ${uiText('The price list could not be refreshed ({code}). The last list is still used.', { code: status.lastError })}`
          : ''}
      </span>
      {onRefresh && (
        <button type="button" className="ghost-button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? uiText('Refreshing…') : uiText('Refresh prices')}
        </button>
      )}
    </div>
  );
}

/** A feature's API-equivalent amount, or why there is none; never a bare zero for an unknown. */
function WorkloadCostCell({ cost }: { cost: UsageCostState | null }) {
  if (!cost || cost.kind === 'unreported') return <td className="usage-token-unavailable">—</td>;
  if (cost.kind === 'known')
    return (
      <td
        title={
          cost.excludedModelIds.length
            ? uiText('{count} models without a price are left out', {
                count: cost.excludedModelIds.length,
              })
            : undefined
        }
      >
        {formatUsd(cost.usd)}
        {cost.excludedModelIds.length > 0 && '+'}
      </td>
    );
  return (
    <td className="usage-token-unavailable">
      {cost.kind === 'unpriced' ? uiText('Price unknown') : uiText('No model breakdown')}
    </td>
  );
}

function UsageTokenChart({ report }: { report: ModelUsageAnalyticsReport }) {
  useUiText();
  const generatedId = useId().replaceAll(':', '');
  const titleId = `usage-chart-title-${generatedId}`;
  const descriptionId = `usage-chart-description-${generatedId}`;
  const helpId = `usage-chart-table-help-${generatedId}`;
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
          <span className="eyebrow">{uiText('KNOWN TOKENS OVER TIME')}</span>
          <h3>{uiText('Input and output trend')}</h3>
          <p>{uiText('Each day’s reporting coverage is in the token data table below.')}</p>
        </div>
        <div className="usage-chart-legend" aria-label={uiText('Chart legend')}>
          <span className="input">
            <i />
            {uiText('Input')}
          </span>
          <span className="output">
            <i />
            {uiText('Output')}
          </span>
        </div>
      </header>
      <figure className="usage-chart-figure">
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <title id={titleId}>{uiText('Known input and output tokens over time')}</title>
          <desc id={descriptionId}>
            {uiText('Provider-reported input and output tokens for')} {report.series.length}{' '}
            {uiText(
              'calendar buckets. The accompanying data table contains the same values and reporting coverage.',
            )}
          </desc>
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
          {uiText('Known totals exclude turns whose provider did not report token counts.')}
        </figcaption>
      </figure>
      <details className="usage-data-disclosure">
        <summary>{uiText('View token data table')}</summary>
        <p id={helpId} className="sr-only">
          {uiText('This table scrolls horizontally when all columns do not fit.')}
        </p>
        <div
          className="usage-table-scroll"
          tabIndex={0}
          aria-label={uiText('Token trend data')}
          aria-describedby={helpId}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{uiText('Date')}</th>
                <th scope="col">{uiText('Turns')}</th>
                <th scope="col">{uiText('Coverage')}</th>
                <th scope="col">{uiText('Known input')}</th>
                <th scope="col">{uiText('Known output')}</th>
                <th scope="col">{uiText('Known total')}</th>
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
  prices,
  active,
  onActive,
  onLectureOffset,
}: Readonly<{
  report: ModelUsageAnalyticsReport;
  prices: Readonly<Record<string, ModelPrice>> | null;
  active: UsageBreakdown;
  onActive: (breakdown: UsageBreakdown) => void;
  onLectureOffset: (offset: number) => void;
}>) {
  useUiText();
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
    <section className="usage-breakdown-card" aria-label={uiText('Usage breakdown')}>
      <div
        ref={tabListRef}
        className="usage-breakdown-tabs"
        role="tablist"
        aria-label={uiText('Usage breakdown views')}
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
        {active === 'briefing' && (
          <DailyWorkloadUsageTable report={report} kind="briefing_summary" prices={prices} />
        )}
        {active === 'papers' && (
          <DailyWorkloadUsageTable report={report} kind="paper_summary" prices={prices} />
        )}
        {active === 'projects' && (
          <>
            <ProjectUsageTable rows={report.byProject} />
            <ProjectModelUsageTable rows={report.byProjectModel ?? []} />
          </>
        )}
        {active === 'lectures' && <LectureUsageTable report={report} onOffset={onLectureOffset} />}
        {active === 'providers' && (
          <ProviderUsageTables connections={report.byConnection} models={report.byModel} />
        )}
      </div>
    </section>
  );
}

/**
 * One of the two detail tabs: what Briefing, or paper summaries, used on each day, by model. The
 * amount is the API-equivalent estimate of that day's row, priced like the rest of the screen.
 */
function DailyWorkloadUsageTable({
  report,
  kind,
  prices,
}: Readonly<{
  report: ModelUsageAnalyticsReport;
  kind: (typeof MODEL_USAGE_DETAIL_WORKLOADS)[number];
  prices: Readonly<Record<string, ModelPrice>> | null;
}>) {
  const rows = (report.byDayWorkloadModel ?? []).filter((row) => row.workloadKind === kind);
  const severalConnections = new Set(rows.map((row) => row.connectionKey)).size > 1;
  if (!rows.length)
    return (
      <BreakdownEmpty>
        {kind === 'paper_summary' ? (
          <>
            {uiText('No paper summary usage was recorded in this range')}
            <br />
            {uiText(
              'Paper summaries are counted apart from briefings since 0.58.140; earlier ones are part of Briefing.',
            )}
          </>
        ) : (
          uiText('No briefing usage was recorded in this range')
        )}
      </BreakdownEmpty>
    );
  return (
    <UsageTable
      label={
        kind === 'paper_summary'
          ? uiText('Paper summary usage by day')
          : uiText('Briefing usage by day')
      }
    >
      <thead>
        <tr>
          <th scope="col">{uiText('Date')}</th>
          <th scope="col">{uiText('Model')}</th>
          <th scope="col">{uiText('Calls')}</th>
          <th scope="col">{uiText('Input')}</th>
          <th scope="col">{uiText('Output')}</th>
          <th scope="col">{uiText('Cached read')}</th>
          <th scope="col">{uiText('Total')}</th>
          {prices && <th scope="col">{uiText('API-equivalent')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const priceKey = prices ? modelPriceKey(row.resolvedModelId, prices) : null;
          const usd = prices && priceKey ? estimateUsageCostUsd(row, prices[priceKey]!) : null;
          return (
            <tr key={`${row.bucketKey}:${row.connectionKey}:${row.resolvedModelId}`}>
              {/* The date is said once per day; the rows under it belong to it. */}
              <td>{rows[index - 1]?.bucketKey === row.bucketKey ? '' : row.bucketKey}</td>
              <td title={row.resolvedModelId}>
                {usageModelDisplayName(row.resolvedModelId)}
                {severalConnections && <small> · {row.connectionLabel}</small>}
              </td>
              <td>{row.turnCount.toLocaleString()}</td>
              <TokenAggregateCell aggregate={row} field="inputTokens" />
              <TokenAggregateCell aggregate={row} field="outputTokens" />
              <TokenAggregateCell aggregate={row} field="cachedReadTokens" />
              <TokenAggregateCell aggregate={row} field="totalTokens" />
              {prices && (
                <td className={usd === null ? 'usage-token-unavailable' : undefined}>
                  {usd === null
                    ? reportedUsageTurnCount(row) === 0
                      ? '—'
                      : uiText('Price unknown')
                    : formatUsd(usd)}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </UsageTable>
  );
}

function ProjectModelUsageTable({ rows }: { rows: readonly ModelUsageProjectModelRow[] }) {
  if (!rows.length) return null;
  return (
    <UsageTable label="프로젝트 내 모델별 사용량">
      <table>
        <thead>
          <tr>
            <th>프로젝트</th>
            <th>모델 · 연결</th>
            <th>입력</th>
            <th>출력</th>
            <th>캐시 읽기</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={JSON.stringify([
                row.projectId,
                row.connectionKey,
                row.providerId,
                row.resolvedModelId,
              ])}
            >
              <td>{row.projectName ?? row.projectId}</td>
              <td>
                {row.resolvedModelId}
                <small>{row.connectionLabel}</small>
              </td>
              <TokenAggregateCell aggregate={row} field="inputTokens" />
              <TokenAggregateCell aggregate={row} field="outputTokens" />
              <TokenAggregateCell aggregate={row} field="cachedReadTokens" />
            </tr>
          ))}
        </tbody>
      </table>
    </UsageTable>
  );
}
function ProjectUsageTable({ rows }: { rows: readonly ModelUsageProjectRow[] }) {
  if (rows.length === 0)
    return <BreakdownEmpty>{uiText('No project-owned usage matches this report.')}</BreakdownEmpty>;
  return (
    <UsageTable label={uiText('Usage by output project owner')}>
      <table>
        <thead>
          <tr>
            <th scope="col">{uiText('Output project owner')}</th>
            <th scope="col">{uiText('Turns')}</th>
            <th scope="col">{uiText('Coverage')}</th>
            <th scope="col">{uiText('Known input')}</th>
            <th scope="col">{uiText('Known output')}</th>
            <th scope="col">{uiText('Known total')}</th>
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
    return <BreakdownEmpty>{uiText('No Lecture generations match this report.')}</BreakdownEmpty>;
  const first = page.offset + 1;
  const last = Math.min(page.total, page.offset + page.items.length);
  return (
    <>
      <UsageTable label={uiText('Usage by Lecture generation')}>
        <table>
          <thead>
            <tr>
              <th scope="col">{uiText('Lecture generation')}</th>
              <th scope="col">{uiText('Output project owner')}</th>
              <th scope="col">{uiText('Status')}</th>
              <th scope="col">{uiText('Connection / model')}</th>
              <th scope="col">{uiText('Turns')}</th>
              <th scope="col">{uiText('Coverage')}</th>
              <th scope="col">{uiText('Known input')}</th>
              <th scope="col">{uiText('Known output')}</th>
              <th scope="col">{uiText('Known total')}</th>
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
          {first.toLocaleString()}–{last.toLocaleString()} {uiText('of')}{' '}
          {page.total.toLocaleString()} {uiText('generations')}
        </span>
        <div>
          <button
            type="button"
            className="secondary-button"
            disabled={page.offset === 0}
            onClick={() => onOffset(Math.max(0, page.offset - page.limit))}
          >
            {uiText('Previous')}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={page.offset + page.items.length >= page.total}
            onClick={() => onOffset(page.offset + page.limit)}
          >
            {uiText('Next')}
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
          {row.projectName ??
            uiText('Unavailable project · {value1}', { value1: shortIdentifier(row.projectId) })}
        </strong>
      </td>
      <td>
        <span className={`usage-status-chip ${row.status}`}>{row.status}</span>
      </td>
      <td>
        <div className="usage-connection-list">
          {row.byConnection.length === 0 ? (
            <span>{uiText('— Not recorded')}</span>
          ) : (
            row.byConnection.map((connection) => (
              <span key={`${connection.connectionKey}:${connection.resolvedModelId ?? 'unknown'}`}>
                <strong>{connection.connectionLabel}</strong>
                <small>
                  {providerIdentity(connection)} ·{' '}
                  {connection.resolvedModelId
                    ? usageModelDisplayName(connection.resolvedModelId)
                    : uiText('Model not reported')}
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
    return (
      <BreakdownEmpty>{uiText('No provider or model usage matches this report.')}</BreakdownEmpty>
    );
  return (
    <div className="usage-provider-sections">
      <section>
        <header>
          <h3>{uiText('Observed connections')}</h3>
          <p>
            {uiText(
              'Connection labels and provider identity are preserved from local turn receipts.',
            )}
          </p>
        </header>
        {connections.length === 0 ? (
          <BreakdownEmpty>{uiText('No observed connections match.')}</BreakdownEmpty>
        ) : (
          <UsageTable label={uiText('Usage by observed connection')}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{uiText('Connection')}</th>
                  <th scope="col">{uiText('Provider')}</th>
                  <th scope="col">{uiText('Turns')}</th>
                  <th scope="col">{uiText('Coverage')}</th>
                  <th scope="col">{uiText('Known input')}</th>
                  <th scope="col">{uiText('Known output')}</th>
                  <th scope="col">{uiText('Known total')}</th>
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
          <h3>{uiText('Observed models')}</h3>
          <p>
            {uiText('Models stay qualified by the connection and provider that reported them.')}
          </p>
        </header>
        {models.length === 0 ? (
          <BreakdownEmpty>{uiText('No observed models match.')}</BreakdownEmpty>
        ) : (
          <UsageTable label={uiText('Usage by observed model')}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{uiText('Model')}</th>
                  <th scope="col">{uiText('Connection / provider')}</th>
                  <th scope="col">{uiText('Turns')}</th>
                  <th scope="col">{uiText('Coverage')}</th>
                  <th scope="col">{uiText('Known input')}</th>
                  <th scope="col">{uiText('Known output')}</th>
                  <th scope="col">{uiText('Known total')}</th>
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
  useUiText();
  const helpId = `usage-table-help-${useId().replaceAll(':', '')}`;
  return (
    <>
      <p id={helpId} className="sr-only">
        {uiText('This table scrolls horizontally when all columns do not fit.')}
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
  field: 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedReadTokens';
}) {
  return (
    <TokenCell
      value={
        field === 'cachedReadTokens'
          ? aggregate.tokens.cachedReadTokens
          : aggregateTokenValue(aggregate, field)
      }
    />
  );
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
      — <small>{uiText('Not reported')}</small>
    </td>
  ) : (
    <td>{formatTokenCount(value)}</td>
  );
}

function BreakdownEmpty({ children }: { children: ReactNode }) {
  return <div className="usage-breakdown-empty">{children}</div>;
}
