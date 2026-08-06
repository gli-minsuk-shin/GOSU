import { describe, expect, it } from 'vitest';

import type { LiteratureProviderCandidate } from '../src/main/literature-crossref';
import { literatureFingerprint } from '../src/main/literature-crossref';
import {
  BALANCED_LITERATURE_POLICY_VERSION,
  rankLiteratureCandidates,
  type LiteratureRankingCandidate,
} from '../src/main/literature-ranking';

function candidate(
  id: string,
  overrides: Partial<LiteratureProviderCandidate> = {},
): LiteratureProviderCandidate {
  return {
    provider: 'semantic-scholar',
    providerId: id,
    fingerprint: id.padEnd(64, '0').slice(0, 64),
    title: `Paper ${id}`,
    authors: [`Author ${id}`],
    publishedYear: 2020,
    topics: ['machine learning'],
    workType: 'JournalArticle',
    citationCount: 0,
    sourceUrl: `https://example.invalid/${id}`,
    ...overrides,
  };
}

function rankingInput(
  item: LiteratureProviderCandidate,
  overrides: Partial<LiteratureRankingCandidate> = {},
): LiteratureRankingCandidate {
  return {
    candidate: item,
    signalSources: [item.provider === 'crossref' ? 'crossref' : 'semantic-scholar'],
    ...overrides,
  };
}

