import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ProjectChatAction,
  ProjectChatEvent,
  ProjectChatSnapshot,
} from '../../shared/project-chat-contracts';
import type { RuntimeReadiness } from '../../shared/runtime-contracts';
import type {
  ProjectRecord,
  WorkspacePendingSummary,
  WorkspaceSnapshot,
} from '../../shared/workspace-contracts';
import { ConnectionsView, type CodexModel } from './connections-view';
import { LocalNotesView, type SelectedNote, type VaultSelection } from './notes-view';
import { ProjectChatLoadGuard } from './project-chat-load-guard';
import { ProjectChatView } from './project-chat-view';
import { SettingsView } from './settings-view';
import { Connection, describeError } from './ui-primitives';
import {
  applyUserPreferences,
  saveUserPreferences,
  type UserPreferences,
} from './user-preferences';
import {
  BoardView,
  EmptyWorkspace,
  FUTURE_MODULES,
  ObjectiveEditor,
  ProjectComposer,
  WORKSPACE_TABS,
  WorkspacePageHeading,
  WorkspaceUnavailable,
  latestObjective,
  type WorkspaceTabId,
} from './workspace-views';

type CodexConnectionState = 'checking' | 'ready' | 'auth-required' | 'unavailable';

function isCodexUnavailableError(error: unknown) {
  return error instanceof Error && error.message.includes('codex_unavailable');
}

