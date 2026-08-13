import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { app, safeStorage } from 'electron';
import { z } from 'zod';

import {
  ManuscriptCheckpointV1Schema,
  ManuscriptSyncAnchorV1Schema,
  ManuscriptWorkspaceBindingV1Schema,
  type ManuscriptCheckpointV1,
  type ModelCatalog,
  type ModelInvocation,
} from '@gosu/contracts';
import {
  EXPERIMENT_EVALUATION_MAX_MESSAGES_PER_SESSION,
  EXPERIMENT_EVALUATION_MAX_PROFILES_PER_PROJECT,
  EXPERIMENT_EVALUATION_MAX_REVISIONS_PER_SESSION,
  EXPERIMENT_EVALUATION_MAX_SESSIONS_PER_PROJECT,
  ExperimentEvaluationMessageSchema,
  ExperimentEvaluationProfileSchema,
  ExperimentEvaluationRevisionSchema,
  ExperimentEvaluationSessionDetailSchema,
  ExperimentEvaluationSessionSchema,
  type ExperimentEvaluationMessage,
  type ExperimentEvaluationProfile,
  type ExperimentEvaluationRevision,
  type ExperimentEvaluationSession,
  type ExperimentEvaluationSessionDetail,
} from '../shared/experiment-evaluation-contracts';
import { EXPERIMENT_EVALUATION_CODE_POLICY_HASH } from './experiment-evaluation-code-policy';
import {
  EXPERIMENT_MAX_IDEAS_PER_PROJECT,
  EXPERIMENT_MAX_LOGGING_TEMPLATE_REVISIONS_PER_PROJECT,
  EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT,
  EXPERIMENT_MAX_RUNS_PER_PROJECT,
  ExperimentIdeaSchema,
  ExperimentLoggingTemplateSchema,
  ExperimentMetricPointSchema,
  ExperimentRunSchema,
  type ExperimentIdea,
  type ExperimentLoggingTemplate,
  type ExperimentMetricPoint,
  type ExperimentRun,
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
  LECTURE_STUDIO_MAX_MESSAGES,
  LECTURE_STUDIO_MAX_REVISIONS,
  LECTURE_STUDIO_MAX_STORED_STUDIOS,
  LECTURE_STUDIO_MAX_STUDIOS,
  LECTURE_STUDIO_MAX_TRASHED_STUDIOS,
  LectureStudioDetailSchema,
  EmptyLectureStudioTrashInputSchema,
  EmptyLectureStudioTrashReceiptSchema,
  LectureStudioGenerationBriefSchema,
  LectureStudioMessageSchema,
  LectureStudioRevisionSchema,
  LectureStudioSchema,
  LectureStudioSummarySchema,
  type LectureStudio,
  type LectureStudioDetail,
  type LectureStudioMessage,
  type LectureStudioRevision,
  type LectureStudioSummary,
  type EmptyLectureStudioTrashInput,
  type EmptyLectureStudioTrashReceipt,
} from '../shared/lecture-studio-contracts';
import {
  ManuscriptRecordSchema,
  ManuscriptWorkspaceLifecycleSchema,
  type ManuscriptRecord,
  type OverleafGitBindingConfiguration,
  type StoredManuscriptWorkspaceConnection,
} from '../shared/manuscript-workspace-contracts';
import {
  AbandonProjectChatResearchNoteSaveInputSchema,
  ConfirmProjectChatResearchNoteSaveInputSchema,
  MarkProjectChatResearchNoteSaveUncertainInputSchema,
  PROJECT_CHAT_RESEARCH_NOTE_SAVE_ABANDONED_SECTION,
  PROJECT_CHAT_RESEARCH_NOTE_SAVE_PENDING_SECTION,
  PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH,
  ProjectChatActionSchema,
  ProjectChatAttemptSchema,
  ProjectChatHermesDelegationReceiptSchema,
  ProjectChatMessageSchema,
  PROJECT_CHAT_MAX_BRANCH_DEPTH,
  PROJECT_CHAT_MAX_BRANCH_MESSAGES,
  PROJECT_CHAT_MAX_QUEUED_TURNS_PER_SESSION,
  PROJECT_CHAT_MAX_SESSIONS_PER_PROJECT,
  ProjectChatProfileSchema,
  ProjectChatQueuedTurnSchema,
  ProjectChatResearchNoteSaveReceiptSchema,
  ProjectChatResearchNoteSaveStageSchema,
  ProjectChatSessionSchema,
  ProjectChatSnapshotSchema,
  UpdateProjectChatProfileInputSchema,
  defaultProjectChatProfile,
  type ProjectChatAction,
  type ProjectChatAttempt,
  type ProjectChatHermesDelegationReceipt,
  type ProjectChatMessage,
  type ProjectChatProfile,
  type ProjectChatQueuedTurn,
  type ProjectChatResearchNoteSaveReceipt,
  type ProjectChatResearchNoteSaveStage,
  type AbandonProjectChatResearchNoteSaveInput,
  type ConfirmProjectChatResearchNoteSaveInput,
  type MarkProjectChatResearchNoteSaveUncertainInput,
  type ProjectChatSession,
  type ProjectChatSnapshot,
  type UpdateProjectChatProfileInput,
} from '../shared/project-chat-contracts';
import { SshConnectionProfileSchema, type SshConnectionProfile } from '../shared/ssh-contracts';
import {
  RemoteWorkspaceGrantSchema,
  SshTrustedWorkspaceAuditRecordSchema,
  type RemoteWorkspaceGrant,
  type SshTrustedWorkspaceAuditRecord,
} from '../shared/ssh-workspace-contracts';
import {
  EmptyProjectTrashReceiptSchema,
  type EmptyProjectTrashReceipt,
  type WorkspaceOperation,
  type WorkspacePendingSummary,
  type WorkspaceSnapshot,
} from '../shared/workspace-contracts';
import { ExperimentWorkspaceStorageError } from './experiment-workspace-storage-error';
import {
  ExperimentRunExecutionBindingSchema,
  ExperimentRunExecutionIntentSchema,
  ExperimentRunLogSourceSchema,
  type ExperimentRunExecutionBinding,
  type ExperimentRunExecutionIntent,
  type ExperimentRunLogSource,
} from './experiment-workspace-service';
import {
  literatureFingerprint,
  normalizeArxivCanonicalId,
  type LiteratureProviderCandidate,
} from './literature-crossref';
import { LiteratureStorageError } from './literature-storage-error';
import { LectureStudioStorageError } from './lecture-studio-storage-error';
import { overleafCredentialWorkspaceId } from './overleaf-git-credential-store';
import { parseOverleafGitRemote } from './overleaf-git-transport';
import { WorkspaceDataRecoveryError } from './workspace-storage-error';

const MAX_WORKSPACE_STATE_BYTES = 8 * 1024 * 1024;
const INTERRUPTED_CHAT_ATTEMPT_RECEIPT =
  'GOSU closed before this Codex turn finished. Retry when ready.';
const PROJECT_CHAT_SESSIONS_MIGRATION = 'project-chat-sessions-v1';
const PROJECT_CHAT_RESEARCH_NOTE_ABANDONED_MIGRATION = 'project-chat-research-note-abandoned-v1';
const LITERATURE_MANUAL_RELEVANCE_MIGRATION = 'literature-manual-relevance-v2';
const LITERATURE_WEAK_FINGERPRINT_MIGRATION = 'literature-weak-fingerprint-v1';
const LITERATURE_DISCOVERY_MIGRATION = 'literature-balanced-discovery-v1';
const LITERATURE_DISCOVERY_COVERAGE_MIGRATION = 'literature-discovery-coverage-v1';
const LITERATURE_SEARCH_TAGS_MIGRATION = 'literature-search-tags-v1';
const LITERATURE_HUGGING_FACE_PROVIDER_MIGRATION = 'literature-hugging-face-provider-v1';
const LITERATURE_CANONICAL_IDENTITY_MIGRATION = 'literature-canonical-identity-v1';
const EXPERIMENT_RUNS_HARDENING_MIGRATION = 'experiment-runs-hardening-v1';
const EXPERIMENT_RUN_INTENT_AUTHORITY_MIGRATION = 'experiment-run-intent-authority-v2';
const DEFAULT_LECTURE_STUDIO_GENERATION_BRIEF_JSON = JSON.stringify(
  LectureStudioGenerationBriefSchema.parse(undefined),
);
const LEGACY_EXPERIMENT_EXECUTION_POLICY_HASH = createHash('sha256')
  .update('gosu:legacy-experiment-execution-policy-unrecoverable:v1', 'utf8')
  .digest('hex');
const DEFAULT_PROJECT_CHAT_SESSION_TITLE = 'Project chat';
const LECTURE_STUDIO_STORAGE_QUERY_LIMIT = 100;
const MANUSCRIPT_ARTIFACT_PURGE_BATCH_LIMIT = 512;
const MANUSCRIPT_ARTIFACT_PURGE_PROJECT_FILTER_LIMIT = 128;
const MANUSCRIPT_CREDENTIAL_CLEANUP_BATCH_LIMIT = 256;
const ExperimentMetricPointDraftSchema = ExperimentMetricPointSchema.omit({ sequence: true });

function validateOverleafGitBindingConfiguration(
  configuration: OverleafGitBindingConfiguration,
): OverleafGitBindingConfiguration {
  const remote = parseOverleafGitRemote(configuration.remoteUrl);
  const credentialWorkspaceId = overleafCredentialWorkspaceId(configuration.credentialRef);
  if (
    configuration.workspaceId !== remote.workspaceId ||
    configuration.webUrl !== remote.webUrl ||
    credentialWorkspaceId !== remote.workspaceId
  ) {
    throw new Error('manuscript_binding_invalid');
  }
  return configuration;
}

const ManuscriptArtifactPurgeQueueEntrySchema = z
  .object({
    bindingId: z.string().uuid(),
    projectId: z.string().uuid(),
    providerId: ManuscriptWorkspaceBindingV1Schema.shape.providerId,
    queuedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const ManuscriptArtifactPurgeProjectIdsSchema = z
  .array(z.string().uuid())
  .max(MANUSCRIPT_ARTIFACT_PURGE_PROJECT_FILTER_LIMIT)
  .refine((projectIds) => new Set(projectIds).size === projectIds.length, {
    message: 'Duplicate project IDs are not allowed',
  });

const ManuscriptArtifactPurgeCursorSchema = z
  .object({
    queuedAt: z.iso.datetime({ offset: true }),
    bindingId: z.string().uuid(),
  })
  .strict();

export type ManuscriptArtifactPurgeQueueEntry = Readonly<
  z.infer<typeof ManuscriptArtifactPurgeQueueEntrySchema>
>;

const ManuscriptCredentialCleanupQueueEntrySchema = z
  .object({
    providerId: ManuscriptWorkspaceBindingV1Schema.shape.providerId,
    credentialRef: z.string().trim().min(1).max(512),
    queuedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ManuscriptCredentialCleanupQueueEntry = Readonly<
  z.infer<typeof ManuscriptCredentialCleanupQueueEntrySchema>
>;

const ManuscriptCredentialCleanupCursorSchema = ManuscriptCredentialCleanupQueueEntrySchema.pick({
  providerId: true,
  credentialRef: true,
  queuedAt: true,
});

type ProjectChatResearchNoteSaveReceiptRow = Readonly<{
  project_id: string;
  session_id: string;
  attempt_id: string;
  binding_id: string;
  category: string;
  artifact_id: string;
  expected_content_sha256: string;
  status: string;
  relative_path: string | null;
  staged_at: string;
  updated_at: string;
  committed_at: string | null;
  reported_at: string | null;
}>;

function toProjectChatResearchNoteSaveReceipt(
  row: ProjectChatResearchNoteSaveReceiptRow,
): ProjectChatResearchNoteSaveReceipt {
  return ProjectChatResearchNoteSaveReceiptSchema.parse({
    schemaVersion: 1,
    projectId: row.project_id,
    sessionId: row.session_id,
    attemptId: row.attempt_id,
    bindingId: row.binding_id,
    category: row.category,
    artifactId: row.artifact_id,
    expectedContentSha256: row.expected_content_sha256,
    status: row.status,
    relativePath: row.relative_path,
    stagedAt: row.staged_at,
    updatedAt: row.updated_at,
    committedAt: row.committed_at,
    reportedAt: row.reported_at,
  });
}

const PROJECT_CHAT_RESEARCH_NOTE_RECEIPT_COLUMNS = `
  project_id,session_id,attempt_id,binding_id,category,artifact_id,
  expected_content_sha256,status,relative_path,staged_at,updated_at,committed_at,reported_at
`;

function committedResearchNoteReceiptsForAttempt(database: Database.Database, attemptId: string) {
  return (
    database
      .prepare(
        `select ${PROJECT_CHAT_RESEARCH_NOTE_RECEIPT_COLUMNS}
         from project_chat_research_note_save_receipts
         where attempt_id=? and status='committed-unreported'
         order by staged_at,artifact_id`,
      )
      .all(attemptId) as ProjectChatResearchNoteSaveReceiptRow[]
  ).map(toProjectChatResearchNoteSaveReceipt);
}

function appendResearchNoteSaveReceipts(
  content: string,
  receipts: readonly ProjectChatResearchNoteSaveReceipt[],
) {
  const serverAppendixSeparator = '\n\n---\n';
  let resolvedContent = content
    .split(`${serverAppendixSeparator}${PROJECT_CHAT_RESEARCH_NOTE_SAVE_PENDING_SECTION}`)
    .join('');
  for (const receipt of receipts) {
    resolvedContent = resolvedContent
      .split(`${serverAppendixSeparator}${abandonedResearchNoteSaveSection(receipt)}`)
      .join('');
  }
  const missing = receipts.filter(
    (receipt) =>
      receipt.relativePath !== null &&
      !resolvedContent.includes(`Research Notes/${receipt.relativePath}`),
  );
  if (missing.length === 0) return resolvedContent;
  const appendix = `\n\n---\nResearch Notes saved\n${missing
    .map(
      (receipt) =>
        `- Research Notes/${receipt.relativePath} · ${receipt.category} · SHA-256 ${receipt.expectedContentSha256}`,
    )
    .join('\n')}`;
  const safeAppendix = appendix.slice(0, PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH - 1);
  const contentBudget = PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH - safeAppendix.length;
  return `${resolvedContent.slice(0, Math.max(1, contentBudget))}${safeAppendix}`;
}

function abandonedResearchNoteSaveSection(
  receipt: Pick<
    ProjectChatResearchNoteSaveReceipt,
    'artifactId' | 'category' | 'expectedContentSha256'
  >,
) {
  return `${PROJECT_CHAT_RESEARCH_NOTE_SAVE_ABANDONED_SECTION}\n- ${receipt.category} artifact ${receipt.artifactId} · SHA-256 ${receipt.expectedContentSha256}`;
}

function appendAbandonedResearchNoteSaveReceipt(
  content: string,
  receipt: ProjectChatResearchNoteSaveReceipt,
) {
  const section = abandonedResearchNoteSaveSection(receipt);
  if (content.includes(section)) return content;
  const serverAppendixSeparator = '\n\n---\n';
  const resolvedContent = content
    .split(`${serverAppendixSeparator}${PROJECT_CHAT_RESEARCH_NOTE_SAVE_PENDING_SECTION}`)
    .join('');
  const appendix = `${serverAppendixSeparator}${section}`;
  const safeAppendix = appendix.slice(0, PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH - 1);
  const contentBudget = PROJECT_CHAT_MAX_VISIBLE_RESPONSE_LENGTH - safeAppendix.length;
  return `${resolvedContent.slice(0, Math.max(1, contentBudget))}${safeAppendix}`;
}

function reportResearchNoteReceipts(
  database: Database.Database,
  attemptId: string,
  reportedAt: string,
) {
  return database
    .prepare(
      `update project_chat_research_note_save_receipts
       set status='reported',reported_at=?,updated_at=?
       where attempt_id=? and status='committed-unreported'`,
    )
    .run(reportedAt, reportedAt, attemptId).changes;
}

function reconcileCommittedResearchNoteReceiptsForAttempt(
  database: Database.Database,
  attemptId: string,
  reportedAt: string,
) {
  const receipts = committedResearchNoteReceiptsForAttempt(database, attemptId);
  if (receipts.length === 0) return 0;
  const assistant = database
    .prepare(
      `select id,content from project_chat_messages
       where attempt_id=? and role='assistant'
       order by created_at desc,id desc limit 1`,
    )
    .get(attemptId) as { id: string; content: string } | undefined;
  if (!assistant) return 0;
  const content = appendResearchNoteSaveReceipts(assistant.content, receipts);
  if (content !== assistant.content) {
    database
      .prepare('update project_chat_messages set content=? where id=?')
      .run(content, assistant.id);
  }
  return reportResearchNoteReceipts(database, attemptId, reportedAt);
}

function reconcileCommittedResearchNoteReceipts(database: Database.Database, reportedAt: string) {
  const attempts = database
    .prepare(
      `select distinct attempt_id from project_chat_research_note_save_receipts
       where status='committed-unreported' order by attempt_id`,
    )
    .all() as Array<{ attempt_id: string }>;
  let reported = 0;
  for (const attempt of attempts) {
    reported += reconcileCommittedResearchNoteReceiptsForAttempt(
      database,
      attempt.attempt_id,
      reportedAt,
    );
  }
  return reported;
}

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
         title_model_json,title_revision,created_at,updated_at
       ) values(?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      session.id,
      session.projectId,
      session.title,
      session.isDefault ? 1 : 0,
      session.parentSessionId ?? null,
      session.branchedFromMessageId ?? null,
      session.titleModel ? JSON.stringify(session.titleModel) : null,
      0,
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
  canonical_id: string | null;
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
  canonical_id: string | null;
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

type ExperimentLoggingTemplateRow = Readonly<{
  id: string;
  schema_version: number;
  project_id: string;
  version: number;
  previous_revision_id: string | null;
  system_fields_json: string;
  custom_fields_json: string;
  template_hash: string;
  created_at: string;
}>;

type ExperimentRunRow = Readonly<{
  id: string;
  schema_version: number;
  project_id: string;
  idea_id: string | null;
  title: string;
  status: ExperimentRun['status'];
  mode: ExperimentRun['mode'];
  server_label: string;
  trial_id: string;
  objective_id: string | null;
  objective_version: number | null;
  logging_template_revision_id: string;
  logging_template_json: string;
  progress_current: number | null;
  progress_total: number | null;
  current_step: string | null;
  latest_metric_json: string | null;
  log_reference_json: string | null;
  process_exit_code: number | null;
  process_duration_ms: number | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  version: number;
}>;

type ExperimentRunLogSourceRow = Readonly<{
  reference_id: string;
  project_id: string;
  run_id: string;
  workspace_grant_id: string;
  workspace_subdirectory: string | null;
  relative_path: string;
}>;

type ExperimentRunExecutionBindingRow = Readonly<{
  project_id: string;
  run_id: string;
  workspace_grant_id: string;
}>;

type ExperimentRunExecutionIntentRow = Readonly<{
  project_id: string;
  run_id: string;
  workspace_grant_id: string;
  grant_version: number;
  connection_id: string;
  connection_version: number;
  canonical_root: string;
  canonical_root_hash: string;
  policy_version: number;
  execution_policy_hash: string;
  intent_hash: string;
  workspace_subdirectory: string | null;
  relative_path: string;
  created_at: string;
}>;

type ExperimentEvaluationSessionRow = Readonly<{
  id: string;
  schema_version: number;
  project_id: string;
  title: string;
  status: ExperimentEvaluationSession['status'];
  active_attempt_id: string | null;
  current_revision: number;
  accepted_profile_id: string | null;
  version: number;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}>;

type ExperimentEvaluationMessageRow = Readonly<{
  id: string;
  schema_version: number;
  session_id: string;
  role: ExperimentEvaluationMessage['role'];
  status: ExperimentEvaluationMessage['status'];
  content: string;
  attempt_id: string | null;
  revision: number | null;
  invocation_json: string | null;
  created_at: string;
  completed_at: string;
}>;

type ExperimentEvaluationRevisionRow = Readonly<{
  id: string;
  schema_version: number;
  session_id: string;
  revision: number;
  attempt_id: string;
  draft_json: string;
  content_hash: string;
  invocation_json: string;
  created_at: string;
}>;

type ExperimentEvaluationProfileRow = Readonly<{
  id: string;
  schema_version: number;
  project_id: string;
  name: string;
  source_session_id: string;
  source_revision_id: string;
  draft_json: string;
  content_hash: string;
  code_policy_hash: string;
  invocation_json: string;
  code_path: string;
  prompt_path: string;
  use_count: number;
  created_at: string;
  last_used_at: string;
}>;

type ExperimentMetricTailRow = ExperimentMetricPointRow &
  Readonly<{
    metric_point_total: number;
    tail_rank: number;
  }>;

const ExperimentMetricTailQuerySchema = z
  .object({
    projectId: ExperimentIdeaSchema.shape.projectId,
    ideaIds: z.array(ExperimentIdeaSchema.shape.id).max(EXPERIMENT_MAX_IDEAS_PER_PROJECT),
    perIdeaLimit: z.number().int().positive().max(EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT),
  })
  .strict();

type LectureStudioRow = Readonly<{
  id: string;
  schema_version: number;
  title: string;
  kind: LectureStudio['kind'];
  duration_minutes: number | null;
  output_project_id: string;
  source_project_ids_json: string;
  source_selection_json: string;
  generation_brief_json: string;
  status: LectureStudio['status'];
  active_attempt_id: string | null;
  current_revision: number;
  version: number;
  last_error_code: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}>;

type LectureStudioSummaryRow = Omit<
  LectureStudioRow,
  'source_project_ids_json' | 'source_selection_json' | 'generation_brief_json'
>;

type LectureStudioMessageRow = Readonly<{
  id: string;
  schema_version: number;
  studio_id: string;
  role: LectureStudioMessage['role'];
  status: LectureStudioMessage['status'];
  content: string;
  attempt_id: string | null;
  revision: number | null;
  invocation_json: string | null;
  created_at: string;
  completed_at: string;
}>;

type LectureStudioRevisionRow = Readonly<{
  id: string;
  schema_version: number;
  studio_id: string;
  revision: number;
  attempt_id: string;
  source_manifest_json: string;
  source_manifest_sha256: string;
  lecture_notes_markdown: string;
  slides_markdown: string;
  lecture_notes_latex: string | null;
  slides_latex: string | null;
  artifacts_json: string;
  invocation_json: string;
  created_at: string;
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

function toExperimentLoggingTemplate(row: ExperimentLoggingTemplateRow): ExperimentLoggingTemplate {
  return ExperimentLoggingTemplateSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    previousRevisionId: row.previous_revision_id,
    systemFields: JSON.parse(row.system_fields_json) as unknown,
    customFields: JSON.parse(row.custom_fields_json) as unknown,
    templateHash: row.template_hash,
    createdAt: row.created_at,
  });
}

function toExperimentRun(row: ExperimentRunRow): ExperimentRun {
  return ExperimentRunSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    projectId: row.project_id,
    ideaId: row.idea_id,
    title: row.title,
    status: row.status,
    mode: row.mode,
    serverLabel: row.server_label,
    trialId: row.trial_id,
    objectiveId: row.objective_id,
    objectiveVersion: row.objective_version,
    loggingTemplate: JSON.parse(row.logging_template_json) as unknown,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    currentStep: row.current_step,
    latestMetric: row.latest_metric_json ? (JSON.parse(row.latest_metric_json) as unknown) : null,
    logReference: row.log_reference_json ? (JSON.parse(row.log_reference_json) as unknown) : null,
    processExitCode: row.process_exit_code,
    processDurationMs: row.process_duration_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    version: row.version,
  });
}

function toExperimentRunLogSource(row: ExperimentRunLogSourceRow): ExperimentRunLogSource {
  return ExperimentRunLogSourceSchema.parse({
    referenceId: row.reference_id,
    projectId: row.project_id,
    runId: row.run_id,
    workspaceGrantId: row.workspace_grant_id,
    workspaceSubdirectory: row.workspace_subdirectory,
    relativePath: row.relative_path,
  });
}

function toExperimentRunExecutionBinding(
  row: ExperimentRunExecutionBindingRow,
): ExperimentRunExecutionBinding {
  return ExperimentRunExecutionBindingSchema.parse({
    projectId: row.project_id,
    runId: row.run_id,
    workspaceGrantId: row.workspace_grant_id,
  });
}

function toExperimentRunExecutionIntent(
  row: ExperimentRunExecutionIntentRow,
): ExperimentRunExecutionIntent {
  return ExperimentRunExecutionIntentSchema.parse({
    projectId: row.project_id,
    runId: row.run_id,
    workspaceGrantId: row.workspace_grant_id,
    grantVersion: row.grant_version,
    connectionId: row.connection_id,
    connectionVersion: row.connection_version,
    canonicalRoot: row.canonical_root,
    canonicalRootHash: row.canonical_root_hash,
    policyVersion: row.policy_version,
    executionPolicyHash: row.execution_policy_hash,
    intentHash: row.intent_hash,
    workspaceSubdirectory: row.workspace_subdirectory,
    relativePath: row.relative_path,
    createdAt: row.created_at,
  });
}

function toExperimentEvaluationSession(
  row: ExperimentEvaluationSessionRow,
): ExperimentEvaluationSession {
  return ExperimentEvaluationSessionSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    activeAttemptId: row.active_attempt_id,
    currentRevision: row.current_revision,
    acceptedProfileId: row.accepted_profile_id,
    version: row.version,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toExperimentEvaluationMessage(
  row: ExperimentEvaluationMessageRow,
): ExperimentEvaluationMessage {
  return ExperimentEvaluationMessageSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    status: row.status,
    content: row.content,
    attemptId: row.attempt_id,
    revision: row.revision,
    invocation: row.invocation_json === null ? null : JSON.parse(row.invocation_json),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
}

function toExperimentEvaluationRevision(
  row: ExperimentEvaluationRevisionRow,
): ExperimentEvaluationRevision {
  return ExperimentEvaluationRevisionSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    sessionId: row.session_id,
    revision: row.revision,
    attemptId: row.attempt_id,
    draft: JSON.parse(row.draft_json) as unknown,
    contentHash: row.content_hash,
    invocation: JSON.parse(row.invocation_json) as unknown,
    createdAt: row.created_at,
  });
}

function toExperimentEvaluationProfile(
  row: ExperimentEvaluationProfileRow,
): ExperimentEvaluationProfile {
  return ExperimentEvaluationProfileSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sourceSessionId: row.source_session_id,
    sourceRevisionId: row.source_revision_id,
    draft: JSON.parse(row.draft_json) as unknown,
    contentHash: row.content_hash,
    codePolicyHash: row.code_policy_hash,
    invocation: JSON.parse(row.invocation_json) as unknown,
    codePath: row.code_path,
    promptPath: row.prompt_path,
    useCount: row.use_count,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  });
}

