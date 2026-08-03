import { useEffect, useState } from 'react';

import type { RuntimeReadiness } from '../../main/runtime-readiness';

type Model = {
  modelId: string;
  displayName: string;
  isDefault: boolean;
  reasoningOptions: Array<{ id: string; label: string; isDefault: boolean }>;
};

export function DesktopApp() {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState('auto');
  const [status, setStatus] = useState('Catalog not loaded');
  const [runtime, setRuntime] = useState<RuntimeReadiness | null>(null);
  const [vault, setVault] = useState<{ root: string; files: string[] } | null>(null);
  const [selectedNote, setSelectedNote] = useState<{ path: string; content: string } | null>(null);
  const [apiKeyMode, setApiKeyMode] = useState(false);
  const [apiKey, setApiKey] = useState('');

  const refreshModels = async () => {
    setStatus('Reading the live Codex model catalog…');
    try {
      const next = (await window.gosu.codex.listModels()) as Model[];
      setModels(next);
      setStatus(`${next.length} models available locally`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Codex is unavailable');
    }
  };

  useEffect(() => {
    void window.gosu.runtime
      .readiness()
      .then((next: RuntimeReadiness) => {
        setRuntime(next);
        setStatus(
          next.codex.ready
            ? 'Codex is available · load the catalog when needed'
            : 'Codex executable is unavailable',
        );
      })
      .catch(() => setStatus('Runtime readiness check failed'));
  }, []);

  const chooseVault = async () => {
    const result = (await window.gosu.vault.choose()) as { root: string; files: string[] } | null;
    if (result) setVault(result);
  };

  return (
    <main className="desktop-shell">
      <header className="titlebar">
        <div className="logo">G</div>
        <strong>GOSU</strong>
        <span>Local Research Workspace · Demo</span>
        <i />
        <button disabled>{runtime?.syncApi.ready ? 'Sync API ready' : 'Sync offline'}</button>
        <b>MS</b>
      </header>
      <aside className="desktop-nav">
        <small>PROJECT</small>
        <h2>Demo · Efficient Vision Adaptation</h2>
        {[
          'Research cockpit',
          'Goal & Metrics',
          'Experiments',
          'Manuscript',
          'Review',
          'References',
          'Local notes',
          'Lecture slides',
        ].map((item, index) => (
          <button className={index === 0 ? 'active' : ''} key={item}>
            <span>{['⌂', '◎', '⌁', '¶', '✓', '⌘', '◇', '▹'][index]}</span>
            {item}
          </button>
        ))}
        <div className="nav-spacer" />
        <small>LOCAL CONNECTIONS</small>
        <Connection
          name="Codex"
          state={
            models.length
              ? 'Connected'
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
          state={runtime === null ? 'Checking' : runtime.syncApi.ready ? 'Ready' : 'Offline'}
          ready={Boolean(runtime?.syncApi.ready)}
        />
        <Connection name="Runner" state="Not configured" ready={false} />
        <Connection
          name="Obsidian"
          state={vault ? 'Selected' : 'Choose folder'}
          ready={Boolean(vault)}
        />
      </aside>
      <section className="desktop-content">
        <div className="welcome">
          <div>
            <span>DEMO RESEARCH COCKPIT</span>
            <h1>Runtime checked. Explore the demo workspace.</h1>
            <p>
              Runtime indicators are live. Research metrics, campaigns and approvals below are
              illustrative until you connect a project.
            </p>
          </div>
          <button disabled>＋ Demo experiment</button>
        </div>
        <div className="desktop-grid">
          <RuntimeCard runtime={runtime} />
          <article className="card objective">
            <CardHead title="Goal & locked metric" detail="Demo objective" />
            <p>
              Improve parameter-efficient adaptation while preserving calibration on the held-out
              validation split.
            </p>
            <div className="metric">
              <div>
                <span>PRIMARY METRIC</span>
                <b>Validation accuracy</b>
              </div>
              <strong>87.4%</strong>
            </div>
            <div className="progress">
              <i style={{ width: '72%' }} />
            </div>
            <footer>
              <span>Baseline 83.6%</span>
              <span>Target 89.0%</span>
            </footer>
          </article>
          <article className="card codex-card">
            <CardHead title="Local Codex" detail={status} />
            <label>
              Model
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
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
              <button onClick={() => void refreshModels()}>Refresh catalog</button>
              <button onClick={() => void window.gosu.codex.loginChatGpt()}>
                Sign in with ChatGPT
              </button>
              <button onClick={() => setApiKeyMode(!apiKeyMode)}>Use API key</button>
            </div>
            {apiKeyMode && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void window.gosu.codex.loginApiKey(apiKey).finally(() => setApiKey(''));
                }}
              >
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="API key stays in the Codex credential store"
                />
                <button>Connect</button>
              </form>
            )}
            <div className="privacy">
              ▣ Authentication is handled by the local Codex App Server and is never sent to GOSU
              Sync.
            </div>
          </article>
          <article className="card run-card">
            <CardHead title="Demo campaign" detail="Illustrative trial 8 of 20" />
            <div className="run-line">
              <i />
              <div>
                <b>adapter rank 24 · dropout 0.10</b>
                <span>Runner 01 · 00:18:42</span>
              </div>
              <strong>SIMULATED</strong>
            </div>
            <div className="mini-chart">
              {[20, 32, 28, 46, 54, 49, 72, 83].map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
            <footer>
              <span>Best 87.4%</span>
              <button>Pause after trial</button>
            </footer>
          </article>
          <article className="card approvals">
            <CardHead title="Demo approval inbox" detail="Illustrative review items" />
            <Approval title="Code change proposal" meta="adapter.py · +18 −6" tone="orange" />
            <Approval title="Evidence candidate" meta="+0.7% validation accuracy" tone="green" />
            <Approval
              title="Reviewer finding"
              meta="Results section · citation check"
              tone="blue"
            />
          </article>
          <article className="card vault-card">
            <CardHead
              title="Local Obsidian reader"
              detail={vault ? vault.root : 'No folder selected'}
            />
            {!vault ? (
              <button className="choose" onClick={() => void chooseVault()}>
                Choose a read-only folder
              </button>
            ) : (
              <div className="vault-browser">
                <div>
                  {vault.files.slice(0, 6).map((file) => (
                    <button
                      key={file}
                      onClick={async () =>
                        setSelectedNote(
                          (await window.gosu.vault.read(file)) as { path: string; content: string },
                        )
                      }
                    >
                      {file}
                    </button>
                  ))}
                </div>
                <pre>
                  {selectedNote?.content ??
                    'Select a Markdown note. Its contents remain on this Mac.'}
                </pre>
              </div>
            )}
          </article>
          <article className="card local-data">
            <CardHead title="Local-first boundary" detail="What leaves this Mac" />
            <Boundary yes text="Visible chat messages" />
            <Boundary yes text="Kanban, approvals and run summaries" />
            <Boundary text="Repository and manuscript contents" />
            <Boundary text="Raw logs, metrics and artifacts" />
            <Boundary text="Obsidian content and credentials" />
          </article>
        </div>
      </section>
    </main>
  );
}

