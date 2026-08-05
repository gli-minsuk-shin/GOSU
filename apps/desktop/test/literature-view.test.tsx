import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  LiteratureTable,
  LiteratureDetail,
  LiteratureView,
  literatureCoreGateSummary,
  literatureCorePolicyCounts,
  literatureLayerCounts,
  literatureTableScrollAvailability,
  literatureSearchNotice,
  literatureSearchTagDraft,
  literatureViewRecord,
  moveLiteratureTable,
  resetLiteratureTableVerticalPosition,
  type LiteratureViewAdapter,
} from '../src/renderer/src/literature-view';
import type { LiteratureRecord } from '../src/shared/literature-contracts';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Evidence synthesis',
  slug: 'evidence-synthesis',
  version: 1,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const rawPaper: LiteratureRecord = {
  schemaVersion: 1,
  id: '22222222-2222-4222-8222-222222222222',
  projectId: project.id,
  provider: 'crossref',
  providerRecordId: '10.1000/gosu.1',
  fingerprint: 'a'.repeat(64),
  title: 'Reliable evaluation for agentic research systems',
  authors: ['Ada Researcher', 'Grace Reviewer'],
  containerTitle: 'GOSU Transactions',
  publishedYear: 2026,
  sourceTopics: ['evaluation', 'agents'],
  searchTags: {
    topics: ['Agentic systems'],
    keywords: ['evaluation'],
  },
  doi: '10.1000/gosu.1',
  workType: 'journal-article',
  citationCount: 55,
  reviewStatus: 'included',
  sourceUrl: 'https://doi.org/10.1000/gosu.1',
  citationKey: 'researcher2026reliable',
  version: 3,
  annotationVersion: 2,
  manualAnnotations: {
    topics: ['evaluation'],
    summary: 'Human-verified summary',
    relevance: 'Matches the primary metric design.',
  },
  aiAnnotations: null,
  discovery: {
    tier: 'core',
    matchedLayers: ['core', 'broad'],
    tierRank: 1,
    overallScore: 0.91,
    relevanceScore: 0.95,
    authorityScore: 0.82,
    momentumScore: 0.36,
    citationVelocityProxy: 4.2,
    influentialCitationCount: 10,
    maxAuthorHIndex: 64,
    reasons: ['high-query-relevance', 'high-citation-impact', 'prominent-author-signal'],
    signalSources: ['semantic-scholar'],
    searchRunId: '33333333-3333-4333-8333-333333333333',
    query: 'agentic research evaluation',
    policyId: 'balanced-three-layer',
    policyVersion: 2,
    classifiedAt: '2026-08-04T00:00:00.000Z',
  },
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};
const paper = literatureViewRecord(rawPaper);

const adapter: LiteratureViewAdapter = {
  list: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    projectId: project.id,
    records: [],
    total: 0,
    recentSearches: [],
  }),
  search: vi.fn(),
  updateAnnotations: vi.fn(),
  deleteRecord: vi.fn(),
  importRecords: vi.fn(),
  exportRecords: vi.fn(),
};

