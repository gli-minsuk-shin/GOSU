import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  buildProjectChatPrompt,
  ProjectChatService,
  type ProjectChatStorage,
} from '../src/main/project-chat-service';
import { WorkspaceService } from '../src/main/workspace-service';
import type {
  ProjectChatAction,
  ProjectChatAttempt,
  ProjectChatEvent,
  ProjectChatMessage,
  ProjectChatSnapshot,
} from '../src/shared/project-chat-contracts';
import type { WorkspaceOperation, WorkspaceSnapshot } from '../src/shared/workspace-contracts';

class MemoryWorkspaceStorage {
  state: WorkspaceSnapshot | null = null;
  operations: WorkspaceOperation[] = [];

  load() {
    return this.state;
  }

  commit(state: WorkspaceSnapshot, operation: WorkspaceOperation) {
    this.state = structuredClone(state);
    this.operations.push(structuredClone(operation));
  }

  pendingChanges() {
    return this.operations;
  }

  pendingSummary() {
    return {
      count: this.operations.length,
      latestWorkspaceRevision: this.operations.at(-1)?.workspaceRevision ?? null,
    };
  }
}

class MemoryChatStorage implements ProjectChatStorage {
  readonly messages: ProjectChatMessage[] = [];
  readonly attempts = new Map<string, ProjectChatAttempt>();
  readonly actions = new Map<string, ProjectChatAction>();
  failNextSave = false;
  failNextAssistantSave = false;
  failNextFinishAction = false;
  failNextMarkRunning = false;
  afterMarkRunning: (() => void) | null = null;

  beginChatAttempt(attempt: ProjectChatAttempt, userMessage: ProjectChatMessage) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('transient_storage_failure');
    }
    if (attempt.status !== 'starting') throw new Error('invalid_attempt_state');
    this.attempts.set(attempt.id, structuredClone(attempt));
    this.messages.push(structuredClone({ ...userMessage, attemptId: attempt.id }));
  }

  markChatAttemptRunning(attempt: ProjectChatAttempt) {
    if (this.failNextMarkRunning) {
      this.failNextMarkRunning = false;
      throw new Error('transient_running_receipt_failure');
    }
    const current = this.attempts.get(attempt.id);
    if (!current || current.status !== 'starting' || attempt.status !== 'running') {
      throw new Error('attempt_state_conflict');
    }
    this.attempts.set(attempt.id, structuredClone(attempt));
    this.afterMarkRunning?.();
  }

  finishChatAttempt(attempt: ProjectChatAttempt, assistantMessage: ProjectChatMessage) {
    if (this.failNextSave || this.failNextAssistantSave) {
      this.failNextSave = false;
      this.failNextAssistantSave = false;
      throw new Error('transient_storage_failure');
    }
    const current = this.attempts.get(attempt.id);
    if (!current || !['starting', 'running'].includes(current.status)) {
      throw new Error('attempt_state_conflict');
    }
    const message = structuredClone({ ...assistantMessage, attemptId: attempt.id });
    this.attempts.set(attempt.id, structuredClone(attempt));
    this.messages.push(message);
    for (const action of message.actions) this.actions.set(action.id, action);
  }

  getChatAttempt(projectId: string, attemptId: string) {
    const attempt = this.attempts.get(attemptId);
    return attempt?.projectId === projectId ? structuredClone(attempt) : null;
  }

  snapshot(projectId: string): ProjectChatSnapshot {
    return {
      schemaVersion: 1,
      projectId,
      attempts: [...this.attempts.values()]
        .filter((attempt) => attempt.projectId === projectId)
        .map((attempt) => structuredClone(attempt)),
      messages: this.messages
        .filter((message) => message.projectId === projectId)
        .map((message) => ({
          ...structuredClone(message),
          actions: message.actions.map((action) =>
            structuredClone(this.actions.get(action.id) ?? action),
          ),
        })),
    };
  }

  getAction(projectId: string, actionId: string) {
    const action = this.actions.get(actionId);
    return action?.projectId === projectId ? structuredClone(action) : null;
  }

  claimAction(projectId: string, actionId: string, updatedAt: string) {
    const action = this.actions.get(actionId);
    if (!action || action.projectId !== projectId || action.status !== 'proposed') return false;
    this.actions.set(actionId, { ...action, status: 'applying', updatedAt });
    return true;
  }

  finishAction(action: ProjectChatAction) {
    if (this.failNextFinishAction) {
      this.failNextFinishAction = false;
      throw new Error('transient_action_receipt_failure');
    }
    const current = this.actions.get(action.id);
    if (!current || current.status !== 'applying') throw new Error('action_state_conflict');
    this.actions.set(action.id, structuredClone(action));
  }
}

