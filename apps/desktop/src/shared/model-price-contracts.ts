import { z } from 'zod';

import type { ModelUsageAggregate } from './model-usage-contracts';

/**
 * What the same tokens would have cost on a pay-per-token API key. GOSU runs on subscriptions, so
 * this is an estimate for comparison, never a bill. Prices are data, fetched from a public list and
 * kept on disk; no price is written into the source, so a price change needs no release.
 */
export const MODEL_PRICE_SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const MODEL_PRICE_SOURCE_LABEL = 'LiteLLM model_prices_and_context_window.json';
export const MODEL_PRICE_REFRESH_INTERVAL_MS = 24 * 60 * 60_000;
export const MODEL_PRICE_MAX_BYTES = 16_000_000;
export const MODEL_PRICE_MAX_MODELS = 3_000;

export const MODEL_PRICE_IPC_CHANNELS = {
  status: 'gosu:model-usage:prices',
  refresh: 'gosu:model-usage:prices:refresh',
} as const;

// USD per token. A dollar per token is already absurd; anything above is a broken list.
const perToken = z.number().finite().min(0).max(1);
export const ModelPriceSchema = z
  .object({
    inputPerToken: perToken,
    outputPerToken: perToken,
    cacheReadPerToken: perToken.nullable(),
    cacheWritePerToken: perToken.nullable(),
    reasoningOutputPerToken: perToken.nullable(),
  })
  .strict();
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const ModelPriceCatalogSchema = z
  .object({
    version: z.literal(1),
    sourceUrl: z.string().url().max(500),
    fetchedAt: z.string().datetime(),
    etag: z.string().max(300).nullable(),
    models: z.record(z.string().min(1).max(200), ModelPriceSchema),
  })
  .strict()
  .refine((catalog) => Object.keys(catalog.models).length <= MODEL_PRICE_MAX_MODELS, {
    path: ['models'],
    message: 'too many models',
  });
export type ModelPriceCatalog = z.infer<typeof ModelPriceCatalogSchema>;

export const ModelPriceStatusSchema = z
  .object({
    catalog: ModelPriceCatalogSchema.nullable(),
    lastAttemptAt: z.string().datetime().nullable(),
    /** A stable code, never provider or network text. */
    lastError: z
      .enum([
        'model_prices_network',
        'model_prices_http',
        'model_prices_too_large',
        'model_prices_invalid',
        'model_prices_empty',
        'model_prices_storage',
      ])
      .nullable(),
  })
  .strict();
export type ModelPriceStatus = z.infer<typeof ModelPriceStatusSchema>;

const PRICED_PROVIDERS = new Set(['anthropic', 'openai']);
const PRICED_MODES = new Set(['chat', 'responses', 'completion']);

function cost(value: unknown) {
  const parsed = perToken.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The first-party Anthropic and OpenAI entries of the LiteLLM list, at their standard rates. Tiered
 * (long-context), batch, flex and priority rates are left out: usage is stored per period, not per
 * request, so a tier cannot be told afterwards.
 */
export function extractLitellmPrices(raw: unknown): Record<string, ModelPrice> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const models: Record<string, ModelPrice> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(models).length >= MODEL_PRICE_MAX_MODELS) break;
    if (key === 'sample_spec' || key.length > 200 || key.includes('/')) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.litellm_provider !== 'string' ||
      !PRICED_PROVIDERS.has(entry.litellm_provider) ||
      typeof entry.mode !== 'string' ||
      !PRICED_MODES.has(entry.mode)
    )
      continue;
    const inputPerToken = cost(entry.input_cost_per_token),
      outputPerToken = cost(entry.output_cost_per_token);
    if (inputPerToken === null || outputPerToken === null) continue;
    models[key.toLowerCase()] = {
      inputPerToken,
      outputPerToken,
      cacheReadPerToken: cost(entry.cache_read_input_token_cost),
      cacheWritePerToken: cost(entry.cache_creation_input_token_cost),
      reasoningOutputPerToken: cost(entry.output_cost_per_reasoning_token),
    };
  }
  return models;
}

const CLAUDE_FAMILY = /^[a-z]+$/u;

/**
 * The price-list key for a model GOSU recorded. Codex ids are the list's own ids. Claude Code
 * records its aliases ("claude-code:opus-5", "claude-code:haiku"): a versioned alias maps to
 * "claude-opus-5", a bare family to that family's newest undated entry in the list.
 */
