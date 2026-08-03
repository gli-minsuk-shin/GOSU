import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { app, safeStorage } from 'electron';

import type { ModelCatalog, ModelInvocation } from '@gosu/contracts';
import type {
  WorkspaceOperation,
  WorkspacePendingSummary,
  WorkspaceSnapshot,
} from '../shared/workspace-contracts';

const MAX_WORKSPACE_STATE_BYTES = 8 * 1024 * 1024;

export class LocalDatabase {
  private database: Database.Database | undefined;

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
      writeFileSync(keyPath, safeStorage.encryptString(key.toString('hex')), { mode: 0o600 });
    }
    if (key.length !== 32) throw new Error('invalid_local_database_key');
    const database = new Database(join(userData, 'gosu.db'));
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
    `);
    const outboxColumns = database.pragma('table_info(sync_outbox)') as Array<{ name: string }>;
    if (!outboxColumns.some((column) => column.name === 'workspace_revision')) {
      database.exec(
        'alter table sync_outbox add column workspace_revision integer check (workspace_revision is null or workspace_revision > 0)',
      );
    }
    const usedRevisions = new Set(
      (
        database
          .prepare(
            `select workspace_revision from sync_outbox
             where scope like 'workspace:%' and workspace_revision is not null`,
          )
          .all() as Array<{ workspace_revision: number }>
      ).map((row) => row.workspace_revision),
    );
    const legacyOperations = database
      .prepare(
        `select rowid,operation_json from sync_outbox
         where scope like 'workspace:%' and workspace_revision is null
         order by rowid asc`,
      )
      .all() as Array<{ rowid: number; operation_json: string }>;
    let nextRevision = 1;
    const backfillWorkspaceRevision = database.prepare(
      'update sync_outbox set workspace_revision=?,operation_json=? where rowid=?',
    );
    database.transaction(() => {
      for (const row of legacyOperations) {
        let parsed: Record<string, unknown> | null = null;
        try {
          const candidate = JSON.parse(row.operation_json) as unknown;
          if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
            parsed = candidate as Record<string, unknown>;
          }
        } catch {
          // Keep malformed payloads opaque. The bounded summary remains available while a future
          // delivery worker can quarantine the row instead of exposing it to the renderer.
        }
        const persistedRevision = parsed?.workspaceRevision;
        let revision =
          typeof persistedRevision === 'number' &&
          Number.isSafeInteger(persistedRevision) &&
          persistedRevision > 0 &&
          !usedRevisions.has(persistedRevision)
            ? persistedRevision
            : nextRevision;
        while (usedRevisions.has(revision)) revision += 1;
        usedRevisions.add(revision);
        nextRevision = Math.max(nextRevision, revision + 1);
        backfillWorkspaceRevision.run(
          revision,
          parsed === null
            ? row.operation_json
            : JSON.stringify({ ...parsed, workspaceRevision: revision }),
          row.rowid,
        );
      }
    })();
    database.exec(`
      insert into local_workspace_outbox_status(
        singleton_id,pending_count,latest_workspace_revision
      )
      select 1,count(*),max(workspace_revision)
      from sync_outbox
      where delivered_at is null and scope like 'workspace:%'
      on conflict(singleton_id) do update set
        pending_count=excluded.pending_count,
        latest_workspace_revision=excluded.latest_workspace_revision
    `);
    this.database = database;
    key.fill(0);
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
      database
        .prepare(
          `insert into local_workspace_state(
             singleton_id,schema_version,revision,state_json,updated_at
           ) values(1,1,?,?,?)
           on conflict(singleton_id) do update set
             schema_version=excluded.schema_version,
             revision=excluded.revision,
             state_json=excluded.state_json,
             updated_at=excluded.updated_at`,
        )
        .run(state.revision, stateJson, operation.createdAt);
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
    const rows = this.require()
      .prepare(
        `select operation_json from sync_outbox
         where delivered_at is null and scope like 'workspace:%'
         order by workspace_revision asc,created_at asc,id asc`,
      )
      .all() as Array<{ operation_json: string }>;
    return rows
      .map((row) => JSON.parse(row.operation_json) as WorkspaceOperation)
      .sort((left, right) => left.workspaceRevision - right.workspaceRevision);
  }

  pendingWorkspaceSummary(): WorkspacePendingSummary {
    const row = this.require()
      .prepare(
        `select pending_count,latest_workspace_revision
         from local_workspace_outbox_status
         where singleton_id=1`,
      )
      .get() as { pending_count: number; latest_workspace_revision: number | null } | undefined;
    return {
      count: row?.pending_count ?? 0,
      latestWorkspaceRevision: row?.latest_workspace_revision ?? null,
    };
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

  close() {
    this.database?.close();
    this.database = undefined;
  }
  private require() {
    if (!this.database) throw new Error('local_database_not_open');
    return this.database;
  }
}
