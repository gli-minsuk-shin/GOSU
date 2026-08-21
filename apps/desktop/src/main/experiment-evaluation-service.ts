import { createHash, randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';

import {
  ApproveExperimentEvaluationInputSchema,
  CancelExperimentEvaluationInputSchema,
  CreateExperimentEvaluationSessionInputSchema,
  EXPERIMENT_EVALUATION_OUTPUT_SCHEMA,
  ExperimentEvaluationApprovalReceiptSchema,
  ExperimentEvaluationCancelReceiptSchema,
  ExperimentEvaluationDetailInputSchema,
  ExperimentEvaluationEventSchema,
  ExperimentEvaluationGenerationOutputSchema,
  ExperimentEvaluationListSnapshotSchema,
  ExperimentEvaluationMessageSchema,
  ExperimentEvaluationProfileSchema,
  ExperimentEvaluationRevisionSchema,
  ExperimentEvaluationSessionDetailSchema,
  ExperimentEvaluationSessionSchema,
  ExperimentEvaluationTurnReceiptSchema,
  ListExperimentEvaluationsInputSchema,
  ReuseExperimentEvaluationProfileInputSchema,
  SendExperimentEvaluationMessageInputSchema,
  type ApproveExperimentEvaluationInput,
  type CancelExperimentEvaluationInput,
  type CreateExperimentEvaluationSessionInput,
  type ExperimentEvaluationApprovalReceipt,
  type ExperimentEvaluationCancelReceipt,
  type ExperimentEvaluationDetailInput,
  type ExperimentEvaluationEvent,
  type ExperimentEvaluationListSnapshot,
  type ExperimentEvaluationMessage,
  type ExperimentEvaluationProfile,
  type ExperimentEvaluationRevision,
  type ExperimentEvaluationSession,
  type ExperimentEvaluationSessionDetail,
  type ExperimentEvaluationTurnReceipt,
  type ListExperimentEvaluationsInput,
  type ReuseExperimentEvaluationProfileInput,
  type SendExperimentEvaluationMessageInput,
} from '../shared/experiment-evaluation-contracts';
import type { ExperimentWorkspaceService } from './experiment-workspace-service';
import {
  EXPERIMENT_EVALUATION_CODE_POLICY_HASH,
  validateExperimentEvaluationReferenceCode,
} from './experiment-evaluation-code-policy';
import {
  EXPERIMENT_EVALUATION_DEVELOPER_INSTRUCTIONS,
  buildExperimentEvaluationPrompt,
} from './experiment-evaluation-prompt';
import type { WorkspaceService } from './workspace-service';

type MaybePromise<T> = T | Promise<T>;
type CodexNotification = Readonly<{ method?: string; params?: unknown }>;

export interface ExperimentEvaluationStorage {
  listExperimentEvaluationSessions(
    projectId: string,
  ): MaybePromise<readonly ExperimentEvaluationSession[]>;
  listExperimentEvaluationProfiles(
    projectId: string,
  ): MaybePromise<readonly ExperimentEvaluationProfile[]>;
  getExperimentEvaluationSession(
    projectId: string,
    sessionId: string,
  ): MaybePromise<ExperimentEvaluationSession | null>;
  getExperimentEvaluationSessionDetail(
    projectId: string,
    sessionId: string,
  ): MaybePromise<ExperimentEvaluationSessionDetail | null>;
  getExperimentEvaluationRevision(
    projectId: string,
    sessionId: string,
    revision: number,
  ): MaybePromise<ExperimentEvaluationRevision | null>;
  getExperimentEvaluationProfile(
    projectId: string,
    profileId: string,
  ): MaybePromise<ExperimentEvaluationProfile | null>;
  createExperimentEvaluationSession(session: ExperimentEvaluationSession): MaybePromise<boolean>;
  beginExperimentEvaluationTurn(
    input: Readonly<{
      projectId: string;
      sessionId: string;
      expectedVersion: number;
      attemptId: string;
      userMessage: ExperimentEvaluationMessage;
      updatedAt: string;
    }>,
  ): MaybePromise<ExperimentEvaluationSession | null>;
  completeExperimentEvaluationTurn(
    input: Readonly<{
      session: ExperimentEvaluationSession;
      revision: ExperimentEvaluationRevision;
      assistantMessage: ExperimentEvaluationMessage;
    }>,
  ): MaybePromise<ExperimentEvaluationSession | null>;
  failExperimentEvaluationTurn(
    input: Readonly<{
      projectId: string;
      sessionId: string;
      attemptId: string;
      errorCode: string;
      messageStatus: 'failed' | 'interrupted';
      updatedAt: string;
    }>,
  ): MaybePromise<ExperimentEvaluationSession | null>;
  approveExperimentEvaluation(
    input: Readonly<{
      projectId: string;
      sessionId: string;
      expectedVersion: number;
      revision: number;
      profile: ExperimentEvaluationProfile;
      updatedAt: string;
    }>,
  ): MaybePromise<ExperimentEvaluationSession | null>;
  createExperimentEvaluationSessionFromProfile(
    input: Readonly<{
      session: ExperimentEvaluationSession;
      revision: ExperimentEvaluationRevision;
      profileId: string;
      usedAt: string;
    }>,
  ): MaybePromise<ExperimentEvaluationSession | null>;
}

export interface ExperimentEvaluationCodex {
  on: EventEmitter['on'];
  startThread(input: {
    cwd: string;
    modelId: string | null;
    developerInstructions?: string;
    responseVerbosity?: 'low' | 'medium' | 'high' | null;
    dynamicTools?: readonly never[];
    webSearchMode?: 'disabled';
  }): Promise<{ threadId: string }>;
  runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
    cwd: string;
    outputSchema?: Readonly<Record<string, unknown>>;
  }): Promise<{ turnId: string; invocation: ModelInvocation }>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  releaseThread(threadId: string): Promise<void>;
}

