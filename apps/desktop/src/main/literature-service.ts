import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  DeleteLiteratureRecordInputSchema,
  DeleteLiteratureRecordReceiptSchema,
  LITERATURE_MAX_ABSTRACT_LENGTH,
  LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT,
  LITERATURE_MAX_AI_RECORDS,
  ListLiteratureInputSchema,
  LiteratureAiAnnotationUpdateSchema,
  LiteratureAiProvenanceSchema,
  LiteratureExportReceiptSchema,
  LiteratureExportRequestSchema,
  LiteratureImportReceiptSchema,
  LiteratureImportRequestSchema,
  LiteratureLibrarySchema,
  LiteratureRecordSchema,
  LiteratureSearchInputSchema,
  LiteratureSearchReceiptSchema,
  LiteratureSearchRunSchema,
  UndoLiteratureSearchInputSchema,
  UndoLiteratureSearchReceiptSchema,
  UpdateLiteratureAnnotationsInputSchema,
  type DeleteLiteratureRecordInput,
  type DeleteLiteratureRecordReceipt,
  type LiteratureAiAnnotationUpdate,
  type LiteratureAiProvenance,
  type LiteratureDiscoveryCoverage,
  type LiteratureExportReceipt,
  type LiteratureExportRequest,
  type LiteratureImportReceipt,
  type LiteratureImportRequest,
  type LiteratureIpcErrorCode,
  type LiteratureLibrary,
  type LiteratureRecord,
  type LiteratureSearchInput,
  type LiteratureSearchReceipt,
  type LiteratureSearchRun,
  type UndoLiteratureSearchInput,
  type UndoLiteratureSearchReceipt,
  type UpdateLiteratureAnnotationsInput,
} from '../shared/literature-contracts';
import { canonicalLiteratureUrl } from '../shared/literature-canonical-url';
import {
  PAPER_LIBRARY_MAX_IMPORT,
  PaperLibraryEntrySchema,
  type PaperLibraryEntry,
} from '../shared/paper-library-contracts';
import { literatureQueryTerms } from '../shared/literature-query';
import { resolveLiteratureSearchTags } from '../shared/literature-search-tags';
import type { WorkspaceService } from './workspace-service';
import { parseLiteratureBibtex, serializeLiteratureBibtex } from './literature-bibtex';
import {
  literatureFingerprint,
  LiteratureProviderError,
  normalizeArxivCanonicalId,
  type LiteratureProviderCandidate,
} from './literature-crossref';
import {
  BalancedLiteratureProvider,
  type LiteratureDiscoveryProvider,
  type LiteratureProviderSearchResult,
} from './literature-discovery';
import { LiteratureStorageError } from './literature-storage-error';
import {
  LiteratureTransferError,
  normalizeDoi,
  parseLiteratureCsv,
  parseLiteratureJson,
  serializeLiteratureCsv,
  serializeLiteratureJson,
  type LiteratureTransferRecord,
} from './literature-transfer';
import type { LiteratureTransferPlatform } from './literature-transfer-platform';

type MaybePromise<T> = T | Promise<T>;

type LiteratureDiscoveryPersistence = Omit<
  LiteratureProviderSearchResult,
  'candidates' | 'coverage'
> &
  Readonly<{ coverage?: LiteratureDiscoveryCoverage }>;

type StoredAiUpdate = LiteratureAiAnnotationUpdate &
  Readonly<{ provenance: LiteratureAiProvenance }>;

function transferCandidate(record: LiteratureTransferRecord): LiteratureProviderCandidate {
  return {
    provider: 'import',
    ...(record.doi ? { doi: record.doi } : {}),
    fingerprint: record.fingerprint,
    title: record.title,
    authors: record.authors,
    ...(record.containerTitle ? { containerTitle: record.containerTitle } : {}),
    ...(record.publishedYear ? { publishedYear: record.publishedYear } : {}),
    topics: record.sourceTopics,
    ...(record.workType ? { workType: record.workType } : {}),
    ...(record.citationCount === null ? {} : { citationCount: record.citationCount }),
    ...(record.sourceUrl ? { sourceUrl: record.sourceUrl } : {}),
    citationKey: record.citationKey,
    reviewStatus: record.reviewStatus,
    manualAnnotations: record.manualAnnotations,
    ...(record.searchTags ? { searchTags: record.searchTags } : {}),
  };
}