describe('balanced literature ranking', () => {
  it('uses the eligibility-gated policy v2', () => {
    expect(BALANCED_LITERATURE_POLICY_VERSION).toBe(3);
  });

  it('fills deterministic bounded Core, Rising, and Broad allocations for eligible papers', () => {
    const classic = Array.from({ length: 5 }, (_, index) =>
      rankingInput(
        candidate(`classic-${index}`, {
          publishedYear: 2014 + index,
          citationCount: 10_000 - index * 500,
        }),
        { relevanceRank: index + 1, relevancePoolSize: 15 },
      ),
    );
    const recent = Array.from({ length: 5 }, (_, index) =>
      rankingInput(
        candidate(`recent-${index}`, {
          publishedYear: 2026 - (index % 3),
          citationCount: 80 - index * 5,
        }),
        {
          relevanceRank: index + 6,
          relevancePoolSize: 15,
          recentRank: index + 1,
          recentPoolSize: 5,
        },
      ),
    );
    const longTail = Array.from({ length: 5 }, (_, index) =>
      rankingInput(candidate(`tail-${index}`, { publishedYear: 2019 }), {
        relevanceRank: index + 11,
        relevancePoolSize: 15,
      }),
    );
    const inputs = [...classic, ...recent, ...longTail];

    const forward = rankLiteratureCandidates(inputs, 10, 2026);
    const reverse = rankLiteratureCandidates([...inputs].reverse(), 10, 2026);

    expect(forward.tierCounts).toEqual({ core: 4, rising: 3, broad: 3 });
    expect(forward.selectedCount).toBe(10);
    expect(forward.retrievedCount).toBe(15);
    expect(
      forward.candidates.map(({ providerId, discovery }) => ({
        providerId,
        tier: discovery?.tier,
        tierRank: discovery?.tierRank,
      })),
    ).toEqual(
      reverse.candidates.map(({ providerId, discovery }) => ({
        providerId,
        tier: discovery?.tier,
        tierRank: discovery?.tierRank,
      })),
    );
    expect(
      forward.candidates.slice(0, 4).every(({ discovery }) => discovery?.tier === 'core'),
    ).toBe(true);
    expect(
      forward.candidates.slice(4, 7).every(({ discovery }) => discovery?.tier === 'rising'),
    ).toBe(true);
  });

  it('keeps a highly cited classic in the core layer and a high-momentum recent paper rising', () => {
    const classic = rankingInput(
      candidate('classic', { publishedYear: 2012, citationCount: 12_000 }),
      { relevanceRank: 1, relevancePoolSize: 4, citationRank: 1, citationPoolSize: 4 },
    );
    const hotRecent = rankingInput(
      candidate('hot-recent', { publishedYear: 2025, citationCount: 600 }),
      {
        relevanceRank: 3,
        relevancePoolSize: 4,
        recentRank: 1,
        recentPoolSize: 3,
        influentialCitationCount: 75,
      },
    );
    const newButUncited = rankingInput(
      candidate('new-uncited', { publishedYear: 2026, citationCount: 0 }),
      { relevanceRank: 4, relevancePoolSize: 4, recentRank: 2, recentPoolSize: 3 },
    );
    const relevant = rankingInput(
      candidate('relevant', { publishedYear: 2020, citationCount: 20 }),
      {
        relevanceRank: 2,
        relevancePoolSize: 4,
      },
    );

    const result = rankLiteratureCandidates([relevant, classic, hotRecent, newButUncited], 3, 2026);
    const core = result.candidates.find(({ discovery }) => discovery?.tier === 'core');
    const rising = result.candidates.find(({ discovery }) => discovery?.tier === 'rising');

    expect(core?.providerId).toBe('classic');
    expect(core?.discovery?.reasons).toEqual(
      expect.arrayContaining(['high-citation-impact', 'established-classic']),
    );
    expect(rising?.providerId).toBe('hot-recent');
    expect(rising?.discovery?.reasons).toEqual(
      expect.arrayContaining(['recent-publication', 'estimated-citation-momentum']),
    );
  });

  it('caps the famous-author signal so it cannot overwhelm query relevance', () => {
    const relevant = rankingInput(candidate('relevant', { citationCount: 10 }), {
      relevanceRank: 1,
      relevancePoolSize: 10,
      maxAuthorHIndex: 10,
    });
    const famousButIrrelevant = rankingInput(candidate('celebrity', { citationCount: 0 }), {
      relevanceRank: 10,
      relevancePoolSize: 10,
      maxAuthorHIndex: 10_000,
    });

    const result = rankLiteratureCandidates([famousButIrrelevant, relevant], 1, 2026);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.providerId).toBe('relevant');
    expect(result.candidates[0]?.discovery?.relevanceScore).toBe(1);
  });

  it('deduplicates DOI matches across providers and excludes non-paper junk types', () => {
    const crossref = rankingInput(
      candidate('crossref-id', {
        provider: 'crossref',
        doi: '10.1000/same',
        workType: 'journal-article',
      }),
      { relevanceRank: 2, relevancePoolSize: 3, signalSources: ['crossref'] },
    );
    const semanticScholar = rankingInput(
      candidate('s2-id', { doi: '10.1000/same', workType: 'JournalArticle' }),
      {
        relevanceRank: 1,
        relevancePoolSize: 3,
        influentialCitationCount: 4,
        maxAuthorHIndex: 55,
        signalSources: ['semantic-scholar'],
      },
    );
    const junkTypes = ['dataset', 'editorial', 'news', 'peer-review', 'reference-entry'];
    const junk = junkTypes.map((workType, index) =>
      rankingInput(candidate(`junk-${index}`, { workType }), {
        relevanceRank: 1,
        relevancePoolSize: 1,
      }),
    );

    const result = rankLiteratureCandidates([crossref, semanticScholar, ...junk], 10, 2026);

    expect(result.retrievedCount).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.doi).toBe('10.1000/same');
    expect(result.candidates[0]?.discovery?.signalSources).toEqual([
      'crossref',
      'semantic-scholar',
    ]);
    expect(result.candidates[0]?.discovery?.maxAuthorHIndex).toBe(55);
  });

  it('losslessly merges richer Crossref metadata into a sparse Semantic Scholar DOI match', () => {
    const sparseSemanticScholar = rankingInput(
      candidate('s2-sparse', {
        doi: '10.1000/classic-table-model',
        title: 'Table model',
        authors: [],
        publishedYear: undefined,
        topics: ['foundation models'],
        workType: undefined,
        citationCount: undefined,
        sourceUrl: undefined,
      }),
      {
        relevanceRank: 1,
        relevancePoolSize: 3,
        signalSources: ['semantic-scholar'],
      },
    );
    const richCrossref = rankingInput(
      candidate('crossref-classic', {
        provider: 'crossref',
        providerId: '10.1000/classic-table-model',
        doi: '10.1000/classic-table-model',
        title: 'A Classical Foundation Model for Tabular Data',
        authors: ['Ada Researcher', 'Grace Scientist'],
        containerTitle: 'Journal of Foundational Machine Learning',
        publishedYear: 2012,
        topics: ['tabular learning', 'machine learning'],
        workType: 'journal-article',
        citationCount: 5_000,
        sourceUrl: 'https://doi.org/10.1000/classic-table-model',
      }),
      {
        citationRank: 1,
        citationPoolSize: 3,
        signalSources: ['crossref'],
      },
    );
    const distractors = [
      rankingInput(candidate('recent-distractor', { publishedYear: 2026 }), {
        relevanceRank: 2,
        relevancePoolSize: 3,
      }),
      rankingInput(candidate('tail-distractor', { publishedYear: 2022 }), {
        relevanceRank: 3,
        relevancePoolSize: 3,
      }),
    ];

    const forward = rankLiteratureCandidates(
      [sparseSemanticScholar, richCrossref, ...distractors],
      3,
      2026,
    );
    const reverse = rankLiteratureCandidates(
      [...distractors, richCrossref, sparseSemanticScholar],
      3,
      2026,
    );
    const merged = forward.candidates.find(({ doi }) => doi === '10.1000/classic-table-model');

    expect(merged).toMatchObject({
      provider: 'semantic-scholar',
      providerId: 's2-sparse',
      title: 'A Classical Foundation Model for Tabular Data',
      authors: ['Ada Researcher', 'Grace Scientist'],
      containerTitle: 'Journal of Foundational Machine Learning',
      publishedYear: 2012,
      topics: ['tabular learning', 'machine learning', 'foundation models'],
      workType: 'journal-article',
      citationCount: 5_000,
      sourceUrl: 'https://doi.org/10.1000/classic-table-model',
      fingerprint: literatureFingerprint(
        'A Classical Foundation Model for Tabular Data',
        ['Ada Researcher', 'Grace Scientist'],
        2012,
      ),
    });
    expect(merged?.discovery).toMatchObject({
      tier: 'core',
      relevanceScore: 1,
      signalSources: ['crossref', 'semantic-scholar'],
    });
    expect(merged?.discovery?.reasons).toEqual(
      expect.arrayContaining(['high-citation-impact', 'established-classic']),
    );
    expect(reverse.candidates).toEqual(forward.candidates);
  });

  it('keeps an absent lane rank absent when duplicate provider lanes are merged', () => {
    const relevanceLane = rankingInput(
      candidate('duplicate-relevance', { doi: '10.1000/merged-lanes', publishedYear: 2026 }),
      { relevanceRank: 10, relevancePoolSize: 10 },
    );
    const citationLane = rankingInput(
      candidate('duplicate-citation', { doi: '10.1000/merged-lanes', publishedYear: 2026 }),
      { citationRank: 1, citationPoolSize: 10 },
    );

    const result = rankLiteratureCandidates([relevanceLane, citationLane], 1, 2026);

    expect(result.retrievedCount).toBe(1);
    expect(result.candidates[0]?.discovery?.relevanceScore).toBe(0.1);
    expect(result.candidates[0]?.discovery?.influentialCitationCount).toBeNull();
    expect(result.candidates[0]?.discovery?.maxAuthorHIndex).toBeNull();
  });

  it('does not treat citation-sorted or newest-only lane rank as query relevance', () => {
    const citedOnly = rankingInput(candidate('cited-only', { citationCount: 500 }), {
      citationRank: 1,
      citationPoolSize: 10,
    });
    const recentOnly = rankingInput(
      candidate('recent-only', { publishedYear: 2026, citationCount: 5 }),
      {
        recentRank: 1,
        recentPoolSize: 10,
      },
    );
    const relevant = rankingInput(candidate('relevance-result', { citationCount: 0 }), {
      relevanceRank: 1,
      relevancePoolSize: 10,
    });

    const result = rankLiteratureCandidates([citedOnly, recentOnly, relevant], 3, 2026);
    const byId = new Map(result.candidates.map((paper) => [paper.providerId, paper]));

    expect(byId.get('cited-only')?.discovery?.relevanceScore).toBe(0.12);
    expect(byId.get('recent-only')?.discovery?.relevanceScore).toBe(0.12);
    expect(byId.get('recent-only')?.discovery?.tier).not.toBe('rising');
    expect(byId.get('relevance-result')?.discovery?.relevanceScore).toBe(1);
  });

  it('never quota-promotes zero-citation papers into Core, with or without a venue', () => {
    const inputs = Array.from({ length: 10 }, (_, index) =>
      rankingInput(
        candidate(`zero-citation-${index}`, {
          containerTitle: index % 2 === 0 ? undefined : 'Example Venue',
          citationCount: 0,
          publishedYear: 2020,
        }),
        { relevanceRank: index + 1, relevancePoolSize: 10 },
      ),
    );

    const result = rankLiteratureCandidates(inputs, 10, 2026);

    expect(result.tierCounts).toEqual({ core: 0, rising: 0, broad: 10 });
    expect(result.candidates.every(({ discovery }) => discovery?.tier === 'broad')).toBe(true);
    expect(result.candidates[0]?.discovery?.matchedLayers).toEqual(['broad']);
    expect(result.candidates[0]?.discovery?.reasons).toContain('core-impact-threshold-not-met');
  });

  it('can keep a high-impact relevant paper Core even when venue metadata is absent', () => {
    const result = rankLiteratureCandidates(
      [
        rankingInput(
          candidate('high-impact-preprint', {
            containerTitle: undefined,
            citationCount: 500,
            publishedYear: 2020,
          }),
          { relevanceRank: 1, relevancePoolSize: 1 },
        ),
      ],
      1,
      2026,
    );

    expect(result.tierCounts).toEqual({ core: 1, rising: 0, broad: 0 });
    expect(result.candidates[0]?.discovery?.tier).toBe('core');
    expect(result.candidates[0]?.discovery?.reasons).toContain('high-citation-impact');
  });

  it('records why a Rising paper did not pass the Core impact gate', () => {
    const result = rankLiteratureCandidates(
      [
        rankingInput(candidate('rising-low-impact', { publishedYear: 2026, citationCount: 2 }), {
          relevanceRank: 1,
          relevancePoolSize: 2,
          recentRank: 1,
          recentPoolSize: 1,
        }),
        rankingInput(candidate('broad-control', { publishedYear: 2019, citationCount: 0 }), {
          relevanceRank: 2,
          relevancePoolSize: 2,
        }),
      ],
      2,
      2026,
    );
    const rising = result.candidates.find(({ discovery }) => discovery?.tier === 'rising');

    expect(rising?.providerId).toBe('rising-low-impact');
    expect(rising?.discovery?.reasons).toContain('core-impact-threshold-not-met');
  });

  it('keeps future-dated metadata out of Core and Rising', () => {
    const result = rankLiteratureCandidates(
      [
        rankingInput(
          candidate('future-paper', {
            publishedYear: 2027,
            citationCount: 10_000,
          }),
          {
            relevanceRank: 1,
            relevancePoolSize: 1,
            citationRank: 1,
            citationPoolSize: 1,
            recentRank: 1,
            recentPoolSize: 1,
            influentialCitationCount: 100,
          },
        ),
      ],
      1,
      2026,
    );

    expect(result.tierCounts).toEqual({ core: 0, rising: 0, broad: 1 });
    expect(result.candidates[0]?.discovery?.matchedLayers).toEqual(['broad']);
    expect(result.candidates[0]?.discovery?.reasons).toContain('future-publication-year');
  });

  it('keeps citation-heavy candidates Broad when minimum bibliographic identity is incomplete', () => {
    const result = rankLiteratureCandidates(
      [
        rankingInput(
          candidate('incomplete', {
            providerId: undefined,
            doi: undefined,
            authors: [],
            publishedYear: undefined,
            citationCount: 10_000,
          }),
          {
            relevanceRank: 1,
            relevancePoolSize: 1,
            citationRank: 1,
            citationPoolSize: 1,
          },
        ),
      ],
      1,
      2026,
    );

    expect(result.tierCounts).toEqual({ core: 0, rising: 0, broad: 1 });
    expect(result.candidates[0]?.discovery?.reasons).toContain('incomplete-bibliographic-metadata');
  });

  it('reserves a bounded Core share for highly cited classics outside the relevance lane', () => {
    const relevanceOnly = Array.from({ length: 100 }, (_, index) =>
      rankingInput(candidate(`relevance-only-${index}`, { citationCount: 0 }), {
        relevanceRank: index + 1,
        relevancePoolSize: 100,
      }),
    );
    const citationOnlyClassics = Array.from({ length: 8 }, (_, index) =>
      rankingInput(
        candidate(`citation-only-classic-${index}`, {
          publishedYear: 2010,
          citationCount: 10_000 - index * 500,
        }),
        {
          citationRank: index + 1,
          citationPoolSize: 9,
        },
      ),
    );
    const trivialCitationOnly = rankingInput(
      candidate('citation-only-trivial', { publishedYear: 2010, citationCount: 1 }),
      { citationRank: 9, citationPoolSize: 9 },
    );
    const inputs = [...relevanceOnly, ...citationOnlyClassics, trivialCitationOnly];

    const forward = rankLiteratureCandidates(inputs, 50, 2026);
    const reverse = rankLiteratureCandidates([...inputs].reverse(), 50, 2026);
    const canonicalCore = forward.candidates.filter(
      ({ providerId, discovery }) =>
        providerId?.startsWith('citation-only-classic-') && discovery?.tier === 'core',
    );

    expect(forward.tierCounts).toEqual({ core: 5, rising: 0, broad: 45 });
    expect(canonicalCore).toHaveLength(5);
    expect(canonicalCore.every(({ discovery }) => discovery?.relevanceScore === 0.12)).toBe(true);
    expect(
      forward.candidates.find(({ providerId }) => providerId === 'citation-only-trivial')?.discovery
        ?.tier,
    ).not.toBe('core');
    expect(
      forward.candidates.map(({ providerId, discovery }) => ({
        providerId,
        tier: discovery?.tier,
        tierRank: discovery?.tierRank,
      })),
    ).toEqual(
      reverse.candidates.map(({ providerId, discovery }) => ({
        providerId,
        tier: discovery?.tier,
        tierRank: discovery?.tierRank,
      })),
    );
  });

  it('does not label trivial citation counts as canonical impact or rising momentum', () => {
    const oldOneCitation = rankingInput(
      candidate('one-citation-classic', { publishedYear: 2010, citationCount: 1 }),
      { relevanceRank: 1, relevancePoolSize: 3, citationRank: 1, citationPoolSize: 1 },
    );
    const newUncited = rankingInput(
      candidate('uncited-new', { publishedYear: 2026, citationCount: 0 }),
      { relevanceRank: 2, relevancePoolSize: 3, recentRank: 1, recentPoolSize: 1 },
    );
    const tail = rankingInput(candidate('tail', { publishedYear: 2020, citationCount: 0 }), {
      relevanceRank: 3,
      relevancePoolSize: 3,
    });

    const result = rankLiteratureCandidates([oldOneCitation, newUncited, tail], 3, 2026);
    const oldPaper = result.candidates.find(
      ({ providerId }) => providerId === 'one-citation-classic',
    );

    expect(result.tierCounts).toEqual({ core: 0, rising: 0, broad: 3 });
    expect(oldPaper?.discovery?.tier).toBe('broad');
    expect(oldPaper?.discovery?.matchedLayers).toEqual(['broad']);
    expect(oldPaper?.discovery?.reasons).toContain('core-impact-threshold-not-met');
    expect(oldPaper?.discovery?.reasons).not.toContain('high-citation-impact');
    expect(oldPaper?.discovery?.reasons).not.toContain('established-classic');
    expect(
      result.candidates.find(({ providerId }) => providerId === 'uncited-new')?.discovery?.tier,
    ).not.toBe('rising');
  });
});
