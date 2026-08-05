import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import {
  defaultProjectChatProfile,
  type CodexCollaborationModeDescriptor,
  type ProjectChatAction,
  type ProjectChatContextScope,
  type ProjectChatHarnessMode,
  type ProjectChatPersonality,
  type ProjectChatResponseDepth,
  type ProjectChatResponseVerbosity,
  type ProjectChatSnapshot,
  type ProjectChatWebSearchMode,
} from '../../shared/project-chat-contracts';
import {
  PROJECT_CHAT_MAX_ATTACHMENTS,
  type ProjectChatAttachment,
} from '../../shared/project-chat-attachment-contracts';
import {
  resolveWorkspaceBoardSettings,
  type ProjectRecord,
  type WorkspaceTask,
  type WorkspaceTaskStatus,
} from '../../shared/workspace-contracts';
import type { VaultSelection } from '../../shared/vault-contracts';
import { shouldSendChatMessage } from './chat-keyboard';
import type { CodexModel } from './connections-view';
import type { VaultRuntimeState } from './notes-view';
import { ProjectChatMarkdown } from './project-chat-markdown';
import { isProjectChatNearBottom, resolveProjectChatArrival } from './project-chat-scroll';
import { ProjectChatSessionRail } from './project-chat-session-rail';
import { PROJECT_CHAT_SESSION_RAIL_DEFAULT_WIDTH } from './project-chat-session-state';

const QUICK_PROMPTS = [
  '현재 프로젝트 상황을 요약해줘',
  '다음으로 할 연구 작업 3개를 제안해줘',
  '목표 metric 기준으로 가장 중요한 리스크를 찾아줘',
  '승인된 Local Notes를 검토하고 프로젝트에 활용할 근거를 정리해줘',
] as const;

export type ProjectChatTurnControls = Readonly<{
  harnessMode: ProjectChatHarnessMode;
  responseDepth: ProjectChatResponseDepth;
  collaborationModeId?: string | null;
  personality: ProjectChatPersonality;
  responseVerbosity: ProjectChatResponseVerbosity;
  contextScope: ProjectChatContextScope;
  profileVersion: number;
}>;

export type ProjectChatSessionUiState = Readonly<{
  draft: string;
  retryOfAttemptId: string | null;
  advancedOpen: boolean;
}>;

export type ProjectChatSshAccess = Readonly<{
  state: 'checking' | 'ready' | 'unavailable';
  registeredConnectionCount: number;
  grantedWorkspaceCount: number;
}>;

const NO_PROJECT_CHAT_SSH_ACCESS: ProjectChatSshAccess = Object.freeze({
  state: 'checking',
  registeredConnectionCount: 0,
  grantedWorkspaceCount: 0,
});

export function resolveLatestMessageScrollTop({
  currentScrollTop,
  scrollHeight,
  clientHeight,
  transcriptTop,
  messageTop,
  topInset,
}: Readonly<{
  currentScrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  transcriptTop: number;
  messageTop: number;
  topInset: number;
}>) {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const messageContentTop = currentScrollTop + messageTop - transcriptTop;
  return Math.min(maxScrollTop, Math.max(0, messageContentTop - topInset));
}

export function resolveInitialProjectChatScrollTop({
  savedScrollTop,
  scrollHeight,
  clientHeight,
}: Readonly<{
  savedScrollTop: number | null;
  scrollHeight: number;
  clientHeight: number;
}>) {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (savedScrollTop === null || !Number.isFinite(savedScrollTop)) return maxScrollTop;
  return Math.min(maxScrollTop, Math.max(0, savedScrollTop));
}

export function shouldPersistProjectChatScrollPosition(
  initializedSessionKey: string | null,
  activeSessionKey: string,
) {
  return initializedSessionKey === activeSessionKey;
}

export function shouldInitializeProjectChatScroll(loading: boolean, snapshotReady: boolean) {
  return !loading && snapshotReady;
}

export function resolveUnreadAssistantMessageId(
  messages: readonly Pick<ProjectChatSnapshot['messages'][number], 'id' | 'role'>[],
  unreadAssistantMessageId: string | null,
) {
  if (!unreadAssistantMessageId) return null;
  return messages.some(
    (message) => message.role === 'assistant' && message.id === unreadAssistantMessageId,
  )
    ? unreadAssistantMessageId
    : null;
}

export type ProjectChatScrollIntent = 'top' | 'bottom' | 'latest-start' | 'none';

export function resolveProjectChatScrollIntent({
  observedLatestMessageId,
  latestMessageId,
  wasInFlight,
  inFlight,
}: Readonly<{
  observedLatestMessageId: string | null;
  latestMessageId: string | null;
  wasInFlight: boolean;
  inFlight: boolean;
}>): ProjectChatScrollIntent {
  if (inFlight) return 'bottom';
  if (latestMessageId === null) return 'top';
  if (wasInFlight && latestMessageId === observedLatestMessageId) return 'none';
  return latestMessageId === observedLatestMessageId ? 'none' : 'latest-start';
}

export function reconcileProjectChatSessionUiState(
  previousIdentity: string,
  nextIdentity: string,
  current: ProjectChatSessionUiState,
  initialDraft: string,
): ProjectChatSessionUiState {
  return previousIdentity === nextIdentity
    ? current
    : { draft: initialDraft, retryOfAttemptId: null, advancedOpen: false };
}

export function shouldAcceptAttachmentPickerResult(
  mounted: boolean,
  expectedScope: string,
  currentScope: string,
  expectedGeneration: number,
  currentGeneration: number,
) {
  return mounted && expectedScope === currentScope && expectedGeneration === currentGeneration;
}

export function resolveFailedTurnRecoveryMode(errorCode?: string) {
  return errorCode === 'attachment_model_modality_unsupported' ? 'reattach' : 'retry';
}

const HARNESS_LABELS: Record<ProjectChatHarnessMode, string> = {
  context: 'Copilot',
  planner: 'Planner',
  reviewer: 'Reviewer',
};

const DEPTH_LABELS: Record<ProjectChatResponseDepth, string> = {
  concise: 'Concise',
  standard: 'Standard',
  deep: 'Deep',
};

const VERBOSITY_LABELS: Record<ProjectChatResponseVerbosity, string> = {
  auto: 'Auto verbosity',
  low: 'Low verbosity',
  medium: 'Medium verbosity',
  high: 'High verbosity',
};

