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
  'lightweightTasks',
  'modelExtraction',
  'paperSummary',
  'paperChat',
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
const role = z.enum(['lightweight', 'fast', 'strong', 'existing']);
export const ModelRoutingSchema = z
  .object({
    version: z.literal(1),
    fast: RoutedModelSchema.nullable(),
    lightweight: RoutedModelSchema.nullable().optional(),
    strong: RoutedModelSchema.nullable(),
    usage: z
      .object({
        projectChat: role,
        briefing: role,
        briefingAssistant: role,
        lecture: role,
        lightweightTasks: role.optional(),
        modelExtraction: z.enum(['fast', 'strong', 'existing']).optional(),
        /** Absent means the paper summary AI follows Briefing, which is what it did before. */
        paperSummary: role.optional(),
        paperChat: role.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    for (const usage of [
      'lecture',
      'briefing',
      'briefingAssistant',
      'lightweightTasks',
      'modelExtraction',
      'paperSummary',
      'paperChat',
    ] as const) {
      const choice = usageChoice(policy, usage),
        model = choice === 'existing' ? null : policy[choice];
      // Lecture, Briefing and extraction run on Codex or Claude Code; Hermes is Project Chat only.
      if (model && model.providerId === 'hermes')
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
    lightweight: null,
    strong: null,
    usage: {
      projectChat: 'strong',
      briefing: 'fast',
      briefingAssistant: 'strong',
      lecture: 'strong',
      lightweightTasks: 'lightweight',
      modelExtraction: 'existing',
    },
  };
}
/**
 * The role a usage actually runs on. A usage the saved settings do not mention takes its default,
 * and the paper summary AI takes Briefing's role, which ran it before it had one of its own, so
 * adding the setting changes nothing until the user picks.
 */
export function usageChoice(
  policy: ModelRouting,
  usage: ModelUsage,
): 'lightweight' | 'fast' | 'strong' | 'existing' {
  const saved = policy.usage[usage];
  if (saved) return saved;
  if (usage === 'modelExtraction') return 'existing';
  // Two different jobs on one paper. Summarizing is a quick pass, so it follows Briefing, which is
  // where the user already tuned bulk summarizing. Analysis and the per-paper conversation follow the
  // assistant instead: that is the model they talk to, and the Briefing model may be the fastest one
  // they own for getting through mail.
  if (usage === 'paperSummary') return policy.usage.briefing;
  if (usage === 'paperChat') return policy.usage.briefingAssistant;
  return 'lightweight';
}
export function routedModel(policy: ModelRouting, usage: ModelUsage): RoutedModel | null {
  const choice = usageChoice(policy, usage);
  return choice === 'existing' ? null : (policy[choice] ?? null);
}
