import { setUiLanguage } from '@gosu/ui/language';
import { afterEach, describe, expect, it } from 'vitest';

import {
  literatureDegradationLabel,
  literatureOrganizeBatches,
  literaturePlannedSearches,
  literatureProviderFailureLabel,
  literatureSearchSummary,
  literatureSignalLabel,
  recordIdsCreatedBySearches,
} from '../src/renderer/src/literature-search-flow';
import type { LiteratureRecord, LiteratureSearchReceipt } from '../src/shared/literature-contracts';

afterEach(() => setUiLanguage('en'));

function receipt(overrides: Partial<LiteratureSearchReceipt> = {}): LiteratureSearchReceipt {
  return {
    run: {
      schemaVersion: 1,
      id: '33333333-3333-4333-8333-333333333333',
      projectId: '11111111-1111-4111-8111-111111111111',
      provider: 'balanced',
      query: 'tabular foundation model',
      fromYear: null,
      toYear: null,
      requestedLimit: 50,
      status: 'complete',
      foundCount: 12,
      newCount: 9,
      updatedCount: 1,
      unchangedCount: 2,
      conflictCount: 0,
      conflicts: [],
      createdAt: '2026-08-05T00:00:00.000Z',
      completedAt: '2026-08-05T00:00:01.000Z',
    },
    foundCount: 12,
    newCount: 9,
    updatedCount: 1,
    unchangedCount: 2,
    conflictCount: 0,
    retrievedCount: 140,
    selectedCount: 12,
    tierCounts: { core: 2, rising: 3, broad: 7 },
    ...overrides,
  };
}

describe('literature search wording', () => {
  it('names every degradation, signal and failure cause in Korean instead of a raw code', () => {
    setUiLanguage('ko');
    expect(literatureDegradationLabel('semantic-scholar-unavailable')).toBe(
      'Semantic Scholar 응답 없음',
    );
    expect(literatureDegradationLabel('crossref-recent-lane-unavailable')).toBe(
      'Crossref 최신순 목록 없음',
    );
    expect(literatureSignalLabel('citation-authority')).toBe('인용 영향력');
    expect(literatureSignalLabel('hugging-face-index')).toBe('Hugging Face 색인');
    expect(
      literatureProviderFailureLabel({
        provider: 'semantic-scholar',
        cause: 'rate_limited',
        attempts: 3,
      }),
    ).toBe('Semantic Scholar가 요청 한도를 넘었다고 응답했습니다 (3회 시도)');
    expect(
      literatureProviderFailureLabel({ provider: 'crossref', cause: 'timeout', attempts: 1 }),
    ).toBe('Crossref가 제한 시간 안에 응답하지 않았습니다 (1회 시도)');
  });

  it('summarizes one search in Korean with counts, layers and what was missing', () => {
    setUiLanguage('ko');
    const text = literatureSearchSummary([
      receipt({
        coverage: {
          source: 'crossref',
          availableSignals: ['relevance', 'hugging-face-index'],
          degradationReasons: ['semantic-scholar-unavailable'],
        },
        providerFailures: [{ provider: 'semantic-scholar', cause: 'rate_limited', attempts: 3 }],
      }),
    ]);

    expect(text).toContain('검색 완료: 후보 140편 검토, 12편 선택');
    expect(text).toContain('새로 추가 9편, 갱신 1편, 이미 저장됨 2편');
    expect(text).toContain('핵심 2 · 주목 3 · 넓은 범위 7');
    expect(text).toContain('Semantic Scholar가 요청 한도를 넘었다고 응답했습니다 (3회 시도)');
    expect(text).toContain('인용 기반 계층(핵심·주목)은 다시 검색하면 채워질 수 있습니다');
    expect(text).not.toMatch(/Unavailable|Deep search/u);
  });

  it('adds up the searches of one plan and lists the queries that were really used', () => {
    const text = literatureSearchSummary(
      [
        receipt(),
        receipt({
          run: {
            ...receipt().run,
            id: '44444444-4444-4444-8444-444444444444',
            query: 'graphical lasso',
          },
          newCount: 4,
          updatedCount: 0,
          unchangedCount: 0,
          foundCount: 4,
          retrievedCount: 60,
          selectedCount: 4,
          tierCounts: { core: 1, rising: 0, broad: 3 },
        }),
      ],
      { plannedQueries: ['tabular foundation model', 'graphical lasso'] },
    );

    expect(text).toContain('Searched as: “tabular foundation model”, “graphical lasso”.');
    expect(text).toContain('200 candidates screened, 16 selected');
    expect(text).toContain('13 added, 1 updated, 2 already saved');
    expect(text).toContain('3 core · 3 rising · 10 broad');
  });

  it('explains an empty result instead of reporting a successful search', () => {
    setUiLanguage('ko');
    const empty = receipt({
      foundCount: 0,
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      retrievedCount: 100,
      selectedCount: 0,
      tierCounts: { core: 0, rising: 0, broad: 0 },
    });

    expect(literatureSearchSummary([empty])).toContain(
      '후보 100편 가운데 검색어를 언급하는 논문이 없어 아무것도 저장하지 않았습니다',
    );
    expect(literatureSearchSummary([empty])).toContain('영어 키워드');
  });

  it('keeps the skipped identity conflicts visible', () => {
    const text = literatureSearchSummary([
      receipt({
        conflictCount: 1,
        run: {
          ...receipt().run,
          conflictCount: 1,
          conflicts: [
            {
              ordinal: 1,
              provider: 'crossref',
              providerRecordId: '10.1000/gosu.conflict',
              canonicalId: 'arxiv:2608.00001',
              doi: '10.1000/gosu.conflict',
              fingerprint: 'b'.repeat(64),
              title: 'Ambiguous metadata fixture',
              authors: ['Ada Researcher'],
              publishedYear: 2026,
            },
          ],
        },
      }),
    ]);

    expect(text).toContain('1 ambiguous result was skipped without changing saved papers');
    expect(text).toContain('arxiv:2608.00001');
    expect(text).toContain('DOI 10.1000/gosu.conflict');
  });
});