const PERSONALITY_LABELS: Record<ProjectChatPersonality, string> = {
  auto: 'Auto personality',
  none: 'No personality',
  friendly: 'Friendly',
  pragmatic: 'Pragmatic',
};

const CONTEXT_LABELS: Record<ProjectChatContextScope, string> = {
  project: 'Board + Objective',
  board: 'Board only',
  objective: 'Objective only',
};

const WEB_SEARCH_LABELS: Record<ProjectChatWebSearchMode, string> = {
  cached: 'Cached web',
  live: 'Live web',
  disabled: 'Web off',
};

export function resolveEffectiveCodexModel(
  models: readonly CodexModel[],
  collaborationModes: readonly CodexCollaborationModeDescriptor[],
  selectedModelId: string | null,
  collaborationModeId: string | null,
) {
  if (selectedModelId !== null) {
    return models.find((model) => model.modelId === selectedModelId);
  }
  const recommendedModelId = collaborationModeId
    ? collaborationModes.find((mode) => mode.id === collaborationModeId)?.recommendedModelId
    : null;
  return recommendedModelId
    ? models.find((model) => model.modelId === recommendedModelId)
    : models.find((model) => model.isDefault);
}

export function ProjectChatView({
  project,
  tasks,
  snapshot,
  loading,
  inFlight,
  projectBusy = inFlight,
  models,
  collaborationModes = [],
  selectedModel,
  selectedReasoning,
  applyingActionId,
  vault,
  vaultState,
  onSelectedModel,
  onSelectedReasoning,
  onRefreshModels,
  onOpenAgentSettings,
  onChooseAttachments = async () => [],
  onReleaseAttachment = async () => undefined,
  onAttachmentError = () => undefined,
  onSend,
  onCancel,
  onApplyAction,
  sessions = snapshot?.sessions ?? [],
  selectedSessionId = snapshot?.session?.id ?? null,
  initialDraft = '',
  onDraftChange = () => undefined,
  activeSessionIds = EMPTY_SESSION_IDS,
  creatingSession = false,
  branchingMessageId = null,
  onSelectSession = () => undefined,
  onCreateSession = () => undefined,
  onRenameSession,
  sessionRailWidth = PROJECT_CHAT_SESSION_RAIL_DEFAULT_WIDTH,
  onSessionRailWidthChange = () => undefined,
  onBranchSession = async () => undefined,
  initialAdvancedOpen = false,
  initialScrollTop = null,
  unreadAssistantMessageId = null,
  onUnreadAssistantMessageSeen = () => undefined,
  onScrollTopChange = () => undefined,
  sshAccess = NO_PROJECT_CHAT_SSH_ACCESS,
  onOpenSshWorkspaceSetup = () => undefined,
}: {
  project: ProjectRecord;
  tasks: readonly WorkspaceTask[];
  snapshot: ProjectChatSnapshot | null;
  loading: boolean;
  inFlight: boolean;
  projectBusy?: boolean;
  models: readonly CodexModel[];
  collaborationModes: readonly CodexCollaborationModeDescriptor[];
  selectedModel: string | null;
  selectedReasoning: string | null;
  applyingActionId: string | null;
  vault: VaultSelection | null;
  vaultState: VaultRuntimeState;
  onSelectedModel: (modelId: string | null) => void;
  onSelectedReasoning: (reasoningId: string | null) => void;
  onRefreshModels: () => void;
  onOpenAgentSettings: () => void;
  onChooseAttachments?: () => Promise<readonly ProjectChatAttachment[]>;
  onReleaseAttachment?: (attachment: ProjectChatAttachment) => Promise<void>;
  onAttachmentError?: (error: unknown) => void;
  onSend: (
    message: string,
    retryOfAttemptId: string | undefined,
    controls: ProjectChatTurnControls,
    attachmentIds: readonly string[],
  ) => Promise<boolean>;
  onCancel: () => void;
  onApplyAction: (action: ProjectChatAction) => Promise<void>;
  sessions?: readonly NonNullable<ProjectChatSnapshot['session']>[];
  selectedSessionId?: string | null;
  initialDraft?: string;
  onDraftChange?: (value: string) => void;
  activeSessionIds?: ReadonlySet<string>;
  creatingSession?: boolean;
  branchingMessageId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onCreateSession?: () => void;
  onRenameSession?: (
    session: NonNullable<ProjectChatSnapshot['session']>,
    title: string,
  ) => boolean | void | Promise<boolean | void>;
  sessionRailWidth?: number;
  onSessionRailWidthChange?: (width: number) => void;
  onBranchSession?: (messageId: string) => Promise<void>;
  initialAdvancedOpen?: boolean;
  initialScrollTop?: number | null;
  unreadAssistantMessageId?: string | null;
  onUnreadAssistantMessageSeen?: (assistantMessageId: string) => void;
  onScrollTopChange?: (scrollTop: number) => void;
  sshAccess?: ProjectChatSshAccess;
  onOpenSshWorkspaceSetup?: () => void;
}) {
  const [sessionUi, setSessionUi] = useState<ProjectChatSessionUiState>({
    draft: initialDraft,
    retryOfAttemptId: null,
    advancedOpen: initialAdvancedOpen,
  });
  const { draft, retryOfAttemptId, advancedOpen } = sessionUi;
  const setDraft = (value: string) => setSessionUi((current) => ({ ...current, draft: value }));
  const setRetryOfAttemptId = (value: string | null) =>
    setSessionUi((current) => ({ ...current, retryOfAttemptId: value }));
  const setAdvancedOpen = (next: boolean | ((current: boolean) => boolean)) =>
    setSessionUi((current) => ({
      ...current,
      advancedOpen: typeof next === 'function' ? next(current.advancedOpen) : next,
    }));
  const [collaborationModeId, setCollaborationModeId] = useState<string | null>(null);
  const [legacyReviewerCompatibility, setLegacyReviewerCompatibility] = useState(false);
  const [personality, setPersonality] = useState<ProjectChatPersonality>('auto');
  const [responseVerbosity, setResponseVerbosity] = useState<ProjectChatResponseVerbosity>('auto');
  const [contextScope, setContextScope] = useState<ProjectChatContextScope>('project');
  const [attachments, setAttachments] = useState<readonly ProjectChatAttachment[]>([]);
  const [choosingAttachments, setChoosingAttachments] = useState(false);
  const [scrollAffordance, setScrollAffordance] = useState({
    nearBottom: true,
    newAssistantMessageAvailable: false,
  });
  const attachmentsRef = useRef(attachments);
  const releaseAttachmentHandlerRef = useRef(onReleaseAttachment);
  const attachmentScopeRef = useRef('');
  const attachmentPickerGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLElement>(null);
  const unreadAssistantMessageRef = useRef<HTMLElement>(null);
  const observedLatestMessageIdRef = useRef<string | null>(null);
  const observedLatestContentRevisionRef = useRef<string | null>(null);
  const nearBottomRef = useRef(true);
  const wasInFlightRef = useRef(inFlight);
  const initializedScrollSessionKeyRef = useRef<string | null>(null);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  const onUnreadAssistantMessageSeenRef = useRef(onUnreadAssistantMessageSeen);
  const draftSessionKey = `${project.id}\u0000${selectedSessionId ?? ''}`;
  attachmentScopeRef.current = draftSessionKey;
  const hydratedSessionKeyRef = useRef(draftSessionKey);
  const updateDraft = (value: string) => {
    setDraft(value);
    onDraftChange(value);
  };
  const releaseAttachment = (attachment: ProjectChatAttachment) => {
    setAttachments((current) => {
      const next = current.filter((candidate) => candidate.id !== attachment.id);
      attachmentsRef.current = next;
      return next;
    });
    void onReleaseAttachment(attachment).catch(onAttachmentError);
  };
  const chooseAttachments = async () => {
    if (choosingAttachments || attachments.length >= PROJECT_CHAT_MAX_ATTACHMENTS) return;
    const scope = draftSessionKey;
    const generation = ++attachmentPickerGenerationRef.current;
    setChoosingAttachments(true);
    try {
      const selected = await onChooseAttachments();
      if (
        !shouldAcceptAttachmentPickerResult(
          mountedRef.current,
          scope,
          attachmentScopeRef.current,
          generation,
          attachmentPickerGenerationRef.current,
        )
      ) {
        for (const attachment of selected) {
          void releaseAttachmentHandlerRef.current(attachment).catch(() => undefined);
        }
        return;
      }
      const currentAttachments = attachmentsRef.current;
      const existingIds = new Set(currentAttachments.map((attachment) => attachment.id));
      const additions = selected.filter((attachment) => !existingIds.has(attachment.id));
      const remaining = PROJECT_CHAT_MAX_ATTACHMENTS - currentAttachments.length;
      const accepted = additions.slice(0, remaining);
      const rejected = additions.slice(remaining);
      setAttachments((current) => {
        const next = [...current, ...accepted];
        attachmentsRef.current = next;
        return next;
      });
      for (const attachment of rejected) {
        void onReleaseAttachment(attachment).catch(() => undefined);
      }
    } catch (error) {
      if (mountedRef.current && attachmentPickerGenerationRef.current === generation) {
        onAttachmentError(error);
      }
    } finally {
      if (mountedRef.current && attachmentPickerGenerationRef.current === generation) {
        setChoosingAttachments(false);
      }
    }
  };
  const board = useMemo(() => resolveWorkspaceBoardSettings(project.board), [project.board]);
  const selectedCollaborationMode = collaborationModeId
    ? collaborationModes.find((mode) => mode.id === collaborationModeId)
    : null;
  const selectedDescriptor = useMemo(
    () =>
      resolveEffectiveCodexModel(models, collaborationModes, selectedModel, collaborationModeId),
    [collaborationModeId, collaborationModes, models, selectedModel],
  );
  const reasoningOptions = selectedDescriptor?.reasoningOptions ?? [];
  const selectedModelMissing = selectedModel !== null && selectedDescriptor === undefined;
  const recommendedModelMissing =
    selectedModel === null &&
    Boolean(selectedCollaborationMode?.recommendedModelId) &&
    selectedDescriptor === undefined;
  const selectedReasoningMissing =
    selectedReasoning !== null &&
    !reasoningOptions.some((option) => option.id === selectedReasoning);
  const recommendedReasoningMissing =
    selectedReasoning === null &&
    Boolean(selectedCollaborationMode?.recommendedReasoningOptionId) &&
    !reasoningOptions.some(
      (option) => option.id === selectedCollaborationMode?.recommendedReasoningOptionId,
    );
  const modelSelectionWarning = selectedModelMissing
    ? 'The selected model is no longer in the live Codex catalog. Choose a model before sending.'
    : recommendedModelMissing
      ? 'This Codex mode recommends a model that is no longer available. Choose a model or another mode.'
      : selectedReasoningMissing
        ? 'The selected reasoning option is no longer available. Choose another option before sending.'
        : recommendedReasoningMissing
          ? 'This Codex mode recommends reasoning that the effective model does not support. Choose a reasoning option, model, or mode.'
          : null;
  const collaborationModeWarning =
    collaborationModeId !== null && !selectedCollaborationMode
      ? 'The selected Codex collaboration mode is no longer available. Choose a current mode before sending.'
      : null;
  const personalityWarning =
    personality !== 'auto' && selectedDescriptor?.supportsPersonality === false
      ? 'The selected model does not support Codex personality controls. Choose Auto or another model.'
      : null;
  const imageAttachmentWarning =
    attachments.some((attachment) => attachment.visualAvailable) &&
    selectedDescriptor?.modalities !== undefined &&
    !selectedDescriptor.modalities.includes('image')
      ? 'The selected model cannot inspect images. Choose an image-capable model or remove the image attachment.'
      : null;
  const localNotesGrant = snapshot?.profile?.localNotesVault ?? null;
  const localNotesAvailable = Boolean(
    vaultState === 'ready' && localNotesGrant && vault?.id === localNotesGrant.id,
  );
  const localNotesStatus =
    vaultState === 'checking'
      ? 'Local Notes access checking'
      : vaultState === 'unavailable'
        ? 'Local Notes status unavailable'
        : localNotesAvailable
          ? `${localNotesGrant?.name ?? 'Local Notes'} authorized`
          : localNotesGrant
            ? `${localNotesGrant.name} grant inactive`
            : 'Local Notes not authorized';
  const localNotesWarning =
    localNotesGrant && vaultState !== 'ready'
      ? 'GOSU cannot verify the Main-process Local Notes capability yet. This turn is paused to prevent a hidden grant mismatch.'
      : null;
  const selectionWarning =
    modelSelectionWarning ??
    collaborationModeWarning ??
    personalityWarning ??
    imageAttachmentWarning ??
    localNotesWarning;
  const snapshotReady = snapshot !== null;
  const resolvedUnreadAssistantMessageId = resolveUnreadAssistantMessageId(
    snapshot?.messages ?? [],
    unreadAssistantMessageId,
  );
  const latestMessageId = snapshot?.messages.at(-1)?.id ?? null;
  const latestMessage = snapshot?.messages.at(-1) ?? null;
  const latestMessageRole = latestMessage?.role ?? null;
  const latestContentRevision = latestMessage
    ? `${latestMessage.id}\u0000${latestMessage.status}\u0000${latestMessage.completedAt ?? ''}\u0000${latestMessage.content}`
    : null;
  const sshWorkspaceSetupNeeded =
    sshAccess.state === 'ready' &&
    sshAccess.registeredConnectionCount > 0 &&
    sshAccess.grantedWorkspaceCount === 0;
  const sshWorkspaceStatus =
    sshAccess.state === 'checking'
      ? 'SSH workspace access checking'
      : sshAccess.state === 'unavailable'
        ? 'SSH workspace status unavailable'
        : sshAccess.grantedWorkspaceCount > 0
          ? `${sshAccess.grantedWorkspaceCount} SSH workspace${sshAccess.grantedWorkspaceCount === 1 ? '' : 's'} granted`
          : 'SSH workspace not granted';

  useEffect(() => {
    onScrollTopChangeRef.current = onScrollTopChange;
  }, [onScrollTopChange]);

  useEffect(() => {
    onUnreadAssistantMessageSeenRef.current = onUnreadAssistantMessageSeen;
  }, [onUnreadAssistantMessageSeen]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || !shouldInitializeProjectChatScroll(loading, snapshotReady)) return;
    if (initializedScrollSessionKeyRef.current !== draftSessionKey) {
      initializedScrollSessionKeyRef.current = draftSessionKey;
      observedLatestMessageIdRef.current = latestMessageId;
      observedLatestContentRevisionRef.current = latestContentRevision;
      wasInFlightRef.current = inFlight;
      transcript.scrollTop = resolveInitialProjectChatScrollTop({
        savedScrollTop: initialScrollTop,
        scrollHeight: transcript.scrollHeight,
        clientHeight: transcript.clientHeight,
      });
      const nearBottom = isProjectChatNearBottom(
        transcript.scrollTop,
        transcript.scrollHeight,
        transcript.clientHeight,
      );
      nearBottomRef.current = nearBottom;
      setScrollAffordance({
        nearBottom,
        newAssistantMessageAvailable: resolvedUnreadAssistantMessageId !== null && !nearBottom,
      });
      if (nearBottom && resolvedUnreadAssistantMessageId) {
        onUnreadAssistantMessageSeenRef.current(resolvedUnreadAssistantMessageId);
      }
      return;
    }
    const previousLatestMessageId = observedLatestMessageIdRef.current;
    const previousContentRevision = observedLatestContentRevisionRef.current;
    const arrival = resolveProjectChatArrival({
      nearBottom: nearBottomRef.current,
      latestRole: latestMessageRole,
      latestMessageIdChanged: latestMessageId !== previousLatestMessageId,
      latestContentChanged: latestContentRevision !== previousContentRevision,
    });
    observedLatestMessageIdRef.current = latestMessageId;
    observedLatestContentRevisionRef.current = latestContentRevision;
    const inFlightStarted = !wasInFlightRef.current && inFlight;
    wasInFlightRef.current = inFlight;
    const latestMessage = latestMessageRef.current;
    if (arrival.announceNewAssistantMessage) {
      setScrollAffordance((current) => ({
        ...current,
        newAssistantMessageAvailable: resolvedUnreadAssistantMessageId !== null,
      }));
      return;
    }
    const intent =
      arrival.intent === 'none' && inFlightStarted && nearBottomRef.current
        ? 'bottom'
        : arrival.intent;
    if (intent === 'none') {
      if (resolvedUnreadAssistantMessageId && nearBottomRef.current) {
        onUnreadAssistantMessageSeenRef.current(resolvedUnreadAssistantMessageId);
        setScrollAffordance((current) => ({
          ...current,
          newAssistantMessageAvailable: false,
        }));
      } else if (resolvedUnreadAssistantMessageId) {
        setScrollAffordance((current) => ({
          ...current,
          newAssistantMessageAvailable: true,
        }));
      } else {
        setScrollAffordance((current) => ({
          ...current,
          newAssistantMessageAvailable: false,
        }));
      }
      return;
    }
    if (intent === 'bottom') {
      transcript.scrollTop = transcript.scrollHeight;
      nearBottomRef.current = true;
      setScrollAffordance({ nearBottom: true, newAssistantMessageAvailable: false });
      if (resolvedUnreadAssistantMessageId) {
        onUnreadAssistantMessageSeenRef.current(resolvedUnreadAssistantMessageId);
      }
      return;
    }
    if (!latestMessage) return;
    observedLatestMessageIdRef.current = latestMessageId;
    const transcriptBounds = transcript.getBoundingClientRect();
    const messageBounds = latestMessage.getBoundingClientRect();
    const topInset = Number.parseFloat(window.getComputedStyle(transcript).paddingTop) || 0;
    transcript.scrollTop = resolveLatestMessageScrollTop({
      currentScrollTop: transcript.scrollTop,
      scrollHeight: transcript.scrollHeight,
      clientHeight: transcript.clientHeight,
      transcriptTop: transcriptBounds.top,
      messageTop: messageBounds.top,
      topInset,
    });
    const nearBottom = isProjectChatNearBottom(
      transcript.scrollTop,
      transcript.scrollHeight,
      transcript.clientHeight,
    );
    nearBottomRef.current = nearBottom;
    setScrollAffordance({ nearBottom, newAssistantMessageAvailable: false });
    if (resolvedUnreadAssistantMessageId) {
      onUnreadAssistantMessageSeenRef.current(resolvedUnreadAssistantMessageId);
    }
  }, [
    draftSessionKey,
    inFlight,
    initialScrollTop,
    latestContentRevision,
    latestMessageId,
    latestMessageRole,
    loading,
    snapshotReady,
    resolvedUnreadAssistantMessageId,
  ]);

  const jumpToLatest = (target: 'bottom' | 'new-message') => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const targetMessage =
      target === 'new-message' ? unreadAssistantMessageRef.current : latestMessageRef.current;
    if (target === 'new-message') {
      if (!targetMessage) return;
      const transcriptBounds = transcript.getBoundingClientRect();
      const messageBounds = targetMessage.getBoundingClientRect();
      const topInset = Number.parseFloat(window.getComputedStyle(transcript).paddingTop) || 0;
      transcript.scrollTop = resolveLatestMessageScrollTop({
        currentScrollTop: transcript.scrollTop,
        scrollHeight: transcript.scrollHeight,
        clientHeight: transcript.clientHeight,
        transcriptTop: transcriptBounds.top,
        messageTop: messageBounds.top,
        topInset,
      });
      targetMessage.focus({ preventScroll: true });
    } else {
      transcript.scrollTop = transcript.scrollHeight;
    }
    const nearBottom = isProjectChatNearBottom(
      transcript.scrollTop,
      transcript.scrollHeight,
      transcript.clientHeight,
    );
    nearBottomRef.current = nearBottom;
    setScrollAffordance({ nearBottom, newAssistantMessageAvailable: false });
    if (target === 'new-message' && resolvedUnreadAssistantMessageId) {
      onUnreadAssistantMessageSeenRef.current(resolvedUnreadAssistantMessageId);
    } else if (target === 'bottom' && nearBottom && resolvedUnreadAssistantMessageId) {
      onUnreadAssistantMessageSeenRef.current(resolvedUnreadAssistantMessageId);
    }
    onScrollTopChangeRef.current(transcript.scrollTop);
  };

  useLayoutEffect(
    () => () => {
      const transcript = transcriptRef.current;
      if (
        transcript &&
        shouldPersistProjectChatScrollPosition(
          initializedScrollSessionKeyRef.current,
          draftSessionKey,
        )
      ) {
        onScrollTopChangeRef.current(transcript.scrollTop);
      }
    },
    [draftSessionKey],
  );

  useEffect(() => {
    const previousIdentity = hydratedSessionKeyRef.current;
    if (previousIdentity === draftSessionKey) return;
    hydratedSessionKeyRef.current = draftSessionKey;
    attachmentPickerGenerationRef.current += 1;
    setChoosingAttachments(false);
    setSessionUi((current) =>
      reconcileProjectChatSessionUiState(previousIdentity, draftSessionKey, current, initialDraft),
    );
    const staleAttachments = attachmentsRef.current;
    attachmentsRef.current = [];
    setAttachments([]);
    for (const attachment of staleAttachments) {
      void onReleaseAttachment(attachment).catch(() => undefined);
    }
  }, [draftSessionKey, initialDraft]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    releaseAttachmentHandlerRef.current = onReleaseAttachment;
  }, [onReleaseAttachment]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attachmentPickerGenerationRef.current += 1;
      for (const attachment of attachmentsRef.current) {
        void releaseAttachmentHandlerRef.current(attachment).catch(() => undefined);
      }
      attachmentsRef.current = [];
    };
  }, []);

  useEffect(() => {
    const profile = snapshot?.profile ?? defaultProjectChatProfile(project.id);
    const preserveLegacyReviewer = profile.harnessMode === 'reviewer';
    setLegacyReviewerCompatibility(preserveLegacyReviewer);
    setCollaborationModeId(preserveLegacyReviewer ? null : profile.collaborationModeId);
    setPersonality(profile.personality);
    setResponseVerbosity(profile.responseVerbosity);
    setContextScope(profile.contextScope);
  }, [project.id, snapshot?.profile?.version]);

  const submit = () => {
    const message = draft.trim();
    if (!message || loading || projectBusy || selectionWarning) return;
    const controls: ProjectChatTurnControls = {
      harnessMode: legacyReviewerCompatibility
        ? 'reviewer'
        : collaborationModeId === 'plan'
          ? 'planner'
          : 'context',
      responseDepth:
        responseVerbosity === 'low'
          ? 'concise'
          : responseVerbosity === 'high'
            ? 'deep'
            : 'standard',
      personality,
      responseVerbosity,
      contextScope,
      profileVersion: snapshot?.profile?.version ?? 0,
      ...(legacyReviewerCompatibility ? {} : { collaborationModeId }),
    };
    void onSend(
      message,
      retryOfAttemptId ?? undefined,
      controls,
      attachments.map((attachment) => attachment.id),
    ).then((accepted) => {
      if (attachments.length > 0) {
        if (!accepted) {
          for (const attachment of attachments) {
            void onReleaseAttachment(attachment).catch(() => undefined);
          }
        }
        attachmentsRef.current = [];
        setAttachments([]);
      }
      if (accepted) {
        updateDraft('');
        setRetryOfAttemptId(null);
      }
    });
  };

  return (
    <div
      className="project-chat-workspace"
      style={{ '--project-chat-session-rail-width': `${sessionRailWidth}px` } as CSSProperties}
    >
      <ProjectChatSessionRail
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        activeSessionIds={activeSessionIds}
        creating={creatingSession}
        disabled={loading || branchingMessageId !== null}
        renameDisabled={projectBusy}
        onSelect={onSelectSession}
        onCreate={onCreateSession}
        width={sessionRailWidth}
        onWidthChange={onSessionRailWidthChange}
        {...(onRenameSession ? { onRename: onRenameSession } : {})}
      />
      <section
        className={`project-chat-shell ${advancedOpen ? 'agent-controls-open' : ''}`}
        aria-label={`${project.name} project chat`}
      >
        <header className="chat-toolbar">
          <div className="chat-identity">
            <span className="chat-orbit" aria-hidden="true">
              G
            </span>
            <div>
              <strong>GOSU Project Copilot</strong>
              <span>현재 프로젝트 Board, Objective, 승인된 Local Notes를 활용합니다</span>
            </div>
          </div>
          <div className="chat-model-controls">
            <label>
              Model
              <select
                value={selectedModel ?? ''}
                onChange={(event) => onSelectedModel(event.target.value || null)}
                disabled={projectBusy}
              >
                <option value="">Auto · provider recommended</option>
                {selectedModelMissing && (
                  <option value={selectedModel} disabled>
                    Unavailable model · choose again
                  </option>
                )}
                {models.map((model) => (
                  <option value={model.modelId} key={model.modelId}>
                    {model.displayName}
                    {model.isDefault ? ' · default' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reasoning
              <select
                value={selectedReasoning ?? ''}
                onChange={(event) => onSelectedReasoning(event.target.value || null)}
                disabled={
                  projectBusy || (reasoningOptions.length === 0 && !selectedReasoningMissing)
                }
              >
                <option value="">Model default</option>
                {selectedReasoningMissing && (
                  <option value={selectedReasoning} disabled>
                    Unavailable reasoning · choose again
                  </option>
                )}
                {reasoningOptions.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                    {option.isDefault ? ' · default' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ghost-button chat-refresh"
              onClick={onRefreshModels}
              disabled={loading || projectBusy}
            >
              Refresh
            </button>
            <button
              type="button"
              className={`secondary-button chat-agent-toggle ${advancedOpen ? 'active' : ''}`}
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((open) => !open)}
              disabled={projectBusy}
            >
              Agent controls
            </button>
          </div>
          {sshWorkspaceSetupNeeded && (
            <div className="chat-ssh-setup-notice" role="status">
              <div>
                <strong>SSH server registered — project access is not granted yet</strong>
                <span>
                  Choose one specific remote project folder before {project.name} Project Chat can
                  use the server.
                </span>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={onOpenSshWorkspaceSetup}
                disabled={projectBusy}
              >
                Grant to {project.name}…
              </button>
            </div>
          )}
        </header>

        {advancedOpen && (
          <section className="chat-agent-controls" aria-label="Advanced agent controls">
            <div className="chat-agent-control-group">
              <span>Codex mode</span>
              <select
                value={collaborationModeId ?? ''}
                onChange={(event) => {
                  setLegacyReviewerCompatibility(false);
                  setCollaborationModeId(event.target.value || null);
                }}
                disabled={projectBusy}
                aria-label="Codex collaboration mode"
              >
                <option value="">
                  {legacyReviewerCompatibility
                    ? 'Legacy Reviewer · choose a native mode to leave'
                    : 'Auto · Codex default'}
                </option>
                {collaborationModeId !== null && !selectedCollaborationMode && (
                  <option value={collaborationModeId} disabled>
                    Unavailable mode · choose again
                  </option>
                )}
                {collaborationModes.map((mode) => (
                  <option value={mode.id} key={mode.id}>
                    {mode.displayName}
                    {mode.recommendedReasoningOptionId
                      ? ` · ${mode.recommendedReasoningOptionId}`
                      : ''}
                  </option>
                ))}
              </select>
              <small>
                Native modes are discovered from the local Codex App Server, not recreated by GOSU.
              </small>
            </div>
            <div className="chat-agent-control-group">
              <span>Personality</span>
              <select
                value={personality}
                onChange={(event) => setPersonality(event.target.value as ProjectChatPersonality)}
                disabled={projectBusy}
                aria-label="Codex personality"
              >
                {(Object.keys(PERSONALITY_LABELS) as ProjectChatPersonality[]).map((value) => (
                  <option
                    value={value}
                    key={value}
                    disabled={value !== 'auto' && selectedDescriptor?.supportsPersonality === false}
                  >
                    {PERSONALITY_LABELS[value]}
                  </option>
                ))}
              </select>
              <small>
                {selectedDescriptor?.supportsPersonality === false
                  ? 'The selected model does not advertise personality support.'
                  : 'Applied through the native Codex personality setting.'}
              </small>
            </div>
            <div className="chat-agent-control-group">
              <span>Answer verbosity</span>
              <select
                value={responseVerbosity}
                onChange={(event) =>
                  setResponseVerbosity(event.target.value as ProjectChatResponseVerbosity)
                }
                disabled={projectBusy}
                aria-label="Codex answer verbosity"
              >
                {(Object.keys(VERBOSITY_LABELS) as ProjectChatResponseVerbosity[]).map((value) => (
                  <option value={value} key={value}>
                    {VERBOSITY_LABELS[value]}
                  </option>
                ))}
              </select>
              <small>Native model verbosity; reasoning effort remains a separate control.</small>
            </div>
            <div className="chat-agent-control-group">
              <span>Context</span>
              <select
                value={contextScope}
                onChange={(event) => setContextScope(event.target.value as ProjectChatContextScope)}
                disabled={projectBusy}
                aria-label="Turn context scope"
              >
                {(Object.keys(CONTEXT_LABELS) as ProjectChatContextScope[]).map((scope) => (
                  <option value={scope} key={scope}>
                    {CONTEXT_LABELS[scope]}
                  </option>
                ))}
              </select>
              <small>
                Scope controls preloaded context. Authorized Local Notes remain available through
                bounded read tools.
              </small>
            </div>
            <div className="chat-agent-profile-summary">
              <span>Project prompt</span>
              <strong>
                {snapshot?.profile?.customInstructions
                  ? `${snapshot.profile.customInstructions.length} characters · profile v${snapshot.profile.version}`
                  : 'No custom instructions'}
              </strong>
              <button
                type="button"
                className="ghost-button"
                onClick={onOpenAgentSettings}
                disabled={projectBusy}
              >
                Edit in Settings…
              </button>
            </div>
            <div className="chat-agent-boundary">
              <strong>Project capability boundary</strong>
              <span>
                Board + Objective read tools · {localNotesStatus} · {sshWorkspaceStatus} · SSH
                requires Allow once
              </span>
              <small>
                Board changes require Apply. Only project-granted remote workspaces are visible.
                Bounded Git inspection and optional approved direct-argv tests/builds show their
                exact target, root, arguments, and risk for a fresh one-time approval. Raw shells,
                TTY, transfer, unattended execution, secrets, Settings, and Trash remain
                unavailable.
              </small>
            </div>
          </section>
        )}

        <div className="chat-transcript-region">
          <div
            className="chat-transcript"
            ref={transcriptRef}
            aria-live="polite"
            onScroll={(event) => {
              const transcript = event.currentTarget;
              const nearBottom = isProjectChatNearBottom(
                transcript.scrollTop,
                transcript.scrollHeight,
                transcript.clientHeight,
              );
              nearBottomRef.current = nearBottom;
              setScrollAffordance((current) => ({
                nearBottom,
                newAssistantMessageAvailable: nearBottom
                  ? false
                  : current.newAssistantMessageAvailable,
              }));
              if (nearBottom && resolvedUnreadAssistantMessageId) {
                onUnreadAssistantMessageSeenRef.current(resolvedUnreadAssistantMessageId);
              }
              if (
                shouldPersistProjectChatScrollPosition(
                  initializedScrollSessionKeyRef.current,
                  draftSessionKey,
                )
              ) {
                onScrollTopChangeRef.current(transcript.scrollTop);
              }
            }}
          >
            {loading ? (
              <div className="chat-loading">암호화된 프로젝트 대화를 불러오는 중…</div>
            ) : !snapshot?.messages.length ? (
              <div className="chat-welcome">
                <span className="welcome-kicker">PROJECT CONVERSATION</span>
                <h2>{project.name}를 대화로 진행해보세요</h2>
                <p>
                  연구 방향을 논의하거나 작업 생성을 요청할 수 있습니다. Kanban 변경은 AI가
                  제안하고, 사용자가 Apply한 뒤에만 반영됩니다.
                </p>
                <div className="quick-prompts">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      type="button"
                      key={prompt}
                      onClick={() => {
                        updateDraft(prompt);
                        setRetryOfAttemptId(null);
                      }}
                    >
                      {prompt}
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              snapshot.messages.map((message, messageIndex) => {
                const attempt = message.attemptId
                  ? snapshot.attempts?.find((candidate) => candidate.id === message.attemptId)
                  : undefined;
                const failedTurnSource =
                  message.role === 'assistant' &&
                  (message.status === 'failed' || message.status === 'interrupted')
                    ? findRetrySource(snapshot, message, messageIndex)
                    : null;
                const recoveryMode = resolveFailedTurnRecoveryMode(attempt?.errorCode);
                const retrySource = recoveryMode === 'retry' ? failedTurnSource : null;
                const reattachSource = recoveryMode === 'reattach' ? failedTurnSource : null;
                const nativeAttempt = attempt?.collaborationModeId !== undefined;
                const isLatestMessage = messageIndex === snapshot.messages.length - 1;
                const isUnreadAssistantMessage =
                  message.role === 'assistant' && message.id === resolvedUnreadAssistantMessageId;
                return (
                  <article
                    ref={(element) => {
                      if (isLatestMessage) latestMessageRef.current = element;
                      if (isUnreadAssistantMessage) unreadAssistantMessageRef.current = element;
                    }}
                    tabIndex={isLatestMessage || isUnreadAssistantMessage ? -1 : undefined}
                    className={`chat-message ${message.role} ${message.status}`}
                    key={message.id}
                  >
                    <header>
                      <strong>{message.role === 'user' ? 'You' : 'GOSU'}</strong>
                      <span>{formatTime(message.completedAt)}</span>
                    </header>
                    <div className="message-copy">
                      <ProjectChatMarkdown source={message.content} />
                    </div>
                    {(message.model || attempt?.harnessMode || nativeAttempt) && (
                      <footer className="message-provenance">
                        {message.model?.resolvedModelId ?? 'Codex'}
                        {message.model?.reasoningOptionId
                          ? ` · reasoning ${message.model.reasoningOptionId}`
                          : ''}
                        {nativeAttempt
                          ? attempt?.collaborationModeId
                            ? ` · ${collaborationModes.find((mode) => mode.id === attempt.collaborationModeId)?.displayName ?? attempt.collaborationModeId}`
                            : ' · Codex default mode'
                          : attempt?.harnessMode
                            ? ` · legacy ${HARNESS_LABELS[attempt.harnessMode]}`
                            : ''}
                        {attempt?.personality && attempt.personality !== 'auto'
                          ? ` · ${PERSONALITY_LABELS[attempt.personality]}`
                          : ''}
                        {attempt?.responseVerbosity
                          ? ` · ${VERBOSITY_LABELS[attempt.responseVerbosity]}`
                          : attempt?.responseDepth
                            ? ` · legacy ${DEPTH_LABELS[attempt.responseDepth]}`
                            : ''}
                        {attempt?.contextScope ? ` · ${CONTEXT_LABELS[attempt.contextScope]}` : ''}
                      </footer>
                    )}
                    {retrySource && (
                      <footer className="failed-turn-recovery">
                        <span>Saved failed attempt · the connection may now be recovered</span>
                        <button
                          type="button"
                          onClick={() => {
                            updateDraft(retrySource.content);
                            setRetryOfAttemptId(retrySource.attemptId);
                          }}
                        >
                          {retrySource.attemptId ? 'Retry this turn' : 'Use message again'}
                        </button>
                      </footer>
                    )}
                    {reattachSource && (
                      <footer className="failed-turn-recovery">
                        <span>
                          Select an image-capable model, attach the image again, and resend
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            updateDraft(reattachSource.content);
                            setRetryOfAttemptId(null);
                          }}
                        >
                          Use message again
                        </button>
                      </footer>
                    )}
                    {message.status === 'complete' && (
                      <footer className="chat-message-branch">
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={inFlight || branchingMessageId !== null}
                          onClick={() => void onBranchSession(message.id)}
                        >
                          {branchingMessageId === message.id
                            ? 'Creating branch…'
                            : '⑂ Branch from here'}
                        </button>
                      </footer>
                    )}
                    {message.actions.length > 0 && (
                      <div className="chat-actions">
                        {message.actions.map((action) => (
                          <ChatActionCard
                            key={action.id}
                            action={action}
                            tasks={tasks}
                            statusLabels={board.columnLabels}
                            busy={applyingActionId === action.id}
                            onApply={() => void onApplyAction(action)}
                          />
                        ))}
                      </div>
                    )}
                  </article>
                );
              })
            )}
            {inFlight && (
              <article className="chat-message assistant thinking" role="status">
                <header>
                  <strong>GOSU</strong>
                  <span>Codex turn active</span>
                </header>
                <div className="thinking-line">
                  <i />
                  <i />
                  <i />
                  <span>프로젝트 컨텍스트를 검토하고 있습니다</span>
                </div>
              </article>
            )}
          </div>
          {!scrollAffordance.nearBottom && (
            <button
              type="button"
              className="chat-jump-to-latest"
              onClick={() => jumpToLatest('bottom')}
              aria-label="Jump to the latest message"
              title="Jump to latest"
            >
              <span aria-hidden="true">↓</span>
              Latest
            </button>
          )}
        </div>

        <div className="chat-compose-area">
          <div className="chat-context-note">
            <span>LOCAL CONTEXT</span>
            {CONTEXT_LABELS[contextScope]} ·{' '}
            {legacyReviewerCompatibility
              ? 'Legacy Reviewer'
              : collaborationModeId === null
                ? 'Codex default mode'
                : (selectedCollaborationMode?.displayName ?? collaborationModeId)}{' '}
            · {VERBOSITY_LABELS[responseVerbosity]} · {localNotesStatus}
            {' · '}
            {WEB_SEARCH_LABELS[snapshot?.profile?.webSearchMode ?? 'cached']}
            {vaultState === 'ready' && !localNotesAvailable && (
              <button
                type="button"
                className="retry-context"
                onClick={onOpenAgentSettings}
                title="Authorize the selected Local Notes folder for this project"
              >
                Authorize…
              </button>
            )}
            {retryOfAttemptId && (
              <button
                type="button"
                className="retry-context"
                onClick={() => setRetryOfAttemptId(null)}
                title="Send as a new turn instead"
              >
                Retrying saved attempt ×
              </button>
            )}
          </div>
          {selectionWarning && (
            <div className="chat-selection-warning" role="status">
              {selectionWarning}
            </div>
          )}
          {projectBusy && !inFlight && (
            <div className="chat-selection-warning" role="status">
              Another session has an active Codex turn. Open the session marked ● to stop it, or
              wait for it to finish.
            </div>
          )}
          {attachments.length > 0 && (
            <div className="chat-attachments" aria-label="Turn attachments">
              {attachments.map((attachment) => (
                <span className="chat-attachment-chip" key={attachment.id}>
                  <span title={attachment.displayName}>{attachment.displayName}</span>
                  <small title={attachment.reconstructionNotice}>
                    {attachment.format.toUpperCase()}
                    {attachment.visualAvailable
                      ? ` · ${attachment.imageWidth}×${attachment.imageHeight}`
                      : ` · ${attachment.unitCount} ${attachment.unitLabel}${attachment.unitCount === 1 ? '' : 's'}`}
                    {!attachment.textAvailable && !attachment.visualAvailable
                      ? ' · no extractable content'
                      : ''}
                    {attachment.visualAvailable ? ' · visual input' : ''}
                    {attachment.truncated ? ' · excerpted' : ''}
                  </small>
                  <button
                    type="button"
                    onClick={() => releaseAttachment(attachment)}
                    aria-label={`Remove ${attachment.displayName}`}
                    disabled={loading || projectBusy}
                  >
                    ×
                  </button>
                </span>
              ))}
              <span className="chat-attachment-privacy">
                Originals stay local. Bounded reconstructed text and normalized images are shared
                only with the selected model for this turn.
              </span>
            </div>
          )}
          {scrollAffordance.newAssistantMessageAvailable && (
            <div className="chat-new-message-notice-wrap" role="status" aria-live="polite">
              <button
                type="button"
                className="chat-new-message-notice"
                onClick={() => jumpToLatest('new-message')}
              >
                <span aria-hidden="true">↓</span>
                New GOSU message
                <small>View unread response</small>
              </button>
            </div>
          )}
          <div className="chat-composer">
            <button
              type="button"
              className="chat-attach-button"
              onClick={() => void chooseAttachments()}
              disabled={
                loading ||
                projectBusy ||
                choosingAttachments ||
                attachments.length >= PROJECT_CHAT_MAX_ATTACHMENTS
              }
              aria-label="Attach research files"
              title="Attach up to 5 documents, presentations, text files, or images for this turn"
            >
              {choosingAttachments ? '…' : '＋'}
              <span>Files</span>
            </button>
            <textarea
              value={draft}
              onChange={(event) => {
                updateDraft(event.target.value);
                setRetryOfAttemptId(null);
              }}
              onKeyDown={(event) => {
                if (
                  shouldSendChatMessage({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    isComposing: event.nativeEvent.isComposing,
                    keyCode: event.keyCode,
                  })
                ) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="예: baseline 재현 작업을 Planned에 추가하고, 이번 주 우선순위를 정해줘"
              maxLength={12_000}
              disabled={loading || projectBusy}
              aria-label="Message GOSU project copilot"
            />
            {inFlight ? (
              <button type="button" className="danger-button chat-send" onClick={onCancel}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="primary-button chat-send"
                onClick={submit}
                disabled={
                  loading || projectBusy || draft.trim().length === 0 || selectionWarning !== null
                }
              >
                Send
                <span>Enter</span>
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set();

function ChatActionCard({
  action,
  tasks,
  statusLabels,
  busy,
  onApply,
}: {
  action: ProjectChatAction;
  tasks: readonly WorkspaceTask[];
  statusLabels: Readonly<Record<WorkspaceTaskStatus, string>>;
  busy: boolean;
  onApply: () => void;
}) {
  const command = action.command;
  const task =
    command.type === 'task.update'
      ? tasks.find((candidate) => candidate.id === command.taskId)
      : undefined;
  const title =
    command.type === 'task.create'
      ? command.title
      : (command.title ?? task?.title ?? `Task ${command.taskId.slice(0, 8)}`);
  const detail =
    command.type === 'task.create'
      ? `Create in ${statusLabels[command.status]}`
      : `Update${command.status ? ` · move to ${statusLabels[command.status]}` : ''}`;
  return (
    <section className={`chat-action-card ${action.status}`}>
      <div>
        <span>{detail}</span>
        <strong>{title}</strong>
      </div>
      {action.status === 'proposed' ? (
        <button type="button" className="secondary-button" onClick={onApply} disabled={busy}>
          {busy ? 'Applying…' : 'Apply'}
        </button>
      ) : (
        <b>{actionStatusLabel(action)}</b>
      )}
    </section>
  );
}

function actionStatusLabel(action: ProjectChatAction) {
  if (action.status === 'applied') return 'Applied';
  if (action.status === 'applying') return 'Applying';
  if (action.errorCode === 'version_conflict') return 'Board changed · ask again';
  if (action.errorCode === 'application_interrupted') return 'Check Board before retry';
  return 'Could not apply';
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function findRetrySource(
  snapshot: ProjectChatSnapshot,
  assistant: ProjectChatSnapshot['messages'][number],
  beforeIndex: number,
) {
  if (assistant.attemptId) {
    const matchingUser = snapshot.messages.find(
      (message) => message.role === 'user' && message.attemptId === assistant.attemptId,
    );
    if (matchingUser) return { content: matchingUser.content, attemptId: assistant.attemptId };
  }
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.role === 'user') return { content: message.content, attemptId: null };
  }
  return null;
}
