import { ZodError } from 'zod';

import { SEARCH_IPC_CHANNELS } from '../shared/search-channels';
import { SearchInputSchema } from '../shared/search-contracts';
import type { SearchIpcResult } from '../shared/search-ipc-result';
import { SearchServiceError, type SearchService } from './search-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerSearchIpc(
  register: RegisterHandler,
  service: SearchService,
  reportUnexpected: (error: unknown) => void = () => undefined,
) {
  register(SEARCH_IPC_CHANNELS.search, async (input): Promise<SearchIpcResult<unknown>> => {
    const parsed = SearchInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: 'invalid_search_input' } };
    try {
      return { ok: true, value: await service.search(parsed.data) };
    } catch (error) {
      if (error instanceof SearchServiceError) {
        return { ok: false, error: { code: error.code } };
      }
      if (error instanceof ZodError) {
        return { ok: false, error: { code: 'invalid_search_input' } };
      }
      try {
        reportUnexpected(error);
      } catch {
        // Diagnostics cannot turn a bounded IPC response into a rejection.
      }
      return { ok: false, error: { code: 'search_unavailable' } };
    }
  });
}