function insertExperimentEvaluationMessage(
  database: Database.Database,
  input: ExperimentEvaluationMessage,
) {
  const message = ExperimentEvaluationMessageSchema.parse(structuredClone(input));
  database
    .prepare(
      `insert into experiment_evaluation_messages(
         id,schema_version,session_id,role,status,content,attempt_id,revision,
         invocation_json,created_at,completed_at
       ) values(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      message.id,
      message.schemaVersion,
      message.sessionId,
      message.role,
      message.status,
      message.content,
      message.attemptId,
      message.revision,
      message.invocation === null ? null : JSON.stringify(message.invocation),
      message.createdAt,
      message.completedAt,
    );
}

function insertExperimentEvaluationRevision(
  database: Database.Database,
  input: ExperimentEvaluationRevision,
) {
  const revision = ExperimentEvaluationRevisionSchema.parse(structuredClone(input));
  database
    .prepare(
      `insert into experiment_evaluation_revisions(
         id,schema_version,session_id,revision,attempt_id,draft_json,content_hash,
         invocation_json,created_at
       ) values(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      revision.id,
      revision.schemaVersion,
      revision.sessionId,
      revision.revision,
      revision.attemptId,
      JSON.stringify(revision.draft),
      revision.contentHash,
      JSON.stringify(revision.invocation),
      revision.createdAt,
    );
}

function insertExperimentEvaluationProfile(
  database: Database.Database,
  input: ExperimentEvaluationProfile,
) {
  const profile = ExperimentEvaluationProfileSchema.parse(structuredClone(input));
  database
    .prepare(
      `insert into experiment_evaluation_profiles(
         id,schema_version,project_id,name,source_session_id,source_revision_id,draft_json,
         content_hash,code_policy_hash,invocation_json,code_path,prompt_path,use_count,created_at,
         last_used_at
       ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      profile.id,
      profile.schemaVersion,
      profile.projectId,
      profile.name,
      profile.sourceSessionId,
      profile.sourceRevisionId,
      JSON.stringify(profile.draft),
      profile.contentHash,
      profile.codePolicyHash,
      JSON.stringify(profile.invocation),
      profile.codePath,
      profile.promptPath,
      profile.useCount,
      profile.createdAt,
      profile.lastUsedAt,
    );
}

function experimentEvaluationDraftHash(draft: ExperimentEvaluationRevision['draft']) {
  return createHash('sha256').update(JSON.stringify(draft), 'utf8').digest('hex');
}

function sameModelInvocation(left: ModelInvocation | null, right: ModelInvocation) {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

function migrateExperimentEvaluationProfileCodePolicy(database: Database.Database) {
  const columns = database.pragma('table_info(experiment_evaluation_profiles)') as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'code_policy_hash')) {
    database.exec(
      `alter table experiment_evaluation_profiles
       add column code_policy_hash text not null default '${'0'.repeat(64)}'
       check (length(code_policy_hash) = 64)`,
    );
  }
  database.exec(`
    drop trigger if exists experiment_evaluation_profiles_content_guard;
    create trigger experiment_evaluation_profiles_content_guard
      before update of schema_version,project_id,name,source_session_id,source_revision_id,
        draft_json,content_hash,code_policy_hash,invocation_json,code_path,prompt_path,created_at
      on experiment_evaluation_profiles
      begin
        select raise(abort,'experiment_evaluation_profile_content_immutable');
      end;
  `);
}

function migrateLectureStudioGenerationBrief(database: Database.Database) {
  const columns = database.pragma('table_info(lecture_studios)') as Array<{ name: string }>;
  if (columns.some((column) => column.name === 'generation_brief_json')) return;
  const escapedDefault = DEFAULT_LECTURE_STUDIO_GENERATION_BRIEF_JSON.replaceAll("'", "''");
  database.exec(
    `alter table lecture_studios
     add column generation_brief_json text not null default '${escapedDefault}'
     check (length(generation_brief_json) between 2 and 16384)`,
  );
}

function migrateLectureStudioTrash(database: Database.Database) {
  const columns = database.pragma('table_info(lecture_studios)') as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'trashed_at')) {
    database.exec('alter table lecture_studios add column trashed_at text');
  }
  database.exec(`
    create index if not exists lecture_studios_by_trash_updated
      on lecture_studios(trashed_at,updated_at desc,id);
    create table if not exists lecture_studio_trash_receipts (
      idempotency_key text primary key check (length(idempotency_key) = 36),
      receipt_json text not null check (length(receipt_json) between 2 and 1048576),
      completed_at text not null
    );
    create trigger if not exists lecture_studio_trash_receipts_update_guard
      before update on lecture_studio_trash_receipts
      begin
        select raise(abort,'lecture_studio_trash_receipt_append_only');
      end;
    create trigger if not exists lecture_studio_trash_receipts_delete_guard
      before delete on lecture_studio_trash_receipts
      begin
        select raise(abort,'lecture_studio_trash_receipt_append_only');
      end;
    drop trigger if exists lecture_studios_limit;
    create trigger lecture_studios_limit
      before insert on lecture_studios
      when
        (select count(*) from lecture_studios where trashed_at is null) >=
          ${LECTURE_STUDIO_MAX_STUDIOS}
        or (select count(*) from lecture_studios) >= ${LECTURE_STUDIO_MAX_STORED_STUDIOS}
      begin
        select raise(abort,'lecture_studio_limit_reached');
      end;
    drop trigger if exists lecture_studios_restore_limit;
    create trigger lecture_studios_restore_limit
      before update of trashed_at on lecture_studios
      when old.trashed_at is not null and new.trashed_at is null
        and (select count(*) from lecture_studios where trashed_at is null) >=
          ${LECTURE_STUDIO_MAX_STUDIOS}
      begin
        select raise(abort,'lecture_studio_limit_reached');
      end;
    drop trigger if exists lecture_studios_trash_limit;
    create trigger lecture_studios_trash_limit
      before update of trashed_at on lecture_studios
      when old.trashed_at is null and new.trashed_at is not null
        and (select count(*) from lecture_studios where trashed_at is not null) >=
          ${LECTURE_STUDIO_MAX_TRASHED_STUDIOS}
      begin
        select raise(abort,'lecture_studio_limit_reached');
      end;
  `);
}

function migrateLectureStudioRevisionLatex(database: Database.Database) {
  const columns = database.pragma('table_info(lecture_studio_revisions)') as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'lecture_notes_latex')) {
    database.exec(
      `alter table lecture_studio_revisions
       add column lecture_notes_latex text
       check (lecture_notes_latex is null or length(lecture_notes_latex) between 1 and 240000)`,
    );
  }
  if (!columns.some((column) => column.name === 'slides_latex')) {
    database.exec(
      `alter table lecture_studio_revisions
       add column slides_latex text
       check (slides_latex is null or length(slides_latex) between 1 and 240000)`,
    );
  }
  database.exec(`
    create trigger if not exists lecture_studio_revisions_latex_pair_insert
      before insert on lecture_studio_revisions
      when (new.lecture_notes_latex is null) != (new.slides_latex is null)
      begin
        select raise(abort,'lecture_revision_latex_pair_required');
      end;
    create trigger if not exists lecture_studio_revisions_latex_pair_update
      before update of lecture_notes_latex,slides_latex on lecture_studio_revisions
      when (new.lecture_notes_latex is null) != (new.slides_latex is null)
      begin
        select raise(abort,'lecture_revision_latex_pair_required');
      end;
  `);
}

function toLectureStudio(row: LectureStudioRow): LectureStudio {
  return LectureStudioSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    title: row.title,
    kind: row.kind,
    durationMinutes: row.duration_minutes,
    outputProjectId: row.output_project_id,
    sourceProjectIds: JSON.parse(row.source_project_ids_json) as unknown,
    sourceSelection: JSON.parse(row.source_selection_json) as unknown,
    generationBrief: JSON.parse(row.generation_brief_json) as unknown,
    status: row.status,
    activeAttemptId: row.active_attempt_id,
    currentRevision: row.current_revision,
    version: row.version,
    lastErrorCode: row.last_error_code,
    ...(row.trashed_at ? { trashedAt: row.trashed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toLectureStudioSummary(row: LectureStudioSummaryRow): LectureStudioSummary {
  return LectureStudioSummarySchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    title: row.title,
    kind: row.kind,
    durationMinutes: row.duration_minutes,
    outputProjectId: row.output_project_id,
    status: row.status,
    activeAttemptId: row.active_attempt_id,
    currentRevision: row.current_revision,
    version: row.version,
    lastErrorCode: row.last_error_code,
    ...(row.trashed_at ? { trashedAt: row.trashed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toLectureStudioMessage(row: LectureStudioMessageRow): LectureStudioMessage {
  return LectureStudioMessageSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    studioId: row.studio_id,
    role: row.role,
    status: row.status,
    content: row.content,
    attemptId: row.attempt_id,
    revision: row.revision,
    invocation: row.invocation_json === null ? null : JSON.parse(row.invocation_json),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
}

function toLectureStudioRevision(row: LectureStudioRevisionRow): LectureStudioRevision {
  return LectureStudioRevisionSchema.parse({
    schemaVersion: row.lecture_notes_latex !== null ? 2 : 1,
    id: row.id,
    studioId: row.studio_id,
    revision: row.revision,
    attemptId: row.attempt_id,
    sourceManifest: JSON.parse(row.source_manifest_json) as unknown,
    sourceManifestSha256: row.source_manifest_sha256,
    ...(row.lecture_notes_latex !== null && row.slides_latex !== null
      ? { lectureNotesLatex: row.lecture_notes_latex, slidesLatex: row.slides_latex }
      : {
          lectureNotesMarkdown: row.lecture_notes_markdown,
          slidesMarkdown: row.slides_markdown,
        }),
    artifacts: JSON.parse(row.artifacts_json) as unknown,
    invocation: JSON.parse(row.invocation_json) as unknown,
    createdAt: row.created_at,
  });
}

function insertLectureStudioMessage(database: Database.Database, input: LectureStudioMessage) {
  const message = LectureStudioMessageSchema.parse(structuredClone(input));
  database
    .prepare(
      `insert into lecture_studio_messages(
         id,schema_version,studio_id,role,status,content,attempt_id,revision,
         invocation_json,created_at,completed_at
       ) values(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      message.id,
      message.schemaVersion,
      message.studioId,
      message.role,
      message.status,
      message.content,
      message.attemptId,
      message.revision,
      message.invocation === null ? null : JSON.stringify(message.invocation),
      message.createdAt,
      message.completedAt,
    );
}

function insertLectureStudioRevision(database: Database.Database, input: LectureStudioRevision) {
  const revision = LectureStudioRevisionSchema.parse(structuredClone(input));
  database
    .prepare(
      `insert into lecture_studio_revisions(
         id,schema_version,studio_id,revision,attempt_id,source_manifest_json,
         source_manifest_sha256,lecture_notes_markdown,slides_markdown,lecture_notes_latex,
         slides_latex,artifacts_json,invocation_json,created_at
       ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      revision.id,
      1,
      revision.studioId,
      revision.revision,
      revision.attemptId,
      JSON.stringify(revision.sourceManifest),
      revision.sourceManifestSha256,
      revision.schemaVersion === 1 ? revision.lectureNotesMarkdown : 'GOSU_LATEX_V2',
      revision.schemaVersion === 1 ? revision.slidesMarkdown : 'GOSU_LATEX_V2',
      revision.schemaVersion === 2 ? revision.lectureNotesLatex : null,
      revision.schemaVersion === 2 ? revision.slidesLatex : null,
      JSON.stringify(revision.artifacts),
      JSON.stringify(revision.invocation),
      revision.createdAt,
    );
}

function lectureStudioStorageQueryLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid_lecture_query_limit');
  return Math.min(limit, LECTURE_STUDIO_STORAGE_QUERY_LIMIT);
}

function throwMappedLectureStudioStorageError(error: unknown): never {
  if (
    error instanceof Error &&
    /lecture_(?:studio|message|revision)_limit_reached/u.test(error.message)
  ) {
    throw new LectureStudioStorageError('capacity_reached');
  }
  throw error;
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
    canonicalId: row.canonical_id,
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
    canonicalId: row.canonical_id,
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
      `select ordinal,provider,provider_record_id,canonical_id,doi,fingerprint,title,authors_json,
              published_year
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
    canonical_id: candidate.canonicalId ?? null,
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
    canonical_id: state.canonical_id ?? existing.canonical_id,
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
  const byCanonical = candidate.canonicalId
    ? (database
        .prepare(
          `select * from literature_records
           where project_id=? and canonical_id=? limit 1`,
        )
        .get(projectId, candidate.canonicalId) as LiteratureRecordRow | undefined)
    : undefined;
  const strongIdentities = [byDoi, byProvider, byCanonical].filter(
    (record): record is LiteratureRecordRow => record !== undefined,
  );
  if (new Set(strongIdentities.map((record) => record.id)).size > 1) {
    throw new LiteratureStorageError('identity_conflict');
  }
  const matched = byDoi ?? byCanonical ?? byProvider;
  if (matched && candidate.doi && matched.doi && candidate.doi !== matched.doi) {
    throw new LiteratureStorageError('identity_conflict');
  }
  if (
    matched &&
    candidate.canonicalId &&
    matched.canonical_id &&
    candidate.canonicalId !== matched.canonical_id
  ) {
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
  const candidateHasStrongIdentity = Boolean(
    candidate.doi || candidate.providerId || candidate.canonicalId,
  );
  if (!candidateHasStrongIdentity) {
    if (fingerprintMatches.length > 1) {
      throw new LiteratureStorageError('identity_conflict');
    }
    const weakMatch = fingerprintMatches[0];
    if (
      weakMatch &&
      (weakMatch.doi !== null ||
        weakMatch.provider_record_id !== null ||
        weakMatch.canonical_id !== null)
    ) {
      throw new LiteratureStorageError('identity_conflict');
    }
    return weakMatch;
  }
  if (fingerprintMatches.length !== 1) return undefined;
  const weakMatch = fingerprintMatches[0]!;
  if (
    weakMatch.doi === null &&
    weakMatch.provider_record_id === null &&
    weakMatch.canonical_id === null
  )
    return weakMatch;
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
  const canonicalCollision = state.canonical_id
    ? database
        .prepare(
          `select 1 from literature_records
           where project_id=? and canonical_id=? and id<>? limit 1`,
        )
        .get(projectId, state.canonical_id, recordId)
    : undefined;
  if (doiCollision || providerCollision || canonicalCollision) {
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
           id,schema_version,project_id,source_provider,provider_record_id,canonical_id,doi,fingerprint,title,
           authors_json,container_title,published_year,topics_json,search_tags_json,work_type,citation_count,
           source_url,citation_key,review_status,manual_topics_json,manual_summary,manual_relevance,
           ai_topics_json,ai_summary,ai_relevance,ai_study_type,ai_limitations_json,
           ai_model_provenance_json,annotation_version,version,created_at,updated_at,deleted_at
         ) values(?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?,null)`,
      )
      .run(
        id,
        projectId,
        state.source_provider,
        state.provider_record_id,
        state.canonical_id,
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
    'hugging-face': 1,
    crossref: 2,
    'semantic-scholar': 3,
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
        ...(existing.canonical_id ? { canonicalId: existing.canonical_id } : {}),
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
    existing.canonical_id !== merged.canonical_id ||
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
         source_provider=?,provider_record_id=?,canonical_id=?,doi=?,fingerprint=?,title=?,authors_json=?,container_title=?,
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
      merged.canonical_id,
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

function migrateLiteratureHuggingFaceProvider(database: Database.Database) {
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(LITERATURE_HUGGING_FACE_PROVIDER_MIGRATION);
  if (migrationApplied) return;
  database
    .transaction(() => {
      const schema = database
        .prepare(
          "select sql from sqlite_master where type='table' and name='literature_search_conflicts'",
        )
        .get() as { sql: string | null } | undefined;
      if (!/hugging-face/iu.test(schema?.sql ?? '')) {
        database.exec(`
          alter table literature_search_conflicts rename to literature_search_conflicts_legacy;
          create table literature_search_conflicts (
            search_run_id text not null references literature_search_runs(id) on delete cascade,
            ordinal integer not null check (ordinal between 1 and 50),
            provider text not null check (
              provider in ('crossref','semantic-scholar','hugging-face')
            ),
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
        .run(LITERATURE_HUGGING_FACE_PROVIDER_MIGRATION, new Date().toISOString());
    })
    .immediate();
}

function migrateProjectChatQueueOrdering(database: Database.Database) {
  database.exec(`
    create table if not exists project_chat_queue_sequence (
      singleton_id integer primary key check (singleton_id = 1),
      next_sequence integer not null check (next_sequence > 0)
    );
    insert or ignore into project_chat_queue_sequence(singleton_id,next_sequence) values(1,1);
  `);
  const columns = database.pragma('table_info(project_chat_queued_turns)') as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'enqueue_sequence')) {
    database.exec(
      `alter table project_chat_queued_turns add column enqueue_sequence integer
       check (enqueue_sequence is null or enqueue_sequence > 0)`,
    );
  }
  database
    .transaction(() => {
      const counter = database
        .prepare('select next_sequence from project_chat_queue_sequence where singleton_id=1')
        .get() as { next_sequence: number };
      const maximum = database
        .prepare(
          'select coalesce(max(enqueue_sequence),0) as maximum from project_chat_queued_turns',
        )
        .get() as { maximum: number };
      let nextSequence = Math.max(counter.next_sequence, maximum.maximum + 1);
      const legacyRows = database
        .prepare(
          `select id from project_chat_queued_turns where enqueue_sequence is null
           order by created_at,id`,
        )
        .all() as Array<{ id: string }>;
      const backfill = database.prepare(
        `update project_chat_queued_turns set enqueue_sequence=?
         where id=? and enqueue_sequence is null`,
      );
      for (const row of legacyRows) {
        backfill.run(nextSequence, row.id);
        nextSequence += 1;
      }
      database
        .prepare(`update project_chat_queue_sequence set next_sequence=? where singleton_id=1`)
        .run(nextSequence);
    })
    .immediate();
  database.exec(`
    create unique index if not exists project_chat_queued_turns_enqueue_sequence
      on project_chat_queued_turns(enqueue_sequence);
    create index if not exists project_chat_queued_turns_by_project_order
      on project_chat_queued_turns(project_id,priority,enqueue_sequence);
  `);
}

function migrateProjectChatResearchNoteAbandoned(database: Database.Database) {
  const table = database
    .prepare(
      `select sql from sqlite_master
       where type='table' and name='project_chat_research_note_save_receipts'`,
    )
    .get() as { sql: string | null } | undefined;
  const supportsAbandoned = /['"]abandoned['"]/u.test(table?.sql ?? '');
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(PROJECT_CHAT_RESEARCH_NOTE_ABANDONED_MIGRATION);
  if (migrationApplied) {
    if (!supportsAbandoned) throw new Error('research_note_abandoned_schema_invalid');
    return;
  }
  database
    .transaction(() => {
      if (!supportsAbandoned) {
        database.exec(`
          create table project_chat_research_note_save_receipts_v2 (
            project_id text not null,
            session_id text not null references project_chat_sessions(id),
            attempt_id text not null references project_chat_attempts(id) on delete cascade,
            binding_id text not null check (length(binding_id) = 64),
            category text not null check (
              category in (
                'literature','papers','experiments','project-progress','idea-development'
              )
            ),
            artifact_id text not null check (length(artifact_id) = 16),
            expected_content_sha256 text not null check (length(expected_content_sha256) = 64),
            status text not null check (
              status in ('staged','uncertain','abandoned','committed-unreported','reported')
            ),
            relative_path text check (
              relative_path is null or length(relative_path) between 1 and 1000
            ),
            staged_at text not null,
            updated_at text not null,
            committed_at text,
            reported_at text,
            primary key(attempt_id,artifact_id),
            check (
              (status in ('staged','uncertain','abandoned') and
                relative_path is null and committed_at is null) or
              (status in ('committed-unreported','reported') and
                relative_path is not null and committed_at is not null)
            ),
            check ((status in ('reported','abandoned')) = (reported_at is not null))
          );
          insert into project_chat_research_note_save_receipts_v2(
            project_id,session_id,attempt_id,binding_id,category,artifact_id,
            expected_content_sha256,status,relative_path,staged_at,updated_at,
            committed_at,reported_at
          )
          select project_id,session_id,attempt_id,binding_id,category,artifact_id,
                 expected_content_sha256,status,relative_path,staged_at,updated_at,
                 committed_at,reported_at
          from project_chat_research_note_save_receipts;
          drop table project_chat_research_note_save_receipts;
          alter table project_chat_research_note_save_receipts_v2
            rename to project_chat_research_note_save_receipts;
          create index project_chat_research_note_receipts_by_status
            on project_chat_research_note_save_receipts(status,updated_at,attempt_id);
        `);
      }
      database
        .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
        .run(PROJECT_CHAT_RESEARCH_NOTE_ABANDONED_MIGRATION, new Date().toISOString());
    })
    .immediate();
}

function migrateLiteratureCanonicalIdentity(database: Database.Database) {
  const columns = database.pragma('table_info(literature_records)') as Array<{ name: string }>;
  const hasCanonicalId = columns.some((column) => column.name === 'canonical_id');
  const conflictColumns = database.pragma('table_info(literature_search_conflicts)') as Array<{
    name: string;
  }>;
  const conflictsHaveCanonicalId = conflictColumns.some((column) => column.name === 'canonical_id');
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(LITERATURE_CANONICAL_IDENTITY_MIGRATION);
  const canonicalIndex = database
    .prepare(
      "select sql from sqlite_master where type='index' and name='literature_record_canonical_identity'",
    )
    .get() as { sql: string | null } | undefined;
  const weakFingerprintIndex = database
    .prepare(
      "select sql from sqlite_master where type='index' and name='literature_record_weak_fingerprint_identity'",
    )
    .get() as { sql: string | null } | undefined;
  if (
    migrationApplied &&
    hasCanonicalId &&
    conflictsHaveCanonicalId &&
    /canonical_id\s+is\s+not\s+null/iu.test(canonicalIndex?.sql ?? '') &&
    /canonical_id\s+is\s+null/iu.test(weakFingerprintIndex?.sql ?? '')
  ) {
    return;
  }
  database
    .transaction(() => {
      if (!hasCanonicalId) {
        database.exec(
          `alter table literature_records add column canonical_id text
           check (canonical_id is null or length(canonical_id) between 1 and 512)`,
        );
      }
      if (!conflictsHaveCanonicalId) {
        database.exec(
          `alter table literature_search_conflicts add column canonical_id text
           check (canonical_id is null or length(canonical_id) between 1 and 512)`,
        );
      }
      const rows = database
        .prepare(
          `select id,project_id,provider_record_id,canonical_id from literature_records
           where source_provider='hugging-face' order by project_id,created_at,id`,
        )
        .all() as Array<{
        id: string;
        project_id: string;
        provider_record_id: string | null;
        canonical_id: string | null;
      }>;
      const seen = new Set(
        (
          database
            .prepare(
              `select project_id,canonical_id from literature_records
               where canonical_id is not null order by project_id,id`,
            )
            .all() as Array<{ project_id: string; canonical_id: string }>
        ).map((row) => `${row.project_id}\0${row.canonical_id}`),
      );
      const update = database.prepare(
        'update literature_records set canonical_id=? where id=? and canonical_id is null',
      );
      for (const row of rows) {
        if (row.canonical_id !== null) continue;
        const canonicalId = normalizeArxivCanonicalId(row.provider_record_id);
        if (!canonicalId) continue;
        const key = `${row.project_id}\0${canonicalId}`;
        if (seen.has(key)) continue;
        update.run(canonicalId, row.id);
        seen.add(key);
      }
      database.exec(`
        drop index if exists literature_record_canonical_identity;
        create unique index literature_record_canonical_identity
          on literature_records(project_id,canonical_id) where canonical_id is not null;
        drop index if exists literature_record_weak_fingerprint_identity;
        create unique index literature_record_weak_fingerprint_identity
          on literature_records(project_id,fingerprint)
          where doi is null and provider_record_id is null and canonical_id is null;
      `);
      database
        .prepare('insert or replace into local_schema_migrations(id,applied_at) values(?,?)')
        .run(LITERATURE_CANONICAL_IDENTITY_MIGRATION, new Date().toISOString());
    })
    .immediate();
}

function installManuscriptIdentityGuards(database: Database.Database) {
  database.exec(`
    create trigger if not exists manuscript_records_identity_insert_guard
      before insert on manuscript_records
      when json_extract(new.record_json,'$.id') is not new.id
        or json_extract(new.record_json,'$.projectId') is not new.project_id
        or json_extract(new.record_json,'$.version') is not new.version
      begin
        select raise(abort,'manuscript_record_identity_mismatch');
      end;
    create trigger if not exists manuscript_records_identity_update_guard
      before update on manuscript_records
      when json_extract(new.record_json,'$.id') is not new.id
        or json_extract(new.record_json,'$.projectId') is not new.project_id
        or json_extract(new.record_json,'$.version') is not new.version
      begin
        select raise(abort,'manuscript_record_identity_mismatch');
      end;
    create trigger if not exists manuscript_workspace_connections_identity_insert_guard
      before insert on manuscript_workspace_connections
      when not exists (
        select 1 from manuscript_records
        where id=new.manuscript_id and project_id=new.project_id
      )
        or json_extract(new.connection_json,'$.binding.bindingId') is not new.binding_id
        or json_extract(new.connection_json,'$.binding.projectId') is not new.project_id
        or json_extract(new.connection_json,'$.binding.manuscriptId') is not new.manuscript_id
        or json_extract(new.connection_json,'$.binding.providerId') is not new.provider_id
        or json_extract(new.connection_json,'$.binding.version') is not new.binding_version
        or json_extract(new.connection_json,'$.binding.enabled') is not new.enabled
        or json_extract(new.connection_json,'$.anchor.bindingId') is not new.binding_id
      begin
        select raise(abort,'manuscript_connection_identity_mismatch');
      end;
    create trigger if not exists manuscript_workspace_connections_identity_update_guard
      before update on manuscript_workspace_connections
      when not exists (
        select 1 from manuscript_records
        where id=new.manuscript_id and project_id=new.project_id
      )
        or json_extract(new.connection_json,'$.binding.bindingId') is not new.binding_id
        or json_extract(new.connection_json,'$.binding.projectId') is not new.project_id
        or json_extract(new.connection_json,'$.binding.manuscriptId') is not new.manuscript_id
        or json_extract(new.connection_json,'$.binding.providerId') is not new.provider_id
        or json_extract(new.connection_json,'$.binding.version') is not new.binding_version
        or json_extract(new.connection_json,'$.binding.enabled') is not new.enabled
        or json_extract(new.connection_json,'$.anchor.bindingId') is not new.binding_id
      begin
        select raise(abort,'manuscript_connection_identity_mismatch');
      end;
    create trigger if not exists manuscript_checkpoints_identity_insert_guard
      before insert on manuscript_checkpoints
      when not exists (
        select 1 from manuscript_workspace_connections
        where binding_id=new.binding_id
          and project_id=new.project_id
          and manuscript_id=new.manuscript_id
          and provider_id=json_extract(new.checkpoint_json,'$.providerId')
      )
        or json_extract(new.checkpoint_json,'$.checkpointId') is not new.checkpoint_id
        or json_extract(new.checkpoint_json,'$.bindingId') is not new.binding_id
        or json_extract(new.checkpoint_json,'$.projectId') is not new.project_id
        or json_extract(new.checkpoint_json,'$.manuscriptId') is not new.manuscript_id
        or json_extract(new.checkpoint_json,'$.providerRevision') is not new.provider_revision
      begin
        select raise(abort,'manuscript_checkpoint_identity_mismatch');
      end;
    create trigger if not exists manuscript_artifact_purge_queue_identity_insert_guard
      before insert on manuscript_artifact_purge_queue
      when not exists (
        select 1 from manuscript_workspace_connections
        where binding_id=new.binding_id
          and project_id=new.project_id
          and provider_id=new.provider_id
      )
      begin
        select raise(abort,'manuscript_artifact_purge_identity_mismatch');
      end;
    create trigger if not exists manuscript_credential_cleanup_identity_insert_guard
      before insert on manuscript_credential_cleanup_queue
      when new.provider_id='overleaf_git' and not exists (
        select 1
        from manuscript_workspace_connections connection
        join overleaf_git_bindings overleaf on overleaf.binding_id=connection.binding_id
        where connection.provider_id=new.provider_id
          and overleaf.credential_ref=new.credential_ref
      )
      begin
        select raise(abort,'manuscript_credential_cleanup_identity_mismatch');
      end;
  `);
}

function installExperimentRunGuards(database: Database.Database) {
  database.exec(`
    drop trigger if exists experiment_runs_project_limit;
    drop trigger if exists experiment_runs_insert_guard;
    drop trigger if exists experiment_runs_update_guard;
    drop trigger if exists experiment_runs_delete_guard;
    create index if not exists experiment_runs_by_project
      on experiment_runs(project_id,updated_at desc,id);
    create trigger if not exists experiment_runs_project_limit
      before insert on experiment_runs
      when (
        select count(*) from experiment_runs where project_id=new.project_id
      ) >= ${EXPERIMENT_MAX_RUNS_PER_PROJECT}
      begin
        select raise(abort,'experiment_run_limit_reached');
      end;
    create trigger if not exists experiment_runs_insert_guard
      before insert on experiment_runs
      when json_extract(new.logging_template_json,'$.revisionId') is not
             new.logging_template_revision_id
        or (new.process_exit_code is null) <> (new.process_duration_ms is null)
        or (
          json_extract(new.log_reference_json,'$.validationState')='pending'
          and new.status<>'verifying'
        )
        or (
          new.status='verifying'
          and (
            json_extract(new.log_reference_json,'$.validationState') is not 'pending'
            or new.process_exit_code is null
          )
        )
        or (
          new.status='succeeded'
          and (
            json_extract(new.log_reference_json,'$.validationState') is not 'valid'
            or new.process_exit_code is not 0
            or new.process_duration_ms is null
          )
        )
      begin
        select raise(abort,'experiment_run_provenance_invalid');
      end;
    create trigger if not exists experiment_runs_update_guard
      before update on experiment_runs
      when new.id is not old.id
        or new.schema_version is not old.schema_version
        or new.project_id is not old.project_id
        or new.idea_id is not old.idea_id
        or new.title is not old.title
        or new.mode is not old.mode
        or new.server_label is not old.server_label
        or new.trial_id is not old.trial_id
        or new.objective_id is not old.objective_id
        or new.objective_version is not old.objective_version
        or new.logging_template_revision_id is not old.logging_template_revision_id
        or new.logging_template_json is not old.logging_template_json
        or new.created_at is not old.created_at
        or (new.process_exit_code is null) <> (new.process_duration_ms is null)
        or (
          json_extract(new.log_reference_json,'$.validationState')='pending'
          and new.status<>'verifying'
        )
        or (
          new.status='verifying'
          and (
            json_extract(new.log_reference_json,'$.validationState') is not 'pending'
            or new.process_exit_code is null
          )
        )
        or (
          new.status='succeeded'
          and (
            json_extract(new.log_reference_json,'$.validationState') is not 'valid'
            or new.process_exit_code is not 0
            or new.process_duration_ms is null
          )
        )
      begin
        select raise(abort,'experiment_run_provenance_invalid');
      end;
    create trigger if not exists experiment_runs_delete_guard
      before delete on experiment_runs
      begin
        select raise(abort,'experiment_run_provenance_append_only');
      end;
  `);
}

function quarantineUnverifiedExperimentSuccesses(database: Database.Database) {
  database.exec('drop trigger if exists experiment_runs_update_guard');
  const quarantinedAt = new Date().toISOString();
  database
    .prepare(
      `update experiment_runs
       set status='lost',current_step='Legacy result requires provenance review',
           log_reference_json=case
             when json_extract(log_reference_json,'$.validationState')='pending'
               then json_set(log_reference_json,'$.validationState','invalid')
             else log_reference_json
           end,
           updated_at=?,completed_at=coalesce(completed_at,?),version=version+1
       where status='succeeded'
         and (
           json_extract(log_reference_json,'$.validationState') is not 'valid'
           or process_exit_code is not 0
           or process_duration_ms is null
         )`,
    )
    .run(quarantinedAt, quarantinedAt);
}

function migrateExperimentRunsHardening(database: Database.Database) {
  const columns = database.pragma('table_info(experiment_runs)') as Array<{ name: string }>;
  const schema = database
    .prepare("select sql from sqlite_master where type='table' and name='experiment_runs'")
    .get() as { sql: string | null } | undefined;
  const hasExitCode = columns.some(({ name }) => name === 'process_exit_code');
  const hasDuration = columns.some(({ name }) => name === 'process_duration_ms');
  const supportsVerifying = schema?.sql?.includes("'verifying'") === true;
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(EXPERIMENT_RUNS_HARDENING_MIGRATION);
  const current = hasExitCode && hasDuration && supportsVerifying;
  if (migrationApplied) {
    if (!current) throw new Error('experiment_runs_hardening_schema_invalid');
    database
      .transaction(() => {
        quarantineUnverifiedExperimentSuccesses(database);
        installExperimentRunGuards(database);
      })
      .immediate();
    return;
  }

  if (current) {
    database
      .transaction(() => {
        quarantineUnverifiedExperimentSuccesses(database);
        installExperimentRunGuards(database);
        database
          .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
          .run(EXPERIMENT_RUNS_HARDENING_MIGRATION, new Date().toISOString());
      })
      .immediate();
    return;
  }

  if (database.prepare("select 1 from experiment_runs where status='verifying' limit 1").get()) {
    throw new Error('experiment_runs_hardening_recovery_required');
  }

  const foreignKeysEnabled = Number(database.pragma('foreign_keys', { simple: true })) === 1;
  database.pragma('foreign_keys=OFF');
  try {
    database
      .transaction(() => {
        database.exec(`
          drop trigger if exists experiment_runs_project_limit;
          drop trigger if exists experiment_runs_insert_guard;
          drop trigger if exists experiment_runs_update_guard;
          drop trigger if exists experiment_runs_delete_guard;
          drop index if exists experiment_runs_by_project;
          drop table if exists experiment_runs_hardened;
          create table experiment_runs_hardened (
            id text primary key check (length(id) = 36),
            schema_version integer not null check (schema_version = 1),
            project_id text not null check (length(project_id) = 36),
            idea_id text check (idea_id is null or length(idea_id) = 36),
            title text not null check (length(title) between 1 and 160),
            status text not null check (
              status in ('queued','running','verifying','succeeded','failed','cancelled','lost')
            ),
            mode text not null check (mode in ('comparable','exploratory')),
            server_label text not null check (length(server_label) between 1 and 120),
            trial_id text not null check (length(trial_id) between 1 and 128),
            objective_id text check (objective_id is null or length(objective_id) = 36),
            objective_version integer check (objective_version is null or objective_version > 0),
            logging_template_revision_id text not null check (
              length(logging_template_revision_id) = 36
            ),
            logging_template_json text not null check (
              length(logging_template_json) between 2 and 65536
            ),
            progress_current integer check (progress_current is null or progress_current >= 0),
            progress_total integer check (progress_total is null or progress_total > 0),
            current_step text check (current_step is null or length(current_step) between 1 and 160),
            latest_metric_json text check (
              latest_metric_json is null or length(latest_metric_json) between 2 and 8192
            ),
            log_reference_json text check (
              log_reference_json is null or length(log_reference_json) between 2 and 16384
            ),
            process_exit_code integer check (
              process_exit_code is null or process_exit_code between 0 and 255
            ),
            process_duration_ms integer check (
              process_duration_ms is null or process_duration_ms >= 0
            ),
            created_at text not null,
            updated_at text not null,
            started_at text,
            completed_at text,
            version integer not null check (version > 0),
            unique(project_id,id),
            unique(project_id,trial_id),
            check ((objective_id is null) = (objective_version is null)),
            check (mode='exploratory' or (idea_id is not null and objective_id is not null)),
            check (mode='comparable' or objective_id is null),
            check (
              progress_current is null or progress_total is null or progress_current <= progress_total
            ),
            foreign key(project_id,idea_id) references experiment_ideas(project_id,id),
            foreign key(project_id,logging_template_revision_id)
              references experiment_logging_template_revisions(project_id,id)
          );
        `);
        const exitCodeExpression = hasExitCode ? 'process_exit_code' : 'null';
        const durationExpression = hasDuration ? 'process_duration_ms' : 'null';
        const migrationTimestamp = new Date().toISOString();
        const statusExpression =
          hasExitCode && hasDuration
            ? "case when status='running' then 'lost' else status end"
            : "case when status in ('running','succeeded') then 'lost' else status end";
        const currentStepExpression =
          hasExitCode && hasDuration
            ? "case when status='running' then 'Interrupted before durable outcome reconciliation' else current_step end"
            : "case when status='succeeded' then 'Legacy result requires provenance review' when status='running' then 'Interrupted before durable outcome reconciliation' else current_step end";
        const convertedExpression =
          hasExitCode && hasDuration ? "status='running'" : "status in ('running','succeeded')";
        database
          .prepare(
            `
          insert into experiment_runs_hardened(
            id,schema_version,project_id,idea_id,title,status,mode,server_label,trial_id,
            objective_id,objective_version,logging_template_revision_id,logging_template_json,
            progress_current,progress_total,current_step,latest_metric_json,log_reference_json,
            process_exit_code,process_duration_ms,created_at,updated_at,started_at,completed_at,version
          )
          select id,schema_version,project_id,idea_id,title,${statusExpression},mode,server_label,trial_id,
                 objective_id,objective_version,logging_template_revision_id,logging_template_json,
                 progress_current,progress_total,${currentStepExpression},latest_metric_json,
                 log_reference_json,${exitCodeExpression},${durationExpression},created_at,
                 case when ${convertedExpression} then ? else updated_at end,started_at,
                 case when ${convertedExpression} then coalesce(completed_at,?) else completed_at end,
                 version + case when ${convertedExpression} then 1 else 0 end
          from experiment_runs;
        `,
          )
          .run(migrationTimestamp, migrationTimestamp);
        const invalid = database
          .prepare(
            `select 1 from experiment_runs_hardened
             where json_extract(logging_template_json,'$.revisionId') is not
                     logging_template_revision_id
                or (process_exit_code is null) <> (process_duration_ms is null)
                or (
                  json_extract(log_reference_json,'$.validationState')='pending'
                  and status<>'verifying'
                )
                or (
                  status='succeeded'
                  and (
                    json_extract(log_reference_json,'$.validationState') is not 'valid'
                    or process_exit_code is not 0
                    or process_duration_ms is null
                  )
                )
             limit 1`,
          )
          .get();
        if (invalid) throw new Error('experiment_runs_hardening_recovery_required');
        database.exec(`
          drop table experiment_runs;
          alter table experiment_runs_hardened rename to experiment_runs;
        `);
        installExperimentRunGuards(database);
        const violations = database.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) throw new Error('experiment_runs_hardening_foreign_key_invalid');
        database
          .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
          .run(EXPERIMENT_RUNS_HARDENING_MIGRATION, new Date().toISOString());
      })
      .immediate();
  } finally {
    if (foreignKeysEnabled) database.pragma('foreign_keys=ON');
  }
}

function installExperimentRunExecutionIntentGuards(database: Database.Database) {
  database.exec(`
    drop trigger if exists experiment_run_execution_intents_delete_guard;
    drop trigger if exists experiment_run_execution_intents_update_guard;
    drop trigger if exists experiment_run_execution_intent_legacy_tombstones_delete_guard;
    drop trigger if exists experiment_run_execution_intent_legacy_tombstones_update_guard;
    create trigger experiment_run_execution_intents_delete_guard
      before delete on experiment_run_execution_intents
      begin
        select raise(abort,'experiment_run_execution_intent_append_only');
      end;
    create trigger experiment_run_execution_intents_update_guard
      before update on experiment_run_execution_intents
      begin
        select raise(abort,'experiment_run_execution_intent_append_only');
      end;
    create trigger experiment_run_execution_intent_legacy_tombstones_delete_guard
      before delete on experiment_run_execution_intent_legacy_tombstones
      begin
        select raise(abort,'experiment_run_execution_intent_tombstone_append_only');
      end;
    create trigger experiment_run_execution_intent_legacy_tombstones_update_guard
      before update on experiment_run_execution_intent_legacy_tombstones
      begin
        select raise(abort,'experiment_run_execution_intent_tombstone_append_only');
      end;
  `);
}

function migrateExperimentRunExecutionIntentAuthority(database: Database.Database) {
  const columns = database.pragma('table_info(experiment_run_execution_intents)') as Array<{
    name: string;
  }>;
  const columnNames = new Set(columns.map(({ name }) => name));
  const legacyColumns = [
    'project_id',
    'run_id',
    'workspace_grant_id',
    'intent_hash',
    'workspace_subdirectory',
    'relative_path',
    'created_at',
  ] as const;
  const authorityColumns = [
    'grant_version',
    'connection_id',
    'connection_version',
    'canonical_root',
    'canonical_root_hash',
    'policy_version',
    'execution_policy_hash',
  ] as const;
  const hasLegacyColumns = legacyColumns.every((name) => columnNames.has(name));
  const current = hasLegacyColumns && authorityColumns.every((name) => columnNames.has(name));
  const migrationApplied = database
    .prepare('select 1 from local_schema_migrations where id=?')
    .get(EXPERIMENT_RUN_INTENT_AUTHORITY_MIGRATION);

  if (migrationApplied) {
    if (!current) throw new Error('experiment_run_execution_intent_authority_schema_invalid');
    installExperimentRunExecutionIntentGuards(database);
    return;
  }
  if (!hasLegacyColumns) {
    throw new Error('experiment_run_execution_intent_authority_schema_invalid');
  }
  if (current) {
    database
      .transaction(() => {
        installExperimentRunExecutionIntentGuards(database);
        database
          .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
          .run(EXPERIMENT_RUN_INTENT_AUTHORITY_MIGRATION, new Date().toISOString());
      })
      .immediate();
    return;
  }

  const foreignKeysEnabled = Number(database.pragma('foreign_keys', { simple: true })) === 1;
  database.pragma('foreign_keys=OFF');
  try {
    database
      .transaction(() => {
        database.exec(`
          drop trigger if exists experiment_run_execution_intents_delete_guard;
          drop trigger if exists experiment_run_execution_intents_update_guard;
          drop trigger if exists experiment_runs_update_guard;
          drop table if exists experiment_run_execution_intents_hardened;
          create table experiment_run_execution_intents_hardened (
            project_id text not null check (length(project_id) = 36),
            run_id text not null check (length(run_id) = 36),
            workspace_grant_id text not null check (length(workspace_grant_id) = 36),
            grant_version integer not null check (grant_version > 0),
            connection_id text not null check (length(connection_id) = 36),
            connection_version integer not null check (connection_version > 0),
            canonical_root text not null check (length(canonical_root) between 1 and 1024),
            canonical_root_hash text not null check (length(canonical_root_hash) = 64),
            policy_version integer not null check (policy_version > 0),
            execution_policy_hash text not null check (length(execution_policy_hash) = 64),
            intent_hash text not null check (length(intent_hash) = 64),
            workspace_subdirectory text check (
              workspace_subdirectory is null or length(workspace_subdirectory) <= 512
            ),
            relative_path text not null check (length(relative_path) between 1 and 512),
            created_at text not null,
            primary key(project_id,run_id),
            foreign key(project_id,run_id) references experiment_runs(project_id,id)
          );
        `);
        const legacyIntents = database
          .prepare(
            `select project_id,run_id,workspace_grant_id,intent_hash,
                    workspace_subdirectory,relative_path,created_at
             from experiment_run_execution_intents order by project_id,run_id`,
          )
          .all() as Array<{
          project_id: string;
          run_id: string;
          workspace_grant_id: string;
          intent_hash: string;
          workspace_subdirectory: string | null;
          relative_path: string;
          created_at: string;
        }>;
        const selectOrigin = database.prepare(
          `select grant.version as grant_version,grant.connection_id,grant.canonical_root,
                  connection.version as connection_version
           from ssh_workspace_grants grant
           join ssh_connections connection on connection.id=grant.connection_id
           where grant.project_id=? and grant.id=?`,
        );
        const insertHardened = database.prepare(
          `insert into experiment_run_execution_intents_hardened(
             project_id,run_id,workspace_grant_id,grant_version,connection_id,
             connection_version,canonical_root,canonical_root_hash,policy_version,
             execution_policy_hash,intent_hash,workspace_subdirectory,relative_path,created_at
           ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        );
        const insertTombstone = database.prepare(
          `insert or ignore into experiment_run_execution_intent_legacy_tombstones(
             project_id,run_id,workspace_grant_id,intent_hash,workspace_subdirectory,
             relative_path,created_at,migrated_at,recovery_reason
           ) values(?,?,?,?,?,?,?,?,?)`,
        );
        const quarantineRun = database.prepare(
          `update experiment_runs
           set status='lost',
               current_step='Legacy execution intent requires provenance review',
               log_reference_json=case
                 when json_extract(log_reference_json,'$.validationState')='pending'
                   then json_set(log_reference_json,'$.validationState','invalid')
                 else log_reference_json
               end,
               completed_at=coalesce(completed_at,?),updated_at=?,version=version+1
           where project_id=? and id=? and status in ('queued','running','verifying','succeeded')`,
        );
        const migratedAt = new Date().toISOString();
        for (const intent of legacyIntents) {
          const origin = selectOrigin.get(intent.project_id, intent.workspace_grant_id) as
            | {
                grant_version: number;
                connection_id: string;
                canonical_root: string;
                connection_version: number;
              }
            | undefined;
          if (origin) {
            insertHardened.run(
              intent.project_id,
              intent.run_id,
              intent.workspace_grant_id,
              origin.grant_version,
              origin.connection_id,
              origin.connection_version,
              origin.canonical_root,
              createHash('sha256').update(origin.canonical_root, 'utf8').digest('hex'),
              1,
              LEGACY_EXPERIMENT_EXECUTION_POLICY_HASH,
              intent.intent_hash,
              intent.workspace_subdirectory,
              intent.relative_path,
              intent.created_at,
            );
          } else {
            insertTombstone.run(
              intent.project_id,
              intent.run_id,
              intent.workspace_grant_id,
              intent.intent_hash,
              intent.workspace_subdirectory,
              intent.relative_path,
              intent.created_at,
              migratedAt,
              'legacy_origin_unrecoverable',
            );
          }
          quarantineRun.run(migratedAt, migratedAt, intent.project_id, intent.run_id);
        }
        database.exec(`
          drop table experiment_run_execution_intents;
          alter table experiment_run_execution_intents_hardened
            rename to experiment_run_execution_intents;
        `);
        installExperimentRunExecutionIntentGuards(database);
        installExperimentRunGuards(database);
        const violations = database.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
          throw new Error('experiment_run_execution_intent_authority_foreign_key_invalid');
        }
        database
          .prepare('insert into local_schema_migrations(id,applied_at) values(?,?)')
          .run(EXPERIMENT_RUN_INTENT_AUTHORITY_MIGRATION, migratedAt);
      })
      .immediate();
  } finally {
    if (foreignKeysEnabled) database.pragma('foreign_keys=ON');
  }
}

function visibleExperimentMetricPredicate(pointAlias: 'point' | 'points') {
  return `(
    ${pointAlias}.source<>'runner-summary'
    or exists (
      select 1 from experiment_runs run
      where run.project_id=${pointAlias}.project_id
        and run.trial_id=${pointAlias}.trial_id
        and run.idea_id=${pointAlias}.idea_id
        and run.objective_id=${pointAlias}.objective_id
        and run.objective_version=${pointAlias}.objective_version
        and run.status='succeeded'
        and run.process_exit_code=0
        and run.process_duration_ms is not null
        and json_extract(run.log_reference_json,'$.validationState')='valid'
        and json_extract(run.latest_metric_json,'$.key')=${pointAlias}.metric_key
        and json_type(run.latest_metric_json,'$.value') in ('integer','real')
        and cast(json_extract(run.latest_metric_json,'$.value') as real)=${pointAlias}.value
    )
  )`;
}

function boundedLocalSearch(projectIds: readonly string[], query: string, requestedLimit: number) {
  const requestedIds = new Set(projectIds);
  const ids = [...requestedIds].filter((projectId) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(projectId),
  );
  if (ids.length === 0 || ids.length !== requestedIds.size || ids.length > 128) return null;
  const tokens = query
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 16);
  if (tokens.length === 0) return null;
  return {
    ids,
    tokens,
    limit: Math.max(1, Math.min(Math.trunc(requestedLimit), 500)),
  } as const;
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
      create table if not exists workspace_trash_purge_receipts (
        idempotency_key text primary key check (length(idempotency_key) = 36),
        operation_id text not null unique check (length(operation_id) = 36),
        receipt_json text not null check (length(receipt_json) between 2 and 262144),
        completed_at text not null
      );
      create trigger if not exists workspace_trash_purge_receipts_update_guard
        before update on workspace_trash_purge_receipts
        begin
          select raise(abort,'workspace_trash_purge_receipt_append_only');
        end;
      create trigger if not exists workspace_trash_purge_receipts_delete_guard
        before delete on workspace_trash_purge_receipts
        begin
          select raise(abort,'workspace_trash_purge_receipt_append_only');
        end;
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
      create table if not exists manuscript_records (
        id text primary key check (length(id) = 36),
        project_id text not null check (length(project_id) = 36),
        record_json text not null check (length(record_json) between 2 and 65536),
        version integer not null check (version > 0),
        created_at text not null,
        updated_at text not null,
        unique(project_id,id)
      );
      create index if not exists manuscript_records_by_project
        on manuscript_records(project_id,created_at,id);
      create table if not exists manuscript_workspace_connections (
        binding_id text primary key check (length(binding_id) = 36),
        project_id text not null check (length(project_id) = 36),
        manuscript_id text not null check (length(manuscript_id) = 36),
        provider_id text not null default 'overleaf_git'
          check (length(provider_id) between 1 and 128),
        connection_json text not null check (length(connection_json) between 2 and 262144),
        binding_version integer not null check (binding_version > 0),
        enabled integer not null check (enabled in (0,1)),
        created_at text not null,
        updated_at text not null,
        foreign key(manuscript_id) references manuscript_records(id) on delete cascade
      );
      create unique index if not exists manuscript_one_active_workspace
        on manuscript_workspace_connections(manuscript_id) where enabled=1;
      create index if not exists manuscript_workspace_connections_by_project
        on manuscript_workspace_connections(project_id,manuscript_id,binding_id);
      create table if not exists manuscript_artifact_purge_queue (
        binding_id text primary key check (length(binding_id) = 36),
        project_id text not null check (length(project_id) = 36),
        provider_id text not null check (length(provider_id) between 1 and 128),
        queued_at text not null
      );
      create index if not exists manuscript_artifact_purge_queue_by_project
        on manuscript_artifact_purge_queue(project_id,queued_at,binding_id);
      create table if not exists manuscript_credential_cleanup_queue (
        provider_id text not null check (length(provider_id) between 1 and 128),
        credential_ref text not null check (length(credential_ref) between 1 and 512),
        queued_at text not null,
        primary key(provider_id,credential_ref)
      );
      create index if not exists manuscript_credential_cleanup_queue_by_time
        on manuscript_credential_cleanup_queue(queued_at,provider_id,credential_ref);
      create table if not exists overleaf_git_bindings (
        binding_id text primary key check (length(binding_id) = 36),
        remote_url text not null check (length(remote_url) between 1 and 2048),
        workspace_id text not null check (length(workspace_id) between 1 and 256),
        web_url text not null check (length(web_url) between 1 and 2048),
        credential_ref text not null check (length(credential_ref) between 1 and 512),
        updated_at text not null,
        foreign key(binding_id) references manuscript_workspace_connections(binding_id)
          on delete cascade
      );
      create table if not exists manuscript_checkpoints (
        checkpoint_id text primary key check (length(checkpoint_id) = 36),
        binding_id text not null check (length(binding_id) = 36),
        project_id text not null check (length(project_id) = 36),
        manuscript_id text not null check (length(manuscript_id) = 36),
        provider_revision text not null check (length(provider_revision) between 1 and 512),
        checkpoint_json text not null check (length(checkpoint_json) between 2 and 262144),
        observed_at text not null,
        unique(binding_id,provider_revision),
        foreign key(binding_id) references manuscript_workspace_connections(binding_id)
          on delete cascade
      );
      create index if not exists manuscript_checkpoints_by_binding
        on manuscript_checkpoints(binding_id,observed_at desc,checkpoint_id desc);
      create trigger if not exists manuscript_checkpoints_update_guard
        before update on manuscript_checkpoints
        begin
          select raise(abort,'manuscript_checkpoint_append_only');
        end;
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
        trusted_access_json text check (
          trusted_access_json is null or length(trusted_access_json) between 2 and 16384
        ),
        version integer not null check (version > 0),
        created_at text not null,
        updated_at text not null,
        unique(project_id,connection_id),
        foreign key(connection_id) references ssh_connections(id) on delete cascade
      );
      create index if not exists ssh_workspace_grants_by_project
        on ssh_workspace_grants(project_id,connection_id,id);
      create table if not exists ssh_trusted_workspace_audit (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null check (length(project_id) = 36),
        grant_id text not null check (length(grant_id) = 36),
        grant_version integer not null check (grant_version > 0),
        connection_id text not null check (length(connection_id) = 36),
        connection_version integer not null check (connection_version > 0),
        policy_version integer not null check (policy_version > 0),
        session_id text not null check (length(session_id) = 36),
        attempt_id text not null check (length(attempt_id) = 36),
        turn_id text not null check (length(turn_id) between 1 and 256),
        tool_call_id text not null check (length(tool_call_id) between 1 and 256),
        operation text not null check (
          operation in ('inspect','edit','test','build','experiment')
        ),
        command_sha256 text not null check (length(command_sha256) = 64),
        auto_approved_at text not null
      );
      create index if not exists ssh_trusted_workspace_audit_by_project
        on ssh_trusted_workspace_audit(project_id,auto_approved_at desc,id);
      create trigger if not exists ssh_trusted_workspace_audit_update_guard
        before update on ssh_trusted_workspace_audit
        begin
          select raise(abort,'ssh_trusted_workspace_audit_append_only');
        end;
      create trigger if not exists ssh_trusted_workspace_audit_delete_guard
        before delete on ssh_trusted_workspace_audit
        begin
          select raise(abort,'ssh_trusted_workspace_audit_append_only');
        end;
      create table if not exists literature_records (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null,
        source_provider text not null check (length(source_provider) between 1 and 64),
        provider_record_id text check (
          provider_record_id is null or length(provider_record_id) between 1 and 2048
        ),
        canonical_id text check (
          canonical_id is null or length(canonical_id) between 1 and 512
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
        provider text not null check (
          provider in ('crossref','semantic-scholar','hugging-face')
        ),
        provider_record_id text check (
          provider_record_id is null or length(provider_record_id) between 1 and 2048
        ),
        canonical_id text check (
          canonical_id is null or length(canonical_id) between 1 and 512
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
      drop trigger if exists experiment_metric_points_delete_guard;
      create trigger experiment_metric_points_delete_guard
        before delete on experiment_metric_points
        begin
          select raise(abort,'experiment_metric_point_append_only');
        end;
      create unique index if not exists experiment_metric_points_runner_trial_unique
        on experiment_metric_points(project_id,trial_id)
        where source='runner-summary' and trial_id is not null;
      create table if not exists experiment_logging_template_revisions (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null check (length(project_id) = 36),
        version integer not null check (version > 0),
        previous_revision_id text check (
          previous_revision_id is null or length(previous_revision_id) = 36
        ),
        system_fields_json text not null check (
          length(system_fields_json) between 2 and 4096
        ),
        custom_fields_json text not null check (
          length(custom_fields_json) between 2 and 65536
        ),
        template_hash text not null check (length(template_hash) = 64),
        created_at text not null,
        unique(project_id,version),
        unique(project_id,id),
        foreign key(project_id,previous_revision_id)
          references experiment_logging_template_revisions(project_id,id)
      );
      create index if not exists experiment_logging_templates_by_project
        on experiment_logging_template_revisions(project_id,version desc);
      create trigger if not exists experiment_logging_templates_project_limit
        before insert on experiment_logging_template_revisions
        when (
          select count(*) from experiment_logging_template_revisions
          where project_id=new.project_id
        ) >= ${EXPERIMENT_MAX_LOGGING_TEMPLATE_REVISIONS_PER_PROJECT}
        begin
          select raise(abort,'experiment_logging_template_limit_reached');
        end;
      create trigger if not exists experiment_logging_templates_update_guard
        before update on experiment_logging_template_revisions
        begin
          select raise(abort,'experiment_logging_template_append_only');
        end;
      drop trigger if exists experiment_logging_templates_delete_guard;
      create trigger experiment_logging_templates_delete_guard
        before delete on experiment_logging_template_revisions
        begin
          select raise(abort,'experiment_logging_template_append_only');
        end;
      create table if not exists experiment_runs (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null check (length(project_id) = 36),
        idea_id text check (idea_id is null or length(idea_id) = 36),
        title text not null check (length(title) between 1 and 160),
        status text not null check (
          status in ('queued','running','verifying','succeeded','failed','cancelled','lost')
        ),
        mode text not null check (mode in ('comparable','exploratory')),
        server_label text not null check (length(server_label) between 1 and 120),
        trial_id text not null check (length(trial_id) between 1 and 128),
        objective_id text check (objective_id is null or length(objective_id) = 36),
        objective_version integer check (objective_version is null or objective_version > 0),
        logging_template_revision_id text not null check (
          length(logging_template_revision_id) = 36
        ),
        logging_template_json text not null check (
          length(logging_template_json) between 2 and 65536
        ),
        progress_current integer check (progress_current is null or progress_current >= 0),
        progress_total integer check (progress_total is null or progress_total > 0),
        current_step text check (current_step is null or length(current_step) between 1 and 160),
        latest_metric_json text check (
          latest_metric_json is null or length(latest_metric_json) between 2 and 8192
        ),
        log_reference_json text check (
          log_reference_json is null or length(log_reference_json) between 2 and 16384
        ),
        process_exit_code integer check (
          process_exit_code is null or process_exit_code between 0 and 255
        ),
        process_duration_ms integer check (
          process_duration_ms is null or process_duration_ms >= 0
        ),
        created_at text not null,
        updated_at text not null,
        started_at text,
        completed_at text,
        version integer not null check (version > 0),
        unique(project_id,id),
        unique(project_id,trial_id),
        check ((objective_id is null) = (objective_version is null)),
        check (mode='exploratory' or (idea_id is not null and objective_id is not null)),
        check (mode='comparable' or objective_id is null),
        check (progress_current is null or progress_total is null or progress_current <= progress_total),
        foreign key(project_id,idea_id) references experiment_ideas(project_id,id),
        foreign key(project_id,logging_template_revision_id)
          references experiment_logging_template_revisions(project_id,id)
      );
      create table if not exists experiment_run_log_sources (
        reference_id text primary key check (length(reference_id) = 36),
        project_id text not null check (length(project_id) = 36),
        run_id text not null check (length(run_id) = 36),
        workspace_grant_id text not null check (length(workspace_grant_id) = 36),
        workspace_subdirectory text check (
          workspace_subdirectory is null or length(workspace_subdirectory) <= 512
        ),
        relative_path text not null check (length(relative_path) between 1 and 512),
        unique(project_id,run_id,reference_id),
        foreign key(project_id,run_id) references experiment_runs(project_id,id)
      );
      create table if not exists experiment_run_execution_bindings (
        project_id text not null check (length(project_id) = 36),
        run_id text not null check (length(run_id) = 36),
        workspace_grant_id text not null check (length(workspace_grant_id) = 36),
        primary key(project_id,run_id),
        foreign key(project_id,run_id) references experiment_runs(project_id,id)
      );
      create table if not exists experiment_run_execution_intents (
        project_id text not null check (length(project_id) = 36),
        run_id text not null check (length(run_id) = 36),
        workspace_grant_id text not null check (length(workspace_grant_id) = 36),
        grant_version integer not null check (grant_version > 0),
        connection_id text not null check (length(connection_id) = 36),
        connection_version integer not null check (connection_version > 0),
        canonical_root text not null check (length(canonical_root) between 1 and 1024),
        canonical_root_hash text not null check (length(canonical_root_hash) = 64),
        policy_version integer not null check (policy_version > 0),
        execution_policy_hash text not null check (length(execution_policy_hash) = 64),
        intent_hash text not null check (length(intent_hash) = 64),
        workspace_subdirectory text check (
          workspace_subdirectory is null or length(workspace_subdirectory) <= 512
        ),
        relative_path text not null check (length(relative_path) between 1 and 512),
        created_at text not null,
        primary key(project_id,run_id),
        foreign key(project_id,run_id) references experiment_runs(project_id,id)
      );
      create table if not exists experiment_run_execution_intent_legacy_tombstones (
        project_id text not null check (length(project_id) = 36),
        run_id text not null check (length(run_id) = 36),
        workspace_grant_id text not null check (length(workspace_grant_id) = 36),
        intent_hash text not null check (length(intent_hash) = 64),
        workspace_subdirectory text check (
          workspace_subdirectory is null or length(workspace_subdirectory) <= 512
        ),
        relative_path text not null check (length(relative_path) between 1 and 512),
        created_at text not null,
        migrated_at text not null,
        recovery_reason text not null check (
          recovery_reason in ('legacy_origin_unrecoverable')
        ),
        primary key(project_id,run_id)
      );
      create trigger if not exists experiment_ideas_delete_guard
        before delete on experiment_ideas
        begin
          select raise(abort,'experiment_idea_provenance_append_only');
        end;
      create trigger if not exists experiment_run_log_sources_delete_guard
        before delete on experiment_run_log_sources
        begin
          select raise(abort,'experiment_run_log_source_append_only');
        end;
      create trigger if not exists experiment_run_execution_bindings_delete_guard
        before delete on experiment_run_execution_bindings
        begin
          select raise(abort,'experiment_run_execution_binding_append_only');
        end;
      create trigger if not exists experiment_run_execution_intents_delete_guard
        before delete on experiment_run_execution_intents
        begin
          select raise(abort,'experiment_run_execution_intent_append_only');
        end;
      create trigger if not exists experiment_run_execution_intents_update_guard
        before update on experiment_run_execution_intents
        begin
          select raise(abort,'experiment_run_execution_intent_append_only');
        end;
      create trigger if not exists experiment_run_execution_intent_legacy_tombstones_delete_guard
        before delete on experiment_run_execution_intent_legacy_tombstones
        begin
          select raise(abort,'experiment_run_execution_intent_tombstone_append_only');
        end;
      create trigger if not exists experiment_run_execution_intent_legacy_tombstones_update_guard
        before update on experiment_run_execution_intent_legacy_tombstones
        begin
          select raise(abort,'experiment_run_execution_intent_tombstone_append_only');
        end;
      create table if not exists experiment_evaluation_sessions (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null check (length(project_id) = 36),
        title text not null check (length(title) between 1 and 160),
        status text not null check (
          status in ('draft','generating','ready','failed','archived')
        ),
        active_attempt_id text check (
          active_attempt_id is null or length(active_attempt_id) = 36
        ),
        current_revision integer not null check (current_revision >= 0),
        accepted_profile_id text check (
          accepted_profile_id is null or length(accepted_profile_id) = 36
        ),
        version integer not null check (version > 0),
        last_error_code text check (
          last_error_code is null or length(last_error_code) between 1 and 128
        ),
        created_at text not null,
        updated_at text not null,
        unique(project_id,id),
        check ((status='generating')=(active_attempt_id is not null)),
        check (status='failed' or last_error_code is null)
      );
      create index if not exists experiment_evaluation_sessions_by_project
        on experiment_evaluation_sessions(project_id,updated_at desc,id);
      create trigger if not exists experiment_evaluation_sessions_project_limit
        before insert on experiment_evaluation_sessions
        when (
          select count(*) from experiment_evaluation_sessions where project_id=new.project_id
        ) >= ${EXPERIMENT_EVALUATION_MAX_SESSIONS_PER_PROJECT}
        begin
          select raise(abort,'experiment_evaluation_session_limit_reached');
        end;
      create table if not exists experiment_evaluation_messages (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        session_id text not null check (length(session_id) = 36),
        role text not null check (role in ('user','assistant')),
        status text not null check (status in ('complete','failed','interrupted')),
        content text not null check (length(content) between 1 and 32000),
        attempt_id text check (attempt_id is null or length(attempt_id) = 36),
        revision integer check (revision is null or revision > 0),
        invocation_json text check (
          invocation_json is null or length(invocation_json) between 2 and 8192
        ),
        created_at text not null,
        completed_at text not null,
        foreign key(session_id) references experiment_evaluation_sessions(id) on delete cascade,
        check (role='assistant' or (revision is null and invocation_json is null))
      );
      create index if not exists experiment_evaluation_messages_by_session
        on experiment_evaluation_messages(session_id,created_at,id);
      create unique index if not exists experiment_evaluation_one_assistant_per_attempt
        on experiment_evaluation_messages(session_id,attempt_id)
        where role='assistant' and attempt_id is not null;
      create trigger if not exists experiment_evaluation_messages_session_limit
        before insert on experiment_evaluation_messages
        when (
          select count(*) from experiment_evaluation_messages where session_id=new.session_id
        ) >= ${EXPERIMENT_EVALUATION_MAX_MESSAGES_PER_SESSION}
        begin
          select raise(abort,'experiment_evaluation_message_limit_reached');
        end;
      create table if not exists experiment_evaluation_revisions (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        session_id text not null check (length(session_id) = 36),
        revision integer not null check (revision > 0),
        attempt_id text not null check (length(attempt_id) = 36),
        draft_json text not null check (length(draft_json) between 2 and 524288),
        content_hash text not null check (length(content_hash) = 64),
        invocation_json text not null check (length(invocation_json) between 2 and 8192),
        created_at text not null,
        unique(session_id,revision),
        unique(session_id,attempt_id),
        foreign key(session_id) references experiment_evaluation_sessions(id) on delete cascade
      );
      create index if not exists experiment_evaluation_revisions_by_session
        on experiment_evaluation_revisions(session_id,revision);
      create trigger if not exists experiment_evaluation_revisions_session_limit
        before insert on experiment_evaluation_revisions
        when (
          select count(*) from experiment_evaluation_revisions where session_id=new.session_id
        ) >= ${EXPERIMENT_EVALUATION_MAX_REVISIONS_PER_SESSION}
        begin
          select raise(abort,'experiment_evaluation_revision_limit_reached');
        end;
      create trigger if not exists experiment_evaluation_revisions_update_guard
        before update on experiment_evaluation_revisions
        begin
          select raise(abort,'experiment_evaluation_revision_append_only');
        end;
      create trigger if not exists experiment_evaluation_revisions_delete_guard
        before delete on experiment_evaluation_revisions
        begin
          select raise(abort,'experiment_evaluation_revision_append_only');
        end;
      create table if not exists experiment_evaluation_profiles (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null check (length(project_id) = 36),
        name text not null check (length(name) between 1 and 160),
        source_session_id text not null check (length(source_session_id) = 36),
        source_revision_id text not null check (length(source_revision_id) = 36),
        draft_json text not null check (length(draft_json) between 2 and 524288),
        content_hash text not null check (length(content_hash) = 64),
        code_policy_hash text not null check (length(code_policy_hash) = 64),
        invocation_json text not null check (length(invocation_json) between 2 and 8192),
        code_path text not null check (length(code_path) between 1 and 1024),
        prompt_path text not null check (length(prompt_path) between 1 and 1024),
        use_count integer not null check (use_count >= 0),
        created_at text not null,
        last_used_at text not null,
        unique(project_id,id),
        unique(project_id,source_revision_id),
        foreign key(source_session_id) references experiment_evaluation_sessions(id)
      );
      create index if not exists experiment_evaluation_profiles_by_project
        on experiment_evaluation_profiles(project_id,last_used_at desc,id);
      create trigger if not exists experiment_evaluation_profiles_project_limit
        before insert on experiment_evaluation_profiles
        when (
          select count(*) from experiment_evaluation_profiles where project_id=new.project_id
        ) >= ${EXPERIMENT_EVALUATION_MAX_PROFILES_PER_PROJECT}
        begin
          select raise(abort,'experiment_evaluation_profile_limit_reached');
        end;
      create trigger if not exists experiment_evaluation_profiles_content_guard
        before update of schema_version,project_id,name,source_session_id,source_revision_id,
          draft_json,content_hash,invocation_json,code_path,prompt_path,created_at
        on experiment_evaluation_profiles
        begin
          select raise(abort,'experiment_evaluation_profile_content_immutable');
        end;
      create trigger if not exists experiment_evaluation_profiles_delete_guard
        before delete on experiment_evaluation_profiles
        begin
          select raise(abort,'experiment_evaluation_profile_append_only');
        end;
      create table if not exists lecture_studios (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        title text not null check (length(title) between 1 and 160),
        kind text not null check (kind in ('lecture','talk')),
        duration_minutes integer check (duration_minutes in (10,20,30,50)),
        output_project_id text not null check (length(output_project_id) = 36),
        source_project_ids_json text not null check (
          length(source_project_ids_json) between 2 and 16384
        ),
        source_selection_json text not null check (
          length(source_selection_json) between 2 and 65536
        ),
        generation_brief_json text not null check (
          length(generation_brief_json) between 2 and 16384
        ),
        status text not null check (status in ('draft','generating','ready','failed')),
        active_attempt_id text check (
          active_attempt_id is null or length(active_attempt_id) = 36
        ),
        current_revision integer not null check (current_revision >= 0),
        version integer not null check (version > 0),
        last_error_code text check (
          last_error_code is null or length(last_error_code) between 1 and 128
        ),
        trashed_at text,
        created_at text not null,
        updated_at text not null,
        check ((status = 'generating') = (active_attempt_id is not null)),
        check (status = 'failed' or last_error_code is null),
        check (
          (kind = 'talk' and duration_minutes is not null) or
          (kind = 'lecture' and duration_minutes is null)
        )
      );
      create index if not exists lecture_studios_by_updated_at
        on lecture_studios(updated_at desc,id);
      create trigger if not exists lecture_studios_limit
        before insert on lecture_studios
        when (select count(*) from lecture_studios) >= ${LECTURE_STUDIO_MAX_STUDIOS}
        begin
          select raise(abort,'lecture_studio_limit_reached');
        end;
      create table if not exists lecture_studio_messages (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        studio_id text not null check (length(studio_id) = 36),
        role text not null check (role in ('user','assistant')),
        status text not null check (status in ('complete','failed','interrupted')),
        content text not null check (length(content) between 1 and 32000),
        attempt_id text check (attempt_id is null or length(attempt_id) = 36),
        revision integer check (revision is null or revision > 0),
        invocation_json text check (
          invocation_json is null or length(invocation_json) between 2 and 8192
        ),
        created_at text not null,
        completed_at text not null,
        foreign key(studio_id) references lecture_studios(id) on delete cascade,
        check (role = 'assistant' or (revision is null and invocation_json is null))
      );
      create index if not exists lecture_studio_messages_by_studio
        on lecture_studio_messages(studio_id,created_at,id);
      create unique index if not exists lecture_studio_one_assistant_per_attempt
        on lecture_studio_messages(studio_id,attempt_id)
        where role='assistant' and attempt_id is not null;
      create trigger if not exists lecture_studio_messages_limit
        before insert on lecture_studio_messages
        when (
          select count(*) from lecture_studio_messages where studio_id=new.studio_id
        ) >= ${LECTURE_STUDIO_MAX_MESSAGES}
        begin
          select raise(abort,'lecture_message_limit_reached');
        end;
      create table if not exists lecture_studio_revisions (
        id text primary key check (length(id) = 36),
        schema_version integer not null check (schema_version = 1),
        studio_id text not null check (length(studio_id) = 36),
        revision integer not null check (revision > 0),
        attempt_id text not null check (length(attempt_id) = 36),
        source_manifest_json text not null check (
          length(source_manifest_json) between 2 and 1048576
        ),
        source_manifest_sha256 text not null check (length(source_manifest_sha256) = 64),
        lecture_notes_markdown text not null check (
          length(lecture_notes_markdown) between 1 and 200000
        ),
        slides_markdown text not null check (length(slides_markdown) between 1 and 200000),
        lecture_notes_latex text check (
          lecture_notes_latex is null or length(lecture_notes_latex) between 1 and 240000
        ),
        slides_latex text check (
          slides_latex is null or length(slides_latex) between 1 and 240000
        ),
        artifacts_json text not null check (length(artifacts_json) between 2 and 32768),
        invocation_json text not null check (length(invocation_json) between 2 and 8192),
        created_at text not null,
        unique(studio_id,revision),
        unique(studio_id,attempt_id),
        foreign key(studio_id) references lecture_studios(id) on delete cascade
      );
      create index if not exists lecture_studio_revisions_by_studio
        on lecture_studio_revisions(studio_id,revision);
      create trigger if not exists lecture_studio_revisions_limit
        before insert on lecture_studio_revisions
        when (
          select count(*) from lecture_studio_revisions where studio_id=new.studio_id
        ) >= ${LECTURE_STUDIO_MAX_REVISIONS}
        begin
          select raise(abort,'lecture_revision_limit_reached');
        end;
      create trigger if not exists lecture_studio_revisions_update_guard
        before update on lecture_studio_revisions
        begin
          select raise(abort,'lecture_revision_append_only');
        end;
      create trigger if not exists lecture_studio_revisions_delete_guard
        before delete on lecture_studio_revisions
        begin
          select raise(abort,'lecture_revision_append_only');
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
        title_model_json text check (
          title_model_json is null or length(title_model_json) between 2 and 4096
        ),
        title_revision integer not null default 0 check (title_revision >= 0),
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
      create table if not exists project_chat_queued_turns (
        id text primary key check (length(id) = 36),
        project_id text not null,
        session_id text not null references project_chat_sessions(id) on delete cascade,
        command_json text not null check (length(command_json) between 2 and 65536),
        enqueue_sequence integer not null unique check (enqueue_sequence > 0),
        priority text not null check (priority in ('normal','next')),
        status text not null check (status in ('queued','starting')),
        created_at text not null,
        updated_at text not null
      );
      create index if not exists project_chat_queued_turns_by_session
        on project_chat_queued_turns(project_id,session_id,priority,created_at,id);
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
        local_notes_allow_agent_markdown_create integer not null default 0 check (
          local_notes_allow_agent_markdown_create in (0,1)
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
      create table if not exists project_chat_research_note_save_receipts (
        project_id text not null,
        session_id text not null references project_chat_sessions(id),
        attempt_id text not null references project_chat_attempts(id) on delete cascade,
        binding_id text not null check (length(binding_id) = 64),
        category text not null check (
          category in (
            'literature','papers','experiments','project-progress','idea-development'
          )
        ),
        artifact_id text not null check (length(artifact_id) = 16),
        expected_content_sha256 text not null check (length(expected_content_sha256) = 64),
        status text not null check (
          status in ('staged','uncertain','abandoned','committed-unreported','reported')
        ),
        relative_path text check (
          relative_path is null or length(relative_path) between 1 and 1000
        ),
        staged_at text not null,
        updated_at text not null,
        committed_at text,
        reported_at text,
        primary key(attempt_id,artifact_id),
        check (
          (status in ('staged','uncertain','abandoned') and
            relative_path is null and committed_at is null) or
          (status in ('committed-unreported','reported') and
            relative_path is not null and committed_at is not null)
        ),
        check ((status in ('reported','abandoned')) = (reported_at is not null))
      );
      create index if not exists project_chat_research_note_receipts_by_status
        on project_chat_research_note_save_receipts(status,updated_at,attempt_id);
      create table if not exists project_chat_hermes_delegation_receipts (
        invocation_id text primary key check (length(invocation_id) = 36),
        schema_version integer not null check (schema_version = 1),
        project_id text not null,
        session_id text not null check (length(session_id) = 36),
        attempt_id text not null check (length(attempt_id) = 36),
        provider_id text not null check (provider_id = 'hermes'),
        transport text not null check (transport = 'acp-v1'),
        resolved_model_id text not null check (length(resolved_model_id) between 1 and 256),
        configured_provider_id text not null check (
          length(configured_provider_id) between 1 and 128
        ),
        catalog_version text not null check (length(catalog_version) = 64),
        agent_name text check (agent_name is null or length(agent_name) between 1 and 256),
        agent_version text check (
          agent_version is null or length(agent_version) between 1 and 128
        ),
        stop_reason text not null check (length(stop_reason) between 1 and 128),
        started_at text not null,
        recorded_at text not null
      );
      create index if not exists project_chat_hermes_delegations_by_attempt
        on project_chat_hermes_delegation_receipts(project_id,session_id,attempt_id,recorded_at);
      create trigger if not exists project_chat_hermes_delegation_update_guard
        before update on project_chat_hermes_delegation_receipts
        begin
          select raise(abort,'hermes_delegation_receipt_append_only');
        end;
      create trigger if not exists project_chat_hermes_delegation_delete_guard
        before delete on project_chat_hermes_delegation_receipts
        begin
          select raise(abort,'hermes_delegation_receipt_append_only');
        end;
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
      migrateExperimentEvaluationProfileCodePolicy(database);
      migrateLectureStudioGenerationBrief(database);
      migrateLectureStudioTrash(database);
      migrateLectureStudioRevisionLatex(database);
      migrateExperimentRunsHardening(database);
      migrateProjectChatResearchNoteAbandoned(database);
      const manuscriptWorkspaceConnectionColumns = database.pragma(
        'table_info(manuscript_workspace_connections)',
      ) as Array<{ name: string }>;
      if (!manuscriptWorkspaceConnectionColumns.some((column) => column.name === 'provider_id')) {
        database.exec(
          `alter table manuscript_workspace_connections add column provider_id text not null
           default 'overleaf_git' check (length(provider_id) between 1 and 128)`,
        );
      }
      const overleafGitBindingColumns = database.pragma(
        'table_info(overleaf_git_bindings)',
      ) as Array<{ name: string }>;
      if (!overleafGitBindingColumns.some((column) => column.name === 'credential_ref')) {
        database.exec(
          `alter table overleaf_git_bindings add column credential_ref text not null
           default 'overleaf-git:legacy-unowned'`,
        );
      }
      database.exec(`
        update overleaf_git_bindings
        set credential_ref='overleaf-git:' || lower(workspace_id)
        where credential_ref in ('overleaf-git:legacy','overleaf-git:legacy-unowned')
          and length(workspace_id)=24
          and lower(workspace_id) not glob '*[^0-9a-f]*';
        update overleaf_git_bindings
        set credential_ref='overleaf-git:legacy-unowned'
        where credential_ref='overleaf-git:legacy';
      `);
      installManuscriptIdentityGuards(database);
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
      migrateLiteratureHuggingFaceProvider(database);
      migrateLiteratureCanonicalIdentity(database);
      migrateProjectChatQueueOrdering(database);
      const chatSessionColumns = database.pragma('table_info(project_chat_sessions)') as Array<{
        name: string;
      }>;
      if (!chatSessionColumns.some((column) => column.name === 'title_model_json')) {
        database.exec(
          `alter table project_chat_sessions add column title_model_json text
           check (title_model_json is null or length(title_model_json) between 2 and 4096)`,
        );
      }
      if (!chatSessionColumns.some((column) => column.name === 'title_revision')) {
        database.exec(
          `alter table project_chat_sessions add column title_revision integer not null default 0
           check (title_revision >= 0)`,
        );
      }
      const sshConnectionColumns = database.pragma('table_info(ssh_connections)') as Array<{
        name: string;
      }>;
      if (!sshConnectionColumns.some((column) => column.name === 'direct_target_json')) {
        database.exec(
          `alter table ssh_connections add column direct_target_json text
           check (direct_target_json is null or length(direct_target_json) between 2 and 16384)`,
        );
      }
      const sshWorkspaceGrantColumns = database.pragma(
        'table_info(ssh_workspace_grants)',
      ) as Array<{ name: string }>;
      if (!sshWorkspaceGrantColumns.some((column) => column.name === 'trusted_access_json')) {
        database.exec(
          `alter table ssh_workspace_grants add column trusted_access_json text
           check (trusted_access_json is null or length(trusted_access_json) between 2 and 16384)`,
        );
      }
      migrateExperimentRunExecutionIntentAuthority(database);
      database
        .prepare(
          `update project_chat_actions
           set status='failed',error_code='application_interrupted',updated_at=?
           where status='applying'`,
        )
        .run(new Date().toISOString());
      database
        .prepare(
          `update project_chat_queued_turns
           set status='queued',updated_at=? where status='starting'`,
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
        [
          'local_notes_allow_agent_markdown_create',
          'alter table project_chat_profiles add column local_notes_allow_agent_markdown_create integer not null default 0 check (local_notes_allow_agent_markdown_create in (0,1))',
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
        const reconciledAt = new Date().toISOString();
        reconcileInterruptedChatAttempts(initializedDatabase, reconciledAt);
        reconcileCommittedResearchNoteReceipts(initializedDatabase, reconciledAt);
        initializedDatabase
          .prepare(
            `update experiment_runs
             set status='lost',
                 current_step='Application interrupted; remote outcome unknown',
                 completed_at=?,updated_at=?,version=version+1
             where status='running'`,
          )
          .run(reconciledAt, reconciledAt);
        initializedDatabase
          .prepare(
            `update lecture_studio_messages
             set status='interrupted',completed_at=?
             where role='user' and status='complete' and exists (
               select 1 from lecture_studios studio
               where studio.id=lecture_studio_messages.studio_id
                 and studio.status='generating'
                 and studio.active_attempt_id=lecture_studio_messages.attempt_id
             )`,
          )
          .run(reconciledAt);
        initializedDatabase
          .prepare(
            `update lecture_studios
             set status='failed',active_attempt_id=null,last_error_code='application_interrupted',
                 version=version+1,updated_at=?
             where status='generating'`,
          )
          .run(reconciledAt);
        initializedDatabase
          .prepare(
            `update experiment_evaluation_messages
             set status='interrupted',completed_at=?
             where role='user' and status='complete' and exists (
               select 1 from experiment_evaluation_sessions session
               where session.id=experiment_evaluation_messages.session_id
                 and session.status='generating'
                 and session.active_attempt_id=experiment_evaluation_messages.attempt_id
             )`,
          )
          .run(reconciledAt);
        initializedDatabase
          .prepare(
            `update experiment_evaluation_sessions
             set status='failed',active_attempt_id=null,last_error_code='application_interrupted',
                 version=version+1,updated_at=?
             where status='generating'`,
          )
          .run(reconciledAt);
        this.workspaceOutboxOrderingReady = backfillLegacyWorkspaceRevisions(initializedDatabase);
        if (this.workspaceOutboxOrderingReady) reconcileWorkspaceOutboxStatus(initializedDatabase);
      })();
      initializedDatabase.exec(`
        create unique index if not exists project_chat_one_active_attempt_per_session
          on project_chat_attempts(project_id,session_id)
          where status in ('starting','running');
        create index if not exists project_chat_queued_turns_by_session_order_v2
          on project_chat_queued_turns(project_id,session_id,priority,enqueue_sequence);
      `);
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

  commitWorkspaceState(
    state: WorkspaceSnapshot,
    operation: WorkspaceOperation,
    trashPurgeReceipt?: EmptyProjectTrashReceipt,
  ) {
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
    if (
      trashPurgeReceipt &&
      (trashPurgeReceipt.idempotencyKey !== operation.idempotencyKey ||
        trashPurgeReceipt.operationId !== operation.id ||
        trashPurgeReceipt.workspaceRevision !== state.revision ||
        operation.commandType !== 'project.trash.empty')
    ) {
      throw new Error('workspace_trash_receipt_mismatch');
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
      if (trashPurgeReceipt) {
        for (const project of trashPurgeReceipt.removedProjects) {
          database
            .prepare(
              `insert or ignore into manuscript_credential_cleanup_queue(
                 provider_id,credential_ref,queued_at
               )
               select connection.provider_id,overleaf.credential_ref,?
               from manuscript_workspace_connections connection
               join overleaf_git_bindings overleaf
                 on overleaf.binding_id=connection.binding_id
               where connection.project_id=?`,
            )
            .run(trashPurgeReceipt.completedAt, project.id);
          database
            .prepare(
              `insert or ignore into manuscript_artifact_purge_queue(
                 binding_id,project_id,provider_id,queued_at
               )
               select binding_id,project_id,provider_id,?
               from manuscript_workspace_connections where project_id=?`,
            )
            .run(trashPurgeReceipt.completedAt, project.id);
          database.prepare('delete from manuscript_records where project_id=?').run(project.id);
          database.prepare('delete from literature_search_runs where project_id=?').run(project.id);
          database.prepare('delete from literature_records where project_id=?').run(project.id);
          database
            .prepare("delete from cache_records where scope='research-notes-project' and key=?")
            .run(project.id);
          database.prepare('delete from ssh_workspace_grants where project_id=?').run(project.id);
          database
            .prepare('delete from project_chat_queued_turns where project_id=?')
            .run(project.id);
        }
        database
          .prepare(
            `insert into workspace_trash_purge_receipts(
               idempotency_key,operation_id,receipt_json,completed_at
             ) values(?,?,?,?)`,
          )
          .run(
            trashPurgeReceipt.idempotencyKey,
            trashPurgeReceipt.operationId,
            JSON.stringify(trashPurgeReceipt),
            trashPurgeReceipt.completedAt,
          );
      }
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

  purgeWorkspaceTrash(
    state: WorkspaceSnapshot,
    operation: WorkspaceOperation,
    receipt: EmptyProjectTrashReceipt,
  ) {
    this.commitWorkspaceState(state, operation, EmptyProjectTrashReceiptSchema.parse(receipt));
  }

  loadWorkspaceTrashPurgeReceipt(idempotencyKey: string): EmptyProjectTrashReceipt | null {
    const row = this.require()
      .prepare(
        `select receipt_json from workspace_trash_purge_receipts
         where idempotency_key=?`,
      )
      .get(idempotencyKey) as { receipt_json: string } | undefined;
    if (!row) return null;
    try {
      return EmptyProjectTrashReceiptSchema.parse(JSON.parse(row.receipt_json));
    } catch {
      throw new WorkspaceDataRecoveryError();
    }
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
                title_model_json,created_at,updated_at
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
                  title_model_json,created_at,updated_at
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
                title_model_json,created_at,updated_at
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
        `update project_chat_sessions
         set title=?,title_model_json=null,title_revision=title_revision+1,updated_at=?
         where project_id=? and id=?`,
      )
      .run(title, updatedAt, projectId, sessionId).changes;
    return changed === 1 ? this.getProjectChatSession(projectId, sessionId) : null;
  }

  renameProjectChatSessionIfUnchanged(input: {
    projectId: string;
    sessionId: string;
    expectedTitle: string;
    title: string;
    titleModel: ProjectChatSession['titleModel'];
    updatedAt: string;
  }): ProjectChatSession | null {
    const changed = this.require()
      .prepare(
        `update project_chat_sessions
         set title=?,title_model_json=?,title_revision=title_revision+1,updated_at=?
         where project_id=? and id=? and title=? and title_revision=0
           and title_model_json is null`,
      )
      .run(
        input.title,
        input.titleModel ? JSON.stringify(input.titleModel) : null,
        input.updatedAt,
        input.projectId,
        input.sessionId,
        input.expectedTitle,
      ).changes;
    return changed === 1 ? this.getProjectChatSession(input.projectId, input.sessionId) : null;
  }

  listProjectChatQueuedTurns(projectId: string, sessionId: string): ProjectChatQueuedTurn[] {
    return (
      this.require()
        .prepare(
          `select id,project_id,session_id,command_json,enqueue_sequence,priority,status,
                  created_at,updated_at
           from project_chat_queued_turns
           where project_id=? and session_id=?
           order by case priority when 'next' then 0 else 1 end,enqueue_sequence`,
        )
        .all(projectId, sessionId) as ProjectChatQueuedTurnRow[]
    ).map(toChatQueuedTurn);
  }

  listProjectChatQueuedSessionKeys() {
    return (
      this.require()
        .prepare(
          `select project_id,session_id,
                  max(case when priority='next' then 1 else 0 end) as has_next,
                  min(case when priority='next' then enqueue_sequence end) as next_sequence,
                  min(enqueue_sequence) as first_sequence
           from project_chat_queued_turns where status='queued'
           group by project_id,session_id
           order by has_next desc,coalesce(next_sequence,first_sequence),project_id,session_id`,
        )
        .all() as Array<{ project_id: string; session_id: string }>
    ).map((row) => ({ projectId: row.project_id, sessionId: row.session_id }));
  }

  enqueueProjectChatTurn(input: ProjectChatQueuedTurn) {
    const queued = ProjectChatQueuedTurnSchema.parse(structuredClone(input));
    if (queued.status !== 'queued') throw new Error('chat_queue_invalid_status');
    const database = this.require();
    return database
      .transaction(() => {
        const session = database
          .prepare('select 1 from project_chat_sessions where project_id=? and id=?')
          .get(queued.projectId, queued.sessionId);
        if (!session) throw new Error('chat_session_not_found');
        const count = database
          .prepare(
            'select count(*) as count from project_chat_queued_turns where project_id=? and session_id=?',
          )
          .get(queued.projectId, queued.sessionId) as { count: number };
        if (count.count >= PROJECT_CHAT_MAX_QUEUED_TURNS_PER_SESSION) {
          throw new Error('chat_queue_limit_reached');
        }
        const counter = database
          .prepare('select next_sequence from project_chat_queue_sequence where singleton_id=1')
          .get() as { next_sequence: number };
        database
          .prepare(`update project_chat_queue_sequence set next_sequence=? where singleton_id=1`)
          .run(counter.next_sequence + 1);
        const stored = ProjectChatQueuedTurnSchema.parse({
          ...queued,
          enqueueSequence: counter.next_sequence,
        });
        const {
          id: _id,
          projectId: _projectId,
          sessionId: _sessionId,
          enqueueSequence: _enqueueSequence,
          priority: _priority,
          status: _status,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...command
        } = queued;
        database
          .prepare(
            `insert into project_chat_queued_turns(
               id,project_id,session_id,command_json,enqueue_sequence,priority,status,
               created_at,updated_at
             ) values(?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            stored.id,
            stored.projectId,
            stored.sessionId,
            JSON.stringify(command),
            stored.enqueueSequence,
            stored.priority,
            stored.status,
            stored.createdAt,
            stored.updatedAt,
          );
        return stored;
      })
      .immediate();
  }

  updateProjectChatQueuedTurn(
    projectId: string,
    sessionId: string,
    queueId: string,
    message: string,
    updatedAt: string,
  ) {
    const changed = this.require()
      .prepare(
        `update project_chat_queued_turns
         set command_json=json_set(command_json,'$.message',?),updated_at=?
         where id=? and project_id=? and session_id=? and status='queued'`,
      )
      .run(message, updatedAt, queueId, projectId, sessionId).changes;
    if (changed !== 1) return null;
    return (
      this.listProjectChatQueuedTurns(projectId, sessionId).find(
        (queued) => queued.id === queueId,
      ) ?? null
    );
  }

  removeProjectChatQueuedTurn(projectId: string, sessionId: string, queueId: string) {
    return (
      this.require()
        .prepare(
          `delete from project_chat_queued_turns
           where id=? and project_id=? and session_id=? and status='queued'`,
        )
        .run(queueId, projectId, sessionId).changes === 1
    );
  }

  prioritizeProjectChatQueuedTurn(
    projectId: string,
    sessionId: string,
    queueId: string,
    updatedAt: string,
  ) {
    const database = this.require();
    return database
      .transaction(() => {
        const target = database
          .prepare(
            `select status from project_chat_queued_turns
             where id=? and project_id=? and session_id=? and status in ('queued','starting')`,
          )
          .get(queueId, projectId, sessionId) as { status: 'queued' | 'starting' } | undefined;
        if (!target) return null;
        if (target.status === 'starting') return 'starting' as const;
        database
          .prepare(
            `update project_chat_queued_turns set priority='normal',updated_at=?
             where project_id=? and session_id=? and priority='next'`,
          )
          .run(updatedAt, projectId, sessionId);
        database
          .prepare(
            `update project_chat_queued_turns set priority='next',updated_at=?
             where id=? and project_id=? and session_id=? and status='queued'`,
          )
          .run(updatedAt, queueId, projectId, sessionId);
        return 'queued' as const;
      })
      .immediate();
  }

  claimNextProjectChatQueuedTurn(projectId: string, sessionId: string) {
    const database = this.require();
    return database
      .transaction(() => {
        const row = database
          .prepare(
            `select id,project_id,session_id,command_json,enqueue_sequence,priority,status,
                    created_at,updated_at
             from project_chat_queued_turns
             where project_id=? and session_id=? and status='queued'
             order by case priority when 'next' then 0 else 1 end,enqueue_sequence limit 1`,
          )
          .get(projectId, sessionId) as ProjectChatQueuedTurnRow | undefined;
        if (!row) return null;
        const updatedAt = new Date().toISOString();
        const changed = database
          .prepare(
            `update project_chat_queued_turns set status='starting',updated_at=?
             where id=? and project_id=? and session_id=? and status='queued'`,
          )
          .run(updatedAt, row.id, row.project_id, row.session_id).changes;
        if (changed !== 1) return null;
        return toChatQueuedTurn({ ...row, status: 'starting', updated_at: updatedAt });
      })
      .immediate();
  }

  finishProjectChatQueuedTurn(projectId: string, sessionId: string, queueId: string) {
    return (
      this.require()
        .prepare(
          `delete from project_chat_queued_turns
           where id=? and project_id=? and session_id=? and status='starting'`,
        )
        .run(queueId, projectId, sessionId).changes === 1
    );
  }

  releaseProjectChatQueuedTurn(
    projectId: string,
    sessionId: string,
    queueId: string,
    updatedAt: string,
  ) {
    return (
      this.require()
        .prepare(
          `update project_chat_queued_turns set status='queued',updated_at=?
           where id=? and project_id=? and session_id=? and status='starting'`,
        )
        .run(updatedAt, queueId, projectId, sessionId).changes === 1
    );
  }

  failProjectChatQueuedTurn(
    queueId: string,
    inputAttempt: ProjectChatAttempt,
    inputUserMessage: ProjectChatMessage,
    inputAssistantMessage: ProjectChatMessage,
  ) {
    const attempt = ProjectChatAttemptSchema.parse(structuredClone(inputAttempt));
    const userMessage = ProjectChatMessageSchema.parse(structuredClone(inputUserMessage));
    const assistantMessage = ProjectChatMessageSchema.parse(structuredClone(inputAssistantMessage));
    if (
      attempt.status !== 'failed' ||
      !attempt.sessionId ||
      attempt.userMessageId !== userMessage.id ||
      userMessage.role !== 'user' ||
      userMessage.status !== 'complete' ||
      userMessage.projectId !== attempt.projectId ||
      userMessage.attemptId !== attempt.id ||
      assistantMessage.role !== 'assistant' ||
      assistantMessage.status !== 'failed' ||
      assistantMessage.projectId !== attempt.projectId ||
      assistantMessage.attemptId !== attempt.id
    ) {
      throw new Error('chat_queue_failure_receipt_invalid');
    }
    const sessionId = attempt.sessionId;
    const database = this.require();
    return database
      .transaction(() => {
        const queued = database
          .prepare(
            `select 1 from project_chat_queued_turns
             where id=? and project_id=? and session_id=? and status in ('queued','starting')`,
          )
          .get(queueId, attempt.projectId, sessionId);
        if (!queued) return false;
        if (attempt.retryOfAttemptId) {
          const retryTarget = database
            .prepare(
              `select 1 from project_chat_attempts a
               join project_chat_session_messages sm on sm.message_id=a.user_message_id
               where a.project_id=? and a.id=? and sm.session_id=?`,
            )
            .get(attempt.projectId, attempt.retryOfAttemptId, sessionId);
          if (!retryTarget) throw new Error('chat_attempt_retry_target_not_found');
        }
        insertProjectChatMessage(database, userMessage);
        appendProjectChatSessionMessage(database, sessionId, userMessage.id);
        insertProjectChatAttempt(database, attempt);
        insertProjectChatMessage(database, assistantMessage);
        appendProjectChatSessionMessage(database, sessionId, assistantMessage.id);
        const removed = database
          .prepare(
            `delete from project_chat_queued_turns
             where id=? and project_id=? and session_id=? and status in ('queued','starting')`,
          )
          .run(queueId, attempt.projectId, sessionId).changes;
        if (removed !== 1) throw new Error('chat_queue_state_conflict');
        touchProjectChatSession(database, sessionId, attempt.updatedAt);
        return true;
      })
      .immediate();
  }

  getProjectChatProfile(projectId: string): ProjectChatProfile {
    const row = this.require()
      .prepare(
        `select p.project_id,p.version,p.harness_mode,p.response_depth,
                p.collaboration_mode_id,p.personality,p.response_verbosity,p.web_search_mode,
                p.context_scope,
                p.local_notes_vault_id,p.local_notes_vault_name,
                p.local_notes_allow_agent_markdown_create,
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
               local_notes_allow_agent_markdown_create,
               instruction_revision_id,created_at,updated_at
             ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
               local_notes_allow_agent_markdown_create=excluded.local_notes_allow_agent_markdown_create,
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
              command.localNotesVault?.allowAgentMarkdownCreate === true ? 1 : 0,
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

  beginQueuedChatAttempt(
    queueId: string,
    attempt: ProjectChatAttempt,
    userMessage: ProjectChatMessage,
  ) {
    const database = this.require();
    database
      .transaction(() => {
        const queued = database
          .prepare(
            `select 1 from project_chat_queued_turns
             where id=? and project_id=? and session_id=? and status='starting'`,
          )
          .get(queueId, attempt.projectId, attempt.sessionId);
        if (!queued) throw new Error('chat_queue_state_conflict');
        this.beginChatAttempt(attempt, userMessage);
        const removed = database
          .prepare(
            `delete from project_chat_queued_turns
             where id=? and project_id=? and session_id=? and status='starting'`,
          )
          .run(queueId, attempt.projectId, attempt.sessionId).changes;
        if (removed !== 1) throw new Error('chat_queue_state_conflict');
      })
      .immediate();
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

  recordHermesDelegationReceipt(input: ProjectChatHermesDelegationReceipt) {
    const receipt = ProjectChatHermesDelegationReceiptSchema.parse(structuredClone(input));
    const database = this.require();
    database.transaction(() => {
      const attempt = database
        .prepare(
          `select project_id,session_id,status from project_chat_attempts
           where id=?`,
        )
        .get(receipt.attemptId) as
        { project_id: string; session_id: string | null; status: string } | undefined;
      if (
        !attempt ||
        attempt.project_id !== receipt.projectId ||
        attempt.session_id !== receipt.sessionId ||
        !['starting', 'running'].includes(attempt.status)
      ) {
        throw new Error('hermes_delegation_receipt_attempt_conflict');
      }
      database
        .prepare(
          `insert into project_chat_hermes_delegation_receipts(
             invocation_id,schema_version,project_id,session_id,attempt_id,provider_id,
             transport,resolved_model_id,configured_provider_id,catalog_version,
             agent_name,agent_version,stop_reason,started_at,recorded_at
           ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           on conflict(invocation_id) do nothing`,
        )
        .run(
          receipt.invocationId,
          receipt.schemaVersion,
          receipt.projectId,
          receipt.sessionId,
          receipt.attemptId,
          receipt.providerId,
          receipt.transport,
          receipt.resolvedModelId,
          receipt.configuredProviderId,
          receipt.catalogVersion,
          receipt.agentName,
          receipt.agentVersion,
          receipt.stopReason,
          receipt.startedAt,
          receipt.recordedAt,
        );
      const stored = database
        .prepare(
          `select invocation_id,schema_version,project_id,session_id,attempt_id,provider_id,
                  transport,resolved_model_id,configured_provider_id,catalog_version,
                  agent_name,agent_version,stop_reason,started_at,recorded_at
           from project_chat_hermes_delegation_receipts where invocation_id=?`,
        )
        .get(receipt.invocationId) as
        | {
            invocation_id: string;
            schema_version: number;
            project_id: string;
            session_id: string;
            attempt_id: string;
            provider_id: string;
            transport: string;
            resolved_model_id: string;
            configured_provider_id: string;
            catalog_version: string;
            agent_name: string | null;
            agent_version: string | null;
            stop_reason: string;
            started_at: string;
            recorded_at: string;
          }
        | undefined;
      if (
        !stored ||
        stored.schema_version !== receipt.schemaVersion ||
        stored.project_id !== receipt.projectId ||
        stored.session_id !== receipt.sessionId ||
        stored.attempt_id !== receipt.attemptId ||
        stored.provider_id !== receipt.providerId ||
        stored.transport !== receipt.transport ||
        stored.resolved_model_id !== receipt.resolvedModelId ||
        stored.configured_provider_id !== receipt.configuredProviderId ||
        stored.catalog_version !== receipt.catalogVersion ||
        stored.agent_name !== receipt.agentName ||
        stored.agent_version !== receipt.agentVersion ||
        stored.stop_reason !== receipt.stopReason ||
        stored.started_at !== receipt.startedAt ||
        stored.recorded_at !== receipt.recordedAt
      ) {
        throw new Error('hermes_delegation_receipt_conflict');
      }
    })();
  }

  listHermesDelegationReceipts(
    projectId: string,
    sessionId: string,
    attemptId: string,
  ): ProjectChatHermesDelegationReceipt[] {
    const rows = this.require()
      .prepare(
        `select invocation_id,schema_version,project_id,session_id,attempt_id,provider_id,
                transport,resolved_model_id,configured_provider_id,catalog_version,
                agent_name,agent_version,stop_reason,started_at,recorded_at
         from project_chat_hermes_delegation_receipts
         where project_id=? and session_id=? and attempt_id=?
         order by recorded_at asc,invocation_id asc`,
      )
      .all(projectId, sessionId, attemptId) as Array<{
      invocation_id: string;
      schema_version: number;
      project_id: string;
      session_id: string;
      attempt_id: string;
      provider_id: string;
      transport: string;
      resolved_model_id: string;
      configured_provider_id: string;
      catalog_version: string;
      agent_name: string | null;
      agent_version: string | null;
      stop_reason: string;
      started_at: string;
      recorded_at: string;
    }>;
    return rows.map((row) =>
      ProjectChatHermesDelegationReceiptSchema.parse({
        schemaVersion: row.schema_version,
        projectId: row.project_id,
        sessionId: row.session_id,
        attemptId: row.attempt_id,
        invocationId: row.invocation_id,
        providerId: row.provider_id,
        transport: row.transport,
        resolvedModelId: row.resolved_model_id,
        configuredProviderId: row.configured_provider_id,
        catalogVersion: row.catalog_version,
        agentName: row.agent_name,
        agentVersion: row.agent_version,
        stopReason: row.stop_reason,
        startedAt: row.started_at,
        recordedAt: row.recorded_at,
      }),
    );
  }

  stageResearchNoteSave(input: ProjectChatResearchNoteSaveStage) {
    const receipt = ProjectChatResearchNoteSaveStageSchema.parse(structuredClone(input));
    const database = this.require();
    database.transaction(() => {
      const attempt = database
        .prepare(
          `select project_id,session_id,status from project_chat_attempts
           where id=?`,
        )
        .get(receipt.attemptId) as
        { project_id: string; session_id: string | null; status: string } | undefined;
      if (
        !attempt ||
        attempt.project_id !== receipt.projectId ||
        attempt.session_id !== receipt.sessionId ||
        !['starting', 'running'].includes(attempt.status)
      ) {
        throw new Error('research_note_save_attempt_conflict');
      }
      database
        .prepare(
          `insert into project_chat_research_note_save_receipts(
             project_id,session_id,attempt_id,binding_id,category,artifact_id,
             expected_content_sha256,status,relative_path,staged_at,updated_at,
             committed_at,reported_at
           ) values(?,?,?,?,?,?,?,'staged',null,?,?,null,null)
           on conflict(attempt_id,artifact_id) do nothing`,
        )
        .run(
          receipt.projectId,
          receipt.sessionId,
          receipt.attemptId,
          receipt.bindingId,
          receipt.category,
          receipt.artifactId,
          receipt.expectedContentSha256,
          receipt.stagedAt,
          receipt.stagedAt,
        );
      const stored = database
        .prepare(
          `select ${PROJECT_CHAT_RESEARCH_NOTE_RECEIPT_COLUMNS}
           from project_chat_research_note_save_receipts
           where attempt_id=? and artifact_id=?`,
        )
        .get(receipt.attemptId, receipt.artifactId) as
        ProjectChatResearchNoteSaveReceiptRow | undefined;
      if (
        !stored ||
        stored.project_id !== receipt.projectId ||
        stored.session_id !== receipt.sessionId ||
        stored.binding_id !== receipt.bindingId ||
        stored.category !== receipt.category ||
        stored.expected_content_sha256 !== receipt.expectedContentSha256
      ) {
        throw new Error('research_note_save_receipt_conflict');
      }
    })();
  }

  markResearchNoteSaveUncertain(input: MarkProjectChatResearchNoteSaveUncertainInput) {
    const command = MarkProjectChatResearchNoteSaveUncertainInputSchema.parse(
      structuredClone(input),
    );
    const database = this.require();
    const result = database
      .prepare(
        `update project_chat_research_note_save_receipts
         set status='uncertain',updated_at=?
         where project_id=? and session_id=? and attempt_id=? and artifact_id=?
           and status in ('staged','uncertain')`,
      )
      .run(
        command.uncertainAt,
        command.projectId,
        command.sessionId,
        command.attemptId,
        command.artifactId,
      );
    if (result.changes > 0) return;
    const current = database
      .prepare(
        `select status from project_chat_research_note_save_receipts
         where project_id=? and session_id=? and attempt_id=? and artifact_id=?`,
      )
      .get(command.projectId, command.sessionId, command.attemptId, command.artifactId) as
      { status: string } | undefined;
    if (!current || !['abandoned', 'committed-unreported', 'reported'].includes(current.status)) {
      throw new Error('research_note_save_receipt_conflict');
    }
  }

  abandonResearchNoteSave(input: AbandonProjectChatResearchNoteSaveInput) {
    const command = AbandonProjectChatResearchNoteSaveInputSchema.parse(structuredClone(input));
    const database = this.require();
    return database.transaction(() => {
      const stored = database
        .prepare(
          `select ${PROJECT_CHAT_RESEARCH_NOTE_RECEIPT_COLUMNS}
           from project_chat_research_note_save_receipts
           where attempt_id=? and artifact_id=?`,
        )
        .get(command.attemptId, command.artifactId) as
        ProjectChatResearchNoteSaveReceiptRow | undefined;
      if (
        !stored ||
        stored.project_id !== command.projectId ||
        stored.session_id !== command.sessionId
      ) {
        throw new Error('research_note_save_receipt_conflict');
      }
      if (stored.status === 'abandoned') return true;
      if (stored.status === 'committed-unreported' || stored.status === 'reported') return false;
      if (stored.status !== 'staged' && stored.status !== 'uncertain') {
        throw new Error('research_note_save_receipt_conflict');
      }
      const assistant = database
        .prepare(
          `select id,content from project_chat_messages
           where attempt_id=? and role='assistant'
           order by created_at desc,id desc limit 1`,
        )
        .get(command.attemptId) as { id: string; content: string } | undefined;
      if (!assistant) return false;
      const receipt = toProjectChatResearchNoteSaveReceipt(stored);
      const content = appendAbandonedResearchNoteSaveReceipt(assistant.content, receipt);
      const updated = database
        .prepare(
          `update project_chat_research_note_save_receipts
           set status='abandoned',updated_at=?,reported_at=?
           where project_id=? and session_id=? and attempt_id=? and artifact_id=?
             and status in ('staged','uncertain')`,
        )
        .run(
          command.abandonedAt,
          command.abandonedAt,
          command.projectId,
          command.sessionId,
          command.attemptId,
          command.artifactId,
        );
      if (updated.changes !== 1) throw new Error('research_note_save_receipt_conflict');
      if (content !== assistant.content) {
        database
          .prepare('update project_chat_messages set content=? where id=?')
          .run(content, assistant.id);
      }
      return true;
    })();
  }

  confirmResearchNoteSave(input: ConfirmProjectChatResearchNoteSaveInput) {
    const command = ConfirmProjectChatResearchNoteSaveInputSchema.parse(structuredClone(input));
    const database = this.require();
    database.transaction(() => {
      const stored = database
        .prepare(
          `select ${PROJECT_CHAT_RESEARCH_NOTE_RECEIPT_COLUMNS}
           from project_chat_research_note_save_receipts
           where attempt_id=? and artifact_id=?`,
        )
        .get(command.attemptId, command.artifactId) as
        ProjectChatResearchNoteSaveReceiptRow | undefined;
      if (
        !stored ||
        stored.project_id !== command.projectId ||
        stored.session_id !== command.sessionId ||
        stored.category !== command.category ||
        stored.expected_content_sha256 !== command.contentSha256
      ) {
        throw new Error('research_note_save_receipt_conflict');
      }
      if (stored.relative_path !== null && stored.relative_path !== command.relativePath) {
        throw new Error('research_note_save_receipt_conflict');
      }
      if (
        stored.status === 'staged' ||
        stored.status === 'uncertain' ||
        stored.status === 'abandoned'
      ) {
        const promoted = database
          .prepare(
            `update project_chat_research_note_save_receipts
             set status='committed-unreported',relative_path=?,committed_at=?,reported_at=null,
                 updated_at=?
             where attempt_id=? and artifact_id=?
               and status in ('staged','uncertain','abandoned')`,
          )
          .run(
            command.relativePath,
            command.confirmedAt,
            command.confirmedAt,
            command.attemptId,
            command.artifactId,
          );
        if (promoted.changes !== 1) throw new Error('research_note_save_receipt_conflict');
      } else if (!['committed-unreported', 'reported'].includes(stored.status)) {
        throw new Error('research_note_save_receipt_conflict');
      }
      reconcileCommittedResearchNoteReceiptsForAttempt(
        database,
        command.attemptId,
        command.confirmedAt,
      );
    })();
  }

  listUnreportedResearchNoteSaves() {
    return (
      this.require()
        .prepare(
          `select ${PROJECT_CHAT_RESEARCH_NOTE_RECEIPT_COLUMNS}
           from project_chat_research_note_save_receipts
           where status in ('staged','uncertain','committed-unreported')
           order by staged_at,attempt_id,artifact_id`,
        )
        .all() as ProjectChatResearchNoteSaveReceiptRow[]
    ).map(toProjectChatResearchNoteSaveReceipt);
  }

  reconcileCommittedResearchNoteSaves(reconciledAt: string) {
    const timestamp = z.string().datetime({ offset: true }).parse(reconciledAt);
    const database = this.require();
    return database.transaction(() =>
      reconcileCommittedResearchNoteReceipts(database, timestamp),
    )();
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
      const committedReceipts = committedResearchNoteReceiptsForAttempt(database, terminal.id);
      const assistantMessage = ProjectChatMessageSchema.parse({
        ...parsedMessage,
        content: appendResearchNoteSaveReceipts(parsedMessage.content, committedReceipts),
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
      reportResearchNoteReceipts(database, terminal.id, terminal.updatedAt);
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
      queuedTurns: this.listProjectChatQueuedTurns(projectId, session.id),
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

  searchProjectChatMessages(projectIds: readonly string[], query: string, requestedLimit: number) {
    const search = boundedLocalSearch(projectIds, query, requestedLimit);
    if (!search) return [];
    const { ids, tokens, limit } = search;
    const projectPlaceholders = ids.map(() => '?').join(',');
    const tokenPredicates = tokens
      .map(() => `instr(lower(m.content || ' ' || s.title),?) > 0`)
      .join(' and ');
    return this.require()
      .prepare(
        `select m.project_id as projectId,m.id as messageId,s.id as sessionId,
                s.title as sessionTitle,m.role,m.content,
                coalesce(m.completed_at,m.created_at) as updatedAt
         from project_chat_messages m
         join project_chat_session_messages sm on sm.message_id=m.id
         join project_chat_sessions s on s.id=sm.session_id and s.project_id=m.project_id
         where m.project_id in (${projectPlaceholders})
           and ${tokenPredicates}
           and s.id=(
             select s2.id
             from project_chat_session_messages sm2
             join project_chat_sessions s2 on s2.id=sm2.session_id
             where sm2.message_id=m.id and s2.project_id=m.project_id
             order by s2.updated_at desc,s2.id asc limit 1
           )
         order by coalesce(m.completed_at,m.created_at) desc,m.id asc limit ?`,
      )
      .all(...ids, ...tokens, limit) as Array<{
      projectId: string;
      messageId: string;
      sessionId: string;
      sessionTitle: string;
      role: 'user' | 'assistant';
      content: string;
      updatedAt: string;
    }>;
  }

  searchExperimentIdeas(projectIds: readonly string[], query: string, requestedLimit: number) {
    const search = boundedLocalSearch(projectIds, query, requestedLimit);
    if (!search) return [];
    const { ids, tokens, limit } = search;
    const projectPlaceholders = ids.map(() => '?').join(',');
    const searchableText =
      "lower(title || ' ' || hypothesis || ' ' || phase || ' ' || outcome || ' ' || result_summary)";
    const tokenPredicates = tokens.map(() => `instr(${searchableText},?) > 0`).join(' and ');
    const rows = this.require()
      .prepare(
        `select * from experiment_ideas
         where project_id in (${projectPlaceholders}) and ${tokenPredicates}
         order by updated_at desc,id asc limit ?`,
      )
      .all(...ids, ...tokens, limit) as ExperimentIdeaRow[];
    return rows.map(toExperimentIdea);
  }

  searchExperimentMetricPoints(
    projectIds: readonly string[],
    query: string,
    requestedLimit: number,
  ) {
    const search = boundedLocalSearch(projectIds, query, requestedLimit);
    if (!search) return [];
    const { ids, tokens, limit } = search;
    const projectPlaceholders = ids.map(() => '?').join(',');
    const searchableText = `lower(
      'metric ' || points.metric_display_name || ' ' || points.metric_key || ' ' ||
      'value ' || cast(points.value as text) || ' ' || coalesce(points.unit,'') || ' ' ||
      'trial ' || coalesce(points.trial_id,'') || ' ' ||
      'series ' || points.metric_key || ' ' || points.aggregation || ' ' ||
      'objective version ' || cast(points.objective_version as text) || ' ' ||
      'baseline ' || coalesce(cast(points.baseline as text),'') || ' ' ||
      'target ' || coalesce(cast(points.target as text),'') || ' ' ||
      'source ' || points.source || ' sequence ' || cast(points.sequence as text) || ' ' ||
      ideas.title
    )`;
    const tokenPredicates = tokens.map(() => `instr(${searchableText},?) > 0`).join(' and ');
    return this.require()
      .prepare(
        `select points.project_id as projectId,points.id as metricPointId,
                points.idea_id as ideaId,ideas.title as ideaTitle,
                points.metric_key as metricKey,points.metric_display_name as metricDisplayName,
                points.value,points.unit,points.aggregation,points.baseline,points.target,
                points.source,points.trial_id as trialId,points.sequence,
                points.objective_version as objectiveVersion,points.recorded_at as updatedAt
         from experiment_metric_points points
         join experiment_ideas ideas
           on ideas.project_id=points.project_id and ideas.id=points.idea_id
         where points.project_id in (${projectPlaceholders})
           and ${visibleExperimentMetricPredicate('points')}
           and ${tokenPredicates}
         order by points.recorded_at desc,points.sequence desc,points.id asc limit ?`,
      )
      .all(...ids, ...tokens, limit) as Array<{
      projectId: string;
      metricPointId: string;
      ideaId: string;
      ideaTitle: string;
      metricKey: string;
      metricDisplayName: string;
      value: number;
      unit: string | null;
      aggregation: string;
      baseline: number | null;
      target: number | null;
      source: string;
      trialId: string | null;
      sequence: number;
      objectiveVersion: number;
      updatedAt: string;
    }>;
  }

  searchLiteratureRecords(projectIds: readonly string[], query: string, requestedLimit: number) {
    const search = boundedLocalSearch(projectIds, query, requestedLimit);
    if (!search) return [];
    const { ids, tokens, limit } = search;
    const projectPlaceholders = ids.map(() => '?').join(',');
    const searchableText = `lower(
      title || ' ' || authors_json || ' ' || coalesce(container_title,'') || ' ' ||
      'doi ' || coalesce(doi,'') || ' citation key ' || coalesce(citation_key,'') || ' ' ||
      'publication year ' || coalesce(cast(published_year as text),'') || ' ' ||
      'citation count ' || coalesce(cast(citation_count as text),'') || ' ' ||
      topics_json || ' ' || search_tags_json || ' ' || manual_topics_json || ' ' ||
      coalesce(manual_summary,'') || ' ' || coalesce(manual_relevance,'') || ' ' ||
      ai_topics_json || ' ' || coalesce(ai_summary,'') || ' ' ||
      coalesce(ai_study_type,'') || ' ' || ai_limitations_json
    )`;
    const tokenPredicates = tokens.map(() => `instr(${searchableText},?) > 0`).join(' and ');
    const rows = this.require()
      .prepare(
        `select * from literature_records
         where project_id in (${projectPlaceholders}) and deleted_at is null
           and ${tokenPredicates}
         order by updated_at desc,id asc limit ?`,
      )
      .all(...ids, ...tokens, limit) as LiteratureRecordRow[];
    return rows.map(toLocalLiteratureRecord);
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
        `select point.* from experiment_metric_points point
         where point.project_id=?
           and ${visibleExperimentMetricPredicate('point')}
         order by point.sequence asc`,
      )
      .all(projectId) as ExperimentMetricPointRow[];
    return rows.map(toExperimentMetricPoint);
  }

  listExperimentMetricTails(
    input: Readonly<{
      projectId: string;
      ideaIds: readonly string[];
      perIdeaLimit: number;
    }>,
  ) {
    const query = ExperimentMetricTailQuerySchema.parse(input);
    const ideaIds = [...new Set(query.ideaIds)];
    if (ideaIds.length === 0) return [];
    const placeholders = ideaIds.map(() => '?').join(',');
    const rows = this.require()
      .prepare(
        `with ranked as (
           select points.*,
                  count(*) over (partition by points.idea_id) as metric_point_total,
                  row_number() over (
                    partition by points.idea_id order by points.sequence desc
                  ) as tail_rank
           from experiment_metric_points points
           where points.project_id=? and points.idea_id in (${placeholders})
             and ${visibleExperimentMetricPredicate('points')}
         )
         select * from ranked where tail_rank<=?
         order by idea_id asc,sequence asc`,
      )
      .all(query.projectId, ...ideaIds, query.perIdeaLimit) as ExperimentMetricTailRow[];
    const tails = new Map(
      ideaIds.map((ideaId) => [
        ideaId,
        {
          ideaId,
          metricPoints: [] as ExperimentMetricPoint[],
          metricPointTotal: 0,
        },
      ]),
    );
    for (const row of rows) {
      const tail = tails.get(row.idea_id);
      if (!tail) continue;
      tail.metricPointTotal = row.metric_point_total;
      tail.metricPoints.push(toExperimentMetricPoint(row));
    }
    return ideaIds.map((ideaId) => tails.get(ideaId)!);
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

  findExperimentMetricPointByTrial(
    projectId: string,
    trialId: string,
  ): ExperimentMetricPoint | null {
    const row = this.require()
      .prepare(
        `select * from experiment_metric_points
         where project_id=? and trial_id=? and source='runner-summary'
         order by sequence asc limit 1`,
      )
      .get(projectId, trialId) as ExperimentMetricPointRow | undefined;
    return row ? toExperimentMetricPoint(row) : null;
  }

  getLatestExperimentLoggingTemplate(projectId: string): ExperimentLoggingTemplate | null {
    const row = this.require()
      .prepare(
        `select * from experiment_logging_template_revisions
         where project_id=? order by version desc limit 1`,
      )
      .get(projectId) as ExperimentLoggingTemplateRow | undefined;
    return row ? toExperimentLoggingTemplate(row) : null;
  }

  appendExperimentLoggingTemplate(input: ExperimentLoggingTemplate, expectedVersion: number) {
    const template = ExperimentLoggingTemplateSchema.parse(structuredClone(input));
    if (template.version !== expectedVersion + 1) {
      throw new Error('experiment_logging_template_version_sequence_invalid');
    }
    const database = this.require();
    return database
      .transaction(() => {
        const current = database
          .prepare(
            `select * from experiment_logging_template_revisions
             where project_id=? order by version desc limit 1`,
          )
          .get(template.projectId) as ExperimentLoggingTemplateRow | undefined;
        if ((current?.version ?? 0) !== expectedVersion) return null;
        if (
          expectedVersion === 0
            ? template.previousRevisionId !== null
            : template.previousRevisionId !== current?.id
        ) {
          throw new ExperimentWorkspaceStorageError('logging_template_conflict');
        }
        const count = database
          .prepare(
            'select count(*) as count from experiment_logging_template_revisions where project_id=?',
          )
          .get(template.projectId) as { count: number };
        if (count.count >= EXPERIMENT_MAX_LOGGING_TEMPLATE_REVISIONS_PER_PROJECT) {
          throw new ExperimentWorkspaceStorageError('logging_template_limit_reached');
        }
        const duplicate = database
          .prepare('select 1 from experiment_logging_template_revisions where id=?')
          .get(template.id);
        if (duplicate) return null;
        database
          .prepare(
            `insert into experiment_logging_template_revisions(
               id,schema_version,project_id,version,previous_revision_id,system_fields_json,
               custom_fields_json,template_hash,created_at
             ) values(?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            template.id,
            template.schemaVersion,
            template.projectId,
            template.version,
            template.previousRevisionId,
            JSON.stringify(template.systemFields),
            JSON.stringify(template.customFields),
            template.templateHash,
            template.createdAt,
          );
        const row = database
          .prepare('select * from experiment_logging_template_revisions where id=?')
          .get(template.id) as ExperimentLoggingTemplateRow;
        return toExperimentLoggingTemplate(row);
      })
      .immediate();
  }

  listExperimentRuns(projectId: string): ExperimentRun[] {
    const rows = this.require()
      .prepare(
        `select * from experiment_runs
         where project_id=? order by updated_at desc,id asc`,
      )
      .all(projectId) as ExperimentRunRow[];
    return rows.map(toExperimentRun);
  }

  getExperimentRun(projectId: string, runId: string): ExperimentRun | null {
    const row = this.require()
      .prepare('select * from experiment_runs where project_id=? and id=?')
      .get(projectId, runId) as ExperimentRunRow | undefined;
    return row ? toExperimentRun(row) : null;
  }

  getExperimentRunByTrial(projectId: string, trialId: string): ExperimentRun | null {
    const row = this.require()
      .prepare('select * from experiment_runs where project_id=? and trial_id=?')
      .get(projectId, trialId) as ExperimentRunRow | undefined;
    return row ? toExperimentRun(row) : null;
  }

  createExperimentRun(input: ExperimentRun) {
    const run = ExperimentRunSchema.parse(structuredClone(input));
    const database = this.require();
    return database
      .transaction(() => {
        if (
          database
            .prepare('select 1 from experiment_runs where id=? or (project_id=? and trial_id=?)')
            .get(run.id, run.projectId, run.trialId)
        ) {
          return false;
        }
        if (
          run.ideaId &&
          !database
            .prepare('select 1 from experiment_ideas where project_id=? and id=?')
            .get(run.projectId, run.ideaId)
        ) {
          throw new ExperimentWorkspaceStorageError('idea_not_found');
        }
        const templateRow = database
          .prepare(
            `select * from experiment_logging_template_revisions
             where project_id=? and id=?`,
          )
          .get(run.projectId, run.loggingTemplate.revisionId) as
          ExperimentLoggingTemplateRow | undefined;
        if (!templateRow) {
          throw new ExperimentWorkspaceStorageError('logging_template_conflict');
        }
        const template = toExperimentLoggingTemplate(templateRow);
        if (
          template.version !== run.loggingTemplate.version ||
          template.templateHash !== run.loggingTemplate.templateHash ||
          JSON.stringify(template.systemFields) !==
            JSON.stringify(run.loggingTemplate.systemFields) ||
          JSON.stringify(template.customFields) !== JSON.stringify(run.loggingTemplate.customFields)
        ) {
          throw new ExperimentWorkspaceStorageError('logging_template_conflict');
        }
        const count = database
          .prepare('select count(*) as count from experiment_runs where project_id=?')
          .get(run.projectId) as { count: number };
        if (count.count >= EXPERIMENT_MAX_RUNS_PER_PROJECT) {
          throw new ExperimentWorkspaceStorageError('run_limit_reached');
        }
        const inserted = database
          .prepare(
            `insert into experiment_runs(
               id,schema_version,project_id,idea_id,title,status,mode,server_label,trial_id,
               objective_id,objective_version,logging_template_revision_id,
               logging_template_json,progress_current,progress_total,current_step,
               latest_metric_json,log_reference_json,process_exit_code,process_duration_ms,
               created_at,updated_at,started_at,completed_at,version
             ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            run.id,
            run.schemaVersion,
            run.projectId,
            run.ideaId,
            run.title,
            run.status,
            run.mode,
            run.serverLabel,
            run.trialId,
            run.objectiveId,
            run.objectiveVersion,
            run.loggingTemplate.revisionId,
            JSON.stringify(run.loggingTemplate),
            run.progressCurrent,
            run.progressTotal,
            run.currentStep,
            run.latestMetric ? JSON.stringify(run.latestMetric) : null,
            run.logReference ? JSON.stringify(run.logReference) : null,
            run.processExitCode,
            run.processDurationMs,
            run.createdAt,
            run.updatedAt,
            run.startedAt,
            run.completedAt,
            run.version,
          );
        return inserted.changes === 1;
      })
      .immediate();
  }

  updateExperimentRun(input: ExperimentRun, expectedVersion: number) {
    const run = ExperimentRunSchema.parse(structuredClone(input));
    if (run.version !== expectedVersion + 1) {
      throw new Error('experiment_run_version_sequence_invalid');
    }
    const database = this.require();
    return database
      .transaction(() => {
        const currentRow = database
          .prepare('select * from experiment_runs where project_id=? and id=?')
          .get(run.projectId, run.id) as ExperimentRunRow | undefined;
        if (!currentRow) throw new ExperimentWorkspaceStorageError('run_not_found');
        if (currentRow.version !== expectedVersion) return null;
        const current = toExperimentRun(currentRow);
        if (
          current.projectId !== run.projectId ||
          current.ideaId !== run.ideaId ||
          current.title !== run.title ||
          current.mode !== run.mode ||
          current.serverLabel !== run.serverLabel ||
          current.trialId !== run.trialId ||
          current.objectiveId !== run.objectiveId ||
          current.objectiveVersion !== run.objectiveVersion ||
          current.createdAt !== run.createdAt ||
          JSON.stringify(current.loggingTemplate) !== JSON.stringify(run.loggingTemplate)
        ) {
          throw new ExperimentWorkspaceStorageError('run_conflict');
        }
        const terminalStatuses = new Set<ExperimentRun['status']>([
          'succeeded',
          'failed',
          'cancelled',
          'lost',
        ]);
        const allowedTransitions: Readonly<
          Record<ExperimentRun['status'], readonly ExperimentRun['status'][]>
        > = {
          queued: ['queued', 'running', 'cancelled', 'lost'],
          running: ['running', 'verifying', 'failed', 'cancelled', 'lost'],
          verifying: ['verifying', 'succeeded', 'failed', 'cancelled', 'lost'],
          succeeded: [],
          failed: [],
          cancelled: [],
          lost: [],
        };
        const resolvesPendingLog =
          current.status === 'verifying' &&
          current.logReference?.validationState === 'pending' &&
          run.logReference !== null &&
          run.logReference.referenceId === current.logReference.referenceId &&
          run.logReference.displayName === current.logReference.displayName &&
          run.logReference.contentHash === current.logReference.contentHash &&
          run.logReference.sizeBytes === current.logReference.sizeBytes &&
          run.logReference.validationState !== 'pending';
        if (
          terminalStatuses.has(current.status) ||
          !allowedTransitions[current.status].includes(run.status) ||
          (current.progressCurrent !== null &&
            run.progressCurrent !== null &&
            run.progressCurrent < current.progressCurrent) ||
          (current.logReference !== null &&
            JSON.stringify(current.logReference) !== JSON.stringify(run.logReference) &&
            !resolvesPendingLog) ||
          (current.processExitCode !== null && current.processExitCode !== run.processExitCode) ||
          (current.processDurationMs !== null &&
            current.processDurationMs !== run.processDurationMs)
        ) {
          throw new ExperimentWorkspaceStorageError('run_conflict');
        }
        const changed = database
          .prepare(
            `update experiment_runs set
               status=?,progress_current=?,progress_total=?,current_step=?,latest_metric_json=?,
               log_reference_json=?,process_exit_code=?,process_duration_ms=?,updated_at=?,
               started_at=?,completed_at=?,version=?
             where project_id=? and id=? and version=?`,
          )
          .run(
            run.status,
            run.progressCurrent,
            run.progressTotal,
            run.currentStep,
            run.latestMetric ? JSON.stringify(run.latestMetric) : null,
            run.logReference ? JSON.stringify(run.logReference) : null,
            run.processExitCode,
            run.processDurationMs,
            run.updatedAt,
            run.startedAt,
            run.completedAt,
            run.version,
            run.projectId,
            run.id,
            expectedVersion,
          );
        if (changed.changes !== 1) return null;
        const stored = database
          .prepare('select * from experiment_runs where project_id=? and id=?')
          .get(run.projectId, run.id) as ExperimentRunRow;
        return toExperimentRun(stored);
      })
      .immediate();
  }

  linkExperimentRunLogSource(input: ExperimentRunLogSource) {
    const source = ExperimentRunLogSourceSchema.parse(structuredClone(input));
    const database = this.require();
    return database
      .transaction(() => {
        const existing = database
          .prepare('select * from experiment_run_log_sources where reference_id=?')
          .get(source.referenceId) as ExperimentRunLogSourceRow | undefined;
        if (existing) {
          const parsed = toExperimentRunLogSource(existing);
          if (JSON.stringify(parsed) === JSON.stringify(source)) return true;
          throw new ExperimentWorkspaceStorageError('run_log_source_conflict');
        }
        const runRow = database
          .prepare('select * from experiment_runs where project_id=? and id=?')
          .get(source.projectId, source.runId) as ExperimentRunRow | undefined;
        if (!runRow) throw new ExperimentWorkspaceStorageError('run_not_found');
        const run = toExperimentRun(runRow);
        if (run.logReference?.referenceId !== source.referenceId) {
          throw new ExperimentWorkspaceStorageError('run_log_source_conflict');
        }
        const executionBinding = database
          .prepare(
            `select workspace_grant_id from experiment_run_execution_bindings
             where project_id=? and run_id=?`,
          )
          .get(source.projectId, source.runId) as { workspace_grant_id: string } | undefined;
        if (executionBinding?.workspace_grant_id !== source.workspaceGrantId) {
          throw new ExperimentWorkspaceStorageError('run_log_source_conflict');
        }
        if (
          !database
            .prepare('select 1 from ssh_workspace_grants where project_id=? and id=?')
            .get(source.projectId, source.workspaceGrantId)
        ) {
          throw new ExperimentWorkspaceStorageError('run_log_source_conflict');
        }
        database
          .prepare(
            `insert into experiment_run_log_sources(
               reference_id,project_id,run_id,workspace_grant_id,workspace_subdirectory,
               relative_path
             ) values(?,?,?,?,?,?)`,
          )
          .run(
            source.referenceId,
            source.projectId,
            source.runId,
            source.workspaceGrantId,
            source.workspaceSubdirectory,
            source.relativePath,
          );
        return true;
      })
      .immediate();
  }

  getExperimentRunLogSource(
    projectId: string,
    runId: string,
    referenceId: string,
  ): ExperimentRunLogSource | null {
    const row = this.require()
      .prepare(
        `select * from experiment_run_log_sources
         where project_id=? and run_id=? and reference_id=?`,
      )
      .get(projectId, runId, referenceId) as ExperimentRunLogSourceRow | undefined;
    return row ? toExperimentRunLogSource(row) : null;
  }

  bindExperimentRunExecution(input: ExperimentRunExecutionBinding) {
    const binding = ExperimentRunExecutionBindingSchema.parse(structuredClone(input));
    const database = this.require();
    return database
      .transaction(() => {
        const existing = database
          .prepare(
            `select * from experiment_run_execution_bindings
             where project_id=? and run_id=?`,
          )
          .get(binding.projectId, binding.runId) as ExperimentRunExecutionBindingRow | undefined;
        if (existing) {
          const parsed = toExperimentRunExecutionBinding(existing);
          if (parsed.workspaceGrantId === binding.workspaceGrantId) return true;
          throw new ExperimentWorkspaceStorageError('run_execution_binding_conflict');
        }
        if (
          !database
            .prepare('select 1 from experiment_runs where project_id=? and id=?')
            .get(binding.projectId, binding.runId) ||
          !database
            .prepare('select 1 from ssh_workspace_grants where project_id=? and id=?')
            .get(binding.projectId, binding.workspaceGrantId)
        ) {
          throw new ExperimentWorkspaceStorageError('run_execution_binding_conflict');
        }
        database
          .prepare(
            `insert into experiment_run_execution_bindings(
               project_id,run_id,workspace_grant_id
             ) values(?,?,?)`,
          )
          .run(binding.projectId, binding.runId, binding.workspaceGrantId);
        return true;
      })
      .immediate();
  }

  getExperimentRunExecutionBinding(
    projectId: string,
    runId: string,
  ): ExperimentRunExecutionBinding | null {
    const row = this.require()
      .prepare(
        `select * from experiment_run_execution_bindings
         where project_id=? and run_id=?`,
      )
      .get(projectId, runId) as ExperimentRunExecutionBindingRow | undefined;
    return row ? toExperimentRunExecutionBinding(row) : null;
  }

  stageExperimentRunExecutionIntent(input: ExperimentRunExecutionIntent) {
    const intent = ExperimentRunExecutionIntentSchema.parse(structuredClone(input));
    const database = this.require();
    return database
      .transaction(() => {
        const existing = database
          .prepare(
            `select * from experiment_run_execution_intents
             where project_id=? and run_id=?`,
          )
          .get(intent.projectId, intent.runId) as ExperimentRunExecutionIntentRow | undefined;
        if (existing) {
          const parsed = toExperimentRunExecutionIntent(existing);
          if (
            parsed.workspaceGrantId === intent.workspaceGrantId &&
            parsed.grantVersion === intent.grantVersion &&
            parsed.connectionId === intent.connectionId &&
            parsed.connectionVersion === intent.connectionVersion &&
            parsed.canonicalRoot === intent.canonicalRoot &&
            parsed.canonicalRootHash === intent.canonicalRootHash &&
            parsed.policyVersion === intent.policyVersion &&
            parsed.executionPolicyHash === intent.executionPolicyHash &&
            parsed.intentHash === intent.intentHash &&
            parsed.workspaceSubdirectory === intent.workspaceSubdirectory &&
            parsed.relativePath === intent.relativePath
          ) {
            return true;
          }
          throw new ExperimentWorkspaceStorageError('run_execution_intent_conflict');
        }
        const binding = database
          .prepare(
            `select workspace_grant_id from experiment_run_execution_bindings
             where project_id=? and run_id=?`,
          )
          .get(intent.projectId, intent.runId) as { workspace_grant_id: string } | undefined;
        if (binding?.workspace_grant_id !== intent.workspaceGrantId) {
          throw new ExperimentWorkspaceStorageError('run_execution_intent_conflict');
        }
        const origin = database
          .prepare(
            `select grant.version as grant_version,grant.connection_id,grant.canonical_root,
                    connection.version as connection_version
             from ssh_workspace_grants grant
             join ssh_connections connection on connection.id=grant.connection_id
             where grant.project_id=? and grant.id=?`,
          )
          .get(intent.projectId, intent.workspaceGrantId) as
          | {
              grant_version: number;
              connection_id: string;
              canonical_root: string;
              connection_version: number;
            }
          | undefined;
        if (
          !origin ||
          origin.grant_version !== intent.grantVersion ||
          origin.connection_id !== intent.connectionId ||
          origin.connection_version !== intent.connectionVersion ||
          origin.canonical_root !== intent.canonicalRoot ||
          createHash('sha256').update(intent.canonicalRoot, 'utf8').digest('hex') !==
            intent.canonicalRootHash
        ) {
          throw new ExperimentWorkspaceStorageError('run_execution_intent_conflict');
        }
        database
          .prepare(
            `insert into experiment_run_execution_intents(
               project_id,run_id,workspace_grant_id,grant_version,connection_id,
               connection_version,canonical_root,canonical_root_hash,policy_version,
               execution_policy_hash,intent_hash,workspace_subdirectory,relative_path,created_at
             ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            intent.projectId,
            intent.runId,
            intent.workspaceGrantId,
            intent.grantVersion,
            intent.connectionId,
            intent.connectionVersion,
            intent.canonicalRoot,
            intent.canonicalRootHash,
            intent.policyVersion,
            intent.executionPolicyHash,
            intent.intentHash,
            intent.workspaceSubdirectory,
            intent.relativePath,
            intent.createdAt,
          );
        return true;
      })
      .immediate();
  }

  getExperimentRunExecutionIntent(
    projectId: string,
    runId: string,
  ): ExperimentRunExecutionIntent | null {
    const row = this.require()
      .prepare(
        `select * from experiment_run_execution_intents
         where project_id=? and run_id=?`,
      )
      .get(projectId, runId) as ExperimentRunExecutionIntentRow | undefined;
    return row ? toExperimentRunExecutionIntent(row) : null;
  }

  listExperimentEvaluationSessions(projectId: string): ExperimentEvaluationSession[] {
    const rows = this.require()
      .prepare(
        `select * from experiment_evaluation_sessions
         where project_id=? order by updated_at desc,id asc`,
      )
      .all(projectId) as ExperimentEvaluationSessionRow[];
    return rows.map(toExperimentEvaluationSession);
  }

  listExperimentEvaluationProfiles(projectId: string): ExperimentEvaluationProfile[] {
    const rows = this.require()
      .prepare(
        `select * from experiment_evaluation_profiles
         where project_id=? order by use_count desc,last_used_at desc,id asc`,
      )
      .all(projectId) as ExperimentEvaluationProfileRow[];
    return rows.map(toExperimentEvaluationProfile);
  }

  getExperimentEvaluationSession(
    projectId: string,
    sessionId: string,
  ): ExperimentEvaluationSession | null {
    const row = this.require()
      .prepare(
        `select * from experiment_evaluation_sessions
         where project_id=? and id=?`,
      )
      .get(projectId, sessionId) as ExperimentEvaluationSessionRow | undefined;
    return row ? toExperimentEvaluationSession(row) : null;
  }

  getExperimentEvaluationSessionDetail(
    projectId: string,
    sessionId: string,
  ): ExperimentEvaluationSessionDetail | null {
    const database = this.require();
    return database.transaction(() => {
      const sessionRow = database
        .prepare(
          `select * from experiment_evaluation_sessions
           where project_id=? and id=?`,
        )
        .get(projectId, sessionId) as ExperimentEvaluationSessionRow | undefined;
      if (!sessionRow) return null;
      const messageRows = database
        .prepare(
          `select * from (
             select * from experiment_evaluation_messages
             where session_id=? order by created_at desc,id desc limit 100
           ) order by created_at asc,id asc`,
        )
        .all(sessionId) as ExperimentEvaluationMessageRow[];
      const revisionRow = database
        .prepare(
          `select revision.* from experiment_evaluation_revisions revision
           join experiment_evaluation_sessions session
             on session.id=revision.session_id and session.current_revision=revision.revision
           where revision.session_id=?`,
        )
        .get(sessionId) as ExperimentEvaluationRevisionRow | undefined;
      return ExperimentEvaluationSessionDetailSchema.parse({
        schemaVersion: 1,
        session: toExperimentEvaluationSession(sessionRow),
        messages: messageRows.map(toExperimentEvaluationMessage),
        currentRevision: revisionRow ? toExperimentEvaluationRevision(revisionRow) : null,
      });
    })();
  }

  getExperimentEvaluationRevision(
    projectId: string,
    sessionId: string,
    revision: number,
  ): ExperimentEvaluationRevision | null {
    if (!Number.isSafeInteger(revision) || revision < 1) return null;
    const row = this.require()
      .prepare(
        `select revision.* from experiment_evaluation_revisions revision
         join experiment_evaluation_sessions session on session.id=revision.session_id
         where session.project_id=? and revision.session_id=? and revision.revision=?`,
      )
      .get(projectId, sessionId, revision) as ExperimentEvaluationRevisionRow | undefined;
    return row ? toExperimentEvaluationRevision(row) : null;
  }

  getExperimentEvaluationProfile(
    projectId: string,
    profileId: string,
  ): ExperimentEvaluationProfile | null {
    const row = this.require()
      .prepare(
        `select * from experiment_evaluation_profiles
         where project_id=? and id=?`,
      )
      .get(projectId, profileId) as ExperimentEvaluationProfileRow | undefined;
    return row ? toExperimentEvaluationProfile(row) : null;
  }

  createExperimentEvaluationSession(input: ExperimentEvaluationSession) {
    const session = ExperimentEvaluationSessionSchema.parse(structuredClone(input));
    if (
      session.status !== 'draft' ||
      session.activeAttemptId !== null ||
      session.currentRevision !== 0 ||
      session.acceptedProfileId !== null ||
      session.version !== 1 ||
      session.lastErrorCode !== null
    ) {
      throw new Error('invalid_experiment_evaluation_session_initial_state');
    }
    return (
      this.require()
        .prepare(
          `insert or ignore into experiment_evaluation_sessions(
             id,schema_version,project_id,title,status,active_attempt_id,current_revision,
             accepted_profile_id,version,last_error_code,created_at,updated_at
           ) values(?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          session.id,
          session.schemaVersion,
          session.projectId,
          session.title,
          session.status,
          session.activeAttemptId,
          session.currentRevision,
          session.acceptedProfileId,
          session.version,
          session.lastErrorCode,
          session.createdAt,
          session.updatedAt,
        ).changes === 1
    );
  }

  beginExperimentEvaluationTurn(
    input: Readonly<{
      projectId: string;
      sessionId: string;
      expectedVersion: number;
      attemptId: string;
      userMessage: ExperimentEvaluationMessage;
      updatedAt: string;
    }>,
  ): ExperimentEvaluationSession | null {
    const message = ExperimentEvaluationMessageSchema.parse(structuredClone(input.userMessage));
    if (
      message.sessionId !== input.sessionId ||
      message.role !== 'user' ||
      message.attemptId !== input.attemptId ||
      message.status !== 'complete'
    ) {
      throw new Error('invalid_experiment_evaluation_user_message');
    }
    const database = this.require();
    return database
      .transaction(() => {
        const eligible = database
          .prepare(
            `select 1 from experiment_evaluation_sessions
             where project_id=? and id=? and version=?
               and status in ('draft','ready','failed') and active_attempt_id is null`,
          )
          .get(input.projectId, input.sessionId, input.expectedVersion);
        if (!eligible) return null;
        const messageCapacity = database
          .prepare(
            `select count(*) as count from experiment_evaluation_messages
             where session_id=?`,
          )
          .get(input.sessionId) as { count: number };
        if (messageCapacity.count + 2 > EXPERIMENT_EVALUATION_MAX_MESSAGES_PER_SESSION) {
          throw new Error('experiment_evaluation_message_limit_reached');
        }
        const revisionCapacity = database
          .prepare(
            `select count(*) as count from experiment_evaluation_revisions
             where session_id=?`,
          )
          .get(input.sessionId) as { count: number };
        if (revisionCapacity.count + 1 > EXPERIMENT_EVALUATION_MAX_REVISIONS_PER_SESSION) {
          throw new Error('experiment_evaluation_revision_limit_reached');
        }
        const changed = database
          .prepare(
            `update experiment_evaluation_sessions
             set status='generating',active_attempt_id=?,last_error_code=null,
                 version=version+1,updated_at=?
             where project_id=? and id=? and version=?
               and status in ('draft','ready','failed') and active_attempt_id is null`,
          )
          .run(
            input.attemptId,
            input.updatedAt,
            input.projectId,
            input.sessionId,
            input.expectedVersion,
          );
        if (changed.changes !== 1) return null;
        insertExperimentEvaluationMessage(database, message);
        const row = database
          .prepare('select * from experiment_evaluation_sessions where id=?')
          .get(input.sessionId) as ExperimentEvaluationSessionRow;
        return toExperimentEvaluationSession(row);
      })
      .immediate();
  }

  completeExperimentEvaluationTurn(
    input: Readonly<{
      session: ExperimentEvaluationSession;
      revision: ExperimentEvaluationRevision;
      assistantMessage: ExperimentEvaluationMessage;
    }>,
  ): ExperimentEvaluationSession | null {
    const session = ExperimentEvaluationSessionSchema.parse(structuredClone(input.session));
    const revision = ExperimentEvaluationRevisionSchema.parse(structuredClone(input.revision));
    const message = ExperimentEvaluationMessageSchema.parse(
      structuredClone(input.assistantMessage),
    );
    if (
      session.status !== 'ready' ||
      session.activeAttemptId !== null ||
      session.acceptedProfileId !== null ||
      session.lastErrorCode !== null ||
      revision.sessionId !== session.id ||
      revision.revision !== session.currentRevision ||
      revision.contentHash !== experimentEvaluationDraftHash(revision.draft) ||
      message.sessionId !== session.id ||
      message.role !== 'assistant' ||
      message.status !== 'complete' ||
      message.attemptId !== revision.attemptId ||
      message.revision !== revision.revision ||
      !sameModelInvocation(message.invocation, revision.invocation)
    ) {
      throw new Error('invalid_experiment_evaluation_completion');
    }
    const database = this.require();
    return database
      .transaction(() => {
        const currentRow = database
          .prepare('select * from experiment_evaluation_sessions where id=?')
          .get(session.id) as ExperimentEvaluationSessionRow | undefined;
        if (!currentRow) return null;
        const current = toExperimentEvaluationSession(currentRow);
        if (
          current.status !== 'generating' ||
          current.activeAttemptId !== revision.attemptId ||
          current.projectId !== session.projectId ||
          session.version !== current.version + 1 ||
          session.currentRevision !== current.currentRevision + 1
        ) {
          return null;
        }
        const changed = database
          .prepare(
            `update experiment_evaluation_sessions
             set title=?,status='ready',active_attempt_id=null,current_revision=?,
                 accepted_profile_id=null,version=?,last_error_code=null,updated_at=?
             where id=? and version=? and status='generating' and active_attempt_id=?`,
          )
          .run(
            session.title,
            session.currentRevision,
            session.version,
            session.updatedAt,
            session.id,
            current.version,
            revision.attemptId,
          );
        if (changed.changes !== 1) return null;
        insertExperimentEvaluationRevision(database, revision);
        insertExperimentEvaluationMessage(database, message);
        const row = database
          .prepare('select * from experiment_evaluation_sessions where id=?')
          .get(session.id) as ExperimentEvaluationSessionRow;
        return toExperimentEvaluationSession(row);
      })
      .immediate();
  }

  failExperimentEvaluationTurn(
    input: Readonly<{
      projectId: string;
      sessionId: string;
      attemptId: string;
      errorCode: string;
      updatedAt: string;
    }>,
  ): ExperimentEvaluationSession | null {
    const database = this.require();
    return database
      .transaction(() => {
        const changed = database
          .prepare(
            `update experiment_evaluation_sessions
             set status='failed',active_attempt_id=null,last_error_code=?,
                 version=version+1,updated_at=?
             where project_id=? and id=? and status='generating' and active_attempt_id=?`,
          )
          .run(
            input.errorCode.slice(0, 128),
            input.updatedAt,
            input.projectId,
            input.sessionId,
            input.attemptId,
          );
        if (changed.changes !== 1) return null;
        database
          .prepare(
            `update experiment_evaluation_messages
             set status='failed',completed_at=?
             where session_id=? and attempt_id=? and role='user' and status='complete'`,
          )
          .run(input.updatedAt, input.sessionId, input.attemptId);
        const row = database
          .prepare('select * from experiment_evaluation_sessions where id=?')
          .get(input.sessionId) as ExperimentEvaluationSessionRow;
        return toExperimentEvaluationSession(row);
      })
      .immediate();
  }

  approveExperimentEvaluation(
    input: Readonly<{
      projectId: string;
      sessionId: string;
      expectedVersion: number;
      revision: number;
      profile: ExperimentEvaluationProfile;
      updatedAt: string;
    }>,
  ): ExperimentEvaluationSession | null {
    const profile = ExperimentEvaluationProfileSchema.parse(structuredClone(input.profile));
    const database = this.require();
    return database
      .transaction(() => {
        const sessionRow = database
          .prepare(
            `select * from experiment_evaluation_sessions
             where project_id=? and id=?`,
          )
          .get(input.projectId, input.sessionId) as ExperimentEvaluationSessionRow | undefined;
        if (!sessionRow) return null;
        const session = toExperimentEvaluationSession(sessionRow);
        const revisionRow = database
          .prepare(
            `select * from experiment_evaluation_revisions
             where session_id=? and revision=?`,
          )
          .get(input.sessionId, input.revision) as ExperimentEvaluationRevisionRow | undefined;
        if (!revisionRow) return null;
        const revision = toExperimentEvaluationRevision(revisionRow);
        if (
          session.status !== 'ready' ||
          session.version !== input.expectedVersion ||
          session.currentRevision !== input.revision ||
          profile.projectId !== input.projectId ||
          profile.sourceSessionId !== input.sessionId ||
          profile.sourceRevisionId !== revision.id ||
          profile.codePolicyHash !== EXPERIMENT_EVALUATION_CODE_POLICY_HASH ||
          profile.contentHash !== experimentEvaluationDraftHash(profile.draft) ||
          revision.contentHash !== experimentEvaluationDraftHash(revision.draft) ||
          profile.contentHash !== revision.contentHash ||
          JSON.stringify(profile.draft) !== JSON.stringify(revision.draft) ||
          !sameModelInvocation(profile.invocation, revision.invocation)
        ) {
          return null;
        }
        insertExperimentEvaluationProfile(database, profile);
        const changed = database
          .prepare(
            `update experiment_evaluation_sessions
             set accepted_profile_id=?,version=version+1,updated_at=?
             where project_id=? and id=? and version=? and status='ready'
               and current_revision=?`,
          )
          .run(
            profile.id,
            input.updatedAt,
            input.projectId,
            input.sessionId,
            input.expectedVersion,
            input.revision,
          );
        if (changed.changes !== 1) return null;
        const row = database
          .prepare('select * from experiment_evaluation_sessions where id=?')
          .get(input.sessionId) as ExperimentEvaluationSessionRow;
        return toExperimentEvaluationSession(row);
      })
      .immediate();
  }

  createExperimentEvaluationSessionFromProfile(
    input: Readonly<{
      session: ExperimentEvaluationSession;
      revision: ExperimentEvaluationRevision;
      profileId: string;
      usedAt: string;
    }>,
  ): ExperimentEvaluationSession | null {
    const session = ExperimentEvaluationSessionSchema.parse(structuredClone(input.session));
    const revision = ExperimentEvaluationRevisionSchema.parse(structuredClone(input.revision));
    if (
      session.status !== 'ready' ||
      session.currentRevision !== 1 ||
      session.version !== 1 ||
      session.acceptedProfileId !== input.profileId ||
      revision.sessionId !== session.id ||
      revision.revision !== 1
    ) {
      throw new Error('invalid_experiment_evaluation_profile_clone');
    }
    const database = this.require();
    return database
      .transaction(() => {
        const profileRow = database
          .prepare(
            `select * from experiment_evaluation_profiles
             where project_id=? and id=?`,
          )
          .get(session.projectId, input.profileId) as ExperimentEvaluationProfileRow | undefined;
        if (!profileRow) return null;
        const profile = toExperimentEvaluationProfile(profileRow);
        if (
          profile.codePolicyHash !== EXPERIMENT_EVALUATION_CODE_POLICY_HASH ||
          profile.contentHash !== experimentEvaluationDraftHash(profile.draft) ||
          revision.contentHash !== experimentEvaluationDraftHash(revision.draft) ||
          profile.contentHash !== revision.contentHash ||
          JSON.stringify(profile.draft) !== JSON.stringify(revision.draft) ||
          !sameModelInvocation(profile.invocation, revision.invocation)
        ) {
          return null;
        }
        const inserted = database
          .prepare(
            `insert or ignore into experiment_evaluation_sessions(
               id,schema_version,project_id,title,status,active_attempt_id,current_revision,
               accepted_profile_id,version,last_error_code,created_at,updated_at
             ) values(?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            session.id,
            session.schemaVersion,
            session.projectId,
            session.title,
            session.status,
            session.activeAttemptId,
            session.currentRevision,
            session.acceptedProfileId,
            session.version,
            session.lastErrorCode,
            session.createdAt,
            session.updatedAt,
          );
        if (inserted.changes !== 1) return null;
        insertExperimentEvaluationRevision(database, revision);
        database
          .prepare(
            `update experiment_evaluation_profiles
             set use_count=use_count+1,last_used_at=?
             where project_id=? and id=?`,
          )
          .run(input.usedAt, session.projectId, input.profileId);
        const row = database
          .prepare('select * from experiment_evaluation_sessions where id=?')
          .get(session.id) as ExperimentEvaluationSessionRow;
        return toExperimentEvaluationSession(row);
      })
      .immediate();
  }

  listLectureStudios(includeTrashed = false): LectureStudioSummary[] {
    const rows = this.require()
      .prepare(
        `select id,schema_version,title,kind,duration_minutes,output_project_id,
                status,active_attempt_id,current_revision,version,last_error_code,
                trashed_at,created_at,updated_at
         from lecture_studios
         where (?=1 or trashed_at is null)
         order by updated_at desc,id asc`,
      )
      .all(includeTrashed ? 1 : 0) as LectureStudioSummaryRow[];
    return rows.map(toLectureStudioSummary);
  }

  getLectureStudio(studioId: string): LectureStudio | null {
    const row = this.require().prepare('select * from lecture_studios where id=?').get(studioId) as
      LectureStudioRow | undefined;
    return row ? toLectureStudio(row) : null;
  }

  getLectureStudioDetail(studioId: string): LectureStudioDetail | null {
    const database = this.require();
    return database.transaction(() => {
      const studioRow = database
        .prepare('select * from lecture_studios where id=?')
        .get(studioId) as LectureStudioRow | undefined;
      if (!studioRow) return null;
      const messageRows = database
        .prepare(
          `select * from (
             select * from lecture_studio_messages
             where studio_id=? order by created_at desc,id desc limit 50
           ) order by created_at asc,id asc`,
        )
        .all(studioId) as LectureStudioMessageRow[];
      const revisionRows = database
        .prepare(
          `select * from lecture_studio_revisions
           where studio_id=? order by revision desc limit 1`,
        )
        .all(studioId) as LectureStudioRevisionRow[];
      return LectureStudioDetailSchema.parse({
        schemaVersion: 1,
        studio: toLectureStudio(studioRow),
        messages: messageRows.map(toLectureStudioMessage),
        revisions: revisionRows.map(toLectureStudioRevision),
      });
    })();
  }

  listLectureStudioMessages(studioId: string, limit: number): LectureStudioMessage[] {
    const safeLimit = lectureStudioStorageQueryLimit(limit);
    const rows = this.require()
      .prepare(
        `select * from (
           select * from lecture_studio_messages
           where studio_id=? order by created_at desc,id desc limit ?
         ) order by created_at asc,id asc`,
      )
      .all(studioId, safeLimit) as LectureStudioMessageRow[];
    return rows.map(toLectureStudioMessage);
  }

  listLectureStudioRevisions(studioId: string, limit: number): LectureStudioRevision[] {
    const safeLimit = lectureStudioStorageQueryLimit(limit);
    const rows = this.require()
      .prepare(
        `select * from (
           select * from lecture_studio_revisions
           where studio_id=? order by revision desc limit ?
         ) order by revision asc`,
      )
      .all(studioId, safeLimit) as LectureStudioRevisionRow[];
    return rows.map(toLectureStudioRevision);
  }

  getCurrentLectureStudioRevision(studioId: string): LectureStudioRevision | null {
    const row = this.require()
      .prepare(
        `select r.* from lecture_studio_revisions r
         join lecture_studios s on s.id=r.studio_id and s.current_revision=r.revision
         where r.studio_id=?`,
      )
      .get(studioId) as LectureStudioRevisionRow | undefined;
    return row ? toLectureStudioRevision(row) : null;
  }

  getLectureStudioRevision(studioId: string, revision: number): LectureStudioRevision | null {
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error('invalid_lecture_revision');
    }
    const row = this.require()
      .prepare(
        `select * from lecture_studio_revisions
         where studio_id=? and revision=?`,
      )
      .get(studioId, revision) as LectureStudioRevisionRow | undefined;
    return row ? toLectureStudioRevision(row) : null;
  }

  createLectureStudio(input: LectureStudio) {
    const studio = LectureStudioSchema.parse(structuredClone(input));
    if (
      studio.status !== 'draft' ||
      studio.activeAttemptId !== null ||
      studio.currentRevision !== 0 ||
      studio.version !== 1 ||
      studio.lastErrorCode !== null
    ) {
      throw new Error('invalid_lecture_studio_initial_state');
    }
    try {
      return (
        this.require()
          .prepare(
            `insert or ignore into lecture_studios(
               id,schema_version,title,kind,duration_minutes,output_project_id,
               source_project_ids_json,source_selection_json,generation_brief_json,
               status,active_attempt_id,current_revision,version,last_error_code,trashed_at,
               created_at,updated_at
             ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            studio.id,
            studio.schemaVersion,
            studio.title,
            studio.kind,
            studio.durationMinutes,
            studio.outputProjectId,
            JSON.stringify(studio.sourceProjectIds),
            JSON.stringify(studio.sourceSelection),
            JSON.stringify(studio.generationBrief),
            studio.status,
            studio.activeAttemptId,
            studio.currentRevision,
            studio.version,
            studio.lastErrorCode,
            studio.trashedAt ?? null,
            studio.createdAt,
            studio.updatedAt,
          ).changes === 1
      );
    } catch (error) {
      throwMappedLectureStudioStorageError(error);
    }
  }

  beginLectureStudioTurn(
    input: Readonly<{
      studioId: string;
      expectedVersion: number;
      attemptId: string;
      userMessage: LectureStudioMessage | null;
      updatedAt: string;
    }>,
  ): LectureStudio | null {
    const database = this.require();
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error('invalid_lecture_version');
    }
    const userMessage =
      input.userMessage === null
        ? null
        : LectureStudioMessageSchema.parse(structuredClone(input.userMessage));
    if (
      userMessage &&
      (userMessage.studioId !== input.studioId ||
        userMessage.role !== 'user' ||
        userMessage.attemptId !== input.attemptId ||
        userMessage.status !== 'complete')
    ) {
      throw new Error('invalid_lecture_user_message');
    }
    try {
      return database
        .transaction(() => {
          const changed = database
            .prepare(
              `update lecture_studios
               set status='generating',active_attempt_id=?,last_error_code=null,
                   version=version+1,updated_at=?
               where id=? and version=? and status in ('draft','ready','failed')
                 and active_attempt_id is null and trashed_at is null`,
            )
            .run(input.attemptId, input.updatedAt, input.studioId, input.expectedVersion);
          if (changed.changes !== 1) return null;
          const capacity = database
            .prepare(
              `select
                 (select count(*) from lecture_studio_messages where studio_id=?) as message_count,
                 (select count(*) from lecture_studio_revisions where studio_id=?) as revision_count`,
            )
            .get(input.studioId, input.studioId) as {
            message_count: number;
            revision_count: number;
          };
          const requiredMessages = userMessage === null ? 1 : 2;
          if (
            capacity.revision_count >= LECTURE_STUDIO_MAX_REVISIONS ||
            capacity.message_count + requiredMessages > LECTURE_STUDIO_MAX_MESSAGES
          ) {
            throw new LectureStudioStorageError('capacity_reached');
          }
          if (userMessage) insertLectureStudioMessage(database, userMessage);
          const row = database
            .prepare('select * from lecture_studios where id=?')
            .get(input.studioId) as LectureStudioRow;
          return toLectureStudio(row);
        })
        .immediate();
    } catch (error) {
      if (error instanceof LectureStudioStorageError) throw error;
      throwMappedLectureStudioStorageError(error);
    }
  }

  completeLectureStudioTurn(
    input: Readonly<{
      studio: LectureStudio;
      revision: LectureStudioRevision;
      assistantMessage: LectureStudioMessage | null;
    }>,
  ): LectureStudio | null {
    const studio = LectureStudioSchema.parse(structuredClone(input.studio));
    const revision = LectureStudioRevisionSchema.parse(structuredClone(input.revision));
    const assistantMessage =
      input.assistantMessage === null
        ? null
        : LectureStudioMessageSchema.parse(structuredClone(input.assistantMessage));
    if (
      studio.status !== 'ready' ||
      studio.activeAttemptId !== null ||
      studio.lastErrorCode !== null ||
      revision.studioId !== studio.id ||
      revision.revision !== studio.currentRevision ||
      (assistantMessage !== null &&
        (assistantMessage.studioId !== studio.id ||
          assistantMessage.role !== 'assistant' ||
          assistantMessage.status !== 'complete' ||
          assistantMessage.attemptId !== revision.attemptId ||
          assistantMessage.revision !== revision.revision))
    ) {
      throw new Error('invalid_lecture_completion');
    }
    const database = this.require();
    try {
      return database
        .transaction(() => {
          const existingRow = database
            .prepare('select * from lecture_studios where id=?')
            .get(studio.id) as LectureStudioRow | undefined;
          if (!existingRow) return null;
          const existing = toLectureStudio(existingRow);
          const configurationChanged =
            studio.title !== existing.title ||
            studio.kind !== existing.kind ||
            studio.durationMinutes !== existing.durationMinutes ||
            studio.outputProjectId !== existing.outputProjectId ||
            JSON.stringify(studio.sourceProjectIds) !== JSON.stringify(existing.sourceProjectIds) ||
            JSON.stringify(studio.sourceSelection) !== JSON.stringify(existing.sourceSelection) ||
            JSON.stringify(studio.generationBrief) !== JSON.stringify(existing.generationBrief);
          if (
            existing.status !== 'generating' ||
            existing.activeAttemptId !== revision.attemptId ||
            studio.version !== existing.version + 1 ||
            studio.currentRevision !== existing.currentRevision + 1 ||
            configurationChanged
          ) {
            return null;
          }
          const changed = database
            .prepare(
              `update lecture_studios
               set status='ready',active_attempt_id=null,current_revision=?,version=?,
                   last_error_code=null,updated_at=?
               where id=? and version=? and status='generating' and active_attempt_id=?`,
            )
            .run(
              studio.currentRevision,
              studio.version,
              studio.updatedAt,
              studio.id,
              existing.version,
              revision.attemptId,
            );
          if (changed.changes !== 1) return null;
          insertLectureStudioRevision(database, revision);
          if (assistantMessage) insertLectureStudioMessage(database, assistantMessage);
          const row = database
            .prepare('select * from lecture_studios where id=?')
            .get(studio.id) as LectureStudioRow;
          return toLectureStudio(row);
        })
        .immediate();
    } catch (error) {
      throwMappedLectureStudioStorageError(error);
    }
  }

  failLectureStudioTurn(
    input: Readonly<{
      studioId: string;
      attemptId: string;
      errorCode: string;
      messageStatus: 'failed' | 'interrupted';
      updatedAt: string;
    }>,
  ): LectureStudio | null {
    if (input.errorCode.trim().length < 1 || input.errorCode.length > 128) {
      throw new Error('invalid_lecture_error_code');
    }
    if (input.messageStatus !== 'failed' && input.messageStatus !== 'interrupted') {
      throw new Error('invalid_lecture_message_status');
    }
    const database = this.require();
    return database
      .transaction(() => {
        const changed = database
          .prepare(
            `update lecture_studios
             set status='failed',active_attempt_id=null,last_error_code=?,
                 version=version+1,updated_at=?
             where id=? and status='generating' and active_attempt_id=?`,
          )
          .run(input.errorCode, input.updatedAt, input.studioId, input.attemptId);
        if (changed.changes !== 1) return null;
        database
          .prepare(
            `update lecture_studio_messages
             set status=?,completed_at=?
             where studio_id=? and attempt_id=? and role='user' and status='complete'`,
          )
          .run(input.messageStatus, input.updatedAt, input.studioId, input.attemptId);
        const row = database
          .prepare('select * from lecture_studios where id=?')
          .get(input.studioId) as LectureStudioRow;
        return toLectureStudio(row);
      })
      .immediate();
  }

  setLectureStudioTrashed(
    studioId: string,
    expectedVersion: number,
    trashedAt: string | null,
    updatedAt: string,
  ): LectureStudio | null {
    const database = this.require();
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('invalid_lecture_version');
    }
    try {
      return database
        .transaction(() => {
          const changed = database
            .prepare(
              `update lecture_studios
               set trashed_at=?,version=version+1,updated_at=?
               where id=? and version=? and active_attempt_id is null
                 and ((? is null and trashed_at is not null) or (? is not null and trashed_at is null))`,
            )
            .run(trashedAt, updatedAt, studioId, expectedVersion, trashedAt, trashedAt);
          if (changed.changes !== 1) return null;
          return toLectureStudio(
            database
              .prepare('select * from lecture_studios where id=?')
              .get(studioId) as LectureStudioRow,
          );
        })
        .immediate();
    } catch (error) {
      if (error instanceof LectureStudioStorageError) throw error;
      throwMappedLectureStudioStorageError(error);
    }
  }

  emptyLectureStudioTrash(
    input: EmptyLectureStudioTrashInput,
    completedAt: string,
  ): EmptyLectureStudioTrashReceipt | null {
    const command = EmptyLectureStudioTrashInputSchema.parse(input);
    const database = this.require();
    try {
      return database
        .transaction(() => {
          const prior = database
            .prepare(
              `select receipt_json from lecture_studio_trash_receipts where idempotency_key=?`,
            )
            .get(command.idempotencyKey) as { receipt_json: string } | undefined;
          if (prior) {
            return EmptyLectureStudioTrashReceiptSchema.parse(JSON.parse(prior.receipt_json));
          }
          const rows = database
            .prepare(
              `select s.id,s.title,s.output_project_id,s.version,s.trashed_at,
                    (select count(*) from lecture_studio_revisions where studio_id=s.id) as revision_count,
                    (select count(*) from lecture_studio_messages where studio_id=s.id) as message_count
             from lecture_studios s
             where s.trashed_at is not null
             order by s.id asc`,
            )
            .all() as Array<{
            id: string;
            title: string;
            output_project_id: string;
            version: number;
            trashed_at: string;
            revision_count: number;
            message_count: number;
          }>;
          const exactTargetsMatch =
            rows.length === command.targets.length &&
            rows.every((row, index) => {
              const target = command.targets[index];
              return (
                target !== undefined &&
                row.id === target.studioId &&
                row.version === target.expectedVersion &&
                row.trashed_at === target.trashedAt
              );
            });
          if (!exactTargetsMatch) {
            throw new LectureStudioStorageError('trash_changed');
          }
          const receipt = EmptyLectureStudioTrashReceiptSchema.parse({
            schemaVersion: 1,
            idempotencyKey: command.idempotencyKey,
            removedStudios: rows.map((row) => ({
              studioId: row.id,
              title: row.title,
              outputProjectId: row.output_project_id,
              revisionCount: row.revision_count,
              messageCount: row.message_count,
              trashedAt: row.trashed_at,
            })),
            completedAt,
          });
          // A confirmed permanent purge temporarily drops the revision append-only guard inside
          // one immediate transaction; active and restored Studio rows never match this delete.
          database.exec('drop trigger if exists lecture_studio_revisions_delete_guard');
          const remove = database.prepare(
            `delete from lecture_studios
             where id=? and version=? and trashed_at=? and active_attempt_id is null`,
          );
          for (const [index, row] of rows.entries()) {
            const target = command.targets[index]!;
            if (remove.run(row.id, target.expectedVersion, target.trashedAt).changes !== 1) {
              throw new LectureStudioStorageError('trash_changed');
            }
          }
          database.exec(`
            create trigger if not exists lecture_studio_revisions_delete_guard
              before delete on lecture_studio_revisions
              begin
                select raise(abort,'lecture_revision_append_only');
              end;
          `);
          database
            .prepare(
              `insert into lecture_studio_trash_receipts(idempotency_key,receipt_json,completed_at)
             values(?,?,?)`,
            )
            .run(command.idempotencyKey, JSON.stringify(receipt), completedAt);
          return receipt;
        })
        .immediate();
    } finally {
      // DDL participates in SQLite transactions, so a rollback restores the guard. Reasserting it
      // here also protects a future schema that changes transaction behavior.
      database.exec(`
        create trigger if not exists lecture_studio_revisions_delete_guard
          before delete on lecture_studio_revisions
          begin
            select raise(abort,'lecture_revision_append_only');
          end;
      `);
    }
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
             search_run_id,ordinal,provider,provider_record_id,canonical_id,doi,fingerprint,title,
             authors_json,published_year
           ) values(?,?,?,?,?,?,?,?,?,?)`,
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
                canonicalId: candidate.canonicalId ?? null,
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
                conflict.canonicalId,
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

  listManuscripts(projectId: string): ManuscriptRecord[] {
    const rows = this.require()
      .prepare(
        `select record_json from manuscript_records
         where project_id=? order by created_at asc,id asc`,
      )
      .all(projectId) as Array<{ record_json: string }>;
    return rows.map((row) => ManuscriptRecordSchema.parse(JSON.parse(row.record_json)));
  }

  getManuscript(projectId: string, manuscriptId: string): ManuscriptRecord | null {
    const row = this.require()
      .prepare('select record_json from manuscript_records where project_id=? and id=?')
      .get(projectId, manuscriptId) as { record_json: string } | undefined;
    return row ? ManuscriptRecordSchema.parse(JSON.parse(row.record_json)) : null;
  }

  createManuscript(input: ManuscriptRecord) {
    const manuscript = ManuscriptRecordSchema.parse(input);
    return (
      this.require()
        .prepare(
          `insert or ignore into manuscript_records(
             id,project_id,record_json,version,created_at,updated_at
           ) values(?,?,?,?,?,?)`,
        )
        .run(
          manuscript.id,
          manuscript.projectId,
          JSON.stringify(manuscript),
          manuscript.version,
          manuscript.createdAt,
          manuscript.updatedAt,
        ).changes === 1
    );
  }

  updateManuscript(input: ManuscriptRecord, expectedVersion: number) {
    const manuscript = ManuscriptRecordSchema.parse(input);
    if (manuscript.version !== expectedVersion + 1) {
      throw new Error('manuscript_version_sequence_invalid');
    }
    return (
      this.require()
        .prepare(
          `update manuscript_records set record_json=?,version=?,updated_at=?
           where project_id=? and id=? and version=?`,
        )
        .run(
          JSON.stringify(manuscript),
          manuscript.version,
          manuscript.updatedAt,
          manuscript.projectId,
          manuscript.id,
          expectedVersion,
        ).changes === 1
    );
  }

  canDeleteUnconfiguredManuscript(projectId: string, manuscriptId: string) {
    return Boolean(
      this.require()
        .prepare(
          `select 1
           from manuscript_records manuscript
           where manuscript.project_id=? and manuscript.id=?
             and not exists (
               select 1 from manuscript_workspace_connections connection
               where connection.project_id=manuscript.project_id
                 and connection.manuscript_id=manuscript.id
             )
             and not exists (
               select 1 from manuscript_checkpoints checkpoint
               where checkpoint.project_id=manuscript.project_id
                 and checkpoint.manuscript_id=manuscript.id
             )`,
        )
        .get(projectId, manuscriptId),
    );
  }

  deleteUnconfiguredManuscript(projectId: string, manuscriptId: string, expectedVersion: number) {
    return (
      this.require()
        .prepare(
          `delete from manuscript_records
           where project_id=? and id=? and version=?
             and not exists (
               select 1 from manuscript_workspace_connections connection
               where connection.project_id=manuscript_records.project_id
                 and connection.manuscript_id=manuscript_records.id
             )
             and not exists (
               select 1 from manuscript_checkpoints checkpoint
               where checkpoint.project_id=manuscript_records.project_id
                 and checkpoint.manuscript_id=manuscript_records.id
             )`,
        )
        .run(projectId, manuscriptId, expectedVersion).changes === 1
    );
  }

  getManuscriptWorkspaceConnection(
    projectId: string,
    manuscriptId: string,
  ): StoredManuscriptWorkspaceConnection | null {
    const row = this.require()
      .prepare(
        `select connection_json from manuscript_workspace_connections
         where project_id=? and manuscript_id=? and enabled=1`,
      )
      .get(projectId, manuscriptId) as { connection_json: string } | undefined;
    return row ? parseStoredManuscriptConnection(row.connection_json) : null;
  }

  getOverleafGitBindingConfiguration(bindingId: string): OverleafGitBindingConfiguration | null {
    const row = this.require()
      .prepare(
        `select binding_id,remote_url,workspace_id,web_url,credential_ref
         from overleaf_git_bindings where binding_id=?`,
      )
      .get(bindingId) as OverleafGitBindingRow | undefined;
    return row
      ? validateOverleafGitBindingConfiguration({
          bindingId: row.binding_id,
          remoteUrl: row.remote_url,
          workspaceId: row.workspace_id,
          webUrl: row.web_url,
          credentialRef: row.credential_ref,
        })
      : null;
  }

  listManuscriptCredentialReferences(providerId: string) {
    const parsedProviderId =
      ManuscriptCredentialCleanupQueueEntrySchema.shape.providerId.parse(providerId);
    if (parsedProviderId !== 'overleaf_git') return [];
    const rows = this.require()
      .prepare(
        `select distinct overleaf.credential_ref
         from manuscript_workspace_connections connection
         join overleaf_git_bindings overleaf on overleaf.binding_id=connection.binding_id
         where connection.provider_id=?
         order by overleaf.credential_ref asc`,
      )
      .all(parsedProviderId) as Array<{ credential_ref: string }>;
    return rows.map((row) => row.credential_ref);
  }

  getManuscriptWorkspacePresentation(bindingId: string) {
    const row = this.require()
      .prepare('select web_url from overleaf_git_bindings where binding_id=?')
      .get(bindingId) as Pick<OverleafGitBindingRow, 'web_url'> | undefined;
    return { workspaceUrl: row?.web_url ?? null };
  }

  connectOverleafGitWorkspace(
    input: StoredManuscriptWorkspaceConnection,
    configuration: OverleafGitBindingConfiguration,
    expectedManuscriptVersion: number,
  ) {
    const connection = validateStoredManuscriptConnection(input);
    const validatedConfiguration = validateOverleafGitBindingConfiguration(configuration);
    if (
      connection.binding.providerId !== 'overleaf_git' ||
      validatedConfiguration.bindingId !== connection.binding.bindingId ||
      expectedManuscriptVersion <= 0
    ) {
      throw new Error('manuscript_binding_invalid');
    }
    const database = this.require();
    return database
      .transaction(() => {
        const manuscript = database
          .prepare('select version from manuscript_records where project_id=? and id=?')
          .get(connection.binding.projectId, connection.binding.manuscriptId) as
          { version: number } | undefined;
        if (!manuscript || manuscript.version !== expectedManuscriptVersion) return false;
        const existing = database
          .prepare(
            `select 1 from manuscript_workspace_connections
             where manuscript_id=? and enabled=1`,
          )
          .get(connection.binding.manuscriptId);
        if (existing) return false;
        const inserted = database
          .prepare(
            `insert or ignore into manuscript_workspace_connections(
               binding_id,project_id,manuscript_id,provider_id,connection_json,
               binding_version,enabled,created_at,updated_at
             ) values(?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            connection.binding.bindingId,
            connection.binding.projectId,
            connection.binding.manuscriptId,
            connection.binding.providerId,
            JSON.stringify(connection),
            connection.binding.version,
            connection.binding.enabled ? 1 : 0,
            connection.binding.createdAt,
            connection.binding.updatedAt,
          );
        if (inserted.changes !== 1) return false;
        database
          .prepare(
            `insert into overleaf_git_bindings(
               binding_id,remote_url,workspace_id,web_url,credential_ref,updated_at
             ) values(?,?,?,?,?,?)`,
          )
          .run(
            validatedConfiguration.bindingId,
            validatedConfiguration.remoteUrl,
            validatedConfiguration.workspaceId,
            validatedConfiguration.webUrl,
            validatedConfiguration.credentialRef,
            connection.binding.updatedAt,
          );
        return true;
      })
      .immediate();
  }

  listManuscriptArtifactPurgeQueue(
    projectIds?: readonly string[],
    after?: Readonly<{ queuedAt: string; bindingId: string }>,
  ): ManuscriptArtifactPurgeQueueEntry[] {
    const columns = 'binding_id,project_id,provider_id,queued_at';
    const cursor = after ? ManuscriptArtifactPurgeCursorSchema.parse(after) : null;
    let rows: ManuscriptArtifactPurgeQueueRow[];
    if (projectIds === undefined) {
      rows = this.require()
        .prepare(
          `select ${columns} from manuscript_artifact_purge_queue
           ${cursor ? 'where (queued_at>? or (queued_at=? and binding_id>?))' : ''}
           order by queued_at asc,binding_id asc limit ?`,
        )
        .all(
          ...(cursor ? [cursor.queuedAt, cursor.queuedAt, cursor.bindingId] : []),
          MANUSCRIPT_ARTIFACT_PURGE_BATCH_LIMIT,
        ) as ManuscriptArtifactPurgeQueueRow[];
    } else {
      const parsedProjectIds = ManuscriptArtifactPurgeProjectIdsSchema.parse([...projectIds]);
      if (parsedProjectIds.length === 0) return [];
      const placeholders = parsedProjectIds.map(() => '?').join(',');
      rows = this.require()
        .prepare(
          `select ${columns} from manuscript_artifact_purge_queue
           where project_id in (${placeholders})
             ${cursor ? 'and (queued_at>? or (queued_at=? and binding_id>?))' : ''}
           order by queued_at asc,binding_id asc limit ?`,
        )
        .all(
          ...parsedProjectIds,
          ...(cursor ? [cursor.queuedAt, cursor.queuedAt, cursor.bindingId] : []),
          MANUSCRIPT_ARTIFACT_PURGE_BATCH_LIMIT,
        ) as ManuscriptArtifactPurgeQueueRow[];
    }
    return rows.map((row) =>
      ManuscriptArtifactPurgeQueueEntrySchema.parse({
        bindingId: row.binding_id,
        projectId: row.project_id,
        providerId: row.provider_id,
        queuedAt: row.queued_at,
      }),
    );
  }

  completeManuscriptArtifactPurge(bindingId: string) {
    const parsedBindingId = z.string().uuid().parse(bindingId);
    return (
      this.require()
        .prepare('delete from manuscript_artifact_purge_queue where binding_id=?')
        .run(parsedBindingId).changes === 1
    );
  }

  listManuscriptCredentialCleanupQueue(
    after?: Readonly<{ queuedAt: string; providerId: string; credentialRef: string }>,
  ): ManuscriptCredentialCleanupQueueEntry[] {
    const cursor = after ? ManuscriptCredentialCleanupCursorSchema.parse(after) : null;
    const rows = this.require()
      .prepare(
        `select provider_id,credential_ref,queued_at
         from manuscript_credential_cleanup_queue
         ${
           cursor
             ? `where queued_at>?
                  or (queued_at=? and provider_id>?)
                  or (queued_at=? and provider_id=? and credential_ref>?)`
             : ''
         }
         order by queued_at asc,provider_id asc,credential_ref asc limit ?`,
      )
      .all(
        ...(cursor
          ? [
              cursor.queuedAt,
              cursor.queuedAt,
              cursor.providerId,
              cursor.queuedAt,
              cursor.providerId,
              cursor.credentialRef,
            ]
          : []),
        MANUSCRIPT_CREDENTIAL_CLEANUP_BATCH_LIMIT,
      ) as ManuscriptCredentialCleanupQueueRow[];
    return rows.map((row) =>
      ManuscriptCredentialCleanupQueueEntrySchema.parse({
        providerId: row.provider_id,
        credentialRef: row.credential_ref,
        queuedAt: row.queued_at,
      }),
    );
  }

  hasEnabledManuscriptCredentialReference(providerId: string, credentialRef: string) {
    const parsed = ManuscriptCredentialCleanupQueueEntrySchema.pick({
      providerId: true,
      credentialRef: true,
    }).parse({ providerId, credentialRef });
    return Boolean(
      this.require()
        .prepare(
          `select 1
           from manuscript_workspace_connections connection
           join overleaf_git_bindings overleaf on overleaf.binding_id=connection.binding_id
           where connection.provider_id=? and overleaf.credential_ref=?
             and connection.enabled=1
           limit 1`,
        )
        .get(parsed.providerId, parsed.credentialRef),
    );
  }

  completeManuscriptCredentialCleanup(providerId: string, credentialRef: string) {
    const parsed = ManuscriptCredentialCleanupQueueEntrySchema.pick({
      providerId: true,
      credentialRef: true,
    }).parse({ providerId, credentialRef });
    return (
      this.require()
        .prepare(
          `delete from manuscript_credential_cleanup_queue
           where provider_id=? and credential_ref=?`,
        )
        .run(parsed.providerId, parsed.credentialRef).changes === 1
    );
  }

  updateManuscriptWorkspaceConnection(
    input: StoredManuscriptWorkspaceConnection,
    expectedBindingVersion: number,
  ) {
    const connection = validateStoredManuscriptConnection(input);
    if (connection.binding.version !== expectedBindingVersion) {
      throw new Error('manuscript_binding_version_sequence_invalid');
    }
    return (
      this.require()
        .prepare(
          `update manuscript_workspace_connections set
             connection_json=?,enabled=?,updated_at=?
           where binding_id=? and project_id=? and manuscript_id=?
             and binding_version=? and enabled=1`,
        )
        .run(
          JSON.stringify(connection),
          connection.binding.enabled ? 1 : 0,
          connection.binding.updatedAt,
          connection.binding.bindingId,
          connection.binding.projectId,
          connection.binding.manuscriptId,
          expectedBindingVersion,
        ).changes === 1
    );
  }

  latestManuscriptCheckpoint(bindingId: string): ManuscriptCheckpointV1 | null {
    const row = this.require()
      .prepare(
        `select checkpoint_json from manuscript_checkpoints
         where binding_id=? order by rowid desc limit 1`,
      )
      .get(bindingId) as { checkpoint_json: string } | undefined;
    return row ? ManuscriptCheckpointV1Schema.parse(JSON.parse(row.checkpoint_json)) : null;
  }

  latestManuscriptCheckpointForManuscript(
    projectId: string,
    manuscriptId: string,
  ): ManuscriptCheckpointV1 | null {
    const row = this.require()
      .prepare(
        `select checkpoint_json from manuscript_checkpoints
         where project_id=? and manuscript_id=? order by rowid desc limit 1`,
      )
      .get(projectId, manuscriptId) as { checkpoint_json: string } | undefined;
    return row ? ManuscriptCheckpointV1Schema.parse(JSON.parse(row.checkpoint_json)) : null;
  }

  getManuscriptCheckpointByProviderRevision(
    bindingId: string,
    providerRevision: string,
  ): ManuscriptCheckpointV1 | null {
    const row = this.require()
      .prepare(
        `select checkpoint_json from manuscript_checkpoints
         where binding_id=? and provider_revision=?`,
      )
      .get(bindingId, providerRevision) as { checkpoint_json: string } | undefined;
    return row ? ManuscriptCheckpointV1Schema.parse(JSON.parse(row.checkpoint_json)) : null;
  }

  appendManuscriptCheckpoint(input: ManuscriptCheckpointV1): ManuscriptCheckpointV1 {
    const checkpoint = ManuscriptCheckpointV1Schema.parse(input);
    if (!checkpoint.providerRevision) throw new Error('manuscript_provider_revision_required');
    const database = this.require();
    return database
      .transaction(() => {
        database
          .prepare(
            `insert or ignore into manuscript_checkpoints(
               checkpoint_id,binding_id,project_id,manuscript_id,provider_revision,
               checkpoint_json,observed_at
             ) values(?,?,?,?,?,?,?)`,
          )
          .run(
            checkpoint.checkpointId,
            checkpoint.bindingId,
            checkpoint.projectId,
            checkpoint.manuscriptId,
            checkpoint.providerRevision,
            JSON.stringify(checkpoint),
            checkpoint.observedAt,
          );
        const stored = database
          .prepare(
            `select checkpoint_json from manuscript_checkpoints
             where binding_id=? and provider_revision=?`,
          )
          .get(checkpoint.bindingId, checkpoint.providerRevision) as
          { checkpoint_json: string } | undefined;
        if (!stored) throw new Error('manuscript_checkpoint_unavailable');
        const parsed = ManuscriptCheckpointV1Schema.parse(JSON.parse(stored.checkpoint_json));
        if (
          parsed.revisionEnvelopeDigest !== checkpoint.revisionEnvelopeDigest ||
          parsed.sourceRevision !== checkpoint.sourceRevision
        ) {
          throw new Error('manuscript_checkpoint_identity_conflict');
        }
        return parsed;
      })
      .immediate();
  }

  disableManuscriptWorkspaceConnection(
    projectId: string,
    manuscriptId: string,
    bindingId: string,
    expectedBindingVersion: number,
    updatedAt: string,
  ) {
    const database = this.require();
    return database
      .transaction(() => {
        const row = database
          .prepare(
            `select connection.connection_json,connection.provider_id,
                    overleaf.credential_ref
             from manuscript_workspace_connections connection
             left join overleaf_git_bindings overleaf
               on overleaf.binding_id=connection.binding_id
             where connection.project_id=? and connection.manuscript_id=?
               and connection.binding_id=? and connection.binding_version=?
               and connection.enabled=1`,
          )
          .get(projectId, manuscriptId, bindingId, expectedBindingVersion) as
          | { connection_json: string; provider_id: string; credential_ref: string | null }
          | undefined;
        if (!row) return false;
        const current = parseStoredManuscriptConnection(row.connection_json);
        const disabled = validateStoredManuscriptConnection({
          ...current,
          binding: ManuscriptWorkspaceBindingV1Schema.parse({
            ...current.binding,
            enabled: false,
            version: current.binding.version + 1,
            updatedAt,
          }),
        });
        if (row.credential_ref) {
          database
            .prepare(
              `insert or ignore into manuscript_credential_cleanup_queue(
                 provider_id,credential_ref,queued_at
               ) values(?,?,?)`,
            )
            .run(row.provider_id, row.credential_ref, updatedAt);
        }
        return (
          database
            .prepare(
              `update manuscript_workspace_connections set
                 connection_json=?,binding_version=?,enabled=0,updated_at=?
               where binding_id=? and binding_version=? and enabled=1`,
            )
            .run(
              JSON.stringify(disabled),
              disabled.binding.version,
              updatedAt,
              bindingId,
              expectedBindingVersion,
            ).changes === 1
        );
      })
      .immediate();
  }

  localManuscriptActorId() {
    const existing = this.get('identity', 'local-manuscript-actor')?.value;
    if (typeof existing === 'string' && z.string().uuid().safeParse(existing).success) {
      return existing;
    }
    const actorId = randomUUID();
    this.cache('identity', 'local-manuscript-actor', actorId, 1);
    return actorId;
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
                trusted_access_json,version,created_at,updated_at
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
             trusted_access_json,version,created_at,updated_at
           ) values(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          grant.id,
          grant.schemaVersion,
          grant.projectId,
          grant.connectionId,
          grant.canonicalRoot,
          grant.permissionMode,
          grant.trustedAccess ? JSON.stringify(grant.trustedAccess) : null,
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
             canonical_root=?,permission_mode=?,trusted_access_json=?,version=?,updated_at=?
           where id=? and project_id=? and connection_id=? and version=?`,
        )
        .run(
          grant.canonicalRoot,
          grant.permissionMode,
          grant.trustedAccess ? JSON.stringify(grant.trustedAccess) : null,
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

  appendSshTrustedWorkspaceAudit(input: SshTrustedWorkspaceAuditRecord) {
    const record = SshTrustedWorkspaceAuditRecordSchema.parse(input);
    return (
      this.require()
        .prepare(
          `insert or ignore into ssh_trusted_workspace_audit(
             id,schema_version,project_id,grant_id,grant_version,connection_id,
             connection_version,policy_version,session_id,attempt_id,turn_id,tool_call_id,
             operation,command_sha256,auto_approved_at
           ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          record.id,
          record.schemaVersion,
          record.projectId,
          record.grantId,
          record.grantVersion,
          record.connectionId,
          record.connectionVersion,
          record.policyVersion,
          record.sessionId,
          record.attemptId,
          record.turnId,
          record.toolCallId,
          record.operation,
          record.commandSha256,
          record.autoApprovedAt,
        ).changes === 1
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

type OverleafGitBindingRow = {
  binding_id: string;
  remote_url: string;
  workspace_id: string;
  web_url: string;
  credential_ref: string;
};

type ManuscriptArtifactPurgeQueueRow = Readonly<{
  binding_id: string;
  project_id: string;
  provider_id: string;
  queued_at: string;
}>;

type ManuscriptCredentialCleanupQueueRow = Readonly<{
  provider_id: string;
  credential_ref: string;
  queued_at: string;
}>;

function validateStoredManuscriptConnection(
  input: StoredManuscriptWorkspaceConnection,
): StoredManuscriptWorkspaceConnection {
  const binding = ManuscriptWorkspaceBindingV1Schema.parse(input.binding);
  const anchor = ManuscriptSyncAnchorV1Schema.parse(input.anchor);
  if (anchor.bindingId !== binding.bindingId) {
    throw new Error('manuscript_anchor_binding_mismatch');
  }
  return {
    binding,
    anchor,
    lifecycle: ManuscriptWorkspaceLifecycleSchema.parse(input.lifecycle),
    lastObservedProviderRevision:
      input.lastObservedProviderRevision === null
        ? null
        : z.string().trim().min(1).max(512).parse(input.lastObservedProviderRevision),
    lastObservedAt:
      input.lastObservedAt === null
        ? null
        : z.iso.datetime({ offset: true }).parse(input.lastObservedAt),
    lastFailureCode:
      input.lastFailureCode === null
        ? null
        : z.string().trim().min(1).max(128).parse(input.lastFailureCode),
  };
}

function parseStoredManuscriptConnection(value: string) {
  return validateStoredManuscriptConnection(
    JSON.parse(value) as StoredManuscriptWorkspaceConnection,
  );
}

type SshWorkspaceGrantRow = {
  id: string;
  schema_version: number;
  project_id: string;
  connection_id: string;
  canonical_root: string;
  permission_mode: string;
  trusted_access_json: string | null;
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
    trustedAccess: row.trusted_access_json
      ? (JSON.parse(row.trusted_access_json) as unknown)
      : null,
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
  title_model_json: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectChatQueuedTurnRow = {
  id: string;
  project_id: string;
  session_id: string;
  command_json: string;
  enqueue_sequence: number;
  priority: 'normal' | 'next';
  status: 'queued' | 'starting';
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
  local_notes_allow_agent_markdown_create: 0 | 1;
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
    ...(row.title_model_json ? { titleModel: JSON.parse(row.title_model_json) as unknown } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toChatQueuedTurn(row: ProjectChatQueuedTurnRow) {
  const command = JSON.parse(row.command_json) as unknown;
  if (typeof command !== 'object' || command === null || Array.isArray(command)) {
    throw new Error('chat_queue_payload_invalid');
  }
  return ProjectChatQueuedTurnSchema.parse({
    ...(command as Record<string, unknown>),
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    enqueueSequence: row.enqueue_sequence,
    priority: row.priority,
    status: row.status,
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
        ? {
            id: row.local_notes_vault_id,
            name: row.local_notes_vault_name,
            allowAgentMarkdownCreate: row.local_notes_allow_agent_markdown_create === 1,
          }
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
