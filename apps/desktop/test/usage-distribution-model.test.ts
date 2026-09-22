import { describe, expect, it } from 'vitest';
import type { ModelUsageAnalyticsReport } from '../src/shared/model-usage-contracts';
import type { ModelPrice } from '../src/shared/model-price-contracts';
import {
  buildUsageDistribution,
  rankUsageDistribution,
  splitUsageParts,
  usageCostParts,
} from '../src/renderer/src/usage-distribution-model';

type Report = Pick<
  ModelUsageAnalyticsReport,
  'byModel' | 'byWorkload' | 'byWorkloadModel' | 'totals'
>;
type Part = NonNullable<Report['byWorkloadModel']>[number];

const aggregate = (
  input: number,
  output: number,
  options: { cachedRead?: number | null; turns?: number; reported?: boolean } = {},
) => {
  const turns = options.turns ?? 1;
  const reported = options.reported ?? true;
  return {
    tokens: {
      inputTokens: reported ? input : 0,
      outputTokens: reported ? output : 0,
      totalTokens: reported ? input + output : 0,
      cachedReadTokens: reported ? (options.cachedRead ?? null) : null,
      cachedWriteTokens: null,
      reasoningOutputTokens: null,
    },
    turnCount: turns,
    exactTurnCount: reported ? turns : 0,
    partialTurnCount: 0,
    unavailableTurnCount: reported ? 0 : turns,
  };
};
const part = (
  workloadKind: Part['workloadKind'],
  resolvedModelId: string,
  value: ReturnType<typeof aggregate>,
  connectionKey = 'codex:native',
): Part => ({
  workloadKind,
  connectionKey,
  connectionLabel: connectionKey === 'codex:native' ? 'codex · GOSU' : 'ChatGPT',
  providerId: 'codex',
  upstreamProviderId: null,
  resolvedModelId,
  ...value,
});
/** A report whose marginals are what the main process would compute from these parts. */
function reportOf(parts: Part[], options: { withParts?: boolean } = {}): Report {
  const merge = (rows: Part[]) => {
    const live = rows.filter((row) => row.exactTurnCount > 0);
    // The service's rule: one reported turn without a cache count makes the whole count unknown.
    const cached = live.some((row) => row.tokens.cachedReadTokens === null)
      ? null
      : live.reduce((sum, row) => sum + row.tokens.cachedReadTokens!, 0);
    return {
      tokens: {
        inputTokens: rows.reduce((sum, row) => sum + row.tokens.inputTokens, 0),
        outputTokens: rows.reduce((sum, row) => sum + row.tokens.outputTokens, 0),
        totalTokens: rows.reduce((sum, row) => sum + row.tokens.totalTokens, 0),
        cachedReadTokens: live.length ? cached : null,
        cachedWriteTokens: null,
        reasoningOutputTokens: null,
      },
      turnCount: rows.reduce((sum, row) => sum + row.turnCount, 0),
      exactTurnCount: rows.reduce((sum, row) => sum + row.exactTurnCount, 0),
      partialTurnCount: 0,
      unavailableTurnCount: rows.reduce((sum, row) => sum + row.unavailableTurnCount, 0),
    };
  };
  const group = <Key extends string>(key: (row: Part) => Key) => {
    const groups = new Map<Key, Part[]>();
    for (const row of parts) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
    return [...groups.values()];
  };
  return {
    totals: merge(parts),
    byModel: group((row) => `${row.connectionKey}|${row.resolvedModelId}`).map((rows) => {
      const { workloadKind: _kind, ...model } = rows[0]!;
      return { ...model, ...merge(rows) };
    }),
    byWorkload: group((row) => row.workloadKind).map((rows) => ({
      workloadKind: rows[0]!.workloadKind,
      ...merge(rows),
    })),
    ...(options.withParts === false ? {} : { byWorkloadModel: parts }),
  };
}
const price = (input: number, output: number, cacheRead: number | null = null): ModelPrice => ({
  inputPerToken: input / 1e6,
  outputPerToken: output / 1e6,
  cacheReadPerToken: cacheRead === null ? null : cacheRead / 1e6,
  cacheWritePerToken: null,
  reasoningOutputPerToken: null,
});
const PRICES = { 'gpt-6-astra': price(10, 50, 1), 'gpt-5.6-luna': price(0.2, 1.2, 0.02) };
const known = (row: { cost: unknown }) => row.cost as { kind: 'known'; usd: number };