describe('Literature workspace', () => {
  it('reports an isolated identity conflict without presenting the entire search as failed', () => {
    const completedAt = '2026-08-05T00:00:01.000Z';
    const notice = literatureSearchNotice({
      run: {
        schemaVersion: 1,
        id: '33333333-3333-4333-8333-333333333333',
        projectId: project.id,
        provider: 'crossref',
        query: 'tabular foundation model',
        fromYear: null,
        toYear: null,
        requestedLimit: 25,
        status: 'complete',
        foundCount: 25,
        newCount: 23,
        updatedCount: 0,
        unchangedCount: 1,
        conflictCount: 1,
        conflicts: [
          {
            ordinal: 25,
            provider: 'crossref',
            providerRecordId: '10.1000/gosu.conflict',
            doi: '10.1000/gosu.conflict',
            fingerprint: 'b'.repeat(64),
            title: 'Ambiguous metadata fixture',
            authors: ['Ada Researcher'],
            publishedYear: 2026,
          },
        ],
        createdAt: '2026-08-05T00:00:00.000Z',
        completedAt,
      },
      foundCount: 25,
      newCount: 23,
      updatedCount: 0,
      unchangedCount: 1,
      conflictCount: 1,
      coverage: {
        source: 'crossref',
        availableSignals: ['relevance', 'citation-authority'],
        degradationReasons: ['semantic-scholar-unavailable', 'crossref-recent-lane-unavailable'],
      },
    });

    expect(notice).toContain('Deep search complete: 25 selected');
    expect(notice).toContain('1 ambiguous result was skipped');
    expect(notice).toContain('without changing saved papers');
    expect(notice).toContain('Skipped: DOI 10.1000/gosu.conflict');
    expect(notice).toContain('Reduced signal coverage');
    expect(notice).toContain('Semantic Scholar Unavailable');
    expect(notice).toContain('available: Relevance, Citation Authority');
  });

  it('bounds conflict identifiers while reporting the omitted count', () => {
    const conflicts = Array.from({ length: 3 }, (_, index) => ({
      ordinal: index + 1,
      provider: 'crossref' as const,
      providerRecordId: `10.1000/gosu.conflict-${index + 1}`,
      doi: `10.1000/gosu.conflict-${index + 1}`,
      fingerprint: `${index + 1}`.repeat(64),
      title: `Ambiguous metadata fixture ${index + 1}`,
      authors: ['Ada Researcher'],
      publishedYear: 2026,
    }));
    const notice = literatureSearchNotice({
      run: {
        schemaVersion: 1,
        id: '44444444-4444-4444-8444-444444444444',
        projectId: project.id,
        provider: 'crossref',
        query: 'tabular foundation model',
        fromYear: null,
        toYear: null,
        requestedLimit: 25,
        status: 'complete',
        foundCount: 25,
        newCount: 20,
        updatedCount: 0,
        unchangedCount: 1,
        conflictCount: 4,
        conflicts,
        createdAt: '2026-08-05T00:00:00.000Z',
        completedAt: '2026-08-05T00:00:01.000Z',
      },
      foundCount: 25,
      newCount: 20,
      updatedCount: 0,
      unchangedCount: 1,
      conflictCount: 4,
    });

    expect(notice).toContain('DOI 10.1000/gosu.conflict-1');
    expect(notice).toContain('DOI 10.1000/gosu.conflict-3');
    expect(notice).toContain('+1 more');
  });

  it('exposes continual search, dialog-based interchange, and a clearly unavailable AI action', () => {
    const html = renderToStaticMarkup(<LiteratureView project={project} adapter={adapter} />);

    expect(html).toContain('Deep search and continue this review');
    expect(html).toContain('Topic tags');
    expect(html).toContain('Keyword tags');
    expect(html).toContain('leaving both fields blank uses the normalized search query');
    expect(html).toContain('aria-label="Search tag filter"');
    expect(html).toContain('All search tags');
    expect(html).toContain('Fixed policy v2');
    expect(html).toContain('Core is a maximum, never a quota');
    expect(html).toContain('Venue metadata and author h-index never promote a paper by themselves');
    expect(html).toContain('aria-label="Discovery layer view"');
    expect(html).toContain('aria-label="Total, 0 saved papers"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-controls="literature-evidence-table-panel"');
    expect(html).toContain('id="literature-evidence-table-panel"');
    expect(html.indexOf('>Total<')).toBeLessThan(html.indexOf('>Core &amp; canonical<'));
    expect(html).toContain('Core &amp; canonical');
    expect(html).toContain('Rising &amp; recent');
    expect(html).toContain('Broad discovery');
    expect(html).toContain('latest matching search');
    expect(html).toContain('scores are only comparable within the same search');
    expect(html).toContain('Import');
    expect(html).toContain('Export JSON');
    expect(html).toContain('Export CSV');
    expect(html).toContain('Export BibTeX');
    expect(html).toContain('AI drafts complete');
    expect(html).toContain('AI organization is disabled in this build');
    expect(html).not.toContain('type="file"');
  });

  it('renders the required evidence columns, DOI, typed search tags, and bounded pagination', () => {
    const html = renderToStaticMarkup(
      <LiteratureTable
        records={[paper]}
        selectedId={paper.id}
        textFilter=""
        statusFilter="all"
        sortKey="year"
        sortDirection="descending"
        page={1}
        onSelect={vi.fn()}
        onSort={vi.fn()}
        onPage={vi.fn()}
      />,
    );

    for (const heading of [
      'Title',
      'Last discovery layer',
      'Authors',
      'Journal / venue',
      'Year',
      'Search tags',
      'DOI',
      'Cited by',
      'Type',
      'Review status',
      'Source',
    ]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain(paper.title);
    expect(html).toContain(paper.doi);
    expect(html).toContain('evaluation');
    expect(html).toContain('Agentic systems');
    expect(html).toContain('aria-label="Filter by topic tag Agentic systems"');
    expect(html).toContain('aria-label="Filter by keyword tag evaluation"');
    expect(html).toContain('Core &amp; canonical');
    expect(html).toContain('91 / 100 · within search');
    expect(html).toContain('55 citations · 10 influential');
    expect(html.match(/>evaluation</gu)).toHaveLength(1);
    expect(html).toContain('page 1 of 1');
  });

  it('keeps an active exact search tag visible when it is beyond the default chip preview', () => {
    const manyTags = literatureViewRecord({
      ...rawPaper,
      searchTags: {
        topics: ['first', 'second', 'third', 'selected later'],
        keywords: ['fifth'],
      },
    });
    const html = renderToStaticMarkup(
      <LiteratureTable
        records={[manyTags]}
        selectedId={null}
        textFilter=""
        statusFilter="all"
        searchTagFilter="topics:selected later"
        sortKey="searchTags"
        sortDirection="ascending"
        page={1}
        onSelect={vi.fn()}
        onSort={vi.fn()}
        onPage={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Filter by topic tag selected later"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('>+2</small>');
  });

  it('renders search, manual, AI, and provider topics as visibly separate sources', () => {
    const record = {
      ...rawPaper,
      aiAnnotations: {
        topics: ['AI suggestion'],
        summary: 'Metadata-only summary',
        relevance: 'medium' as const,
        studyType: 'benchmark',
        limitations: ['Full text unavailable'],
        provenance: {
          invocation: {
            schemaVersion: 1,
            invocationId: '66666666-6666-4666-8666-666666666666',
            providerId: 'codex',
            requestedModelId: 'fixture-model',
            resolvedModelId: 'fixture-model',
            reasoningOptionId: null,
            catalogVersion: 'fixture-catalog',
            startedAt: '2026-08-04T00:00:00.000Z',
          },
          inputSha256: 'b'.repeat(64),
          generatedAt: '2026-08-04T00:00:00.000Z',
          metadataOnly: true as const,
        },
      },
    } satisfies LiteratureRecord;
    const html = renderToStaticMarkup(
      <LiteratureDetail record={record} busy={false} onSave={vi.fn()} onDelete={vi.fn()} />,
    );

    expect(html).toContain('aria-label="Search provenance tags"');
    expect(html).toContain('Search tags');
    expect(html).toContain('Agentic systems');
    expect(html).toContain('aria-label="Source keywords"');
    expect(html).toContain('Source keywords');
    expect(html).toContain('agents');
    expect(html).toContain('AI topic suggestions');
    expect(html).toContain('AI suggestion');
    expect(html).toContain('Manual review topics');
  });

  it('restores separate Topic and Keyword draft fields from a recent search run', () => {
    expect(
      literatureSearchTagDraft({
        searchTags: { topics: ['Tabular FM', 'Evaluation'], keywords: ['TabPFN', 'benchmark'] },
      }),
    ).toEqual({
      topicText: 'Tabular FM, Evaluation',
      keywordText: 'TabPFN, benchmark',
    });
    expect(literatureSearchTagDraft({})).toEqual({ topicText: '', keywordText: '' });
  });

  it('keeps the evidence table in a bounded, keyboard-focusable two-axis scroll region', () => {
    const html = renderToStaticMarkup(
      <LiteratureTable
        records={[paper]}
        selectedId={null}
        textFilter=""
        statusFilter="all"
        sortKey="year"
        sortDirection="descending"
        page={1}
        onSelect={vi.fn()}
        onSort={vi.fn()}
        onPage={vi.fn()}
      />,
    );
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(html).toContain('id="literature-table-scroll-help"');
    expect(html).toContain('aria-label="Evidence table scroll controls"');
    expect(html).toContain('aria-label="Scroll evidence columns right"');
    expect(html).toContain('aria-label="Scroll evidence table to bottom"');
    expect(html).toMatch(
      /<div id="literature-evidence-scroll-region" class="literature-table-scroll" role="region" tabindex="0" aria-label="Literature evidence table" aria-describedby="literature-table-scroll-help">/u,
    );
    expect(styles).toMatch(
      /\.literature-workspace\s*\{(?=[^}]*\bgrid-template-columns:\s*minmax\(0, 1fr\);)(?=[^}]*\bwidth:\s*100%;)(?=[^}]*\bmin-width:\s*0;)[^}]*\}/su,
    );
    expect(styles).toMatch(
      /\.literature-library-card\s*\{(?=[^}]*\bgrid-template-columns:\s*minmax\(0, 1fr\);)(?=[^}]*\boverflow:\s*hidden;)[^}]*\}/su,
    );
    expect(styles).toMatch(
      /\.literature-table-scroll\s*\{(?=[^}]*\bdisplay:\s*block;)(?=[^}]*\bwidth:\s*100%;)(?=[^}]*\bmin-width:\s*0;)(?=[^}]*\bmax-width:\s*100%;)(?=[^}]*\bheight:\s*clamp\(320px, 52vh, 620px\);)(?=[^}]*\bcontain:\s*inline-size;)(?=[^}]*\boverflow-x:\s*auto;)(?=[^}]*\boverflow-y:\s*auto;)[^}]*\}/su,
    );
    expect(styles).toMatch(
      /\.literature-table-scroll\s*\{(?=[^}]*\boverscroll-behavior-x:\s*contain;)(?=[^}]*\boverscroll-behavior-y:\s*auto;)(?=[^}]*\bscrollbar-gutter:\s*stable both-edges;)(?=[^}]*\btouch-action:\s*pan-x pan-y;)[^}]*\}/su,
    );
    expect(styles).toMatch(
      /\.literature-table-scroll::-webkit-scrollbar\s*\{(?=[^}]*\bwidth:\s*12px;)(?=[^}]*\bheight:\s*12px;)[^}]*\}/su,
    );
    expect(styles).toMatch(
      /\.literature-table\s*\{(?=[^}]*\bwidth:\s*100%;)(?=[^}]*\bmin-width:\s*1420px;)[^}]*\}/su,
    );
  });

  it('computes table scroll affordances and bounded navigation targets', () => {
    const scrollTo = vi.fn();
    const element = {
      clientHeight: 500,
      clientWidth: 800,
      scrollHeight: 1_900,
      scrollLeft: 100,
      scrollTop: 300,
      scrollWidth: 2_000,
      scrollTo,
    } as unknown as HTMLElement;

    expect(literatureTableScrollAvailability(element)).toEqual({
      left: true,
      right: true,
      top: true,
      bottom: true,
    });

    moveLiteratureTable(element, 'left');
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 300, behavior: 'auto' });
    moveLiteratureTable(element, 'right');
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 740, top: 300, behavior: 'auto' });
    moveLiteratureTable(element, 'top');
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 100, top: 0, behavior: 'auto' });
    moveLiteratureTable(element, 'bottom');
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 100, top: 1_400, behavior: 'auto' });

    resetLiteratureTableVerticalPosition(element);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 100, top: 0, behavior: 'auto' });
  });

  it('counts Total across every layer, including imported and unclassified papers', () => {
    expect(
      literatureLayerCounts([
        { discoveryTier: 'core' },
        { discoveryTier: 'rising' },
        { discoveryTier: 'broad' },
        { discoveryTier: 'unclassified' },
      ]),
    ).toEqual({ all: 4, core: 1, rising: 1, broad: 1, unclassified: 1 });
  });

  it('explains current Core gates and marks old policy labels as historical', () => {
    expect(literatureCoreGateSummary(rawPaper)).toBe(
      'Passed · relevance-lane rank 95 ≥ 55 · 55 citations · 10 influential',
    );
    expect(
      literatureCoreGateSummary({
        ...rawPaper,
        citationCount: null,
        discovery: rawPaper.discovery
          ? {
              ...rawPaper.discovery,
              tier: 'broad',
              influentialCitationCount: null,
              reasons: ['core-impact-threshold-not-met', 'broad-recall'],
            }
          : null,
      }),
    ).toBe(
      'Not passed · citations unavailable · influential citations unavailable; needs ≥50 citations or ≥10 influential',
    );
    expect(
      literatureCoreGateSummary({
        ...rawPaper,
        discovery: rawPaper.discovery ? { ...rawPaper.discovery, policyVersion: 1 } : null,
      }),
    ).toBe('Legacy policy v1 — search again to apply v2');
    expect(
      literatureCoreGateSummary({
        ...rawPaper,
        discovery: rawPaper.discovery ? { ...rawPaper.discovery, policyVersion: 3 } : null,
      }),
    ).toBe('Policy balanced-three-layer v3 — current v2 Core gate is not interpreted');
  });

  it('separates current v2 Core counts from historical or other-policy labels', () => {
    const legacy = {
      ...rawPaper,
      id: '44444444-4444-4444-8444-444444444444',
      discovery: rawPaper.discovery ? { ...rawPaper.discovery, policyVersion: 1 } : null,
    } satisfies LiteratureRecord;
    const otherPolicy = {
      ...rawPaper,
      id: '55555555-5555-4555-8555-555555555555',
      discovery: rawPaper.discovery
        ? { ...rawPaper.discovery, policyId: 'crossref-basic', policyVersion: 1 }
        : null,
    } satisfies LiteratureRecord;

    expect(literatureCorePolicyCounts([rawPaper, legacy, otherPolicy])).toEqual({
      current: 1,
      historicalOrOther: 2,
    });
  });

  it('keeps table navigation usable when no results match', () => {
    const html = renderToStaticMarkup(
      <LiteratureTable
        records={[paper]}
        selectedId={null}
        textFilter="unrelated query"
        statusFilter="all"
        sortKey="title"
        sortDirection="ascending"
        page={1}
        onSelect={vi.fn()}
        onSort={vi.fn()}
        onPage={vi.fn()}
      />,
    );

    expect(html).toContain('No matching papers');
    expect(html).toContain('Clear the table filter');
  });

  it('labels AI organization as metadata-only and never presents a provider abstract', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/literature-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('AI summary · metadata-only draft');
    expect(source).toContain('Likely relevance');
    expect(source).toContain('Study type');
    expect(source).toContain('Metadata limitations');
    expect(source).toContain('Delete paper');
    expect(source).toContain('expectedVersion: record.version');
    expect(source).toContain('requestedModelId,');
    expect(source).toContain('reasoningOptionId,');
    expect(source).toContain('Uses the linked selection');
    expect(source).toContain('record.aiAnnotations === null');
    expect(source).toContain('aiCandidates.map');
    expect(source).not.toContain('record.abstract');
    expect(source).not.toContain('>Abstract<');
  });

  it('projects the latest discovery search identity and rank for query-safe table sorting', () => {
    expect(paper.discoveryRunId).toBe(rawPaper.discovery?.searchRunId);
    expect(paper.discoveryTierRank).toBe(rawPaper.discovery?.tierRank);
    expect(paper.discoveryClassifiedAt).toBe(rawPaper.discovery?.classifiedAt);
  });
});
