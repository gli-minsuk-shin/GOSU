import { z } from 'zod';

import { ProjectChatPdfAttachmentIdsSchema } from './project-chat-attachment-contracts';
import { WORKSPACE_TASK_STATUSES } from './workspace-contracts';

export const PROJECT_CHAT_MAX_MESSAGE_LENGTH = 12_000;
export const PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH = 32_000;
export const PROJECT_CHAT_MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4_000;
export const PROJECT_CHAT_MAX_SESSIONS_PER_PROJECT = 100;
export const PROJECT_CHAT_MAX_SESSION_TITLE_LENGTH = 120;
export const PROJECT_CHAT_MAX_BRANCH_DEPTH = 32;
export const PROJECT_CHAT_MAX_BRANCH_MESSAGES = 5_000;

export const PROJECT_CHAT_HARNESS_MODES = ['context', 'planner', 'reviewer'] as const;
export const PROJECT_CHAT_RESPONSE_DEPTHS = ['concise', 'standard', 'deep'] as const;
export const PROJECT_CHAT_CONTEXT_SCOPES = ['project', 'board', 'objective'] as const;
export const PROJECT_CHAT_PERSONALITIES = ['auto', 'none', 'friendly', 'pragmatic'] as const;
export const PROJECT_CHAT_RESPONSE_VERBOSITIES = ['auto', 'low', 'medium', 'high'] as const;
export const PROJECT_CHAT_WEB_SEARCH_MODES = ['disabled', 'cached', 'live'] as const;
export const PROJECT_CHAT_NATIVE_EXECUTION_KINDS = ['default', 'plan', 'legacy-reviewer'] as const;

const timestampSchema = z.string().datetime({ offset: true });
const uuidSchema = z.string().uuid();
const taskStatusSchema = z.enum(WORKSPACE_TASK_STATUSES);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const harnessModeSchema = z.enum(PROJECT_CHAT_HARNESS_MODES);
const responseDepthSchema = z.enum(PROJECT_CHAT_RESPONSE_DEPTHS);
const contextScopeSchema = z.enum(PROJECT_CHAT_CONTEXT_SCOPES);
const personalitySchema = z.enum(PROJECT_CHAT_PERSONALITIES);
const responseVerbositySchema = z.enum(PROJECT_CHAT_RESPONSE_VERBOSITIES);
const webSearchModeSchema = z.enum(PROJECT_CHAT_WEB_SEARCH_MODES);
const nativeExecutionKindSchema = z.enum(PROJECT_CHAT_NATIVE_EXECUTION_KINDS);
const opaqueCollaborationModeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim().length > 0, 'Collaboration mode ID cannot be blank');

export const CodexCollaborationModeDescriptorSchema = z
  .object({
    id: opaqueCollaborationModeIdSchema,
    displayName: z.string().trim().min(1).max(256),
    recommendedModelId: z.string().trim().min(1).max(256).nullable(),
    recommendedReasoningOptionId: z.string().trim().min(1).max(128).nullable(),
  })
  .strict();

export type CodexCollaborationModeDescriptor = z.infer<
  typeof CodexCollaborationModeDescriptorSchema
>;

export const CodexCollaborationModeCatalogSchema = z
  .object({
    catalogVersion: z.string().trim().min(1).max(128),
    modes: z.array(CodexCollaborationModeDescriptorSchema).max(64),
  })
  .strict()
  .superRefine((catalog, context) => {
    const seen = new Set<string>();
    for (const [index, mode] of catalog.modes.entries()) {
      if (seen.has(mode.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Collaboration mode IDs must be unique',
          path: ['modes', index, 'id'],
        });
      }
      seen.add(mode.id);
    }
  });

export type CodexCollaborationModeCatalog = z.infer<typeof CodexCollaborationModeCatalogSchema>;

export function legacyHarnessToCollaborationModeId(harnessMode: ProjectChatHarnessMode): string {
  return harnessMode === 'planner' ? 'plan' : 'default';
}

export function legacyDepthToResponseVerbosity(
  responseDepth: ProjectChatResponseDepth,
): Exclude<ProjectChatResponseVerbosity, 'auto'> {
  if (responseDepth === 'concise') return 'low';
  if (responseDepth === 'deep') return 'high';
  return 'medium';
}

export const LocalNotesVaultGrantSchema = z
  .object({
    id: sha256Schema,
    name: z.string().trim().min(1).max(256),
  })
  .strict();

export type LocalNotesVaultGrant = z.infer<typeof LocalNotesVaultGrantSchema>;

