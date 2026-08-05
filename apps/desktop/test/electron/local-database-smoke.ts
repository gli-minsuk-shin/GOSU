import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import Database from 'better-sqlite3-multiple-ciphers';
import { app, safeStorage } from 'electron';

import { LocalDatabase } from '../../src/main/local-database';
import { literatureFingerprint } from '../../src/main/literature-crossref';
import { LiteratureStorageError } from '../../src/main/literature-storage-error';
import { WorkspaceService } from '../../src/main/workspace-service';
import { WorkspaceDataRecoveryError } from '../../src/main/workspace-storage-error';
import type {
  ProjectChatAttempt,
  ProjectChatMessage,
} from '../../src/shared/project-chat-contracts';
import {
  PROJECT_CHAT_MAX_BRANCH_DEPTH,
  PROJECT_CHAT_MAX_BRANCH_MESSAGES,
} from '../../src/shared/project-chat-contracts';
import {
  LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT,
  type LiteratureAiProvenance,
  type LiteratureDiscoveryCoverage,
  type LiteratureDiscoveryTier,
  type LiteratureRankingSignals,
} from '../../src/shared/literature-contracts';
import type {
  ProjectRecord,
  WorkspaceOperation,
  WorkspaceSnapshot,
} from '../../src/shared/workspace-contracts';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixture(revision: number, operationId: string, createdAt: string) {
  const project: ProjectRecord = {
    id: randomUUID(),
    name: `Persistence fixture ${revision}`,
    slug: `persistence-fixture-${revision}`,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const state: WorkspaceSnapshot = {
    schemaVersion: 1,
    revision,
    projects: [project],
    tasks: [],
    objectives: [],
  };
  const operation: WorkspaceOperation = {
    schemaVersion: 1,
    workspaceRevision: revision,
    id: operationId,
    idempotencyKey: operationId,
    scope: `workspace:${project.id}:project:create`,
    projectId: project.id,
    entityType: 'project',
    entityId: project.id,
    commandType: 'project.create',
    baseVersion: null,
    createdAt,
    payload: { name: project.name, slug: project.slug },
  };
  return { state, operation };
}

function verifyLiteraturePersistence(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const title = 'Bounded research systems';
  const authors = ['Ada Researcher'];
  const firstFingerprint = literatureFingerprint(title, authors, 2026);
  const firstRunId = randomUUID();
  const firstRun = {
    schemaVersion: 1 as const,
    id: firstRunId,
    projectId,
    provider: 'crossref' as const,
    query: 'bounded research systems',
    fromYear: 2020,
    toYear: 2026,
    requestedLimit: 25,
    status: 'running' as const,
    foundCount: 0,
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    conflictCount: 0,
    conflicts: [],
    createdAt: fixedTimestamp,
    completedAt: null,
  };
  invariant(database.beginLiteratureSearch(firstRun), 'literature_search_start_failed');
  const firstReceipt = database.completeLiteratureSearch(
    projectId,
    firstRunId,
    [
      {
        provider: 'crossref',
        providerId: 'crossref-fixture-1',
        doi: '10.1000/gosu.fixture',
        fingerprint: firstFingerprint,
        title,
        authors,
        containerTitle: 'Journal of Fixtures',
        publishedYear: 2026,
        topics: ['research systems'],
        workType: 'journal-article',
        citationCount: 2,
        sourceUrl: 'https://doi.org/10.1000/gosu.fixture',
      },
    ],
    fixedTimestamp,
  );
  invariant(
    firstReceipt.newCount === 1 && firstReceipt.run.fromYear === 2020,
    'literature_search_insert_failed',
  );
  const first = database.listLiteratureRecords(projectId)[0];
  invariant(first?.doi === '10.1000/gosu.fixture', 'literature_doi_was_not_persisted');
  const manual = database.updateLiteratureManualAnnotations({
    projectId,
    recordId: first.id,
    expectedVersion: first.version,
    expectedAnnotationVersion: first.annotationVersion,
    manualTopics: ['verified'],
    manualSummary: 'Human-reviewed summary',
    manualRelevance: 'Directly relevant',
    reviewStatus: 'included',
    updatedAt: fixedTimestamp,
  });
  invariant(
    manual?.annotationVersion === 1 && manual.reviewStatus === 'included',
    'literature_manual_annotation_update_failed',
  );
  const provenance: LiteratureAiProvenance = {
    invocation: {
      schemaVersion: 1,
      invocationId: randomUUID(),
      providerId: 'codex',
      requestedModelId: null,
      resolvedModelId: 'fixture-model',
      catalogVersion: 'fixture-catalog',
      reasoningOptionId: 'high',
      startedAt: fixedTimestamp,
    },
    inputSha256: 'a'.repeat(64),
    generatedAt: fixedTimestamp,
    metadataOnly: true,
  };
  const ai = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: first.id,
        expectedVersion: manual.version,
        expectedAnnotationVersion: manual.annotationVersion,
        topics: ['metadata'],
        summary: 'Metadata-only AI summary',
        relevance: 'high',
        studyType: 'Not assessable from metadata alone',
        limitations: ['Not assessable from metadata alone'],
        provenance,
      },
    ],
    fixedTimestamp,
  );
  invariant(ai?.[0]?.aiAnnotations?.provenance.metadataOnly, 'literature_ai_update_failed');

  const secondRunId = randomUUID();
  invariant(
    database.beginLiteratureSearch({ ...firstRun, id: secondRunId, query: 'refresh fixture' }),
    'literature_refresh_start_failed',
  );
  const refresh = database.completeLiteratureSearch(
    projectId,
    secondRunId,
    [
      {
        provider: 'crossref',
        providerId: 'crossref-fixture-1',
        doi: '10.1000/gosu.fixture',
        fingerprint: literatureFingerprint('Updated provider title', authors, 2026),
        title: 'Updated provider title',
        authors,
        containerTitle: 'Updated Fixture Journal',
        publishedYear: 2026,
        topics: ['updated source topic'],
        workType: 'journal-article',
        citationCount: 9,
        sourceUrl: 'https://doi.org/10.1000/gosu.fixture',
      },
    ],
    fixedTimestamp,
  );
  invariant(refresh.updatedCount === 1, 'literature_crossref_refresh_not_classified');
  const refreshed = database.listLiteratureRecords(projectId)[0];
  invariant(
    refreshed?.title === 'Updated provider title' &&
      refreshed.manualAnnotations.summary === 'Human-reviewed summary' &&
      refreshed.aiAnnotations === null &&
      refreshed.annotationVersion === ai[0]!.annotationVersion + 1,
    'literature_crossref_refresh_did_not_invalidate_stale_ai',
  );
  const reorganized = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: refreshed.id,
        expectedVersion: refreshed.version,
        expectedAnnotationVersion: refreshed.annotationVersion,
        topics: ['updated metadata'],
        summary: 'Metadata-only AI summary',
        relevance: 'high',
        studyType: 'Not assessable from metadata alone',
        limitations: ['Not assessable from metadata alone'],
        provenance,
      },
    ],
    fixedTimestamp,
  );
  invariant(
    reorganized?.[0]?.aiAnnotations?.summary === 'Metadata-only AI summary',
    'literature_crossref_refresh_could_not_be_reorganized',
  );

  const imported = database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'import',
        doi: '10.1000/gosu.fixture',
        fingerprint: firstFingerprint,
        title: 'Untrusted stale imported title',
        authors: ['Different Imported Author'],
        publishedYear: 2020,
        topics: ['stale import topic'],
        citationKey: 'ImportedReviewKey',
        reviewStatus: 'reviewed',
        manualAnnotations: {
          topics: ['restored review'],
          summary: 'Imported human review',
          relevance: 'Imported relevance',
        },
      },
    ],
    fixedTimestamp,
  );
  invariant(imported.updated === 1, 'literature_review_import_not_updated');
  const merged = database.listLiteratureRecords(projectId)[0];
  invariant(
    merged?.provider === 'crossref' &&
      merged.title === 'Updated provider title' &&
      merged.manualAnnotations.summary === 'Imported human review' &&
      merged.reviewStatus === 'reviewed' &&
      merged.aiAnnotations?.summary === 'Metadata-only AI summary',
    'literature_import_trust_merge_failed',
  );

  const providerIdentityTitle = 'Provider identity before metadata change';
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: 'https://api.crossref.org/works/provider-only-fixture',
        fingerprint: literatureFingerprint(providerIdentityTitle, authors, 2025),
        title: providerIdentityTitle,
        authors,
        publishedYear: 2025,
        topics: [],
      },
    ],
    fixedTimestamp,
  );
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: '10.1000/gosu.provider-enriched',
        doi: '10.1000/gosu.provider-enriched',
        fingerprint: literatureFingerprint(providerIdentityTitle, authors, 2025),
        title: providerIdentityTitle,
        authors,
        publishedYear: 2025,
        topics: [],
      },
    ],
    fixedTimestamp,
  );
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: '10.1000/gosu.provider-enriched',
        doi: '10.1000/gosu.provider-enriched',
        fingerprint: literatureFingerprint('Provider identity changed title', authors, 2025),
        title: 'Provider identity changed title',
        authors,
        publishedYear: 2025,
        topics: [],
      },
    ],
    fixedTimestamp,
  );
  const providerIdentity = database
    .listLiteratureRecords(projectId)
    .find((record) => record.doi === '10.1000/gosu.provider-enriched');
  const providerFallbackIdentity = database
    .listLiteratureRecords(projectId)
    .find(
      (record) =>
        record.providerRecordId === 'https://api.crossref.org/works/provider-only-fixture',
    );
  invariant(
    database.countLiteratureRecords(projectId) === 3 &&
      providerIdentity?.doi === '10.1000/gosu.provider-enriched' &&
      providerIdentity?.fingerprint ===
        literatureFingerprint('Provider identity changed title', authors, 2025) &&
      providerFallbackIdentity?.doi === null,
    'literature_provider_identity_or_fingerprint_refresh_failed',
  );

  const fingerprintTitle = 'Fingerprint-only identity';
  const fingerprint = literatureFingerprint(fingerprintTitle, authors, 2024);
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'import',
        fingerprint,
        title: fingerprintTitle,
        authors,
        publishedYear: 2024,
        topics: [],
      },
      {
        provider: 'import',
        fingerprint,
        title: fingerprintTitle,
        authors,
        publishedYear: 2024,
        topics: [],
        reviewStatus: 'screening',
      },
    ],
    fixedTimestamp,
  );
  invariant(
    database.countLiteratureRecords(projectId) === 4,
    'literature_fingerprint_dedupe_failed',
  );
  database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: '10.1000/gosu.fingerprint-enriched',
        doi: '10.1000/gosu.fingerprint-enriched',
        fingerprint,
        title: fingerprintTitle,
        authors,
        publishedYear: 2024,
        topics: ['provider metadata'],
      },
    ],
    fixedTimestamp,
  );
  const enrichedFingerprintRecord = database
    .listLiteratureRecords(projectId)
    .find((record) => record.doi === '10.1000/gosu.fingerprint-enriched');
  invariant(
    database.countLiteratureRecords(projectId) === 4 &&
      enrichedFingerprintRecord?.provider === 'crossref' &&
      enrichedFingerprintRecord.reviewStatus === 'screening',
    'literature_weak_fingerprint_was_not_safely_enriched',
  );

  database.upsertLiteratureCandidates(
    otherProjectId,
    [
      {
        provider: 'crossref',
        doi: '10.1000/gosu.fixture',
        fingerprint: firstFingerprint,
        title,
        authors,
        publishedYear: 2026,
        topics: [],
      },
    ],
    fixedTimestamp,
  );
  invariant(
    database.countLiteratureRecords(otherProjectId) === 1 &&
      database.countLiteratureRecords(projectId) === 4,
    'literature_project_isolation_failed',
  );

  const beforeAtomicConflict = database.getLiteratureRecordsByIds(projectId, [merged.id])[0]!;
  const atomicConflict = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: merged.id,
        expectedVersion: beforeAtomicConflict.version,
        expectedAnnotationVersion: beforeAtomicConflict.annotationVersion,
        topics: ['would-be-write'],
        summary: 'This must roll back',
        relevance: 'low',
        studyType: '',
        limitations: [],
        provenance,
      },
      {
        recordId: randomUUID(),
        expectedVersion: 1,
        expectedAnnotationVersion: 0,
        topics: [],
        summary: '',
        relevance: 'uncertain',
        studyType: '',
        limitations: [],
        provenance,
      },
    ],
    fixedTimestamp,
  );
  invariant(atomicConflict === null, 'literature_ai_conflict_was_not_rejected');
  invariant(
    database.getLiteratureRecordsByIds(projectId, [merged.id])[0]?.aiAnnotations?.summary ===
      'Metadata-only AI summary',
    'literature_ai_conflict_was_not_atomic',
  );
  invariant(
    database.updateLiteratureManualAnnotations({
      projectId,
      recordId: merged.id,
      expectedVersion: 1,
      expectedAnnotationVersion: 0,
      manualTopics: [],
      manualSummary: '',
      manualRelevance: '',
      reviewStatus: 'unreviewed',
      updatedAt: fixedTimestamp,
    }) === null,
    'literature_manual_conflict_was_not_rejected',
  );

  const beforeSourceRefresh = database.getLiteratureRecordsByIds(projectId, [merged.id])[0]!;
  const staleDraftRunId = randomUUID();
  invariant(
    database.beginLiteratureSearch({
      ...firstRun,
      id: staleDraftRunId,
      query: 'source refresh after AI draft',
    }),
    'literature_stale_ai_refresh_start_failed',
  );
  database.completeLiteratureSearch(
    projectId,
    staleDraftRunId,
    [
      {
        provider: 'crossref',
        ...(beforeSourceRefresh.providerRecordId
          ? { providerId: beforeSourceRefresh.providerRecordId }
          : {}),
        ...(beforeSourceRefresh.doi ? { doi: beforeSourceRefresh.doi } : {}),
        fingerprint: literatureFingerprint('Source changed after AI draft', authors, 2026),
        title: 'Source changed after AI draft',
        authors,
        ...(beforeSourceRefresh.containerTitle
          ? { containerTitle: beforeSourceRefresh.containerTitle }
          : {}),
        publishedYear: 2026,
        topics: ['fresh source metadata'],
        ...(beforeSourceRefresh.workType ? { workType: beforeSourceRefresh.workType } : {}),
        citationCount: 10,
        ...(beforeSourceRefresh.sourceUrl ? { sourceUrl: beforeSourceRefresh.sourceUrl } : {}),
      },
    ],
    fixedTimestamp,
  );
  const afterSourceRefresh = database.getLiteratureRecordsByIds(projectId, [merged.id])[0]!;
  invariant(
    afterSourceRefresh.version === beforeSourceRefresh.version + 1 &&
      afterSourceRefresh.annotationVersion === beforeSourceRefresh.annotationVersion + 1 &&
      afterSourceRefresh.aiAnnotations === null,
    'literature_source_refresh_did_not_clear_ai_annotations',
  );
  invariant(
    database.applyLiteratureAiAnnotations(
      projectId,
      [
        {
          recordId: merged.id,
          expectedVersion: beforeSourceRefresh.version,
          expectedAnnotationVersion: beforeSourceRefresh.annotationVersion,
          topics: ['stale-draft'],
          summary: 'This stale draft must not apply',
          relevance: 'low',
          studyType: '',
          limitations: [],
          provenance,
        },
      ],
      fixedTimestamp,
    ) === null,
    'literature_stale_ai_source_version_was_accepted',
  );
  const freshAi = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: merged.id,
        expectedVersion: afterSourceRefresh.version,
        expectedAnnotationVersion: afterSourceRefresh.annotationVersion,
        topics: ['fresh-draft'],
        summary: 'Fresh metadata-only draft',
        relevance: 'high',
        studyType: '',
        limitations: [],
        provenance,
      },
    ],
    fixedTimestamp,
  );
  invariant(
    freshAi?.[0]?.aiAnnotations?.summary === 'Fresh metadata-only draft',
    'literature_source_refresh_new_ai_cas_failed',
  );
  invariant(
    database.deleteLiteratureRecord(projectId, merged.id, freshAi[0]!.version, fixedTimestamp),
    'literature_soft_delete_failed',
  );
  invariant(
    !database.listLiteratureRecords(projectId).some((record) => record.id === merged.id),
    'literature_soft_delete_remained_visible',
  );
  database.close();

  const reopened = new LocalDatabase();
  reopened.open();
  invariant(
    reopened.listLiteratureSearchRuns(projectId).length === 3,
    'literature_runs_not_reopened',
  );
  invariant(reopened.countLiteratureRecords(projectId) === 3, 'literature_records_not_reopened');
  invariant(
    reopened.countLiteratureRecords(otherProjectId) === 1,
    'literature_other_project_not_reopened',
  );
  reopened.close();
}

