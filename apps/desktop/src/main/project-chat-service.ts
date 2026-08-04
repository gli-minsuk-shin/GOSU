import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';

import {
  ApplyProjectChatActionInputSchema,
  CodexProjectResponseSchema,
  PROJECT_CHAT_OUTPUT_SCHEMA,
  PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH,
  ProjectChatProjectInputSchema,
  ProjectChatSnapshotSchema,
  ProjectChatTurnReceiptSchema,
  SendProjectChatMessageInputSchema,
  UpdateProjectChatProfileInputSchema,
  legacyDepthToResponseVerbosity,
  legacyHarnessToCollaborationModeId,
  type ApplyProjectChatActionInput,
  type CodexCollaborationModeCatalog,
  type CodexCollaborationModeDescriptor,
  type ProjectChatAction,
  type ProjectChatActionCommand,
  type ProjectChatAttempt,
  type ProjectChatEvent,
  type ProjectChatMessage,
  type ProjectChatNativeExecutionKind,
  type ProjectChatProfile,
  type ProjectChatProjectInput,
  type ProjectChatSnapshot,
  type ProjectChatTurnReceipt,
  type SendProjectChatMessageInput,
  type UpdateProjectChatProfileInput,
} from '../shared/project-chat-contracts';
import type {
  CodexDynamicToolHandler,
  CodexDynamicToolSpec,
  CodexPersonality,
  CodexResponseVerbosity,
} from './codex-app-server';
import { ProjectAgentToolSession, type ProjectAgentVault } from './project-agent-tools';
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
  listCollaborationModeCatalog(): Promise<CodexCollaborationModeCatalog>;
  startThread(input: {
    cwd: string;
    modelId: string | null;
    developerInstructions?: string;
    responseVerbosity?: CodexResponseVerbosity | null;
    dynamicTools?: readonly CodexDynamicToolSpec[];
    dynamicToolHandler?: CodexDynamicToolHandler;
  }): Promise<{ threadId: string }>;
  runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
    cwd: string;
    clientUserMessageId?: string;
    outputSchema?: Readonly<Record<string, unknown>>;
    collaborationModeId?: string | null;
    expectedCollaborationModeCatalogVersion?: string | null;
    personality?: CodexPersonality | null;
  }): Promise<{
    turnId: string;
    invocation: ModelInvocation;
    collaborationMode?: CodexCollaborationModeDescriptor | null;
    effectiveReasoningOptionId?: string | null;
    personality?: CodexPersonality | null;
  }>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  revokeDynamicTools(threadId: string): void;
  releaseThread(threadId: string): Promise<void>;
}

