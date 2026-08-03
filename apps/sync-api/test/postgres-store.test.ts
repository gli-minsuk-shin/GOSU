import { describe, expect, it } from 'vitest';
import {
  EntityVersionConflictError,
  IdempotencyConflictError,
  PostgresSyncStore,
  ProjectAccessDeniedError,
  UnsafeHostedPayloadError,
  toSafePersistableObject,
  type PgPoolClientLike,
  type PgPoolLike,
  type PgQueryResult,
  type ProjectAccessContext,
} from '../src/postgres-store.js';

const LAB_ID = '00000000-0000-4000-8000-000000000010';
const PROJECT_ID = '00000000-0000-4000-8000-000000000020';
const ACTOR_ID = '00000000-0000-4000-8000-000000000030';
const WORK_ITEM_ID = '00000000-0000-4000-8000-000000000040';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000050';
const NOW = '2026-08-03T08:00:00.000Z';

const context: ProjectAccessContext = {
  labId: LAB_ID,
  projectId: PROJECT_ID,
  actorId: ACTOR_ID,
};

type Statement = Readonly<{ sql: string; values: readonly unknown[] }>;
type QueryHandler = (sql: string, values: readonly unknown[]) => PgQueryResult;

class FakeClient implements PgPoolClientLike {
  readonly statements: Statement[] = [];
  releases = 0;

  constructor(private readonly handler: QueryHandler) {}

  async query(text: string, values: readonly unknown[] = []): Promise<PgQueryResult> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push({ sql, values });
    if (
      sql === 'BEGIN' ||
      sql === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' ||
      sql === 'COMMIT' ||
      sql === 'ROLLBACK'
    ) {
      return emptyResult();
    }
    return this.handler(sql, values);
  }

  release(_error?: Error): void {
    this.releases += 1;
  }
}

class FakePool implements PgPoolLike {
  connections = 0;

  constructor(readonly client: FakeClient) {}

  async query(): Promise<PgQueryResult> {
    throw new Error('The adapter must use a checked-out client for scoped transactions.');
  }

  async connect(): Promise<PgPoolClientLike> {
    this.connections += 1;
    return this.client;
  }
}

function emptyResult(): PgQueryResult {
  return { rows: [], rowCount: 0 };
}

function rows(...values: PgQueryResult['rows']): PgQueryResult {
  return { rows: values, rowCount: values.length };
}

function isScopeSetup(sql: string): boolean {
  return sql.includes("set_config('gosu.lab_id'");
}

function isAuthorization(sql: string): boolean {
  return sql.includes('FROM projects AS project') && sql.includes('JOIN memberships AS membership');
}

function defaultControlQuery(sql: string): PgQueryResult | undefined {
  if (isScopeSetup(sql)) return rows({ set_config: PROJECT_ID });
  if (isAuthorization(sql)) return rows({ role: 'researcher' });
  return undefined;
}

function workItemRow(id: unknown = WORK_ITEM_ID, version: unknown = 1) {
  return {
    id,
    project_id: PROJECT_ID,
    title: 'Evaluate deterministic optimizer',
    status: 'planned',
    assignee_id: null,
    resource_type: 'experiment',
    resource_id: 'campaign-safe-fixture',
    version,
    updated_at: NOW,
  };
}

