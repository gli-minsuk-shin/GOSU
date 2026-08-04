import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerLiteratureIpc } from '../src/main/literature-ipc';
import { LiteratureServiceError, type LiteratureService } from '../src/main/literature-service';
import { LITERATURE_IPC_CHANNELS } from '../src/shared/literature-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function fixture(service: Partial<LiteratureService>, reportUnexpected = vi.fn()) {
  const handlers = new Map<string, Handler>();
  registerLiteratureIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as LiteratureService,
    null,
    reportUnexpected,
  );
  return { handlers, reportUnexpected };
}

describe('Literature IPC boundary', () => {
  it('registers only the fixed typed literature surface, including bounded AI organize', () => {
    const { handlers } = fixture({});
    expect([...handlers.keys()].sort()).toEqual(Object.values(LITERATURE_IPC_CHANNELS).sort());
    expect([...handlers.keys()]).not.toContain('gosu:literature:fetch-url');
    expect([...handlers.keys()]).not.toContain('gosu:literature:read-file');
  });

  it('rejects malformed queries and inverted year filters before service use', async () => {
    const search = vi.fn();
    const { handlers } = fixture({ search });

    await expect(
      handlers.get(LITERATURE_IPC_CHANNELS.search)?.({
        projectId: randomUUID(),
        query: 'fixture',
        fromYear: 2026,
        toYear: 2020,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_literature_input' } });
    await expect(
      handlers.get(LITERATURE_IPC_CHANNELS.search)?.({
        projectId: randomUUID(),
        query: 'fixture',
        limit: 51,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_literature_input' } });
    expect(search).not.toHaveBeenCalled();
  });

  it('does not accept renderer-provided paths or file content for transfer commands', async () => {
    const importRecords = vi.fn();
    const exportRecords = vi.fn();
    const { handlers } = fixture({ importRecords, exportRecords });
    const projectId = randomUUID();

    await expect(
      handlers.get(LITERATURE_IPC_CHANNELS.importRecords)?.({
        projectId,
        path: '/Users/researcher/private-review.json',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_literature_input' } });
    await expect(
      handlers.get(LITERATURE_IPC_CHANNELS.exportRecords)?.({
        projectId,
        format: 'json',
        content: 'PRIVATE PAPER BODY',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_literature_input' } });
    expect(importRecords).not.toHaveBeenCalled();
    expect(exportRecords).not.toHaveBeenCalled();
  });

  it('returns known service failures and disables organize cleanly without an AI service', async () => {
    const list = vi.fn(async () => {
      throw new LiteratureServiceError('literature_project_unavailable');
    });
    const { handlers, reportUnexpected } = fixture({ list });
    const projectId = randomUUID();

    await expect(handlers.get(LITERATURE_IPC_CHANNELS.list)?.({ projectId })).resolves.toEqual({
      ok: false,
      error: { code: 'literature_project_unavailable' },
    });
    await expect(
      handlers.get(LITERATURE_IPC_CHANNELS.organize)?.({ projectId, recordIds: [randomUUID()] }),
    ).resolves.toEqual({ ok: false, error: { code: 'literature_ai_unavailable' } });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it('maps unexpected failures to a generic result without reflecting private diagnostics', async () => {
    const exportRecords = vi.fn(async () => {
      throw new Error('/Users/researcher/private-library.json');
    });
    const { handlers, reportUnexpected } = fixture({ exportRecords });

    const result = await handlers.get(LITERATURE_IPC_CHANNELS.exportRecords)?.({
      projectId: randomUUID(),
      format: 'json',
    });
    expect(result).toEqual({ ok: false, error: { code: 'literature_unavailable' } });
    expect(JSON.stringify(result)).not.toContain('private-library');
    expect(reportUnexpected).toHaveBeenCalledOnce();
  });
});
