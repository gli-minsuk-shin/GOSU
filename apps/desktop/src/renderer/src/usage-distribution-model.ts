import type {
  ModelUsageAggregate,
  ModelUsageAnalyticsReport,
  ModelUsageModelRow,
  ModelUsageWorkloadModelRow,
} from '../../shared/model-usage-contracts';
import {
  estimateUsageCostPartsUsd,
  modelPriceKey,
  summarizeUsageCost,
  type ModelPrice,
  type UsageCostSummary,
} from '../../shared/model-price-contracts';

/** Why a row has, or does not have, an API-equivalent amount. An unknown is never shown as zero. */
export type UsageCostState =
  | Readonly<{ kind: 'known'; usd: number; excludedModelIds: readonly string[] }>
  /** Tokens were reported, but the price list has no entry for the model(s). */
  | Readonly<{ kind: 'unpriced'; modelIds: readonly string[] }>
  /** No turn of the row reported tokens. */
  | Readonly<{ kind: 'unreported' }>
  /** A feature without a usable model breakdown (an older report, or one cut at its row limit). */
  | Readonly<{ kind: 'no_breakdown' }>;

export type UsageDistributionRow = Readonly<{
  key: string;
  /** A model id or a workload kind; the view turns it into a label. */
  id: string;
  /** For a model row when the report has more than one connection; otherwise null. */
  connectionLabel: string | null;
  turnCount: number;
  /** Provider-reported tokens; null when no turn of the row reported any. */
  tokens: number | null;
  /** null when there is no price list at all: then the view shows no cost anywhere. */
  cost: UsageCostState | null;
  /**
   * On a model row: its input and output apart, in tokens and (with a price) in money; the two
   * amounts add up to the row's cost. null when no turn reported tokens. Absent on a feature row.
   */
  io?: UsageModelIo | null;
  /** On a model row with a price: the price list entry it was priced as. */
  pricedAs?: string;
  /**
   * A model's place in the report's model order. A model keeps this tone in the model list and in
   * every feature bar, whatever metric orders the rows. Absent on a feature row.
   */
  tone?: number;
  /**
   * On a feature row: the models that ran the feature (each with the model row's key and tone), or
   * null without a usable breakdown. Absent on a model row.
   */
  parts?: readonly UsageDistributionRow[] | null;
}>;

export type UsageModelIo = Readonly<{
  inputTokens: number;
  outputTokens: number;
  /** null when any reported turn of the row lacks a cache count. */
  cachedReadTokens: number | null;
  inputUsd: number | null;
  outputUsd: number | null;
}>;

export type UsageDistribution = Readonly<{
  models: readonly UsageDistributionRow[];
  workloads: readonly UsageDistributionRow[];
  /** The amount of the summary card, from the same parts as the rows; null without a price list. */
  total: UsageCostSummary | null;
}>;

const reported = (row: Pick<ModelUsageAggregate, 'exactTurnCount' | 'partialTurnCount'>) =>
  row.exactTurnCount + row.partialTurnCount > 0;

const modelKey = (
  row: Pick<
    ModelUsageModelRow,
    'connectionKey' | 'providerId' | 'upstreamProviderId' | 'resolvedModelId'
  >,
) =>
  JSON.stringify([
    row.connectionKey,
    row.providerId,
    row.upstreamProviderId ?? '',
    row.resolvedModelId,
  ]);

/**
 * The feature-by-model parts when they cover the whole report. The main process cuts the list at
 * 1,000 rows and older reports have none; a partial list would price a feature too low, so it is
 * used only when its turns add up to the report's total.
 */
export function usageCostParts(
  report: Pick<ModelUsageAnalyticsReport, 'byWorkloadModel' | 'totals'>,
): readonly ModelUsageWorkloadModelRow[] | null {
  const parts = report.byWorkloadModel;
  if (!parts) return null;
  return parts.reduce((turns, part) => turns + part.turnCount, 0) === report.totals.turnCount
    ? parts
    : null;
}

function costState(summary: UsageCostSummary): UsageCostState {
  if (summary.usd !== null)
    return { kind: 'known', usd: summary.usd, excludedModelIds: summary.unpricedModelIds };
  return summary.unpricedModelIds.length
    ? { kind: 'unpriced', modelIds: summary.unpricedModelIds }
    : { kind: 'unreported' };
}

/**
 * Tokens and API-equivalent cost per model and per feature. A feature has no price of its own: its
 * cost is the sum over the models that ran it. Every amount on the screen (summary card, model
 * cards, both lists) comes from the same parts, because cost does not add up across groupings: an
 * aggregate loses its cache counts as soon as one turn lacks them, and is then priced at the full
 * input rate. With the parts, features, models and the card agree to the cent.
 */
