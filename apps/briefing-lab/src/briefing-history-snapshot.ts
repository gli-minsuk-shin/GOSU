import { z } from 'zod';
import { BriefingTodosSchema } from './briefing-todos';
import { EventDraftSchema } from './workspace-contracts';

const nullableNumber = z.number().finite().nullable();
export const BriefingSnapshotSchema = z.object({
  collectedAt: z.string().datetime(),
  routineName: z.string().max(160),
  timeZone: z.string().max(100),
  newItemsSince: z.string().datetime().optional(),
  daily: z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), updatedAt: z.string().datetime() })
    .optional(),
  calendarReferenceAt: z.string().datetime().optional(),
  todos: BriefingTodosSchema.optional(),
  todoError: z.string().max(1000).optional(),
  // Legacy discovery-only display hint. Accepted on read, never used to hide saved content.
  visiblePaperKeys: z.array(z.string().max(5000)).max(1000).optional(),
  weather: z
    .object({
      city: z.string().max(500),
      timeZone: z.string().max(100),
      localDate: z.string().max(30),
      currentTime: z.string().max(100),
      temperature: nullableNumber,
      code: nullableNumber,
      wind: nullableNumber,
      hours: z
        .array(
          z.object({
            time: z.number().finite(),
            temperature: nullableNumber,
            apparent: nullableNumber,
            precipitation: nullableNumber,
            code: nullableNumber,
          }),
        )
        .max(48),
    })
    .optional(),
  sources: z
    .array(
      z
        .object({
          kind: z.enum(['weather', 'papers', 'email']),
          status: z.enum(['ready', 'empty', 'failed']),
          count: z.number().int().nonnegative(),
          error: z.string().max(1000).optional(),
          notice: z.string().max(1200).optional(),
        })
        .strip(),
    )
    .max(3),
  calendar: z
    .array(
      z
        .object({
          title: EventDraftSchema.shape.title,
          id: z.string().min(1).max(300).optional(),
          start: EventDraftSchema.shape.start,
          end: EventDraftSchema.shape.end,
          timeZone: EventDraftSchema.shape.timeZone,
          allDay: EventDraftSchema.shape.allDay,
          location: EventDraftSchema.shape.location,
        })
        .refine((e) => Date.parse(e.end) > Date.parse(e.start), 'event_range_invalid'),
    )
    .max(500)
    .optional(),
});
export type BriefingSnapshot = z.infer<typeof BriefingSnapshotSchema>;
