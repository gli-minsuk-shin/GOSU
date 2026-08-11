import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import type {
  HermesAcpApprovalDecision,
  HermesAcpApprovalRequest,
  ResolveHermesAcpApprovalInput,
} from '../../shared/hermes-acp-approval-contracts';

type MaybePromise<T> = T | Promise<T>;

const APPROVAL_BUTTON_LABELS: Readonly<Record<HermesAcpApprovalDecision, string>> = {
  allow_once: 'Allow once',
  allow_session: 'Allow for session',
  deny: 'Deny',
};

function remainingApprovalSeconds(expiresAt: string) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1_000));
}

function formatRemainingTime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function resolveWithoutUnhandledRejection(operation: () => MaybePromise<unknown>) {
  try {
    void Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // The parent surface owns the visible bounded error state.
  }
}

function HermesAcpApprovalExpiry({ expiresAt, id }: Readonly<{ expiresAt: string; id: string }>) {
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
    <p id={id} className="ssh-approval-expiry hermes-acp-approval-expiry">
      <strong role="timer">
        {remainingSeconds > 0
          ? `Expires in ${formatRemainingTime(remainingSeconds)}`
          : 'Expiring now'}
      </strong>
      <span>
        Deadline · {new Date(expiresAt).toLocaleTimeString()}. If this request expires, Hermes will
        not receive approval from GOSU.
      </span>
    </p>
  );
}

export type HermesAcpApprovalCenterProps = Readonly<{
  requests: readonly HermesAcpApprovalRequest[];
  busyApprovalIds?: ReadonlySet<string>;
  describeScope?: (request: HermesAcpApprovalRequest) => string;
  onResolve: (input: ResolveHermesAcpApprovalInput) => MaybePromise<unknown>;
}>;

export function HermesAcpApprovalCenter({
  requests,
  busyApprovalIds = new Set(),
  describeScope,
  onResolve,
}: HermesAcpApprovalCenterProps) {
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

  const titleId = `hermes-acp-approval-title-${request.id}`;
  const warningId = `hermes-acp-approval-warning-${request.id}`;
  const expiryId = `hermes-acp-approval-expiry-${request.id}`;

  const resolve = (decision: HermesAcpApprovalDecision) => {
    if (busy || !request.options.includes(decision)) return;
    resolveWithoutUnhandledRejection(() => onResolve({ approvalId: request.id, decision }));
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      resolve('deny');
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

  const orderedDecisions: readonly HermesAcpApprovalDecision[] = [
    'deny',
    'allow_session',
    'allow_once',
  ];

  return (
    <div
      className="ssh-approval-backdrop hermes-acp-approval-backdrop"
      ref={backdropRef}
      data-hermes-acp-approval-backdrop
    >
      <aside
        className="ssh-approval-dialog hermes-acp-approval-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${warningId} ${expiryId}`}
        onKeyDown={handleDialogKeyDown}
        key={request.id}
      >
        <header className="ssh-approval-dialog-header hermes-acp-approval-dialog-header">
          <div>
            <span className="ssh-approval-kicker hermes-acp-approval-kicker">
              HERMES AGENT APPROVAL
            </span>
            <h2 id={titleId}>Hermes permission required</h2>
          </div>
          <strong className="ssh-approval-queue-count hermes-acp-approval-queue-count">
            {requests.length === 1 ? '1 pending' : `Reviewing 1 of ${requests.length}`}
          </strong>
        </header>

        <div className="ssh-approval-dialog-body hermes-acp-approval-dialog-body">
          <article className="ssh-approval-card hermes-acp-approval-card">
            <div>
              <span>REQUEST</span>
              <strong>{request.title}</strong>
              <small>Kind · {request.kind}</small>
              <small>
                {describeScope?.(request) ??
                  `Project ${request.projectId} · Chat ${request.sessionId}`}
              </small>
            </div>

            <p dir="auto">{request.safeSummary.text}</p>
            {request.safeSummary.commandPreview && (
              <pre dir="ltr" aria-label="Reviewed Hermes command summary">
                {request.safeSummary.commandPreview}
              </pre>
            )}
            {request.editPreview && (
              <section className="hermes-acp-edit-preview" aria-label="Proposed file edit">
                <strong>File · {request.editPreview.path}</strong>
                <div>
                  <span>
                    Before{request.editPreview.oldTextTruncated ? ' · preview truncated' : ''}
                  </span>
                  <pre dir="auto">{request.editPreview.oldText ?? '[New file]'}</pre>
                </div>
                <div>
                  <span>
                    After{request.editPreview.newTextTruncated ? ' · preview truncated' : ''}
                  </span>
                  <pre dir="auto">{request.editPreview.newText}</pre>
                </div>
              </section>
            )}

            <p id={warningId}>
              Review this bounded preview carefully. GOSU does not persist the structured raw Hermes
              tool payload or tool output, but this preview is derived from the request and may
              contain sensitive command arguments. Allow once applies to this request only. Allow
              for session applies only to matching requests in this active Hermes session and ends
              when that session closes.
            </p>
          </article>
        </div>

        <footer className="ssh-approval-dialog-footer hermes-acp-approval-dialog-footer">
          <HermesAcpApprovalExpiry expiresAt={request.expiresAt} id={expiryId} />
          <div className="ssh-approval-actions hermes-acp-approval-actions">
            {orderedDecisions.map((decision) =>
              request.options.includes(decision) ? (
                <button
                  ref={decision === 'deny' ? denyButtonRef : undefined}
                  key={decision}
                  type="button"
                  className={decision === 'allow_once' ? 'primary-button' : 'secondary-button'}
                  onClick={() => resolve(decision)}
                  disabled={busy}
                >
                  {APPROVAL_BUTTON_LABELS[decision]}
                </button>
              ) : null,
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}
