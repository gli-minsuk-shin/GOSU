import type { ModelInvocation } from '@gosu/contracts';
import { GLOBAL_USAGE_OWNER } from './native-usage-ledger';

import {
  MODEL_USAGE_DETAIL_WORKLOADS,
  ModelUsageAnalyticsQuerySchema,
  ModelUsageAnalyticsReportSchema,
  type ModelUsageAggregate,
  type ModelUsageAnalyticsQuery,
  type ModelUsageAnalyticsReport,
  type ModelUsageConnectionRow,
  type ModelUsageLectureConnectionRow,
  type ModelUsageLectureGenerationRow,
  type ModelUsageModelRow,
  type ModelUsageProjectRow,
  type ModelUsageSeriesRow,
  type ModelUsageTokenTotals,
  type ModelUsageDailyWorkloadModelRow,
  type ModelUsageWorkloadModelRow,
  type ModelUsageWorkloadRow,
} from '../shared/model-usage-contracts';
import type {
  LocalDatabase,
  ModelUsageAbsoluteTotals,
  ModelUsageAttributionInput,
  ModelUsageConnectionSnapshot,
  StoredLectureUsageAttempt,
  StoredModelUsageRow,
} from './local-database';

type WorkspaceSnapshotReader = Readonly<{
  snapshot(): Promise<{ projects: readonly { id: string; name: string }[] }>;
}>;

type CalendarDate = Readonly<{ year: number; month: number; day: number }>;

const DEFAULT_LECTURE_PAGE = { offset: 0, limit: 25 } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeAdd(left: number, right: number) {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('model_usage_overflow');
  return value;
}