function verifySparseSemanticScholarMerge(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  const projectId = randomUUID();
  const doi = '10.1000/gosu.sparse-semantic';
  const title = 'Durable provider metadata';
  const authors = ['Ada Researcher', 'Grace Scientist'];
  const originalFingerprint = literatureFingerprint(title, authors, 2018);
  const original = database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'crossref',
        providerId: doi,
        doi,
        fingerprint: originalFingerprint,
        title,
        authors,
        containerTitle: 'Journal of Durable Metadata',
        publishedYear: 2018,
        topics: ['durable metadata', 'research systems'],
        workType: 'journal-article',
        citationCount: 72,
        sourceUrl: `https://doi.org/${doi}`,
      },
    ],
    fixedTimestamp,
  );
  invariant(original.imported === 1, 'sparse_semantic_fixture_was_not_inserted');
  const inserted = database.listLiteratureRecords(projectId)[0]!;
  const manual = database.updateLiteratureManualAnnotations({
    projectId,
    recordId: inserted.id,
    expectedVersion: inserted.version,
    expectedAnnotationVersion: inserted.annotationVersion,
    manualTopics: ['human verified'],
    manualSummary: 'Preserve this human review.',
    manualRelevance: 'Directly relevant',
    reviewStatus: 'included',
    updatedAt: fixedTimestamp,
  })!;
  const provenance: LiteratureAiProvenance = {
    invocation: {
      schemaVersion: 1,
      invocationId: randomUUID(),
      providerId: 'codex',
      requestedModelId: null,
      resolvedModelId: 'fixture-model',
      catalogVersion: 'fixture-catalog',
      reasoningOptionId: 'high',
      startedAt: fixedTimestamp,
    },
    inputSha256: 'c'.repeat(64),
    generatedAt: fixedTimestamp,
    metadataOnly: true,
  };
  const annotated = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: manual.id,
        expectedVersion: manual.version,
        expectedAnnotationVersion: manual.annotationVersion,
        topics: ['provider metadata'],
        summary: 'AI summary before provider promotion',
        relevance: 'high',
        studyType: '',
        limitations: [],
        provenance,
      },
    ],
    fixedTimestamp,
  )![0]!;
  const sparseSemanticCandidate = {
    provider: 'semantic-scholar' as const,
    providerId: 'semantic-sparse-fixture',
    doi,
    fingerprint: literatureFingerprint(title, [], undefined),
    title,
    authors: [],
    topics: [],
  };

  const promotion = database.upsertLiteratureCandidates(
    projectId,
    [sparseSemanticCandidate],
    fixedTimestamp,
  );
  const promoted = database.listLiteratureRecords(projectId)[0]!;
  invariant(
    promotion.updated === 1 &&
      promoted.provider === 'semantic-scholar' &&
      promoted.providerRecordId === 'semantic-sparse-fixture' &&
      promoted.authors.join('|') === authors.join('|') &&
      promoted.containerTitle === 'Journal of Durable Metadata' &&
      promoted.publishedYear === 2018 &&
      promoted.sourceTopics.join('|') === 'durable metadata|research systems' &&
      promoted.workType === 'journal-article' &&
      promoted.citationCount === 72 &&
      promoted.sourceUrl === `https://doi.org/${doi}` &&
      promoted.fingerprint === originalFingerprint &&
      promoted.manualAnnotations.summary === 'Preserve this human review.' &&
      promoted.reviewStatus === 'included' &&
      promoted.aiAnnotations === null &&
      promoted.annotationVersion === annotated.annotationVersion + 1,
    'sparse_semantic_provider_promotion_erased_known_metadata',
  );

  const refreshedAi = database.applyLiteratureAiAnnotations(
    projectId,
    [
      {
        recordId: promoted.id,
        expectedVersion: promoted.version,
        expectedAnnotationVersion: promoted.annotationVersion,
        topics: ['preserved metadata'],
        summary: 'AI summary after provider promotion',
        relevance: 'high',
        studyType: '',
        limitations: [],
        provenance,
      },
    ],
    fixedTimestamp,
  )![0]!;
  const noOp = database.upsertLiteratureCandidates(
    projectId,
    [sparseSemanticCandidate],
    fixedTimestamp,
  );
  const afterNoOp = database.listLiteratureRecords(projectId)[0]!;
  invariant(
    noOp.skipped === 1 &&
      afterNoOp.version === refreshedAi.version &&
      afterNoOp.annotationVersion === refreshedAi.annotationVersion &&
      afterNoOp.aiAnnotations?.summary === 'AI summary after provider promotion',
    'repeated_sparse_semantic_refresh_invalidated_unchanged_ai',
  );

  const richerTitle = 'Richer Semantic Scholar metadata';
  const richerAuthors = ['Ada Researcher', 'Katherine Scholar'];
  const richer = database.upsertLiteratureCandidates(
    projectId,
    [
      {
        provider: 'semantic-scholar',
        providerId: 'semantic-sparse-fixture',
        doi,
        fingerprint: literatureFingerprint(richerTitle, richerAuthors, 2024),
        title: richerTitle,
        authors: richerAuthors,
        containerTitle: 'Semantic Systems Conference',
        publishedYear: 2024,
        topics: ['foundation models'],
        workType: 'Conference',
        citationCount: 99,
        sourceUrl: 'https://www.semanticscholar.org/paper/semantic-sparse-fixture',
      },
    ],
    fixedTimestamp,
  );
  const enriched = database.listLiteratureRecords(projectId)[0]!;
  invariant(
    richer.updated === 1 &&
      enriched.title === richerTitle &&
      enriched.authors.join('|') === richerAuthors.join('|') &&
      enriched.containerTitle === 'Semantic Systems Conference' &&
      enriched.publishedYear === 2024 &&
      enriched.sourceTopics.join('|') === 'foundation models' &&
      enriched.workType === 'Conference' &&
      enriched.citationCount === 99 &&
      enriched.fingerprint === literatureFingerprint(richerTitle, richerAuthors, 2024) &&
      enriched.manualAnnotations.summary === 'Preserve this human review.' &&
      enriched.aiAnnotations === null,
    'explicit_richer_semantic_metadata_was_not_applied',
  );
  database.close();

  const reopened = new LocalDatabase();
  reopened.open();
  const durable = reopened.listLiteratureRecords(projectId)[0];
  invariant(
    durable?.provider === 'semantic-scholar' &&
      durable.title === richerTitle &&
      durable.manualAnnotations.summary === 'Preserve this human review.',
    'semantic_metadata_merge_was_not_durable',
  );
  reopened.close();
}

function verifyLiteratureDiscoveryPersistence(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  const projectId = randomUUID();
  const runId = randomUUID();
  const query = 'deep literature discovery';
  invariant(
    database.beginLiteratureSearch({
      schemaVersion: 1,
      id: runId,
      projectId,
      provider: 'balanced',
      policyId: 'balanced-three-layer',
      policyVersion: 1,
      query,
      fromYear: null,
      toYear: null,
      requestedLimit: 3,
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
      createdAt: fixedTimestamp,
      completedAt: null,
    }),
    'literature_discovery_search_start_failed',
  );
  const discovery = (
    tier: LiteratureDiscoveryTier,
    tierRank: number,
    score: number,
  ): LiteratureRankingSignals => ({
    tier,
    matchedLayers: tier === 'broad' ? ['broad'] : [tier, 'broad'],
    tierRank,
    overallScore: score,
    relevanceScore: score,
    authorityScore: tier === 'core' ? 0.9 : 0.3,
    momentumScore: tier === 'rising' ? 0.9 : 0.2,
    citationVelocityProxy: tier === 'rising' ? 12.5 : 1,
    influentialCitationCount: tier === 'core' ? 100 : 2,
    maxAuthorHIndex: tier === 'core' ? 80 : 10,
    reasons:
      tier === 'core'
        ? ['high-query-relevance', 'high-citation-impact']
        : tier === 'rising'
          ? ['recent-publication', 'estimated-citation-momentum']
          : ['broad-recall'],
    signalSources: ['semantic-scholar'],
  });
  const candidates = (['core', 'rising', 'broad'] as const).map((tier, index) => ({
    provider: 'semantic-scholar' as const,
    providerId: `discovery-${tier}`,
    doi: `10.1000/gosu.discovery.${tier}`,
    fingerprint: literatureFingerprint(`Discovery ${tier}`, ['Discovery Author'], 2026 - index),
    title: `Discovery ${tier}`,
    authors: ['Discovery Author'],
    publishedYear: 2026 - index,
    topics: ['discovery'],
    citationCount: 100 - index,
    discovery: discovery(tier, 1, 0.9 - index * 0.1),
  }));
  const coverage: LiteratureDiscoveryCoverage = {
    source: 'semantic-scholar',
    availableSignals: ['relevance', 'citation-authority', 'recent-momentum'],
    degradationReasons: ['author-metrics-unavailable'],
  };
  const receipt = database.completeLiteratureSearch(projectId, runId, candidates, fixedTimestamp, {
    retrievedCount: 137,
    selectedCount: 3,
    tierCounts: { core: 1, rising: 1, broad: 1 },
    coverage,
  });
  invariant(
    receipt.retrievedCount === 137 &&
      receipt.selectedCount === 3 &&
      receipt.tierCounts.core === 1 &&
      receipt.tierCounts.rising === 1 &&
      receipt.tierCounts.broad === 1 &&
      receipt.run.coverage?.source === 'semantic-scholar' &&
      receipt.run.coverage.degradationReasons[0] === 'author-metrics-unavailable',
    'literature_discovery_counts_were_not_persisted',
  );
  const records = database.listLiteratureRecords(projectId);
  invariant(
    records.every(
      (record) =>
        record.discovery?.searchRunId === runId &&
        record.discovery.query === query &&
        record.discovery.policyId === 'balanced-three-layer',
    ) && new Set(records.map((record) => record.discovery?.tier)).size === 3,
    'literature_discovery_provenance_was_not_persisted',
  );
  database.close();

  const reopened = new LocalDatabase();
  reopened.open();
  const [savedRun] = reopened.listLiteratureSearchRuns(projectId);
  invariant(
    savedRun?.retrievedCount === 137 &&
      savedRun.selectedCount === 3 &&
      savedRun.tierCounts?.core === 1 &&
      savedRun.coverage?.availableSignals.includes('citation-authority') === true &&
      savedRun.coverage.degradationReasons.includes('author-metrics-unavailable') &&
      reopened
        .listLiteratureRecords(projectId)
        .every((record) => record.discovery !== undefined && record.discovery !== null),
    'literature_discovery_provenance_was_not_durable',
  );
  reopened.close();
}

