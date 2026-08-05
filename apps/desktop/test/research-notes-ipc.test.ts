import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { registerResearchNotesIpc } from '../src/main/research-notes-ipc';
import {
  ResearchNotesServiceError,
  type ResearchNotesService,
} from '../src/main/research-notes-service';
import { RESEARCH_NOTES_IPC_CHANNELS } from '../src/shared/research-notes-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function fixture(
  service: Partial<ResearchNotesService>,
  options: {
    chooseVault?: (projectId: string) => Promise<unknown>;
    reportUnexpected?: (error: unknown) => void;
  } = {},
) {
  const handlers = new Map<string, Handler>();
  const chooseVault = options.chooseVault ?? vi.fn(async () => null);
  const reportUnexpected = options.reportUnexpected ?? vi.fn();
  registerResearchNotesIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as ResearchNotesService,
    chooseVault,
    reportUnexpected,
  );
  return { handlers, chooseVault, reportUnexpected };
}

describe('Research Notes IPC boundary', () => {
  it('registers exactly the fixed typed Research Notes surface', () => {
    const { handlers } = fixture({});

    expect([...handlers.keys()]).toEqual([
      RESEARCH_NOTES_IPC_CHANNELS.current,
      RESEARCH_NOTES_IPC_CHANNELS.chooseVault,
      RESEARCH_NOTES_IPC_CHANNELS.read,
      RESEARCH_NOTES_IPC_CHANNELS.readAttachment,
      RESEARCH_NOTES_IPC_CHANNELS.syncLiterature,
      RESEARCH_NOTES_IPC_CHANNELS.createPaperNote,
    ]);
    expect([...handlers.keys()]).not.toContain('gosu:research-notes:write-file');
    expect([...handlers.keys()]).not.toContain('gosu:research-notes:read-path');
    expect([...handlers.keys()]).not.toContain('gosu:research-notes:delete');
  });

  it('routes every valid project-scoped command without exposing renderer paths to Main', async () => {
    const projectId = randomUUID();
    const recordId = randomUUID();
    const current = vi.fn(async () => null);
    const read = vi.fn(async (input) => ({ path: input.path, content: '# Note' }));
    const readAttachment = vi.fn(async (input) => ({
      path: input.source,
      mimeType: 'image/png',
      dataBase64: 'fixture',
    }));
    const syncLiterature = vi.fn(async () => '2026-08-06T00:00:00.000Z');
    const createPaperNote = vi.fn(async (input) => ({
      schemaVersion: 1 as const,
      projectId: input.projectId,
      recordId: input.recordId,
      path: 'Papers/fixture.md',
      created: true,
    }));
    const chooseVault = vi.fn(async (selectedProjectId: string) => ({
      projectId: selectedProjectId,
    }));
    const { handlers } = fixture(
      { current, read, readAttachment, syncLiterature, createPaperNote },
      { chooseVault },
    );

    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.current)?.({ projectId }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.chooseVault)?.({ projectId }),
    ).resolves.toEqual({ ok: true, value: { projectId } });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.read)?.({
        projectId,
        path: 'Literature/Literature Review.md',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.readAttachment)?.({
        projectId,
        notePath: 'Papers/fixture.md',
        source: 'figures/result.png',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.syncLiterature)?.({ projectId }),
    ).resolves.toEqual({
      ok: true,
      value: { syncedAt: '2026-08-06T00:00:00.000Z' },
    });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.createPaperNote)?.({ projectId, recordId }),
    ).resolves.toMatchObject({ ok: true, value: { projectId, recordId, created: true } });

    expect(current).toHaveBeenCalledExactlyOnceWith({ projectId });
    expect(chooseVault).toHaveBeenCalledExactlyOnceWith(projectId);
    expect(read).toHaveBeenCalledExactlyOnceWith({
      projectId,
      path: 'Literature/Literature Review.md',
    });
    expect(readAttachment).toHaveBeenCalledExactlyOnceWith({
      projectId,
      notePath: 'Papers/fixture.md',
      source: 'figures/result.png',
    });
    expect(syncLiterature).toHaveBeenCalledExactlyOnceWith(projectId);
    expect(createPaperNote).toHaveBeenCalledExactlyOnceWith({ projectId, recordId });
  });

  it('rejects malformed and extra renderer input before any service operation', async () => {
    const current = vi.fn();
    const read = vi.fn();
    const readAttachment = vi.fn();
    const syncLiterature = vi.fn();
    const createPaperNote = vi.fn();
    const chooseVault = vi.fn();
    const { handlers } = fixture(
      { current, read, readAttachment, syncLiterature, createPaperNote },
      { chooseVault },
    );
    const projectId = randomUUID();

    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.current)?.({
        projectId,
        vaultRoot: '/Users/researcher/private-vault',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_research_notes_input' } });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.chooseVault)?.({ projectId: 'not-a-uuid' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_research_notes_input' } });
    await expect(handlers.get(RESEARCH_NOTES_IPC_CHANNELS.read)?.({ projectId })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_research_notes_input' },
    });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.readAttachment)?.({
        projectId,
        notePath: 'Papers/fixture.md',
        source: 'figure.png',
        arbitraryFilesystemRead: true,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_research_notes_input' } });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.syncLiterature)?.({
        projectId,
        markdown: 'private content',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_research_notes_input' } });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.createPaperNote)?.({
        projectId,
        recordId: randomUUID(),
        outputPath: '/tmp/paper.md',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_research_notes_input' } });

    expect(current).not.toHaveBeenCalled();
    expect(chooseVault).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(readAttachment).not.toHaveBeenCalled();
    expect(syncLiterature).not.toHaveBeenCalled();
    expect(createPaperNote).not.toHaveBeenCalled();
  });

  it('returns declared service errors and service-thrown validation errors as typed results', async () => {
    const current = vi.fn(async () => {
      throw new ResearchNotesServiceError('research_notes_vault_not_selected');
    });
    const read = vi.fn(async () => {
      throw new z.ZodError([]);
    });
    const { handlers, reportUnexpected } = fixture({ current, read });
    const projectId = randomUUID();

    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.current)?.({ projectId }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'research_notes_vault_not_selected' },
    });
    await expect(
      handlers.get(RESEARCH_NOTES_IPC_CHANNELS.read)?.({ projectId, path: 'Papers/note.md' }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_research_notes_input' },
    });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it('maps unexpected failures to one generic error without reflecting private diagnostics', async () => {
    const privateError = new Error('/Users/researcher/private-vault/GOSU/Secret Project');
    const current = vi.fn(async () => {
      throw privateError;
    });
    const reportUnexpected = vi.fn(() => {
      throw new Error('diagnostic sink unavailable');
    });
    const { handlers } = fixture({ current }, { reportUnexpected });

    const result = await handlers.get(RESEARCH_NOTES_IPC_CHANNELS.current)?.({
      projectId: randomUUID(),
    });

    expect(result).toEqual({ ok: false, error: { code: 'research_notes_unavailable' } });
    expect(JSON.stringify(result)).not.toContain('private-vault');
    expect(reportUnexpected).toHaveBeenCalledExactlyOnceWith(privateError);
  });
});
