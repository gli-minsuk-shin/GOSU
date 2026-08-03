import { z } from 'zod';

import { WORKSPACE_TASK_STATUSES } from './workspace-contracts';

export const PROJECT_CHAT_MAX_MESSAGE_LENGTH = 12_000;
export const PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH = 32_000;

const timestampSchema = z.string().datetime({ offset: true });
const uuidSchema = z.string().uuid();
const taskStatusSchema = z.enum(WORKSPACE_TASK_STATUSES);

export const ProjectChatActionCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('task.create'),
      title: z.string().trim().min(2).max(240),
      status: taskStatusSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('task.update'),
      taskId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      title: z.string().trim().min(2).max(240).optional(),
      status: taskStatusSchema.optional(),
    })
    .strict()
    .refine((command) => command.title !== undefined || command.status !== undefined, {
      message: 'At least one task field must change',
    }),
]);

export type ProjectChatActionCommand = z.infer<typeof ProjectChatActionCommandSchema>;

export const PROJECT_CHAT_ACTION_STATUSES = ['proposed', 'applying', 'applied', 'failed'] as const;

export const ProjectChatActionSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    messageId: uuidSchema,
    command: ProjectChatActionCommandSchema,
    status: z.enum(PROJECT_CHAT_ACTION_STATUSES),
    resultEntityId: uuidSchema.optional(),
    resultEntityVersion: z.number().int().positive().optional(),
    errorCode: z
      .enum([
        'version_conflict',
        'task_not_found',
        'cross_project_access_denied',
        'application_interrupted',
        'action_failed',
      ])
      .optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type ProjectChatAction = z.infer<typeof ProjectChatActionSchema>;

export const ProjectChatModelProvenanceSchema = z
  .object({
    invocationId: uuidSchema,
    requestedModelId: z.string().trim().min(1).max(256).nullable(),
    resolvedModelId: z.string().trim().min(1).max(256),
    catalogVersion: z.string().trim().min(1).max(128),
    reasoningOptionId: z.string().trim().min(1).max(128).nullable(),
  })
  .strict();

export type ProjectChatModelProvenance = z.infer<typeof ProjectChatModelProvenanceSchema>;

export const ProjectChatMessageSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH),
    status: z.enum(['complete', 'failed', 'interrupted']),
    turnId: z.string().trim().min(1).max(256).optional(),
    model: ProjectChatModelProvenanceSchema.optional(),
    actions: z.array(ProjectChatActionSchema).max(8),
    createdAt: timestampSchema,
    completedAt: timestampSchema,
  })
  .strict()
  .superRefine((message, context) => {
    for (const [index, action] of message.actions.entries()) {
      if (action.messageId !== message.id) {
        context.addIssue({
          code: 'custom',
          message: 'Chat action references another message',
          path: ['actions', index, 'messageId'],
        });
      }
      if (action.projectId !== message.projectId) {
        context.addIssue({
          code: 'custom',
          message: 'Chat action references another project',
          path: ['actions', index, 'projectId'],
        });
      }
    }
  });

export type ProjectChatMessage = z.infer<typeof ProjectChatMessageSchema>;

export const ProjectChatSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    activeTurnId: z.string().trim().min(1).max(256).optional(),
    messages: z.array(ProjectChatMessageSchema).max(250),
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const [index, message] of snapshot.messages.entries()) {
      if (message.projectId !== snapshot.projectId) {
        context.addIssue({
          code: 'custom',
          message: 'Chat message references another project',
          path: ['messages', index, 'projectId'],
        });
      }
    }
  });

export type ProjectChatSnapshot = z.infer<typeof ProjectChatSnapshotSchema>;

export const SendProjectChatMessageInputSchema = z
  .object({
    projectId: uuidSchema,
    message: z.string().trim().min(1).max(PROJECT_CHAT_MAX_MESSAGE_LENGTH),
    requestedModelId: z.string().trim().min(1).max(256).nullable(),
    reasoningOptionId: z.string().trim().min(1).max(128).nullable(),
  })
  .strict();

export const ProjectChatProjectInputSchema = z.object({ projectId: uuidSchema }).strict();

export const ApplyProjectChatActionInputSchema = z
  .object({ projectId: uuidSchema, actionId: uuidSchema })
  .strict();

export type SendProjectChatMessageInput = z.infer<typeof SendProjectChatMessageInputSchema>;
export type ProjectChatProjectInput = z.infer<typeof ProjectChatProjectInputSchema>;
export type ApplyProjectChatActionInput = z.infer<typeof ApplyProjectChatActionInputSchema>;

export const ProjectChatTurnReceiptSchema = z
  .object({
    projectId: uuidSchema,
    userMessageId: uuidSchema,
    turnId: z.string().trim().min(1).max(256),
  })
  .strict();

export type ProjectChatTurnReceipt = z.infer<typeof ProjectChatTurnReceiptSchema>;

export const ProjectChatEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('turn.started'),
      projectId: uuidSchema,
      turnId: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      type: z.literal('turn.completed'),
      projectId: uuidSchema,
      turnId: z.string().trim().min(1).max(256),
      status: z.enum(['complete', 'failed', 'interrupted']),
    })
    .strict(),
  z
    .object({
      type: z.literal('action.updated'),
      projectId: uuidSchema,
      action: ProjectChatActionSchema,
      workspaceChanged: z.boolean(),
    })
    .strict(),
]);

export type ProjectChatEvent = z.infer<typeof ProjectChatEventSchema>;

export const CodexProjectResponseSchema = z
  .object({
    reply: z.string().trim().min(1).max(PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH),
    actions: z.array(ProjectChatActionCommandSchema).max(8),
  })
  .strict();

export type CodexProjectResponse = z.infer<typeof CodexProjectResponseSchema>;

export const PROJECT_CHAT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: {
      type: 'string',
      minLength: 1,
      maxLength: PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH,
      description: 'Natural-language reply shown to the user.',
    },
    actions: {
      type: 'array',
      maxItems: 8,
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['task.create'] },
              title: { type: 'string', minLength: 2, maxLength: 240 },
              status: { type: 'string', enum: [...WORKSPACE_TASK_STATUSES] },
            },
            required: ['type', 'title', 'status'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['task.update'] },
              taskId: { type: 'string', minLength: 36, maxLength: 36 },
              expectedVersion: { type: 'integer', minimum: 1 },
              status: { type: 'string', enum: [...WORKSPACE_TASK_STATUSES] },
            },
            required: ['type', 'taskId', 'expectedVersion', 'status'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['task.update'] },
              taskId: { type: 'string', minLength: 36, maxLength: 36 },
              expectedVersion: { type: 'integer', minimum: 1 },
              title: { type: 'string', minLength: 2, maxLength: 240 },
            },
            required: ['type', 'taskId', 'expectedVersion', 'title'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['task.update'] },
              taskId: { type: 'string', minLength: 36, maxLength: 36 },
              expectedVersion: { type: 'integer', minimum: 1 },
              title: { type: 'string', minLength: 2, maxLength: 240 },
              status: { type: 'string', enum: [...WORKSPACE_TASK_STATUSES] },
            },
            required: ['type', 'taskId', 'expectedVersion', 'title', 'status'],
          },
        ],
      },
    },
  },
  required: ['reply', 'actions'],
} as const;