function verifyLiteratureBoundsAndIdentity(fixedTimestamp: string) {
  const database = new LocalDatabase();
  database.open();
  try {
    const identityProjectId = randomUUID();
    const identityCandidates = ['doi', 'provider', 'fingerprint'].map((name, index) => ({
      provider: 'crossref' as const,
      providerId: `identity-provider-${index}`,
      doi: `10.1000/gosu.identity-${index}`,
      fingerprint: literatureFingerprint(`Identity ${name}`, ['Identity Author'], 2026),
      title: `Identity ${name}`,
      authors: ['Identity Author'],
      publishedYear: 2026,
      topics: [],
      citationKey: `Identity${index}`,
    }));
    database.upsertLiteratureCandidates(identityProjectId, identityCandidates, fixedTimestamp);

    const sharedFingerprintProjectId = randomUUID();
    const sharedFingerprintTitle =
      'A physics-informed residual correction framework for pretrained tabular foundation model based battery health prognostics';
    const sharedFingerprintAuthors = ['Zhiqiang Li'];
    const sharedFingerprint = literatureFingerprint(
      sharedFingerprintTitle,
      sharedFingerprintAuthors,
      2026,
    );
    const sharedFingerprintCandidates = ['10.2139/ssrn.6778930', '10.2139/ssrn.6862081'].map(
      (doi) => ({
        provider: 'crossref' as const,
        providerId: doi,
        doi,
        fingerprint: sharedFingerprint,
        title: sharedFingerprintTitle,
        authors: sharedFingerprintAuthors,
        publishedYear: 2026,
        topics: [],
      }),
    );
    const sharedFingerprintRunId = randomUUID();
    invariant(
      database.beginLiteratureSearch({
        schemaVersion: 1,
        id: sharedFingerprintRunId,
        projectId: sharedFingerprintProjectId,
        provider: 'crossref',
        query: 'tabular foundation model',
        fromYear: null,
        toYear: null,
        requestedLimit: 25,
        status: 'running',
        foundCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        retrievedCount: 0,
        selectedCount: 0,
        tierCounts: { core: 0, rising: 0, broad: 0 },
        conflicts: [],
        createdAt: fixedTimestamp,
        completedAt: null,
      }),
      'literature_shared_fingerprint_search_start_failed',
    );
    const sharedFingerprintReceipt = database.completeLiteratureSearch(
      sharedFingerprintProjectId,
      sharedFingerprintRunId,
      sharedFingerprintCandidates,
      fixedTimestamp,
    );
    const sharedFingerprintRecords = database.listLiteratureRecords(sharedFingerprintProjectId);
    invariant(
      sharedFingerprintReceipt.foundCount === 2 &&
        sharedFingerprintReceipt.newCount === 2 &&
        sharedFingerprintReceipt.conflictCount === 0 &&
        sharedFingerprintRecords.length === 2 &&
        new Set(sharedFingerprintRecords.map((record) => record.doi)).size === 2 &&
        sharedFingerprintRecords.every((record) => record.fingerprint === sharedFingerprint),
      'literature_distinct_dois_with_shared_fingerprint_were_not_preserved',
    );
    const repeatedSharedFingerprintRunId = randomUUID();
    invariant(
      database.beginLiteratureSearch({
        ...sharedFingerprintReceipt.run,
        id: repeatedSharedFingerprintRunId,
        status: 'running',
        foundCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        retrievedCount: 0,
        selectedCount: 0,
        tierCounts: { core: 0, rising: 0, broad: 0 },
        conflicts: [],
        completedAt: null,
      }),
      'literature_shared_fingerprint_repeat_start_failed',
    );
    const repeatedSharedFingerprintReceipt = database.completeLiteratureSearch(
      sharedFingerprintProjectId,
      repeatedSharedFingerprintRunId,
      sharedFingerprintCandidates,
      fixedTimestamp,
    );
    invariant(
      repeatedSharedFingerprintReceipt.unchangedCount === 2 &&
        repeatedSharedFingerprintReceipt.conflictCount === 0 &&
        database.countLiteratureRecords(sharedFingerprintProjectId) === 2,
      'literature_distinct_dois_with_shared_fingerprint_were_not_idempotent',
    );
    let ambiguousWeakImportRejected = false;
    try {
      database.upsertLiteratureCandidates(
        sharedFingerprintProjectId,
        [
          {
            provider: 'import',
            fingerprint: sharedFingerprint,
            title: sharedFingerprintTitle,
            authors: sharedFingerprintAuthors,
            publishedYear: 2026,
            topics: [],
          },
        ],
        fixedTimestamp,
      );
    } catch (error) {
      ambiguousWeakImportRejected =
        error instanceof LiteratureStorageError && error.code === 'identity_conflict';
    }
    invariant(
      ambiguousWeakImportRejected &&
        database.countLiteratureRecords(sharedFingerprintProjectId) === 2,
      'literature_ambiguous_weak_fingerprint_was_not_rejected',
    );

    const singleStrongProjectId = randomUUID();
    const singleStrongFingerprint = literatureFingerprint(
      'One strong record with coarse metadata',
      ['Shared Author'],
      2026,
    );
    database.upsertLiteratureCandidates(
      singleStrongProjectId,
      [
        {
          provider: 'crossref',
          providerId: '10.1000/gosu.single-strong',
          doi: '10.1000/gosu.single-strong',
          fingerprint: singleStrongFingerprint,
          title: 'One strong record with coarse metadata',
          authors: ['Shared Author'],
          publishedYear: 2026,
          topics: [],
        },
      ],
      fixedTimestamp,
    );
    const singleStrongRecord = database.listLiteratureRecords(singleStrongProjectId)[0]!;
    const weakImport = {
      provider: 'import' as const,
      fingerprint: singleStrongFingerprint,
      title: singleStrongRecord.title,
      authors: singleStrongRecord.authors,
      ...(singleStrongRecord.publishedYear
        ? { publishedYear: singleStrongRecord.publishedYear }
        : {}),
      topics: [],
      reviewStatus: 'included' as const,
    };
    for (const deleted of [false, true]) {
      if (deleted) {
        invariant(
          database.deleteLiteratureRecord(
            singleStrongProjectId,
            singleStrongRecord.id,
            singleStrongRecord.version,
            fixedTimestamp,
          ),
          'literature_single_strong_delete_fixture_failed',
        );
      }
      let weakStrongCollisionRejected = false;
      try {
        database.upsertLiteratureCandidates(singleStrongProjectId, [weakImport], fixedTimestamp);
      } catch (error) {
        weakStrongCollisionRejected =
          error instanceof LiteratureStorageError && error.code === 'identity_conflict';
      }
      invariant(
        weakStrongCollisionRejected &&
          database.countLiteratureRecords(singleStrongProjectId) === (deleted ? 0 : 1),
        deleted
          ? 'literature_weak_fingerprint_resurrected_deleted_strong_record'
          : 'literature_weak_fingerprint_merged_into_strong_record',
      );
    }

    let identityConflictRejected = false;
    try {
      database.upsertLiteratureCandidates(
        identityProjectId,
        [
          {
            provider: 'import',
            fingerprint: literatureFingerprint('Must roll back', ['Atomic Author'], 2026),
            title: 'Must roll back',
            authors: ['Atomic Author'],
            publishedYear: 2026,
            topics: [],
            citationKey: 'MustRollBack',
          },
          {
            provider: 'crossref',
            providerId: identityCandidates[1]!.providerId,
            doi: identityCandidates[0]!.doi,
            fingerprint: identityCandidates[2]!.fingerprint,
            title: 'Conflicting three-way identity',
            authors: ['Identity Author'],
            publishedYear: 2026,
            topics: [],
          },
        ],
        fixedTimestamp,
      );
    } catch (error) {
      identityConflictRejected =
        error instanceof LiteratureStorageError && error.code === 'identity_conflict';
    }
    invariant(identityConflictRejected, 'literature_identity_conflict_was_not_typed');
    invariant(
      database.countLiteratureRecords(identityProjectId) === identityCandidates.length &&
        !database
          .listLiteratureRecords(identityProjectId)
          .some((record) => record.citationKey === 'MustRollBack'),
      'literature_identity_conflict_was_not_atomic',
    );

    const isolatedConflictRunId = randomUUID();
    invariant(
      database.beginLiteratureSearch({
        schemaVersion: 1,
        id: isolatedConflictRunId,
        projectId: identityProjectId,
        provider: 'crossref',
        query: 'isolated strong identity conflict',
        fromYear: null,
        toYear: null,
        requestedLimit: 5,
        status: 'running',
        foundCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        conflicts: [],
        createdAt: fixedTimestamp,
        completedAt: null,
      }),
      'literature_isolated_conflict_search_start_failed',
    );
    const safeSearchCandidate = {
      provider: 'crossref' as const,
      providerId: '10.1000/gosu.identity-safe-search',
      doi: '10.1000/gosu.identity-safe-search',
      fingerprint: literatureFingerprint('Safe search candidate', ['Safe Author'], 2026),
      title: 'Safe search candidate',
      authors: ['Safe Author'],
      publishedYear: 2026,
      topics: [],
    };
    const isolatedConflictReceipt = database.completeLiteratureSearch(
      identityProjectId,
      isolatedConflictRunId,
      [
        ...Array.from({ length: 4 }, (_, index) => ({
          provider: 'crossref' as const,
          providerId: identityCandidates[1]!.providerId,
          doi: identityCandidates[0]!.doi,
          fingerprint: literatureFingerprint(
            `Conflicting strong identities from search ${index}`,
            ['Identity Author'],
            2026,
          ),
          title: `Conflicting strong identities from search ${index}`,
          authors: ['Identity Author'],
          publishedYear: 2026,
          topics: [],
        })),
        safeSearchCandidate,
      ],
      fixedTimestamp,
    );
    const isolatedConflictRun = database
      .listLiteratureSearchRuns(identityProjectId)
      .find((run) => run.id === isolatedConflictRunId);
    const identityRecordsAfterSearch = database.listLiteratureRecords(identityProjectId);
    invariant(
      isolatedConflictReceipt.foundCount === 5 &&
        isolatedConflictReceipt.newCount === 1 &&
        isolatedConflictReceipt.updatedCount === 0 &&
        isolatedConflictReceipt.unchangedCount === 0 &&
        isolatedConflictReceipt.conflictCount === 4 &&
        isolatedConflictReceipt.run.status === 'complete' &&
        isolatedConflictReceipt.run.conflictCount === 4 &&
        isolatedConflictReceipt.run.conflicts.length === 3 &&
        isolatedConflictReceipt.run.conflicts[0]?.doi === identityCandidates[0]!.doi &&
        isolatedConflictReceipt.run.conflicts[0]?.providerRecordId ===
          identityCandidates[1]!.providerId &&
        isolatedConflictRun?.status === 'complete' &&
        isolatedConflictRun.conflictCount === 4 &&
        isolatedConflictRun.conflicts.length === 3 &&
        isolatedConflictRun.conflicts[0]?.title === 'Conflicting strong identities from search 0' &&
        identityRecordsAfterSearch.some((record) => record.doi === safeSearchCandidate.doi) &&
        identityCandidates.every((candidate) =>
          identityRecordsAfterSearch.some(
            (record) =>
              record.doi === candidate.doi && record.providerRecordId === candidate.providerId,
          ),
        ) &&
        identityRecordsAfterSearch.length === identityCandidates.length + 1,
      'literature_search_identity_conflict_was_not_isolated',
    );

    for (const mismatch of [
      {
        ...identityCandidates[0]!,
        doi: '10.1000/gosu.identity-different',
      },
      {
        ...identityCandidates[0]!,
        providerId: 'identity-provider-different',
      },
    ]) {
      let strongIdentityMismatchRejected = false;
      try {
        database.upsertLiteratureCandidates(identityProjectId, [mismatch], fixedTimestamp);
      } catch (error) {
        strongIdentityMismatchRejected =
          error instanceof LiteratureStorageError && error.code === 'identity_conflict';
      }
      invariant(
        strongIdentityMismatchRejected,
        'literature_strong_identity_mismatch_was_not_rejected',
      );
    }
    const preservedIdentity = database
      .listLiteratureRecords(identityProjectId)
      .find((record) => record.fingerprint === identityCandidates[0]!.fingerprint);
    invariant(
      preservedIdentity?.doi === identityCandidates[0]!.doi &&
        preservedIdentity.providerRecordId === identityCandidates[0]!.providerId,
      'literature_strong_identity_mismatch_overwrote_identity',
    );

    const capacityProjectId = randomUUID();
    const capacityCandidate = (index: number, provider: 'crossref' | 'import' = 'import') => ({
      provider,
      ...(provider === 'crossref' ? { providerId: `capacity-provider-${index}` } : {}),
      fingerprint: literatureFingerprint(`Capacity record ${index}`, ['Capacity Author'], 2026),
      title: `Capacity record ${index}`,
      authors: ['Capacity Author'],
      publishedYear: 2026,
      topics: [],
      citationKey: `Capacity${index}`,
    });
    database.upsertLiteratureCandidates(
      capacityProjectId,
      Array.from({ length: LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT - 1 }, (_, index) =>
        capacityCandidate(index),
      ),
      fixedTimestamp,
    );

    const capacityRunId = randomUUID();
    invariant(
      database.beginLiteratureSearch({
        schemaVersion: 1,
        id: capacityRunId,
        projectId: capacityProjectId,
        provider: 'crossref',
        query: 'capacity boundary',
        fromYear: null,
        toYear: null,
        requestedLimit: 2,
        status: 'running',
        foundCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        conflicts: [],
        createdAt: fixedTimestamp,
        completedAt: null,
      }),
      'literature_capacity_search_start_failed',
    );
    let searchLimitRejected = false;
    try {
      database.completeLiteratureSearch(
        capacityProjectId,
        capacityRunId,
        [capacityCandidate(10_000, 'crossref'), capacityCandidate(10_001, 'crossref')],
        fixedTimestamp,
      );
    } catch (error) {
      searchLimitRejected =
        error instanceof LiteratureStorageError && error.code === 'record_limit_reached';
    }
    invariant(searchLimitRejected, 'literature_search_capacity_was_not_typed');
    invariant(
      database.countLiteratureRecords(capacityProjectId) ===
        LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT - 1,
      'literature_search_capacity_was_not_atomic',
    );
    invariant(
      database.failLiteratureSearch(capacityProjectId, capacityRunId, 'failed', fixedTimestamp),
      'literature_capacity_search_was_not_reconcilable',
    );

    let importLimitRejected = false;
    try {
      database.upsertLiteratureCandidates(
        capacityProjectId,
        [capacityCandidate(20_000), capacityCandidate(20_001)],
        fixedTimestamp,
      );
    } catch (error) {
      importLimitRejected =
        error instanceof LiteratureStorageError && error.code === 'record_limit_reached';
    }
    invariant(importLimitRejected, 'literature_import_capacity_was_not_typed');
    invariant(
      database.countLiteratureRecords(capacityProjectId) ===
        LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT - 1,
      'literature_import_capacity_was_not_atomic',
    );
    database.upsertLiteratureCandidates(
      capacityProjectId,
      [capacityCandidate(30_000)],
      fixedTimestamp,
    );
    invariant(
      database.listLiteratureRecords(capacityProjectId).length ===
        LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT,
      'literature_record_list_was_silently_truncated',
    );
  } finally {
    database.close();
  }
}