export function modelPriceKey(
  resolvedModelId: string,
  models: Readonly<Record<string, ModelPrice>>,
): string | null {
  const id = resolvedModelId.trim().toLowerCase();
  if (!id) return null;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(models, key);
  const bare = id.replace(/^(?:claude-code|codex|openai|anthropic):/u, '');
  const undated = bare.replace(/-\d{4}-?\d{2}-?\d{2}$/u, '');
  for (const key of [id, bare, undated]) if (has(key)) return key;
  if (!id.startsWith('claude-code:') && !bare.startsWith('claude-')) return null;
  const alias = bare.replace(/^claude-/u, '');
  for (const key of [`claude-${alias}`, `claude-${alias.replace(/-\d{8}$/u, '')}`])
    if (has(key)) return key;
  if (!CLAUDE_FAMILY.test(alias)) return null;
  let newest: { key: string; major: number; minor: number } | null = null;
  const pattern = new RegExp(`^claude-${alias}-(\\d{1,2})(?:-(\\d{1,2}))?$`, 'u');
  for (const key of Object.keys(models)) {
    const match = pattern.exec(key);
    if (!match) continue;
    const major = Number(match[1]),
      minor = Number(match[2] ?? 0);
    if (!newest || major > newest.major || (major === newest.major && minor > newest.minor))
      newest = { key, major, minor };
  }
  return newest?.key ?? null;
}

/**
 * USD for one aggregate at standard rates, or null when the provider reported no tokens. Cached
 * reads and writes are part of the input count and reasoning is part of the output count, so each
 * token is charged once, at its own rate when the list has one and at the plain rate otherwise.
 */
/**
 * The input side (plain input, cache reads, cache writes) and the output side (output, reasoning) of
 * an estimate. They add up to `estimateUsageCostUsd`, which is built from them.
 */
export function estimateUsageCostPartsUsd(
  aggregate: Pick<ModelUsageAggregate, 'tokens' | 'exactTurnCount' | 'partialTurnCount'>,
  price: ModelPrice,
): { inputUsd: number; outputUsd: number } | null {
  if (aggregate.exactTurnCount + aggregate.partialTurnCount === 0) return null;
  const { inputTokens, outputTokens } = aggregate.tokens;
  const cachedRead = Math.min(aggregate.tokens.cachedReadTokens ?? 0, inputTokens);
  const cachedWrite = Math.min(aggregate.tokens.cachedWriteTokens ?? 0, inputTokens - cachedRead);
  const reasoning = Math.min(aggregate.tokens.reasoningOutputTokens ?? 0, outputTokens);
  const inputUsd =
    (inputTokens - cachedRead - cachedWrite) * price.inputPerToken +
    cachedRead * (price.cacheReadPerToken ?? price.inputPerToken) +
    cachedWrite * (price.cacheWritePerToken ?? price.inputPerToken);
  const outputUsd =
    (outputTokens - reasoning) * price.outputPerToken +
    reasoning * (price.reasoningOutputPerToken ?? price.outputPerToken);
  return Number.isFinite(inputUsd) && Number.isFinite(outputUsd) && inputUsd >= 0 && outputUsd >= 0
    ? { inputUsd, outputUsd }
    : null;
}

export function estimateUsageCostUsd(
  aggregate: Pick<ModelUsageAggregate, 'tokens' | 'exactTurnCount' | 'partialTurnCount'>,
  price: ModelPrice,
): number | null {
  const parts = estimateUsageCostPartsUsd(aggregate, price);
  return parts ? parts.inputUsd + parts.outputUsd : null;
}

export type UsageCostSummary = Readonly<{
  /** Sum over the rows that have a price; null when no row has one. */
  usd: number | null;
  pricedRows: number;
  /** Models with reported tokens and no entry in the list: left out, never guessed. */
  unpricedModelIds: readonly string[];
}>;

export function summarizeUsageCost(
  rows: readonly (Pick<ModelUsageAggregate, 'tokens' | 'exactTurnCount' | 'partialTurnCount'> & {
    resolvedModelId: string;
  })[],
  models: Readonly<Record<string, ModelPrice>>,
): UsageCostSummary {
  let usd = 0,
    pricedRows = 0;
  const unpriced = new Set<string>();
  for (const row of rows) {
    if (row.exactTurnCount + row.partialTurnCount === 0) continue;
    const key = modelPriceKey(row.resolvedModelId, models);
    const cost = key ? estimateUsageCostUsd(row, models[key]!) : null;
    if (cost === null) unpriced.add(row.resolvedModelId);
    else {
      usd += cost;
      pricedRows++;
    }
  }
  return { usd: pricedRows ? usd : null, pricedRows, unpricedModelIds: [...unpriced].sort() };
}