export interface ExperimentEvaluationModelUsage {
  bindThread(
    threadId: string,
    attribution: Readonly<{
      workloadKind: 'experiment_evaluation';
      projectId: string;
    }>,
  ): void;
  releaseThread(threadId: string): void;
}

export interface ExperimentEvaluationArtifactWriter {
  saveProfile(
    input: Readonly<{
      projectId: string;
      profileId: string;
      fileName: string;
      code: string;
      prompt: string;
    }>,
  ): Promise<Readonly<{ codePath: string; promptPath: string }>>;
  finalizeProfile(input: Readonly<{ projectId: string; profileId: string }>): Promise<void>;
  verifyProfile(
    input: Readonly<{
      projectId: string;
      profileId: string;
      fileName: string;
      code: string;
      prompt: string;
      codePath: string;
      promptPath: string;
    }>,
  ): Promise<boolean>;
  rollbackProfile(input: Readonly<{ projectId: string; profileId: string }>): Promise<void>;
}

export class ExperimentEvaluationServiceError extends Error {
  constructor(
    readonly code:
      | 'experiment_evaluation_unavailable'
      | 'experiment_evaluation_project_not_found'
      | 'experiment_evaluation_project_unavailable'
      | 'experiment_evaluation_session_not_found'
      | 'experiment_evaluation_profile_not_found'
      | 'experiment_evaluation_version_conflict'
      | 'experiment_evaluation_busy'
      | 'experiment_evaluation_interrupted'
      | 'experiment_evaluation_codex_unavailable'
      | 'experiment_evaluation_invalid_response'
      | 'experiment_evaluation_revision_not_found'
      | 'experiment_evaluation_revision_conflict'
      | 'experiment_evaluation_capacity_reached'
      | 'experiment_evaluation_artifact_failed',
  ) {
    super(code);
    this.name = 'ExperimentEvaluationServiceError';
  }
}

type PendingTurn = {
  threadId: string;
  turnId: string | null;
  invocation: ModelInvocation | null;
  earlyInvocation: { turnId: string; invocation: ModelInvocation } | null;
  finalText: string | null;
  terminalStatus: string | null;
  settled: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
  resolve: (value: { status: string; text: string | null }) => void;
};

type BufferedTurnEvents = {
  finalMessage: CodexNotification | null;
  terminal: CodexNotification | null;
};