function verifyLiteratureRelevanceMigration(rootUserData: string, fixedTimestamp: string) {
  const primaryUserData = app.getPath('userData');
  const legacyUserData = join(rootUserData, 'legacy-literature-relevance-v1');
  mkdirSync(legacyUserData, { recursive: true });
  app.setPath('userData', legacyUserData);
  try {
    const projectId = randomUUID();
    const legacySearchRunId = randomUUID();
    const bootstrap = new LocalDatabase();
    bootstrap.open();
    bootstrap.upsertLiteratureCandidates(
      projectId,
      [
        {
          provider: 'import',
          fingerprint: literatureFingerprint('Relevance migration', ['Migration Author'], 2026),
          title: 'Relevance migration',
          authors: ['Migration Author'],
          publishedYear: 2026,
          topics: [],
          manualAnnotations: {
            topics: [],
            summary: '',
            relevance: 'n'.repeat(4_000),
          },
        },
      ],
      fixedTimestamp,
    );
    const inserted = bootstrap.listLiteratureRecords(projectId)[0]!;
    invariant(
      inserted.manualAnnotations.relevance.length === 4_000,
      'new_literature_relevance_limit_was_not_applied',
    );
    const legacyValue = 'Preserved legacy relevance';
    const legacyRecord = bootstrap.updateLiteratureManualAnnotations({
      projectId,
      recordId: inserted.id,
      expectedVersion: inserted.version,
      expectedAnnotationVersion: inserted.annotationVersion,
      manualTopics: [],
      manualSummary: '',
      manualRelevance: legacyValue,
      reviewStatus: inserted.reviewStatus,
      updatedAt: fixedTimestamp,
    });
    invariant(legacyRecord !== null, 'legacy_literature_relevance_fixture_failed');
    bootstrap.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(legacyUserData, 'local-key.bin')))
      .trim();
    const raw = new Database(join(legacyUserData, 'gosu.db'));
    try {
      raw.pragma(`key="x'${keyHex}'"`);
      raw.transaction(() => {
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-manual-relevance-v2');
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-weak-fingerprint-v1');
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-balanced-discovery-v1');
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('literature-discovery-coverage-v1');
        raw.exec(`
          drop index literature_record_weak_fingerprint_identity;
          drop index literature_records_by_fingerprint;
          create unique index literature_record_fingerprint_identity
            on literature_records(project_id,fingerprint);
          alter table literature_records drop column current_discovery_json;
          alter table literature_search_runs drop column policy_id;
          alter table literature_search_runs drop column policy_version;
          alter table literature_search_runs drop column retrieved_count;
          alter table literature_search_runs drop column selected_count;
          alter table literature_search_runs drop column core_count;
          alter table literature_search_runs drop column rising_count;
          alter table literature_search_runs drop column broad_count;
          alter table literature_search_runs drop column discovery_coverage_json;
          alter table literature_search_hits drop column discovery_tier;
          alter table literature_search_hits drop column tier_rank;
          alter table literature_search_hits drop column overall_score;
          alter table literature_search_hits drop column ranking_signals_json;
          drop table literature_search_conflicts;
          create table literature_search_conflicts (
            search_run_id text not null references literature_search_runs(id) on delete cascade,
            ordinal integer not null check (ordinal between 1 and 50),
            provider text not null check (provider='crossref'),
            provider_record_id text check (
              provider_record_id is null or length(provider_record_id) between 1 and 2048
            ),
            doi text check (doi is null or length(doi) between 1 and 512),
            fingerprint text not null check (length(fingerprint)=64),
            title text not null check (length(title) between 1 and 2000),
            authors_json text not null check (length(authors_json) <= 32768),
            published_year integer check (
              published_year is null or published_year between 1000 and 3000
            ),
            primary key(search_run_id,ordinal)
          );
          alter table literature_search_runs drop column conflict_count;
          alter table literature_records rename column manual_relevance to manual_relevance_v2;
          alter table literature_records add column manual_relevance text check (
            manual_relevance is null or length(manual_relevance) between 1 and 64
          );
          update literature_records set manual_relevance=manual_relevance_v2;
          alter table literature_records drop column manual_relevance_v2;
        `);
        raw
          .prepare(
            `insert into literature_search_runs(
               id,schema_version,project_id,provider,query,requested_limit,from_year,to_year,status,
               new_count,updated_count,unchanged_count,created_at,completed_at
             ) values(?,1,?,'crossref',?,25,null,null,'complete',1,0,0,?,?)`,
          )
          .run(
            legacySearchRunId,
            projectId,
            'legacy completed discovery',
            fixedTimestamp,
            fixedTimestamp,
          );
      })();
    } finally {
      raw.close();
    }

    const migrated = new LocalDatabase();
    migrated.open();
    const preserved = migrated.listLiteratureRecords(projectId)[0]!;
    invariant(
      preserved.manualAnnotations.relevance === legacyValue,
      'legacy_literature_relevance_was_not_preserved',
    );
    const expandedValue = 'r'.repeat(4_000);
    const expanded = migrated.updateLiteratureManualAnnotations({
      projectId,
      recordId: preserved.id,
      expectedVersion: preserved.version,
      expectedAnnotationVersion: preserved.annotationVersion,
      manualTopics: [],
      manualSummary: '',
      manualRelevance: expandedValue,
      reviewStatus: preserved.reviewStatus,
      updatedAt: fixedTimestamp,
    });
    invariant(
      expanded?.manualAnnotations.relevance === expandedValue,
      'migrated_literature_relevance_limit_was_not_applied',
    );
    const migratedLegacyRun = migrated
      .listLiteratureSearchRuns(projectId)
      .find(({ id }) => id === legacySearchRunId);
    invariant(
      migratedLegacyRun?.retrievedCount === 1 &&
        migratedLegacyRun.selectedCount === 1 &&
        migratedLegacyRun.tierCounts === undefined,
      'legacy_literature_search_counts_were_not_backfilled_safely',
    );
    migrated.close();

    const inspected = new Database(join(legacyUserData, 'gosu.db'));
    try {
      inspected.pragma(`key="x'${keyHex}'"`);
      const columns = inspected.pragma('table_info(literature_records)') as Array<{ name: string }>;
      const searchColumns = inspected.pragma('table_info(literature_search_runs)') as Array<{
        name: string;
      }>;
      const hitColumns = inspected.pragma('table_info(literature_search_hits)') as Array<{
        name: string;
      }>;
      const indexes = inspected.pragma('index_list(literature_records)') as Array<{
        name: string;
        unique: number;
      }>;
      const table = inspected
        .prepare("select sql from sqlite_master where type='table' and name='literature_records'")
        .get() as { sql: string };
      const conflictTable = inspected
        .prepare(
          "select sql from sqlite_master where type='table' and name='literature_search_conflicts'",
        )
        .get() as { sql: string };
      invariant(
        columns
          .filter((column) => column.name.includes('manual_relevance'))
          .every((column) => column.name === 'manual_relevance') &&
          columns.filter((column) => column.name === 'manual_relevance').length === 1,
        'literature_relevance_migration_left_a_duplicate_column',
      );
      invariant(
        /\bmanual_relevance\s+text\s+check\s*\(\s*manual_relevance\s+is\s+null\s+or\s+length\s*\(\s*manual_relevance\s*\)\s+between\s+1\s+and\s+4000\s*\)/iu.test(
          table.sql,
        ),
        'literature_relevance_migration_schema_is_not_4000',
      );
      invariant(
        searchColumns.some((column) => column.name === 'conflict_count'),
        'literature_search_conflict_count_was_not_migrated',
      );
      invariant(
        columns.some((column) => column.name === 'current_discovery_json') &&
          [
            'policy_id',
            'policy_version',
            'retrieved_count',
            'selected_count',
            'core_count',
            'rising_count',
            'broad_count',
            'discovery_coverage_json',
          ].every((name) => searchColumns.some((column) => column.name === name)) &&
          ['discovery_tier', 'tier_rank', 'overall_score', 'ranking_signals_json'].every((name) =>
            hitColumns.some((column) => column.name === name),
          ) &&
          /provider\s+text\s+not\s+null\s+check/iu.test(conflictTable.sql) &&
          conflictTable.sql.includes("'semantic-scholar'"),
        'literature_discovery_schema_was_not_migrated',
      );
      invariant(
        !indexes.some((index) => index.name === 'literature_record_fingerprint_identity') &&
          indexes.some(
            (index) =>
              index.name === 'literature_record_weak_fingerprint_identity' && index.unique === 1,
          ) &&
          indexes.some(
            (index) => index.name === 'literature_records_by_fingerprint' && index.unique === 0,
          ),
        'literature_fingerprint_identity_index_was_not_migrated',
      );
    } finally {
      inspected.close();
    }

    const reopened = new LocalDatabase();
    reopened.open();
    invariant(
      reopened.listLiteratureRecords(projectId)[0]?.manualAnnotations.relevance === expandedValue,
      'migrated_literature_relevance_was_not_durable',
    );
    reopened.close();
  } finally {
    app.setPath('userData', primaryUserData);
  }
}

