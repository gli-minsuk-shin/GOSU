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
    trash_empty: 'Project Trash is already empty.',
    trash_busy:
      'Trash was not emptied because Project Chat, SSH, or lecture work is still running. Stop or finish that work and try again.',
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
    chat_queue_not_found: 'That queued message already started, moved, or was removed.',
    chat_queue_limit_reached:
      'This chat already has 50 queued messages. Let one run or remove one before adding more.',
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
      'Connect this project’s Research Notes folder before authorizing it for chat.',
    local_notes_vault_changed:
      'This project’s Research Notes binding changed. Review the Obsidian folder and authorize it again.',
    invalid_research_notes_input: 'Check the Research Notes request and try again.',
    research_notes_project_not_found:
      'This Research Notes project no longer exists. Reload the workspace and try again.',
    research_notes_project_unavailable:
      'Research Notes are available only while this project is active. Restore it first.',
    research_notes_vault_not_selected:
      'Choose an Obsidian Vault before opening this project’s Research Notes.',
    research_notes_vault_changed:
      'The selected Obsidian Vault changed. GOSU kept the existing project notes untouched.',
    research_notes_folder_conflict:
      'That Obsidian project folder already exists and cannot be safely replaced.',
    research_notes_folder_unavailable:
      'This project’s Obsidian folder is unavailable. Existing notes were not changed.',
    research_notes_note_not_found:
      'This note is no longer available inside the selected project folder.',
    research_notes_record_not_found:
      'This Literature record is no longer available, so no paper note was created.',
    research_notes_unavailable:
      'Research Notes are unavailable. Existing Obsidian files were not changed.',
    research_notes_save_commit_uncertain:
      'The Research Notes save could not be confirmed. Check the project folder before retrying; the file may already exist.',
    research_notes_markdown_too_large:
      'This Markdown file is too large for the Research Notes reader. Split it into smaller notes and try again.',
    attachment_invalid:
      'This file is damaged or does not match its file type. Choose a valid local file.',
    attachment_unsupported:
      'This file type is not supported yet. Use PDF, DOCX, PPTX, HWPX, text, or a common raster image. Export legacy .ppt files as .pptx first.',
    attachment_too_large: 'Each attachment must be 20 MB or smaller and within decode limits.',
    attachment_total_too_large: 'The attachments in one message must total 50 MB or less.',
    attachment_too_many: 'Attach no more than five files to one message.',
    attachment_encrypted: 'Password-protected attachments cannot be read yet.',
    attachment_archive_limit:
      'This document expands beyond the safe archive limit and was not opened.',
    attachment_extraction_failed:
      'GOSU could not safely reconstruct content from this file. Try exporting it again.',
    attachment_expired: 'This one-time attachment expired. Attach it again.',
    attachment_scope_mismatch:
      'This file belongs to another project or chat session. Attach it here again.',
    attachment_capacity_exhausted:
      'Too many one-time files are already waiting or being analyzed. Send or remove them, then try again.',
    attachment_model_modality_unsupported:
      'The selected model cannot inspect images. Choose an image-capable model, attach the image again, and resend.',
    action_not_found: 'This proposed project action no longer exists.',
    action_not_proposed: 'This project action was already handled.',
    invalid_chat_input: 'Check the chat message and model selection, then try again.',
    codex_unavailable: 'Codex is unavailable. Board and Research Notes remain usable.',
    chat_unavailable: 'Project chat is unavailable. Existing local messages were not replaced.',
    invalid_experiment_input: 'Check the experiment fields and try again.',
    experiment_project_not_found:
      'This project no longer exists. Reload the workspace before opening Experiments.',
    experiment_project_unavailable:
      'Experiments are available only while this project is active. Restore it first.',
    experiment_idea_not_found:
      'This experiment idea no longer exists in the selected project. Refresh and try again.',
    experiment_parent_not_found:
      'The parent idea is no longer available in this project. Choose another branch point.',
    experiment_idea_conflict:
      'This idea changed since it was opened. GOSU kept the newer version and did not overwrite it.',
    experiment_idea_limit_reached: 'This project has reached its local experiment-idea limit.',
    experiment_metric_limit_reached:
      'This project has reached its local experiment-metric history limit.',
    experiment_objective_required:
      'Freeze the latest Goal & Metrics revision before recording experiment evidence.',
    experiment_unavailable:
      'The local experiment workspace is unavailable. Existing experiment evidence was not replaced.',
    invalid_ssh_input: 'Check the SSH server name or alias and try again.',
    ssh_import_invalid_command:
      'Use ssh with only -p, -l, one user@host destination, and optional loopback-only -L forwarding.',
    ssh_connection_not_found: 'This SSH server profile no longer exists. Refresh Connections.',
    ssh_connection_version_conflict:
      'This SSH server profile changed since it was opened. The newer version was not overwritten.',
    ssh_connection_limit_reached: 'This Mac has reached the SSH server profile limit.',
    ssh_workspace_grant_not_found:
      'This project remote workspace grant no longer exists. Refresh Connections.',
    ssh_workspace_grant_conflict:
      'This project remote workspace grant changed since it was opened. Review the latest version.',
    ssh_workspace_grant_limit_reached: 'This project has reached the remote workspace grant limit.',
    ssh_workspace_project_unavailable:
      'Remote workspace access is available only for an active, non-archived project.',
    ssh_workspace_command_not_allowed:
      'GOSU blocked this remote workspace command or permission mode. Use an approved bounded text file action, smaller Git inspection, direct test/build command, or relative Python experiment entrypoint.',
    ssh_workspace_file_not_found:
      'This remote workspace text file no longer exists. Refresh the file list before continuing.',
    ssh_workspace_file_conflict:
      'This remote workspace file changed after review, so GOSU did not replace it. Read the latest version and review a new change.',
    ssh_workspace_file_not_allowed:
      'GOSU blocked this remote file path or action. Choose a bounded text file inside the approved project workspace.',
    ssh_workspace_file_too_large:
      'This remote file or proposed content is too large for one approved Project Chat action.',
    ssh_workspace_file_invalid:
      'The remote file response was invalid or could not be confirmed. Re-read the same path before assuming whether a requested write changed it.',
    ssh_workspace_file_commit_uncertain:
      'The remote write may have committed before confirmation failed. Read the same path and compare its SHA-256 before retrying.',
    ssh_workspace_file_helper_unavailable:
      'This server does not provide the required /usr/bin/python3 file-broker runtime. Configure Python 3 on the server or choose another workspace; no retry was started.',
    ssh_trusted_workspace_not_allowed:
      'Trusted workspace requires a standard non-root SSH user and an exact Workspace-mode grant.',
    ssh_trusted_workspace_expired:
      'Trusted workspace expired because its project, server, grant, path, or safety policy changed. Retry with Allow once or review and enable trust again.',
    ssh_trusted_workspace_audit_failed:
      'GOSU could not record the trusted-operation audit, so the remote operation was not started.',
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
  const code = Object.keys(messages)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => error.message.includes(candidate));
  return code ? messages[code]! : 'The operation could not be completed.';
}