function parseTransfer(format: LiteratureImportRequest['format'], content: string) {
  if (format === 'json') return parseLiteratureJson(content);
  if (format === 'csv') return parseLiteratureCsv(content);
  if (format === 'bibtex') return parseLiteratureBibtex(content);
  throw new LiteratureTransferError('literature_import_invalid');
}

function serializeTransfer(
  format: LiteratureExportRequest['format'],
  records: readonly LiteratureRecord[],
) {
  if (format === 'json') return serializeLiteratureJson(records);
  if (format === 'csv') return serializeLiteratureCsv(records);
  return serializeLiteratureBibtex(records);
}

function transferPlatformFailure(error: unknown, operation: 'import' | 'export') {
  const code = error instanceof Error ? error.message : '';
  if (operation === 'import' && code === 'literature_import_too_large') {
    return new LiteratureServiceError('literature_import_too_large');
  }
  if (operation === 'import' && code === 'literature_import_invalid') {
    return new LiteratureServiceError('literature_import_invalid');
  }
  if (operation === 'export' && code === 'literature_export_too_large') {
    return new LiteratureServiceError('literature_export_too_large');
  }
  return new LiteratureServiceError('literature_unavailable');
}

function storageFailure(error: unknown): LiteratureServiceError | null {
  if (!(error instanceof LiteratureStorageError)) return null;
  return new LiteratureServiceError(
    error.code === 'record_limit_reached'
      ? 'literature_record_limit_reached'
      : 'literature_identity_conflict',
  );
}

export function literatureProviderQuery(
  query: string,
  searchTags: Readonly<{ topics: readonly string[]; keywords: readonly string[] }>,
) {
  const terms = [query, ...searchTags.topics, ...searchTags.keywords]
    .map((value) => value.replace(/\s+/gu, ' ').trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
  return terms.join(' ').slice(0, 1_000).trim();
}

export interface LiteratureStorage {
  listLiteratureRecords(projectId: string): MaybePromise<readonly LiteratureRecord[]>;
  countLiteratureRecords(projectId: string): MaybePromise<number>;
  getLiteratureRecordsByIds(
    projectId: string,
    recordIds: readonly string[],
  ): MaybePromise<readonly LiteratureRecord[]>;
  listLiteratureSearchRuns(projectId: string): MaybePromise<readonly LiteratureSearchRun[]>;
  beginLiteratureSearch(run: LiteratureSearchRun): MaybePromise<boolean>;
  completeLiteratureSearch(
    projectId: string,
    runId: string,
    candidates: readonly LiteratureProviderCandidate[],
    completedAt: string,
    discovery?: LiteratureDiscoveryPersistence,
  ): MaybePromise<{
    foundCount: number;
    newCount: number;
    updatedCount: number;
    unchangedCount: number;
    conflictCount: number;
    run: LiteratureSearchRun;
  }>;
  failLiteratureSearch(
    projectId: string,
    runId: string,
    status: 'failed' | 'cancelled',
    completedAt: string,
  ): MaybePromise<boolean>;
  upsertLiteratureCandidates(
    projectId: string,
    candidates: readonly LiteratureProviderCandidate[],
    updatedAt: string,
  ): MaybePromise<{ imported: number; updated: number; skipped: number }>;
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
  }): MaybePromise<LiteratureRecord | null>;
  applyLiteratureAiAnnotations(
    projectId: string,
    updates: readonly StoredAiUpdate[],
    updatedAt: string,
  ): MaybePromise<readonly LiteratureRecord[] | null>;
  deleteLiteratureRecord(
    projectId: string,
    recordId: string,
    expectedVersion: number,
    deletedAt: string,
  ): MaybePromise<boolean>;
}

