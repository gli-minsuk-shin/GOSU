import type { NativeTokenUsage } from './src/context-usage';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function codexTokenUsage(raw: unknown): NativeTokenUsage | undefined {
  const usage = object(raw),
    total = object(usage.total),
    last = object(usage.last);
  const inputTokens = count(total.inputTokens),
    outputTokens = count(total.outputTokens);
  if (inputTokens === null || outputTokens === null) return undefined;
  const cachedInputTokens = count(total.cachedInputTokens);
  if (cachedInputTokens !== null && cachedInputTokens > inputTokens) return undefined;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens: count(total.reasoningOutputTokens),
    totalTokens: count(total.totalTokens),
    contextTokens: count(last.totalTokens),
    contextWindowTokens: count(usage.modelContextWindow) || null,
  };
}
export function claudeTokenUsage(raw: unknown, window?: unknown): NativeTokenUsage | undefined {
  const usage = object(raw);
  const inputTokens = count(usage.inputTokens),
    outputTokens = count(usage.outputTokens);
  if (inputTokens === null || outputTokens === null) return undefined;
  // Claude result usage is cumulative across tool rounds, NOT current context occupancy.
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: count(usage.cachedReadTokens),
    reasoningTokens: count(usage.reasoningOutputTokens),
    totalTokens: count(usage.totalTokens),
    contextTokens: null,
    contextWindowTokens: count(window) || null,
  };
}
