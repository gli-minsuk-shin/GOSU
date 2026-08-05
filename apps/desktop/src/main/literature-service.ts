import { createHash, randomUUID } from 'node:crypto';

import {
  DeleteLiteratureRecordInputSchema,
  DeleteLiteratureRecordReceiptSchema,
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
  type UpdateLiteratureAnnotationsInput,
} from '../shared/literature-contracts';
import { resolveLiteratureSearchTags } from '../shared/literature-search-tags';
import type { WorkspaceService } from './workspace-service';
import { parseLiteratureBibtex, serializeLiteratureBibtex } from './literature-bibtex';
import { LiteratureProviderError, type LiteratureProviderCandidate } from './literature-crossref';
import {
  BalancedLiteratureProvider,
  type LiteratureDiscoveryProvider,
  type LiteratureProviderSearchResult,
} from './literature-discovery';
import { LiteratureStorageError } from './literature-storage-error';
import {
  LiteratureTransferError,
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
  now?: () => Date;
}>;

export class LiteratureService {
  private readonly storage: LiteratureStorage;
  private readonly workspace: WorkspaceService;
  private readonly provider: LiteratureDiscoveryProvider;
  private readonly transfer: LiteratureTransferPlatform;
  private readonly now: () => Date;
  private readonly activeSearches = new Set<AbortController>();

  constructor(options: LiteratureServiceOptions) {
    this.storage = options.storage;
    this.workspace = options.workspace;
    this.provider = options.provider ?? new BalancedLiteratureProvider();
    this.transfer = options.transfer;
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
    const run = LiteratureSearchRunSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId: command.projectId,
      provider: this.provider.providerId,
      policyId: this.provider.policyId,
      policyVersion: this.provider.policyVersion,
      query: command.query,
      searchTags,
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
      const providerResult = await this.provider.search(command.query, run.requestedLimit, {
        signal: controller.signal,
        fromYear: command.fromYear,
        toYear: command.toYear,
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
      return LiteratureSearchReceiptSchema.parse({
        ...receipt,
        retrievedCount: discovered.retrievedCount,
        selectedCount: discovered.selectedCount,
        tierCounts: persistedTierCounts,
        ...(persistedCoverage ? { coverage: persistedCoverage } : {}),
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
    return LiteratureRecordSchema.parse(updated);
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
    return DeleteLiteratureRecordReceiptSchema.parse({ ...command, deleted: true });
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
}