export class ProjectChatServiceError extends Error {
  constructor(
    readonly code:
      | 'project_not_found'
      | 'project_archived'
      | 'project_trashed'
      | 'chat_busy'
      | 'chat_not_active'
      | 'chat_attempt_not_found'
      | 'chat_attempt_not_retryable'
      | 'chat_profile_conflict'
      | 'local_notes_vault_not_selected'
      | 'local_notes_vault_changed'
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
  agentTools: ProjectAgentToolSession;
  terminal: boolean;
};

const UNAVAILABLE_AGENT_VAULT: ProjectAgentVault = {
  descriptor: () => null,
  matchesGrant: () => false,
  listForAgent: () => Promise.reject(new Error('vault_not_selected')),
  readForAgent: () => Promise.reject(new Error('vault_not_selected')),
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

function legacyHarnessForNativeMode(collaborationModeId: string | null) {
  return collaborationModeId === 'plan' ? ('planner' as const) : ('context' as const);
}

function nativeExecutionKind(
  collaborationModeId: string | null,
  legacyReviewerCompatibility: boolean,
): ProjectChatNativeExecutionKind {
  if (legacyReviewerCompatibility) return 'legacy-reviewer';
  return collaborationModeId === 'plan' ? 'plan' : 'default';
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

function appendSourceProvenance(reply: string, appendix: string) {
  if (!appendix) return reply;
  const safeAppendix = appendix.slice(0, PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH - 1);
  const replyBudget = PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH - safeAppendix.length;
  return `${reply.slice(0, Math.max(1, replyBudget))}${safeAppendix}`;
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
  private readonly lifecycleLockedProjects = new Set<string>();
  private readonly mutatingProjects = new Set<string>();
  private readonly earlyNotifications = new Map<string, CodexNotification[]>();
  private actionTail: Promise<void> = Promise.resolve();
  private codexConnectionEpoch = 0;

  constructor(
    private readonly dependencies: {
      storage: ProjectChatStorage;
      workspace: WorkspaceService;
      codex: ProjectChatCodex;
      vault?: ProjectAgentVault;
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
    if (
      this.startingProjects.has(command.projectId) ||
      this.activeTurnByProject.has(command.projectId)
    ) {
      throw new ProjectChatServiceError('chat_busy');
    }
    return this.runProjectChatMutation(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      if (command.localNotesVault) {
        const selectedVault = this.dependencies.vault?.descriptor() ?? null;
        if (!selectedVault) {
          throw new ProjectChatServiceError('local_notes_vault_not_selected');
        }
        if (
          selectedVault.id !== command.localNotesVault.id ||
          selectedVault.name !== command.localNotesVault.name
        ) {
          throw new ProjectChatServiceError('local_notes_vault_changed');
        }
      }
      const updated = await this.dependencies.storage.updateProjectChatProfile(command);
      if (!updated) throw new ProjectChatServiceError('chat_profile_conflict');
      return updated;
    });
  }

  async runWhenProjectChatIdle<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (
      this.lifecycleLockedProjects.has(projectId) ||
      this.mutatingProjects.has(projectId) ||
      this.startingProjects.has(projectId) ||
      this.activeTurnByProject.has(projectId)
    ) {
      throw new ProjectChatServiceError('chat_busy');
    }
    this.lifecycleLockedProjects.add(projectId);
    try {
      return await operation();
    } finally {
      this.lifecycleLockedProjects.delete(projectId);
    }
  }

  async send(input: SendProjectChatMessageInput): Promise<ProjectChatTurnReceipt> {
    const hasExplicitNativeModeSelection = input.collaborationModeId !== undefined;
    const command = SendProjectChatMessageInputSchema.parse(input);
    if (
      this.lifecycleLockedProjects.has(command.projectId) ||
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
      if (project.archivedAt !== undefined) throw new ProjectChatServiceError('project_archived');
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

      const legacyReviewerCompatibility =
        !hasExplicitNativeModeSelection &&
        (profile.harnessMode === 'reviewer' || command.harnessMode === 'reviewer');
      const requestedHarnessMode = legacyReviewerCompatibility
        ? 'reviewer'
        : (command.harnessMode ?? profile.harnessMode);
      const collaborationModeId = hasExplicitNativeModeSelection
        ? (command.collaborationModeId ?? null)
        : command.harnessMode !== undefined
          ? legacyHarnessToCollaborationModeId(command.harnessMode)
          : profile.collaborationModeId;
      const harnessMode = hasExplicitNativeModeSelection
        ? legacyHarnessForNativeMode(collaborationModeId)
        : requestedHarnessMode;
      const resolvedCollaborationModeId = legacyReviewerCompatibility ? null : collaborationModeId;
      const responseDepth = command.responseDepth ?? profile.responseDepth;
      const personality = command.personality ?? profile.personality;
      const responseVerbosity =
        command.responseVerbosity ??
        (command.responseDepth === undefined
          ? profile.responseVerbosity
          : legacyDepthToResponseVerbosity(command.responseDepth));
      const contextScope = command.contextScope ?? profile.contextScope;
      let collaborationModeCatalog: CodexCollaborationModeCatalog;
      try {
        collaborationModeCatalog = await this.dependencies.codex.listCollaborationModeCatalog();
      } catch {
        throw new ProjectChatServiceError('codex_unavailable');
      }
      const collaborationMode = resolvedCollaborationModeId
        ? (collaborationModeCatalog.modes.find(
            (candidate) => candidate.id === resolvedCollaborationModeId,
          ) ?? null)
        : null;
      if (resolvedCollaborationModeId && !collaborationMode) {
        // A saved opaque mode is never silently replaced after the provider removes it.
        throw new ProjectChatServiceError('codex_unavailable');
      }
      const effectiveReasoningOptionId =
        command.reasoningOptionId ?? collaborationMode?.recommendedReasoningOptionId ?? null;
      const executionKind = nativeExecutionKind(
        resolvedCollaborationModeId,
        legacyReviewerCompatibility,
      );
      const agentTools = new ProjectAgentToolSession({
        projectId: command.projectId,
        workspace: this.dependencies.workspace,
        vault: this.dependencies.vault ?? UNAVAILABLE_AGENT_VAULT,
        localNotesVault: profile.localNotesVault ?? null,
      });
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
        toolCatalogSha256: agentTools.catalogSha256,
        localNotesVaultId:
          agentTools.localNotesAvailable && profile.localNotesVault
            ? profile.localNotesVault.id
            : null,
        nativeCollaborationModeId: resolvedCollaborationModeId,
        nativeExecutionKind: executionKind,
        nativeCollaborationCatalogSha256: collaborationModeCatalog.catalogVersion,
        nativePersonality: personality,
        nativeResponseVerbosity: responseVerbosity,
        effectiveReasoningOptionId,
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
        collaborationModeId: resolvedCollaborationModeId,
        personality,
        responseVerbosity,
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
          agentTools,
          responseVerbosity === 'auto' ? null : responseVerbosity,
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
          collaborationModeId: resolvedCollaborationModeId,
          expectedCollaborationModeCatalogVersion: collaborationModeCatalog.catalogVersion,
          personality: personality === 'auto' ? null : personality,
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
          agentTools,
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
          const sourceAppendix = await agentTools.finalizeSourceAppendix();
          await this.finishAttemptBeforeTurn(
            currentAttempt,
            appendSourceProvenance(
              interruptUnconfirmed ? FAILURE_COPY.interruptUnconfirmed : FAILURE_COPY.unavailable,
              sourceAppendix,
            ),
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
    agentTools: ProjectAgentToolSession,
    responseVerbosity: CodexResponseVerbosity | null,
  ) {
    const started = await this.dependencies.codex.startThread({
      cwd,
      modelId,
      developerInstructions,
      responseVerbosity,
      dynamicTools: agentTools.dynamicTools,
      dynamicToolHandler: agentTools.handler,
    });
    if (this.threadProjects.has(started.threadId)) {
      throw new Error('codex_thread_id_collision');
    }
    agentTools.bindTransportRevoker(() =>
      this.dependencies.codex.revokeDynamicTools(started.threadId),
    );
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
          const sourceAppendix = await active.agentTools.finalizeSourceAppendix();
          await this.saveAssistant(
            active,
            'interrupted',
            appendSourceProvenance(FAILURE_COPY.persistence, sourceAppendix),
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
    const sourceAppendix = await active.agentTools.finalizeSourceAppendix();
    const response = active.finalResponseText
      ? parseCodexProjectResponse(active.finalResponseText)
      : null;
    if (!response) {
      await this.saveAssistant(
        active,
        'failed',
        appendSourceProvenance(FAILURE_COPY.invalid, sourceAppendix),
        [],
        'invalid_response',
      );
      return 'failed';
    }
    const snapshot = await this.dependencies.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === active.projectId);
    const taskIds = new Set(
      snapshot.tasks.filter((task) => task.projectId === active.projectId).map((task) => task.id),
    );
    const commands =
      !project ||
      project.trashedAt !== undefined ||
      project.archivedAt !== undefined ||
      active.attempt.harnessMode === 'reviewer'
        ? []
        : response.actions.filter(
            (action) => action.type === 'task.create' || taskIds.has(action.taskId),
          );
    await this.saveAssistant(
      active,
      'complete',
      appendSourceProvenance(response.reply, sourceAppendix),
      commands,
    );
    return 'complete';
  }

  private async finishInterrupted(active: ActiveTurn): Promise<'interrupted'> {
    const sourceAppendix = await active.agentTools.finalizeSourceAppendix();
    await this.saveAssistant(
      active,
      'interrupted',
      appendSourceProvenance(FAILURE_COPY.interrupted, sourceAppendix),
      [],
      'user_interrupted',
    );
    return 'interrupted';
  }

  private async finishFailed(active: ActiveTurn): Promise<'failed'> {
    const sourceAppendix = await active.agentTools.finalizeSourceAppendix();
    await this.saveAssistant(
      active,
      'failed',
      appendSourceProvenance(FAILURE_COPY.unavailable, sourceAppendix),
      [],
      'codex_unavailable',
    );
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
    if (project.archivedAt !== undefined) throw new ProjectChatServiceError('project_archived');
    return project;
  }

  private async runProjectChatMutation<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.lifecycleLockedProjects.has(projectId) || this.mutatingProjects.has(projectId)) {
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
