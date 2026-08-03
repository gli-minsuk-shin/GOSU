import { useEffect, useMemo, useState } from 'react';

import type { RuntimeReadiness } from '../../shared/runtime-contracts';
import type {
  ProjectRecord,
  WorkspacePendingSummary,
  WorkspaceSnapshot,
} from '../../shared/workspace-contracts';
import { ConnectionsView, type CodexModel } from './connections-view';
import { LocalNotesView, type SelectedNote, type VaultSelection } from './notes-view';
import { Connection, describeError } from './ui-primitives';
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

export function DesktopApp() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [pendingSummary, setPendingSummary] = useState<WorkspacePendingSummary | null>(null);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('board');
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showProjectForm, setShowProjectForm] = useState(false);

  const [models, setModels] = useState<CodexModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('auto');
  const [codexStatus, setCodexStatus] = useState('Catalog not loaded');
  const [codexBusy, setCodexBusy] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeReadiness | null>(null);
  const [vault, setVault] = useState<VaultSelection | null>(null);
  const [selectedNote, setSelectedNote] = useState<SelectedNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [apiKeyMode, setApiKeyMode] = useState(false);
  const [apiKey, setApiKey] = useState('');

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

  useEffect(() => {
    void loadWorkspace()
      .catch((error: unknown) => setWorkspaceError(describeError(error)))
      .finally(() => setWorkspaceLoading(false));

    void window.gosu.runtime
      .readiness()
      .then((next: RuntimeReadiness) => {
        setRuntime(next);
        setCodexStatus(
          next.codex.ready
            ? 'Codex is available · load the catalog when needed'
            : 'Codex executable is unavailable',
        );
      })
      .catch(() => setCodexStatus('Runtime readiness check failed'));
  }, []);

  const refreshModels = async () => {
    if (codexBusy) return;
    setCodexBusy(true);
    setCodexStatus('Reading the live Codex model catalog…');
    try {
      const next = (await window.gosu.codex.listModels()) as CodexModel[];
      setModels(next);
      setCodexStatus(`${next.length} models available locally`);
    } catch (error) {
      setCodexStatus(describeError(error));
    } finally {
      setCodexBusy(false);
    }
  };

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

  return (
    <main className="desktop-shell">
      <header className="titlebar">
        <div className="logo">G</div>
        <strong>GOSU</strong>
        <span>Local Research Workspace</span>
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
            models.length
              ? 'Catalog loaded'
              : runtime === null
                ? 'Checking'
                : runtime.codex.ready
                  ? 'Available'
                  : 'Unavailable'
          }
          ready={Boolean(models.length || runtime?.codex.ready)}
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
            {workspaceError}
          </div>
        )}

        {workspaceLoading ? (
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
                setActiveTab('board');
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
                    setActiveTab('board');
                  }
                  return succeeded;
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
                onSelectedModel={setSelectedModel}
                onRefresh={() => void refreshModels()}
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
