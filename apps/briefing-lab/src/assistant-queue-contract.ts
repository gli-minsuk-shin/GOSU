import { z } from 'zod';
import { ProjectChatAttachmentIdsSchema } from '../../desktop/src/shared/project-chat-attachment-contracts';
import { PaperChatReferenceSchema } from './paper-chat-reference';
export const AssistantQueuedMessageSchema = z
  .object({
    id: z.string().uuid(),
    routineId: z.string().max(128),
    owner: z.string(),
    scope: z.string(),
    prompt: z.string().trim().min(1).max(6000),
    attachmentIds: ProjectChatAttachmentIdsSchema,
    paperReference: PaperChatReferenceSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    state: z.enum(['queued', 'claimed', 'failed']),
    token: z.string().uuid().optional(),
    error: z.string().max(300).optional(),
  })
  .strict();
export type AssistantQueuedMessage = z.infer<typeof AssistantQueuedMessageSchema>;
export type AssistantQueueState = {
  items: AssistantQueuedMessage[];
  active: boolean;
  canSteer: boolean;
  canAttach: boolean;
};
