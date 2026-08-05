import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';
import { describe, expect, it, vi } from 'vitest';

import type {
  CodexDynamicToolDelivery,
  CodexDynamicToolHandler,
  CodexDynamicToolSpec,
  CodexDynamicToolTimeoutOverride,
} from '../src/main/codex-app-server';
import type {
  ProjectAgentLiterature,
  ProjectAgentSsh,
  ProjectAgentVault,
} from '../src/main/project-agent-tools';
import type {
  ProjectChatPdfAttachmentClaimer,
  ProjectChatPdfAttachmentsForAgent,
} from '../src/main/project-chat-attachment-service';
import {
  buildProjectChatPrompt,
  explicitlyAuthorizesLiteratureSearch,
  ProjectChatService,
  type ProjectChatStorage,
} from '../src/main/project-chat-service';
import { WorkspaceService } from '../src/main/workspace-service';
import type {
  ProjectChatAction,
  ProjectChatAttempt,
  ProjectChatEvent,
  ProjectChatMessage,
  ProjectChatProfile,
  ProjectChatSession,
  ProjectChatSnapshot,
  UpdateProjectChatProfileInput,
} from '../src/shared/project-chat-contracts';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';
import type {
  LiteratureSearchInput,
  LiteratureSearchReceipt,
} from '../src/shared/literature-contracts';
import type { WorkspaceOperation, WorkspaceSnapshot } from '../src/shared/workspace-contracts';

function dynamicToolDelivery(
  outcome: CodexDynamicToolDelivery['outcome'] = Promise.resolve('delivered'),
): CodexDynamicToolDelivery {
  return { outcome, abortSignal: new AbortController().signal };
}

