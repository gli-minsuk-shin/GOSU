import type {
  ModelUsageAggregate,
  ModelUsagePeriod,
  ModelUsageSeriesRow,
  ModelUsageTokenTotals,
} from '../../shared/model-usage-contracts';

export const USAGE_PERIODS = [
  'day',
  'week',
  'month',
] as const satisfies readonly ModelUsagePeriod[];
export type UsagePeriod = ModelUsagePeriod;

export const USAGE_BREAKDOWNS = ['projects', 'lectures', 'providers'] as const;
export type UsageBreakdown = (typeof USAGE_BREAKDOWNS)[number];

export type NullableTokenCounts = Readonly<{
  inputTokens: number | null;
  outputTokens: number | null;
}>;

export type UsageCoverageSummary = Readonly<{
  turnCount: number;
  inputReportedTurnCount: number;
  outputReportedTurnCount: number;
  splitReportedTurnCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  knownTotalTokens: number | null;
}>;

export type UsageChartBucket = NullableTokenCounts &
  Readonly<{
    id: string;
    label: string;
    accessibleLabel: string;
    lowerBound: boolean;
  }>;

export type UsageChartBar = UsageChartBucket &
  Readonly<{
    x: number;
    width: number;
    inputY: number;
    inputHeight: number;
    outputY: number;
    outputHeight: number;
    incomplete: boolean;
  }>;

export type UsageChartTick = Readonly<{
  value: number;
  y: number;
}>;

export type UsageChartModel = Readonly<{
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  maximum: number;
  bars: readonly UsageChartBar[];
  ticks: readonly UsageChartTick[];
}>;

const CHART_WIDTH = 960;
const CHART_HEIGHT = 320;
const CHART_PADDING = { top: 20, right: 18, bottom: 52, left: 78 } as const;

function sumReported(values: readonly (number | null)[]) {
  const reported = values.filter((value): value is number => value !== null);
  if (reported.length === 0) return null;
  let total = 0;
  for (const value of reported) {
    const next = total + value;
    if (!Number.isSafeInteger(next)) return null;
    total = next;
  }
  return total;
}

export function summarizeUsageCoverage(
  turns: readonly NullableTokenCounts[],
): UsageCoverageSummary {
  const inputReportedTurnCount = turns.filter(({ inputTokens: value }) => value !== null).length;
  const outputReportedTurnCount = turns.filter(({ outputTokens: value }) => value !== null).length;
  const inputTokens = sumReported(turns.map(({ inputTokens: value }) => value));
  const outputTokens = sumReported(turns.map(({ outputTokens: value }) => value));
  const overflowed =
    (inputReportedTurnCount > 0 && inputTokens === null) ||
    (outputReportedTurnCount > 0 && outputTokens === null);
  return {
    turnCount: turns.length,
    inputReportedTurnCount,
    outputReportedTurnCount,
    splitReportedTurnCount: turns.filter(
      ({ inputTokens: input, outputTokens: output }) => input !== null && output !== null,
    ).length,
    inputTokens,
    outputTokens,
    knownTotalTokens: overflowed ? null : safeKnownTokenSum(inputTokens, outputTokens),
  };
}

export function reportedUsageTurnCount(aggregate: ModelUsageAggregate) {
  const reported = aggregate.exactTurnCount + aggregate.partialTurnCount;
  return Number.isSafeInteger(reported) ? reported : 0;
}

export function aggregateTokenCounts(aggregate: ModelUsageAggregate): NullableTokenCounts {
  if (reportedUsageTurnCount(aggregate) === 0) {
    return { inputTokens: null, outputTokens: null };
  }
  return {
    inputTokens: aggregate.tokens.inputTokens,
    outputTokens: aggregate.tokens.outputTokens,
  };
}

export function aggregateTokenValue(
  aggregate: ModelUsageAggregate,
  field: keyof Pick<ModelUsageTokenTotals, 'inputTokens' | 'outputTokens' | 'totalTokens'>,
) {
  return reportedUsageTurnCount(aggregate) === 0 ? null : aggregate.tokens[field];
}

export function completeTokenTotal({ inputTokens, outputTokens }: NullableTokenCounts) {
  if (inputTokens === null || outputTokens === null) return null;
  const total = inputTokens + outputTokens;
  return Number.isSafeInteger(total) ? total : null;
}

export function knownTokenTotal({ inputTokens, outputTokens }: NullableTokenCounts) {
  return safeKnownTokenSum(inputTokens, outputTokens);
}

