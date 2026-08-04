import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  CodexCollaborationModeCatalog,
  CodexCollaborationModeDescriptor,
  ProjectChatAction,
  ProjectChatEvent,
  ProjectChatSnapshot,
  UpdateProjectChatProfileInput,
} from '../../shared/project-chat-contracts';
import type { RuntimeReadiness } from '../../shared/runtime-contracts';
import type {
  CreateProjectInput,
  ProjectRecord,
  WorkspacePendingSummary,
  WorkspaceSnapshot,
} from '../../shared/workspace-contracts';
import { BoardView } from './board-view';
import { resetCodexPicker, selectCodexModel } from './codex-picker-state';
import { ConnectionsView, type CodexModel } from './connections-view';
import {
  LocalNotesView,
  type SelectedNote,
  type VaultRuntimeState,
  type VaultSelection,
} from './notes-view';
import { ProjectChatLoadGuard } from './project-chat-load-guard';
import { ProjectChatView, resolveEffectiveCodexModel } from './project-chat-view';
import {
  archivedProjects as archivedPortfolioProjects,
  resolveActiveProjectId,
  visibleProjects,
} from './project-portfolio-model';
import {
  hideProjectLocally,
  loadProjectNavigationState,
  pruneProjectNavigationState,
  saveProjectNavigationState,
  showAllProjectsLocally,
  showProjectLocally,
  type ProjectNavigationState,
} from './project-navigation-state';
import {
  ProjectSidebar,
  type GlobalWorkspaceTabId,
  type ProjectWorkspaceTabId,
} from './project-sidebar';
import { SettingsView, type SettingsCategory } from './settings-view';
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
  WorkspacePageHeading,
  WorkspaceUnavailable,
  latestObjective,
  type WorkspaceTabId,
} from './workspace-views';

type CodexConnectionState = 'checking' | 'ready' | 'auth-required' | 'unavailable';
type AppSurface = 'workspace' | 'settings';

type ProjectDraft = Readonly<{ name: string; repository?: string | undefined }>;

function createProjectCommand(
  input: ProjectDraft,
  preferences: UserPreferences,
): CreateProjectInput {
  return {
    ...input,
    board: structuredClone(preferences.defaultBoardTemplate),
  };
}

function isCodexUnavailableError(error: unknown) {
  return error instanceof Error && error.message.includes('codex_unavailable');
}

