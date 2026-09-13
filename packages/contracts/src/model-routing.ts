import { z } from 'zod';

export const MODEL_ROUTING_CHANNELS = {
  get: 'model-routing:get',
  set: 'model-routing:set',
} as const;
export const MODEL_ROUTING_USAGES = [
  'projectChat',
  'briefing',
  'briefingAssistant',
  'lecture',
] as const;
const opaque = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (v) =>
      v === v.trim() && [...v].every((c) => c.codePointAt(0)! > 31 && c.codePointAt(0) !== 127),
  );
export const RoutedModelSchema = z
  .object({
    providerId: z.enum(['codex', 'claude-code', 'hermes']),
    modelId: opaque,
    reasoningOptionId: opaque.nullable(),
  })
  .strict();
const role = z.enum(['fast', 'strong', 'existing']);
export const ModelRoutingSchema = z
  .object({
    version: z.literal(1),
    fast: RoutedModelSchema.nullable(),
    strong: RoutedModelSchema.nullable(),
    usage: z
      .object({ projectChat: role, briefing: role, briefingAssistant: role, lecture: role })
      .strict(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    for (const usage of ['lecture', 'briefing', 'briefingAssistant'] as const) {
      const choice = policy.usage[usage],
        model = choice === 'existing' ? null : policy[choice];
      if (
        model &&
        (usage === 'lecture' ? model.providerId !== 'codex' : model.providerId === 'hermes')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['usage', usage],
          message: 'model_routing_provider_unsupported',
        });
    }
  });
export type ModelRouting = z.infer<typeof ModelRoutingSchema>;
export type ModelUsage = (typeof MODEL_ROUTING_USAGES)[number];
export type RoutedModel = z.infer<typeof RoutedModelSchema>;
export function defaultModelRouting(): ModelRouting {
  return {
    version: 1,
    fast: null,
    strong: null,
    usage: {
      projectChat: 'strong',
      briefing: 'fast',
      briefingAssistant: 'strong',
      lecture: 'strong',
    },
  };
}
export function routedModel(policy: ModelRouting, usage: ModelUsage): RoutedModel | null {
  const choice = policy.usage[usage];
  return choice === 'existing' ? null : policy[choice];
}