class FakeCodex extends EventEmitter {
  private threadCount = 0;
  private turnCount = 0;
  readonly turnThreads = new Map<string, string>();
  readonly interrupted: Array<{ threadId: string; turnId: string }> = [];
  readonly released: string[] = [];
  readonly prompts: string[] = [];
  beforeRunReturns: ((threadId: string, turnId: string) => void) | null = null;
  failNextInterrupt = false;

  async startThread() {
    this.threadCount += 1;
    return { threadId: `thread-${this.threadCount}`, modelId: 'fixture-model' };
  }

  async runTurn(input: { threadId: string; requestedModelId: string | null; prompt: string }) {
    this.turnCount += 1;
    const turnId = `turn-${this.turnCount}`;
    this.turnThreads.set(turnId, input.threadId);
    this.prompts.push(input.prompt);
    this.beforeRunReturns?.(input.threadId, turnId);
    return {
      turnId,
      invocation: invocation(input.requestedModelId),
    };
  }

  async interruptTurn(threadId: string, turnId: string) {
    this.interrupted.push({ threadId, turnId });
    if (this.failNextInterrupt) {
      this.failNextInterrupt = false;
      throw new Error('transient_interrupt_failure');
    }
  }

  async releaseThread(threadId: string) {
    this.released.push(threadId);
  }

  complete(turnId: string, response: unknown) {
    const threadId = this.turnThreads.get(turnId)!;
    this.emit('notification', {
      method: 'item/completed',
      params: {
        threadId,
        turnId,
        item: {
          type: 'agentMessage',
          phase: 'final_answer',
          text: typeof response === 'string' ? response : JSON.stringify(response),
        },
      },
    });
    this.emit('notification', {
      method: 'turn/completed',
      params: { threadId, turn: { id: turnId, status: 'completed' } },
    });
  }
}

function invocation(requestedModelId: string | null): ModelInvocation {
  return {
    schemaVersion: 1,
    invocationId: randomUUID(),
    providerId: 'codex',
    requestedModelId,
    resolvedModelId: requestedModelId ?? 'fixture-default',
    catalogVersion: 'fixture-catalog',
    reasoningOptionId: null,
    startedAt: new Date().toISOString(),
  };
}

async function fixture() {
  const workspaceStorage = new MemoryWorkspaceStorage();
  const workspace = new WorkspaceService(workspaceStorage);
  const projectA = await workspace.createProject({ name: 'Project Alpha' });
  const projectB = await workspace.createProject({ name: 'Project Beta' });
  const taskA = await workspace.createTask({
    projectId: projectA.id,
    title: 'Alpha baseline',
    status: 'backlog',
  });
  await workspace.createTask({
    projectId: projectB.id,
    title: 'Beta secret task',
    status: 'planned',
  });
  const storage = new MemoryChatStorage();
  const codex = new FakeCodex();
  const chat = new ProjectChatService({
    storage,
    workspace,
    codex,
    prepareProjectDirectory: async (projectId) => `/isolated/${projectId}`,
  });
  return { workspace, storage, codex, chat, projectA, projectB, taskA };
}

function waitForTurnCompleted(chat: ProjectChatService, turnId: string) {
  return new Promise<void>((resolve) => {
    const listener = (event: ProjectChatEvent) => {
      if (event.type !== 'turn.completed' || event.turnId !== turnId) return;
      chat.off('event', listener);
      resolve();
    };
    chat.on('event', listener);
  });
}