function isProjectWorkspaceTab(tab: WorkspaceTabId): tab is ProjectWorkspaceTabId {
  return tab === 'chat' || tab === 'board' || tab === 'objective';
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
  const [announcement, setAnnouncement] = useState('');
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectNavigation, setProjectNavigation] = useState<ProjectNavigationState>(() =>
    loadProjectNavigationState(window.localStorage),
  );

  const [models, setModels] = useState<CodexModel[]>([]);
  const [collaborationModes, setCollaborationModes] = useState<CodexCollaborationModeDescriptor[]>(
    [],
  );
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedReasoning, setSelectedReasoning] = useState<string | null>(null);
  const [codexStatus, setCodexStatus] = useState('Catalog not loaded');
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexConnectionState, setCodexConnectionState] =
    useState<CodexConnectionState>('checking');
  const [codexErrorVisible, setCodexErrorVisible] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeReadiness | null>(null);
  const [vault, setVault] = useState<VaultSelection | null>(null);
  const [vaultState, setVaultState] = useState<VaultRuntimeState>('checking');
  const [selectedNote, setSelectedNote] = useState<SelectedNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [apiKeyMode, setApiKeyMode] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [chatSnapshots, setChatSnapshots] = useState<Record<string, ProjectChatSnapshot>>({});
  const [chatLoadingProjectId, setChatLoadingProjectId] = useState<string | null>(null);
  const [chatStartingProjectId, setChatStartingProjectId] = useState<string | null>(null);
  const [chatInFlight, setChatInFlight] = useState<Record<string, boolean>>({});
  const [applyingChatActionId, setApplyingChatActionId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const chatLoadGuard = useRef(new ProjectChatLoadGuard());
  const codexBootstrapStarted = useRef(false);
  const vaultSelectionGeneration = useRef(0);
  const projectNavigationRef = useRef(projectNavigation);

  const activeProjects = useMemo(() => visibleProjects(snapshot?.projects ?? []), [snapshot]);
  const archivedProjects = useMemo(
    () => archivedPortfolioProjects(snapshot?.projects ?? []),
    [snapshot],
  );
  const activeProject = useMemo(
    () => activeProjects.find((project) => project.id === activeProjectId),
    [activeProjectId, activeProjects],
  );
  const activeTasks = useMemo(
    () => snapshot?.tasks.filter((task) => task.projectId === activeProjectId) ?? [],
    [activeProjectId, snapshot],
  );
  const activeObjective = useMemo(
    () => latestObjective(snapshot?.objectives ?? [], activeProjectId),
    [activeProjectId, snapshot],
  );
  const chatBusyProjectIds = useMemo(() => {
    const busyProjects = new Set(
      Object.entries(chatInFlight)
        .filter(([, inFlight]) => inFlight)
        .map(([projectId]) => projectId),
    );
    if (chatStartingProjectId) busyProjects.add(chatStartingProjectId);
    return busyProjects;
  }, [chatInFlight, chatStartingProjectId]);

  const updateProjectNavigation = (next: ProjectNavigationState) => {
    projectNavigationRef.current = next;
    setProjectNavigation(next);
  };

  useEffect(() => {
    projectNavigationRef.current = projectNavigation;
    saveProjectNavigationState(window.localStorage, projectNavigation);
  }, [projectNavigation]);

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

  const loadProjectChat = async (projectId: string) => {
    if (!projectId) return null;
    const loadToken = chatLoadGuard.current.begin(projectId);
    setChatLoadingProjectId(projectId);
    try {
      const next = await window.gosu.projectChat.snapshot(projectId);
      if (!chatLoadGuard.current.canApply(loadToken)) return null;
      setChatSnapshots((current) => ({ ...current, [projectId]: next }));
      setChatInFlight((current) => ({ ...current, [projectId]: Boolean(next.activeTurnId) }));
      return next;
    } finally {
      if (chatLoadGuard.current.isLatestRequest(loadToken)) {
        setChatLoadingProjectId((current) => (current === projectId ? null : current));
      }
    }
  };

  useEffect(() => {
    void loadWorkspace()
      .catch((error: unknown) => setWorkspaceError(describeError(error)))
      .finally(() => setWorkspaceLoading(false));

    const vaultGeneration = ++vaultSelectionGeneration.current;
    void window.gosu.vault
      .current()
      .then((selection) => {
        if (vaultSelectionGeneration.current === vaultGeneration) {
          setVault(selection);
          setVaultState('ready');
        }
      })
      .catch(() => {
        if (vaultSelectionGeneration.current === vaultGeneration) {
          setVault(null);
          setVaultState('unavailable');
        }
      });

    void window.gosu.runtime
      .readiness()
      .then((next: RuntimeReadiness) => setRuntime(next))
      .catch(() =>
        setCodexStatus((current) =>
          current === 'Catalog not loaded' ? 'Runtime readiness check failed' : current,
        ),
      );
  }, []);

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
    () =>
      window.gosu.projectChat.onEvent((event: ProjectChatEvent) => {
        chatLoadGuard.current.observeEvent(event.projectId);
        if (event.type === 'turn.started') {
          setChatInFlight((current) => ({ ...current, [event.projectId]: true }));
          return;
        }
        if (event.type === 'turn.completed') {
          setChatInFlight((current) => ({ ...current, [event.projectId]: false }));
          void loadProjectChat(event.projectId).catch((error: unknown) =>
            setWorkspaceError(describeError(error)),
          );
          return;
        }
        setChatSnapshots((current) => {
          const projectSnapshot = current[event.projectId];
          if (!projectSnapshot) return current;
          return {
            ...current,
            [event.projectId]: {
              ...projectSnapshot,
              messages: projectSnapshot.messages.map((message) => ({
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

  useEffect(() => {
    if (activeTab !== 'chat' || !activeProjectId) return;
    void loadProjectChat(activeProjectId).catch((error: unknown) =>
      setWorkspaceError(describeError(error)),
    );
  }, [activeProjectId, activeTab]);

  useEffect(() => {
    if (
      activeSurface !== 'settings' ||
      settingsCategory !== 'agent' ||
      !activeProjectId ||
      chatSnapshots[activeProjectId]?.profile
    ) {
      return;
    }
    void loadProjectChat(activeProjectId).catch((error: unknown) =>
      setWorkspaceError(describeError(error)),
    );
  }, [activeProjectId, activeSurface, settingsCategory]);

  const refreshModels = async (showRecoveryError = false) => {
    if (codexBusy) return;
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
          'Codex could not reconnect. Board, settings, and local notes still work.',
        );
        setCodexErrorVisible(true);
      }
    } finally {
      setCodexBusy(false);
    }
  };

  useEffect(() => {
    if (codexBootstrapStarted.current) return;
    codexBootstrapStarted.current = true;
    void refreshModels();
  }, []);

  const chooseVault = async () => {
    if (noteLoading) return;
    const vaultGeneration = ++vaultSelectionGeneration.current;
    setVaultState('checking');
    setNoteLoading(true);
    setWorkspaceError(null);
    try {
      const result = await window.gosu.vault.choose();
      if (vaultSelectionGeneration.current !== vaultGeneration) return;
      if (result !== null) {
        setVault(result);
        setVaultState('ready');
        setSelectedNote(null);
        setAnnouncement(`Selected a local folder with ${result.files.length} Markdown files.`);
      } else {
        const current = await window.gosu.vault.current();
        if (vaultSelectionGeneration.current === vaultGeneration) {
          setVault(current);
          setVaultState('ready');
        }
      }
    } catch (error) {
      setWorkspaceError(describeError(error));
      try {
        const current = await window.gosu.vault.current();
        if (vaultSelectionGeneration.current === vaultGeneration) {
          setVault(current);
          setVaultState('ready');
        }
      } catch {
        if (vaultSelectionGeneration.current === vaultGeneration) {
          setVault(null);
          setVaultState('unavailable');
        }
      }
    } finally {
      setNoteLoading(false);
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
      setChatSnapshots((current) => {
        const existing = current[input.projectId];
        return existing ? { ...current, [input.projectId]: { ...existing, profile } } : current;
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
    setActiveProjectId(projectId);
    setActiveSurface('workspace');
    setShowProjectForm(false);
    if (!isProjectWorkspaceTab(activeTab)) setActiveTab('chat');
  };

  const selectProjectTab = (projectId: string, tab: ProjectWorkspaceTabId) => {
    setActiveProjectId(projectId);
    setActiveSurface('workspace');
    setActiveTab(tab);
    setShowProjectForm(false);
  };

  const selectGlobalTab = (tab: GlobalWorkspaceTabId) => {
    setActiveSurface('workspace');
    setActiveTab(tab);
    setShowProjectForm(false);
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

  return (
    <main className="desktop-shell">
      <header className="titlebar">
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

      <aside className="desktop-nav" aria-label="Workspace navigation">
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
        <Connection name="Runner" state="Not configured" ready={false} />
        <Connection
          name="Obsidian"
          state={vault ? 'Folder selected' : 'Not selected'}
          ready={Boolean(vault)}
        />
      </aside>

      <section className="desktop-content">
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
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
          <>
            <header className="page-heading settings-page-heading">
              <div>
                <span className="eyebrow">GOSU / Settings</span>
                <h1>Settings</h1>
                <p>Configure this Mac, project defaults, and recoverable project management.</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setActiveSurface('workspace')}
              >
                Done
              </button>
            </header>
            <SettingsView
              preferences={preferences}
              onChange={updatePreferences}
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
              category={settingsCategory}
              onCategoryChange={setSettingsCategory}
              agentProject={activeProject}
              agentProfile={activeProject ? chatSnapshots[activeProject.id]?.profile : undefined}
              agentProfileLoading={Boolean(
                activeProject &&
                chatLoadingProjectId === activeProject.id &&
                !chatSnapshots[activeProject.id]?.profile,
              )}
              collaborationModes={collaborationModes}
              vault={vault}
              vaultState={vaultState}
              onUpdateAgentProfile={updateProjectChatProfile}
            />
          </>
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
            <WorkspacePageHeading
              activeTab={activeTab}
              activeProject={activeProject}
              onNewProject={() => setShowProjectForm((visible) => !visible)}
            />
            {showProjectForm && (
              <ProjectComposer
                busy={busyAction !== null}
                onCancel={() => setShowProjectForm(false)}
                onCreate={createProject}
              />
            )}

            {activeTab === 'chat' && activeProject && (
              <ProjectChatView
                key={activeProject.id}
                project={activeProject}
                tasks={activeTasks}
                snapshot={chatSnapshots[activeProject.id] ?? null}
                loading={
                  chatLoadingProjectId === activeProject.id &&
                  chatSnapshots[activeProject.id] === undefined
                }
                inFlight={
                  Boolean(chatInFlight[activeProject.id]) ||
                  chatStartingProjectId === activeProject.id
                }
                models={models}
                collaborationModes={collaborationModes}
                selectedModel={selectedModel}
                selectedReasoning={selectedReasoning}
                applyingActionId={applyingChatActionId}
                vault={vault}
                vaultState={vaultState}
                onSelectedModel={(modelId) => {
                  const selection = selectCodexModel(modelId);
                  setSelectedModel(selection.modelId);
                  setSelectedReasoning(selection.reasoningOptionId);
                }}
                onSelectedReasoning={setSelectedReasoning}
                onRefreshModels={() => void refreshModels()}
                onOpenAgentSettings={() => {
                  setSettingsCategory('agent');
                  setActiveSurface('settings');
                  setShowProjectForm(false);
                }}
                onSend={async (message, retryOfAttemptId, controls) => {
                  if (chatStartingProjectId !== null || chatInFlight[activeProject.id])
                    return false;
                  const savedLocalNotesGrant =
                    chatSnapshots[activeProject.id]?.profile?.localNotesVault;
                  if (savedLocalNotesGrant && vaultState !== 'ready') {
                    setWorkspaceError(
                      'Local Notes capability status is unavailable. GOSU paused this turn so a hidden saved grant cannot be used. Reopen Local notes and try again.',
                    );
                    return false;
                  }
                  const selectedDescriptor = resolveEffectiveCodexModel(
                    models,
                    collaborationModes,
                    selectedModel,
                    controls.collaborationModeId ?? null,
                  );
                  const selectedCollaborationMode = controls.collaborationModeId
                    ? collaborationModes.find((mode) => mode.id === controls.collaborationModeId)
                    : undefined;
                  const effectiveReasoningOptionId =
                    selectedReasoning ??
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
                      selectedModel !== null
                        ? 'The selected Codex model is no longer available. Choose a current model and try again.'
                        : 'The effective Codex default or mode-recommended model is unavailable. Choose a current model or mode and try again.',
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
                  setChatStartingProjectId(activeProject.id);
                  setWorkspaceError(null);
                  try {
                    await window.gosu.projectChat.send({
                      projectId: activeProject.id,
                      message,
                      requestedModelId: selectedModel,
                      reasoningOptionId: selectedReasoning,
                      ...controls,
                      ...(retryOfAttemptId ? { retryOfAttemptId } : {}),
                    });
                    await loadProjectChat(activeProject.id);
                    setCodexConnectionState('ready');
                    setCodexErrorVisible(false);
                    return true;
                  } catch (error) {
                    setWorkspaceError(describeError(error));
                    if (isCodexUnavailableError(error)) {
                      setCodexConnectionState('unavailable');
                      setCodexErrorVisible(true);
                    }
                    await loadProjectChat(activeProject.id).catch(() => undefined);
                    return false;
                  } finally {
                    setChatStartingProjectId((current) =>
                      current === activeProject.id ? null : current,
                    );
                  }
                }}
                onCancel={() => {
                  void window.gosu.projectChat
                    .cancel(activeProject.id)
                    .catch((error: unknown) => setWorkspaceError(describeError(error)));
                }}
                onApplyAction={async (action: ProjectChatAction) => {
                  if (applyingChatActionId !== null) return;
                  setApplyingChatActionId(action.id);
                  setWorkspaceError(null);
                  try {
                    const updated = await window.gosu.projectChat.applyAction({
                      projectId: activeProject.id,
                      actionId: action.id,
                    });
                    await Promise.all([loadProjectChat(activeProject.id), loadWorkspace()]);
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
                    input.archived ? 'Archived the task.' : 'Restored the task.',
                  )
                }
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
                  const selection = selectCodexModel(modelId);
                  setSelectedModel(selection.modelId);
                  setSelectedReasoning(selection.reasoningOptionId);
                }}
                onRefresh={() => void refreshModels()}
                onReconnect={() => void refreshModels(true)}
                onToggleApiKey={() => setApiKeyMode((visible) => !visible)}
                onApiKey={setApiKey}
                onLoginChatGpt={() => {
                  if (codexBusy) return;
                  setCodexBusy(true);
                  void window.gosu.codex
                    .loginChatGpt()
                    .then(() => setCodexStatus('Continue sign-in in the system browser.'))
                    .catch((error: unknown) => setCodexStatus(describeError(error)))
                    .finally(() => setCodexBusy(false));
                }}
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
              />
            )}
            {activeTab === 'notes' && (
              <LocalNotesView
                vault={vault}
                selectedNote={selectedNote}
                busy={noteLoading}
                onChoose={() => void chooseVault()}
                onRead={(path) => {
                  if (noteLoading) return;
                  setNoteLoading(true);
                  setWorkspaceError(null);
                  void window.gosu.vault
                    .read(path)
                    .then((note) => setSelectedNote(note as SelectedNote))
                    .catch((error: unknown) => setWorkspaceError(describeError(error)))
                    .finally(() => setNoteLoading(false));
                }}
              />
            )}
          </>
        )}
      </section>
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