function verifyLegacyChatMigration(rootUserData: string, fixedTimestamp: string) {
  const primaryUserData = app.getPath('userData');
  const legacyUserData = join(rootUserData, 'legacy-chat-v030');
  mkdirSync(legacyUserData, { recursive: true });
  app.setPath('userData', legacyUserData);
  try {
    const bootstrap = new LocalDatabase();
    bootstrap.open();
    bootstrap.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(legacyUserData, 'local-key.bin')))
      .trim();
    const legacyUserId = randomUUID();
    const legacyAssistantId = randomUUID();
    const legacyProjectId = randomUUID();
    const raw = new Database(join(legacyUserData, 'gosu.db'));
    try {
      raw.pragma(`key="x'${keyHex}'"`);
      raw.pragma('foreign_keys=OFF');
      raw.transaction(() => {
        raw
          .prepare('delete from local_schema_migrations where id=?')
          .run('project-chat-sessions-v1');
        raw.exec(`
          drop table project_chat_actions;
          drop table project_chat_attempts;
          drop table project_chat_messages;
          create table project_chat_messages (
            id text primary key,
            project_id text not null,
            role text not null check (role in ('user','assistant')),
            content text not null check (length(content) between 1 and 32000),
            status text not null check (status in ('complete','failed','interrupted')),
            turn_id text check (turn_id is null or length(turn_id) between 1 and 256),
            model_json text check (model_json is null or length(model_json) <= 4096),
            created_at text not null,
            completed_at text not null
          );
          create index project_chat_messages_by_project
            on project_chat_messages(project_id,created_at,id);
          create table project_chat_actions (
            id text primary key,
            message_id text not null references project_chat_messages(id) on delete cascade,
            project_id text not null,
            command_json text not null check (length(command_json) <= 4096),
            status text not null check (status in ('proposed','applying','applied','failed')),
            result_entity_id text,
            result_entity_version integer,
            error_code text,
            created_at text not null,
            updated_at text not null
          );
          create index project_chat_actions_by_message
            on project_chat_actions(message_id,created_at,id);
        `);
        const insertLegacyMessage = raw.prepare(
          `insert into project_chat_messages(
             id,project_id,role,content,status,turn_id,model_json,created_at,completed_at
           ) values(?,?,?,?,?,?,?,?,?)`,
        );
        insertLegacyMessage.run(
          legacyUserId,
          legacyProjectId,
          'user',
          'Legacy failed request',
          'complete',
          null,
          null,
          fixedTimestamp,
          fixedTimestamp,
        );
        insertLegacyMessage.run(
          legacyAssistantId,
          legacyProjectId,
          'assistant',
          'Legacy Codex failure',
          'failed',
          null,
          null,
          fixedTimestamp,
          fixedTimestamp,
        );
      })();
    } finally {
      raw.close();
    }

    const migrated = new LocalDatabase();
    migrated.open();
    const migratedSnapshot = migrated.snapshot(legacyProjectId);
    invariant(migratedSnapshot.messages.length === 2, 'legacy_chat_messages_were_not_preserved');
    invariant(
      migratedSnapshot.session?.isDefault === true && migratedSnapshot.sessions?.length === 1,
      'legacy_chat_default_session_was_not_created_once',
    );
    invariant(
      migrated.snapshot(legacyProjectId).session?.id === migratedSnapshot.session?.id,
      'legacy_chat_default_session_was_not_idempotent',
    );
    invariant(
      migratedSnapshot.messages.every((message) => message.attemptId === undefined),
      'legacy_chat_messages_received_false_attempt_lineage',
    );
    invariant(migratedSnapshot.attempts?.length === 0, 'legacy_chat_created_false_attempts');
    const durableAttemptId = randomUUID();
    const durableUserMessageId = randomUUID();
    migrated.beginChatAttempt(
      {
        id: durableAttemptId,
        projectId: legacyProjectId,
        userMessageId: durableUserMessageId,
        requestedModelId: null,
        reasoningOptionId: null,
        status: 'starting',
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      },
      {
        id: durableUserMessageId,
        projectId: legacyProjectId,
        role: 'user',
        content: 'First durable request after migration',
        status: 'complete',
        actions: [],
        createdAt: fixedTimestamp,
        completedAt: fixedTimestamp,
      },
    );
    migrated.close();

    const reopened = new LocalDatabase();
    reopened.open();
    invariant(
      reopened.snapshot(legacyProjectId).session?.id === migratedSnapshot.session?.id,
      'legacy_chat_default_session_changed_after_restart',
    );
    const reconciled = reopened.getChatAttempt(legacyProjectId, durableAttemptId);
    invariant(
      reconciled?.status === 'interrupted' &&
        reconciled.errorCode === 'application_interrupted' &&
        reconciled.collaborationModeId === undefined &&
        reconciled.personality === undefined &&
        reconciled.responseVerbosity === undefined,
      'migrated_chat_did_not_support_durable_attempt_reconciliation',
    );
    reopened.close();
  } finally {
    app.setPath('userData', primaryUserData);
  }
}

function verifyLegacySshMigration(rootUserData: string, fixedTimestamp: string) {
  const primaryUserData = app.getPath('userData');
  const legacyUserData = join(rootUserData, 'legacy-ssh-v010');
  mkdirSync(legacyUserData, { recursive: true });
  app.setPath('userData', legacyUserData);
  try {
    const bootstrap = new LocalDatabase();
    bootstrap.open();
    bootstrap.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(legacyUserData, 'local-key.bin')))
      .trim();
    const legacyConnectionId = randomUUID();
    const raw = new Database(join(legacyUserData, 'gosu.db'));
    try {
      raw.pragma(`key="x'${keyHex}'"`);
      raw.pragma('foreign_keys=OFF');
      raw.transaction(() => {
        raw.exec(`
          drop table ssh_workspace_grants;
          drop table ssh_connections;
          create table ssh_connections (
            id text primary key check (length(id) = 36),
            schema_version integer not null check (schema_version = 1),
            label text not null check (length(label) between 1 and 120),
            host_alias text not null check (length(host_alias) between 1 and 255),
            version integer not null check (version > 0),
            created_at text not null,
            updated_at text not null
          );
          create index ssh_connections_by_label on ssh_connections(label,id);
        `);
        raw
          .prepare(
            `insert into ssh_connections(
               id,schema_version,label,host_alias,version,created_at,updated_at
             ) values(?,?,?,?,?,?,?)`,
          )
          .run(
            legacyConnectionId,
            1,
            'Legacy alias',
            'legacy-research-gpu',
            1,
            fixedTimestamp,
            fixedTimestamp,
          );
      })();
    } finally {
      raw.close();
    }

    const migrated = new LocalDatabase();
    migrated.open();
    const legacy = migrated
      .listSshConnections()
      .find((connection) => connection.id === legacyConnectionId);
    invariant(
      legacy?.hostAlias === 'legacy-research-gpu' && legacy.directTarget === null,
      'legacy_ssh_alias_migration_failed',
    );
    invariant(
      migrated.listSshWorkspaceGrants(randomUUID()).length === 0,
      'legacy_ssh_workspace_table_missing',
    );

    const directConnectionId = randomUUID();
    const projectId = randomUUID();
    const grantId = randomUUID();
    invariant(
      migrated.createSshConnection({
        schemaVersion: 1,
        id: directConnectionId,
        label: 'Imported SSH server',
        hostAlias: 'direct-203.0.113.20-2222',
        directTarget: {
          host: '203.0.113.20',
          user: 'researcher',
          port: 2222,
          localForwards: [],
        },
        version: 1,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      }),
      'migrated_ssh_direct_profile_create_failed',
    );
    invariant(
      migrated.createSshWorkspaceGrant({
        schemaVersion: 1,
        id: grantId,
        projectId,
        connectionId: directConnectionId,
        canonicalRoot: '/workspace/research-project',
        permissionMode: 'diagnostics',
        version: 1,
        createdAt: fixedTimestamp,
        updatedAt: fixedTimestamp,
      }),
      'migrated_ssh_workspace_grant_create_failed',
    );
    migrated.close();

    const reopened = new LocalDatabase();
    reopened.open();
    invariant(
      reopened.listSshConnections().some((connection) => connection.id === legacyConnectionId) &&
        reopened.listSshConnections().some((connection) => connection.id === directConnectionId),
      'migrated_ssh_profiles_were_not_durable',
    );
    invariant(
      reopened.listSshWorkspaceGrants(projectId)[0]?.id === grantId,
      'migrated_ssh_workspace_grant_was_not_durable',
    );
    reopened.close();
  } finally {
    app.setPath('userData', primaryUserData);
  }
}

function verifyLegacyProfileMigration(rootUserData: string, fixedTimestamp: string) {
  const primaryUserData = app.getPath('userData');
  const legacyUserData = join(rootUserData, 'legacy-profile-v050');
  mkdirSync(legacyUserData, { recursive: true });
  app.setPath('userData', legacyUserData);
  try {
    const bootstrap = new LocalDatabase();
    bootstrap.open();
    bootstrap.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(legacyUserData, 'local-key.bin')))
      .trim();
    const projectId = randomUUID();
    const revisionId = randomUUID();
    const contextProjectId = randomUUID();
    const contextRevisionId = randomUUID();
    const reviewerProjectId = randomUUID();
    const reviewerRevisionId = randomUUID();
    const raw = new Database(join(legacyUserData, 'gosu.db'));
    try {
      raw.pragma(`key="x'${keyHex}'"`);
      raw.pragma('foreign_keys=OFF');
      raw.transaction(() => {
        raw.exec(`
          drop table project_chat_profiles;
          create table project_chat_profiles (
            project_id text primary key,
            version integer not null check (version > 0),
            harness_mode text not null check (harness_mode in ('context','planner','reviewer')),
            response_depth text not null check (response_depth in ('concise','standard','deep')),
            context_scope text not null check (context_scope in ('project','board','objective')),
            instruction_revision_id text not null
              references project_chat_instruction_revisions(id),
            created_at text not null,
            updated_at text not null
          );
        `);
        raw
          .prepare(
            `insert into project_chat_instruction_revisions(
             id,project_id,revision,content,content_sha256,created_at
           ) values(?,?,?,?,?,?)`,
          )
          .run(
            revisionId,
            projectId,
            1,
            'Legacy profile instructions.',
            'd'.repeat(64),
            fixedTimestamp,
          );
        const insertLegacyRevision = raw.prepare(
          `insert into project_chat_instruction_revisions(
             id,project_id,revision,content,content_sha256,created_at
           ) values(?,?,?,?,?,?)`,
        );
        insertLegacyRevision.run(
          contextRevisionId,
          contextProjectId,
          1,
          '',
          'e'.repeat(64),
          fixedTimestamp,
        );
        insertLegacyRevision.run(
          reviewerRevisionId,
          reviewerProjectId,
          1,
          '',
          'f'.repeat(64),
          fixedTimestamp,
        );
        const insertLegacyProfile = raw.prepare(
          `insert into project_chat_profiles(
             project_id,version,harness_mode,response_depth,context_scope,
             instruction_revision_id,created_at,updated_at
           ) values(?,?,?,?,?,?,?,?)`,
        );
        insertLegacyProfile.run(
          projectId,
          1,
          'planner',
          'deep',
          'board',
          revisionId,
          fixedTimestamp,
          fixedTimestamp,
        );
        insertLegacyProfile.run(
          contextProjectId,
          1,
          'context',
          'standard',
          'project',
          contextRevisionId,
          fixedTimestamp,
          fixedTimestamp,
        );
        insertLegacyProfile.run(
          reviewerProjectId,
          1,
          'reviewer',
          'concise',
          'objective',
          reviewerRevisionId,
          fixedTimestamp,
          fixedTimestamp,
        );
      })();
    } finally {
      raw.close();
    }

    const migrated = new LocalDatabase();
    migrated.open();
    const legacyProfile = migrated.getProjectChatProfile(projectId);
    invariant(
      legacyProfile.version === 1 &&
        legacyProfile.collaborationModeId === 'plan' &&
        legacyProfile.personality === 'auto' &&
        legacyProfile.responseVerbosity === 'high' &&
        legacyProfile.webSearchMode === 'cached' &&
        legacyProfile.localNotesVault === null &&
        legacyProfile.customInstructions === 'Legacy profile instructions.',
      'legacy_profile_v050_migration_failed',
    );
    invariant(
      migrated.getProjectChatProfile(contextProjectId).collaborationModeId === 'default' &&
        migrated.getProjectChatProfile(contextProjectId).responseVerbosity === 'medium' &&
        migrated.getProjectChatProfile(reviewerProjectId).collaborationModeId === 'default' &&
        migrated.getProjectChatProfile(reviewerProjectId).responseVerbosity === 'low',
      'legacy_profile_v050_native_mode_mapping_failed',
    );
    const updated = migrated.updateProjectChatProfile({
      projectId,
      expectedVersion: 1,
      harnessMode: 'planner',
      responseDepth: 'deep',
      collaborationModeId: 'research-orchestrator-v2',
      personality: 'friendly',
      responseVerbosity: 'low',
      webSearchMode: 'live',
      contextScope: 'board',
      localNotesVault: { id: 'f'.repeat(64), name: 'Migrated Vault' },
      customInstructions: 'Legacy profile instructions.',
    });
    invariant(
      updated?.version === 2 &&
        updated.collaborationModeId === 'research-orchestrator-v2' &&
        updated.personality === 'friendly' &&
        updated.responseVerbosity === 'low' &&
        updated.webSearchMode === 'live' &&
        updated.localNotesVault?.id === 'f'.repeat(64),
      'legacy_profile_v050_grant_update_failed',
    );
    migrated.close();
  } finally {
    app.setPath('userData', primaryUserData);
  }
}

const temporaryUserData = mkdtempSync(join(tmpdir(), 'gosu-local-db-smoke-'));
app.setPath('userData', temporaryUserData);

