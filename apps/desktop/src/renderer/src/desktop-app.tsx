import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import {
  allowsAgentMarkdownCreate,
  type CodexCollaborationModeCatalog,
  type CodexCollaborationModeDescriptor,
  type LocalNotesVaultGrant,
  type ProjectChatAction,
  type ProjectChatEvent,
  type ProjectChatProfile,
  type ProjectChatSession,
  type ProjectChatSnapshot,
  type UpdateProjectChatProfileInput,
} from '../../shared/project-chat-contracts';
import type {
  HermesAcpApprovalDecision,
  HermesAcpApprovalEvent,
  HermesAcpApprovalRequest,
} from '../../shared/hermes-acp-approval-contracts';
import type { RuntimeReadiness } from '../../shared/runtime-contracts';
import type { CodexAuthenticationEvent } from '../../shared/codex-auth-channels';
import type { AgentAddOnStatus } from '../../shared/agent-addon-contracts';
import type {
  CreateSshConnectionInput,
  ImportSshCommandInput,
  RemoveSshConnectionInput,
  SshApprovalRequest,
  SshConnectionProfile,
  SshEvent,
  SshServerResourceSnapshot,
  UpdateSshConnectionInput,
} from '../../shared/ssh-contracts';
import type {
  CreateRemoteWorkspaceGrantInput,
  EnableTrustedRemoteWorkspaceInput,
  GrantedRemoteWorkspace,
  RemoveRemoteWorkspaceGrantInput,
  RevokeTrustedRemoteWorkspaceInput,
  UpdateRemoteWorkspaceGrantInput,
} from '../../shared/ssh-workspace-contracts';
import type {
  CreateProjectInput,
  EmptyProjectTrashInput,
  EmptyProjectTrashReceipt,
  ProjectRecord,
  WorkspacePendingSummary,
  WorkspaceSnapshot,
} from '../../shared/workspace-contracts';
import type { ResearchNotesWorkspace } from '../../shared/research-notes-contracts';
import type { SearchHit } from '../../shared/search-contracts';
import type {
  EmptyLectureStudioTrashInput,
  EmptyLectureStudioTrashReceipt,
  LectureStudioListSnapshot,
  LectureStudioVersionCommand,
} from '../../shared/lecture-studio-contracts';
import type { SaveOverleafPersonalTokenInput } from '../../shared/overleaf-personal-token-contracts';
import { BoardView } from './board-view';
import type { HermesProjectChatConnectionUiState } from './agent-addons-section';
import { resetCodexPicker, selectCodexModel } from './codex-picker-state';
import { ConnectionsView, type CodexModel } from './connections-view';
import { desktopContentClassName } from './desktop-content-layout';
import { ExperimentsView, type ExperimentsViewAdapter } from './experiments-view';
import type { ExperimentEvaluationStudioAdapter } from './experiment-evaluation-studio-view';
import { HermesAcpApprovalCenter } from './hermes-acp-approval-center';
import { buildLocalNotesGrantUpdate } from './local-notes-access-model';
import { LiteratureView, type LiteratureViewAdapter } from './literature-view';
import { ManuscriptView } from './manuscript-view';
import { OverleafPersonalTokenDialog } from './overleaf-personal-token-dialog';
import type { OverleafPersonalTokenUiState } from './overleaf-personal-token-ui';
import { VolatileLectureStudioDrafts } from './lecture-studio-session-state';
import { LectureStudioView, type LectureStudioViewAdapter } from './lecture-studio-view';
import {
  ResearchNotesView,
  type SelectedNote,
  type VaultRuntimeState,
  type VaultSelection,
} from './notes-view';
import {
  ProjectChatLoadGuard,
  clearProjectChatLoading,
  markProjectChatLoading,
  mergeProjectChatSnapshot,
  shouldHydrateProjectChat,
} from './project-chat-load-guard';
import {
  ProjectChatView,
  resolveEditedMessageBranchPoint,
  resolveEffectiveCodexModel,
  type ProjectChatSshServer,
} from './project-chat-view';
import {
  isSelectedHermesProviderFailure,
  ProjectChatProviderOperationQueue,
  reconcileRemovedProjectChatProvider,
  selectProjectChatModel,
  selectProjectChatReasoning,
  type ProjectChatModelSelection,
} from './project-chat-provider-selection';
import {
  AUTO_PROJECT_CHAT_MODEL_SELECTION,
  loadProjectChatModelSelection,
  saveProjectChatModelSelection,
} from './project-chat-model-selection-store';
import {
  enqueueVisibleSshApproval,
  mergeHydratedSshApprovals,
  rememberResolvedSshApproval,
  removeSshApproval,
  shouldPresentSshApproval,
} from './ssh-approval-state';
import {
  buildSshConnectionRemovalConfirmation,
  commitSshMutationThenRefresh,
} from './ssh-mutation-flow';
import {
  activeSessionIdsForProject,
  loadProjectChatLayoutState,
  projectChatSessionKey,
  resolveProjectChatSessionId,
  saveProjectChatLayoutState,
  VolatileProjectChatDrafts,
  VolatileProjectChatScrollPositions,
  VolatileProjectChatUnreadAssistantMessages,
} from './project-chat-session-state';
import { RepositoryView } from './repository-view';
import {
  consumePendingSearchNavigation,
  objectiveSearchHitIsCurrent,
  workspaceTabForSearchHit,
  type PendingSearchNavigation,
} from './search-results-model';
import { SearchView, type SearchViewAdapter } from './search-view';
import {
  loadResearchNotesLayoutState,
  saveResearchNotesLayoutState,
} from './research-notes-layout-state';
import {
  loadLectureStudioLayoutState,
  saveLectureStudioLayoutState,
} from './lecture-studio-layout-state';
import {
  archivedProjects as archivedPortfolioProjects,
  resolveActiveProjectId,
  visibleProjects,
} from './project-portfolio-model';
import {
  hideProjectLocally,
  loadProjectNavigationState,
  PROJECT_SIDEBAR_MAX_WIDTH,
  PROJECT_SIDEBAR_MIN_WIDTH,
  pruneProjectNavigationState,
  saveProjectNavigationState,
  setProjectSidebarWidth,
  showAllProjectsLocally,
  showProjectLocally,
  toggleProjectSidebar,
  type ProjectNavigationState,
} from './project-navigation-state';
import {
  ProjectSidebar,
  ProjectSidebarToggle,
  type GlobalWorkspaceTabId,
  type ProjectWorkspaceTabId,
} from './project-sidebar';
import { ResizeHandle } from './resize-handle';
import { SettingsView, type SettingsCategory } from './settings-view';
import { SshApprovalCenter } from './ssh-approval-center';
import { startSshResourceRefreshScheduler } from './ssh-resource-refresh-policy';
import {
  acknowledgeSshWorkspaceSetupRequest,
  type SshWorkspaceSetupRequest,
} from './ssh-workspace-grants-card';
import { SshWorkspaceLoadGuard, sshWorkspacesForProject } from './ssh-workspace-load-guard';
import {
  sshConnectionTestStatus,
  sshResourceErrorLabel,
  sshResourceErrorReason,
  type SshResourceUiErrorReason,
  type SshResourceUiState,
} from './ssh-resource-summary';
import { SshResourceRequestGuard, sshResourceProfilesKey } from './ssh-resource-request-guard';
import { Connection, describeError } from './ui-primitives';
import {
  applyUserPreferences,
  saveUserPreferences,
  type UserPreferences,
} from './user-preferences';
import {
  EmptyWorkspace,
  ObjectiveEditor,
  ProjectComposer,
  shouldShowActiveProjectPageHeading,
  WorkspacePageHeading,
  WorkspaceUnavailable,
  latestObjective,
  type WorkspaceTabId,
} from './workspace-views';

type CodexConnectionState = 'checking' | 'ready' | 'auth-required' | 'unavailable';
type AppSurface = 'workspace' | 'settings';

type ProjectDraft = Readonly<{ name: string; repository?: string | undefined }>;

const literatureAdapter: LiteratureViewAdapter = {
  list: (input) => window.gosu.literature.list(input),
  search: (input) => window.gosu.literature.search(input),
  updateAnnotations: (input) => window.gosu.literature.updateAnnotations(input),
  deleteRecord: (input) => window.gosu.literature.deleteRecord(input),
  importRecords: (input) => window.gosu.literature.importRecords(input),
  exportRecords: (input) => window.gosu.literature.exportRecords(input),
  organize: (input) => window.gosu.literature.organize(input),
  createPaperNote: (input) => window.gosu.researchNotes.createPaperNote(input),
};

const experimentsAdapter: ExperimentsViewAdapter = {
  list: (input) => window.gosu.experiments.list(input),
  createIdea: (input) => window.gosu.experiments.createIdea(input),
  updateIdea: (input) => window.gosu.experiments.updateIdea(input),
  recordMetric: (input) => window.gosu.experiments.recordMetric(input),
  reviseLoggingTemplate: (input) => window.gosu.experiments.reviseLoggingTemplate(input),
  readRunLog: (input) => window.gosu.experiments.readRunLog(input),
  onEvent: (listener) => window.gosu.experiments.onEvent(listener),
};

const experimentEvaluationAdapter: ExperimentEvaluationStudioAdapter = {
  list: (input) => window.gosu.experimentEvaluation.list(input),
  detail: (input) => window.gosu.experimentEvaluation.detail(input),
  createSession: (input) => window.gosu.experimentEvaluation.createSession(input),
  send: (input) => window.gosu.experimentEvaluation.send(input),
  approve: (input) => window.gosu.experimentEvaluation.approve(input),
  reuseProfile: (input) => window.gosu.experimentEvaluation.reuseProfile(input),
  onEvent: (listener) => window.gosu.experimentEvaluation.onEvent(listener),
};

const lectureStudioAdapter: LectureStudioViewAdapter = {
  list: (input) => window.gosu.lectureStudio.list(input),
  detail: (input) => window.gosu.lectureStudio.detail(input),
  candidates: (input) => window.gosu.lectureStudio.candidates(input),
  stageExternalSources: (input) => window.gosu.lectureStudio.stageExternalSources(input),
  removeStagedExternalSource: (input) =>
    window.gosu.lectureStudio.removeStagedExternalSource(input),
  discardExternalSourceSet: (input) => window.gosu.lectureStudio.discardExternalSourceSet(input),
  importOverleaf: (input) => window.gosu.lectureStudio.importOverleaf(input),
  create: (input) => window.gosu.lectureStudio.create(input),
  updateGenerationBrief: (input) => window.gosu.lectureStudio.updateGenerationBrief(input),
  generate: (input) => window.gosu.lectureStudio.generate(input),
  send: (input) => window.gosu.lectureStudio.send(input),
  cancel: (input) => window.gosu.lectureStudio.cancel(input),
  trash: (input) => window.gosu.lectureStudio.trash(input),
  restore: (input) => window.gosu.lectureStudio.restore(input),
  emptyTrash: (input) => window.gosu.lectureStudio.emptyTrash(input),
  compilePdf: (input) => window.gosu.lectureStudio.compilePdf(input),
  exportArtifact: (input) => window.gosu.lectureStudio.exportArtifact(input),
  openArtifact: (input) => window.gosu.lectureStudio.openArtifact(input),
  revealArtifact: (input) => window.gosu.lectureStudio.revealArtifact(input),
  onEvent: (listener) => window.gosu.lectureStudio.onEvent(listener),
};

const searchAdapter: SearchViewAdapter = {
  search: (input) => window.gosu.search.query(input),
};

function createProjectCommand(
  input: ProjectDraft,
  preferences: UserPreferences,
): CreateProjectInput {
  return {
    ...input,
    board: structuredClone(preferences.defaultBoardTemplate),
  };
}

export function isCodexUnavailableError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const codes: string[] = error.message.match(/[a-z][a-z0-9_]+/gu) ?? [];
  return codes.includes('codex_unavailable') || codes.includes('lecture_codex_unavailable');
}

export function codexAuthenticationUiUpdate(event: CodexAuthenticationEvent): {
  connectionState: CodexConnectionState;
  status: string;
  refreshModels: boolean;
} {
  return event.success
    ? {
        connectionState: 'checking',
        status: 'Codex sign-in completed. Refreshing models…',
        refreshModels: true,
      }
    : {
        connectionState: 'auth-required',
        status: 'Codex sign-in did not complete. Try signing in again.',
        refreshModels: false,
      };
}

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && error.message.includes(code);
}

type HermesAcpApprovalScope = Readonly<{ projectId: string; sessionId: string }>;

function hermesAcpApprovalMatchesScope(
  request: HermesAcpApprovalRequest,
  scope: HermesAcpApprovalScope | null,
) {
  return (
    scope !== null && request.projectId === scope.projectId && request.sessionId === scope.sessionId
  );
}