export const ProjectChatInstructionRevisionSchema = z
  .object({
    id: uuidSchema,
    revision: z.number().int().positive(),
    contentSha256: sha256Schema,
    createdAt: timestampSchema,
  })
  .strict();

export type ProjectChatInstructionRevision = z.infer<typeof ProjectChatInstructionRevisionSchema>;

const ProjectChatProfileWireSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    version: z.number().int().nonnegative(),
    harnessMode: harnessModeSchema,
    responseDepth: responseDepthSchema,
    // Optional at the wire boundary so v0.6 profiles can be upgraded without data loss.
    collaborationModeId: opaqueCollaborationModeIdSchema.nullable().optional(),
    personality: personalitySchema.optional(),
    responseVerbosity: responseVerbositySchema.optional(),
    // Optional at the wire boundary so legacy profiles inherit the safer cached-search default.
    webSearchMode: webSearchModeSchema.optional(),
    contextScope: contextScopeSchema,
    // Optional at the wire boundary so profiles created by older desktop builds remain readable.
    localNotesVault: LocalNotesVaultGrantSchema.nullable().optional(),
    customInstructions: z.string().max(PROJECT_CHAT_MAX_CUSTOM_INSTRUCTIONS_LENGTH),
    instructionRevision: ProjectChatInstructionRevisionSchema.nullable(),
    updatedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.version === 0 && profile.instructionRevision !== null) {
      context.addIssue({
        code: 'custom',
        message: 'An unsaved chat profile cannot reference an instruction revision',
        path: ['instructionRevision'],
      });
    }
    if (
      profile.version > 0 &&
      (profile.instructionRevision === null ||
        profile.instructionRevision.revision !== profile.version)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The instruction revision must match the chat profile version',
        path: ['instructionRevision'],
      });
    }
  });

export const ProjectChatProfileSchema = ProjectChatProfileWireSchema.transform((profile) => ({
  ...profile,
  collaborationModeId:
    profile.collaborationModeId === undefined
      ? legacyHarnessToCollaborationModeId(profile.harnessMode)
      : profile.collaborationModeId,
  personality: profile.personality ?? 'auto',
  responseVerbosity:
    profile.responseVerbosity ?? legacyDepthToResponseVerbosity(profile.responseDepth),
  webSearchMode: profile.webSearchMode ?? 'cached',
}));

export type ProjectChatProfile = z.infer<typeof ProjectChatProfileSchema>;
export type ProjectChatHarnessMode = z.infer<typeof harnessModeSchema>;
export type ProjectChatResponseDepth = z.infer<typeof responseDepthSchema>;
export type ProjectChatContextScope = z.infer<typeof contextScopeSchema>;
export type ProjectChatPersonality = z.infer<typeof personalitySchema>;
export type ProjectChatResponseVerbosity = z.infer<typeof responseVerbositySchema>;
export type ProjectChatWebSearchMode = z.infer<typeof webSearchModeSchema>;
export type ProjectChatNativeExecutionKind = z.infer<typeof nativeExecutionKindSchema>;

export function defaultProjectChatProfile(projectId: string): ProjectChatProfile {
  return ProjectChatProfileSchema.parse({
    schemaVersion: 1,
    projectId,
    version: 0,
    harnessMode: 'context',
    responseDepth: 'standard',
    collaborationModeId: null,
    personality: 'auto',
    responseVerbosity: 'auto',
    webSearchMode: 'cached',
    contextScope: 'project',
    localNotesVault: null,
    customInstructions: '',
    instructionRevision: null,
    updatedAt: null,
  });
}

export const UpdateProjectChatProfileInputSchema = z
  .object({
    projectId: uuidSchema,
    expectedVersion: z.number().int().nonnegative(),
    harnessMode: harnessModeSchema,
    responseDepth: responseDepthSchema,
    // Optional for compatibility with v0.6 renderer payloads. Parsing always resolves values.
    collaborationModeId: opaqueCollaborationModeIdSchema.nullable().optional(),
    personality: personalitySchema.optional(),
    responseVerbosity: responseVerbositySchema.optional(),
    // Legacy clients omitted this field and therefore receive the cached-search default.
    webSearchMode: webSearchModeSchema.optional(),
    contextScope: contextScopeSchema,
    // Legacy clients omitted this field and therefore retain the safe no-access default.
    localNotesVault: LocalNotesVaultGrantSchema.nullable().optional(),
    customInstructions: z.string().max(PROJECT_CHAT_MAX_CUSTOM_INSTRUCTIONS_LENGTH),
  })
  .strict()
  .transform((profile) => ({
    ...profile,
    collaborationModeId:
      profile.collaborationModeId === undefined
        ? legacyHarnessToCollaborationModeId(profile.harnessMode)
        : profile.collaborationModeId,
    personality: profile.personality ?? 'auto',
    responseVerbosity:
      profile.responseVerbosity ?? legacyDepthToResponseVerbosity(profile.responseDepth),
    webSearchMode: profile.webSearchMode ?? 'cached',
  }));