describe('ProjectChatService', () => {
  it('builds context from only the selected project', async () => {
    const { workspace, projectA } = await fixture();
    const prompt = buildProjectChatPrompt(await workspace.snapshot(), projectA.id, 'What next?');

    expect(prompt).toContain('Project Alpha');
    expect(prompt).toContain('Alpha baseline');
    expect(prompt).not.toContain('Project Beta');
    expect(prompt).not.toContain('Beta secret task');
  });

  it('persists a visible reply and applies a reviewed task proposal once', async () => {
    const { chat, codex, storage, workspace, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Plan the ablation.',
      requestedModelId: 'new-catalog-model',
      reasoningOptionId: null,
    });

    codex.complete(receipt.turnId, {
      reply: 'Ablation 작업을 제안했습니다. Apply 후 Board에 반영됩니다.',
      actions: [{ type: 'task.create', title: 'Run ablation', status: 'planned' }],
    });

    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    const assistant = storage.snapshot(projectA.id).messages[1]!;
    const attempt = storage.snapshot(projectA.id).attempts?.[0];
    expect(assistant.content).toContain('Apply');
    expect(attempt).toMatchObject({
      id: receipt.attemptId,
      userMessageId: receipt.userMessageId,
      turnId: receipt.turnId,
      status: 'complete',
    });
    expect(storage.snapshot(projectA.id).messages[0]?.attemptId).toBe(receipt.attemptId);
    expect(assistant.attemptId).toBe(receipt.attemptId);
    expect(assistant.model?.resolvedModelId).toBe('new-catalog-model');
    expect(assistant.actions[0]?.status).toBe('proposed');

    const action = assistant.actions[0]!;
    const applied = await chat.applyAction({ projectId: projectA.id, actionId: action.id });
    const duplicate = await chat.applyAction({ projectId: projectA.id, actionId: action.id });
    expect(applied.status).toBe('applied');
    expect(duplicate.status).toBe('applied');
    expect(
      (await workspace.snapshot()).tasks.filter((task) => task.title === 'Run ablation'),
    ).toHaveLength(1);
  });

  it('routes interleaved completions to their own project, including early events', async () => {
    const { chat, codex, storage, projectA, projectB } = await fixture();
    codex.beforeRunReturns = (threadId, turnId) => {
      if (threadId !== 'thread-1') return;
      codex.complete(turnId, { reply: 'Alpha reply', actions: [] });
      codex.beforeRunReturns = null;
    };
    const alpha = await chat.send({
      projectId: projectA.id,
      message: 'Alpha question',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const beta = await chat.send({
      projectId: projectB.id,
      message: 'Beta question',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(beta.turnId, { reply: 'Beta reply', actions: [] });

    await vi.waitFor(() => {
      expect(storage.snapshot(projectA.id).messages).toHaveLength(2);
      expect(storage.snapshot(projectB.id).messages).toHaveLength(2);
    });
    expect(storage.snapshot(projectA.id).messages.map((message) => message.content)).toEqual([
      'Alpha question',
      'Alpha reply',
    ]);
    expect(storage.snapshot(projectB.id).messages.map((message) => message.content)).toEqual([
      'Beta question',
      'Beta reply',
    ]);
    expect(alpha.projectId).not.toBe(beta.projectId);
  });

  it('drops notifications and provenance whose thread does not match the active turn', async () => {
    const { chat, codex, storage, projectA, projectB } = await fixture();
    const alpha = await chat.send({
      projectId: projectA.id,
      message: 'Alpha question',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const beta = await chat.send({
      projectId: projectB.id,
      message: 'Beta question',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const betaThread = codex.turnThreads.get(beta.turnId)!;
    codex.emit('invocation', {
      threadId: betaThread,
      turnId: alpha.turnId,
      invocation: invocation('spoofed-model'),
    });
    codex.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: betaThread,
        turnId: alpha.turnId,
        item: { type: 'agentMessage', phase: 'final_answer', text: 'Spoofed reply' },
      },
    });
    codex.emit('notification', {
      method: 'turn/completed',
      params: { threadId: betaThread, turn: { id: alpha.turnId, status: 'completed' } },
    });

    expect((await chat.snapshot({ projectId: projectA.id })).activeTurnId).toBe(alpha.turnId);
    codex.complete(alpha.turnId, { reply: 'Authentic alpha', actions: [] });
    codex.complete(beta.turnId, { reply: 'Authentic beta', actions: [] });
    await vi.waitFor(() => {
      expect(storage.snapshot(projectA.id).messages).toHaveLength(2);
      expect(storage.snapshot(projectB.id).messages).toHaveLength(2);
    });
    const alphaReply = storage.snapshot(projectA.id).messages[1]!;
    expect(alphaReply.content).toBe('Authentic alpha');
    expect(alphaReply.model?.resolvedModelId).toBe('fixture-default');
  });

  it('fails a stale update proposal without overwriting the newer board state', async () => {
    const { chat, codex, storage, workspace, projectA, taskA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Move the baseline to planned.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(receipt.turnId, {
      reply: '이동을 제안했습니다.',
      actions: [
        {
          type: 'task.update',
          taskId: taskA.id,
          expectedVersion: taskA.version,
          status: 'planned',
        },
      ],
    });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    await workspace.updateTask({
      projectId: projectA.id,
      taskId: taskA.id,
      expectedVersion: taskA.version,
      title: 'Newer human title',
    });

    const action = storage.snapshot(projectA.id).messages[1]!.actions[0]!;
    const result = await chat.applyAction({ projectId: projectA.id, actionId: action.id });
    const current = (await workspace.snapshot()).tasks.find((task) => task.id === taskA.id)!;
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('version_conflict');
    expect(current.title).toBe('Newer human title');
    expect(current.status).toBe('backlog');
  });

  it('reconstructs conversation from encrypted visible history in a fresh ephemeral thread', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const first = await chat.send({
      projectId: projectA.id,
      message: 'First turn',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(first.turnId, { reply: 'First reply', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));

    codex.emit('disconnected');
    const second = await chat.send({
      projectId: projectA.id,
      message: 'Second turn',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(second.turnId, { reply: 'Second reply', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(4));

    expect(codex.turnThreads.get(first.turnId)).toBe('thread-1');
    expect(codex.turnThreads.get(second.turnId)).toBe('thread-2');
    expect(codex.prompts[1]).toContain('First turn');
    expect(codex.prompts[1]).toContain('First reply');
    expect(codex.prompts[1]).not.toContain('Beta secret task');
  });

  it('returns active turn state in snapshots so a reloaded renderer can stop it', async () => {
    const { chat, codex, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Long-running question',
      requestedModelId: null,
      reasoningOptionId: null,
    });

    expect((await chat.snapshot({ projectId: projectA.id })).activeTurnId).toBe(receipt.turnId);
    const completed = waitForTurnCompleted(chat, receipt.turnId);
    codex.complete(receipt.turnId, { reply: 'Done', actions: [] });
    await completed;
    expect((await chat.snapshot({ projectId: projectA.id })).activeTurnId).toBeUndefined();
  });

  it('releases the project reservation after a transient message storage failure', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    storage.failNextSave = true;
    const input = {
      projectId: projectA.id,
      message: 'Retryable turn',
      requestedModelId: null,
      reasoningOptionId: null,
    } as const;

    await expect(chat.send(input)).rejects.toThrow('transient_storage_failure');
    const receipt = await chat.send(input);
    codex.complete(receipt.turnId, { reply: 'Recovered', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    expect(storage.snapshot(projectA.id).messages.at(-1)?.content).toBe('Recovered');
  });

  it('releases an active turn even when its terminal message cannot be persisted', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const events: ProjectChatEvent[] = [];
    chat.on('event', (event: ProjectChatEvent) => events.push(event));
    const first = await chat.send({
      projectId: projectA.id,
      message: 'First turn',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    storage.failNextAssistantSave = true;
    codex.complete(first.turnId, { reply: 'Lost persistence', actions: [] });
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: 'turn.completed',
        projectId: projectA.id,
        turnId: first.turnId,
        status: 'interrupted',
      }),
    );
    expect(storage.snapshot(projectA.id).attempts?.[0]).toMatchObject({
      status: 'interrupted',
      errorCode: 'application_interrupted',
    });

    const second = await chat.send({
      projectId: projectA.id,
      message: 'Second turn',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(second.turnId, { reply: 'Recovered', actions: [] });
    await vi.waitFor(() =>
      expect(storage.snapshot(projectA.id).messages.at(-1)?.content).toBe('Recovered'),
    );
  });

  it('marks an action receipt interrupted without pretending the durable board change failed', async () => {
    const { chat, codex, storage, workspace, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Create the robustness task.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(receipt.turnId, {
      reply: '작업 생성을 제안했습니다.',
      actions: [{ type: 'task.create', title: 'Check robustness', status: 'planned' }],
    });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    const action = storage.snapshot(projectA.id).messages[1]!.actions[0]!;
    storage.failNextFinishAction = true;

    const interrupted = await chat.applyAction({ projectId: projectA.id, actionId: action.id });
    const duplicate = await chat.applyAction({ projectId: projectA.id, actionId: action.id });
    expect(interrupted).toMatchObject({
      status: 'failed',
      errorCode: 'application_interrupted',
    });
    expect(duplicate).toMatchObject({
      status: 'failed',
      errorCode: 'application_interrupted',
    });
    expect(
      (await workspace.snapshot()).tasks.filter((task) => task.title === 'Check robustness'),
    ).toHaveLength(1);
  });

  it('releases every ephemeral Codex thread during a long project conversation', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    for (let index = 0; index < 101; index += 1) {
      const receipt = await chat.send({
        projectId: projectA.id,
        message: `Turn ${index}`,
        requestedModelId: null,
        reasoningOptionId: null,
      });
      const completed = waitForTurnCompleted(chat, receipt.turnId);
      codex.complete(receipt.turnId, { reply: `Reply ${index}`, actions: [] });
      await completed;
    }

    expect(codex.released).toHaveLength(101);
    expect(new Set(codex.released).size).toBe(101);
    expect(storage.snapshot(projectA.id).messages).toHaveLength(202);
  });

  it('durably records a disconnect during turn registration and can retry it', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    codex.beforeRunReturns = () => {
      codex.beforeRunReturns = null;
      codex.emit('disconnected');
    };

    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'Recover this registration race',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('codex_unavailable');

    const failed = storage.snapshot(projectA.id);
    expect(failed.messages).toHaveLength(2);
    expect(failed.attempts?.[0]).toMatchObject({
      status: 'failed',
      errorCode: 'codex_unavailable',
    });
    const retryTargetId = failed.attempts?.[0]?.id;
    expect(retryTargetId).toBeTruthy();

    const retry = await chat.send({
      projectId: projectA.id,
      message: 'Recover this registration race',
      requestedModelId: null,
      reasoningOptionId: null,
      retryOfAttemptId: retryTargetId!,
    });
    codex.complete(retry.turnId, { reply: 'Recovered after reconnect', actions: [] });
    await vi.waitFor(() =>
      expect(storage.snapshot(projectA.id).messages.at(-1)?.content).toBe(
        'Recovered after reconnect',
      ),
    );
    expect(storage.snapshot(projectA.id).attempts?.[1]).toMatchObject({
      retryOfAttemptId: retryTargetId,
      status: 'complete',
    });
  });

  it('does not leave a project busy when Codex disconnects while the running receipt is saved', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    storage.afterMarkRunning = () => {
      storage.afterMarkRunning = null;
      codex.emit('disconnected');
    };

    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'Disconnect while registering this turn',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('codex_unavailable');

    expect(storage.snapshot(projectA.id).attempts?.[0]).toMatchObject({
      status: 'failed',
      errorCode: 'codex_unavailable',
    });
    const retry = await chat.send({
      projectId: projectA.id,
      message: 'The project reservation should have been released',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(retry.turnId, { reply: 'Recovered without a stale busy state', actions: [] });
    await vi.waitFor(() =>
      expect(storage.snapshot(projectA.id).messages.at(-1)?.content).toBe(
        'Recovered without a stale busy state',
      ),
    );
  });

  it('interrupts a Codex turn when its running receipt cannot be saved', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    storage.failNextMarkRunning = true;

    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'Do not leave this rejected turn running',
        requestedModelId: 'fixture-explicit',
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('codex_unavailable');

    expect(codex.interrupted).toEqual([{ threadId: 'thread-1', turnId: 'turn-1' }]);
    expect(codex.released).toContain('thread-1');
    expect(storage.snapshot(projectA.id).attempts?.[0]).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-1',
      status: 'failed',
      errorCode: 'codex_unavailable',
      model: { resolvedModelId: 'fixture-explicit' },
    });

    const retry = await chat.send({
      projectId: projectA.id,
      message: 'A new turn can start after cleanup',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(retry.turnId, { reply: 'Cleanup released the project', actions: [] });
    await vi.waitFor(() =>
      expect(storage.snapshot(projectA.id).messages.at(-1)?.content).toBe(
        'Cleanup released the project',
      ),
    );
  });

  it('records an unconfirmed turn interruption with durable turn provenance', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    storage.failNextMarkRunning = true;
    codex.failNextInterrupt = true;

    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'Preserve cleanup failure provenance',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('codex_unavailable');

    const failed = storage.snapshot(projectA.id);
    expect(failed.attempts?.[0]).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-1',
      status: 'failed',
      errorCode: 'application_interrupted',
    });
    expect(failed.messages.at(-1)?.content).toContain('could not confirm');
  });

  it('retries only terminal failures and excludes their partial history', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const first = await chat.send({
      projectId: projectA.id,
      message: 'Unique failed request',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const firstCompleted = waitForTurnCompleted(chat, first.turnId);
    codex.complete(first.turnId, 'not structured JSON');
    await firstCompleted;
    expect(storage.snapshot(projectA.id).attempts?.[0]?.status).toBe('failed');

    const retry = await chat.send({
      projectId: projectA.id,
      message: 'Unique failed request',
      requestedModelId: null,
      reasoningOptionId: null,
      retryOfAttemptId: first.attemptId,
    });
    expect(codex.prompts[1]?.match(/Unique failed request/g)).toHaveLength(1);
    const retryCompleted = waitForTurnCompleted(chat, retry.turnId);
    codex.complete(retry.turnId, { reply: 'Valid retry', actions: [] });
    await retryCompleted;
    expect(storage.snapshot(projectA.id).attempts?.[1]?.status).toBe('complete');

    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'Do not retry a completed turn',
        requestedModelId: null,
        reasoningOptionId: null,
        retryOfAttemptId: retry.attemptId,
      }),
    ).rejects.toThrow('chat_attempt_not_retryable');
  });

  it('does not duplicate a retried user message from a legacy failed turn', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const failedAt = new Date().toISOString();
    storage.messages.push(
      {
        id: randomUUID(),
        projectId: projectA.id,
        role: 'user',
        content: 'Unique legacy retry request',
        status: 'complete',
        actions: [],
        createdAt: failedAt,
        completedAt: failedAt,
      },
      {
        id: randomUUID(),
        projectId: projectA.id,
        role: 'assistant',
        content: 'Legacy Codex failure receipt',
        status: 'failed',
        actions: [],
        createdAt: failedAt,
        completedAt: failedAt,
      },
    );

    const retry = await chat.send({
      projectId: projectA.id,
      message: 'Unique legacy retry request',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(codex.prompts[0]?.match(/Unique legacy retry request/g)).toHaveLength(1);
    codex.complete(retry.turnId, { reply: 'Legacy retry recovered', actions: [] });
    await vi.waitFor(() =>
      expect(storage.snapshot(projectA.id).messages.at(-1)?.content).toBe('Legacy retry recovered'),
    );
  });
});
