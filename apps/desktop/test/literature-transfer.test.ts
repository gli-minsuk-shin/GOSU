import { describe, expect, it } from 'vitest';

import { normalizeCrossrefWork } from '../src/main/literature-crossref';
import {
  LITERATURE_TRANSFER_MAX_INPUT_BYTES,
  LITERATURE_TRANSFER_MAX_RECORDS,
  LiteratureTransferError,
  literatureFingerprint,
  normalizeDoi,
  parseLiteratureCsv,
  parseLiteratureJson,
  protectCsvCell,
  serializeLiteratureCsv,
  serializeLiteratureJson,
  unprotectCsvCell,
} from '../src/main/literature-transfer';
import type { LiteratureRecord } from '../src/shared/literature-contracts';

function record(title: string, overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    provider: 'crossref',
    providerRecordId: 'provider-secret-1',
    doi: '10.1000/EXAMPLE',
    fingerprint: 'f'.repeat(64),
    title,
    authors: ['Ada Lovelace', 'Grace Hopper'],
    containerTitle: 'Journal of Reproducible Systems',
    publishedYear: 2026,
    sourceTopics: ['Research systems'],
    searchTags: {
      topics: ['Tabular foundation models', 'Scientific machine learning'],
      keywords: ['tabpfn', 'in-context learning'],
    },
    workType: 'journal-article',
    citationCount: 12,
    sourceUrl: 'https://doi.org/10.1000/example',
    citationKey: 'Lovelace2026Research',
    reviewStatus: 'included',
    manualAnnotations: {
      topics: ['Agentic research'],
      summary: 'Reviewed by a human.',
      relevance: 'Directly relevant.',
    },
    aiAnnotations: {
      topics: ['private-ai-topic'],
      summary: 'private-ai-summary',
      relevance: 'high',
      studyType: 'private-ai-study-type',
      limitations: ['private-ai-limitation'],
      provenance: {
        invocation: {
          schemaVersion: 1,
          invocationId: '33333333-3333-4333-8333-333333333333',
          providerId: 'codex',
          requestedModelId: null,
          resolvedModelId: 'private-model-id',
          catalogVersion: 'private-catalog',
          reasoningOptionId: null,
          startedAt: '2026-08-04T00:00:00.000Z',
        },
        inputSha256: 'a'.repeat(64),
        generatedAt: '2026-08-04T00:00:01.000Z',
        metadataOnly: true,
      },
    },
    annotationVersion: 2,
    version: 3,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:01.000Z',
    ...overrides,
  };
}

describe('literature transfer identity and DOI normalization', () => {
  it('normalizes safe DOI forms and rejects malformed values', () => {
    expect(normalizeDoi(' DOI: 10.1000/ABC.Def ')).toBe('10.1000/abc.def');
    expect(normalizeDoi('https://doi.org/10.1000%2FABC')).toBe('10.1000/abc');
    expect(normalizeDoi('not-a-doi')).toBeNull();
    expect(normalizeDoi('10.1000/bad\nvalue')).toBeNull();
  });

  it('matches provider fallback identity and treats DOI and later authors separately', () => {
    const input = {
      title: 'Étude: Agentic  Research!',
      authors: ['Ada Lovelace', 'Grace Hopper'],
      publishedYear: 2026,
      doi: '10.1000/one',
    };
    expect(literatureFingerprint(input)).toBe(
      normalizeCrossrefWork({
        title: [input.title],
        author: [
          { given: 'Ada', family: 'Lovelace' },
          { given: 'Grace', family: 'Hopper' },
        ],
        published: { 'date-parts': [[input.publishedYear]] },
        DOI: input.doi,
      })?.fingerprint,
    );
    expect(literatureFingerprint({ ...input, authors: ['Ada Lovelace', 'Different Author'] })).toBe(
      literatureFingerprint(input),
    );
    expect(literatureFingerprint({ ...input, doi: '10.1000/two' })).toBe(
      literatureFingerprint(input),
    );
  });
});

