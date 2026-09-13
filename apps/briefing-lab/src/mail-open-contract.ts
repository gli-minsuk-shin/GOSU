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
