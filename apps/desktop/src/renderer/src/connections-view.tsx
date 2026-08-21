import type { RuntimeReadiness } from '../../shared/runtime-contracts';
import type {
  CreateSshConnectionInput,
  ImportSshCommandInput,
  RemoveSshConnectionInput,
  SshConnectionProfile,
  UpdateSshConnectionInput,
} from '../../shared/ssh-contracts';
import type {
  CreateRemoteWorkspaceGrantInput,
  EnableTrustedRemoteWorkspaceInput,
  GrantedRemoteWorkspace,
  RemoveRemoteWorkspaceGrantInput,
  RevokeTrustedRemoteWorkspaceInput,
  UpdateRemoteWorkspaceGrantInput,
} from '../../shared/ssh-workspace-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import { SshConnectionsCard } from './ssh-connections-card';
import type { SshResourceUiState } from './ssh-resource-summary';
import { SshWorkspaceGrantsCard, type SshWorkspaceSetupRequest } from './ssh-workspace-grants-card';
import { Boundary, CardHead, RuntimeCard } from './ui-primitives';

export type CodexModel = {
  providerId?: string;
  modelId: string;
  displayName: string;
  isDefault: boolean;
  modalities?: readonly string[];
  reasoningOptions: Array<{ id: string; label: string; isDefault: boolean }>;
  supportsPersonality?: boolean;
};

