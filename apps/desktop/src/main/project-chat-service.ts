import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';

import {
  ApplyProjectChatActionInputSchema,
  BranchProjectChatSessionInputSchema,
  CodexProjectResponseSchema,
  CreateProjectChatSessionInputSchema,
  PROJECT_CHAT_OUTPUT_SCHEMA,
  PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH,
  ProjectChatProjectInputSchema,
  RenameProjectChatSessionInputSchema,
  ProjectChatSessionInputSchema,
  ProjectChatSnapshotInputSchema,
  ProjectChatSnapshotSchema,
  ProjectChatTurnReceiptSchema,
  SendProjectChatMessageInputSchema,
  UpdateProjectChatProfileInputSchema,
  legacyDepthToResponseVerbosity,
  legacyHarnessToCollaborationModeId,
  type ApplyProjectChatActionInput,
  type BranchProjectChatSessionInput,
  type CodexCollaborationModeCatalog,
  type CodexCollaborationModeDescriptor,
  type CreateProjectChatSessionInput,
  type ProjectChatAction,
  type ProjectChatActionCommand,
  type ProjectChatAttempt,
  type ProjectChatEvent,
  type ProjectChatMessage,
  type ProjectChatNativeExecutionKind,
  type ProjectChatProfile,
  type ProjectChatProjectInput,
  type RenameProjectChatSessionInput,
  type ProjectChatSession,
  type ProjectChatSessionInput,
  type ProjectChatSnapshot,
  type ProjectChatSnapshotInput,
  type ProjectChatTurnReceipt,
  type SendProjectChatMessageInput,
  type UpdateProjectChatProfileInput,
} from '../shared/project-chat-contracts';
import type {
  CodexDynamicToolHandler,
  CodexDynamicToolSpec,
  CodexDynamicToolTimeoutOverride,
  CodexPersonality,
  CodexResponseVerbosity,
  CodexWebSearchMode,
} from './codex-app-server';
import {
  ProjectChatAttachmentError,
  type ProjectChatAttachmentClaimer,
} from './project-chat-attachment-service';
import {
  ProjectAgentToolSession,
  type ProjectAgentLiterature,
  type ProjectAgentSsh,
  type ProjectAgentVault,
} from './project-agent-tools';
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
  getChatAttempt(
    projectId: string,
    sessionId: string,
    attemptId: string,
  ): MaybePromise<ProjectChatAttempt | null>;
  snapshot(projectId: string, sessionId?: string): MaybePromise<ProjectChatSnapshot>;
  listProjectChatSessions(projectId: string): MaybePromise<ProjectChatSession[]>;
  createProjectChatSession(projectId: string, title?: string): MaybePromise<ProjectChatSession>;
  branchProjectChatSession(input: BranchProjectChatSessionInput): MaybePromise<ProjectChatSession>;
  renameProjectChatSession(
    projectId: string,
    sessionId: string,
    title: string,
  ): MaybePromise<ProjectChatSession | null>;
  getProjectChatProfile(projectId: string): MaybePromise<ProjectChatProfile>;
  updateProjectChatProfile(
    input: UpdateProjectChatProfileInput,
  ): MaybePromise<ProjectChatProfile | null>;
  getAction(
    projectId: string,
    sessionId: string,
    actionId: string,
  ): MaybePromise<ProjectChatAction | null>;
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
    dynamicToolTimeouts?: readonly CodexDynamicToolTimeoutOverride[];
    webSearchMode?: CodexWebSearchMode;
  }): Promise<{ threadId: string }>;
  runTurn(input: {
    threadId: string;
    prompt: string;
    localImagePaths?: readonly string[];
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
      | 'chat_session_not_found'
      | 'chat_branch_message_not_found'
      | 'chat_branch_point_invalid'
      | 'chat_branch_lineage_invalid'
      | 'chat_branch_limit_reached'
      | 'chat_session_limit_reached'
      | 'local_notes_vault_not_selected'
      | 'local_notes_vault_changed'
      | 'attachment_invalid'
      | 'attachment_unsupported'
      | 'attachment_too_large'
      | 'attachment_total_too_large'
      | 'attachment_too_many'
      | 'attachment_encrypted'
      | 'attachment_archive_limit'
      | 'attachment_extraction_failed'
      | 'attachment_capacity_exhausted'
      | 'attachment_expired'
      | 'attachment_scope_mismatch'
      | 'attachment_model_modality_unsupported'
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
  sessionId: string;
  attempt: ProjectChatAttempt;
  threadId: string;
  turnId: string;
  invocation: ModelInvocation;
  finalResponseText: string | null;
  agentTools: ProjectAgentToolSession;
  terminalErrorCode: 'attachment_model_modality_unsupported' | null;
  terminal: boolean;
};

const UNAVAILABLE_AGENT_VAULT: ProjectAgentVault = {
  descriptor: () => null,
  matchesGrant: () => false,
  validateGrant: () => Promise.reject(new Error('vault_not_selected')),
  listForAgent: () => Promise.reject(new Error('vault_not_selected')),
  readForAgent: () => Promise.reject(new Error('vault_not_selected')),
};

const FAILURE_COPY = {
  unavailable: 'Codex could not complete this turn. Check the local connection and try again.',
  attachmentModelModalityUnsupported:
    'The selected model cannot accept image attachments. Choose an image-capable model, attach the image again, and resend this message.',
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

const LITERATURE_SUBJECT_PATTERN =
  /(?:\bliterature\b|\bpapers?\b|\bpublications?\b|\breferences?\b|\bbibliograph(?:y|ies|ic)\b|논문|문헌|참고문헌|레퍼런스)/giu;
const LITERATURE_ENGLISH_ACTION_PATTERN =
  /(?:^|\bplease\s+|\b(?:can|could|would|will)\s+you\s+|\bi\s+(?:want|need)\s+you\s+to\s+|\b(?:let['’]?s|help\s+me|go\s+ahead\s+and|then)\s+)(?<verb>search|find|look\s+up|discover|add|insert)\b/giu;
const LITERATURE_KOREAN_ACTION_PATTERN =
  /(?<verb>\b(?:search|find|add|insert)(?:해서|하고|하여|해줘|해주세요)|(?:검색|발굴)(?:해서|하고|하여|해줘|해주세요|해라|하라|하십시오|할래|해줄래|해)|찾(?:아서|아줘|아라|으세요|아)|추가(?:해서|하고|하여|해줘|해주세요|하라|하십시오|해)|넣(?:어서|어줘|어라|으세요|어))(?=$|[\s,.!?])/giu;
const LITERATURE_DENIAL_PATTERN =
  /(?:\bdo\s+not\b|\bdon't\b|\bwithout\s+(?:searching|finding|adding|saving|importing)\b|검색\s*(?:하지\s*마|하지\s*말|없이)|찾지\s*마|추가하지\s*마|넣지\s*마)/iu;
const LITERATURE_INTERVENING_TARGET_PATTERN =
  /(?:\b(?:board|tasks?|notes?|settings?)\b|보드|태스크|작업|노트|설정)/iu;
const LITERATURE_LOCAL_SUBJECT_SUFFIX_PATTERN =
  /^\s*(?:(?:search\s+)?(?:settings?|policy|tools?|feature|table|section|library)\b|(?:in|from|on)\s+(?:the\s+)?(?:board|tasks?|notes?|literature)\b|(?:검색\s*)?(?:설정|정책|도구|기능|표|테이블|섹션|라이브러리)|(?:보드|태스크|작업|노트|문헌)(?:에서|의))/iu;
const LITERATURE_ADD_TARGET_PREFIX_PATTERN =
  /(?:\b(?:add|insert)\b.{0,32}\b(?:to|into)\s+(?:the\s+)?$|(?:추가|넣).{0,24}(?:에|로)\s*$)/iu;
const LITERATURE_EXPLICIT_LIBRARY_TARGET_PATTERN =
  /(?:\b(?:to|into)\s+(?:the\s+)?(?:literature|bibliograph(?:y|ies))(?:\s+(?:table|section|library))?\b|(?:Literature|문헌|참고문헌|레퍼런스)(?:\s*(?:표|테이블|섹션|라이브러리))?(?:에|로))/iu;
const LITERATURE_LOCAL_DOCUMENT_SCOPE_PATTERN =
  /(?:\b(?:search|find|look\s+up)\b.{0,160}\b(?:in|from|inside|within|of)\s+(?:the\s+)?(?:(?:this|attached|current)\s+)?(?:paper|pdf|file|document)\b|\b(?:search|find|look\s+up)\s+(?:the\s+)?(?:this|attached|current)\s+(?:paper|pdf|file|document)\b|(?:(?:첨부|이|현재)\s*)?(?:논문|PDF|파일|문서)(?:에서|안에서|내에서|의).{0,128}(?:\b(?:search|find|look\s+up)\b|(?:검색|찾)(?:해서|하고|하여|해줘|해주세요|해라|하라|하십시오|할래|해줄래|해|아서|아줘|아라|으세요|아)))/iu;
const LITERATURE_LOCAL_WORKSPACE_SCOPE_PATTERN =
  /(?:\b(?:search|find|look\s+up)\b.{0,160}\b(?:in|from|inside|within|of)\s+(?:the\s+)?(?:local\s+notes|repository(?=$|[,.!?]|\s+(?:for|about|on|under|inside|within|and)\b)|manuscript(?=$|[,.!?]|\s+(?:for|about|on|under|inside|within|and)\b)|literature(?:\s+(?:table|section|library))?|source\s+code(?=$|[,.!?])|(?:this|current|the)\s+(?:code|source|function))\b|\b(?:search|find|look\s+up)\b.{0,96}\breferences?\s+to\s+(?:this|the|current)\s+function\b|(?:로컬\s*노트|저장소|리포지토리|원고|코드|소스|함수)(?:에서|안에서|내에서|의|에).{0,128}(?:\b(?:search|find|look\s+up)\b|(?:검색|찾)(?:해서|하고|하여|해줘|해주세요|해라|하라|하십시오|할래|해줄래|해|아서|아줘|아라|으세요|아)))/iu;
const LITERATURE_EXISTING_COLLECTION_SCOPE_PATTERN =
  /(?:\b(?:search|find|look\s+up)\b.{0,180}\b(?:(?:my|our|the|these|those)\s+)?(?:(?:already\s+)?(?:saved|stored|collected|imported)|existing)\s+(?:papers?|publications?|references?|literature|bibliograph(?:y|ies))\b|\b(?:search|find|look\s+up)\b.{0,180}\b(?:papers?|publications?|references?)\s+(?:already\s+)?(?:saved|stored|collected|imported)(?:\s+by\s+GOSU)?\b|\b(?:search|find|look\s+up)\b.{0,180}\b(?:papers?|publications?|references?|literature|bibliograph(?:y|ies))\s+(?:already\s+)?(?:in|from|inside|within)\s+(?:(?:my|our|the|this|current\s+project|project)\s+)?(?:library|collection|literature\s+(?:table|section)|GOSU)\b|\b(?:search|find|look\s+up)\b.{0,180}\b(?:this|the|current)\s+project(?:'s)?\s+(?:papers?|references?|library|literature)\b|(?:(?:내|우리|이\s*프로젝트(?:의)?|현재\s*프로젝트(?:의)?|기존|저장된|이미\s*저장(?:한|된))\s*)?(?:논문|문헌|참고문헌|레퍼런스|라이브러리|컬렉션)(?:에서|안에서|내에서|중에서|의).{0,128}(?:\b(?:search|find|look\s+up)\b|(?:검색|찾)(?:해서|하고|하여|해줘|해주세요|해라|하라|하십시오|할래|해줄래|해|아서|아줘|아라|으세요|아)))/iu;

type LiteratureCommandAction = Readonly<{
  start: number;
  end: number;
  verb: string;
}>;

function literatureCommandActions(message: string) {
  return [
    ...message.matchAll(LITERATURE_ENGLISH_ACTION_PATTERN),
    ...message.matchAll(LITERATURE_KOREAN_ACTION_PATTERN),
  ].map<LiteratureCommandAction>((match) => {
    const verb = match.groups?.verb ?? '';
    const verbOffset = match[0].toLocaleLowerCase().lastIndexOf(verb.toLocaleLowerCase());
    const start = match.index + Math.max(0, verbOffset);
    return { start, end: start + verb.length, verb };
  });
}

function actionDirectlyTargetsLiterature(message: string, action: LiteratureCommandAction) {
  if (/^find$/iu.test(action.verb) && /^\s+out\b/iu.test(message.slice(action.end))) return false;
  for (const subject of message.matchAll(LITERATURE_SUBJECT_PATTERN)) {
    const subjectStart = subject.index;
    const subjectEnd = subjectStart + subject[0].length;
    const distance = Math.max(action.start, subjectStart) - Math.min(action.end, subjectEnd);
    if (distance > 200) continue;
    const between = message.slice(
      Math.min(action.end, subjectEnd),
      Math.max(action.start, subjectStart),
    );
    if (LITERATURE_INTERVENING_TARGET_PATTERN.test(between)) continue;
    const suffix = message.slice(subjectEnd, subjectEnd + 64);
    if (LITERATURE_LOCAL_SUBJECT_SUFFIX_PATTERN.test(suffix)) {
      const prefix = message.slice(Math.max(0, subjectStart - 48), subjectStart);
      if (!LITERATURE_ADD_TARGET_PREFIX_PATTERN.test(prefix)) continue;
    }
    if (/^(?:add|insert|추가|넣)/iu.test(action.verb)) {
      const commandWindow = message.slice(
        Math.max(0, Math.min(action.start, subjectStart) - 32),
        Math.min(message.length, Math.max(action.end, subjectEnd) + 160),
      );
      if (!LITERATURE_EXPLICIT_LIBRARY_TARGET_PATTERN.test(commandWindow)) continue;
    }
    return true;
  }
  return false;
}

export function explicitlyAuthorizesLiteratureSearch(message: string) {
  const normalized = message.normalize('NFKC').trim();
  return (
    normalized.length > 0 &&
    !LITERATURE_DENIAL_PATTERN.test(normalized) &&
    !LITERATURE_LOCAL_DOCUMENT_SCOPE_PATTERN.test(normalized) &&
    !LITERATURE_LOCAL_WORKSPACE_SCOPE_PATTERN.test(normalized) &&
    !LITERATURE_EXISTING_COLLECTION_SCOPE_PATTERN.test(normalized) &&
    literatureCommandActions(normalized).some((action) =>
      actionDirectlyTargetsLiterature(normalized, action),
    )
  );
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

function mapSessionStorageError(error: unknown): ProjectChatServiceError {
  const code = error instanceof Error ? error.message : '';
  if (
    code === 'chat_session_not_found' ||
    code === 'chat_branch_message_not_found' ||
    code === 'chat_branch_point_invalid' ||
    code === 'chat_branch_lineage_invalid' ||
    code === 'chat_branch_limit_reached' ||
    code === 'chat_session_limit_reached'
  ) {
    return new ProjectChatServiceError(code);
  }
  throw error;
}

function sessionIdentity(projectId: string, sessionId: string) {
  return `${projectId}:${sessionId}`;
}

function transportIdentity(threadId: string, turnId: string) {
  return `${threadId}\u0000${turnId}`;
}

export class ProjectChatService extends EventEmitter {
  private readonly activeByTransport = new Map<string, ActiveTurn>();
  private readonly activeTransportBySession = new Map<string, string>();
  private readonly threadSessions = new Map<string, { projectId: string; sessionId: string }>();
  private readonly startingProjects = new Set<string>();
  private readonly startingSessions = new Set<string>();
  private readonly liveAgentToolsBySession = new Map<string, ProjectAgentToolSession>();
  private readonly sshScopeEpochBySession = new Map<string, number>();
  private readonly sshScopeEpochByProject = new Map<string, number>();
  private readonly sshRevokeAllEpochByProject = new Map<string, number>();
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
      literature?: ProjectAgentLiterature;
      ssh?: ProjectAgentSsh;
      attachments?: ProjectChatAttachmentClaimer;
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
        const active = this.activeByTransport.get(transportIdentity(event.threadId, event.turnId));
        if (active) active.invocation = event.invocation;
      },
    );
    dependencies.codex.on('disconnected', () => {
      this.codexConnectionEpoch += 1;
      this.threadSessions.clear();
      this.earlyNotifications.clear();
      for (const active of this.activeByTransport.values()) this.beginFinalize(active, 'failed');
    });
  }

  async snapshot(input: ProjectChatSnapshotInput) {
    const command = ProjectChatSnapshotInputSchema.parse(input);
    await this.requireProject(command.projectId);
    let stored: ProjectChatSnapshot;
    let profile: ProjectChatProfile;
    try {
      [stored, profile] = await Promise.all([
        this.dependencies.storage.snapshot(command.projectId, command.sessionId),
        this.dependencies.storage.getProjectChatProfile(command.projectId),
      ]);
    } catch (error) {
      throw mapSessionStorageError(error);
    }
    const selectedSessionId = stored.session?.id;
    const activeTransport = selectedSessionId
      ? this.activeTransportBySession.get(sessionIdentity(command.projectId, selectedSessionId))
      : undefined;
    const active = activeTransport ? this.activeByTransport.get(activeTransport) : undefined;
    return ProjectChatSnapshotSchema.parse({
      ...stored,
      profile,
      ...(active ? { activeTurnId: active.turnId } : {}),
    });
  }

  async listSessions(input: ProjectChatProjectInput) {
    const command = ProjectChatProjectInputSchema.parse(input);
    await this.requireProject(command.projectId);
    return this.dependencies.storage.listProjectChatSessions(command.projectId);
  }

  async createSession(input: CreateProjectChatSessionInput) {
    const command = CreateProjectChatSessionInputSchema.parse(input);
    return this.runProjectChatMutation(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      try {
        return await this.dependencies.storage.createProjectChatSession(
          command.projectId,
          command.title,
        );
      } catch (error) {
        throw mapSessionStorageError(error);
      }
    });
  }

  async branchSession(input: BranchProjectChatSessionInput) {
    const command = BranchProjectChatSessionInputSchema.parse(input);
    return this.runProjectChatMutation(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      try {
        return await this.dependencies.storage.branchProjectChatSession(command);
      } catch (error) {
        throw mapSessionStorageError(error);
      }
    });
  }

  async renameSession(input: RenameProjectChatSessionInput) {
    const command = RenameProjectChatSessionInputSchema.parse(input);
    return this.runWhenProjectChatIdle(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      const renamed = await this.dependencies.storage.renameProjectChatSession(
        command.projectId,
        command.sessionId,
        command.title,
      );
      if (!renamed) throw new ProjectChatServiceError('chat_session_not_found');
      return renamed;
    });
  }

  async updateProfile(input: UpdateProjectChatProfileInput) {
    const command = UpdateProjectChatProfileInputSchema.parse(input);
    if (this.hasProjectActivity(command.projectId)) {
      throw new ProjectChatServiceError('chat_busy');
    }
    return this.runProjectChatMutation(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      if (command.localNotesVault) {
        const selectedVault = this.dependencies.vault?.descriptor(command.projectId) ?? null;
        if (!selectedVault) {
          throw new ProjectChatServiceError('local_notes_vault_not_selected');
        }
        if (
          selectedVault.id !== command.localNotesVault.id ||
          selectedVault.name !== command.localNotesVault.name
        ) {
          throw new ProjectChatServiceError('local_notes_vault_changed');
        }
        try {
          await this.dependencies.vault!.validateGrant(
            command.projectId,
            command.localNotesVault.id,
          );
        } catch {
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
      this.hasProjectActivity(projectId)
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
    const requestedSshSessionKey = command.sessionId
      ? sessionIdentity(command.projectId, command.sessionId)
      : null;
    const sshSessionEpochAtInvocation = requestedSshSessionKey
      ? (this.sshScopeEpochBySession.get(requestedSshSessionKey) ?? 0)
      : null;
    const sshProjectEpochAtInvocation = this.sshScopeEpochByProject.get(command.projectId) ?? 0;
    const sshRevokeAllEpochAtInvocation =
      this.sshRevokeAllEpochByProject.get(command.projectId) ?? 0;
    if (
      this.lifecycleLockedProjects.has(command.projectId) ||
      this.mutatingProjects.has(command.projectId) ||
      this.hasProjectActivity(command.projectId)
    ) {
      throw new ProjectChatServiceError('chat_busy');
    }
    this.startingProjects.add(command.projectId);
    let startingSessionKey: string | undefined;
    let startingSessionRegistered = false;
    let createdAgentTools: ProjectAgentToolSession | undefined;
    let agentToolsTransferred = false;
    try {
      await this.requireActiveProject(command.projectId);
      let priorChat: ProjectChatSnapshot;
      try {
        priorChat = await this.dependencies.storage.snapshot(command.projectId, command.sessionId);
      } catch (error) {
        throw mapSessionStorageError(error);
      }
      const session = priorChat.session;
      if (!session) throw new ProjectChatServiceError('chat_session_not_found');
      startingSessionKey = sessionIdentity(command.projectId, session.id);
      if (
        this.lifecycleLockedProjects.has(command.projectId) ||
        this.mutatingProjects.has(command.projectId) ||
        [...this.startingSessions].some((identity) =>
          identity.startsWith(`${command.projectId}:`),
        ) ||
        this.startingSessions.has(startingSessionKey) ||
        this.activeTransportBySession.has(startingSessionKey)
      ) {
        throw new ProjectChatServiceError('chat_busy');
      }
      this.startingSessions.add(startingSessionKey);
      startingSessionRegistered = true;
      const [snapshot, profile] = await Promise.all([
        this.dependencies.workspace.snapshot(),
        this.dependencies.storage.getProjectChatProfile(command.projectId),
      ]);
      const project = snapshot.projects.find((candidate) => candidate.id === command.projectId);
      if (!project) throw new ProjectChatServiceError('project_not_found');
      if (project.trashedAt !== undefined) throw new ProjectChatServiceError('project_trashed');
      if (project.archivedAt !== undefined) throw new ProjectChatServiceError('project_archived');
      if (command.profileVersion !== undefined && command.profileVersion !== profile.version) {
        throw new ProjectChatServiceError('chat_profile_conflict');
      }
      if (command.retryOfAttemptId) {
        const retryTarget = await this.dependencies.storage.getChatAttempt(
          command.projectId,
          session.id,
          command.retryOfAttemptId,
        );
        if (!retryTarget) throw new ProjectChatServiceError('chat_attempt_not_found');
        if (
          (retryTarget.status !== 'failed' && retryTarget.status !== 'interrupted') ||
          retryTarget.errorCode === 'attachment_model_modality_unsupported'
        ) {
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
      const attemptId = randomUUID();
      let attachments;
      if (command.attachmentIds && command.attachmentIds.length > 0) {
        try {
          if (!this.dependencies.attachments) {
            throw new ProjectChatAttachmentError('attachment_expired');
          }
          attachments = this.dependencies.attachments.claim(
            command.projectId,
            session.id,
            command.attachmentIds,
          );
        } catch (error) {
          if (error instanceof ProjectChatAttachmentError) {
            throw new ProjectChatServiceError(error.code);
          }
          throw error;
        }
      }
      const agentTools = new ProjectAgentToolSession({
        projectId: command.projectId,
        sessionId: session.id,
        attemptId,
        workspace: this.dependencies.workspace,
        vault: this.dependencies.vault ?? UNAVAILABLE_AGENT_VAULT,
        localNotesVault: profile.localNotesVault ?? null,
        ...(attachments ? { attachments } : {}),
        ...(executionKind !== 'legacy-reviewer' &&
        this.dependencies.literature &&
        explicitlyAuthorizesLiteratureSearch(command.message)
          ? { literature: this.dependencies.literature }
          : {}),
        ...(this.dependencies.ssh ? { ssh: this.dependencies.ssh } : {}),
      });
      createdAgentTools = agentTools;
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
        sessionId: session.id,
        userMessageId: userMessage.id,
        ...(command.retryOfAttemptId ? { retryOfAttemptId: command.retryOfAttemptId } : {}),
        requestedModelId: command.requestedModelId,
        reasoningOptionId: command.reasoningOptionId,
        harnessMode,
        responseDepth,
        collaborationModeId: resolvedCollaborationModeId,
        personality,
        responseVerbosity,
        webSearchMode: profile.webSearchMode,
        contextScope,
        profileVersion: profile.version,
        instructionRevisionId: profile.instructionRevision?.id ?? null,
        promptProvenance: assembled.provenance,
        status: 'starting',
        createdAt,
        updatedAt: createdAt,
      };
      await this.dependencies.storage.beginChatAttempt(startingAttempt, userMessage);
      const sshScopeRevokedDuringStartup = requestedSshSessionKey
        ? (this.sshScopeEpochBySession.get(requestedSshSessionKey) ?? 0) !==
            sshSessionEpochAtInvocation ||
          (this.sshRevokeAllEpochByProject.get(command.projectId) ?? 0) !==
            sshRevokeAllEpochAtInvocation
        : (this.sshScopeEpochByProject.get(command.projectId) ?? 0) !== sshProjectEpochAtInvocation;
      if (sshScopeRevokedDuringStartup) {
        agentTools.revokeSshCapability();
      }
      this.liveAgentToolsBySession.set(startingSessionKey, agentTools);

      let ephemeralThreadId: string | undefined;
      let ephemeralTurnId: string | undefined;
      let currentAttempt = startingAttempt;
      let activeRegistered = false;
      let connectionEpoch: number | undefined;
      try {
        const cwd = await this.dependencies.prepareProjectDirectory(command.projectId);
        const threadId = await this.startEphemeralThread(
          command.projectId,
          session.id,
          cwd,
          command.requestedModelId,
          assembled.developerInstructions,
          agentTools,
          responseVerbosity === 'auto' ? null : responseVerbosity,
          profile.webSearchMode,
        );
        ephemeralThreadId = threadId;
        connectionEpoch = this.codexConnectionEpoch;
        const nativeImages = attachments?.nativeImages() ?? [];
        const result = await this.dependencies.codex.runTurn({
          threadId,
          prompt: assembled.prompt,
          ...(nativeImages.length
            ? { localImagePaths: nativeImages.map((image) => image.path) }
            : {}),
          requestedModelId: command.requestedModelId,
          reasoningOptionId: command.reasoningOptionId,
          cwd,
          clientUserMessageId: userMessage.id,
          outputSchema: PROJECT_CHAT_OUTPUT_SCHEMA,
          collaborationModeId: resolvedCollaborationModeId,
          expectedCollaborationModeCatalogVersion: collaborationModeCatalog.catalogVersion,
          personality: personality === 'auto' ? null : personality,
        });
        agentTools.markNativeImagesDelivered();
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
          sessionId: session.id,
          attempt: runningAttempt,
          threadId,
          turnId: result.turnId,
          invocation: result.invocation,
          finalResponseText: null,
          agentTools,
          terminalErrorCode: null,
          terminal: false,
        };
        const activeTransport = transportIdentity(threadId, result.turnId);
        this.activeByTransport.set(activeTransport, active);
        this.activeTransportBySession.set(startingSessionKey, activeTransport);
        activeRegistered = true;
        agentToolsTransferred = true;
        this.emitEvent({
          type: 'turn.started',
          projectId: command.projectId,
          sessionId: session.id,
          turnId: result.turnId,
        });
        const buffered = this.earlyNotifications.get(activeTransport) ?? [];
        this.earlyNotifications.delete(activeTransport);
        for (const notification of buffered) this.processNotification(active, notification);
        return ProjectChatTurnReceiptSchema.parse({
          projectId: command.projectId,
          sessionId: session.id,
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
          this.threadSessions.delete(ephemeralThreadId);
          void this.dependencies.codex.releaseThread(ephemeralThreadId).catch(() => undefined);
        }
        if (ephemeralThreadId && ephemeralTurnId) {
          this.earlyNotifications.delete(transportIdentity(ephemeralThreadId, ephemeralTurnId));
        }
        if (!activeRegistered) {
          agentTools.revokeSshCapability();
          agentTools.revokeLiteratureCapability();
          agentTools.revokeAttachmentCapability();
          if (this.liveAgentToolsBySession.get(startingSessionKey) === agentTools) {
            this.liveAgentToolsBySession.delete(startingSessionKey);
          }
          const sourceAppendix = await agentTools.finalizeSourceAppendix();
          const attachmentModelModalityUnsupported =
            error instanceof Error && error.message === 'attachment_model_modality_unsupported';
          const failureCode: NonNullable<ProjectChatAttempt['errorCode']> = interruptUnconfirmed
            ? 'application_interrupted'
            : attachmentModelModalityUnsupported
              ? 'attachment_model_modality_unsupported'
              : 'codex_unavailable';
          const failureCopy = attachmentModelModalityUnsupported
            ? FAILURE_COPY.attachmentModelModalityUnsupported
            : interruptUnconfirmed
              ? FAILURE_COPY.interruptUnconfirmed
              : FAILURE_COPY.unavailable;
          await this.finishAttemptBeforeTurn(
            currentAttempt,
            appendSourceProvenance(failureCopy, sourceAppendix),
            failureCode,
          );
        }
        if (error instanceof ProjectChatServiceError) throw error;
        if (error instanceof Error && error.message === 'attachment_model_modality_unsupported') {
          throw new ProjectChatServiceError('attachment_model_modality_unsupported');
        }
        throw new ProjectChatServiceError('codex_unavailable');
      }
    } finally {
      if (createdAgentTools && !agentToolsTransferred) {
        await createdAgentTools.finalizeSourceAppendix().catch(() => undefined);
      }
      this.startingProjects.delete(command.projectId);
      if (startingSessionRegistered && startingSessionKey) {
        this.startingSessions.delete(startingSessionKey);
      }
    }
  }

  async cancel(input: ProjectChatSessionInput) {
    const command = ProjectChatSessionInputSchema.parse(input);
    this.advanceSshScopeEpoch(command.projectId, command.sessionId);
    this.revokeSshScopeImmediately(command.projectId, command.sessionId);
    await this.requireProject(command.projectId);
    let snapshot: ProjectChatSnapshot;
    try {
      snapshot = await this.dependencies.storage.snapshot(command.projectId, command.sessionId);
    } catch (error) {
      throw mapSessionStorageError(error);
    }
    const sessionId = snapshot.session?.id;
    if (!sessionId) throw new ProjectChatServiceError('chat_session_not_found');
    const activeTransport = this.activeTransportBySession.get(
      sessionIdentity(command.projectId, sessionId),
    );
    const active = activeTransport ? this.activeByTransport.get(activeTransport) : undefined;
    if (!active) throw new ProjectChatServiceError('chat_not_active');
    active.agentTools.revokeSshCapability();
    active.agentTools.revokeLiteratureCapability();
    active.agentTools.revokeAttachmentCapability();
    this.dependencies.ssh?.cancelSession(command.projectId, sessionId);
    await this.dependencies.codex.interruptTurn(active.threadId, active.turnId);
    return { accepted: true } as const;
  }

  async revokeSsh(input: ProjectChatSessionInput) {
    const command = ProjectChatSessionInputSchema.parse(input);
    this.advanceSshScopeEpoch(command.projectId, command.sessionId);
    this.revokeSshScopeImmediately(command.projectId, command.sessionId);
    await this.requireProject(command.projectId);
    let sessionIds: string[];
    try {
      if (command.sessionId) {
        const snapshot = await this.dependencies.storage.snapshot(
          command.projectId,
          command.sessionId,
        );
        if (!snapshot.session) throw new ProjectChatServiceError('chat_session_not_found');
        sessionIds = [snapshot.session.id];
      } else {
        sessionIds = (
          await this.dependencies.storage.listProjectChatSessions(command.projectId)
        ).map((session) => session.id);
      }
    } catch (error) {
      if (error instanceof ProjectChatServiceError) throw error;
      throw mapSessionStorageError(error);
    }

    for (const sessionId of sessionIds) {
      const key = sessionIdentity(command.projectId, sessionId);
      if (!command.sessionId) {
        this.sshScopeEpochBySession.set(key, (this.sshScopeEpochBySession.get(key) ?? 0) + 1);
      }
      this.liveAgentToolsBySession.get(key)?.revokeSshCapability();
      this.dependencies.ssh?.cancelSession(command.projectId, sessionId);
    }
    return { revoked: true } as const;
  }

  private advanceSshScopeEpoch(projectId: string, sessionId?: string) {
    this.sshScopeEpochByProject.set(
      projectId,
      (this.sshScopeEpochByProject.get(projectId) ?? 0) + 1,
    );
    if (sessionId) {
      const requestedKey = sessionIdentity(projectId, sessionId);
      this.sshScopeEpochBySession.set(
        requestedKey,
        (this.sshScopeEpochBySession.get(requestedKey) ?? 0) + 1,
      );
    } else {
      this.sshRevokeAllEpochByProject.set(
        projectId,
        (this.sshRevokeAllEpochByProject.get(projectId) ?? 0) + 1,
      );
    }
  }

  private revokeSshScopeImmediately(projectId: string, sessionId?: string) {
    if (sessionId) {
      this.liveAgentToolsBySession
        .get(sessionIdentity(projectId, sessionId))
        ?.revokeSshCapability();
      this.dependencies.ssh?.cancelSession(projectId, sessionId);
      return;
    }
    for (const [key, agentTools] of this.liveAgentToolsBySession) {
      if (key.startsWith(`${projectId}:`)) agentTools.revokeSshCapability();
    }
    this.dependencies.ssh?.cancelProject(projectId);
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
    let snapshot: ProjectChatSnapshot;
    try {
      snapshot = await this.dependencies.storage.snapshot(command.projectId, command.sessionId);
    } catch (error) {
      throw mapSessionStorageError(error);
    }
    const sessionId = snapshot.session?.id;
    if (!sessionId) throw new ProjectChatServiceError('chat_session_not_found');
    let action = await this.dependencies.storage.getAction(
      command.projectId,
      sessionId,
      command.actionId,
    );
    if (!action) throw new ProjectChatServiceError('action_not_found');
    if (action.status === 'applied' || action.status === 'failed') return action;
    if (action.status !== 'proposed') throw new ProjectChatServiceError('action_not_proposed');
    const claimedAt = isoNow();
    if (!(await this.dependencies.storage.claimAction(action.projectId, action.id, claimedAt))) {
      action = await this.dependencies.storage.getAction(
        command.projectId,
        sessionId,
        command.actionId,
      );
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
        sessionId,
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
        sessionId,
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
        sessionId,
        action: interrupted,
        workspaceChanged: true,
      });
      return interrupted;
    }
  }

  private async startEphemeralThread(
    projectId: string,
    sessionId: string,
    cwd: string,
    modelId: string | null,
    developerInstructions: string,
    agentTools: ProjectAgentToolSession,
    responseVerbosity: CodexResponseVerbosity | null,
    webSearchMode: CodexWebSearchMode,
  ) {
    const started = await this.dependencies.codex.startThread({
      cwd,
      modelId,
      developerInstructions,
      responseVerbosity,
      webSearchMode,
      dynamicTools: agentTools.dynamicTools,
      dynamicToolHandler: agentTools.handler,
      dynamicToolTimeouts: agentTools.dynamicToolTimeouts,
    });
    if (this.threadSessions.has(started.threadId)) {
      throw new Error('codex_thread_id_collision');
    }
    agentTools.bindTransportRevoker(() =>
      this.dependencies.codex.revokeDynamicTools(started.threadId),
    );
    this.threadSessions.set(started.threadId, { projectId, sessionId });
    return started.threadId;
  }

  private routeNotification(notification: CodexNotification) {
    const identity = notificationIdentity(notification);
    if (!identity) return;
    const session = this.threadSessions.get(identity.threadId);
    if (!session) return;
    const transport = transportIdentity(identity.threadId, identity.turnId);
    const active = this.activeByTransport.get(transport);
    if (active) {
      if (active.projectId !== session.projectId || active.sessionId !== session.sessionId) {
        return;
      }
      this.processNotification(active, notification);
      return;
    }
    if (!this.startingSessions.has(sessionIdentity(session.projectId, session.sessionId))) return;
    const current = this.earlyNotifications.get(transport) ?? [];
    if (current.length < 100) {
      current.push(notification);
      this.earlyNotifications.set(transport, current);
    }
  }

  private processNotification(active: ActiveTurn, notification: CodexNotification) {
    if (active.terminal || !isRecord(notification.params)) return;
    if (notification.method === 'gosu/attachment-model-modality-rejected') {
      active.terminalErrorCode = 'attachment_model_modality_unsupported';
      active.agentTools.rejectNativeImageDelivery();
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
        active.finalResponseText = item.text;
      }
      return;
    }
    if (notification.method !== 'turn/completed') return;
    const turn = notification.params.turn;
    const status = isRecord(turn) ? turn.status : undefined;
    if (notification.params.gosuErrorCode === 'attachment_model_modality_unsupported') {
      active.terminalErrorCode = 'attachment_model_modality_unsupported';
      active.agentTools.rejectNativeImageDelivery();
    }
    this.beginFinalize(
      active,
      status === 'completed' || status === 'interrupted' ? status : 'failed',
    );
  }

  private beginFinalize(active: ActiveTurn, status: 'completed' | 'interrupted' | 'failed') {
    if (active.terminal) return;
    active.terminal = true;
    active.agentTools.revokeSshCapability();
    active.agentTools.revokeLiteratureCapability();
    active.agentTools.revokeAttachmentCapability();
    void this.persistTerminal(active, status)
      .then((persistedStatus) => this.clearActive(active, persistedStatus))
      .catch(async () => {
        try {
          const sourceAppendix = await active.agentTools.finalizeSourceAppendix();
          const modalityUnsupported =
            active.terminalErrorCode === 'attachment_model_modality_unsupported';
          const fallbackStatus = modalityUnsupported ? 'failed' : 'interrupted';
          await this.saveAssistant(
            active,
            fallbackStatus,
            appendSourceProvenance(
              modalityUnsupported
                ? FAILURE_COPY.attachmentModelModalityUnsupported
                : FAILURE_COPY.persistence,
              sourceAppendix,
            ),
            [],
            modalityUnsupported
              ? 'attachment_model_modality_unsupported'
              : 'application_interrupted',
          );
          this.clearActive(active, fallbackStatus);
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
    const modalityUnsupported =
      active.terminalErrorCode === 'attachment_model_modality_unsupported';
    await this.saveAssistant(
      active,
      'failed',
      appendSourceProvenance(
        modalityUnsupported
          ? FAILURE_COPY.attachmentModelModalityUnsupported
          : FAILURE_COPY.unavailable,
        sourceAppendix,
      ),
      [],
      modalityUnsupported ? 'attachment_model_modality_unsupported' : 'codex_unavailable',
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
    this.dependencies.ssh?.cancelSession(active.projectId, active.sessionId);
    const transport = transportIdentity(active.threadId, active.turnId);
    const session = sessionIdentity(active.projectId, active.sessionId);
    this.activeByTransport.delete(transport);
    this.threadSessions.delete(active.threadId);
    if (this.activeTransportBySession.get(session) === transport) {
      this.activeTransportBySession.delete(session);
    }
    if (this.liveAgentToolsBySession.get(session) === active.agentTools) {
      this.liveAgentToolsBySession.delete(session);
    }
    this.earlyNotifications.delete(transport);
    void this.dependencies.codex.releaseThread(active.threadId).catch(() => undefined);
    this.emitEvent({
      type: 'turn.completed',
      projectId: active.projectId,
      sessionId: active.sessionId,
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

  private hasProjectActivity(projectId: string) {
    const prefix = `${projectId}:`;
    return (
      this.startingProjects.has(projectId) ||
      [...this.startingSessions].some((identity) => identity.startsWith(prefix)) ||
      [...this.activeTransportBySession.keys()].some((identity) => identity.startsWith(prefix))
    );
  }

  private emitEvent(event: ProjectChatEvent) {
    try {
      this.emit('event', event);
    } catch {
      // A renderer/observability listener must not break chat state cleanup or action receipts.
    }
  }
}
