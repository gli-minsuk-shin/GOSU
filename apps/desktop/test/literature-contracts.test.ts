import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  LiteratureAiAnnotationUpdateSchema,
  LiteratureRecordSchema,
  LiteratureSearchInputSchema,
  LiteratureSearchReceiptSchema,
  OrganizeLiteratureInputSchema,
} from '../src/shared/literature-contracts';
import { unwrapLiteratureIpcResult } from '../src/shared/literature-ipc-result';

function recordFixture() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    projectId: randomUUID(),
    provider: 'crossref',
    providerRecordId: '10.1000/fixture',
    doi: '10.1000/fixture',
    fingerprint: 'a'.repeat(64),
    title: 'A bounded literature record',
    authors: ['Ada Researcher'],
    containerTitle: 'Journal of Fixtures',
    publishedYear: 2026,
    sourceTopics: ['evaluation'],
    workType: 'journal-article',
    citationCount: 3,
    sourceUrl: 'https://doi.org/10.1000/fixture',
    citationKey: 'researcher2026bounded',
    reviewStatus: 'unreviewed',
    manualAnnotations: { topics: [], summary: '', relevance: '' },
    aiAnnotations: null,
    annotationVersion: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe('literature IPC contracts', () => {
  it('accepts normalized metadata but rejects non-HTTPS source links', () => {
    expect(LiteratureRecordSchema.safeParse(recordFixture()).success).toBe(true);
    expect(
      LiteratureRecordSchema.safeParse({
        ...recordFixture(),
        sourceUrl: 'http://example.invalid/paper',
      }).success,
    ).toBe(false);
  });

  it('rejects inverted year ranges and duplicate AI record IDs', () => {
    expect(
      LiteratureSearchInputSchema.safeParse({
        projectId: randomUUID(),
        query: 'evaluation',
        fromYear: 2026,
        toYear: 2020,
      }).success,
    ).toBe(false);

    const recordId = randomUUID();
    expect(
      OrganizeLiteratureInputSchema.safeParse({
        projectId: randomUUID(),
        recordIds: [recordId, recordId],
      }).success,
    ).toBe(false);
  });

  it('requires both source and annotation versions for AI compare-and-swap updates', () => {
    const update = {
      recordId: randomUUID(),
      expectedVersion: 3,
      expectedAnnotationVersion: 2,
      topics: [],
      summary: '',
      relevance: 'uncertain',
      studyType: '',
      limitations: [],
    };
    expect(LiteratureAiAnnotationUpdateSchema.safeParse(update).success).toBe(true);
    expect(
      LiteratureAiAnnotationUpdateSchema.safeParse({ ...update, expectedVersion: undefined })
        .success,
    ).toBe(false);
  });

  it('defaults conflict counts for compatible schema-v1 search receipts', () => {
    const timestamp = new Date().toISOString();
    const legacyReceipt = {
      run: {
        schemaVersion: 1,
        id: randomUUID(),
        projectId: randomUUID(),
        provider: 'crossref',
        query: 'legacy search receipt',
        fromYear: null,
        toYear: null,
        requestedLimit: 25,
        status: 'complete',
        foundCount: 1,
        newCount: 1,
        updatedCount: 0,
        unchangedCount: 0,
        createdAt: timestamp,
        completedAt: timestamp,
      },
      foundCount: 1,
      newCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
    };

    expect(LiteratureSearchReceiptSchema.parse(legacyReceipt)).toMatchObject({
      conflictCount: 0,
      run: { conflictCount: 0, conflicts: [] },
    });
  });

  it('exposes only bounded public error codes across the preload boundary', () => {
    expect(() =>
      unwrapLiteratureIpcResult({
        ok: false,
        error: { code: 'literature_record_conflict', detail: '/private/research/path' },
      }),
    ).toThrow('literature_record_conflict');
    expect(() =>
      unwrapLiteratureIpcResult({
        ok: false,
        error: { code: '/private/research/path' },
      }),
    ).toThrow('literature_unavailable');
  });
});
