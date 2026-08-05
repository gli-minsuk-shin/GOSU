import type { ResolveSshApprovalInput, SshApprovalRequest } from '../../shared/ssh-contracts';

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
        const executesWorkspaceCode =
          request.workspaceOperation === 'test' || request.workspaceOperation === 'build';
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
                  <small>Mode · remote workspace / {request.workspaceOperation ?? 'unknown'}</small>
                  <small>Configured root · {request.workspaceRoot}</small>
                  <small>Exact working directory · {request.workspaceWorkingDirectory}</small>
                  <small>
                    Connection v{request.connectionVersion} · Grant v{request.workspaceGrantVersion}
                  </small>
                  <small>Command SHA-256 · {request.commandSha256}</small>
                </>
              )}
            </div>
            <pre aria-label="Requested SSH command">{request.commandPreview}</pre>
            {remoteWorkspace ? (
              <p>
                Allow once runs only this exact direct-argv command for this turn. The configured
                root and path checks are an advisory policy boundary, not a remote sandbox; symlinks
                and repository code can access resources permitted to the SSH account.
                {executesWorkspaceCode
                  ? ' This test/build can execute untrusted project code and change server state.'
                  : ' This inspection may still expose private repository data.'}{' '}
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
