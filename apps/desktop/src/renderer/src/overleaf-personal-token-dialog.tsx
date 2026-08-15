import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { SaveOverleafPersonalTokenInput } from '../../shared/overleaf-personal-token-contracts';
import { OverleafPersonalTokenSettings } from './overleaf-personal-token-settings';
import type { OverleafPersonalTokenUiState } from './overleaf-personal-token-ui';

export function resolveOverleafTokenReturnFocus(
  opener: HTMLElement | null,
  fallback: HTMLElement | null,
) {
  if (opener?.isConnected) return opener;
  return fallback?.isConnected ? fallback : null;
}

export function OverleafPersonalTokenDialog({
  state,
  onRefresh,
  onSave,
  onRemove,
  onClose,
}: {
  state: OverleafPersonalTokenUiState;
  onRefresh: () => Promise<void>;
  onSave: (input: SaveOverleafPersonalTokenInput) => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [operationPending, setOperationPending] = useState(false);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      resolveOverleafTokenReturnFocus(
        returnFocusRef.current,
        document.querySelector<HTMLElement>('[data-overleaf-token-focus-fallback]'),
      )?.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!operationPending) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
    <div className="overleaf-token-dialog-backdrop">
      <aside
        className="overleaf-token-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={operationPending}
        aria-labelledby="overleaf-token-dialog-title"
        onKeyDown={handleKeyDown}
      >
        <header>
          <div>
            <span>OVERLEAF SETTINGS</span>
            <h2 id="overleaf-token-dialog-title">Personal Git token</h2>
            <p>Your current Manuscript or Lecture draft stays open behind this window.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            aria-label="Close Overleaf Settings"
            title="Close"
            disabled={operationPending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="overleaf-token-dialog-body">
          <OverleafPersonalTokenSettings
            state={state}
            onRefresh={onRefresh}
            onSave={onSave}
            onRemove={onRemove}
            onOperationPendingChange={setOperationPending}
          />
        </div>
      </aside>
    </div>
  );
}
