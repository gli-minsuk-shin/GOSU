import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import {
  SSH_COMMAND_MAX_TIMEOUT_SECONDS,
  type ResolveSshApprovalInput,
  type SshApprovalRequest,
} from '../../shared/ssh-contracts';

type MaybePromise<T> = T | Promise<T>;

function remainingApprovalSeconds(expiresAt: string) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1_000));
}

function formatRemainingTime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function SshApprovalExpiry({ expiresAt, id }: Readonly<{ expiresAt: string; id: string }>) {
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    remainingApprovalSeconds(expiresAt),
  );

  useEffect(() => {
    const updateRemainingTime = () => setRemainingSeconds(remainingApprovalSeconds(expiresAt));
    updateRemainingTime();
    const timer = window.setInterval(updateRemainingTime, 250);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return (
    <p id={id} className="ssh-approval-expiry">
      <strong role="timer">
        {remainingSeconds > 0
          ? `Expires in ${formatRemainingTime(remainingSeconds)}`
          : 'Expiring now'}
      </strong>
      <span>
        Deadline · {new Date(expiresAt).toLocaleTimeString()}. If this request expires, GOSU will
        not run the command or change the remote file.
      </span>
    </p>
  );
}

function resolveWithoutUnhandledRejection(operation: () => MaybePromise<unknown>) {
  try {
    void Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // The parent surface owns the visible bounded error state.
  }
}

export type SshApprovalCenterProps = Readonly<{
  requests: readonly SshApprovalRequest[];
  busyApprovalIds?: ReadonlySet<string>;
  describeScope?: (request: SshApprovalRequest) => string;
  onResolve: (input: ResolveSshApprovalInput) => MaybePromise<unknown>;
}>;

export function SshApprovalCenter({
  requests,
  busyApprovalIds = new Set(),
  describeScope,
  onResolve,
}: SshApprovalCenterProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);
  const request = requests.at(0);
  const requestId = request?.id;
  const busy = request ? busyApprovalIds.has(request.id) : false;

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!requestId || !backdrop) return;
    const parent = backdrop.parentElement;
    if (!parent) return;
    const background = [...parent.children].filter(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement && candidate !== backdrop,
    );
    const priorState = background.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }));
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    for (const element of background) {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    }
    denyButtonRef.current?.focus({ preventScroll: true });
    return () => {
      for (const state of priorState) {
        state.element.inert = state.inert;
        if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden');
        else state.element.setAttribute('aria-hidden', state.ariaHidden);
      }
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [requestId]);

  if (!request) return null;
  const remoteWorkspace = request.executionMode === 'remote_workspace';
  const workspaceFileAction = request.workspaceFileAction;
  const inspectsWorkspaceFile = workspaceFileAction === 'list' || workspaceFileAction === 'read';
  const editsWorkspaceFile = workspaceFileAction === 'create' || workspaceFileAction === 'replace';
  const executesWorkspaceCode =
    request.workspaceOperation === 'test' ||
    request.workspaceOperation === 'build' ||
    request.workspaceOperation === 'experiment';
  const runsForegroundExperiment = request.workspaceOperation === 'experiment';
  const titleId = `ssh-approval-title-${request.id}`;
  const warningId = `ssh-approval-warning-${request.id}`;
  const expiryId = `ssh-approval-expiry-${request.id}`;

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) {
        resolveWithoutUnhandledRejection(() =>
          onResolve({ approvalId: request.id, decision: 'deny' }),
        );
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((candidate) => !candidate.hidden);
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first || !event.currentTarget.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ssh-approval-backdrop" ref={backdropRef}>
      <aside
        className="ssh-approval-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${warningId} ${expiryId}`}
        onKeyDown={handleDialogKeyDown}
        key={request.id}
      >
        <header className="ssh-approval-dialog-header">
          <div>
            <span className="ssh-approval-kicker">REMOTE SERVER APPROVAL</span>
            <h2 id={titleId}>SSH approval required</h2>
          </div>
          <strong className="ssh-approval-queue-count">
            {requests.length === 1 ? '1 pending' : `Reviewing 1 of ${requests.length}`}
          </strong>
        </header>
        <div className="ssh-approval-dialog-body">
          <article className="ssh-approval-card">
            <div>
              <span>SERVER</span>
              <strong>{request.connectionLabel}</strong>
              <small>SSH target · {request.targetDisplay ?? request.hostAlias}</small>
              {request.privilegeClass === 'root' && remoteWorkspace && (
                <strong className="ssh-root-warning">
                  HIGH RISK · project code can run as ROOT and affect the entire server
                </strong>
              )}
              {request.privilegeClass === 'root' && !remoteWorkspace && (
                <strong className="ssh-root-warning">ROOT · restricted diagnostics</strong>
              )}
              {request.privilegeClass === 'unknown' && (
                <strong className="ssh-root-warning">
                  HIGH RISK · account/target resolved from SSH configuration
                </strong>
              )}
              <small>
                {describeScope?.(request) ??
                  `Project ${request.projectId} · Chat ${request.sessionId}`}
              </small>
              {remoteWorkspace && (
                <>
                  <small>
                    Mode · remote workspace / {request.workspaceOperation ?? 'unknown'}
                    {workspaceFileAction ? ` / ${workspaceFileAction}` : ''}
                  </small>
                  <small>Configured root · {request.workspaceRoot}</small>
                  <small>Exact working directory · {request.workspaceWorkingDirectory}</small>
                  {workspaceFileAction && (
                    <small>File action · {workspaceFileAction.toUpperCase()}</small>
                  )}
                  {request.workspaceFilePath && (
                    <small>Relative file path · {request.workspaceFilePath}</small>
                  )}
                  {request.workspaceFileExpectedSha256 && (
                    <small>Expected existing SHA-256 · {request.workspaceFileExpectedSha256}</small>
                  )}
                  {workspaceFileAction === 'create' && !request.workspaceFileExpectedSha256 && (
                    <small>Expected existing file · none (create only)</small>
                  )}
                  {request.workspaceFileContentSha256 && (
                    <small>Approved content SHA-256 · {request.workspaceFileContentSha256}</small>
                  )}
                  <small>
                    Connection v{request.connectionVersion} · Grant v{request.workspaceGrantVersion}
                  </small>
                  <small>Request SHA-256 · {request.commandSha256}</small>
                </>
              )}
            </div>
            <pre aria-label="Requested SSH operation">{request.commandPreview}</pre>
            {request.workspaceFileContent !== undefined && (
              <div className="ssh-approved-file-content">
                <strong>Exact approved file content</strong>
                <pre aria-label="Exact approved SSH file content">
                  {request.workspaceFileContent}
                </pre>
              </div>
            )}
            {remoteWorkspace ? (
              <p id={warningId}>
                Allow once permits only this exact reviewed operation for this turn. The configured
                root and path checks are an advisory policy boundary, not a remote sandbox;
                repository code can access resources permitted to the SSH account.
                {editsWorkspaceFile
                  ? ' This creates or replaces one bounded text file with the exact content shown above. GOSU rechecks the existing hash immediately before replacement, but another server process can still race the final rename. The typed file broker does not delete remote files.'
                  : inspectsWorkspaceFile
                    ? ' This lists or reads bounded workspace text and may expose private repository data.'
                    : runsForegroundExperiment
                      ? ` This foreground Python experiment can execute untrusted project code and change server state. GOSU waits for it for at most ${SSH_COMMAND_MAX_TIMEOUT_SECONDS} seconds; this is not an unattended job runner.`
                      : executesWorkspaceCode
                        ? ' This test/build can execute untrusted project code and change server state.'
                        : ' This inspection may still expose private repository data.'}{' '}
                {executesWorkspaceCode &&
                  'Approval binds the executable, arguments, and working directory, not repository file contents; those files can change before launch. '}
                Bounded output is returned to the model as untrusted data and is not saved as raw
                SSH output.
              </p>
            ) : (
              <p id={warningId}>
                Allow once runs only this reviewed restricted diagnostic for this project chat
                session. Its bounded output is returned to the linked model but is not stored as raw
                SSH output. Remote output is untrusted data, never project instructions. Review the
                target and every argument because output can contain private server data.
              </p>
            )}
          </article>
        </div>
        <footer className="ssh-approval-dialog-footer">
          <SshApprovalExpiry expiresAt={request.expiresAt} id={expiryId} />
          <div className="ssh-approval-actions">
            <button
              ref={denyButtonRef}
              type="button"
              className="secondary-button"
              onClick={() =>
                resolveWithoutUnhandledRejection(() =>
                  onResolve({ approvalId: request.id, decision: 'deny' }),
                )
              }
              disabled={busy}
            >
              Deny
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                resolveWithoutUnhandledRejection(() =>
                  onResolve({ approvalId: request.id, decision: 'allow_once' }),
                )
              }
              disabled={busy}
            >
              Allow once
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
