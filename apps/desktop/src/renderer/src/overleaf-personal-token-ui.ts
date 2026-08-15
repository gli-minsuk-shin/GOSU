import type { OverleafPersonalTokenStatus } from '../../shared/overleaf-personal-token-contracts';

export type OverleafPersonalTokenUiState = OverleafPersonalTokenStatus['state'] | 'loading';

export function overleafPersonalTokenStatusLabel(state: OverleafPersonalTokenUiState) {
  return {
    loading: 'Checking…',
    configured: 'Saved',
    not_configured: 'Not saved',
    unavailable: 'Status unavailable',
  }[state];
}

export function describeOverleafPersonalTokenError(error: unknown) {
  const code = error instanceof Error ? error.message.split(':', 1)[0] : '';
  if (code === 'invalid_overleaf_personal_token_input') {
    return 'Enter a personal Git token before saving.';
  }
  if (code === 'overleaf_token_invalid') {
    return 'Enter a valid Overleaf personal Git token without spaces.';
  }
  if (code === 'overleaf_keychain_unavailable') {
    return 'GOSU could not use this Mac’s secure credential storage. Check macOS access and try again.';
  }
  if (code === 'overleaf_personal_token_unavailable') {
    return 'The saved Overleaf token could not be checked. Try again before changing it.';
  }
  return 'The Overleaf token could not be updated. Try again.';
}

export const OVERLEAF_PERSONAL_TOKEN_CLEAR_CONFIRMATION =
  'Clear the saved Overleaf token from GOSU?\n\nExisting linked manuscripts keep working. New Overleaf links will require another saved token. This does not revoke the token in Overleaf.';
