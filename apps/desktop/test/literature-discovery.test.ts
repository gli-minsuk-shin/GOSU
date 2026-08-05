import { describe, expect, it, vi } from 'vitest';

import { LiteratureProviderError } from '../src/main/literature-crossref';
import type {
  CrossrefLiteratureProvider,
  LiteratureProviderCandidate,
} from '../src/main/literature-crossref';
import { BalancedLiteratureProvider } from '../src/main/literature-discovery';
import type { SemanticScholarLiteratureProvider } from '../src/main/literature-semantic-scholar';

function candidate(
  id: string,
  overrides: Partial<LiteratureProviderCandidate> = {},
): LiteratureProviderCandidate {
  return {
    provider: 'crossref',
    providerId: id,
    doi: `10.1000/${id}`,
    fingerprint: id.padEnd(64, '0').slice(0, 64),
    title: `Paper ${id}`,
    authors: [`Author ${id}`],
    publishedYear: 2020,
    topics: ['machine learning'],
    workType: 'journal-article',
    citationCount: 10,
    sourceUrl: `https://doi.org/10.1000/${id}`,
    ...overrides,
  };
}

function providerWithMocks(
  semanticScholar: Pick<SemanticScholarLiteratureProvider, 'search' | 'authorMetrics'>,
  crossref: Pick<CrossrefLiteratureProvider, 'search'>,
) {
  return new BalancedLiteratureProvider({
    semanticScholar: semanticScholar as SemanticScholarLiteratureProvider,
    crossref: crossref as CrossrefLiteratureProvider,
    now: () => new Date('2026-08-05T00:00:00.000Z'),
  });
}

