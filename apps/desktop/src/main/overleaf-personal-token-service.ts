import {
  OverleafPersonalTokenCommandSchema,
  OverleafPersonalTokenStatusSchema,
  SaveOverleafPersonalTokenInputSchema,
  type OverleafPersonalTokenCommand,
  type OverleafPersonalTokenStatus,
  type SaveOverleafPersonalTokenInput,
} from '../shared/overleaf-personal-token-contracts';
import type { OverleafPersonalTokenIpcErrorCode } from '../shared/overleaf-personal-token-ipc-result';
import type { OverleafGitCredentialStore } from './overleaf-git-credential-store';

type PersonalTokenStore = Pick<
  OverleafGitCredentialStore,
  'personalTokenStatus' | 'savePersonalToken' | 'removePersonalToken'
>;

export class OverleafPersonalTokenServiceError extends Error {
  constructor(
    readonly code: Extract<
      OverleafPersonalTokenIpcErrorCode,
      'overleaf_token_invalid' | 'overleaf_keychain_unavailable'
    >,
  ) {
    super(code);
    this.name = 'OverleafPersonalTokenServiceError';
  }
}

function mapStoreError(error: unknown): OverleafPersonalTokenServiceError {
  if (error instanceof Error && error.message === 'overleaf_token_invalid') {
    return new OverleafPersonalTokenServiceError('overleaf_token_invalid');
  }
  return new OverleafPersonalTokenServiceError('overleaf_keychain_unavailable');
}

/** Main-only orchestration for the reusable Overleaf personal Git token. */
export class OverleafPersonalTokenService {
  constructor(private readonly store: PersonalTokenStore) {}

  async status(input: OverleafPersonalTokenCommand): Promise<OverleafPersonalTokenStatus> {
    OverleafPersonalTokenCommandSchema.parse(input);
    try {
      return OverleafPersonalTokenStatusSchema.parse({
        schemaVersion: 1,
        state: await this.store.personalTokenStatus(),
      });
    } catch {
      return OverleafPersonalTokenStatusSchema.parse({ schemaVersion: 1, state: 'unavailable' });
    }
  }

  async save(input: SaveOverleafPersonalTokenInput): Promise<OverleafPersonalTokenStatus> {
    const command = SaveOverleafPersonalTokenInputSchema.parse(input);
    try {
      await this.store.savePersonalToken(command.accessToken);
    } catch (error) {
      throw mapStoreError(error);
    }
    return OverleafPersonalTokenStatusSchema.parse({ schemaVersion: 1, state: 'configured' });
  }

  async remove(input: OverleafPersonalTokenCommand): Promise<OverleafPersonalTokenStatus> {
    OverleafPersonalTokenCommandSchema.parse(input);
    try {
      await this.store.removePersonalToken();
    } catch (error) {
      throw mapStoreError(error);
    }
    return OverleafPersonalTokenStatusSchema.parse({ schemaVersion: 1, state: 'not_configured' });
  }
}