export type UpdateProjectChatProfileInput = z.input<typeof UpdateProjectChatProfileInputSchema>;

const ProjectChatPromptProvenanceV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    assemblyVersion: z.literal(1),
    baseInstructionId: z.string().trim().min(1).max(128),
    baseInstructionVersion: z.number().int().positive(),
    baseInstructionsSha256: sha256Schema,
    harnessInstructionId: z.string().trim().min(1).max(128),
    harnessInstructionVersion: z.number().int().positive(),
    harnessInstructionsSha256: sha256Schema,
    customInstructionsSha256: sha256Schema,
    developerInstructionsSha256: sha256Schema,
    promptSha256: sha256Schema,
    projectContextSha256: sha256Schema,
    visibleHistorySha256: sha256Schema,
    userMessageSha256: sha256Schema,
    profileVersion: z.number().int().nonnegative(),
    instructionRevisionId: uuidSchema.nullable(),
    workspaceRevision: z.number().int().nonnegative(),
    developerInstructionsCharacters: z.number().int().nonnegative(),
    promptCharacters: z.number().int().positive(),
    contextTruncated: z.boolean(),
    historyTruncated: z.boolean(),
  })
  .strict();

const ProjectChatPromptProvenanceV2Schema = ProjectChatPromptProvenanceV1Schema.omit({
  assemblyVersion: true,
})
  .extend({
    assemblyVersion: z.literal(2),
    toolCatalogSha256: sha256Schema,
    localNotesVaultId: sha256Schema.nullable(),
  })
  .strict();

const ProjectChatPromptProvenanceV3Schema = ProjectChatPromptProvenanceV2Schema.omit({
  assemblyVersion: true,
})
  .extend({
    assemblyVersion: z.literal(3),
    requestedLegacyHarnessMode: harnessModeSchema,
    nativeCollaborationModeId: opaqueCollaborationModeIdSchema.nullable(),
    nativeExecutionKind: nativeExecutionKindSchema,
    nativeCollaborationCatalogSha256: sha256Schema,
    nativePersonality: personalitySchema,
    nativeResponseVerbosity: responseVerbositySchema,
    effectiveReasoningOptionId: z.string().trim().min(1).max(128).nullable(),
  })
  .strict();

export const ProjectChatPromptProvenanceSchema = z.discriminatedUnion('assemblyVersion', [
  ProjectChatPromptProvenanceV1Schema,
  ProjectChatPromptProvenanceV2Schema,
  ProjectChatPromptProvenanceV3Schema,
]);

export type ProjectChatPromptProvenance = z.infer<typeof ProjectChatPromptProvenanceSchema>;

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

export const ProjectChatSessionSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    title: z.string().trim().min(1).max(PROJECT_CHAT_MAX_SESSION_TITLE_LENGTH),
    isDefault: z.boolean(),
    parentSessionId: uuidSchema.optional(),
    branchedFromMessageId: uuidSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .refine(
    (session) =>
      (session.parentSessionId === undefined) === (session.branchedFromMessageId === undefined),
    {
      message: 'A branched chat session must identify both its parent and branch message',
      path: ['parentSessionId'],
    },
  )
  .refine((session) => !session.isDefault || session.parentSessionId === undefined, {
    message: 'The default chat session must be a root session',
    path: ['isDefault'],
  })
  .refine((session) => session.parentSessionId !== session.id, {
    message: 'A chat session cannot branch from itself',
    path: ['parentSessionId'],
  });

export type ProjectChatSession = z.infer<typeof ProjectChatSessionSchema>;

export const PROJECT_CHAT_ATTEMPT_STATUSES = [
  'starting',
  'running',
  'complete',
  'failed',
  'interrupted',
] as const;

export const PROJECT_CHAT_ATTEMPT_ERROR_CODES = [
  'codex_unavailable',
  'invalid_response',
  'application_interrupted',
  'user_interrupted',
] as const;

