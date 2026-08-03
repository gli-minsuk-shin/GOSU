import { contextBridge, ipcRenderer } from 'electron';

import { APP_NAVIGATION_CHANNELS } from '../shared/app-navigation-channels';
import { PROJECT_CHAT_IPC_CHANNELS } from '../shared/project-chat-channels';
import {
  ProjectChatEventSchema,
  type ApplyProjectChatActionInput,
  type ProjectChatAction,
  type ProjectChatEvent,
  type ProjectChatProfile,
  type ProjectChatSnapshot,
  type ProjectChatTurnReceipt,
  type SendProjectChatMessageInput,
  type UpdateProjectChatProfileInput,
} from '../shared/project-chat-contracts';
import { unwrapProjectChatIpcResult } from '../shared/project-chat-ipc-result';
import type { ReadVaultAttachmentInput, VaultAttachment } from '../shared/vault-contracts';
import type {
  CreateProjectInput,
  CreateTaskInput,
  ObjectiveCommand,
  ProjectRecord,
  ProjectVersionCommand,
  RenameProjectInput,
  SaveObjectiveInput,
  SetTaskArchivedInput,
  UpdateBoardSettingsInput,
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

const openSettingsListeners = new Set<() => void>();
let pendingOpenSettings = false;

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

const api = {
  app: {
    onOpenSettings,
  },
  runtime: {
    readiness: () => ipcRenderer.invoke('gosu:runtime:readiness'),
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
    snapshot: (projectId: string) =>
      invokeProjectChat<ProjectChatSnapshot>(PROJECT_CHAT_IPC_CHANNELS.snapshot, { projectId }),
    updateProfile: (input: UpdateProjectChatProfileInput) =>
      invokeProjectChat<ProjectChatProfile>(PROJECT_CHAT_IPC_CHANNELS.updateProfile, input),
    send: (input: SendProjectChatMessageInput) =>
      invokeProjectChat<ProjectChatTurnReceipt>(PROJECT_CHAT_IPC_CHANNELS.send, input),
    cancel: (projectId: string) =>
      invokeProjectChat<{ accepted: true }>(PROJECT_CHAT_IPC_CHANNELS.cancel, { projectId }),
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
  vault: {
    choose: () => ipcRenderer.invoke('gosu:vault:choose'),
    read: (relativePath: string) => ipcRenderer.invoke('gosu:vault:read', relativePath),
    readAttachment: (input: ReadVaultAttachmentInput) =>
      ipcRenderer.invoke('gosu:vault:read-attachment', input) as Promise<VaultAttachment>,
  },
  workspace: {
    snapshot: () => invokeWorkspace<WorkspaceSnapshot>(WORKSPACE_IPC_CHANNELS.snapshot),
    pendingSummary: () =>
      invokeWorkspace<WorkspacePendingSummary>(WORKSPACE_IPC_CHANNELS.pendingSummary),
    createProject: (input: CreateProjectInput) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.createProject, input),
    renameProject: (input: RenameProjectInput) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.renameProject, input),
    trashProject: (input: ProjectVersionCommand) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.trashProject, input),
    restoreProject: (input: ProjectVersionCommand) =>
      invokeWorkspace<ProjectRecord>(WORKSPACE_IPC_CHANNELS.restoreProject, input),
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
