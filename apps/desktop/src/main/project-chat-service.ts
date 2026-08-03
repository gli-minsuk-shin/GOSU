import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';

import {
  ApplyProjectChatActionInputSchema,
  CodexProjectResponseSchema,
  PROJECT_CHAT_OUTPUT_SCHEMA,
  ProjectChatProjectInputSchema,
  ProjectChatSnapshotSchema,
  ProjectChatTurnReceiptSchema,
  SendProjectChatMessageInputSchema,
  UpdateProjectChatProfileInputSchema,
  type ApplyProjectChatActionInput,
  type ProjectChatAction,
  type ProjectChatActionCommand,
  type ProjectChatAttempt,
  type ProjectChatEvent,
  type ProjectChatMessage,
  type ProjectChatProfile,
  type ProjectChatProjectInput,
  type ProjectChatSnapshot,
  type ProjectChatTurnReceipt,
  type SendProjectChatMessageInput,
  type UpdateProjectChatProfileInput,
} from '../shared/project-chat-contracts';
import { assembleProjectChatPrompt } from './project-chat-prompt';
import { WorkspaceServiceError, type WorkspaceService } from './workspace-service';

export { buildProjectChatPrompt } from './project-chat-prompt';

type MaybePromise<T> = T | Promise<T>;

export interface ProjectChatStorage {
  beginChatAttempt(
    attempt: ProjectChatAttempt,
    userMessage: ProjectChatMessage,
  ): MaybePromise<void>;
  markChatAttemptRunning(attempt: ProjectChatAttempt): MaybePromise<void>;
  finishChatAttempt(
    attempt: ProjectChatAttempt,
    assistantMessage: ProjectChatMessage,
  ): MaybePromise<void>;
  getChatAttempt(projectId: string, attemptId: string): MaybePromise<ProjectChatAttempt | null>;
  snapshot(projectId: string): MaybePromise<ProjectChatSnapshot>;
  getProjectChatProfile(projectId: string): MaybePromise<ProjectChatProfile>;
  updateProjectChatProfile(
    input: UpdateProjectChatProfileInput,
  ): MaybePromise<ProjectChatProfile | null>;
  getAction(projectId: string, actionId: string): MaybePromise<ProjectChatAction | null>;
  claimAction(projectId: string, actionId: string, updatedAt: string): MaybePromise<boolean>;
  finishAction(action: ProjectChatAction): MaybePromise<void>;
}

export interface ProjectChatCodex {
  on: EventEmitter['on'];
  startThread(input: {
    cwd: string;
    modelId: string | null;
    developerInstructions?: string;
  }): Promise<{ threadId: string }>;
  runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
    cwd: string;
    clientUserMessageId?: string;
    outputSchema?: Readonly<Record<string, unknown>>;
  }): Promise<{ turnId: string; invocation: ModelInvocation }>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  releaseThread(threadId: string): Promise<void>;
}

export class ProjectChatServiceError extends Error {
  constructor(
    readonly code:
      | 'project_not_found'
      | 'project_trashed'
      | 'chat_busy'
      | 'chat_not_active'
      | 'chat_attempt_not_found'
      | 'chat_attempt_not_retryable'
      | 'chat_profile_conflict'
      | 'action_not_found'
      | 'action_not_proposed'
      | 'codex_unavailable',
  ) {
    super(code);
    this.name = 'ProjectChatServiceError';
  }
}

type CodexNotification = Readonly<{ method?: string; params?: unknown }>;

type ActiveTurn = {
  projectId: string;
  attempt: ProjectChatAttempt;
  threadId: string;
  turnId: string;
  invocation: ModelInvocation;
  finalResponseText: string | null;
  terminal: boolean;
};