function parseCalendarDate(value: string): CalendarDate {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

function shiftCalendarDate(value: CalendarDate, days: number): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function calendarKey(value: CalendarDate) {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(
    value.day,
  ).padStart(2, '0')}`;
}

function localPartsAt(
  timestamp: number,
  timeZone: string,
): CalendarDate & {
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function localMidnightUtc(value: CalendarDate, timeZone: string) {
  const compareDate = (timestamp: number) => {
    const actual = localPartsAt(timestamp, timeZone);
    return actual.year - value.year || actual.month - value.month || actual.day - value.day;
  };
  const nominal = Date.UTC(value.year, value.month - 1, value.day);
  let lower = nominal - 3 * 24 * 60 * 60 * 1_000;
  let upper = nominal + 3 * 24 * 60 * 60 * 1_000;
  if (compareDate(lower) >= 0 || compareDate(upper) < 0) {
    throw new Error('model_usage_time_zone_boundary_unavailable');
  }
  while (upper - lower > 1) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (compareDate(middle) >= 0) upper = middle;
    else lower = middle;
  }
  return new Date(upper).toISOString();
}

function queryRange(query: ModelUsageAnalyticsQuery) {
  const anchor = parseCalendarDate(query.anchorDate);
  let start = anchor;
  let end: CalendarDate;
  if (query.period === 'week') {
    const weekday = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day)).getUTCDay();
    start = shiftCalendarDate(anchor, -((weekday + 6) % 7));
    end = shiftCalendarDate(start, 7);
  } else if (query.period === 'month') {
    start = { year: anchor.year, month: anchor.month, day: 1 };
    end =
      anchor.month === 12
        ? { year: anchor.year + 1, month: 1, day: 1 }
        : { year: anchor.year, month: anchor.month + 1, day: 1 };
  } else {
    end = shiftCalendarDate(start, 1);
  }
  return {
    start,
    end,
    fromInclusive: localMidnightUtc(start, query.timeZone),
    toExclusive: localMidnightUtc(end, query.timeZone),
  };
}

function reported(row: StoredModelUsageRow) {
  return row.coverage === 'exact' || row.coverage === 'partial';
}

function aggregate(rows: readonly StoredModelUsageRow[]): ModelUsageAggregate {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cachedReadTokens: number | null = 0;
  let cachedWriteTokens: number | null = 0;
  let reasoningOutputTokens: number | null = 0;
  for (const row of rows) {
    if (!reported(row)) continue;
    inputTokens = safeAdd(inputTokens, row.inputTokens);
    outputTokens = safeAdd(outputTokens, row.outputTokens);
    totalTokens = safeAdd(totalTokens, row.totalTokens);
    cachedReadTokens =
      cachedReadTokens === null || row.cachedReadTokens === null
        ? null
        : safeAdd(cachedReadTokens, row.cachedReadTokens);
    cachedWriteTokens =
      cachedWriteTokens === null || row.cachedWriteTokens === null
        ? null
        : safeAdd(cachedWriteTokens, row.cachedWriteTokens);
    reasoningOutputTokens =
      reasoningOutputTokens === null || row.reasoningOutputTokens === null
        ? null
        : safeAdd(reasoningOutputTokens, row.reasoningOutputTokens);
  }
  const reportedTurnCount = rows.filter(reported).length;
  return {
    tokens: {
      inputTokens,
      outputTokens,
      totalTokens,
      cachedReadTokens: reportedTurnCount === 0 ? null : cachedReadTokens,
      cachedWriteTokens: reportedTurnCount === 0 ? null : cachedWriteTokens,
      reasoningOutputTokens: reportedTurnCount === 0 ? null : reasoningOutputTokens,
    },
    turnCount: rows.length,
    exactTurnCount: rows.filter((row) => row.coverage === 'exact').length,
    partialTurnCount: rows.filter((row) => row.coverage === 'partial').length,
    unavailableTurnCount: rows.filter((row) => row.coverage === 'unavailable').length,
  };
}

function groupRows<Key extends string>(
  rows: readonly StoredModelUsageRow[],
  keyFor: (row: StoredModelUsageRow) => Key,
) {
  const groups = new Map<Key, StoredModelUsageRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function connectionRows(rows: readonly StoredModelUsageRow[]): ModelUsageConnectionRow[] {
  return [
    ...groupRows(
      rows,
      (row) => `${row.connectionKey}\u0000${row.providerId}\u0000${row.upstreamProviderId ?? ''}`,
    ).values(),
  ]
    .map((group) => ({
      connectionKey: group[0]!.connectionKey,
      connectionLabel: group[0]!.connectionLabel,
      providerId: group[0]!.providerId,
      upstreamProviderId: group[0]!.upstreamProviderId,
      ...aggregate(group),
    }))
    .sort(
      (left, right) =>
        right.tokens.totalTokens - left.tokens.totalTokens ||
        left.connectionLabel.localeCompare(right.connectionLabel),
    );
}

function lectureConnectionRows(
  rows: readonly StoredModelUsageRow[],
): ModelUsageLectureConnectionRow[] {
  return [
    ...groupRows(
      rows,
      (row) =>
        `${row.connectionKey}\u0000${row.providerId}\u0000${row.upstreamProviderId ?? ''}\u0000${row.resolvedModelId}`,
    ).values(),
  ]
    .map((group) => ({
      connectionKey: group[0]!.connectionKey,
      connectionLabel: group[0]!.connectionLabel,
      providerId: group[0]!.providerId,
      upstreamProviderId: group[0]!.upstreamProviderId,
      resolvedModelId: group[0]!.resolvedModelId,
      ...aggregate(group),
    }))
    .sort((left, right) => right.tokens.totalTokens - left.tokens.totalTokens);
}

function tokensOrNull(rows: readonly StoredModelUsageRow[]): ModelUsageTokenTotals | null {
  return rows.some(reported) ? aggregate(rows).tokens : null;
}

function lectureCoverage(
  attempt: StoredLectureUsageAttempt,
  rows: readonly StoredModelUsageRow[],
  trackingStartedAt: string,
) {
  if (attempt.status === 'running') {
    if (rows.some(reported)) return 'partial' as const;
    if (rows.some((row) => row.coverage === 'unavailable')) return 'unavailable' as const;
    return 'pending' as const;
  }
  if (rows.length > 0 && rows.every((row) => row.coverage === 'exact')) return 'exact' as const;
  if (rows.some(reported)) return 'partial' as const;
  if (rows.some((row) => row.coverage === 'unavailable')) return 'unavailable' as const;
  if (Date.parse(attempt.startedAt) < Date.parse(trackingStartedAt)) {
    return 'not_tracked' as const;
  }
  return 'unavailable' as const;
}

function optionalCounter(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function parseCodexTotals(value: unknown): ModelUsageAbsoluteTotals | null {
  if (!isRecord(value)) return null;
  if (
    ['cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens'].some(
      (key) => value[key] != null && optionalCounter(value[key]) === null,
    )
  )
    return null;
  const required = ['inputTokens', 'outputTokens', 'totalTokens'] as const;
  if (required.some((key) => !Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) {
    return null;
  }
  const totals = {
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    totalTokens: value.totalTokens as number,
    cachedReadTokens: optionalCounter(value.cachedInputTokens),
    cachedWriteTokens: optionalCounter(value.cacheWriteInputTokens),
    reasoningOutputTokens: optionalCounter(value.reasoningOutputTokens),
  };
  if (totals.totalTokens !== totals.inputTokens + totals.outputTokens) return null;
  if (
    (totals.cachedReadTokens !== null && totals.cachedReadTokens > totals.inputTokens) ||
    (totals.cachedWriteTokens !== null && totals.cachedWriteTokens > totals.inputTokens) ||
    (totals.cachedReadTokens !== null &&
      totals.cachedWriteTokens !== null &&
      (!Number.isSafeInteger(totals.cachedReadTokens + totals.cachedWriteTokens) ||
        totals.cachedReadTokens + totals.cachedWriteTokens > totals.inputTokens)) ||
    (totals.reasoningOutputTokens !== null && totals.reasoningOutputTokens > totals.outputTokens)
  ) {
    return null;
  }
  return totals;
}

export type ModelUsageInvocationEvent = Readonly<{
  threadId: string;
  turnId: string;
  invocation: ModelInvocation;
  connection?: ModelUsageConnectionSnapshot;
}>;

export type ModelUsageAcpPromptResultEvent = Readonly<{
  threadId: string;
  turnId: string;
  providerId?: string;
  usage: ModelUsageAbsoluteTotals | null;
  stopReason: string;
  successful: boolean;
  connection?: ModelUsageConnectionSnapshot;
}>;

export type ModelUsageDelegationInvocationEvent = ModelUsageInvocationEvent &
  Readonly<{ attribution: ModelUsageAttributionInput }>;

const UNLABELED_CODEX_CONNECTION = 'codex:unknown';

/**
 * Codex turns recorded before GOSU had read the Codex login carry the unlabeled key
 * `codex:unknown` ("Codex"), so one account appears twice in the usage screen next to the row
 * it was later labelled with. When the range holds exactly one labelled Codex connection the
 * unlabelled turns belong to it, so fold them in. With none or several labelled connections the
 * owner is genuinely unknown and the rows stay apart rather than being guessed into one.
 */
export function foldUnlabeledCodexUsage(rows: readonly StoredModelUsageRow[]) {
  const labelled = new Map<string, StoredModelUsageRow>();
  let unlabelled = false;
  for (const row of rows) {
    if (row.connectionKey === UNLABELED_CODEX_CONNECTION) unlabelled = true;
    else if (row.connectionKey.startsWith('codex:')) labelled.set(row.connectionKey, row);
  }
  if (!unlabelled || labelled.size !== 1) return [...rows];
  const target = [...labelled.values()][0]!;
  return rows.map((row) =>
    row.connectionKey === UNLABELED_CODEX_CONNECTION
      ? {
          ...row,
          connectionKey: target.connectionKey,
          connectionLabel: target.connectionLabel,
          upstreamProviderId: target.upstreamProviderId,
        }
      : row,
  );
}

export class ModelUsageService {
  private readonly threadAttributions = new Map<string, ModelUsageAttributionInput>();
  private readonly knownTurns = new Set<string>();
  private readonly diagnosedCollectorFailures = new Set<string>();
  private readonly pendingCodexTotals = new Map<
    string,
    { threadId: string; turnId: string; totals: ModelUsageAbsoluteTotals; observedAt: string }
  >();
  private readonly pendingCodexTerminals = new Map<
    string,
    { threadId: string; turnId: string; status: string; completedAt: string }
  >();
  private codexConnection: ModelUsageConnectionSnapshot = {
    connectionKey: 'codex:unknown',
    connectionLabel: 'Codex',
    upstreamProviderId: null,
  };

  constructor(
    private readonly storage: LocalDatabase,
    private readonly workspace: WorkspaceSnapshotReader,
    private readonly additionalUsage?: () => Promise<StoredModelUsageRow[]>,
  ) {}

  bindThread(threadId: string, attribution: ModelUsageAttributionInput) {
    this.observeCollector('bind-thread', () => {
      const existing = this.threadAttributions.get(threadId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(attribution)) {
        // Fail closed instead of retaining an attribution that could charge the wrong workload.
        this.threadAttributions.delete(threadId);
        throw new Error('model_usage_thread_attribution_conflict');
      }
      this.threadAttributions.set(threadId, structuredClone(attribution));
    });
  }

  releaseThread(threadId: string) {
    this.threadAttributions.delete(threadId);
  }

  observeCodexAccount(value: unknown) {
    if (!isRecord(value)) return;
    const account = isRecord(value.account) ? value.account : null;
    const type = typeof account?.type === 'string' ? account.type : null;
    const authMode = typeof value.authMode === 'string' ? value.authMode : null;
    this.codexConnection = ModelUsageService.codexConnectionFor(type ?? authMode);
  }

  recordInvocation(event: ModelUsageInvocationEvent) {
    this.observeCollector('record-invocation', () => {
      const attribution = this.threadAttributions.get(event.threadId);
      if (!attribution || !this.storage.isReady()) return;
      this.storage.recordAttributedModelInvocation(
        event.threadId,
        event.turnId,
        event.invocation,
        attribution,
        event.connection ??
          (event.invocation.providerId === 'codex'
            ? this.codexConnection
            : {
                connectionKey: `${event.invocation.providerId}:unknown`,
                connectionLabel: event.invocation.providerId,
                upstreamProviderId: null,
              }),
      );
      const turnKey = ModelUsageService.turnKey(
        event.invocation.providerId,
        event.threadId,
        event.turnId,
      );
      if (!this.knownTurns.has(turnKey) && this.knownTurns.size >= 2_048) {
        this.knownTurns.delete(this.knownTurns.values().next().value!);
      }
      this.knownTurns.add(turnKey);
      const pendingTotals = this.pendingCodexTotals.get(turnKey);
      if (pendingTotals && event.invocation.providerId === 'codex') {
        this.pendingCodexTotals.delete(turnKey);
        this.recordCodexTotals(pendingTotals);
      }
      const pendingTerminal = this.pendingCodexTerminals.get(turnKey);
      if (pendingTerminal && event.invocation.providerId === 'codex') {
        this.pendingCodexTerminals.delete(turnKey);
        this.finishCodexTurn(pendingTerminal);
      }
    });
  }

  recordCodexNotification(notification: unknown) {
    this.observeCollector('codex-notification', () => {
      if (!this.storage.isReady() || !isRecord(notification)) return;
      const method = notification.method;
      const params = notification.params;
      if (method === 'account/updated' && isRecord(params)) {
        this.observeCodexAccount(params);
        return;
      }
      if (!isRecord(params)) return;
      if (method === 'thread/tokenUsage/updated') {
        const threadId = typeof params.threadId === 'string' ? params.threadId : null;
        const turnId = typeof params.turnId === 'string' ? params.turnId : null;
        const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : null;
        const totals = parseCodexTotals(tokenUsage?.total);
        if (!threadId || !turnId || !totals) return;
        const pending = { threadId, turnId, totals, observedAt: new Date().toISOString() };
        const turnKey = ModelUsageService.turnKey('codex', threadId, turnId);
        if (!this.knownTurns.has(turnKey)) {
          this.setBounded(this.pendingCodexTotals, turnKey, pending);
        } else {
          this.recordCodexTotals(pending);
        }
        return;
      }
      if (method === 'turn/completed') {
        const threadId = typeof params.threadId === 'string' ? params.threadId : null;
        const turn = isRecord(params.turn) ? params.turn : null;
        const turnId = typeof turn?.id === 'string' ? turn.id : null;
        const status = typeof turn?.status === 'string' ? turn.status : 'failed';
        if (!threadId || !turnId) return;
        const pending = { threadId, turnId, status, completedAt: new Date().toISOString() };
        const turnKey = ModelUsageService.turnKey('codex', threadId, turnId);
        if (!this.knownTurns.has(turnKey)) {
          this.setBounded(this.pendingCodexTerminals, turnKey, pending);
        } else {
          this.finishCodexTurn(pending);
        }
      }
    });
  }

  recordAcpPromptResult(event: ModelUsageAcpPromptResultEvent) {
    this.observeCollector('acp-prompt-result', () => {
      if (!this.storage.isReady()) return;
      const observedAt = new Date().toISOString();
      if (event.usage) {
        this.storage.recordAcpModelUsage({
          providerId: event.providerId ?? 'hermes',
          threadId: event.threadId,
          turnId: event.turnId,
          totals: event.usage,
          terminalStatus: event.stopReason,
          successful: event.successful,
          observedAt,
        });
      } else {
        this.storage.finishModelUsageTurn({
          providerId: event.providerId ?? 'hermes',
          threadId: event.threadId,
          turnId: event.turnId,
          terminalStatus: event.stopReason,
          successful: event.successful,
          completedAt: observedAt,
        });
      }
    });
  }

  recordDelegationInvocation(event: ModelUsageDelegationInvocationEvent) {
    this.bindThread(event.threadId, event.attribution);
    this.recordInvocation(event);
  }

  recordDelegationPromptResult(event: ModelUsageAcpPromptResultEvent) {
    try {
      this.recordAcpPromptResult(event);
    } finally {
      this.releaseThread(event.threadId);
    }
  }

  recordAcpNotification(notification: unknown) {
    this.observeCollector('acp-notification', () => {
      if (
        !this.storage.isReady() ||
        !isRecord(notification) ||
        notification.method !== 'turn/completed'
      ) {
        return;
      }
      const params = isRecord(notification.params) ? notification.params : null;
      const turn = isRecord(params?.turn) ? params.turn : null;
      const threadId = typeof params?.threadId === 'string' ? params.threadId : null;
      const turnId = typeof turn?.id === 'string' ? turn.id : null;
      const status = typeof turn?.status === 'string' ? turn.status : 'failed';
      if (!threadId || !turnId) return;
      this.storage.finishModelUsageTurn({
        providerId: 'hermes',
        threadId,
        turnId,
        terminalStatus: status,
        successful: status === 'completed',
        completedAt: new Date().toISOString(),
      });
    });
  }

  async query(input: ModelUsageAnalyticsQuery): Promise<ModelUsageAnalyticsReport> {
    const query = ModelUsageAnalyticsQuerySchema.parse(input);
    const generatedAt = new Date().toISOString();
    const range = queryRange(query);
    const lecturePage = query.lecturePage ?? DEFAULT_LECTURE_PAGE;
    const requestedSnapshotAt =
      'snapshotAt' in lecturePage ? (lecturePage.snapshotAt ?? generatedAt) : generatedAt;
    const lectureSnapshotAt =
      Date.parse(requestedSnapshotAt) <= Date.parse(generatedAt)
        ? requestedSnapshotAt
        : generatedAt;
    const [snapshot, storedRows] = await Promise.all([
      this.workspace.snapshot(),
      Promise.resolve(
        this.storage.listStoredModelUsage(
          range.fromInclusive,
          range.toExclusive,
          lectureSnapshotAt,
        ),
      ),
    ]);
    const projectNames = new Map(snapshot.projects.map((project) => [project.id, project.name]));
    const extraRows = (await this.additionalUsage?.()) ?? [];
    const rows = foldUnlabeledCodexUsage([
      ...storedRows,
      ...extraRows.filter(
        (row) =>
          row.startedAt >= range.fromInclusive &&
          row.startedAt < range.toExclusive &&
          row.startedAt <= lectureSnapshotAt,
      ),
    ]).filter(
      (row) =>
        row.coverage !== 'pending' &&
        (!query.projectId || row.projectId === query.projectId) &&
        (!query.connectionKey || row.connectionKey === query.connectionKey) &&
        (!query.modelId || row.resolvedModelId === query.modelId) &&
        (!query.workloadKind || row.workloadKind === query.workloadKind),
    );
    const trackingStartedAt = this.storage.getModelUsageTrackingStartedAt();
    const series: ModelUsageSeriesRow[] = [];
    for (
      let day = range.start;
      calendarKey(day) < calendarKey(range.end);
      day = shiftCalendarDate(day, 1)
    ) {
      const next = shiftCalendarDate(day, 1);
      const fromInclusive = localMidnightUtc(day, query.timeZone);
      const toExclusive = localMidnightUtc(next, query.timeZone);
      series.push({
        bucketKey: calendarKey(day),
        fromInclusive,
        toExclusive,
        ...aggregate(
          rows.filter((row) => row.startedAt >= fromInclusive && row.startedAt < toExclusive),
        ),
      });
    }
    const byProject: ModelUsageProjectRow[] = [
      ...groupRows(
        rows.filter((row) => row.projectId !== GLOBAL_USAGE_OWNER),
        (row) => row.projectId,
      ).values(),
    ]
      .map((group) => ({
        projectId: group[0]!.projectId,
        projectName: projectNames.get(group[0]!.projectId) ?? null,
        ...aggregate(group),
      }))
      .sort((left, right) => right.tokens.totalTokens - left.tokens.totalTokens)
      .slice(0, 1_000);
    const byModel: ModelUsageModelRow[] = [
      ...groupRows(
        rows,
        (row) =>
          `${row.connectionKey}\u0000${row.providerId}\u0000${row.upstreamProviderId ?? ''}\u0000${row.resolvedModelId}`,
      ).values(),
    ]
      .map((group) => ({
        connectionKey: group[0]!.connectionKey,
        connectionLabel: group[0]!.connectionLabel,
        providerId: group[0]!.providerId,
        upstreamProviderId: group[0]!.upstreamProviderId,
        resolvedModelId: group[0]!.resolvedModelId,
        ...aggregate(group),
      }))
      .sort((left, right) => right.tokens.totalTokens - left.tokens.totalTokens)
      .slice(0, 1_000);
    const byWorkload: ModelUsageWorkloadRow[] = [
      ...groupRows(rows, (row) => row.workloadKind).values(),
    ]
      .map((group) => ({ workloadKind: group[0]!.workloadKind, ...aggregate(group) }))
      .sort((left, right) => right.tokens.totalTokens - left.tokens.totalTokens);
    const byProjectModel = [
      ...groupRows(
        rows.filter((r) => r.projectId !== GLOBAL_USAGE_OWNER),
        (r) => JSON.stringify([r.projectId, r.connectionKey, r.providerId, r.resolvedModelId]),
      ).values(),
    ]
      .map((group) => {
        const r = group[0]!;
        return {
          projectId: r.projectId,
          projectName: projectNames.get(r.projectId) ?? null,
          connectionKey: r.connectionKey,
          connectionLabel: r.connectionLabel,
          providerId: r.providerId,
          upstreamProviderId: r.upstreamProviderId,
          resolvedModelId: r.resolvedModelId,
          ...aggregate(group),
        };
      })
      .sort((a, b) => b.tokens.totalTokens - a.tokens.totalTokens)
      .slice(0, 1000);
    // Every feature's usage per model, at the grain of `byModel` (so the parts of one model add up
    // to its row). Unlike the project breakdown this keeps the rows without a project: the AI
    // assistant and the briefing summaries are exactly those, and a feature's cost is summed here.
    // The detail tabs (Briefing, paper summaries): one row per local day, feature and model.
    const detailKinds = new Set<string>(MODEL_USAGE_DETAIL_WORKLOADS);
    const byDayWorkloadModel: ModelUsageDailyWorkloadModelRow[] = [...series]
      .reverse()
      .flatMap((day) =>
        [
          ...groupRows(
            rows.filter(
              (row) =>
                detailKinds.has(row.workloadKind) &&
                row.startedAt >= day.fromInclusive &&
                row.startedAt < day.toExclusive,
            ),
            (row) =>
              JSON.stringify([
                row.workloadKind,
                row.connectionKey,
                row.providerId,
                row.upstreamProviderId ?? '',
                row.resolvedModelId,
              ]),
          ).values(),
        ]
          .map((group) => ({
            bucketKey: day.bucketKey,
            workloadKind: group[0]!.workloadKind,
            connectionKey: group[0]!.connectionKey,
            connectionLabel: group[0]!.connectionLabel,
            providerId: group[0]!.providerId,
            upstreamProviderId: group[0]!.upstreamProviderId,
            resolvedModelId: group[0]!.resolvedModelId,
            ...aggregate(group),
          }))
          .sort(
            (left, right) =>
              left.workloadKind.localeCompare(right.workloadKind) ||
              right.tokens.totalTokens - left.tokens.totalTokens ||
              left.resolvedModelId.localeCompare(right.resolvedModelId),
          ),
      )
      .slice(0, 1_000);
    const byWorkloadModel: ModelUsageWorkloadModelRow[] = [
      ...groupRows(rows, (r) =>
        JSON.stringify([
          r.workloadKind,
          r.connectionKey,
          r.providerId,
          r.upstreamProviderId ?? '',
          r.resolvedModelId,
        ]),
      ).values(),
    ]
      .map((group) => {
        const r = group[0]!;
        return {
          workloadKind: r.workloadKind,
          connectionKey: r.connectionKey,
          connectionLabel: r.connectionLabel,
          providerId: r.providerId,
          upstreamProviderId: r.upstreamProviderId,
          resolvedModelId: r.resolvedModelId,
          ...aggregate(group),
        };
      })
      .sort((a, b) => b.tokens.totalTokens - a.tokens.totalTokens)
      .slice(0, 1000);
    const lectureAttempts = this.storage
      .listStoredLectureUsageAttempts(range.fromInclusive, range.toExclusive, lectureSnapshotAt)
      .filter((attempt) => {
        if (query.projectId && attempt.projectId !== query.projectId) return false;
        if (query.workloadKind && query.workloadKind !== 'lecture_generation') return false;
        if (!query.connectionKey && !query.modelId) return true;
        return rows.some(
          (row) =>
            row.workloadKind === 'lecture_generation' && row.lectureAttemptId === attempt.attemptId,
        );
      });
    const lectureOffset =
      lectureAttempts.length === 0
        ? 0
        : Math.min(
            lecturePage.offset,
            Math.floor((lectureAttempts.length - 1) / lecturePage.limit) * lecturePage.limit,
          );
    const lectureItems: ModelUsageLectureGenerationRow[] = lectureAttempts
      .slice(lectureOffset, lectureOffset + lecturePage.limit)
      .map((attempt) => {
        const attemptRows = rows.filter(
          (row) =>
            row.workloadKind === 'lecture_generation' && row.lectureAttemptId === attempt.attemptId,
        );
        return {
          studioId: attempt.studioId,
          studioTitle: attempt.studioTitle,
          attemptId: attempt.attemptId,
          projectId: attempt.projectId,
          projectName: projectNames.get(attempt.projectId) ?? null,
          status: attempt.status,
          startedAt: attempt.startedAt,
          completedAt: attempt.completedAt,
          coverage: lectureCoverage(attempt, attemptRows, trackingStartedAt),
          tokens: tokensOrNull(attemptRows),
          turnCount: attemptRows.length,
          byConnection: lectureConnectionRows(attemptRows),
        };
      });
    return ModelUsageAnalyticsReportSchema.parse({
      schemaVersion: 1,
      generatedAt,
      trackingStartedAt,
      localOnly: true,
      rangeCoverage:
        Date.parse(trackingStartedAt) >= Date.parse(range.toExclusive)
          ? 'not_tracked'
          : Date.parse(trackingStartedAt) <= Date.parse(range.fromInclusive)
            ? 'complete'
            : 'partial',
      range: {
        period: query.period,
        anchorDate: query.anchorDate,
        timeZone: query.timeZone,
        fromInclusive: range.fromInclusive,
        toExclusive: range.toExclusive,
      },
      totals: aggregate(rows),
      series,
      byProject,
      byConnection: connectionRows(rows).slice(0, 1_000),
      byModel,
      byProjectModel,
      byWorkload,
      byWorkloadModel,
      byDayWorkloadModel,
      lectureGenerations: {
        items: lectureItems,
        total: lectureAttempts.length,
        offset: lectureOffset,
        limit: lecturePage.limit,
        snapshotAt: lectureSnapshotAt,
      },
    });
  }

  private static codexConnectionFor(type: string | null): ModelUsageConnectionSnapshot {
    if (type === 'chatgpt') {
      return {
        connectionKey: 'codex:chatgpt',
        connectionLabel: 'ChatGPT',
        upstreamProviderId: null,
      };
    }
    if (type === 'apiKey' || type === 'api-key' || type === 'apikey') {
      return {
        connectionKey: 'codex:api-key',
        connectionLabel: 'OpenAI API',
        upstreamProviderId: 'openai',
      };
    }
    if (type === 'amazonBedrock' || type === 'amazon-bedrock' || type === 'bedrockApiKey') {
      return {
        connectionKey: 'codex:amazon-bedrock',
        connectionLabel: 'Amazon Bedrock',
        upstreamProviderId: 'amazon-bedrock',
      };
    }
    if (type === 'chatgptAuthTokens') {
      return {
        connectionKey: 'codex:chatgpt',
        connectionLabel: 'ChatGPT',
        upstreamProviderId: null,
      };
    }
    return { connectionKey: 'codex:unknown', connectionLabel: 'Codex', upstreamProviderId: null };
  }

  private recordCodexTotals(input: {
    threadId: string;
    turnId: string;
    totals: ModelUsageAbsoluteTotals;
    observedAt: string;
  }) {
    this.observeCollector('codex-total', () => {
      this.storage.recordCodexModelUsageTotal({ providerId: 'codex', ...input });
    });
  }

  private finishCodexTurn(input: {
    threadId: string;
    turnId: string;
    status: string;
    completedAt: string;
  }) {
    this.observeCollector('codex-terminal', () => {
      this.storage.finishModelUsageTurn({
        providerId: 'codex',
        threadId: input.threadId,
        turnId: input.turnId,
        terminalStatus: input.status,
        successful: input.status === 'completed',
        completedAt: input.completedAt,
      });
    });
  }

  private observeCollector(operation: string, action: () => void) {
    try {
      action();
    } catch {
      // Analytics is optional: never let a malformed event or local ledger failure abort a turn.
      if (!this.diagnosedCollectorFailures.has(operation)) {
        this.diagnosedCollectorFailures.add(operation);
        console.error(`[GOSU] Model usage ${operation} collection failed.`);
      }
    }
  }

  private setBounded<Value>(map: Map<string, Value>, key: string, value: Value) {
    if (!map.has(key) && map.size >= 512) map.delete(map.keys().next().value!);
    map.set(key, value);
  }

  private static turnKey(providerId: string, threadId: string, turnId: string) {
    return `${providerId}\u0000${threadId}\u0000${turnId}`;
  }
}
