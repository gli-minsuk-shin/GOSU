import { describe, expect, it, vi } from 'vitest';

import {
  OverleafPersonalTokenService,
  OverleafPersonalTokenServiceError,
} from '../src/main/overleaf-personal-token-service';

describe('Overleaf personal token service', () => {
  it('returns only a bounded non-secret status and supports save/remove', async () => {
    const personalTokenStatus = vi
      .fn<() => Promise<'configured' | 'not_configured'>>()
      .mockResolvedValue('not_configured');
    const savePersonalToken = vi.fn(async () => undefined);
    const removePersonalToken = vi.fn(async () => undefined);
    const service = new OverleafPersonalTokenService({
      personalTokenStatus,
      savePersonalToken,
      removePersonalToken,
    });

    await expect(service.status({})).resolves.toEqual({
      schemaVersion: 1,
      state: 'not_configured',
    });
    const token = 'main-only-personal-token';
    await expect(service.save({ accessToken: token })).resolves.toEqual({
      schemaVersion: 1,
      state: 'configured',
    });
    await expect(service.remove({})).resolves.toEqual({
      schemaVersion: 1,
      state: 'not_configured',
    });

    expect(savePersonalToken).toHaveBeenCalledExactlyOnceWith(token);
    expect(removePersonalToken).toHaveBeenCalledOnce();
    expect(JSON.stringify(await service.status({}))).not.toContain(token);
  });

  it('maps status failure to unavailable and write failures to bounded codes', async () => {
    const service = new OverleafPersonalTokenService({
      personalTokenStatus: vi.fn(async () => {
        throw new Error('/Users/researcher/private-token.bin');
      }),
      savePersonalToken: vi.fn(async () => {
        throw new Error('overleaf_token_invalid');
      }),
      removePersonalToken: vi.fn(async () => {
        throw new Error('private-storage-detail');
      }),
    });

    await expect(service.status({})).resolves.toEqual({ schemaVersion: 1, state: 'unavailable' });
    await expect(service.save({ accessToken: 'invalid-fixture' })).rejects.toEqual(
      new OverleafPersonalTokenServiceError('overleaf_token_invalid'),
    );
    await expect(service.remove({})).rejects.toEqual(
      new OverleafPersonalTokenServiceError('overleaf_keychain_unavailable'),
    );
  });
});