export class LiteratureServiceError extends Error {
  constructor(readonly code: Exclude<LiteratureIpcErrorCode, 'invalid_literature_input'>) {
    super(code);
    this.name = 'LiteratureServiceError';
  }
}

type LiteratureServiceOptions = Readonly<{
  storage: LiteratureStorage;
  workspace: WorkspaceService;
  provider?: LiteratureDiscoveryProvider;
  transfer: LiteratureTransferPlatform;
  projection?: Readonly<{
    syncLiterature(projectId: string): Promise<unknown>;
    syncReviewedPaper?(record: LiteratureRecord): Promise<unknown>;
  }>;
  now?: () => Date;
}>;

/** Public paper metadata the AI assistant observed in its own search, never model-written text. */
export const AssistantLiteraturePaperSchema = z
  .object({
    title: z.string().trim().min(1).max(2_000),
    authors: z.array(z.string().trim().min(1).max(300)).max(100),
    publishedYear: z.number().int().min(1000).max(3000).nullable(),
    venue: z.string().trim().max(1_000).nullable(),
    abstractText: z.string().trim().max(LITERATURE_MAX_ABSTRACT_LENGTH).nullable(),
    sourceUrl: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => value.startsWith('https://'))
      .nullable(),
    doi: z.string().trim().max(512).nullable(),
  })
  .strict();
export const AddAssistantLiteratureInputSchema = z
  .object({
    projectId: z.string().uuid(),
    papers: z.array(AssistantLiteraturePaperSchema).min(1).max(12),
  })
  .strict();
export type AddAssistantLiteratureInput = z.infer<typeof AddAssistantLiteratureInputSchema>;

function assistantCandidate(
  paper: z.infer<typeof AssistantLiteraturePaperSchema>,
): LiteratureProviderCandidate {
  const doi = normalizeDoi(paper.doi) ?? (paper.sourceUrl ? normalizeDoi(paper.sourceUrl) : null);
  const canonicalId = normalizeArxivCanonicalId(paper.sourceUrl);
  return {
    provider: 'import',
    ...(doi ? { doi } : {}),
    ...(canonicalId ? { canonicalId } : {}),
    fingerprint: literatureFingerprint(
      paper.title,
      paper.authors,
      paper.publishedYear ?? undefined,
    ),
    title: paper.title,
    authors: paper.authors,
    ...(paper.venue ? { containerTitle: paper.venue } : {}),
    ...(paper.publishedYear ? { publishedYear: paper.publishedYear } : {}),
    ...(paper.abstractText ? { abstractText: paper.abstractText } : {}),
    topics: [],
    ...(paper.sourceUrl ? { sourceUrl: paper.sourceUrl } : {}),
  };
}

export class LiteratureService {
  private readonly storage: LiteratureStorage;
  private readonly workspace: WorkspaceService;
  private readonly provider: LiteratureDiscoveryProvider;
  private readonly transfer: LiteratureTransferPlatform;
  private readonly projection?: LiteratureServiceOptions['projection'];
  private readonly now: () => Date;
  private readonly activeSearches = new Set<AbortController>();

  constructor(options: LiteratureServiceOptions) {
    this.storage = options.storage;
    this.workspace = options.workspace;
    this.provider = options.provider ?? new BalancedLiteratureProvider();
    this.transfer = options.transfer;
    this.projection = options.projection;
    this.now = options.now ?? (() => new Date());
  }

  async list(input: { projectId: string }): Promise<LiteratureLibrary> {
    const command = ListLiteratureInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const [records, total, searches] = await Promise.all([
      this.storage.listLiteratureRecords(command.projectId),
      this.storage.countLiteratureRecords(command.projectId),
      this.storage.listLiteratureSearchRuns(command.projectId),
    ]);
    if (
      total > LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT ||
      records.length > LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT
    ) {
      throw new LiteratureServiceError('literature_record_limit_reached');
    }
    return LiteratureLibrarySchema.parse({
      schemaVersion: 1,
      projectId: command.projectId,
      records,
      total,
      recentSearches: searches.slice(0, 20),
    });
  }

