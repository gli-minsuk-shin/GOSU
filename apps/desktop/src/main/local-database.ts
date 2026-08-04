import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { app, safeStorage } from 'electron';

import type { ModelCatalog, ModelInvocation } from '@gosu/contracts';
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
import type {
  WorkspaceOperation,
  WorkspacePendingSummary,
  WorkspaceSnapshot,
} from '../shared/workspace-contracts';
import { WorkspaceDataRecoveryError } from './workspace-storage-error';

const MAX_WORKSPACE_STATE_BYTES = 8 * 1024 * 1024;
const INTERRUPTED_CHAT_ATTEMPT_RECEIPT =
  'GOSU closed before this Codex turn finished. Retry when ready.';
const PROJECT_CHAT_SESSIONS_MIGRATION = 'project-chat-sessions-v1';
const DEFAULT_PROJECT_CHAT_SESSION_TITLE = 'Project chat';

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
         collaboration_mode_id,personality,response_verbosity,context_scope,profile_version,
         instruction_revision_id,prompt_provenance_json,status,error_code,created_at,updated_at
       ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      attempt.contextScope ?? null,
      attempt.profileVersion ?? null,
      attempt.instructionRevisionId ?? null,
      attempt.promptProvenance ? JSON.stringify(attempt.promptProvenance) : null,
      attempt.status,
      attempt.errorCode ?? null,
      attempt.createdAt,
      attempt.updatedAt,
    );
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
     set status='interrupted',error_code='application_interrupted',updated_at=?
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
        version integer not null check (version > 0),
        created_at text not null,
        updated_at text not null
      );
      create index if not exists ssh_connections_by_label
        on ssh_connections(label,id);
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
      database
        .prepare(
          `update project_chat_actions
           set status='failed',error_code='application_interrupted',updated_at=?
           where status='applying'`,
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
                p.collaboration_mode_id,p.personality,p.response_verbosity,p.context_scope,
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
               personality,response_verbosity,context_scope,
               local_notes_vault_id,local_notes_vault_name,
               instruction_revision_id,created_at,updated_at
             ) values(?,?,?,?,?,?,?,?,?,?,?,?,?)
             on conflict(project_id) do update set
               version=excluded.version,
               harness_mode=excluded.harness_mode,
               response_depth=excluded.response_depth,
               collaboration_mode_id=excluded.collaboration_mode_id,
               personality=excluded.personality,
               response_verbosity=excluded.response_verbosity,
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
           thread_id=?,turn_id=?,model_json=?,status='running',error_code=null,updated_at=?
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
                  collaboration_mode_id,personality,response_verbosity,context_scope,profile_version,
                  instruction_revision_id,prompt_provenance_json,status,error_code,created_at,updated_at
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
             thread_id=?,turn_id=?,model_json=?,status=?,error_code=?,updated_at=?
           where project_id=? and id=? and user_message_id=? and status in ('starting','running')`,
        )
        .run(
          terminal.threadId ?? null,
          terminal.turnId ?? null,
          terminal.model ? JSON.stringify(terminal.model) : null,
          terminal.status,
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
                a.response_verbosity,a.context_scope,a.profile_version,a.instruction_revision_id,
                a.prompt_provenance_json,a.status,a.error_code,a.created_at,a.updated_at
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
                  a.response_verbosity,a.context_scope,a.profile_version,a.instruction_revision_id,
                  a.prompt_provenance_json,a.status,a.error_code,a.created_at,a.updated_at,sm.ordinal
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

  listSshConnections(): SshConnectionProfile[] {
    const rows = this.require()
      .prepare(
        `select id,schema_version,label,host_alias,version,created_at,updated_at
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
           id,schema_version,label,host_alias,version,created_at,updated_at
         ) values(?,?,?,?,?,?,?)`,
      )
      .run(
        profile.id,
        profile.schemaVersion,
        profile.label,
        profile.hostAlias,
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
           schema_version=?,label=?,host_alias=?,version=?,updated_at=?
         where id=? and version=?`,
      )
      .run(
        profile.schemaVersion,
        profile.label,
        profile.hostAlias,
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
    ...(row.context_scope ? { contextScope: row.context_scope } : {}),
    ...(row.profile_version === null ? {} : { profileVersion: row.profile_version }),
    ...(row.profile_version === null ? {} : { instructionRevisionId: row.instruction_revision_id }),
    ...(row.prompt_provenance_json
      ? { promptProvenance: JSON.parse(row.prompt_provenance_json) as unknown }
      : {}),
    status: row.status,
    ...(row.error_code ? { errorCode: row.error_code } : {}),
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
