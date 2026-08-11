import { contextBridge, ipcRenderer } from 'electron';

import { AGENT_ADD_ON_CHANNELS } from '../shared/agent-addon-channels';
import type {
  AgentAddOnId,
  AgentAddOnStatus,
  AgentAddOnStatusRequest,
  ConnectAgentAddOnRequest,
  DisconnectAgentAddOnRequest,
} from '../shared/agent-addon-contracts';
import { APP_NAVIGATION_CHANNELS } from '../shared/app-navigation-channels';
import { EXPERIMENT_WORKSPACE_IPC_CHANNELS } from '../shared/experiment-workspace-channels';
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
import type {
  ConnectOverleafGitInput,
  CreateManuscriptInput,
  FetchManuscriptCheckpointInput,
  ManuscriptBindingCommand,
  ManuscriptWorkspaceSnapshot,
  UpdateManuscriptInput,
} from '../shared/manuscript-workspace-contracts';
import { unwrapManuscriptWorkspaceIpcResult } from '../shared/manuscript-workspace-ipc-result';
import { LECTURE_STUDIO_IPC_CHANNELS } from '../shared/lecture-studio-channels';
import {
  LectureStudioEventSchema,
  type CancelLectureStudioInput,
  type CreateLectureStudioInput,
  type GenerateLectureStudioInput,
  type LectureSourceCandidates,
  type LectureStudio,
  type LectureStudioDetail,
  type LectureStudioDetailInput,
  type LectureStudioEvent,
  type LectureStudioListSnapshot,
  type LectureStudioTurnReceipt,
  type ListLectureCandidatesInput,
  type ListLectureStudiosInput,
  type SendLectureStudioMessageInput,
} from '../shared/lecture-studio-contracts';
import { unwrapLectureStudioIpcResult } from '../shared/lecture-studio-ipc-result';
import type {
  DeleteLiteratureRecordInput,
  DeleteLiteratureRecordReceipt,
  LiteratureExportReceipt,
  LiteratureExportRequest,
  LiteratureImportReceipt,
  LiteratureImportRequest,
  LiteratureLibrary,
  LiteratureOrganizeReceipt,
  LiteratureRecord,
  LiteratureSearchInput,
  LiteratureSearchReceipt,
  ListLiteratureInput,
  OrganizeLiteratureInput,
  UpdateLiteratureAnnotationsInput,
} from '../shared/literature-contracts';
import { unwrapLiteratureIpcResult } from '../shared/literature-ipc-result';
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

async function invokeManuscriptWorkspace<T>(channel: string, input: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input).catch(() => ({
    ok: false,
    error: { code: 'manuscript_workspace_unavailable' },
  }));
  return unwrapManuscriptWorkspaceIpcResult<T>(result);
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

const openSettingsListeners = new Set<() => void>();
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
  app: {
    onOpenSettings,
    onToggleSidebar,
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
  codex: {
    status: () => ipcRenderer.invoke('gosu:codex:status'),
    listModels: () => ipcRenderer.invoke('gosu:codex:list-models'),
    reconnect: () => ipcRenderer.invoke('gosu:codex:reconnect'),
    loginChatGpt: () => ipcRenderer.invoke('gosu:codex:login-chatgpt'),
    loginApiKey: (apiKey: string) => ipcRenderer.invoke('gosu:codex:login-api-key', apiKey),
    logout: () => ipcRenderer.invoke('gosu:codex:logout'),
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
    disconnect: (input: ManuscriptBindingCommand) =>
      invokeManuscriptWorkspace<ManuscriptWorkspaceSnapshot>(
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.disconnect,
        input,
      ),
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
  },
  lectureStudio: {
    list: (input: ListLectureStudiosInput) =>
      invokeLectureStudio<LectureStudioListSnapshot>(LECTURE_STUDIO_IPC_CHANNELS.list, input),
    detail: (input: LectureStudioDetailInput) =>
      invokeLectureStudio<LectureStudioDetail>(LECTURE_STUDIO_IPC_CHANNELS.detail, input),
    candidates: (input: ListLectureCandidatesInput) =>
      invokeLectureStudio<LectureSourceCandidates>(LECTURE_STUDIO_IPC_CHANNELS.candidates, input),
    create: (input: CreateLectureStudioInput) =>
      invokeLectureStudio<LectureStudio>(LECTURE_STUDIO_IPC_CHANNELS.create, input),
    generate: (input: GenerateLectureStudioInput) =>
      invokeLectureStudio<LectureStudioTurnReceipt>(LECTURE_STUDIO_IPC_CHANNELS.generate, input),
    send: (input: SendLectureStudioMessageInput) =>
      invokeLectureStudio<LectureStudioTurnReceipt>(LECTURE_STUDIO_IPC_CHANNELS.send, input),
    cancel: (input: CancelLectureStudioInput) =>
      invokeLectureStudio<LectureStudio>(LECTURE_STUDIO_IPC_CHANNELS.cancel, input),
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
