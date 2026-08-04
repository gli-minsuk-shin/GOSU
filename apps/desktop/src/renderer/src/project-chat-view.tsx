import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

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
} from '../../shared/project-chat-contracts';
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
import { ProjectChatSessionRail } from './project-chat-session-rail';

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
  onBranchSession = async () => undefined,
  initialAdvancedOpen = false,
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
  onSend: (
    message: string,
    retryOfAttemptId: string | undefined,
    controls: ProjectChatTurnControls,
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
  onRenameSession?: (session: NonNullable<ProjectChatSnapshot['session']>) => void;
  onBranchSession?: (messageId: string) => Promise<void>;
  initialAdvancedOpen?: boolean;
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
  const transcriptRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLElement>(null);
  const observedLatestMessageIdRef = useRef<string | null>(null);
  const wasInFlightRef = useRef(inFlight);
  const draftSessionKey = `${project.id}\u0000${selectedSessionId ?? ''}`;
  const hydratedSessionKeyRef = useRef(draftSessionKey);
  const updateDraft = (value: string) => {
    setDraft(value);
    onDraftChange(value);
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
    modelSelectionWarning ?? collaborationModeWarning ?? personalityWarning ?? localNotesWarning;
  const latestMessageId = snapshot?.messages.at(-1)?.id ?? null;

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const intent = resolveProjectChatScrollIntent({
      observedLatestMessageId: observedLatestMessageIdRef.current,
      latestMessageId,
      wasInFlight: wasInFlightRef.current,
      inFlight,
    });
    wasInFlightRef.current = inFlight;
    const latestMessage = latestMessageRef.current;
    if (intent === 'none') return;
    if (intent === 'bottom') {
      observedLatestMessageIdRef.current = latestMessageId;
      transcript.scrollTop = transcript.scrollHeight;
      return;
    }
    if (intent === 'top' || !latestMessage) {
      observedLatestMessageIdRef.current = null;
      transcript.scrollTop = 0;
      return;
    }
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
  }, [inFlight, latestMessageId]);

  useEffect(() => {
    const previousIdentity = hydratedSessionKeyRef.current;
    if (previousIdentity === draftSessionKey) return;
    hydratedSessionKeyRef.current = draftSessionKey;
    setSessionUi((current) =>
      reconcileProjectChatSessionUiState(previousIdentity, draftSessionKey, current, initialDraft),
    );
  }, [draftSessionKey, initialDraft]);

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
    void onSend(message, retryOfAttemptId ?? undefined, controls).then((accepted) => {
      if (accepted) {
        updateDraft('');
        setRetryOfAttemptId(null);
      }
    });
  };

  return (
    <div className="project-chat-workspace">
      <ProjectChatSessionRail
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        activeSessionIds={activeSessionIds}
        creating={creatingSession}
        disabled={loading || branchingMessageId !== null}
        renameDisabled={projectBusy}
        onSelect={onSelectSession}
        onCreate={onCreateSession}
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
                Board + Objective read tools · {localNotesStatus} · SSH requires Allow once
              </span>
              <small>
                Board changes require Apply. Remote commands show their exact server alias and typed
                arguments for one-time approval and are limited to a read-only diagnostics
                allowlist; secrets, direct local shell or file access, Settings, and Trash remain
                unavailable.
              </small>
            </div>
          </section>
        )}

        <div className="chat-transcript" ref={transcriptRef} aria-live="polite">
          {loading ? (
            <div className="chat-loading">암호화된 프로젝트 대화를 불러오는 중…</div>
          ) : !snapshot?.messages.length ? (
            <div className="chat-welcome">
              <span className="welcome-kicker">PROJECT CONVERSATION</span>
              <h2>{project.name}를 대화로 진행해보세요</h2>
              <p>
                연구 방향을 논의하거나 작업 생성을 요청할 수 있습니다. Kanban 변경은 AI가 제안하고,
                사용자가 Apply한 뒤에만 반영됩니다.
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
              const retrySource =
                message.role === 'assistant' &&
                (message.status === 'failed' || message.status === 'interrupted')
                  ? findRetrySource(snapshot, message, messageIndex)
                  : null;
              const attempt = message.attemptId
                ? snapshot.attempts?.find((candidate) => candidate.id === message.attemptId)
                : undefined;
              const nativeAttempt = attempt?.collaborationModeId !== undefined;
              return (
                <article
                  ref={messageIndex === snapshot.messages.length - 1 ? latestMessageRef : undefined}
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
          <div className="chat-composer">
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