  async search(
    input: LiteratureSearchInput,
    externalSignal?: AbortSignal,
  ): Promise<LiteratureSearchReceipt> {
    const command = LiteratureSearchInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    if (externalSignal?.aborted) {
      throw new LiteratureServiceError('literature_provider_unavailable');
    }
    const createdAt = this.now().toISOString();
    const searchTags = resolveLiteratureSearchTags(command.query, command.searchTags);
    const providerQuery = literatureProviderQuery(command.query, searchTags);
    // "논문 검색" or "find papers" names the act, not a topic. A provider still returns something
    // for it, so refuse before a run is recorded instead of saving whatever came back.
    if (literatureQueryTerms(providerQuery).length === 0) {
      throw new LiteratureServiceError('literature_query_without_topic');
    }
    const run = LiteratureSearchRunSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: command.projectId,
      provider: this.provider.providerId,
      policyId: this.provider.policyId,
      policyVersion: this.provider.policyVersion,
      query: command.query,
      searchTags,
      authorQuery: command.authorQuery ?? null,
      venueQuery: command.venueQuery ?? null,
      fromYear: command.fromYear ?? null,
      toYear: command.toYear ?? null,
      requestedLimit: command.limit ?? 50,
      status: 'running',
      foundCount: 0,
      retrievedCount: 0,
      selectedCount: 0,
      tierCounts: { core: 0, rising: 0, broad: 0 },
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      conflictCount: 0,
      conflicts: [],
      createdAt,
      completedAt: null,
    });
    if (!(await this.storage.beginLiteratureSearch(run))) {
      throw new LiteratureServiceError('literature_unavailable');
    }
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    if (externalSignal?.aborted) controller.abort(externalSignal.reason);
    this.activeSearches.add(controller);
    try {
      const providerResult = await this.provider.search(providerQuery, run.requestedLimit, {
        signal: controller.signal,
        fromYear: command.fromYear,
        toYear: command.toYear,
        authorQuery: command.authorQuery,
        venueQuery: command.venueQuery,
      });
      const discovered = Array.isArray(providerResult)
        ? {
            candidates: providerResult as readonly LiteratureProviderCandidate[],
            retrievedCount: providerResult.length,
            selectedCount: providerResult.length,
            tierCounts: { core: 0, rising: 0, broad: 0 },
          }
        : (providerResult as LiteratureProviderSearchResult);
      const discoveryCoverage = 'coverage' in discovered ? discovered.coverage : undefined;
      const providerFailures =
        'providerFailures' in discovered ? (discovered.providerFailures ?? []) : [];
      await this.requireActiveProject(command.projectId);
      if (controller.signal.aborted) throw new LiteratureProviderError('cancelled');
      const receipt = await this.storage.completeLiteratureSearch(
        command.projectId,
        run.id,
        discovered.candidates,
        this.now().toISOString(),
        {
          retrievedCount: discovered.retrievedCount,
          selectedCount: discovered.selectedCount,
          tierCounts: discovered.tierCounts,
          ...(discoveryCoverage ? { coverage: discoveryCoverage } : {}),
        },
      );
      const persistedTierCounts = receipt.run.tierCounts ?? discovered.tierCounts;
      const persistedCoverage = receipt.run.coverage ?? discoveryCoverage;
      await this.projectLiterature(command.projectId);
      return LiteratureSearchReceiptSchema.parse({
        ...receipt,
        retrievedCount: discovered.retrievedCount,
        selectedCount: discovered.selectedCount,
        tierCounts: persistedTierCounts,
        ...(persistedCoverage ? { coverage: persistedCoverage } : {}),
        ...(providerFailures.length > 0 ? { providerFailures: providerFailures.slice(0, 3) } : {}),
        run: {
          ...receipt.run,
          retrievedCount: discovered.retrievedCount,
          selectedCount: discovered.selectedCount,
          tierCounts: persistedTierCounts,
          ...(persistedCoverage ? { coverage: persistedCoverage } : {}),
        },
      });
    } catch (error) {
      const cancelled = error instanceof LiteratureProviderError && error.code === 'cancelled';
      await this.storage.failLiteratureSearch(
        command.projectId,
        run.id,
        cancelled ? 'cancelled' : 'failed',
        this.now().toISOString(),
      );
      if (error instanceof LiteratureServiceError) throw error;
      const persistenceError = storageFailure(error);
      if (persistenceError) throw persistenceError;
      if (error instanceof LiteratureProviderError) {
        throw new LiteratureServiceError(
          error.code === 'rate_limited'
            ? 'literature_rate_limited'
            : 'literature_provider_unavailable',
        );
      }
      throw error;
    } finally {
      externalSignal?.removeEventListener('abort', forwardAbort);
      this.activeSearches.delete(controller);
    }
  }

  async updateAnnotations(input: UpdateLiteratureAnnotationsInput) {
    const command = UpdateLiteratureAnnotationsInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const [current] = await this.storage.getLiteratureRecordsByIds(command.projectId, [
      command.recordId,
    ]);
    if (!current) throw new LiteratureServiceError('literature_record_not_found');
    if (
      current.version !== command.expectedVersion ||
      current.annotationVersion !== command.expectedAnnotationVersion
    ) {
      throw new LiteratureServiceError('literature_record_conflict');
    }
    const updated = await this.storage.updateLiteratureManualAnnotations({
      ...command,
      updatedAt: this.now().toISOString(),
    });
    if (!updated) throw new LiteratureServiceError('literature_record_conflict');
    const parsed = LiteratureRecordSchema.parse(updated);
    await this.projectLiterature(command.projectId);
    if (
      parsed.manualAnnotations.summary ||
      parsed.manualAnnotations.relevance ||
      parsed.reviewStatus === 'included' ||
      parsed.reviewStatus === 'reviewed'
    ) {
      await this.projectReviewedPaper(parsed);
    }
    return parsed;
  }

  async deleteRecord(input: DeleteLiteratureRecordInput): Promise<DeleteLiteratureRecordReceipt> {
    const command = DeleteLiteratureRecordInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const [current] = await this.storage.getLiteratureRecordsByIds(command.projectId, [
      command.recordId,
    ]);
    if (!current) throw new LiteratureServiceError('literature_record_not_found');
    if (current.version !== command.expectedVersion) {
      throw new LiteratureServiceError('literature_record_conflict');
    }
    if (
      !(await this.storage.deleteLiteratureRecord(
        command.projectId,
        command.recordId,
        command.expectedVersion,
        this.now().toISOString(),
      ))
    ) {
      throw new LiteratureServiceError('literature_record_conflict');
    }
    await this.projectLiterature(command.projectId);
    return DeleteLiteratureRecordReceiptSchema.parse({ ...command, deleted: true });
  }

  /**
   * The papers one search selected, best layer first, each with the canonical link GOSU would open.
   * Project Chat hands these to the model so a reply can link real papers instead of naming them,
   * which is also what lets the paper summary library verify and save them.
   */
  async papersOfSearch(input: Readonly<{ projectId: string; runId: string; limit: number }>) {
    await this.requireActiveProject(input.projectId);
    const tierOrder = { core: 0, rising: 1, broad: 2 } as const;
    const selected = (await this.storage.listLiteratureRecords(input.projectId))
      .filter((record) => record.discovery?.searchRunId === input.runId)
      .sort(
        (left, right) =>
          tierOrder[left.discovery!.tier] - tierOrder[right.discovery!.tier] ||
          left.discovery!.tierRank - right.discovery!.tierRank ||
          left.title.localeCompare(right.title),
      );
    const limit = Math.max(0, Math.min(Math.trunc(input.limit), 50));
    return {
      papers: selected.slice(0, limit).map((record) => ({
        title: record.title,
        authors: record.authors.slice(0, 3),
        year: record.publishedYear,
        tier: record.discovery!.tier,
        url: canonicalLiteratureUrl(record),
      })),
      omittedCount: Math.max(0, selected.length - limit),
    };
  }

  /**
   * Takes back the papers that the given searches created, as long as nobody has touched them: no
   * review status, no manual note. AI organization alone does not protect a paper, because it runs
   * by itself after a search. Removal is the same soft delete as "Delete paper", so a later search
   * can bring a paper back.
   */
  async undoSearchAdditions(
    input: UndoLiteratureSearchInput,
  ): Promise<UndoLiteratureSearchReceipt> {
    const command = UndoLiteratureSearchInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const runs = (await this.storage.listLiteratureSearchRuns(command.projectId)).filter(
      (run) => command.runIds.includes(run.id) && run.status === 'complete' && run.completedAt,
    );
    if (runs.length !== new Set(command.runIds).size) {
      throw new LiteratureServiceError('literature_record_not_found');
    }
    const completedAtByRun = new Map(runs.map((run) => [run.id, run.completedAt]));
    const created = (await this.storage.listLiteratureRecords(command.projectId)).filter(
      (record) =>
        record.discovery !== null &&
        record.discovery !== undefined &&
        completedAtByRun.get(record.discovery.searchRunId) === record.createdAt,
    );
    const deletedAt = this.now().toISOString();
    let removedCount = 0;
    for (const record of created) {
      const untouched =
        record.reviewStatus === 'unreviewed' &&
        record.manualAnnotations.topics.length === 0 &&
        record.manualAnnotations.summary === '' &&
        record.manualAnnotations.relevance === '';
      if (
        untouched &&
        (await this.storage.deleteLiteratureRecord(
          command.projectId,
          record.id,
          record.version,
          deletedAt,
        ))
      ) {
        removedCount += 1;
      }
    }
    if (removedCount > 0) await this.projectLiterature(command.projectId);
    return UndoLiteratureSearchReceiptSchema.parse({
      projectId: command.projectId,
      removedCount,
      keptCount: created.length - removedCount,
    });
  }

  /**
   * Adds papers the global AI assistant found, as imported records. Existing records are matched by
   * DOI, arXiv id or fingerprint (the same upsert as file import), so a repeat adds nothing.
   */
  async addFromAssistant(input: AddAssistantLiteratureInput) {
    const command = AddAssistantLiteratureInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const added = await this.addImportedCandidates(
      command.projectId,
      command.papers.map(assistantCandidate),
    );
    return {
      projectId: command.projectId,
      importedCount: added.imported,
      updatedCount: added.updated,
      unchangedCount: added.skipped + added.alreadySaved,
    };
  }

  /**
   * Adds papers the user chose from the shared paper summary library. The library's own summary
   * comes along as a labelled note and its tags as search tags; no abstract is invented.
   */
  async addLibraryPapers(
    input: Readonly<{ projectId: string; papers: readonly PaperLibraryEntry[] }>,
  ) {
    const papers = z
      .array(PaperLibraryEntrySchema)
      .min(1)
      .max(PAPER_LIBRARY_MAX_IMPORT)
      .parse(input.papers);
    await this.requireActiveProject(input.projectId);
    const added = await this.addImportedCandidates(
      input.projectId,
      papers.map((paper) => ({
        ...assistantCandidate({
          title: paper.title,
          authors: paper.authors,
          publishedYear: paper.year,
          venue: paper.venue,
          abstractText: null,
          sourceUrl: paper.sourceUrl,
          doi: null,
        }),
        searchTags: { topics: paper.tags, keywords: paper.keywords },
        ...(paper.summary
          ? {
              manualAnnotations: {
                topics: [],
                summary: `[논문 요약 보관함] ${paper.summary}`,
                relevance: '',
              },
            }
          : {}),
      })),
    );
    return {
      projectId: input.projectId,
      importedCount: added.imported + added.updated,
      alreadySavedCount: added.alreadySaved + added.skipped,
    };
  }

  /**
   * The shared tail of every "add these papers" path. Storage treats an `import` candidate as a
   * review file: it replaces the manual notes of a record it matches. That is right for a file the
   * user exported, and wrong for a paper an assistant or the paper library merely names again, so
   * papers already in the table are left completely alone here.
   */
  private async addImportedCandidates(
    projectId: string,
    candidates: readonly LiteratureProviderCandidate[],
  ) {
    const existing = await this.storage.listLiteratureRecords(projectId);
    const known = new Set(
      existing.flatMap((record) => [
        ...(record.doi ? [`doi:${record.doi.toLowerCase()}`] : []),
        ...(record.canonicalId ? [`canonical:${record.canonicalId.toLowerCase()}`] : []),
        `fingerprint:${record.fingerprint}`,
      ]),
    );
    const fresh = candidates.filter(
      (candidate) =>
        !(
          (candidate.doi && known.has(`doi:${candidate.doi.toLowerCase()}`)) ||
          (candidate.canonicalId &&
            known.has(`canonical:${candidate.canonicalId.toLowerCase()}`)) ||
          known.has(`fingerprint:${candidate.fingerprint}`)
        ),
    );
    const alreadySaved = candidates.length - fresh.length;
    if (fresh.length === 0) return { imported: 0, updated: 0, skipped: 0, alreadySaved };
    if (existing.length + fresh.length > LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT) {
      throw new LiteratureServiceError('literature_record_limit_reached');
    }
    let summary: Awaited<ReturnType<LiteratureStorage['upsertLiteratureCandidates']>>;
    try {
      summary = await this.storage.upsertLiteratureCandidates(
        projectId,
        fresh,
        this.now().toISOString(),
      );
    } catch (error) {
      const persistenceError = storageFailure(error);
      if (persistenceError) throw persistenceError;
      throw error;
    }
    await this.projectLiterature(projectId);
    return { ...summary, alreadySaved };
  }

  async importRecords(input: LiteratureImportRequest): Promise<LiteratureImportReceipt> {
    const command = LiteratureImportRequestSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    let selected: Awaited<ReturnType<LiteratureTransferPlatform['chooseImport']>>;
    try {
      selected = await this.transfer.chooseImport(command.format);
    } catch (error) {
      throw transferPlatformFailure(error, 'import');
    }
    if (selected.status === 'cancelled') {
      return LiteratureImportReceiptSchema.parse({
        status: 'cancelled',
        format: null,
        fileName: null,
        importedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
      });
    }
    if (!selected.format || selected.content === undefined) {
      throw new LiteratureServiceError('literature_import_invalid');
    }
    let candidates: readonly LiteratureProviderCandidate[];
    try {
      candidates = parseTransfer(selected.format, selected.content).map(transferCandidate);
    } catch (error) {
      if (error instanceof LiteratureTransferError) {
        throw new LiteratureServiceError(
          error.code === 'literature_import_too_large'
            ? 'literature_import_too_large'
            : 'literature_import_invalid',
        );
      }
      throw error;
    }
    await this.requireActiveProject(command.projectId);
    let summary: Awaited<ReturnType<LiteratureStorage['upsertLiteratureCandidates']>>;
    try {
      summary = await this.storage.upsertLiteratureCandidates(
        command.projectId,
        candidates,
        this.now().toISOString(),
      );
    } catch (error) {
      const persistenceError = storageFailure(error);
      if (persistenceError) throw persistenceError;
      throw error;
    }
    await this.projectLiterature(command.projectId);
    return LiteratureImportReceiptSchema.parse({
      status: 'imported',
      format: selected.format,
      fileName: selected.fileName,
      importedCount: summary.imported,
      updatedCount: summary.updated,
      unchangedCount: summary.skipped,
    });
  }

  async exportRecords(input: LiteratureExportRequest): Promise<LiteratureExportReceipt> {
    const command = LiteratureExportRequestSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const records = command.recordIds
      ? await this.storage.getLiteratureRecordsByIds(command.projectId, command.recordIds)
      : await this.storage.listLiteratureRecords(command.projectId);
    if (records.length > LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT) {
      throw new LiteratureServiceError('literature_record_limit_reached');
    }
    if (command.recordIds && records.length !== new Set(command.recordIds).size) {
      throw new LiteratureServiceError('literature_record_not_found');
    }
    let content: string;
    try {
      content = serializeTransfer(command.format, records);
    } catch (error) {
      if (error instanceof LiteratureTransferError) {
        throw new LiteratureServiceError('literature_export_too_large');
      }
      throw error;
    }
    let selected: Awaited<ReturnType<LiteratureTransferPlatform['saveExport']>>;
    try {
      selected = await this.transfer.saveExport(command.format, content);
    } catch (error) {
      throw transferPlatformFailure(error, 'export');
    }
    return LiteratureExportReceiptSchema.parse({
      status: selected.status,
      format: command.format,
      fileName: selected.fileName,
      recordCount: selected.status === 'exported' ? records.length : 0,
      sha256:
        selected.status === 'exported'
          ? createHash('sha256').update(content, 'utf8').digest('hex')
          : null,
    });
  }

  async getRecordsForAi(
    projectId: string,
    recordIds: readonly string[],
  ): Promise<LiteratureRecord[]> {
    await this.requireActiveProject(projectId);
    if (
      recordIds.length === 0 ||
      recordIds.length > LITERATURE_MAX_AI_RECORDS ||
      new Set(recordIds).size !== recordIds.length
    ) {
      throw new LiteratureServiceError('literature_ai_conflict');
    }
    const records = await this.storage.getLiteratureRecordsByIds(projectId, recordIds);
    if (records.length !== recordIds.length) {
      throw new LiteratureServiceError('literature_ai_conflict');
    }
    return LiteratureRecordSchema.array().parse(records);
  }

  async applyAiAnnotations(
    projectId: string,
    inputUpdates: readonly LiteratureAiAnnotationUpdate[],
    inputProvenance: LiteratureAiProvenance,
  ) {
    await this.requireActiveProject(projectId);
    const updates = LiteratureAiAnnotationUpdateSchema.array()
      .max(LITERATURE_MAX_AI_RECORDS)
      .parse(inputUpdates);
    const provenance = LiteratureAiProvenanceSchema.parse(inputProvenance);
    if (new Set(updates.map((update) => update.recordId)).size !== updates.length) {
      throw new LiteratureServiceError('literature_ai_conflict');
    }
    if (updates.length === 0) return { updatedCount: 0, skippedCount: 0 };
    const records = await this.storage.getLiteratureRecordsByIds(
      projectId,
      updates.map((update) => update.recordId),
    );
    if (
      records.length !== updates.length ||
      updates.some(
        (update) =>
          records.find((record) => record.id === update.recordId)?.version !==
            update.expectedVersion ||
          records.find((record) => record.id === update.recordId)?.annotationVersion !==
            update.expectedAnnotationVersion,
      )
    ) {
      throw new LiteratureServiceError('literature_ai_conflict');
    }
    const stored = await this.storage.applyLiteratureAiAnnotations(
      projectId,
      updates.map((update) => ({ ...update, provenance })),
      this.now().toISOString(),
    );
    if (!stored) throw new LiteratureServiceError('literature_ai_conflict');
    await this.projectLiterature(projectId);
    await Promise.all(stored.map((record) => this.projectReviewedPaper(record)));
    return { updatedCount: stored.length, skippedCount: updates.length - stored.length };
  }

  shutdown() {
    for (const controller of this.activeSearches) controller.abort('application_shutdown');
    this.activeSearches.clear();
  }

  private async requireActiveProject(projectId: string) {
    const snapshot = await this.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new LiteratureServiceError('literature_project_not_found');
    if (project.archivedAt || project.trashedAt) {
      throw new LiteratureServiceError('literature_project_unavailable');
    }
    return project;
  }

  private async projectLiterature(projectId: string) {
    try {
      await this.projection?.syncLiterature(projectId);
    } catch {
      // Obsidian is a recoverable local projection and never rolls back Literature data.
    }
  }

  private async projectReviewedPaper(record: LiteratureRecord) {
    try {
      await this.projection?.syncReviewedPaper?.(record);
    } catch {
      // A paper note remains retryable local output and never blocks the human review save.
    }
  }
}
