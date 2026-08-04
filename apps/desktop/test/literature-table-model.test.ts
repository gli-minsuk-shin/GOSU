import { describe, expect, it } from 'vitest';

import {
  buildLiteratureTablePage,
  LITERATURE_PAGE_SIZE,
  MAX_VISIBLE_LITERATURE_RECORDS,
  nextLiteratureSort,
  type LiteratureTableRecord,
} from '../src/renderer/src/literature-table-model';

const record = (
  id: string,
  overrides: Partial<LiteratureTableRecord> = {},
): LiteratureTableRecord => ({
  id,
  title: `Paper ${id}`,
  authors: ['Ada Researcher'],
  venue: 'GOSU Transactions',
  year: 2026,
  topics: ['agentic research'],
  doi: `10.1000/${id}`,
  type: 'journal-article',
  citedBy: 0,
  reviewStatus: 'unreviewed',
  source: 'crossref',
  ...overrides,
});

describe('literature table model', () => {
  it('searches across evidence columns and filters review status', () => {
    const result = buildLiteratureTablePage(
      [
        record('one', { title: 'Learning systems', reviewStatus: 'included' }),
        record('two', {
          authors: ['Grace Hopper'],
          topics: ['compilers'],
          reviewStatus: 'excluded',
        }),
      ],
      {
        text: 'hopper',
        reviewStatus: 'excluded',
        sortKey: 'title',
        sortDirection: 'ascending',
        page: 1,
      },
    );

    expect(result.rows.map(({ id }) => id)).toEqual(['two']);
  });

  it('sorts missing numeric metadata last when descending and keeps equal values stable', () => {
    const result = buildLiteratureTablePage(
      [
        record('old', { year: 2022 }),
        record('unknown', { year: null }),
        record('new-a', { year: 2026 }),
        record('new-b', { year: 2026 }),
      ],
      {
        text: '',
        reviewStatus: 'all',
        sortKey: 'year',
        sortDirection: 'descending',
        page: 1,
      },
    );

    expect(result.rows.map(({ id }) => id)).toEqual(['new-a', 'new-b', 'old', 'unknown']);
  });

  it('bounds the working set and clamps pagination', () => {
    const records = Array.from({ length: MAX_VISIBLE_LITERATURE_RECORDS + 20 }, (_, index) =>
      record(String(index).padStart(3, '0')),
    );
    const result = buildLiteratureTablePage(records, {
      text: '',
      reviewStatus: 'all',
      sortKey: 'title',
      sortDirection: 'ascending',
      page: 999,
    });

    expect(result.total).toBe(MAX_VISIBLE_LITERATURE_RECORDS);
    expect(result.pageSize).toBe(LITERATURE_PAGE_SIZE);
    expect(result.page).toBe(result.pageCount);
    expect(result.rows).toHaveLength(LITERATURE_PAGE_SIZE);
  });

  it('uses native numeric defaults and toggles an active sort', () => {
    expect(nextLiteratureSort('title', 'ascending', 'citedBy')).toEqual({
      sortKey: 'citedBy',
      sortDirection: 'descending',
    });
    expect(nextLiteratureSort('citedBy', 'descending', 'citedBy')).toEqual({
      sortKey: 'citedBy',
      sortDirection: 'ascending',
    });
  });
});
