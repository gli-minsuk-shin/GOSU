import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CodexCollaborationModeCatalogSchema,
  CodexProjectResponseSchema,
  PROJECT_CHAT_OUTPUT_SCHEMA,
  BranchProjectChatSessionInputSchema,
  CreateProjectChatSessionInputSchema,
  ProjectChatAttemptSchema,
  ProjectChatMessageSchema,
  ProjectChatPromptProvenanceSchema,
  ProjectChatProfileSchema,
  ProjectChatQueuedTurnSchema,
  ProjectChatResearchNoteSaveReceiptSchema,
  ProjectChatResearchNoteSaveStageSchema,
  ProjectChatSessionSchema,
  ProjectChatSnapshotSchema,
  UpdateProjectChatProfileInputSchema,
  allowsAgentMarkdownCreate,
  defaultProjectChatProfile,
} from '../src/shared/project-chat-contracts';

describe('Project chat contracts', () => {
  it('keeps the Codex output schema within the pinned structured-output subset', () => {
    const serialized = JSON.stringify(PROJECT_CHAT_OUTPUT_SCHEMA);
    expect(serialized).toContain('anyOf');
    expect(serialized).not.toContain('oneOf');
    expect(serialized).not.toContain('allOf');
    expect(serialized).not.toContain('"format"');
  });

  it('parses supported create and update action responses', () => {
    const taskId = randomUUID();
    expect(
      CodexProjectResponseSchema.parse({
        reply: 'Review these changes.',
        researchNote: { disposition: 'none' },
        actions: [
          { type: 'task.create', title: 'Reproduce baseline', status: 'planned' },
          {
            type: 'task.update',
            taskId,
            expectedVersion: 2,
            title: 'Validate baseline',
            status: 'review',
          },
        ],
      }).actions,
    ).toHaveLength(2);
  });

  it('requires a bounded structured Research Notes disposition', () => {
    expect(
      CodexProjectResponseSchema.parse({
        reply: 'A durable plan is ready.',
        actions: [],
        researchNote: {
          disposition: 'save',
          category: 'project-progress',
          title: 'Evaluation decision',
          content: '# Evaluation decision\n',
        },
      }).researchNote,
    ).toMatchObject({ disposition: 'save', category: 'project-progress' });
    expect(() =>
      CodexProjectResponseSchema.parse({ reply: 'Missing disposition.', actions: [] }),
    ).toThrow();
    expect(() =>
      CodexProjectResponseSchema.parse({
        reply: 'Too large.',
        actions: [],
        researchNote: {
          disposition: 'save',
          category: 'project-progress',
          title: 'Oversized',
          content: 'x'.repeat(28_001),
        },
      }),
    ).toThrow();
    expect(PROJECT_CHAT_OUTPUT_SCHEMA.required).toContain('researchNote');
  });

  it('keeps staged Research Notes receipts body-free and validates committed paths', () => {
    const staged = ProjectChatResearchNoteSaveStageSchema.parse({
      schemaVersion: 1,
      projectId: randomUUID(),
      sessionId: randomUUID(),
      attemptId: randomUUID(),
      bindingId: 'a'.repeat(64),
      category: 'experiments',
      artifactId: 'b'.repeat(16),
      expectedContentSha256: 'c'.repeat(64),
      stagedAt: '2026-08-06T00:00:00.000Z',
    });
    expect(Object.keys(staged)).not.toEqual(
      expect.arrayContaining(['content', 'body', 'markdown', 'title']),
    );
    expect(
      ProjectChatResearchNoteSaveReceiptSchema.parse({
        ...staged,
        status: 'committed-unreported',
        relativePath: `Experiments/Plan--${staged.artifactId}.md`,
        updatedAt: '2026-08-06T00:00:01.000Z',
        committedAt: '2026-08-06T00:00:01.000Z',
        reportedAt: null,
      }).relativePath,
    ).toContain('Experiments/');
    expect(
      ProjectChatResearchNoteSaveReceiptSchema.parse({
        ...staged,
        status: 'abandoned',
        relativePath: null,
        updatedAt: '2026-08-06T00:00:02.000Z',
        committedAt: null,
        reportedAt: '2026-08-06T00:00:02.000Z',
      }).status,
    ).toBe('abandoned');
    expect(() =>
      ProjectChatResearchNoteSaveReceiptSchema.parse({
        ...staged,
        status: 'abandoned',
        relativePath: null,
        updatedAt: '2026-08-06T00:00:02.000Z',
        committedAt: null,
        reportedAt: null,
      }),
    ).toThrow();
    expect(() =>
      ProjectChatResearchNoteSaveReceiptSchema.parse({
        ...staged,
        status: 'committed-unreported',
        relativePath: `../Plan--${staged.artifactId}.md`,
        updatedAt: '2026-08-06T00:00:01.000Z',
        committedAt: '2026-08-06T00:00:01.000Z',
        reportedAt: null,
      }),
    ).toThrow();
  });

  it('rejects actions attached to another project or message', () => {
    const projectId = randomUUID();
    const messageId = randomUUID();
    const now = new Date().toISOString();
    expect(() =>
      ProjectChatMessageSchema.parse({
        id: messageId,
        projectId,
        role: 'assistant',
        content: 'Proposal',
        status: 'complete',
        actions: [
          {
            id: randomUUID(),
            projectId: randomUUID(),
            messageId: randomUUID(),
            command: { type: 'task.create', title: 'Cross project', status: 'backlog' },
            status: 'proposed',
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        completedAt: now,
      }),
    ).toThrow();
  });

  it('links durable attempts to messages and rejects cross-project snapshot entries', () => {
    const projectId = randomUUID();
    const attemptId = randomUUID();
    const userMessageId = randomUUID();
    const now = new Date().toISOString();
    const attempt = ProjectChatAttemptSchema.parse({
      id: attemptId,
      projectId,
      userMessageId,
      requestedModelId: null,
      reasoningOptionId: null,
      status: 'starting',
      createdAt: now,
      updatedAt: now,
    });
    const message = ProjectChatMessageSchema.parse({
      id: userMessageId,
      projectId,
      attemptId,
      role: 'user',
      content: 'Retry this without losing the first attempt.',
      status: 'complete',
      actions: [],
      createdAt: now,
      completedAt: now,
    });

    expect(
      ProjectChatSnapshotSchema.parse({
        schemaVersion: 1,
        projectId,
        attempts: [attempt],
        messages: [message],
      }).attempts,
    ).toEqual([attempt]);
    expect(() =>
      ProjectChatSnapshotSchema.parse({
        schemaVersion: 1,
        projectId,
        attempts: [{ ...attempt, projectId: randomUUID() }],
        messages: [message],
      }),
    ).toThrow();
  });

  it('keeps queued turns project/session scoped and bounded', () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const queued = ProjectChatQueuedTurnSchema.parse({
      id: randomUUID(),
      projectId,
      sessionId,
      message: '  Run this after the current turn  ',
      requestedModelId: null,
      reasoningOptionId: null,
      priority: 'normal',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    });
    expect(queued.message).toBe('Run this after the current turn');
    expect(() =>
      ProjectChatSnapshotSchema.parse({
        schemaVersion: 1,
        projectId,
        session: {
          id: sessionId,
          projectId,
          title: 'Project chat',
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        },
        queuedTurns: [{ ...queued, sessionId: randomUUID() }],
        messages: [],
      }),
    ).toThrow();
  });

  it('accepts the specific image-modality failure as durable attempt provenance', () => {
    const now = new Date().toISOString();
    expect(
      ProjectChatAttemptSchema.parse({
        id: randomUUID(),
        projectId: randomUUID(),
        userMessageId: randomUUID(),
        requestedModelId: 'text-only-model',
        reasoningOptionId: null,
        status: 'failed',
        errorCode: 'attachment_model_modality_unsupported',
        createdAt: now,
        updatedAt: now,
      }).errorCode,
    ).toBe('attachment_model_modality_unsupported');
  });

  it('keeps session catalogs strict, project-scoped, and compatible with legacy snapshots', () => {
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const now = new Date().toISOString();
    const root = ProjectChatSessionSchema.parse({
      id: randomUUID(),
      projectId,
      title: ' Project chat ',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    expect(root.title).toBe('Project chat');
    expect(
      ProjectChatSnapshotSchema.parse({
        schemaVersion: 1,
        projectId,
        session: root,
        sessions: [root],
        messages: [],
        attempts: [],
      }).session,
    ).toEqual(root);
    expect(
      ProjectChatSnapshotSchema.parse({ schemaVersion: 1, projectId, messages: [] }).session,
    ).toBeUndefined();
    expect(() =>
      ProjectChatSnapshotSchema.parse({
        schemaVersion: 1,
        projectId,
        session: root,
        sessions: [{ ...root, projectId: otherProjectId }],
        messages: [],
      }),
    ).toThrow();
    expect(() =>
      ProjectChatSnapshotSchema.parse({
        schemaVersion: 1,
        projectId,
        session: root,
        sessions: [root, root],
        messages: [],
      }),
    ).toThrow();
    expect(() =>
      ProjectChatSessionSchema.parse({
        ...root,
        parentSessionId: randomUUID(),
        branchedFromMessageId: randomUUID(),
      }),
    ).toThrow();
  });

  it('bounds strict root and branch session commands', () => {
    const projectId = randomUUID();
    expect(
      CreateProjectChatSessionInputSchema.parse({ projectId, title: '  New analysis  ' }),
    ).toEqual({ projectId, title: 'New analysis' });
    expect(
      BranchProjectChatSessionInputSchema.parse({
        projectId,
        sourceSessionId: randomUUID(),
        branchFromMessageId: randomUUID(),
      }),
    ).toMatchObject({ projectId });
    expect(() =>
      CreateProjectChatSessionInputSchema.parse({
        projectId,
        title: 'x'.repeat(121),
      }),
    ).toThrow();
    expect(() =>
      BranchProjectChatSessionInputSchema.parse({
        projectId,
        sourceSessionId: randomUUID(),
        branchFromMessageId: randomUUID(),
        unsafe: true,
      }),
    ).toThrow();
  });

  it('bounds versioned profile instructions and keeps the version-zero default representable', () => {
    const projectId = randomUUID();
    const legacyProfile = ProjectChatProfileSchema.parse({
      schemaVersion: 1,
      projectId,
      version: 0,
      harnessMode: 'planner',
      responseDepth: 'deep',
      contextScope: 'project',
      customInstructions: '',
      instructionRevision: null,
      updatedAt: null,
    });
    expect(legacyProfile).toMatchObject({
      version: 0,
      collaborationModeId: 'plan',
      personality: 'auto',
      responseVerbosity: 'high',
      webSearchMode: 'cached',
    });
    expect(
      ProjectChatProfileSchema.parse({
        ...legacyProfile,
        harnessMode: 'reviewer',
        responseDepth: 'concise',
        collaborationModeId: undefined,
        responseVerbosity: undefined,
      }),
    ).toMatchObject({ collaborationModeId: 'default', responseVerbosity: 'low' });
    expect(defaultProjectChatProfile(projectId)).toMatchObject({
      collaborationModeId: null,
      personality: 'auto',
      responseVerbosity: 'auto',
      webSearchMode: 'cached',
    });
    expect(() =>
      UpdateProjectChatProfileInputSchema.parse({
        projectId,
        expectedVersion: 0,
        harnessMode: 'planner',
        responseDepth: 'deep',
        contextScope: 'board',
        customInstructions: 'x'.repeat(4_001),
      }),
    ).toThrow();
    const legacyReadGrant = UpdateProjectChatProfileInputSchema.parse({
      projectId,
      expectedVersion: 0,
      harnessMode: 'context',
      responseDepth: 'standard',
      contextScope: 'project',
      localNotesVault: { id: 'a'.repeat(64), name: 'Research Notes' },
      customInstructions: '',
    });
    expect(legacyReadGrant).toMatchObject({
      collaborationModeId: 'default',
      personality: 'auto',
      responseVerbosity: 'medium',
      webSearchMode: 'cached',
      localNotesVault: { id: 'a'.repeat(64), name: 'Research Notes' },
    });
    expect(allowsAgentMarkdownCreate(legacyReadGrant.localNotesVault)).toBe(false);
    const explicitCreateGrant = UpdateProjectChatProfileInputSchema.parse({
      ...legacyReadGrant,
      localNotesVault: {
        id: 'a'.repeat(64),
        name: 'Research Notes',
        allowAgentMarkdownCreate: true,
      },
    });
    expect(allowsAgentMarkdownCreate(explicitCreateGrant.localNotesVault)).toBe(true);
    expect(
      UpdateProjectChatProfileInputSchema.parse({
        projectId,
        expectedVersion: 0,
        harnessMode: 'context',
        responseDepth: 'standard',
        webSearchMode: 'live',
        contextScope: 'project',
        customInstructions: '',
      }).webSearchMode,
    ).toBe('live');
    expect(() =>
      UpdateProjectChatProfileInputSchema.parse({
        projectId,
        expectedVersion: 0,
        harnessMode: 'context',
        responseDepth: 'standard',
        webSearchMode: 'browser',
        contextScope: 'project',
        customInstructions: '',
      }),
    ).toThrow();
    expect(() =>
      UpdateProjectChatProfileInputSchema.parse({
        projectId,
        expectedVersion: 0,
        harnessMode: 'context',
        responseDepth: 'standard',
        contextScope: 'project',
        localNotesVault: { id: '../vault', name: 'Research Notes' },
        customInstructions: '',
      }),
    ).toThrow();
  });

  it('accepts future native collaboration modes without a desktop release', () => {
    const catalog = CodexCollaborationModeCatalogSchema.parse({
      catalogVersion: 'catalog-future-fixture',
      modes: [
        {
          id: 'default',
          displayName: 'Default',
          recommendedModelId: null,
          recommendedReasoningOptionId: null,
        },
        {
          id: 'research-orchestrator-v2',
          displayName: 'Research orchestrator',
          recommendedModelId: 'future-model-id',
          recommendedReasoningOptionId: 'high',
        },
      ],
    });
    expect(catalog.modes[1]?.id).toBe('research-orchestrator-v2');
    expect(() =>
      CodexCollaborationModeCatalogSchema.parse({
        catalogVersion: 'duplicate-fixture',
        modes: [catalog.modes[0], catalog.modes[0]],
      }),
    ).toThrow();
  });

  it('keeps v1/v2 prompt provenance readable and parses native v3 provenance', () => {
    const base = {
      schemaVersion: 1 as const,
      baseInstructionId: 'gosu.project-chat.base',
      baseInstructionVersion: 1,
      baseInstructionsSha256: 'a'.repeat(64),
      harnessInstructionId: 'gosu.project-chat.harness.planner',
      harnessInstructionVersion: 1,
      harnessInstructionsSha256: 'b'.repeat(64),
      customInstructionsSha256: 'c'.repeat(64),
      developerInstructionsSha256: 'd'.repeat(64),
      promptSha256: 'e'.repeat(64),
      projectContextSha256: 'f'.repeat(64),
      visibleHistorySha256: '0'.repeat(64),
      userMessageSha256: '1'.repeat(64),
      profileVersion: 0,
      instructionRevisionId: null,
      workspaceRevision: 1,
      developerInstructionsCharacters: 800,
      promptCharacters: 1_200,
      contextTruncated: false,
      historyTruncated: false,
    };
    expect(
      ProjectChatPromptProvenanceSchema.parse({ ...base, assemblyVersion: 1 }).assemblyVersion,
    ).toBe(1);
    const v2Fields = {
      toolCatalogSha256: '2'.repeat(64),
      localNotesVaultId: null,
    };
    expect(
      ProjectChatPromptProvenanceSchema.parse({
        ...base,
        ...v2Fields,
        assemblyVersion: 2,
      }).assemblyVersion,
    ).toBe(2);
    expect(
      ProjectChatPromptProvenanceSchema.parse({
        ...base,
        ...v2Fields,
        assemblyVersion: 3,
        requestedLegacyHarnessMode: 'planner',
        nativeCollaborationModeId: 'plan',
        nativeExecutionKind: 'plan',
        nativeCollaborationCatalogSha256: '3'.repeat(64),
        nativePersonality: 'pragmatic',
        nativeResponseVerbosity: 'high',
        effectiveReasoningOptionId: 'high',
      }),
    ).toMatchObject({
      assemblyVersion: 3,
      nativeCollaborationModeId: 'plan',
      nativePersonality: 'pragmatic',
    });
  });
});
