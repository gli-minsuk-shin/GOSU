import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import Database from 'better-sqlite3-multiple-ciphers';
import { app, safeStorage } from 'electron';

import { LocalDatabase } from '../../src/main/local-database';
import { WorkspaceDataRecoveryError } from '../../src/main/workspace-storage-error';
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

const temporaryUserData = mkdtempSync(join(tmpdir(), 'gosu-local-db-smoke-'));
app.setPath('userData', temporaryUserData);

void app.whenReady().then(() => {
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
    database.close();

    const keyHex = safeStorage
      .decryptString(readFileSync(join(temporaryUserData, 'local-key.bin')))
      .trim();
    const legacyDatabase = new Database(join(temporaryUserData, 'gosu.db'));
    legacyDatabase.pragma(`key="x'${keyHex}'"`);
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

    const reopened = new LocalDatabase();
    reopened.open();
    invariant(reopened.loadWorkspaceState()?.revision === 2, 'workspace_restart_restore_failed');
    invariant(
      reopened
        .pendingWorkspaceChanges()
        .every((operation, index) => operation.workspaceRevision === index + 1),
      'outbox_sequence_restore_failed',
    );
    invariant(reopened.pendingWorkspaceSummary().count === 2, 'outbox_summary_restore_failed');
    invariant(
      reopened.pendingWorkspaceSummary().latestWorkspaceRevision === 2,
      'outbox_summary_revision_failed',
    );

    const duplicate = fixture(3, operationId, fixedTimestamp);
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
      afterRollback.loadWorkspaceState()?.revision === 2,
      'workspace_transaction_did_not_roll_back',
    );
    invariant(
      afterRollback.pendingWorkspaceChanges().length === 2,
      'outbox_transaction_did_not_roll_back',
    );
    invariant(
      afterRollback.pendingWorkspaceSummary().count === 2,
      'outbox_summary_did_not_roll_back',
    );

    const competing = new LocalDatabase();
    competing.open();
    const accepted = fixture(3, randomUUID(), fixedTimestamp);
    const stale = fixture(3, randomUUID(), fixedTimestamp);
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
    invariant(afterRace.loadWorkspaceState()?.revision === 3, 'workspace_race_revision_changed');
    invariant(
      afterRace.loadWorkspaceState()?.projects[0]?.id === accepted.state.projects[0]?.id,
      'workspace_race_snapshot_was_overwritten',
    );
    invariant(
      afterRace.pendingWorkspaceChanges().filter((operation) => operation.workspaceRevision === 3)
        .length === 1,
      'workspace_race_created_duplicate_revision',
    );
    invariant(afterRace.pendingWorkspaceSummary().count === 3, 'workspace_race_summary_changed');
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
    invariant(recovered.loadWorkspaceState()?.revision === 3, 'opaque_payload_changed_snapshot');
    invariant(recovered.pendingWorkspaceSummary().count === 3, 'status_reconciliation_failed');
    invariant(
      recovered.pendingWorkspaceSummary().latestWorkspaceRevision === 3,
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
    acceptedOperation.workspaceRevision = 4;
    ambiguousOrdering
      .prepare('update sync_outbox set operation_json=?,workspace_revision=4 where id=?')
      .run(JSON.stringify(acceptedOperation), accepted.operation.id);
    ambiguousOrdering.close();

    const recoveryRequired = new LocalDatabase();
    recoveryRequired.open();
    invariant(
      recoveryRequired.loadWorkspaceState()?.revision === 3,
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