const FAILURE_COPY = {
  unavailable: 'Codex could not complete this turn. Check the local connection and try again.',
  invalid: 'Codex returned an invalid project response. Please try the request again.',
  interrupted: 'This Codex turn was stopped.',
  persistence:
    'GOSU recovered this turn after its first completion receipt could not be saved. Retry when ready.',
  interruptUnconfirmed:
    'GOSU could not confirm that this Codex turn stopped after registration failed. Check the local Codex connection before retrying.',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isoNow() {
  return new Date().toISOString();
}

function modelProvenance(invocation: ModelInvocation) {
  return {
    invocationId: invocation.invocationId,
    requestedModelId: invocation.requestedModelId,
    resolvedModelId: invocation.resolvedModelId,
    catalogVersion: invocation.catalogVersion,
    reasoningOptionId: invocation.reasoningOptionId,
  };
}

function completedAttemptHistory(snapshot: ProjectChatSnapshot) {
  const failedLegacyUserMessageIds = new Set<string>();
  for (let index = 1; index < snapshot.messages.length; index += 1) {
    const assistant = snapshot.messages[index];
    const precedingUser = snapshot.messages[index - 1];
    if (
      assistant?.attemptId === undefined &&
      assistant?.role === 'assistant' &&
      assistant.status !== 'complete' &&
      precedingUser?.attemptId === undefined &&
      precedingUser?.role === 'user'
    ) {
      failedLegacyUserMessageIds.add(precedingUser.id);
    }
  }
  const completedAttemptIds = new Set(
    (snapshot.attempts ?? [])
      .filter((attempt) => attempt.status === 'complete')
      .map((attempt) => attempt.id),
  );
  return snapshot.messages.filter((message) =>
    message.attemptId === undefined
      ? !failedLegacyUserMessageIds.has(message.id)
      : completedAttemptIds.has(message.attemptId),
  );
}

export function parseCodexProjectResponse(value: string) {
  try {
    return CodexProjectResponseSchema.parse(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function notificationIdentity(notification: CodexNotification) {
  if (!isRecord(notification.params)) return null;
  const threadId = notification.params.threadId;
  const turn = notification.params.turn;
  const turnId =
    typeof notification.params.turnId === 'string'
      ? notification.params.turnId
      : isRecord(turn) && typeof turn.id === 'string'
        ? turn.id
        : undefined;
  return typeof threadId === 'string' && typeof turnId === 'string' ? { threadId, turnId } : null;
}

function actionErrorCode(error: unknown): ProjectChatAction['errorCode'] {
  if (error instanceof WorkspaceServiceError) {
    if (
      error.code === 'version_conflict' ||
      error.code === 'task_not_found' ||
      error.code === 'cross_project_access_denied'
    ) {
      return error.code;
    }
  }
  return 'action_failed';
}

export class ProjectChatService extends EventEmitter {
  private readonly activeByTurn = new Map<string, ActiveTurn>();
  private readonly activeTurnByProject = new Map<string, string>();
  private readonly threadProjects = new Map<string, string>();
  private readonly startingProjects = new Set<string>();
  private readonly trashLockedProjects = new Set<string>();
  private readonly mutatingProjects = new Set<string>();
  private readonly earlyNotifications = new Map<string, CodexNotification[]>();
  private actionTail: Promise<void> = Promise.resolve();
  private codexConnectionEpoch = 0;

  constructor(
    private readonly dependencies: {
      storage: ProjectChatStorage;
      workspace: WorkspaceService;
      codex: ProjectChatCodex;
      prepareProjectDirectory(projectId: string): Promise<string>;
    },
  ) {
    super();
    dependencies.codex.on('notification', (notification: CodexNotification) =>
      this.routeNotification(notification),
    );
    dependencies.codex.on(
      'invocation',
      (event: { threadId?: string; turnId?: string; invocation?: ModelInvocation }) => {
        if (!event.threadId || !event.turnId || !event.invocation) return;
        const active = this.activeByTurn.get(event.turnId);
        if (active?.threadId === event.threadId) active.invocation = event.invocation;
      },
    );
    dependencies.codex.on('disconnected', () => {
      this.codexConnectionEpoch += 1;
      this.threadProjects.clear();
      this.earlyNotifications.clear();
      for (const active of this.activeByTurn.values()) this.beginFinalize(active, 'failed');
    });
  }

  async snapshot(input: ProjectChatProjectInput) {
    const command = ProjectChatProjectInputSchema.parse(input);
    await this.requireProject(command.projectId);
    const [stored, profile] = await Promise.all([
      this.dependencies.storage.snapshot(command.projectId),
      this.dependencies.storage.getProjectChatProfile(command.projectId),
    ]);
    const activeTurnId = this.activeTurnByProject.get(command.projectId);
    return ProjectChatSnapshotSchema.parse({
      ...stored,
      profile,
      ...(activeTurnId ? { activeTurnId } : {}),
    });
  }

  async updateProfile(input: UpdateProjectChatProfileInput) {
    const command = UpdateProjectChatProfileInputSchema.parse(input);
    return this.runProjectChatMutation(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      const updated = await this.dependencies.storage.updateProjectChatProfile(command);
      if (!updated) throw new ProjectChatServiceError('chat_profile_conflict');
      return updated;
    });
  }

  async runWhenProjectChatIdle<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (
      this.trashLockedProjects.has(projectId) ||
      this.mutatingProjects.has(projectId) ||
      this.startingProjects.has(projectId) ||
      this.activeTurnByProject.has(projectId)
    ) {
      throw new ProjectChatServiceError('chat_busy');
    }
    this.trashLockedProjects.add(projectId);
    try {
      return await operation();
    } finally {
      this.trashLockedProjects.delete(projectId);
    }
  }

  async send(input: SendProjectChatMessageInput): Promise<ProjectChatTurnReceipt> {
    const command = SendProjectChatMessageInputSchema.parse(input);
    if (
      this.trashLockedProjects.has(command.projectId) ||
      this.mutatingProjects.has(command.projectId) ||
      this.startingProjects.has(command.projectId) ||
      this.activeTurnByProject.has(command.projectId)
    ) {
      throw new ProjectChatServiceError('chat_busy');
    }
    this.startingProjects.add(command.projectId);
    try {
      const snapshot = await this.dependencies.workspace.snapshot();
      const project = snapshot.projects.find((candidate) => candidate.id === command.projectId);
      if (!project) throw new ProjectChatServiceError('project_not_found');
      if (project.trashedAt !== undefined) throw new ProjectChatServiceError('project_trashed');
      const [priorChat, profile] = await Promise.all([
        this.dependencies.storage.snapshot(command.projectId),
        this.dependencies.storage.getProjectChatProfile(command.projectId),
      ]);
      if (command.profileVersion !== undefined && command.profileVersion !== profile.version) {
        throw new ProjectChatServiceError('chat_profile_conflict');
      }
      if (command.retryOfAttemptId) {
        const retryTarget = await this.dependencies.storage.getChatAttempt(
          command.projectId,
          command.retryOfAttemptId,
        );
        if (!retryTarget) throw new ProjectChatServiceError('chat_attempt_not_found');
        if (retryTarget.status !== 'failed' && retryTarget.status !== 'interrupted') {
          throw new ProjectChatServiceError('chat_attempt_not_retryable');
        }
      }

      const harnessMode = command.harnessMode ?? profile.harnessMode;
      const responseDepth = command.responseDepth ?? profile.responseDepth;
      const contextScope = command.contextScope ?? profile.contextScope;
      const assembled = assembleProjectChatPrompt({
        snapshot,
        projectId: command.projectId,
        message: command.message,
        priorMessages: completedAttemptHistory(priorChat),
        harnessMode,
        responseDepth,
        contextScope,
        profileVersion: profile.version,
        instructionRevisionId: profile.instructionRevision?.id ?? null,
        customInstructions: profile.customInstructions,
      });

      const createdAt = isoNow();
      const attemptId = randomUUID();
      const userMessage: ProjectChatMessage = {
        id: randomUUID(),
        projectId: command.projectId,
        role: 'user',
        content: command.message,
        status: 'complete',
        attemptId,
        actions: [],
        createdAt,
        completedAt: createdAt,
      };
      const startingAttempt: ProjectChatAttempt = {
        id: attemptId,
        projectId: command.projectId,
        userMessageId: userMessage.id,
        ...(command.retryOfAttemptId ? { retryOfAttemptId: command.retryOfAttemptId } : {}),
        requestedModelId: command.requestedModelId,
        reasoningOptionId: command.reasoningOptionId,
        harnessMode,
        responseDepth,
        contextScope,
        profileVersion: profile.version,
        instructionRevisionId: profile.instructionRevision?.id ?? null,
        promptProvenance: assembled.provenance,
        status: 'starting',
        createdAt,
        updatedAt: createdAt,
      };
      await this.dependencies.storage.beginChatAttempt(startingAttempt, userMessage);

      let ephemeralThreadId: string | undefined;
      let ephemeralTurnId: string | undefined;
      let currentAttempt = startingAttempt;
      let activeRegistered = false;
      let connectionEpoch: number | undefined;
      try {
        const cwd = await this.dependencies.prepareProjectDirectory(command.projectId);
        const threadId = await this.startEphemeralThread(
          command.projectId,
          cwd,
          command.requestedModelId,
          assembled.developerInstructions,
        );
        ephemeralThreadId = threadId;
        connectionEpoch = this.codexConnectionEpoch;
        const result = await this.dependencies.codex.runTurn({
          threadId,
          prompt: assembled.prompt,
          requestedModelId: command.requestedModelId,
          reasoningOptionId: command.reasoningOptionId,
          cwd,
          clientUserMessageId: userMessage.id,
          outputSchema: PROJECT_CHAT_OUTPUT_SCHEMA,
        });
        ephemeralTurnId = result.turnId;
        if (connectionEpoch !== this.codexConnectionEpoch) {
          throw new Error('codex_connection_changed_during_turn_start');
        }
        const runningAttempt: ProjectChatAttempt = {
          ...startingAttempt,
          threadId,
          turnId: result.turnId,
          model: modelProvenance(result.invocation),
          status: 'running',
          updatedAt: isoNow(),
        };
        currentAttempt = runningAttempt;
        await this.dependencies.storage.markChatAttemptRunning(runningAttempt);
        if (connectionEpoch !== this.codexConnectionEpoch) {
          throw new Error('codex_connection_changed_during_turn_registration');
        }
        const active: ActiveTurn = {
          projectId: command.projectId,
          attempt: runningAttempt,
          threadId,
          turnId: result.turnId,
          invocation: result.invocation,
          finalResponseText: null,
          terminal: false,
        };
        this.activeByTurn.set(result.turnId, active);
        this.activeTurnByProject.set(command.projectId, result.turnId);
        activeRegistered = true;
        this.emitEvent({
          type: 'turn.started',
          projectId: command.projectId,
          turnId: result.turnId,
        });
        const buffered = this.earlyNotifications.get(result.turnId) ?? [];
        this.earlyNotifications.delete(result.turnId);
        for (const notification of buffered) this.processNotification(active, notification);
        return ProjectChatTurnReceiptSchema.parse({
          projectId: command.projectId,
          attemptId,
          userMessageId: userMessage.id,
          turnId: result.turnId,
        });
      } catch (error) {
        let interruptUnconfirmed = false;
        if (
          !activeRegistered &&
          ephemeralThreadId &&
          ephemeralTurnId &&
          connectionEpoch === this.codexConnectionEpoch
        ) {
          try {
            await this.dependencies.codex.interruptTurn(ephemeralThreadId, ephemeralTurnId);
          } catch {
            interruptUnconfirmed = true;
          }
        }
        if (ephemeralThreadId) {
          this.threadProjects.delete(ephemeralThreadId);
          void this.dependencies.codex.releaseThread(ephemeralThreadId).catch(() => undefined);
        }
        if (ephemeralTurnId) this.earlyNotifications.delete(ephemeralTurnId);
        if (!activeRegistered) {
          await this.finishAttemptBeforeTurn(
            currentAttempt,
            interruptUnconfirmed ? FAILURE_COPY.interruptUnconfirmed : FAILURE_COPY.unavailable,
            interruptUnconfirmed ? 'application_interrupted' : 'codex_unavailable',
          );
        }
        if (error instanceof ProjectChatServiceError) throw error;
        throw new ProjectChatServiceError('codex_unavailable');
      }
    } finally {
      this.startingProjects.delete(command.projectId);
    }
  }

  async cancel(input: ProjectChatProjectInput) {
    const command = ProjectChatProjectInputSchema.parse(input);
    const turnId = this.activeTurnByProject.get(command.projectId);
    const active = turnId ? this.activeByTurn.get(turnId) : undefined;
    if (!active) throw new ProjectChatServiceError('chat_not_active');
    await this.dependencies.codex.interruptTurn(active.threadId, active.turnId);
    return { accepted: true } as const;
  }

  applyAction(input: ApplyProjectChatActionInput): Promise<ProjectChatAction> {
    const command = ApplyProjectChatActionInputSchema.parse(input);
    const result = this.actionTail.then(() => this.applyActionInternal(command));
    this.actionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async applyActionInternal(command: ApplyProjectChatActionInput) {
    return this.runProjectChatMutation(command.projectId, () =>
      this.applyActionWithProjectLock(command),
    );
  }

  private async applyActionWithProjectLock(command: ApplyProjectChatActionInput) {
    await this.requireActiveProject(command.projectId);
    let action = await this.dependencies.storage.getAction(command.projectId, command.actionId);
    if (!action) throw new ProjectChatServiceError('action_not_found');
    if (action.status === 'applied' || action.status === 'failed') return action;
    if (action.status !== 'proposed') throw new ProjectChatServiceError('action_not_proposed');
    const claimedAt = isoNow();
    if (!(await this.dependencies.storage.claimAction(action.projectId, action.id, claimedAt))) {
      action = await this.dependencies.storage.getAction(command.projectId, command.actionId);
      if (action?.status === 'applied' || action?.status === 'failed') return action;
      throw new ProjectChatServiceError('action_not_proposed');
    }

    let result: Awaited<ReturnType<WorkspaceService['createTask']>>;
    try {
      result =
        action.command.type === 'task.create'
          ? await this.dependencies.workspace.createTask({
              projectId: action.projectId,
              title: action.command.title,
              status: action.command.status,
            })
          : await this.dependencies.workspace.updateTask({
              projectId: action.projectId,
              taskId: action.command.taskId,
              expectedVersion: action.command.expectedVersion,
              ...(action.command.title === undefined ? {} : { title: action.command.title }),
              ...(action.command.status === undefined ? {} : { status: action.command.status }),
            });
    } catch (error) {
      const failed: ProjectChatAction = {
        ...action,
        status: 'failed',
        errorCode: actionErrorCode(error),
        updatedAt: isoNow(),
      };
      await this.dependencies.storage.finishAction(failed);
      this.emitEvent({
        type: 'action.updated',
        projectId: action.projectId,
        action: failed,
        workspaceChanged: false,
      });
      return failed;
    }

    const applied: ProjectChatAction = {
      ...action,
      status: 'applied',
      resultEntityId: result.id,
      resultEntityVersion: result.version,
      updatedAt: isoNow(),
    };
    try {
      await this.dependencies.storage.finishAction(applied);
      this.emitEvent({
        type: 'action.updated',
        projectId: action.projectId,
        action: applied,
        workspaceChanged: true,
      });
      return applied;
    } catch {
      // The board mutation is already durable. Preserve that fact instead of reporting a false
      // application failure that could invite a duplicate retry.
      const interrupted: ProjectChatAction = {
        ...applied,
        status: 'failed',
        errorCode: 'application_interrupted',
        updatedAt: isoNow(),
      };
      await this.dependencies.storage.finishAction(interrupted);
      this.emitEvent({
        type: 'action.updated',
        projectId: action.projectId,
        action: interrupted,
        workspaceChanged: true,
      });
      return interrupted;
    }
  }

  private async startEphemeralThread(
    projectId: string,
    cwd: string,
    modelId: string | null,
    developerInstructions: string,
  ) {
    const started = await this.dependencies.codex.startThread({
      cwd,
      modelId,
      developerInstructions,
    });
    this.threadProjects.set(started.threadId, projectId);
    return started.threadId;
  }

  private routeNotification(notification: CodexNotification) {
    const identity = notificationIdentity(notification);
    if (!identity) return;
    const projectId = this.threadProjects.get(identity.threadId);
    if (projectId === undefined) return;
    const active = this.activeByTurn.get(identity.turnId);
    if (active) {
      if (active.threadId !== identity.threadId || active.projectId !== projectId) return;
      this.processNotification(active, notification);
      return;
    }
    if (!this.startingProjects.has(projectId)) return;
    const current = this.earlyNotifications.get(identity.turnId) ?? [];
    if (current.length < 100) {
      current.push(notification);
      this.earlyNotifications.set(identity.turnId, current);
    }
  }

  private processNotification(active: ActiveTurn, notification: CodexNotification) {
    if (active.terminal || !isRecord(notification.params)) return;
    if (notification.method === 'item/completed') {
      const item = notification.params.item;
      if (
        isRecord(item) &&
        item.type === 'agentMessage' &&
        item.phase !== 'commentary' &&
        typeof item.text === 'string'
      ) {
        active.finalResponseText = item.text;
      }
      return;
    }
    if (notification.method !== 'turn/completed') return;
    const turn = notification.params.turn;
    const status = isRecord(turn) ? turn.status : undefined;
    this.beginFinalize(
      active,
      status === 'completed' || status === 'interrupted' ? status : 'failed',
    );
  }

  private beginFinalize(active: ActiveTurn, status: 'completed' | 'interrupted' | 'failed') {
    if (active.terminal) return;
    active.terminal = true;
    void this.persistTerminal(active, status)
      .then((persistedStatus) => this.clearActive(active, persistedStatus))
      .catch(async () => {
        try {
          await this.saveAssistant(
            active,
            'interrupted',
            FAILURE_COPY.persistence,
            [],
            'application_interrupted',
          );
          this.clearActive(active, 'interrupted');
        } catch {
          this.clearActive(active, 'failed');
        }
      });
  }

  private async persistTerminal(
    active: ActiveTurn,
    status: 'completed' | 'interrupted' | 'failed',
  ): Promise<'complete' | 'failed' | 'interrupted'> {
    if (status === 'completed') return this.finishCompleted(active);
    if (status === 'interrupted') return this.finishInterrupted(active);
    return this.finishFailed(active);
  }

  private async finishCompleted(active: ActiveTurn): Promise<'complete' | 'failed'> {
    const response = active.finalResponseText
      ? parseCodexProjectResponse(active.finalResponseText)
      : null;
    if (!response) {
      await this.saveAssistant(active, 'failed', FAILURE_COPY.invalid, [], 'invalid_response');
      return 'failed';
    }
    const snapshot = await this.dependencies.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === active.projectId);
    const taskIds = new Set(
      snapshot.tasks.filter((task) => task.projectId === active.projectId).map((task) => task.id),
    );
    const commands =
      project?.trashedAt !== undefined || active.attempt.harnessMode === 'reviewer'
        ? []
        : response.actions.filter(
            (action) => action.type === 'task.create' || taskIds.has(action.taskId),
          );
    await this.saveAssistant(active, 'complete', response.reply, commands);
    return 'complete';
  }

  private async finishInterrupted(active: ActiveTurn): Promise<'interrupted'> {
    await this.saveAssistant(
      active,
      'interrupted',
      FAILURE_COPY.interrupted,
      [],
      'user_interrupted',
    );
    return 'interrupted';
  }

  private async finishFailed(active: ActiveTurn): Promise<'failed'> {
    await this.saveAssistant(active, 'failed', FAILURE_COPY.unavailable, [], 'codex_unavailable');
    return 'failed';
  }

  private async saveAssistant(
    active: ActiveTurn,
    status: ProjectChatMessage['status'],
    content: string,
    commands: readonly ProjectChatActionCommand[],
    errorCode?: ProjectChatAttempt['errorCode'],
  ) {
    const completedAt = isoNow();
    const messageId = randomUUID();
    const actions: ProjectChatAction[] = commands.map((command) => ({
      id: randomUUID(),
      projectId: active.projectId,
      messageId,
      command,
      status: 'proposed',
      createdAt: completedAt,
      updatedAt: completedAt,
    }));
    const model = modelProvenance(active.invocation);
    const terminalAttempt: ProjectChatAttempt = {
      ...active.attempt,
      model,
      status,
      ...(errorCode ? { errorCode } : {}),
      updatedAt: completedAt,
    };
    await this.dependencies.storage.finishChatAttempt(terminalAttempt, {
      id: messageId,
      projectId: active.projectId,
      role: 'assistant',
      content,
      status,
      attemptId: active.attempt.id,
      turnId: active.turnId,
      model,
      actions,
      createdAt: active.invocation.startedAt,
      completedAt,
    });
  }

  private async finishAttemptBeforeTurn(
    attempt: ProjectChatAttempt,
    content: string,
    errorCode: NonNullable<ProjectChatAttempt['errorCode']>,
  ) {
    const now = isoNow();
    await this.dependencies.storage.finishChatAttempt(
      {
        ...attempt,
        status: 'failed',
        errorCode,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        projectId: attempt.projectId,
        role: 'assistant',
        content,
        status: 'failed',
        attemptId: attempt.id,
        ...(attempt.turnId ? { turnId: attempt.turnId } : {}),
        ...(attempt.model ? { model: attempt.model } : {}),
        actions: [],
        createdAt: now,
        completedAt: now,
      },
    );
  }

  private clearActive(active: ActiveTurn, status: 'complete' | 'failed' | 'interrupted') {
    this.activeByTurn.delete(active.turnId);
    this.threadProjects.delete(active.threadId);
    if (this.activeTurnByProject.get(active.projectId) === active.turnId) {
      this.activeTurnByProject.delete(active.projectId);
    }
    this.earlyNotifications.delete(active.turnId);
    void this.dependencies.codex.releaseThread(active.threadId).catch(() => undefined);
    this.emitEvent({
      type: 'turn.completed',
      projectId: active.projectId,
      turnId: active.turnId,
      status,
    });
  }

  private async requireProject(projectId: string) {
    const snapshot = await this.dependencies.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new ProjectChatServiceError('project_not_found');
    return project;
  }

  private async requireActiveProject(projectId: string) {
    const project = await this.requireProject(projectId);
    if (project.trashedAt !== undefined) throw new ProjectChatServiceError('project_trashed');
    return project;
  }

  private async runProjectChatMutation<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.trashLockedProjects.has(projectId) || this.mutatingProjects.has(projectId)) {
      throw new ProjectChatServiceError('chat_busy');
    }
    this.mutatingProjects.add(projectId);
    try {
      return await operation();
    } finally {
      this.mutatingProjects.delete(projectId);
    }
  }

  private emitEvent(event: ProjectChatEvent) {
    try {
      this.emit('event', event);
    } catch {
      // A renderer/observability listener must not break chat state cleanup or action receipts.
    }
  }
}
