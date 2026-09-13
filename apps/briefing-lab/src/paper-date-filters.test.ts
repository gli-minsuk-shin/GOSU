import { expect, it } from 'vitest';
import { matchesPaperDates, emptyPaperDates, paperDateError } from './paper-date-filters';
import type { SavedPaper } from './paper-library-index';
const paper: SavedPaper = {
  historyId: 'h',
  savedAt: '2026-09-12T00:00:00Z',
  item: {
    id: 'p',
    title: 'Paper',
    summary: 'Summary',
    relevance: '',
    importance: 'medium',
    readScope: 'abstract',
    paperPublishedAt: '2026-09-01T16:00:00Z',
    provenance: {
      version: 1,
      sourceDigest: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      summarizedAt: '2026-09-09T16:00:00Z',
      reused: true,
    },
  },
};
it('filters summary and source publication dates independently, intersecting inclusive Korean calendar days', () => {
  const dates = {
    summary: { from: '2026-09-10', to: '2026-09-10' },
    published: { from: '2026-09-02', to: '2026-09-02' },
  };
  expect(matchesPaperDates(paper, dates)).toBe(true);
  expect(matchesPaperDates(paper, { ...dates, summary: { from: '2026-09-12', to: '' } })).toBe(
    false,
  );
  expect(matchesPaperDates(paper, { ...dates, published: { from: '', to: '2026-09-01' } })).toBe(
    false,
  );
});
it('does not mistake save time, classification time or missing publication data for source/summary dates', () => {
  const unknown = {
    ...paper,
    item: { ...paper.item, paperPublishedAt: undefined, provenance: undefined },
  };
  expect(matchesPaperDates(unknown, emptyPaperDates())).toBe(true);
  expect(
    matchesPaperDates(unknown, { ...emptyPaperDates(), summary: { from: '2026-09-01', to: '' } }),
  ).toBe(false);
  expect(
    matchesPaperDates(unknown, { ...emptyPaperDates(), published: { from: '', to: '2026-09-30' } }),
  ).toBe(false);
});
it('reports reversed or invalid calendar ranges instead of silently applying them', () => {
  expect(
    paperDateError({ ...emptyPaperDates(), summary: { from: '2026-09-12', to: '2026-09-10' } }),
  ).toContain('요약일');
  expect(
    paperDateError({ ...emptyPaperDates(), published: { from: '2026-02-30', to: '' } }),
  ).toContain('공개일');
});
