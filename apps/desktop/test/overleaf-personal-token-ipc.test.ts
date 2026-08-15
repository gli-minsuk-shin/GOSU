import { describe, expect, it, vi } from 'vitest';

import { registerOverleafPersonalTokenIpc } from '../src/main/overleaf-personal-token-ipc';
import {
  OverleafPersonalTokenService,
  OverleafPersonalTokenServiceError,
} from '../src/main/overleaf-personal-token-service';
import { OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS } from '../src/shared/overleaf-personal-token-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function fixture(service: Record<string, unknown>, reportUnexpected = vi.fn()) {
  const handlers = new Map<string, Handler>();
  registerOverleafPersonalTokenIpc(
    (channel, listener) => handlers.set(channel, listener),
    service as unknown as OverleafPersonalTokenService,
    reportUnexpected,
  );
  return { handlers, reportUnexpected };
}

describe('Overleaf personal token IPC', () => {
  it('registers only fixed status/save/remove channels and validates exact inputs', async () => {
    const status = vi.fn(async () => ({
      schemaVersion: 1 as const,
      state: 'not_configured' as const,
    }));
    const save = vi.fn(async () => ({ schemaVersion: 1 as const, state: 'configured' as const }));
    const remove = vi.fn(async () => ({
      schemaVersion: 1 as const,
      state: 'not_configured' as const,
    }));
    const { handlers } = fixture({ status, save, remove });
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS).sort(),
    );

    await expect(handlers.get(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.status)?.({})).resolves.toEqual({
      ok: true,
      value: { schemaVersion: 1, state: 'not_configured' },
    });
    await expect(
      handlers.get(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.save)?.({ accessToken: 'personal-token' }),
    ).resolves.toEqual({ ok: true, value: { schemaVersion: 1, state: 'configured' } });
    await expect(handlers.get(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.remove)?.({})).resolves.toEqual({
      ok: true,
      value: { schemaVersion: 1, state: 'not_configured' },
    });
    await expect(
      handlers.get(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.save)?.({
        accessToken: 'personal-token',
        persistInRenderer: true,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_overleaf_personal_token_input' },
    });
    expect(status).toHaveBeenCalledExactlyOnceWith({});
    expect(save).toHaveBeenCalledExactlyOnceWith({ accessToken: 'personal-token' });
    expect(remove).toHaveBeenCalledExactlyOnceWith({});
  });

  it('returns only allowlisted errors and never reflects token-bearing diagnostics', async () => {
    const secret = 'private-personal-token';
    const save = vi
      .fn()
      .mockRejectedValueOnce(new OverleafPersonalTokenServiceError('overleaf_token_invalid'))
      .mockRejectedValueOnce(new Error(`/Users/researcher/${secret}`));
    const { handlers, reportUnexpected } = fixture({ save });

    await expect(
      handlers.get(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.save)?.({ accessToken: secret }),
    ).resolves.toEqual({ ok: false, error: { code: 'overleaf_token_invalid' } });
    const unexpected = await handlers.get(OVERLEAF_PERSONAL_TOKEN_IPC_CHANNELS.save)?.({
      accessToken: secret,
    });
    expect(unexpected).toEqual({
      ok: false,
      error: { code: 'overleaf_personal_token_unavailable' },
    });
    expect(JSON.stringify(unexpected)).not.toContain(secret);
    expect(reportUnexpected).toHaveBeenCalledOnce();
    expect(JSON.stringify(reportUnexpected.mock.calls)).not.toContain(secret);
    expect(reportUnexpected.mock.calls[0]?.[0]).toMatchObject({
      message: 'overleaf_personal_token_unavailable',
    });
  });
});
