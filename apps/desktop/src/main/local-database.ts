import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { app, safeStorage } from 'electron';

import type { ModelCatalog, ModelInvocation } from '@gosu/contracts';
import {
  EXPERIMENT_MAX_IDEAS_PER_PROJECT,
  EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT,
  ExperimentIdeaSchema,
  ExperimentMetricPointSchema,
  type ExperimentIdea,
  type ExperimentMetricPoint,
} from '../shared/experiment-workspace-contracts';
import {
  LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT,
  LITERATURE_MAX_SEARCH_CONFLICT_PREVIEW,
  LITERATURE_MAX_SEARCH_RESULTS,
  LiteratureDiscoveryCoverageSchema,
  LiteratureDiscoverySummarySchema,
  LiteratureRecordSchema,
  LiteratureSearchConflictSchema,
  LiteratureSearchRunSchema,
  type LiteratureAiAnnotationUpdate,
  type LiteratureAiProvenance,
  type LiteratureDiscoveryCoverage,
  type LiteratureRecord,
  type LiteratureSearchConflict,
  type LiteratureSearchRun,
  type LiteratureTierCounts,
} from '../shared/literature-contracts';
import {
  LiteratureSearchTagsSchema,
  mergeLiteratureSearchTags,
  type LiteratureSearchTags,
} from '../shared/literature-search-tags';
import {
  ProjectChatActionSchema,
  ProjectChatAttemptSchema,
  ProjectChatMessageSchema,
  PROJECT_CHAT_MAX_BRANCH_DEPTH,
  PROJECT_CHAT_MAX_BRANCH_MESSAGES,
  PROJECT_CHAT_MAX_SESSIONS_PER_PROJECT,
  ProjectChatProfileSchema,
  ProjectChatSessionSchema,
  ProjectChatSnapshotSchema,
  UpdateProjectChatProfileInputSchema,
  defaultProjectChatProfile,
  type ProjectChatAction,
  type ProjectChatAttempt,
  type ProjectChatMessage,
  type ProjectChatProfile,
  type ProjectChatSession,
  type ProjectChatSnapshot,
  type UpdateProjectChatProfileInput,
} from '../shared/project-chat-contracts';
import { SshConnectionProfileSchema, type SshConnectionProfile } from '../shared/ssh-contracts';
import {
  RemoteWorkspaceGrantSchema,
  type RemoteWorkspaceGrant,
} from '../shared/ssh-workspace-contracts';
import type {
  WorkspaceOperation,
  WorkspacePendingSummary,
  WorkspaceSnapshot,
} from '../shared/workspace-contracts';
import { ExperimentWorkspaceStorageError } from './experiment-workspace-storage-error';
import { literatureFingerprint, type LiteratureProviderCandidate } from './literature-crossref';
import { LiteratureStorageError } from './literature-storage-error';
import { WorkspaceDataRecoveryError } from './workspace-storage-error';

const MAX_WORKSPACE_STATE_BYTES = 8 * 1024 * 1024;
const INTERRUPTED_CHAT_ATTEMPT_RECEIPT =
  'GOSU closed before this Codex turn finished. Retry when ready.';
const PROJECT_CHAT_SESSIONS_MIGRATION = 'project-chat-sessions-v1';
const LITERATURE_MANUAL_RELEVANCE_MIGRATION = 'literature-manual-relevance-v2';
const LITERATURE_WEAK_FINGERPRINT_MIGRATION = 'literature-weak-fingerprint-v1';
const LITERATURE_DISCOVERY_MIGRATION = 'literature-balanced-discovery-v1';
const LITERATURE_DISCOVERY_COVERAGE_MIGRATION = 'literature-discovery-coverage-v1';
const LITERATURE_SEARCH_TAGS_MIGRATION = 'literature-search-tags-v1';
const DEFAULT_PROJECT_CHAT_SESSION_TITLE = 'Project chat';
const ExperimentMetricPointDraftSchema = ExperimentMetricPointSchema.omit({ sequence: true });

export type LocalLiteratureAiAnnotationUpdate = LiteratureAiAnnotationUpdate &
  Readonly<{ provenance: LiteratureAiProvenance }>;

function backfillLegacyWorkspaceRevisions(database: Database.Database) {
  const operations = database
    .prepare(
      `select rowid,operation_json,workspace_revision from sync_outbox
       where scope like 'workspace:%'
       order by rowid asc`,
    )
    .all() as Array<{
    rowid: number;
    operation_json: string;
    workspace_revision: number | null;
  }>;
  const repairs: Array<{ rowid: number; operationJson: string; revision: number }> = [];

  for (const [index, row] of operations.entries()) {
    const expectedRevision = index + 1;
    if (row.workspace_revision !== null && row.workspace_revision !== expectedRevision) {
      return false;
    }

    let operationJson = row.operation_json;
    try {
      const candidate = JSON.parse(row.operation_json) as unknown;
      if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
        const parsed = candidate as Record<string, unknown>;
        const persistedRevision = parsed.workspaceRevision;
        if (
          persistedRevision !== undefined &&
          (typeof persistedRevision !== 'number' ||
            !Number.isSafeInteger(persistedRevision) ||
            persistedRevision !== expectedRevision)
        ) {
          return false;
        }
        if (persistedRevision === undefined) {
          operationJson = JSON.stringify({ ...parsed, workspaceRevision: expectedRevision });
        }
      }
    } catch {
      // Keep malformed payloads byte-for-byte opaque. Only ordering metadata can be repaired.
    }

    if (row.workspace_revision === null || operationJson !== row.operation_json) {
      repairs.push({ rowid: row.rowid, operationJson, revision: expectedRevision });
    }
  }

  const update = database.prepare(
    'update sync_outbox set workspace_revision=?,operation_json=? where rowid=?',
  );
  for (const repair of repairs) {
    update.run(repair.revision, repair.operationJson, repair.rowid);
  }
  return true;
}

function reconcileWorkspaceOutboxStatus(database: Database.Database): WorkspacePendingSummary {
  const row = database
    .prepare(
      `select count(*) as pending_count,max(workspace_revision) as latest_workspace_revision
       from sync_outbox
       where delivered_at is null and scope like 'workspace:%'`,
    )
    .get() as { pending_count: number; latest_workspace_revision: number | null };
  const summary: WorkspacePendingSummary = {
    count: row.pending_count,
    latestWorkspaceRevision: row.latest_workspace_revision,
  };
  database
    .prepare(
      `insert into local_workspace_outbox_status(
         singleton_id,pending_count,latest_workspace_revision
       ) values(1,?,?)
       on conflict(singleton_id) do update set
         pending_count=excluded.pending_count,
         latest_workspace_revision=excluded.latest_workspace_revision`,
    )
    .run(summary.count, summary.latestWorkspaceRevision);
  return summary;
}