describe('PostgresSyncStore', () => {
  it('authorizes tenant and project, then commits state, audit, outbox, and idempotency atomically', async () => {
    const client = new FakeClient((sql, values) => {
      const control = defaultControlQuery(sql);
      if (control !== undefined) return control;
      if (sql.startsWith('INSERT INTO idempotency_keys')) {
        return rows({ key: IDEMPOTENCY_KEY });
      }
      if (sql.startsWith('INSERT INTO work_items')) {
        return rows(workItemRow(values[0]));
      }
      if (sql.startsWith('INSERT INTO audit_events')) return emptyResult();
      if (sql.startsWith('INSERT INTO sync_outbox')) return emptyResult();
      if (sql.startsWith('UPDATE idempotency_keys')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const pool = new FakePool(client);
    const store = new PostgresSyncStore(pool);

    const created = await store.createWorkItem(context, {
      idempotencyKey: IDEMPOTENCY_KEY,
      title: 'Evaluate deterministic optimizer',
      status: 'planned',
      resourceType: 'experiment',
      resourceId: 'campaign-safe-fixture',
    });

    expect(created).toMatchObject({ projectId: PROJECT_ID, version: 1, status: 'planned' });
    const authorization = client.statements.find((statement) => isAuthorization(statement.sql));
    expect(authorization?.values.slice(0, 3)).toEqual([PROJECT_ID, LAB_ID, ACTOR_ID]);

    const statements = client.statements.map((statement) => statement.sql);
    const stateIndex = statements.findIndex((sql) => sql.startsWith('INSERT INTO work_items'));
    const auditIndex = statements.findIndex((sql) => sql.startsWith('INSERT INTO audit_events'));
    const outboxIndex = statements.findIndex((sql) => sql.startsWith('INSERT INTO sync_outbox'));
    const completedIndex = statements.findIndex((sql) => sql.startsWith('UPDATE idempotency_keys'));
    const commitIndex = statements.indexOf('COMMIT');
    expect(stateIndex).toBeGreaterThan(statements.indexOf('BEGIN'));
    expect(auditIndex).toBeGreaterThan(stateIndex);
    expect(outboxIndex).toBeGreaterThan(auditIndex);
    expect(completedIndex).toBeGreaterThan(outboxIndex);
    expect(commitIndex).toBeGreaterThan(completedIndex);
    expect(client.releases).toBe(1);
  });

  it('returns the stored response for an identical idempotent replay without repeating writes', async () => {
    let claimed = false;
    let savedResponse: unknown;
    let stateWrites = 0;
    let auditWrites = 0;
    let outboxWrites = 0;

    const client = new FakeClient((sql, values) => {
      const control = defaultControlQuery(sql);
      if (control !== undefined) return control;
      if (sql.startsWith('INSERT INTO idempotency_keys')) {
        if (claimed) return emptyResult();
        claimed = true;
        return rows({ key: IDEMPOTENCY_KEY });
      }
      if (sql.startsWith('SELECT response FROM idempotency_keys')) {
        return rows({ response: savedResponse });
      }
      if (sql.startsWith('INSERT INTO work_items')) {
        stateWrites += 1;
        return rows(workItemRow(values[0]));
      }
      if (sql.startsWith('INSERT INTO audit_events')) {
        auditWrites += 1;
        return emptyResult();
      }
      if (sql.startsWith('INSERT INTO sync_outbox')) {
        outboxWrites += 1;
        return emptyResult();
      }
      if (sql.startsWith('UPDATE idempotency_keys')) {
        savedResponse = values[4];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = new PostgresSyncStore(new FakePool(client));
    const command = {
      idempotencyKey: IDEMPOTENCY_KEY,
      title: 'Evaluate deterministic optimizer',
      status: 'planned' as const,
      resourceType: 'experiment' as const,
      resourceId: 'campaign-safe-fixture',
    };

    const first = await store.createWorkItem(context, command);
    const replay = await store.createWorkItem(context, command);

    expect(replay).toEqual(first);
    expect({ stateWrites, auditWrites, outboxWrites }).toEqual({
      stateWrites: 1,
      auditWrites: 1,
      outboxWrites: 1,
    });
  });

  it('rejects reuse of an idempotency key for a different request', async () => {
    let savedResponse: unknown;
    let claimed = false;
    const client = new FakeClient((sql, values) => {
      const control = defaultControlQuery(sql);
      if (control !== undefined) return control;
      if (sql.startsWith('INSERT INTO idempotency_keys')) {
        if (claimed) return emptyResult();
        claimed = true;
        return rows({ key: IDEMPOTENCY_KEY });
      }
      if (sql.startsWith('SELECT response FROM idempotency_keys')) {
        return rows({ response: savedResponse });
      }
      if (sql.startsWith('INSERT INTO work_items')) return rows(workItemRow(values[0]));
      if (sql.startsWith('INSERT INTO audit_events')) return emptyResult();
      if (sql.startsWith('INSERT INTO sync_outbox')) return emptyResult();
      if (sql.startsWith('UPDATE idempotency_keys')) {
        savedResponse = values[4];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = new PostgresSyncStore(new FakePool(client));
    await store.createWorkItem(context, {
      idempotencyKey: IDEMPOTENCY_KEY,
      title: 'Evaluate deterministic optimizer',
      status: 'planned',
    });

    await expect(
      store.createWorkItem(context, {
        idempotencyKey: IDEMPOTENCY_KEY,
        title: 'A different request title',
        status: 'planned',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(client.statements.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('surfaces the current entity version and rolls back stale updates', async () => {
    const client = new FakeClient((sql) => {
      const control = defaultControlQuery(sql);
      if (control !== undefined) return control;
      if (sql.startsWith('INSERT INTO idempotency_keys')) {
        return rows({ key: IDEMPOTENCY_KEY });
      }
      if (sql.startsWith('UPDATE work_items')) return emptyResult();
      if (sql.startsWith('SELECT version FROM work_items')) return rows({ version: '4' });
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = new PostgresSyncStore(new FakePool(client));

    const error = await store
      .updateWorkItem(context, {
        idempotencyKey: IDEMPOTENCY_KEY,
        workItemId: WORK_ITEM_ID,
        expectedVersion: 3,
        status: 'review',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EntityVersionConflictError);
    expect(error).toMatchObject({ expectedVersion: 3, currentVersion: 4 });
    expect(client.statements.at(-1)?.sql).toBe('ROLLBACK');
    expect(client.statements.some((statement) => statement.sql.includes('sync_outbox'))).toBe(
      false,
    );
  });

  it('fails closed when the actor is not a member of the requested tenant and project', async () => {
    const client = new FakeClient((sql) => {
      if (isScopeSetup(sql)) return emptyResult();
      if (isAuthorization(sql)) return emptyResult();
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = new PostgresSyncStore(new FakePool(client));

    await expect(store.listWorkItems(context)).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    expect(client.statements.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('rolls back the state write when the transactional outbox insert fails', async () => {
    const client = new FakeClient((sql, values) => {
      const control = defaultControlQuery(sql);
      if (control !== undefined) return control;
      if (sql.startsWith('INSERT INTO idempotency_keys')) {
        return rows({ key: IDEMPOTENCY_KEY });
      }
      if (sql.startsWith('INSERT INTO work_items')) return rows(workItemRow(values[0]));
      if (sql.startsWith('INSERT INTO audit_events')) return emptyResult();
      if (sql.startsWith('INSERT INTO sync_outbox')) throw new Error('simulated outbox failure');
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = new PostgresSyncStore(new FakePool(client));

    await expect(
      store.createWorkItem(context, {
        idempotencyKey: IDEMPOTENCY_KEY,
        title: 'Evaluate deterministic optimizer',
        status: 'planned',
      }),
    ).rejects.toThrow('simulated outbox failure');
    expect(client.statements.at(-1)?.sql).toBe('ROLLBACK');
    expect(client.statements.some((statement) => statement.sql === 'COMMIT')).toBe(false);
  });

  it.each([
    ['raw log', { rawLog: 'runner output' }],
    ['raw metric point', { metricPoint: { step: 7, value: 0.9 } }],
    ['tool payload', { toolPayload: { command: 'read' } }],
    ['file body', { fileBody: 'private manuscript source' }],
    ['API key field', { apiKey: 'definitely-not-persistable' }],
    ['serialized tool payload', { content: '{"tool_payload":{"command":"read"}}' }],
  ])('rejects local-only %s fields before SQL', (_label, payload) => {
    expect(() => toSafePersistableObject(payload)).toThrow(UnsafeHostedPayloadError);
  });

  it('rejects credential-like text in visible chat before acquiring a database connection', async () => {
    const client = new FakeClient((sql) => {
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const pool = new FakePool(client);
    const store = new PostgresSyncStore(pool);

    await expect(
      store.appendVisibleChat(context, {
        idempotencyKey: IDEMPOTENCY_KEY,
        role: 'user',
        content: 'Authorization: Bearer fixturecredentialvalue1234567890',
      }),
    ).rejects.toBeInstanceOf(UnsafeHostedPayloadError);
    expect(pool.connections).toBe(0);
  });

  it('records immutable, versioned human approval with audit and outbox metadata', async () => {
    const client = new FakeClient((sql, values) => {
      if (isScopeSetup(sql)) return emptyResult();
      if (isAuthorization(sql)) return rows({ role: 'reviewer' });
      if (sql.startsWith('INSERT INTO idempotency_keys')) {
        return rows({ key: IDEMPOTENCY_KEY });
      }
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return emptyResult();
      if (sql.startsWith('SELECT version FROM approval_records')) return rows({ version: '1' });
      if (sql.startsWith('INSERT INTO approval_records')) {
        return rows({
          id: values[0],
          project_id: PROJECT_ID,
          actor_id: ACTOR_ID,
          subject_type: 'manuscript_revision',
          subject_id: 'revision-safe-fixture',
          subject_version: '7',
          decision: 'approved',
          rationale: 'Evidence and citations verified.',
          version: '2',
          created_at: NOW,
        });
      }
      if (sql.startsWith('INSERT INTO audit_events')) return emptyResult();
      if (sql.startsWith('INSERT INTO sync_outbox')) return emptyResult();
      if (sql.startsWith('UPDATE idempotency_keys')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = new PostgresSyncStore(new FakePool(client));

    const approval = await store.recordApproval(context, {
      idempotencyKey: IDEMPOTENCY_KEY,
      subjectType: 'manuscript_revision',
      subjectId: 'revision-safe-fixture',
      subjectVersion: 7,
      expectedVersion: 1,
      decision: 'approved',
      rationale: 'Evidence and citations verified.',
    });

    expect(approval).toMatchObject({ version: 2, subjectVersion: 7, decision: 'approved' });
    const outbox = client.statements.find((statement) =>
      statement.sql.startsWith('INSERT INTO sync_outbox'),
    );
    expect(JSON.stringify(outbox?.values)).not.toContain('Evidence and citations verified.');
    expect(client.statements.at(-1)?.sql).toBe('COMMIT');
  });
});