export const ProjectChatAttemptSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    // Optional at the wire boundary so pre-session durable attempts remain migratable.
    sessionId: uuidSchema.optional(),
    userMessageId: uuidSchema,
    retryOfAttemptId: uuidSchema.optional(),
    threadId: z.string().trim().min(1).max(256).optional(),
    turnId: z.string().trim().min(1).max(256).optional(),
    model: ProjectChatModelProvenanceSchema.optional(),
    requestedModelId: z.string().trim().min(1).max(256).nullable(),
    reasoningOptionId: z.string().trim().min(1).max(128).nullable(),
    // Optional so durable attempts written before harness profiles remain readable.
    harnessMode: harnessModeSchema.optional(),
    responseDepth: responseDepthSchema.optional(),
    collaborationModeId: opaqueCollaborationModeIdSchema.nullable().optional(),
    personality: personalitySchema.optional(),
    responseVerbosity: responseVerbositySchema.optional(),
    // Optional so attempts written before per-project web search modes remain readable.
    webSearchMode: webSearchModeSchema.optional(),
    contextScope: contextScopeSchema.optional(),
    profileVersion: z.number().int().nonnegative().optional(),
    instructionRevisionId: uuidSchema.nullable().optional(),
    promptProvenance: ProjectChatPromptProvenanceSchema.optional(),
    status: z.enum(PROJECT_CHAT_ATTEMPT_STATUSES),
    errorCode: z.enum(PROJECT_CHAT_ATTEMPT_ERROR_CODES).optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .refine((attempt) => attempt.retryOfAttemptId !== attempt.id, {
    message: 'A chat attempt cannot retry itself',
    path: ['retryOfAttemptId'],
  });

export type ProjectChatAttempt = z.infer<typeof ProjectChatAttemptSchema>;

export const ProjectChatMessageSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH),
    status: z.enum(['complete', 'failed', 'interrupted']),
    attemptId: uuidSchema.optional(),
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
    // Optional at the wire boundary for compatibility with snapshots produced before sessions.
    session: ProjectChatSessionSchema.optional(),
    sessions: z
      .array(ProjectChatSessionSchema)
      .min(1)
      .max(PROJECT_CHAT_MAX_SESSIONS_PER_PROJECT)
      .optional(),
    activeTurnId: z.string().trim().min(1).max(256).optional(),
    messages: z.array(ProjectChatMessageSchema).max(250),
    // Optional at the wire boundary so legacy snapshots remain readable. Current service snapshots
    // always include the effective profile, including a version-zero default.
    profile: ProjectChatProfileSchema.optional(),
    // Optional at the wire boundary so snapshots written before durable attempts remain readable.
    // Current storage always returns an array.
    attempts: z.array(ProjectChatAttemptSchema).max(500).optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.profile && snapshot.profile.projectId !== snapshot.projectId) {
      context.addIssue({
        code: 'custom',
        message: 'Chat profile references another project',
        path: ['profile', 'projectId'],
      });
    }
    if (snapshot.session && snapshot.session.projectId !== snapshot.projectId) {
      context.addIssue({
        code: 'custom',
        message: 'Chat session references another project',
        path: ['session', 'projectId'],
      });
    }
    for (const [index, session] of (snapshot.sessions ?? []).entries()) {
      if (session.projectId !== snapshot.projectId) {
        context.addIssue({
          code: 'custom',
          message: 'Chat session catalog references another project',
          path: ['sessions', index, 'projectId'],
        });
      }
    }
    if (snapshot.sessions) {
      const sessionIds = new Set<string>();
      for (const [index, session] of snapshot.sessions.entries()) {
        if (sessionIds.has(session.id)) {
          context.addIssue({
            code: 'custom',
            message: 'Chat session IDs must be unique',
            path: ['sessions', index, 'id'],
          });
        }
        sessionIds.add(session.id);
      }
      if (snapshot.sessions.filter((session) => session.isDefault).length !== 1) {
        context.addIssue({
          code: 'custom',
          message: 'A chat session catalog must contain exactly one default session',
          path: ['sessions'],
        });
      }
      if (snapshot.session && !sessionIds.has(snapshot.session.id)) {
        context.addIssue({
          code: 'custom',
          message: 'The selected chat session must be present in its catalog',
          path: ['session', 'id'],
        });
      }
      for (const [index, attempt] of (snapshot.attempts ?? []).entries()) {
        if (attempt.sessionId && !sessionIds.has(attempt.sessionId)) {
          context.addIssue({
            code: 'custom',
            message: 'Chat attempt origin must be present in the session catalog',
            path: ['attempts', index, 'sessionId'],
          });
        }
      }
    }
    for (const [index, message] of snapshot.messages.entries()) {
      if (message.projectId !== snapshot.projectId) {
        context.addIssue({
          code: 'custom',
          message: 'Chat message references another project',
          path: ['messages', index, 'projectId'],
        });
      }
    }
    for (const [index, attempt] of (snapshot.attempts ?? []).entries()) {
      if (attempt.projectId !== snapshot.projectId) {
        context.addIssue({
          code: 'custom',
          message: 'Chat attempt references another project',
          path: ['attempts', index, 'projectId'],
        });
      }
    }
  });

