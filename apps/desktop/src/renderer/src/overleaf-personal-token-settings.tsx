import { useEffect, useState, type FormEvent } from 'react';

import type { SaveOverleafPersonalTokenInput } from '../../shared/overleaf-personal-token-contracts';
import {
  describeOverleafPersonalTokenError,
  OVERLEAF_PERSONAL_TOKEN_CLEAR_CONFIRMATION,
  overleafPersonalTokenStatusLabel,
  type OverleafPersonalTokenUiState,
} from './overleaf-personal-token-ui';

export function OverleafPersonalTokenSettings({
  state,
  onRefresh,
  onSave,
  onRemove,
  onOperationPendingChange,
}: {
  state: OverleafPersonalTokenUiState;
  onRefresh: () => Promise<void>;
  onSave: (input: SaveOverleafPersonalTokenInput) => Promise<void>;
  onRemove: () => Promise<void>;
  onOperationPendingChange?: (pending: boolean) => void;
}) {
  const [accessToken, setAccessToken] = useState('');
  const [operation, setOperation] = useState<'refresh' | 'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = state === 'configured';
  const unavailable = state === 'unavailable';
  const canClear = configured || unavailable;
  const busy = operation !== null || state === 'loading';

  useEffect(() => {
    onOperationPendingChange?.(operation !== null);
  }, [onOperationPendingChange, operation]);

  const refresh = async () => {
    if (busy) return;
    setOperation('refresh');
    setError(null);
    try {
      await onRefresh();
    } catch (refreshError) {
      setError(describeOverleafPersonalTokenError(refreshError));
    } finally {
      setOperation(null);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || accessToken.length === 0) return;
    const token = accessToken;
    setAccessToken('');
    setOperation('save');
    setError(null);
    try {
      await onSave({ accessToken: token });
    } catch (saveError) {
      setError(describeOverleafPersonalTokenError(saveError));
    } finally {
      setOperation(null);
    }
  };

  const remove = async () => {
    if (busy || !canClear || !window.confirm(OVERLEAF_PERSONAL_TOKEN_CLEAR_CONFIRMATION)) return;
    setAccessToken('');
    setOperation('remove');
    setError(null);
    try {
      await onRemove();
    } catch (removeError) {
      setError(describeOverleafPersonalTokenError(removeError));
    } finally {
      setOperation(null);
    }
  };

  return (
    <article className="settings-card overleaf-token-settings-card">
      <div className="settings-card-heading overleaf-token-settings-heading">
        <div>
          <span>OVERLEAF</span>
          <h2>Use one token for every new Overleaf link</h2>
          <p>
            Save it once, then Manuscript and Lecture Studio use it automatically when you link a
            new Overleaf project.
          </p>
        </div>
        <span className={`overleaf-token-status state-${state}`} role="status">
          <i aria-hidden="true" />
          {overleafPersonalTokenStatusLabel(state)}
        </span>
      </div>

      {error && (
        <div className="error-banner overleaf-token-error" role="alert">
          {error}
        </div>
      )}

      {unavailable && (
        <div className="overleaf-token-unavailable">
          <div>
            <strong>GOSU could not read the saved token</strong>
            <span>Retry the check, or replace or clear the saved data to recover.</span>
          </div>
          <button type="button" className="secondary-button" onClick={() => void refresh()}>
            {operation === 'refresh' ? 'Checking…' : 'Retry'}
          </button>
        </div>
      )}

      <form className="overleaf-token-form" onSubmit={(event) => void save(event)}>
        <label>
          Personal Git token
          <input
            type="password"
            value={accessToken}
            maxLength={2_048}
            placeholder={
              configured || unavailable ? 'Enter a new token to replace it' : 'Enter your token'
            }
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => setAccessToken(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="primary-button"
          disabled={busy || accessToken.length === 0}
        >
          {operation === 'save' ? 'Saving…' : configured || unavailable ? 'Replace' : 'Save'}
        </button>
      </form>

      <div className="overleaf-token-privacy-note">
        <strong>The token is never shown again.</strong>
        <span>
          GOSU encrypts it on this Mac using operating-system secure storage. Each new link receives
          its own encrypted, workspace-bound copy.
        </span>
      </div>

      <div className="overleaf-token-clear-row">
        <div>
          <strong>Future links only</strong>
          <span>
            Existing linked manuscripts keep working when this token is replaced or cleared. Clear
            removes GOSU’s saved copy; it does not revoke the token in Overleaf.
          </span>
        </div>
        <button
          type="button"
          className="danger-button"
          disabled={busy || !canClear}
          onClick={() => void remove()}
        >
          {operation === 'remove' ? 'Clearing…' : 'Clear'}
        </button>
      </div>
    </article>
  );
}
