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
  discoveryTier: 'unclassified',
  importanceScore: null,
  discoveryRunId: null,
  discoveryTierRank: null,
  discoveryClassifiedAt: null,
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
    expect(nextLiteratureSort('title', 'ascending', 'importance')).toEqual({
      sortKey: 'importance',
      sortDirection: 'descending',
    });
  });

  it('sorts the latest matching search first without comparing scores across searches', () => {
    const result = buildLiteratureTablePage(
      [
        record('older-high-score', {
          discoveryTier: 'core',
          importanceScore: 0.99,
          discoveryRunId: 'older-run',
          discoveryTierRank: 1,
          discoveryClassifiedAt: '2026-08-01T00:00:00.000Z',
        }),
        record('newer-broad', {
          discoveryTier: 'broad',
          importanceScore: 0.95,
          discoveryRunId: 'newer-run',
          discoveryTierRank: 1,
          discoveryClassifiedAt: '2026-08-05T00:00:00.000Z',
        }),
        record('newer-core-rank-two', {
          discoveryTier: 'core',
          importanceScore: 0.01,
          discoveryRunId: 'newer-run',
          discoveryTierRank: 2,
          discoveryClassifiedAt: '2026-08-05T00:00:00.000Z',
        }),
        record('newer-core-rank-one', {
          discoveryTier: 'core',
          importanceScore: 0.001,
          discoveryRunId: 'newer-run',
          discoveryTierRank: 1,
          discoveryClassifiedAt: '2026-08-05T00:00:00.000Z',
        }),
      ],
      {
        text: '',
        reviewStatus: 'all',
        sortKey: 'importance',
        sortDirection: 'descending',
        page: 1,
      },
    );

    expect(result.rows.map(({ id }) => id)).toEqual([
      'newer-core-rank-one',
      'newer-core-rank-two',
      'newer-broad',
      'older-high-score',
    ]);
  });

  it('keeps equal-time records from different searches stable instead of comparing scores', () => {
    const result = buildLiteratureTablePage(
      [
        record('first-run-low-score', {
          discoveryTier: 'broad',
          importanceScore: 0.01,
          discoveryRunId: 'first-run',
          discoveryTierRank: 10,
          discoveryClassifiedAt: '2026-08-05T00:00:00.000Z',
        }),
        record('second-run-high-score', {
          discoveryTier: 'core',
          importanceScore: 0.99,
          discoveryRunId: 'second-run',
          discoveryTierRank: 1,
          discoveryClassifiedAt: '2026-08-05T00:00:00.000Z',
        }),
      ],
      {
        text: '',
        reviewStatus: 'all',
        sortKey: 'importance',
        sortDirection: 'descending',
        page: 1,
      },
    );

    expect(result.rows.map(({ id }) => id)).toEqual([
      'first-run-low-score',
      'second-run-high-score',
    ]);
  });
});
