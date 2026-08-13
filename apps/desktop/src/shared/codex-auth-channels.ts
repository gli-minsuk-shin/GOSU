import { z } from 'zod';

export const CODEX_AUTH_IPC_CHANNELS = Object.freeze({
  event: 'gosu:codex:authentication-event',
});

export const CodexAuthenticationEventSchema = z
  .object({
    type: z.literal('login.completed'),
    success: z.boolean(),
  })
  .strict();

export type CodexAuthenticationEvent = z.infer<typeof CodexAuthenticationEventSchema>;
