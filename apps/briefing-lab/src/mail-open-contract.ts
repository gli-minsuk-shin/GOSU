import { z } from 'zod';
export const MailNativeIdSchema = z
  .string()
  .regex(/^\d{1,16}$/)
  .refine((value) => Number.isSafeInteger(Number(value)));
const identity = { routineId: z.string().min(1).max(128), itemId: z.string().min(1).max(160) };
// The browser identifies a displayed source; it cannot supply a URL, app, command or policy.
export const MailOpenRequestSchema = z.union([
  z.object({ ...identity, receiptId: z.string().uuid() }).strict(),
  z.object({ ...identity, historyId: z.string().min(1).max(128) }).strict(),
]);
export type MailOpenTarget = z.infer<typeof MailOpenRequestSchema>;
/** "모두 읽음" of one saved briefing: the mails are named by their saved history and item ids only. */
export const MailMarkAllRequestSchema = z
  .object({
    routineId: identity.routineId,
    items: z
      .array(z.object({ historyId: z.string().min(1).max(128), itemId: identity.itemId }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export type MailMarkAllRequest = z.infer<typeof MailMarkAllRequestSchema>;
