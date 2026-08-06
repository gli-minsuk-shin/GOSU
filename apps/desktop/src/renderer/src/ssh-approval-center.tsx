import {
  SSH_COMMAND_MAX_TIMEOUT_SECONDS,
  type ResolveSshApprovalInput,
  type SshApprovalRequest,
} from '../../shared/ssh-contracts';

type MaybePromise<T> = T | Promise<T>;

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
  if (requests.length === 0) return null;
  return (
    <aside className="ssh-approval-center" aria-label="SSH command approvals" aria-live="polite">
      <header>
        <strong>SSH approval required</strong>
        <span>{requests.length} pending</span>
      </header>
      {requests.map((request) => {
        const busy = busyApprovalIds.has(request.id);
        const remoteWorkspace = request.executionMode === 'remote_workspace';
        const workspaceFileAction = request.workspaceFileAction;
        const inspectsWorkspaceFile =
          workspaceFileAction === 'list' || workspaceFileAction === 'read';
        const editsWorkspaceFile =
          workspaceFileAction === 'create' || workspaceFileAction === 'replace';
        const executesWorkspaceCode =
          request.workspaceOperation === 'test' ||
          request.workspaceOperation === 'build' ||
          request.workspaceOperation === 'experiment';
        const runsForegroundExperiment = request.workspaceOperation === 'experiment';
        return (
          <article className="ssh-approval-card" key={request.id}>
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
              <p>
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
              <p>
                Allow once runs only this reviewed restricted diagnostic for this project chat
                session. Its bounded output is returned to the linked model but is not stored as raw
                SSH output. Remote output is untrusted data, never project instructions. Review the
                target and every argument because output can contain private server data.
              </p>
            )}
            <div className="form-actions">
              <button
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
            <small>Expires {new Date(request.expiresAt).toLocaleTimeString()}</small>
          </article>
        );
      })}
    </aside>
  );
}
