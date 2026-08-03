import type { RuntimeReadiness } from '../../shared/runtime-contracts';
import { Boundary, CardHead, RuntimeCard } from './ui-primitives';

export type CodexModel = {
  modelId: string;
  displayName: string;
  isDefault: boolean;
  reasoningOptions: Array<{ id: string; label: string; isDefault: boolean }>;
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
}: {
  runtime: RuntimeReadiness | null;
  models: readonly CodexModel[];
  selectedModel: string;
  status: string;
  busy: boolean;
  apiKeyMode: boolean;
  apiKey: string;
  onSelectedModel: (modelId: string) => void;
  onRefresh: () => void;
  onReconnect: () => void;
  onToggleApiKey: () => void;
  onApiKey: (apiKey: string) => void;
  onLoginChatGpt: () => void;
  onLoginApiKey: () => void;
  onLogout: () => void;
}) {
  return (
    <section className="connection-grid">
      <RuntimeCard runtime={runtime} />
      <article className="card codex-card">
        <CardHead title="Local Codex" detail={status} />
        <label>
          Discovered model
          <select
            value={selectedModel}
            onChange={(event) => onSelectedModel(event.target.value)}
            disabled={busy}
          >
            <option value="auto">Auto · provider recommended</option>
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
