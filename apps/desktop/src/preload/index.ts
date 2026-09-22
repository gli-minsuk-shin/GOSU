import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { droppedAttachmentPaths } from './dropped-attachment-paths';
import {
  APPROVAL_POLICY_CHANNELS,
  ApprovalPolicySchema,
  type ApprovalPolicy,
} from '../shared/approval-policy';
import { BriefingNotificationSnapshotSchema } from '../../../briefing-lab/src/briefing-notifications';
import { MODEL_ROUTING_CHANNELS, ModelRoutingSchema, type ModelRouting } from '@gosu/contracts';
import type {
  PaperSummaryCandidate,
  PaperSummarySaveReceipt,
} from '../../../briefing-lab/src/paper-summary-contract';
import {
  APPLICATION_LANGUAGE_CHANNELS,
  ApplicationLanguagePreferenceSchema,
  AppLanguageSchema,
  type AppLanguage,
  type ApplicationLanguagePreference,
} from '@gosu/contracts';
import {
  MODEL_LAB_OPEN_CHANNEL,
  type ProjectModelLabLocation,
} from '../shared/model-lab-contracts';

import { AGENT_ADD_ON_CHANNELS } from '../shared/agent-addon-channels';
import type {
  AgentAddOnId,
  AgentAddOnStatus,
  AgentAddOnStatusRequest,
  ConnectAgentAddOnRequest,
  DisconnectAgentAddOnRequest,
} from '../shared/agent-addon-contracts';
import { APP_NAVIGATION_CHANNELS } from '../shared/app-navigation-channels';
import {
  APP_SHORTCUT_TARGETS,
  type AppShortcuts,
  type AppShortcutTarget,
} from '../shared/app-shortcuts';
import {
  CODEX_AUTH_IPC_CHANNELS,
  CodexAuthenticationEventSchema,
  type CodexAuthenticationEvent,
} from '../shared/codex-auth-channels';
import { EXPERIMENT_WORKSPACE_IPC_CHANNELS } from '../shared/experiment-workspace-channels';
import { EXPERIMENT_EVALUATION_IPC_CHANNELS } from '../shared/experiment-evaluation-channels';
import {
  ExperimentEvaluationEventSchema,
  type ApproveExperimentEvaluationInput,
  type CancelExperimentEvaluationInput,
  type CreateExperimentEvaluationSessionInput,
  type ExperimentEvaluationApprovalReceipt,
  type ExperimentEvaluationCancelReceipt,
  type ExperimentEvaluationDetailInput,
  type ExperimentEvaluationEvent,
  type ExperimentEvaluationListSnapshot,
  type ExperimentEvaluationSession,
  type ExperimentEvaluationSessionDetail,
  type ExperimentEvaluationTurnReceipt,
  type ListExperimentEvaluationsInput,
  type ReuseExperimentEvaluationProfileInput,
  type SendExperimentEvaluationMessageInput,
} from '../shared/experiment-evaluation-contracts';
import { unwrapExperimentEvaluationIpcResult } from '../shared/experiment-evaluation-ipc-result';
import {
  ExperimentWorkspaceEventSchema,
  type CreateExperimentIdeaInput,
  type ExperimentIdea,
  type ExperimentLoggingTemplate,
  type ExperimentMetricPoint,
  type ExperimentRunLogChunk,
  type ExperimentWorkspaceEvent,
  type ExperimentWorkspaceSnapshot,
  type ListExperimentWorkspaceInput,
  type ReadExperimentRunLogInput,
  type RecordExperimentMetricInput,
  type ReviseExperimentLoggingTemplateInput,
  type UpdateExperimentIdeaInput,
} from '../shared/experiment-workspace-contracts';
import { unwrapExperimentIpcResult } from '../shared/experiment-workspace-ipc-result';
import { GIT_WORKSPACE_IPC_CHANNELS } from '../shared/git-workspace-channels';
import { HERMES_ACP_APPROVAL_CHANNELS } from '../shared/hermes-acp-approval-channels';
import {
  HermesAcpApprovalEventSchema,
  HermesAcpApprovalListSchema,
  type HermesAcpApprovalEvent,
  type HermesAcpApprovalRequest,
  type ListPendingHermesAcpApprovalsInput,
  type ResolveHermesAcpApprovalInput,
} from '../shared/hermes-acp-approval-contracts';
import type {
  GitCommitInput,
  GitCreateBranchInput,
  GitDiffInput,
  GitFileInput,
  GitFilePreview,
  GitHeadCommand,
  GitPathsCommand,
  GitSwitchBranchInput,
  GitTextPreview,
  GitWorkspaceSnapshot,
} from '../shared/git-workspace-contracts';
import { unwrapGitWorkspaceIpcResult } from '../shared/git-workspace-ipc-result';
import { LITERATURE_IPC_CHANNELS } from '../shared/literature-channels';
import { MANUSCRIPT_WORKSPACE_IPC_CHANNELS } from '../shared/manuscript-workspace-channels';
import { MODEL_PRICE_IPC_CHANNELS, type ModelPriceStatus } from '../shared/model-price-contracts';
import { FULL_DISK_ACCESS_CHANNEL, type FullDiskAccessState } from '../shared/full-disk-access';
import {
  USAGE_LIMIT_IPC_CHANNELS,
  UsageLimitStatusSchema,
  type UsageLimitSettings,
  type UsageLimitStatus,
} from '../shared/usage-limit-contracts';
import { MODEL_USAGE_IPC_CHANNELS } from '../shared/model-usage-channels';
import type {
  ModelUsageAnalyticsQuery,
  ModelUsageAnalyticsReport,
} from '../shared/model-usage-contracts';
import { OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS } from '../shared/overleaf-personal-token-channels';
import {
  OverleafPersonalTokenStatusSchema,
  type OverleafPersonalTokenStatus,
  type SaveOverleafPersonalTokenInput,
} from '../shared/overleaf-personal-token-contracts';
import { unwrapOverleafPersonalTokenIpcResult } from '../shared/overleaf-personal-token-ipc-result';
import type {
  ConnectOverleafGitInput,
  CompileManuscriptPdfInput,
  CreateManuscriptInput,
  DeleteUnconfiguredManuscriptInput,
  FetchManuscriptCheckpointInput,
  ListManuscriptCheckpointFilesInput,
  ManuscriptBindingCommand,
  ManuscriptCheckpointFileChunk,
  ManuscriptCheckpointFileList,
  ManuscriptPdfPreview,
  ManuscriptPdfArtifactActionReceipt,
  ManuscriptPdfArtifactBinding,
  ManuscriptWorkspaceSnapshot,
  ReadManuscriptCheckpointFileInput,
  UpdateManuscriptInput,
} from '../shared/manuscript-workspace-contracts';
import { unwrapManuscriptWorkspaceIpcResult } from '../shared/manuscript-workspace-ipc-result';
import { LECTURE_STUDIO_IPC_CHANNELS } from '../shared/lecture-studio-channels';
import type {
  DiscardLectureExternalSourceSetInput,
  RemoveStagedLectureExternalSourceInput,
  StageLectureExternalSourcesInput,
  StagedLectureExternalSourceSetView,
} from '../shared/lecture-external-source-contracts';
import type {
  ImportLectureOverleafSourceInput,
  LectureOverleafSourceReceipt,
} from '../shared/lecture-overleaf-source-contracts';
import type {
  ChooseLectureStudioAttachmentsInput,
  LectureStudioAttachmentCard,
  ReleaseLectureStudioAttachmentInput,
} from '../shared/lecture-studio-attachment-contracts';
import {
  LectureStudioEventSchema,
  type CancelLectureStudioInput,
  type CompileLectureStudioPdfInput,
  type CreateLectureStudioInput,
  type EmptyLectureStudioTrashInput,
  type EmptyLectureStudioTrashReceipt,
  type ExportLectureStudioArtifactInput,
  type GenerateLectureStudioInput,
  type GetLectureStudioEditDraftInput,
  type LectureStudioEditDraft,
  type SaveLectureStudioManualRevisionInput,
  type LectureStudioManualRevisionReceipt,
  type ListLectureStudioFiguresInput,
  type ChooseLectureStudioFiguresInput,
  type RemoveLectureStudioFigureInput,
  type PreviewLectureStudioFigureInput,
  type LectureStudioFigureAsset,
  type LectureStudioFigureLibraryReceipt,
  type LectureStudioFigurePreview,
  type LectureSourceCandidates,
  type LectureStudio,
  type LectureStudioArtifactActionReceipt,
  type LectureStudioDetail,
  type LectureStudioDetailInput,
  type LectureStudioEvent,
  type LectureStudioListSnapshot,
  type LectureStudioPdfPreview,
  type LectureStudioTurnReceipt,
  type LectureStudioVersionCommand,
  type OpenLectureStudioArtifactInput,
  type RevealLectureStudioArtifactInput,
  type ListLectureCandidatesInput,
  type ListLectureStudiosInput,
  type SendLectureStudioMessageInput,
  type UpdateLectureStudioGenerationBriefInput,
} from '../shared/lecture-studio-contracts';
import { unwrapLectureStudioIpcResult } from '../shared/lecture-studio-ipc-result';
import type {
  CancelLiteratureAiInput,
  DeleteLiteratureRecordInput,
  DeleteLiteratureRecordReceipt,
  LiteratureExportReceipt,
  LiteratureExportRequest,
  LiteratureImportReceipt,
  LiteratureImportRequest,
  LiteratureLibrary,
  LiteratureOrganizeReceipt,
  LiteratureAiCancelReceipt,
  LiteratureRecord,
  LiteratureSearchInput,
  LiteratureSearchPlanReceipt,
  LiteratureSearchReceipt,
  ListLiteratureInput,
  OrganizeLiteratureInput,
  PlanLiteratureSearchInput,
  UndoLiteratureSearchInput,
  UndoLiteratureSearchReceipt,
  UpdateLiteratureAnnotationsInput,
} from '../shared/literature-contracts';
import { unwrapLiteratureIpcResult } from '../shared/literature-ipc-result';
import {
  DAILY_QUOTE_CHANNELS,
  DailyQuoteHistorySchema,
  DailyQuoteViewSchema,
  type DailyQuoteHistory,
  type DailyQuoteView,
} from '../shared/daily-quote-contracts';
import {
  SSH_AGENT_NOTES_CHANNELS,
  SshAgentNotesSchema,
  type SetSshAgentNoteInput,
  type SshAgentNotes,
} from '../shared/ssh-agent-notes-contracts';
import {
  PAPER_LIBRARY_IPC_CHANNELS,
  type ImportPaperSummariesInput,
  type ImportPaperSummariesReceipt,
  type PaperLibraryList,
} from '../shared/paper-library-contracts';
import { PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS } from '../shared/project-chat-attachment-channels';
import type {
  ChooseProjectChatAttachmentsInput,
  ProjectChatAttachment,
  ReleaseProjectChatAttachmentInput,
} from '../shared/project-chat-attachment-contracts';
import { PROJECT_CHAT_IPC_CHANNELS } from '../shared/project-chat-channels';
import {
  ProjectChatEventSchema,
  type ApplyProjectChatActionInput,
  type BranchProjectChatSessionInput,
  type CreateProjectChatSessionInput,
  type ProjectChatAction,
  type ProjectChatEvent,
  type ProjectChatProfile,
  type ProjectChatQueuedTurn,
  type ProjectChatQueuedTurnInput,
  type ProjectChatSession,
  type RenameProjectChatSessionInput,
  type CompactProjectChatSessionInput,
  type ProjectChatCompactionReceipt,
  type ProjectChatSnapshot,
  type ProjectChatTurnReceipt,
  type SendProjectChatMessageInput,
  type UpdateProjectChatQueuedTurnInput,
  type UpdateProjectChatProfileInput,
} from '../shared/project-chat-contracts';
import { unwrapProjectChatIpcResult } from '../shared/project-chat-ipc-result';
import { RESEARCH_NOTES_IPC_CHANNELS } from '../shared/research-notes-channels';
import type {
  CreateResearchPaperNoteInput,
  ReadResearchNoteAttachmentInput,
  ReadResearchNoteInput,
  ResearchNotesProjectInput,
  ResearchNotesWorkspace,
  ResearchPaperNoteReceipt,
} from '../shared/research-notes-contracts';
import {
  type ResearchNotesIpcResult,
  unwrapResearchNotesIpcResult,
} from '../shared/research-notes-ipc-result';
import { SEARCH_IPC_CHANNELS } from '../shared/search-channels';
import type { SearchInput, SearchResponse } from '../shared/search-contracts';
import { type SearchIpcResult, unwrapSearchIpcResult } from '../shared/search-ipc-result';
import { SSH_IPC_CHANNELS } from '../shared/ssh-channels';
import {
  SshEventSchema,
  type CancelSshScopeInput,
  type CreateSshConnectionInput,
  type ImportSshCommandInput,
  type ListPendingSshApprovalsInput,
  type ListProjectSshResourceSnapshotsInput,
  type ReadProjectSshResourceSnapshotInput,
  type ReadSshResourceSnapshotInput,
  type RemoveSshConnectionInput,
  type ResolveSshApprovalInput,
  type SshConnectionProfile,
  type SshApprovalRequest,
  type SshConnectionTestResult,
  type SshEvent,
  type SshServerResourceSnapshot,
  type UpdateSshConnectionInput,
} from '../shared/ssh-contracts';
import { unwrapSshIpcResult } from '../shared/ssh-ipc-result';
import type {
  CreateRemoteWorkspaceGrantInput,
  EnableTrustedRemoteWorkspaceInput,
  GrantedRemoteWorkspace,
  ListRemoteWorkspaceGrantsInput,
  RemoteWorkspaceGrant,
  RemoveRemoteWorkspaceGrantInput,
  RevokeTrustedRemoteWorkspaceInput,
  UpdateRemoteWorkspaceGrantInput,
} from '../shared/ssh-workspace-contracts';
import type { VaultAttachment } from '../shared/vault-contracts';
import type {
  CreateProjectInput,
  CreateTaskInput,
  EmptyProjectTrashInput,
  EmptyProjectTrashReceipt,
  ObjectiveCommand,
  ProjectRecord,
  ProjectVersionCommand,
  RenameProjectInput,
  SaveObjectiveInput,
  SetProjectArchivedInput,
  SetTaskArchivedInput,
  UpdateBoardSettingsInput,
  UpdateProjectRepositoryInput,
  UpdateTaskInput,
  WorkspaceObjective,
  WorkspacePendingSummary,
  WorkspaceSnapshot,
  WorkspaceTask,
} from '../shared/workspace-contracts';
import { WORKSPACE_IPC_CHANNELS } from '../shared/workspace-channels';
import { unwrapWorkspaceIpcResult } from '../shared/workspace-ipc-result';