function insertProjectChatMessage(database: Database.Database, message: ProjectChatMessage) {
  database
    .prepare(
      `insert into project_chat_messages(
         id,project_id,role,content,status,attempt_id,turn_id,model_json,created_at,completed_at
       ) values(?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      message.id,
      message.projectId,
      message.role,
      message.content,
      message.status,
      message.attemptId ?? null,
      message.turnId ?? null,
      message.model ? JSON.stringify(message.model) : null,
      message.createdAt,
      message.completedAt,
    );
  const insertAction = database.prepare(
    `insert into project_chat_actions(
       id,message_id,project_id,command_json,status,result_entity_id,
       result_entity_version,error_code,created_at,updated_at
     ) values(?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const action of message.actions) {
    insertAction.run(
      action.id,
      action.messageId,
      action.projectId,
      JSON.stringify(action.command),
      action.status,
      action.resultEntityId ?? null,
      action.resultEntityVersion ?? null,
      action.errorCode ?? null,
      action.createdAt,
      action.updatedAt,
    );
  }
}

function insertProjectChatAttempt(database: Database.Database, attempt: ProjectChatAttempt) {
  database
    .prepare(
      `insert into project_chat_attempts(
         id,project_id,session_id,user_message_id,retry_of_attempt_id,thread_id,turn_id,model_json,
         requested_model_id,reasoning_option_id,harness_mode,response_depth,
         collaboration_mode_id,personality,response_verbosity,web_search_mode,context_scope,
         profile_version,
         instruction_revision_id,prompt_provenance_json,status,error_code,error_code_v2,
         created_at,updated_at
       ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      attempt.id,
      attempt.projectId,
      attempt.sessionId ?? null,
      attempt.userMessageId,
      attempt.retryOfAttemptId ?? null,
      attempt.threadId ?? null,
      attempt.turnId ?? null,
      attempt.model ? JSON.stringify(attempt.model) : null,
      attempt.requestedModelId,
      attempt.reasoningOptionId,
      attempt.harnessMode ?? null,
      attempt.responseDepth ?? null,
      attempt.collaborationModeId ?? null,
      attempt.personality ?? null,
      attempt.responseVerbosity ?? null,
      attempt.webSearchMode ?? null,
      attempt.contextScope ?? null,
      attempt.profileVersion ?? null,
      attempt.instructionRevisionId ?? null,
      attempt.promptProvenance ? JSON.stringify(attempt.promptProvenance) : null,
      attempt.status,
      legacyProjectChatAttemptErrorCode(attempt.errorCode),
      attempt.errorCode ?? null,
      attempt.createdAt,
      attempt.updatedAt,
    );
}

function legacyProjectChatAttemptErrorCode(errorCode: ProjectChatAttempt['errorCode']) {
  return errorCode === 'attachment_model_modality_unsupported' ? null : (errorCode ?? null);
}

function insertProjectChatSession(database: Database.Database, session: ProjectChatSession) {
  database
    .prepare(
      `insert into project_chat_sessions(
         id,project_id,title,is_default,parent_session_id,branched_from_message_id,
         created_at,updated_at
       ) values(?,?,?,?,?,?,?,?)`,
    )
    .run(
      session.id,
      session.projectId,
      session.title,
      session.isDefault ? 1 : 0,
      session.parentSessionId ?? null,
      session.branchedFromMessageId ?? null,
      session.createdAt,
      session.updatedAt,
    );
}

function appendProjectChatSessionMessage(
  database: Database.Database,
  sessionId: string,
  messageId: string,
) {
  const next = database
    .prepare(
      `select coalesce(max(ordinal),0)+1 as ordinal
       from project_chat_session_messages where session_id=?`,
    )
    .get(sessionId) as { ordinal: number };
  database
    .prepare(
      `insert into project_chat_session_messages(session_id,message_id,ordinal)
       values(?,?,?)`,
    )
    .run(sessionId, messageId, next.ordinal);
}

function touchProjectChatSession(
  database: Database.Database,
  sessionId: string,
  updatedAt: string,
) {
  database
    .prepare('update project_chat_sessions set updated_at=? where id=?')
    .run(updatedAt, sessionId);
}

function reconcileInterruptedChatAttempts(database: Database.Database, reconciledAt: string) {
  const attempts = database
    .prepare(
      `select id,project_id,session_id,turn_id,model_json
       from project_chat_attempts where status in ('starting','running')`,
    )
    .all() as Array<{
    id: string;
    project_id: string;
    session_id: string | null;
    turn_id: string | null;
    model_json: string | null;
  }>;
  const interrupt = database.prepare(
    `update project_chat_attempts
     set status='interrupted',error_code='application_interrupted',
         error_code_v2='application_interrupted',updated_at=?
     where id=? and project_id=? and status in ('starting','running')`,
  );
  const hasReceipt = database.prepare(
    `select 1 from project_chat_messages
     where project_id=? and attempt_id=? and role='assistant' limit 1`,
  );
  const insertReceipt = database.prepare(
    `insert into project_chat_messages(
       id,project_id,role,content,status,attempt_id,turn_id,model_json,created_at,completed_at
     ) values(?,?,'assistant',?,'interrupted',?,?,?,?,?)`,
  );
  for (const attempt of attempts) {
    const changed = interrupt.run(reconciledAt, attempt.id, attempt.project_id).changes;
    if (changed !== 1 || hasReceipt.get(attempt.project_id, attempt.id)) continue;
    if (!attempt.session_id) throw new Error('chat_attempt_session_missing');
    const receiptId = randomUUID();
    insertReceipt.run(
      receiptId,
      attempt.project_id,
      INTERRUPTED_CHAT_ATTEMPT_RECEIPT,
      attempt.id,
      attempt.turn_id,
      attempt.model_json,
      reconciledAt,
      reconciledAt,
    );
    appendProjectChatSessionMessage(database, attempt.session_id, receiptId);
    touchProjectChatSession(database, attempt.session_id, reconciledAt);
  }
}

type LiteratureRecordRow = Readonly<{
  id: string;
  schema_version: number;
  project_id: string;
  source_provider: string;
  provider_record_id: string | null;
  doi: string | null;
  fingerprint: string;
  title: string;
  authors_json: string;
  container_title: string | null;
  published_year: number | null;
  topics_json: string;
  search_tags_json: string;
  work_type: string | null;
  citation_count: number | null;
  source_url: string | null;
  citation_key: string | null;
  review_status: string;
  manual_topics_json: string;
  manual_summary: string | null;
  manual_relevance: string | null;
  ai_topics_json: string;
  ai_summary: string | null;
  ai_relevance: string | null;
  ai_study_type: string | null;
  ai_limitations_json: string;
  ai_model_provenance_json: string | null;
  current_discovery_json: string | null;
  annotation_version: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}>;

type LiteratureSearchRunRow = Readonly<{
  id: string;
  project_id: string;
  provider: string;
  policy_id: string;
  policy_version: number;
  query: string;
  search_tags_json: string;
  requested_limit: number;
  from_year: number | null;
  to_year: number | null;
  status: LiteratureSearchRun['status'];
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  conflict_count: number;
  retrieved_count: number;
  selected_count: number;
  core_count: number;
  rising_count: number;
  broad_count: number;
  discovery_coverage_json: string | null;
  created_at: string;
  completed_at: string | null;
}>;

type LiteratureSearchConflictRow = Readonly<{
  ordinal: number;
  provider: string;
  provider_record_id: string | null;
  doi: string | null;
  fingerprint: string;
  title: string;
  authors_json: string;
  published_year: number | null;
}>;

type ExperimentIdeaRow = Readonly<{
  id: string;
  schema_version: number;
  project_id: string;
  parent_idea_id: string | null;
  title: string;
  hypothesis: string;
  phase: string;
  outcome: ExperimentIdea['outcome'];
  result_summary: string;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}>;

type ExperimentMetricPointRow = Readonly<{
  id: string;
  schema_version: number;
  project_id: string;
  idea_id: string;
  sequence: number;
  objective_id: string;
  objective_version: number;
  metric_key: string;
  metric_display_name: string;
  direction: ExperimentMetricPoint['direction'];
  unit: string | null;
  aggregation: ExperimentMetricPoint['aggregation'];
  evaluator_hash: string;
  dataset_hash: string;
  holdout_hash: string | null;
  baseline: number | null;
  target: number | null;
  value: number;
  source: ExperimentMetricPoint['source'];
  trial_id: string | null;
  recorded_at: string;
}>;

function toExperimentIdea(row: ExperimentIdeaRow): ExperimentIdea {
  return ExperimentIdeaSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    projectId: row.project_id,
    parentIdeaId: row.parent_idea_id,
    title: row.title,
    hypothesis: row.hypothesis,
    phase: row.phase,
    outcome: row.outcome,
    resultSummary: row.result_summary,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });
}

function toExperimentMetricPoint(row: ExperimentMetricPointRow): ExperimentMetricPoint {
  return ExperimentMetricPointSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    projectId: row.project_id,
    ideaId: row.idea_id,
    sequence: row.sequence,
    objectiveId: row.objective_id,
    objectiveVersion: row.objective_version,
    metricKey: row.metric_key,
    metricDisplayName: row.metric_display_name,
    direction: row.direction,
    unit: row.unit,
    aggregation: row.aggregation,
    evaluatorHash: row.evaluator_hash,
    datasetHash: row.dataset_hash,
    holdoutHash: row.holdout_hash,
    baseline: row.baseline,
    target: row.target,
    value: row.value,
    source: row.source,
    trialId: row.trial_id,
    recordedAt: row.recorded_at,
  });
}

function stringArrayJson(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('invalid_literature_record');
  }
  return parsed;
}

function recordJson(value: string | null) {
  if (value === null) return null;
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid_literature_record');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function literatureSearchTagsJson(value: string): LiteratureSearchTags {
  return LiteratureSearchTagsSchema.parse(JSON.parse(value) as unknown);
}

function toLocalLiteratureRecord(row: LiteratureRecordRow): LiteratureRecord {
  return LiteratureRecordSchema.parse({
    schemaVersion: 1,
    id: row.id,
    projectId: row.project_id,
    provider: row.source_provider,
    providerRecordId: row.provider_record_id,
    doi: row.doi,
    fingerprint: row.fingerprint,
    title: row.title,
    authors: stringArrayJson(row.authors_json),
    containerTitle: row.container_title,
    publishedYear: row.published_year,
    sourceTopics: stringArrayJson(row.topics_json),
    searchTags: literatureSearchTagsJson(row.search_tags_json),
    workType: row.work_type,
    citationCount: row.citation_count,
    sourceUrl: row.source_url,
    citationKey: row.citation_key ?? '',
    reviewStatus: row.review_status,
    manualAnnotations: {
      topics: stringArrayJson(row.manual_topics_json),
      summary: row.manual_summary ?? '',
      relevance: row.manual_relevance ?? '',
    },
    aiAnnotations: row.ai_model_provenance_json
      ? {
          topics: stringArrayJson(row.ai_topics_json),
          summary: row.ai_summary ?? '',
          relevance: row.ai_relevance,
          studyType: row.ai_study_type ?? '',
          limitations: stringArrayJson(row.ai_limitations_json),
          provenance: recordJson(row.ai_model_provenance_json),
        }
      : null,
    discovery: row.current_discovery_json
      ? LiteratureDiscoverySummarySchema.parse(recordJson(row.current_discovery_json))
      : null,
    version: row.version,
    annotationVersion: row.annotation_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toLocalLiteratureSearchConflict(
  row: LiteratureSearchConflictRow,
): LiteratureSearchConflict {
  return LiteratureSearchConflictSchema.parse({
    ordinal: row.ordinal,
    provider: row.provider,
    providerRecordId: row.provider_record_id,
    doi: row.doi,
    fingerprint: row.fingerprint,
    title: row.title,
    authors: stringArrayJson(row.authors_json),
    publishedYear: row.published_year,
  });
}

function toLocalLiteratureSearchRun(
  row: LiteratureSearchRunRow,
  conflicts: readonly LiteratureSearchConflict[] = [],
): LiteratureSearchRun {
  return LiteratureSearchRunSchema.parse({
    schemaVersion: 1,
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    query: row.query,
    searchTags: literatureSearchTagsJson(row.search_tags_json),
    requestedLimit: row.requested_limit,
    fromYear: row.from_year,
    toYear: row.to_year,
    status: row.status,
    foundCount: row.new_count + row.updated_count + row.unchanged_count + row.conflict_count,
    retrievedCount: row.retrieved_count,
    selectedCount: row.selected_count,
    ...(row.policy_id === 'balanced-three-layer'
      ? {
          tierCounts: {
            core: row.core_count,
            rising: row.rising_count,
            broad: row.broad_count,
          },
        }
      : {}),
    ...(row.discovery_coverage_json
      ? {
          coverage: LiteratureDiscoveryCoverageSchema.parse(
            recordJson(row.discovery_coverage_json),
          ),
        }
      : {}),
    newCount: row.new_count,
    updatedCount: row.updated_count,
    unchangedCount: row.unchanged_count,
    conflictCount: row.conflict_count,
    conflicts,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
}

function listLiteratureSearchConflicts(
  database: Database.Database,
  runId: string,
): LiteratureSearchConflict[] {
  const rows = database
    .prepare(
      `select ordinal,provider,provider_record_id,doi,fingerprint,title,authors_json,published_year
       from literature_search_conflicts where search_run_id=? order by ordinal
       limit ${LITERATURE_MAX_SEARCH_CONFLICT_PREVIEW}`,
    )
    .all(runId) as LiteratureSearchConflictRow[];
  return rows.map(toLocalLiteratureSearchConflict);
}

function citationKeyBase(candidate: LiteratureProviderCandidate) {
  const author = (candidate.authors[0] ?? 'paper')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .split(/\s+/u)
    .at(-1)
    ?.replace(/[^A-Za-z0-9]/gu, '')
    .toLowerCase();
  const titleWord = candidate.title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .split(/[^A-Za-z0-9]+/u)
    .find((word) => word.length >= 3)
    ?.toLowerCase();
  return `${author || 'paper'}${candidate.publishedYear ?? 'nd'}${titleWord || 'work'}`.slice(
    0,
    140,
  );
}

function nextCitationKey(
  database: Database.Database,
  projectId: string,
  candidate: LiteratureProviderCandidate,
  excludeRecordId?: string,
) {
  const requested = candidate.citationKey
    ?.trim()
    .replace(/[^A-Za-z0-9_:+./-]/gu, '')
    .slice(0, 140);
  const base = requested || citationKeyBase(candidate);
  const exists = excludeRecordId
    ? database.prepare(
        `select 1 from literature_records
         where project_id=? and citation_key=? and id<>? limit 1`,
      )
    : database.prepare(
        'select 1 from literature_records where project_id=? and citation_key=? limit 1',
      );
  const values = (key: string) =>
    excludeRecordId ? [projectId, key, excludeRecordId] : [projectId, key];
  if (!exists.get(...values(base))) return base;
  let suffix = 2;
  while (exists.get(...values(`${base}${suffix}`))) suffix += 1;
  return `${base}${suffix}`;
}

function candidateState(candidate: LiteratureProviderCandidate) {
  return {
    source_provider: candidate.provider,
    provider_record_id: candidate.providerId ?? null,
    doi: candidate.doi ?? null,
    fingerprint: candidate.fingerprint,
    title: candidate.title,
    authors_json: JSON.stringify(candidate.authors),
    container_title: candidate.containerTitle ?? null,
    published_year: candidate.publishedYear ?? null,
    topics_json: JSON.stringify(candidate.topics),
    work_type: candidate.workType ?? null,
    citation_count: candidate.citationCount ?? null,
    source_url: candidate.sourceUrl ?? null,
  };
}

function mergedProviderCandidateState(
  existing: LiteratureRecordRow,
  candidate: LiteratureProviderCandidate,
  state: ReturnType<typeof candidateState>,
) {
  const identity = {
    provider_record_id:
      state.provider_record_id ??
      (state.source_provider === existing.source_provider ? existing.provider_record_id : null),
    doi: state.doi ?? existing.doi,
  };
  if (candidate.provider !== 'semantic-scholar') return { ...state, ...identity };

  // Semantic Scholar can return a strong DOI/paper identity while omitting optional metadata.
  // Promoting that trusted source must not turn already-known fields into null or empty arrays.
  const authorsJson = candidate.authors.length > 0 ? state.authors_json : existing.authors_json;
  const publishedYear = state.published_year ?? existing.published_year;
  return {
    ...state,
    ...identity,
    authors_json: authorsJson,
    container_title: state.container_title ?? existing.container_title,
    published_year: publishedYear,
    topics_json: candidate.topics.length > 0 ? state.topics_json : existing.topics_json,
    work_type: state.work_type ?? existing.work_type,
    citation_count: state.citation_count ?? existing.citation_count,
    source_url: state.source_url ?? existing.source_url,
    fingerprint: literatureFingerprint(
      state.title,
      stringArrayJson(authorsJson),
      publishedYear ?? undefined,
    ),
  };
}

function requireLiteratureRecordCapacity(
  database: Database.Database,
  projectId: string,
  existing: LiteratureRecordRow | undefined,
) {
  if (existing?.deleted_at === null) return;
  const row = database
    .prepare(
      'select count(*) as count from literature_records where project_id=? and deleted_at is null',
    )
    .get(projectId) as { count: number };
  if (row.count >= LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT) {
    throw new LiteratureStorageError('record_limit_reached');
  }
}

function findLiteratureRecord(
  database: Database.Database,
  projectId: string,
  candidate: LiteratureProviderCandidate,
): LiteratureRecordRow | undefined {
  const byDoi = candidate.doi
    ? (database
        .prepare('select * from literature_records where project_id=? and doi=? limit 1')
        .get(projectId, candidate.doi) as LiteratureRecordRow | undefined)
    : undefined;
  const byProvider = candidate.providerId
    ? (database
        .prepare(
          `select * from literature_records
           where project_id=? and source_provider=? and provider_record_id=? limit 1`,
        )
        .get(projectId, candidate.provider, candidate.providerId) as
        LiteratureRecordRow | undefined)
    : undefined;
  const strongIdentities = [byDoi, byProvider].filter(
    (record): record is LiteratureRecordRow => record !== undefined,
  );
  if (new Set(strongIdentities.map((record) => record.id)).size > 1) {
    throw new LiteratureStorageError('identity_conflict');
  }
  const matched = byDoi ?? byProvider;
  if (matched && candidate.doi && matched.doi && candidate.doi !== matched.doi) {
    throw new LiteratureStorageError('identity_conflict');
  }
  if (
    matched &&
    candidate.provider === matched.source_provider &&
    candidate.providerId &&
    matched.provider_record_id &&
    candidate.providerId !== matched.provider_record_id &&
    !(matched.doi === null && candidate.doi !== undefined && candidate.providerId === candidate.doi)
  ) {
    throw new LiteratureStorageError('identity_conflict');
  }
  if (matched) return matched;

  const fingerprintMatches = database
    .prepare(
      `select * from literature_records
       where project_id=? and fingerprint=? order by created_at,id`,
    )
    .all(projectId, candidate.fingerprint) as LiteratureRecordRow[];
  const candidateHasStrongIdentity = Boolean(candidate.doi || candidate.providerId);
  if (!candidateHasStrongIdentity) {
    if (fingerprintMatches.length > 1) {
      throw new LiteratureStorageError('identity_conflict');
    }
    const weakMatch = fingerprintMatches[0];
    if (weakMatch && (weakMatch.doi !== null || weakMatch.provider_record_id !== null)) {
      throw new LiteratureStorageError('identity_conflict');
    }
    return weakMatch;
  }
  if (fingerprintMatches.length !== 1) return undefined;
  const weakMatch = fingerprintMatches[0]!;
  if (weakMatch.doi === null && weakMatch.provider_record_id === null) return weakMatch;
  return undefined;
}

function requireNoLiteratureIdentityCollision(
  database: Database.Database,
  projectId: string,
  recordId: string,
  state: ReturnType<typeof candidateState>,
) {
  const doiCollision = state.doi
    ? database
        .prepare('select 1 from literature_records where project_id=? and doi=? and id<>? limit 1')
        .get(projectId, state.doi, recordId)
    : undefined;
  const providerCollision = state.provider_record_id
    ? database
        .prepare(
          `select 1 from literature_records where project_id=? and source_provider=?
           and provider_record_id=? and id<>? limit 1`,
        )
        .get(projectId, state.source_provider, state.provider_record_id, recordId)
    : undefined;
  if (doiCollision || providerCollision) {
    throw new LiteratureStorageError('identity_conflict');
  }
}

function upsertLiteratureCandidate(
  database: Database.Database,
  projectId: string,
  candidate: LiteratureProviderCandidate,
  updatedAt: string,
  runSearchTags?: LiteratureSearchTags,
) {
  const existing = findLiteratureRecord(database, projectId, candidate);
  requireLiteratureRecordCapacity(database, projectId, existing);
  const state = candidateState(candidate);
  if (!existing) {
    const id = randomUUID();
    const manual = candidate.manualAnnotations ?? { topics: [], summary: '', relevance: '' };
    const searchTags = mergeLiteratureSearchTags(candidate.searchTags, runSearchTags);
    database
      .prepare(
        `insert into literature_records(
           id,schema_version,project_id,source_provider,provider_record_id,doi,fingerprint,title,
           authors_json,container_title,published_year,topics_json,search_tags_json,work_type,citation_count,
           source_url,citation_key,review_status,manual_topics_json,manual_summary,manual_relevance,
           ai_topics_json,ai_summary,ai_relevance,ai_study_type,ai_limitations_json,
           ai_model_provenance_json,annotation_version,version,created_at,updated_at,deleted_at
         ) values(?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?,null)`,
      )
      .run(
        id,
        projectId,
        state.source_provider,
        state.provider_record_id,
        state.doi,
        state.fingerprint,
        state.title,
        state.authors_json,
        state.container_title,
        state.published_year,
        state.topics_json,
        JSON.stringify(searchTags),
        state.work_type,
        state.citation_count,
        state.source_url,
        nextCitationKey(database, projectId, candidate),
        candidate.reviewStatus ?? 'unreviewed',
        JSON.stringify(manual.topics),
        manual.summary || null,
        manual.relevance || null,
        '[]',
        null,
        null,
        null,
        '[]',
        null,
        updatedAt,
        updatedAt,
      );
    const inserted = database
      .prepare('select * from literature_records where project_id=? and id=?')
      .get(projectId, id) as LiteratureRecordRow;
    return { outcome: 'new' as const, record: toLocalLiteratureRecord(inserted) };
  }
  const providerPriority: Record<string, number> = {
    import: 0,
    crossref: 1,
    'semantic-scholar': 2,
  };
  const refreshSource =
    existing.source_provider === 'import' ||
    (candidate.provider !== 'import' &&
      (providerPriority[candidate.provider] ?? 0) >=
        (providerPriority[existing.source_provider] ?? 0));
  const importReview = candidate.provider === 'import';
  const merged = refreshSource
    ? mergedProviderCandidateState(existing, candidate, state)
    : candidateState({
        provider: existing.source_provider as LiteratureProviderCandidate['provider'],
        ...(existing.provider_record_id ? { providerId: existing.provider_record_id } : {}),
        ...(existing.doi ? { doi: existing.doi } : {}),
        fingerprint: existing.fingerprint,
        title: existing.title,
        authors: stringArrayJson(existing.authors_json),
        ...(existing.container_title ? { containerTitle: existing.container_title } : {}),
        ...(existing.published_year ? { publishedYear: existing.published_year } : {}),
        topics: stringArrayJson(existing.topics_json),
        ...(existing.work_type ? { workType: existing.work_type } : {}),
        ...(existing.citation_count === null ? {} : { citationCount: existing.citation_count }),
        ...(existing.source_url ? { sourceUrl: existing.source_url } : {}),
      });
  const manual = importReview
    ? (candidate.manualAnnotations ?? { topics: [], summary: '', relevance: '' })
    : {
        topics: stringArrayJson(existing.manual_topics_json),
        summary: existing.manual_summary ?? '',
        relevance: existing.manual_relevance ?? '',
      };
  const reviewStatus = importReview
    ? (candidate.reviewStatus ?? existing.review_status)
    : existing.review_status;
  const citationKey =
    importReview && candidate.citationKey
      ? nextCitationKey(database, projectId, candidate, existing.id)
      : existing.citation_key;
  const searchTags = mergeLiteratureSearchTags(
    literatureSearchTagsJson(existing.search_tags_json),
    candidate.searchTags,
    runSearchTags,
  );
  const searchTagsJson = JSON.stringify(searchTags);
  const searchTagsChanged = existing.search_tags_json !== searchTagsJson;
  const sourceChanged =
    existing.source_provider !== merged.source_provider ||
    existing.provider_record_id !== merged.provider_record_id ||
    existing.doi !== merged.doi ||
    existing.fingerprint !== merged.fingerprint ||
    existing.title !== merged.title ||
    existing.authors_json !== merged.authors_json ||
    existing.container_title !== merged.container_title ||
    existing.published_year !== merged.published_year ||
    existing.topics_json !== merged.topics_json ||
    existing.work_type !== merged.work_type ||
    existing.citation_count !== merged.citation_count ||
    existing.source_url !== merged.source_url;
  const aiInvalidated = sourceChanged && existing.ai_model_provenance_json !== null;
  const annotationChanged =
    existing.review_status !== reviewStatus ||
    existing.manual_topics_json !== JSON.stringify(manual.topics) ||
    existing.manual_summary !== (manual.summary || null) ||
    existing.manual_relevance !== (manual.relevance || null);
  const changed =
    sourceChanged ||
    searchTagsChanged ||
    existing.citation_key !== citationKey ||
    existing.review_status !== reviewStatus ||
    existing.manual_topics_json !== JSON.stringify(manual.topics) ||
    existing.manual_summary !== (manual.summary || null) ||
    existing.manual_relevance !== (manual.relevance || null) ||
    existing.deleted_at !== null;
  if (!changed) return { outcome: 'unchanged' as const, record: toLocalLiteratureRecord(existing) };
  requireNoLiteratureIdentityCollision(database, projectId, existing.id, merged);
  database
    .prepare(
      `update literature_records set
         source_provider=?,provider_record_id=?,doi=?,fingerprint=?,title=?,authors_json=?,container_title=?,
         published_year=?,topics_json=?,search_tags_json=?,work_type=?,citation_count=?,source_url=?,citation_key=?,
         review_status=?,manual_topics_json=?,manual_summary=?,manual_relevance=?,
         ai_topics_json=?,ai_summary=?,ai_relevance=?,ai_study_type=?,ai_limitations_json=?,
         ai_model_provenance_json=?,
         annotation_version=annotation_version+?,version=version+1,updated_at=?,deleted_at=null
       where project_id=? and id=?`,
    )
    .run(
      merged.source_provider,
      merged.provider_record_id,
      merged.doi,
      merged.fingerprint,
      merged.title,
      merged.authors_json,
      merged.container_title,
      merged.published_year,
      merged.topics_json,
      searchTagsJson,
      merged.work_type,
      merged.citation_count,
      merged.source_url,
      citationKey,
      reviewStatus,
      JSON.stringify(manual.topics),
      manual.summary || null,
      manual.relevance || null,
      aiInvalidated ? '[]' : existing.ai_topics_json,
      aiInvalidated ? null : existing.ai_summary,
      aiInvalidated ? null : existing.ai_relevance,
      aiInvalidated ? null : existing.ai_study_type,
      aiInvalidated ? '[]' : existing.ai_limitations_json,
      aiInvalidated ? null : existing.ai_model_provenance_json,
      annotationChanged || aiInvalidated ? 1 : 0,
      updatedAt,
      projectId,
      existing.id,
    );
  const updated = database
    .prepare('select * from literature_records where project_id=? and id=?')
    .get(projectId, existing.id) as LiteratureRecordRow;
  return { outcome: 'updated' as const, record: toLocalLiteratureRecord(updated) };
}

function migrateLiteratureManualRelevance(database: Database.Database) {
  const schema = database
    .prepare("select sql from sqlite_master where type='table' and name='literature_records'")
    .get() as { sql: string | null } | undefined;
  const limitMatch = schema?.sql?.match(
    /\bmanual_relevance\s+text\s+check\s*\(\s*manual_relevance\s+is\s+null\s+or\s+length\s*\(\s*manual_relevance\s*\)\s+between\s+1\s+and\s+(\d+)\s*\)/iu,
  );
  const configuredLimit = limitMatch ? Number(limitMatch[1]) : null;
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(LITERATURE_MANUAL_RELEVANCE_MIGRATION);

  if (migrationApplied) {
    if (configuredLimit !== 4_000) {
      throw new Error('literature_manual_relevance_schema_invalid');
    }
    return;
  }

  database
    .transaction(() => {
      if (configuredLimit === 64) {
        database.exec(`
          alter table literature_records rename column manual_relevance to legacy_manual_relevance;
          alter table literature_records add column manual_relevance text check (
            manual_relevance is null or length(manual_relevance) between 1 and 4000
          );
          update literature_records set manual_relevance=legacy_manual_relevance;
          alter table literature_records drop column legacy_manual_relevance;
        `);
      } else if (configuredLimit !== 4_000) {
        throw new Error('literature_manual_relevance_schema_invalid');
      }
      database
        .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
        .run(LITERATURE_MANUAL_RELEVANCE_MIGRATION, new Date().toISOString());
    })
    .immediate();
}

function migrateLiteratureWeakFingerprint(database: Database.Database) {
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(LITERATURE_WEAK_FINGERPRINT_MIGRATION);
  if (migrationApplied) return;
  database
    .transaction(() => {
      database.exec(`
        drop index if exists literature_record_fingerprint_identity;
        create unique index if not exists literature_record_weak_fingerprint_identity
          on literature_records(project_id,fingerprint)
          where doi is null and provider_record_id is null;
        create index if not exists literature_records_by_fingerprint
          on literature_records(project_id,fingerprint);
      `);
      database
        .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
        .run(LITERATURE_WEAK_FINGERPRINT_MIGRATION, new Date().toISOString());
    })
    .immediate();
}

function migrateLiteratureDiscovery(database: Database.Database) {
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(LITERATURE_DISCOVERY_MIGRATION);
  if (migrationApplied) return;
  database
    .transaction(() => {
      const addColumn = (table: string, name: string, definition: string) => {
        const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
        if (!columns.some((column) => column.name === name)) {
          database.exec(`alter table ${table} add column ${name} ${definition}`);
        }
      };
      addColumn(
        'literature_records',
        'current_discovery_json',
        'text check (current_discovery_json is null or length(current_discovery_json) <= 16384)',
      );
      addColumn(
        'literature_search_runs',
        'policy_id',
        "text not null default 'crossref-basic' check (policy_id in ('crossref-basic','balanced-three-layer'))",
      );
      addColumn(
        'literature_search_runs',
        'policy_version',
        'integer not null default 1 check (policy_version > 0)',
      );
      addColumn(
        'literature_search_runs',
        'retrieved_count',
        'integer not null default 0 check (retrieved_count >= 0)',
      );
      addColumn(
        'literature_search_runs',
        'selected_count',
        'integer not null default 0 check (selected_count >= 0)',
      );
      addColumn(
        'literature_search_runs',
        'core_count',
        'integer not null default 0 check (core_count >= 0)',
      );
      addColumn(
        'literature_search_runs',
        'rising_count',
        'integer not null default 0 check (rising_count >= 0)',
      );
      addColumn(
        'literature_search_runs',
        'broad_count',
        'integer not null default 0 check (broad_count >= 0)',
      );
      addColumn(
        'literature_search_hits',
        'discovery_tier',
        "text check (discovery_tier is null or discovery_tier in ('core','rising','broad'))",
      );
      addColumn(
        'literature_search_hits',
        'tier_rank',
        'integer check (tier_rank is null or tier_rank > 0)',
      );
      addColumn(
        'literature_search_hits',
        'overall_score',
        'real check (overall_score is null or overall_score between 0 and 1)',
      );
      addColumn(
        'literature_search_hits',
        'ranking_signals_json',
        'text check (ranking_signals_json is null or length(ranking_signals_json) <= 16384)',
      );

      database
        .prepare(
          `update literature_search_runs set
             retrieved_count=new_count+updated_count+unchanged_count+conflict_count,
             selected_count=new_count+updated_count+unchanged_count+conflict_count
           where status='complete' and retrieved_count=0 and selected_count=0`,
        )
        .run();

      const conflictSchema = database
        .prepare(
          "select sql from sqlite_master where type='table' and name='literature_search_conflicts'",
        )
        .get() as { sql: string | null } | undefined;
      if (/provider\s*=\s*'crossref'/iu.test(conflictSchema?.sql ?? '')) {
        database.exec(`
          alter table literature_search_conflicts rename to literature_search_conflicts_legacy;
          create table literature_search_conflicts (
            search_run_id text not null references literature_search_runs(id) on delete cascade,
            ordinal integer not null check (ordinal between 1 and 50),
            provider text not null check (provider in ('crossref','semantic-scholar')),
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
          insert into literature_search_conflicts(
            search_run_id,ordinal,provider,provider_record_id,doi,fingerprint,title,authors_json,
            published_year
          )
          select search_run_id,ordinal,provider,provider_record_id,doi,fingerprint,title,
                 authors_json,published_year
          from literature_search_conflicts_legacy;
          drop table literature_search_conflicts_legacy;
        `);
      }
      database
        .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
        .run(LITERATURE_DISCOVERY_MIGRATION, new Date().toISOString());
    })
    .immediate();
}

function migrateLiteratureDiscoveryCoverage(database: Database.Database) {
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(LITERATURE_DISCOVERY_COVERAGE_MIGRATION);
  if (migrationApplied) return;
  database
    .transaction(() => {
      const columns = database.pragma('table_info(literature_search_runs)') as Array<{
        name: string;
      }>;
      if (!columns.some((column) => column.name === 'discovery_coverage_json')) {
        database.exec(
          `alter table literature_search_runs add column discovery_coverage_json text
           check (
             discovery_coverage_json is null or length(discovery_coverage_json) <= 4096
           )`,
        );
      }
      database
        .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
        .run(LITERATURE_DISCOVERY_COVERAGE_MIGRATION, new Date().toISOString());
    })
    .immediate();
}

function migrateLiteratureSearchTags(database: Database.Database) {
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(LITERATURE_SEARCH_TAGS_MIGRATION);
  if (migrationApplied) return;
  database
    .transaction(() => {
      const addColumn = (table: string) => {
        const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
        if (!columns.some((column) => column.name === 'search_tags_json')) {
          database.exec(
            `alter table ${table} add column search_tags_json text not null
             default '{"topics":[],"keywords":[]}'
             check (length(search_tags_json) <= 32768)`,
          );
        }
      };
      addColumn('literature_records');
      addColumn('literature_search_runs');
      database
        .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
        .run(LITERATURE_SEARCH_TAGS_MIGRATION, new Date().toISOString());
    })
    .immediate();
}

export class LocalDatabase {
  private database: Database.Database | undefined;
  private workspaceOutboxOrderingReady = false;

  isReady() {
    return this.database !== undefined;
  }

  open() {
    if (this.database) return;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('secure_local_storage_unavailable');
    }
    const userData = app.getPath('userData');
    const keyPath = join(userData, 'local-key.bin');
    let key: Buffer;
    if (existsSync(keyPath)) {
      const decrypted = safeStorage.decryptString(readFileSync(keyPath)).trim();
      key = decrypted.length > 0 ? Buffer.from(decrypted, 'hex') : Buffer.alloc(0);
    } else {
      key = randomBytes(32);
      try {
        writeFileSync(keyPath, safeStorage.encryptString(key.toString('hex')), { mode: 0o600 });
      } catch (error) {
        key.fill(0);
        throw error;
      }
    }
    if (key.length !== 32) {
      key.fill(0);
      throw new Error('invalid_local_database_key');
    }
    let database: Database.Database | undefined;
    try {
      database = new Database(join(userData, 'gosu.db'));
      database.pragma(`key="x'${key.toString('hex')}'"`);
      database.pragma('journal_mode=WAL');
      database.pragma('foreign_keys=ON');
      database.exec(`
      create table if not exists cache_records (
        scope text not null,
        key text not null,
        value_json text not null,
        entity_version integer not null,
        updated_at text not null,
        primary key (scope, key)
      );
      create table if not exists sync_outbox (
        id text primary key,
        scope text not null,
        operation_json text not null,
        base_version integer,
        workspace_revision integer check (workspace_revision is null or workspace_revision > 0),
        created_at text not null,
        delivered_at text
      );
      create table if not exists local_workspace_state (
        singleton_id integer primary key check (singleton_id = 1),
        schema_version integer not null check (schema_version = 1),
        revision integer not null check (revision >= 0),
        state_json text not null check (length(state_json) <= ${MAX_WORKSPACE_STATE_BYTES}),
        updated_at text not null
      );
      create table if not exists local_workspace_outbox_status (
        singleton_id integer primary key check (singleton_id = 1),
        pending_count integer not null check (pending_count >= 0),
        latest_workspace_revision integer check (
          latest_workspace_revision is null or latest_workspace_revision > 0
        )
      );
      create table if not exists model_catalog_snapshots (
        id text primary key,
        provider text not null,
        catalog_json text not null,
        captured_at text not null
      );
      create table if not exists model_invocations (
        invocation_id text primary key,
        thread_id text not null,
        turn_id text not null,
        requested_model_id text,
        resolved_model_id text not null,
        catalog_version text not null,
        reasoning_option_id text,
        started_at text not null,
        updated_at text not null
      );
      create table if not exists ssh_connections (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        label text not null check (length(label) between 1 and 120),
        host_alias text not null check (length(host_alias) between 1 and 255),
        direct_target_json text check (
          direct_target_json is null or length(direct_target_json) between 2 and 16384
        ),
        version integer not null check (version > 0),
        created_at text not null,
        updated_at text not null
      );
      create index if not exists ssh_connections_by_label
        on ssh_connections(label,id);
      create table if not exists ssh_workspace_grants (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null check (length(project_id) = 36),
        connection_id text not null check (length(connection_id) = 36),
        canonical_root text not null check (length(canonical_root) between 1 and 1024),
        permission_mode text not null check (permission_mode in ('diagnostics','workspace')),
        version integer not null check (version > 0),
        created_at text not null,
        updated_at text not null,
        unique(project_id,connection_id),
        foreign key(connection_id) references ssh_connections(id) on delete cascade
      );
      create index if not exists ssh_workspace_grants_by_project
        on ssh_workspace_grants(project_id,connection_id,id);
      create table if not exists literature_records (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null,
        source_provider text not null check (length(source_provider) between 1 and 64),
        provider_record_id text check (
          provider_record_id is null or length(provider_record_id) between 1 and 2048
        ),
        doi text check (doi is null or length(doi) between 1 and 512),
        fingerprint text not null check (length(fingerprint) = 64),
        title text not null check (length(title) between 1 and 2000),
        authors_json text not null check (length(authors_json) <= 32768),
        container_title text check (
          container_title is null or length(container_title) between 1 and 1000
        ),
        published_year integer check (
          published_year is null or published_year between 1000 and 3000
        ),
        topics_json text not null check (length(topics_json) <= 32768),
        search_tags_json text not null default '{"topics":[],"keywords":[]}' check (
          length(search_tags_json) <= 32768
        ),
        work_type text check (work_type is null or length(work_type) between 1 and 120),
        citation_count integer check (citation_count is null or citation_count >= 0),
        source_url text check (source_url is null or length(source_url) between 1 and 2048),
        citation_key text check (citation_key is null or length(citation_key) between 1 and 160),
        review_status text not null default 'unreviewed' check (
          review_status in ('unreviewed','screening','included','excluded','reviewed','maybe')
        ),
        manual_topics_json text not null default '[]' check (
          length(manual_topics_json) <= 32768
        ),
        manual_summary text check (
          manual_summary is null or length(manual_summary) between 1 and 8000
        ),
        manual_relevance text check (
          manual_relevance is null or length(manual_relevance) between 1 and 4000
        ),
        ai_topics_json text not null default '[]' check (length(ai_topics_json) <= 32768),
        ai_summary text check (ai_summary is null or length(ai_summary) between 1 and 8000),
        ai_relevance text check (
          ai_relevance is null or length(ai_relevance) between 1 and 64
        ),
        ai_study_type text check (
          ai_study_type is null or length(ai_study_type) between 1 and 240
        ),
        ai_limitations_json text not null default '[]' check (
          length(ai_limitations_json) <= 32768
        ),
        ai_model_provenance_json text check (
          ai_model_provenance_json is null or length(ai_model_provenance_json) <= 16384
        ),
        current_discovery_json text check (
          current_discovery_json is null or length(current_discovery_json) <= 16384
        ),
        annotation_version integer not null default 0 check (annotation_version >= 0),
        version integer not null check (version > 0),
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );
      create unique index if not exists literature_record_doi_identity
        on literature_records(project_id,doi) where doi is not null;
      create unique index if not exists literature_record_provider_identity
        on literature_records(project_id,source_provider,provider_record_id)
        where provider_record_id is not null;
      create unique index if not exists literature_record_weak_fingerprint_identity
        on literature_records(project_id,fingerprint)
        where doi is null and provider_record_id is null;
      create index if not exists literature_records_by_fingerprint
        on literature_records(project_id,fingerprint);
      create unique index if not exists literature_record_citation_key
        on literature_records(project_id,citation_key) where citation_key is not null;
      create index if not exists literature_records_by_project
        on literature_records(project_id,deleted_at,updated_at desc,id);
      create table if not exists literature_search_runs (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null,
        provider text not null check (length(provider) between 1 and 64),
        policy_id text not null default 'crossref-basic' check (
          policy_id in ('crossref-basic','balanced-three-layer')
        ),
        policy_version integer not null default 1 check (policy_version > 0),
        query text not null check (length(query) between 1 and 1000),
        search_tags_json text not null default '{"topics":[],"keywords":[]}' check (
          length(search_tags_json) <= 32768
        ),
        requested_limit integer not null check (requested_limit between 1 and 50),
        from_year integer check (from_year is null or from_year between 1000 and 3000),
        to_year integer check (to_year is null or to_year between 1000 and 3000),
        status text not null check (status in ('running','complete','failed','cancelled')),
        new_count integer not null default 0 check (new_count >= 0),
        updated_count integer not null default 0 check (updated_count >= 0),
        unchanged_count integer not null default 0 check (unchanged_count >= 0),
        conflict_count integer not null default 0 check (conflict_count >= 0),
        retrieved_count integer not null default 0 check (retrieved_count >= 0),
        selected_count integer not null default 0 check (selected_count >= 0),
        core_count integer not null default 0 check (core_count >= 0),
        rising_count integer not null default 0 check (rising_count >= 0),
        broad_count integer not null default 0 check (broad_count >= 0),
        discovery_coverage_json text check (
          discovery_coverage_json is null or length(discovery_coverage_json) <= 4096
        ),
        created_at text not null,
        completed_at text
      );
      create index if not exists literature_search_runs_by_project
        on literature_search_runs(project_id,created_at desc,id);
      create table if not exists literature_search_hits (
        search_run_id text not null references literature_search_runs(id) on delete cascade,
        ordinal integer not null check (ordinal > 0),
        record_id text not null references literature_records(id) on delete cascade,
        outcome text not null check (outcome in ('new','updated','unchanged')),
        discovery_tier text check (
          discovery_tier is null or discovery_tier in ('core','rising','broad')
        ),
        tier_rank integer check (tier_rank is null or tier_rank > 0),
        overall_score real check (overall_score is null or overall_score between 0 and 1),
        ranking_signals_json text check (
          ranking_signals_json is null or length(ranking_signals_json) <= 16384
        ),
        primary key(search_run_id,ordinal)
      );
      create index if not exists literature_search_hits_by_record
        on literature_search_hits(record_id,search_run_id);
      create table if not exists literature_search_conflicts (
        search_run_id text not null references literature_search_runs(id) on delete cascade,
        ordinal integer not null check (ordinal between 1 and 50),
        provider text not null check (provider in ('crossref','semantic-scholar')),
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
      create table if not exists experiment_ideas (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null check (length(project_id) = 36),
        parent_idea_id text check (parent_idea_id is null or length(parent_idea_id) = 36),
        title text not null check (length(title) between 1 and 160),
        hypothesis text not null check (length(hypothesis) <= 4000),
        phase text not null check (length(phase) <= 80),
        outcome text not null check (
          outcome in ('planned','running','success','partial','failed','inconclusive')
        ),
        result_summary text not null check (length(result_summary) <= 4000),
        version integer not null check (version > 0),
        created_at text not null,
        updated_at text not null,
        completed_at text,
        unique(project_id,id),
        check (parent_idea_id is null or parent_idea_id <> id),
        foreign key(project_id,parent_idea_id)
          references experiment_ideas(project_id,id)
      );
      create index if not exists experiment_ideas_by_project
        on experiment_ideas(project_id,created_at,id);
      create trigger if not exists experiment_ideas_project_limit
        before insert on experiment_ideas
        when (
          select count(*) from experiment_ideas where project_id=new.project_id
        ) >= ${EXPERIMENT_MAX_IDEAS_PER_PROJECT}
        begin
          select raise(abort,'experiment_idea_limit_reached');
        end;
      create table if not exists experiment_metric_points (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null check (length(project_id) = 36),
        idea_id text not null check (length(idea_id) = 36),
        sequence integer not null check (sequence > 0),
        objective_id text not null check (length(objective_id) = 36),
        objective_version integer not null check (objective_version > 0),
        metric_key text not null check (length(metric_key) between 1 and 128),
        metric_display_name text not null check (
          length(metric_display_name) between 1 and 256
        ),
        direction text not null check (direction in ('maximize','minimize')),
        unit text check (unit is null or length(unit) between 1 and 64),
        aggregation text not null check (
          aggregation in ('mean','median','minimum','maximum','last')
        ),
        evaluator_hash text not null check (length(evaluator_hash) between 8 and 160),
        dataset_hash text not null check (length(dataset_hash) between 8 and 160),
        holdout_hash text check (holdout_hash is null or length(holdout_hash) between 8 and 160),
        baseline real,
        target real,
        value real not null,
        source text not null check (source in ('manual','runner-summary')),
        trial_id text check (trial_id is null or length(trial_id) between 1 and 128),
        recorded_at text not null,
        unique(project_id,sequence),
        foreign key(project_id,idea_id)
          references experiment_ideas(project_id,id)
      );
      create index if not exists experiment_metric_points_by_project
        on experiment_metric_points(project_id,sequence);
      create index if not exists experiment_metric_points_by_idea
        on experiment_metric_points(project_id,idea_id,sequence);
      create trigger if not exists experiment_metric_points_project_limit
        before insert on experiment_metric_points
        when (
          select count(*) from experiment_metric_points where project_id=new.project_id
        ) >= ${EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT}
        begin
          select raise(abort,'experiment_metric_limit_reached');
        end;
      create trigger if not exists experiment_metric_points_update_guard
        before update on experiment_metric_points
        begin
          select raise(abort,'experiment_metric_point_append_only');
        end;
      create trigger if not exists experiment_metric_points_delete_guard
        before delete on experiment_metric_points
        begin
          select raise(abort,'experiment_metric_point_append_only');
        end;
      create table if not exists local_schema_migrations (
        id text primary key,
        applied_at text not null
      );
      create table if not exists project_chat_messages (
        id text primary key,
        project_id text not null,
        role text not null check (role in ('user','assistant')),
        content text not null check (length(content) between 1 and 32000),
        status text not null check (status in ('complete','failed','interrupted')),
        attempt_id text check (attempt_id is null or length(attempt_id) = 36),
        turn_id text check (turn_id is null or length(turn_id) between 1 and 256),
        model_json text check (model_json is null or length(model_json) <= 4096),
        created_at text not null,
        completed_at text not null
      );
      create index if not exists project_chat_messages_by_project
        on project_chat_messages(project_id,created_at,id);
      create table if not exists project_chat_sessions (
        id text primary key check (length(id) = 36),
        project_id text not null,
        title text not null check (length(title) between 1 and 120),
        is_default integer not null check (is_default in (0,1)),
        parent_session_id text references project_chat_sessions(id),
        branched_from_message_id text references project_chat_messages(id),
        created_at text not null,
        updated_at text not null,
        check (
          (parent_session_id is null and branched_from_message_id is null) or
          (parent_session_id is not null and branched_from_message_id is not null)
        )
      );
      create unique index if not exists project_chat_one_default_session
        on project_chat_sessions(project_id) where is_default=1;
      create trigger if not exists project_chat_default_session_marker_immutable
        before update of is_default on project_chat_sessions
        begin
          select raise(abort,'chat_default_session_immutable');
        end;
      create trigger if not exists project_chat_default_session_delete_guard
        before delete on project_chat_sessions when old.is_default=1
        begin
          select raise(abort,'chat_default_session_immutable');
        end;
      create trigger if not exists project_chat_session_lineage_immutable
        before update of project_id,parent_session_id,branched_from_message_id,created_at
        on project_chat_sessions
        begin
          select raise(abort,'chat_session_lineage_immutable');
        end;
      create index if not exists project_chat_sessions_by_project
        on project_chat_sessions(project_id,updated_at desc,id);
      create table if not exists project_chat_session_messages (
        session_id text not null references project_chat_sessions(id) on delete cascade,
        message_id text not null references project_chat_messages(id) on delete cascade,
        ordinal integer not null check (ordinal > 0),
        primary key(session_id,message_id),
        unique(session_id,ordinal)
      );
      create table if not exists project_chat_instruction_revisions (
        id text primary key check (length(id) = 36),
        project_id text not null,
        revision integer not null check (revision > 0),
        content text not null check (length(content) <= 4000),
        content_sha256 text not null check (length(content_sha256) = 64),
        created_at text not null,
        unique(project_id,revision)
      );
      create table if not exists project_chat_profiles (
        project_id text primary key,
        version integer not null check (version > 0),
        harness_mode text not null check (harness_mode in ('context','planner','reviewer')),
        response_depth text not null check (response_depth in ('concise','standard','deep')),
        collaboration_mode_id text check (
          collaboration_mode_id is null or length(collaboration_mode_id) between 1 and 128
        ),
        personality text not null default 'auto' check (
          personality in ('auto','none','friendly','pragmatic')
        ),
        response_verbosity text not null default 'auto' check (
          response_verbosity in ('auto','low','medium','high')
        ),
        web_search_mode text not null default 'cached' check (
          web_search_mode in ('disabled','cached','live')
        ),
        context_scope text not null check (context_scope in ('project','board','objective')),
        local_notes_vault_id text check (
          local_notes_vault_id is null or length(local_notes_vault_id) = 64
        ),
        local_notes_vault_name text check (
          local_notes_vault_name is null or length(local_notes_vault_name) between 1 and 256
        ),
        instruction_revision_id text not null
          references project_chat_instruction_revisions(id),
        created_at text not null,
        updated_at text not null
      );
      create table if not exists project_chat_attempts (
        id text primary key,
        project_id text not null,
        session_id text not null references project_chat_sessions(id),
        user_message_id text not null unique
          references project_chat_messages(id) on delete cascade,
        retry_of_attempt_id text references project_chat_attempts(id),
        thread_id text check (thread_id is null or length(thread_id) between 1 and 256),
        turn_id text check (turn_id is null or length(turn_id) between 1 and 256),
        model_json text check (model_json is null or length(model_json) <= 4096),
        requested_model_id text check (
          requested_model_id is null or length(requested_model_id) between 1 and 256
        ),
        reasoning_option_id text check (
          reasoning_option_id is null or length(reasoning_option_id) between 1 and 128
        ),
        harness_mode text check (
          harness_mode is null or harness_mode in ('context','planner','reviewer')
        ),
        response_depth text check (
          response_depth is null or response_depth in ('concise','standard','deep')
        ),
        collaboration_mode_id text check (
          collaboration_mode_id is null or length(collaboration_mode_id) between 1 and 128
        ),
        personality text check (
          personality is null or personality in ('auto','none','friendly','pragmatic')
        ),
        response_verbosity text check (
          response_verbosity is null or response_verbosity in ('auto','low','medium','high')
        ),
        web_search_mode text check (
          web_search_mode is null or web_search_mode in ('disabled','cached','live')
        ),
        context_scope text check (
          context_scope is null or context_scope in ('project','board','objective')
        ),
        profile_version integer check (profile_version is null or profile_version >= 0),
        instruction_revision_id text check (
          instruction_revision_id is null or length(instruction_revision_id) = 36
        ),
        prompt_provenance_json text check (
          prompt_provenance_json is null or length(prompt_provenance_json) <= 16384
        ),
        status text not null check (
          status in ('starting','running','complete','failed','interrupted')
        ),
        error_code text check (
          error_code is null or error_code in (
            'codex_unavailable','invalid_response','application_interrupted','user_interrupted'
          )
        ),
        error_code_v2 text check (
          error_code_v2 is null or error_code_v2 in (
            'codex_unavailable','attachment_model_modality_unsupported','invalid_response',
            'application_interrupted','user_interrupted'
          )
        ),
        created_at text not null,
        updated_at text not null
      );
      create index if not exists project_chat_attempts_by_project
        on project_chat_attempts(project_id,created_at,id);
      create index if not exists project_chat_attempts_by_retry
        on project_chat_attempts(retry_of_attempt_id);
      create table if not exists project_chat_actions (
        id text primary key,
        message_id text not null references project_chat_messages(id) on delete cascade,
        project_id text not null,
        command_json text not null check (length(command_json) <= 4096),
        status text not null check (status in ('proposed','applying','applied','failed')),
        result_entity_id text,
        result_entity_version integer check (
          result_entity_version is null or result_entity_version > 0
        ),
        error_code text,
        created_at text not null,
        updated_at text not null
      );
      create index if not exists project_chat_actions_by_message
        on project_chat_actions(message_id,created_at,id);
    `);
      migrateLiteratureManualRelevance(database);
      migrateLiteratureWeakFingerprint(database);
      const literatureSearchColumns = database.pragma(
        'table_info(literature_search_runs)',
      ) as Array<{ name: string }>;
      if (!literatureSearchColumns.some((column) => column.name === 'conflict_count')) {
        database.exec(
          `alter table literature_search_runs add column conflict_count integer not null default 0
           check (conflict_count >= 0)`,
        );
      }
      migrateLiteratureDiscovery(database);
      migrateLiteratureDiscoveryCoverage(database);
      migrateLiteratureSearchTags(database);
      const sshConnectionColumns = database.pragma('table_info(ssh_connections)') as Array<{
        name: string;
      }>;
      if (!sshConnectionColumns.some((column) => column.name === 'direct_target_json')) {
        database.exec(
          `alter table ssh_connections add column direct_target_json text
           check (direct_target_json is null or length(direct_target_json) between 2 and 16384)`,
        );
      }
      database
        .prepare(
          `update project_chat_actions
           set status='failed',error_code='application_interrupted',updated_at=?
           where status='applying'`,
        )
        .run(new Date().toISOString());
      database
        .prepare(
          `update literature_search_runs
           set status='failed',completed_at=? where status='running'`,
        )
        .run(new Date().toISOString());
      const messageColumns = database.pragma('table_info(project_chat_messages)') as Array<{
        name: string;
      }>;
      if (!messageColumns.some((column) => column.name === 'attempt_id')) {
        database.exec(
          `alter table project_chat_messages add column attempt_id text
           check (attempt_id is null or length(attempt_id) = 36)`,
        );
      }
      const attemptColumns = database.pragma('table_info(project_chat_attempts)') as Array<{
        name: string;
      }>;
      const attemptMigrations = [
        [
          'session_id',
          'alter table project_chat_attempts add column session_id text references project_chat_sessions(id)',
        ],
        [
          'harness_mode',
          "alter table project_chat_attempts add column harness_mode text check (harness_mode is null or harness_mode in ('context','planner','reviewer'))",
        ],
        [
          'response_depth',
          "alter table project_chat_attempts add column response_depth text check (response_depth is null or response_depth in ('concise','standard','deep'))",
        ],
        [
          'collaboration_mode_id',
          'alter table project_chat_attempts add column collaboration_mode_id text check (collaboration_mode_id is null or length(collaboration_mode_id) between 1 and 128)',
        ],
        [
          'personality',
          "alter table project_chat_attempts add column personality text check (personality is null or personality in ('auto','none','friendly','pragmatic'))",
        ],
        [
          'response_verbosity',
          "alter table project_chat_attempts add column response_verbosity text check (response_verbosity is null or response_verbosity in ('auto','low','medium','high'))",
        ],
        [
          'web_search_mode',
          "alter table project_chat_attempts add column web_search_mode text check (web_search_mode is null or web_search_mode in ('disabled','cached','live'))",
        ],
        [
          'context_scope',
          "alter table project_chat_attempts add column context_scope text check (context_scope is null or context_scope in ('project','board','objective'))",
        ],
        [
          'profile_version',
          'alter table project_chat_attempts add column profile_version integer check (profile_version is null or profile_version >= 0)',
        ],
        [
          'instruction_revision_id',
          'alter table project_chat_attempts add column instruction_revision_id text check (instruction_revision_id is null or length(instruction_revision_id) = 36)',
        ],
        [
          'prompt_provenance_json',
          'alter table project_chat_attempts add column prompt_provenance_json text check (prompt_provenance_json is null or length(prompt_provenance_json) <= 16384)',
        ],
        [
          'error_code_v2',
          "alter table project_chat_attempts add column error_code_v2 text check (error_code_v2 is null or error_code_v2 in ('codex_unavailable','attachment_model_modality_unsupported','invalid_response','application_interrupted','user_interrupted'))",
        ],
      ] as const;
      for (const [name, statement] of attemptMigrations) {
        if (!attemptColumns.some((column) => column.name === name)) database.exec(statement);
      }
      const profileColumns = database.pragma('table_info(project_chat_profiles)') as Array<{
        name: string;
      }>;
      const profileNeedsNativeBackfill = [
        'collaboration_mode_id',
        'personality',
        'response_verbosity',
      ].some((name) => !profileColumns.some((column) => column.name === name));
      const profileMigrations = [
        [
          'collaboration_mode_id',
          'alter table project_chat_profiles add column collaboration_mode_id text check (collaboration_mode_id is null or length(collaboration_mode_id) between 1 and 128)',
        ],
        [
          'personality',
          "alter table project_chat_profiles add column personality text not null default 'auto' check (personality in ('auto','none','friendly','pragmatic'))",
        ],
        [
          'response_verbosity',
          "alter table project_chat_profiles add column response_verbosity text not null default 'auto' check (response_verbosity in ('auto','low','medium','high'))",
        ],
        [
          'web_search_mode',
          "alter table project_chat_profiles add column web_search_mode text not null default 'cached' check (web_search_mode in ('disabled','cached','live'))",
        ],
        [
          'local_notes_vault_id',
          'alter table project_chat_profiles add column local_notes_vault_id text check (local_notes_vault_id is null or length(local_notes_vault_id) = 64)',
        ],
        [
          'local_notes_vault_name',
          'alter table project_chat_profiles add column local_notes_vault_name text check (local_notes_vault_name is null or length(local_notes_vault_name) between 1 and 256)',
        ],
      ] as const;
      for (const [name, statement] of profileMigrations) {
        if (!profileColumns.some((column) => column.name === name)) database.exec(statement);
      }
      if (profileNeedsNativeBackfill) {
        database.exec(`
          update project_chat_profiles
          set collaboration_mode_id=case harness_mode
            when 'planner' then 'plan'
            else 'default'
          end
        `);
        database.exec(`
          update project_chat_profiles
          set response_verbosity=case response_depth
            when 'concise' then 'low'
            when 'deep' then 'high'
            else 'medium'
          end
        `);
      }
      database.exec(`
        create index if not exists project_chat_messages_by_attempt
          on project_chat_messages(attempt_id,role);
        create unique index if not exists project_chat_one_assistant_per_attempt
          on project_chat_messages(attempt_id)
          where attempt_id is not null and role='assistant';
      `);
      const migrationDatabase = database as Database.Database;
      const sessionMigrationApplied = migrationDatabase
        .prepare('select 1 from local_schema_migrations where id=?')
        .get(PROJECT_CHAT_SESSIONS_MIGRATION);
      if (!sessionMigrationApplied) {
        migrationDatabase
          .transaction(() => {
            const projects = migrationDatabase
              .prepare(
                `select project_id from project_chat_messages
                 union select project_id from project_chat_attempts
                 union select project_id from project_chat_profiles`,
              )
              .all() as Array<{ project_id: string }>;
            const selectDefault = migrationDatabase.prepare(
              'select id from project_chat_sessions where project_id=? and is_default=1',
            );
            const selectMessages = migrationDatabase.prepare(
              `select id from project_chat_messages
               where project_id=? order by created_at asc,id asc`,
            );
            const insertMembership = migrationDatabase.prepare(
              `insert or ignore into project_chat_session_messages(session_id,message_id,ordinal)
               values(?,?,?)`,
            );
            const assignAttempt = migrationDatabase.prepare(
              'update project_chat_attempts set session_id=? where project_id=? and session_id is null',
            );
            for (const project of projects) {
              let defaultRow = selectDefault.get(project.project_id) as { id: string } | undefined;
              if (!defaultRow) {
                const createdAt = new Date().toISOString();
                const session = ProjectChatSessionSchema.parse({
                  id: randomUUID(),
                  projectId: project.project_id,
                  title: DEFAULT_PROJECT_CHAT_SESSION_TITLE,
                  isDefault: true,
                  createdAt,
                  updatedAt: createdAt,
                });
                insertProjectChatSession(migrationDatabase, session);
                defaultRow = { id: session.id };
              }
              const messages = selectMessages.all(project.project_id) as Array<{ id: string }>;
              for (const [index, message] of messages.entries()) {
                insertMembership.run(defaultRow.id, message.id, index + 1);
              }
              assignAttempt.run(defaultRow.id, project.project_id);
            }
            const missingAttemptSession = migrationDatabase
              .prepare('select 1 from project_chat_attempts where session_id is null limit 1')
              .get();
            if (missingAttemptSession) throw new Error('chat_session_migration_incomplete');
            migrationDatabase
              .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
              .run(PROJECT_CHAT_SESSIONS_MIGRATION, new Date().toISOString());
          })
          .immediate();
      }
      const outboxColumns = database.pragma('table_info(sync_outbox)') as Array<{ name: string }>;
      if (!outboxColumns.some((column) => column.name === 'workspace_revision')) {
        database.exec(
          'alter table sync_outbox add column workspace_revision integer check (workspace_revision is null or workspace_revision > 0)',
        );
      }
      const initializedDatabase = database;
      initializedDatabase.transaction(() => {
        reconcileInterruptedChatAttempts(initializedDatabase, new Date().toISOString());
        this.workspaceOutboxOrderingReady = backfillLegacyWorkspaceRevisions(initializedDatabase);
        if (this.workspaceOutboxOrderingReady) reconcileWorkspaceOutboxStatus(initializedDatabase);
      })();
      this.database = initializedDatabase;
    } catch (error) {
      this.workspaceOutboxOrderingReady = false;
      try {
        database?.close();
      } catch {
        // Preserve the original open or migration error.
      }
      throw error;
    } finally {
      key.fill(0);
    }
  }

  cache(scope: string, key: string, value: unknown, entityVersion = 0) {
    this.require()
      .prepare(
        'insert into cache_records(scope,key,value_json,entity_version,updated_at) values(?,?,?,?,?) on conflict(scope,key) do update set value_json=excluded.value_json,entity_version=excluded.entity_version,updated_at=excluded.updated_at',
      )
      .run(scope, key, JSON.stringify(value), entityVersion, new Date().toISOString());
  }

  get(scope: string, key: string) {
    const row = this.require()
      .prepare(
        'select value_json,entity_version,updated_at from cache_records where scope=? and key=?',
      )
      .get(scope, key) as
      { value_json: string; entity_version: number; updated_at: string } | undefined;
    return row
      ? {
          value: JSON.parse(row.value_json) as unknown,
          entityVersion: row.entity_version,
          updatedAt: row.updated_at,
        }
      : null;
  }

  loadWorkspaceState(): WorkspaceSnapshot | null {
    const row = this.require()
      .prepare('select state_json from local_workspace_state where singleton_id=1')
      .get() as { state_json: string } | undefined;
    return row ? (JSON.parse(row.state_json) as WorkspaceSnapshot) : null;
  }

  commitWorkspaceState(state: WorkspaceSnapshot, operation: WorkspaceOperation) {
    if (!this.workspaceOutboxOrderingReady) throw new WorkspaceDataRecoveryError();
    const stateJson = JSON.stringify(state);
    const operationJson = JSON.stringify(operation);
    if (Buffer.byteLength(stateJson, 'utf8') > MAX_WORKSPACE_STATE_BYTES) {
      throw new Error('workspace_state_too_large');
    }
    if (operation.id !== operation.idempotencyKey) {
      throw new Error('workspace_operation_id_mismatch');
    }
    if (operation.workspaceRevision !== state.revision) {
      throw new Error('workspace_operation_sequence_mismatch');
    }

    const database = this.require();
    database.transaction(() => {
      const expectedRevision = state.revision - 1;
      const stateCommit = database
        .prepare(
          `insert into local_workspace_state(
             singleton_id,schema_version,revision,state_json,updated_at
           )
           select 1,1,?,?,?
           where ?=1 or exists(
             select 1 from local_workspace_state
             where singleton_id=1 and revision=?
           )
           on conflict(singleton_id) do update set
             schema_version=excluded.schema_version,
             revision=excluded.revision,
             state_json=excluded.state_json,
             updated_at=excluded.updated_at
           where local_workspace_state.revision=?`,
        )
        .run(
          state.revision,
          stateJson,
          operation.createdAt,
          state.revision,
          expectedRevision,
          expectedRevision,
        );
      if (stateCommit.changes !== 1) throw new Error('workspace_revision_conflict');
      database
        .prepare(
          `insert into sync_outbox(
             id,scope,operation_json,base_version,workspace_revision,created_at,delivered_at
           ) values(?,?,?,?,?,?,null)`,
        )
        .run(
          operation.idempotencyKey,
          operation.scope,
          operationJson,
          operation.baseVersion,
          operation.workspaceRevision,
          operation.createdAt,
        );
      database
        .prepare(
          `insert into local_workspace_outbox_status(
             singleton_id,pending_count,latest_workspace_revision
           ) values(1,1,?)
           on conflict(singleton_id) do update set
             pending_count=local_workspace_outbox_status.pending_count+1,
             latest_workspace_revision=excluded.latest_workspace_revision`,
        )
        .run(operation.workspaceRevision);
    })();
  }

  pendingWorkspaceChanges(): readonly WorkspaceOperation[] {
    if (!this.workspaceOutboxOrderingReady) throw new WorkspaceDataRecoveryError();
    const rows = this.require()
      .prepare(
        `select operation_json from sync_outbox
         where delivered_at is null and scope like 'workspace:%'
         order by workspace_revision asc,created_at asc,id asc`,
      )
      .all() as Array<{ operation_json: string }>;
    try {
      return rows
        .map((row) => JSON.parse(row.operation_json) as WorkspaceOperation)
        .sort((left, right) => left.workspaceRevision - right.workspaceRevision);
    } catch {
      throw new WorkspaceDataRecoveryError();
    }
  }

  pendingWorkspaceSummary(): WorkspacePendingSummary {
    const database = this.require();
    return database.transaction(() => {
      this.workspaceOutboxOrderingReady = backfillLegacyWorkspaceRevisions(database);
      if (!this.workspaceOutboxOrderingReady) throw new WorkspaceDataRecoveryError();
      return reconcileWorkspaceOutboxStatus(database);
    })();
  }

  recordModelCatalog(catalog: ModelCatalog) {
    this.require()
      .prepare(
        'insert into model_catalog_snapshots(id,provider,catalog_json,captured_at) values(?,?,?,?) on conflict(id) do nothing',
      )
      .run(catalog.catalogVersion, catalog.providerId, JSON.stringify(catalog), catalog.fetchedAt);
  }

  recordModelInvocation(threadId: string, turnId: string, invocation: ModelInvocation) {
    const updatedAt = new Date().toISOString();
    this.require()
      .prepare(
        `insert into model_invocations(
          invocation_id,thread_id,turn_id,requested_model_id,resolved_model_id,
          catalog_version,reasoning_option_id,started_at,updated_at
        ) values(?,?,?,?,?,?,?,?,?)
        on conflict(invocation_id) do update set
          resolved_model_id=excluded.resolved_model_id,
          updated_at=excluded.updated_at`,
      )
      .run(
        invocation.invocationId,
        threadId,
        turnId,
        invocation.requestedModelId,
        invocation.resolvedModelId,
        invocation.catalogVersion,
        invocation.reasoningOptionId,
        invocation.startedAt,
        updatedAt,
      );
  }

  saveMessage(input: ProjectChatMessage) {
    const message = ProjectChatMessageSchema.parse(structuredClone(input));
    const database = this.require();
    const session = this.ensureDefaultProjectChatSession(message.projectId);
    database.transaction(() => {
      insertProjectChatMessage(database, message);
      appendProjectChatSessionMessage(database, session.id, message.id);
      touchProjectChatSession(database, session.id, message.completedAt);
    })();
  }

  ensureDefaultProjectChatSession(projectId: string): ProjectChatSession {
    const database = this.require();
    const existing = database
      .prepare(
        `select id,project_id,title,is_default,parent_session_id,branched_from_message_id,
                created_at,updated_at
         from project_chat_sessions where project_id=? and is_default=1`,
      )
      .get(projectId) as ProjectChatSessionRow | undefined;
    if (existing) return toChatSession(existing);
    const now = new Date().toISOString();
    const session = ProjectChatSessionSchema.parse({
      id: randomUUID(),
      projectId,
      title: DEFAULT_PROJECT_CHAT_SESSION_TITLE,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    database.transaction(() => insertProjectChatSession(database, session)).immediate();
    return session;
  }

  listProjectChatSessions(projectId: string): ProjectChatSession[] {
    this.ensureDefaultProjectChatSession(projectId);
    return (
      this.require()
        .prepare(
          `select id,project_id,title,is_default,parent_session_id,branched_from_message_id,
                  created_at,updated_at
           from project_chat_sessions where project_id=?
           order by is_default desc,updated_at desc,id asc`,
        )
        .all(projectId) as ProjectChatSessionRow[]
    ).map(toChatSession);
  }

  getProjectChatSession(projectId: string, sessionId: string): ProjectChatSession | null {
    const row = this.require()
      .prepare(
        `select id,project_id,title,is_default,parent_session_id,branched_from_message_id,
                created_at,updated_at
         from project_chat_sessions where project_id=? and id=?`,
      )
      .get(projectId, sessionId) as ProjectChatSessionRow | undefined;
    return row ? toChatSession(row) : null;
  }

  createProjectChatSession(projectId: string, title?: string): ProjectChatSession {
    const database = this.require();
    this.ensureDefaultProjectChatSession(projectId);
    return database
      .transaction(() => {
        const count = database
          .prepare('select count(*) as count from project_chat_sessions where project_id=?')
          .get(projectId) as { count: number };
        if (count.count >= PROJECT_CHAT_MAX_SESSIONS_PER_PROJECT) {
          throw new Error('chat_session_limit_reached');
        }
        const now = new Date().toISOString();
        const rootTitles = new Set(
          (
            database
              .prepare(
                `select title from project_chat_sessions
                 where project_id=? and parent_session_id is null`,
              )
              .all(projectId) as Array<{ title: string }>
          ).map((row) => row.title),
        );
        let generatedTitle = 'New chat';
        for (let suffix = 2; rootTitles.has(generatedTitle); suffix += 1) {
          generatedTitle = `New chat ${suffix}`;
        }
        const session = ProjectChatSessionSchema.parse({
          id: randomUUID(),
          projectId,
          title: title ?? generatedTitle,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        });
        insertProjectChatSession(database, session);
        return session;
      })
      .immediate();
  }

  branchProjectChatSession(input: {
    projectId: string;
    sourceSessionId: string;
    branchFromMessageId: string;
    title?: string;
  }): ProjectChatSession {
    const database = this.require();
    return database
      .transaction(() => {
        const source = this.getProjectChatSession(input.projectId, input.sourceSessionId);
        if (!source) throw new Error('chat_session_not_found');
        const visitedSessionIds = new Set<string>();
        let lineageCursor = source;
        let sourceDepth = 0;
        while (lineageCursor.parentSessionId) {
          if (visitedSessionIds.has(lineageCursor.id)) {
            throw new Error('chat_branch_lineage_invalid');
          }
          visitedSessionIds.add(lineageCursor.id);
          const parent = this.getProjectChatSession(input.projectId, lineageCursor.parentSessionId);
          if (!parent) throw new Error('chat_branch_lineage_invalid');
          lineageCursor = parent;
          sourceDepth += 1;
          if (sourceDepth >= PROJECT_CHAT_MAX_BRANCH_DEPTH) {
            throw new Error('chat_branch_limit_reached');
          }
        }
        if (visitedSessionIds.has(lineageCursor.id)) {
          throw new Error('chat_branch_lineage_invalid');
        }
        const branchPoint = database
          .prepare(
            `select sm.ordinal,m.status,
                    case
                      when m.attempt_id is null then 1
                      when exists(
                        select 1 from project_chat_attempts a
                        where a.id=m.attempt_id and a.project_id=m.project_id
                          and a.status in ('complete','failed','interrupted')
                      ) then 1 else 0
                    end as attempt_terminal
             from project_chat_session_messages sm
             join project_chat_messages m on m.id=sm.message_id
             where sm.session_id=? and sm.message_id=? and m.project_id=?`,
          )
          .get(input.sourceSessionId, input.branchFromMessageId, input.projectId) as
          | {
              ordinal: number;
              status: ProjectChatMessage['status'];
              attempt_terminal: number;
            }
          | undefined;
        if (!branchPoint) throw new Error('chat_branch_message_not_found');
        if (branchPoint.status !== 'complete' || branchPoint.attempt_terminal !== 1) {
          throw new Error('chat_branch_point_invalid');
        }
        if (branchPoint.ordinal > PROJECT_CHAT_MAX_BRANCH_MESSAGES) {
          throw new Error('chat_branch_limit_reached');
        }
        const effectivePrefix = database
          .prepare(
            `select count(*) as count,min(ordinal) as first_ordinal,max(ordinal) as last_ordinal
             from project_chat_session_messages where session_id=? and ordinal<=?`,
          )
          .get(source.id, branchPoint.ordinal) as {
          count: number;
          first_ordinal: number | null;
          last_ordinal: number | null;
        };
        if (
          effectivePrefix.count !== branchPoint.ordinal ||
          effectivePrefix.first_ordinal !== 1 ||
          effectivePrefix.last_ordinal !== branchPoint.ordinal
        ) {
          throw new Error('chat_branch_lineage_invalid');
        }
        const count = database
          .prepare('select count(*) as count from project_chat_sessions where project_id=?')
          .get(input.projectId) as { count: number };
        if (count.count >= PROJECT_CHAT_MAX_SESSIONS_PER_PROJECT) {
          throw new Error('chat_session_limit_reached');
        }
        const now = new Date().toISOString();
        const session = ProjectChatSessionSchema.parse({
          id: randomUUID(),
          projectId: input.projectId,
          title: input.title ?? `Branch · ${source.title}`.slice(0, 120),
          isDefault: false,
          parentSessionId: source.id,
          branchedFromMessageId: input.branchFromMessageId,
          createdAt: now,
          updatedAt: now,
        });
        insertProjectChatSession(database, session);
        const copied = database
          .prepare(
            `insert into project_chat_session_messages(session_id,message_id,ordinal)
             select ?,message_id,ordinal from project_chat_session_messages
             where session_id=? and ordinal<=? order by ordinal asc`,
          )
          .run(session.id, source.id, branchPoint.ordinal);
        if (copied.changes !== effectivePrefix.count) {
          throw new Error('chat_branch_lineage_invalid');
        }
        return session;
      })
      .immediate();
  }

  renameProjectChatSession(
    projectId: string,
    sessionId: string,
    title: string,
  ): ProjectChatSession | null {
    const updatedAt = new Date().toISOString();
    const changed = this.require()
      .prepare(
        `update project_chat_sessions set title=?,updated_at=?
         where project_id=? and id=?`,
      )
      .run(title, updatedAt, projectId, sessionId).changes;
    return changed === 1 ? this.getProjectChatSession(projectId, sessionId) : null;
  }

  getProjectChatProfile(projectId: string): ProjectChatProfile {
    const row = this.require()
      .prepare(
        `select p.project_id,p.version,p.harness_mode,p.response_depth,
                p.collaboration_mode_id,p.personality,p.response_verbosity,p.web_search_mode,
                p.context_scope,
                p.local_notes_vault_id,p.local_notes_vault_name,
                p.instruction_revision_id,p.updated_at,r.content,r.content_sha256,r.created_at
         from project_chat_profiles p
         join project_chat_instruction_revisions r on r.id=p.instruction_revision_id
         where p.project_id=?`,
      )
      .get(projectId) as ProjectChatProfileRow | undefined;
    return row ? toChatProfile(row) : defaultProjectChatProfile(projectId);
  }

  updateProjectChatProfile(input: UpdateProjectChatProfileInput): ProjectChatProfile | null {
    const command = UpdateProjectChatProfileInputSchema.parse(structuredClone(input));
    const database = this.require();
    const now = new Date().toISOString();
    const nextVersion = command.expectedVersion + 1;
    const instructionRevisionId = randomUUID();
    const instructionSha256 = createHash('sha256')
      .update(command.customInstructions, 'utf8')
      .digest('hex');
    const conflict = new Error('chat_profile_conflict');
    try {
      database
        .transaction(() => {
          const current = database
            .prepare('select version from project_chat_profiles where project_id=?')
            .get(command.projectId) as { version: number } | undefined;
          if ((current?.version ?? 0) !== command.expectedVersion) throw conflict;
          database
            .prepare(
              `insert into project_chat_instruction_revisions(
               id,project_id,revision,content,content_sha256,created_at
             ) values(?,?,?,?,?,?)`,
            )
            .run(
              instructionRevisionId,
              command.projectId,
              nextVersion,
              command.customInstructions,
              instructionSha256,
              now,
            );
          const changed = database
            .prepare(
              `insert into project_chat_profiles(
               project_id,version,harness_mode,response_depth,collaboration_mode_id,
               personality,response_verbosity,web_search_mode,context_scope,
               local_notes_vault_id,local_notes_vault_name,
               instruction_revision_id,created_at,updated_at
             ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             on conflict(project_id) do update set
               version=excluded.version,
               harness_mode=excluded.harness_mode,
               response_depth=excluded.response_depth,
               collaboration_mode_id=excluded.collaboration_mode_id,
               personality=excluded.personality,
               response_verbosity=excluded.response_verbosity,
               web_search_mode=excluded.web_search_mode,
               context_scope=excluded.context_scope,
               local_notes_vault_id=excluded.local_notes_vault_id,
               local_notes_vault_name=excluded.local_notes_vault_name,
               instruction_revision_id=excluded.instruction_revision_id,
               updated_at=excluded.updated_at
             where project_chat_profiles.version=?`,
            )
            .run(
              command.projectId,
              nextVersion,
              command.harnessMode,
              command.responseDepth,
              command.collaborationModeId,
              command.personality,
              command.responseVerbosity,
              command.webSearchMode,
              command.contextScope,
              command.localNotesVault?.id ?? null,
              command.localNotesVault?.name ?? null,
              instructionRevisionId,
              now,
              now,
              command.expectedVersion,
            ).changes;
          if (changed !== 1) throw conflict;
        })
        .immediate();
    } catch (error) {
      if (error === conflict) return null;
      throw error;
    }
    return this.getProjectChatProfile(command.projectId);
  }

  beginChatAttempt(input: ProjectChatAttempt, inputUserMessage: ProjectChatMessage) {
    let attempt = ProjectChatAttemptSchema.parse(structuredClone(input));
    const parsedMessage = ProjectChatMessageSchema.parse(structuredClone(inputUserMessage));
    if (attempt.status !== 'starting') throw new Error('chat_attempt_must_start_in_starting_state');
    if (
      parsedMessage.role !== 'user' ||
      parsedMessage.status !== 'complete' ||
      parsedMessage.actions.length > 0
    ) {
      throw new Error('invalid_chat_attempt_user_message');
    }
    if (
      attempt.projectId !== parsedMessage.projectId ||
      attempt.userMessageId !== parsedMessage.id ||
      (parsedMessage.attemptId !== undefined && parsedMessage.attemptId !== attempt.id)
    ) {
      throw new Error('chat_attempt_message_mismatch');
    }
    const userMessage = ProjectChatMessageSchema.parse({
      ...parsedMessage,
      attemptId: attempt.id,
    });
    const database = this.require();
    const session = attempt.sessionId
      ? this.getProjectChatSession(attempt.projectId, attempt.sessionId)
      : this.ensureDefaultProjectChatSession(attempt.projectId);
    if (!session) throw new Error('chat_session_not_found');
    attempt = ProjectChatAttemptSchema.parse({ ...attempt, sessionId: session.id });
    database.transaction(() => {
      if (attempt.retryOfAttemptId) {
        const retryTarget = database
          .prepare(
            `select 1 from project_chat_attempts a
             join project_chat_session_messages sm on sm.message_id=a.user_message_id
             where a.project_id=? and a.id=? and sm.session_id=?`,
          )
          .get(attempt.projectId, attempt.retryOfAttemptId, session.id);
        if (!retryTarget) throw new Error('chat_attempt_retry_target_not_found');
      }
      insertProjectChatMessage(database, userMessage);
      appendProjectChatSessionMessage(database, session.id, userMessage.id);
      insertProjectChatAttempt(database, attempt);
      touchProjectChatSession(database, session.id, attempt.updatedAt);
    })();
  }

  markChatAttemptRunning(input: ProjectChatAttempt) {
    let attempt = ProjectChatAttemptSchema.parse(structuredClone(input));
    if (!attempt.sessionId) {
      const durable = this.require()
        .prepare(
          `select session_id from project_chat_attempts
           where project_id=? and id=? and user_message_id=?`,
        )
        .get(attempt.projectId, attempt.id, attempt.userMessageId) as
        { session_id: string | null } | undefined;
      if (durable?.session_id) {
        attempt = ProjectChatAttemptSchema.parse({ ...attempt, sessionId: durable.session_id });
      }
    }
    if (
      attempt.status !== 'running' ||
      !attempt.sessionId ||
      !attempt.threadId ||
      !attempt.turnId ||
      !attempt.model ||
      attempt.errorCode
    ) {
      throw new Error('invalid_running_chat_attempt');
    }
    const result = this.require()
      .prepare(
        `update project_chat_attempts set
           thread_id=?,turn_id=?,model_json=?,status='running',error_code=null,
           error_code_v2=null,updated_at=?
         where project_id=? and session_id=? and id=? and user_message_id=? and status='starting'`,
      )
      .run(
        attempt.threadId,
        attempt.turnId,
        JSON.stringify(attempt.model),
        attempt.updatedAt,
        attempt.projectId,
        attempt.sessionId,
        attempt.id,
        attempt.userMessageId,
      );
    if (result.changes !== 1) throw new Error('chat_attempt_state_conflict');
  }

  finishChatAttempt(input: ProjectChatAttempt, inputAssistantMessage: ProjectChatMessage) {
    let requestedTerminal = ProjectChatAttemptSchema.parse(structuredClone(input));
    if (!['complete', 'failed', 'interrupted'].includes(requestedTerminal.status)) {
      throw new Error('chat_attempt_terminal_state_required');
    }
    const database = this.require();
    database.transaction(() => {
      const currentRow = database
        .prepare(
          `select id,project_id,session_id,user_message_id,retry_of_attempt_id,thread_id,turn_id,model_json,
                  requested_model_id,reasoning_option_id,harness_mode,response_depth,
                  collaboration_mode_id,personality,response_verbosity,web_search_mode,
                  context_scope,profile_version,
                  instruction_revision_id,prompt_provenance_json,status,error_code,error_code_v2,
                  created_at,updated_at
           from project_chat_attempts where project_id=? and id=?`,
        )
        .get(requestedTerminal.projectId, requestedTerminal.id) as
        ProjectChatAttemptRow | undefined;
      if (!currentRow || !['starting', 'running'].includes(currentRow.status)) {
        throw new Error('chat_attempt_state_conflict');
      }
      const current = toChatAttempt(currentRow);
      if (!requestedTerminal.sessionId && current.sessionId) {
        requestedTerminal = ProjectChatAttemptSchema.parse({
          ...requestedTerminal,
          sessionId: current.sessionId,
        });
      }
      if (
        current.userMessageId !== requestedTerminal.userMessageId ||
        current.sessionId !== requestedTerminal.sessionId ||
        current.retryOfAttemptId !== requestedTerminal.retryOfAttemptId ||
        current.requestedModelId !== requestedTerminal.requestedModelId ||
        current.reasoningOptionId !== requestedTerminal.reasoningOptionId ||
        current.harnessMode !== requestedTerminal.harnessMode ||
        current.responseDepth !== requestedTerminal.responseDepth ||
        current.collaborationModeId !== requestedTerminal.collaborationModeId ||
        current.personality !== requestedTerminal.personality ||
        current.responseVerbosity !== requestedTerminal.responseVerbosity ||
        current.webSearchMode !== requestedTerminal.webSearchMode ||
        current.contextScope !== requestedTerminal.contextScope ||
        current.profileVersion !== requestedTerminal.profileVersion ||
        current.instructionRevisionId !== requestedTerminal.instructionRevisionId ||
        JSON.stringify(current.promptProvenance) !==
          JSON.stringify(requestedTerminal.promptProvenance) ||
        current.createdAt !== requestedTerminal.createdAt
      ) {
        throw new Error('chat_attempt_identity_mismatch');
      }
      const terminal = ProjectChatAttemptSchema.parse({
        ...requestedTerminal,
        threadId: requestedTerminal.threadId ?? current.threadId,
        turnId: requestedTerminal.turnId ?? current.turnId,
        model: requestedTerminal.model ?? current.model,
      });
      const parsedMessage = ProjectChatMessageSchema.parse(structuredClone(inputAssistantMessage));
      const expectedMessageStatus =
        terminal.status === 'complete'
          ? 'complete'
          : terminal.status === 'failed'
            ? 'failed'
            : 'interrupted';
      if (
        parsedMessage.role !== 'assistant' ||
        parsedMessage.projectId !== terminal.projectId ||
        parsedMessage.status !== expectedMessageStatus ||
        (parsedMessage.attemptId !== undefined && parsedMessage.attemptId !== terminal.id)
      ) {
        throw new Error('chat_attempt_assistant_message_mismatch');
      }
      const assistantMessage = ProjectChatMessageSchema.parse({
        ...parsedMessage,
        attemptId: terminal.id,
        turnId: parsedMessage.turnId ?? terminal.turnId,
        model: parsedMessage.model ?? terminal.model,
      });
      const updated = database
        .prepare(
          `update project_chat_attempts set
             thread_id=?,turn_id=?,model_json=?,status=?,error_code=?,error_code_v2=?,updated_at=?
           where project_id=? and id=? and user_message_id=? and status in ('starting','running')`,
        )
        .run(
          terminal.threadId ?? null,
          terminal.turnId ?? null,
          terminal.model ? JSON.stringify(terminal.model) : null,
          terminal.status,
          legacyProjectChatAttemptErrorCode(terminal.errorCode),
          terminal.errorCode ?? null,
          terminal.updatedAt,
          terminal.projectId,
          terminal.id,
          terminal.userMessageId,
        );
      if (updated.changes !== 1) throw new Error('chat_attempt_state_conflict');
      insertProjectChatMessage(database, assistantMessage);
      if (!terminal.sessionId) throw new Error('chat_attempt_session_missing');
      appendProjectChatSessionMessage(database, terminal.sessionId, assistantMessage.id);
      touchProjectChatSession(database, terminal.sessionId, terminal.updatedAt);
    })();
  }

  getChatAttempt(projectId: string, sessionId: string, attemptId?: string) {
    const resolvedAttemptId = attemptId ?? sessionId;
    const resolvedSessionId = attemptId
      ? sessionId
      : this.ensureDefaultProjectChatSession(projectId).id;
    const row = this.require()
      .prepare(
        `select a.id,a.project_id,a.session_id,a.user_message_id,a.retry_of_attempt_id,
                a.thread_id,a.turn_id,a.model_json,a.requested_model_id,a.reasoning_option_id,
                a.harness_mode,a.response_depth,a.collaboration_mode_id,a.personality,
                a.response_verbosity,a.web_search_mode,a.context_scope,a.profile_version,
                a.instruction_revision_id,
                a.prompt_provenance_json,a.status,a.error_code,a.error_code_v2,
                a.created_at,a.updated_at
         from project_chat_attempts a
         join project_chat_session_messages sm on sm.message_id=a.user_message_id
         where a.project_id=? and a.id=? and sm.session_id=?`,
      )
      .get(projectId, resolvedAttemptId, resolvedSessionId) as ProjectChatAttemptRow | undefined;
    return row ? toChatAttempt(row) : null;
  }

  snapshot(projectId: string, requestedSessionId?: string): ProjectChatSnapshot {
    const database = this.require();
    const session = requestedSessionId
      ? this.getProjectChatSession(projectId, requestedSessionId)
      : this.ensureDefaultProjectChatSession(projectId);
    if (!session) throw new Error('chat_session_not_found');
    const sessions = this.listProjectChatSessions(projectId);
    const rows = database
      .prepare(
        `select * from (
           select m.id,m.project_id,m.role,m.content,m.status,m.attempt_id,m.turn_id,
                  m.model_json,m.created_at,m.completed_at,sm.ordinal
           from project_chat_session_messages sm
           join project_chat_messages m on m.id=sm.message_id
           where sm.session_id=? and m.project_id=?
           order by sm.ordinal desc limit 250
         ) order by ordinal asc`,
      )
      .all(session.id, projectId) as ProjectChatMessageRow[];
    const actionsByMessage = new Map<string, ProjectChatAction[]>();
    const attempts = database
      .prepare(
        `select * from (
           select a.id,a.project_id,a.session_id,a.user_message_id,a.retry_of_attempt_id,
                  a.thread_id,a.turn_id,a.model_json,a.requested_model_id,a.reasoning_option_id,
                  a.harness_mode,a.response_depth,a.collaboration_mode_id,a.personality,
                  a.response_verbosity,a.web_search_mode,a.context_scope,a.profile_version,
                  a.instruction_revision_id,
                  a.prompt_provenance_json,a.status,a.error_code,a.error_code_v2,
                  a.created_at,a.updated_at,sm.ordinal
           from project_chat_attempts a
           join project_chat_session_messages sm on sm.message_id=a.user_message_id
           where sm.session_id=? and a.project_id=?
           order by sm.ordinal desc limit 500
         ) order by ordinal asc`,
      )
      .all(session.id, projectId) as ProjectChatAttemptRow[];
    const actionStatement = database.prepare(
      `select id,message_id,project_id,command_json,status,result_entity_id,
              result_entity_version,error_code,created_at,updated_at
       from project_chat_actions where message_id=? order by created_at asc,id asc`,
    );
    for (const row of rows) {
      const actions = (actionStatement.all(row.id) as ProjectChatActionRow[]).map(toChatAction);
      actionsByMessage.set(row.id, actions);
    }
    return ProjectChatSnapshotSchema.parse({
      schemaVersion: 1,
      projectId,
      session,
      sessions,
      attempts: attempts.map(toChatAttempt),
      messages: rows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        role: row.role,
        content: row.content,
        status: row.status,
        ...(row.attempt_id ? { attemptId: row.attempt_id } : {}),
        ...(row.turn_id ? { turnId: row.turn_id } : {}),
        ...(row.model_json ? { model: JSON.parse(row.model_json) as Record<string, unknown> } : {}),
        actions: actionsByMessage.get(row.id) ?? [],
        createdAt: row.created_at,
        completedAt: row.completed_at,
      })),
    });
  }

  getAction(projectId: string, sessionId: string, actionId?: string) {
    const resolvedActionId = actionId ?? sessionId;
    const resolvedSessionId = actionId
      ? sessionId
      : this.ensureDefaultProjectChatSession(projectId).id;
    const row = this.require()
      .prepare(
        `select a.id,a.message_id,a.project_id,a.command_json,a.status,a.result_entity_id,
                a.result_entity_version,a.error_code,a.created_at,a.updated_at
         from project_chat_actions a
         join project_chat_session_messages sm on sm.message_id=a.message_id
         where a.project_id=? and a.id=? and sm.session_id=?`,
      )
      .get(projectId, resolvedActionId, resolvedSessionId) as ProjectChatActionRow | undefined;
    return row ? toChatAction(row) : null;
  }

  claimAction(projectId: string, actionId: string, updatedAt: string) {
    return (
      this.require()
        .prepare(
          `update project_chat_actions set status='applying',updated_at=?
           where project_id=? and id=? and status='proposed'`,
        )
        .run(updatedAt, projectId, actionId).changes === 1
    );
  }

  finishAction(input: ProjectChatAction) {
    const action = ProjectChatActionSchema.parse(structuredClone(input));
    if (action.status !== 'applied' && action.status !== 'failed') {
      throw new Error('invalid_chat_action_terminal_status');
    }
    const result = this.require()
      .prepare(
        `update project_chat_actions set
           status=?,result_entity_id=?,result_entity_version=?,error_code=?,updated_at=?
         where project_id=? and id=? and status='applying'`,
      )
      .run(
        action.status,
        action.resultEntityId ?? null,
        action.resultEntityVersion ?? null,
        action.errorCode ?? null,
        action.updatedAt,
        action.projectId,
        action.id,
      );
    if (result.changes !== 1) throw new Error('chat_action_state_conflict');
  }

  listExperimentIdeas(projectId: string): ExperimentIdea[] {
    const rows = this.require()
      .prepare(
        `select * from experiment_ideas
         where project_id=? order by created_at asc,id asc`,
      )
      .all(projectId) as ExperimentIdeaRow[];
    return rows.map(toExperimentIdea);
  }

  listExperimentMetricPoints(projectId: string): ExperimentMetricPoint[] {
    const rows = this.require()
      .prepare(
        `select * from experiment_metric_points
         where project_id=? order by sequence asc`,
      )
      .all(projectId) as ExperimentMetricPointRow[];
    return rows.map(toExperimentMetricPoint);
  }

  getExperimentIdea(projectId: string, ideaId: string): ExperimentIdea | null {
    const row = this.require()
      .prepare('select * from experiment_ideas where project_id=? and id=?')
      .get(projectId, ideaId) as ExperimentIdeaRow | undefined;
    return row ? toExperimentIdea(row) : null;
  }

  createExperimentIdea(input: ExperimentIdea) {
    const idea = ExperimentIdeaSchema.parse(structuredClone(input));
    const database = this.require();
    return database
      .transaction(() => {
        const duplicate = database
          .prepare('select 1 from experiment_ideas where id=?')
          .get(idea.id);
        if (duplicate) return false;
        if (
          idea.parentIdeaId &&
          !database
            .prepare('select 1 from experiment_ideas where project_id=? and id=?')
            .get(idea.projectId, idea.parentIdeaId)
        ) {
          throw new ExperimentWorkspaceStorageError('parent_not_found');
        }
        const count = database
          .prepare('select count(*) as count from experiment_ideas where project_id=?')
          .get(idea.projectId) as { count: number };
        if (count.count >= EXPERIMENT_MAX_IDEAS_PER_PROJECT) {
          throw new ExperimentWorkspaceStorageError('idea_limit_reached');
        }
        const inserted = database
          .prepare(
            `insert into experiment_ideas(
               id,schema_version,project_id,parent_idea_id,title,hypothesis,phase,outcome,
               result_summary,version,created_at,updated_at,completed_at
             ) values(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            idea.id,
            idea.schemaVersion,
            idea.projectId,
            idea.parentIdeaId,
            idea.title,
            idea.hypothesis,
            idea.phase,
            idea.outcome,
            idea.resultSummary,
            idea.version,
            idea.createdAt,
            idea.updatedAt,
            idea.completedAt,
          );
        return inserted.changes === 1;
      })
      .immediate();
  }

  updateExperimentIdea(input: ExperimentIdea, expectedVersion: number) {
    const idea = ExperimentIdeaSchema.parse(structuredClone(input));
    if (idea.version !== expectedVersion + 1) {
      throw new Error('experiment_idea_version_sequence_invalid');
    }
    const database = this.require();
    return database
      .transaction(() => {
        const changed = database
          .prepare(
            `update experiment_ideas set
               title=?,hypothesis=?,phase=?,outcome=?,result_summary=?,version=?,
               updated_at=?,completed_at=?
             where project_id=? and id=? and version=?`,
          )
          .run(
            idea.title,
            idea.hypothesis,
            idea.phase,
            idea.outcome,
            idea.resultSummary,
            idea.version,
            idea.updatedAt,
            idea.completedAt,
            idea.projectId,
            idea.id,
            expectedVersion,
          );
        if (changed.changes !== 1) return null;
        const row = database
          .prepare('select * from experiment_ideas where project_id=? and id=?')
          .get(idea.projectId, idea.id) as ExperimentIdeaRow;
        return toExperimentIdea(row);
      })
      .immediate();
  }

  appendExperimentMetricPoint(input: Omit<ExperimentMetricPoint, 'sequence'>) {
    const point = ExperimentMetricPointDraftSchema.parse(structuredClone(input));
    const database = this.require();
    return database
      .transaction(() => {
        const idea = database
          .prepare('select 1 from experiment_ideas where project_id=? and id=?')
          .get(point.projectId, point.ideaId);
        if (!idea) throw new ExperimentWorkspaceStorageError('idea_not_found');
        const count = database
          .prepare('select count(*) as count from experiment_metric_points where project_id=?')
          .get(point.projectId) as { count: number };
        if (count.count >= EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT) {
          throw new ExperimentWorkspaceStorageError('metric_limit_reached');
        }
        const next = database
          .prepare(
            `select coalesce(max(sequence),0)+1 as sequence
             from experiment_metric_points where project_id=?`,
          )
          .get(point.projectId) as { sequence: number };
        database
          .prepare(
            `insert into experiment_metric_points(
               id,schema_version,project_id,idea_id,sequence,objective_id,objective_version,
               metric_key,metric_display_name,direction,unit,aggregation,evaluator_hash,
               dataset_hash,holdout_hash,baseline,target,value,source,trial_id,recorded_at
             ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            point.id,
            point.schemaVersion,
            point.projectId,
            point.ideaId,
            next.sequence,
            point.objectiveId,
            point.objectiveVersion,
            point.metricKey,
            point.metricDisplayName,
            point.direction,
            point.unit,
            point.aggregation,
            point.evaluatorHash,
            point.datasetHash,
            point.holdoutHash,
            point.baseline,
            point.target,
            point.value,
            point.source,
            point.trialId,
            point.recordedAt,
          );
        const row = database
          .prepare('select * from experiment_metric_points where id=?')
          .get(point.id) as ExperimentMetricPointRow;
        return toExperimentMetricPoint(row);
      })
      .immediate();
  }

  listLiteratureRecords(projectId: string): LiteratureRecord[] {
    const rows = this.require()
      .prepare(
        `select * from literature_records where project_id=? and deleted_at is null
         order by updated_at desc,id asc`,
      )
      .all(projectId) as LiteratureRecordRow[];
    return rows.map(toLocalLiteratureRecord);
  }

  countLiteratureRecords(projectId: string) {
    const row = this.require()
      .prepare(
        'select count(*) as count from literature_records where project_id=? and deleted_at is null',
      )
      .get(projectId) as { count: number };
    return row.count;
  }

  getLiteratureRecordsByIds(projectId: string, recordIds: readonly string[]): LiteratureRecord[] {
    const uniqueIds = [...new Set(recordIds)];
    if (uniqueIds.length > LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT) {
      throw new LiteratureStorageError('record_limit_reached');
    }
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => '?').join(',');
    const rows = this.require()
      .prepare(
        `select * from literature_records
         where project_id=? and deleted_at is null and id in (${placeholders})`,
      )
      .all(projectId, ...uniqueIds) as LiteratureRecordRow[];
    const byId = new Map(rows.map((row) => [row.id, toLocalLiteratureRecord(row)]));
    return uniqueIds.flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    });
  }

  listLiteratureSearchRuns(projectId: string): LiteratureSearchRun[] {
    const database = this.require();
    const rows = database
      .prepare(
        `select id,project_id,provider,policy_id,policy_version,query,search_tags_json,requested_limit,from_year,to_year,status,
                new_count,updated_count,unchanged_count,conflict_count,retrieved_count,selected_count,
                core_count,rising_count,broad_count,discovery_coverage_json,created_at,completed_at
         from literature_search_runs where project_id=? order by created_at desc,id desc limit 20`,
      )
      .all(projectId) as LiteratureSearchRunRow[];
    return rows.map((row) =>
      toLocalLiteratureSearchRun(row, listLiteratureSearchConflicts(database, row.id)),
    );
  }

  beginLiteratureSearch(input: LiteratureSearchRun) {
    if (
      input.status !== 'running' ||
      input.foundCount !== 0 ||
      input.newCount !== 0 ||
      input.updatedCount !== 0 ||
      input.unchangedCount !== 0 ||
      input.conflictCount !== 0 ||
      (input.retrievedCount ?? 0) !== 0 ||
      (input.selectedCount ?? 0) !== 0 ||
      (input.tierCounts?.core ?? 0) !== 0 ||
      (input.tierCounts?.rising ?? 0) !== 0 ||
      (input.tierCounts?.broad ?? 0) !== 0 ||
      input.coverage !== undefined ||
      input.conflicts.length !== 0
    ) {
      throw new Error('invalid_literature_search_start');
    }
    return (
      this.require()
        .prepare(
          `insert or ignore into literature_search_runs(
             id,schema_version,project_id,provider,policy_id,policy_version,query,search_tags_json,requested_limit,
             from_year,to_year,status,new_count,updated_count,unchanged_count,conflict_count,
             retrieved_count,selected_count,core_count,rising_count,broad_count,
             discovery_coverage_json,created_at,completed_at
           ) values(?,1,?,?,?,?,?,?,?,?,?,'running',0,0,0,0,0,0,0,0,0,null,?,null)`,
        )
        .run(
          input.id,
          input.projectId,
          input.provider,
          input.policyId ?? 'crossref-basic',
          input.policyVersion ?? 1,
          input.query,
          JSON.stringify(input.searchTags ?? { topics: [], keywords: [] }),
          input.requestedLimit,
          input.fromYear,
          input.toYear,
          input.createdAt,
        ).changes === 1
    );
  }

  completeLiteratureSearch(
    projectId: string,
    runId: string,
    candidates: readonly LiteratureProviderCandidate[],
    completedAt: string,
    discovery?: Readonly<{
      retrievedCount: number;
      selectedCount: number;
      tierCounts: LiteratureTierCounts;
      coverage?: LiteratureDiscoveryCoverage;
    }>,
  ) {
    if (candidates.length > LITERATURE_MAX_SEARCH_RESULTS) {
      throw new LiteratureStorageError('record_limit_reached');
    }
    const database = this.require();
    return database
      .transaction(() => {
        const run = database
          .prepare(
            `select id,project_id,provider,policy_id,policy_version,query,search_tags_json,requested_limit,from_year,to_year,status,
                    new_count,updated_count,unchanged_count,conflict_count,retrieved_count,selected_count,
                    core_count,rising_count,broad_count,discovery_coverage_json,created_at,completed_at
             from literature_search_runs where project_id=? and id=?`,
          )
          .get(projectId, runId) as LiteratureSearchRunRow | undefined;
        if (!run || run.status !== 'running') throw new Error('literature_search_state_conflict');
        const selectedTierCounts =
          discovery?.tierCounts ??
          candidates.reduce<LiteratureTierCounts>(
            (counts, candidate) =>
              candidate.discovery
                ? {
                    ...counts,
                    [candidate.discovery.tier]: counts[candidate.discovery.tier] + 1,
                  }
                : counts,
            { core: 0, rising: 0, broad: 0 },
          );
        const selectedCount = discovery?.selectedCount ?? candidates.length;
        const retrievedCount = discovery?.retrievedCount ?? candidates.length;
        const coverage = discovery?.coverage
          ? LiteratureDiscoveryCoverageSchema.parse(discovery.coverage)
          : undefined;
        if (
          selectedCount !== candidates.length ||
          retrievedCount < selectedCount ||
          selectedTierCounts.core + selectedTierCounts.rising + selectedTierCounts.broad >
            selectedCount
        ) {
          throw new Error('invalid_literature_discovery_summary');
        }
        let added = 0;
        let updated = 0;
        let skipped = 0;
        let conflicts = 0;
        const tierCounts: LiteratureTierCounts = { core: 0, rising: 0, broad: 0 };
        const conflictDetails: LiteratureSearchConflict[] = [];
        const runSearchTags = literatureSearchTagsJson(run.search_tags_json);
        const upsertOne = database.transaction((candidate: LiteratureProviderCandidate) =>
          upsertLiteratureCandidate(database, projectId, candidate, completedAt, runSearchTags),
        );
        const insertHit = database.prepare(
          `insert into literature_search_hits(
             search_run_id,ordinal,record_id,outcome,discovery_tier,tier_rank,overall_score,
             ranking_signals_json
           ) values(?,?,?,?,?,?,?,?)`,
        );
        const insertConflict = database.prepare(
          `insert into literature_search_conflicts(
             search_run_id,ordinal,provider,provider_record_id,doi,fingerprint,title,authors_json,
             published_year
           ) values(?,?,?,?,?,?,?,?,?)`,
        );
        for (const [index, candidate] of candidates.entries()) {
          let result: ReturnType<typeof upsertLiteratureCandidate>;
          try {
            result = upsertOne(candidate);
          } catch (error) {
            if (error instanceof LiteratureStorageError && error.code === 'identity_conflict') {
              const conflict = LiteratureSearchConflictSchema.parse({
                ordinal: index + 1,
                provider: candidate.provider,
                providerRecordId: candidate.providerId ?? null,
                doi: candidate.doi ?? null,
                fingerprint: candidate.fingerprint,
                title: candidate.title,
                authors: candidate.authors,
                publishedYear: candidate.publishedYear ?? null,
              });
              insertConflict.run(
                runId,
                conflict.ordinal,
                conflict.provider,
                conflict.providerRecordId,
                conflict.doi,
                conflict.fingerprint,
                conflict.title,
                JSON.stringify(conflict.authors),
                conflict.publishedYear,
              );
              if (conflictDetails.length < LITERATURE_MAX_SEARCH_CONFLICT_PREVIEW) {
                conflictDetails.push(conflict);
              }
              conflicts += 1;
              continue;
            }
            throw error;
          }
          if (result.outcome === 'new') added += 1;
          else if (result.outcome === 'updated') updated += 1;
          else skipped += 1;
          const ranking = candidate.discovery;
          if (ranking) tierCounts[ranking.tier] += 1;
          insertHit.run(
            runId,
            index + 1,
            result.record.id,
            result.outcome,
            ranking?.tier ?? null,
            ranking?.tierRank ?? null,
            ranking?.overallScore ?? null,
            ranking ? JSON.stringify(ranking) : null,
          );
          if (ranking) {
            const summary = LiteratureDiscoverySummarySchema.parse({
              ...ranking,
              searchRunId: runId,
              query: run.query,
              policyId: run.policy_id,
              policyVersion: run.policy_version,
              classifiedAt: completedAt,
            });
            database
              .prepare(
                `update literature_records set current_discovery_json=?
                 where project_id=? and id=? and deleted_at is null`,
              )
              .run(JSON.stringify(summary), projectId, result.record.id);
          }
        }
        const changed = database
          .prepare(
            `update literature_search_runs set
               status='complete',new_count=?,updated_count=?,unchanged_count=?,conflict_count=?,
               retrieved_count=?,selected_count=?,core_count=?,rising_count=?,broad_count=?,
               discovery_coverage_json=?,completed_at=?
             where project_id=? and id=? and status='running'`,
          )
          .run(
            added,
            updated,
            skipped,
            conflicts,
            retrievedCount,
            selectedCount,
            tierCounts.core,
            tierCounts.rising,
            tierCounts.broad,
            coverage ? JSON.stringify(coverage) : null,
            completedAt,
            projectId,
            runId,
          ).changes;
        if (changed !== 1) throw new Error('literature_search_state_conflict');
        return {
          foundCount: candidates.length,
          newCount: added,
          updatedCount: updated,
          unchangedCount: skipped,
          conflictCount: conflicts,
          retrievedCount,
          selectedCount,
          tierCounts,
          run: toLocalLiteratureSearchRun(
            {
              ...run,
              status: 'complete',
              new_count: added,
              updated_count: updated,
              unchanged_count: skipped,
              conflict_count: conflicts,
              retrieved_count: retrievedCount,
              selected_count: selectedCount,
              core_count: tierCounts.core,
              rising_count: tierCounts.rising,
              broad_count: tierCounts.broad,
              discovery_coverage_json: coverage ? JSON.stringify(coverage) : null,
              completed_at: completedAt,
            },
            conflictDetails,
          ),
        };
      })
      .immediate();
  }

  failLiteratureSearch(
    projectId: string,
    runId: string,
    status: 'failed' | 'cancelled',
    completedAt: string,
  ) {
    return (
      this.require()
        .prepare(
          `update literature_search_runs set status=?,completed_at=?
           where project_id=? and id=? and status='running'`,
        )
        .run(status, completedAt, projectId, runId).changes === 1
    );
  }

  upsertLiteratureCandidates(
    projectId: string,
    candidates: readonly LiteratureProviderCandidate[],
    updatedAt: string,
  ) {
    if (candidates.length > LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT) {
      throw new LiteratureStorageError('record_limit_reached');
    }
    const database = this.require();
    return database
      .transaction(() => {
        let imported = 0;
        let updated = 0;
        let skipped = 0;
        for (const candidate of candidates) {
          const result = upsertLiteratureCandidate(database, projectId, candidate, updatedAt);
          if (result.outcome === 'new') imported += 1;
          else if (result.outcome === 'updated') updated += 1;
          else skipped += 1;
        }
        return { imported, updated, skipped };
      })
      .immediate();
  }

  updateLiteratureManualAnnotations(input: {
    projectId: string;
    recordId: string;
    expectedVersion: number;
    expectedAnnotationVersion: number;
    manualTopics: readonly string[];
    manualSummary: string;
    manualRelevance: string;
    reviewStatus: string;
    updatedAt: string;
  }) {
    const database = this.require();
    const changed = database
      .prepare(
        `update literature_records set
           manual_topics_json=?,manual_summary=?,manual_relevance=?,review_status=?,
           annotation_version=annotation_version+1,version=version+1,updated_at=?
         where project_id=? and id=? and deleted_at is null
           and version=? and annotation_version=?`,
      )
      .run(
        JSON.stringify(input.manualTopics),
        input.manualSummary || null,
        input.manualRelevance || null,
        input.reviewStatus,
        input.updatedAt,
        input.projectId,
        input.recordId,
        input.expectedVersion,
        input.expectedAnnotationVersion,
      ).changes;
    if (changed !== 1) return null;
    const row = database
      .prepare(
        'select * from literature_records where project_id=? and id=? and deleted_at is null',
      )
      .get(input.projectId, input.recordId) as LiteratureRecordRow;
    return toLocalLiteratureRecord(row);
  }

  applyLiteratureAiAnnotations(
    projectId: string,
    updates: readonly LocalLiteratureAiAnnotationUpdate[],
    updatedAt: string,
  ) {
    const database = this.require();
    const conflict = new Error('literature_annotation_conflict');
    try {
      return database
        .transaction(() => {
          const results: LiteratureRecord[] = [];
          for (const update of updates) {
            const changed = database
              .prepare(
                `update literature_records set
                   ai_topics_json=?,ai_summary=?,ai_relevance=?,ai_study_type=?,
                   ai_limitations_json=?,ai_model_provenance_json=?,
                   annotation_version=annotation_version+1,version=version+1,updated_at=?
                 where project_id=? and id=? and deleted_at is null
                   and version=? and annotation_version=?`,
              )
              .run(
                JSON.stringify(update.topics),
                update.summary || null,
                update.relevance,
                update.studyType || null,
                JSON.stringify(update.limitations),
                JSON.stringify(update.provenance),
                updatedAt,
                projectId,
                update.recordId,
                update.expectedVersion,
                update.expectedAnnotationVersion,
              ).changes;
            if (changed !== 1) throw conflict;
            const row = database
              .prepare(
                'select * from literature_records where project_id=? and id=? and deleted_at is null',
              )
              .get(projectId, update.recordId) as LiteratureRecordRow;
            results.push(toLocalLiteratureRecord(row));
          }
          return results;
        })
        .immediate();
    } catch (error) {
      if (error === conflict) return null;
      throw error;
    }
  }

  deleteLiteratureRecord(
    projectId: string,
    recordId: string,
    expectedVersion: number,
    deletedAt: string,
  ) {
    return (
      this.require()
        .prepare(
          `update literature_records set deleted_at=?,version=version+1,updated_at=?
           where project_id=? and id=? and deleted_at is null and version=?`,
        )
        .run(deletedAt, deletedAt, projectId, recordId, expectedVersion).changes === 1
    );
  }

  listSshConnections(): SshConnectionProfile[] {
    const rows = this.require()
      .prepare(
        `select id,schema_version,label,host_alias,direct_target_json,version,created_at,updated_at
         from ssh_connections order by label collate nocase asc,id asc`,
      )
      .all() as SshConnectionRow[];
    return rows.map(toSshConnection);
  }

  createSshConnection(input: SshConnectionProfile) {
    const profile = SshConnectionProfileSchema.parse(input);
    const result = this.require()
      .prepare(
        `insert or ignore into ssh_connections(
           id,schema_version,label,host_alias,direct_target_json,version,created_at,updated_at
         ) values(?,?,?,?,?,?,?,?)`,
      )
      .run(
        profile.id,
        profile.schemaVersion,
        profile.label,
        profile.hostAlias,
        profile.directTarget ? JSON.stringify(profile.directTarget) : null,
        profile.version,
        profile.createdAt,
        profile.updatedAt,
      );
    return result.changes === 1;
  }

  updateSshConnection(input: SshConnectionProfile, expectedVersion: number) {
    const profile = SshConnectionProfileSchema.parse(input);
    if (profile.version !== expectedVersion + 1) throw new Error('ssh_version_sequence_invalid');
    const result = this.require()
      .prepare(
        `update ssh_connections set
           schema_version=?,label=?,host_alias=?,direct_target_json=?,version=?,updated_at=?
         where id=? and version=?`,
      )
      .run(
        profile.schemaVersion,
        profile.label,
        profile.hostAlias,
        profile.directTarget ? JSON.stringify(profile.directTarget) : null,
        profile.version,
        profile.updatedAt,
        profile.id,
        expectedVersion,
      );
    return result.changes === 1;
  }

  removeSshConnection(connectionId: string, expectedVersion: number) {
    const result = this.require()
      .prepare('delete from ssh_connections where id=? and version=?')
      .run(connectionId, expectedVersion);
    return result.changes === 1;
  }

  listSshWorkspaceGrants(projectId: string): RemoteWorkspaceGrant[] {
    const rows = this.require()
      .prepare(
        `select id,schema_version,project_id,connection_id,canonical_root,permission_mode,
                version,created_at,updated_at
         from ssh_workspace_grants where project_id=? order by connection_id asc,id asc`,
      )
      .all(projectId) as SshWorkspaceGrantRow[];
    return rows.map(toSshWorkspaceGrant);
  }

  createSshWorkspaceGrant(input: RemoteWorkspaceGrant) {
    const grant = RemoteWorkspaceGrantSchema.parse(input);
    return (
      this.require()
        .prepare(
          `insert or ignore into ssh_workspace_grants(
             id,schema_version,project_id,connection_id,canonical_root,permission_mode,
             version,created_at,updated_at
           ) values(?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          grant.id,
          grant.schemaVersion,
          grant.projectId,
          grant.connectionId,
          grant.canonicalRoot,
          grant.permissionMode,
          grant.version,
          grant.createdAt,
          grant.updatedAt,
        ).changes === 1
    );
  }

  updateSshWorkspaceGrant(input: RemoteWorkspaceGrant, expectedVersion: number) {
    const grant = RemoteWorkspaceGrantSchema.parse(input);
    if (grant.version !== expectedVersion + 1) {
      throw new Error('ssh_workspace_grant_version_sequence_invalid');
    }
    return (
      this.require()
        .prepare(
          `update ssh_workspace_grants set
             canonical_root=?,permission_mode=?,version=?,updated_at=?
           where id=? and project_id=? and connection_id=? and version=?`,
        )
        .run(
          grant.canonicalRoot,
          grant.permissionMode,
          grant.version,
          grant.updatedAt,
          grant.id,
          grant.projectId,
          grant.connectionId,
          expectedVersion,
        ).changes === 1
    );
  }

  removeSshWorkspaceGrant(projectId: string, grantId: string, expectedVersion: number) {
    return (
      this.require()
        .prepare('delete from ssh_workspace_grants where project_id=? and id=? and version=?')
        .run(projectId, grantId, expectedVersion).changes === 1
    );
  }

  close() {
    this.database?.close();
    this.database = undefined;
    this.workspaceOutboxOrderingReady = false;
  }
  private require() {
    if (!this.database) throw new Error('local_database_not_open');
    return this.database;
  }
}

type ProjectChatMessageRow = {
  id: string;
  project_id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'failed' | 'interrupted';
  attempt_id: string | null;
  turn_id: string | null;
  model_json: string | null;
  created_at: string;
  completed_at: string;
};

type SshConnectionRow = {
  id: string;
  schema_version: number;
  label: string;
  host_alias: string;
  direct_target_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type SshWorkspaceGrantRow = {
  id: string;
  schema_version: number;
  project_id: string;
  connection_id: string;
  canonical_root: string;
  permission_mode: string;
  version: number;
  created_at: string;
  updated_at: string;
};

function toSshConnection(row: SshConnectionRow) {
  return SshConnectionProfileSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    label: row.label,
    hostAlias: row.host_alias,
    directTarget: row.direct_target_json ? (JSON.parse(row.direct_target_json) as unknown) : null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toSshWorkspaceGrant(row: SshWorkspaceGrantRow) {
  return RemoteWorkspaceGrantSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    projectId: row.project_id,
    connectionId: row.connection_id,
    canonicalRoot: row.canonical_root,
    permissionMode: row.permission_mode,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

type ProjectChatSessionRow = {
  id: string;
  project_id: string;
  title: string;
  is_default: number;
  parent_session_id: string | null;
  branched_from_message_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectChatAttemptRow = {
  id: string;
  project_id: string;
  session_id: string | null;
  user_message_id: string;
  retry_of_attempt_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  model_json: string | null;
  requested_model_id: string | null;
  reasoning_option_id: string | null;
  harness_mode: 'context' | 'planner' | 'reviewer' | null;
  response_depth: 'concise' | 'standard' | 'deep' | null;
  collaboration_mode_id: string | null;
  personality: 'auto' | 'none' | 'friendly' | 'pragmatic' | null;
  response_verbosity: 'auto' | 'low' | 'medium' | 'high' | null;
  web_search_mode: 'disabled' | 'cached' | 'live' | null;
  context_scope: 'project' | 'board' | 'objective' | null;
  profile_version: number | null;
  instruction_revision_id: string | null;
  prompt_provenance_json: string | null;
  status: 'starting' | 'running' | 'complete' | 'failed' | 'interrupted';
  error_code:
    | 'codex_unavailable'
    | 'invalid_response'
    | 'application_interrupted'
    | 'user_interrupted'
    | null;
  error_code_v2:
    | 'codex_unavailable'
    | 'attachment_model_modality_unsupported'
    | 'invalid_response'
    | 'application_interrupted'
    | 'user_interrupted'
    | null;
  created_at: string;
  updated_at: string;
};

type ProjectChatProfileRow = {
  project_id: string;
  version: number;
  harness_mode: 'context' | 'planner' | 'reviewer';
  response_depth: 'concise' | 'standard' | 'deep';
  collaboration_mode_id: string | null;
  personality: 'auto' | 'none' | 'friendly' | 'pragmatic';
  response_verbosity: 'auto' | 'low' | 'medium' | 'high';
  web_search_mode: 'disabled' | 'cached' | 'live';
  context_scope: 'project' | 'board' | 'objective';
  local_notes_vault_id: string | null;
  local_notes_vault_name: string | null;
  instruction_revision_id: string;
  updated_at: string;
  content: string;
  content_sha256: string;
  created_at: string;
};

type ProjectChatActionRow = {
  id: string;
  message_id: string;
  project_id: string;
  command_json: string;
  status: 'proposed' | 'applying' | 'applied' | 'failed';
  result_entity_id: string | null;
  result_entity_version: number | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

function toChatAction(row: ProjectChatActionRow) {
  return ProjectChatActionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    messageId: row.message_id,
    command: JSON.parse(row.command_json) as unknown,
    status: row.status,
    ...(row.result_entity_id ? { resultEntityId: row.result_entity_id } : {}),
    ...(row.result_entity_version ? { resultEntityVersion: row.result_entity_version } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toChatAttempt(row: ProjectChatAttemptRow) {
  const hasNativeSettings = row.personality !== null || row.response_verbosity !== null;
  return ProjectChatAttemptSchema.parse({
    id: row.id,
    projectId: row.project_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    userMessageId: row.user_message_id,
    ...(row.retry_of_attempt_id ? { retryOfAttemptId: row.retry_of_attempt_id } : {}),
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    ...(row.model_json ? { model: JSON.parse(row.model_json) as unknown } : {}),
    requestedModelId: row.requested_model_id,
    reasoningOptionId: row.reasoning_option_id,
    ...(row.harness_mode ? { harnessMode: row.harness_mode } : {}),
    ...(row.response_depth ? { responseDepth: row.response_depth } : {}),
    ...(hasNativeSettings ? { collaborationModeId: row.collaboration_mode_id } : {}),
    ...(row.personality ? { personality: row.personality } : {}),
    ...(row.response_verbosity ? { responseVerbosity: row.response_verbosity } : {}),
    ...(row.web_search_mode ? { webSearchMode: row.web_search_mode } : {}),
    ...(row.context_scope ? { contextScope: row.context_scope } : {}),
    ...(row.profile_version === null ? {} : { profileVersion: row.profile_version }),
    ...(row.profile_version === null ? {} : { instructionRevisionId: row.instruction_revision_id }),
    ...(row.prompt_provenance_json
      ? { promptProvenance: JSON.parse(row.prompt_provenance_json) as unknown }
      : {}),
    status: row.status,
    ...((row.error_code_v2 ?? row.error_code)
      ? { errorCode: row.error_code_v2 ?? row.error_code! }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toChatSession(row: ProjectChatSessionRow) {
  return ProjectChatSessionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    isDefault: row.is_default === 1,
    ...(row.parent_session_id ? { parentSessionId: row.parent_session_id } : {}),
    ...(row.branched_from_message_id
      ? { branchedFromMessageId: row.branched_from_message_id }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toChatProfile(row: ProjectChatProfileRow) {
  return ProjectChatProfileSchema.parse({
    schemaVersion: 1,
    projectId: row.project_id,
    version: row.version,
    harnessMode: row.harness_mode,
    responseDepth: row.response_depth,
    collaborationModeId: row.collaboration_mode_id,
    personality: row.personality,
    responseVerbosity: row.response_verbosity,
    webSearchMode: row.web_search_mode,
    contextScope: row.context_scope,
    localNotesVault:
      row.local_notes_vault_id && row.local_notes_vault_name
        ? { id: row.local_notes_vault_id, name: row.local_notes_vault_name }
        : null,
    customInstructions: row.content,
    instructionRevision: {
      id: row.instruction_revision_id,
      revision: row.version,
      contentSha256: row.content_sha256,
      createdAt: row.created_at,
    },
    updatedAt: row.updated_at,
  });
}