describe('literature JSON exchange', () => {
  it('is versioned, deterministic, metadata-only, and omits local/provider/AI state', () => {
    const first = record('Alpha paper');
    const second = record('Beta paper', {
      id: '44444444-4444-4444-8444-444444444444',
      providerRecordId: 'provider-secret-2',
      doi: null,
      citationKey: 'Hopper2025Beta',
      publishedYear: 2025,
    });
    const forward = serializeLiteratureJson([first, second]);
    const reverse = serializeLiteratureJson([second, first]);

    expect(forward).toBe(reverse);
    expect(JSON.parse(forward)).toMatchObject({ schemaVersion: 2, kind: 'gosu.literature' });
    expect(forward).not.toContain('provider-secret');
    expect(forward).not.toContain('private-ai');
    expect(forward).not.toContain('projectId');
    expect(forward).not.toContain('aiAnnotations');
    const restored = parseLiteratureJson(forward);
    expect(restored).toHaveLength(2);
    expect(restored[0]?.searchTags).toEqual(first.searchTags);
    expect(serializeLiteratureJson(restored)).toBe(forward);
  });

  it('accepts legacy v1 JSON records and defaults their search tags to empty', () => {
    const legacy = JSON.parse(serializeLiteratureJson([record('Legacy JSON paper')])) as {
      schemaVersion: number;
      records: Array<Record<string, unknown>>;
    };
    legacy.schemaVersion = 1;
    delete legacy.records[0]?.searchTags;

    expect(parseLiteratureJson(JSON.stringify(legacy))[0]?.searchTags).toEqual({
      topics: [],
      keywords: [],
    });
  });

  it('rejects insecure URLs and reports record-count overflow as import overflow', () => {
    const envelope = JSON.parse(serializeLiteratureJson([record('Safe')])) as {
      records: Array<Record<string, unknown>>;
    };
    envelope.records[0]!.sourceUrl = 'http://example.test/paper';
    expect(() => parseLiteratureJson(JSON.stringify(envelope))).toThrowError(
      expect.objectContaining({ code: 'literature_import_invalid' }),
    );

    expect(() =>
      parseLiteratureJson(
        JSON.stringify({
          schemaVersion: 1,
          kind: 'gosu.literature',
          records: Array.from({ length: LITERATURE_TRANSFER_MAX_RECORDS + 1 }, () => ({})),
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'literature_import_too_large' }));
  });

  it('bounds input bytes before parsing', () => {
    expect(() =>
      parseLiteratureJson('x'.repeat(LITERATURE_TRANSFER_MAX_INPUT_BYTES + 1)),
    ).toThrowError(expect.objectContaining({ code: 'literature_import_too_large' }));
  });
});

describe('literature CSV exchange', () => {
  it.each(['=SUM(1,1)', ' +cmd', '-2+3', '@evil', "'=literal"])(
    'protects and exactly restores spreadsheet-sensitive value %s',
    (value) => {
      const protectedValue = protectCsvCell(value);
      expect(protectedValue.startsWith("'")).toBe(true);
      expect(unprotectCsvCell(protectedValue)).toBe(value);
    },
  );

  it('round-trips formula-like titles, commas, quotes, and multiline text safely', () => {
    const records = ['=SUM(1,1)', '+cmd', '-2+3', '@evil', "'=literal"].map((title, index) =>
      record(title, {
        id: `00000000-0000-4000-8000-00000000000${index}`,
        doi: null,
        citationKey: `Key${index}`,
        manualAnnotations: {
          topics: ['quoted, topic'],
          summary: 'A "quoted", multiline\nsummary.',
          relevance: '+important',
        },
      }),
    );
    const csv = serializeLiteratureCsv(records);
    const restored = parseLiteratureCsv(csv);

    expect(csv.split('\n')[0]).toContain('search_topics,search_keywords');
    expect(csv).toContain("'=SUM(1,1)");
    expect(csv).toContain("''=literal");
    expect(restored.map((item) => item.title).sort()).toEqual(
      records.map((item) => item.title).sort(),
    );
    expect(
      restored.every(
        (item) => item.manualAnnotations.summary === 'A "quoted", multiline\nsummary.',
      ),
    ).toBe(true);
    expect(csv).not.toContain('private-ai');
    expect(csv).not.toContain('provider-secret');
    expect(restored[0]?.searchTags).toEqual(records[0]?.searchTags);
    expect(serializeLiteratureCsv(restored)).toBe(csv);
  });

  it('accepts the exact legacy CSV header and defaults search tags to empty', () => {
    const legacyHeader =
      'title,authors,container_title,published_year,work_type,doi,source_url,source_topics,citation_count,citation_key,review_status,manual_topics,manual_summary,manual_relevance,fingerprint,metadata_only';
    const legacyRow = '"Legacy CSV paper","[]","","","","","","[]","","","","[]","","","","true"';

    expect(parseLiteratureCsv(`${legacyHeader}\n${legacyRow}\n`)[0]).toMatchObject({
      title: 'Legacy CSV paper',
      searchTags: { topics: [], keywords: [] },
    });
  });

  it('uses bounded error types', () => {
    try {
      parseLiteratureCsv('bad,header\n');
      throw new Error('expected parse failure');
    } catch (error) {
      expect(error).toBeInstanceOf(LiteratureTransferError);
      expect((error as LiteratureTransferError).code).toBe('literature_import_invalid');
    }
  });
});
