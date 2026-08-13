import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import type { ModelCatalog, ModelInvocation } from '@gosu/contracts';
import { createManuscriptWorkspaceAdapterRegistry } from '@gosu/integrations';
import { APP_NAVIGATION_CHANNELS } from '../shared/app-navigation-channels';
import { EXPERIMENT_WORKSPACE_IPC_CHANNELS } from '../shared/experiment-workspace-channels';
import { EXPERIMENT_EVALUATION_IPC_CHANNELS } from '../shared/experiment-evaluation-channels';
import { ExperimentEvaluationEventSchema } from '../shared/experiment-evaluation-contracts';
import { HERMES_ACP_APPROVAL_CHANNELS } from '../shared/hermes-acp-approval-channels';
import { HermesAcpApprovalEventSchema } from '../shared/hermes-acp-approval-contracts';
import { LECTURE_STUDIO_IPC_CHANNELS } from '../shared/lecture-studio-channels';
import { LectureStudioEventSchema } from '../shared/lecture-studio-contracts';
import { PROJECT_CHAT_IPC_CHANNELS } from '../shared/project-chat-channels';
import { SSH_IPC_CHANNELS } from '../shared/ssh-channels';
import { SshEventSchema } from '../shared/ssh-contracts';
import { buildMacApplicationMenuTemplate } from './application-menu';
import { registerAgentAddOnIpc } from './agent-addon-ipc';
import { createAgentAddOnRegistry } from './agent-addon-service';
import { cleanupStaleGosuRuntimeDirectories, CodexAppServer } from './codex-app-server';
import { registerHermesAcpApprovalIpc } from './hermes-acp-approval-ipc';
import { HermesAcpApprovalService } from './hermes-acp-approval-service';
import { HermesAcpProjectChatAdapter } from './hermes-acp-project-chat-adapter';
import { HermesProjectChatAdapter } from './hermes-project-chat-adapter';
import { LocalDatabase } from './local-database';
import { installProcessOutputGuards } from './process-output-guard';
import { registerGitWorkspaceIpc } from './git-workspace-ipc';
import { GitWorkspaceService } from './git-workspace-service';
import { registerManuscriptWorkspaceIpc } from './manuscript-workspace-ipc';
import { ManuscriptWorkspaceService } from './manuscript-workspace-service';
import { ManuscriptPdfCompiler } from './manuscript-pdf-compiler';
import { OverleafGitCredentialStore } from './overleaf-git-credential-store';
import { OverleafGitManuscriptWorkspaceAdapter } from './overleaf-git-manuscript-adapter';
import { OverleafGitTransport } from './overleaf-git-transport';
import { LiteratureAiService } from './literature-ai-service';
import { CrossrefLiteratureProvider } from './literature-crossref';
import { BalancedLiteratureProvider } from './literature-discovery';
import { registerLiteratureIpc } from './literature-ipc';
import { SemanticScholarLiteratureProvider } from './literature-semantic-scholar';
import { LiteratureService } from './literature-service';
import { registerLectureStudioIpc } from './lecture-studio-ipc';
import { LectureStudioService } from './lecture-studio-service';
import { LectureDocumentCompiler } from './lecture-document-compiler';
import { createLiteratureTransferPlatform } from './literature-transfer-platform';
import { registerExperimentRunLogIpc } from './experiment-run-log-ipc';
import { ExperimentRunLogService } from './experiment-run-log-service';
import { LocalExperimentEvaluationArtifacts } from './experiment-evaluation-artifacts';
import { registerExperimentEvaluationIpc } from './experiment-evaluation-ipc';
import { ExperimentEvaluationService } from './experiment-evaluation-service';
import { registerExperimentWorkspaceIpc } from './experiment-workspace-ipc';
import { ExperimentWorkspaceService } from './experiment-workspace-service';
import { registerProjectChatAttachmentIpc } from './project-chat-attachment-ipc';
import { createProjectChatAttachmentPicker } from './project-chat-attachment-platform';
import { ProjectChatAttachmentService } from './project-chat-attachment-service';
import { registerProjectChatIpc } from './project-chat-ipc';
import { ProjectChatService } from './project-chat-service';
import { ProjectChatProviderRouter } from './project-chat-provider-router';
import { ApplicationSearchSource } from './application-search-source';
import { RepositorySearchSource } from './repository-search-source';
import { ProjectTrashLifecycle } from './project-trash-lifecycle';
import { ResearchNotesSearchSource } from './research-notes-search-source';
import { registerResearchNotesIpc } from './research-notes-ipc';
import { ResearchNotesProjectLinkSchema, ResearchNotesService } from './research-notes-service';
import { registerSearchIpc } from './search-ipc';
import { SearchService } from './search-service';
import { createSshCommandRunner } from './ssh-command-runner';
import { SshConnectionService } from './ssh-connection-service';
import { registerSshIpc } from './ssh-ipc';
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
  clientVersion: () => app.getVersion(),
});
const hermesAcpApprovals = new HermesAcpApprovalService();
const hermesRuntimeDiscovery = new HermesProjectChatAdapter();
const hermesProjectChat = new HermesAcpProjectChatAdapter({
  runtimeDiscovery: hermesRuntimeDiscovery,
  approvals: hermesAcpApprovals,
  clientVersion: () => app.getVersion(),
});
const projectChatProvider = new ProjectChatProviderRouter(codex, hermesProjectChat);
const agentAddOns = createAgentAddOnRegistry({}, { hermesProjectChat: projectChatProvider });
const database = new LocalDatabase();
const vault = new VaultAccess({
  loadRoot() {
    const value = database.get('research-notes', 'obsidian-vault-root')?.value;
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as { root?: unknown }).root !== 'string'
    ) {
      return null;
    }
    return (value as { root: string }).root;
  },
  saveRoot(root) {
    database.cache('research-notes', 'obsidian-vault-root', { root });
  },
});
const ssh = new SshConnectionService(database, createSshCommandRunner());
const workspace = new WorkspaceService({
  load: () => database.loadWorkspaceState(),
  commit: (state, operation) => database.commitWorkspaceState(state, operation),
  purgeTrash: (state, operation, receipt) =>
    database.purgeWorkspaceTrash(state, operation, receipt),
  loadTrashPurgeReceipt: (idempotencyKey) =>
    database.loadWorkspaceTrashPurgeReceipt(idempotencyKey),
  pendingChanges: () => database.pendingWorkspaceChanges(),
  pendingSummary: () => database.pendingWorkspaceSummary(),
});
const experimentWorkspace = new ExperimentWorkspaceService({
  storage: database,
  workspace,
});
const experimentRunLogs = new ExperimentRunLogService({
  experiments: experimentWorkspace,
  ssh,
});
const experimentEvaluationArtifacts = new LocalExperimentEvaluationArtifacts(() =>
  join(app.getPath('userData'), 'evaluation-profiles'),
);
const experimentEvaluation = new ExperimentEvaluationService({
  storage: database,
  workspace,
  experiments: experimentWorkspace,
  codex,
  artifacts: experimentEvaluationArtifacts,
  async prepareDirectory(projectId) {
    const directory = join(app.getPath('userData'), 'experiment-evaluation-workspaces', projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  },
});
const gitWorkspace = new GitWorkspaceService({
  workspace,
  rootDirectory: () => join(app.getPath('userData'), 'git-workspaces'),
});
const overleafGitCredentials = new OverleafGitCredentialStore({
  rootDirectory: () => join(app.getPath('userData'), 'credentials', 'overleaf-git'),
  encryption: safeStorage,
});
const overleafGitTransport = new OverleafGitTransport({
  rootDirectory: () => join(app.getPath('userData'), 'manuscript-workspaces'),
  credentials: overleafGitCredentials,
});
const manuscriptPdfCompiler = new ManuscriptPdfCompiler({
  materializer: overleafGitTransport,
  rootDirectory: () => join(app.getPath('userData'), 'manuscript-pdf-previews'),
});
const lectureDocumentCompiler = new LectureDocumentCompiler({
  rootDirectory: () => join(app.getPath('userData'), 'lecture-pdf-previews'),
});
const manuscriptWorkspaceAdapters = createManuscriptWorkspaceAdapterRegistry([
  new OverleafGitManuscriptWorkspaceAdapter(
    database,
    overleafGitTransport,
    () => new Date(),
    overleafGitCredentials,
  ),
]);
const manuscriptWorkspace = new ManuscriptWorkspaceService({
  storage: database,
  workspace,
  repository: {
    revision: (projectId) => gitWorkspace.revision(projectId),
  },
  adapters: manuscriptWorkspaceAdapters,
  overleafGit: overleafGitTransport,
  pdfCompiler: manuscriptPdfCompiler,
  credentials: overleafGitCredentials,
});
const researchNotes = new ResearchNotesService({
  storage: {
    loadProjectLink(projectId) {
      const value = database.get('research-notes-project', projectId)?.value;
      const parsed = ResearchNotesProjectLinkSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
    saveProjectLink(link) {
      database.cache('research-notes-project', link.projectId, link, Date.parse(link.updatedAt));
    },
  },
  literature: database,
  workspace,
  vault,
});
const search = new SearchService({
  workspace,
  application: new ApplicationSearchSource(database),
  researchNotes: new ResearchNotesSearchSource(researchNotes),
  repository: new RepositorySearchSource(gitWorkspace),
});
let mainWindow: BrowserWindow | undefined;
const projectChatAttachments = new ProjectChatAttachmentService({
  chooseFiles: createProjectChatAttachmentPicker(() => mainWindow),
  async validateScope(projectId, sessionId) {
    const snapshot = await projectChat.snapshot({ projectId, sessionId });
    if (snapshot.session?.id !== sessionId) throw new Error('attachment_scope_mismatch');
  },
});
const literature = new LiteratureService({
  storage: database,
  workspace,
  provider: new BalancedLiteratureProvider({
    semanticScholar: new SemanticScholarLiteratureProvider({
      apiKey: process.env.GOSU_SEMANTIC_SCHOLAR_API_KEY?.trim() || undefined,
    }),
    crossref: new CrossrefLiteratureProvider({
      contactEmail: process.env.GOSU_CROSSREF_MAILTO?.trim() || undefined,
      userAgent:
        process.env.GOSU_CROSSREF_USER_AGENT?.trim() ||
        `GOSU/${app.getVersion()} (+https://github.com/gli-minsuk-shin/GOSU)`,
    }),
  }),
  transfer: createLiteratureTransferPlatform(() => mainWindow),
  projection: researchNotes,
});
const projectChat = new ProjectChatService({
  storage: database,
  workspace,
  codex: projectChatProvider,
  hermes: {
    isConnected: () => projectChatProvider.isHermesConnected(),
    delegate: (input) => hermesProjectChat.delegate(input),
  },
  vault: researchNotes,
  literature,
  manuscripts: manuscriptWorkspace,
  ssh,
  experiments: experimentWorkspace,
  attachments: projectChatAttachments,
  async prepareProjectDirectory(projectId) {
    const directory = join(app.getPath('userData'), 'project-chat-workspaces', projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  },
});
const literatureAi = new LiteratureAiService({
  storage: literature,
  codex,
  async prepareDirectory(projectId) {
    const directory = join(app.getPath('userData'), 'literature-ai-workspaces', projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  },
});
const lectureStudio = new LectureStudioService({
  storage: database,
  sources: database,
  manuscripts: manuscriptWorkspace,
  workspace,
  artifacts: researchNotes,
  codex,
  pdfCompiler: lectureDocumentCompiler,
  async prepareDirectory(outputProjectId) {
    const directory = join(app.getPath('userData'), 'lecture-studio-workspaces', outputProjectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  },
});
const projectTrashLifecycle = new ProjectTrashLifecycle(
  projectChat,
  ssh,
  lectureStudio,
  manuscriptWorkspace,
);
let mainWindowRendererLoaded = false;
let pendingSettingsOpen = false;
let pendingSidebarToggle = false;

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

function deliverPendingNavigation(window: BrowserWindow) {
  if (!mainWindowRendererLoaded || mainWindow !== window || window.isDestroyed()) {
    return;
  }
  if (pendingSettingsOpen) {
    pendingSettingsOpen = false;
    window.webContents.send(APP_NAVIGATION_CHANNELS.openSettings);
  }
  if (pendingSidebarToggle) {
    pendingSidebarToggle = false;
    window.webContents.send(APP_NAVIGATION_CHANNELS.toggleSidebar);
  }
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
  mainWindowRendererLoaded = false;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
      mainWindowRendererLoaded = false;
    }
  });
  window.webContents.on('did-start-loading', () => {
    if (mainWindow === window) mainWindowRendererLoaded = false;
  });
  window.webContents.on('did-finish-load', () => {
    if (mainWindow !== window) return;
    mainWindowRendererLoaded = true;
    deliverPendingNavigation(window);
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
  return window;
}

function openSettings(trustedRenderer: TrustedRenderer) {
  pendingSettingsOpen = true;
  const window =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow(trustedRenderer);
  focusMainWindow();
  deliverPendingNavigation(window);
}

function toggleSidebar(trustedRenderer: TrustedRenderer) {
  const window =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow(trustedRenderer);
  focusMainWindow();
  if (!mainWindowRendererLoaded) {
    pendingSidebarToggle = !pendingSidebarToggle;
    return;
  }
  window.webContents.send(APP_NAVIGATION_CHANNELS.toggleSidebar);
}

function installApplicationMenu(trustedRenderer: TrustedRenderer) {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMacApplicationMenuTemplate({
        appName: app.getName(),
        openSettings: () => openSettings(trustedRenderer),
        toggleSidebar: () => toggleSidebar(trustedRenderer),
      }),
    ),
  );
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
    projectChat,
    researchNotes,
    projectTrashLifecycle,
  );
  registerProjectChatIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    projectChat,
    reportUnexpectedWorkspaceError,
  );
  registerProjectChatAttachmentIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    projectChatAttachments,
    reportUnexpectedWorkspaceError,
  );
  registerGitWorkspaceIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    gitWorkspace,
    { reveal: (path) => shell.showItemInFolder(path) },
    reportUnexpectedWorkspaceError,
  );
  registerManuscriptWorkspaceIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    manuscriptWorkspace,
    reportUnexpectedWorkspaceError,
  );
  registerSshIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    ssh,
    reportUnexpectedWorkspaceError,
    workspace,
  );
  registerHermesAcpApprovalIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    hermesAcpApprovals,
  );
  registerLiteratureIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    literature,
    literatureAi,
    reportUnexpectedWorkspaceError,
  );
  registerResearchNotesIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    researchNotes,
    async (projectId) => {
      if (!mainWindow) return Promise.reject(new Error('research_notes_unavailable'));
      await lectureStudio.reconcilePendingArtifacts().catch(() => undefined);
      const selected = await researchNotes.chooseVault({ projectId }, mainWindow);
      if (selected) {
        await lectureStudio.reconcilePendingArtifacts().catch(() => undefined);
        await projectChat.reconcileResearchNoteSaveReceipts().catch(() => undefined);
      }
      return selected;
    },
    reportUnexpectedWorkspaceError,
  );
  registerSearchIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    search,
    reportUnexpectedWorkspaceError,
  );
  registerExperimentWorkspaceIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    experimentWorkspace,
    reportUnexpectedWorkspaceError,
  );
  registerExperimentEvaluationIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    experimentEvaluation,
    reportUnexpectedWorkspaceError,
  );
  registerExperimentRunLogIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    experimentRunLogs,
    reportUnexpectedWorkspaceError,
  );
  registerLectureStudioIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    lectureStudio,
    reportUnexpectedWorkspaceError,
  );
  registerAgentAddOnIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    agentAddOns,
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
    return catalog.models.map((model) => ({
      ...model,
      supportsPersonality: model.metadata?.supportsPersonality === true,
    }));
  });
  handle('gosu:codex:reconnect', async () => {
    let status = (await codex.status()) as { account?: unknown; unavailable?: boolean };
    if (status.unavailable) {
      codex.stop();
      status = (await codex.status()) as { account?: unknown; unavailable?: boolean };
    }
    if (status.unavailable) throw new Error('codex_unavailable');
    const [catalog, collaborationModeCatalog] = await Promise.all([
      codex.listModelCatalog(),
      codex.listCollaborationModeCatalog(),
    ]);
    return {
      authenticated: status.account !== null && status.account !== undefined,
      models: catalog.models.map((model) => ({
        ...model,
        supportsPersonality: model.metadata?.supportsPersonality === true,
      })),
      collaborationModeCatalog,
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
  handle('gosu:external:open', (_event, url) =>
    typeof url === 'string' && url.startsWith('https://')
      ? shell.openExternal(url)
      : Promise.reject(new Error('https_only')),
  );
}

const packagedStartupSmoke =
  app.isPackaged &&
  process.env.GOSU_PACKAGED_STARTUP_SMOKE === '1' &&
  process.argv.includes('--gosu-packaged-startup-smoke');
const primaryInstance = packagedStartupSmoke || app.requestSingleInstanceLock();

if (!primaryInstance) {
  app.quit();
} else {
  if (!packagedStartupSmoke) installLocalSupervisorGuard();
  void app.whenReady().then(async () => {
    app.setName('GOSU');
    if (packagedStartupSmoke) {
      process.stdout.write('GOSU_PACKAGED_STARTUP_READY\n');
      app.quit();
      return;
    }
    setDevelopmentDockIcon();
    await cleanupStaleGosuRuntimeDirectories().catch(() => undefined);
    await overleafGitTransport.reconcileStaleArchives().catch(() => undefined);
    await manuscriptPdfCompiler.reconcileStaleStaging().catch(() => undefined);
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
      const evaluationArtifactReconciliation = await experimentEvaluationArtifacts
        .reconcilePendingProfiles(
          (projectId, profileId) =>
            database.getExperimentEvaluationProfile(projectId, profileId) !== null,
        )
        .catch(() => ({ finalized: 0, removed: 0, failures: 1 }));
      if (evaluationArtifactReconciliation.failures > 0) {
        localData = {
          ready: true,
          detail: 'encrypted_local_data_ready_artifact_reconciliation_incomplete',
        };
      }
      await overleafGitCredentials
        .reconcilePending(database.listManuscriptCredentialReferences('overleaf_git'))
        .catch(() => undefined);
      await manuscriptWorkspace.reconcileArtifactPurgeQueue().catch(() => undefined);
      await lectureDocumentCompiler.reconcileStaleStaging().catch(() => undefined);
      await vault.restore().catch(() => null);
      await lectureStudio.reconcilePendingArtifacts().catch(() => undefined);
      await projectChat.reconcileResearchNoteSaveReceipts().catch(() => undefined);
      await projectChat.reconcileQueuedTurns().catch(() => undefined);
    } catch (error) {
      localData = localDataReadiness(error);
    }
    codex.on('catalog', (catalog: ModelCatalog) => {
      if (!database.isReady()) return;
      database.recordModelCatalog(catalog);
      database.cache('codex', 'model-catalog', catalog, Date.now());
    });
    projectChatProvider.on(
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
    ssh.on('event', (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send(SSH_IPC_CHANNELS.event, SshEventSchema.parse(event));
        } catch {
          console.error('[GOSU] SSH approval renderer event delivery failed.');
        }
      }
    });
    hermesAcpApprovals.on('event', (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send(
            HERMES_ACP_APPROVAL_CHANNELS.event,
            HermesAcpApprovalEventSchema.parse(event),
          );
        } catch {
          console.error('[GOSU] Hermes ACP approval renderer event delivery failed.');
        }
      }
    });
    experimentWorkspace.onEvent((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send(EXPERIMENT_WORKSPACE_IPC_CHANNELS.event, event);
        } catch {
          console.error('[GOSU] Experiment workspace renderer event delivery failed.');
        }
      }
    });
    experimentEvaluation.onEvent((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send(
            EXPERIMENT_EVALUATION_IPC_CHANNELS.event,
            ExperimentEvaluationEventSchema.parse(event),
          );
        } catch {
          console.error('[GOSU] Experiment Evaluation renderer event delivery failed.');
        }
      }
    });
    lectureStudio.onEvent((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send(
            LECTURE_STUDIO_IPC_CHANNELS.event,
            LectureStudioEventSchema.parse(event),
          );
        } catch {
          console.error('[GOSU] Lecture Studio renderer event delivery failed.');
        }
      }
    });
    registerIpc(trustedRenderer, localData);
    createWindow(trustedRenderer);
    installApplicationMenu(trustedRenderer);
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
    manuscriptPdfCompiler.dispose();
    lectureDocumentCompiler.dispose();
    projectChatAttachments.disposeImmediately();
    literature.shutdown();
    ssh.shutdown();
    hermesProjectChat.shutdown();
    codex.stop();
    database.close();
  });
}
