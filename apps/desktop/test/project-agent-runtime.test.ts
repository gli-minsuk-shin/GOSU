import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applicationLanguageContext,
  withApplicationLanguageInstructions,
} from '../src/main/application-language-service';
import { ProjectModelTransferStore } from '../../model-lab/project-model-transfer-store';
import { residualClassifier } from '../../model-lab/src/sample-models';
import {
  initialModelPseudocodeWorkspace,
  serializeModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
} from '../../model-lab/src/model-pseudocode';

import {
  createAgentPermanentMemoryEntry,
  GOSU_RESEARCH_AGENT_POLICY,
  selectAgentPermanentMemories,
  type AgentPermanentMemoryEntry,
} from '@gosu/contracts';
import { describe, expect, it } from 'vitest';
import {
  modelLabBackendContext,
  modelLabBackendDirectory,
} from '../../model-lab/model-lab-backend-context';

import { assembleProjectChatPrompt } from '../src/main/project-chat-prompt';
import {
  ProjectAgentRunSchema,
  ProjectChatQueuedTurnSchema,
  ProjectAgentWorkingMemorySchema,
  type ProjectChatMessage,
} from '../src/shared/project-chat-contracts';

it('retains a queued run language independently of later preference changes', () => {
  const queued = ProjectChatQueuedTurnSchema.parse({
    id: randomUUID(),
    projectId: randomUUID(),
    sessionId: randomUUID(),
    message: 'Explain this model in detail',
    requestedModelId: null,
    reasoningOptionId: null,
    applicationLanguage: { language: 'ko', configured: true },
    priority: 'normal',
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const restored = ProjectChatQueuedTurnSchema.parse(JSON.parse(JSON.stringify(queued)));
  const instructions = applicationLanguageContext.run({ language: 'en', configured: true }, () =>
    applicationLanguageContext.run(restored.applicationLanguage!, () =>
      withApplicationLanguageInstructions('Authorized tools only.'),
    ),
  );
  expect(instructions).toContain('Korean (한국어)');
  expect(instructions).toContain('Authorized tools only.');
  expect(instructions).not.toContain('language: English');
});
import type { WorkspaceSnapshot } from '../src/shared/workspace-contracts';

function promptInput(input: {
  snapshot: WorkspaceSnapshot;
  projectId: string;
  message: string;
  priorMessages: readonly ProjectChatMessage[];
  workingMemory: ReturnType<typeof ProjectAgentWorkingMemorySchema.parse> | null;
  permanentMemory?: Readonly<{
    entries: readonly AgentPermanentMemoryEntry[];
    candidateCount: number;
    omittedCount: number;
    serializedCharacters: number;
    estimatedTokens: number;
  }>;
}) {
  return {
    ...input,
    harnessMode: 'context' as const,
    responseDepth: 'standard' as const,
    contextScope: 'project' as const,
    profileVersion: 0,
    instructionRevisionId: null,
    customInstructions: '',
    nativeCollaborationModeId: null,
    nativeExecutionKind: 'default' as const,
    nativeCollaborationCatalogSha256: 'a'.repeat(64),
    nativePersonality: 'auto' as const,
    nativeResponseVerbosity: 'auto' as const,
    effectiveReasoningOptionId: null,
  };
}

describe('GOSU Agent Runtime regression gate', () => {
  it.each([
    ['unavailable', null, 'context', 'unavailable'],
    ['read-only', 'a'.repeat(64), 'context', 'read-only'],
    ['create', 'a'.repeat(64), 'context', 'create'],
    ['create', null, 'context', 'unavailable'],
    ['unavailable', 'a'.repeat(64), 'context', 'unavailable'],
    ['create', 'a'.repeat(64), 'reviewer', 'read-only'],
  ] as const)(
    'continues chat with verified notes capability %s (binding %s, harness %s)',
    (requested, binding, harnessMode, expected) => {
      const projectId = randomUUID();
      const now = '2026-09-08T00:00:00.000Z';
      const result = assembleProjectChatPrompt({
        ...promptInput({
          snapshot: {
            schemaVersion: 1,
            revision: 1,
            projects: [
              {
                id: projectId,
                name: 'Research',
                slug: 'research',
                version: 1,
                createdAt: now,
                updatedAt: now,
              },
            ],
            tasks: [],
            objectives: [],
          },
          projectId,
          message: 'Continue the analysis with available evidence.',
          priorMessages: [],
          workingMemory: null,
        }),
        harnessMode,
        localNotesVaultId: binding,
        researchNotesCapability: requested,
      });
      const envelope = JSON.parse(result.prompt.split('\n').find((line) => line.startsWith('{'))!);
      expect(envelope.researchNotesAccess).toEqual({
        capability: expected,
        readAllowed: expected !== 'unavailable',
        markdownCreateAllowed: expected === 'create',
      });
      expect(envelope.userMessage).toBe('Continue the analysis with available evidence.');
      expect(result.developerInstructions).toContain(
        `GOSU runtime Research Notes capability: ${expected}.`,
      );
      if (expected !== 'create')
        expect(result.developerInstructions).toContain('set researchNote.disposition to none');
      if (expected === 'unavailable') {
        expect(result.developerInstructions).toContain('do not stop to request note authorization');
        expect(result.provenance).toMatchObject({ localNotesVaultId: null });
      }
    },
  );
  it('copies project models without transferring conversation or permanent-memory context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gosu-runtime-copy-gate-'));
    const source = randomUUID();
    const destination = randomUUID();
    const state = {
      [MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]: serializeModelPseudocodeWorkspace(
        initialModelPseudocodeWorkspace([residualClassifier]),
      ),
      'gosu.model-lab.chat-sessions.v1': 'PRIVATE_SOURCE_CHAT',
      'gosu.model-lab.permanent-memory.v1': 'PRIVATE_SOURCE_MEMORY',
    };
    try {
      const store = new ProjectModelTransferStore({
        root,
        readStorage: async (id) => (id === source ? state : {}),
        resolveProject: async (id) =>
          [source, destination].some((project) => project === id) ? { id, name: id } : null,
        listProjects: async () => [
          { id: source, name: 'Source' },
          { id: destination, name: 'Destination' },
        ],
      });
      const copy = await store.create(source, {
        targetProjectId: destination,
        sourceModelId: residualClassifier.id,
        sourceRevision: 0,
        requestId: randomUUID(),
      });
      expect(copy.targetProjectId).toBe(destination);
      expect(copy.rootModelId).not.toBe(residualClassifier.id);
      expect(JSON.stringify(copy)).not.toContain('PRIVATE_SOURCE_');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('keeps concurrent embedded Model Lab artifact, memory and import contexts project-scoped', async () => {
    const values = await Promise.all(
      ['alpha', 'beta'].map((projectId) =>
        modelLabBackendContext.run(
          { projectId, directory: `/private/model-lab/${projectId}` },
          async () => {
            await Promise.resolve();
            return [
              modelLabBackendDirectory('artifacts'),
              modelLabBackendDirectory('model-builder-cache'),
              modelLabBackendDirectory('import-runs'),
            ];
          },
        ),
      ),
    );
    expect(values[0]?.every((path) => path.startsWith('/private/model-lab/alpha/'))).toBe(true);
    expect(values[1]?.every((path) => path.startsWith('/private/model-lab/beta/'))).toBe(true);
    expect(modelLabBackendContext.getStore()).toBeUndefined();
  });
  it('keeps a follow-up correction and durable decisions under the same shared agent policy', () => {
    const projectId = randomUUID();
    const now = '2026-09-07T00:00:00.000Z';
    const originalRequest = 'Evaluate 10 fixed tasks with rho(6) = 6 and keep CD references.';
    const correction = 'Use H1_new = X.T @ (y - X @ H1) / N; H3 = concat(H1_new, H2). Continue.';
    const workingMemory = ProjectAgentWorkingMemorySchema.parse({
      schemaVersion: 1,
      projectId,
      sessionId: randomUUID(),
      revision: 2,
      entries: [
        {
          attemptId: randomUUID(),
          userRequest: originalRequest,
          outcome: 'The dataset and penalty decisions are accepted; no evaluation receipt yet.',
          completedAt: now,
        },
      ],
      updatedAt: now,
    });
    const assembled = assembleProjectChatPrompt(
      promptInput({
        snapshot: {
          schemaVersion: 1,
          revision: 1,
          projects: [
            {
              id: projectId,
              name: 'Research',
              slug: 'research',
              version: 1,
              createdAt: now,
              updatedAt: now,
            },
          ],
          tasks: [],
          objectives: [],
        },
        projectId,
        message: correction,
        priorMessages: [],
        workingMemory,
      }),
    );
    const envelope = JSON.parse(assembled.prompt.split('\n').find((line) => line.startsWith('{'))!);

    expect(envelope.userMessage).toBe(correction);
    expect(envelope.sessionWorkingMemory.entries[0]).toMatchObject({
      userRequest: originalRequest,
      outcome: 'The dataset and penalty decisions are accepted; no evaluation receipt yet.',
    });
    expect(assembled.developerInstructions).toContain(GOSU_RESEARCH_AGENT_POLICY.content);
    expect(assembled.developerInstructions).not.toContain(correction);
    expect(assembled.developerInstructions).not.toContain(originalRequest);
    expect(assembled.provenance).toMatchObject({
      harnessInstructionId: GOSU_RESEARCH_AGENT_POLICY.id,
      harnessInstructionVersion: GOSU_RESEARCH_AGENT_POLICY.version,
      harnessInstructionsSha256: createHash('sha256')
        .update(GOSU_RESEARCH_AGENT_POLICY.content)
        .digest('hex'),
      workingMemoryRevision: 2,
    });
  });

  it('compresses context, preserves a provider-neutral run graph, and reuses session and permanent memory', () => {
    const now = new Date().toISOString();
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const attemptIds = Array.from({ length: 7 }, () => randomUUID());
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: 1,
      revision: 7,
      projects: [
        {
          id: projectId,
          name: 'Agent runtime regression project',
          slug: 'agent-runtime-regression-project',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
      tasks: [],
      objectives: [],
    };
    const priorMessages: ProjectChatMessage[] = Array.from({ length: 14 }, (_, index) => ({
      id: randomUUID(),
      projectId,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `${index}:RAW_HISTORY_${'h'.repeat(1_000)}`,
      status: 'complete',
      attemptId: attemptIds[Math.floor(index / 2)]!,
      actions: [],
      createdAt: now,
      completedAt: now,
    }));
    const oldMemoryAttemptId = randomUUID();
    const memory = ProjectAgentWorkingMemorySchema.parse({
      schemaVersion: 1,
      projectId,
      sessionId,
      revision: 5,
      entries: [
        {
          attemptId: oldMemoryAttemptId,
          userRequest: 'Which metric did we freeze?',
          outcome: 'OLDER_MEMORY_RETAINED: use held-out log likelihood.',
          completedAt: now,
        },
        {
          attemptId: attemptIds.at(-1),
          userRequest: 'This turn is already present in recent history.',
          outcome: 'RECENT_MEMORY_SHOULD_BE_DEDUPED',
          completedAt: now,
        },
      ],
      updatedAt: now,
    });
    const crossSessionPermanent = createAgentPermanentMemoryEntry({
      id: 'project-memory-frozen-metric',
      scopeType: 'project',
      scopeId: projectId,
      sourceId: randomUUID(),
      userRequest: 'Remember this decision across every project session.',
      outcome: 'PROJECT_MEMORY_CROSS_SESSION: use held-out log likelihood.',
      createdAt: now,
    })!;
    const duplicatePermanent = createAgentPermanentMemoryEntry({
      id: 'project-memory-duplicate-session-entry',
      scopeType: 'project',
      scopeId: projectId,
      sourceId: oldMemoryAttemptId,
      userRequest:
        'Remember this required rule: always keep the same metric already present in session working memory.',
      outcome: 'PROJECT_MEMORY_DUPLICATE_SHOULD_BE_DEDUPED',
      createdAt: now,
    })!;
    const permanentMemory = selectAgentPermanentMemories(
      [duplicatePermanent, crossSessionPermanent],
      'Continue the held-out log likelihood evaluation.',
    );

    const assembled = assembleProjectChatPrompt(
      promptInput({
        snapshot,
        projectId,
        message: 'Continue the evaluation without repeating the entire transcript.',
        priorMessages,
        workingMemory: memory,
        permanentMemory,
      }),
    );

    expect(assembled.contextPlan).toMatchObject({
      strategy: 'layered-project-memory',
      candidateMessageCount: 14,
      workingMemoryRevision: 5,
      memoryEntryCount: 1,
      permanentMemoryCandidateCount: 2,
      permanentMemoryEntryCount: 1,
    });
    expect(assembled.contextPlan.recentMessageCount).toBeLessThanOrEqual(12);
    expect(assembled.contextPlan.omittedMessageCount).toBeGreaterThan(0);
    expect(assembled.contextPlan.estimatedInputCharactersSaved).toBeGreaterThan(0);
    expect(assembled.prompt).toContain('OLDER_MEMORY_RETAINED');
    expect(assembled.prompt).not.toContain('RECENT_MEMORY_SHOULD_BE_DEDUPED');
    expect(assembled.prompt).toContain('PROJECT_MEMORY_CROSS_SESSION');
    expect(assembled.prompt).not.toContain('PROJECT_MEMORY_DUPLICATE_SHOULD_BE_DEDUPED');

    const runId = randomUUID();
    const coordinatorId = randomUUID();
    const attemptId = randomUUID();
    const starting = ProjectAgentRunSchema.parse({
      schemaVersion: 1,
      id: runId,
      projectId,
      sessionId,
      attemptId,
      status: 'starting',
      goal: 'Continue the evaluation without repeating the entire transcript.',
      contextPlan: assembled.contextPlan,
      nodes: [
        {
          id: coordinatorId,
          runId,
          kind: 'coordinator',
          providerId: 'provider-pending',
          status: 'starting',
          task: 'Coordinate the requested evaluation.',
          invocationId: null,
          resultSummary: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    const coordinatorInvocationId = randomUUID();
    const running = ProjectAgentRunSchema.parse({
      ...starting,
      status: 'running',
      nodes: [
        {
          ...starting.nodes[0],
          providerId: 'codex',
          status: 'running',
          invocationId: coordinatorInvocationId,
        },
      ],
    });
    const workerInvocationId = randomUUID();
    const delegated = ProjectAgentRunSchema.parse({
      ...running,
      nodes: [
        ...running.nodes,
        {
          id: workerInvocationId,
          runId,
          parentNodeId: coordinatorId,
          kind: 'delegated-worker',
          providerId: 'hermes',
          status: 'complete',
          task: 'Review the bounded evaluation design.',
          invocationId: workerInvocationId,
          resultSummary: 'Worker verified the frozen metric and holdout split.',
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        },
      ],
    });
    const completedOutcome = 'Coordinator accepted the worker review and froze the evaluation.';
    const completed = ProjectAgentRunSchema.parse({
      ...delegated,
      status: 'complete',
      nodes: delegated.nodes.map((node) =>
        node.kind === 'coordinator'
          ? {
              ...node,
              status: 'complete',
              resultSummary: completedOutcome,
              updatedAt: now,
              completedAt: now,
            }
          : node,
      ),
      updatedAt: now,
      completedAt: now,
    });

    expect(completed.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'coordinator', providerId: 'codex' }),
        expect.objectContaining({
          kind: 'delegated-worker',
          providerId: 'hermes',
          parentNodeId: coordinatorId,
        }),
      ]),
    );

    const nextMemory = ProjectAgentWorkingMemorySchema.parse({
      schemaVersion: 1,
      projectId,
      sessionId,
      revision: 6,
      entries: [
        ...memory.entries.slice(0, 1),
        {
          attemptId,
          userRequest: completed.goal,
          outcome: completedOutcome,
          completedAt: now,
        },
      ],
      updatedAt: now,
    });
    const nextTurn = assembleProjectChatPrompt(
      promptInput({
        snapshot,
        projectId,
        message: 'What did the previous agent run decide?',
        priorMessages: [],
        workingMemory: nextMemory,
        permanentMemory,
      }),
    );

    expect(nextTurn.contextPlan).toMatchObject({
      workingMemoryRevision: 6,
      memoryEntryCount: 2,
    });
    expect(nextTurn.prompt).toContain(completedOutcome);
    expect(nextTurn.provenance).toMatchObject({
      assemblyVersion: 7,
      workingMemoryRevision: 6,
    });

    const anotherSessionTurn = assembleProjectChatPrompt(
      promptInput({
        snapshot,
        projectId,
        message: 'Which metric must this new session continue using?',
        priorMessages: [],
        workingMemory: null,
        permanentMemory,
      }),
    );
    expect(anotherSessionTurn.contextPlan).toMatchObject({
      workingMemoryRevision: null,
      memoryEntryCount: 0,
      permanentMemoryCandidateCount: 2,
      permanentMemoryEntryCount: 2,
      includedSegments: expect.arrayContaining(['permanent-memory']),
    });
    expect(anotherSessionTurn.prompt).toContain('PROJECT_MEMORY_CROSS_SESSION');
  });
});
