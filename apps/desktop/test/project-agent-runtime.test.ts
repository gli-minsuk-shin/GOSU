import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { assembleProjectChatPrompt } from '../src/main/project-chat-prompt';
import {
  ProjectAgentRunSchema,
  ProjectAgentWorkingMemorySchema,
  type ProjectChatMessage,
} from '../src/shared/project-chat-contracts';
import type { WorkspaceSnapshot } from '../src/shared/workspace-contracts';

function promptInput(input: {
  snapshot: WorkspaceSnapshot;
  projectId: string;
  message: string;
  priorMessages: readonly ProjectChatMessage[];
  workingMemory: ReturnType<typeof ProjectAgentWorkingMemorySchema.parse> | null;
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
  it('compresses context, preserves a provider-neutral run graph, and reuses completed memory', () => {
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

    const assembled = assembleProjectChatPrompt(
      promptInput({
        snapshot,
        projectId,
        message: 'Continue the evaluation without repeating the entire transcript.',
        priorMessages,
        workingMemory: memory,
      }),
    );

    expect(assembled.contextPlan).toMatchObject({
      strategy: 'recent-history-plus-working-memory',
      candidateMessageCount: 14,
      workingMemoryRevision: 5,
      memoryEntryCount: 1,
    });
    expect(assembled.contextPlan.recentMessageCount).toBeLessThanOrEqual(12);
    expect(assembled.contextPlan.omittedMessageCount).toBeGreaterThan(0);
    expect(assembled.contextPlan.estimatedInputCharactersSaved).toBeGreaterThan(0);
    expect(assembled.prompt).toContain('OLDER_MEMORY_RETAINED');
    expect(assembled.prompt).not.toContain('RECENT_MEMORY_SHOULD_BE_DEDUPED');

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
      }),
    );

    expect(nextTurn.contextPlan).toMatchObject({
      workingMemoryRevision: 6,
      memoryEntryCount: 2,
    });
    expect(nextTurn.prompt).toContain(completedOutcome);
    expect(nextTurn.provenance).toMatchObject({
      assemblyVersion: 5,
      workingMemoryRevision: 6,
    });
  });
});