export function ConnectionsView({
  runtime,
  models,
  defaultModelId,
  defaultReasoningOptionId,
  status,
  busy,
  apiKeyMode,
  apiKey,
  onOpenAiDefaults,
  onRefresh,
  onReconnect,
  onToggleApiKey,
  onApiKey,
  onLoginChatGpt,
  onLoginApiKey,
  onLogout,
  sshConnections,
  sshBusy,
  sshTestStatus,
  onCreateSshConnection,
  onImportSshCommand,
  onUpdateSshConnection,
  onRemoveSshConnection,
  onTestSshConnection,
  sshResourceStates = {},
  onRefreshSshResource = async () => undefined,
  onOpenSshWorkspaceSetup = () => undefined,
  activeProject,
  projects,
  linkedProjectIdsByConnectionId,
  sshWorkspaces,
  sshWorkspaceReady = true,
  onCreateSshWorkspace,
  onUpdateSshWorkspace,
  onRemoveSshWorkspace,
  onEnableTrustedWorkspace,
  onRevokeTrustedWorkspace,
  sshWorkspaceSetupRequest = null,
  onSshWorkspaceSetupHandled = () => undefined,
}: {
  runtime: RuntimeReadiness | null;
  models: readonly CodexModel[];
  defaultModelId: string | null;
  defaultReasoningOptionId: string | null;
  status: string;
  busy: boolean;
  apiKeyMode: boolean;
  apiKey: string;
  onOpenAiDefaults: () => void;
  onRefresh: () => void;
  onReconnect: () => void;
  onToggleApiKey: () => void;
  onApiKey: (apiKey: string) => void;
  onLoginChatGpt: () => void;
  onLoginApiKey: () => void;
  onLogout: () => void;
  sshConnections: readonly SshConnectionProfile[];
  sshBusy: boolean;
  sshTestStatus: Readonly<Record<string, string>>;
  onCreateSshConnection: (input: CreateSshConnectionInput) => Promise<unknown>;
  onImportSshCommand: (input: ImportSshCommandInput) => Promise<unknown>;
  onUpdateSshConnection: (input: UpdateSshConnectionInput) => Promise<unknown>;
  onRemoveSshConnection: (input: RemoveSshConnectionInput) => Promise<unknown>;
  onTestSshConnection: (connectionId: string) => Promise<unknown>;
  sshResourceStates?: Readonly<Record<string, SshResourceUiState>>;
  onRefreshSshResource?: (connectionId: string) => Promise<unknown>;
  onOpenSshWorkspaceSetup?: (projectId: string, connectionId: string) => void;
  activeProject: ProjectRecord | null;
  projects: readonly ProjectRecord[];
  linkedProjectIdsByConnectionId: Readonly<Record<string, readonly string[]>>;
  sshWorkspaces: readonly GrantedRemoteWorkspace[];
  sshWorkspaceReady?: boolean;
  onCreateSshWorkspace: (input: CreateRemoteWorkspaceGrantInput) => Promise<unknown>;
  onUpdateSshWorkspace: (input: UpdateRemoteWorkspaceGrantInput) => Promise<unknown>;
  onRemoveSshWorkspace: (input: RemoveRemoteWorkspaceGrantInput) => Promise<unknown>;
  onEnableTrustedWorkspace: (input: EnableTrustedRemoteWorkspaceInput) => Promise<unknown>;
  onRevokeTrustedWorkspace: (input: RevokeTrustedRemoteWorkspaceInput) => Promise<unknown>;
  sshWorkspaceSetupRequest?: SshWorkspaceSetupRequest | null;
  onSshWorkspaceSetupHandled?: (requestId: number) => void;
}) {
  return (
    <section className="connection-grid" aria-label="Connections">
      <SshConnectionsCard
        connections={sshConnections}
        busy={sshBusy}
        testStatus={sshTestStatus}
        onCreate={onCreateSshConnection}
        onImport={onImportSshCommand}
        onUpdate={onUpdateSshConnection}
        onRemove={onRemoveSshConnection}
        onTest={onTestSshConnection}
        activeProject={activeProject}
        projects={projects}
        linkedConnectionIds={new Set(sshWorkspaces.map((workspace) => workspace.connection.id))}
        linkedProjectIdsByConnectionId={linkedProjectIdsByConnectionId}
        resourceStates={sshResourceStates}
        onRefreshResource={onRefreshSshResource}
        onOpenWorkspaceSetup={onOpenSshWorkspaceSetup}
      />
      <RuntimeCard runtime={runtime} />
      <article className="card codex-card">
        <CardHead title="Local Codex" detail={status} />
        <div className="settings-preview codex-default-summary">
          <span>DEFAULT FOR NEW AI WORK</span>
          <strong>
            {defaultModelId === null
              ? 'Auto · provider recommended'
              : (models.find((model) => model.modelId === defaultModelId)?.displayName ??
                `${defaultModelId} · unavailable`)}
          </strong>
          <p>
            Reasoning:{' '}
            {defaultReasoningOptionId === null ? 'Model default' : defaultReasoningOptionId}
          </p>
          <button type="button" className="secondary-button" onClick={onOpenAiDefaults}>
            Open AI defaults
          </button>
        </div>
        <div className="codex-actions">
          <button className="secondary-button" type="button" onClick={onReconnect} disabled={busy}>
            Reconnect Codex
          </button>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={busy}>
            Refresh catalog
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={onLoginChatGpt}
            disabled={busy}
          >
            Sign in with ChatGPT
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={onToggleApiKey}
            disabled={busy}
          >
            Use API key
          </button>
          <button className="ghost-button" type="button" onClick={onLogout} disabled={busy}>
            Sign out
          </button>
        </div>
        {apiKeyMode && (
          <form
            className="task-composer"
            onSubmit={(event) => {
              event.preventDefault();
              onLoginApiKey();
            }}
          >
            <label>
              OpenAI API key
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => onApiKey(event.target.value)}
                placeholder="Stored by Codex, not GOSU Sync"
                required
                disabled={busy}
              />
            </label>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || apiKey.trim() === ''}
            >
              Connect
            </button>
          </form>
        )}
        <div className="privacy">
          Authentication and the live model catalog are handled by the local Codex App Server. The
          Settings defaults seed new AI work; Project Chat and Lecture can keep their own scoped
          choices. Every turn records the resolved model locally.
        </div>
      </article>
      <SshWorkspaceGrantsCard
        project={activeProject}
        connections={sshConnections}
        workspaces={sshWorkspaces}
        workspaceReady={sshWorkspaceReady}
        busy={sshBusy}
        onCreate={onCreateSshWorkspace}
        onUpdate={onUpdateSshWorkspace}
        onRemove={onRemoveSshWorkspace}
        onEnableTrustedWorkspace={onEnableTrustedWorkspace}
        onRevokeTrustedWorkspace={onRevokeTrustedWorkspace}
        onTest={onTestSshConnection}
        testStatus={sshTestStatus}
        setupRequest={sshWorkspaceSetupRequest}
        onSetupRequestHandled={onSshWorkspaceSetupHandled}
      />
      <article className="card">
        <CardHead title="Local-first boundary" detail="Eligibility policy · delivery is off" />
        <div className="boundary-list">
          <Boundary yes text="Project and Kanban collaboration metadata" />
          <Boundary yes text="Objective drafts and local freeze state" />
          <Boundary text="Repository and manuscript contents" />
          <Boundary text="Raw logs, metric series and artifacts" />
          <Boundary text="Obsidian content and credentials" />
        </div>
      </article>
    </section>
  );
}
