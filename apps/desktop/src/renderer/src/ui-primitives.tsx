import type { RuntimeReadiness } from '../../shared/runtime-contracts';

export function RuntimeCard({ runtime }: { runtime: RuntimeReadiness | null }) {
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
                ? 'Local runtime ready'
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

export function CardHead({ title, detail, id }: { title: string; detail: string; id?: string }) {
  return (
    <header className="card-head">
      <h2 id={id}>{title}</h2>
      <span>{detail}</span>
    </header>
  );
}

export function Connection({
  name,
  state,
  ready,
}: {
  name: string;
  state: string;
  ready: boolean;
}) {
  return (
    <div className="connection">
      <i className={ready ? '' : 'warn'} />
      <span>{name}</span>
      <b>{state}</b>
    </div>
  );
}

export function Boundary({ yes = false, text }: { yes?: boolean; text: string }) {
  return (
    <div className="boundary">
      <span className={yes ? 'yes' : ''}>{yes ? 'FUTURE SYNC' : 'LOCAL'}</span>
      <b>{text}</b>
    </div>
  );
}

export function describeError(error: unknown) {
  if (!(error instanceof Error)) return 'The operation could not be completed.';
  const messages: Record<string, string> = {
    project_not_found: 'This project no longer exists. Reload the workspace and try again.',
    task_not_found: 'This task no longer exists.',
    cross_project_access_denied: 'A task cannot be changed from another project.',
    objective_not_found: 'Save an objective before using revision controls.',
    objective_locked: 'This objective is frozen. Start a new revision before editing it.',
    objective_not_locked: 'Freeze the current objective before starting a new revision.',
    version_conflict:
      'This item changed since it was opened. The newer version was not overwritten.',
    invalid_workspace_input: 'Check the workspace fields and try again.',
    workspace_data_requires_recovery:
      'Local workspace metadata needs recovery. Restart the latest GOSU build; existing data was not replaced.',
    workspace_unavailable:
      'The encrypted local workspace is unavailable. Your existing data was not replaced.',
    chat_busy: 'This project already has an active Codex turn. Stop it or wait for completion.',
    chat_not_active: 'There is no active Codex turn to stop for this project.',
    chat_attempt_not_found:
      'The saved turn to retry is no longer available in this project. Send it as a new turn.',
    chat_attempt_not_retryable: 'Only failed or interrupted Codex turns can be retried.',
    action_not_found: 'This proposed project action no longer exists.',
    action_not_proposed: 'This project action was already handled.',
    invalid_chat_input: 'Check the chat message and model selection, then try again.',
    codex_unavailable: 'Codex is unavailable. Board and local notes remain usable.',
    chat_unavailable: 'Project chat is unavailable. Existing local messages were not replaced.',
  };
  const code = Object.keys(messages).find((candidate) => error.message.includes(candidate));
  return code ? messages[code]! : 'The operation could not be completed.';
}
