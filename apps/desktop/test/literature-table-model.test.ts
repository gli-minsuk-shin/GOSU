import { describe, expect, it } from 'vitest';

import {
  buildLiteratureSearchTagOptions,
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
  searchTags: { topics: ['agentic research'], keywords: [] },
  sourceTopics: [],
  manualTopics: [],
  aiTopics: [],
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
          searchTags: { topics: ['compilers'], keywords: [] },
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

  it('filters typed search tags by exact normalized key without matching other topic sources', () => {
    const records = [
      record('exact-topic', {
        searchTags: { topics: ['ＲＡＧ'], keywords: [] },
      }),
      record('substring', {
        searchTags: { topics: ['ragged evaluation'], keywords: [] },
      }),
      record('keyword', {
        searchTags: { topics: [], keywords: ['RAG'] },
      }),
      record('other-source', {
        searchTags: { topics: [], keywords: [] },
        sourceTopics: ['RAG'],
        manualTopics: ['RAG'],
        aiTopics: ['RAG'],
      }),
    ];
    const query = {
      text: '',
      reviewStatus: 'all',
      sortKey: 'title' as const,
      sortDirection: 'ascending' as const,
      page: 1,
    };

    expect(
      buildLiteratureTablePage(records, { ...query, searchTag: 'topics:rag' }).rows.map(
        ({ id }) => id,
      ),
    ).toEqual(['exact-topic']);
    expect(
      buildLiteratureTablePage(records, { ...query, searchTag: 'keywords:rag' }).rows.map(
        ({ id }) => id,
      ),
    ).toEqual(['keyword']);
    expect(
      buildLiteratureTablePage(records, { ...query, searchTag: 'untagged' }).rows.map(
        ({ id }) => id,
      ),
    ).toEqual(['other-source']);
  });

  it('builds separate, stable Topic and Keyword filter options with paper counts', () => {
    const options = buildLiteratureSearchTagOptions([
      record('one', {
        searchTags: { topics: ['Tabular FM'], keywords: ['benchmark'] },
      }),
      record('two', {
        searchTags: { topics: ['tabular fm'], keywords: ['Benchmark', 'few-shot'] },
      }),
      record('three', {
        searchTags: { topics: ['benchmark'], keywords: [] },
      }),
    ]);

    expect(options).toEqual([
      { key: 'topics:benchmark', kind: 'topics', label: 'benchmark', count: 1 },
      { key: 'topics:tabular fm', kind: 'topics', label: 'Tabular FM', count: 2 },
      { key: 'keywords:benchmark', kind: 'keywords', label: 'benchmark', count: 2 },
      { key: 'keywords:few-shot', kind: 'keywords', label: 'few-shot', count: 1 },
    ]);
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

  it('treats Total as all classified and imported papers while preserving layer filters', () => {
    const records = [
      record('core', { discoveryTier: 'core' }),
      record('rising', { discoveryTier: 'rising' }),
      record('broad', { discoveryTier: 'broad' }),
      record('imported', { discoveryTier: 'unclassified' }),
    ];
    const query = {
      text: '',
      reviewStatus: 'all',
      sortKey: 'title' as const,
      sortDirection: 'ascending' as const,
      page: 1,
    };

    expect(
      buildLiteratureTablePage(records, { ...query, discoveryTier: 'all' }).rows.map(
        ({ id }) => id,
      ),
    ).toEqual(['broad', 'core', 'imported', 'rising']);
    for (const tier of ['core', 'rising', 'broad', 'unclassified'] as const) {
      expect(
        buildLiteratureTablePage(records, { ...query, discoveryTier: tier }).rows.map(
          ({ id }) => id,
        ),
      ).toEqual([tier === 'unclassified' ? 'imported' : tier]);
    }
  });
});