describe('literature search planning helpers', () => {
  it('merges the tags typed by the user with the planned ones inside the limits', () => {
    const planned = literaturePlannedSearches(
      [
        {
          query: 'TabPFN class expansion',
          topics: ['tabular models', 'Tabular Models'],
          keywords: ['TabPFN'],
        },
      ],
      { topics: ['my topic'], keywords: Array.from({ length: 24 }, (_, index) => `k${index}`) },
    );

    expect(planned).toHaveLength(1);
    expect(planned[0]?.query).toBe('TabPFN class expansion');
    expect(planned[0]?.searchTags.topics).toEqual(['my topic', 'tabular models']);
    expect(planned[0]?.searchTags.keywords).toHaveLength(24);
    expect(planned[0]?.searchTags.keywords).not.toContain('TabPFN');
  });

  it('finds the records that these searches created and leaves older papers alone', () => {
    const record = (id: string, searchRunId: string | null, createdAt: string) =>
      ({
        id,
        createdAt,
        abstractText: 'An abstract.',
        aiAnnotations: null,
        discovery: searchRunId ? { searchRunId } : null,
      }) as unknown as LiteratureRecord;
    const runs = [
      { id: 'run-a', completedAt: '2026-08-05T00:00:01.000Z' },
      { id: 'run-b', completedAt: '2026-08-05T00:00:09.000Z' },
    ];

    expect(
      recordIdsCreatedBySearches(
        [
          record('new-a', 'run-a', '2026-08-05T00:00:01.000Z'),
          record('new-b', 'run-b', '2026-08-05T00:00:09.000Z'),
          record('reclassified', 'run-a', '2026-07-01T00:00:00.000Z'),
          record('other-run', 'run-z', '2026-08-05T00:00:01.000Z'),
          record('imported', null, '2026-08-05T00:00:01.000Z'),
        ],
        runs,
      ),
    ).toEqual(['new-a', 'new-b']);
  });

  it('splits AI organization into small batches and bounds the automatic part', () => {
    const ids = Array.from({ length: 47 }, (_, index) => `id-${index}`);
    const batches = literatureOrganizeBatches(ids, { batchSize: 10, maximum: 30 });

    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 10]);
    expect(batches[2]?.[9]).toBe('id-29');
    expect(literatureOrganizeBatches([], { batchSize: 10, maximum: 30 })).toEqual([]);
  });
});