void app.whenReady().then(async () => {
  const operationId = randomUUID();
  const secondOperationId = randomUUID();
  const fixedTimestamp = new Date().toISOString();
  try {
    const first = fixture(1, operationId, fixedTimestamp);
    const second = fixture(2, secondOperationId, fixedTimestamp);
    const database = new LocalDatabase();
    database.open();
    database.commitWorkspaceState(first.state, first.operation);
    database.commitWorkspaceState(second.state, second.operation);
    const chatMessageId = randomUUID();
    const chatActionId = randomUUID();
    const chatProjectId = second.state.projects[0]!.id;
    invariant(
      database.getProjectChatProfile(chatProjectId).version === 0 &&
        database.getProjectChatProfile(chatProjectId).collaborationModeId === null &&
        database.getProjectChatProfile(chatProjectId).responseVerbosity === 'auto' &&
        database.getProjectChatProfile(chatProjectId).webSearchMode === 'cached',
      'default_chat_profile_missing',
    );
    const chatProfile = database.updateProjectChatProfile({
      projectId: chatProjectId,
      expectedVersion: 0,
      harnessMode: 'planner',
      responseDepth: 'deep',
      collaborationModeId: 'research-orchestrator-v2',
      personality: 'pragmatic',
      responseVerbosity: 'high',
      webSearchMode: 'live',
      contextScope: 'board',
      localNotesVault: { id: 'a'.repeat(64), name: 'Fixture Vault' },
      customInstructions: 'Prefer reproducible experiments.',
    });
    invariant(chatProfile?.version === 1, 'chat_profile_initial_update_failed');
    invariant(
      chatProfile.collaborationModeId === 'research-orchestrator-v2' &&
        chatProfile.personality === 'pragmatic' &&
        chatProfile.responseVerbosity === 'high' &&
        chatProfile.webSearchMode === 'live',
      'chat_profile_native_settings_missing',
    );
    invariant(
      chatProfile.localNotesVault?.id === 'a'.repeat(64) &&
        chatProfile.localNotesVault.name === 'Fixture Vault',
      'chat_profile_local_notes_grant_missing',
    );
    invariant(
      database.updateProjectChatProfile({
        projectId: chatProjectId,
        expectedVersion: 0,
        harnessMode: 'reviewer',
        responseDepth: 'concise',
        contextScope: 'objective',
        localNotesVault: null,
        customInstructions: '',
      }) === null,
      'stale_chat_profile_update_was_accepted',
    );
    const chatMessage: ProjectChatMessage = {
      id: chatMessageId,
      projectId: chatProjectId,
      role: 'assistant',
      content: 'Create the reproduction task after review.',
      status: 'complete',
      actions: [
        {
          id: chatActionId,
          projectId: chatProjectId,
          messageId: chatMessageId,
          command: { type: 'task.create', title: 'Reproduce baseline', status: 'planned' },
          status: 'proposed',
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
        },
      ],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    };
    database.saveMessage(chatMessage);
    const defaultChatSession = database.ensureDefaultProjectChatSession(chatProjectId);
    invariant(
      database.ensureDefaultProjectChatSession(chatProjectId).id === defaultChatSession.id &&
        database.listProjectChatSessions(chatProjectId).filter((session) => session.isDefault)
          .length === 1,
      'default_chat_session_was_not_idempotent',
    );
    invariant(
      database.renameProjectChatSession(
        chatProjectId,
        defaultChatSession.id,
        'Primary research chat',
      )?.isDefault === true,
      'default_chat_session_marker_changed_during_rename',
    );
    const independentChatSession = database.createProjectChatSession(chatProjectId);
    invariant(
      database.snapshot(chatProjectId, independentChatSession.id).messages.length === 0,
      'new_root_chat_inherited_default_history',
    );

    const interruptedAttemptId = randomUUID();
    const interruptedUserMessageId = randomUUID();
    const interruptedAttempt: ProjectChatAttempt = {
      id: interruptedAttemptId,
      projectId: chatProjectId,
      sessionId: defaultChatSession.id,
      userMessageId: interruptedUserMessageId,
      requestedModelId: null,
      reasoningOptionId: null,
      status: 'starting',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    database.beginChatAttempt(interruptedAttempt, {
      id: interruptedUserMessageId,
      projectId: chatProjectId,
      role: 'user',
      content: 'Leave this turn running across a restart.',
      status: 'complete',
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    });
    const interruptedRunning: ProjectChatAttempt = {
      ...interruptedAttempt,
      threadId: 'thread-interrupted-fixture',
      turnId: 'turn-interrupted-fixture',
      model: {
        invocationId: randomUUID(),
        requestedModelId: null,
        resolvedModelId: 'fixture-model',
        catalogVersion: 'fixture-catalog',
        reasoningOptionId: null,
      },
      status: 'running',
    };
    database.markChatAttemptRunning(interruptedRunning);

    const completedAttemptId = randomUUID();
    const completedUserMessageId = randomUUID();
    const completedAttempt: ProjectChatAttempt = {
      id: completedAttemptId,
      projectId: chatProjectId,
      sessionId: defaultChatSession.id,
      userMessageId: completedUserMessageId,
      requestedModelId: 'fixture-model',
      reasoningOptionId: 'high',
      harnessMode: 'planner',
      responseDepth: 'deep',
      collaborationModeId: 'research-orchestrator-v2',
      personality: 'pragmatic',
      responseVerbosity: 'high',
      webSearchMode: 'live',
      contextScope: 'board',
      profileVersion: chatProfile.version,
      instructionRevisionId: chatProfile.instructionRevision?.id ?? null,
      promptProvenance: {
        schemaVersion: 1,
        assemblyVersion: 1,
        baseInstructionId: 'gosu.project-chat.base',
        baseInstructionVersion: 1,
        baseInstructionsSha256: 'a'.repeat(64),
        harnessInstructionId: 'gosu.project-chat.harness.planner',
        harnessInstructionVersion: 1,
        harnessInstructionsSha256: 'b'.repeat(64),
        customInstructionsSha256: 'c'.repeat(64),
        developerInstructionsSha256: 'd'.repeat(64),
        promptSha256: 'e'.repeat(64),
        projectContextSha256: 'f'.repeat(64),
        visibleHistorySha256: '0'.repeat(64),
        userMessageSha256: '1'.repeat(64),
        profileVersion: chatProfile.version,
        instructionRevisionId: chatProfile.instructionRevision?.id ?? null,
        workspaceRevision: second.state.revision,
        developerInstructionsCharacters: 700,
        promptCharacters: 1_200,
        contextTruncated: false,
        historyTruncated: false,
      },
      status: 'starting',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    database.beginChatAttempt(completedAttempt, {
      id: completedUserMessageId,
      projectId: chatProjectId,
      role: 'user',
      content: 'Complete this durable attempt.',
      status: 'complete',
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    });
    const completedRunning: ProjectChatAttempt = {
      ...completedAttempt,
      threadId: 'thread-completed-fixture',
      turnId: 'turn-completed-fixture',
      model: {
        invocationId: randomUUID(),
        requestedModelId: 'fixture-model',
        resolvedModelId: 'fixture-model',
        catalogVersion: 'fixture-catalog',
        reasoningOptionId: 'high',
      },
      status: 'running',
    };
    database.markChatAttemptRunning(completedRunning);
    const completedAssistantMessageId = randomUUID();
    database.finishChatAttempt(
      { ...completedRunning, status: 'complete' },
      {
        id: completedAssistantMessageId,
        projectId: chatProjectId,
        role: 'assistant',
        content: 'This attempt completed durably.',
        status: 'complete',
        actions: [],
        createdAt: fixedTimestamp,
        completedAt: fixedTimestamp,
      },
    );
    const modalityAttemptId = randomUUID();
    const modalityUserMessageId = randomUUID();
    const modalityAttempt: ProjectChatAttempt = {
      id: modalityAttemptId,
      projectId: chatProjectId,
      sessionId: defaultChatSession.id,
      userMessageId: modalityUserMessageId,
      requestedModelId: 'text-only-model',
      reasoningOptionId: null,
      status: 'starting',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    database.beginChatAttempt(modalityAttempt, {
      id: modalityUserMessageId,
      projectId: chatProjectId,
      role: 'user',
      content: 'Analyze an image with a text-only model.',
      status: 'complete',
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    });
    database.finishChatAttempt(
      {
        ...modalityAttempt,
        status: 'failed',
        errorCode: 'attachment_model_modality_unsupported',
      },
      {
        id: randomUUID(),
        projectId: chatProjectId,
        role: 'assistant',
        content: 'The selected model cannot accept image attachments.',
        status: 'failed',
        actions: [],
        createdAt: fixedTimestamp,
        completedAt: fixedTimestamp,
      },
    );
    const sshConnectionId = randomUUID();
    const sshProfile = {
      schemaVersion: 1 as const,
      id: sshConnectionId,
      label: 'Fixture GPU',
      hostAlias: 'fixture-gpu',
      directTarget: {
        host: '203.0.113.10',
        user: 'researcher',
        port: 2222,
        localForwards: [
          {
            bindAddress: '127.0.0.1' as const,
            localPort: 8080,
            destinationHost: 'localhost' as const,
            destinationPort: 8080,
          },
        ],
      },
      version: 1,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    invariant(database.createSshConnection(sshProfile), 'ssh_profile_create_failed');
    invariant(!database.createSshConnection(sshProfile), 'ssh_profile_duplicate_was_accepted');
    const updatedSshProfile = {
      ...sshProfile,
      label: 'Fixture GPU 2',
      hostAlias: 'fixture-gpu-2',
      version: 2,
    };
    invariant(
      !database.updateSshConnection({ ...updatedSshProfile, version: 3 }, 2),
      'ssh_profile_stale_version_was_accepted',
    );
    invariant(database.updateSshConnection(updatedSshProfile, 1), 'ssh_profile_update_failed');
    const sshWorkspaceGrantId = randomUUID();
    const sshWorkspaceGrant = {
      schemaVersion: 1 as const,
      id: sshWorkspaceGrantId,
      projectId: chatProjectId,
      connectionId: sshConnectionId,
      canonicalRoot: '/workspace',
      permissionMode: 'diagnostics' as const,
      version: 1,
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    invariant(
      database.createSshWorkspaceGrant(sshWorkspaceGrant),
      'ssh_workspace_grant_create_failed',
    );
    invariant(
      !database.createSshWorkspaceGrant(sshWorkspaceGrant),
      'ssh_workspace_grant_duplicate_was_accepted',
    );
    const updatedSshWorkspaceGrant = {
      ...sshWorkspaceGrant,
      canonicalRoot: '/workspace/research-project',
      permissionMode: 'workspace' as const,
      version: 2,
    };
    invariant(
      !database.updateSshWorkspaceGrant({ ...updatedSshWorkspaceGrant, version: 3 }, 2),
      'ssh_workspace_grant_stale_version_was_accepted',
    );
    invariant(
      database.updateSshWorkspaceGrant(updatedSshWorkspaceGrant, 1),
      'ssh_workspace_grant_update_failed',
    );
    database.close();

    const branchLimitProjectId = randomUUID();
    const branchLimitSessionId = randomUUID();
    let branchLimitMessageId = '';
    const keyHex = safeStorage
      .decryptString(readFileSync(join(temporaryUserData, 'local-key.bin')))
      .trim();
    const legacyDatabase = new Database(join(temporaryUserData, 'gosu.db'));
    legacyDatabase.pragma(`key="x'${keyHex}'"`);
    let defaultMarkerMutationRejected = false;
    try {
      legacyDatabase
        .prepare('update project_chat_sessions set is_default=0 where id=?')
        .run(defaultChatSession.id);
    } catch (error) {
      defaultMarkerMutationRejected =
        error instanceof Error && error.message.includes('chat_default_session_immutable');
    }
    invariant(defaultMarkerMutationRejected, 'default_chat_session_marker_was_mutable');
    legacyDatabase.transaction(() => {
      legacyDatabase
        .prepare(
          `insert into project_chat_sessions(
             id,project_id,title,is_default,parent_session_id,branched_from_message_id,
             created_at,updated_at
           ) values(?,?,?,1,null,null,?,?)`,
        )
        .run(
          branchLimitSessionId,
          branchLimitProjectId,
          'Branch limit fixture',
          fixedTimestamp,
          fixedTimestamp,
        );
      legacyDatabase.exec(`
        with digits(value) as (
          values(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)
        ), sequence(value) as (
          select ones.value+10*tens.value+100*hundreds.value+1000*thousands.value+1
          from digits ones cross join digits tens cross join digits hundreds cross join digits thousands
          where ones.value+10*tens.value+100*hundreds.value+1000*thousands.value
                <${PROJECT_CHAT_MAX_BRANCH_MESSAGES + 1}
        )
        insert into project_chat_messages(
          id,project_id,role,content,status,attempt_id,turn_id,model_json,created_at,completed_at
        )
        select printf('%08x-0000-4000-8000-%012x',value,value),
               '${branchLimitProjectId}','assistant','Branch limit message','complete',
               null,null,null,'${fixedTimestamp}','${fixedTimestamp}'
        from sequence;
        with digits(value) as (
          values(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)
        ), sequence(value) as (
          select ones.value+10*tens.value+100*hundreds.value+1000*thousands.value+1
          from digits ones cross join digits tens cross join digits hundreds cross join digits thousands
          where ones.value+10*tens.value+100*hundreds.value+1000*thousands.value
                <${PROJECT_CHAT_MAX_BRANCH_MESSAGES + 1}
        )
        insert into project_chat_session_messages(session_id,message_id,ordinal)
        select '${branchLimitSessionId}',
               printf('%08x-0000-4000-8000-%012x',value,value),value
        from sequence;
      `);
      branchLimitMessageId = (
        legacyDatabase
          .prepare(
            `select message_id from project_chat_session_messages
             where session_id=? order by ordinal desc limit 1`,
          )
          .get(branchLimitSessionId) as { message_id: string }
      ).message_id;
    })();
    const sshColumns = (
      legacyDatabase.pragma('table_info(ssh_connections)') as Array<{ name: string }>
    ).map((column) => column.name);
    invariant(
      sshColumns.join(',') ===
        'id,schema_version,label,host_alias,direct_target_json,version,created_at,updated_at',
      'ssh_profile_table_contains_unexpected_data',
    );
    const legacyRows = legacyDatabase
      .prepare(
        `select id,scope,operation_json,base_version,created_at,delivered_at
         from sync_outbox where scope like 'workspace:%' order by rowid asc`,
      )
      .all() as Array<{
      id: string;
      scope: string;
      operation_json: string;
      base_version: number | null;
      created_at: string;
      delivered_at: string | null;
    }>;
    legacyDatabase.transaction(() => {
      legacyDatabase.exec(`
        create table sync_outbox_v01 (
          id text primary key,
          scope text not null,
          operation_json text not null,
          base_version integer,
          created_at text not null,
          delivered_at text
        )
      `);
      const insertLegacy = legacyDatabase.prepare(
        `insert into sync_outbox_v01(
           id,scope,operation_json,base_version,created_at,delivered_at
         ) values(?,?,?,?,?,?)`,
      );
      for (const row of legacyRows) {
        const operation = JSON.parse(row.operation_json) as Record<string, unknown>;
        delete operation.workspaceRevision;
        insertLegacy.run(
          row.id,
          row.scope,
          JSON.stringify(operation),
          row.base_version,
          row.created_at,
          row.delivered_at,
        );
      }
      legacyDatabase.exec(`
        drop table sync_outbox;
        alter table sync_outbox_v01 rename to sync_outbox;
        drop table local_workspace_outbox_status;
      `);
    })();
    legacyDatabase.close();

    const encryptedHeader = readFileSync(join(temporaryUserData, 'gosu.db')).subarray(0, 16);
    invariant(
      encryptedHeader.toString('utf8') !== 'SQLite format 3\0',
      'workspace_database_was_not_encrypted',
    );

    const legacyReopened = new LocalDatabase();
    legacyReopened.open();
    invariant(
      legacyReopened.loadWorkspaceState()?.revision === 2,
      'legacy_workspace_restart_restore_failed',
    );
    invariant(
      legacyReopened
        .pendingWorkspaceChanges()
        .every((operation, index) => operation.workspaceRevision === index + 1),
      'outbox_sequence_restore_failed',
    );
    invariant(
      legacyReopened.pendingWorkspaceSummary().count === 2,
      'legacy_outbox_summary_restore_failed',
    );
    invariant(
      legacyReopened.pendingWorkspaceSummary().latestWorkspaceRevision === 2,
      'legacy_outbox_summary_revision_failed',
    );
    const restoredSshProfile = legacyReopened
      .listSshConnections()
      .find((profile) => profile.id === sshConnectionId);
    invariant(
      restoredSshProfile?.directTarget?.host === '203.0.113.10' &&
        restoredSshProfile.directTarget.localForwards[0]?.localPort === 8080,
      'ssh_direct_target_restart_restore_failed',
    );
    invariant(
      !JSON.stringify(restoredSshProfile).includes('ssh -p'),
      'ssh_raw_import_command_was_persisted',
    );
    const restoredSshWorkspaceGrant = legacyReopened
      .listSshWorkspaceGrants(chatProjectId)
      .find((grant) => grant.id === sshWorkspaceGrantId);
    invariant(
      restoredSshWorkspaceGrant?.canonicalRoot === '/workspace/research-project' &&
        restoredSshWorkspaceGrant.permissionMode === 'workspace' &&
        restoredSshWorkspaceGrant.version === 2,
      'ssh_workspace_grant_restart_restore_failed',
    );
    invariant(
      !legacyReopened.removeSshWorkspaceGrant(chatProjectId, sshWorkspaceGrantId, 1),
      'ssh_workspace_grant_stale_remove_was_accepted',
    );
    legacyReopened.close();

    const mutationDatabase = new LocalDatabase();
    mutationDatabase.open();
    const workspace = new WorkspaceService({
      load: () => mutationDatabase.loadWorkspaceState(),
      commit: (state, operation) => mutationDatabase.commitWorkspaceState(state, operation),
      pendingChanges: () => mutationDatabase.pendingWorkspaceChanges(),
      pendingSummary: () => mutationDatabase.pendingWorkspaceSummary(),
    });
    const legacySnapshot = await workspace.snapshot();
    const legacyProject = legacySnapshot.projects[0];
    invariant(legacyProject !== undefined, 'legacy_project_missing');
    invariant(legacyProject.board === undefined, 'legacy_project_received_persisted_defaults');
    await workspace.updateBoardSettings({
      projectId: legacyProject.id,
      expectedVersion: legacyProject.version,
      board: {
        title: 'Reproduction pipeline',
        columnLabels: {
          backlog: 'Ideas',
          planned: 'Ready',
          in_progress: 'Running',
          review: 'Evidence check',
          done: 'Published',
        },
        columnOrder: ['backlog', 'planned', 'in_progress', 'review', 'done'],
        wipLimits: { backlog: null, planned: 4, in_progress: 2, review: 1, done: null },
      },
    });
    const persistedTask = await workspace.createTask({
      projectId: legacyProject.id,
      title: 'Run reproducibility baseline',
      status: 'in_progress',
      description: 'Verify metric parity before the ablation.',
      priority: 'urgent',
      dueDate: '2026-08-20',
      labels: ['GPU', 'gpu', 'paper'],
    });
    await workspace.setTaskArchived({
      projectId: legacyProject.id,
      taskId: persistedTask.id,
      expectedVersion: persistedTask.version,
      archived: true,
    });
    const templatedProject = await workspace.createProject({
      name: 'Default template copy',
      board: {
        title: 'Paper pipeline',
        columnLabels: {
          backlog: 'Questions',
          planned: 'Selected',
          in_progress: 'Analyzing',
          review: 'Evidence check',
          done: 'Accepted',
        },
        columnOrder: ['backlog', 'planned', 'in_progress', 'review', 'done'],
        wipLimits: { backlog: null, planned: 5, in_progress: 2, review: 2, done: null },
      },
    });
    const archivedProject = await workspace.setProjectArchived({
      projectId: templatedProject.id,
      expectedVersion: templatedProject.version,
      archived: true,
    });
    mutationDatabase.close();

    const archivedRestart = new LocalDatabase();
    archivedRestart.open();
    const archivedWorkspace = new WorkspaceService({
      load: () => archivedRestart.loadWorkspaceState(),
      commit: (state, operation) => archivedRestart.commitWorkspaceState(state, operation),
      pendingChanges: () => archivedRestart.pendingWorkspaceChanges(),
      pendingSummary: () => archivedRestart.pendingWorkspaceSummary(),
    });
    const archivedSnapshot = await archivedWorkspace.snapshot();
    invariant(
      archivedSnapshot.projects.find((project) => project.id === templatedProject.id)
        ?.archivedAt !== undefined,
      'project_archive_restart_restore_failed',
    );
    await archivedWorkspace.setProjectArchived({
      projectId: templatedProject.id,
      expectedVersion: archivedProject.version,
      archived: false,
    });
    archivedRestart.close();

    const reopened = new LocalDatabase();
    reopened.open();
    let branchMessageLimitRejected = false;
    try {
      reopened.branchProjectChatSession({
        projectId: branchLimitProjectId,
        sourceSessionId: branchLimitSessionId,
        branchFromMessageId: branchLimitMessageId,
      });
    } catch (error) {
      branchMessageLimitRejected =
        error instanceof Error && error.message === 'chat_branch_limit_reached';
    }
    invariant(branchMessageLimitRejected, 'chat_branch_message_limit_was_not_enforced');
    const firstBranchMessageId = '00000001-0000-4000-8000-000000000001';
    let lineageSourceSessionId: string = branchLimitSessionId;
    for (let depth = 0; depth < PROJECT_CHAT_MAX_BRANCH_DEPTH; depth += 1) {
      lineageSourceSessionId = reopened.branchProjectChatSession({
        projectId: branchLimitProjectId,
        sourceSessionId: lineageSourceSessionId,
        branchFromMessageId: firstBranchMessageId,
      }).id;
    }
    let branchDepthLimitRejected = false;
    try {
      reopened.branchProjectChatSession({
        projectId: branchLimitProjectId,
        sourceSessionId: lineageSourceSessionId,
        branchFromMessageId: firstBranchMessageId,
      });
    } catch (error) {
      branchDepthLimitRejected =
        error instanceof Error && error.message === 'chat_branch_limit_reached';
    }
    invariant(branchDepthLimitRejected, 'chat_branch_depth_limit_was_not_enforced');
    const unrelatedRoot = reopened.createProjectChatSession(branchLimitProjectId, 'Unrelated root');
    let crossSessionBranchRejected = false;
    try {
      reopened.branchProjectChatSession({
        projectId: branchLimitProjectId,
        sourceSessionId: unrelatedRoot.id,
        branchFromMessageId: firstBranchMessageId,
      });
    } catch (error) {
      crossSessionBranchRejected =
        error instanceof Error && error.message === 'chat_branch_message_not_found';
    }
    invariant(crossSessionBranchRejected, 'cross_session_chat_branch_was_not_rejected');
    const operationalSnapshot = reopened.loadWorkspaceState();
    invariant(operationalSnapshot?.revision === 8, 'kanban_workspace_restart_restore_failed');
    invariant(
      operationalSnapshot.projects[0]?.board?.title === 'Reproduction pipeline' &&
        operationalSnapshot.projects[0]?.board?.columnLabels.review === 'Evidence check' &&
        operationalSnapshot.projects[0]?.board?.wipLimits.in_progress === 2,
      'kanban_board_settings_restart_restore_failed',
    );
    const restoredTask = operationalSnapshot.tasks.find((task) => task.id === persistedTask.id);
    invariant(
      restoredTask?.description === 'Verify metric parity before the ablation.' &&
        restoredTask.priority === 'urgent' &&
        restoredTask.dueDate === '2026-08-20' &&
        restoredTask.labels?.join(',') === 'GPU,paper' &&
        restoredTask.archivedAt !== undefined &&
        restoredTask.version === 2,
      'kanban_task_metadata_archive_restart_restore_failed',
    );
    invariant(
      operationalSnapshot.projects.find((project) => project.id === templatedProject.id)?.board
        ?.columnLabels.backlog === 'Questions' &&
        operationalSnapshot.projects.find((project) => project.id === templatedProject.id)
          ?.archivedAt === undefined &&
        operationalSnapshot.projects.find((project) => project.id === templatedProject.id)
          ?.version === 3,
      'project_archive_unarchive_restart_restore_failed',
    );
    invariant(
      reopened
        .pendingWorkspaceChanges()
        .slice(-6)
        .map((operation) => operation.commandType)
        .join(',') ===
        'project.board.update,task.create,task.archive,project.create,project.archive,project.unarchive',
      'kanban_outbox_lineage_restore_failed',
    );
    invariant(
      reopened
        .pendingWorkspaceChanges()
        .find(
          (operation) =>
            operation.commandType === 'project.create' &&
            operation.entityId === templatedProject.id,
        )?.payload.board !== undefined,
      'default_board_template_outbox_missing',
    );
    invariant(reopened.pendingWorkspaceSummary().count === 8, 'outbox_summary_restore_failed');
    invariant(
      reopened.pendingWorkspaceSummary().latestWorkspaceRevision === 8,
      'outbox_summary_revision_failed',
    );
    const reopenedChat = reopened.snapshot(chatProjectId);
    const reopenedSsh = reopened.listSshConnections();
    invariant(
      reopenedSsh.length === 1 &&
        reopenedSsh[0]?.id === sshConnectionId &&
        reopenedSsh[0].label === 'Fixture GPU 2' &&
        reopenedSsh[0].hostAlias === 'fixture-gpu-2' &&
        reopenedSsh[0].version === 2,
      'ssh_profile_restart_restore_failed',
    );
    invariant(
      reopened.removeSshConnection(sshConnectionId, 2),
      'ssh_profile_remove_for_grant_cascade_failed',
    );
    invariant(
      reopened.listSshWorkspaceGrants(chatProjectId).length === 0,
      'ssh_workspace_grant_connection_cascade_failed',
    );
    invariant(
      reopened.listProjectChatSessions(chatProjectId).length === 2 &&
        reopened.snapshot(chatProjectId, independentChatSession.id).messages.length === 0,
      'root_chat_session_isolation_did_not_survive_restart',
    );
    const completedBranchSession = reopened.branchProjectChatSession({
      projectId: chatProjectId,
      sourceSessionId: defaultChatSession.id,
      branchFromMessageId: completedAssistantMessageId,
    });
    const branchedSnapshot = reopened.snapshot(chatProjectId, completedBranchSession.id);
    invariant(
      branchedSnapshot.messages.some((message) => message.id === completedAssistantMessageId) &&
        !branchedSnapshot.messages.some(
          (message) => message.attemptId === interruptedAttemptId && message.role === 'assistant',
        ),
      'chat_branch_did_not_stop_at_completed_message',
    );
    invariant(
      reopened.getChatAttempt(chatProjectId, independentChatSession.id, completedAttemptId) ===
        null,
      'chat_attempt_crossed_root_session_boundary',
    );
    let crossProjectBranchRejected = false;
    try {
      reopened.branchProjectChatSession({
        projectId: first.state.projects[0]!.id,
        sourceSessionId: defaultChatSession.id,
        branchFromMessageId: completedAssistantMessageId,
      });
    } catch (error) {
      crossProjectBranchRejected =
        error instanceof Error && error.message === 'chat_session_not_found';
    }
    invariant(crossProjectBranchRejected, 'cross_project_chat_branch_was_not_rejected');
    invariant(
      reopenedChat.messages.find((message) => message.id === chatMessageId)?.content ===
        chatMessage.content,
      'chat_message_restore_failed',
    );
    invariant(
      reopenedChat.messages.find((message) => message.id === chatMessageId)?.actions[0]?.status ===
        'proposed',
      'chat_action_restore_failed',
    );
    invariant(
      reopened.getChatAttempt(chatProjectId, completedAttemptId)?.status === 'complete' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.harnessMode === 'planner' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.collaborationModeId ===
          'research-orchestrator-v2' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.personality === 'pragmatic' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.responseVerbosity === 'high' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.webSearchMode === 'live' &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.profileVersion === 1 &&
        reopened.getChatAttempt(chatProjectId, completedAttemptId)?.promptProvenance
          ?.promptSha256 === 'e'.repeat(64),
      'completed_chat_attempt_restore_failed',
    );
    invariant(
      reopened.getProjectChatProfile(chatProjectId).version === 1 &&
        reopened.getProjectChatProfile(chatProjectId).customInstructions ===
          'Prefer reproducible experiments.' &&
        reopened.getProjectChatProfile(chatProjectId).collaborationModeId ===
          'research-orchestrator-v2' &&
        reopened.getProjectChatProfile(chatProjectId).personality === 'pragmatic' &&
        reopened.getProjectChatProfile(chatProjectId).responseVerbosity === 'high' &&
        reopened.getProjectChatProfile(chatProjectId).webSearchMode === 'live' &&
        reopened.getProjectChatProfile(chatProjectId).localNotesVault?.id === 'a'.repeat(64) &&
        reopened.getProjectChatProfile(chatProjectId).localNotesVault?.name === 'Fixture Vault' &&
        reopened.getProjectChatProfile(chatProjectId).instructionRevision?.id ===
          chatProfile.instructionRevision?.id,
      'chat_profile_restart_restore_failed',
    );
    const reconciledAttempt = reopened.getChatAttempt(chatProjectId, interruptedAttemptId);
    invariant(
      reconciledAttempt?.status === 'interrupted' &&
        reconciledAttempt.errorCode === 'application_interrupted',
      'running_chat_attempt_was_not_reconciled',
    );
    invariant(
      reopenedChat.messages.filter(
        (message) => message.attemptId === interruptedAttemptId && message.role === 'assistant',
      ).length === 1,
      'interrupted_chat_attempt_receipt_missing',
    );
    invariant(
      reopened.getChatAttempt(chatProjectId, modalityAttemptId)?.errorCode ===
        'attachment_model_modality_unsupported',
      'chat_attempt_modality_error_restore_failed',
    );
    invariant(reopenedChat.attempts?.length === 3, 'chat_attempt_snapshot_restore_failed');
    invariant(
      reopened.claimAction(chatProjectId, chatActionId, fixedTimestamp),
      'chat_action_claim_failed',
    );

    const independentSession = reopened.createProjectChatSession(
      chatProjectId,
      'Independent investigation',
    );
    invariant(
      reopened.snapshot(chatProjectId, independentSession.id).messages.length === 0,
      'new_chat_session_inherited_default_history',
    );
    const sessionAttemptId = randomUUID();
    const sessionUserMessageId = randomUUID();
    const sessionAssistantMessageId = randomUUID();
    const sessionAttempt: ProjectChatAttempt = {
      id: sessionAttemptId,
      projectId: chatProjectId,
      sessionId: independentSession.id,
      userMessageId: sessionUserMessageId,
      requestedModelId: null,
      reasoningOptionId: null,
      status: 'starting',
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp,
    };
    reopened.beginChatAttempt(sessionAttempt, {
      id: sessionUserMessageId,
      projectId: chatProjectId,
      role: 'user',
      content: 'Session-only question',
      status: 'complete',
      actions: [],
      createdAt: fixedTimestamp,
      completedAt: fixedTimestamp,
    });
    const sessionRunning: ProjectChatAttempt = {
      ...sessionAttempt,
      threadId: 'thread-session-fixture',
      turnId: 'turn-session-fixture',
      model: {
        invocationId: randomUUID(),
        requestedModelId: null,
        resolvedModelId: 'fixture-model',
        catalogVersion: 'fixture-catalog',
        reasoningOptionId: null,
      },
      status: 'running',
    };
    reopened.markChatAttemptRunning(sessionRunning);
    reopened.finishChatAttempt(
      { ...sessionRunning, status: 'complete' },
      {
        id: sessionAssistantMessageId,
        projectId: chatProjectId,
        role: 'assistant',
        content: 'Session-only answer',
        status: 'complete',
        actions: [],
        createdAt: fixedTimestamp,
        completedAt: fixedTimestamp,
      },
    );
    const branchedSession = reopened.branchProjectChatSession({
      projectId: chatProjectId,
      sourceSessionId: independentSession.id,
      branchFromMessageId: sessionAssistantMessageId,
    });
    invariant(
      reopened.snapshot(chatProjectId, branchedSession.id).messages.length === 2,
      'branched_chat_session_did_not_copy_membership_prefix',
    );
    const renamedSession = reopened.renameProjectChatSession(
      chatProjectId,
      branchedSession.id,
      'Alternative hypothesis',
    );
    invariant(
      renamedSession?.title === 'Alternative hypothesis' &&
        renamedSession.id === branchedSession.id,
      'chat_session_rename_failed',
    );
    invariant(
      reopened
        .snapshot(chatProjectId)
        .messages.every(
          (message) =>
            message.id !== sessionUserMessageId && message.id !== sessionAssistantMessageId,
        ),
      'independent_chat_session_leaked_into_default_history',
    );

    const duplicate = fixture(9, operationId, fixedTimestamp);
    let duplicateRejected = false;
    try {
      reopened.commitWorkspaceState(duplicate.state, duplicate.operation);
    } catch {
      duplicateRejected = true;
    }
    invariant(duplicateRejected, 'duplicate_outbox_operation_was_not_rejected');
    reopened.close();

    const afterRollback = new LocalDatabase();
    afterRollback.open();
    invariant(
      afterRollback.snapshot(chatProjectId).messages.find((message) => message.id === chatMessageId)
        ?.actions[0]?.errorCode === 'application_interrupted',
      'chat_action_interruption_reconciliation_failed',
    );
    invariant(
      afterRollback
        .snapshot(chatProjectId)
        .messages.filter(
          (message) => message.attemptId === interruptedAttemptId && message.role === 'assistant',
        ).length === 1,
      'chat_attempt_reconciliation_created_duplicate_receipt',
    );
    invariant(
      afterRollback.loadWorkspaceState()?.revision === 8,
      'workspace_transaction_did_not_roll_back',
    );
    invariant(
      afterRollback.pendingWorkspaceChanges().length === 8,
      'outbox_transaction_did_not_roll_back',
    );
    invariant(
      afterRollback.pendingWorkspaceSummary().count === 8,
      'outbox_summary_did_not_roll_back',
    );

    const competing = new LocalDatabase();
    competing.open();
    const accepted = fixture(9, randomUUID(), fixedTimestamp);
    const stale = fixture(9, randomUUID(), fixedTimestamp);
    afterRollback.commitWorkspaceState(accepted.state, accepted.operation);
    let staleRevisionRejected = false;
    try {
      competing.commitWorkspaceState(stale.state, stale.operation);
    } catch (error) {
      staleRevisionRejected =
        error instanceof Error && error.message === 'workspace_revision_conflict';
    }
    invariant(staleRevisionRejected, 'stale_workspace_revision_was_not_rejected');
    afterRollback.close();
    competing.close();

    const afterRace = new LocalDatabase();
    afterRace.open();
    invariant(afterRace.loadWorkspaceState()?.revision === 9, 'workspace_race_revision_changed');
    invariant(
      afterRace.loadWorkspaceState()?.projects[0]?.id === accepted.state.projects[0]?.id,
      'workspace_race_snapshot_was_overwritten',
    );
    invariant(
      afterRace.pendingWorkspaceChanges().filter((operation) => operation.workspaceRevision === 9)
        .length === 1,
      'workspace_race_created_duplicate_revision',
    );
    invariant(afterRace.pendingWorkspaceSummary().count === 9, 'workspace_race_summary_changed');
    afterRace.close();

    const opaquePayload = '{legacy-operation-payload-is-not-json';
    const corruptStatus = new Database(join(temporaryUserData, 'gosu.db'));
    corruptStatus.pragma(`key="x'${keyHex}'"`);
    corruptStatus.transaction(() => {
      corruptStatus
        .prepare('update sync_outbox set operation_json=?,workspace_revision=null where id=?')
        .run(opaquePayload, operationId);
      corruptStatus
        .prepare(
          `update local_workspace_outbox_status
           set pending_count=1,latest_workspace_revision=null where singleton_id=1`,
        )
        .run();
    })();
    corruptStatus.close();

    const recovered = new LocalDatabase();
    recovered.open();
    invariant(recovered.loadWorkspaceState()?.revision === 9, 'opaque_payload_changed_snapshot');
    invariant(recovered.pendingWorkspaceSummary().count === 9, 'status_reconciliation_failed');
    invariant(
      recovered.pendingWorkspaceSummary().latestWorkspaceRevision === 9,
      'status_revision_reconciliation_failed',
    );
    let opaqueQueueRejected = false;
    try {
      recovered.pendingWorkspaceChanges();
    } catch (error) {
      opaqueQueueRejected = error instanceof WorkspaceDataRecoveryError;
    }
    invariant(opaqueQueueRejected, 'opaque_queue_was_not_marked_for_recovery');
    recovered.close();

    const preservedPayload = new Database(join(temporaryUserData, 'gosu.db'));
    preservedPayload.pragma(`key="x'${keyHex}'"`);
    const preserved = preservedPayload
      .prepare('select operation_json from sync_outbox where id=?')
      .get(operationId) as { operation_json: string };
    preservedPayload.close();
    invariant(preserved.operation_json === opaquePayload, 'opaque_payload_was_rewritten');

    const ambiguousOrdering = new Database(join(temporaryUserData, 'gosu.db'));
    ambiguousOrdering.pragma(`key="x'${keyHex}'"`);
    const acceptedRow = ambiguousOrdering
      .prepare('select operation_json from sync_outbox where id=?')
      .get(accepted.operation.id) as { operation_json: string };
    const acceptedOperation = JSON.parse(acceptedRow.operation_json) as Record<string, unknown>;
    acceptedOperation.workspaceRevision = 10;
    ambiguousOrdering
      .prepare('update sync_outbox set operation_json=?,workspace_revision=10 where id=?')
      .run(JSON.stringify(acceptedOperation), accepted.operation.id);
    ambiguousOrdering.close();

    const recoveryRequired = new LocalDatabase();
    recoveryRequired.open();
    invariant(
      recoveryRequired.loadWorkspaceState()?.revision === 9,
      'ambiguous_outbox_hid_workspace_snapshot',
    );
    let ambiguousSummaryRejected = false;
    try {
      recoveryRequired.pendingWorkspaceSummary();
    } catch (error) {
      ambiguousSummaryRejected = error instanceof WorkspaceDataRecoveryError;
    }
    invariant(ambiguousSummaryRejected, 'ambiguous_outbox_was_silently_renumbered');
    recoveryRequired.close();

    verifyLegacyChatMigration(temporaryUserData, fixedTimestamp);
    verifyLegacySshMigration(temporaryUserData, fixedTimestamp);
    verifyLegacyProfileMigration(temporaryUserData, fixedTimestamp);
    verifyLiteratureRelevanceMigration(temporaryUserData, fixedTimestamp);
    verifyLiteraturePersistence(fixedTimestamp);
    verifySparseSemanticScholarMerge(fixedTimestamp);
    verifyLiteratureDiscoveryPersistence(fixedTimestamp);
    verifyLiteratureBoundsAndIdentity(fixedTimestamp);

    process.stdout.write('local SQLCipher workspace smoke test passed\n');
    app.exit(0);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'local_database_smoke_failed'}\n`,
    );
    app.exit(1);
  } finally {
    invariant(
      basename(temporaryUserData).startsWith('gosu-local-db-smoke-'),
      'temporary_workspace_path_rejected',
    );
    rmSync(temporaryUserData, { recursive: true, force: true });
  }
});