function safeKnownTokenSum(inputTokens: number | null, outputTokens: number | null) {
  if (inputTokens === null && outputTokens === null) return null;
  const total = (inputTokens ?? 0) + (outputTokens ?? 0);
  return Number.isSafeInteger(total) ? total : null;
}

export function formatTokenCount(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat().format(value);
}

export function formatCompactTokenCount(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
  }).format(value);
}

export function formatUsageCoverage(reported: number, total: number) {
  if (total === 0) return 'No finalized turns';
  return `${reported.toLocaleString()} of ${total.toLocaleString()} turns`;
}

export function describeAggregateCoverage(aggregate: ModelUsageAggregate) {
  const reported = reportedUsageTurnCount(aggregate);
  if (aggregate.turnCount === 0) return 'No finalized turns';
  if (reported === 0) return `0 of ${aggregate.turnCount.toLocaleString()} turns reported`;
  const partial = aggregate.partialTurnCount;
  return `${reported.toLocaleString()} of ${aggregate.turnCount.toLocaleString()} turns reported${
    partial > 0 ? ` · ${partial.toLocaleString()} partial` : ''
  }`;
}

function paddedMaximum(maximum: number) {
  if (maximum <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / magnitude;
  const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
}

export function buildUsageTokenChart(buckets: readonly UsageChartBucket[]): UsageChartModel {
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const plotLeft = CHART_PADDING.left;
  const plotRight = width - CHART_PADDING.right;
  const plotTop = CHART_PADDING.top;
  const plotBottom = height - CHART_PADDING.bottom;
  const maximum = paddedMaximum(
    Math.max(0, ...buckets.map((bucket) => knownTokenTotal(bucket) ?? 0)),
  );
  const y = (value: number) => plotBottom - (value / maximum) * Math.max(1, plotBottom - plotTop);
  const slotWidth = (plotRight - plotLeft) / Math.max(1, buckets.length);
  const barWidth = Math.max(3, Math.min(34, slotWidth * 0.62));
  const bars = buckets.map((bucket, index) => {
    const input = bucket.inputTokens ?? 0;
    const output = bucket.outputTokens ?? 0;
    const inputTop = y(input);
    const totalTop = y(input + output);
    return {
      ...bucket,
      x: plotLeft + slotWidth * index + (slotWidth - barWidth) / 2,
      width: barWidth,
      inputY: inputTop,
      inputHeight: plotBottom - inputTop,
      outputY: totalTop,
      outputHeight: inputTop - totalTop,
      incomplete: bucket.lowerBound || bucket.inputTokens === null || bucket.outputTokens === null,
    } satisfies UsageChartBar;
  });
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      value: maximum * (1 - ratio),
      y: plotTop + ratio * (plotBottom - plotTop),
    };
  });
  return {
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    maximum,
    bars,
    ticks,
  };
}

export function usageSeriesChartBuckets(
  rows: readonly ModelUsageSeriesRow[],
  timeZone: string,
): UsageChartBucket[] {
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
  });
  return rows.map((row) => {
    const counts = aggregateTokenCounts(row);
    const dateLabel = formatter.format(new Date(row.fromInclusive));
    return {
      id: row.bucketKey,
      label: dateLabel,
      accessibleLabel: `${dateLabel}: ${formatTokenCount(counts.inputTokens)} known input tokens, ${formatTokenCount(counts.outputTokens)} known output tokens. ${describeAggregateCoverage(row)}${row.partialTurnCount > 0 || row.unavailableTurnCount > 0 ? '. Displayed values are a known lower bound' : ''}.`,
      lowerBound: row.partialTurnCount > 0 || row.unavailableTurnCount > 0,
      ...counts,
    };
  });
}

export function formatUsageRange(
  startAt: string,
  endAt: string,
  timeZone: string,
  locale?: string,
) {
  const start = new Date(startAt);
  const exclusiveEnd = new Date(Math.max(start.getTime(), new Date(endAt).getTime() - 1));
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(exclusiveEnd);
  return `${startLabel === endLabel ? startLabel : `${startLabel}–${endLabel}`} · ${timeZone}`;
}

export function localCalendarDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function usagePeriodLabel(period: UsagePeriod) {
  if (period === 'day') return 'Today';
  if (period === 'week') return 'This week';
  return 'This month';
}

export function usageBreakdownLabel(breakdown: UsageBreakdown) {
  if (breakdown === 'projects') return 'Projects';
  if (breakdown === 'lectures') return 'Lecture generations';
  return 'Providers & models';
}