export type ProjectChatSnapshot = z.infer<typeof ProjectChatSnapshotSchema>;

export const SendProjectChatMessageInputSchema = z
  .object({
    projectId: uuidSchema,
    // Legacy callers omit this and are routed to the project's durable default session.
    sessionId: uuidSchema.optional(),
    message: z.string().trim().min(1).max(PROJECT_CHAT_MAX_MESSAGE_LENGTH),
    requestedModelId: z.string().trim().min(1).max(256).nullable(),
    reasoningOptionId: z.string().trim().min(1).max(128).nullable(),
    retryOfAttemptId: uuidSchema.optional(),
    harnessMode: harnessModeSchema.optional(),
    responseDepth: responseDepthSchema.optional(),
    collaborationModeId: opaqueCollaborationModeIdSchema.nullable().optional(),
    personality: personalitySchema.optional(),
    responseVerbosity: responseVerbositySchema.optional(),
    contextScope: contextScopeSchema.optional(),
    profileVersion: z.number().int().nonnegative().optional(),
    attachmentIds: ProjectChatPdfAttachmentIdsSchema.optional(),
  })
  .strict();

export const ProjectChatProjectInputSchema = z.object({ projectId: uuidSchema }).strict();

export const ProjectChatSnapshotInputSchema = z
  .object({ projectId: uuidSchema, sessionId: uuidSchema.optional() })
  .strict();

export const CreateProjectChatSessionInputSchema = z
  .object({
    projectId: uuidSchema,
    title: z.string().trim().min(1).max(PROJECT_CHAT_MAX_SESSION_TITLE_LENGTH).optional(),
  })
  .strict();

export const BranchProjectChatSessionInputSchema = z
  .object({
    projectId: uuidSchema,
    sourceSessionId: uuidSchema,
    branchFromMessageId: uuidSchema,
    title: z.string().trim().min(1).max(PROJECT_CHAT_MAX_SESSION_TITLE_LENGTH).optional(),
  })
  .strict();

export const RenameProjectChatSessionInputSchema = z
  .object({
    projectId: uuidSchema,
    sessionId: uuidSchema,
    title: z.string().trim().min(1).max(PROJECT_CHAT_MAX_SESSION_TITLE_LENGTH),
  })
  .strict();

export const ProjectChatSessionInputSchema = z
  .object({ projectId: uuidSchema, sessionId: uuidSchema.optional() })
  .strict();

export const ApplyProjectChatActionInputSchema = z
  .object({
    projectId: uuidSchema,
    // Legacy callers omit this and apply actions from the durable default session.
    sessionId: uuidSchema.optional(),
    actionId: uuidSchema,
  })
  .strict();

export type SendProjectChatMessageInput = z.infer<typeof SendProjectChatMessageInputSchema>;
export type ProjectChatProjectInput = z.infer<typeof ProjectChatProjectInputSchema>;
export type ProjectChatSnapshotInput = z.infer<typeof ProjectChatSnapshotInputSchema>;
export type CreateProjectChatSessionInput = z.infer<typeof CreateProjectChatSessionInputSchema>;
export type BranchProjectChatSessionInput = z.infer<typeof BranchProjectChatSessionInputSchema>;
export type RenameProjectChatSessionInput = z.infer<typeof RenameProjectChatSessionInputSchema>;
export type ProjectChatSessionInput = z.infer<typeof ProjectChatSessionInputSchema>;
export type ApplyProjectChatActionInput = z.infer<typeof ApplyProjectChatActionInputSchema>;

export const ProjectChatTurnReceiptSchema = z
  .object({
    projectId: uuidSchema,
    sessionId: uuidSchema,
    attemptId: uuidSchema,
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
      sessionId: uuidSchema,
      turnId: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      type: z.literal('turn.completed'),
      projectId: uuidSchema,
      sessionId: uuidSchema,
      turnId: z.string().trim().min(1).max(256),
      status: z.enum(['complete', 'failed', 'interrupted']),
    })
    .strict(),
  z
    .object({
      type: z.literal('action.updated'),
      projectId: uuidSchema,
      sessionId: uuidSchema,
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
