import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import type { ModelCatalog, ModelInvocation } from '@gosu/contracts';
import { PROJECT_CHAT_IPC_CHANNELS } from '../shared/project-chat-channels';
import { CodexAppServer } from './codex-app-server';
import { LocalDatabase } from './local-database';
import { installProcessOutputGuards } from './process-output-guard';
import { registerProjectChatIpc } from './project-chat-ipc';
import { ProjectChatService } from './project-chat-service';
import {
  createTrustedRenderer,
  isTrustedRendererUrl,
  rendererContentSecurityPolicy,
  type TrustedRenderer,
} from './renderer-trust';
import {
  buildRuntimeReadiness,
  checkSyncApiHealth,
  localDataReadiness,
  type ComponentReadiness,
} from './runtime-readiness';
import { VaultAccess } from './vault';
import { registerWorkspaceIpc } from './workspace-ipc';
import { WorkspaceService } from './workspace-service';
import { isSupervisorAlive, parseSupervisorPid } from './supervisor-liveness';

installProcessOutputGuards();

const sharedCodexHome =
  process.env.CODEX_HOME?.trim() ||
  (process.env.HOME ? join(process.env.HOME, '.codex') : undefined);
const codex = new CodexAppServer({
  isolatedCodexHome: () => join(app.getPath('userData'), 'codex-project-chat'),
  sharedAuthFile: () => (sharedCodexHome ? join(sharedCodexHome, 'auth.json') : undefined),
});
const database = new LocalDatabase();
const vault = new VaultAccess();
const workspace = new WorkspaceService({
  load: () => database.loadWorkspaceState(),
  commit: (state, operation) => database.commitWorkspaceState(state, operation),
  pendingChanges: () => database.pendingWorkspaceChanges(),
  pendingSummary: () => database.pendingWorkspaceSummary(),
});
const projectChat = new ProjectChatService({
  storage: database,
  workspace,
  codex,
  async prepareProjectDirectory(projectId) {
    const directory = join(app.getPath('userData'), 'project-chat-workspaces', projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  },
});
let mainWindow: BrowserWindow | undefined;

function setDevelopmentDockIcon() {
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(join(__dirname, '../../build/icon.png'));
  }
}

function reportUnexpectedWorkspaceError(_error: unknown) {
  console.error('[GOSU] Unexpected workspace IPC failure.');
}

function installLocalSupervisorGuard() {
  if (app.isPackaged) return;
  const supervisorPid = parseSupervisorPid(process.env.GOSU_LOCAL_SUPERVISOR_PID);
  if (supervisorPid === null) return;
  const check = () => {
    if (!isSupervisorAlive(supervisorPid)) app.quit();
  };
  const timer = setInterval(check, 1_000);
  timer.unref();
  app.once('before-quit', () => clearInterval(timer));
  check();
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(trustedRenderer: TrustedRenderer) {
  const window = new BrowserWindow({
    width: 1480,
    height: 930,
    minWidth: 1060,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#080a09',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === 'https:') void shell.openExternal(url);
    } catch {
      // Invalid URLs stay inside the denied window-open path.
    }
    return { action: 'deny' };
  });
  const preventUntrustedNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedRendererUrl(url, trustedRenderer)) event.preventDefault();
  };
  window.webContents.on('will-navigate', preventUntrustedNavigation);
  window.webContents.on('will-redirect', preventUntrustedNavigation);
  void window.loadURL(trustedRenderer.entryUrl);
}

