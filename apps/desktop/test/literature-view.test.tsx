import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  LiteratureTable,
  LiteratureView,
  literatureViewRecord,
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
  doi: '10.1000/gosu.1',
  workType: 'journal-article',
  citationCount: 42,
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
  it('exposes continual search, dialog-based interchange, and a clearly unavailable AI action', () => {
    const html = renderToStaticMarkup(<LiteratureView project={project} adapter={adapter} />);

    expect(html).toContain('Search and continue this review');
    expect(html).toContain('New results merge');
    expect(html).toContain('Import');
    expect(html).toContain('Export JSON');
    expect(html).toContain('Export CSV');
    expect(html).toContain('Export BibTeX');
    expect(html).toContain('AI drafts complete');
    expect(html).toContain('AI organization is disabled in this build');
    expect(html).not.toContain('type="file"');
  });

  it('renders the required evidence columns, DOI, topics, and bounded pagination', () => {
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
      'Authors',
      'Journal / venue',
      'Year',
      'Topics',
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
    expect(html.match(/>evaluation</gu)).toHaveLength(1);
    expect(html).toContain('page 1 of 1');
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
});