function RuntimeCard({ runtime }: { runtime: RuntimeReadiness | null }) {
  const state = runtime?.status ?? 'checking';
  return (
    <article className={`runtime-card ${state}`} aria-live="polite">
      <div className="runtime-summary">
        <i />
        <div>
          <span>LOCAL RUNTIME</span>
          <strong>
            {state === 'checking'
              ? 'Checking this Mac…'
              : state === 'ready'
                ? 'Ready for connected work'
                : 'Local workspace ready with limited connections'}
          </strong>
        </div>
        <b>{state.toUpperCase()}</b>
      </div>
      <div className="runtime-checks">
        <RuntimeCheck
          label="App"
          value={
            runtime
              ? `v${runtime.app.version} · ${runtime.app.platform === 'darwin' ? 'macOS' : runtime.app.platform} · ${runtime.app.packaged ? 'Installed' : 'Development'}`
              : 'Checking'
          }
          ready={Boolean(runtime)}
        />
        <RuntimeCheck
          label="Local data"
          value={runtime?.localData.ready ? 'Encrypted store ready' : 'Unavailable'}
          ready={Boolean(runtime?.localData.ready)}
        />
        <RuntimeCheck
          label="Codex"
          value={runtime?.codex.ready ? 'Available' : 'Unavailable'}
          ready={Boolean(runtime?.codex.ready)}
        />
        <RuntimeCheck
          label="Sync API"
          value={runtime?.syncApi.ready ? 'Reachable' : 'Offline'}
          ready={Boolean(runtime?.syncApi.ready)}
        />
      </div>
    </article>
  );
}

function RuntimeCheck({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div>
      <i className={ready ? '' : 'warn'} />
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function CardHead({ title, detail }: { title: string; detail: string }) {
  return (
    <header className="card-head">
      <h3>{title}</h3>
      <span>{detail}</span>
    </header>
  );
}
function Connection({ name, state, ready }: { name: string; state: string; ready: boolean }) {
  return (
    <div className="connection">
      <i className={ready ? '' : 'warn'} />
      <span>{name}</span>
      <b>{state}</b>
    </div>
  );
}
function Approval({ title, meta, tone }: { title: string; meta: string; tone: string }) {
  return (
    <div className="approval">
      <i className={tone} />
      <div>
        <b>{title}</b>
        <span>{meta}</span>
      </div>
      <button>Review →</button>
    </div>
  );
}
function Boundary({ yes = false, text }: { yes?: boolean; text: string }) {
  return (
    <div className="boundary">
      <span className={yes ? 'yes' : 'no'}>{yes ? 'SYNC' : 'LOCAL'}</span>
      <b>{text}</b>
    </div>
  );
}