describe('balanced literature discovery provider', () => {
  it('combines relevance, citation-sorted, and recent Semantic Scholar candidate lanes', async () => {
    const paper = (id: string, publishedYear: number, citationCount: number) => ({
      candidate: candidate(id, {
        provider: 'semantic-scholar',
        publishedYear,
        citationCount,
      }),
      authorIds: [`author-${id}`],
      influentialCitationCount: Math.floor(citationCount / 10),
      publicationDate: `${publishedYear}-01-01`,
    });
    const semanticScholar = {
      search: vi.fn(
        async (
          _query: string,
          _limit: number,
          options?: { sort?: 'relevance' | 'citation' | 'published' },
        ) =>
          options?.sort === 'citation'
            ? [paper('classic', 2012, 12_000)]
            : options?.sort === 'published'
              ? [paper('rising', 2026, 50)]
              : [paper('relevant', 2024, 500)],
      ),
      authorMetrics: vi.fn(
        async () =>
          new Map([
            ['author-classic', { authorId: 'author-classic', hIndex: 90, citationCount: 50_000 }],
            ['author-relevant', { authorId: 'author-relevant', hIndex: 40, citationCount: 5_000 }],
            ['author-rising', { authorId: 'author-rising', hIndex: 12, citationCount: 500 }],
          ]),
      ),
    };
    const crossref = { search: vi.fn() };
    const provider = providerWithMocks(semanticScholar, crossref);

    const result = await provider.search('tabular foundation models', 3);

    expect(semanticScholar.search).toHaveBeenCalledTimes(3);
    expect(semanticScholar.search).toHaveBeenNthCalledWith(
      2,
      'tabular foundation models',
      100,
      expect.objectContaining({ sort: 'citation' }),
    );
    expect(semanticScholar.search).toHaveBeenNthCalledWith(
      3,
      'tabular foundation models',
      100,
      expect.objectContaining({ sort: 'published', fromYear: 2023, toYear: 2026 }),
    );
    expect(result.retrievedCount).toBe(3);
    expect(result.tierCounts).toEqual({ core: 1, rising: 1, broad: 1 });
    expect(result.coverage).toEqual({
      source: 'semantic-scholar',
      availableSignals: ['relevance', 'citation-authority', 'recent-momentum', 'author-impact'],
      degradationReasons: [],
    });
    expect(result.candidates.map(({ providerId }) => providerId)).toEqual(
      expect.arrayContaining(['classic', 'rising', 'relevant']),
    );
    expect(semanticScholar.authorMetrics).toHaveBeenCalledWith(
      expect.arrayContaining(['author-relevant', 'author-classic', 'author-rising']),
      undefined,
    );
    expect(crossref.search).not.toHaveBeenCalled();
  });

  it('falls back to three Crossref lanes when Semantic Scholar is unavailable', async () => {
    const semanticScholar = {
      search: vi.fn(async () => {
        throw new LiteratureProviderError('unavailable');
      }),
      authorMetrics: vi.fn(),
    };
    const relevant = Array.from({ length: 5 }, (_, index) =>
      candidate(`relevant-${index}`, { citationCount: 100 - index }),
    );
    const classics = Array.from({ length: 5 }, (_, index) =>
      candidate(`classic-${index}`, {
        publishedYear: 2010 + index,
        citationCount: 10_000 - index * 500,
      }),
    );
    const recent = Array.from({ length: 5 }, (_, index) =>
      candidate(`recent-${index}`, { publishedYear: 2026 - (index % 3), citationCount: 30 }),
    );
    const crossref = {
      search: vi.fn(
        async (
          _query: string,
          _limit: number,
          options?: { sort?: 'relevance' | 'citation' | 'published' },
        ) =>
          options?.sort === 'citation'
            ? classics
            : options?.sort === 'published'
              ? recent
              : relevant,
      ),
    };
    const provider = providerWithMocks(semanticScholar, crossref);

    const result = await provider.search('tabular foundation models', 9, {
      fromYear: 2010,
      toYear: 2026,
    });

    expect(provider.providerId).toBe('balanced');
    expect(provider.policyId).toBe('balanced-three-layer');
    expect(crossref.search).toHaveBeenCalledTimes(3);
    expect(crossref.search).toHaveBeenNthCalledWith(
      1,
      'tabular foundation models',
      25,
      expect.objectContaining({ sort: 'relevance', fromYear: 2010, toYear: 2026 }),
    );
    expect(crossref.search).toHaveBeenNthCalledWith(
      2,
      'tabular foundation models',
      25,
      expect.objectContaining({ sort: 'citation' }),
    );
    expect(crossref.search).toHaveBeenNthCalledWith(
      3,
      'tabular foundation models',
      25,
      expect.objectContaining({ sort: 'published', fromYear: 2023, toYear: 2026 }),
    );
    expect(result.selectedCount).toBe(9);
    expect(result.tierCounts).toEqual({ core: 3, rising: 2, broad: 4 });
    expect(result.candidates.every(({ discovery }) => discovery !== undefined)).toBe(true);
    expect(result.coverage).toEqual({
      source: 'crossref',
      availableSignals: ['relevance', 'citation-authority', 'recent-momentum'],
      degradationReasons: ['semantic-scholar-unavailable'],
    });
    expect(
      result.candidates.every(({ discovery }) => discovery?.signalSources.includes('crossref')),
    ).toBe(true);
  });

  it('propagates cancellation without silently starting a fallback search', async () => {
    const semanticScholar = {
      search: vi.fn(async () => {
        throw new LiteratureProviderError('cancelled');
      }),
      authorMetrics: vi.fn(),
    };
    const crossref = { search: vi.fn() };
    const provider = providerWithMocks(semanticScholar, crossref);

    await expect(provider.search('cancelled search', 10)).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureProviderError>>({ code: 'cancelled' }),
    );
    expect(crossref.search).not.toHaveBeenCalled();
  });

  it('propagates cancellation from an optional Semantic Scholar lane', async () => {
    let callCount = 0;
    const semanticScholar = {
      search: vi.fn(async () => {
        callCount += 1;
        if (callCount === 2) throw new LiteratureProviderError('cancelled');
        return [];
      }),
      authorMetrics: vi.fn(),
    };
    const crossref = { search: vi.fn() };
    const provider = providerWithMocks(semanticScholar, crossref);

    await expect(provider.search('cancelled citation lane', 10)).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureProviderError>>({ code: 'cancelled' }),
    );
    expect(semanticScholar.search).toHaveBeenCalledTimes(2);
    expect(crossref.search).not.toHaveBeenCalled();
  });

  it('reports partial Semantic Scholar signal loss and a failed Crossref supplement', async () => {
    const relevantPaper = {
      candidate: candidate('partial-semantic', {
        provider: 'semantic-scholar',
        publishedYear: 2026,
      }),
      authorIds: ['author-partial'],
      influentialCitationCount: 2,
      publicationDate: '2026-01-01',
    };
    const semanticScholar = {
      search: vi.fn(
        async (
          _query: string,
          _limit: number,
          options?: { sort?: 'relevance' | 'citation' | 'published' },
        ) => {
          if (options?.sort) throw new LiteratureProviderError('unavailable');
          return [relevantPaper];
        },
      ),
      authorMetrics: vi.fn(async () => {
        throw new LiteratureProviderError('unavailable');
      }),
    };
    const crossref = {
      search: vi.fn(async () => {
        throw new LiteratureProviderError('unavailable');
      }),
    };
    const provider = providerWithMocks(semanticScholar, crossref);

    const result = await provider.search('partial semantic coverage', 3);

    expect(result.selectedCount).toBe(1);
    expect(result.coverage).toEqual({
      source: 'semantic-scholar',
      availableSignals: ['relevance', 'citation-authority', 'recent-momentum'],
      degradationReasons: [
        'citation-lane-unavailable',
        'recent-lane-unavailable',
        'author-metrics-unavailable',
        'semantic-scholar-insufficient-results',
        'crossref-supplement-unavailable',
      ],
    });
    expect(crossref.search).toHaveBeenCalledOnce();
  });

  it('records Semantic Scholar fallback and partial Crossref lane failures', async () => {
    const semanticScholar = {
      search: vi.fn(async () => {
        throw new LiteratureProviderError('unavailable');
      }),
      authorMetrics: vi.fn(),
    };
    const crossref = {
      search: vi.fn(
        async (
          _query: string,
          _limit: number,
          options?: { sort?: 'relevance' | 'citation' | 'published' },
        ) => {
          if (options?.sort && options.sort !== 'relevance') {
            throw new LiteratureProviderError('unavailable');
          }
          return [candidate('crossref-relevance')];
        },
      ),
    };
    const provider = providerWithMocks(semanticScholar, crossref);

    const result = await provider.search('partial crossref coverage', 3);

    expect(result.coverage).toEqual({
      source: 'crossref',
      availableSignals: ['relevance', 'citation-authority', 'recent-momentum'],
      degradationReasons: [
        'semantic-scholar-unavailable',
        'crossref-citation-lane-unavailable',
        'crossref-recent-lane-unavailable',
      ],
    });
  });

  it('supplements an incomplete Semantic Scholar result and ranks the combined provider pool', async () => {
    const semanticPaper = {
      candidate: candidate('semantic-only', {
        provider: 'semantic-scholar',
        publishedYear: 2026,
        citationCount: 3,
      }),
      authorIds: ['author-semantic'],
      influentialCitationCount: 0,
      publicationDate: '2026-01-01',
    };
    const semanticScholar = {
      search: vi.fn(
        async (
          _query: string,
          _limit: number,
          options?: { sort?: 'relevance' | 'citation' | 'published' },
        ) => {
          if (options?.sort) throw new LiteratureProviderError('unavailable');
          return [semanticPaper];
        },
      ),
      authorMetrics: vi.fn(async () => new Map()),
    };
    const crossref = {
      search: vi.fn(
        async (
          _query: string,
          _limit: number,
          options?: { sort?: 'relevance' | 'citation' | 'published' },
        ) =>
          options?.sort === 'citation'
            ? [candidate('crossref-classic', { publishedYear: 2012, citationCount: 8_000 })]
            : options?.sort === 'published'
              ? [candidate('crossref-rising', { publishedYear: 2026, citationCount: 30 })]
              : [candidate('crossref-relevant', { publishedYear: 2022, citationCount: 80 })],
      ),
    };
    const provider = providerWithMocks(semanticScholar, crossref);

    const result = await provider.search('combined discovery', 3);

    expect(result.selectedCount).toBe(3);
    expect(result.tierCounts).toEqual({ core: 1, rising: 1, broad: 1 });
    expect(result.coverage.source).toBe('combined');
    expect(result.coverage.availableSignals).toEqual([
      'relevance',
      'citation-authority',
      'recent-momentum',
    ]);
    expect(result.coverage.degradationReasons).toEqual(
      expect.arrayContaining([
        'citation-lane-unavailable',
        'recent-lane-unavailable',
        'author-metrics-unavailable',
        'semantic-scholar-insufficient-results',
      ]),
    );
    expect(result.candidates.some(({ provider }) => provider === 'semantic-scholar')).toBe(true);
    expect(result.candidates.some(({ provider }) => provider === 'crossref')).toBe(true);
  });

  it('samples first, last, and other authors fairly within the 200-author lookup cap', async () => {
    const papers = Array.from({ length: 205 }, (_, index) => ({
      candidate: candidate(`author-pool-${index}`, {
        provider: 'semantic-scholar',
        publishedYear: 2026,
        citationCount: 20,
      }),
      authorIds: [`first-${index}`, `middle-${index}`, `last-${index}`],
      influentialCitationCount: 1,
      publicationDate: '2026-01-01',
    }));
    const semanticScholar = {
      search: vi.fn(async () => papers),
      authorMetrics: vi.fn(
        async (ids: readonly string[]) =>
          new Map(ids.map((id) => [id, { authorId: id, hIndex: 30, citationCount: 1_000 }])),
      ),
    };
    const crossref = { search: vi.fn() };
    const provider = providerWithMocks(semanticScholar, crossref);

    const firstResult = await provider.search('bounded author coverage', 3);
    await provider.search('bounded author coverage', 3);

    const requestedIds = semanticScholar.authorMetrics.mock.calls[0]?.[0] ?? [];
    expect(requestedIds).toHaveLength(200);
    expect(requestedIds).toEqual(semanticScholar.authorMetrics.mock.calls[1]?.[0]);
    expect(requestedIds).toEqual(expect.arrayContaining(['first-0', 'first-204']));
    expect(requestedIds).toEqual(expect.arrayContaining(['middle-0', 'middle-204']));
    expect(requestedIds).toEqual(expect.arrayContaining(['last-0', 'last-204']));
    expect(firstResult.coverage.availableSignals).toContain('author-impact');
    expect(firstResult.coverage.degradationReasons).toContain('author-metrics-partial');
    expect(crossref.search).not.toHaveBeenCalled();
  });

  it('deduplicates at most 30k external author IDs without prefix-biased lookup growth', async () => {
    const papers = Array.from({ length: 301 }, (_, paperIndex) => ({
      candidate: candidate(`large-author-pool-${paperIndex}`, {
        provider: 'semantic-scholar',
        publishedYear: 2026,
        citationCount: 20,
      }),
      authorIds: Array.from(
        { length: 100 },
        (_, authorIndex) => `author-${paperIndex}-${authorIndex}`,
      ),
      influentialCitationCount: 1,
      publicationDate: '2026-01-01',
    }));
    const semanticScholar = {
      search: vi.fn(async () => papers),
      authorMetrics: vi.fn(
        async (ids: readonly string[]) =>
          new Map(ids.map((id) => [id, { authorId: id, hIndex: 10, citationCount: 100 }])),
      ),
    };
    const provider = providerWithMocks(semanticScholar, { search: vi.fn() });

    const result = await provider.search('large bounded author pool', 3);

    const requestedIds = semanticScholar.authorMetrics.mock.calls[0]?.[0] ?? [];
    expect(requestedIds).toHaveLength(200);
    expect(new Set(requestedIds).size).toBe(200);
    expect(requestedIds.some((id) => id.startsWith('author-300-'))).toBe(false);
    expect(result.coverage.degradationReasons).toContain('author-metrics-partial');
  });

  it('preserves failed Crossref lane provenance when an empty supplement adds no papers', async () => {
    const semanticPaper = {
      candidate: candidate('semantic-before-empty-supplement', {
        provider: 'semantic-scholar',
        publishedYear: 2026,
      }),
      authorIds: ['author-semantic'],
      influentialCitationCount: 1,
      publicationDate: '2026-01-01',
    };
    const semanticScholar = {
      search: vi.fn(async () => [semanticPaper]),
      authorMetrics: vi.fn(
        async () =>
          new Map([
            ['author-semantic', { authorId: 'author-semantic', hIndex: 20, citationCount: 500 }],
          ]),
      ),
    };
    const crossref = {
      search: vi.fn(
        async (
          _query: string,
          _limit: number,
          options?: { sort?: 'relevance' | 'citation' | 'published' },
        ) => {
          if (options?.sort === 'relevance') return [];
          throw new LiteratureProviderError('unavailable');
        },
      ),
    };
    const provider = providerWithMocks(semanticScholar, crossref);

    const result = await provider.search('empty Crossref supplement', 3);

    expect(result.selectedCount).toBe(1);
    expect(result.coverage.source).toBe('semantic-scholar');
    expect(result.coverage.degradationReasons).toEqual([
      'semantic-scholar-insufficient-results',
      'crossref-citation-lane-unavailable',
      'crossref-recent-lane-unavailable',
    ]);
  });

  it('distinguishes an empty Semantic Scholar result from provider unavailability', async () => {
    const semanticScholar = {
      search: vi.fn(async () => []),
      authorMetrics: vi.fn(),
    };
    const crossref = {
      search: vi.fn(async () => [candidate('crossref-after-empty-semantic')]),
    };
    const provider = providerWithMocks(semanticScholar, crossref);

    const result = await provider.search('no semantic matches', 3);

    expect(result.coverage.source).toBe('crossref');
    expect(result.coverage.degradationReasons).toEqual(['semantic-scholar-no-eligible-results']);
    expect(semanticScholar.authorMetrics).not.toHaveBeenCalled();
  });
});
