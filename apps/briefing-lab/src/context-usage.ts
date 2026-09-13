import { z } from 'zod';
import type { ModelDescriptor } from '@gosu/contracts';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const NativeTokenUsageSchema = z.object({
  contextStale: z.boolean().optional(),
  inputTokens: count.nullable(),
  outputTokens: count.nullable(),
  cachedInputTokens: count.nullable(),
  reasoningTokens: count.nullable(),
  totalTokens: count.nullable(),
  contextTokens: count.nullable(),
  contextWindowTokens: count.positive().nullable(),
});
export type NativeTokenUsage = z.infer<typeof NativeTokenUsageSchema>;
export const ContextUsageSchema = z.object({
  contextConfigurationKey: z.string().max(128).optional(),
  requestedWindowTokens: count.positive().optional(),
  modelDefaultWindowTokens: count.positive().optional(),
  modelMaximumWindowTokens: count.positive().optional(),
  windowTokens: count.positive(),
  windowSource: z.enum(['provider', 'configured', 'fallback']),
  estimatedInputTokens: count,
  outputReserveTokens: count,
  toolReserveTokens: count,
  totalMessages: count,
  includedMessages: count,
  compressedMessages: count,
  omittedMessages: count,
  native: NativeTokenUsageSchema.optional(),
  maintenance: z
    .object({ calls: count, inputTokens: count.nullable(), outputTokens: count.nullable() })
    .optional(),
});
export type ContextUsage = z.infer<typeof ContextUsageSchema>;
export function contextCapacityMetadata(model: ModelDescriptor | undefined) {
  const metadata = model?.metadata;
  return {
    ...(typeof metadata?.contextConfigurationKey === 'string'
      ? { contextConfigurationKey: metadata.contextConfigurationKey }
      : {}),
    ...(typeof metadata?.requestedContextWindowTokens === 'number'
      ? { requestedWindowTokens: metadata.requestedContextWindowTokens }
      : {}),
    ...(typeof metadata?.defaultContextWindowTokens === 'number'
      ? { modelDefaultWindowTokens: metadata.defaultContextWindowTokens }
      : {}),
    ...(typeof metadata?.nativeContextWindowTokens === 'number'
      ? { modelMaximumWindowTokens: metadata.nativeContextWindowTokens }
      : {}),
  };
}
/** Ignore old execution telemetry after the model's context configuration changes. */
export function contextConfigurationMatches(
  model: ModelDescriptor | undefined,
  usage: ContextUsage | undefined,
) {
  const key = model?.metadata?.contextConfigurationKey;
  return typeof key !== 'string' || key === usage?.contextConfigurationKey;
}
export function contextRemaining(usage: ContextUsage) {
  const limit =
    usage.native?.contextWindowTokens ??
    (usage.windowSource === 'fallback' ? null : usage.windowTokens);
  const used = usage.native?.contextStale
    ? null
    : (usage.native?.contextTokens ?? usage.estimatedInputTokens);
  return {
    limit,
    used,
    remaining:
      limit === null || used === null
        ? null
        : Math.max(0, limit - used - usage.outputReserveTokens),
    reported: usage.native?.contextTokens !== null && usage.native?.contextTokens !== undefined,
  };
}