export function buildUsageDistribution(
  report: Pick<ModelUsageAnalyticsReport, 'byModel' | 'byWorkload' | 'byWorkloadModel' | 'totals'>,
  prices: Readonly<Record<string, ModelPrice>> | null,
): UsageDistribution {
  const parts = usageCostParts(report);
  const severalConnections = new Set(report.byModel.map((row) => row.connectionKey)).size > 1;
  const models = report.byModel.map((row, tone): UsageDistributionRow => {
    const key = modelKey(row);
    const source = parts ? parts.filter((part) => modelKey(part) === key) : [row];
    const priceKey = prices ? modelPriceKey(row.resolvedModelId, prices) : null;
    // Money is split over the same parts the row's amount comes from, so the two sides add up to it.
    const money =
      prices && priceKey
        ? source.reduce<{ inputUsd: number; outputUsd: number } | null>((sum, part) => {
            const next = estimateUsageCostPartsUsd(part, prices[priceKey]!);
            return next
              ? {
                  inputUsd: (sum?.inputUsd ?? 0) + next.inputUsd,
                  outputUsd: (sum?.outputUsd ?? 0) + next.outputUsd,
                }
              : sum;
          }, null)
        : null;
    return {
      key,
      id: row.resolvedModelId,
      connectionLabel: severalConnections ? row.connectionLabel : null,
      turnCount: row.turnCount,
      tokens: reported(row) ? row.tokens.totalTokens : null,
      cost: prices ? costState(summarizeUsageCost(source, prices)) : null,
      tone,
      io: reported(row)
        ? {
            inputTokens: row.tokens.inputTokens,
            outputTokens: row.tokens.outputTokens,
            cachedReadTokens: row.tokens.cachedReadTokens,
            inputUsd: money?.inputUsd ?? null,
            outputUsd: money?.outputUsd ?? null,
          }
        : null,
      ...(priceKey ? { pricedAs: priceKey } : {}),
    };
  });
  const tones = new Map(models.map((row) => [row.key, row.tone!]));
  const workloads = report.byWorkload.map((row): UsageDistributionRow => {
    const own = parts?.filter((part) => part.workloadKind === row.workloadKind) ?? null;
    return {
      key: row.workloadKind,
      id: row.workloadKind,
      connectionLabel: null,
      turnCount: row.turnCount,
      tokens: reported(row) ? row.tokens.totalTokens : null,
      cost: !prices
        ? null
        : own
          ? costState(summarizeUsageCost(own, prices))
          : { kind: 'no_breakdown' },
      // Which models ran the feature. A model missing from `byModel` cannot happen for a complete
      // breakdown (both come from the same turns); it would get the last, neutral tone.
      parts:
        own?.map((part): UsageDistributionRow => {
          const key = modelKey(part);
          return {
            key,
            id: part.resolvedModelId,
            connectionLabel: severalConnections ? part.connectionLabel : null,
            turnCount: part.turnCount,
            tokens: reported(part) ? part.tokens.totalTokens : null,
            cost: prices ? costState(summarizeUsageCost([part], prices)) : null,
            tone: tones.get(key) ?? models.length,
          };
        }) ?? null,
    };
  });
  return {
    models,
    workloads,
    total: prices ? summarizeUsageCost(parts ?? report.byModel, prices) : null,
  };
}

/** The distribution row of a `byModel` row, for the model cards' cost line. */
export const usageModelRowKey = modelKey;

export type UsageDistributionMetric = 'tokens' | 'usd';

const metricValue = (row: UsageDistributionRow, metric: UsageDistributionMetric) =>
  metric === 'tokens' ? row.tokens : row.cost?.kind === 'known' ? row.cost.usd : null;

/**
 * Largest first by the chosen metric. Rows without that metric go last, in their token order. `share`
 * is the bar length in percent of the largest row: at least 1 for anything above zero, so a small
 * amount stays visible, and 0 for a true zero or an unknown.
 */
export function rankUsageDistribution(
  rows: readonly UsageDistributionRow[],
  metric: UsageDistributionMetric,
) {
  const ranked = [...rows].sort((a, b) => {
    const left = metricValue(a, metric),
      right = metricValue(b, metric);
    if (left === null || right === null)
      return left === right ? (b.tokens ?? -1) - (a.tokens ?? -1) : left === null ? 1 : -1;
    return right - left || (b.tokens ?? -1) - (a.tokens ?? -1);
  });
  const max = Math.max(0, ...ranked.map((row) => metricValue(row, metric) ?? 0));
  return ranked.map((row) => {
    const value = metricValue(row, metric);
    return {
      ...row,
      value,
      share: value && max > 0 ? Math.max(1, Math.round((value / max) * 1000) / 10) : 0,
    };
  });
}

/**
 * A feature's models for its stacked bar, largest first by the chosen metric. `fraction` is the
 * model's share of what is known for the feature (the shares add up to 1); a model without that
 * metric (no price, or no reported tokens) has no share and goes last, so it is named, not drawn.
 */
export function splitUsageParts(
  parts: readonly UsageDistributionRow[],
  metric: UsageDistributionMetric,
) {
  const known = parts.reduce((sum, part) => sum + (metricValue(part, metric) ?? 0), 0);
  return [...parts]
    .map((part) => {
      const value = metricValue(part, metric);
      return { ...part, value, fraction: value === null || known <= 0 ? null : value / known };
    })
    .sort((a, b) =>
      a.value === null || b.value === null
        ? a.value === b.value
          ? (b.tokens ?? -1) - (a.tokens ?? -1)
          : a.value === null
            ? 1
            : -1
        : b.value - a.value || (b.tokens ?? -1) - (a.tokens ?? -1),
    );
}
