import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import Database from 'better-sqlite3-multiple-ciphers';
import { app, safeStorage } from 'electron';

import { LocalDatabase } from '../../src/main/local-database';
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
      .prepare("select id,operation_json from sync_outbox where scope like 'workspace:%'")
      .all() as Array<{ id: string; operation_json: string }>;
    const makeLegacy = legacyDatabase.prepare(
      'update sync_outbox set workspace_revision=null,operation_json=? where id=?',
    );
    legacyDatabase.transaction(() => {
      for (const row of legacyRows) {
        const operation = JSON.parse(row.operation_json) as Record<string, unknown>;
        delete operation.workspaceRevision;
        makeLegacy.run(JSON.stringify(operation), row.id);
      }
      legacyDatabase
        .prepare(
          'update local_workspace_outbox_status set latest_workspace_revision=null where singleton_id=1',
        )
        .run();
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
    afterRollback.close();

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