describe('usage distribution', () => {
  it('prices a feature as the sum of the models that ran it', () => {
    const report = reportOf([
      part('briefing_assistant', 'gpt-6-astra', aggregate(1_000_000, 100_000)),
      part('briefing_summary', 'gpt-5.6-luna', aggregate(9_000_000, 600_000)),
      part('briefing_summary', 'gpt-6-astra', aggregate(200_000, 10_000)),
    ]);
    const { models, workloads, total } = buildUsageDistribution(report, PRICES);
    const feature = (id: string) => workloads.find((row) => row.id === id)!;
    // Astra: 1.0M in, 0.1M out -> $10 + $5. Luna: 9M in, 0.6M out -> $1.80 + $0.72.
    expect(known(feature('briefing_assistant')).usd).toBeCloseTo(15, 6);
    expect(known(feature('briefing_summary')).usd).toBeCloseTo(1.8 + 0.72 + 2 + 0.5, 6);
    expect(feature('briefing_summary').tokens).toBe(9_810_000);
    const model = (id: string) => models.find((row) => row.id === id)!;
    expect(known(model('gpt-6-astra')).usd).toBeCloseTo(15 + 2.5, 6);
    expect(total!.usd).toBeCloseTo(20.02, 6);
    // One connection: a model row needs no connection name.
    expect(models.every((row) => row.connectionLabel === null)).toBe(true);
  });

  it('keeps features, models and the summary card in agreement when cache counts are partly missing', () => {
    // Native rows can mix turns with and without a cache count for one model. The model's own
    // aggregate then has no cache count at all and would be priced at the full input rate, while the
    // parts still know theirs: priced separately, the three numbers on the screen would disagree.
    const report = reportOf([
      part('briefing_assistant', 'gpt-6-astra', aggregate(1_000_000, 0, { cachedRead: 900_000 })),
      part('briefing_summary', 'gpt-6-astra', aggregate(1_000_000, 0, { cachedRead: null })),
    ]);
    expect(report.byModel[0]!.tokens.cachedReadTokens).toBeNull();
    const { models, workloads, total } = buildUsageDistribution(report, PRICES);
    const sum = (rows: readonly { cost: unknown }[]) =>
      rows.reduce((value, row) => value + known(row).usd, 0);
    // 0.1M at $10 + 0.9M at $1 = $1.90, and 1M at $10 = $10.
    expect(sum(workloads)).toBeCloseTo(11.9, 6);
    expect(sum(models)).toBeCloseTo(sum(workloads), 9);
    expect(total!.usd).toBeCloseTo(sum(workloads), 9);
  });

  it('says why an amount is missing instead of showing zero', () => {
    const report = reportOf([
      part('project_chat', 'gpt-6-astra', aggregate(100_000, 1_000)),
      part('project_chat', 'gpt-5.3-codex-spark', aggregate(50_000, 500)),
      part('model_lab', 'gpt-5.3-codex-spark', aggregate(18_000, 0)),
      part('lecture_generation', 'gpt-6-astra', aggregate(0, 0, { reported: false, turns: 2 })),
    ]);
    const { models, workloads, total } = buildUsageDistribution(report, PRICES);
    const feature = (id: string) => workloads.find((row) => row.id === id)!;
    // Partly priced: the known part, with the model that was left out named.
    expect(feature('project_chat').cost).toMatchObject({
      kind: 'known',
      excludedModelIds: ['gpt-5.3-codex-spark'],
    });
    // Its only model has no price: unknown, not $0.
    expect(feature('model_lab').cost).toEqual({
      kind: 'unpriced',
      modelIds: ['gpt-5.3-codex-spark'],
    });
    // Turns without reported tokens: nothing to price, and no tokens either.
    expect(feature('lecture_generation')).toMatchObject({
      tokens: null,
      turnCount: 2,
      cost: { kind: 'unreported' },
    });
    expect(models.find((row) => row.id === 'gpt-5.3-codex-spark')!.cost).toMatchObject({
      kind: 'unpriced',
    });
    expect(total!.unpricedModelIds).toEqual(['gpt-5.3-codex-spark']);
  });

  it('shows no cost without a price list, and no feature cost without a complete breakdown', () => {
    const parts = [
      part('project_chat', 'gpt-6-astra', aggregate(100_000, 1_000)),
      part('briefing_summary', 'gpt-5.6-luna', aggregate(100_000, 1_000)),
    ];
    const plain = buildUsageDistribution(reportOf(parts), null);
    expect(plain.total).toBeNull();
    expect([...plain.models, ...plain.workloads].every((row) => row.cost === null)).toBe(true);
    expect(plain.workloads[0]!.tokens).toBe(101_000);
    // A report from before 0.58.138: models are priced from their own rows, features cannot be.
    const older = buildUsageDistribution(reportOf(parts, { withParts: false }), PRICES);
    expect(older.models.every((row) => row.cost?.kind === 'known')).toBe(true);
    expect(older.workloads.every((row) => row.cost?.kind === 'no_breakdown')).toBe(true);
    expect(older.total!.usd).toBeGreaterThan(0);
    // A list cut at its row limit does not cover every turn: it is not used, rather than
    // pricing a feature too low.
    const cut = { ...reportOf(parts), byWorkloadModel: parts.slice(0, 1) };
    expect(usageCostParts(cut)).toBeNull();
    expect(usageCostParts(reportOf(parts))).toHaveLength(2);
    expect(buildUsageDistribution(cut, PRICES).workloads[0]!.cost).toEqual({
      kind: 'no_breakdown',
    });
  });

  it('names the connection only when the same report has more than one', () => {
    const report = reportOf([
      part('project_chat', 'gpt-6-astra', aggregate(100_000, 1_000), 'codex:chatgpt'),
      part('briefing_assistant', 'gpt-6-astra', aggregate(200_000, 2_000), 'codex:native'),
    ]);
    const { models } = buildUsageDistribution(report, PRICES);
    expect(models.map((row) => row.connectionLabel).sort()).toEqual(['ChatGPT', 'codex · GOSU']);
    expect(new Set(models.map((row) => row.key)).size).toBe(2);
  });

  it('ranks by the chosen metric, unknown values last, with a visible bar for anything above zero', () => {
    const report = reportOf([
      part('briefing_summary', 'gpt-5.6-luna', aggregate(9_000_000, 600_000)),
      part('briefing_assistant', 'gpt-6-astra', aggregate(1_000_000, 100_000)),
      part('model_lab', 'gpt-5.3-codex-spark', aggregate(2_000_000, 0)),
      part('project_chat_title', 'gpt-5.6-luna', aggregate(900, 100)),
    ]);
    const { workloads } = buildUsageDistribution(report, PRICES);
    expect(rankUsageDistribution(workloads, 'tokens').map((row) => row.id)).toEqual([
      'briefing_summary',
      'model_lab',
      'briefing_assistant',
      'project_chat_title',
    ]);
    const byCost = rankUsageDistribution(workloads, 'usd');
    // The cheap model did most of the tokens; the expensive one leads by cost. No price: last.
    expect(byCost.map((row) => row.id)).toEqual([
      'briefing_assistant',
      'briefing_summary',
      'project_chat_title',
      'model_lab',
    ]);
    expect(byCost.map((row) => row.share)).toEqual([100, expect.any(Number), 1, 0]);
    expect(byCost[1]!.share).toBeCloseTo(16.8, 1);
    expect(byCost[3]!.value).toBeNull();
    expect(rankUsageDistribution([], 'usd')).toEqual([]);
  });
  // 2026-09-21 user request: "기능별로 어떤 모델이 쓰였는지 궁금함 … 기능 아래 모델별 누적 막대로".
  it('lists the models that ran each feature, in the tone of that model, or nothing without a complete breakdown', () => {
    const parts = [
      part('briefing_assistant', 'gpt-6-astra', aggregate(1_000_000, 100_000)),
      part('briefing_summary', 'gpt-5.6-luna', aggregate(9_000_000, 600_000)),
      part('briefing_summary', 'gpt-6-astra', aggregate(200_000, 10_000)),
      part('briefing_summary', 'gpt-5.3-codex-spark', aggregate(19_000, 200)),
      part('briefing_summary', 'gpt-0-silent', aggregate(0, 0, { reported: false })),
    ];
    const { models, workloads } = buildUsageDistribution(reportOf(parts), PRICES);
    // A model keeps one tone everywhere; it follows the report's model order, not the metric.
    expect(models.map((row) => row.tone)).toEqual(models.map((_, index) => index));
    const tone = (id: string) => models.find((row) => row.id === id)!.tone;
    const summary = workloads.find((row) => row.id === 'briefing_summary')!;
    expect(summary.parts!.map((row) => [row.id, row.tokens, row.cost!.kind, row.tone])).toEqual([
      ['gpt-5.6-luna', 9_600_000, 'known', tone('gpt-5.6-luna')],
      ['gpt-6-astra', 210_000, 'known', tone('gpt-6-astra')],
      ['gpt-5.3-codex-spark', 19_200, 'unpriced', tone('gpt-5.3-codex-spark')],
      ['gpt-0-silent', null, 'unreported', tone('gpt-0-silent')],
    ]);
    expect(known(summary.parts![0]!).usd).toBeCloseTo(1.8 + 0.72, 6);
    // A model row and its part share the key, so the view can tie a segment to the model list.
    expect(summary.parts![1]!.key).toBe(models.find((row) => row.id === 'gpt-6-astra')!.key);
    expect(workloads.find((row) => row.id === 'briefing_assistant')!.parts).toHaveLength(1);
    // Older reports and reports cut at the row limit have no usable breakdown: no parts, no guess.
    const without = buildUsageDistribution(reportOf(parts, { withParts: false }), PRICES);
    expect(without.workloads.every((row) => row.parts === null)).toBe(true);
    // Without a price list the parts are still there, by tokens only.
    const unpriced = buildUsageDistribution(reportOf(parts), null);
    expect(unpriced.workloads[0]!.parts!.every((row) => row.cost === null)).toBe(true);
  });

  it('splits a feature by the chosen metric: shares of what is known, unknown parts named last', () => {
    const { workloads } = buildUsageDistribution(
      reportOf([
        part('briefing_summary', 'gpt-5.6-luna', aggregate(9_000_000, 600_000)),
        part('briefing_summary', 'gpt-6-astra', aggregate(200_000, 10_000)),
        part('briefing_summary', 'gpt-5.3-codex-spark', aggregate(19_000, 200)),
      ]),
      PRICES,
    );
    const parts = workloads[0]!.parts!;
    const byTokens = splitUsageParts(parts, 'tokens');
    expect(byTokens.map((row) => row.id)).toEqual([
      'gpt-5.6-luna',
      'gpt-6-astra',
      'gpt-5.3-codex-spark',
    ]);
    expect(byTokens.reduce((sum, row) => sum + row.fraction!, 0)).toBeCloseTo(1, 9);
    expect(byTokens[0]!.fraction).toBeCloseTo(9_600_000 / 9_829_200, 9);
    // By cost the expensive model and the cheap one are nearly even; the unpriced one has no share.
    const byCost = splitUsageParts(parts, 'usd');
    expect(byCost.map((row) => [row.id, row.fraction === null])).toEqual([
      ['gpt-5.6-luna', false],
      ['gpt-6-astra', false],
      ['gpt-5.3-codex-spark', true],
    ]);
    expect(byCost[0]!.fraction).toBeCloseTo(2.52 / 5.02, 9);
    expect(splitUsageParts([], 'tokens')).toEqual([]);
  });
  // 2026-09-22 user request: "모델별 사용량은 불필요 … 사용 분포에서 model 별로 입력 출력 색깔 다르게".
  it('gives each model its input and output, in tokens and in money, adding up to the row', () => {
    const { models } = buildUsageDistribution(
      reportOf([
        part(
          'briefing_assistant',
          'gpt-6-astra',
          aggregate(1_000_000, 100_000, { cachedRead: 400_000 }),
        ),
        part('briefing_summary', 'gpt-6-astra', aggregate(200_000, 10_000, { cachedRead: 0 })),
        part('briefing_summary', 'gpt-5.3-codex-spark', aggregate(19_000, 200)),
        part('briefing_summary', 'gpt-0-silent', aggregate(0, 0, { reported: false })),
      ]),
      PRICES,
    );
    const astra = models.find((row) => row.id === 'gpt-6-astra')!;
    expect(astra.io).toMatchObject({
      inputTokens: 1_200_000,
      outputTokens: 110_000,
      cachedReadTokens: 400_000,
    });
    // Input: 0.8M at $10 + 0.4M cached at $1 = $8.40. Output: 0.11M at $50 = $5.50.
    expect(astra.io!.inputUsd).toBeCloseTo(8.4, 6);
    expect(astra.io!.outputUsd).toBeCloseTo(5.5, 6);
    expect(astra.io!.inputUsd! + astra.io!.outputUsd!).toBeCloseTo(known(astra).usd, 9);
    expect(astra.pricedAs).toBe('gpt-6-astra');
    // No price: tokens are split, money is not. No reported tokens: nothing to split.
    const spark = models.find((row) => row.id === 'gpt-5.3-codex-spark')!;
    expect(spark.io).toMatchObject({ inputTokens: 19_000, outputTokens: 200, inputUsd: null });
    expect(spark.pricedAs).toBeUndefined();
    expect(models.find((row) => row.id === 'gpt-0-silent')!.io).toBeNull();
    // Without a price list the token split is still there.
    const plain = buildUsageDistribution(
      reportOf([part('briefing_summary', 'gpt-6-astra', aggregate(10, 5))]),
      null,
    );
    expect(plain.models[0]!.io).toMatchObject({ inputTokens: 10, outputTokens: 5, inputUsd: null });
  });
});
