import { z } from 'zod';

export const OverleafPersonalTokenCommandSchema = z.object({}).strict();
export type OverleafPersonalTokenCommand = z.infer<typeof OverleafPersonalTokenCommandSchema>;

export const SaveOverleafPersonalTokenInputSchema = z
  .object({
    accessToken: z.string().min(1).max(2_048),
  })
  .strict();
export type SaveOverleafPersonalTokenInput = z.infer<typeof SaveOverleafPersonalTokenInputSchema>;

/** Safe renderer-facing state. Secret material and credential references never cross IPC. */
export const OverleafPersonalTokenStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    state: z.enum(['configured', 'not_configured', 'unavailable']),
  })
  .strict();
export type OverleafPersonalTokenStatus = z.infer<typeof OverleafPersonalTokenStatusSchema>;
