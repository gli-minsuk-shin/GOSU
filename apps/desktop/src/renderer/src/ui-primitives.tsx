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
    project_archived: 'This project is archived. Restore it to active before making changes.',
    project_not_archived: 'This project is already active.',
    project_trashed: 'This project is in Trash. Restore it before making changes.',
    project_not_trashed: 'This project is already active.',
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
    chat_profile_conflict:
      'This project agent profile changed since it was opened. GOSU reloaded the current version.',
    chat_session_not_found:
      'This chat session no longer exists in the selected project. Choose another session.',
    chat_branch_message_not_found: 'That branch point is not part of the selected chat session.',
    chat_branch_point_invalid: 'Wait for this turn to finish before branching from that message.',
    chat_branch_lineage_invalid:
      'This chat lineage could not be verified, so GOSU did not create the branch.',
    chat_branch_limit_reached:
      'This chat is too deep or long to branch safely. Start a new chat instead.',
    chat_session_limit_reached:
      'This project has reached its local chat-session limit. Rename and reuse an existing chat.',
    local_notes_vault_not_selected:
      'Choose a Local Notes folder before authorizing it for this project.',
    local_notes_vault_changed:
      'The selected Local Notes folder changed. Review it and authorize the current folder again.',
    action_not_found: 'This proposed project action no longer exists.',
    action_not_proposed: 'This project action was already handled.',
    invalid_chat_input: 'Check the chat message and model selection, then try again.',
    codex_unavailable: 'Codex is unavailable. Board and local notes remain usable.',
    chat_unavailable: 'Project chat is unavailable. Existing local messages were not replaced.',
    invalid_ssh_input: 'Check the SSH server name or alias and try again.',
    ssh_connection_not_found: 'This SSH server profile no longer exists. Refresh Connections.',
    ssh_connection_version_conflict:
      'This SSH server profile changed since it was opened. The newer version was not overwritten.',
    ssh_connection_limit_reached: 'This Mac has reached the SSH server profile limit.',
    ssh_approval_not_found: 'This SSH approval is no longer pending.',
    ssh_approval_denied: 'The SSH command was denied and was not started.',
    ssh_approval_expired: 'The SSH approval expired and the command was not started.',
    ssh_approval_cancelled: 'The SSH approval or command was cancelled.',
    ssh_command_not_allowed:
      'GOSU blocked this SSH command shape or high-risk command. Use a smaller non-interactive command.',
    ssh_unknown_host_key:
      'This server host key is not trusted yet. Verify its fingerprint and connect once in Terminal.',
    ssh_authentication_failed:
      'SSH authentication failed. Check this alias, ssh-agent, and Keychain in Terminal.',
    ssh_connection_failed: 'The SSH connection failed. Board and existing chat remain available.',
    ssh_timed_out: 'The SSH connection or command timed out.',
    ssh_output_too_large: 'The SSH command produced more output than this chat tool can accept.',
    ssh_cancelled:
      'The local SSH transport was stopped. The remote process may require separate verification.',
    ssh_capacity_exceeded:
      'Too many SSH commands are awaiting approval or running. Try again later.',
    ssh_unavailable: 'Local SSH is unavailable. Board and existing chat remain available.',
  };
  const code = Object.keys(messages).find((candidate) => error.message.includes(candidate));
  return code ? messages[code]! : 'The operation could not be completed.';
}
