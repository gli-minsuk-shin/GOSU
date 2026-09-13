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
  let handler!: (input: unknown) => Promise<unknown>;
  registerPaperSummaryIpc(
    (channel, callback) => {
      expect(channel).toBe(PAPER_SUMMARY_SAVE_CHANNEL);
      handler = callback;
    },
    { save },
  );
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
