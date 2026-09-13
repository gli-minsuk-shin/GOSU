import { z } from 'zod';
import { ContextUsageSchema } from './context-usage';

export const ConversationMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().max(64000),
    createdAt: z.string().datetime(),
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
