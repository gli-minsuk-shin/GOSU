import { uiText } from '@gosu/ui/language';

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
          <strong>{uiText('Checking the saved Overleaf token…')}</strong>
          <span>{uiText('This takes place locally on this Mac.')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="overleaf-token-required" role={state === 'unavailable' ? 'alert' : 'status'}>
      <div>
        <strong>
          {state === 'not_configured'
            ? uiText('Save an Overleaf token before linking')
            : uiText('The saved Overleaf token could not be checked')}
        </strong>
        <span>
          {state === 'not_configured'
            ? uiText(
                'GOSU uses one saved token automatically for every new Manuscript and Lecture link.',
              )
            : uiText('Open Overleaf Settings and retry the secure-storage check.')}
        </span>
      </div>
      <button type="button" className="secondary-button" onClick={onOpenSettings}>
        {uiText('Open Overleaf Settings')}
      </button>
    </div>
  );
}
