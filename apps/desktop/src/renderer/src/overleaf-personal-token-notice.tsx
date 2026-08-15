import type { OverleafPersonalTokenUiState } from './overleaf-personal-token-ui';

export function OverleafPersonalTokenNotice({
  state,
  onOpenSettings,
}: {
  state: Exclude<OverleafPersonalTokenUiState, 'configured'>;
  onOpenSettings: () => void;
}) {
  if (state === 'loading') {
    return (
      <div className="overleaf-token-required" role="status">
        <div>
          <strong>Checking the saved Overleaf token…</strong>
          <span>This takes place locally on this Mac.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="overleaf-token-required" role={state === 'unavailable' ? 'alert' : 'status'}>
      <div>
        <strong>
          {state === 'not_configured'
            ? 'Save an Overleaf token before linking'
            : 'The saved Overleaf token could not be checked'}
        </strong>
        <span>
          {state === 'not_configured'
            ? 'GOSU uses one saved token automatically for every new Manuscript and Lecture link.'
            : 'Open Overleaf Settings and retry the secure-storage check.'}
        </span>
      </div>
      <button type="button" className="secondary-button" onClick={onOpenSettings}>
        Open Overleaf Settings
      </button>
    </div>
  );
}
