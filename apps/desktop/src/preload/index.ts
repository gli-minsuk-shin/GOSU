import { contextBridge, ipcRenderer } from 'electron';

import type {
  CreateProjectInput,
  CreateTaskInput,
  ObjectiveCommand,
  ProjectRecord,
  SaveObjectiveInput,
  UpdateTaskInput,
  WorkspaceObjective,
  WorkspacePendingSummary,
  WorkspaceSnapshot,
  WorkspaceTask,
} from '../shared/workspace-contracts';
import { WORKSPACE_IPC_CHANNELS } from '../shared/workspace-channels';

const api = {
  runtime: {
    readiness: () => ipcRenderer.invoke('gosu:runtime:readiness'),
  },
  codex: {
    status: () => ipcRenderer.invoke('gosu:codex:status'),
    listModels: () => ipcRenderer.invoke('gosu:codex:list-models'),
    loginChatGpt: () => ipcRenderer.invoke('gosu:codex:login-chatgpt'),
    loginApiKey: (apiKey: string) => ipcRenderer.invoke('gosu:codex:login-api-key', apiKey),
    logout: () => ipcRenderer.invoke('gosu:codex:logout'),
  },
  vault: {
    choose: () => ipcRenderer.invoke('gosu:vault:choose'),
    read: (relativePath: string) => ipcRenderer.invoke('gosu:vault:read', relativePath),
  },
  workspace: {
    snapshot: () =>
      ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.snapshot) as Promise<WorkspaceSnapshot>,
    pendingSummary: () =>
      ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.pendingSummary) as Promise<WorkspacePendingSummary>,
    createProject: (input: CreateProjectInput) =>
      ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.createProject, input) as Promise<ProjectRecord>,
    createTask: (input: CreateTaskInput) =>
      ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.createTask, input) as Promise<WorkspaceTask>,
    updateTask: (input: UpdateTaskInput) =>
      ipcRenderer.invoke(WORKSPACE_IPC_CHANNELS.updateTask, input) as Promise<WorkspaceTask>,
    saveObjective: (input: SaveObjectiveInput) =>
      ipcRenderer.invoke(
        WORKSPACE_IPC_CHANNELS.saveObjective,
        input,
      ) as Promise<WorkspaceObjective>,
    lockObjective: (input: ObjectiveCommand) =>
      ipcRenderer.invoke(
        WORKSPACE_IPC_CHANNELS.lockObjective,
        input,
      ) as Promise<WorkspaceObjective>,
    startObjectiveVersion: (input: ObjectiveCommand) =>
      ipcRenderer.invoke(
        WORKSPACE_IPC_CHANNELS.startObjectiveVersion,
        input,
      ) as Promise<WorkspaceObjective>,
  },
  openExternal: (url: string) => ipcRenderer.invoke('gosu:external:open', url),
};

contextBridge.exposeInMainWorld('gosu', api);
export type GosuDesktopApi = typeof api;
