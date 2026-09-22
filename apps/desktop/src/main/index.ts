import { access, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openLocalDatabaseWithWrappedKey } from './local-database-key';
import { PromptFreeSecretSealing } from './local-secret-sealing';
import { systemBriefingKey } from '../../../briefing-lab/briefing-system-key';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  APPLICATION_LANGUAGE_CHANNELS,
  DEFAULT_APP_LANGUAGE,
  type ModelCatalog,
  type ModelInvocation,
} from '@gosu/contracts';
import {
  ApplicationLanguageService,
  applicationLanguageContext,
  configureApplicationLanguageService,
} from './application-language-service';
import { createManuscriptWorkspaceAdapterRegistry } from '@gosu/integrations';
import { resolveGosuCodexHome } from '@gosu/integrations/codex-runtime-discovery';
import { APP_NAVIGATION_CHANNELS } from '../shared/app-navigation-channels';
import {
  CODEX_AUTH_IPC_CHANNELS,
  CodexAuthenticationEventSchema,
} from '../shared/codex-auth-channels';
import { EXPERIMENT_WORKSPACE_IPC_CHANNELS } from '../shared/experiment-workspace-channels';
import { EXPERIMENT_EVALUATION_IPC_CHANNELS } from '../shared/experiment-evaluation-channels';
import { ExperimentEvaluationEventSchema } from '../shared/experiment-evaluation-contracts';
import { HERMES_ACP_APPROVAL_CHANNELS } from '../shared/hermes-acp-approval-channels';
import { HermesAcpApprovalEventSchema } from '../shared/hermes-acp-approval-contracts';
import { LECTURE_STUDIO_IPC_CHANNELS } from '../shared/lecture-studio-channels';
import { LectureStudioEventSchema } from '../shared/lecture-studio-contracts';
import { PROJECT_CHAT_IPC_CHANNELS } from '../shared/project-chat-channels';
import { MODEL_LAB_OPEN_CHANNEL, OpenProjectModelLabSchema } from '../shared/model-lab-contracts';
import { ModelLabDesktopHost } from '../../../model-lab/model-lab-desktop-host';
import { createModelCopilotMiddleware } from '../../../model-lab/model-copilot-server';
import { modelLabBackendContext } from '../../../model-lab/model-lab-backend-context';
import { SSH_IPC_CHANNELS } from '../shared/ssh-channels';
import { SshEventSchema } from '../shared/ssh-contracts';
import {
  buildMacApplicationMenuTemplate,
  macApplicationMenuLabelChanges,
} from './application-menu';
import { registerAgentAddOnIpc } from './agent-addon-ipc';
import { createAgentAddOnRegistry } from './agent-addon-service';
import { ClaudeCodeLoginService, createNodeClaudeCodeLoginPlatform } from './claude-code-login';
import { ClaudeCodeProjectChatAdapter } from './claude-code-project-chat-adapter';
import {
  cleanupStaleGosuRuntimeDirectories,
  CodexAppServer,
  toCodexCollaborationModeCatalog,
} from './codex-app-server';
import { registerHermesAcpApprovalIpc } from './hermes-acp-approval-ipc';
import { HermesAcpApprovalService } from './hermes-acp-approval-service';
import { HermesAcpProjectChatAdapter } from './hermes-acp-project-chat-adapter';
import {
  createNodeHermesProjectChatPlatform,
  HermesProjectChatAdapter,
} from './hermes-project-chat-adapter';
import { LocalDatabase } from './local-database';
import { ModelPriceCatalogStore } from './model-price-catalog';
import { registerModelUsageIpc } from './model-usage-ipc';
import { registerUsageLimitIpc } from './usage-limit-ipc';
import { fullDiskAccessState } from './full-disk-access';
import {
  FULL_DISK_ACCESS_CHANNEL,
  FULL_DISK_ACCESS_SETTINGS_URL,
} from '../shared/full-disk-access';
import { UsageLimitService } from './usage-limit-service';
import { ClaudeUsageProbe } from './claude-usage-probe';
import { USAGE_LIMIT_IPC_CHANNELS } from '../shared/usage-limit-contracts';
import { ModelUsageService } from './model-usage-service';
import { installProcessOutputGuards } from './process-output-guard';
import { registerGitWorkspaceIpc } from './git-workspace-ipc';
import { GitWorkspaceService } from './git-workspace-service';
import { registerManuscriptWorkspaceIpc } from './manuscript-workspace-ipc';
import { ManuscriptWorkspaceService } from './manuscript-workspace-service';
import { createManuscriptPdfArtifactPlatform } from './manuscript-pdf-artifact-platform';
import { ManuscriptPdfCompiler } from './manuscript-pdf-compiler';
import { OverleafGitCredentialStore } from './overleaf-git-credential-store';
import { OverleafGitManuscriptWorkspaceAdapter } from './overleaf-git-manuscript-adapter';
import { registerOverleafPersonalTokenIpc } from './overleaf-personal-token-ipc';
import { OverleafPersonalTokenService } from './overleaf-personal-token-service';
import { OverleafGitTransport } from './overleaf-git-transport';
import { LiteratureAiService } from './literature-ai-service';
import { CrossrefLiteratureProvider } from './literature-crossref';
import { BalancedLiteratureProvider } from './literature-discovery';
import { registerLiteratureIpc } from './literature-ipc';
import { SemanticScholarLiteratureProvider } from './literature-semantic-scholar';
import { LiteratureService } from './literature-service';
import { registerLectureStudioIpc } from './lecture-studio-ipc';
import { createLectureArtifactPlatform } from './lecture-artifact-platform';
import { LectureStudioService } from './lecture-studio-service';
import { LectureStudioAttachmentService } from './lecture-studio-attachment-service';
import { LectureStudioFigureService } from './lecture-studio-figure-service';
import { LectureDocumentCompiler } from './lecture-document-compiler';
import {
  LectureExternalSourceManifestAuthenticator,
  LectureExternalSourceService,
} from './lecture-external-source-service';
import { LectureOverleafSourceService } from './lecture-overleaf-source-service';
import { createLiteratureTransferPlatform } from './literature-transfer-platform';
import { registerExperimentRunLogIpc } from './experiment-run-log-ipc';
import { ExperimentRunLogService } from './experiment-run-log-service';
import { LocalExperimentEvaluationArtifacts } from './experiment-evaluation-artifacts';
import { registerExperimentEvaluationIpc } from './experiment-evaluation-ipc';
import { ExperimentEvaluationService } from './experiment-evaluation-service';
import { ProjectResearchPlanService } from './project-research-plan-service';
import { registerExperimentWorkspaceIpc } from './experiment-workspace-ipc';
import { ExperimentWorkspaceService } from './experiment-workspace-service';
import { registerProjectChatAttachmentIpc } from './project-chat-attachment-ipc';
import { ReserveBriefingDropSchema } from '../shared/project-chat-attachment-contracts';
import { compactProjectConversation } from '../../../briefing-lab/briefing-compaction';
import { createProjectChatAttachmentPicker } from './project-chat-attachment-platform';
import { ProjectChatAttachmentService } from './project-chat-attachment-service';
import { registerProjectChatIpc } from './project-chat-ipc';
import { registerPaperSummaryIpc } from './paper-summary-ipc';
import { SharedPaperSummaryLibrary } from '../../../briefing-lab/paper-summary-library';
import { BriefingDesktopHost } from '../../../briefing-lab/briefing-desktop-host';
import { createBriefingHostConsent } from './briefing-host-consent';
import { createGlobalAssistantProjects } from './global-assistant-projects';
import { createGlobalAssistantWorkspace } from './global-assistant-workspace';
import { ModelRoutingStore } from './model-routing-store';
import { ApprovalPolicyStore } from './approval-policy-store';
import { AssistantShortcutStore } from './assistant-shortcut-store';
import { AppShortcutStore } from './app-shortcut-store';
import { installAppShortcutInput, installAssistantShortcutInput } from './assistant-shortcut-input';
import {
  AppShortcutsSchema,
  DEFAULT_APP_SHORTCUTS,
  appShortcutOwner,
  type AppShortcutTarget,
} from '../shared/app-shortcuts';
import { trackMainRendererReadiness } from './renderer-navigation-ready';
import { DEFAULT_ASSISTANT_SHORTCUT } from '../shared/assistant-shortcut';
import { NativeUsageLedger } from './native-usage-ledger';
import { configureNativeUsageObserver } from '../../../briefing-lab/native-usage-observer';
import { APPROVAL_POLICY_CHANNELS } from '../shared/approval-policy';
import { MODEL_ROUTING_CHANNELS } from '@gosu/contracts';
import { briefingTodoSnapshot } from './briefing-todo-adapter';
import { DesktopBriefingTaskActions } from './briefing-task-actions';
import { BRIEFING_LAB_OPEN_CHANNEL } from '../shared/briefing-lab-contracts';
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
import { DAILY_QUOTE_CHANNELS } from '../shared/daily-quote-contracts';
import { dailyQuoteGenerator } from './daily-quote-generator';
import { DailyQuoteService } from './daily-quote-service';
import { registerSshAgentNotesIpc } from './ssh-agent-notes-ipc';
import { SshAgentNotesStore } from './ssh-agent-notes-store';
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

