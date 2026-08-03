import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import type { ModelInvocation } from '@gosu/contracts';
import { CodexAppServer } from './codex-app-server';
import { LocalDatabase } from './local-database';
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

const codex = new CodexAppServer();
const database = new LocalDatabase();
const vault = new VaultAccess();
let mainWindow: BrowserWindow | undefined;

function createWindow(trustedRenderer: TrustedRenderer) {
  mainWindow = new BrowserWindow({
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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
  mainWindow.webContents.on('will-navigate', preventUntrustedNavigation);
  mainWindow.webContents.on('will-redirect', preventUntrustedNavigation);
  void mainWindow.loadURL(trustedRenderer.entryUrl);
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
    if (database.isReady()) {
      database.recordModelCatalog(catalog);
      database.cache('codex', 'model-catalog', catalog, Date.now());
    }
    return catalog.models;
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
  handle('gosu:cache:get', (_event, scope, key) => database.get(String(scope), String(key)));
  handle('gosu:external:open', (_event, url) =>
    typeof url === 'string' && url.startsWith('https://')
      ? shell.openExternal(url)
      : Promise.reject(new Error('https_only')),
  );
}

app.whenReady().then(() => {
  app.setName('GOSU');
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
  codex.on(
    'invocation',
    (event: { threadId: string; turnId: string; invocation: ModelInvocation }) =>
      database.isReady() &&
      database.recordModelInvocation(event.threadId, event.turnId, event.invocation),
  );
  registerIpc(trustedRenderer, localData);
  createWindow(trustedRenderer);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(trustedRenderer);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  codex.stop();
  database.close();
});