export function DesktopApp({ initialPreferences }: { initialPreferences: UserPreferences }) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [pendingSummary, setPendingSummary] = useState<WorkspacePendingSummary | null>(null);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('chat');
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showProjectForm, setShowProjectForm] = useState(false);

  const [models, setModels] = useState<CodexModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('auto');
  const [selectedReasoning, setSelectedReasoning] = useState('auto');
  const [codexStatus, setCodexStatus] = useState('Catalog not loaded');
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexConnectionState, setCodexConnectionState] =
    useState<CodexConnectionState>('checking');
  const [codexErrorVisible, setCodexErrorVisible] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeReadiness | null>(null);
  const [vault, setVault] = useState<VaultSelection | null>(null);
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

  const activeProject = useMemo(
    () => snapshot?.projects.find((project) => project.id === activeProjectId),
    [activeProjectId, snapshot],
  );
  const activeTasks = useMemo(
    () => snapshot?.tasks.filter((task) => task.projectId === activeProjectId) ?? [],
    [activeProjectId, snapshot],
  );
  const activeObjective = useMemo(
    () => latestObjective(snapshot?.objectives ?? [], activeProjectId),
    [activeProjectId, snapshot],
  );
  const loadWorkspace = async () => {
    const nextSnapshot = await window.gosu.workspace.snapshot();
    setSnapshot(nextSnapshot);
    setActiveProjectId((current) =>
      nextSnapshot.projects.some((project) => project.id === current)
        ? current
        : (nextSnapshot.projects[0]?.id ?? ''),
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

  const refreshModels = async (showRecoveryError = false) => {
    if (codexBusy) return;
    setCodexBusy(true);
    setCodexConnectionState('checking');
    setCodexStatus('Checking the local Codex connection and model catalog…');
    try {
      const result = (await window.gosu.codex.reconnect()) as {
        authenticated: boolean;
        models: CodexModel[];
      };
      setModels(result.models);
      setCodexConnectionState(result.authenticated ? 'ready' : 'auth-required');
      setCodexStatus(
        result.authenticated
          ? `Connected · ${result.models.length} models available locally`
          : `${result.models.length} models found · sign in before chatting`,
      );
      if (codexErrorVisible || showRecoveryError) setWorkspaceError(null);
      setCodexErrorVisible(false);
    } catch (error) {
      setModels([]);
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
    setNoteLoading(true);
    setWorkspaceError(null);
    try {
      const result = (await window.gosu.vault.choose()) as VaultSelection | null;
      if (result) {
        setVault(result);
        setSelectedNote(null);
        setAnnouncement(`Selected a local folder with ${result.files.length} Markdown files.`);
      }
    } catch (error) {
      setWorkspaceError(describeError(error));
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
        ? 'Saved display settings on this Mac.'
        : 'Display settings changed for this session but could not be saved.',
    );
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
        <small>Project</small>
        <select
          className="project-switcher"
          value={activeProjectId}
          onChange={(event) => setActiveProjectId(event.target.value)}
          disabled={!snapshot?.projects.length || busyAction !== null}
          aria-label="Active project"
        >
          {snapshot?.projects.length ? (
            snapshot.projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))
          ) : (
            <option value="">No project yet</option>
          )}
        </select>
        {WORKSPACE_TABS.map((tab) => (
          <button
            type="button"
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <span className="nav-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
        {FUTURE_MODULES.map(([label, icon]) => (
          <button
            type="button"
            className="coming-soon"
            key={label}
            disabled
            title={`${label} is not implemented yet`}
          >
            <span className="nav-icon">{icon}</span>
            {label}
            <em>Later</em>
          </button>
        ))}
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

        {activeTab === 'settings' ? (
          <>
            <WorkspacePageHeading
              activeTab={activeTab}
              activeProject={undefined}
              onNewProject={null}
            />
            <SettingsView preferences={preferences} onChange={updatePreferences} />
          </>
        ) : workspaceLoading ? (
          <div className="loading-state" role="status">
            Opening the encrypted local workspace…
          </div>
        ) : !snapshot ? (
          <WorkspaceUnavailable onRetry={() => void retryWorkspace()} />
        ) : snapshot.projects.length === 0 &&
          activeTab !== 'connections' &&
          activeTab !== 'notes' ? (
          <EmptyWorkspace
            busy={busyAction !== null}
            onCreate={async (input) => {
              let createdProject: ProjectRecord | undefined;
              const succeeded = await runWorkspaceAction(
                'project:create',
                async () => {
                  createdProject = await window.gosu.workspace.createProject(input);
                },
                `Created ${input.name}.`,
              );
              if (succeeded && createdProject) {
                setActiveProjectId(createdProject.id);
                setActiveTab('chat');
              }
              return succeeded;
            }}
          />
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
                onCreate={async (input) => {
                  let createdProject: ProjectRecord | undefined;
                  const succeeded = await runWorkspaceAction(
                    'project:create',
                    async () => {
                      createdProject = await window.gosu.workspace.createProject(input);
                    },
                    `Created ${input.name}.`,
                  );
                  if (succeeded && createdProject) {
                    setActiveProjectId(createdProject.id);
                    setShowProjectForm(false);
                    setActiveTab('chat');
                  }
                  return succeeded;
                }}
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
                selectedModel={selectedModel}
                selectedReasoning={selectedReasoning}
                applyingActionId={applyingChatActionId}
                onSelectedModel={(modelId) => {
                  setSelectedModel(modelId);
                  setSelectedReasoning('auto');
                }}
                onSelectedReasoning={setSelectedReasoning}
                onRefreshModels={() => void refreshModels()}
                onSend={async (message, retryOfAttemptId) => {
                  if (chatStartingProjectId !== null || chatInFlight[activeProject.id])
                    return false;
                  const selectedDescriptor = models.find(
                    (model) => model.modelId === selectedModel,
                  );
                  if (selectedModel !== 'auto' && !selectedDescriptor) {
                    setWorkspaceError(
                      'The selected Codex model is no longer available. Choose a current model and try again.',
                    );
                    return false;
                  }
                  if (
                    selectedReasoning !== 'auto' &&
                    !selectedDescriptor?.reasoningOptions.some(
                      (option) => option.id === selectedReasoning,
                    )
                  ) {
                    setWorkspaceError(
                      'The selected reasoning option is no longer available. Choose a current option and try again.',
                    );
                    return false;
                  }
                  setChatStartingProjectId(activeProject.id);
                  setWorkspaceError(null);
                  try {
                    await window.gosu.projectChat.send({
                      projectId: activeProject.id,
                      message,
                      requestedModelId: selectedModel === 'auto' ? null : selectedModel,
                      reasoningOptionId: selectedReasoning === 'auto' ? null : selectedReasoning,
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
                  setSelectedModel(modelId);
                  setSelectedReasoning('auto');
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
                      setModels([]);
                      setSelectedModel('auto');
                      setSelectedReasoning('auto');
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
