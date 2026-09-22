import { describe, expect, it } from 'vitest';

import {
  estimateUsageCostPartsUsd,
  estimateUsageCostUsd,
  extractLitellmPrices,
  modelPriceKey,
  summarizeUsageCost,
  type ModelPrice,
} from '../src/shared/model-price-contracts';

const price = (input: number, output: number, extra: Partial<ModelPrice> = {}): ModelPrice => ({
  inputPerToken: input,
  outputPerToken: output,
  cacheReadPerToken: null,
  cacheWritePerToken: null,
  reasoningOutputPerToken: null,
  ...extra,
});
const aggregate = (
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens?: number | null;
    cachedWriteTokens?: number | null;
    reasoningOutputTokens?: number | null;
  },
  reported = 1,
) => ({
  exactTurnCount: reported,
  partialTurnCount: 0,
  tokens: {
    totalTokens: tokens.inputTokens + tokens.outputTokens,
    cachedReadTokens: null,
    cachedWriteTokens: null,
    reasoningOutputTokens: null,
    ...tokens,
  },
});

describe('API price list', () => {
  it('keeps only first-party Anthropic and OpenAI text models at their standard rates', () => {
    const models = extractLitellmPrices({
      sample_spec: {
        input_cost_per_token: 0,
        output_cost_per_token: 0,
        litellm_provider: 'openai',
      },
      'Claude-Opus-5': {
        litellm_provider: 'anthropic',
        mode: 'chat',
        input_cost_per_token: 5e-6,
        output_cost_per_token: 2.5e-5,
        cache_read_input_token_cost: 5e-7,
        cache_creation_input_token_cost: 6.25e-6,
        input_cost_per_token_above_200k_tokens: 1e-5,
      },
      'gpt-5.6-luna': {
        litellm_provider: 'openai',
        mode: 'responses',
        input_cost_per_token: 2e-7,
        output_cost_per_token: 1.6e-6,
        output_cost_per_reasoning_token: 1.6e-6,
      },
      'bedrock/claude-opus-5': { litellm_provider: 'bedrock', mode: 'chat' },
      'azure/gpt-5': {
        litellm_provider: 'azure',
        mode: 'chat',
        input_cost_per_token: 1e-6,
        output_cost_per_token: 1e-5,
      },
      'text-embedding-3-large': {
        litellm_provider: 'openai',
        mode: 'embedding',
        input_cost_per_token: 1e-7,
        output_cost_per_token: 0,
      },
      'gpt-broken': {
        litellm_provider: 'openai',
        mode: 'chat',
        input_cost_per_token: -1,
        output_cost_per_token: 'free',
      },
      'gpt-absurd': {
        litellm_provider: 'openai',
        mode: 'chat',
        input_cost_per_token: 5,
        output_cost_per_token: 5,
      },
    });
    expect(Object.keys(models).sort()).toEqual(['claude-opus-5', 'gpt-5.6-luna']);
    expect(models['claude-opus-5']).toEqual({
      inputPerToken: 5e-6,
      outputPerToken: 2.5e-5,
      cacheReadPerToken: 5e-7,
      cacheWritePerToken: 6.25e-6,
      reasoningOutputPerToken: null,
    });
    expect(extractLitellmPrices(null)).toEqual({});
    expect(extractLitellmPrices([1, 2])).toEqual({});
  });

  it('finds the list entry for the ids GOSU records, and none for a model the list lacks', () => {
    const models = Object.fromEntries(
      [
        'gpt-5.6-luna',
        'gpt-6-astra',
        'gpt-5.5-2026-04-23',
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-sonnet-4-5',
        'claude-sonnet-4-6',
        'claude-sonnet-5',
        'claude-haiku-4-5',
        'claude-haiku-4-5-20251001',
        'claude-3-haiku-20240307',
      ].map((key) => [key, price(1e-6, 1e-5)]),
    );
    expect(modelPriceKey('gpt-5.6-luna', models)).toBe('gpt-5.6-luna');
    expect(modelPriceKey('GPT-6-Astra', models)).toBe('gpt-6-astra');
    expect(modelPriceKey('gpt-5.5-2026-04-23', models)).toBe('gpt-5.5-2026-04-23');
    expect(modelPriceKey('claude-code:opus-5', models)).toBe('claude-opus-5');
    expect(modelPriceKey('claude-code:sonnet-5', models)).toBe('claude-sonnet-5');
    expect(modelPriceKey('claude-haiku-4-5-20251001', models)).toBe('claude-haiku-4-5-20251001');
    // A bare family is that family's newest undated entry: 5 beats 4-6, and a dated or
    // "claude-3-haiku" style key never wins.
    expect(modelPriceKey('claude-code:sonnet', models)).toBe('claude-sonnet-5');
    expect(modelPriceKey('claude-code:haiku', models)).toBe('claude-haiku-4-5');
    expect(modelPriceKey('claude-code:opus', models)).toBe('claude-opus-5');
    expect(modelPriceKey('gpt-5.3-codex-spark', models)).toBeNull();
    expect(modelPriceKey('claude-code:mythos', models)).toBeNull();
    expect(modelPriceKey('', models)).toBeNull();
  });

  it('charges every token once: cached input, cache writes and reasoning at their own rates', () => {
    const full = price(2e-6, 1e-5, { cacheReadPerToken: 2e-7, cacheWritePerToken: 2.5e-6 });
    const tokens = {
      inputTokens: 1_000,
      outputTokens: 500,
      cachedReadTokens: 600,
      cachedWriteTokens: 100,
      reasoningOutputTokens: 200,
    };
    // 300 plain input + 600 cached reads + 100 cache writes + 500 output (reasoning at output rate)
    expect(estimateUsageCostUsd(aggregate(tokens), full)).toBeCloseTo(0.00597, 10);
    // Without cache rates the list's plain input rate applies; a reasoning rate applies to its part.
    expect(
      estimateUsageCostUsd(aggregate(tokens), price(2e-6, 1e-5, { reasoningOutputPerToken: 2e-5 })),
    ).toBeCloseTo(1_000 * 2e-6 + 300 * 1e-5 + 200 * 2e-5, 10);
    expect(
      estimateUsageCostUsd(aggregate({ inputTokens: 0, outputTokens: 0 }, 0), full),
    ).toBeNull();
    expect(estimateUsageCostUsd(aggregate({ inputTokens: 0, outputTokens: 0 }), full)).toBe(0);
  });

  it('sums the priced models and names the ones it left out instead of guessing', () => {
    const models = { 'gpt-5.6-luna': price(2e-7, 1.6e-6), 'claude-opus-5': price(5e-6, 2.5e-5) };
    const summary = summarizeUsageCost(
      [
        { resolvedModelId: 'gpt-5.6-luna', ...aggregate({ inputTokens: 1e6, outputTokens: 1e5 }) },
        {
          resolvedModelId: 'claude-code:opus-5',
          ...aggregate({ inputTokens: 2e5, outputTokens: 1e4 }),
        },
        {
          resolvedModelId: 'gpt-5.3-codex-spark',
          ...aggregate({ inputTokens: 5e5, outputTokens: 5e4 }),
        },
        { resolvedModelId: 'gpt-6-astra', ...aggregate({ inputTokens: 0, outputTokens: 0 }, 0) },
      ],
      models,
    );
    expect(summary.usd).toBeCloseTo(0.2 + 0.16 + 1 + 0.25, 10);
    expect(summary.pricedRows).toBe(2);
    expect(summary.unpricedModelIds).toEqual(['gpt-5.3-codex-spark']);
    expect(summarizeUsageCost([], models)).toEqual({
      usd: null,
      pricedRows: 0,
      unpricedModelIds: [],
    });
  });
  // 2026-09-22 user request: show input and output apart for each model, instead of model cards.
  it('splits an estimate into its input side and its output side, which add up to the estimate', () => {
    const tokens = {
      inputTokens: 1_000,
      outputTokens: 500,
      cachedReadTokens: 400,
      cachedWriteTokens: 100,
      reasoningOutputTokens: 200,
    };
    const full = price(2e-6, 1e-5, {
      cacheReadPerToken: 2e-7,
      cacheWritePerToken: 2.5e-6,
      reasoningOutputPerToken: 2e-5,
    });
    const parts = estimateUsageCostPartsUsd(aggregate(tokens), full)!;
    // Input side: 500 plain + 400 cache reads + 100 cache writes. Output side: 300 plain + 200 reasoning.
    expect(parts.inputUsd).toBeCloseTo(500 * 2e-6 + 400 * 2e-7 + 100 * 2.5e-6, 12);
    expect(parts.outputUsd).toBeCloseTo(300 * 1e-5 + 200 * 2e-5, 12);
    expect(parts.inputUsd + parts.outputUsd).toBeCloseTo(
      estimateUsageCostUsd(aggregate(tokens), full)!,
      12,
    );
    expect(
      estimateUsageCostPartsUsd(aggregate({ inputTokens: 0, outputTokens: 0 }, 0), full),
    ).toBeNull();
  });
});