type ActiveEvaluationTurn = {
  projectId: string;
  sessionId: string;
  attemptId: string;
  threadId: string | null;
  turnId: string | null;
  cancelRequested: boolean;
  interruptIssued: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function notificationIdentity(notification: CodexNotification) {
  if (!isRecord(notification.params) || typeof notification.params.threadId !== 'string') {
    return null;
  }
  const turn = notification.params.turn;
  const turnId =
    typeof notification.params.turnId === 'string'
      ? notification.params.turnId
      : isRecord(turn) && typeof turn.id === 'string'
        ? turn.id
        : null;
  return turnId ? { threadId: notification.params.threadId, turnId } : null;
}

function contentHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export class ExperimentEvaluationService {
  private readonly pendingByThread = new Map<string, PendingTurn>();
  private readonly bufferedByThread = new Map<string, BufferedTurnEvents>();
  private readonly busySessions = new Set<string>();
  private readonly activeBySession = new Map<string, ActiveEvaluationTurn>();
  private readonly listeners = new Set<(event: ExperimentEvaluationEvent) => void>();

  constructor(
    private readonly dependencies: Readonly<{
      storage: ExperimentEvaluationStorage;
      workspace: WorkspaceService;
      experiments: ExperimentWorkspaceService;
      codex: ExperimentEvaluationCodex;
      usage?: ExperimentEvaluationModelUsage;
      artifacts: ExperimentEvaluationArtifactWriter;
      prepareDirectory: (projectId: string) => Promise<string>;
      now?: () => Date;
      timeoutMs?: number;
    }>,
  ) {
    dependencies.codex.on('notification', (notification: CodexNotification) => {
      this.routeNotification(notification);
    });
    dependencies.codex.on(
      'invocation',
      (event: { threadId?: string; turnId?: string; invocation?: ModelInvocation }) => {
        if (!event.threadId || !event.turnId || !event.invocation) return;
        const pending = this.pendingByThread.get(event.threadId);
        if (!pending) return;
        if (pending.turnId === null) {
          pending.earlyInvocation = { turnId: event.turnId, invocation: event.invocation };
          return;
        }
        if (pending.turnId === event.turnId) pending.invocation = event.invocation;
      },
    );
  }

  onEvent(listener: (event: ExperimentEvaluationEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(input: ListExperimentEvaluationsInput): Promise<ExperimentEvaluationListSnapshot> {
    const command = ListExperimentEvaluationsInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const [sessions, profiles] = await Promise.all([
      this.dependencies.storage.listExperimentEvaluationSessions(command.projectId),
      this.dependencies.storage.listExperimentEvaluationProfiles(command.projectId),
    ]);
    return ExperimentEvaluationListSnapshotSchema.parse({
      schemaVersion: 1,
      projectId: command.projectId,
      sessions,
      profiles,
    });
  }

  async detail(input: ExperimentEvaluationDetailInput): Promise<ExperimentEvaluationSessionDetail> {
    const command = ExperimentEvaluationDetailInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const detail = await this.dependencies.storage.getExperimentEvaluationSessionDetail(
      command.projectId,
      command.sessionId,
    );
    if (!detail) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_session_not_found');
    }
    return ExperimentEvaluationSessionDetailSchema.parse(detail);
  }

  async createSession(
    input: CreateExperimentEvaluationSessionInput,
  ): Promise<ExperimentEvaluationSession> {
    const command = CreateExperimentEvaluationSessionInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const now = this.now().toISOString();
    const session = ExperimentEvaluationSessionSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: command.projectId,
      title: command.title,
      status: 'draft',
      activeAttemptId: null,
      currentRevision: 0,
      acceptedProfileId: null,
      version: 1,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    let created: boolean;
    try {
      created = await this.dependencies.storage.createExperimentEvaluationSession(session);
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!created) throw new ExperimentEvaluationServiceError('experiment_evaluation_unavailable');
    this.publish(session.projectId, session.id, 'session', session.id, now);
    return session;
  }

  async send(
    input: SendExperimentEvaluationMessageInput,
  ): Promise<ExperimentEvaluationTurnReceipt> {
    const command = SendExperimentEvaluationMessageInputSchema.parse(input);
    const { project } = await this.requireActiveProject(command.projectId);
    if (this.busySessions.has(command.sessionId)) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_busy');
    }
    const session = await this.requireSession(command.projectId, command.sessionId);
    if (session.version !== command.expectedVersion) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_version_conflict');
    }
    if (session.status === 'generating' || session.status === 'archived') {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_busy');
    }
    this.busySessions.add(session.id);
    const attemptId = randomUUID();
    const activeTurn: ActiveEvaluationTurn = {
      projectId: command.projectId,
      sessionId: session.id,
      attemptId,
      threadId: null,
      turnId: null,
      cancelRequested: false,
      interruptIssued: false,
    };
    this.activeBySession.set(session.id, activeTurn);
    const startedAt = this.now().toISOString();
    const userMessage = ExperimentEvaluationMessageSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      sessionId: session.id,
      role: 'user',
      status: 'complete',
      content: command.message,
      attemptId,
      revision: null,
      invocation: null,
      createdAt: startedAt,
      completedAt: startedAt,
    });
    let generating: ExperimentEvaluationSession | null;
    try {
      generating = await this.dependencies.storage.beginExperimentEvaluationTurn({
        projectId: command.projectId,
        sessionId: session.id,
        expectedVersion: session.version,
        attemptId,
        userMessage,
        updatedAt: startedAt,
      });
    } catch (error) {
      this.busySessions.delete(session.id);
      this.activeBySession.delete(session.id);
      throw this.normalizeStorageError(error);
    }
    if (!generating) {
      this.busySessions.delete(session.id);
      this.activeBySession.delete(session.id);
      throw new ExperimentEvaluationServiceError('experiment_evaluation_version_conflict');
    }
    let threadId: string | null = null;
    let turnId: string | null = null;
    let completedTurn = false;
    try {
      this.throwIfCancelled(activeTurn);
      this.publish(command.projectId, session.id, 'session', session.id, startedAt);
      const [workspaceSnapshot, experimentSnapshot, detail, cwd] = await Promise.all([
        this.dependencies.workspace.snapshot(),
        this.dependencies.experiments.list({ projectId: command.projectId }),
        this.dependencies.storage.getExperimentEvaluationSessionDetail(
          command.projectId,
          command.sessionId,
        ),
        this.dependencies.prepareDirectory(command.projectId),
      ]);
      if (!detail) {
        throw new ExperimentEvaluationServiceError('experiment_evaluation_session_not_found');
      }
      const objective =
        workspaceSnapshot.objectives
          .filter((candidate) => candidate.projectId === command.projectId)
          .sort((left, right) => right.objectiveVersion - left.objectiveVersion)[0] ?? null;
      const started = await this.dependencies.codex.startThread({
        cwd,
        modelId: command.requestedModelId ?? null,
        developerInstructions: EXPERIMENT_EVALUATION_DEVELOPER_INSTRUCTIONS,
        responseVerbosity: 'medium',
        dynamicTools: [],
        webSearchMode: 'disabled',
      });
      threadId = started.threadId;
      activeTurn.threadId = threadId;
      this.throwIfCancelled(activeTurn);
      this.dependencies.usage?.bindThread(threadId, {
        workloadKind: 'experiment_evaluation',
        projectId: command.projectId,
      });
      const completed = new Promise<{ status: string; text: string | null }>((resolve) => {
        this.pendingByThread.set(threadId!, {
          threadId: threadId!,
          turnId: null,
          invocation: null,
          earlyInvocation: null,
          finalText: null,
          terminalStatus: null,
          settled: false,
          graceTimer: null,
          resolve,
        });
      });
      const running = await this.dependencies.codex.runTurn({
        threadId,
        prompt: buildExperimentEvaluationPrompt({
          project: { id: project.id, name: project.name },
          objective,
          loggingTemplate: experimentSnapshot.loggingTemplate,
          recentRuns: experimentSnapshot.runs,
          currentDraft: detail.currentRevision?.draft ?? null,
          messages: detail.messages.filter((message) => message.id !== userMessage.id),
          request: command.message,
        }),
        requestedModelId: command.requestedModelId ?? null,
        reasoningOptionId: command.reasoningOptionId ?? null,
        cwd,
        outputSchema: EXPERIMENT_EVALUATION_OUTPUT_SCHEMA,
      });
      turnId = running.turnId;
      activeTurn.turnId = turnId;
      this.throwIfCancelled(activeTurn);
      const pending = this.pendingByThread.get(threadId);
      if (!pending) {
        throw new ExperimentEvaluationServiceError('experiment_evaluation_codex_unavailable');
      }
      pending.turnId = turnId;
      pending.invocation =
        pending.earlyInvocation?.turnId === turnId
          ? pending.earlyInvocation.invocation
          : running.invocation;
      const buffered = this.bufferedByThread.get(threadId);
      if (buffered?.finalMessage) {
        this.processNotification(pending, buffered.finalMessage);
      }
      if (buffered?.terminal) {
        this.processNotification(pending, buffered.terminal);
      }
      this.bufferedByThread.delete(threadId);
      const timeoutMs = Math.max(5_000, Math.min(this.dependencies.timeoutMs ?? 180_000, 300_000));
      const terminal = await Promise.race([
        completed,
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new ExperimentEvaluationServiceError('experiment_evaluation_codex_unavailable'),
              ),
            timeoutMs,
          );
          timer.unref?.();
          void completed.finally(() => clearTimeout(timer));
        }),
      ]);
      if (activeTurn.cancelRequested || terminal.status === 'interrupted') {
        throw new ExperimentEvaluationServiceError('experiment_evaluation_interrupted');
      }
      if (terminal.status !== 'completed' || !terminal.text) {
        throw new ExperimentEvaluationServiceError('experiment_evaluation_codex_unavailable');
      }
      completedTurn = true;
      this.throwIfCancelled(activeTurn);
      let output: ReturnType<typeof ExperimentEvaluationGenerationOutputSchema.parse>;
      try {
        output = ExperimentEvaluationGenerationOutputSchema.parse(
          JSON.parse(terminal.text) as unknown,
        );
      } catch {
        throw new ExperimentEvaluationServiceError('experiment_evaluation_invalid_response');
      }
      try {
        validateExperimentEvaluationReferenceCode(output.draft.referenceCode.content);
      } catch {
        throw new ExperimentEvaluationServiceError('experiment_evaluation_invalid_response');
      }
      const completedAt = this.now().toISOString();
      const revisionNumber = generating.currentRevision + 1;
      const invocation = pending.invocation ?? running.invocation;
      const revision = ExperimentEvaluationRevisionSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        sessionId: generating.id,
        revision: revisionNumber,
        attemptId,
        draft: output.draft,
        contentHash: contentHash(output.draft),
        invocation,
        createdAt: completedAt,
      });
      const assistantMessage = ExperimentEvaluationMessageSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        sessionId: generating.id,
        role: 'assistant',
        status: 'complete',
        content: output.reply,
        attemptId,
        revision: revisionNumber,
        invocation,
        createdAt: completedAt,
        completedAt,
      });
      const ready = ExperimentEvaluationSessionSchema.parse({
        ...generating,
        title: output.sessionTitle,
        status: 'ready',
        activeAttemptId: null,
        currentRevision: revisionNumber,
        acceptedProfileId: null,
        version: generating.version + 1,
        lastErrorCode: null,
        updatedAt: completedAt,
      });
      this.throwIfCancelled(activeTurn);
      let stored: ExperimentEvaluationSession | null;
      try {
        stored = await this.dependencies.storage.completeExperimentEvaluationTurn({
          session: ready,
          revision,
          assistantMessage,
        });
      } catch (error) {
        throw this.normalizeStorageError(error);
      }
      if (!stored) {
        throw new ExperimentEvaluationServiceError('experiment_evaluation_version_conflict');
      }
      this.publish(command.projectId, stored.id, 'revision', revision.id, completedAt);
      return ExperimentEvaluationTurnReceiptSchema.parse({
        session: stored,
        revision,
        assistantMessage,
      });
    } catch (error) {
      const normalized =
        error instanceof ExperimentEvaluationServiceError
          ? error
          : new ExperimentEvaluationServiceError('experiment_evaluation_codex_unavailable');
      const failedAt = this.now().toISOString();
      const failed = await Promise.resolve()
        .then(() =>
          this.dependencies.storage.failExperimentEvaluationTurn({
            projectId: command.projectId,
            sessionId: command.sessionId,
            attemptId,
            errorCode: normalized.code,
            messageStatus:
              normalized.code === 'experiment_evaluation_interrupted' ? 'interrupted' : 'failed',
            updatedAt: failedAt,
          }),
        )
        .catch(() => null);
      if (failed) this.publish(command.projectId, failed.id, 'session', failed.id, failedAt);
      throw normalized;
    } finally {
      this.busySessions.delete(command.sessionId);
      if (this.activeBySession.get(command.sessionId) === activeTurn) {
        this.activeBySession.delete(command.sessionId);
      }
      if (threadId) {
        const pending = this.pendingByThread.get(threadId);
        if (pending?.graceTimer) clearTimeout(pending.graceTimer);
        this.pendingByThread.delete(threadId);
        this.bufferedByThread.delete(threadId);
        if (turnId && !completedTurn && !activeTurn.interruptIssued) {
          await this.dependencies.codex.interruptTurn(threadId, turnId).catch(() => undefined);
        }
        await this.dependencies.codex.releaseThread(threadId).catch(() => undefined);
        this.dependencies.usage?.releaseThread(threadId);
      }
    }
  }

  async cancel(input: CancelExperimentEvaluationInput): Promise<ExperimentEvaluationCancelReceipt> {
    const command = CancelExperimentEvaluationInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const session = await this.requireSession(command.projectId, command.sessionId);
    const active = this.activeBySession.get(command.sessionId);
    if (!active || active.projectId !== command.projectId) {
      return ExperimentEvaluationCancelReceiptSchema.parse({
        session,
        cancelRequested: false,
      });
    }

    active.cancelRequested = true;
    if (active.threadId && active.turnId) {
      await this.dependencies.codex
        .interruptTurn(active.threadId, active.turnId)
        .catch(() => undefined);
      active.interruptIssued = true;
      const pending = this.pendingByThread.get(active.threadId);
      if (pending && !pending.settled) {
        pending.terminalStatus = 'interrupted';
        this.maybeResolvePending(pending, true);
      }
    }

    let interrupted = session;
    if (session.status === 'generating' && session.activeAttemptId === active.attemptId) {
      const interruptedAt = this.now().toISOString();
      interrupted =
        (await Promise.resolve(
          this.dependencies.storage.failExperimentEvaluationTurn({
            projectId: command.projectId,
            sessionId: command.sessionId,
            attemptId: active.attemptId,
            errorCode: 'experiment_evaluation_interrupted',
            messageStatus: 'interrupted',
            updatedAt: interruptedAt,
          }),
        ).catch(() => null)) ?? session;
      if (interrupted !== session) {
        this.publish(command.projectId, interrupted.id, 'session', interrupted.id, interruptedAt);
      }
    }

    return ExperimentEvaluationCancelReceiptSchema.parse({
      session: interrupted,
      cancelRequested: true,
    });
  }

  async approve(
    input: ApproveExperimentEvaluationInput,
  ): Promise<ExperimentEvaluationApprovalReceipt> {
    const command = ApproveExperimentEvaluationInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const session = await this.requireSession(command.projectId, command.sessionId);
    if (session.version !== command.expectedVersion || session.status !== 'ready') {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_version_conflict');
    }
    const revision = await this.dependencies.storage.getExperimentEvaluationRevision(
      command.projectId,
      command.sessionId,
      command.revision,
    );
    if (!revision) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_revision_not_found');
    }
    if (revision.revision !== session.currentRevision) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_revision_conflict');
    }
    try {
      validateExperimentEvaluationReferenceCode(revision.draft.referenceCode.content);
    } catch {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_invalid_response');
    }
    const profileId = randomUUID();
    let paths: Readonly<{ codePath: string; promptPath: string }>;
    try {
      paths = await this.dependencies.artifacts.saveProfile({
        projectId: command.projectId,
        profileId,
        fileName: revision.draft.referenceCode.fileName,
        code: revision.draft.referenceCode.content,
        prompt: revision.draft.promptTemplate,
      });
    } catch {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_artifact_failed');
    }
    const approvedAt = this.now().toISOString();
    const profile = ExperimentEvaluationProfileSchema.parse({
      schemaVersion: 1,
      id: profileId,
      projectId: command.projectId,
      name: command.profileName,
      sourceSessionId: session.id,
      sourceRevisionId: revision.id,
      draft: revision.draft,
      contentHash: revision.contentHash,
      codePolicyHash: EXPERIMENT_EVALUATION_CODE_POLICY_HASH,
      invocation: revision.invocation,
      codePath: paths.codePath,
      promptPath: paths.promptPath,
      useCount: 0,
      createdAt: approvedAt,
      lastUsedAt: approvedAt,
    });
    let stored: ExperimentEvaluationSession | null;
    try {
      stored = await this.dependencies.storage.approveExperimentEvaluation({
        projectId: command.projectId,
        sessionId: command.sessionId,
        expectedVersion: command.expectedVersion,
        revision: command.revision,
        profile,
        updatedAt: approvedAt,
      });
    } catch (error) {
      await this.dependencies.artifacts
        .rollbackProfile({ projectId: command.projectId, profileId })
        .catch(() => undefined);
      throw this.normalizeStorageError(error);
    }
    if (!stored) {
      await this.dependencies.artifacts
        .rollbackProfile({ projectId: command.projectId, profileId })
        .catch(() => undefined);
      throw new ExperimentEvaluationServiceError('experiment_evaluation_version_conflict');
    }
    await this.dependencies.artifacts
      .finalizeProfile({ projectId: command.projectId, profileId })
      .catch(() => undefined);
    this.publish(command.projectId, stored.id, 'profile', profile.id, approvedAt);
    return ExperimentEvaluationApprovalReceiptSchema.parse({ session: stored, profile });
  }

  async reuseProfile(
    input: ReuseExperimentEvaluationProfileInput,
  ): Promise<ExperimentEvaluationSessionDetail> {
    const command = ReuseExperimentEvaluationProfileInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const profile = await this.dependencies.storage.getExperimentEvaluationProfile(
      command.projectId,
      command.profileId,
    );
    if (!profile) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_profile_not_found');
    }
    if (profile.codePolicyHash !== EXPERIMENT_EVALUATION_CODE_POLICY_HASH) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_invalid_response');
    }
    try {
      validateExperimentEvaluationReferenceCode(profile.draft.referenceCode.content);
    } catch {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_invalid_response');
    }
    const artifactsIntact = await this.dependencies.artifacts
      .verifyProfile({
        projectId: command.projectId,
        profileId: profile.id,
        fileName: profile.draft.referenceCode.fileName,
        code: profile.draft.referenceCode.content,
        prompt: profile.draft.promptTemplate,
        codePath: profile.codePath,
        promptPath: profile.promptPath,
      })
      .catch(() => false);
    if (!artifactsIntact) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_artifact_failed');
    }
    const now = this.now().toISOString();
    const sessionId = randomUUID();
    const attemptId = randomUUID();
    const session = ExperimentEvaluationSessionSchema.parse({
      schemaVersion: 1,
      id: sessionId,
      projectId: command.projectId,
      title: `${profile.name} copy`,
      status: 'ready',
      activeAttemptId: null,
      currentRevision: 1,
      acceptedProfileId: profile.id,
      version: 1,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    const revision = ExperimentEvaluationRevisionSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      sessionId,
      revision: 1,
      attemptId,
      draft: profile.draft,
      contentHash: profile.contentHash,
      invocation: profile.invocation,
      createdAt: now,
    });
    let stored: ExperimentEvaluationSession | null;
    try {
      stored = await this.dependencies.storage.createExperimentEvaluationSessionFromProfile({
        session,
        revision,
        profileId: profile.id,
        usedAt: now,
      });
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!stored) throw new ExperimentEvaluationServiceError('experiment_evaluation_unavailable');
    this.publish(command.projectId, stored.id, 'session', stored.id, now);
    return ExperimentEvaluationSessionDetailSchema.parse({
      schemaVersion: 1,
      session: stored,
      messages: [],
      currentRevision: revision,
    });
  }

  private routeNotification(notification: CodexNotification) {
    const identity = notificationIdentity(notification);
    if (!identity) return;
    const pending = this.pendingByThread.get(identity.threadId);
    if (!pending) return;
    if (pending.turnId === null) {
      const buffered = this.bufferedByThread.get(identity.threadId) ?? {
        finalMessage: null,
        terminal: null,
      };
      if (notification.method === 'item/completed' && isRecord(notification.params)) {
        const item = notification.params.item;
        if (
          isRecord(item) &&
          item.type === 'agentMessage' &&
          item.phase !== 'commentary' &&
          typeof item.text === 'string'
        ) {
          buffered.finalMessage = notification;
        }
      }
      if (notification.method === 'turn/completed') buffered.terminal = notification;
      this.bufferedByThread.set(identity.threadId, buffered);
      return;
    }
    if (pending.turnId !== identity.turnId) return;
    this.processNotification(pending, notification);
  }

  private processNotification(pending: PendingTurn, notification: CodexNotification) {
    if (pending.settled || !isRecord(notification.params)) return;
    const identity = notificationIdentity(notification);
    if (!identity || identity.threadId !== pending.threadId || identity.turnId !== pending.turnId) {
      return;
    }
    if (notification.method === 'item/completed') {
      const item = notification.params.item;
      if (
        isRecord(item) &&
        item.type === 'agentMessage' &&
        item.phase !== 'commentary' &&
        typeof item.text === 'string'
      ) {
        pending.finalText = item.text;
        this.maybeResolvePending(pending);
      }
      return;
    }
    if (notification.method !== 'turn/completed') return;
    const turn = notification.params.turn;
    pending.terminalStatus =
      isRecord(turn) && typeof turn.status === 'string' ? turn.status : 'failed';
    this.maybeResolvePending(pending);
  }

  private maybeResolvePending(pending: PendingTurn, graceExpired = false) {
    if (pending.settled || pending.terminalStatus === null) return;
    const needsFinalMessage = pending.terminalStatus === 'completed' && pending.finalText === null;
    if (needsFinalMessage && !graceExpired) {
      if (!pending.graceTimer) {
        pending.graceTimer = setTimeout(() => this.maybeResolvePending(pending, true), 1_000);
        pending.graceTimer.unref?.();
      }
      return;
    }
    if (pending.graceTimer) clearTimeout(pending.graceTimer);
    pending.graceTimer = null;
    pending.settled = true;
    pending.resolve({ status: pending.terminalStatus, text: pending.finalText });
  }

  private async requireActiveProject(projectId: string) {
    const snapshot = await this.dependencies.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_project_not_found');
    }
    if (project.archivedAt || project.trashedAt) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_project_unavailable');
    }
    return { project, snapshot };
  }

  private throwIfCancelled(active: ActiveEvaluationTurn) {
    if (active.cancelRequested) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_interrupted');
    }
  }

  private async requireSession(projectId: string, sessionId: string) {
    const session = await this.dependencies.storage.getExperimentEvaluationSession(
      projectId,
      sessionId,
    );
    if (!session) {
      throw new ExperimentEvaluationServiceError('experiment_evaluation_session_not_found');
    }
    return ExperimentEvaluationSessionSchema.parse(session);
  }

  private normalizeStorageError(error: unknown) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    const message = error instanceof Error ? error.message : '';
    if (code.includes('limit') || message.includes('limit')) {
      return new ExperimentEvaluationServiceError('experiment_evaluation_capacity_reached');
    }
    return new ExperimentEvaluationServiceError('experiment_evaluation_unavailable');
  }

  private publish(
    projectId: string,
    sessionId: string,
    entityType: ExperimentEvaluationEvent['entityType'],
    entityId: string,
    occurredAt: string,
  ) {
    const event = ExperimentEvaluationEventSchema.parse({
      schemaVersion: 1,
      type: 'experiment.evaluation.changed',
      projectId,
      sessionId,
      entityType,
      entityId,
      occurredAt,
    });
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Renderer notification failures must not alter the persisted session state.
      }
    }
  }

  private now() {
    return this.dependencies.now?.() ?? new Date();
  }
}
