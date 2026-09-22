import { z } from 'zod';
import { ContextUsageSchema } from './context-usage';

export const ConversationMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().max(64000),
    createdAt: z.string().datetime(),
    /** 논문 요약 holds one conversation for the page, so which paper a turn was about is carried by
     *  the turn rather than by the thread it lives in. Absent on the AI 비서's turns and on turns
     *  asked with no paper attached. */
    paperKey: z.string().max(512).optional(),
    hasOtherPendingActions: z.boolean().optional(),
    contextUsage: ContextUsageSchema.optional(),
    invocation: z
      .object({
        providerId: z.string().max(128),
        model: z.string().max(256),
        reasoning: z.string().max(128).nullable(),
      })
      .optional(),
  })
  .strict();
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
