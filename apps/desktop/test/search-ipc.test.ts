import { describe, expect, it, vi } from 'vitest';

import { registerSearchIpc } from '../src/main/search-ipc';
import { SearchServiceError } from '../src/main/search-service';
import { SEARCH_IPC_CHANNELS } from '../src/shared/search-channels';

describe('search IPC', () => {
  it('validates input before calling the service', async () => {
    const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
    const search = vi.fn();
    registerSearchIpc((channel, listener) => handlers.set(channel, listener), { search } as never);
    await expect(handlers.get(SEARCH_IPC_CHANNELS.search)?.({ query: '' })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_search_input' },
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('maps expected service failures without exposing details', async () => {
    const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
    registerSearchIpc((channel, listener) => handlers.set(channel, listener), {
      search: () => Promise.reject(new SearchServiceError('search_project_not_found')),
    } as never);
    await expect(
      handlers.get(SEARCH_IPC_CHANNELS.search)?.({
        query: 'paper',
        scope: { kind: 'global' },
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'search_project_not_found' } });
  });
});