let refreshApplicationMenu: (() => void) | undefined;
const applicationLanguage = new ApplicationLanguageService(
  () => join(app.getPath('userData'), 'application-language.json'),
  (preference) => {
    try {
      refreshApplicationMenu?.();
    } finally {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(APPLICATION_LANGUAGE_CHANNELS.changed, preference);
    }
  },
);
configureApplicationLanguageService(applicationLanguage);

const codex = new CodexAppServer({
  isolatedCodexHome: () => resolveGosuCodexHome({ userDataDirectory: app.getPath('userData') }),
  clientVersion: () => app.getVersion(),
});
const hermesAcpApprovals = new HermesAcpApprovalService();
const hermesRuntimeDiscovery = new HermesProjectChatAdapter(
  createNodeHermesProjectChatPlatform({
    bundledRuntimeDirectory: app.isPackaged
      ? null
      : join(app.getAppPath(), '.runtime', 'hermes-runtime'),
    bundledRuntimeArchivePath: app.isPackaged
      ? join(process.resourcesPath, 'hermes-runtime.zip')
      : null,
    bundledRuntimeCacheDirectory: app.isPackaged
      ? join(app.getPath('userData'), 'hermes-runtime-cache')
      : null,
    // A release build is hermetic: it never searches PATH or a user's mutable Hermes checkout.
    // Local fallback remains available only for development while the signed bundle is prepared.
    allowCustomLocalRuntime: !app.isPackaged,
  }),
);
const hermesProjectChat = new HermesAcpProjectChatAdapter({
  runtimeDiscovery: hermesRuntimeDiscovery,
  approvals: hermesAcpApprovals,
  clientVersion: () => app.getVersion(),
});
const claudeCodeProjectChat = new ClaudeCodeProjectChatAdapter();
const claudeCodeLogin = new ClaudeCodeLoginService(
  createNodeClaudeCodeLoginPlatform((url) => shell.openExternal(url)),
);
const projectChatProvider = new ProjectChatProviderRouter(
  codex,
  hermesProjectChat,
  claudeCodeProjectChat,
);
const agentAddOns = createAgentAddOnRegistry(
  {},
  {
    claudeCodeProjectChat: projectChatProvider,
  },
  ['claude-code'],
);
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
let approvalPolicyStore: ApprovalPolicyStore | undefined;
let assistantShortcutStore: AssistantShortcutStore | undefined;
let appShortcutStore: AppShortcutStore | undefined;
let pendingAssistantOpen = false;
let pendingSurfaceOpen: AppShortcutTarget | null = null;
const ssh = new SshConnectionService(database, createSshCommandRunner(), {
  reuseApprovedScopes: (id) => approvalPolicyStore?.enabled(id) ?? false,
  revokeReusedScope: async (id) => {
    if (!approvalPolicyStore) throw new Error('approval_policy_unavailable');
    await approvalPolicyStore.revokeScope(id);
  },
});
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
let nativeUsageLedger: NativeUsageLedger | undefined;
const modelUsage = new ModelUsageService(database, workspace, async () =>
  nativeUsageLedger ? nativeUsageLedger.rows() : [],
);
// Public API prices for the Usage view's "what an API key would have cost" estimate.
const modelPrices = new ModelPriceCatalogStore(app.getPath('userData'));
// Remaining plan limits of the connected CLIs, for the title bar and the Usage screen. Each CLI is
// asked with its own login (Codex: app-server account limits, Claude Code: the usage control
// request); GOSU reads no credential and sends no model request for this.
const claudeUsageProbe = new ClaudeUsageProbe();
const usageLimits = new UsageLimitService(
  app.getPath('userData'),
  {
    codex: { read: () => codex.rateLimits() },
    claude: {
      connected: () => projectChatProvider.isClaudeCodeConnected(),
      read: (keepAlive) => claudeUsageProbe.read({ keepAlive }),
      close: () => claudeUsageProbe.close(),
    },
  },
  (status) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.webContents.send(USAGE_LIMIT_IPC_CHANNELS.changed, status);
    } catch {
      console.error('[GOSU] Usage limit renderer event delivery failed.');
    }
  },
);
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
  usage: modelUsage,
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
let mainWindow: BrowserWindow | undefined;
// Overleaf tokens and the lecture manifest key were read through safeStorage when the renderer
// loaded, which asked for the login password at every launch (local-secret-sealing.ts).
const localSecrets = new PromptFreeSecretSealing(safeStorage);
const overleafGitCredentials = new OverleafGitCredentialStore({
  rootDirectory: () => join(app.getPath('userData'), 'credentials', 'overleaf-git'),
  encryption: localSecrets,
});
const overleafPersonalToken = new OverleafPersonalTokenService(overleafGitCredentials);
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
  pdfArtifacts: createManuscriptPdfArtifactPlatform(
    () => mainWindow,
    () => join(app.getPath('userData'), 'manuscript-pdf-artifacts'),
  ),
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
const projectChatAttachments = new ProjectChatAttachmentService({
  chooseFiles: createProjectChatAttachmentPicker(() => mainWindow),
  async validateScope(projectId, sessionId) {
    const snapshot = await projectChat.snapshot({ projectId, sessionId });
    if (snapshot.session?.id !== sessionId) throw new Error('attachment_scope_mismatch');
  },
});
const briefingChatAttachments = new ProjectChatAttachmentService({
  chooseFiles: createProjectChatAttachmentPicker(() => mainWindow),
  async validateScope(projectId) {
    if (projectId !== 'b13f1000-0000-4000-8000-000000000001')
      throw new Error('attachment_scope_mismatch');
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
const researchPlans = new ProjectResearchPlanService({
  workspace,
  storage: database,
  onCommitted: (receipt) => {
    experimentWorkspace.notifyResearchPlanCommitted(
      receipt.projectId,
      receipt.loggingTemplateId,
      receipt.createdAt,
    );
    experimentEvaluation.notifyResearchPlanCommitted(
      receipt.projectId,
      receipt.evaluationSessionId,
      receipt.evaluationRevisionId,
      receipt.createdAt,
    );
  },
});
const projectChat = new ProjectChatService({
  modelLab: async (projectId, input) => {
    if (!modelLabHost) throw new Error('model_lab_host_unavailable');
    return modelLabHost.readForChat(projectId, input);
  },
  modelLabWrite: async (projectId, input) => {
    if (!modelLabHost) throw new Error('model_lab_host_unavailable');
    return modelLabHost.addModelForChat(projectId, { ...input, origin: 'project-chat' });
  },
  // Calendar, mail, saved briefings and paper summaries, under the Briefing Lab settings only.
  briefingReads: async () => (briefingLabHost ? await briefingLabHost.reads() : null),
  researchPlans,
  compactHistory: async (model, messages, summary, signal, onUsage) => {
    return compactProjectConversation(
      model,
      messages,
      summary,
      signal,
      modelRoutingStore ? await modelRoutingStore.get() : undefined,
      onUsage,
    );
  },
  storage: database,
  workspace,
  codex: projectChatProvider,
  vault: researchNotes,
  literature,
  manuscripts: manuscriptWorkspace,
  ssh,
  // The store is created once the app is ready; before that there are no notes to hand over.
  sshAgentNotes: {
    async get() {
      const notes = sshAgentNotesStore ? (await sshAgentNotesStore.get()).notes : {};
      return Object.fromEntries(Object.entries(notes).map(([id, note]) => [id, note.text]));
    },
  },
  experiments: experimentWorkspace,
  attachments: projectChatAttachments,
  usage: modelUsage,
  async prepareProjectDirectory(projectId) {
    const directory = join(app.getPath('userData'), 'project-chat-workspaces', projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  },
});
const literatureAi = new LiteratureAiService({
  storage: literature,
  codex,
  usage: modelUsage,
  async prepareDirectory(projectId) {
    const directory = join(app.getPath('userData'), 'literature-ai-workspaces', projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  },
});
const lectureExternalSourceRoot = () => join(app.getPath('userData'), 'lecture-external-sources');
const lectureExternalSources = new LectureExternalSourceService({
  rootDirectory: lectureExternalSourceRoot,
  async chooseFiles() {
    const options: Electron.OpenDialogOptions = {
      title: 'Add sources to Lecture Studio',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Lecture sources', extensions: ['tex', 'md', 'markdown', 'pdf'] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  },
  async validateProject(projectId) {
    const project = (await workspace.snapshot()).projects.find(({ id }) => id === projectId);
    if (!project || project.archivedAt || project.trashedAt) throw new Error('project_not_found');
  },
  manifestAuthenticator: new LectureExternalSourceManifestAuthenticator({
    rootDirectory: lectureExternalSourceRoot,
    encryption: localSecrets,
  }),
});
const lectureOverleafSources = new LectureOverleafSourceService(manuscriptWorkspace);
const lectureStudioAttachments = new LectureStudioAttachmentService({
  externalSources: lectureExternalSources,
  getStudio: (studioId) => database.getLectureStudio(studioId),
});
const lectureStudioFigures = new LectureStudioFigureService({
  storage: database,
  async chooseFiles() {
    const options: Electron.OpenDialogOptions = {
      title: 'Add figures to Lecture Studio',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp', 'avif'],
        },
      ],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  },
  temporaryRoot: () => app.getPath('temp'),
});
const lectureStudio = new LectureStudioService({
  storage: database,
  sources: database,
  manuscripts: manuscriptWorkspace,
  externalSources: lectureExternalSources,
  attachments: lectureStudioAttachments,
  figures: lectureStudioFigures,
  workspace,
  artifacts: researchNotes,
  // The router sends Codex models to Codex and connected Claude Code models to Claude Code.
  codex: projectChatProvider,
  usage: modelUsage,
  pdfCompiler: lectureDocumentCompiler,
  artifactPlatform: createLectureArtifactPlatform(
    () => mainWindow,
    () => join(app.getPath('userData'), 'lecture-artifact-open-cache'),
  ),
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
  if (pendingAssistantOpen) {
    pendingAssistantOpen = false;
    window.webContents.send(APP_NAVIGATION_CHANNELS.openAssistant);
  }
  if (pendingSurfaceOpen) {
    const target = pendingSurfaceOpen;
    pendingSurfaceOpen = null;
    window.webContents.send(APP_NAVIGATION_CHANNELS.openSurface, target);
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
      // Hiding/minimizing the app must not suspend retained chat streams and progress delivery.
      backgroundThrottling: false,
    },
  });
  mainWindow = window;
  mainWindowRendererLoaded = false;
  const removeRendererReadiness = trackMainRendererReadiness(window.webContents, (ready) => {
    if (mainWindow !== window) return;
    mainWindowRendererLoaded = ready;
    if (ready) deliverPendingNavigation(window);
  });
  const removeAssistantShortcut = installAssistantShortcutInput(
    window.webContents,
    () => assistantShortcutStore?.get() ?? DEFAULT_ASSISTANT_SHORTCUT,
    () => {
      pendingAssistantOpen = true;
      focusMainWindow();
      deliverPendingNavigation(window);
    },
  );
  const removeAppShortcuts = installAppShortcutInput(
    window.webContents,
    () => appShortcutStore?.get() ?? DEFAULT_APP_SHORTCUTS,
    (target) => {
      pendingSurfaceOpen = target;
      focusMainWindow();
      deliverPendingNavigation(window);
    },
  );
  // Limits are refreshed only while the window can be seen; showing it again refreshes at once.
  const limitsVisible = () => usageLimits.setActive(window.isVisible() && !window.isMinimized());
  for (const event of ['show', 'hide', 'minimize', 'restore'] as const)
    window.on(event as 'show', limitsVisible);
  window.on('closed', () => {
    removeAssistantShortcut();
    removeAppShortcuts();
    removeRendererReadiness();
    if (mainWindow === window) {
      mainWindow = undefined;
      mainWindowRendererLoaded = false;
    }
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
  let installedLanguage: string | undefined;
  refreshApplicationMenu = () => {
    let language = DEFAULT_APP_LANGUAGE;
    try {
      language = applicationLanguage.get().language;
    } catch {
      /* Keep Settings reachable so the user can repair an invalid preference. */
    }
    const menuKey = `${language}:${assistantShortcutStore?.get()}:${JSON.stringify(appShortcutStore?.get())}`;
    if (installedLanguage === menuKey) return;
    const menu = Menu.buildFromTemplate(
      buildMacApplicationMenuTemplate({
        appName: app.getName(),
        language,
        openSettings: () => openSettings(trustedRenderer),
        toggleSidebar: () => toggleSidebar(trustedRenderer),
        ...(assistantShortcutStore ? { assistantShortcut: assistantShortcutStore.get() } : {}),
        openAssistant: () => {
          pendingAssistantOpen = true;
          const window =
            mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow(trustedRenderer);
          focusMainWindow();
          deliverPendingNavigation(window);
        },
        appShortcuts: appShortcutStore?.get() ?? DEFAULT_APP_SHORTCUTS,
        openSurface: (target) => {
          pendingSurfaceOpen = target;
          const window =
            mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow(trustedRenderer);
          focusMainWindow();
          deliverPendingNavigation(window);
        },
      }),
    );
    for (const change of macApplicationMenuLabelChanges(menu.items, language, app.getName()))
      change.item.label = change.label;
    Menu.setApplicationMenu(menu);
    installedLanguage = menuKey;
  };
  refreshApplicationMenu();
}

let modelLabHost: ModelLabDesktopHost | undefined;
let briefingLabHost: BriefingDesktopHost | undefined;
let modelRoutingStore: ModelRoutingStore | undefined;
let sshAgentNotesStore: SshAgentNotesStore | undefined;
let dailyQuotes: DailyQuoteService | undefined;

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
      if (
        channel === APPLICATION_LANGUAGE_CHANNELS.get ||
        channel === APPLICATION_LANGUAGE_CHANNELS.set
      )
        return listener(event, ...args);
      return applicationLanguageContext.run(applicationLanguage.get(), () =>
        listener(event, ...args),
      );
    });
  };

  handle(APPLICATION_LANGUAGE_CHANNELS.get, () => {
    const preference = applicationLanguage.get();
    refreshApplicationMenu?.();
    return preference;
  });
  handle(APPLICATION_LANGUAGE_CHANNELS.set, (_event, value) => applicationLanguage.set(value));
  handle(MODEL_LAB_OPEN_CHANNEL, async (_event, input) => {
    const { projectId } = OpenProjectModelLabSchema.parse(input);
    if (!modelLabHost) throw new Error('model_lab_host_unavailable');
    return modelLabHost.open(projectId);
  });
  handle(BRIEFING_LAB_OPEN_CHANNEL, async () => {
    if (!briefingLabHost) throw new Error('briefing_host_unavailable');
    return briefingLabHost.open();
  });
  handle('briefing-lab:notifications', async () => {
    if (!briefingLabHost) throw new Error('briefing_host_unavailable');
    return briefingLabHost.notifications();
  });
  handle(MODEL_ROUTING_CHANNELS.get, () => {
    if (!modelRoutingStore) throw new Error('model_routing_unavailable');
    return modelRoutingStore.get();
  });
  handle(APPROVAL_POLICY_CHANNELS.get, () => {
    if (!approvalPolicyStore) throw new Error('approval_policy_unavailable');
    return approvalPolicyStore.get();
  });
  handle(APP_NAVIGATION_CHANNELS.getAssistantShortcut, () => {
    if (!assistantShortcutStore) throw new Error('shortcut_unavailable');
    return assistantShortcutStore.get();
  });
  handle(APP_NAVIGATION_CHANNELS.setAssistantShortcut, async (_event, value) => {
    if (!assistantShortcutStore) throw new Error('shortcut_unavailable');
    // One chord opens one screen: the assistant cannot take a chord a screen already uses.
    if (
      typeof value === 'string' &&
      appShortcutOwner(value, appShortcutStore?.get() ?? DEFAULT_APP_SHORTCUTS, '', 'assistant')
    ) {
      throw new Error('shortcut_in_use');
    }
    const saved = await assistantShortcutStore.set(value);
    refreshApplicationMenu?.();
    return saved;
  });
  handle(APP_NAVIGATION_CHANNELS.getAppShortcuts, () => {
    if (!appShortcutStore) throw new Error('shortcut_unavailable');
    return appShortcutStore.get();
  });
  handle(APP_NAVIGATION_CHANNELS.setAppShortcuts, async (_event, value) => {
    if (!appShortcutStore || !assistantShortcutStore) throw new Error('shortcut_unavailable');
    const next = AppShortcutsSchema.parse(value);
    if (Object.values(next).includes(assistantShortcutStore.get())) {
      throw new Error('shortcut_in_use');
    }
    const saved = await appShortcutStore.set(next);
    refreshApplicationMenu?.();
    return saved;
  });
  handle(APPROVAL_POLICY_CHANNELS.set, (_event, value) => {
    if (!approvalPolicyStore) throw new Error('approval_policy_unavailable');
    return approvalPolicyStore.set(value);
  });
  handle(MODEL_ROUTING_CHANNELS.set, (_event, value) => {
    if (!modelRoutingStore) throw new Error('model_routing_unavailable');
    return modelRoutingStore.set(value);
  });
  handle('briefing-lab:open-privacy', async (_event, kind) => {
    if (kind !== 'automation' && kind !== 'calendar' && kind !== 'full-disk')
      throw new Error('invalid_privacy_target');
    await shell.openExternal(
      kind === 'automation'
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'
        : kind === 'calendar'
          ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'
          : FULL_DISK_ACCESS_SETTINGS_URL,
    );
  });
  // Whether the fast Apple Mail read can work. GOSU cannot grant this; it only notices and guides.
  handle(FULL_DISK_ACCESS_CHANNEL, () => fullDiskAccessState());
  handle('briefing-lab:reserve-drop', (_event, input) => {
    const parsed = ReserveBriefingDropSchema.parse(input);
    return briefingChatAttachments.reserveDrop(parsed.routineId, parsed.paths);
  });
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
  registerPaperSummaryIpc(
    (channel, listener) => handle(channel, (_event, input) => listener(input)),
    new SharedPaperSummaryLibrary(undefined, undefined, undefined, () => modelRoutingStore!.get()),
    literature,
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
  registerOverleafPersonalTokenIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    overleafPersonalToken,
    reportUnexpectedWorkspaceError,
  );
  registerSshIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    ssh,
    reportUnexpectedWorkspaceError,
    workspace,
  );
  // Never throws: the title bar always gets a line, with the reason when it is not the model's.
  handle(DAILY_QUOTE_CHANNELS.get, async () => {
    if (!dailyQuotes) throw new Error('daily_quote_unavailable');
    return dailyQuotes.today();
  });
  // One more line because the reader asked. Bounded by the day's allowance inside the service.
  handle(DAILY_QUOTE_CHANNELS.refresh, async () => {
    if (!dailyQuotes) throw new Error('daily_quote_unavailable');
    return dailyQuotes.refresh();
  });
  handle(DAILY_QUOTE_CHANNELS.history, async () => {
    if (!dailyQuotes) throw new Error('daily_quote_unavailable');
    return dailyQuotes.history();
  });
  registerSshAgentNotesIpc(
    (channel, listener) => handle(channel, (_event, input) => listener(input)),
    () => sshAgentNotesStore,
    async () => (await ssh.listConnections()).map(({ id }) => id),
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
    lectureExternalSources,
    lectureOverleafSources,
    lectureStudioAttachments,
    lectureStudioFigures,
    reportUnexpectedWorkspaceError,
  );
  registerAgentAddOnIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    agentAddOns,
  );
  handle('gosu:claude-code:login', () => claudeCodeLogin.login());
  handle('gosu:claude-code:cancel-login', () => claudeCodeLogin.cancel());
  handle('gosu:claude-code:submit-login-code', (_event, code) => claudeCodeLogin.submitCode(code));
  handle('gosu:claude-code:open-login-page', () => claudeCodeLogin.openSignInPage());
  registerModelUsageIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    modelUsage,
    modelPrices,
  );
  modelPrices.start();
  registerUsageLimitIpc(
    (channel, listener) => handle(channel, (_event, ...arguments_) => listener(...arguments_)),
    usageLimits,
  );
  void usageLimits
    .load()
    .catch(() =>
      console.error('[GOSU] Usage limit settings could not be read; using the defaults.'),
    )
    .then(() => usageLimits.start());

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
  handle('gosu:codex:status', async () => {
    const status = await codex.status();
    modelUsage.observeCodexAccount(status);
    return status;
  });
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
    modelUsage.observeCodexAccount(status);
    if (status.account === null || status.account === undefined) {
      return {
        authenticated: false,
        models: [],
        collaborationModeCatalog: toCodexCollaborationModeCatalog([]),
      };
    }
    const [catalog, collaborationModeCatalog] = await Promise.all([
      codex.listModelCatalog(),
      codex.listCollaborationModeCatalog(),
    ]);
    return {
      authenticated: true,
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
      await access(join(__dirname, '../model-lab/index.html'));
      await access(join(__dirname, '../briefing-lab/index.html'));
      await access(join(process.resourcesPath, 'model-lab/python-architecture-analyzer.py'));
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
    process.env.GOSU_MODEL_LAB_PYTHON_ANALYZER = app.isPackaged
      ? join(process.resourcesPath, 'model-lab', 'python-architecture-analyzer.py')
      : join(__dirname, 'python-architecture-analyzer.py');
    modelLabHost = new ModelLabDesktopHost({
      assetsDirectory: join(__dirname, '../model-lab'),
      stateDirectory: join(app.getPath('userData'), 'model-lab', 'projects'),
      listProjects: async () =>
        (await workspace.snapshot()).projects
          .filter((project) => !project.trashedAt && !project.archivedAt)
          .map(({ id, name }) => ({ id, name })),
      resolveProject: async (projectId) => {
        const project = (await workspace.snapshot()).projects.find(
          (item) => item.id === projectId && !item.trashedAt && !item.archivedAt,
        );
        return project ? { id: project.id, name: project.name } : null;
      },
      middleware: createModelCopilotMiddleware(
        undefined,
        undefined,
        undefined,
        applicationLanguage,
        undefined,
        async () => (modelRoutingStore ? modelRoutingStore.get() : undefined),
        // The 논문 요약 AI conversations for Model Lab's assistant. Read only, under the Briefing
        // permission the user already granted for papers: Model Lab adds no permission of its own.
        async (input, signal) => {
          if (!briefingLabHost) throw new Error('assistant_papers_permission_required');
          const reads = await briefingLabHost.reads();
          const projectId = modelLabBackendContext.getStore()?.projectId;
          const project = projectId
            ? (await workspace.snapshot()).projects.find((item) => item.id === projectId)
            : undefined;
          return reads.paperConversations(
            input,
            `Model Lab AI(${project?.name ?? 'GOSU'})`,
            signal,
          );
        },
      ),
    });
    await modelLabHost
      .start()
      .catch(() => console.error('[GOSU] Embedded Model Lab could not start.'));
    modelRoutingStore = new ModelRoutingStore(
      join(app.getPath('userData'), 'model-routing.v1.json'),
    );
    approvalPolicyStore = new ApprovalPolicyStore(
      join(app.getPath('userData'), 'approval-policy.v1.json'),
    );
    assistantShortcutStore = new AssistantShortcutStore(
      join(app.getPath('userData'), 'assistant-shortcut.v1.json'),
    );
    await assistantShortcutStore
      .load()
      .catch(() => console.error('[GOSU] Shortcut settings could not be loaded; using default.'));
    appShortcutStore = new AppShortcutStore(join(app.getPath('userData'), 'app-shortcuts.v1.json'));
    await appShortcutStore
      .load()
      .catch(() =>
        console.error('[GOSU] Screen shortcut settings could not be loaded; using defaults.'),
      );
    dailyQuotes = new DailyQuoteService({
      path: join(app.getPath('userData'), 'daily-quote.v1.json'),
      language: () => applicationLanguage.get().language,
      generator: async () => dailyQuoteGenerator(await modelRoutingStore?.get()),
    });
    sshAgentNotesStore = new SshAgentNotesStore(
      join(app.getPath('userData'), 'ssh-agent-notes.v1.json'),
    );
    nativeUsageLedger = new NativeUsageLedger(
      join(app.getPath('userData'), 'native-usage-ledger.v1.json'),
    );
    configureNativeUsageObserver((event) => nativeUsageLedger!.record(event));
    await approvalPolicyStore
      .load()
      .catch(() =>
        console.error('[GOSU] Approval policy unavailable; automatic scope reuse disabled.'),
      );
    briefingLabHost = new BriefingDesktopHost(
      join(__dirname, '../briefing-lab'),
      4318,
      undefined,
      async () => {
        return briefingTodoSnapshot(await workspace.snapshot());
      },
      () => modelRoutingStore!.get(),
      createBriefingHostConsent(
        () => mainWindow,
        (window, options) => dialog.showMessageBox(window, options),
      ),
      createGlobalAssistantProjects({
        modelLab: async (projectId, input) => {
          if (!modelLabHost) throw new Error('model_lab_host_unavailable');
          return modelLabHost.readForChat(projectId, input);
        },
        modelLabWrite: async (projectId, input) => {
          if (!modelLabHost) throw new Error('model_lab_host_unavailable');
          return modelLabHost.addModelForChat(projectId, { ...input, origin: 'ai-assistant' });
        },
        workspace: createGlobalAssistantWorkspace({
          notes: researchNotes,
          literature,
          manuscripts: manuscriptWorkspace,
          experiments: experimentWorkspace,
        }),
        projects: async () => (await workspace.snapshot()).projects,
        sessions: (projectId) => projectChat.listSessions({ projectId }),
        read: (projectId, sessionId) => projectChat.snapshot({ projectId, sessionId }),
        memory: (projectId) =>
          database.getProjectAgentPermanentMemory(
            projectId,
            '프로젝트 전역 비서 기억 결정 상태 진행',
            { maxTokens: 2000 },
          ),
        remember: (projectId, text) => database.rememberGlobalAssistantContext(projectId, text),
        send: (projectId, sessionId, message) =>
          projectChat.send({
            projectId,
            ...(sessionId ? { sessionId } : {}),
            message,
            requestedModelId: null,
            reasoningOptionId: null,
          }),
        confirm: createBriefingHostConsent(
          () => mainWindow,
          (window, options) => dialog.showMessageBox(window, options),
        ),
      }),
      briefingChatAttachments,
      () => approvalPolicyStore?.enabled() ?? false,
      new DesktopBriefingTaskActions(
        workspace,
        join(app.getPath('appData'), 'GOSU', 'briefing-lab'),
      ),
    );
    const contentSecurityPolicy = rendererContentSecurityPolicy(
      trustedRenderer,
      modelLabHost.origin || undefined,
      briefingLabHost.origin,
    );
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          ...(details.url.startsWith(`${modelLabHost?.origin}/`) ||
          details.url.startsWith(`${briefingLabHost?.origin}/`)
            ? {}
            : { 'Content-Security-Policy': [contentSecurityPolicy] }),
        },
      }),
    );
    let localData = localDataReadiness();
    if (
      await localSecrets.load(() =>
        systemBriefingKey(join(app.getPath('appData'), 'GOSU', 'briefing-lab')),
      )
    ) {
      const overleafRoot = join(app.getPath('userData'), 'credentials', 'overleaf-git');
      const overleafFiles = await readdir(overleafRoot).catch(() => [] as string[]);
      await localSecrets.migrateFiles([
        ...overleafFiles
          .filter((name) => name.endsWith('.bin'))
          .map((name) => join(overleafRoot, name)),
        join(lectureExternalSourceRoot(), 'manifest-authentication-key.bin'),
      ]);
    }
    try {
      // The database key is wrapped by the Briefing Keychain helper, so updates of this locally
      // signed app no longer ask for the login password at every launch (local-database-key.ts).
      await openLocalDatabaseWithWrappedKey(database, {
        userData: app.getPath('userData'),
        systemKey: () => systemBriefingKey(join(app.getPath('appData'), 'GOSU', 'briefing-lab')),
        legacy: safeStorage,
      });
      codex.on(
        'invocation',
        (event: { threadId: string; turnId: string; invocation: ModelInvocation }) =>
          modelUsage.recordInvocation(event),
      );
      codex.on('notification', (notification: unknown) =>
        modelUsage.recordCodexNotification(notification),
      );
      hermesProjectChat.on(
        'invocation',
        (event: Parameters<ModelUsageService['recordInvocation']>[0]) =>
          modelUsage.recordInvocation(event),
      );
      hermesProjectChat.on(
        'usage',
        (event: Parameters<ModelUsageService['recordAcpPromptResult']>[0]) =>
          modelUsage.recordAcpPromptResult(event),
      );
      hermesProjectChat.on(
        'delegationInvocation',
        (event: Parameters<ModelUsageService['recordDelegationInvocation']>[0]) =>
          modelUsage.recordDelegationInvocation(event),
      );
      hermesProjectChat.on(
        'delegationUsage',
        (event: Parameters<ModelUsageService['recordDelegationPromptResult']>[0]) =>
          modelUsage.recordDelegationPromptResult(event),
      );
      hermesProjectChat.on('notification', (notification: unknown) =>
        modelUsage.recordAcpNotification(notification),
      );
      claudeCodeProjectChat.on(
        'invocation',
        (event: Parameters<ModelUsageService['recordInvocation']>[0]) =>
          modelUsage.recordInvocation(event),
      );
      claudeCodeProjectChat.on(
        'usage',
        (event: Parameters<ModelUsageService['recordAcpPromptResult']>[0]) =>
          modelUsage.recordAcpPromptResult(event),
      );
      // The saved Obsidian vault only needs local data. It used to wait behind the Codex start and
      // every reconciliation below, so Research Notes opened in that window looked unconnected.
      // A failure is kept for the Research Notes screen, which also retries on demand.
      await vault.restore().catch(() => null);
      const initialCodexStatus = await codex.status().catch(() => null);
      if (initialCodexStatus) modelUsage.observeCodexAccount(initialCodexStatus);
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
      await lectureExternalSources
        .cleanupOrphanedStudios(
          database.listLectureStudios(true).map(({ id, outputProjectId }) => ({
            projectId: outputProjectId,
            studioId: id,
          })),
        )
        .catch(() => undefined);
      await lectureExternalSources.cleanupExpired().catch(() => undefined);
      await lectureStudio.reconcilePendingArtifacts().catch(() => undefined);
      await projectChat.reconcileResearchNoteSaveReceipts().catch(() => undefined);
      await projectChat.reconcileQueuedTurns().catch(() => undefined);
    } catch (error) {
      localData = localDataReadiness(error);
    }
    codex.on('notification', (notification: unknown) => {
      const { method, params } = (notification ?? {}) as { method?: unknown; params?: unknown };
      usageLimits.acceptCodexNotification(method, params);
    });
    codex.on('catalog', (catalog: ModelCatalog) => {
      if (!database.isReady()) return;
      database.recordModelCatalog(catalog);
      database.cache('codex', 'model-catalog', catalog, Date.now());
    });
    codex.on('authentication', (event: unknown) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const parsed = CodexAuthenticationEventSchema.safeParse(event);
      if (!parsed.success) return;
      try {
        mainWindow.webContents.send(CODEX_AUTH_IPC_CHANNELS.event, parsed.data);
      } catch {
        console.error('[GOSU] Codex authentication renderer event delivery failed.');
      }
    });
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
    modelPrices.close();
    usageLimits.close();
    void modelLabHost?.close();
    void briefingLabHost?.close();
    manuscriptPdfCompiler.dispose();
    lectureDocumentCompiler.dispose();
    void lectureStudioFigures.dispose();
    projectChatAttachments.disposeImmediately();
    briefingChatAttachments.disposeImmediately();
    literature.shutdown();
    ssh.shutdown();
    hermesProjectChat.shutdown();
    codex.stop();
    database.close();
  });
}