async function invokeWorkspace<T>(channel: string, ...arguments_: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...arguments_).catch(() => ({
    ok: false,
    error: { code: 'workspace_unavailable' },
  }));
  return unwrapWorkspaceIpcResult<T>(result);
}

async function invokeProjectChat<T>(channel: string, input: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'chat_unavailable' },
  }));
  return unwrapProjectChatIpcResult<T>(result);
}

async function invokeGitWorkspace<T>(channel: string, input: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'git_workspace_unavailable' },
  }));
  return unwrapGitWorkspaceIpcResult<T>(result);
}

async function invokeLiterature<T>(channel: string, input: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'literature_unavailable' },
  }));
  return unwrapLiteratureIpcResult<T>(result);
}

/** The thrown message is a bounded code the Literature view can explain, never library text. */
async function invokePaperLibrary<T>(channel: string, input: unknown): Promise<T> {
  const result: unknown = await ipcRenderer
    .invoke(channel, input)
    .catch(() => ({ ok: false, error: { code: 'paper_library_unavailable' } }));
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    const outcome = result as { ok: boolean; value?: T; error?: { code?: unknown } };
    if (outcome.ok && 'value' in outcome) return outcome.value as T;
    const code = outcome.error?.code;
    if (typeof code === 'string' && /^[a-z_]{3,64}$/u.test(code)) throw new Error(code);
  }
  throw new Error('paper_library_unavailable');
}

