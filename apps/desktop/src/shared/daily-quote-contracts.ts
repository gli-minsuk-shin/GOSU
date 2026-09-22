import { z } from 'zod';

export const DAILY_QUOTE_CHANNELS = {
  get: 'gosu:daily-quote:get',
  refresh: 'gosu:daily-quote:refresh',
  history: 'gosu:daily-quote:history',
} as const;
export const DAILY_QUOTE_MAX_ENTRIES = 200;
/** Quotes a day may be asked for by hand. The eleventh press is refused, wittily. */
export const DAILY_QUOTE_REFRESH_LIMIT = 10;
export const DAILY_QUOTE_HISTORY_LIMIT = 60;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const languageSchema = z.enum(['ko', 'en']);
const failureSchema = z
  .string()
  .regex(/^[a-z_]{3,64}$/u)
  .nullable();

export const DailyQuoteEntrySchema = z
  .object({
    date: dateSchema,
    language: languageSchema,
    text: z.string().trim().min(1).max(200),
    author: z.string().trim().min(1).max(60).nullable(),
    tone: z.enum(['humor', 'wisdom']),
    /** `builtin` is the fallback line shown while, or because, the model did not write one. */
    source: z.enum(['model', 'builtin']),
    failure: failureSchema,
    attemptedAt: z.string().datetime().nullable(),
    /** When this line was written. Absent in files from before quotes could be refreshed. */
    createdAt: z.string().datetime().optional(),
    /** What the line is about, so the next one can take a subject the history has not used. */
    subject: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const DailyQuoteFileSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(DailyQuoteEntrySchema).max(DAILY_QUOTE_MAX_ENTRIES),
    /** Hand-asked quotes per local day; a failed attempt counts, so the model is not hammered. */
    refreshes: z
      .array(z.object({ date: dateSchema, count: z.number().int().min(0).max(1000) }).strict())
      .max(60)
      .optional(),
  })
  .strict();

/** What the title bar shows. `pending` means a model line is being written; ask again soon. */
export const DailyQuoteViewSchema = DailyQuoteEntrySchema.omit({ attemptedAt: true })
  .extend({
    pending: z.boolean(),
    /** Hand-asked quotes used today and the day's allowance; `capped` means the next press is refused. */
    refreshesUsed: z.number().int().min(0).max(1000),
    refreshLimit: z.number().int().min(0).max(1000),
    capped: z.boolean(),
  })
  .strict();

export const DailyQuoteHistoryEntrySchema = DailyQuoteEntrySchema.omit({
  attemptedAt: true,
  failure: true,
}).extend({ createdAt: z.string().datetime() });

export const DailyQuoteHistorySchema = z
  .object({ entries: z.array(DailyQuoteHistoryEntrySchema).max(DAILY_QUOTE_HISTORY_LIMIT) })
  .strict();

export type DailyQuoteEntry = z.infer<typeof DailyQuoteEntrySchema>;
export type DailyQuoteFile = z.infer<typeof DailyQuoteFileSchema>;
export type DailyQuoteView = z.infer<typeof DailyQuoteViewSchema>;
export type DailyQuoteHistoryEntry = z.infer<typeof DailyQuoteHistoryEntrySchema>;
export type DailyQuoteHistory = z.infer<typeof DailyQuoteHistorySchema>;
