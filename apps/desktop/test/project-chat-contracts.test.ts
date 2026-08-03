import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CodexProjectResponseSchema,
  PROJECT_CHAT_OUTPUT_SCHEMA,
  ProjectChatAttemptSchema,
  ProjectChatMessageSchema,
  ProjectChatProfileSchema,
  ProjectChatSnapshotSchema,
  UpdateProjectChatProfileInputSchema,
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

  it('bounds versioned profile instructions and keeps the version-zero default representable', () => {
    const projectId = randomUUID();
    expect(
      ProjectChatProfileSchema.parse({
        schemaVersion: 1,
        projectId,
        version: 0,
        harnessMode: 'context',
        responseDepth: 'standard',
        contextScope: 'project',
        customInstructions: '',
        instructionRevision: null,
        updatedAt: null,
      }).version,
    ).toBe(0);
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
  });
});
