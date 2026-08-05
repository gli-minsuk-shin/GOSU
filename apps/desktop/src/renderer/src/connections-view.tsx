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
  GrantedRemoteWorkspace,
  RemoveRemoteWorkspaceGrantInput,
  UpdateRemoteWorkspaceGrantInput,
} from '../../shared/ssh-workspace-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import { SshConnectionsCard } from './ssh-connections-card';
import { SshWorkspaceGrantsCard, type SshWorkspaceSetupRequest } from './ssh-workspace-grants-card';
import { Boundary, CardHead, RuntimeCard } from './ui-primitives';

export type CodexModel = {
  modelId: string;
  displayName: string;
  isDefault: boolean;
  reasoningOptions: Array<{ id: string; label: string; isDefault: boolean }>;
  supportsPersonality?: boolean;
};

export function ConnectionsView({
  runtime,
  models,
  selectedModel,
  status,
  busy,
  apiKeyMode,
  apiKey,
  onSelectedModel,
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
  activeProject,
  sshWorkspaces,
  onCreateSshWorkspace,
  onUpdateSshWorkspace,
  onRemoveSshWorkspace,
  sshWorkspaceSetupRequest = null,
  onSshWorkspaceSetupHandled = () => undefined,
}: {
  runtime: RuntimeReadiness | null;
  models: readonly CodexModel[];
  selectedModel: string | null;
  status: string;
  busy: boolean;
  apiKeyMode: boolean;
  apiKey: string;
  onSelectedModel: (modelId: string | null) => void;
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
  activeProject: ProjectRecord | null;
  sshWorkspaces: readonly GrantedRemoteWorkspace[];
  onCreateSshWorkspace: (input: CreateRemoteWorkspaceGrantInput) => Promise<unknown>;
  onUpdateSshWorkspace: (input: UpdateRemoteWorkspaceGrantInput) => Promise<unknown>;
  onRemoveSshWorkspace: (input: RemoveRemoteWorkspaceGrantInput) => Promise<unknown>;
  sshWorkspaceSetupRequest?: SshWorkspaceSetupRequest | null;
  onSshWorkspaceSetupHandled?: (requestId: number) => void;
}) {
  return (
    <section className="connection-grid">
      <SshConnectionsCard
        connections={sshConnections}
        busy={sshBusy}
        testStatus={sshTestStatus}
        onCreate={onCreateSshConnection}
        onImport={onImportSshCommand}
        onUpdate={onUpdateSshConnection}
        onRemove={onRemoveSshConnection}
        onTest={onTestSshConnection}
      />
      <RuntimeCard runtime={runtime} />
      <article className="card codex-card">
        <CardHead title="Local Codex" detail={status} />
        <label>
          Discovered model
          <select
            value={selectedModel ?? ''}
            onChange={(event) => onSelectedModel(event.target.value || null)}
            disabled={busy}
          >
            <option value="">Auto · provider recommended</option>
            {models.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.displayName}
                {model.isDefault ? ' · default' : ''}
              </option>
            ))}
          </select>
        </label>
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
          selected model is used by Project chat and every turn records the resolved model locally.
        </div>
      </article>
      <SshWorkspaceGrantsCard
        project={activeProject}
        connections={sshConnections}
        workspaces={sshWorkspaces}
        busy={sshBusy}
        onCreate={onCreateSshWorkspace}
        onUpdate={onUpdateSshWorkspace}
        onRemove={onRemoveSshWorkspace}
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
