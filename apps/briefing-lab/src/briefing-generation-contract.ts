import { z } from 'zod';
export const BriefingIntervalSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(6),
  z.literal(12),
  z.literal(24),
]);
export const GenerationRequestSchema = z.object({ routineId: z.string().min(1).max(128) }).strict();
export const GenerationScheduleRequestSchema = GenerationRequestSchema.extend({
  intervalHours: BriefingIntervalSchema,
}).strict();
export const GenerationStatusSchema = z.object({
  id: z.string().uuid(),
  routineId: z.string(),
  runId: z.string().uuid().nullable(),
  state: z.enum(['running', 'complete', 'failed', 'cancelled', 'interrupted']),
  detail: z.string().max(1000),
  newCount: z.number().int().nonnegative(),
  discoveredEmails: z.number().int().nonnegative().optional(),
  emailSourceState: z.enum(['ready', 'empty', 'failed', 'disabled']).optional(),
  todoCount: z.number().int().nonnegative().optional(),
  addedSummaries: z
    .object({ email: z.number().int().nonnegative(), papers: z.number().int().nonnegative() })
    .optional(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().max(1000).nullable(),
  progress: z
    .object({
      stage: z.enum(['collect', 'calendar', 'summarize', 'finalize']),
      completed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative().nullable(),
    })
    .optional(),
});
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;
export type GenerationView = {
  intervalHours: number;
  nextDueAt: string | null;
  scheduleError: string | null;
  job: GenerationStatus | null;
};
export function briefingLocalDay(at: string | number, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}
