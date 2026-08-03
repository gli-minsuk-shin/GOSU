import { contextBridge, ipcRenderer } from 'electron';

const api = {
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
  cache: { get: (scope: string, key: string) => ipcRenderer.invoke('gosu:cache:get', scope, key) },
  openExternal: (url: string) => ipcRenderer.invoke('gosu:external:open', url),
};

contextBridge.exposeInMainWorld('gosu', api);
export type GosuDesktopApi = typeof api;