function orderHermesAcpApprovals(requests: readonly HermesAcpApprovalRequest[]) {
  return [...requests].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function upsertHermesAcpApproval(
  current: readonly HermesAcpApprovalRequest[],
  request: HermesAcpApprovalRequest,
) {
  return orderHermesAcpApprovals([
    ...current.filter((candidate) => candidate.id !== request.id),
    request,
  ]);
}

function removeHermesAcpApproval(current: readonly HermesAcpApprovalRequest[], approvalId: string) {
  return current.filter((request) => request.id !== approvalId);
}

function rememberResolvedHermesAcpApproval(
  current: ReadonlySet<string>,
  approvalId: string,
  maximum = 256,
) {
  const next = new Set(current);
  next.delete(approvalId);
  next.add(approvalId);
  while (next.size > maximum) {
    const oldest = next.values().next().value as string | undefined;
    if (!oldest) break;
    next.delete(oldest);
  }
  return next;
}

function mergeHydratedHermesAcpApprovals(
  current: readonly HermesAcpApprovalRequest[],
  hydrated: readonly HermesAcpApprovalRequest[],
  scope: HermesAcpApprovalScope,
  resolvedApprovalIds: ReadonlySet<string>,
  now = Date.now(),
) {
  const byId = new Map(
    current
      .filter(
        (request) => !resolvedApprovalIds.has(request.id) && Date.parse(request.expiresAt) > now,
      )
      .map((request) => [request.id, request]),
  );
  for (const request of hydrated) {
    if (
      !hermesAcpApprovalMatchesScope(request, scope) ||
      resolvedApprovalIds.has(request.id) ||
      Date.parse(request.expiresAt) <= now
    ) {
      continue;
    }
    byId.set(request.id, request);
  }
  return orderHermesAcpApprovals([...byId.values()]);
}

function sshResourceSnapshotFromState(state: SshResourceUiState | undefined) {
  return state && state.phase !== 'idle' ? state.snapshot : undefined;
}

function markSshResourcesLoading(
  current: Readonly<Record<string, SshResourceUiState>>,
  connectionIds: readonly string[],
) {
  const next = { ...current };
  for (const connectionId of connectionIds) {
    const snapshot = sshResourceSnapshotFromState(current[connectionId]);
    next[connectionId] = snapshot ? { phase: 'loading', snapshot } : { phase: 'loading' };
  }
  return next;
}

function markSshResourcesFailed(
  current: Readonly<Record<string, SshResourceUiState>>,
  connectionIds: readonly string[],
  reason: SshResourceUiErrorReason = 'unavailable',
) {
  const next = { ...current };
  for (const connectionId of connectionIds) {
    const snapshot = sshResourceSnapshotFromState(current[connectionId]);
    next[connectionId] = snapshot
      ? { phase: 'error', snapshot, reason }
      : { phase: 'error', reason };
  }
  return next;
}

function mergeSshResourceSnapshots(
  current: Readonly<Record<string, SshResourceUiState>>,
  snapshots: readonly SshServerResourceSnapshot[],
) {
  const next = { ...current };
  for (const snapshot of snapshots) {
    const existing = sshResourceSnapshotFromState(current[snapshot.connectionId]);
    if (existing && Date.parse(existing.capturedAt) > Date.parse(snapshot.capturedAt)) continue;
    next[snapshot.connectionId] = { phase: 'ready', snapshot };
  }
  return next;
}

export function mergeProjectChatSessionCatalogUpdate(
  current: Readonly<Record<string, readonly ProjectChatSession[]>>,
  session: ProjectChatSession,
) {
  const projectSessions = current[session.projectId] ?? [];
  const found = projectSessions.some((candidate) => candidate.id === session.id);
  return {
    ...current,
    [session.projectId]: found
      ? projectSessions.map((candidate) =>
          candidate.id === session.id &&
          Date.parse(session.updatedAt) >= Date.parse(candidate.updatedAt)
            ? session
            : candidate,
        )
      : [...projectSessions, session],
  };
}

export function mergeProjectChatSessionSnapshotUpdate(
  current: Readonly<Record<string, ProjectChatSnapshot>>,
  session: ProjectChatSession,
) {
  const sessionKey = projectChatSessionKey(session.projectId, session.id);
  const snapshot = current[sessionKey];
  if (!snapshot) return current;
  if (snapshot.session && Date.parse(snapshot.session.updatedAt) > Date.parse(session.updatedAt)) {
    return current;
  }
  return {
    ...current,
    [sessionKey]: { ...snapshot, session },
  };
}

function isProjectWorkspaceTab(tab: WorkspaceTabId): tab is ProjectWorkspaceTabId {
  return (
    tab === 'chat' ||
    tab === 'repository' ||
    tab === 'manuscript' ||
    tab === 'board' ||
    tab === 'objective' ||
    tab === 'experiments' ||
    tab === 'literature' ||
    tab === 'notes'
  );
}

export function DesktopApp({ initialPreferences }: { initialPreferences: UserPreferences }) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [pendingSummary, setPendingSummary] = useState<WorkspacePendingSummary | null>(null);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('chat');
  const [activeSurface, setActiveSurface] = useState<AppSurface>('workspace');
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('appearance');
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [sshRefreshWarning, setSshRefreshWarning] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectNavigation, setProjectNavigation] = useState<ProjectNavigationState>(() =>
    loadProjectNavigationState(window.localStorage),
  );
  const [projectChatLayout, setProjectChatLayout] = useState(() =>
    loadProjectChatLayoutState(window.localStorage),
  );
  const [researchNotesLayout, setResearchNotesLayout] = useState(() =>
    loadResearchNotesLayoutState(window.localStorage),
  );
  const [lectureStudioLayout, setLectureStudioLayout] = useState(() =>
    loadLectureStudioLayoutState(window.localStorage),
  );
  const [lectureTrashSnapshot, setLectureTrashSnapshot] =
    useState<LectureStudioListSnapshot | null>(null);
  const [lectureTrashState, setLectureTrashState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [overleafPersonalTokenState, setOverleafPersonalTokenState] =
    useState<OverleafPersonalTokenUiState>('loading');
  const [overleafTokenSettingsOpen, setOverleafTokenSettingsOpen] = useState(false);
  const [sidebarResizing, setSidebarResizing] = useState(false);

  const [models, setModels] = useState<CodexModel[]>([]);
  const [collaborationModes, setCollaborationModes] = useState<CodexCollaborationModeDescriptor[]>(
    [],
  );
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedReasoning, setSelectedReasoning] = useState<string | null>(null);
  const [hermesProjectChatModel, setHermesProjectChatModel] = useState<CodexModel | null>(null);
  const [hermesProjectChatConnection, setHermesProjectChatConnection] =
    useState<HermesProjectChatConnectionUiState>({ phase: 'disabled', status: null });
  const [projectChatModelSelection, setProjectChatModelSelection] =
    useState<ProjectChatModelSelection>({
      providerId: null,
      modelId: null,
      reasoningOptionId: null,
    });
  const [codexStatus, setCodexStatus] = useState('Catalog not loaded');
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexConnectionState, setCodexConnectionState] =
    useState<CodexConnectionState>('checking');
  const codexRefreshInProgress = useRef(false);
  const refreshModelsRef = useRef<(showRecoveryError?: boolean) => Promise<void>>(async () => {});
  const [codexErrorVisible, setCodexErrorVisible] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeReadiness | null>(null);
  const [researchNotesState, setResearchNotesState] = useState<VaultRuntimeState>('checking');
  const [researchNotesWorkspace, setResearchNotesWorkspace] =
    useState<ResearchNotesWorkspace | null>(null);
  const [selectedNote, setSelectedNote] = useState<SelectedNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [apiKeyMode, setApiKeyMode] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [sshConnections, setSshConnections] = useState<readonly SshConnectionProfile[]>([]);
  const [sshWorkspaces, setSshWorkspaces] = useState<readonly GrantedRemoteWorkspace[]>([]);
  const [sshLinkedProjectIdsByConnectionId, setSshLinkedProjectIdsByConnectionId] = useState<
    Readonly<Record<string, readonly string[]>>
  >({});
  const [sshConnectionBusy, setSshConnectionBusy] = useState<string | null>(null);
  const [sshConnectionState, setSshConnectionState] = useState<
    'checking' | 'ready' | 'unavailable'
  >('checking');
  const [sshWorkspaceRuntime, setSshWorkspaceRuntime] = useState<{
    projectId: string | null;
    state: 'checking' | 'ready' | 'unavailable';
  }>({ projectId: null, state: 'checking' });
  const [sshTestStatus, setSshTestStatus] = useState<Record<string, string>>({});
  const [sshResourceStates, setSshResourceStates] = useState<Record<string, SshResourceUiState>>(
    {},
  );
  const [sshWorkspaceSetupRequest, setSshWorkspaceSetupRequest] =
    useState<SshWorkspaceSetupRequest | null>(null);
  const [sshApprovals, setSshApprovals] = useState<readonly SshApprovalRequest[]>([]);
  const [sshApprovalBusyIds, setSshApprovalBusyIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [hermesAcpApprovals, setHermesAcpApprovals] = useState<readonly HermesAcpApprovalRequest[]>(
    [],
  );
  const [hermesAcpApprovalBusyIds, setHermesAcpApprovalBusyIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [chatSnapshots, setChatSnapshots] = useState<Record<string, ProjectChatSnapshot>>({});
  const [projectChatSessions, setProjectChatSessions] = useState<
    Record<string, readonly ProjectChatSession[]>
  >({});
  const [activeChatSessionIds, setActiveChatSessionIds] = useState<Record<string, string>>({});
  const [chatSessionMutation, setChatSessionMutation] = useState<{
    projectId: string;
    kind: 'create' | 'branch' | 'rename';
    sessionId?: string;
    messageId?: string;
  } | null>(null);
  const [chatLoadingSessionKeys, setChatLoadingSessionKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [chatStartingSessionKeys, setChatStartingSessionKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [chatInFlight, setChatInFlight] = useState<Record<string, boolean>>({});
  const [chatUnreadAssistantMessageIds, setChatUnreadAssistantMessageIds] = useState<
    Record<string, string>
  >({});
  const [applyingChatActionId, setApplyingChatActionId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const chatLoadGuard = useRef(new ProjectChatLoadGuard());
  const codexBootstrapStarted = useRef(false);
  const hermesProjectChatConnectionGenerationRef = useRef(0);
  const hermesProjectChatOperationQueueRef = useRef(new ProjectChatProviderOperationQueue());
  const hermesProjectChatPreferenceRef = useRef(preferences.agentAddOns.hermes);
  const previousHermesProjectChatPreferenceRef = useRef(preferences.agentAddOns.hermes);
  const researchNotesGeneration = useRef(0);
  const researchNoteReadGeneration = useRef(0);
  const [pendingSearchNavigation, setPendingSearchNavigation] =
    useState<PendingSearchNavigation | null>(null);
  const searchNavigationRequestIdRef = useRef(0);
  const sshWorkspaceLoadGuard = useRef(new SshWorkspaceLoadGuard());
  const sshProjectLinksLoadGenerationRef = useRef(0);
  const sshWorkspaceSetupRequestIdRef = useRef(0);
  const sshResourceRequestsRef = useRef(new Map<string, Promise<void>>());
  const sshResourceRequestGuardRef = useRef(new SshResourceRequestGuard());
  const projectNavigationRef = useRef(projectNavigation);
  const activeChatSessionIdsRef = useRef(activeChatSessionIds);
  const projectChatSessionsRef = useRef(projectChatSessions);
  const chatDraftsRef = useRef(new VolatileProjectChatDrafts());
  const lectureStudioDraftsRef = useRef(new VolatileLectureStudioDrafts());
  const chatScrollPositionsRef = useRef(new VolatileProjectChatScrollPositions());
  const chatUnreadAssistantMessagesRef = useRef(new VolatileProjectChatUnreadAssistantMessages());
  const visibleChatSshScopeRef = useRef<{ projectId: string; sessionId: string } | null>(null);
  const sshResolvedApprovalIdsRef = useRef<ReadonlySet<string>>(new Set());
  const visibleChatHermesAcpScopeRef = useRef<HermesAcpApprovalScope | null>(null);
  const hermesAcpApprovalsRef = useRef<readonly HermesAcpApprovalRequest[]>([]);
  const hermesAcpResolvedApprovalIdsRef = useRef<ReadonlySet<string>>(new Set());
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  hermesProjectChatPreferenceRef.current = preferences.agentAddOns.hermes;
  hermesAcpApprovalsRef.current = hermesAcpApprovals;

  const activeProjects = useMemo(() => visibleProjects(snapshot?.projects ?? []), [snapshot]);
  const archivedProjects = useMemo(
    () => archivedPortfolioProjects(snapshot?.projects ?? []),
    [snapshot],
  );
  const activeProject = useMemo(
    () => activeProjects.find((project) => project.id === activeProjectId),
    [activeProjectId, activeProjects],
  );
  const projectChatModels = useMemo(
    () => (hermesProjectChatModel ? [...models, hermesProjectChatModel] : models),
    [hermesProjectChatModel, models],
  );
  const activeResearchNotesSelection = useMemo<VaultSelection | null>(() => {
    if (
      !activeProject ||
      researchNotesWorkspace?.projectId !== activeProject.id ||
      researchNotesWorkspace.status !== 'ready'
    ) {
      return null;
    }
    return {
      id: researchNotesWorkspace.bindingId,
      name: 'Research Notes',
      root: researchNotesWorkspace.displayRoot,
      files: researchNotesWorkspace.files,
    };
  }, [activeProject, researchNotesWorkspace]);
  sshWorkspaceLoadGuard.current.activate(activeProject?.id ?? null);
  const activeProjectSshWorkspaces = sshWorkspacesForProject(
    sshWorkspaces,
    activeProject?.id ?? null,
  );
  const activeProjectSshServers: readonly ProjectChatSshServer[] = activeProjectSshWorkspaces.map(
    ({ connection, grant }) => ({
      connectionId: connection.id,
      grantId: grant.id,
      grantVersion: grant.version,
      label: connection.label,
      canonicalRoot: grant.canonicalRoot,
      permissionMode: grant.permissionMode,
      trustedAccessEnabled: Boolean(grant.trustedAccess),
      privilegeClass:
        connection.directTarget?.user === 'root'
          ? 'root'
          : connection.directTarget?.user
            ? 'standard'
            : 'unknown',
      resourceState: sshResourceStates[connection.id] ?? { phase: 'idle' },
    }),
  );
  const registeredSshConnectionIdsKey = sshConnections
    .map((connection) => connection.id)
    .sort()
    .join(',');
  const activeProjectIdsKey = activeProjects
    .map((project) => project.id)
    .sort()
    .join(',');
  const registeredSshResourceProfilesKey = sshResourceProfilesKey(sshConnections);
  const activeProjectSshConnectionIdsKey = activeProjectSshWorkspaces
    .map((workspace) => workspace.connection.id)
    .sort()
    .join(',');
  const activeProjectSshResourceProfilesKey = sshResourceProfilesKey(
    activeProjectSshWorkspaces.map(({ connection }) => connection),
  );
  const activeProjectSshWorkspaceState =
    sshWorkspaceRuntime.projectId === (activeProject?.id ?? null)
      ? sshWorkspaceRuntime.state
      : 'checking';
  const activeTasks = useMemo(
    () => snapshot?.tasks.filter((task) => task.projectId === activeProjectId) ?? [],
    [activeProjectId, snapshot],
  );
  const activeObjective = useMemo(
    () => latestObjective(snapshot?.objectives ?? [], activeProjectId),
    [activeProjectId, snapshot],
  );
  const chatBusyProjectIds = useMemo(() => {
    const busyProjects = new Set<string>();
    for (const project of snapshot?.projects ?? []) {
      const sessionKeyPrefix = projectChatSessionKey(project.id, '');
      if (
        Object.entries(chatInFlight).some(
          ([key, inFlight]) => inFlight && key.startsWith(sessionKeyPrefix),
        ) ||
        [...chatStartingSessionKeys].some((key) => key.startsWith(sessionKeyPrefix))
      ) {
        busyProjects.add(project.id);
      }
    }
    return busyProjects;
  }, [chatInFlight, chatStartingSessionKeys, snapshot?.projects]);

  const updateProjectNavigation = useCallback((next: ProjectNavigationState) => {
    projectNavigationRef.current = next;
    setProjectNavigation(next);
  }, []);

  const toggleProjectSidebarVisibility = useCallback(() => {
    const next = toggleProjectSidebar(projectNavigationRef.current);
    if (next.sidebarCollapsed) {
      sidebarToggleRef.current?.focus();
    }
    updateProjectNavigation(next);
    setAnnouncement(next.sidebarCollapsed ? 'Project sidebar hidden.' : 'Project sidebar shown.');
  }, [updateProjectNavigation]);

  useEffect(() => {
    projectNavigationRef.current = projectNavigation;
    saveProjectNavigationState(window.localStorage, projectNavigation);
  }, [projectNavigation]);

  useEffect(() => {
    saveProjectChatLayoutState(window.localStorage, projectChatLayout);
  }, [projectChatLayout]);

  useEffect(() => {
    saveResearchNotesLayoutState(window.localStorage, researchNotesLayout);
  }, [researchNotesLayout]);

  useEffect(() => {
    saveLectureStudioLayoutState(window.localStorage, lectureStudioLayout);
  }, [lectureStudioLayout]);

  useEffect(() => {
    activeChatSessionIdsRef.current = activeChatSessionIds;
  }, [activeChatSessionIds]);

  useEffect(() => {
    projectChatSessionsRef.current = projectChatSessions;
  }, [projectChatSessions]);

  const loadWorkspace = async () => {
    const nextSnapshot = await window.gosu.workspace.snapshot();
    const nextNavigation = pruneProjectNavigationState(
      projectNavigationRef.current,
      new Set(nextSnapshot.projects.map((project) => project.id)),
    );
    projectNavigationRef.current = nextNavigation;
    setProjectNavigation(nextNavigation);
    setSnapshot(nextSnapshot);
    setActiveProjectId((current) =>
      resolveActiveProjectId(
        nextSnapshot.projects,
        current,
        new Set(nextNavigation.hiddenProjectIds),
      ),
    );
    try {
      setPendingSummary(await window.gosu.workspace.pendingSummary());
    } catch {
      setPendingSummary(null);
    }
    return nextSnapshot;
  };

  const updateProjectChatSessions = (
    projectId: string,
    sessions: readonly ProjectChatSession[],
  ) => {
    projectChatSessionsRef.current = {
      ...projectChatSessionsRef.current,
      [projectId]: sessions,
    };
    setProjectChatSessions(projectChatSessionsRef.current);
  };

  const activateChatSession = (projectId: string, sessionId: string) => {
    activeChatSessionIdsRef.current = {
      ...activeChatSessionIdsRef.current,
      [projectId]: sessionId,
    };
    setActiveChatSessionIds(activeChatSessionIdsRef.current);
  };

  const projectChatCatalogLoadKey = (projectId: string) => `sessions:${projectId}`;

  const loadProjectChatSessions = async (projectId: string) => {
    const guardKey = projectChatCatalogLoadKey(projectId);
    const loadToken = chatLoadGuard.current.begin(guardKey);
    const sessions = await window.gosu.projectChat.listSessions(projectId);
    if (!chatLoadGuard.current.canApply(loadToken)) {
      return projectChatSessionsRef.current[projectId] ?? sessions;
    }
    updateProjectChatSessions(projectId, sessions);
    return sessions;
  };

  const updateUnreadAssistantMessage = (sessionKey: string, messageId: string | null) => {
    setChatUnreadAssistantMessageIds((current) => {
      if ((current[sessionKey] ?? null) === messageId) return current;
      if (messageId !== null) return { ...current, [sessionKey]: messageId };
      if (!(sessionKey in current)) return current;
      const next = { ...current };
      delete next[sessionKey];
      return next;
    });
  };

  const loadProjectChat = async (projectId: string, requestedSessionId?: string) => {
    if (!projectId) return null;
    let sessions = projectChatSessionsRef.current[projectId] ?? [];
    if (
      sessions.length === 0 ||
      (requestedSessionId !== undefined &&
        !sessions.some((session) => session.id === requestedSessionId))
    ) {
      sessions = await loadProjectChatSessions(projectId);
    }
    const sessionId =
      requestedSessionId ??
      resolveProjectChatSessionId(sessions, activeChatSessionIdsRef.current[projectId]);
    if (!sessionId) return null;
    if (
      activeChatSessionIdsRef.current[projectId] === undefined ||
      (requestedSessionId === undefined && activeChatSessionIdsRef.current[projectId] !== sessionId)
    ) {
      activateChatSession(projectId, sessionId);
    }
    const sessionKey = projectChatSessionKey(projectId, sessionId);
    const loadToken = chatLoadGuard.current.begin(sessionKey);
    setChatLoadingSessionKeys((current) => markProjectChatLoading(current, sessionKey));
    try {
      const loaded = await window.gosu.projectChat.snapshot(projectId, sessionId);
      if (!chatLoadGuard.current.canApply(loadToken)) return null;
      const catalogSession = loaded.session
        ? projectChatSessionsRef.current[projectId]?.find(
            (session) => session.id === loaded.session?.id,
          )
        : undefined;
      const next =
        loaded.session &&
        catalogSession &&
        Date.parse(catalogSession.updatedAt) >= Date.parse(loaded.session.updatedAt)
          ? { ...loaded, session: catalogSession }
          : loaded;
      const resolvedSessionId = next.session?.id ?? sessionId;
      const resolvedSessionKey = projectChatSessionKey(projectId, resolvedSessionId);
      updateUnreadAssistantMessage(
        resolvedSessionKey,
        chatUnreadAssistantMessagesRef.current.observe(projectId, resolvedSessionId, next.messages),
      );
      setChatSnapshots((current) => ({
        ...current,
        [resolvedSessionKey]: mergeProjectChatSnapshot(current[resolvedSessionKey], next),
      }));
      setChatInFlight((current) => ({
        ...current,
        [resolvedSessionKey]: Boolean(next.activeTurnId),
      }));
      return next;
    } finally {
      if (chatLoadGuard.current.isLatestRequest(loadToken)) {
        setChatLoadingSessionKeys((current) => clearProjectChatLoading(current, sessionKey));
      }
    }
  };

  const selectedProjectChatSessionId = (projectId: string) =>
    resolveProjectChatSessionId(
      projectChatSessions[projectId] ?? [],
      activeChatSessionIds[projectId],
    );

  const selectedProjectChatSnapshot = (projectId: string) => {
    const sessionId = selectedProjectChatSessionId(projectId);
    return sessionId ? chatSnapshots[projectChatSessionKey(projectId, sessionId)] : undefined;
  };

  const loadSshConnections = async () => {
    const connections = await window.gosu.ssh.listConnections();
    const invalidatedIds = sshResourceRequestGuardRef.current.reconcile(connections);
    if (invalidatedIds.length > 0) {
      setSshResourceStates((current) => {
        const next = { ...current };
        for (const connectionId of invalidatedIds) delete next[connectionId];
        return next;
      });
    }
    setSshConnections(connections);
    setSshConnectionState('ready');
    return connections;
  };

  const loadSshWorkspaces = async (projectId: string) => {
    const token = sshWorkspaceLoadGuard.current.begin(projectId);
    try {
      const workspaces = await window.gosu.ssh.listWorkspaceGrants({ projectId });
      if (sshWorkspaceLoadGuard.current.accepts(token)) {
        setSshWorkspaces(workspaces);
        setSshWorkspaceRuntime({ projectId, state: 'ready' });
      }
      return workspaces;
    } catch (error) {
      if (sshWorkspaceLoadGuard.current.accepts(token)) {
        setSshWorkspaceRuntime({ projectId, state: 'unavailable' });
        throw error;
      }
      return [];
    }
  };

  const loadSshProjectLinks = async (projects: readonly ProjectRecord[]) => {
    const generation = ++sshProjectLinksLoadGenerationRef.current;
    if (projects.length === 0) {
      setSshLinkedProjectIdsByConnectionId({});
      return {};
    }

    const projectWorkspaces = await Promise.all(
      projects.map(async (project) => ({
        projectId: project.id,
        workspaces: await window.gosu.ssh.listWorkspaceGrants({ projectId: project.id }),
      })),
    );
    const next: Record<string, string[]> = {};
    for (const { projectId, workspaces } of projectWorkspaces) {
      for (const workspace of workspaces) {
        const linkedProjects = next[workspace.connection.id] ?? [];
        linkedProjects.push(projectId);
        next[workspace.connection.id] = linkedProjects;
      }
    }
    if (generation === sshProjectLinksLoadGenerationRef.current) {
      setSshLinkedProjectIdsByConnectionId(next);
    }
    return next;
  };

  const refreshSshResource = useCallback((connectionId: string, force = true) => {
    const token = sshResourceRequestGuardRef.current.token(connectionId);
    if (!token) return Promise.resolve();
    const requestKey = `connection:${connectionId}:${token.generation}`;
    const activeRequest = sshResourceRequestsRef.current.get(requestKey);
    if (activeRequest) return activeRequest;

    setSshResourceStates((current) => markSshResourcesLoading(current, [connectionId]));
    const request = (async () => {
      try {
        const snapshot = await window.gosu.ssh.readResourceSnapshot(
          force ? { connectionId, force: true } : { connectionId },
        );
        setSshResourceStates((current) =>
          sshResourceRequestGuardRef.current.accepts(token)
            ? mergeSshResourceSnapshots(current, [snapshot])
            : current,
        );
      } catch (error) {
        setSshResourceStates((current) =>
          sshResourceRequestGuardRef.current.accepts(token)
            ? markSshResourcesFailed(current, [connectionId], sshResourceErrorReason(error))
            : current,
        );
      } finally {
        sshResourceRequestsRef.current.delete(requestKey);
      }
    })();
    sshResourceRequestsRef.current.set(requestKey, request);
    return request;
  }, []);

  useEffect(() => {
    if (!activeProject) {
      researchNoteReadGeneration.current += 1;
      setResearchNotesWorkspace(null);
      setResearchNotesState('ready');
      setSelectedNote(null);
      return;
    }
    const generation = ++researchNotesGeneration.current;
    researchNoteReadGeneration.current += 1;
    setResearchNotesState('checking');
    setNoteLoading(true);
    setWorkspaceError(null);
    setSelectedNote(null);
    setResearchNotesWorkspace(null);
    void window.gosu.researchNotes
      .current({ projectId: activeProject.id })
      .then((next) => {
        if (researchNotesGeneration.current === generation) {
          setResearchNotesWorkspace(next);
          setResearchNotesState('ready');
        }
      })
      .catch((error: unknown) => {
        if (researchNotesGeneration.current === generation) {
          setResearchNotesWorkspace(null);
          setResearchNotesState('unavailable');
          setWorkspaceError(describeError(error));
        }
      })
      .finally(() => {
        if (researchNotesGeneration.current === generation) setNoteLoading(false);
      });
  }, [activeProject?.id, activeProject?.version]);

  useEffect(() => {
    const navigation = pendingSearchNavigation;
    const hit = navigation?.hit;
    if (
      !hit ||
      hit.target.kind !== 'research-note' ||
      activeTab !== 'notes' ||
      activeProject?.id !== hit.projectId ||
      researchNotesState !== 'ready' ||
      researchNotesWorkspace?.projectId !== hit.projectId
    ) {
      return;
    }
    setPendingSearchNavigation((current) =>
      consumePendingSearchNavigation(current, navigation.requestId),
    );
    const generation = ++researchNoteReadGeneration.current;
    setNoteLoading(true);
    void window.gosu.researchNotes
      .read({ projectId: hit.projectId, path: hit.target.path })
      .then((note) => {
        if (researchNoteReadGeneration.current === generation) {
          setSelectedNote(note as SelectedNote);
          setAnnouncement(`Opened ${hit.title} from local search.`);
        }
      })
      .catch((error: unknown) => {
        if (researchNoteReadGeneration.current === generation) {
          setWorkspaceError(describeError(error));
        }
      })
      .finally(() => {
        if (researchNoteReadGeneration.current === generation) setNoteLoading(false);
      });
  }, [
    activeProject?.id,
    activeTab,
    pendingSearchNavigation,
    researchNotesState,
    researchNotesWorkspace?.projectId,
  ]);

  const refreshProjectSshResources = useCallback(
    (projectId: string, connectionIds: readonly string[], force = false) => {
      const requestScopes = new Map(
        [...new Set(connectionIds)].sort().flatMap((connectionId) => {
          const token = sshResourceRequestGuardRef.current.token(connectionId);
          return token ? ([[connectionId, token]] as const) : [];
        }),
      );
      const scopedConnectionIds = [...requestScopes.keys()];
      if (scopedConnectionIds.length === 0) return Promise.resolve();
      const requestKey = `project:${projectId}:${scopedConnectionIds
        .map(
          (connectionId) => `${connectionId}:${requestScopes.get(connectionId)?.generation ?? 0}`,
        )
        .join(',')}`;
      const activeRequest = sshResourceRequestsRef.current.get(requestKey);
      if (activeRequest) return activeRequest;

      setSshResourceStates((current) => markSshResourcesLoading(current, scopedConnectionIds));
      const request = (async () => {
        try {
          const snapshots = await window.gosu.ssh.listProjectResourceSnapshots(
            force ? { projectId, force: true } : { projectId },
          );
          setSshResourceStates((current) => {
            const allowedIds = new Set(scopedConnectionIds);
            const isCurrent = (connectionId: string) => {
              const token = requestScopes.get(connectionId);
              return token !== undefined && sshResourceRequestGuardRef.current.accepts(token);
            };
            const scopedSnapshots = snapshots.filter(
              (snapshot) =>
                allowedIds.has(snapshot.connectionId) && isCurrent(snapshot.connectionId),
            );
            const returnedIds = new Set(scopedSnapshots.map((snapshot) => snapshot.connectionId));
            const missingIds = scopedConnectionIds.filter(
              (connectionId) => isCurrent(connectionId) && !returnedIds.has(connectionId),
            );
            return markSshResourcesFailed(
              mergeSshResourceSnapshots(current, scopedSnapshots),
              missingIds,
              'project_grant_required',
            );
          });
        } catch (error) {
          setSshResourceStates((current) => {
            const currentIds = scopedConnectionIds.filter((connectionId) => {
              const token = requestScopes.get(connectionId);
              return token !== undefined && sshResourceRequestGuardRef.current.accepts(token);
            });
            return markSshResourcesFailed(current, currentIds, sshResourceErrorReason(error));
          });
        } finally {
          sshResourceRequestsRef.current.delete(requestKey);
        }
      })();
      sshResourceRequestsRef.current.set(requestKey, request);
      return request;
    },
    [],
  );

  const refreshProjectSshResource = useCallback(
    (projectId: string, connectionId: string, force = true) => {
      const token = sshResourceRequestGuardRef.current.token(connectionId);
      if (!token) return Promise.resolve();
      const requestKey = `project:${projectId}:connection:${connectionId}:${token.generation}`;
      const activeRequest = sshResourceRequestsRef.current.get(requestKey);
      if (activeRequest) return activeRequest;

      setSshResourceStates((current) => markSshResourcesLoading(current, [connectionId]));
      const request = (async () => {
        try {
          const snapshot = await window.gosu.ssh.readProjectResourceSnapshot(
            force ? { projectId, connectionId, force: true } : { projectId, connectionId },
          );
          setSshResourceStates((current) =>
            sshResourceRequestGuardRef.current.accepts(token)
              ? mergeSshResourceSnapshots(current, [snapshot])
              : current,
          );
        } catch (error) {
          setSshResourceStates((current) =>
            sshResourceRequestGuardRef.current.accepts(token)
              ? markSshResourcesFailed(current, [connectionId], sshResourceErrorReason(error))
              : current,
          );
        } finally {
          sshResourceRequestsRef.current.delete(requestKey);
        }
      })();
      sshResourceRequestsRef.current.set(requestKey, request);
      return request;
    },
    [],
  );

  useEffect(() => {
    void loadWorkspace()
      .catch((error: unknown) => setWorkspaceError(describeError(error)))
      .finally(() => setWorkspaceLoading(false));

    void window.gosu.runtime
      .readiness()
      .then((next: RuntimeReadiness) => setRuntime(next))
      .catch(() =>
        setCodexStatus((current) =>
          current === 'Catalog not loaded' ? 'Runtime readiness check failed' : current,
        ),
      );

    void loadSshConnections().catch(() => {
      setSshConnections([]);
      setSshConnectionState('unavailable');
    });
  }, []);

  useEffect(() => {
    setSshWorkspaces([]);
    setSshWorkspaceRuntime({ projectId: activeProject?.id ?? null, state: 'checking' });
    if (!activeProject) {
      return;
    }
    void loadSshWorkspaces(activeProject.id).catch((error: unknown) => {
      setSshWorkspaces([]);
      setWorkspaceError(describeError(error));
    });
  }, [activeProject?.id]);

  useEffect(() => {
    if (activeSurface !== 'workspace' || activeTab !== 'connections') return;
    void loadSshProjectLinks(activeProjects).catch((error: unknown) =>
      setWorkspaceError(describeError(error)),
    );
  }, [activeProjectIdsKey, activeSurface, activeTab]);

  useEffect(() => {
    if (activeSurface !== 'workspace' || (activeTab !== 'connections' && activeTab !== 'chat')) {
      return;
    }
    const connectionIdsKey =
      activeTab === 'connections'
        ? registeredSshConnectionIdsKey
        : activeProjectSshConnectionIdsKey;
    const connectionIds = connectionIdsKey ? connectionIdsKey.split(',') : [];
    if (connectionIds.length === 0) return;

    const refreshVisibleResources = () => {
      if (activeTab === 'connections') {
        return Promise.all(
          connectionIds.map((connectionId) => refreshSshResource(connectionId, false)),
        );
      }
      if (activeProject) {
        return refreshProjectSshResources(activeProject.id, connectionIds, false);
      }
      return Promise.resolve();
    };
    return startSshResourceRefreshScheduler({
      interval: preferences.sshResourceRefreshInterval,
      refresh: refreshVisibleResources,
      platform: {
        isVisible: () => !document.hidden,
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (handle) => globalThis.clearTimeout(handle),
        subscribeVisibility: (callback) => {
          document.addEventListener('visibilitychange', callback);
          return () => document.removeEventListener('visibilitychange', callback);
        },
      },
    });
  }, [
    activeProject?.id,
    activeProjectSshConnectionIdsKey,
    activeProjectSshResourceProfilesKey,
    activeSurface,
    activeTab,
    preferences.sshResourceRefreshInterval,
    refreshProjectSshResources,
    refreshSshResource,
    registeredSshConnectionIdsKey,
    registeredSshResourceProfilesKey,
  ]);

  const refreshOverleafPersonalToken = useCallback(async () => {
    setOverleafPersonalTokenState('loading');
    try {
      const status = await window.gosu.overleafPersonalToken.status();
      setOverleafPersonalTokenState(status.state);
    } catch {
      setOverleafPersonalTokenState('unavailable');
      throw new Error('overleaf_personal_token_unavailable');
    }
  }, []);

  const saveOverleafPersonalToken = useCallback(async (input: SaveOverleafPersonalTokenInput) => {
    const status = await window.gosu.overleafPersonalToken.save(input);
    setOverleafPersonalTokenState(status.state);
    setAnnouncement('Saved the Overleaf token for future links on this Mac.');
  }, []);

  const removeOverleafPersonalToken = useCallback(async () => {
    const status = await window.gosu.overleafPersonalToken.remove();
    setOverleafPersonalTokenState(status.state);
    setAnnouncement(
      'Cleared GOSU’s saved Overleaf token. Existing links were preserved, and the token was not revoked in Overleaf.',
    );
  }, []);

  useEffect(() => {
    void refreshOverleafPersonalToken().catch(() => undefined);
  }, [refreshOverleafPersonalToken]);

  useEffect(
    () =>
      window.gosu.app.onOpenSettings(() => {
        setSettingsCategory('appearance');
        setActiveSurface('settings');
        setShowProjectForm(false);
      }),
    [],
  );

  useEffect(
    () => window.gosu.app.onToggleSidebar(toggleProjectSidebarVisibility),
    [toggleProjectSidebarVisibility],
  );

  useEffect(
    () =>
      window.gosu.codex.onAuthenticationEvent((event) => {
        const update = codexAuthenticationUiUpdate(event);
        setCodexConnectionState(update.connectionState);
        setCodexStatus(update.status);
        if (update.refreshModels) void refreshModelsRef.current(true);
      }),
    [],
  );

  useEffect(
    () =>
      window.gosu.projectChat.onEvent((event: ProjectChatEvent) => {
        const sessionKey = projectChatSessionKey(event.projectId, event.sessionId);
        if (event.type === 'session.updated') {
          chatLoadGuard.current.observeEvent(projectChatCatalogLoadKey(event.projectId));
          const nextCatalog = mergeProjectChatSessionCatalogUpdate(
            projectChatSessionsRef.current,
            event.session,
          );
          projectChatSessionsRef.current = nextCatalog;
          setProjectChatSessions(nextCatalog);
          setChatSnapshots((current) =>
            mergeProjectChatSessionSnapshotUpdate(current, event.session),
          );
          return;
        }
        chatLoadGuard.current.observeEvent(sessionKey);
        if (event.type === 'turn.started') {
          setChatInFlight((current) => ({ ...current, [sessionKey]: true }));
          return;
        }
        if (event.type === 'turn.completed') {
          chatUnreadAssistantMessagesRef.current.noteCompletedTurn(
            event.projectId,
            event.sessionId,
            event.turnId,
          );
          setChatInFlight((current) => ({ ...current, [sessionKey]: false }));
          void Promise.all([
            loadProjectChat(event.projectId, event.sessionId),
            loadProjectChatSessions(event.projectId),
          ]).catch((error: unknown) => setWorkspaceError(describeError(error)));
          return;
        }
        if (event.type === 'queue.updated') {
          void loadProjectChat(event.projectId, event.sessionId).catch((error: unknown) =>
            setWorkspaceError(describeError(error)),
          );
          return;
        }
        setChatSnapshots((current) => {
          const sessionSnapshot = current[sessionKey];
          if (!sessionSnapshot) return current;
          return {
            ...current,
            [sessionKey]: {
              ...sessionSnapshot,
              messages: sessionSnapshot.messages.map((message) => ({
                ...message,
                actions: message.actions.map((action) =>
                  action.id === event.action.id ? event.action : action,
                ),
              })),
            },
          };
        });
        if (event.workspaceChanged) {
          void loadWorkspace().catch((error: unknown) => setWorkspaceError(describeError(error)));
        }
      }),
    [],
  );

  useEffect(
    () =>
      window.gosu.ssh.onEvent((event: SshEvent) => {
        if (event.type === 'approval.requested') {
          const visibleScope = visibleChatSshScopeRef.current;
          if (sshResolvedApprovalIdsRef.current.has(event.request.id)) return;
          if (
            !shouldPresentSshApproval(
              event.request,
              visibleScope,
              sshResolvedApprovalIdsRef.current,
            )
          ) {
            void window.gosu.ssh
              .resolveApproval({
                approvalId: event.request.id,
                decision: 'deny',
              })
              .catch(() => undefined);
            return;
          }
          setSshApprovals((current) =>
            enqueueVisibleSshApproval(
              current,
              event.request,
              visibleChatSshScopeRef.current,
              sshResolvedApprovalIdsRef.current,
            ),
          );
          return;
        }
        sshResolvedApprovalIdsRef.current = rememberResolvedSshApproval(
          sshResolvedApprovalIdsRef.current,
          event.approvalId,
        );
        setSshApprovals((current) => removeSshApproval(current, event.approvalId));
        setSshApprovalBusyIds((current) => {
          if (!current.has(event.approvalId)) return current;
          const next = new Set(current);
          next.delete(event.approvalId);
          return next;
        });
        if (event.outcome === 'expired') {
          setWorkspaceError(
            'The server approval expired before a choice was made. Ask Project Chat to retry, then use the centered Allow once dialog.',
          );
        }
      }),
    [],
  );

  useEffect(
    () =>
      window.gosu.hermesAcp.onEvent((event: HermesAcpApprovalEvent) => {
        if (event.type === 'approval.requested') {
          if (hermesAcpResolvedApprovalIdsRef.current.has(event.request.id)) return;
          if (Date.parse(event.request.expiresAt) <= Date.now()) {
            hermesAcpResolvedApprovalIdsRef.current = rememberResolvedHermesAcpApproval(
              hermesAcpResolvedApprovalIdsRef.current,
              event.request.id,
            );
            void window.gosu.hermesAcp
              .resolveApproval({ approvalId: event.request.id, decision: 'deny' })
              .catch(() => undefined);
            return;
          }
          setHermesAcpApprovals((current) => upsertHermesAcpApproval(current, event.request));
          return;
        }
        hermesAcpResolvedApprovalIdsRef.current = rememberResolvedHermesAcpApproval(
          hermesAcpResolvedApprovalIdsRef.current,
          event.approvalId,
        );
        setHermesAcpApprovals((current) => removeHermesAcpApproval(current, event.approvalId));
        setHermesAcpApprovalBusyIds((current) => {
          if (!current.has(event.approvalId)) return current;
          const next = new Set(current);
          next.delete(event.approvalId);
          return next;
        });
        const visibleScope = visibleChatHermesAcpScopeRef.current;
        if (
          event.resolution === 'expired' &&
          visibleScope?.projectId === event.projectId &&
          visibleScope.sessionId === event.sessionId
        ) {
          setWorkspaceError(
            'The Hermes approval expired before a choice was made. Ask Hermes to retry the operation and review the centered approval dialog.',
          );
        }
      }),
    [],
  );

  useEffect(() => {
    if (!shouldHydrateProjectChat(activeTab, activeProjectId)) return;
    void loadProjectChat(activeProjectId).catch((error: unknown) =>
      setWorkspaceError(describeError(error)),
    );
  }, [activeProjectId, activeTab]);

  useEffect(() => {
    if (
      activeSurface !== 'settings' ||
      settingsCategory !== 'agent' ||
      !activeProjectId ||
      selectedProjectChatSnapshot(activeProjectId)?.profile
    ) {
      return;
    }
    void loadProjectChat(activeProjectId).catch((error: unknown) =>
      setWorkspaceError(describeError(error)),
    );
  }, [activeProjectId, activeSurface, settingsCategory]);

  const refreshModels = async (showRecoveryError = false) => {
    if (codexRefreshInProgress.current) return;
    codexRefreshInProgress.current = true;
    setCodexBusy(true);
    setCodexConnectionState('checking');
    setCodexStatus('Checking the local Codex connection and model catalog…');
    try {
      const result = (await window.gosu.codex.reconnect()) as {
        authenticated: boolean;
        models: CodexModel[];
        collaborationModeCatalog: CodexCollaborationModeCatalog;
      };
      setModels(result.models);
      setCollaborationModes(result.collaborationModeCatalog.modes);
      setCodexConnectionState(result.authenticated ? 'ready' : 'auth-required');
      setCodexStatus(
        result.authenticated
          ? `Connected · ${result.models.length} models · ${result.collaborationModeCatalog.modes.length} native modes`
          : `${result.models.length} models and ${result.collaborationModeCatalog.modes.length} native modes found · sign in before chatting`,
      );
      if (codexErrorVisible || showRecoveryError) setWorkspaceError(null);
      setCodexErrorVisible(false);
    } catch (error) {
      setModels([]);
      setCollaborationModes([]);
      setCodexConnectionState('unavailable');
      setCodexStatus(describeError(error));
      if (showRecoveryError) {
        setWorkspaceError(
          'Codex could not reconnect. Board, settings, and Research Notes still work.',
        );
        setCodexErrorVisible(true);
      }
    } finally {
      codexRefreshInProgress.current = false;
      setCodexBusy(false);
    }
  };
  refreshModelsRef.current = refreshModels;

  const startCodexChatGptLogin = () => {
    if (codexBusy) return;
    setActiveSurface('workspace');
    setActiveTab('connections');
    setShowProjectForm(false);
    setCodexBusy(true);
    setCodexConnectionState('auth-required');
    setCodexStatus('Opening secure Codex sign-in in the system browser…');
    void window.gosu.codex
      .loginChatGpt()
      .then(() =>
        setCodexStatus(
          'Complete sign-in in the system browser. GOSU will reconnect automatically.',
        ),
      )
      .catch((error: unknown) => setCodexStatus(describeError(error)))
      .finally(() => setCodexBusy(false));
  };

  const applyHermesProjectChatStatus = useCallback((status: AgentAddOnStatus) => {
    if (!status.connected || !status.projectChatModel) {
      throw new Error('hermes_project_chat_connection_unavailable');
    }
    const model: CodexModel = {
      ...status.projectChatModel,
      reasoningOptions: [...status.projectChatModel.reasoningOptions],
    };
    setHermesProjectChatModel(model);
    setHermesProjectChatConnection({ phase: 'ready', status });
  }, []);

  const removeHermesProjectChatDescriptor = useCallback(() => {
    setHermesProjectChatModel(null);
  }, []);

  const refreshHermesProjectChatConnection = useCallback(async () => {
    const generation = ++hermesProjectChatConnectionGenerationRef.current;
    if (hermesProjectChatPreferenceRef.current !== 'connect-local') return false;
    setHermesProjectChatConnection((current) => ({ ...current, phase: 'checking' }));
    try {
      const status = await hermesProjectChatOperationQueueRef.current.enqueue(() =>
        window.gosu.agentAddOns.connect('hermes'),
      );
      if (
        generation !== hermesProjectChatConnectionGenerationRef.current ||
        hermesProjectChatPreferenceRef.current !== 'connect-local'
      ) {
        return false;
      }
      applyHermesProjectChatStatus(status);
      return true;
    } catch {
      if (
        generation !== hermesProjectChatConnectionGenerationRef.current ||
        hermesProjectChatPreferenceRef.current !== 'connect-local'
      ) {
        return false;
      }
      // Keep an explicitly selected Hermes model ID. Removing only its live descriptor makes the
      // existing unavailable-selection guard block the next turn instead of falling back to Codex.
      removeHermesProjectChatDescriptor();
      setHermesProjectChatConnection({ phase: 'unavailable', status: null });
      return false;
    }
  }, [applyHermesProjectChatStatus, removeHermesProjectChatDescriptor]);

  useEffect(() => {
    const preference = preferences.agentAddOns.hermes;
    const previousPreference = previousHermesProjectChatPreferenceRef.current;
    previousHermesProjectChatPreferenceRef.current = preference;
    if (preference === 'connect-local') {
      void refreshHermesProjectChatConnection();
      return;
    }

    const generation = ++hermesProjectChatConnectionGenerationRef.current;
    removeHermesProjectChatDescriptor();
    setHermesProjectChatConnection({ phase: 'disabled', status: null });
    if (previousPreference !== 'connect-local') return;

    setHermesProjectChatConnection((current) => ({ ...current, phase: 'checking' }));
    void hermesProjectChatOperationQueueRef.current
      .enqueue(() => window.gosu.agentAddOns.disconnect('hermes'))
      .then(() => {
        if (
          generation !== hermesProjectChatConnectionGenerationRef.current ||
          hermesProjectChatPreferenceRef.current === 'connect-local'
        ) {
          return;
        }
        setHermesProjectChatConnection({ phase: 'disabled', status: null });
        setProjectChatModelSelection((current) =>
          reconcileRemovedProjectChatProvider(current, {
            removedProviderId: 'hermes',
            reason: 'explicit-disconnect',
          }),
        );
        setAnnouncement('Disconnected BYO Hermes. Any explicit Hermes selection was cleared.');
      })
      .catch((error: unknown) => {
        if (generation !== hermesProjectChatConnectionGenerationRef.current) return;
        setHermesProjectChatConnection({ phase: 'unavailable', status: null });
        setWorkspaceError(
          `Hermes could not be disconnected safely: ${describeError(error)}. Its prior selection remains blocked.`,
        );
      });
  }, [
    preferences.agentAddOns.hermes,
    refreshHermesProjectChatConnection,
    removeHermesProjectChatDescriptor,
  ]);

  useEffect(() => {
    if (codexBootstrapStarted.current) return;
    codexBootstrapStarted.current = true;
    void refreshModels();
  }, []);

  const chooseResearchNotesVault = async (projectId: string) => {
    if (noteLoading) return;
    const generation = ++researchNotesGeneration.current;
    researchNoteReadGeneration.current += 1;
    setResearchNotesState('checking');
    setNoteLoading(true);
    setWorkspaceError(null);
    try {
      const next = await window.gosu.researchNotes.chooseVault({ projectId });
      if (researchNotesGeneration.current !== generation) return;
      setResearchNotesWorkspace(next);
      setResearchNotesState('ready');
      setSelectedNote(null);
      setAnnouncement(
        next
          ? `Connected ${next.displayRoot} and prepared the project Research Notes folders.`
          : 'Obsidian Vault selection was cancelled.',
      );
    } catch (error) {
      if (researchNotesGeneration.current === generation) {
        setResearchNotesState('unavailable');
        setWorkspaceError(describeError(error));
      }
    } finally {
      if (researchNotesGeneration.current === generation) setNoteLoading(false);
    }
  };

  const runWorkspaceAction = async (
    key: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    if (busyAction !== null) return false;
    setBusyAction(key);
    setWorkspaceError(null);
    try {
      await action();
      await loadWorkspace();
      setAnnouncement(successMessage);
      return true;
    } catch (error) {
      setWorkspaceError(describeError(error));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const emptyProjectTrash = async (
    input: EmptyProjectTrashInput,
  ): Promise<EmptyProjectTrashReceipt | null> => {
    if (busyAction !== null) return null;
    setBusyAction('project:trash:empty');
    setWorkspaceError(null);
    try {
      const receipt = await window.gosu.workspace.emptyProjectTrash(input);
      await loadWorkspace();
      setAnnouncement(
        `Permanently removed ${receipt.removedProjects.length} project${receipt.removedProjects.length === 1 ? '' : 's'} from GOSU. External research data was preserved.`,
      );
      return receipt;
    } catch (error) {
      setWorkspaceError(describeError(error));
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const loadLectureTrash = useCallback(async () => {
    setLectureTrashState('loading');
    try {
      setLectureTrashSnapshot(await window.gosu.lectureStudio.list({ includeTrashed: true }));
      setLectureTrashState('ready');
    } catch {
      setLectureTrashSnapshot(null);
      setLectureTrashState('error');
    }
  }, []);

  const restoreLectureStudio = async (input: LectureStudioVersionCommand) => {
    if (busyAction !== null) return false;
    setBusyAction(`lecture:restore:${input.studioId}`);
    setWorkspaceError(null);
    try {
      await window.gosu.lectureStudio.restore(input);
      await loadLectureTrash();
      setAnnouncement('Restored the Lecture Studio with its chat and revision history.');
      return true;
    } catch (error) {
      setWorkspaceError(describeError(error));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const emptyLectureStudioTrash = async (
    input: EmptyLectureStudioTrashInput,
  ): Promise<EmptyLectureStudioTrashReceipt | null> => {
    if (busyAction !== null) return null;
    setBusyAction('lecture:trash:empty');
    setWorkspaceError(null);
    try {
      const receipt = await window.gosu.lectureStudio.emptyTrash(input);
      await loadLectureTrash();
      setAnnouncement(
        `Permanently removed ${receipt.removedStudios.length} Lecture Studio${receipt.removedStudios.length === 1 ? '' : 's'} from GOSU. Research Notes and exported files were preserved.`,
      );
      return receipt;
    } catch (error) {
      setWorkspaceError(describeError(error));
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    if (activeSurface === 'settings' && settingsCategory === 'trash') {
      void loadLectureTrash();
    }
  }, [activeSurface, loadLectureTrash, settingsCategory]);

  const runSshConnectionAction = async (
    key: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    if (sshConnectionBusy !== null) return false;
    setSshConnectionBusy(key);
    setWorkspaceError(null);
    setSshRefreshWarning(null);
    const outcome = await commitSshMutationThenRefresh(action, () =>
      Promise.all([
        loadSshConnections(),
        ...(activeProject ? [loadSshWorkspaces(activeProject.id)] : []),
        loadSshProjectLinks(activeProjects),
      ]),
    );
    setSshConnectionBusy(null);

    if (!outcome.committed) {
      if (hasErrorCode(outcome.mutationError, 'ssh_unavailable')) {
        setSshConnectionState('unavailable');
      }
      setWorkspaceError(describeError(outcome.mutationError));
      return false;
    }

    setAnnouncement(successMessage);
    if (outcome.refreshError) {
      setSshRefreshWarning(
        `The SSH change was saved, but GOSU could not refresh every SSH view. Do not repeat the change; reopen Connections or refresh the affected view. ${describeError(outcome.refreshError)}`,
      );
    }
    return true;
  };

  const runSshWorkspaceAction = async (
    key: string,
    projectId: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    if (sshConnectionBusy !== null) return false;
    setSshConnectionBusy(key);
    setWorkspaceError(null);
    setSshRefreshWarning(null);
    const outcome = await commitSshMutationThenRefresh(action, () =>
      Promise.all([loadSshWorkspaces(projectId), loadSshProjectLinks(activeProjects)]),
    );
    setSshConnectionBusy(null);

    if (!outcome.committed) {
      setWorkspaceError(describeError(outcome.mutationError));
      return false;
    }

    setAnnouncement(successMessage);
    if (outcome.refreshError) {
      setSshRefreshWarning(
        `The project SSH grant change was saved, but GOSU could not refresh every SSH view. Do not repeat the change; reopen Connections or refresh the affected view. ${describeError(outcome.refreshError)}`,
      );
    }
    return true;
  };

  const testSshConnection = async (connectionId: string) => {
    if (sshConnectionBusy !== null) return false;
    setSshConnectionBusy(`test:${connectionId}`);
    setWorkspaceError(null);
    setSshTestStatus((current) => ({ ...current, [connectionId]: 'Testing…' }));
    try {
      const result = await window.gosu.ssh.testConnection(connectionId);
      const status = sshConnectionTestStatus(result);
      setSshTestStatus((current) => ({ ...current, [connectionId]: status }));
      setSshConnectionState('ready');
      return result.reachable;
    } catch (error) {
      const reason = sshResourceErrorReason(error);
      setSshTestStatus((current) => ({
        ...current,
        [connectionId]: `Test unavailable · ${sshResourceErrorLabel(reason)}`,
      }));
      setWorkspaceError(describeError(error));
      setSshConnectionState('unavailable');
      return false;
    } finally {
      setSshConnectionBusy(null);
    }
  };

  const resolveSshApproval = async (approvalId: string, decision: 'allow_once' | 'deny') => {
    if (sshApprovalBusyIds.has(approvalId)) return;
    setSshApprovalBusyIds((current) => new Set(current).add(approvalId));
    setWorkspaceError(null);
    try {
      await window.gosu.ssh.resolveApproval({ approvalId, decision });
      sshResolvedApprovalIdsRef.current = rememberResolvedSshApproval(
        sshResolvedApprovalIdsRef.current,
        approvalId,
      );
      setSshApprovals((current) => removeSshApproval(current, approvalId));
    } catch (error) {
      const description = describeError(error);
      if (
        hasErrorCode(error, 'ssh_approval_not_found') ||
        hasErrorCode(error, 'ssh_approval_expired') ||
        hasErrorCode(error, 'ssh_approval_cancelled')
      ) {
        sshResolvedApprovalIdsRef.current = rememberResolvedSshApproval(
          sshResolvedApprovalIdsRef.current,
          approvalId,
        );
        setSshApprovals((current) => removeSshApproval(current, approvalId));
      }
      setWorkspaceError(description);
    } finally {
      setSshApprovalBusyIds((current) => {
        const next = new Set(current);
        next.delete(approvalId);
        return next;
      });
    }
  };

  const resolveHermesAcpApproval = async (
    approvalId: string,
    decision: HermesAcpApprovalDecision,
  ) => {
    if (hermesAcpApprovalBusyIds.has(approvalId)) return;
    const request = hermesAcpApprovalsRef.current.find((candidate) => candidate.id === approvalId);
    const requestCanReceiveDecision =
      request !== undefined &&
      Date.parse(request.expiresAt) > Date.now() &&
      request.options.includes(decision);
    const effectiveDecision: HermesAcpApprovalDecision = requestCanReceiveDecision
      ? decision
      : 'deny';

    setHermesAcpApprovalBusyIds((current) => new Set(current).add(approvalId));
    setWorkspaceError(null);
    try {
      await window.gosu.hermesAcp.resolveApproval({
        approvalId,
        decision: effectiveDecision,
      });
      hermesAcpResolvedApprovalIdsRef.current = rememberResolvedHermesAcpApproval(
        hermesAcpResolvedApprovalIdsRef.current,
        approvalId,
      );
      setHermesAcpApprovals((current) => removeHermesAcpApproval(current, approvalId));
      if (!requestCanReceiveDecision && decision !== 'deny') {
        setWorkspaceError(
          'GOSU denied this Hermes request because its project, chat session, option, or deadline no longer matched the visible approval.',
        );
      }
    } catch (error) {
      if (
        hasErrorCode(error, 'hermes_acp_approval_not_found') ||
        hasErrorCode(error, 'hermes_acp_approval_decision_not_offered')
      ) {
        hermesAcpResolvedApprovalIdsRef.current = rememberResolvedHermesAcpApproval(
          hermesAcpResolvedApprovalIdsRef.current,
          approvalId,
        );
        setHermesAcpApprovals((current) => removeHermesAcpApproval(current, approvalId));
      }
      setWorkspaceError(describeError(error));
    } finally {
      setHermesAcpApprovalBusyIds((current) => {
        const next = new Set(current);
        next.delete(approvalId);
        return next;
      });
    }
  };

  useEffect(() => {
    const selectedSessionId = activeProjectId
      ? resolveProjectChatSessionId(
          projectChatSessions[activeProjectId] ?? [],
          activeChatSessionIds[activeProjectId],
        )
      : null;
    const currentScope =
      activeSurface === 'workspace' && activeTab === 'chat' && activeProjectId && selectedSessionId
        ? { projectId: activeProjectId, sessionId: selectedSessionId }
        : null;
    const previousScope = visibleChatSshScopeRef.current;
    if (
      previousScope &&
      (previousScope.projectId !== currentScope?.projectId ||
        previousScope.sessionId !== currentScope?.sessionId)
    ) {
      setSshApprovals((current) =>
        current.filter(
          (request) =>
            request.projectId !== previousScope.projectId ||
            request.sessionId !== previousScope.sessionId,
        ),
      );
      void window.gosu.ssh
        .cancelScope(previousScope)
        .catch(() => setWorkspaceError('Could not cancel the previous SSH activity safely.'));
      void window.gosu.projectChat
        .revokeSsh(previousScope.projectId, previousScope.sessionId)
        .catch(() => setWorkspaceError('Could not revoke the previous SSH capability safely.'));
    }
    visibleChatSshScopeRef.current = currentScope;

    // Hermes turns may continue concurrently in background project/chat sessions. Navigation does
    // not revoke their scoped requests; the global approval dialog labels the owning project and
    // session. Actual cancel, thread release, disconnect, and expiry still fail closed in Main.
    visibleChatHermesAcpScopeRef.current = currentScope;
  }, [activeChatSessionIds, activeProjectId, activeSurface, activeTab, projectChatSessions]);

  const pendingCount = pendingSummary?.count ?? 0;

  const updatePreferences = (next: UserPreferences) => {
    applyUserPreferences(document.documentElement, next);
    setPreferences(next);
    setAnnouncement(
      saveUserPreferences(window.localStorage, next)
        ? 'Saved local settings on this Mac.'
        : 'Settings changed for this session but could not be saved.',
    );
  };

  const updateProjectChatProfile = async (input: UpdateProjectChatProfileInput) => {
    if (busyAction !== null) return false;
    setBusyAction(`project-chat:profile:${input.projectId}`);
    setWorkspaceError(null);
    try {
      const profile = await window.gosu.projectChat.updateProfile(input);
      chatLoadGuard.current.invalidateProject(projectChatCatalogLoadKey(input.projectId));
      for (const session of projectChatSessionsRef.current[input.projectId] ?? []) {
        chatLoadGuard.current.invalidateProject(projectChatSessionKey(input.projectId, session.id));
      }
      setChatSnapshots((current) => {
        const updated = { ...current };
        for (const [key, existing] of Object.entries(current)) {
          if (existing.projectId === input.projectId) updated[key] = { ...existing, profile };
        }
        return updated;
      });
      setAnnouncement(`Saved project agent profile version ${profile.version}.`);
      return true;
    } catch (error) {
      setWorkspaceError(describeError(error));
      await loadProjectChat(input.projectId).catch(() => undefined);
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const updateProjectLocalNotesGrant = async (
    project: ProjectRecord,
    profile: ProjectChatProfile,
    grant: LocalNotesVaultGrant | null,
  ) => {
    const saved = await updateProjectChatProfile(buildLocalNotesGrantUpdate(profile, grant));
    if (saved) {
      setAnnouncement(
        grant
          ? allowsAgentMarkdownCreate(grant)
            ? `Authorized ${grant.name} reads and create-only automatic Markdown saves for ${project.name} project chat.`
            : `Kept ${grant.name} read-only for ${project.name} project chat.`
          : `Revoked Research Notes access for ${project.name}.`,
      );
    }
  };

  const createProject = async (input: ProjectDraft) => {
    const command = createProjectCommand(input, preferences);
    let createdProject: ProjectRecord | undefined;
    const succeeded = await runWorkspaceAction(
      'project:create',
      async () => {
        createdProject = await window.gosu.workspace.createProject(command);
      },
      `Created ${input.name}.`,
    );
    if (succeeded && createdProject) {
      const shown = showProjectLocally(projectNavigationRef.current, createdProject.id);
      updateProjectNavigation({
        ...shown,
        expandedProjectIds: [...new Set([...shown.expandedProjectIds, createdProject.id])],
        activeGroupExpanded: true,
      });
      setActiveProjectId(createdProject.id);
      setShowProjectForm(false);
      setActiveSurface('workspace');
      setActiveTab('chat');
    }
    return succeeded;
  };

  const selectProject = (projectId: string) => {
    setPendingSearchNavigation(null);
    setActiveProjectId(projectId);
    setActiveSurface('workspace');
    setShowProjectForm(false);
    if (!isProjectWorkspaceTab(activeTab)) setActiveTab('chat');
  };

  const selectProjectTab = (projectId: string, tab: ProjectWorkspaceTabId) => {
    setPendingSearchNavigation(null);
    setActiveProjectId(projectId);
    setActiveSurface('workspace');
    setActiveTab(tab);
    setShowProjectForm(false);
  };

  const selectGlobalTab = (tab: GlobalWorkspaceTabId) => {
    setPendingSearchNavigation(null);
    setActiveSurface('workspace');
    setActiveTab(tab);
    setShowProjectForm(false);
  };

  const openSearchHit = (hit: SearchHit) => {
    researchNoteReadGeneration.current += 1;
    const project = snapshot?.projects.find((candidate) => candidate.id === hit.projectId);
    if (!project || project.trashedAt) {
      setPendingSearchNavigation(null);
      setWorkspaceError('This search result no longer belongs to an available project.');
      return;
    }
    if (!objectiveSearchHitIsCurrent(hit, snapshot?.objectives ?? [])) {
      setPendingSearchNavigation(null);
      setWorkspaceError(
        'This Goal & Metrics result is no longer the current objective version. Refresh Search to open the latest version.',
      );
      return;
    }
    setActiveProjectId(project.id);
    setShowProjectForm(false);
    if (project.archivedAt) {
      setPendingSearchNavigation(null);
      setSettingsCategory('projects');
      setActiveSurface('settings');
      setAnnouncement(`Restore ${project.name} before opening this archived result.`);
      return;
    }
    const shown = showProjectLocally(projectNavigationRef.current, project.id);
    updateProjectNavigation({
      ...shown,
      expandedProjectIds: [...new Set([...shown.expandedProjectIds, project.id])],
      activeGroupExpanded: true,
    });
    const tab = workspaceTabForSearchHit(hit);
    setPendingSearchNavigation(
      hit.target.kind === 'objective'
        ? null
        : {
            requestId: ++searchNavigationRequestIdRef.current,
            hit,
          },
    );
    setActiveSurface('workspace');
    setActiveTab(tab);
    if (hit.target.kind === 'project-chat') {
      activateChatSession(project.id, hit.target.sessionId);
      void loadProjectChat(project.id, hit.target.sessionId).catch((error: unknown) =>
        setWorkspaceError(describeError(error)),
      );
      setAnnouncement(`Opened ${hit.title} in Project Chat.`);
      return;
    }
    setAnnouncement(`Opened ${project.name} · ${tab}.`);
  };

  const completeSearchNavigation = useCallback((requestId: number) => {
    setPendingSearchNavigation((current) => consumePendingSearchNavigation(current, requestId));
  }, []);

  const openAgentSettings = () => {
    setSettingsCategory('agent');
    setActiveSurface('settings');
    setShowProjectForm(false);
  };

  const openOverleafSettings = () => {
    setOverleafTokenSettingsOpen(true);
  };

  const openSshWorkspaceSetup = (
    connectionId: string | null = null,
    projectId: string | null = activeProject?.id ?? null,
  ) => {
    if (projectId) {
      sshWorkspaceSetupRequestIdRef.current += 1;
      setSshWorkspaceSetupRequest({
        requestId: sshWorkspaceSetupRequestIdRef.current,
        projectId,
        connectionId,
      });
      setActiveProjectId(projectId);
    }
    setActiveSurface('workspace');
    setActiveTab('connections');
    setShowProjectForm(false);
  };

  const selectChatSession = (projectId: string, sessionId: string) => {
    activateChatSession(projectId, sessionId);
    void loadProjectChat(projectId, sessionId).catch((error: unknown) =>
      setWorkspaceError(describeError(error)),
    );
  };

  const createChatSession = async (projectId: string) => {
    if (chatSessionMutation) return;
    setChatSessionMutation({ projectId, kind: 'create' });
    setWorkspaceError(null);
    try {
      const session = await window.gosu.projectChat.createSession({ projectId });
      activateChatSession(projectId, session.id);
      await loadProjectChat(projectId, session.id);
      setAnnouncement(`Created ${session.title}.`);
    } catch (error) {
      setWorkspaceError(describeError(error));
    } finally {
      setChatSessionMutation(null);
    }
  };

  const branchChatSession = async (projectId: string, messageId: string) => {
    const sourceSessionId = activeChatSessionIdsRef.current[projectId];
    const sourceSessionKey = sourceSessionId
      ? projectChatSessionKey(projectId, sourceSessionId)
      : null;
    if (
      !sourceSessionId ||
      !sourceSessionKey ||
      chatInFlight[sourceSessionKey] ||
      chatStartingSessionKeys.has(sourceSessionKey) ||
      chatSessionMutation
    ) {
      return;
    }
    setChatSessionMutation({ projectId, kind: 'branch', messageId });
    setWorkspaceError(null);
    try {
      const session = await window.gosu.projectChat.branchSession({
        projectId,
        sourceSessionId,
        branchFromMessageId: messageId,
      });
      activateChatSession(projectId, session.id);
      await loadProjectChat(projectId, session.id);
      setAnnouncement(`Created ${session.title} from the selected message.`);
    } catch (error) {
      setWorkspaceError(describeError(error));
    } finally {
      setChatSessionMutation(null);
    }
  };

  const renameChatSession = async (session: ProjectChatSession, title: string) => {
    const sessionKey = projectChatSessionKey(session.projectId, session.id);
    if (
      chatInFlight[sessionKey] ||
      chatStartingSessionKeys.has(sessionKey) ||
      chatSessionMutation
    ) {
      return false;
    }
    const proposed = title.trim();
    if (!proposed) return false;
    if (proposed === session.title) return true;
    if (proposed.length > 120) {
      setWorkspaceError('Chat session names can contain at most 120 characters.');
      return false;
    }
    setChatSessionMutation({
      projectId: session.projectId,
      sessionId: session.id,
      kind: 'rename',
    });
    setWorkspaceError(null);
    try {
      const renamed = await window.gosu.projectChat.renameSession({
        projectId: session.projectId,
        sessionId: session.id,
        title: proposed,
      });
      updateProjectChatSessions(
        session.projectId,
        (projectChatSessionsRef.current[session.projectId] ?? []).map((candidate) =>
          candidate.id === renamed.id ? renamed : candidate,
        ),
      );
      const renamedSessionKey = projectChatSessionKey(session.projectId, renamed.id);
      setChatSnapshots((current) => {
        const snapshotForSession = current[renamedSessionKey];
        if (!snapshotForSession?.session) return current;
        return {
          ...current,
          [renamedSessionKey]: { ...snapshotForSession, session: renamed },
        };
      });
      setAnnouncement(`Renamed the chat session to ${renamed.title}.`);
      return true;
    } catch (error) {
      setWorkspaceError(describeError(error));
      return false;
    } finally {
      setChatSessionMutation(null);
    }
  };

  const hideProject = (projectId: string) => {
    if (chatBusyProjectIds.has(projectId)) {
      setAnnouncement("Stop or wait for this project's active Codex turn before hiding it.");
      return;
    }
    const next = hideProjectLocally(projectNavigationRef.current, projectId);
    updateProjectNavigation(next);
    setActiveProjectId((current) =>
      current === projectId
        ? resolveActiveProjectId(snapshot?.projects ?? [], '', new Set(next.hiddenProjectIds))
        : current,
    );
    setAnnouncement('Hidden the project from this Mac sidebar. Its project data was not changed.');
  };

  const showProject = (projectId: string) => {
    const shown = showProjectLocally(projectNavigationRef.current, projectId);
    updateProjectNavigation({
      ...shown,
      expandedProjectIds: [...new Set([...shown.expandedProjectIds, projectId])],
      activeGroupExpanded: true,
    });
    selectProjectTab(projectId, 'chat');
    setAnnouncement('Restored the project to this Mac sidebar.');
  };

  const showAllProjects = () => {
    const next = showAllProjectsLocally(projectNavigationRef.current);
    updateProjectNavigation(next);
    setActiveProjectId((current) => resolveActiveProjectId(snapshot?.projects ?? [], current));
    setAnnouncement('Showing all active projects in this Mac sidebar.');
  };

  const activeProjectSessions = activeProject ? (projectChatSessions[activeProject.id] ?? []) : [];
  const activeProjectChatSessionId = activeProject
    ? resolveProjectChatSessionId(activeProjectSessions, activeChatSessionIds[activeProject.id])
    : null;
  const activeProjectChatSessionKey =
    activeProject && activeProjectChatSessionId
      ? projectChatSessionKey(activeProject.id, activeProjectChatSessionId)
      : null;

  useEffect(() => {
    if (!activeProject || !activeProjectChatSessionId) {
      setProjectChatModelSelection(AUTO_PROJECT_CHAT_MODEL_SELECTION);
      return;
    }
    const saved = loadProjectChatModelSelection(
      window.localStorage,
      activeProject.id,
      activeProjectChatSessionId,
    );
    const selection =
      preferences.agentAddOns.hermes === 'connect-local'
        ? saved
        : reconcileRemovedProjectChatProvider(saved, {
            removedProviderId: 'hermes',
            reason: 'explicit-disconnect',
          });
    if (selection !== saved) {
      saveProjectChatModelSelection(
        window.localStorage,
        activeProject.id,
        activeProjectChatSessionId,
        selection,
      );
    }
    setProjectChatModelSelection(selection);
  }, [activeProject, activeProjectChatSessionId, preferences.agentAddOns.hermes]);

  useEffect(() => {
    if (
      activeSurface !== 'workspace' ||
      activeTab !== 'chat' ||
      !activeProjectId ||
      !activeProjectChatSessionId
    ) {
      return;
    }

    let cancelled = false;
    const scope = {
      projectId: activeProjectId,
      sessionId: activeProjectChatSessionId,
    };
    void window.gosu.ssh
      .listPendingApprovals(scope)
      .then((requests) => {
        if (cancelled) return;
        setSshApprovals((current) =>
          mergeHydratedSshApprovals(current, requests, scope, sshResolvedApprovalIdsRef.current),
        );
      })
      .catch(() => undefined);
    void window.gosu.hermesAcp
      .listPendingApprovals(scope)
      .then((requests) => {
        if (cancelled) return;
        const now = Date.now();
        const rejected = requests.filter(
          (request) =>
            !hermesAcpApprovalMatchesScope(request, scope) || Date.parse(request.expiresAt) <= now,
        );
        for (const request of rejected) {
          hermesAcpResolvedApprovalIdsRef.current = rememberResolvedHermesAcpApproval(
            hermesAcpResolvedApprovalIdsRef.current,
            request.id,
          );
          void window.gosu.hermesAcp
            .resolveApproval({ approvalId: request.id, decision: 'deny' })
            .catch(() => undefined);
        }
        setHermesAcpApprovals((current) =>
          mergeHydratedHermesAcpApprovals(
            current,
            requests,
            scope,
            hermesAcpResolvedApprovalIdsRef.current,
            now,
          ),
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeProjectChatSessionId, activeProjectId, activeSurface, activeTab]);

  const activeProjectChatSnapshot = activeProjectChatSessionKey
    ? chatSnapshots[activeProjectChatSessionKey]
    : undefined;
  const activeChatSessionKeys = new Set([
    ...Object.entries(chatInFlight)
      .filter(([, inFlight]) => inFlight)
      .map(([key]) => key),
    ...chatStartingSessionKeys,
  ]);
  const firstSshApproval = sshApprovals.at(0);
  const firstHermesAcpApproval = hermesAcpApprovals.at(0);
  const presentHermesAcpApproval =
    firstHermesAcpApproval !== undefined &&
    (firstSshApproval === undefined ||
      firstHermesAcpApproval.createdAt <= firstSshApproval.requestedAt);

  return (
    <main
      className={`desktop-shell${projectNavigation.sidebarCollapsed ? ' sidebar-collapsed' : ''}${sidebarResizing ? ' sidebar-resizing' : ''}`}
      style={
        {
          '--project-sidebar-width': `${projectNavigation.sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <header className="titlebar">
        <ProjectSidebarToggle
          collapsed={projectNavigation.sidebarCollapsed}
          onToggle={toggleProjectSidebarVisibility}
          buttonRef={sidebarToggleRef}
        />
        <div className="logo">G</div>
        <strong>GOSU</strong>
        <span>Local Research Workspace{runtime ? ` · v${runtime.app.version}` : ''}</span>
        <i className="titlebar-spacer" />
        <span
          className={`sync-pill ${pendingCount > 0 ? 'pending' : snapshot && pendingSummary === null ? 'offline' : runtime?.syncApi.ready ? 'ready' : 'offline'}`}
          aria-live="polite"
        >
          <i />
          {pendingCount > 0
            ? `Local · queued for future sync (${pendingCount})`
            : snapshot && pendingSummary === null
              ? 'Local · queue status unavailable'
              : runtime?.syncApi.ready
                ? 'Sync API reachable · delivery off'
                : 'Local only'}
        </span>
      </header>

      <aside
        id="workspace-sidebar"
        className="desktop-nav"
        aria-label="Workspace navigation"
        aria-hidden={projectNavigation.sidebarCollapsed}
        inert={projectNavigation.sidebarCollapsed ? true : undefined}
      >
        <ProjectSidebar
          projects={snapshot?.projects ?? []}
          activeProjectId={activeProjectId}
          activeTab={activeTab}
          navigationState={projectNavigation}
          settingsActive={activeSurface === 'settings'}
          disabled={busyAction !== null}
          busyProjectIds={chatBusyProjectIds}
          onNavigationStateChange={updateProjectNavigation}
          onSelectProject={selectProject}
          onSelectProjectTab={selectProjectTab}
          onSelectGlobalTab={selectGlobalTab}
          onHideProject={hideProject}
          onShowProject={showProject}
          onShowAllProjects={showAllProjects}
          onArchiveProject={(project) => {
            void runWorkspaceAction(
              `project:archive:${project.id}`,
              () =>
                window.gosu.workspace.setProjectArchived({
                  projectId: project.id,
                  expectedVersion: project.version,
                  archived: true,
                }),
              `Archived ${project.name}.`,
            );
          }}
          onRestoreProject={(project) => {
            void runWorkspaceAction(
              `project:unarchive:${project.id}`,
              () =>
                window.gosu.workspace.setProjectArchived({
                  projectId: project.id,
                  expectedVersion: project.version,
                  archived: false,
                }),
              `Restored ${project.name} to active projects.`,
            ).then((succeeded) => {
              if (succeeded) showProject(project.id);
            });
          }}
          onOpenProjectSettings={(projectId) => {
            setActiveProjectId(projectId);
            setSettingsCategory('projects');
            setActiveSurface('settings');
            setShowProjectForm(false);
          }}
          onOpenSettings={() => {
            setSettingsCategory('appearance');
            setActiveSurface('settings');
            setShowProjectForm(false);
          }}
          onNewProject={() => {
            setActiveSurface('workspace');
            if (!isProjectWorkspaceTab(activeTab)) setActiveTab('chat');
            setShowProjectForm(true);
          }}
        />
        <div className="nav-spacer" />
        <small>Local connections</small>
        <Connection
          name="Codex"
          state={
            codexConnectionState === 'ready'
              ? 'Connected'
              : codexConnectionState === 'auth-required'
                ? 'Sign in required'
                : codexConnectionState === 'unavailable'
                  ? 'Reconnect needed'
                  : 'Checking'
          }
          ready={codexConnectionState === 'ready'}
        />
        <Connection
          name="Sync API"
          state={runtime === null ? 'Checking' : runtime.syncApi.ready ? 'Reachable' : 'Offline'}
          ready={Boolean(runtime?.syncApi.ready)}
        />
        <Connection
          name="SSH"
          state={
            sshConnectionState === 'checking'
              ? 'Checking'
              : sshConnectionState === 'unavailable'
                ? 'Unavailable'
                : sshConnections.length > 0
                  ? `${sshConnections.length} registered`
                  : 'Not configured'
          }
          ready={sshConnectionState === 'ready' && sshConnections.length > 0}
        />
        <Connection name="Runner" state="Not configured" ready={false} />
        <Connection
          name="Obsidian"
          state={
            researchNotesState === 'checking'
              ? 'Checking'
              : researchNotesState === 'unavailable'
                ? 'Unavailable'
                : researchNotesWorkspace?.status === 'ready'
                  ? 'Project folder ready'
                  : researchNotesWorkspace?.status === 'rename-pending'
                    ? 'Rename needs attention'
                    : 'Not connected'
          }
          ready={researchNotesWorkspace?.status === 'ready'}
        />
      </aside>
      {!projectNavigation.sidebarCollapsed && (
        <ResizeHandle
          className="project-sidebar-resize-handle"
          label="Resize projects sidebar"
          value={projectNavigation.sidebarWidth}
          min={PROJECT_SIDEBAR_MIN_WIDTH}
          max={PROJECT_SIDEBAR_MAX_WIDTH}
          onChange={(sidebarWidth) =>
            updateProjectNavigation(
              setProjectSidebarWidth(projectNavigationRef.current, sidebarWidth),
            )
          }
          onDraggingChange={setSidebarResizing}
        />
      )}

      <section
        className={desktopContentClassName({
          surface: activeSurface,
          tab: activeTab,
          hasActiveProject: Boolean(activeProject),
        })}
      >
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        {sshRefreshWarning && (
          <div className="notice" role="status">
            <span>{sshRefreshWarning}</span>
            <div className="notice-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSshRefreshWarning(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {workspaceError && (
          <div className="notice error" role="alert">
            <span>{workspaceError}</span>
            <div className="notice-actions">
              {codexErrorVisible && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void refreshModels(true)}
                  disabled={codexBusy}
                >
                  {codexBusy ? 'Reconnecting…' : 'Reconnect Codex'}
                </button>
              )}
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setWorkspaceError(null);
                  setCodexErrorVisible(false);
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {activeSurface === 'settings' ? (
          <SettingsView
            preferences={preferences}
            onChange={updatePreferences}
            hermesConnection={hermesProjectChatConnection}
            onRefreshHermesConnection={refreshHermesProjectChatConnection}
            workspaceSnapshot={snapshot}
            busyAction={busyAction}
            chatBusyProjectIds={chatBusyProjectIds}
            onRenameProject={(input) =>
              runWorkspaceAction(
                `project:rename:${input.projectId}`,
                () => window.gosu.workspace.renameProject(input),
                `Renamed the project to ${input.name}.`,
              )
            }
            onSetProjectArchived={(input) =>
              runWorkspaceAction(
                `project:${input.archived ? 'archive' : 'unarchive'}:${input.projectId}`,
                () => window.gosu.workspace.setProjectArchived(input),
                input.archived
                  ? 'Archived the project with all local work preserved.'
                  : 'Restored the project to active projects.',
              )
            }
            onTrashProject={(input) =>
              runWorkspaceAction(
                `project:trash:${input.projectId}`,
                () => window.gosu.workspace.trashProject(input),
                'Moved the project to recoverable Trash.',
              )
            }
            onRestoreProject={(input) =>
              runWorkspaceAction(
                `project:restore:${input.projectId}`,
                () => window.gosu.workspace.restoreProject(input),
                'Restored the project with its preserved local work.',
              )
            }
            onEmptyProjectTrash={emptyProjectTrash}
            lectureTrashSnapshot={lectureTrashSnapshot}
            lectureTrashState={lectureTrashState}
            onRetryLectureTrash={() => void loadLectureTrash()}
            onRestoreLectureStudio={restoreLectureStudio}
            onEmptyLectureStudioTrash={emptyLectureStudioTrash}
            onRestoreTask={(input) =>
              runWorkspaceAction(
                `task:restore:${input.taskId}`,
                () => window.gosu.workspace.setTaskArchived(input),
                'Restored the task to its Board.',
              )
            }
            overleafPersonalTokenState={overleafPersonalTokenState}
            onRefreshOverleafPersonalToken={refreshOverleafPersonalToken}
            onSaveOverleafPersonalToken={saveOverleafPersonalToken}
            onRemoveOverleafPersonalToken={removeOverleafPersonalToken}
            category={settingsCategory}
            onCategoryChange={setSettingsCategory}
            agentProject={activeProject}
            agentProfile={activeProjectChatSnapshot?.profile}
            agentProfileLoading={Boolean(
              activeProject &&
              activeProjectChatSessionKey &&
              chatLoadingSessionKeys.has(activeProjectChatSessionKey) &&
              !activeProjectChatSnapshot?.profile,
            )}
            collaborationModes={collaborationModes}
            vault={activeResearchNotesSelection}
            vaultState={researchNotesState}
            onUpdateAgentProfile={updateProjectChatProfile}
          />
        ) : workspaceLoading ? (
          <div className="loading-state" role="status">
            Opening the encrypted local workspace…
          </div>
        ) : !snapshot ? (
          <WorkspaceUnavailable onRetry={() => void retryWorkspace()} />
        ) : activeProjects.length === 0 &&
          archivedProjects.length === 0 &&
          isProjectWorkspaceTab(activeTab) ? (
          <EmptyWorkspace busy={busyAction !== null} onCreate={createProject} />
        ) : !activeProject && isProjectWorkspaceTab(activeTab) ? (
          <>
            <WorkspacePageHeading
              activeTab={activeTab}
              activeProject={undefined}
              onNewProject={() => setShowProjectForm((visible) => !visible)}
            />
            {showProjectForm && (
              <ProjectComposer
                busy={busyAction !== null}
                onCancel={() => setShowProjectForm(false)}
                onCreate={createProject}
              />
            )}
            <section className="empty-state portfolio-selection-empty">
              <div className="empty-card">
                <div className="empty-mark">▱</div>
                <h1>
                  {activeProjects.length > 0
                    ? 'All active projects are hidden on this Mac'
                    : 'Your projects are archived'}
                </h1>
                <p>
                  {activeProjects.length > 0
                    ? 'Show all projects, or open Hidden projects in the sidebar to restore just one. Hiding never changes project data.'
                    : 'Open Archived in the sidebar and restore a project to resume Board, Goal, and AI work with its history intact.'}
                </p>
                {activeProjects.length > 0 ? (
                  <button type="button" className="secondary-button" onClick={showAllProjects}>
                    Show all active projects
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      updateProjectNavigation({
                        ...projectNavigationRef.current,
                        archivedGroupExpanded: true,
                      })
                    }
                  >
                    Show archived projects
                  </button>
                )}
              </div>
            </section>
          </>
        ) : (
          <>
            {shouldShowActiveProjectPageHeading(activeTab) && (
              <WorkspacePageHeading
                activeTab={activeTab}
                activeProject={activeProject}
                onNewProject={() => setShowProjectForm((visible) => !visible)}
              />
            )}
            {showProjectForm && (
              <ProjectComposer
                busy={busyAction !== null}
                onCancel={() => setShowProjectForm(false)}
                onCreate={createProject}
              />
            )}

            {activeTab === 'chat' && activeProject && (
              <ProjectChatView
                key={`${activeProject.id}:${activeProjectChatSessionId ?? 'default'}`}
                project={activeProject}
                tasks={activeTasks}
                snapshot={activeProjectChatSnapshot ?? null}
                loading={
                  activeProjectChatSessionId === null ||
                  Boolean(
                    activeProjectChatSessionKey &&
                    chatLoadingSessionKeys.has(activeProjectChatSessionKey) &&
                    activeProjectChatSnapshot === undefined,
                  )
                }
                inFlight={Boolean(
                  activeProjectChatSessionKey && chatInFlight[activeProjectChatSessionKey],
                )}
                sessionBusy={Boolean(
                  activeProjectChatSessionKey &&
                  (chatInFlight[activeProjectChatSessionKey] ||
                    chatStartingSessionKeys.has(activeProjectChatSessionKey)),
                )}
                projectBusy={Boolean(
                  chatSessionMutation?.projectId === activeProject.id &&
                  chatSessionMutation.kind !== 'rename',
                )}
                models={projectChatModels}
                collaborationModes={collaborationModes}
                selectedProviderId={projectChatModelSelection.providerId}
                selectedModel={projectChatModelSelection.modelId}
                selectedReasoning={projectChatModelSelection.reasoningOptionId}
                applyingActionId={applyingChatActionId}
                vault={activeResearchNotesSelection}
                vaultState={researchNotesState}
                sessions={activeProjectSessions}
                sessionRailWidth={projectChatLayout.sessionRailWidth}
                onSessionRailWidthChange={(sessionRailWidth) =>
                  setProjectChatLayout((current) => ({ ...current, sessionRailWidth }))
                }
                sessionRailCollapsed={projectChatLayout.sessionRailCollapsed}
                onSessionRailCollapsedChange={(sessionRailCollapsed) =>
                  setProjectChatLayout((current) => ({ ...current, sessionRailCollapsed }))
                }
                chatDetailsCollapsed={projectChatLayout.chatDetailsCollapsed}
                onChatDetailsCollapsedChange={(chatDetailsCollapsed) =>
                  setProjectChatLayout((current) => ({ ...current, chatDetailsCollapsed }))
                }
                selectedSessionId={activeProjectChatSessionId}
                initialDraft={chatDraftsRef.current.read(
                  activeProject.id,
                  activeProjectChatSessionId,
                )}
                onDraftChange={(value) =>
                  chatDraftsRef.current.write(activeProject.id, activeProjectChatSessionId, value)
                }
                initialScrollTop={chatScrollPositionsRef.current.read(
                  activeProject.id,
                  activeProjectChatSessionId,
                )}
                unreadAssistantMessageId={
                  activeProjectChatSessionKey
                    ? (chatUnreadAssistantMessageIds[activeProjectChatSessionKey] ?? null)
                    : null
                }
                searchTarget={
                  pendingSearchNavigation?.hit.projectId === activeProject.id &&
                  pendingSearchNavigation.hit.target.kind === 'project-chat' &&
                  pendingSearchNavigation.hit.target.sessionId === activeProjectChatSessionId
                    ? {
                        requestId: pendingSearchNavigation.requestId,
                        targetId: pendingSearchNavigation.hit.target.messageId,
                      }
                    : null
                }
                onSearchTargetHandled={completeSearchNavigation}
                onUnreadAssistantMessageSeen={(assistantMessageId) => {
                  if (!activeProjectChatSessionId || !activeProjectChatSessionKey) return;
                  updateUnreadAssistantMessage(
                    activeProjectChatSessionKey,
                    chatUnreadAssistantMessagesRef.current.acknowledge(
                      activeProject.id,
                      activeProjectChatSessionId,
                      assistantMessageId,
                    ),
                  );
                }}
                onScrollTopChange={(scrollTop) =>
                  chatScrollPositionsRef.current.write(
                    activeProject.id,
                    activeProjectChatSessionId,
                    scrollTop,
                  )
                }
                sshAccess={{
                  state: activeProjectSshWorkspaceState,
                  registeredConnectionCount: sshConnections.length,
                  grantedWorkspaceCount: activeProjectSshWorkspaces.length,
                }}
                sshServers={activeProjectSshServers}
                onOpenSshWorkspaceSetup={() => openSshWorkspaceSetup()}
                onRefreshSshResource={(connectionId) =>
                  refreshProjectSshResource(activeProject.id, connectionId, true)
                }
                onEnableTrustedWorkspace={(input: EnableTrustedRemoteWorkspaceInput) =>
                  runSshWorkspaceAction(
                    `trusted-workspace-enable:${input.grantId}`,
                    input.projectId,
                    () => window.gosu.ssh.enableTrustedWorkspace(input),
                    'Trusted workspace enabled. Supported bounded operations will no longer ask Allow once.',
                  )
                }
                onRevokeTrustedWorkspace={(input: RevokeTrustedRemoteWorkspaceInput) =>
                  runSshWorkspaceAction(
                    `trusted-workspace-revoke:${input.grantId}`,
                    input.projectId,
                    () => window.gosu.ssh.revokeTrustedWorkspace(input),
                    'Trusted workspace revoked. Remote operations require Allow once again.',
                  )
                }
                activeSessionIds={activeSessionIdsForProject(
                  activeProject.id,
                  activeChatSessionKeys,
                  activeProjectSessions,
                )}
                creatingSession={
                  chatSessionMutation?.projectId === activeProject.id &&
                  chatSessionMutation.kind === 'create'
                }
                branchingMessageId={
                  chatSessionMutation?.projectId === activeProject.id &&
                  chatSessionMutation.kind === 'branch'
                    ? (chatSessionMutation.messageId ?? null)
                    : null
                }
                onSelectSession={(sessionId) => selectChatSession(activeProject.id, sessionId)}
                onCreateSession={() => void createChatSession(activeProject.id)}
                onRenameSession={renameChatSession}
                onBranchSession={(messageId) => branchChatSession(activeProject.id, messageId)}
                onSelectedModel={(modelId) =>
                  setProjectChatModelSelection((current) => {
                    const nextProviderId =
                      modelId === null
                        ? null
                        : (projectChatModels.find((model) => model.modelId === modelId)
                            ?.providerId ?? null);
                    const selection = selectProjectChatModel(current, {
                      providerId: nextProviderId,
                      modelId,
                    });
                    if (activeProjectChatSessionId) {
                      saveProjectChatModelSelection(
                        window.localStorage,
                        activeProject.id,
                        activeProjectChatSessionId,
                        selection,
                      );
                    }
                    return selection;
                  })
                }
                onSelectedReasoning={(reasoningOptionId) =>
                  setProjectChatModelSelection((current) => {
                    const selection = selectProjectChatReasoning(current, reasoningOptionId);
                    if (activeProjectChatSessionId) {
                      saveProjectChatModelSelection(
                        window.localStorage,
                        activeProject.id,
                        activeProjectChatSessionId,
                        selection,
                      );
                    }
                    return selection;
                  })
                }
                onRefreshModels={() => {
                  void refreshModels();
                  if (preferences.agentAddOns.hermes === 'connect-local') {
                    void refreshHermesProjectChatConnection();
                  }
                }}
                onOpenAgentSettings={openAgentSettings}
                onChooseAttachments={() => {
                  if (!activeProjectChatSessionId) return Promise.resolve([]);
                  return window.gosu.projectChat.chooseAttachments({
                    projectId: activeProject.id,
                    sessionId: activeProjectChatSessionId,
                  });
                }}
                onReleaseAttachment={(attachment) =>
                  window.gosu.projectChat
                    .releaseAttachment({
                      projectId: attachment.projectId,
                      sessionId: attachment.sessionId,
                      attachmentId: attachment.id,
                    })
                    .then(() => undefined)
                }
                onAttachmentError={(error) => setWorkspaceError(describeError(error))}
                onSend={async (message, retryOfAttemptId, controls, attachmentIds) => {
                  if (!activeProjectChatSessionId || !activeProjectChatSessionKey) {
                    return false;
                  }
                  const selectedDescriptor = resolveEffectiveCodexModel(
                    projectChatModels,
                    collaborationModes,
                    projectChatModelSelection.modelId,
                    controls.collaborationModeId ?? null,
                  );
                  const selectedCollaborationMode = controls.collaborationModeId
                    ? collaborationModes.find((mode) => mode.id === controls.collaborationModeId)
                    : undefined;
                  const effectiveReasoningOptionId =
                    projectChatModelSelection.reasoningOptionId ??
                    selectedCollaborationMode?.recommendedReasoningOptionId ??
                    null;
                  if (controls.collaborationModeId && !selectedCollaborationMode) {
                    setWorkspaceError(
                      'The selected Codex collaboration mode is no longer available. Choose a current mode and try again.',
                    );
                    return false;
                  }
                  if (!selectedDescriptor) {
                    setWorkspaceError(
                      projectChatModelSelection.modelId !== null
                        ? 'The selected Project Chat model is no longer available. Choose a current model and try again.'
                        : 'The effective default or mode-recommended Project Chat model is unavailable. Choose a current model or mode and try again.',
                    );
                    return false;
                  }
                  const savedLocalNotesGrant = activeProjectChatSnapshot?.profile?.localNotesVault;
                  if (
                    selectedDescriptor.providerId !== 'hermes' &&
                    savedLocalNotesGrant &&
                    (researchNotesState !== 'ready' ||
                      activeResearchNotesSelection?.id !== savedLocalNotesGrant.id)
                  ) {
                    setWorkspaceError(
                      'Research Notes access cannot be verified for this project. GOSU paused this turn so a stale or hidden grant cannot be used. Open Research Notes and review the project folder.',
                    );
                    return false;
                  }
                  if (selectedDescriptor.providerId === 'hermes' && attachmentIds.length > 0) {
                    setWorkspaceError(
                      'Turn attachments are not bridged to Hermes ACP yet. Remove attachments or choose Codex for this turn.',
                    );
                    return false;
                  }
                  if (
                    effectiveReasoningOptionId !== null &&
                    !selectedDescriptor?.reasoningOptions.some(
                      (option) => option.id === effectiveReasoningOptionId,
                    )
                  ) {
                    setWorkspaceError(
                      'The selected or mode-recommended reasoning option is unavailable for the effective model. Choose a current option and try again.',
                    );
                    return false;
                  }
                  if (
                    controls.personality !== 'auto' &&
                    selectedDescriptor?.supportsPersonality === false
                  ) {
                    setWorkspaceError(
                      'The effective Codex model does not support personality controls. Choose Auto personality or another model/mode.',
                    );
                    return false;
                  }
                  setChatStartingSessionKeys((current) => {
                    const next = new Set(current);
                    next.add(activeProjectChatSessionKey);
                    return next;
                  });
                  setWorkspaceError(null);
                  try {
                    const receipt = await window.gosu.projectChat.send({
                      projectId: activeProject.id,
                      sessionId: activeProjectChatSessionId,
                      message,
                      requestedModelId: projectChatModelSelection.modelId,
                      reasoningOptionId: projectChatModelSelection.reasoningOptionId,
                      ...(attachmentIds.length > 0 ? { attachmentIds: [...attachmentIds] } : {}),
                      ...controls,
                      ...(retryOfAttemptId ? { retryOfAttemptId } : {}),
                    });
                    await loadProjectChat(activeProject.id, receipt.sessionId);
                    if ('queued' in receipt) {
                      setAnnouncement('Queued this message for the selected Project Chat session.');
                    }
                    if (selectedDescriptor.providerId !== 'hermes') {
                      setCodexConnectionState('ready');
                      setCodexErrorVisible(false);
                    }
                    return true;
                  } catch (error) {
                    setWorkspaceError(describeError(error));
                    if (
                      isSelectedHermesProviderFailure(selectedDescriptor.providerId ?? null, error)
                    ) {
                      ++hermesProjectChatConnectionGenerationRef.current;
                      removeHermesProjectChatDescriptor();
                      setHermesProjectChatConnection({ phase: 'unavailable', status: null });
                    } else if (isCodexUnavailableError(error)) {
                      setCodexConnectionState('unavailable');
                      setCodexErrorVisible(true);
                    }
                    await loadProjectChat(activeProject.id, activeProjectChatSessionId).catch(
                      () => undefined,
                    );
                    return false;
                  } finally {
                    setChatStartingSessionKeys((current) => {
                      const next = new Set(current);
                      next.delete(activeProjectChatSessionKey);
                      return next;
                    });
                  }
                }}
                onCancel={() => {
                  if (!activeProjectChatSessionId) return;
                  void window.gosu.projectChat
                    .cancel(activeProject.id, activeProjectChatSessionId)
                    .catch((error: unknown) => setWorkspaceError(describeError(error)));
                }}
                onUpdateQueuedTurn={async (queueId, message) => {
                  if (!activeProjectChatSessionId) return;
                  try {
                    await window.gosu.projectChat.updateQueuedTurn({
                      projectId: activeProject.id,
                      sessionId: activeProjectChatSessionId,
                      queueId,
                      message,
                    });
                    await loadProjectChat(activeProject.id, activeProjectChatSessionId);
                  } catch (error) {
                    setWorkspaceError(describeError(error));
                    throw error;
                  }
                }}
                onRemoveQueuedTurn={async (queueId) => {
                  if (!activeProjectChatSessionId) return;
                  try {
                    await window.gosu.projectChat.removeQueuedTurn({
                      projectId: activeProject.id,
                      sessionId: activeProjectChatSessionId,
                      queueId,
                    });
                    await loadProjectChat(activeProject.id, activeProjectChatSessionId);
                  } catch (error) {
                    setWorkspaceError(describeError(error));
                    throw error;
                  }
                }}
                onRunQueuedTurnNow={async (queueId) => {
                  if (!activeProjectChatSessionId) return;
                  try {
                    await window.gosu.projectChat.runQueuedTurnNow({
                      projectId: activeProject.id,
                      sessionId: activeProjectChatSessionId,
                      queueId,
                    });
                    await loadProjectChat(activeProject.id, activeProjectChatSessionId);
                  } catch (error) {
                    setWorkspaceError(describeError(error));
                    throw error;
                  }
                }}
                onEditHistoryMessage={async (messageId, content) => {
                  if (!activeProjectChatSessionId || !activeProjectChatSnapshot) return;
                  const branchPointId = resolveEditedMessageBranchPoint(
                    activeProjectChatSnapshot.messages,
                    messageId,
                  );
                  if (branchPointId === undefined) return;
                  try {
                    const editedSession = branchPointId
                      ? await window.gosu.projectChat.branchSession({
                          projectId: activeProject.id,
                          sourceSessionId: activeProjectChatSessionId,
                          branchFromMessageId: branchPointId,
                          title:
                            `Edit · ${activeProjectChatSnapshot.session?.title ?? 'Project chat'}`.slice(
                              0,
                              120,
                            ),
                        })
                      : await window.gosu.projectChat.createSession({
                          projectId: activeProject.id,
                          title:
                            `Edit · ${activeProjectChatSnapshot.session?.title ?? 'Project chat'}`.slice(
                              0,
                              120,
                            ),
                        });
                    await loadProjectChatSessions(activeProject.id);
                    activateChatSession(activeProject.id, editedSession.id);
                    chatDraftsRef.current.write(activeProject.id, editedSession.id, content);
                    await loadProjectChat(activeProject.id, editedSession.id);
                    setAnnouncement(
                      'Created a new session branch for the edited message. Original history is unchanged.',
                    );
                  } catch (error) {
                    setWorkspaceError(describeError(error));
                  }
                }}
                onApplyAction={async (action: ProjectChatAction) => {
                  if (applyingChatActionId !== null || !activeProjectChatSessionId) return;
                  setApplyingChatActionId(action.id);
                  setWorkspaceError(null);
                  try {
                    const updated = await window.gosu.projectChat.applyAction({
                      projectId: activeProject.id,
                      sessionId: activeProjectChatSessionId,
                      actionId: action.id,
                    });
                    await Promise.all([
                      loadProjectChat(activeProject.id, activeProjectChatSessionId),
                      loadWorkspace(),
                    ]);
                    setAnnouncement(
                      updated.status === 'applied'
                        ? 'Applied the reviewed chat action to the Board.'
                        : 'The chat action was not applied. Its receipt explains why.',
                    );
                  } catch (error) {
                    setWorkspaceError(describeError(error));
                  } finally {
                    setApplyingChatActionId(null);
                  }
                }}
              />
            )}

            {activeTab === 'board' && activeProject && (
              <BoardView
                key={activeProject.id}
                project={activeProject}
                tasks={activeTasks}
                busyAction={busyAction}
                searchTarget={
                  pendingSearchNavigation?.hit.projectId === activeProject.id &&
                  pendingSearchNavigation.hit.target.kind === 'board-task'
                    ? {
                        requestId: pendingSearchNavigation.requestId,
                        targetId: pendingSearchNavigation.hit.target.taskId,
                      }
                    : null
                }
                onSearchTargetHandled={completeSearchNavigation}
                onCreateTask={(input) =>
                  runWorkspaceAction(
                    'task:create',
                    () => window.gosu.workspace.createTask(input),
                    `Added ${input.title} to the board.`,
                  )
                }
                onUpdateTask={(input) =>
                  runWorkspaceAction(
                    `task:update:${input.taskId}`,
                    () => window.gosu.workspace.updateTask(input),
                    'Updated the task.',
                  )
                }
                onUpdateBoardSettings={(input) =>
                  runWorkspaceAction(
                    'project:board:update',
                    () => window.gosu.workspace.updateBoardSettings(input),
                    'Updated the Board settings.',
                  )
                }
                onSetTaskArchived={(input) =>
                  runWorkspaceAction(
                    `task:${input.archived ? 'archive' : 'restore'}:${input.taskId}`,
                    () => window.gosu.workspace.setTaskArchived(input),
                    input.archived
                      ? 'Moved the task to Task trash.'
                      : 'Restored the task to the Board.',
                  )
                }
              />
            )}
            {activeTab === 'repository' && activeProject && (
              <RepositoryView
                key={`${activeProject.id}:${activeProject.version}`}
                project={activeProject}
                searchTarget={
                  pendingSearchNavigation?.hit.projectId === activeProject.id &&
                  pendingSearchNavigation.hit.target.kind === 'repository-file'
                    ? {
                        requestId: pendingSearchNavigation.requestId,
                        targetId: pendingSearchNavigation.hit.target.path,
                      }
                    : null
                }
                onSearchTargetHandled={completeSearchNavigation}
                onUpdateRepository={(input) =>
                  runWorkspaceAction(
                    `project:repository:${input.projectId}`,
                    () => window.gosu.workspace.updateProjectRepository(input),
                    `Connected ${input.repository} to this project.`,
                  )
                }
              />
            )}
            {activeTab === 'manuscript' && activeProject && (
              <ManuscriptView
                key={activeProject.id}
                project={activeProject}
                overleafPersonalTokenState={overleafPersonalTokenState}
                onOpenOverleafSettings={openOverleafSettings}
              />
            )}
            {activeTab === 'objective' && activeProject && (
              <ObjectiveEditor
                key={`${activeProject.id}:${activeObjective?.id ?? 'new'}:${activeObjective?.entityVersion ?? 0}`}
                project={activeProject}
                objective={activeObjective}
                busy={busyAction !== null}
                onSave={(input) =>
                  runWorkspaceAction(
                    'objective:save',
                    () => window.gosu.workspace.saveObjective(input),
                    'Saved the objective to the encrypted local workspace.',
                  )
                }
                onLock={(input) =>
                  runWorkspaceAction(
                    'objective:lock',
                    () => window.gosu.workspace.lockObjective(input),
                    'Froze this objective revision in the local workspace.',
                  )
                }
                onStartVersion={(input) =>
                  runWorkspaceAction(
                    'objective:start-version',
                    () => window.gosu.workspace.startObjectiveVersion(input),
                    'Started an editable objective revision.',
                  )
                }
              />
            )}
            {activeTab === 'experiments' && activeProject && (
              <ExperimentsView
                key={activeProject.id}
                project={activeProject}
                objective={activeObjective}
                adapter={experimentsAdapter}
                evaluationAdapter={experimentEvaluationAdapter}
                requestedModelId={selectedModel}
                reasoningOptionId={selectedReasoning}
                searchTarget={
                  pendingSearchNavigation?.hit.projectId === activeProject.id &&
                  pendingSearchNavigation.hit.target.kind === 'experiment'
                    ? {
                        requestId: pendingSearchNavigation.requestId,
                        targetId: pendingSearchNavigation.hit.target.ideaId,
                      }
                    : null
                }
                onSearchTargetHandled={completeSearchNavigation}
                onOpenObjective={() => selectProjectTab(activeProject.id, 'objective')}
              />
            )}
            {activeTab === 'literature' && activeProject && (
              <LiteratureView
                key={activeProject.id}
                project={activeProject}
                adapter={literatureAdapter}
                aiAvailable={codexConnectionState === 'ready'}
                requestedModelId={selectedModel}
                reasoningOptionId={selectedReasoning}
                searchTarget={
                  pendingSearchNavigation?.hit.projectId === activeProject.id &&
                  pendingSearchNavigation.hit.target.kind === 'literature'
                    ? {
                        requestId: pendingSearchNavigation.requestId,
                        targetId: pendingSearchNavigation.hit.target.recordId,
                      }
                    : null
                }
                onSearchTargetHandled={completeSearchNavigation}
              />
            )}
            {activeTab === 'search' && (
              <SearchView
                adapter={searchAdapter}
                scope={{ kind: 'global' }}
                scopeLabel="all projects"
                onOpen={openSearchHit}
              />
            )}
            {activeTab === 'lecture' && (
              <LectureStudioView
                projects={snapshot.projects}
                adapter={lectureStudioAdapter}
                draftStore={lectureStudioDraftsRef.current}
                models={models}
                modelsLoading={codexBusy}
                codexAuthenticationRequired={codexConnectionState === 'auth-required'}
                onRefreshModels={() => void refreshModels(true)}
                onOpenCodexSignIn={startCodexChatGptLogin}
                overleafPersonalTokenState={overleafPersonalTokenState}
                onOpenOverleafSettings={openOverleafSettings}
                layout={lectureStudioLayout}
                onLayoutChange={setLectureStudioLayout}
              />
            )}
            {activeTab === 'connections' && (
              <ConnectionsView
                runtime={runtime}
                models={models}
                selectedModel={selectedModel}
                status={codexStatus}
                busy={codexBusy}
                apiKeyMode={apiKeyMode}
                apiKey={apiKey}
                onSelectedModel={(modelId) => {
                  const selection = selectCodexModel(modelId, selectedReasoning);
                  setSelectedModel(selection.modelId);
                  setSelectedReasoning(selection.reasoningOptionId);
                }}
                onRefresh={() => void refreshModels()}
                onReconnect={() => void refreshModels(true)}
                onToggleApiKey={() => setApiKeyMode((visible) => !visible)}
                onApiKey={setApiKey}
                onLoginChatGpt={startCodexChatGptLogin}
                onLoginApiKey={() => {
                  if (codexBusy || apiKey.trim() === '') return;
                  setCodexBusy(true);
                  void window.gosu.codex
                    .loginApiKey(apiKey)
                    .then(() => setCodexStatus('API key authentication was handed to Codex.'))
                    .catch((error: unknown) => setCodexStatus(describeError(error)))
                    .finally(() => {
                      setApiKey('');
                      setCodexBusy(false);
                    });
                }}
                onLogout={() => {
                  if (codexBusy) return;
                  setCodexBusy(true);
                  void window.gosu.codex
                    .logout()
                    .then(() => {
                      const selection = resetCodexPicker();
                      setModels([]);
                      setSelectedModel(selection.modelId);
                      setSelectedReasoning(selection.reasoningOptionId);
                      setCodexConnectionState('auth-required');
                      setCodexStatus('Signed out from local Codex.');
                    })
                    .catch((error: unknown) => setCodexStatus(describeError(error)))
                    .finally(() => setCodexBusy(false));
                }}
                sshConnections={sshConnections}
                sshBusy={sshConnectionBusy !== null}
                sshTestStatus={sshTestStatus}
                onCreateSshConnection={async (input: CreateSshConnectionInput) => {
                  let registeredConnectionId: string | null = null;
                  const succeeded = await runSshConnectionAction(
                    'create',
                    async () => {
                      const registered = await window.gosu.ssh.createConnection(input);
                      registeredConnectionId = registered.id;
                    },
                    `Registered ${input.label} locally. A project workspace grant is still required.`,
                  );
                  if (succeeded && activeProject) {
                    openSshWorkspaceSetup(registeredConnectionId);
                  }
                  return succeeded;
                }}
                onImportSshCommand={async (input: ImportSshCommandInput) => {
                  let registeredConnectionId: string | null = null;
                  const succeeded = await runSshConnectionAction(
                    'import',
                    async () => {
                      const registered = await window.gosu.ssh.importCommand(input);
                      registeredConnectionId = registered.id;
                    },
                    `Parsed and registered ${input.label ?? 'the SSH server'} locally. A project workspace grant is still required.`,
                  );
                  if (succeeded && activeProject) {
                    openSshWorkspaceSetup(registeredConnectionId);
                  }
                  return succeeded;
                }}
                onUpdateSshConnection={(input: UpdateSshConnectionInput) =>
                  runSshConnectionAction(
                    `update:${input.connectionId}`,
                    () => window.gosu.ssh.updateConnection(input),
                    `Updated the ${input.label} SSH profile.`,
                  )
                }
                onRemoveSshConnection={async (input: RemoveSshConnectionInput) => {
                  const connection = sshConnections.find(
                    (candidate) => candidate.id === input.connectionId,
                  );
                  if (!connection) return false;
                  let currentProjectLinks: Readonly<Record<string, readonly string[]>>;
                  try {
                    currentProjectLinks = await loadSshProjectLinks(activeProjects);
                  } catch (error) {
                    setWorkspaceError(
                      `GOSU could not verify which active projects use this server, so it was not removed. ${describeError(error)}`,
                    );
                    return false;
                  }
                  const linkedProjectIds = new Set(currentProjectLinks[input.connectionId] ?? []);
                  const linkedActiveProjectNames = activeProjects
                    .filter((project) => linkedProjectIds.has(project.id))
                    .map((project) => project.name);
                  if (
                    !window.confirm(
                      buildSshConnectionRemovalConfirmation(
                        connection.label,
                        linkedActiveProjectNames,
                      ),
                    )
                  ) {
                    return Promise.resolve(false);
                  }
                  return runSshConnectionAction(
                    `remove:${input.connectionId}`,
                    () => window.gosu.ssh.removeConnection(input),
                    `Removed ${connection.label} from GOSU.`,
                  );
                }}
                onTestSshConnection={testSshConnection}
                sshResourceStates={sshResourceStates}
                onRefreshSshResource={(connectionId) => refreshSshResource(connectionId, true)}
                onOpenSshWorkspaceSetup={(projectId, connectionId) =>
                  openSshWorkspaceSetup(connectionId, projectId)
                }
                activeProject={activeProject ?? null}
                projects={activeProjects}
                linkedProjectIdsByConnectionId={sshLinkedProjectIdsByConnectionId}
                sshWorkspaces={activeProjectSshWorkspaces}
                sshWorkspaceReady={activeProjectSshWorkspaceState === 'ready'}
                sshWorkspaceSetupRequest={sshWorkspaceSetupRequest}
                onSshWorkspaceSetupHandled={(requestId) =>
                  setSshWorkspaceSetupRequest((current) =>
                    acknowledgeSshWorkspaceSetupRequest(current, requestId),
                  )
                }
                onCreateSshWorkspace={(input: CreateRemoteWorkspaceGrantInput) =>
                  runSshWorkspaceAction(
                    `workspace-create:${input.projectId}:${input.connectionId}`,
                    input.projectId,
                    () => window.gosu.ssh.createWorkspaceGrant(input),
                    'Granted this project access to the remote workspace.',
                  )
                }
                onUpdateSshWorkspace={(input: UpdateRemoteWorkspaceGrantInput) =>
                  runSshWorkspaceAction(
                    `workspace-update:${input.grantId}`,
                    input.projectId,
                    () => window.gosu.ssh.updateWorkspaceGrant(input),
                    'Updated the project remote workspace grant.',
                  )
                }
                onRemoveSshWorkspace={(input: RemoveRemoteWorkspaceGrantInput) =>
                  runSshWorkspaceAction(
                    `workspace-remove:${input.grantId}`,
                    input.projectId,
                    () => window.gosu.ssh.removeWorkspaceGrant(input),
                    'Revoked the project remote workspace grant.',
                  )
                }
              />
            )}
            {activeTab === 'notes' && activeProject && (
              <ResearchNotesView
                workspace={researchNotesWorkspace}
                vaultState={researchNotesState}
                selectedNote={selectedNote}
                busy={noteLoading}
                project={activeProject}
                profile={activeProjectChatSnapshot?.profile}
                profileLoading={Boolean(
                  activeProjectChatSessionKey &&
                  chatLoadingSessionKeys.has(activeProjectChatSessionKey),
                )}
                accessBusy={
                  busyAction !== null ||
                  Boolean(activeProject && chatBusyProjectIds.has(activeProject.id))
                }
                folderTreeCollapsed={researchNotesLayout.folderTreeCollapsed}
                onFolderTreeCollapsedChange={(folderTreeCollapsed) =>
                  setResearchNotesLayout((current) => ({ ...current, folderTreeCollapsed }))
                }
                searchAdapter={searchAdapter}
                onChoose={() => void chooseResearchNotesVault(activeProject.id)}
                onRetry={() => {
                  const generation = ++researchNotesGeneration.current;
                  researchNoteReadGeneration.current += 1;
                  setResearchNotesState('checking');
                  setNoteLoading(true);
                  setWorkspaceError(null);
                  void window.gosu.researchNotes
                    .current({ projectId: activeProject.id })
                    .then((next) => {
                      if (researchNotesGeneration.current === generation) {
                        setResearchNotesWorkspace(next);
                        setResearchNotesState('ready');
                        setAnnouncement('Retried the Obsidian project folder reconciliation.');
                      }
                    })
                    .catch((error: unknown) => {
                      if (researchNotesGeneration.current !== generation) return;
                      setResearchNotesState('unavailable');
                      setWorkspaceError(describeError(error));
                    })
                    .finally(() => {
                      if (researchNotesGeneration.current === generation) setNoteLoading(false);
                    });
                }}
                onRead={(path) => {
                  if (noteLoading) return;
                  const generation = ++researchNoteReadGeneration.current;
                  const projectId = activeProject.id;
                  setNoteLoading(true);
                  setWorkspaceError(null);
                  void window.gosu.researchNotes
                    .read({ projectId, path })
                    .then((note) => {
                      if (researchNoteReadGeneration.current === generation) {
                        setSelectedNote(note as SelectedNote);
                      }
                    })
                    .catch((error: unknown) => {
                      if (researchNoteReadGeneration.current === generation) {
                        setWorkspaceError(describeError(error));
                      }
                    })
                    .finally(() => {
                      if (researchNoteReadGeneration.current === generation) {
                        setNoteLoading(false);
                      }
                    });
                }}
                readAttachment={(input) =>
                  window.gosu.researchNotes.readAttachment({
                    projectId: activeProject.id,
                    ...input,
                  })
                }
                onSetProjectAccess={(grant) => {
                  if (!activeProject) return;
                  const profile = activeProjectChatSnapshot?.profile;
                  if (!profile) {
                    setWorkspaceError(
                      'The project agent profile is not available yet. Open AI Agent Settings and try again.',
                    );
                    return;
                  }
                  void updateProjectLocalNotesGrant(activeProject, profile, grant);
                }}
                onOpenAgentSettings={openAgentSettings}
              />
            )}
          </>
        )}
      </section>
      {overleafTokenSettingsOpen && (
        <OverleafPersonalTokenDialog
          state={overleafPersonalTokenState}
          onRefresh={refreshOverleafPersonalToken}
          onSave={saveOverleafPersonalToken}
          onRemove={removeOverleafPersonalToken}
          onClose={() => setOverleafTokenSettingsOpen(false)}
        />
      )}
      <SshApprovalCenter
        requests={presentHermesAcpApproval ? [] : sshApprovals}
        busyApprovalIds={sshApprovalBusyIds}
        describeScope={(request) => {
          const projectName =
            snapshot?.projects.find((project) => project.id === request.projectId)?.name ??
            'Unknown project';
          const sessionTitle = projectChatSessions[request.projectId]?.find(
            (session) => session.id === request.sessionId,
          )?.title;
          return `${projectName} · ${sessionTitle ?? 'Project chat'}`;
        }}
        onResolve={(input) => resolveSshApproval(input.approvalId, input.decision)}
      />
      <HermesAcpApprovalCenter
        requests={presentHermesAcpApproval ? hermesAcpApprovals : []}
        busyApprovalIds={hermesAcpApprovalBusyIds}
        describeScope={(request) => {
          const projectName =
            snapshot?.projects.find((project) => project.id === request.projectId)?.name ??
            'Unknown project';
          const sessionTitle = projectChatSessions[request.projectId]?.find(
            (session) => session.id === request.sessionId,
          )?.title;
          return `${projectName} · ${sessionTitle ?? 'Project chat'}`;
        }}
        onResolve={(input) => resolveHermesAcpApproval(input.approvalId, input.decision)}
      />
    </main>
  );

  async function retryWorkspace() {
    if (workspaceLoading) return;
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      await loadWorkspace();
    } catch (error) {
      setWorkspaceError(describeError(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }
}
