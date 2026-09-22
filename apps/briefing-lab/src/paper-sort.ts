import { importanceFirst } from './paper-chat-reference';
import type { SavedPaper } from './paper-library-index';

export const PAPER_SORTS = [
  { id: 'summarized', label: '요약일 최신순' },
  { id: 'published', label: '공개일 최신순' },
  { id: 'title', label: '제목 ABC순' },
  { id: 'importance', label: '중요도순' },
] as const;

export type PaperSort = (typeof PAPER_SORTS)[number]['id'];
export const DEFAULT_PAPER_SORT: PaperSort = 'summarized';

export function isPaperSort(value: string): value is PaperSort {
  return PAPER_SORTS.some((sort) => sort.id === value);
}

/** The date the AI wrote this summary, falling back to when the briefing that holds it was saved. */
const summarizedAt = (paper: SavedPaper) => paper.item.provenance?.summarizedAt ?? paper.savedAt;

/**
 * A paper with no date sorts last rather than first: an unknown date is not "the oldest", and
 * putting it at the top would push the papers the reader is looking for down the page.
 */
const byNewest = (left: string | undefined, right: string | undefined) => {
  const a = left ? Date.parse(left) : Number.NaN;
  const b = right ? Date.parse(right) : Number.NaN;
  if (Number.isNaN(a) && Number.isNaN(b)) return 0;
  if (Number.isNaN(a)) return 1;
  if (Number.isNaN(b)) return -1;
  return b - a;
};

/**
 * Every order is applied to the same filtered list, and every one of them is stable: the server
 * returns papers newest-summary-first, so papers that tie keep that order instead of shuffling
 * when the reader switches back and forth.
 */
export function sortSavedPapers(papers: readonly SavedPaper[], sort: PaperSort): SavedPaper[] {
  if (sort === 'importance') return importanceFirst(papers, (paper) => paper.item.importance);
  if (sort === 'title')
    return [...papers].sort((a, b) =>
      // 'en' leads on purpose: the reader asked for "ABCD 순" and most paper titles are English, so
      // A-Z comes first and Korean titles follow. Korean collation puts Hangul first instead.
      // `numeric` so "Study 2" precedes "Study 10"; `base` so case is not a rank.
      a.item.title.localeCompare(b.item.title, ['en', 'ko'], {
        numeric: true,
        sensitivity: 'base',
      }),
    );
  if (sort === 'published')
    return [...papers].sort((a, b) => byNewest(a.item.paperPublishedAt, b.item.paperPublishedAt));
  return [...papers].sort((a, b) => byNewest(summarizedAt(a), summarizedAt(b)));
}
