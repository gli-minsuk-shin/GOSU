import { describe, expect, it } from 'vitest';

import {
  researchPaperNoteFileName,
  serializeLiteratureReviewMarkdown,
  serializePaperNoteMarkdown,
} from '../src/main/research-notes-markdown';
import type { LiteratureRecord } from '../src/shared/literature-contracts';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const PROJECT: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'FM | LM',
  slug: 'fm-lm',
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

function record(id: string, overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    schemaVersion: 1,
    id,
    projectId: PROJECT.id,
    provider: 'semantic-scholar',
    providerRecordId: `provider-${id}`,
    doi: `10.1000/${id}`,
    fingerprint: id.replaceAll('-', '').slice(0, 1).repeat(64),
    title: `Paper ${id.slice(0, 4)}`,
    authors: ['Ada Researcher'],
    containerTitle: 'Journal of Fixtures',
    publishedYear: 2025,
    sourceTopics: ['foundation models'],
    searchTags: {
      topics: ['tabular learning'],
      keywords: ['foundation model'],
    },
    workType: 'journal-article',
    citationCount: 42,
    sourceUrl: `https://doi.org/10.1000/${id}`,
    citationKey: `Researcher2025${id.slice(0, 4)}`,
    reviewStatus: 'included',
    manualAnnotations: {
      topics: ['benchmarking'],
      summary: 'Human summary',
      relevance: 'Useful baseline',
    },
    aiAnnotations: null,
    discovery: {
      searchRunId: '99999999-9999-4999-8999-999999999999',
      query: 'tabular foundation model',
      policyId: 'balanced-three-layer',
      policyVersion: 1,
      classifiedAt: '2026-08-03T00:00:00.000Z',
      tier: 'core',
      matchedLayers: ['core'],
      tierRank: 1,
      overallScore: 0.9,
      relevanceScore: 0.9,
      authorityScore: 0.8,
      momentumScore: 0.5,
      citationVelocityProxy: 3,
      influentialCitationCount: 5,
      maxAuthorHIndex: 80,
      reasons: ['high-query-relevance', 'high-citation-impact'],
      signalSources: ['semantic-scholar'],
    },
    annotationVersion: 1,
    version: 2,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('Research Notes Markdown projections', () => {
  it('serializes the Literature table deterministically independent of input order', () => {
    const core = record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      title: 'Core | canonical',
      publishedYear: 2018,
    });
    const rising = record('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      title: 'Rising paper',
      publishedYear: 2026,
      citationCount: 7,
      discovery: {
        ...record('cccccccc-cccc-4ccc-8ccc-cccccccccccc').discovery!,
        tier: 'rising',
        matchedLayers: ['rising'],
        tierRank: 1,
      },
    });
    const unclassified = record('dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      title: 'Imported paper',
      discovery: null,
      citationCount: null,
      doi: null,
    });

    const first = serializeLiteratureReviewMarkdown(PROJECT, [unclassified, rising, core]);
    const second = serializeLiteratureReviewMarkdown(PROJECT, [core, unclassified, rising]);

    expect(first).toBe(second);
    expect(first).toContain('gosu_schema_version: 2');
    expect(first).toContain('gosu_document_kind: "literature-review"');
    expect(first).toContain('gosu_managed: true');
    expect(first).toContain(`created_at: ${JSON.stringify(PROJECT.createdAt)}`);
    expect(first).toContain('modified_at: "2026-08-04T00:00:00.000Z"');
    expect(first).toContain(`gosu_project_name: ${JSON.stringify(PROJECT.name)}`);
    expect(first).toContain('gosu_origin_session_id: null');
    expect(first).toContain('gosu_creator_id: "gosu-system"');
    expect(first).toContain('related_papers: ["https://doi.org/10.1000/');
    expect(first).toContain('gosu_provenance: {');
    expect(first).toContain('record_count: 3');
    expect(first).toContain('metadata_only: true');
    expect(first).toContain('<!-- GOSU-MANAGED-FILE v1:');
    expect(first).toContain('| Core & canonical | 1 |');
    expect(first).toContain('| Rising & recent | 1 |');
    expect(first).toContain('| Imported / unclassified | 1 |');
    expect(first).toContain('Core \\| canonical');
    expect(first).toContain('topic:tabular learning, keyword:foundation model');
    expect(first.indexOf('Core \\| canonical')).toBeLessThan(first.indexOf('Rising paper'));
    expect(first.indexOf('Rising paper')).toBeLessThan(first.indexOf('Imported paper'));
  });

  it('changes its source digest when a saved Literature record version changes', () => {
    const saved = record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const original = serializeLiteratureReviewMarkdown(PROJECT, [saved]);
    const updated = serializeLiteratureReviewMarkdown(PROJECT, [
      { ...saved, version: saved.version + 1 },
    ]);
    const digest = (value: string) => value.match(/gosu_source_sha256: "([0-9a-f]{64})"/u)?.[1];

    expect(digest(original)).toMatch(/^[0-9a-f]{64}$/u);
    expect(digest(updated)).not.toBe(digest(original));
  });

  it('creates a metadata-only, user-owned paper note with provenance and editable sections', () => {
    const saved = record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      title: '# A paper\nwith a second line',
      manualAnnotations: {
        topics: [],
        summary: 'Verified by the researcher',
        relevance: 'Directly supports the metric choice',
      },
    });

    const note = serializePaperNoteMarkdown(PROJECT, saved);

    expect(note).toContain('gosu_document_kind: "literature-paper-note"');
    expect(note).toContain('gosu_schema_version: 2');
    expect(note).toContain(`gosu_record_id: "${saved.id}"`);
    expect(note).toContain(`created_at: ${JSON.stringify(saved.createdAt)}`);
    expect(note).toContain(`gosu_project_name: ${JSON.stringify(PROJECT.name)}`);
    expect(note).toContain('gosu_origin_session_name: null');
    expect(note).toContain('gosu_creator_name: "GOSU"');
    expect(note).toContain('related_documents: ["Literature/Literature Review.md"]');
    expect(note).toContain(
      `authors: ${JSON.stringify(saved.authors.map((author) => author.trim()))}`,
    );
    expect(note).toContain('metadata_only: true');
    expect(note).toContain('full_text_reviewed: false');
    expect(note).toContain('<!-- GOSU-CREATED-PAPER-NOTE v1: user-owned after creation;');
    expect(note).toContain('The paper full text was not read or verified.');
    expect(note).toContain('## Claims to verify');
    expect(note).toContain('## Methods');
    expect(note).toContain('Verified by the researcher');
    expect(note).not.toContain('\nwith a second line\nwith a second line');
  });

  it('builds bounded, filesystem-safe, record-unique paper note names', () => {
    const first = record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      citationKey: '',
      title: '../A paper: with / unsafe * punctuation '.repeat(20),
    });
    const second = { ...first, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    const firstName = researchPaperNoteFileName(first);
    const secondName = researchPaperNoteFileName(second);

    expect(firstName).toMatch(/^[^/\\:]+--aaaaaaaa-aaa\.md$/u);
    expect(Buffer.byteLength(firstName, 'utf8')).toBeLessThan(120);
    expect(secondName).not.toBe(firstName);
  });
});
