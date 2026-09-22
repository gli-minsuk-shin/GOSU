import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { registerPaperSummaryIpc, PAPER_SUMMARY_SAVE_CHANNEL } from '../src/main/paper-summary-ipc';
it('invalidates cross-app build/test caches when the shared library or confirmation UI changes', () => {
  const config = JSON.parse(readFileSync(new URL('../../../turbo.json', import.meta.url), 'utf8'));
  expect(config.globalDependencies).toContain('apps/briefing-lab/paper-summary-library.ts');
  expect(config.globalDependencies).toContain('apps/briefing-lab/src/paper-summary-offer.tsx');
  expect(config.globalDependencies).toContain('apps/briefing-lab/src/paper-summary-contract.ts');
});
it('requires explicit UI approval before storing a GOSU paper analysis and never accepts model-supplied origin', async () => {
  const save = vi.fn(async () => ({
    id: 'x',
    savedAt: '2026-09-10T00:00:00Z',
    alreadySaved: false,
  }));
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  registerPaperSummaryIpc((channel, callback) => handlers.set(channel, callback), { save });
  expect([...handlers.keys()].sort()).toEqual(
    [
      PAPER_SUMMARY_SAVE_CHANNEL,
      'gosu:paper-summary:import-to-literature',
      'gosu:paper-summary:list',
    ].sort(),
  );
  const handler = handlers.get(PAPER_SUMMARY_SAVE_CHANNEL)!;
  const candidate = {
    title: 'Paper',
    question: '이 논문 요약해줘',
    markdown: 'Synthetic paper analysis.',
    sourceUrls: [],
  };
  await expect(handler({ candidate })).rejects.toThrow();
  await expect(handler({ candidate, confirmed: false })).rejects.toThrow();
  await expect(handler({ candidate, confirmed: true, origin: 'Other' })).rejects.toThrow();
  expect(save).not.toHaveBeenCalled();
  await handler({ candidate, confirmed: true });
  expect(save).toHaveBeenCalledWith({ candidate, confirmed: true }, 'GOSU');
});
it('lists and imports saved papers through bounded results and never as raw library errors', async () => {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const projectId = '11111111-1111-4111-8111-111111111111';
  const paperId = 'a'.repeat(64);
  const list = vi.fn(async () => {
    throw new Error('keychain locked: secret detail');
  });
  const addLibraryPapers = vi.fn();
  registerPaperSummaryIpc(
    (channel, callback) => handlers.set(channel, callback),
    { save: vi.fn(), list },
    { addLibraryPapers },
  );

  await expect(handlers.get('gosu:paper-summary:list')!(undefined)).resolves.toEqual({
    ok: false,
    error: { code: 'paper_library_unavailable' },
  });
  await expect(
    handlers.get('gosu:paper-summary:import-to-literature')!({ projectId, paperIds: [] }),
  ).resolves.toEqual({ ok: false, error: { code: 'invalid_paper_library_input' } });
  await expect(
    handlers.get('gosu:paper-summary:import-to-literature')!({ projectId, paperIds: [paperId] }),
  ).resolves.toEqual({ ok: false, error: { code: 'paper_library_unavailable' } });
  expect(addLibraryPapers).not.toHaveBeenCalled();

  list.mockResolvedValue([] as never);
  await expect(handlers.get('gosu:paper-summary:list')!(undefined)).resolves.toEqual({
    ok: true,
    value: { entries: [], unverifiedCount: 0 },
  });
  await expect(
    handlers.get('gosu:paper-summary:import-to-literature')!({ projectId, paperIds: [paperId] }),
  ).resolves.toEqual({
    ok: true,
    value: { projectId, importedCount: 0, alreadySavedCount: 0, missingCount: 1 },
  });
});