describe('Literature command authorization', () => {
  it('recognizes direct Korean and English requests but denies unrelated or negative text', () => {
    expect(
      explicitlyAuthorizesLiteratureSearch(
        'Tabular foundation model을 literature search해서 Literature section에 넣어줘.',
      ),
    ).toBe(true);
    expect(explicitlyAuthorizesLiteratureSearch('관련 논문을 찾아서 문헌 표에 추가해줘.')).toBe(
      true,
    );
    expect(explicitlyAuthorizesLiteratureSearch('Summarize the attached PDF.')).toBe(false);
    expect(explicitlyAuthorizesLiteratureSearch("Don't search papers; explain the metric.")).toBe(
      false,
    );
  });
});

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
  readonly profiles = new Map<string, ProjectChatProfile>();
  readonly sessions = new Map<string, ProjectChatSession[]>();
  readonly sessionMessageIds = new Map<string, string[]>();
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
    const session = attempt.sessionId
      ? this.getSession(attempt.projectId, attempt.sessionId)
      : this.ensureDefaultSession(attempt.projectId);
    if (!session) throw new Error('chat_session_not_found');
    if (
      attempt.retryOfAttemptId &&
      !this.getChatAttempt(attempt.projectId, session.id, attempt.retryOfAttemptId)
    ) {
      throw new Error('chat_attempt_retry_target_not_found');
    }
    const storedAttempt = { ...attempt, sessionId: session.id };
    this.attempts.set(attempt.id, structuredClone(storedAttempt));
    this.messages.push(structuredClone({ ...userMessage, attemptId: attempt.id }));
    this.sessionMessageIds.get(session.id)!.push(userMessage.id);
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
    if (!attempt.sessionId || !this.getSession(attempt.projectId, attempt.sessionId)) {
      throw new Error('chat_session_not_found');
    }
    this.sessionMessageIds.get(attempt.sessionId)!.push(message.id);
    for (const action of message.actions) this.actions.set(action.id, action);
  }

  getChatAttempt(projectId: string, sessionId: string, attemptId?: string) {
    const resolvedAttemptId = attemptId ?? sessionId;
    const resolvedSessionId = attemptId ? sessionId : this.ensureDefaultSession(projectId).id;
    const attempt = this.attempts.get(resolvedAttemptId);
    const membership = attempt
      ? this.sessionMessageIds.get(resolvedSessionId)?.includes(attempt.userMessageId)
      : false;
    return attempt?.projectId === projectId && membership ? structuredClone(attempt) : null;
  }

  snapshot(projectId: string, requestedSessionId?: string): ProjectChatSnapshot {
    const session = requestedSessionId
      ? this.getSession(projectId, requestedSessionId)
      : this.ensureDefaultSession(projectId);
    if (!session) throw new Error('chat_session_not_found');
    const defaultSession = this.ensureDefaultSession(projectId);
    const assigned = new Set([...this.sessionMessageIds.values()].flat());
    for (const message of this.messages) {
      if (message.projectId === projectId && !assigned.has(message.id)) {
        this.sessionMessageIds.get(defaultSession.id)!.push(message.id);
      }
    }
    const visibleIds = new Set(this.sessionMessageIds.get(session.id) ?? []);
    return {
      schemaVersion: 1,
      projectId,
      session: structuredClone(session),
      sessions: this.listProjectChatSessions(projectId),
      attempts: [...this.attempts.values()]
        .filter(
          (attempt) => attempt.projectId === projectId && visibleIds.has(attempt.userMessageId),
        )
        .map((attempt) => structuredClone(attempt)),
      messages: this.messages
        .filter((message) => message.projectId === projectId && visibleIds.has(message.id))
        .map((message) => ({
          ...structuredClone(message),
          actions: message.actions.map((action) =>
            structuredClone(this.actions.get(action.id) ?? action),
          ),
        })),
    };
  }

  listProjectChatSessions(projectId: string) {
    this.ensureDefaultSession(projectId);
    return structuredClone(this.sessions.get(projectId)!);
  }

  createProjectChatSession(projectId: string, title?: string) {
    const existing = this.listProjectChatSessions(projectId);
    const now = new Date().toISOString();
    const session: ProjectChatSession = {
      id: randomUUID(),
      projectId,
      title: title ?? `New chat${existing.length > 1 ? ` ${existing.length}` : ''}`,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.get(projectId)!.push(session);
    this.sessionMessageIds.set(session.id, []);
    return structuredClone(session);
  }

  branchProjectChatSession(input: {
    projectId: string;
    sourceSessionId: string;
    branchFromMessageId: string;
    title?: string;
  }) {
    const source = this.getSession(input.projectId, input.sourceSessionId);
    if (!source) throw new Error('chat_session_not_found');
    const sourceMessages = this.sessionMessageIds.get(source.id) ?? [];
    const branchIndex = sourceMessages.indexOf(input.branchFromMessageId);
    if (branchIndex < 0) throw new Error('chat_branch_message_not_found');
    const message = this.messages.find((candidate) => candidate.id === input.branchFromMessageId);
    const attempt = message?.attemptId ? this.attempts.get(message.attemptId) : undefined;
    if (!message || message.status !== 'complete' || (attempt && attempt.status === 'running')) {
      throw new Error('chat_branch_point_invalid');
    }
    const now = new Date().toISOString();
    const session: ProjectChatSession = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title ?? `Branch · ${source.title}`,
      isDefault: false,
      parentSessionId: source.id,
      branchedFromMessageId: message.id,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.get(input.projectId)!.push(session);
    this.sessionMessageIds.set(session.id, sourceMessages.slice(0, branchIndex + 1));
    return structuredClone(session);
  }

  renameProjectChatSession(projectId: string, sessionId: string, title: string) {
    const session = this.getSession(projectId, sessionId);
    if (!session) return null;
    const renamed = { ...session, title, updatedAt: new Date().toISOString() };
    const projectSessions = this.sessions.get(projectId)!;
    projectSessions[projectSessions.indexOf(session)] = renamed;
    return structuredClone(renamed);
  }

  private ensureDefaultSession(projectId: string) {
    const existing = this.sessions.get(projectId)?.find((session) => session.isDefault);
    if (existing) return existing;
    const now = new Date().toISOString();
    const session: ProjectChatSession = {
      id: randomUUID(),
      projectId,
      title: 'Project chat',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(projectId, [session]);
    this.sessionMessageIds.set(session.id, []);
    return session;
  }

  private getSession(projectId: string, sessionId: string) {
    return this.sessions.get(projectId)?.find((session) => session.id === sessionId) ?? null;
  }

  getProjectChatProfile(projectId: string) {
    return structuredClone(this.profiles.get(projectId) ?? defaultProjectChatProfile(projectId));
  }

  updateProjectChatProfile(input: UpdateProjectChatProfileInput) {
    const current =
      this.profiles.get(input.projectId) ?? defaultProjectChatProfile(input.projectId);
    if (current.version !== input.expectedVersion) return null;
    const nextVersion = current.version + 1;
    const updated: ProjectChatProfile = {
      schemaVersion: 1,
      projectId: input.projectId,
      version: nextVersion,
      harnessMode: input.harnessMode,
      responseDepth: input.responseDepth,
      collaborationModeId:
        input.collaborationModeId === undefined
          ? input.harnessMode === 'planner'
            ? 'plan'
            : 'default'
          : input.collaborationModeId,
      personality: input.personality ?? 'auto',
      responseVerbosity:
        input.responseVerbosity ??
        (input.responseDepth === 'concise'
          ? 'low'
          : input.responseDepth === 'deep'
            ? 'high'
            : 'medium'),
      webSearchMode: input.webSearchMode ?? 'cached',
      contextScope: input.contextScope,
      localNotesVault: input.localNotesVault ?? null,
      customInstructions: input.customInstructions,
      instructionRevision: {
        id: randomUUID(),
        revision: nextVersion,
        contentSha256: '0'.repeat(64),
        createdAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    this.profiles.set(input.projectId, structuredClone(updated));
    return updated;
  }

  getAction(projectId: string, sessionId: string, actionId?: string) {
    const resolvedActionId = actionId ?? sessionId;
    const resolvedSessionId = actionId ? sessionId : this.ensureDefaultSession(projectId).id;
    const action = this.actions.get(resolvedActionId);
    const membership = action
      ? this.sessionMessageIds.get(resolvedSessionId)?.includes(action.messageId)
      : false;
    return action?.projectId === projectId && membership ? structuredClone(action) : null;
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
  readonly revoked: string[] = [];
  readonly prompts: string[] = [];
  readonly developerInstructions: string[] = [];
  readonly responseVerbosities: Array<'low' | 'medium' | 'high' | null> = [];
  readonly webSearchModes: Array<'disabled' | 'cached' | 'live' | undefined> = [];
  readonly turnSettings: Array<{
    collaborationModeId: string | null;
    expectedCollaborationModeCatalogVersion: string | null;
    personality: 'none' | 'friendly' | 'pragmatic' | null;
    reasoningOptionId: string | null;
  }> = [];
  readonly dynamicTools: Array<readonly CodexDynamicToolSpec[]> = [];
  readonly dynamicToolHandlers: Array<CodexDynamicToolHandler | undefined> = [];
  readonly dynamicToolTimeouts: Array<readonly CodexDynamicToolTimeoutOverride[]> = [];
  beforeRunReturns: ((threadId: string, turnId: string) => void | Promise<void>) | null = null;
  failNextInterrupt = false;
  nextThreadId: string | null = null;
  collaborationModeCatalog = {
    catalogVersion: 'd'.repeat(64),
    modes: [
      {
        id: 'default',
        displayName: 'Default',
        recommendedModelId: null,
        recommendedReasoningOptionId: null,
      },
      {
        id: 'plan',
        displayName: 'Plan',
        recommendedModelId: null,
        recommendedReasoningOptionId: 'medium',
      },
    ],
  };

  async listCollaborationModeCatalog() {
    return structuredClone(this.collaborationModeCatalog);
  }

  async startThread(input: {
    developerInstructions?: string;
    responseVerbosity?: 'low' | 'medium' | 'high' | null;
    webSearchMode?: 'disabled' | 'cached' | 'live';
    dynamicTools?: readonly CodexDynamicToolSpec[];
    dynamicToolHandler?: CodexDynamicToolHandler;
    dynamicToolTimeouts?: readonly CodexDynamicToolTimeoutOverride[];
  }) {
    this.threadCount += 1;
    this.developerInstructions.push(input.developerInstructions ?? '');
    this.responseVerbosities.push(input.responseVerbosity ?? null);
    this.webSearchModes.push(input.webSearchMode);
    this.dynamicTools.push(input.dynamicTools ?? []);
    this.dynamicToolHandlers.push(input.dynamicToolHandler);
    this.dynamicToolTimeouts.push(input.dynamicToolTimeouts ?? []);
    const threadId = this.nextThreadId ?? `thread-${this.threadCount}`;
    this.nextThreadId = null;
    return { threadId, modelId: 'fixture-model' };
  }

  async runTurn(input: {
    threadId: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
    collaborationModeId?: string | null;
    expectedCollaborationModeCatalogVersion?: string | null;
    personality?: 'none' | 'friendly' | 'pragmatic' | null;
    prompt: string;
  }) {
    this.turnCount += 1;
    const turnId = `turn-${this.turnCount}`;
    this.turnThreads.set(turnId, input.threadId);
    this.prompts.push(input.prompt);
    this.turnSettings.push({
      collaborationModeId: input.collaborationModeId ?? null,
      expectedCollaborationModeCatalogVersion:
        input.expectedCollaborationModeCatalogVersion ?? null,
      personality: input.personality ?? null,
      reasoningOptionId: input.reasoningOptionId,
    });
    await this.beforeRunReturns?.(input.threadId, turnId);
    const collaborationMode = input.collaborationModeId
      ? (this.collaborationModeCatalog.modes.find(
          (candidate) => candidate.id === input.collaborationModeId,
        ) ?? null)
      : null;
    const effectiveReasoningOptionId =
      input.reasoningOptionId ?? collaborationMode?.recommendedReasoningOptionId ?? null;
    return {
      turnId,
      invocation: {
        ...invocation(input.requestedModelId),
        reasoningOptionId: effectiveReasoningOptionId,
      },
      collaborationMode,
      collaborationModeCatalogVersion: this.collaborationModeCatalog.catalogVersion,
      effectiveReasoningOptionId,
      personality: input.personality ?? null,
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

  revokeDynamicTools(threadId: string) {
    this.revoked.push(threadId);
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

function localNotesVaultFixture() {
  const vaultId = 'a'.repeat(64);
  const noteId = 'b'.repeat(64);
  const contentSha256 = 'c'.repeat(64);
  const content = 'PRIVATE_NOTE_BODY';
  const vault: ProjectAgentVault = {
    descriptor: () => ({ id: vaultId, name: 'Research Notes' }),
    matchesGrant: (candidate) => candidate === vaultId,
    validateGrant: async (candidate) => {
      if (candidate !== vaultId) throw new Error('vault_grant_stale');
    },
    listForAgent: async () => ({
      notes: [{ noteId, title: 'Baseline evidence' }],
      truncated: false,
    }),
    readForAgent: async () => ({
      noteId,
      title: 'Baseline evidence',
      content,
      contentSha256,
      offset: 0,
      nextOffset: null,
      totalCharacters: content.length,
      truncated: false,
    }),
  };
  return { vault, vaultId, noteId, contentSha256, content };
}

async function fixture(
  vault?: ProjectAgentVault,
  pdfAttachments?: ProjectChatPdfAttachmentClaimer,
) {
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
  const ssh: ProjectAgentSsh = {
    listConnections: vi.fn(async () => []),
    listWorkspaceGrants: vi.fn(async () => []),
    runAgentCommand: vi.fn(async () => {
      throw new Error('ssh_unavailable');
    }),
    runAgentWorkspaceCommand: vi.fn(async () => {
      throw new Error('ssh_unavailable');
    }),
    cancelSession: vi.fn(() => 0),
    cancelProject: vi.fn(() => 0),
  };
  const literature: ProjectAgentLiterature = {
    search: vi.fn(async (input: LiteratureSearchInput): Promise<LiteratureSearchReceipt> => ({
      run: {
        schemaVersion: 1,
        id: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
        projectId: input.projectId,
        provider: 'crossref',
        query: input.query,
        fromYear: input.fromYear ?? null,
        toYear: input.toYear ?? null,
        requestedLimit: input.limit ?? 25,
        status: 'complete',
        foundCount: 2,
        newCount: 2,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        conflicts: [],
        createdAt: '2026-08-05T00:00:00.000Z',
        completedAt: '2026-08-05T00:00:01.000Z',
      },
      foundCount: 2,
      newCount: 2,
      updatedCount: 0,
      unchangedCount: 0,
      conflictCount: 0,
    })),
  };
  const chat = new ProjectChatService({
    storage,
    workspace,
    codex,
    literature,
    ssh,
    ...(pdfAttachments ? { pdfAttachments } : {}),
    ...(vault ? { vault } : {}),
    prepareProjectDirectory: async (projectId) => `/isolated/${projectId}`,
  });
  return { workspace, storage, codex, chat, literature, ssh, projectA, projectB, taskA };
}

async function activeLocalNotesTurn(
  deliveryOutcome: Promise<'delivered' | 'discarded' | 'uncertain'> = Promise.resolve('delivered'),
) {
  const localNotes = localNotesVaultFixture();
  const environment = await fixture(localNotes.vault);
  const profile = await environment.chat.updateProfile({
    projectId: environment.projectA.id,
    expectedVersion: 0,
    harnessMode: 'context',
    responseDepth: 'standard',
    contextScope: 'project',
    localNotesVault: { id: localNotes.vaultId, name: 'Research Notes' },
    customInstructions: '',
  });
  const receipt = await environment.chat.send({
    projectId: environment.projectA.id,
    message: 'Read the approved evidence.',
    requestedModelId: null,
    reasoningOptionId: null,
    profileVersion: profile.version,
  });
  const handler = environment.codex.dynamicToolHandlers[0]!;
  const read = await handler(
    {
      threadId: environment.codex.turnThreads.get(receipt.turnId)!,
      turnId: receipt.turnId,
      callId: 'read-source-before-terminal',
      namespace: 'gosu_project',
      tool: 'read_local_note',
      arguments: { noteId: localNotes.noteId },
    },
    dynamicToolDelivery(deliveryOutcome),
  );
  expect(read.success).toBe(true);
  return { ...environment, ...localNotes, receipt };
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
  it('keeps attached PDF text out of durable messages/prompts and revokes a claimed capability on startup failure', async () => {
    const attachmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const privatePdfText = 'PRIVATE_PDF_TEXT_MUST_NOT_BE_PERSISTED';
    const claimed: ProjectChatPdfAttachmentsForAgent = {
      catalog: () => [
        {
          attachmentId,
          label: 'PDF 1',
          sourceSha256: 'b'.repeat(64),
          pageCount: 1,
          extractedCharacters: privatePdfText.length,
          truncated: false,
          textAvailable: true,
        },
      ],
      read: () => ({
        attachmentId,
        label: 'PDF 1',
        sourceSha256: 'b'.repeat(64),
        pageCount: 1,
        startPage: 1,
        endPage: 1,
        content: privatePdfText,
        contentSha256: 'c'.repeat(64),
        truncated: false,
      }),
      revoke: vi.fn(),
    };
    const attachmentService = { claim: vi.fn(() => claimed) };
    const environment = await fixture(undefined, attachmentService);
    environment.storage.failNextSave = true;

    await expect(
      environment.chat.send({
        projectId: environment.projectA.id,
        message: 'Analyze the attached paper.',
        requestedModelId: null,
        reasoningOptionId: null,
        attachmentIds: [attachmentId],
      }),
    ).rejects.toThrow();

    expect(attachmentService.claim).toHaveBeenCalledOnce();
    expect(claimed.revoke).toHaveBeenCalledOnce();
    expect(JSON.stringify(environment.storage.messages)).not.toContain(privatePdfText);
    expect(JSON.stringify(environment.codex.prompts)).not.toContain(privatePdfText);
  });

  it('does not claim an attachment capability for ordinary text-only turns', async () => {
    const attachmentService = {
      claim: vi.fn(() => {
        throw new Error('must_not_claim');
      }),
    };
    const environment = await fixture(undefined, attachmentService);

    await expect(
      environment.chat.send({
        projectId: environment.projectA.id,
        message: 'Summarize the project.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).resolves.toMatchObject({ projectId: environment.projectA.id });
    expect(attachmentService.claim).not.toHaveBeenCalled();
  });

  it('builds bounded active Board context from only the selected project', async () => {
    const { workspace, projectA, taskA } = await fixture();
    await workspace.updateBoardSettings({
      projectId: projectA.id,
      expectedVersion: projectA.version,
      board: {
        title: 'Alpha research flow',
        columnLabels: {
          backlog: 'Ideas',
          planned: 'Ready for GPU',
          in_progress: 'Running',
          review: 'Check evidence',
          done: 'Published',
        },
        columnOrder: ['planned', 'in_progress', 'review', 'backlog', 'done'],
        wipLimits: {
          backlog: null,
          planned: 4,
          in_progress: 2,
          review: 1,
          done: null,
        },
      },
    });
    await workspace.updateTask({
      projectId: projectA.id,
      taskId: taskA.id,
      expectedVersion: taskA.version,
      description: 'Reproduce the public baseline before the ablation.',
      priority: 'urgent',
      labels: ['baseline', 'gpu'],
      dueDate: '2026-08-14',
    });
    await workspace.createTask({
      projectId: projectA.id,
      title: 'Bound the model context',
      status: 'planned',
      description: `${'x'.repeat(1_100)}DESCRIPTION_TAIL_MUST_BE_EXCLUDED`,
    });
    const archived = await workspace.createTask({
      projectId: projectA.id,
      title: 'Retired private direction',
      status: 'review',
      description: 'Archived task details must not enter the model context.',
      priority: 'high',
      labels: ['retired'],
      dueDate: '2026-08-07',
    });
    await workspace.setTaskArchived({
      projectId: projectA.id,
      taskId: archived.id,
      expectedVersion: archived.version,
      archived: true,
    });
    const prompt = buildProjectChatPrompt(await workspace.snapshot(), projectA.id, 'What next?');

    expect(prompt).toContain('Project Alpha');
    expect(prompt).toContain('Alpha research flow');
    expect(prompt).toContain('"status":"planned","label":"Ready for GPU"');
    expect(prompt).toContain('Alpha baseline');
    expect(prompt).toContain('Reproduce the public baseline before the ablation.');
    expect(prompt).toContain('"priority":"urgent"');
    expect(prompt).toContain('"labels":["baseline","gpu"]');
    expect(prompt).toContain('"dueDate":"2026-08-14"');
    expect(prompt).toContain('"archivedTaskCount":1');
    expect(prompt).not.toContain('DESCRIPTION_TAIL_MUST_BE_EXCLUDED');
    expect(prompt).not.toContain('Retired private direction');
    expect(prompt).not.toContain('Archived task details must not enter the model context.');
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

  it('rejects a cross-project thread ID collision without rebinding or releasing its owner', async () => {
    const { chat, codex, storage, projectA, projectB } = await fixture();
    const alpha = await chat.send({
      projectId: projectA.id,
      message: 'Keep the alpha owner.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.nextThreadId = 'thread-1';

    await expect(
      chat.send({
        projectId: projectB.id,
        message: 'Attempt a colliding owner.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('codex_unavailable');
    expect(codex.released).not.toContain('thread-1');

    codex.complete(alpha.turnId, { reply: 'Alpha ownership preserved', actions: [] });
    await vi.waitFor(() =>
      expect(storage.snapshot(projectA.id).messages.at(-1)?.content).toBe(
        'Alpha ownership preserved',
      ),
    );
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
        sessionId: first.sessionId,
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

  it('versions a project-local profile and records the resolved prompt provenance', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    expect((await chat.snapshot({ projectId: projectA.id })).profile).toMatchObject({
      version: 0,
      harnessMode: 'context',
      webSearchMode: 'cached',
      customInstructions: '',
    });

    const profile = await chat.updateProfile({
      projectId: projectA.id,
      expectedVersion: 0,
      harnessMode: 'planner',
      responseDepth: 'deep',
      webSearchMode: 'live',
      contextScope: 'board',
      customInstructions: 'Prefer falsifiable next steps.',
    });
    await expect(
      chat.updateProfile({
        projectId: projectA.id,
        expectedVersion: 0,
        harnessMode: 'reviewer',
        responseDepth: 'concise',
        contextScope: 'objective',
        customInstructions: '',
      }),
    ).rejects.toThrow('chat_profile_conflict');

    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Plan the next experiment.',
      requestedModelId: null,
      reasoningOptionId: null,
      profileVersion: profile.version,
    });
    const attempt = storage.getChatAttempt(projectA.id, receipt.attemptId);
    expect(attempt).toMatchObject({
      harnessMode: 'planner',
      responseDepth: 'deep',
      webSearchMode: 'live',
      contextScope: 'board',
      profileVersion: 1,
      instructionRevisionId: profile.instructionRevision?.id,
      promptProvenance: {
        assemblyVersion: 3,
        profileVersion: 1,
        instructionRevisionId: profile.instructionRevision?.id,
        requestedLegacyHarnessMode: 'planner',
        nativeCollaborationModeId: 'plan',
        nativeExecutionKind: 'plan',
        nativeCollaborationCatalogSha256: 'd'.repeat(64),
        nativePersonality: 'auto',
        nativeResponseVerbosity: 'high',
        effectiveReasoningOptionId: 'medium',
      },
    });
    expect(attempt?.promptProvenance?.promptCharacters).toBe(codex.prompts[0]?.length);
    expect(codex.developerInstructions[0]).not.toContain('Harness mode');
    expect(codex.developerInstructions[0]).not.toContain('Prefer falsifiable next steps.');
    expect(codex.developerInstructions[0]).toContain('explicitly provided GOSU tools');
    expect(codex.webSearchModes[0]).toBe('live');
    expect(codex.prompts[0]).toContain('Prefer falsifiable next steps.');
    expect(codex.turnSettings[0]).toMatchObject({
      collaborationModeId: 'plan',
      expectedCollaborationModeCatalogVersion: 'd'.repeat(64),
      personality: null,
      reasoningOptionId: null,
    });
    expect(codex.responseVerbosities[0]).toBe('high');

    codex.complete(receipt.turnId, { reply: 'Plan ready', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
  });

  it('requires the currently selected Vault before saving a project Local Notes grant', async () => {
    const { chat, projectA } = await fixture();
    await expect(
      chat.updateProfile({
        projectId: projectA.id,
        expectedVersion: 0,
        harnessMode: 'context',
        responseDepth: 'standard',
        contextScope: 'project',
        localNotesVault: { id: 'a'.repeat(64), name: 'Unselected Vault' },
        customInstructions: '',
      }),
    ).rejects.toThrow('local_notes_vault_not_selected');
  });

  it('revalidates the selected folder identity before saving a Local Notes grant', async () => {
    const localNotes = localNotesVaultFixture();
    const vault: ProjectAgentVault = {
      ...localNotes.vault,
      validateGrant: () => Promise.reject(new Error('vault_root_changed')),
    };
    const { chat, projectA } = await fixture(vault);

    await expect(
      chat.updateProfile({
        projectId: projectA.id,
        expectedVersion: 0,
        harnessMode: 'context',
        responseDepth: 'standard',
        contextScope: 'project',
        localNotesVault: { id: localNotes.vaultId, name: 'Research Notes' },
        customInstructions: '',
      }),
    ).rejects.toThrow('local_notes_vault_changed');
  });

  it('allows an existing Local Notes grant to be revoked when the folder is unavailable', async () => {
    const localNotes = localNotesVaultFixture();
    let folderAvailable = true;
    const vault: ProjectAgentVault = {
      ...localNotes.vault,
      descriptor: () =>
        folderAvailable ? { id: localNotes.vaultId, name: 'Research Notes' } : null,
    };
    const { chat, projectA } = await fixture(vault);
    const authorized = await chat.updateProfile({
      projectId: projectA.id,
      expectedVersion: 0,
      harnessMode: 'context',
      responseDepth: 'standard',
      contextScope: 'project',
      localNotesVault: { id: localNotes.vaultId, name: 'Research Notes' },
      customInstructions: '',
    });

    folderAvailable = false;
    const revoked = await chat.updateProfile({
      projectId: projectA.id,
      expectedVersion: authorized.version,
      harnessMode: authorized.harnessMode,
      responseDepth: authorized.responseDepth,
      collaborationModeId: authorized.collaborationModeId,
      personality: authorized.personality,
      responseVerbosity: authorized.responseVerbosity,
      contextScope: authorized.contextScope,
      localNotesVault: null,
      customInstructions: authorized.customInstructions,
    });

    expect(revoked.localNotesVault).toBeNull();
  });

  it('binds authorized Local Notes tools to the project and persists bounded source provenance', async () => {
    const { vault, vaultId, noteId, contentSha256, content } = localNotesVaultFixture();
    const { chat, codex, storage, projectA } = await fixture(vault);
    const profile = await chat.updateProfile({
      projectId: projectA.id,
      expectedVersion: 0,
      harnessMode: 'context',
      responseDepth: 'deep',
      contextScope: 'project',
      localNotesVault: { id: vaultId, name: 'Research Notes' },
      customInstructions: '',
    });
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Use the approved local evidence.',
      requestedModelId: null,
      reasoningOptionId: null,
      profileVersion: profile.version,
    });

    expect(JSON.stringify(codex.dynamicTools[0])).toContain('read_workspace');
    expect(JSON.stringify(codex.dynamicTools[0])).toContain('list_local_notes');
    expect(JSON.stringify(codex.dynamicTools[0])).toContain('read_local_note');
    expect(JSON.stringify(codex.dynamicTools[0])).not.toContain('search_literature');
    expect(JSON.stringify(codex.dynamicTools[0])).toContain('list_ssh_workspaces');
    expect(JSON.stringify(codex.dynamicTools[0])).toContain('run_ssh_workspace_command');
    expect(JSON.stringify(codex.dynamicTools[0])).not.toContain('/Users/');
    expect(codex.dynamicToolTimeouts[0]).toEqual([
      { namespace: 'gosu_project', tool: 'run_ssh_workspace_command', timeoutMs: 155_000 },
    ]);
    const handler = codex.dynamicToolHandlers[0]!;
    await expect(
      handler(
        {
          threadId: 'thread-1',
          turnId: receipt.turnId,
          callId: 'list-1',
          namespace: 'gosu_project',
          tool: 'list_local_notes',
          arguments: {},
        },
        dynamicToolDelivery(),
      ),
    ).resolves.toMatchObject({ success: true });
    const read = await handler(
      {
        threadId: 'thread-1',
        turnId: receipt.turnId,
        callId: 'read-1',
        namespace: 'gosu_project',
        tool: 'read_local_note',
        arguments: { noteId },
      },
      dynamicToolDelivery(),
    );
    expect(read).toMatchObject({ success: true });
    expect(read.contentItems[0]?.text).toContain('PRIVATE_NOTE_BODY');

    codex.complete(receipt.turnId, {
      reply: `The model quoted approved evidence: ${content}`,
      actions: [],
    });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    const assistant = storage.snapshot(projectA.id).messages[1]!;
    expect(assistant.content).toContain('Local Notes accessed');
    expect(assistant.content).toContain('Baseline evidence');
    expect(assistant.content).toContain(contentSha256);
    // Visible model replies are durable project chat. Explicit authorization therefore also
    // discloses that the model may quote or summarize a note in the stored/synced answer.
    expect(assistant.content).toContain(content);
    expect(storage.getChatAttempt(projectA.id, receipt.attemptId)?.promptProvenance).toMatchObject({
      assemblyVersion: 3,
      localNotesVaultId: vaultId,
    });
  });

  it('binds Literature search to the active project and excludes it from legacy reviewer turns', async () => {
    const { chat, codex, literature, storage, projectA, projectB } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Search for tabular foundation models and add them to Literature.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const handler = codex.dynamicToolHandlers[0]!;
    const result = await handler(
      {
        threadId: codex.turnThreads.get(receipt.turnId)!,
        turnId: receipt.turnId,
        callId: 'literature-search-1',
        namespace: 'gosu_project',
        tool: 'search_literature',
        arguments: { query: 'tabular foundation models', limit: 10 },
      },
      dynamicToolDelivery(),
    );
    expect(result.success).toBe(true);
    expect(JSON.parse(result.contentItems[0]!.text)).toMatchObject({
      provider: 'crossref',
      metadataOnly: true,
      persisted: true,
      newCount: 2,
    });
    expect(literature.search).toHaveBeenCalledExactlyOnceWith(
      { projectId: projectA.id, query: 'tabular foundation models', limit: 10 },
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(result)).not.toContain(projectB.id);
    codex.complete(receipt.turnId, { reply: 'Added two metadata records.', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));

    const reviewer = await chat.updateProfile({
      projectId: projectB.id,
      expectedVersion: 0,
      harnessMode: 'reviewer',
      responseDepth: 'standard',
      contextScope: 'project',
      localNotesVault: null,
      customInstructions: '',
    });
    const reviewerReceipt = await chat.send({
      projectId: projectB.id,
      message: 'Review this project.',
      requestedModelId: null,
      reasoningOptionId: null,
      profileVersion: reviewer.version,
    });
    expect(JSON.stringify(codex.dynamicTools[1])).not.toContain('search_literature');
    codex.complete(reviewerReceipt.turnId, { reply: 'Review complete.', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectB.id).messages).toHaveLength(2));
  });

  it('does not grant Literature mutation to an unrelated or explicitly denied user turn', async () => {
    const { chat, codex, storage, projectA, projectB } = await fixture();
    const unrelated = await chat.send({
      projectId: projectA.id,
      message: 'Summarize the attached evidence.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(JSON.stringify(codex.dynamicTools[0])).not.toContain('search_literature');
    codex.complete(unrelated.turnId, { reply: 'Summary complete.', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));

    const denied = await chat.send({
      projectId: projectB.id,
      message: 'Do not search literature; just explain the current objective.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(JSON.stringify(codex.dynamicTools[1])).not.toContain('search_literature');
    codex.complete(denied.turnId, { reply: 'Objective explained.', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectB.id).messages).toHaveLength(2));
  });

  it('keeps Local Notes source receipts when the structured response is invalid', async () => {
    const { chat, codex, storage, projectA, receipt, contentSha256, content } =
      await activeLocalNotesTurn();
    const completed = waitForTurnCompleted(chat, receipt.turnId);

    codex.complete(receipt.turnId, 'not structured JSON');
    await completed;

    const assistant = storage.snapshot(projectA.id).messages.at(-1)!;
    expect(assistant).toMatchObject({ status: 'failed' });
    expect(assistant.content).toContain('invalid project response');
    expect(assistant.content).toContain('Local Notes accessed');
    expect(assistant.content).toContain(contentSha256);
    expect(assistant.content).not.toContain(content);
  });

  it('keeps Local Notes source receipts when a turn is interrupted or fails', async () => {
    for (const status of ['interrupted', 'failed'] as const) {
      const { chat, codex, storage, projectA, receipt, contentSha256, content } =
        await activeLocalNotesTurn();
      const completed = waitForTurnCompleted(chat, receipt.turnId);
      const threadId = codex.turnThreads.get(receipt.turnId)!;

      codex.emit('notification', {
        method: 'turn/completed',
        params: { threadId, turn: { id: receipt.turnId, status } },
      });
      await completed;

      const assistant = storage.snapshot(projectA.id).messages.at(-1)!;
      expect(assistant.status).toBe(status === 'interrupted' ? 'interrupted' : 'failed');
      expect(assistant.content).toContain('Local Notes accessed');
      expect(assistant.content).toContain(contentSha256);
      expect(assistant.content).not.toContain(content);
    }
  });

  it('waits for an in-flight delivery acknowledgement before sealing an interrupted receipt', async () => {
    let acknowledge!: () => void;
    const deliveryOutcome = new Promise<'delivered'>((resolve) => {
      acknowledge = () => resolve('delivered');
    });
    const { chat, codex, ssh, storage, projectA, receipt, contentSha256 } =
      await activeLocalNotesTurn(deliveryOutcome);
    const completed = waitForTurnCompleted(chat, receipt.turnId);
    const threadId = codex.turnThreads.get(receipt.turnId)!;

    codex.emit('notification', {
      method: 'turn/completed',
      params: { threadId, turn: { id: receipt.turnId, status: 'interrupted' } },
    });
    const handler = codex.dynamicToolHandlers[0]!;
    const listed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-list-during-terminal-note-settlement',
        namespace: 'gosu_project',
        tool: 'list_ssh_workspaces',
        arguments: {},
      },
      dynamicToolDelivery(),
    );
    const executed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-run-during-terminal-note-settlement',
        namespace: 'gosu_project',
        tool: 'run_ssh_workspace_command',
        arguments: {
          connectionId: randomUUID(),
          command: '/usr/bin/nvidia-smi',
        },
      },
      dynamicToolDelivery(),
    );
    expect(JSON.parse(listed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(JSON.parse(executed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
    expect(ssh.cancelSession).toHaveBeenCalledWith(projectA.id, receipt.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(storage.snapshot(projectA.id).messages).toHaveLength(1);

    acknowledge();
    await completed;
    const assistant = storage.snapshot(projectA.id).messages.at(-1)!;
    expect(codex.revoked).toContain(threadId);
    expect(assistant).toMatchObject({ status: 'interrupted' });
    expect(assistant.content).toContain('Local Notes accessed');
    expect(assistant.content).toContain(contentSha256);
  });

  it('keeps Local Notes source receipts when turn registration fails after a tool read', async () => {
    const { vault, vaultId, noteId, contentSha256, content } = localNotesVaultFixture();
    const { chat, codex, storage, projectA } = await fixture(vault);
    const profile = await chat.updateProfile({
      projectId: projectA.id,
      expectedVersion: 0,
      harnessMode: 'context',
      responseDepth: 'standard',
      contextScope: 'project',
      localNotesVault: { id: vaultId, name: 'Research Notes' },
      customInstructions: '',
    });
    storage.failNextMarkRunning = true;
    codex.beforeRunReturns = async (threadId, turnId) => {
      codex.beforeRunReturns = null;
      const read = await codex.dynamicToolHandlers[0]!(
        {
          threadId,
          turnId,
          callId: 'read-before-running-receipt',
          namespace: 'gosu_project',
          tool: 'read_local_note',
          arguments: { noteId },
        },
        dynamicToolDelivery(),
      );
      expect(read.success).toBe(true);
    };

    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'Preserve evidence provenance if registration fails.',
        requestedModelId: null,
        reasoningOptionId: null,
        profileVersion: profile.version,
      }),
    ).rejects.toThrow('codex_unavailable');

    const assistant = storage.snapshot(projectA.id).messages.at(-1)!;
    expect(assistant).toMatchObject({ status: 'failed' });
    expect(assistant.content).toContain('Local Notes accessed');
    expect(assistant.content).toContain(contentSha256);
    expect(assistant.content).not.toContain(content);
  });

  it('preserves migrated reviewer when new controls omit an explicit native mode', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const profile = await chat.updateProfile({
      projectId: projectA.id,
      expectedVersion: 0,
      harnessMode: 'reviewer',
      responseDepth: 'standard',
      contextScope: 'project',
      customInstructions: 'Be strict.',
    });
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Review the board.',
      requestedModelId: null,
      reasoningOptionId: null,
      profileVersion: profile.version,
      // A new renderer can send every other turn control while deliberately omitting
      // collaborationModeId because the user has not changed the migrated Reviewer setting.
      harnessMode: 'context',
      responseDepth: 'deep',
      personality: 'friendly',
      responseVerbosity: 'high',
      contextScope: 'board',
    });
    codex.complete(receipt.turnId, {
      reply: 'The plan needs a control.',
      actions: [{ type: 'task.create', title: 'Hallucinated mutation', status: 'planned' }],
    });

    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    expect(storage.snapshot(projectA.id).messages[1]?.actions).toEqual([]);
    expect(storage.getChatAttempt(projectA.id, receipt.attemptId)).toMatchObject({
      harnessMode: 'reviewer',
      collaborationModeId: null,
      personality: 'friendly',
      responseVerbosity: 'high',
      promptProvenance: {
        assemblyVersion: 3,
        requestedLegacyHarnessMode: 'reviewer',
        nativeCollaborationModeId: null,
        nativeExecutionKind: 'legacy-reviewer',
      },
    });
    expect(codex.turnSettings[0]?.collaborationModeId).toBeNull();
    expect(codex.developerInstructions[0]).toContain('Legacy reviewer compatibility is active');
  });

  it('lets an explicit native selection leave legacy reviewer compatibility', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const profile = await chat.updateProfile({
      projectId: projectA.id,
      expectedVersion: 0,
      harnessMode: 'reviewer',
      responseDepth: 'standard',
      contextScope: 'project',
      customInstructions: 'Be strict.',
    });
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Plan a correction instead.',
      requestedModelId: null,
      reasoningOptionId: null,
      profileVersion: profile.version,
      collaborationModeId: 'plan',
      personality: 'friendly',
      responseVerbosity: 'low',
    });
    codex.complete(receipt.turnId, {
      reply: 'A correction is ready for approval.',
      actions: [{ type: 'task.create', title: 'Add a control run', status: 'planned' }],
    });

    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    expect(storage.snapshot(projectA.id).messages[1]?.actions).toHaveLength(1);
    expect(storage.getChatAttempt(projectA.id, receipt.attemptId)).toMatchObject({
      harnessMode: 'planner',
      collaborationModeId: 'plan',
      personality: 'friendly',
      responseVerbosity: 'low',
      promptProvenance: {
        assemblyVersion: 3,
        requestedLegacyHarnessMode: 'planner',
        nativeCollaborationModeId: 'plan',
        nativeExecutionKind: 'plan',
        nativePersonality: 'friendly',
        nativeResponseVerbosity: 'low',
      },
    });
    expect(codex.turnSettings[0]).toMatchObject({
      collaborationModeId: 'plan',
      personality: 'friendly',
    });
    expect(codex.responseVerbosities[0]).toBe('low');
    expect(codex.developerInstructions[0]).not.toContain('Legacy reviewer compatibility is active');
  });

  it('treats an explicitly selected native Auto mode as an exit from legacy reviewer', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const profile = await chat.updateProfile({
      projectId: projectA.id,
      expectedVersion: 0,
      harnessMode: 'reviewer',
      responseDepth: 'standard',
      contextScope: 'project',
      customInstructions: 'Be strict.',
    });
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Return to native Auto and propose a task.',
      requestedModelId: null,
      reasoningOptionId: null,
      profileVersion: profile.version,
      harnessMode: 'reviewer',
      collaborationModeId: null,
      personality: 'auto',
      responseVerbosity: 'auto',
    });
    codex.complete(receipt.turnId, {
      reply: 'A proposal is ready.',
      actions: [{ type: 'task.create', title: 'Run the native default', status: 'planned' }],
    });

    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    expect(storage.snapshot(projectA.id).messages[1]?.actions).toHaveLength(1);
    expect(storage.getChatAttempt(projectA.id, receipt.attemptId)).toMatchObject({
      harnessMode: 'context',
      collaborationModeId: null,
      promptProvenance: {
        assemblyVersion: 3,
        requestedLegacyHarnessMode: 'context',
        nativeCollaborationModeId: null,
        nativeExecutionKind: 'default',
      },
    });
    expect(codex.developerInstructions[0]).not.toContain('Legacy reviewer compatibility is active');
  });

  it('does not silently replace a native collaboration mode removed by Codex', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'Use my saved native mode.',
        requestedModelId: null,
        reasoningOptionId: null,
        collaborationModeId: 'removed-mode',
      }),
    ).rejects.toThrow('codex_unavailable');

    expect(storage.snapshot(projectA.id).attempts).toEqual([]);
    expect(storage.snapshot(projectA.id).messages).toEqual([]);
    expect(codex.turnSettings).toEqual([]);
  });

  it('passes through a newly discovered opaque Codex mode without an app update', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    codex.collaborationModeCatalog.modes.push({
      id: 'research-focus-v2',
      displayName: 'Research Focus',
      recommendedModelId: null,
      recommendedReasoningOptionId: 'high',
    });
    codex.collaborationModeCatalog.catalogVersion = 'e'.repeat(64);

    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Use the provider mode.',
      requestedModelId: null,
      reasoningOptionId: null,
      collaborationModeId: 'research-focus-v2',
      personality: 'pragmatic',
      responseVerbosity: 'auto',
    });

    expect(codex.turnSettings[0]).toMatchObject({
      collaborationModeId: 'research-focus-v2',
      expectedCollaborationModeCatalogVersion: 'e'.repeat(64),
      personality: 'pragmatic',
    });
    expect(storage.getChatAttempt(projectA.id, receipt.attemptId)).toMatchObject({
      harnessMode: 'context',
      collaborationModeId: 'research-focus-v2',
      promptProvenance: {
        assemblyVersion: 3,
        nativeCollaborationModeId: 'research-focus-v2',
        nativeExecutionKind: 'default',
        nativeCollaborationCatalogSha256: 'e'.repeat(64),
        effectiveReasoningOptionId: 'high',
      },
    });
  });

  it('rejects a stale send profile version before creating an attempt', async () => {
    const { chat, storage, projectA } = await fixture();
    await chat.updateProfile({
      projectId: projectA.id,
      expectedVersion: 0,
      harnessMode: 'context',
      responseDepth: 'standard',
      contextScope: 'project',
      customInstructions: '',
    });

    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'Use an obsolete profile.',
        requestedModelId: null,
        reasoningOptionId: null,
        profileVersion: 0,
      }),
    ).rejects.toThrow('chat_profile_conflict');
    expect(storage.snapshot(projectA.id).attempts).toEqual([]);
    expect(storage.snapshot(projectA.id).messages).toEqual([]);
  });

  it('does not change project capabilities while a Codex turn is active', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Keep this capability snapshot stable.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await expect(
      chat.updateProfile({
        projectId: projectA.id,
        expectedVersion: 0,
        harnessMode: 'planner',
        responseDepth: 'deep',
        contextScope: 'project',
        localNotesVault: null,
        customInstructions: '',
      }),
    ).rejects.toThrow('chat_busy');
    codex.complete(receipt.turnId, { reply: 'Stable turn completed.', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
  });

  it('preserves chat history but blocks new turns and profile changes while a project is in Trash', async () => {
    const { chat, workspace, storage, projectA } = await fixture();
    await workspace.trashProject({
      projectId: projectA.id,
      expectedVersion: projectA.version,
    });

    await expect(chat.snapshot({ projectId: projectA.id })).resolves.toMatchObject({
      projectId: projectA.id,
      messages: [],
    });
    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'This turn must not start.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('project_trashed');
    await expect(
      chat.updateProfile({
        projectId: projectA.id,
        expectedVersion: 0,
        harnessMode: 'planner',
        responseDepth: 'deep',
        contextScope: 'project',
        customInstructions: 'Do not save this.',
      }),
    ).rejects.toThrow('project_trashed');
    expect(storage.snapshot(projectA.id).attempts).toEqual([]);
  });

  it('preserves chat history but blocks new turns and profile changes while a project is archived', async () => {
    const { chat, workspace, storage, projectA } = await fixture();
    await workspace.setProjectArchived({
      projectId: projectA.id,
      expectedVersion: projectA.version,
      archived: true,
    });

    await expect(chat.snapshot({ projectId: projectA.id })).resolves.toMatchObject({
      projectId: projectA.id,
      messages: [],
    });
    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'This archived turn must not start.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('project_archived');
    await expect(
      chat.updateProfile({
        projectId: projectA.id,
        expectedVersion: 0,
        harnessMode: 'planner',
        responseDepth: 'deep',
        contextScope: 'project',
        customInstructions: 'Do not save this.',
      }),
    ).rejects.toThrow('project_archived');
    expect(storage.snapshot(projectA.id).attempts).toEqual([]);
  });

  it('does not apply a previously proposed action after the project enters Trash', async () => {
    const { chat, codex, workspace, storage, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Propose one task.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(receipt.turnId, {
      reply: 'Proposal ready.',
      actions: [{ type: 'task.create', title: 'Preserved proposal', status: 'planned' }],
    });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    const action = storage.snapshot(projectA.id).messages[1]!.actions[0]!;
    await workspace.trashProject({
      projectId: projectA.id,
      expectedVersion: projectA.version,
    });

    await expect(chat.applyAction({ projectId: projectA.id, actionId: action.id })).rejects.toThrow(
      'project_trashed',
    );
    expect(storage.getAction(projectA.id, action.id)?.status).toBe('proposed');
  });

  it('holds an application-level Trash gate around active turns and new turn starts', async () => {
    const { chat, codex, workspace, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Keep this turn active.',
      requestedModelId: null,
      reasoningOptionId: null,
    });

    await expect(
      chat.runWhenProjectChatIdle(projectA.id, () =>
        workspace.trashProject({
          projectId: projectA.id,
          expectedVersion: projectA.version,
        }),
      ),
    ).rejects.toThrow('chat_busy');
    expect((await workspace.snapshot()).projects[0]).not.toHaveProperty('trashedAt');

    const completed = waitForTurnCompleted(chat, receipt.turnId);
    codex.complete(receipt.turnId, { reply: 'Turn complete.', actions: [] });
    await completed;

    let releaseTrashGate: (() => void) | undefined;
    const trashed = chat.runWhenProjectChatIdle(projectA.id, async () => {
      await new Promise<void>((resolve) => {
        releaseTrashGate = resolve;
      });
      return workspace.trashProject({
        projectId: projectA.id,
        expectedVersion: projectA.version,
      });
    });
    await vi.waitFor(() => expect(releaseTrashGate).toBeTypeOf('function'));
    await expect(
      chat.send({
        projectId: projectA.id,
        message: 'Do not start inside the Trash transition.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('chat_busy');
    releaseTrashGate?.();
    await expect(trashed).resolves.toHaveProperty('trashedAt');
  });

  it('drops proposed actions if an internal caller trashes a project during terminal persistence', async () => {
    const { chat, codex, workspace, storage, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'This proposal must be invalidated by Trash.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await workspace.trashProject({
      projectId: projectA.id,
      expectedVersion: projectA.version,
    });
    codex.complete(receipt.turnId, {
      reply: 'The text receipt remains visible.',
      actions: [{ type: 'task.create', title: 'Stale proposal', status: 'planned' }],
    });

    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    expect(storage.snapshot(projectA.id).messages[1]).toMatchObject({
      content: 'The text receipt remains visible.',
      actions: [],
    });
  });

  it('drops proposed actions if an internal caller archives a project during terminal persistence', async () => {
    const { chat, codex, workspace, storage, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'This proposal must be invalidated by Archive.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await workspace.setProjectArchived({
      projectId: projectA.id,
      expectedVersion: projectA.version,
      archived: true,
    });
    codex.complete(receipt.turnId, {
      reply: 'The archived text receipt remains visible.',
      actions: [{ type: 'task.create', title: 'Stale proposal', status: 'planned' }],
    });

    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    expect(storage.snapshot(projectA.id).messages[1]).toMatchObject({
      content: 'The archived text receipt remains visible.',
      actions: [],
    });
  });

  it('keeps root sessions isolated and permits only one active turn per project', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const [defaultSession] = await chat.listSessions({ projectId: projectA.id });
    const secondSession = await chat.createSession({ projectId: projectA.id });

    const first = await chat.send({
      projectId: projectA.id,
      sessionId: defaultSession!.id,
      message: 'Default session question',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await expect(
      chat.send({
        projectId: projectA.id,
        sessionId: secondSession.id,
        message: 'Do not overlap this project turn',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('chat_busy');

    await expect(
      chat.snapshot({ projectId: projectA.id, sessionId: defaultSession!.id }),
    ).resolves.toMatchObject({ activeTurnId: first.turnId });
    await expect(
      chat.snapshot({ projectId: projectA.id, sessionId: secondSession.id }),
    ).resolves.not.toHaveProperty('activeTurnId');
    expect(storage.snapshot(projectA.id, defaultSession!.id).messages).toHaveLength(1);
    expect(storage.snapshot(projectA.id, secondSession.id).messages).toHaveLength(0);
    codex.complete(first.turnId, { reply: 'Default answer', actions: [] });
    await vi.waitFor(() =>
      expect(storage.snapshot(projectA.id, defaultSession!.id).messages).toHaveLength(2),
    );

    const second = await chat.send({
      projectId: projectA.id,
      sessionId: secondSession.id,
      message: 'Independent session question',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(second.turnId, { reply: 'Independent answer', actions: [] });
    await vi.waitFor(() =>
      expect(storage.snapshot(projectA.id, secondSession.id).messages).toHaveLength(2),
    );
    expect(
      storage.snapshot(projectA.id, defaultSession!.id).messages.map((message) => message.content),
    ).toEqual(['Default session question', 'Default answer']);
    expect(
      storage.snapshot(projectA.id, secondSession.id).messages.map((message) => message.content),
    ).toEqual(['Independent session question', 'Independent answer']);
  });

  it('branches only through the selected completed message and stops inheriting later history', async () => {
    const { chat, codex, storage, projectA } = await fixture();
    const first = await chat.send({
      projectId: projectA.id,
      message: 'First question',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(first.turnId, { reply: 'First answer', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(2));
    const firstAnswerId = storage.snapshot(projectA.id).messages[1]!.id;

    const second = await chat.send({
      projectId: projectA.id,
      message: 'Later source question',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(second.turnId, { reply: 'Later source answer', actions: [] });
    await vi.waitFor(() => expect(storage.snapshot(projectA.id).messages).toHaveLength(4));
    const sourceSession = storage.snapshot(projectA.id).session!;
    const branch = await chat.branchSession({
      projectId: projectA.id,
      sourceSessionId: sourceSession.id,
      branchFromMessageId: firstAnswerId,
    });

    expect(
      storage.snapshot(projectA.id, branch.id).messages.map((message) => message.content),
    ).toEqual(['First question', 'First answer']);
    const branchTurn = await chat.send({
      projectId: projectA.id,
      sessionId: branch.id,
      message: 'Branch-only question',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(branchTurn.turnId, { reply: 'Branch-only answer', actions: [] });
    await vi.waitFor(() =>
      expect(storage.snapshot(projectA.id, branch.id).messages).toHaveLength(4),
    );
    expect(storage.snapshot(projectA.id).messages.map((message) => message.content)).toEqual([
      'First question',
      'First answer',
      'Later source question',
      'Later source answer',
    ]);
    expect(
      storage.snapshot(projectA.id, branch.id).messages.map((message) => message.content),
    ).toEqual(['First question', 'First answer', 'Branch-only question', 'Branch-only answer']);
  });

  it('rejects cross-project and cross-session cancel, retry, and action access', async () => {
    const { chat, codex, storage, projectA, projectB } = await fixture();
    const defaultSession = storage.snapshot(projectA.id).session!;
    const otherSession = await chat.createSession({ projectId: projectA.id });
    await expect(
      chat.snapshot({ projectId: projectB.id, sessionId: defaultSession.id }),
    ).rejects.toThrow('chat_session_not_found');
    await expect(
      chat.cancel({ projectId: projectB.id, sessionId: defaultSession.id }),
    ).rejects.toThrow('chat_session_not_found');

    const failed = await chat.send({
      projectId: projectA.id,
      sessionId: defaultSession.id,
      message: 'Produce an invalid response',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(failed.turnId, 'not-json');
    await vi.waitFor(() =>
      expect(storage.getChatAttempt(projectA.id, defaultSession.id, failed.attemptId)?.status).toBe(
        'failed',
      ),
    );
    await expect(
      chat.branchSession({
        projectId: projectA.id,
        sourceSessionId: otherSession.id,
        branchFromMessageId: failed.userMessageId,
      }),
    ).rejects.toThrow('chat_branch_message_not_found');
    await expect(
      chat.branchSession({
        projectId: projectB.id,
        sourceSessionId: defaultSession.id,
        branchFromMessageId: failed.userMessageId,
      }),
    ).rejects.toThrow('chat_session_not_found');
    await expect(
      chat.send({
        projectId: projectA.id,
        sessionId: otherSession.id,
        message: 'Cross-session retry',
        requestedModelId: null,
        reasoningOptionId: null,
        retryOfAttemptId: failed.attemptId,
      }),
    ).rejects.toThrow('chat_attempt_not_found');

    const proposed = await chat.send({
      projectId: projectA.id,
      sessionId: defaultSession.id,
      message: 'Propose one task',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.complete(proposed.turnId, {
      reply: 'Proposal',
      actions: [{ type: 'task.create', title: 'Session-owned task', status: 'planned' }],
    });
    await vi.waitFor(() =>
      expect(
        storage.snapshot(projectA.id, defaultSession.id).messages.at(-1)?.actions,
      ).toHaveLength(1),
    );
    const action = storage.snapshot(projectA.id, defaultSession.id).messages.at(-1)!.actions[0]!;
    await expect(
      chat.applyAction({ projectId: projectA.id, sessionId: otherSession.id, actionId: action.id }),
    ).rejects.toThrow('action_not_found');
    await expect(
      chat.applyAction({
        projectId: projectB.id,
        sessionId: defaultSession.id,
        actionId: action.id,
      }),
    ).rejects.toThrow('chat_session_not_found');
  });

  it('routes legacy callers to the one durable default session', async () => {
    const { chat, codex, ssh, projectA } = await fixture();
    const first = await chat.snapshot({ projectId: projectA.id });
    const second = await chat.snapshot({ projectId: projectA.id });
    expect(first.session).toEqual(second.session);
    expect(first.sessions?.filter((session) => session.isDefault)).toHaveLength(1);

    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Legacy default send',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(receipt.sessionId).toBe(first.session?.id);
    await chat.cancel({ projectId: projectA.id });
    expect(codex.interrupted.at(-1)?.turnId).toBe(receipt.turnId);
    expect(ssh.cancelSession).toHaveBeenCalledWith(projectA.id, receipt.sessionId);
    codex.complete(receipt.turnId, { reply: 'Done', actions: [] });
  });

  it('revokes SSH synchronously even when cancelling the Codex turn fails', async () => {
    const { chat, codex, ssh, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Keep the turn active until cancellation.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    codex.failNextInterrupt = true;
    const cancellation = chat
      .cancel({ projectId: projectA.id, sessionId: receipt.sessionId })
      .catch((error: unknown) => error);
    const handler = codex.dynamicToolHandlers[0]!;
    const threadId = codex.turnThreads.get(receipt.turnId)!;
    const listed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-list-after-cancel-start',
        namespace: 'gosu_project',
        tool: 'list_ssh_workspaces',
        arguments: {},
      },
      dynamicToolDelivery(),
    );
    const executed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-run-after-cancel-start',
        namespace: 'gosu_project',
        tool: 'run_ssh_workspace_command',
        arguments: {
          connectionId: randomUUID(),
          command: '/usr/bin/nvidia-smi',
        },
      },
      dynamicToolDelivery(),
    );

    await expect(cancellation).resolves.toEqual(
      expect.objectContaining({ message: 'transient_interrupt_failure' }),
    );
    expect(JSON.parse(listed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(JSON.parse(executed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
    expect(ssh.cancelSession).toHaveBeenCalledWith(projectA.id, receipt.sessionId);
    codex.complete(receipt.turnId, { reply: 'Done', actions: [] });
  });

  it('keeps SSH revoked when cancel session lookup fails', async () => {
    const { chat, codex, ssh, storage, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Keep the turn active during a failed lookup.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    vi.spyOn(storage, 'snapshot').mockImplementationOnce(() => {
      throw new Error('fixture_cancel_lookup_failure');
    });
    const cancellation = chat
      .cancel({ projectId: projectA.id, sessionId: receipt.sessionId })
      .catch((error: unknown) => error);
    const handler = codex.dynamicToolHandlers[0]!;
    const threadId = codex.turnThreads.get(receipt.turnId)!;
    const listed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-list-after-cancel-lookup-failure',
        namespace: 'gosu_project',
        tool: 'list_ssh_workspaces',
        arguments: {},
      },
      dynamicToolDelivery(),
    );
    const executed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-run-after-cancel-lookup-failure',
        namespace: 'gosu_project',
        tool: 'run_ssh_workspace_command',
        arguments: { connectionId: randomUUID(), command: '/usr/bin/nvidia-smi' },
      },
      dynamicToolDelivery(),
    );

    await expect(cancellation).resolves.toEqual(
      expect.objectContaining({ message: 'fixture_cancel_lookup_failure' }),
    );
    expect(JSON.parse(listed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(JSON.parse(executed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
    expect(ssh.cancelSession).toHaveBeenCalledWith(projectA.id, receipt.sessionId);
    codex.complete(receipt.turnId, { reply: 'Done', actions: [] });
  });

  it('keeps a starting turn SSH-revoked when Stop races before turn registration', async () => {
    const { chat, codex, ssh, storage, projectA } = await fixture();
    const session = (await chat.snapshot({ projectId: projectA.id })).session!;
    const originalSnapshot = storage.snapshot.bind(storage);
    let releaseSnapshot!: (snapshot: ProjectChatSnapshot) => void;
    const deferredSnapshot = new Promise<ProjectChatSnapshot>((resolve) => {
      releaseSnapshot = resolve;
    });
    const snapshotSpy = vi
      .spyOn(storage, 'snapshot')
      .mockImplementationOnce(() => deferredSnapshot as unknown as ProjectChatSnapshot);
    const sending = chat.send({
      projectId: projectA.id,
      sessionId: session.id,
      message: 'Race startup with Stop.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await vi.waitFor(() => expect(snapshotSpy).toHaveBeenCalledOnce());

    await expect(chat.cancel({ projectId: projectA.id, sessionId: session.id })).rejects.toThrow(
      'chat_not_active',
    );
    releaseSnapshot(originalSnapshot(projectA.id, session.id));
    const receipt = await sending;
    const handler = codex.dynamicToolHandlers.at(-1)!;
    const threadId = codex.turnThreads.get(receipt.turnId)!;
    const listed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-list-after-startup-stop',
        namespace: 'gosu_project',
        tool: 'list_ssh_workspaces',
        arguments: {},
      },
      dynamicToolDelivery(),
    );
    const executed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-run-after-startup-stop',
        namespace: 'gosu_project',
        tool: 'run_ssh_workspace_command',
        arguments: { connectionId: randomUUID(), command: '/usr/bin/nvidia-smi' },
      },
      dynamicToolDelivery(),
    );

    expect(JSON.parse(listed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(JSON.parse(executed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
    codex.complete(receipt.turnId, { reply: 'Done', actions: [] });
  });

  it('revokes current and future SSH tools for a session without stopping its Codex turn', async () => {
    const { chat, codex, ssh, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Inspect the server if needed.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    const handler = codex.dynamicToolHandlers[0]!;

    await expect(
      chat.revokeSsh({ projectId: projectA.id, sessionId: receipt.sessionId }),
    ).resolves.toEqual({ revoked: true });
    const sshResult = await handler(
      {
        threadId: codex.turnThreads.get(receipt.turnId)!,
        turnId: receipt.turnId,
        callId: 'ssh-after-navigation',
        namespace: 'gosu_project',
        tool: 'list_ssh_workspaces',
        arguments: {},
      },
      dynamicToolDelivery(),
    );
    const workspaceResult = await handler(
      {
        threadId: codex.turnThreads.get(receipt.turnId)!,
        turnId: receipt.turnId,
        callId: 'workspace-after-navigation',
        namespace: 'gosu_project',
        tool: 'read_workspace',
        arguments: { section: 'summary' },
      },
      dynamicToolDelivery(),
    );

    expect(JSON.parse(sshResult.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(workspaceResult.success).toBe(true);
    expect(ssh.cancelSession).toHaveBeenCalledWith(projectA.id, receipt.sessionId);
    expect(codex.interrupted).toHaveLength(0);
    codex.complete(receipt.turnId, { reply: 'Done', actions: [] });
  });

  it('fails closed when SSH revocation races a chat send startup', async () => {
    const { chat, codex, ssh, storage, projectA } = await fixture();
    const session = (await chat.snapshot({ projectId: projectA.id })).session!;
    const originalSnapshot = storage.snapshot.bind(storage);
    let releaseSnapshot!: (snapshot: ProjectChatSnapshot) => void;
    const deferredSnapshot = new Promise<ProjectChatSnapshot>((resolve) => {
      releaseSnapshot = resolve;
    });
    const snapshotSpy = vi
      .spyOn(storage, 'snapshot')
      .mockImplementationOnce(() => deferredSnapshot as unknown as ProjectChatSnapshot);

    const sending = chat.send({
      projectId: projectA.id,
      sessionId: session.id,
      message: 'Inspect the server after startup.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await vi.waitFor(() => expect(snapshotSpy).toHaveBeenCalledOnce());

    await chat.revokeSsh({ projectId: projectA.id, sessionId: session.id });
    releaseSnapshot(originalSnapshot(projectA.id, session.id));
    const receipt = await sending;
    const handler = codex.dynamicToolHandlers.at(-1)!;
    const threadId = codex.turnThreads.get(receipt.turnId)!;
    const listed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-list-after-startup-revoke',
        namespace: 'gosu_project',
        tool: 'list_ssh_workspaces',
        arguments: {},
      },
      dynamicToolDelivery(),
    );
    const executed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-run-after-startup-revoke',
        namespace: 'gosu_project',
        tool: 'run_ssh_workspace_command',
        arguments: {
          connectionId: randomUUID(),
          command: '/usr/bin/nvidia-smi',
        },
      },
      dynamicToolDelivery(),
    );

    expect(JSON.parse(listed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(JSON.parse(executed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
    codex.complete(receipt.turnId, { reply: 'Done', actions: [] });
  });

  it('keeps a different session SSH-capable when an older session is revoked during startup', async () => {
    const { chat, codex, ssh, storage, projectA } = await fixture();
    const sessionA = (await chat.snapshot({ projectId: projectA.id })).session!;
    const sessionB = await chat.createSession({ projectId: projectA.id });
    const originalSnapshot = storage.snapshot.bind(storage);
    let releaseSnapshot!: (snapshot: ProjectChatSnapshot) => void;
    const deferredSnapshot = new Promise<ProjectChatSnapshot>((resolve) => {
      releaseSnapshot = resolve;
    });
    const snapshotSpy = vi
      .spyOn(storage, 'snapshot')
      .mockImplementationOnce(() => deferredSnapshot as unknown as ProjectChatSnapshot);

    const sending = chat.send({
      projectId: projectA.id,
      sessionId: sessionB.id,
      message: 'Keep the new session capability isolated.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    await vi.waitFor(() => expect(snapshotSpy).toHaveBeenCalledOnce());
    await chat.revokeSsh({ projectId: projectA.id, sessionId: sessionA.id });
    releaseSnapshot(originalSnapshot(projectA.id, sessionB.id));

    const receipt = await sending;
    const listed = await codex.dynamicToolHandlers.at(-1)!(
      {
        threadId: codex.turnThreads.get(receipt.turnId)!,
        turnId: receipt.turnId,
        callId: 'ssh-list-in-new-session',
        namespace: 'gosu_project',
        tool: 'list_ssh_workspaces',
        arguments: {},
      },
      dynamicToolDelivery(),
    );

    expect(listed.success).toBe(true);
    expect(JSON.parse(listed.contentItems[0]!.text)).toEqual({
      schemaVersion: 1,
      setupState: 'no_registered_connections',
      registeredConnectionCount: 0,
      workspaces: [],
    });
    expect(ssh.listWorkspaceGrants).toHaveBeenCalledOnce();
    codex.complete(receipt.turnId, { reply: 'Done', actions: [] });
  });

  it('keeps every active SSH capability revoked when project-wide storage validation fails', async () => {
    const { chat, codex, ssh, storage, projectA } = await fixture();
    const receipt = await chat.send({
      projectId: projectA.id,
      message: 'Inspect the server before navigation.',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    vi.spyOn(storage, 'listProjectChatSessions').mockImplementationOnce(() => {
      throw new Error('fixture_storage_failure');
    });

    await expect(chat.revokeSsh({ projectId: projectA.id })).rejects.toThrow(
      'fixture_storage_failure',
    );
    const handler = codex.dynamicToolHandlers.at(-1)!;
    const threadId = codex.turnThreads.get(receipt.turnId)!;
    const listed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-list-after-storage-failure',
        namespace: 'gosu_project',
        tool: 'list_ssh_workspaces',
        arguments: {},
      },
      dynamicToolDelivery(),
    );
    const executed = await handler(
      {
        threadId,
        turnId: receipt.turnId,
        callId: 'ssh-run-after-storage-failure',
        namespace: 'gosu_project',
        tool: 'run_ssh_workspace_command',
        arguments: {
          connectionId: randomUUID(),
          command: '/usr/bin/nvidia-smi',
        },
      },
      dynamicToolDelivery(),
    );

    expect(JSON.parse(listed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(JSON.parse(executed.contentItems[0]!.text)).toEqual({ error: 'ssh_cancelled' });
    expect(ssh.listWorkspaceGrants).not.toHaveBeenCalled();
    expect(ssh.runAgentWorkspaceCommand).not.toHaveBeenCalled();
    expect(ssh.cancelProject).toHaveBeenCalledWith(projectA.id);
    codex.complete(receipt.turnId, { reply: 'Done', actions: [] });
  });

  it('validates a project before storage can lazily create its default session', async () => {
    const { chat, storage } = await fixture();
    const missingProjectId = randomUUID();

    await expect(
      chat.send({
        projectId: missingProjectId,
        message: 'This project does not exist.',
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).rejects.toThrow('project_not_found');

    expect(storage.sessions.has(missingProjectId)).toBe(false);
  });

  it('renames one session without changing its identity or sibling history', async () => {
    const { chat, projectA } = await fixture();
    const original = (await chat.listSessions({ projectId: projectA.id }))[0]!;
    const sibling = await chat.createSession({ projectId: projectA.id });

    const renamed = await chat.renameSession({
      projectId: projectA.id,
      sessionId: original.id,
      title: 'Main research thread',
    });

    expect(renamed).toMatchObject({
      id: original.id,
      projectId: projectA.id,
      title: 'Main research thread',
      isDefault: true,
    });
    const sessions = await chat.listSessions({ projectId: projectA.id });
    expect(sessions.filter((session) => session.isDefault)).toHaveLength(1);
    expect(sessions.find((session) => session.id === sibling.id)?.isDefault).toBe(false);
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.id, title: 'Main research thread' }),
        expect.objectContaining({ id: sibling.id, title: sibling.title }),
      ]),
    );
  });
});
