import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { CrossrefLiteratureProvider } from '../src/main/literature-crossref';
import type { LiteratureDiscoveryProvider } from '../src/main/literature-discovery';
import {
  LiteratureService,
  type LiteratureServiceError,
  type LiteratureStorage,
} from '../src/main/literature-service';
import { LiteratureStorageError } from '../src/main/literature-storage-error';
import { serializeLiteratureJson } from '../src/main/literature-transfer';
import type { LiteratureTransferPlatform } from '../src/main/literature-transfer-platform';
import type { WorkspaceService } from '../src/main/workspace-service';
import type {
  LiteratureAiAnnotationUpdate,
  LiteratureAiProvenance,
  LiteratureDiscoveryCoverage,
  LiteratureRecord,
  LiteratureSearchRun,
} from '../src/shared/literature-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-04T00:00:00.000Z');

function record(overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    projectId: PROJECT_ID,
    provider: 'crossref',
    providerRecordId: '10.1000/fixture',
    doi: '10.1000/fixture',
    fingerprint: 'a'.repeat(64),
    title: 'A fixture paper',
    authors: ['Ada Researcher'],
    containerTitle: 'Fixture Journal',
    publishedYear: 2026,
    sourceTopics: ['evaluation'],
    workType: 'journal-article',
    citationCount: 3,
    sourceUrl: 'https://doi.org/10.1000/fixture',
    citationKey: 'Researcher2026Fixture',
    reviewStatus: 'unreviewed',
    manualAnnotations: { topics: [], summary: '', relevance: '' },
    aiAnnotations: null,
    annotationVersion: 0,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function provenance(): LiteratureAiProvenance {
  return {
    invocation: {
      schemaVersion: 1,
      invocationId: randomUUID(),
      providerId: 'codex',
      requestedModelId: null,
      resolvedModelId: 'fixture-model',
      catalogVersion: 'fixture-catalog',
      reasoningOptionId: null,
      startedAt: NOW.toISOString(),
    },
    inputSha256: 'f'.repeat(64),
    generatedAt: NOW.toISOString(),
    metadataOnly: true,
  };
}

class MemoryLiteratureStorage implements LiteratureStorage {
  readonly records: LiteratureRecord[] = [];
  readonly runs: LiteratureSearchRun[] = [];
  candidates: unknown[] = [];
  failAiApply = false;

  listLiteratureRecords(projectId: string) {
    return this.records.filter((item) => item.projectId === projectId);
  }

  countLiteratureRecords(projectId: string) {
    return this.listLiteratureRecords(projectId).length;
  }

  getLiteratureRecordsByIds(projectId: string, recordIds: readonly string[]) {
    return recordIds.flatMap((id) => {
      const item = this.records.find(
        (candidate) => candidate.projectId === projectId && candidate.id === id,
      );
      return item ? [item] : [];
    });
  }

  listLiteratureSearchRuns(projectId: string) {
    return this.runs.filter((run) => run.projectId === projectId);
  }

  beginLiteratureSearch(run: LiteratureSearchRun) {
    this.runs.push(run);
    return true;
  }

  completeLiteratureSearch(
    projectId: string,
    runId: string,
    candidates: readonly unknown[],
    completedAt: string,
  ) {
    this.candidates = [...candidates];
    const index = this.runs.findIndex((run) => run.projectId === projectId && run.id === runId);
    const current = this.runs[index]!;
    const run: LiteratureSearchRun = {
      ...current,
      status: 'complete',
      foundCount: candidates.length,
      newCount: candidates.length,
      completedAt,
    };
    this.runs[index] = run;
    return {
      run,
      foundCount: candidates.length,
      newCount: candidates.length,
      updatedCount: 0,
      unchangedCount: 0,
      conflictCount: 0,
    };
  }

  failLiteratureSearch(
    projectId: string,
    runId: string,
    status: 'failed' | 'cancelled',
    completedAt: string,
  ) {
    const index = this.runs.findIndex((run) => run.projectId === projectId && run.id === runId);
    if (index < 0 || this.runs[index]?.status !== 'running') return false;
    this.runs[index] = { ...this.runs[index]!, status, completedAt };
    return true;
  }

  upsertLiteratureCandidates(
    _projectId: string,
    candidates: readonly unknown[],
    _updatedAt: string,
  ) {
    this.candidates = [...candidates];
    return { imported: candidates.length, updated: 0, skipped: 0 };
  }

  updateLiteratureManualAnnotations(input: {
    projectId: string;
    recordId: string;
    expectedVersion: number;
    expectedAnnotationVersion: number;
    manualTopics: readonly string[];
    manualSummary: string;
    manualRelevance: string;
    reviewStatus: LiteratureRecord['reviewStatus'];
    updatedAt: string;
  }) {
    const index = this.records.findIndex(
      (item) =>
        item.projectId === input.projectId &&
        item.id === input.recordId &&
        item.version === input.expectedVersion &&
        item.annotationVersion === input.expectedAnnotationVersion,
    );
    if (index < 0) return null;
    const updated: LiteratureRecord = {
      ...this.records[index]!,
      reviewStatus: input.reviewStatus,
      manualAnnotations: {
        topics: [...input.manualTopics],
        summary: input.manualSummary,
        relevance: input.manualRelevance,
      },
      version: input.expectedVersion + 1,
      annotationVersion: input.expectedAnnotationVersion + 1,
      updatedAt: input.updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }

  applyLiteratureAiAnnotations(
    projectId: string,
    updates: readonly (LiteratureAiAnnotationUpdate & { provenance: LiteratureAiProvenance })[],
    updatedAt: string,
  ) {
    if (this.failAiApply) return null;
    const current = updates.map((update) =>
      this.records.find(
        (item) =>
          item.projectId === projectId &&
          item.id === update.recordId &&
          item.version === update.expectedVersion &&
          item.annotationVersion === update.expectedAnnotationVersion,
      ),
    );
    if (current.some((item) => !item)) return null;
    return updates.map((update, index) => ({
      ...current[index]!,
      aiAnnotations: {
        topics: update.topics,
        summary: update.summary,
        relevance: update.relevance,
        studyType: update.studyType,
        limitations: update.limitations,
        provenance: update.provenance,
      },
      annotationVersion: update.expectedAnnotationVersion + 1,
      version: update.expectedVersion + 1,
      updatedAt,
    }));
  }

  deleteLiteratureRecord(
    projectId: string,
    recordId: string,
    expectedVersion: number,
    _deletedAt: string,
  ) {
    const index = this.records.findIndex(
      (item) =>
        item.projectId === projectId && item.id === recordId && item.version === expectedVersion,
    );
    if (index < 0) return false;
    this.records.splice(index, 1);
    return true;
  }
}

function workspace(status: 'active' | 'archived' | 'trashed' = 'active') {
  return {
    snapshot: vi.fn(async () => ({
      schemaVersion: 1,
      revision: 1,
      projects: [
        {
          id: PROJECT_ID,
          name: 'Fixture',
          slug: 'fixture',
          version: 1,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
          ...(status === 'archived' ? { archivedAt: NOW.toISOString() } : {}),
          ...(status === 'trashed' ? { trashedAt: NOW.toISOString() } : {}),
        },
      ],
      tasks: [],
      objectives: [],
    })),
  } as unknown as WorkspaceService;
}

function transfer(overrides: Partial<LiteratureTransferPlatform> = {}): LiteratureTransferPlatform {
  return {
    chooseImport: vi.fn(async () => ({
      status: 'cancelled' as const,
      format: null,
      fileName: null,
    })),
    saveExport: vi.fn(async () => ({ status: 'cancelled' as const, fileName: null })),
    ...overrides,
  };
}

function provider(items: readonly unknown[] = []) {
  return new CrossrefLiteratureProvider({
    fetch: vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: { items } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  });
}

function service(
  storage: MemoryLiteratureStorage,
  options: {
    workspace?: WorkspaceService;
    provider?: LiteratureDiscoveryProvider;
    transfer?: LiteratureTransferPlatform;
    projection?: Readonly<{
      syncLiterature(projectId: string): Promise<unknown>;
      syncReviewedPaper?(record: LiteratureRecord): Promise<unknown>;
    }>;
  } = {},
) {
  return new LiteratureService({
    storage,
    workspace: options.workspace ?? workspace(),
    provider: options.provider ?? provider(),
    transfer: options.transfer ?? transfer(),
    ...(options.projection ? { projection: options.projection } : {}),
    now: () => NOW,
  });
}

describe('LiteratureService', () => {
  it('isolates projects and gates archived or trashed work through WorkspaceService', async () => {
    const storage = new MemoryLiteratureStorage();
    storage.records.push(record(), record({ id: randomUUID(), projectId: OTHER_PROJECT_ID }));

    await expect(service(storage).list({ projectId: PROJECT_ID })).resolves.toMatchObject({
      projectId: PROJECT_ID,
      total: 1,
      records: [{ projectId: PROJECT_ID }],
    });
    for (const status of ['archived', 'trashed'] as const) {
      await expect(
        service(storage, { workspace: workspace(status) }).list({ projectId: PROJECT_ID }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<LiteratureServiceError>>({
          code: 'literature_project_unavailable',
        }),
      );
    }
  });

  it('runs a bounded Crossref search with year filters and returns versioned counts', async () => {
    const storage = new MemoryLiteratureStorage();
    const result = await service(storage, {
      provider: provider([
        {
          DOI: '10.1000/fixture',
          title: ['Fixture paper'],
          author: [{ given: 'Ada', family: 'Researcher' }],
          issued: { 'date-parts': [[2026]] },
        },
      ]),
    }).search({ projectId: PROJECT_ID, query: 'research fixtures', fromYear: 2020, toYear: 2026 });

    expect(result).toMatchObject({
      foundCount: 1,
      newCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      conflictCount: 0,
    });
    expect(result.run).toMatchObject({
      projectId: PROJECT_ID,
      searchTags: { topics: ['research fixtures'], keywords: [] },
      fromYear: 2020,
      toYear: 2026,
      requestedLimit: 50,
      status: 'complete',
    });
    expect(JSON.stringify(storage.candidates)).not.toContain('abstract');
  });

  it('persists explicit topic and keyword provenance tags on each search run', async () => {
    const storage = new MemoryLiteratureStorage();
    const result = await service(storage, { provider: provider([]) }).search({
      projectId: PROJECT_ID,
      query: 'a long research question remains provider input',
      searchTags: {
        topics: ['#Tabular foundation models', 'tabular foundation models'],
        keywords: ['TabPFN', 'in-context   learning'],
      },
    });

    expect(result.run.searchTags).toEqual({
      topics: ['Tabular foundation models'],
      keywords: ['TabPFN', 'in-context learning'],
    });
    expect(storage.runs[0]?.searchTags).toEqual(result.run.searchTags);
  });

  it('uses subject and keyword tags for discovery and forwards structured author and venue filters', async () => {
    const storage = new MemoryLiteratureStorage();
    const search = vi.fn(async () => []);
    const discoveryProvider: LiteratureDiscoveryProvider = {
      providerId: 'crossref',
      policyId: 'balanced-three-layer',
      policyVersion: 3,
      search,
    };

    await service(storage, { provider: discoveryProvider }).search({
      projectId: PROJECT_ID,
      query: 'causal representation learning',
      searchTags: {
        topics: ['identifiability'],
        keywords: ['nonlinear ICA', 'identifiability'],
      },
      authorQuery: 'Aapo Hyvarinen',
      venueQuery: 'JMLR',
      fromYear: 2018,
      toYear: 2026,
    });

    expect(search).toHaveBeenCalledWith(
      'causal representation learning identifiability nonlinear ICA',
      50,
      expect.objectContaining({
        authorQuery: 'Aapo Hyvarinen',
        venueQuery: 'JMLR',
        fromYear: 2018,
        toYear: 2026,
      }),
    );
    expect(storage.runs[0]).toMatchObject({
      authorQuery: 'Aapo Hyvarinen',
      venueQuery: 'JMLR',
    });
  });

  it('projects saved searches and reviewed records to Research Notes without rolling back Literature', async () => {
    const storage = new MemoryLiteratureStorage();
    const saved = record();
    storage.records.push(saved);
    const syncLiterature = vi
      .fn<(projectId: string) => Promise<unknown>>()
      .mockRejectedValue(new Error('Obsidian offline'));
    const syncReviewedPaper = vi
      .fn<(record: LiteratureRecord) => Promise<unknown>>()
      .mockRejectedValue(new Error('Obsidian offline'));
    const literature = service(storage, {
      provider: provider([]),
      projection: { syncLiterature, syncReviewedPaper },
    });

    await expect(
      literature.search({ projectId: PROJECT_ID, query: 'projected evidence' }),
    ).resolves.toMatchObject({ foundCount: 0 });
    const updated = await literature.updateAnnotations({
      projectId: PROJECT_ID,
      recordId: saved.id,
      expectedVersion: saved.version,
      expectedAnnotationVersion: saved.annotationVersion,
      reviewStatus: 'included',
      manualTopics: ['projected'],
      manualSummary: 'Keep this evidence.',
      manualRelevance: 'Directly relevant.',
    });

    expect(updated.reviewStatus).toBe('included');
    expect(syncLiterature).toHaveBeenCalledTimes(2);
    expect(syncLiterature).toHaveBeenNthCalledWith(1, PROJECT_ID);
    expect(syncLiterature).toHaveBeenNthCalledWith(2, PROJECT_ID);
    expect(syncReviewedPaper).toHaveBeenCalledExactlyOnceWith(updated);
  });

  it('persists and returns the discovery signal coverage used by Project Chat receipts', async () => {
    const storage = new MemoryLiteratureStorage();
    const complete = vi.spyOn(storage, 'completeLiteratureSearch');
    const coverage: LiteratureDiscoveryCoverage = {
      source: 'semantic-scholar',
      availableSignals: ['relevance', 'citation-authority'],
      degradationReasons: ['recent-lane-unavailable', 'author-metrics-unavailable'],
    };
    const discoveryProvider: LiteratureDiscoveryProvider = {
      providerId: 'balanced',
      policyId: 'balanced-three-layer',
      policyVersion: 1,
      search: vi.fn(async () => ({
        candidates: [
          {
            provider: 'semantic-scholar' as const,
            providerId: 'coverage-fixture',
            fingerprint: 'b'.repeat(64),
            title: 'Coverage fixture',
            authors: ['Ada Researcher'],
            topics: [],
          },
        ],
        retrievedCount: 4,
        selectedCount: 1,
        tierCounts: { core: 0, rising: 0, broad: 1 },
        coverage,
      })),
    };

    const result = await service(storage, { provider: discoveryProvider }).search({
      projectId: PROJECT_ID,
      query: 'discovery coverage',
    });

    expect(result.coverage).toEqual(coverage);
    expect(result.run.coverage).toEqual(coverage);
    expect(complete).toHaveBeenCalledWith(
      PROJECT_ID,
      result.run.id,
      expect.any(Array),
      NOW.toISOString(),
      expect.objectContaining({ coverage }),
    );
  });

  it('cancels an externally aborted search without committing candidates', async () => {
    const storage = new MemoryLiteratureStorage();
    const complete = vi.spyOn(storage, 'completeLiteratureSearch');
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const cancellableProvider = new CrossrefLiteratureProvider({
      fetch: vi.fn(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            requestStarted();
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    });
    const controller = new AbortController();
    const pending = service(storage, { provider: cancellableProvider }).search(
      { projectId: PROJECT_ID, query: 'cancelled literature search' },
      controller.signal,
    );

    await started;
    controller.abort('turn_cancelled');

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureServiceError>>({
        code: 'literature_provider_unavailable',
      }),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(storage.runs).toHaveLength(1);
    expect(storage.runs[0]?.status).toBe('cancelled');
  });

  it('rechecks external cancellation after provider return and before the atomic merge', async () => {
    const storage = new MemoryLiteratureStorage();
    const complete = vi.spyOn(storage, 'completeLiteratureSearch');
    const initialSnapshot = await workspace().snapshot();
    let releaseRevalidation!: () => void;
    const revalidationStarted = new Promise<void>((resolve) => {
      releaseRevalidation = resolve;
    });
    let snapshotCalls = 0;
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const delayedWorkspace = {
      snapshot: vi.fn(async () => {
        snapshotCalls += 1;
        if (snapshotCalls === 2) {
          releaseRevalidation();
          await blocked;
        }
        return initialSnapshot;
      }),
    } as unknown as WorkspaceService;
    const controller = new AbortController();
    const pending = service(storage, {
      workspace: delayedWorkspace,
      provider: provider([{ DOI: '10.1000/cancel-race', title: ['Cancel race'] }]),
    }).search({ projectId: PROJECT_ID, query: 'cancel before merge' }, controller.signal);

    await revalidationStarted;
    controller.abort('turn_cancelled');
    unblock();

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureServiceError>>({
        code: 'literature_provider_unavailable',
      }),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(storage.runs[0]?.status).toBe('cancelled');
  });

  it('maps Crossref throttling to the bounded rate-limit error and closes the durable run', async () => {
    const storage = new MemoryLiteratureStorage();
    const rateLimited = new CrossrefLiteratureProvider({
      fetch: vi.fn(async () => Promise.resolve(new Response('private body', { status: 429 }))),
    });

    await expect(
      service(storage, { provider: rateLimited }).search({
        projectId: PROJECT_ID,
        query: 'rate limited fixture',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureServiceError>>({
        code: 'literature_rate_limited',
      }),
    );
    expect(storage.runs).toHaveLength(1);
    expect(storage.runs[0]?.status).toBe('failed');
  });

  it('maps a storage capacity failure to a bounded error and closes the durable search run', async () => {
    const storage = new MemoryLiteratureStorage();
    vi.spyOn(storage, 'completeLiteratureSearch').mockImplementation(() => {
      throw new LiteratureStorageError('record_limit_reached');
    });

    await expect(
      service(storage, {
        provider: provider([
          {
            DOI: '10.1000/capacity',
            title: ['Capacity boundary'],
            author: [{ family: 'Researcher' }],
            issued: { 'date-parts': [[2026]] },
          },
        ]),
      }).search({ projectId: PROJECT_ID, query: 'capacity boundary' }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureServiceError>>({
        code: 'literature_record_limit_reached',
      }),
    );
    expect(storage.runs[0]?.status).toBe('failed');
  });

  it('maps an import identity collision without leaking database details', async () => {
    const storage = new MemoryLiteratureStorage();
    vi.spyOn(storage, 'upsertLiteratureCandidates').mockImplementation(() => {
      throw new LiteratureStorageError('identity_conflict');
    });
    const content = serializeLiteratureJson([record()]);

    await expect(
      service(storage, {
        transfer: transfer({
          chooseImport: vi.fn(async () => ({
            status: 'selected' as const,
            format: 'json' as const,
            fileName: 'collision.json',
            content,
          })),
        }),
      }).importRecords({ projectId: PROJECT_ID }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureServiceError>>({
        code: 'literature_identity_conflict',
      }),
    );
  });

  it('uses Main-owned transfer data and imports metadata/manual review without AI annotations', async () => {
    const storage = new MemoryLiteratureStorage();
    const exported = serializeLiteratureJson([
      record({
        reviewStatus: 'included',
        manualAnnotations: { topics: ['manual'], summary: 'Human note', relevance: 'Direct' },
        aiAnnotations: {
          topics: ['private-ai'],
          summary: 'private-ai',
          relevance: 'high',
          studyType: 'private-ai',
          limitations: ['private-ai'],
          provenance: {
            invocation: {
              schemaVersion: 1,
              invocationId: randomUUID(),
              providerId: 'codex',
              requestedModelId: null,
              resolvedModelId: 'private-model',
              catalogVersion: 'private-catalog',
              reasoningOptionId: null,
              startedAt: NOW.toISOString(),
            },
            inputSha256: 'b'.repeat(64),
            generatedAt: NOW.toISOString(),
            metadataOnly: true,
          },
        },
      }),
    ]);
    expect(exported).not.toContain('private-ai');
    const result = await service(storage, {
      transfer: transfer({
        chooseImport: vi.fn(async () => ({
          status: 'selected' as const,
          format: 'json' as const,
          fileName: 'review.json',
          content: exported,
        })),
      }),
    }).importRecords({ projectId: PROJECT_ID });

    expect(result).toMatchObject({
      status: 'imported',
      fileName: 'review.json',
      importedCount: 1,
    });
    expect(storage.candidates[0]).toMatchObject({
      provider: 'import',
      reviewStatus: 'included',
      manualAnnotations: { summary: 'Human note' },
    });
    expect(JSON.stringify(storage.candidates[0])).not.toContain('private-ai');
  });

  it('rejects missing, foreign, and stale annotation targets without cross-project writes', async () => {
    const storage = new MemoryLiteratureStorage();
    const item = record({ annotationVersion: 2, version: 3 });
    storage.records.push(item, record({ id: randomUUID(), projectId: OTHER_PROJECT_ID }));
    const literature = service(storage);

    await expect(
      literature.updateAnnotations({
        projectId: PROJECT_ID,
        recordId: item.id,
        expectedVersion: 2,
        expectedAnnotationVersion: 2,
        reviewStatus: 'included',
        manualTopics: [],
        manualSummary: '',
        manualRelevance: '',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureServiceError>>({
        code: 'literature_record_conflict',
      }),
    );
    await expect(literature.getRecordsForAi(PROJECT_ID, [randomUUID()])).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureServiceError>>({ code: 'literature_ai_conflict' }),
    );

    const apply = vi.spyOn(storage, 'applyLiteratureAiAnnotations');
    await expect(
      literature.applyAiAnnotations(
        PROJECT_ID,
        [
          {
            recordId: item.id,
            expectedVersion: item.version - 1,
            expectedAnnotationVersion: item.annotationVersion,
            topics: [],
            summary: '',
            relevance: 'uncertain',
            studyType: '',
            limitations: [],
          },
        ],
        provenance(),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureServiceError>>({ code: 'literature_ai_conflict' }),
    );
    expect(apply).not.toHaveBeenCalled();
    await expect(
      literature.applyAiAnnotations(
        PROJECT_ID,
        [
          {
            recordId: item.id,
            expectedVersion: item.version,
            expectedAnnotationVersion: item.annotationVersion,
            topics: ['fresh metadata'],
            summary: 'Fresh metadata-only organization',
            relevance: 'high',
            studyType: '',
            limitations: [],
          },
        ],
        provenance(),
      ),
    ).resolves.toEqual({ updatedCount: 1, skippedCount: 0 });
    expect(apply).toHaveBeenCalledOnce();
  });

  it('creates one-time Research Notes paper projections after metadata-only AI organization', async () => {
    const storage = new MemoryLiteratureStorage();
    const item = record();
    storage.records.push(item);
    const syncLiterature = vi.fn(async () => undefined);
    const syncReviewedPaper = vi.fn(async () => undefined);
    const literature = service(storage, {
      projection: { syncLiterature, syncReviewedPaper },
    });

    await literature.applyAiAnnotations(
      PROJECT_ID,
      [
        {
          recordId: item.id,
          expectedVersion: item.version,
          expectedAnnotationVersion: item.annotationVersion,
          topics: ['organized'],
          summary: 'Metadata-only summary',
          relevance: 'high',
          studyType: 'benchmark',
          limitations: ['Full text not reviewed'],
        },
      ],
      provenance(),
    );

    expect(syncLiterature).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(syncReviewedPaper).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: item.id, projectId: PROJECT_ID }),
    );
  });

  it('does not silently truncate a legacy library above the active-record bound', async () => {
    const storage = new MemoryLiteratureStorage();
    storage.records.push(
      ...Array.from({ length: 501 }, () =>
        record({ id: randomUUID(), fingerprint: randomUUID().replaceAll('-', '').repeat(2) }),
      ),
    );

    await expect(service(storage).list({ projectId: PROJECT_ID })).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureServiceError>>({
        code: 'literature_record_limit_reached',
      }),
    );
  });

  it('exports through the Main-owned save surface and returns only a bounded receipt', async () => {
    const storage = new MemoryLiteratureStorage();
    storage.records.push(
      record({
        providerRecordId: 'private-provider-id',
        aiAnnotations: {
          topics: ['private-ai'],
          summary: 'private-ai',
          relevance: 'high',
          studyType: 'private-ai',
          limitations: ['private-ai'],
          provenance: {
            invocation: {
              schemaVersion: 1,
              invocationId: randomUUID(),
              providerId: 'codex',
              requestedModelId: null,
              resolvedModelId: 'private-model',
              catalogVersion: 'private-catalog',
              reasoningOptionId: null,
              startedAt: NOW.toISOString(),
            },
            inputSha256: 'c'.repeat(64),
            generatedAt: NOW.toISOString(),
            metadataOnly: true,
          },
        },
      }),
    );
    let exportedContent = '';
    const receipt = await service(storage, {
      transfer: transfer({
        saveExport: vi.fn(async (_format, content) => {
          exportedContent = content;
          return { status: 'exported' as const, fileName: 'review.json' };
        }),
      }),
    }).exportRecords({ projectId: PROJECT_ID, format: 'json' });

    expect(receipt).toMatchObject({
      status: 'exported',
      format: 'json',
      fileName: 'review.json',
      recordCount: 1,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(JSON.stringify(receipt)).not.toContain(exportedContent);
    expect(exportedContent).not.toContain('private-provider-id');
    expect(exportedContent).not.toContain('private-ai');
  });
});