async function invokeManuscriptWorkspace<T>(channel: string, input: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'manuscript_workspace_unavailable' },
  }));
  return unwrapManuscriptWorkspaceIpcResult<T>(result);
}

async function invokeOverleafPersonalToken(
  channel: string,
  input: unknown,
): Promise<OverleafPersonalTokenStatus> {
  const result = await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'overleaf_personal_token_unavailable' },
  }));
  const value = unwrapOverleafPersonalTokenIpcResult<unknown>(result);
  const parsed = OverleafPersonalTokenStatusSchema.safeParse(value);
  if (!parsed.success) throw new Error('overleaf_personal_token_unavailable');
  return parsed.data;
}

async function invokeLectureStudio<T>(channel: string, input: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'lecture_unavailable' },
  }));
  return unwrapLectureStudioIpcResult<T>(result);
}

async function invokeExperiment<T>(channel: string, input: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'experiment_unavailable' },
  }));
  return unwrapExperimentIpcResult<T>(result);
}

async function invokeExperimentEvaluation<T>(channel: string, input: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'experiment_evaluation_unavailable' },
  }));
  return unwrapExperimentEvaluationIpcResult<T>(result);
}

async function invokeResearchNotes<T>(channel: string, input: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'research_notes_unavailable' },
  }))) as ResearchNotesIpcResult<T>;
  return unwrapResearchNotesIpcResult(result);
}

async function invokeSearch<T>(channel: string, input: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'search_unavailable' },
  }))) as SearchIpcResult<T>;
  return unwrapSearchIpcResult(result);
}

async function invokeSsh<T>(channel: string, input?: unknown): Promise<T> {
  const result = await ipcRenderer
    .invoke(channel, ...(input === undefined ? [] : [input]))
    .catch(() => ({
      ok: false,
      error: { code: 'ssh_unavailable' },
    }));
  return unwrapSshIpcResult<T>(result);
}

async function invokeSshAgentNotes(channel: string, input: unknown): Promise<SshAgentNotes> {
  const result: unknown = await ipcRenderer
    .invoke(channel, input)
    .catch(() => ({ ok: false, error: { code: 'ssh_agent_notes_unavailable' } }));
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    const outcome = result as { ok: boolean; value?: unknown; error?: { code?: unknown } };
    if (outcome.ok) return SshAgentNotesSchema.parse(outcome.value);
    const code = outcome.error?.code;
    if (typeof code === 'string' && /^[a-z_]{3,64}$/u.test(code)) throw new Error(code);
  }
  throw new Error('ssh_agent_notes_unavailable');
}

const openSettingsListeners = new Set<() => void>();
const openAssistantListeners = new Set<() => void>();
let pendingOpenAssistant = false;
ipcRenderer.on(APP_NAVIGATION_CHANNELS.openAssistant, (_event, ...args: unknown[]) => {
  if (args.length) return;
  if (!openAssistantListeners.size) {
    pendingOpenAssistant = true;
    return;
  }
  for (const listener of openAssistantListeners) listener();
});
function onOpenAssistant(listener: () => void) {
  if (typeof listener !== 'function') throw new Error('invalid_assistant_listener');
  openAssistantListeners.add(listener);
  if (pendingOpenAssistant) {
    pendingOpenAssistant = false;
    listener();
  }
  return () => {
    openAssistantListeners.delete(listener);
  };
}
const openSurfaceListeners = new Set<(target: AppShortcutTarget) => void>();
let pendingOpenSurface: AppShortcutTarget | null = null;
ipcRenderer.on(APP_NAVIGATION_CHANNELS.openSurface, (_event, ...args: unknown[]) => {
  const target = args[0];
  if (args.length !== 1 || !(APP_SHORTCUT_TARGETS as readonly unknown[]).includes(target)) return;
  if (!openSurfaceListeners.size) {
    pendingOpenSurface = target as AppShortcutTarget;
    return;
  }
  for (const listener of openSurfaceListeners) listener(target as AppShortcutTarget);
});
function onOpenSurface(listener: (target: AppShortcutTarget) => void) {
  if (typeof listener !== 'function') throw new Error('invalid_surface_listener');
  openSurfaceListeners.add(listener);
  if (pendingOpenSurface) {
    const target = pendingOpenSurface;
    pendingOpenSurface = null;
    listener(target);
  }
  return () => {
    openSurfaceListeners.delete(listener);
  };
}
const toggleSidebarListeners = new Set<() => void>();
let pendingOpenSettings = false;
let pendingSidebarToggle = false;

ipcRenderer.on(APP_NAVIGATION_CHANNELS.openSettings, (_event, ...arguments_: unknown[]) => {
  if (arguments_.length !== 0) return;
  if (openSettingsListeners.size === 0) {
    pendingOpenSettings = true;
    return;
  }
  for (const listener of openSettingsListeners) listener();
});

function onOpenSettings(listener: () => void) {
  if (typeof listener !== 'function') throw new Error('invalid_open_settings_listener');
  openSettingsListeners.add(listener);
  if (pendingOpenSettings) {
    pendingOpenSettings = false;
    listener();
  }
  return () => {
    openSettingsListeners.delete(listener);
  };
}

ipcRenderer.on(APP_NAVIGATION_CHANNELS.toggleSidebar, (_event, ...arguments_: unknown[]) => {
  if (arguments_.length !== 0) return;
  if (toggleSidebarListeners.size === 0) {
    pendingSidebarToggle = !pendingSidebarToggle;
    return;
  }
  for (const listener of toggleSidebarListeners) listener();
});

function onToggleSidebar(listener: () => void) {
  if (typeof listener !== 'function') throw new Error('invalid_toggle_sidebar_listener');
  toggleSidebarListeners.add(listener);
  if (pendingSidebarToggle) {
    pendingSidebarToggle = false;
    listener();
  }
  return () => {
    toggleSidebarListeners.delete(listener);
  };
}