function registerIpc(trustedRenderer: TrustedRenderer, localData: ComponentReadiness) {
  const handle = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => {
    ipcMain.handle(channel, (event, ...args) => {
      const senderFrame = event.senderFrame;
      if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        !senderFrame ||
        senderFrame !== mainWindow.webContents.mainFrame ||
        !isTrustedRendererUrl(senderFrame.url, trustedRenderer)
      ) {
        throw new Error('untrusted_ipc_sender');
      }
      return listener(event, ...args);
    });
  };

  registerWorkspaceIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    workspace,
    reportUnexpectedWorkspaceError,
  );
  registerProjectChatIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    projectChat,
    reportUnexpectedWorkspaceError,
  );

  handle('gosu:runtime:readiness', async () =>
    buildRuntimeReadiness({
      app: {
        version: app.getVersion(),
        platform: process.platform,
        packaged: app.isPackaged,
      },
      localData,
      codex: await codex.availability(),
      syncApi: await checkSyncApiHealth(process.env.GOSU_SYNC_API_URL?.trim() || undefined),
    }),
  );
  handle('gosu:codex:status', () => codex.status());
  handle('gosu:codex:list-models', async () => {
    const catalog = await codex.listModelCatalog();
    return catalog.models;
  });
  handle('gosu:codex:reconnect', async () => {
    let status = (await codex.status()) as { account?: unknown; unavailable?: boolean };
    if (status.unavailable) {
      codex.stop();
      status = (await codex.status()) as { account?: unknown; unavailable?: boolean };
    }
    if (status.unavailable) throw new Error('codex_unavailable');
    const catalog = await codex.listModelCatalog();
    return {
      authenticated: status.account !== null && status.account !== undefined,
      models: catalog.models,
    };
  });
  handle('gosu:codex:login-chatgpt', async () => {
    const result = (await codex.loginChatGpt()) as { authUrl?: string };
    if (result.authUrl?.startsWith('https://')) await shell.openExternal(result.authUrl);
    return { started: true };
  });
  handle('gosu:codex:login-api-key', (_event, apiKey) =>
    codex.loginApiKey(typeof apiKey === 'string' ? apiKey : ''),
  );
  handle('gosu:codex:logout', () => codex.logout());
  handle('gosu:vault:choose', () => (mainWindow ? vault.choose(mainWindow) : null));
  handle('gosu:vault:read', (_event, relativePath) =>
    vault.readMarkdown(typeof relativePath === 'string' ? relativePath : ''),
  );
  handle('gosu:external:open', (_event, url) =>
    typeof url === 'string' && url.startsWith('https://')
      ? shell.openExternal(url)
      : Promise.reject(new Error('https_only')),
  );
}

const primaryInstance = app.requestSingleInstanceLock();

if (!primaryInstance) {
  app.quit();
} else {
  installLocalSupervisorGuard();
  void app.whenReady().then(() => {
    app.setName('GOSU');
    setDevelopmentDockIcon();
    const trustedRenderer = createTrustedRenderer({
      developmentUrl: process.env.ELECTRON_RENDERER_URL,
      isPackaged: app.isPackaged,
      productionEntryPath: join(__dirname, '../renderer/index.html'),
    });
    const contentSecurityPolicy = rendererContentSecurityPolicy(trustedRenderer);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [contentSecurityPolicy],
        },
      }),
    );
    let localData = localDataReadiness();
    try {
      database.open();
    } catch (error) {
      localData = localDataReadiness(error);
    }
    codex.on('catalog', (catalog: ModelCatalog) => {
      if (!database.isReady()) return;
      database.recordModelCatalog(catalog);
      database.cache('codex', 'model-catalog', catalog, Date.now());
    });
    codex.on(
      'invocation',
      (event: { threadId: string; turnId: string; invocation: ModelInvocation }) =>
        database.isReady() &&
        database.recordModelInvocation(event.threadId, event.turnId, event.invocation),
    );
    projectChat.on('event', (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send(PROJECT_CHAT_IPC_CHANNELS.event, event);
        } catch {
          console.error('[GOSU] Project chat renderer event delivery failed.');
        }
      }
    });
    registerIpc(trustedRenderer, localData);
    createWindow(trustedRenderer);
    app.on('second-instance', () => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow(trustedRenderer);
      else focusMainWindow();
    });
    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow(trustedRenderer);
      else focusMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    codex.stop();
    database.close();
  });
}
