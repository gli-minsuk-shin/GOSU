import { expect, it } from 'vitest';
import {
  DEFAULT_PAPER_SORT,
  isPaperSort,
  PAPER_SORTS,
  sortSavedPapers,
  type PaperSort,
} from './paper-sort';
import type { SavedPaper } from './paper-library-index';

/** Only `summarizedAt` matters here; the rest is what the stored shape requires. */
const provenance = (summarizedAt: string) => ({
  version: 1 as const,
  sourceDigest: 'a'.repeat(64),
  contextDigest: 'b'.repeat(64),
  summarizedAt,
  reused: false,
});

const paper = (
  id: string,
  title: string,
  extra: Partial<SavedPaper['item']> & { savedAt?: string } = {},
) => {
  const { savedAt, ...item } = extra;
  return {
    historyId: 'h',
    savedAt: savedAt ?? '2026-09-01T00:00:00Z',
    item: {
      id,
      kind: 'papers',
      title,
      summary: 'Saved result',
      readScope: 'abstract',
      importance: 'medium',
      ...item,
    },
  } as unknown as SavedPaper;
};

const order = (papers: readonly SavedPaper[], sort: PaperSort) =>
  sortSavedPapers(papers, sort).map((p) => p.item.id);

it('defaults to the date the summary was written, newest first', () => {
  expect(DEFAULT_PAPER_SORT).toBe('summarized');
  const papers = [
    paper('old', 'A', { provenance: provenance('2026-09-02T00:00:00Z') }),
    paper('new', 'B', { provenance: provenance('2026-09-20T00:00:00Z') }),
    // No provenance: the briefing that holds it is when it was summarized.
    paper('middle', 'C', { savedAt: '2026-09-10T00:00:00Z' }),
  ];
  expect(order(papers, 'summarized')).toEqual(['new', 'middle', 'old']);
});

it('sorts by the paper’s own publication date, not by when GOSU read it', () => {
  const papers = [
    paper('read-first', 'A', {
      paperPublishedAt: '2024-01-01T00:00:00Z',
      savedAt: '2026-09-20T00:00:00Z',
    }),
    paper('published-later', 'B', {
      paperPublishedAt: '2026-05-01T00:00:00Z',
      savedAt: '2026-09-01T00:00:00Z',
    }),
  ];
  expect(order(papers, 'published')).toEqual(['published-later', 'read-first']);
});

it('puts a paper with no date last rather than treating a missing date as the oldest', () => {
  const papers = [
    paper('dated', 'A', { paperPublishedAt: '2020-01-01T00:00:00Z' }),
    paper('undated', 'B'),
    paper('newer', 'C', { paperPublishedAt: '2026-01-01T00:00:00Z' }),
  ];
  expect(order(papers, 'published')).toEqual(['newer', 'dated', 'undated']);
});

it('sorts titles so Korean, English and numbers read the way a reader expects', () => {
  const papers = [
    paper('b', 'beta networks'),
    paper('ko', '가변 경로 압축'),
    paper('a', 'Alpha methods'),
    paper('n2', 'Study 10'),
    paper('n1', 'Study 2'),
  ];
  // Case is not a rank, and 2 comes before 10.
  expect(order(papers, 'title')).toEqual(['a', 'b', 'n1', 'n2', 'ko']);
});

it('keeps importance available, and leaves ties in the order they arrived', () => {
  const papers = [
    paper('m1', 'A', { importance: 'medium' }),
    paper('h1', 'B', { importance: 'high' }),
    paper('m2', 'C', { importance: 'medium' }),
    paper('h2', 'D', { importance: 'high' }),
  ];
  expect(order(papers, 'importance')).toEqual(['h1', 'h2', 'm1', 'm2']);
});

it('never reorders the caller’s array and refuses a sort it does not have', () => {
  const papers = [paper('a', 'A'), paper('b', 'B')];
  const before = papers.map((p) => p.item.id);
  sortSavedPapers(papers, 'title');
  expect(papers.map((p) => p.item.id)).toEqual(before);

  expect(PAPER_SORTS.map((s) => s.id)).toEqual(['summarized', 'published', 'title', 'importance']);
  expect(isPaperSort('title')).toBe(true);
  expect(isPaperSort('whatever')).toBe(false);
});