const api = {
  applicationLanguage: {
    get: async () =>
      ApplicationLanguagePreferenceSchema.parse(
        await ipcRenderer.invoke(APPLICATION_LANGUAGE_CHANNELS.get),
      ),
    set: async (language: AppLanguage) =>
      ApplicationLanguagePreferenceSchema.parse(
        await ipcRenderer.invoke(
          APPLICATION_LANGUAGE_CHANNELS.set,
          AppLanguageSchema.parse(language),
        ),
      ),
    onChanged: (listener: (preference: ApplicationLanguagePreference) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const preference = ApplicationLanguagePreferenceSchema.safeParse(value);
        if (preference.success) listener(preference.data);
      };
      ipcRenderer.on(APPLICATION_LANGUAGE_CHANNELS.changed, handler);
      return () => ipcRenderer.removeListener(APPLICATION_LANGUAGE_CHANNELS.changed, handler);
    },
  },
  app: {
    onOpenSettings,
    onToggleSidebar,
    onOpenAssistant,
    getAssistantShortcut: (): Promise<string> =>
      ipcRenderer.invoke(APP_NAVIGATION_CHANNELS.getAssistantShortcut),
    setAssistantShortcut: (value: string): Promise<string> =>
      ipcRenderer.invoke(APP_NAVIGATION_CHANNELS.setAssistantShortcut, value),
    onOpenSurface,
    getAppShortcuts: (): Promise<AppShortcuts> =>
      ipcRenderer.invoke(APP_NAVIGATION_CHANNELS.getAppShortcuts),
    setAppShortcuts: (value: AppShortcuts): Promise<AppShortcuts> =>
      ipcRenderer.invoke(APP_NAVIGATION_CHANNELS.setAppShortcuts, value),
  },
  runtime: {
    readiness: () => ipcRenderer.invoke('gosu:runtime:readiness'),
  },
  agentAddOns: {
    status: (ids: readonly AgentAddOnId[]) =>
      ipcRenderer.invoke(AGENT_ADD_ON_CHANNELS.status, {
        ids,
      } satisfies AgentAddOnStatusRequest) as Promise<readonly AgentAddOnStatus[]>,
    connect: (id: AgentAddOnId) =>
      ipcRenderer.invoke(AGENT_ADD_ON_CHANNELS.connect, {
        id,
      } satisfies ConnectAgentAddOnRequest) as Promise<AgentAddOnStatus>,
    disconnect: (id: AgentAddOnId) =>
      ipcRenderer.invoke(AGENT_ADD_ON_CHANNELS.disconnect, {
        id,
      } satisfies DisconnectAgentAddOnRequest) as Promise<AgentAddOnStatus>,
  },
  claudeCode: {
    // Runs the official Claude Code subscription login; tokens never reach GOSU.
    login: () => ipcRenderer.invoke('gosu:claude-code:login') as Promise<{ status: 'signed_in' }>,
    cancelLogin: () => ipcRenderer.invoke('gosu:claude-code:cancel-login') as Promise<boolean>,
    submitLoginCode: (code: string) =>
      ipcRenderer.invoke('gosu:claude-code:submit-login-code', code) as Promise<boolean>,
    openLoginPage: () => ipcRenderer.invoke('gosu:claude-code:open-login-page') as Promise<boolean>,
  },
  codex: {
    status: () => ipcRenderer.invoke('gosu:codex:status'),
    listModels: () => ipcRenderer.invoke('gosu:codex:list-models'),
    reconnect: () => ipcRenderer.invoke('gosu:codex:reconnect'),
    loginChatGpt: () => ipcRenderer.invoke('gosu:codex:login-chatgpt'),
    loginApiKey: (apiKey: string) => ipcRenderer.invoke('gosu:codex:login-api-key', apiKey),
    logout: () => ipcRenderer.invoke('gosu:codex:logout'),
    onAuthenticationEvent: (listener: (event: CodexAuthenticationEvent) => void) => {
      if (typeof listener !== 'function') {
        throw new Error('invalid_codex_authentication_listener');
      }
      const handler = (_event: Electron.IpcRendererEvent, ...arguments_: unknown[]) => {
        if (arguments_.length !== 1) return;
        const parsed = CodexAuthenticationEventSchema.safeParse(arguments_[0]);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(CODEX_AUTH_IPC_CHANNELS.event, handler);
      return () => {
        ipcRenderer.removeListener(CODEX_AUTH_IPC_CHANNELS.event, handler);
      };
    },
  },
  briefingLab: {
    getApprovalPolicy: (): Promise<ApprovalPolicy> =>
      ipcRenderer.invoke(APPROVAL_POLICY_CHANNELS.get).then((v) => ApprovalPolicySchema.parse(v)),
    setApprovalPolicy: (value: ApprovalPolicy): Promise<ApprovalPolicy> =>
      ipcRenderer
        .invoke(APPROVAL_POLICY_CHANNELS.set, ApprovalPolicySchema.parse(value))
        .then((v) => ApprovalPolicySchema.parse(v)),
    notifications: () =>
      ipcRenderer
        .invoke('briefing-lab:notifications')
        .then((value) => BriefingNotificationSnapshotSchema.parse(value)),
    reserveDroppedAttachments: (
      routineId: string,
      files: readonly File[],
    ): Promise<{ ticket: string }> =>
      ipcRenderer.invoke('briefing-lab:reserve-drop', {
        routineId,
        paths: droppedAttachmentPaths(files, (file) => webUtils.getPathForFile(file)),
      }),
    getModelRouting: (): Promise<ModelRouting> =>
      ipcRenderer.invoke(MODEL_ROUTING_CHANNELS.get).then((v) => ModelRoutingSchema.parse(v)),
    setModelRouting: (value: ModelRouting): Promise<ModelRouting> =>
      ipcRenderer
        .invoke(MODEL_ROUTING_CHANNELS.set, ModelRoutingSchema.parse(value))
        .then((v) => ModelRoutingSchema.parse(v)),
    fullDiskAccess: () =>
      ipcRenderer.invoke(FULL_DISK_ACCESS_CHANNEL) as Promise<FullDiskAccessState>,
    openPrivacy: (kind: 'automation' | 'calendar' | 'full-disk'): Promise<void> =>
      ipcRenderer.invoke('briefing-lab:open-privacy', kind),
    open: (): Promise<{ url: string; configuration: unknown }> =>
      ipcRenderer.invoke('briefing-lab:open-global'),
  },
  modelLab: {
    open: (input: { projectId: string }): Promise<ProjectModelLabLocation> =>
      ipcRenderer.invoke(MODEL_LAB_OPEN_CHANNEL, input),
  },
  modelUsage: {
    query: (input: ModelUsageAnalyticsQuery) =>
      ipcRenderer.invoke(
        MODEL_USAGE_IPC_CHANNELS.query,
        input,
      ) as Promise<ModelUsageAnalyticsReport>,
    prices: () => ipcRenderer.invoke(MODEL_PRICE_IPC_CHANNELS.status) as Promise<ModelPriceStatus>,
    refreshPrices: () =>
      ipcRenderer.invoke(MODEL_PRICE_IPC_CHANNELS.refresh) as Promise<ModelPriceStatus>,
  },
  usageLimits: {
    status: () => ipcRenderer.invoke(USAGE_LIMIT_IPC_CHANNELS.status) as Promise<UsageLimitStatus>,
    refresh: () =>
      ipcRenderer.invoke(USAGE_LIMIT_IPC_CHANNELS.refresh) as Promise<UsageLimitStatus>,
    configure: (settings: UsageLimitSettings) =>
      ipcRenderer.invoke(USAGE_LIMIT_IPC_CHANNELS.configure, settings) as Promise<UsageLimitStatus>,
    onChanged: (listener: (status: UsageLimitStatus) => void) => {
      if (typeof listener !== 'function') throw new Error('invalid_usage_limit_listener');
      const handler = (_event: Electron.IpcRendererEvent, ...arguments_: unknown[]) => {
        if (arguments_.length !== 1) return;
        const parsed = UsageLimitStatusSchema.safeParse(arguments_[0]);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(USAGE_LIMIT_IPC_CHANNELS.changed, handler);
      return () => {
        ipcRenderer.removeListener(USAGE_LIMIT_IPC_CHANNELS.changed, handler);
      };
    },
  },
  dailyQuote: {
    /** Today's title bar quote; null when it cannot be read, so the chrome simply shows none. */
    get: async (): Promise<DailyQuoteView | null> => {
      const value: unknown = await ipcRenderer.invoke(DAILY_QUOTE_CHANNELS.get).catch(() => null);
      const parsed = DailyQuoteViewSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    /** Asks for one more line now; the answer says how many of the day's allowance are left. */
    refresh: async (): Promise<DailyQuoteView | null> => {
      const value: unknown = await ipcRenderer
        .invoke(DAILY_QUOTE_CHANNELS.refresh)
        .catch(() => null);
      const parsed = DailyQuoteViewSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    /** Every line still stored, newest first, with the time it was written. */
    history: async (): Promise<DailyQuoteHistory | null> => {
      const value: unknown = await ipcRenderer
        .invoke(DAILY_QUOTE_CHANNELS.history)
        .catch(() => null);
      const parsed = DailyQuoteHistorySchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
  },
  paperSummaries: {
    save: (input: PaperSummaryCandidate) =>
      ipcRenderer.invoke('gosu:paper-summary:save', {
        candidate: input,
        confirmed: true,
      }) as Promise<PaperSummarySaveReceipt>,
    list: () => invokePaperLibrary<PaperLibraryList>(PAPER_LIBRARY_IPC_CHANNELS.list, undefined),
    importToLiterature: (input: ImportPaperSummariesInput) =>
      invokePaperLibrary<ImportPaperSummariesReceipt>(
        PAPER_LIBRARY_IPC_CHANNELS.importToLiterature,
        input,
      ),
  },
  projectChat: {
    snapshot: (projectId: string, sessionId?: string) =>
      invokeProjectChat<ProjectChatSnapshot>(PROJECT_CHAT_IPC_CHANNELS.snapshot, {
        projectId,
        ...(sessionId ? { sessionId } : {}),
      }),
    listSessions: (projectId: string) =>
      invokeProjectChat<ProjectChatSession[]>(PROJECT_CHAT_IPC_CHANNELS.listSessions, {
        projectId,
      }),
    createSession: (input: CreateProjectChatSessionInput) =>
      invokeProjectChat<ProjectChatSession>(PROJECT_CHAT_IPC_CHANNELS.createSession, input),
    branchSession: (input: BranchProjectChatSessionInput) =>
      invokeProjectChat<ProjectChatSession>(PROJECT_CHAT_IPC_CHANNELS.branchSession, input),
    renameSession: (input: RenameProjectChatSessionInput) =>
      invokeProjectChat<ProjectChatSession>(PROJECT_CHAT_IPC_CHANNELS.renameSession, input),
    compactSession: (input: CompactProjectChatSessionInput) =>
      invokeProjectChat<ProjectChatCompactionReceipt>(
        PROJECT_CHAT_IPC_CHANNELS.compactSession,
        input,
      ),
    updateProfile: (input: UpdateProjectChatProfileInput) =>
      invokeProjectChat<ProjectChatProfile>(PROJECT_CHAT_IPC_CHANNELS.updateProfile, input),
    send: (input: SendProjectChatMessageInput) =>
      invokeProjectChat<ProjectChatTurnReceipt>(PROJECT_CHAT_IPC_CHANNELS.send, input),
    updateQueuedTurn: (input: UpdateProjectChatQueuedTurnInput) =>
      invokeProjectChat<ProjectChatQueuedTurn>(PROJECT_CHAT_IPC_CHANNELS.updateQueuedTurn, input),
    removeQueuedTurn: (input: ProjectChatQueuedTurnInput) =>
      invokeProjectChat<{ removed: true }>(PROJECT_CHAT_IPC_CHANNELS.removeQueuedTurn, input),
    runQueuedTurnNow: (input: ProjectChatQueuedTurnInput) =>
      invokeProjectChat<{ accepted: true }>(PROJECT_CHAT_IPC_CHANNELS.runQueuedTurnNow, input),
    steerQueuedTurn: (input: UpdateProjectChatQueuedTurnInput) =>
      invokeProjectChat<{ accepted: true }>(PROJECT_CHAT_IPC_CHANNELS.steerQueuedTurn, input),
    stageDroppedAttachments: (input: ChooseProjectChatAttachmentsInput, files: readonly File[]) =>
      invokeProjectChat<ProjectChatAttachment[]>(PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.drop, {
        ...input,
        paths: droppedAttachmentPaths(files, (file) => webUtils.getPathForFile(file)),
      }),
    chooseAttachments: (input: ChooseProjectChatAttachmentsInput) =>
      invokeProjectChat<ProjectChatAttachment[]>(
        PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.choose,
        input,
      ),
    releaseAttachment: (input: ReleaseProjectChatAttachmentInput) =>
      invokeProjectChat<{ released: true }>(PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.release, input),
    cancel: (projectId: string, sessionId?: string) =>
      invokeProjectChat<{ accepted: true }>(PROJECT_CHAT_IPC_CHANNELS.cancel, {
        projectId,
        ...(sessionId ? { sessionId } : {}),
      }),
    revokeSsh: (projectId: string, sessionId?: string) =>
      invokeProjectChat<{ revoked: true }>(PROJECT_CHAT_IPC_CHANNELS.revokeSsh, {
        projectId,
        ...(sessionId ? { sessionId } : {}),
      }),
    applyAction: (input: ApplyProjectChatActionInput) =>
      invokeProjectChat<ProjectChatAction>(PROJECT_CHAT_IPC_CHANNELS.applyAction, input),
    onEvent: (listener: (event: ProjectChatEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = ProjectChatEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(PROJECT_CHAT_IPC_CHANNELS.event, handler);
      return () => {
        ipcRenderer.removeListener(PROJECT_CHAT_IPC_CHANNELS.event, handler);
      };
    },
  },
  gitWorkspace: {
    snapshot: (projectId: string) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.snapshot, { projectId }),
    clone: (projectId: string) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.clone, { projectId }),
    readFile: (input: GitFileInput) =>
      invokeGitWorkspace<GitFilePreview>(GIT_WORKSPACE_IPC_CHANNELS.readFile, input),
    diff: (input: GitDiffInput) =>
      invokeGitWorkspace<GitTextPreview>(GIT_WORKSPACE_IPC_CHANNELS.diff, input),
    commitDetail: (projectId: string, commitSha: string) =>
      invokeGitWorkspace<GitTextPreview>(GIT_WORKSPACE_IPC_CHANNELS.commitDetail, {
        projectId,
        commitSha,
      }),
    stage: (input: GitPathsCommand) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.stage, input),
    unstage: (input: GitPathsCommand) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.unstage, input),
    commit: (input: GitCommitInput) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.commit, input),
    createBranch: (input: GitCreateBranchInput) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.createBranch, input),
    switchBranch: (input: GitSwitchBranchInput) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.switchBranch, input),
    fetch: (input: GitHeadCommand) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.fetch, input),
    pull: (input: GitHeadCommand) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.pull, input),
    push: (input: GitHeadCommand) =>
      invokeGitWorkspace<GitWorkspaceSnapshot>(GIT_WORKSPACE_IPC_CHANNELS.push, input),
    reveal: (projectId: string) =>
      invokeGitWorkspace<{ revealed: true }>(GIT_WORKSPACE_IPC_CHANNELS.reveal, { projectId }),
  },
  manuscriptWorkspace: {
    list: (projectId: string) =>
      invokeManuscriptWorkspace<ManuscriptWorkspaceSnapshot>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.list,
        { projectId },
      ),
    create: (input: CreateManuscriptInput) =>
      invokeManuscriptWorkspace<ManuscriptWorkspaceSnapshot>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.create,
        input,
      ),
    update: (input: UpdateManuscriptInput) =>
      invokeManuscriptWorkspace<ManuscriptWorkspaceSnapshot>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.update,
        input,
      ),
    deleteUnconfigured: (input: DeleteUnconfiguredManuscriptInput) =>
      invokeManuscriptWorkspace<ManuscriptWorkspaceSnapshot>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.deleteUnconfigured,
        input,
      ),
    connectOverleafGit: (input: ConnectOverleafGitInput) =>
      invokeManuscriptWorkspace<ManuscriptWorkspaceSnapshot>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.connectOverleafGit,
        input,
      ),
    inspect: (input: ManuscriptBindingCommand) =>
      invokeManuscriptWorkspace<ManuscriptWorkspaceSnapshot>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.inspect,
        input,
      ),
    fetchCheckpoint: (input: FetchManuscriptCheckpointInput) =>
      invokeManuscriptWorkspace<ManuscriptWorkspaceSnapshot>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.fetchCheckpoint,
        input,
      ),
    listCheckpointFiles: (input: ListManuscriptCheckpointFilesInput) =>
      invokeManuscriptWorkspace<ManuscriptCheckpointFileList>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.listCheckpointFiles,
        input,
      ),
    readCheckpointFile: (input: ReadManuscriptCheckpointFileInput) =>
      invokeManuscriptWorkspace<ManuscriptCheckpointFileChunk>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.readCheckpointFile,
        input,
      ),
    compilePdf: (input: CompileManuscriptPdfInput) =>
      invokeManuscriptWorkspace<ManuscriptPdfPreview>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.compilePdf,
        input,
      ),
    exportPdf: (input: ManuscriptPdfArtifactBinding) =>
      invokeManuscriptWorkspace<ManuscriptPdfArtifactActionReceipt>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.exportPdf,
        input,
      ),
    openPdf: (input: ManuscriptPdfArtifactBinding) =>
      invokeManuscriptWorkspace<ManuscriptPdfArtifactActionReceipt>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.openPdf,
        input,
      ),
    revealPdf: (input: ManuscriptPdfArtifactBinding) =>
      invokeManuscriptWorkspace<ManuscriptPdfArtifactActionReceipt>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.revealPdf,
        input,
      ),
    disconnect: (input: ManuscriptBindingCommand) =>
      invokeManuscriptWorkspace<ManuscriptWorkspaceSnapshot>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.disconnect,
        input,
      ),
  },
  overleafPersonalToken: {
    status: () => invokeOverleafPersonalToken(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.status, {}),
    save: (input: SaveOverleafPersonalTokenInput) =>
      invokeOverleafPersonalToken(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.save, input),
    remove: () => invokeOverleafPersonalToken(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.remove, {}),
  },
  literature: {
    list: (input: ListLiteratureInput) =>
      invokeLiterature<LiteratureLibrary>(LITERATURE_IPC_CHANNELS.list, input),
    search: (input: LiteratureSearchInput) =>
      invokeLiterature<LiteratureSearchReceipt>(LITERATURE_IPC_CHANNELS.search, input),
    updateAnnotations: (input: UpdateLiteratureAnnotationsInput) =>
      invokeLiterature<LiteratureRecord>(LITERATURE_IPC_CHANNELS.updateAnnotations, input),
    deleteRecord: (input: DeleteLiteratureRecordInput) =>
      invokeLiterature<DeleteLiteratureRecordReceipt>(LITERATURE_IPC_CHANNELS.deleteRecord, input),
    importRecords: (input: LiteratureImportRequest) =>
      invokeLiterature<LiteratureImportReceipt>(LITERATURE_IPC_CHANNELS.importRecords, input),
    exportRecords: (input: LiteratureExportRequest) =>
      invokeLiterature<LiteratureExportReceipt>(LITERATURE_IPC_CHANNELS.exportRecords, input),
    organize: (input: OrganizeLiteratureInput) =>
      invokeLiterature<LiteratureOrganizeReceipt>(LITERATURE_IPC_CHANNELS.organize, input),
    cancelOrganize: (input: CancelLiteratureAiInput) =>
      invokeLiterature<LiteratureAiCancelReceipt>(LITERATURE_IPC_CHANNELS.cancelOrganize, input),
    planSearch: (input: PlanLiteratureSearchInput) =>
      invokeLiterature<LiteratureSearchPlanReceipt>(LITERATURE_IPC_CHANNELS.planSearch, input),
    undoSearch: (input: UndoLiteratureSearchInput) =>
      invokeLiterature<UndoLiteratureSearchReceipt>(LITERATURE_IPC_CHANNELS.undoSearch, input),
  },
  lectureStudio: {
    list: (input: ListLectureStudiosInput) =>
      invokeLectureStudio<LectureStudioListSnapshot>(LECTURE_STUDIO_IPC_CHANNELS.list, input),
    detail: (input: LectureStudioDetailInput) =>
      invokeLectureStudio<LectureStudioDetail>(LECTURE_STUDIO_IPC_CHANNELS.detail, input),
    candidates: (input: ListLectureCandidatesInput) =>
      invokeLectureStudio<LectureSourceCandidates>(LECTURE_STUDIO_IPC_CHANNELS.candidates, input),
    stageExternalSources: (input: StageLectureExternalSourcesInput) =>
      invokeLectureStudio<StagedLectureExternalSourceSetView>(
        LECTURE_STUDIO_IPC_CHANNELS.stageExternalSources,
        input,
      ),
    removeStagedExternalSource: (input: RemoveStagedLectureExternalSourceInput) =>
      invokeLectureStudio<StagedLectureExternalSourceSetView>(
        LECTURE_STUDIO_IPC_CHANNELS.removeStagedExternalSource,
        input,
      ),
    discardExternalSourceSet: (input: DiscardLectureExternalSourceSetInput) =>
      invokeLectureStudio<{ discarded: true }>(
        LECTURE_STUDIO_IPC_CHANNELS.discardExternalSourceSet,
        input,
      ),
    importOverleaf: (input: ImportLectureOverleafSourceInput) =>
      invokeLectureStudio<LectureOverleafSourceReceipt>(
        LECTURE_STUDIO_IPC_CHANNELS.importOverleaf,
        input,
      ),
    chooseAttachments: (input: ChooseLectureStudioAttachmentsInput) =>
      invokeLectureStudio<readonly LectureStudioAttachmentCard[]>(
        LECTURE_STUDIO_IPC_CHANNELS.chooseAttachments,
        input,
      ),
    releaseAttachment: (input: ReleaseLectureStudioAttachmentInput) =>
      invokeLectureStudio<{ released: true }>(LECTURE_STUDIO_IPC_CHANNELS.releaseAttachment, input),
    create: (input: CreateLectureStudioInput) =>
      invokeLectureStudio<LectureStudio>(LECTURE_STUDIO_IPC_CHANNELS.create, input),
    updateGenerationBrief: (input: UpdateLectureStudioGenerationBriefInput) =>
      invokeLectureStudio<LectureStudio>(LECTURE_STUDIO_IPC_CHANNELS.updateGenerationBrief, input),
    editDraft: (input: GetLectureStudioEditDraftInput) =>
      invokeLectureStudio<LectureStudioEditDraft>(LECTURE_STUDIO_IPC_CHANNELS.editDraft, input),
    saveManualRevision: (input: SaveLectureStudioManualRevisionInput) =>
      invokeLectureStudio<LectureStudioManualRevisionReceipt>(
        LECTURE_STUDIO_IPC_CHANNELS.saveManualRevision,
        input,
      ),
    listFigures: (input: ListLectureStudioFiguresInput) =>
      invokeLectureStudio<readonly LectureStudioFigureAsset[]>(
        LECTURE_STUDIO_IPC_CHANNELS.listFigures,
        input,
      ),
    chooseFigures: (input: ChooseLectureStudioFiguresInput) =>
      invokeLectureStudio<LectureStudioFigureLibraryReceipt>(
        LECTURE_STUDIO_IPC_CHANNELS.chooseFigures,
        input,
      ),
    stageDroppedFigures: (input: ChooseLectureStudioFiguresInput, files: readonly File[]) => {
      if (!Array.isArray(files) || files.length < 1 || files.length > 5) {
        return Promise.reject(new Error('invalid_lecture_input'));
      }
      let paths: string[];
      try {
        paths = files.map((file) => webUtils.getPathForFile(file));
      } catch {
        return Promise.reject(new Error('invalid_lecture_input'));
      }
      if (paths.some((path) => path.length === 0)) {
        return Promise.reject(new Error('invalid_lecture_input'));
      }
      return invokeLectureStudio<LectureStudioFigureLibraryReceipt>(
        LECTURE_STUDIO_IPC_CHANNELS.stageDroppedFigures,
        { ...input, paths },
      );
    },
    removeFigure: (input: RemoveLectureStudioFigureInput) =>
      invokeLectureStudio<LectureStudioFigureLibraryReceipt>(
        LECTURE_STUDIO_IPC_CHANNELS.removeFigure,
        input,
      ),
    previewFigure: (input: PreviewLectureStudioFigureInput) =>
      invokeLectureStudio<LectureStudioFigurePreview>(
        LECTURE_STUDIO_IPC_CHANNELS.previewFigure,
        input,
      ),
    generate: (input: GenerateLectureStudioInput) =>
      invokeLectureStudio<LectureStudioTurnReceipt>(LECTURE_STUDIO_IPC_CHANNELS.generate, input),
    send: (input: SendLectureStudioMessageInput) =>
      invokeLectureStudio<LectureStudioTurnReceipt>(LECTURE_STUDIO_IPC_CHANNELS.send, input),
    cancel: (input: CancelLectureStudioInput) =>
      invokeLectureStudio<LectureStudio>(LECTURE_STUDIO_IPC_CHANNELS.cancel, input),
    trash: (input: LectureStudioVersionCommand) =>
      invokeLectureStudio<LectureStudio>(LECTURE_STUDIO_IPC_CHANNELS.trash, input),
    restore: (input: LectureStudioVersionCommand) =>
      invokeLectureStudio<LectureStudio>(LECTURE_STUDIO_IPC_CHANNELS.restore, input),
    emptyTrash: (input: EmptyLectureStudioTrashInput) =>
      invokeLectureStudio<EmptyLectureStudioTrashReceipt>(
        LECTURE_STUDIO_IPC_CHANNELS.emptyTrash,
        input,
      ),
    compilePdf: (input: CompileLectureStudioPdfInput) =>
      invokeLectureStudio<LectureStudioPdfPreview>(LECTURE_STUDIO_IPC_CHANNELS.compilePdf, input),
    exportArtifact: (input: ExportLectureStudioArtifactInput) =>
      invokeLectureStudio<LectureStudioArtifactActionReceipt>(
        LECTURE_STUDIO_IPC_CHANNELS.exportArtifact,
        input,
      ),
    openArtifact: (input: OpenLectureStudioArtifactInput) =>
      invokeLectureStudio<LectureStudioArtifactActionReceipt>(
        LECTURE_STUDIO_IPC_CHANNELS.openArtifact,
        input,
      ),
    revealArtifact: (input: RevealLectureStudioArtifactInput) =>
      invokeLectureStudio<LectureStudioArtifactActionReceipt>(
        LECTURE_STUDIO_IPC_CHANNELS.revealArtifact,
        input,
      ),
    onEvent: (listener: (event: LectureStudioEvent) => void) => {
      if (typeof listener !== 'function') throw new Error('invalid_lecture_event_listener');
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = LectureStudioEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(LECTURE_STUDIO_IPC_CHANNELS.event, handler);
      return () => {
        ipcRenderer.removeListener(LECTURE_STUDIO_IPC_CHANNELS.event, handler);
      };
    },
  },
  experiments: {
    list: (input: ListExperimentWorkspaceInput) =>
      invokeExperiment<ExperimentWorkspaceSnapshot>(EXPERIMENT_WORKSPACE_IPC_CHANNELS.list, input),
    createIdea: (input: CreateExperimentIdeaInput) =>
      invokeExperiment<ExperimentIdea>(EXPERIMENT_WORKSPACE_IPC_CHANNELS.createIdea, input),
    updateIdea: (input: UpdateExperimentIdeaInput) =>
      invokeExperiment<ExperimentIdea>(EXPERIMENT_WORKSPACE_IPC_CHANNELS.updateIdea, input),
    recordMetric: (input: RecordExperimentMetricInput) =>
      invokeExperiment<ExperimentMetricPoint>(
        EXPERIMENT_WORKSPACE_IPC_CHANNELS.recordMetric,
        input,
      ),
    reviseLoggingTemplate: (input: ReviseExperimentLoggingTemplateInput) =>
      invokeExperiment<ExperimentLoggingTemplate>(
        EXPERIMENT_WORKSPACE_IPC_CHANNELS.reviseLoggingTemplate,
        input,
      ),
    readRunLog: (input: ReadExperimentRunLogInput) =>
      invokeExperiment<ExperimentRunLogChunk>(EXPERIMENT_WORKSPACE_IPC_CHANNELS.readRunLog, input),
    onEvent: (listener: (event: ExperimentWorkspaceEvent) => void) => {
      if (typeof listener !== 'function') throw new Error('invalid_experiment_event_listener');
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = ExperimentWorkspaceEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(EXPERIMENT_WORKSPACE_IPC_CHANNELS.event, handler);
      return () => {
        ipcRenderer.removeListener(EXPERIMENT_WORKSPACE_IPC_CHANNELS.event, handler);
      };
    },
  },
  experimentEvaluation: {
    list: (input: ListExperimentEvaluationsInput) =>
      invokeExperimentEvaluation<ExperimentEvaluationListSnapshot>(
        EXPERIMENT_EVALUATION_IPC_CHANNELS.list,
        input,
      ),
    detail: (input: ExperimentEvaluationDetailInput) =>
      invokeExperimentEvaluation<ExperimentEvaluationSessionDetail>(
        EXPERIMENT_EVALUATION_IPC_CHANNELS.detail,
        input,
      ),
    createSession: (input: CreateExperimentEvaluationSessionInput) =>
      invokeExperimentEvaluation<ExperimentEvaluationSession>(
        EXPERIMENT_EVALUATION_IPC_CHANNELS.createSession,
        input,
      ),
    send: (input: SendExperimentEvaluationMessageInput) =>
      invokeExperimentEvaluation<ExperimentEvaluationTurnReceipt>(
        EXPERIMENT_EVALUATION_IPC_CHANNELS.send,
        input,
      ),
    cancel: (input: CancelExperimentEvaluationInput) =>
      invokeExperimentEvaluation<ExperimentEvaluationCancelReceipt>(
        EXPERIMENT_EVALUATION_IPC_CHANNELS.cancel,
        input,
      ),
    approve: (input: ApproveExperimentEvaluationInput) =>
      invokeExperimentEvaluation<ExperimentEvaluationApprovalReceipt>(
        EXPERIMENT_EVALUATION_IPC_CHANNELS.approve,
        input,
      ),
    reuseProfile: (input: ReuseExperimentEvaluationProfileInput) =>
      invokeExperimentEvaluation<ExperimentEvaluationSessionDetail>(
        EXPERIMENT_EVALUATION_IPC_CHANNELS.reuseProfile,
        input,
      ),
    onEvent: (listener: (event: ExperimentEvaluationEvent) => void) => {
      if (typeof listener !== 'function') {
        throw new Error('invalid_experiment_evaluation_event_listener');
      }
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = ExperimentEvaluationEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(EXPERIMENT_EVALUATION_IPC_CHANNELS.event, handler);
      return () => {
        ipcRenderer.removeListener(EXPERIMENT_EVALUATION_IPC_CHANNELS.event, handler);
      };
    },
  },
  /**
   * The user's notes for the AI per registered server. Kept out of `ssh`: that namespace is the
   * reviewed connection and approval surface, and plain text settings do not belong to it.
   */
  sshAgentNotes: {
    get: () => invokeSshAgentNotes(SSH_AGENT_NOTES_CHANNELS.get, undefined),
    set: (input: SetSshAgentNoteInput) => invokeSshAgentNotes(SSH_AGENT_NOTES_CHANNELS.set, input),
  },
  ssh: {
    listConnections: () =>
      invokeSsh<readonly SshConnectionProfile[]>(SSH_IPC_CHANNELS.listConnections),
    createConnection: (input: CreateSshConnectionInput) =>
      invokeSsh<SshConnectionProfile>(SSH_IPC_CHANNELS.createConnection, input),
    importCommand: (input: ImportSshCommandInput) =>
      invokeSsh<SshConnectionProfile>(SSH_IPC_CHANNELS.importCommand, input),
    updateConnection: (input: UpdateSshConnectionInput) =>
      invokeSsh<SshConnectionProfile>(SSH_IPC_CHANNELS.updateConnection, input),
    removeConnection: (input: RemoveSshConnectionInput) =>
      invokeSsh<{ removed: true }>(SSH_IPC_CHANNELS.removeConnection, input),
    testConnection: (connectionId: string) =>
      invokeSsh<SshConnectionTestResult>(SSH_IPC_CHANNELS.testConnection, { connectionId }),
    readResourceSnapshot: (input: ReadSshResourceSnapshotInput) =>
      invokeSsh<SshServerResourceSnapshot>(SSH_IPC_CHANNELS.readResourceSnapshot, input),
    readProjectResourceSnapshot: (input: ReadProjectSshResourceSnapshotInput) =>
      invokeSsh<SshServerResourceSnapshot>(SSH_IPC_CHANNELS.readProjectResourceSnapshot, input),
    listProjectResourceSnapshots: (input: ListProjectSshResourceSnapshotsInput) =>
      invokeSsh<readonly SshServerResourceSnapshot[]>(
        SSH_IPC_CHANNELS.listProjectResourceSnapshots,
        input,
      ),
    listWorkspaceGrants: (input: ListRemoteWorkspaceGrantsInput) =>
      invokeSsh<readonly GrantedRemoteWorkspace[]>(SSH_IPC_CHANNELS.listWorkspaceGrants, input),
    createWorkspaceGrant: (input: CreateRemoteWorkspaceGrantInput) =>
      invokeSsh<RemoteWorkspaceGrant>(SSH_IPC_CHANNELS.createWorkspaceGrant, input),
    updateWorkspaceGrant: (input: UpdateRemoteWorkspaceGrantInput) =>
      invokeSsh<RemoteWorkspaceGrant>(SSH_IPC_CHANNELS.updateWorkspaceGrant, input),
    removeWorkspaceGrant: (input: RemoveRemoteWorkspaceGrantInput) =>
      invokeSsh<{ removed: true }>(SSH_IPC_CHANNELS.removeWorkspaceGrant, input),
    enableTrustedWorkspace: (input: EnableTrustedRemoteWorkspaceInput) =>
      invokeSsh<RemoteWorkspaceGrant>(SSH_IPC_CHANNELS.enableTrustedWorkspace, input),
    revokeTrustedWorkspace: (input: RevokeTrustedRemoteWorkspaceInput) =>
      invokeSsh<RemoteWorkspaceGrant>(SSH_IPC_CHANNELS.revokeTrustedWorkspace, input),
    listPendingApprovals: (input: ListPendingSshApprovalsInput) =>
      invokeSsh<readonly SshApprovalRequest[]>(SSH_IPC_CHANNELS.listPendingApprovals, input),
    resolveApproval: (input: ResolveSshApprovalInput) =>
      invokeSsh<{ outcome: 'allowed' | 'denied' }>(SSH_IPC_CHANNELS.resolveApproval, input),
    cancelScope: (input: CancelSshScopeInput) =>
      invokeSsh<{ cancelled: number }>(SSH_IPC_CHANNELS.cancelScope, input),
    onEvent: (listener: (event: SshEvent) => void) => {
      if (typeof listener !== 'function') throw new Error('invalid_ssh_event_listener');
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = SshEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(SSH_IPC_CHANNELS.event, handler);
      return () => {
        ipcRenderer.removeListener(SSH_IPC_CHANNELS.event, handler);
      };
    },
  },
  hermesAcp: {
    listPendingApprovals: async (input: ListPendingHermesAcpApprovalsInput) =>
      HermesAcpApprovalListSchema.parse(
        await ipcRenderer.invoke(HERMES_ACP_APPROVAL_CHANNELS.listPendingApprovals, input),
      ) as readonly HermesAcpApprovalRequest[],
    resolveApproval: (input: ResolveHermesAcpApprovalInput) =>
      ipcRenderer.invoke(HERMES_ACP_APPROVAL_CHANNELS.resolveApproval, input) as Promise<{
        outcome: 'allowed' | 'denied';
      }>,
    onEvent: (listener: (event: HermesAcpApprovalEvent) => void) => {
      if (typeof listener !== 'function') {
        throw new Error('invalid_hermes_acp_approval_event_listener');
      }
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = HermesAcpApprovalEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(HERMES_ACP_APPROVAL_CHANNELS.event, handler);
      return () => {
        ipcRenderer.removeListener(HERMES_ACP_APPROVAL_CHANNELS.event, handler);
      };
    },
  },
  researchNotes: {
    current: (input: ResearchNotesProjectInput) =>
      invokeResearchNotes<ResearchNotesWorkspace | null>(
        RESEARCH_NOTES_IPC_CHANNELS.current,
        input,
      ),
    chooseVault: (input: ResearchNotesProjectInput) =>
      invokeResearchNotes<ResearchNotesWorkspace | null>(
        RESEARCH_NOTES_IPC_CHANNELS.chooseVault,
        input,
      ),
    read: (input: ReadResearchNoteInput) =>
      invokeResearchNotes<{ path: string; content: string }>(
        RESEARCH_NOTES_IPC_CHANNELS.read,
        input,
      ),
    readAttachment: (input: ReadResearchNoteAttachmentInput) =>
      invokeResearchNotes<VaultAttachment>(RESEARCH_NOTES_IPC_CHANNELS.readAttachment, input),
    syncLiterature: (input: ResearchNotesProjectInput) =>
      invokeResearchNotes<{ syncedAt: string | null }>(
        RESEARCH_NOTES_IPC_CHANNELS.syncLiterature,
        input,
      ),
    createPaperNote: (input: CreateResearchPaperNoteInput) =>
      invokeResearchNotes<ResearchPaperNoteReceipt>(
        RESEARCH_NOTES_IPC_CHANNELS.createPaperNote,
        input,
      ),
  },
  search: {
    query: (input: SearchInput) => invokeSearch<SearchResponse>(SEARCH_IPC_CHANNELS.search, input),
  },
  workspace: {
    snapshot: () => invokeWorkspace<WorkspaceSnapshot>(WORKSPACE_IPC_CHANNELS.snapshot),
    pendingSummary: () =>
      invokeWorkspace<WorkspacePendingSummary>(WORKSPACE_IPC_CHANNELS.pendingSummary),
    createProject: (input: CreateProjectInput) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.createProject, input),
    renameProject: (input: RenameProjectInput) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.renameProject, input),
    updateProjectRepository: (input: UpdateProjectRepositoryInput) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.updateProjectRepository, input),
    setProjectArchived: (input: SetProjectArchivedInput) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.setProjectArchived, input),
    trashProject: (input: ProjectVersionCommand) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.trashProject, input),
    restoreProject: (input: ProjectVersionCommand) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.restoreProject, input),
    emptyProjectTrash: (input: EmptyProjectTrashInput) =>
      invokeWorkspace<EmptyProjectTrashReceipt>(WORKSPACE_IPC_CHANNELS.emptyProjectTrash, input),
    updateBoardSettings: (input: UpdateBoardSettingsInput) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.updateBoardSettings, input),
    createTask: (input: CreateTaskInput) =>
      invokeWorkspace<WorkspaceTask>(WORKSPACE_IPC_CHANNELS.createTask, input),
    updateTask: (input: UpdateTaskInput) =>
      invokeWorkspace<WorkspaceTask>(WORKSPACE_IPC_CHANNELS.updateTask, input),
    setTaskArchived: (input: SetTaskArchivedInput) =>
      invokeWorkspace<WorkspaceTask>(WORKSPACE_IPC_CHANNELS.setTaskArchived, input),
    saveObjective: (input: SaveObjectiveInput) =>
      invokeWorkspace<WorkspaceObjective>(WORKSPACE_IPC_CHANNELS.saveObjective, input),
    lockObjective: (input: ObjectiveCommand) =>
      invokeWorkspace<WorkspaceObjective>(WORKSPACE_IPC_CHANNELS.lockObjective, input),
    startObjectiveVersion: (input: ObjectiveCommand) =>
      invokeWorkspace<WorkspaceObjective>(WORKSPACE_IPC_CHANNELS.startObjectiveVersion, input),
  },
  openExternal: (url: string) => ipcRenderer.invoke('gosu:external:open', url),
};

contextBridge.exposeInMainWorld('gosu', api);
export type GosuDesktopApi = typeof api;
