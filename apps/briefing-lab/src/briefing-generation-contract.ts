import { z } from 'zod';
import { BriefingScheduleSchema } from '@gosu/briefing-core';
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
  /** The routine's own delivery times, so the briefing also runs at those clock times. */
  routineSchedule: BriefingScheduleSchema.nullable().optional(),
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
  // AI summary batches that failed while the run continued; their reasons are in `error`.
  summaryFailures: z.number().int().nonnegative().optional(),
  // Mailbox intervals this run could not examine (or that aged out); reasons are in `error`.
  mailCoverageGaps: z.number().int().nonnegative().optional(),
  // When the metadata-only first briefing was saved, so the history view reloads right away.
  quickBriefingAt: z.string().datetime().optional(),
  // Mail could not be read through its index and the slow scripted query ran; the reason is in `error`.
  mailIndexFallback: z.boolean().optional(),
  // Items whose summary failed validation after one correction while the rest of the batch was saved.
  summaryRejectedItems: z.number().int().nonnegative().optional(),
  quickBriefingState: z.enum(['running', 'saved', 'failed']).optional(),
  summaryKinds: z
    .array(
      z.object({
        kind: z.enum(['email', 'papers']),
        total: z.number().int().nonnegative(),
        saved: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        running: z.array(z.string().max(40)).max(12),
        state: z.enum(['waiting', 'running', 'done']),
      }),
    )
    .max(2)
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
export type BriefingRoutineSchedule = z.infer<typeof BriefingScheduleSchema>;
/** The same schedule as the saved routine holds it, with its arrays read-only. */
export type BriefingRoutineScheduleView = Readonly<{
  frequency: BriefingRoutineSchedule['frequency'];
  interval: number;
  anchorDate: string;
  timeZone: string;
  times: readonly string[];
  weekdays: readonly number[];
  monthDay: number;
}>;
export type GenerationView = {
  intervalHours: number;
  /** The saved routine schedule when its delivery times run the briefing, else null. */
  routineSchedule: BriefingRoutineSchedule | null;
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
