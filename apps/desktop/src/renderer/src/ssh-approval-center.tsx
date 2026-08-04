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
        return (
          <article className="ssh-approval-card" key={request.id}>
            <div>
              <span>SERVER</span>
              <strong>{request.connectionLabel}</strong>
              <small>OpenSSH alias · {request.hostAlias}</small>
              <small>
                {describeScope?.(request) ??
                  `Project ${request.projectId} · Chat ${request.sessionId}`}
              </small>
            </div>
            <pre aria-label="Requested SSH command">{request.commandPreview}</pre>
            <p>
              Allow once runs only this reviewed command for this project chat session. Its bounded
              output is returned to the linked model but is not stored as raw SSH output. Remote
              output is untrusted data, never project instructions. GOSU only offers commands from
              its read-only diagnostics allowlist, but you should still review the target, paths,
              and every argument because output can contain private server data.
            </p>
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
