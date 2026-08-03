import { createHash, randomUUID } from 'node:crypto';

export type ProjectRole = 'owner' | 'project_lead' | 'researcher' | 'reviewer' | 'viewer';
export type TaskStatus = 'backlog' | 'planned' | 'in_progress' | 'review' | 'done';
export type WorkItemResourceType = 'experiment' | 'revision' | 'review' | 'reference';
export type ApprovalSubjectType =
  'objective' | 'campaign' | 'manuscript_revision' | 'overleaf_export' | 'work_item';
export type ApprovalDecision = 'approved' | 'rejected' | 'changes_requested';

export type PersistableScalar = null | boolean | number | string;
export type PersistableValue = PersistableScalar | readonly PersistableValue[] | PersistableObject;
export type PersistableObject = { readonly [key: string]: PersistableValue };

declare const safePersistencePayload: unique symbol;
export type SafePersistableObject = PersistableObject & {
  readonly [safePersistencePayload]: true;
};

export type ProjectAccessContext = Readonly<{
  labId: string;
  projectId: string;
  actorId: string;
}>;

export type PgRow = Record<string, unknown>;

export interface PgQueryResult {
  readonly rows: readonly PgRow[];
  readonly rowCount: number | null;
}

/** A deliberately small structural interface implemented by pg.PoolClient-compatible wrappers. */
export interface PgPoolClientLike {
  query(text: string, values?: readonly unknown[]): Promise<PgQueryResult>;
  release(error?: Error): void;
}

/** A deliberately small structural interface implemented by pg.Pool-compatible wrappers. */
export interface PgPoolLike {
  query(text: string, values?: readonly unknown[]): Promise<PgQueryResult>;
  connect(): Promise<PgPoolClientLike>;
}

export type WorkItemRecord = Readonly<{
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  assigneeId?: string;
  resourceType?: WorkItemResourceType;
  resourceId?: string;
  version: number;
  updatedAt: string;
}>;

export type VisibleChatRecord = Readonly<{
  id: string;
  projectId: string;
  actorId: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
  createdAt: string;
}>;

export type ApprovalRecord = Readonly<{
  id: string;
  projectId: string;
  actorId: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  subjectVersion: number;
  decision: ApprovalDecision;
  rationale?: string;
  version: number;
  createdAt: string;
}>;

export type AuditRecord = Readonly<{
  id: string;
  labId: string;
  projectId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  entityVersion: number;
  details: PersistableObject;
  occurredAt: string;
}>;

export type CreateWorkItemCommand = Readonly<{
  idempotencyKey: string;
  title: string;
  status?: TaskStatus;
  assigneeId?: string;
  resourceType?: WorkItemResourceType;
  resourceId?: string;
}>;

export type UpdateWorkItemCommand = Readonly<{
  idempotencyKey: string;
  workItemId: string;
  expectedVersion: number;
  title?: string;
  status?: TaskStatus;
  assigneeId?: string | null;
}>;

export type AppendVisibleChatCommand = Readonly<{
  idempotencyKey: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
}>;

export type RecordApprovalCommand = Readonly<{
  idempotencyKey: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  subjectVersion: number;
  expectedVersion: number;
  decision: ApprovalDecision;
  rationale?: string;
}>;

export class PostgresStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PostgresStoreError';
  }
}

export class ProjectAccessDeniedError extends PostgresStoreError {
  constructor() {
    super('project_access_denied', 'The actor is not authorized for this lab and project.');
    this.name = 'ProjectAccessDeniedError';
  }
}

export class EntityNotFoundError extends PostgresStoreError {
  constructor(readonly entity: string) {
    super('entity_not_found', `${entity} was not found in the authorized project.`);
    this.name = 'EntityNotFoundError';
  }
}

export class EntityVersionConflictError extends PostgresStoreError {
  constructor(
    readonly entity: string,
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super(
      'version_conflict',
      `${entity} expected version ${expectedVersion}, but the current version is ${currentVersion}.`,
    );
    this.name = 'EntityVersionConflictError';
  }
}

export class IdempotencyConflictError extends PostgresStoreError {
  constructor() {
    super(
      'idempotency_key_reused',
      'The idempotency key was already used with a different request payload.',
    );
    this.name = 'IdempotencyConflictError';
  }
}

export class UnsafeHostedPayloadError extends PostgresStoreError {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super('unsafe_hosted_payload', `Hosted persistence rejected ${path}: ${reason}.`);
    this.name = 'UnsafeHostedPayloadError';
  }
}

export class InvalidStoreInputError extends PostgresStoreError {
  constructor(field: string, reason: string) {
    super('invalid_store_input', `${field} ${reason}.`);
    this.name = 'InvalidStoreInputError';
  }
}

export class StoreInvariantError extends PostgresStoreError {
  constructor(message: string) {
    super('store_invariant_failed', message);
    this.name = 'StoreInvariantError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_HOSTED_PAYLOAD_BYTES = 128 * 1024;
const MAX_HOSTED_PAYLOAD_DEPTH = 16;

const FORBIDDEN_PERSISTED_FIELDS = new Set([
  'apikey',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'credential',
  'credentials',
  'filebody',
  'filecontent',
  'filecontents',
  'log',
  'logchunk',
  'logs',
  'metricpoint',
  'metricpoints',
  'openaiapikey',
  'password',
  'privatekey',
  'rawlog',
  'rawlogs',
  'rawmetric',
  'rawmetrics',
  'secret',
  'sourcebody',
  'toolcall',
  'toolinput',
  'tooloutput',
  'toolpayload',
  'toolpayloads',
  'toolresult',
]);

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\b(?:gh[pousr]_|github_pat_|sk-(?:proj-)?|xox[baprs]-)[0-9A-Za-z_-]{12,}\b/,
  /\bBearer\s+[0-9A-Za-z._~+/-]{16,}/i,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|secret)\b\s*(?:is|[:=])\s*["']?[0-9A-Za-z+/_=-]{12,}/i,
];
const SERIALIZED_LOCAL_ONLY_PATTERNS: readonly RegExp[] = [
  /["']?(?:raw[_ -]?logs?|raw[_ -]?metrics?|metric[_ -]?points?|tool[_ -]?(?:payload|input|output|result)|file[_ -]?(?:body|content))["']?\s*:/i,
];

const READ_ROLES: readonly ProjectRole[] = [
  'owner',
  'project_lead',
  'researcher',
  'reviewer',
  'viewer',
];
const WRITE_ROLES: readonly ProjectRole[] = ['owner', 'project_lead', 'researcher'];
const APPROVAL_ROLES: readonly ProjectRole[] = ['owner', 'project_lead', 'reviewer'];
const AUDIT_READ_ROLES: readonly ProjectRole[] = ['owner', 'project_lead'];

const NO_IDEMPOTENT_REPLAY = Symbol('no-idempotent-replay');

type MutationAudit = Readonly<{
  action: string;
  entityType: string;
  entityId: string;
  entityVersion: number;
  details: SafePersistableObject;
}>;

type MutationOutbox = Readonly<{
  eventType: string;
  entityVersion: number;
  payload: SafePersistableObject;
}>;

type MutationResult<T> = Readonly<{
  value: T;
  audit: MutationAudit;
  outbox: MutationOutbox;
}>;

type IdempotencyEnvelope = Readonly<{
  schemaVersion: 1;
  requestHash: string;
  state: 'pending' | 'completed';
  value?: PersistableValue;
}>;

export function toSafePersistableObject(value: unknown): SafePersistableObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnsafeHostedPayloadError('$', 'the payload must be a plain object');
  }

  inspectPersistableValue(value, '$', new Set<object>(), 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_HOSTED_PAYLOAD_BYTES) {
    throw new UnsafeHostedPayloadError('$', 'the payload exceeds the hosted size limit');
  }
  return value as SafePersistableObject;
}

function inspectPersistableValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  depth: number,
): void {
  if (depth > MAX_HOSTED_PAYLOAD_DEPTH) {
    throw new UnsafeHostedPayloadError(path, 'the payload is nested too deeply');
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new UnsafeHostedPayloadError(path, 'numbers must be finite');
    }
    return;
  }
  if (typeof value === 'string') {
    if (SERIALIZED_LOCAL_ONLY_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new UnsafeHostedPayloadError(path, 'the value embeds a local-only payload');
    }
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new UnsafeHostedPayloadError(path, 'the value resembles a credential or private key');
    }
    return;
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new UnsafeHostedPayloadError(path, `values of type ${typeof value} are not JSON-safe`);
  }
  if (ancestors.has(value)) {
    throw new UnsafeHostedPayloadError(path, 'cyclic objects are not persistable');
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    throw new UnsafeHostedPayloadError(path, 'only plain objects and arrays are persistable');
  }

  ancestors.add(value);
  if (isArray) {
    value.forEach((item, index) => {
      inspectPersistableValue(item, `${path}[${index}]`, ancestors, depth + 1);
    });
  } else {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN_PERSISTED_FIELDS.has(normalizedKey)) {
        throw new UnsafeHostedPayloadError(`${path}.${key}`, 'this field is local-only');
      }
      inspectPersistableValue(child, `${path}.${key}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

export class PostgresSyncStore {
  constructor(private readonly pool: PgPoolLike) {}

  async listWorkItems(context: ProjectAccessContext): Promise<readonly WorkItemRecord[]> {
    return this.withAuthorizedProject(context, READ_ROLES, async (client) => {
      const result = await client.query(
        `SELECT id, project_id, title, status, assignee_id, resource_type, resource_id,
                version, updated_at
           FROM work_items
          WHERE project_id = $1
          ORDER BY updated_at DESC, id ASC`,
        [context.projectId],
      );
      return result.rows.map(mapWorkItemRow);
    });
  }

  async createWorkItem(
    context: ProjectAccessContext,
    command: CreateWorkItemCommand,
  ): Promise<WorkItemRecord> {
    assertText(command.title, 'title', 1, 240);
    assertTaskStatus(command.status ?? 'backlog');
    if (command.assigneeId !== undefined) assertUuid(command.assigneeId, 'assigneeId');
    if (command.resourceType !== undefined) assertWorkItemResourceType(command.resourceType);
    if (command.resourceId !== undefined) assertText(command.resourceId, 'resourceId', 1, 500);

    const request = toSafePersistableObject({
      title: command.title,
      status: command.status ?? 'backlog',
      ...(command.assigneeId === undefined ? {} : { assigneeId: command.assigneeId }),
      ...(command.resourceType === undefined ? {} : { resourceType: command.resourceType }),
      ...(command.resourceId === undefined ? {} : { resourceId: command.resourceId }),
    });

    return this.runMutation(
      context,
      WRITE_ROLES,
      'work-item.create',
      command.idempotencyKey,
      request,
      async (client) => {
        const id = randomUUID();
        const result = await client.query(
          `INSERT INTO work_items
             (id, project_id, title, status, assignee_id, resource_type, resource_id,
              version, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, now())
           RETURNING id, project_id, title, status, assignee_id, resource_type, resource_id,
                     version, updated_at`,
          [
            id,
            context.projectId,
            command.title,
            command.status ?? 'backlog',
            command.assigneeId ?? null,
            command.resourceType ?? null,
            command.resourceId ?? null,
          ],
        );
        const row = requireReturnedRow(result, 'work item insert');
        const value = mapWorkItemRow(row);
        return {
          value,
          audit: {
            action: 'work_item.created',
            entityType: 'work_item',
            entityId: value.id,
            entityVersion: value.version,
            details: toSafePersistableObject({ status: value.status }),
          },
          outbox: {
            eventType: 'task.created',
            entityVersion: value.version,
            payload: toSafePersistableObject({ taskId: value.id, status: value.status }),
          },
        };
      },
    );
  }

  async updateWorkItem(
    context: ProjectAccessContext,
    command: UpdateWorkItemCommand,
  ): Promise<WorkItemRecord> {
    assertUuid(command.workItemId, 'workItemId');
    assertVersion(command.expectedVersion, 'expectedVersion');
    if (
      command.title === undefined &&
      command.status === undefined &&
      command.assigneeId === undefined
    ) {
      throw new InvalidStoreInputError('update', 'must change at least one field');
    }
    if (command.title !== undefined) assertText(command.title, 'title', 1, 240);
    if (command.status !== undefined) assertTaskStatus(command.status);
    if (command.assigneeId !== undefined && command.assigneeId !== null) {
      assertUuid(command.assigneeId, 'assigneeId');
    }

    const changedFields = [
      ...(command.title === undefined ? [] : ['title']),
      ...(command.status === undefined ? [] : ['status']),
      ...(command.assigneeId === undefined ? [] : ['assigneeId']),
    ];
    const request = toSafePersistableObject({
      workItemId: command.workItemId,
      expectedVersion: command.expectedVersion,
      changedFields,
      ...(command.title === undefined ? {} : { title: command.title }),
      ...(command.status === undefined ? {} : { status: command.status }),
      ...(command.assigneeId === undefined ? {} : { assigneeId: command.assigneeId }),
    });

    return this.runMutation(
      context,
      WRITE_ROLES,
      'work-item.update',
      command.idempotencyKey,
      request,
      async (client) => {
        const result = await client.query(
          `UPDATE work_items
              SET title = COALESCE($4, title),
                  status = COALESCE($5, status),
                  assignee_id = CASE WHEN $6::boolean THEN $7::uuid ELSE assignee_id END,
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1
              AND project_id = $2
              AND version = $3
          RETURNING id, project_id, title, status, assignee_id, resource_type, resource_id,
                    version, updated_at`,
          [
            command.workItemId,
            context.projectId,
            command.expectedVersion,
            command.title ?? null,
            command.status ?? null,
            command.assigneeId !== undefined,
            command.assigneeId ?? null,
          ],
        );

        if (result.rowCount !== 1) {
          const current = await client.query(
            `SELECT version
               FROM work_items
              WHERE id = $1 AND project_id = $2`,
            [command.workItemId, context.projectId],
          );
          if (current.rowCount !== 1) throw new EntityNotFoundError('work_item');
          throw new EntityVersionConflictError(
            'work_item',
            command.expectedVersion,
            asVersion(current.rows[0]?.version, 'work_items.version'),
          );
        }

        const value = mapWorkItemRow(requireReturnedRow(result, 'work item update'));
        return {
          value,
          audit: {
            action: 'work_item.updated',
            entityType: 'work_item',
            entityId: value.id,
            entityVersion: value.version,
            details: toSafePersistableObject({ changedFields, status: value.status }),
          },
          outbox: {
            eventType: 'task.updated',
            entityVersion: value.version,
            payload: toSafePersistableObject({ taskId: value.id, status: value.status }),
          },
        };
      },
    );
  }

  async listVisibleChat(context: ProjectAccessContext): Promise<readonly VisibleChatRecord[]> {
    return this.withAuthorizedProject(context, READ_ROLES, async (client) => {
      const result = await client.query(
        `SELECT id, project_id, actor_id, role, content, model_id, created_at
           FROM visible_chat_messages
          WHERE project_id = $1
          ORDER BY created_at ASC, id ASC`,
        [context.projectId],
      );
      return result.rows.map(mapVisibleChatRow);
    });
  }

  async appendVisibleChat(
    context: ProjectAccessContext,
    command: AppendVisibleChatCommand,
  ): Promise<VisibleChatRecord> {
    if (command.role !== 'user' && command.role !== 'assistant') {
      throw new InvalidStoreInputError('role', 'must be user or assistant');
    }
    assertText(command.content, 'content', 1, 100_000);
    if (command.modelId !== undefined) assertText(command.modelId, 'modelId', 1, 200);

    const request = toSafePersistableObject({
      role: command.role,
      content: command.content,
      ...(command.modelId === undefined ? {} : { modelId: command.modelId }),
    });

    return this.runMutation(
      context,
      WRITE_ROLES,
      'visible-chat.append',
      command.idempotencyKey,
      request,
      async (client) => {
        const result = await client.query(
          `INSERT INTO visible_chat_messages
             (id, project_id, actor_id, role, content, model_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           RETURNING id, project_id, actor_id, role, content, model_id, created_at`,
          [
            randomUUID(),
            context.projectId,
            context.actorId,
            command.role,
            command.content,
            command.modelId ?? null,
          ],
        );
        const value = mapVisibleChatRow(requireReturnedRow(result, 'visible chat insert'));
        const publicMetadata = toSafePersistableObject({
          messageId: value.id,
          role: value.role,
          ...(value.modelId === undefined ? {} : { modelId: value.modelId }),
        });
        return {
          value,
          audit: {
            action: 'visible_chat.appended',
            entityType: 'visible_chat_message',
            entityId: value.id,
            entityVersion: 1,
            details: publicMetadata,
          },
          outbox: {
            eventType: 'chat.message.appended',
            entityVersion: 1,
            payload: publicMetadata,
          },
        };
      },
    );
  }

  async listApprovals(context: ProjectAccessContext): Promise<readonly ApprovalRecord[]> {
    return this.withAuthorizedProject(context, READ_ROLES, async (client) => {
      const result = await client.query(
        `SELECT id, project_id, actor_id, subject_type, subject_id, subject_version,
                decision, rationale, version, created_at
           FROM approval_records
          WHERE lab_id = $1 AND project_id = $2
          ORDER BY created_at DESC, id DESC`,
        [context.labId, context.projectId],
      );
      return result.rows.map(mapApprovalRow);
    });
  }

  async recordApproval(
    context: ProjectAccessContext,
    command: RecordApprovalCommand,
  ): Promise<ApprovalRecord> {
    assertApprovalSubjectType(command.subjectType);
    assertText(command.subjectId, 'subjectId', 1, 500);
    assertPositiveVersion(command.subjectVersion, 'subjectVersion');
    assertVersion(command.expectedVersion, 'expectedVersion');
    assertApprovalDecision(command.decision);
    if (command.rationale !== undefined) assertText(command.rationale, 'rationale', 1, 20_000);

    const request = toSafePersistableObject({
      subjectType: command.subjectType,
      subjectId: command.subjectId,
      subjectVersion: command.subjectVersion,
      expectedVersion: command.expectedVersion,
      decision: command.decision,
      ...(command.rationale === undefined ? {} : { rationale: command.rationale }),
    });

    return this.runMutation(
      context,
      APPROVAL_ROLES,
      'approval.record',
      command.idempotencyKey,
      request,
      async (client) => {
        const subjectKey = `${context.labId}:${context.projectId}:${command.subjectType}:${command.subjectId}`;
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [subjectKey]);
        const latest = await client.query(
          `SELECT version
             FROM approval_records
            WHERE lab_id = $1
              AND project_id = $2
              AND subject_type = $3
              AND subject_id = $4
            ORDER BY version DESC
            LIMIT 1
            FOR UPDATE`,
          [context.labId, context.projectId, command.subjectType, command.subjectId],
        );
        const currentVersion =
          latest.rowCount === 1
            ? asVersion(latest.rows[0]?.version, 'approval_records.version')
            : 0;
        if (currentVersion !== command.expectedVersion) {
          throw new EntityVersionConflictError(
            `approval:${command.subjectType}:${command.subjectId}`,
            command.expectedVersion,
            currentVersion,
          );
        }

        const result = await client.query(
          `INSERT INTO approval_records
             (id, lab_id, project_id, actor_id, subject_type, subject_id, subject_version,
              decision, rationale, version, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           RETURNING id, project_id, actor_id, subject_type, subject_id, subject_version,
                     decision, rationale, version, created_at`,
          [
            randomUUID(),
            context.labId,
            context.projectId,
            context.actorId,
            command.subjectType,
            command.subjectId,
            command.subjectVersion,
            command.decision,
            command.rationale ?? null,
            currentVersion + 1,
          ],
        );
        const value = mapApprovalRow(requireReturnedRow(result, 'approval insert'));
        const publicMetadata = toSafePersistableObject({
          approvalId: value.id,
          subjectType: value.subjectType,
          subjectId: value.subjectId,
          subjectVersion: value.subjectVersion,
          decision: value.decision,
        });
        return {
          value,
          audit: {
            action: 'approval.recorded',
            entityType: 'approval',
            entityId: value.id,
            entityVersion: value.version,
            details: publicMetadata,
          },
          outbox: {
            eventType: 'approval.recorded',
            entityVersion: value.version,
            payload: publicMetadata,
          },
        };
      },
    );
  }

  async listAudit(
    context: ProjectAccessContext,
    options: Readonly<{ limit?: number }> = {},
  ): Promise<readonly AuditRecord[]> {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new InvalidStoreInputError('limit', 'must be an integer between 1 and 500');
    }
    return this.withAuthorizedProject(context, AUDIT_READ_ROLES, async (client) => {
      const result = await client.query(
        `SELECT id, lab_id, project_id, actor_id, action, entity_type, entity_id,
                entity_version, details, occurred_at
           FROM audit_events
          WHERE lab_id = $1 AND project_id = $2
          ORDER BY occurred_at DESC, id DESC
          LIMIT $3`,
        [context.labId, context.projectId, limit],
      );
      return result.rows.map(mapAuditRow);
    });
  }

  private async runMutation<T extends PersistableValue>(
    context: ProjectAccessContext,
    allowedRoles: readonly ProjectRole[],
    operation: string,
    idempotencyKey: string,
    request: SafePersistableObject,
    mutate: (client: PgPoolClientLike) => Promise<MutationResult<T>>,
  ): Promise<T> {
    assertUuid(idempotencyKey, 'idempotencyKey');
    const requestHash = createHash('sha256').update(stableJson(request)).digest('hex');
    const idempotencyScope = [
      'gosu',
      'v1',
      operation,
      context.labId,
      context.projectId,
      context.actorId,
    ].join(':');

    return this.withAuthorizedProject(context, allowedRoles, async (client) => {
      const replay = await this.claimIdempotency(
        client,
        context,
        idempotencyScope,
        idempotencyKey,
        requestHash,
      );
      if (replay !== NO_IDEMPOTENT_REPLAY) return replay as T;

      const result = await mutate(client);
      toSafePersistableObject({ value: result.value });
      await this.insertAudit(client, context, result.audit);
      await this.insertOutbox(client, context, result.outbox);
      await this.completeIdempotency(
        client,
        context,
        idempotencyScope,
        idempotencyKey,
        requestHash,
        result.value,
      );
      return result.value;
    });
  }

  private async claimIdempotency(
    client: PgPoolClientLike,
    context: ProjectAccessContext,
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<PersistableValue | typeof NO_IDEMPOTENT_REPLAY> {
    const pending: IdempotencyEnvelope = {
      schemaVersion: 1,
      requestHash,
      state: 'pending',
    };
    const claim = await client.query(
      `INSERT INTO idempotency_keys
         (lab_id, project_id, actor_id, scope, key, response, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
       ON CONFLICT (lab_id, project_id, scope, key) DO NOTHING
       RETURNING key`,
      [context.labId, context.projectId, context.actorId, scope, key, pending],
    );
    if (claim.rowCount === 1) return NO_IDEMPOTENT_REPLAY;

    const existing = await client.query(
      `SELECT response
         FROM idempotency_keys
        WHERE lab_id = $1 AND project_id = $2 AND scope = $3 AND key = $4`,
      [context.labId, context.projectId, scope, key],
    );
    const row = requireReturnedRow(existing, 'idempotency replay');
    const envelope = parseIdempotencyEnvelope(row.response);
    if (envelope.requestHash !== requestHash) throw new IdempotencyConflictError();
    if (envelope.state !== 'completed' || envelope.value === undefined) {
      throw new StoreInvariantError('An idempotency record was visible before completion.');
    }
    return envelope.value;
  }

  private async completeIdempotency(
    client: PgPoolClientLike,
    context: ProjectAccessContext,
    scope: string,
    key: string,
    requestHash: string,
    value: PersistableValue,
  ): Promise<void> {
    const completed: IdempotencyEnvelope = {
      schemaVersion: 1,
      requestHash,
      state: 'completed',
      value,
    };
    const result = await client.query(
      `UPDATE idempotency_keys
          SET response = $5::jsonb
        WHERE lab_id = $1 AND project_id = $2 AND scope = $3 AND key = $4`,
      [context.labId, context.projectId, scope, key, completed],
    );
    if (result.rowCount !== 1) {
      throw new StoreInvariantError('The claimed idempotency record could not be completed.');
    }
  }

  private async insertAudit(
    client: PgPoolClientLike,
    context: ProjectAccessContext,
    audit: MutationAudit,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events
         (id, lab_id, project_id, actor_id, action, entity_type, entity_id,
          entity_version, details, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())`,
      [
        randomUUID(),
        context.labId,
        context.projectId,
        context.actorId,
        audit.action,
        audit.entityType,
        audit.entityId,
        audit.entityVersion,
        audit.details,
      ],
    );
  }

  private async insertOutbox(
    client: PgPoolClientLike,
    context: ProjectAccessContext,
    outbox: MutationOutbox,
  ): Promise<void> {
    await client.query(
      `INSERT INTO sync_outbox
         (id, lab_id, project_id, actor_id, event_type, schema_version,
          entity_version, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7::jsonb, now())`,
      [
        randomUUID(),
        context.labId,
        context.projectId,
        context.actorId,
        outbox.eventType,
        outbox.entityVersion,
        outbox.payload,
      ],
    );
  }

  private async withAuthorizedProject<T>(
    context: ProjectAccessContext,
    allowedRoles: readonly ProjectRole[],
    operation: (client: PgPoolClientLike, role: ProjectRole) => Promise<T>,
  ): Promise<T> {
    assertAccessContext(context);
    const client = await this.pool.connect();
    let began = false;
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      began = true;
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await client.query(
        `SELECT set_config('gosu.lab_id', $1, true),
                set_config('gosu.actor_id', $2, true),
                set_config('gosu.project_id', $3, true)`,
        [context.labId, context.actorId, context.projectId],
      );
      const authorization = await client.query(
        `SELECT membership.role
           FROM projects AS project
           JOIN memberships AS membership ON membership.lab_id = project.lab_id
          WHERE project.id = $1
            AND project.lab_id = $2
            AND membership.identity_id = $3
            AND membership.role = ANY($4::text[])
          FOR SHARE OF project`,
        [context.projectId, context.labId, context.actorId, allowedRoles],
      );
      if (authorization.rowCount !== 1) throw new ProjectAccessDeniedError();
      const role = asProjectRole(authorization.rows[0]?.role);
      const value = await operation(client, role);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      if (began) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          releaseError =
            rollbackError instanceof Error
              ? rollbackError
              : new Error('The PostgreSQL transaction could not be rolled back.');
        }
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }
}

function assertAccessContext(context: ProjectAccessContext): void {
  assertUuid(context.labId, 'labId');
  assertUuid(context.projectId, 'projectId');
  assertUuid(context.actorId, 'actorId');
}

function assertUuid(value: string, field: string): void {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new InvalidStoreInputError(field, 'must be a UUID');
  }
}

function assertVersion(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidStoreInputError(field, 'must be a non-negative safe integer');
  }
}

function assertPositiveVersion(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvalidStoreInputError(field, 'must be a positive safe integer');
  }
}

function assertText(value: string, field: string, minimum: number, maximum: number): void {
  if (typeof value !== 'string') {
    throw new InvalidStoreInputError(field, 'must be a string');
  }
  const length = value.trim().length;
  if (length < minimum || length > maximum) {
    throw new InvalidStoreInputError(
      field,
      `must contain between ${minimum} and ${maximum} characters`,
    );
  }
}

function assertTaskStatus(value: string): asserts value is TaskStatus {
  if (!['backlog', 'planned', 'in_progress', 'review', 'done'].includes(value)) {
    throw new InvalidStoreInputError('status', 'is not recognized');
  }
}

function assertWorkItemResourceType(value: string): asserts value is WorkItemResourceType {
  if (!['experiment', 'revision', 'review', 'reference'].includes(value)) {
    throw new InvalidStoreInputError('resourceType', 'is not recognized');
  }
}

function assertApprovalSubjectType(value: string): asserts value is ApprovalSubjectType {
  if (
    !['objective', 'campaign', 'manuscript_revision', 'overleaf_export', 'work_item'].includes(
      value,
    )
  ) {
    throw new InvalidStoreInputError('subjectType', 'is not recognized');
  }
}

function assertApprovalDecision(value: string): asserts value is ApprovalDecision {
  if (!['approved', 'rejected', 'changes_requested'].includes(value)) {
    throw new InvalidStoreInputError('decision', 'is not recognized');
  }
}

function asProjectRole(value: unknown): ProjectRole {
  if (
    typeof value !== 'string' ||
    !['owner', 'project_lead', 'researcher', 'reviewer', 'viewer'].includes(value)
  ) {
    throw new StoreInvariantError('The membership query returned an invalid role.');
  }
  return value as ProjectRole;
}

function requireReturnedRow(result: PgQueryResult, operation: string): PgRow {
  const row = result.rows[0];
  if (result.rowCount !== 1 || row === undefined) {
    throw new StoreInvariantError(`${operation} did not return exactly one row.`);
  }
  return row;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new StoreInvariantError(`${field} was not a string.`);
  return value;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return asString(value, field);
}

function asVersion(value: unknown, field: string): number {
  const version = typeof value === 'string' ? Number(value) : value;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new StoreInvariantError(`${field} was not a valid entity version.`);
  }
  return version;
}

function asTimestamp(value: unknown, field: string): string {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new StoreInvariantError(`${field} was not a valid timestamp.`);
}

function mapWorkItemRow(row: PgRow): WorkItemRecord {
  const status = asString(row.status, 'work_items.status');
  assertTaskStatus(status);
  const resourceType = asOptionalString(row.resource_type, 'work_items.resource_type');
  if (
    resourceType !== undefined &&
    !['experiment', 'revision', 'review', 'reference'].includes(resourceType)
  ) {
    throw new StoreInvariantError('work_items.resource_type was not recognized.');
  }
  const assigneeId = asOptionalString(row.assignee_id, 'work_items.assignee_id');
  const resourceId = asOptionalString(row.resource_id, 'work_items.resource_id');
  return {
    id: asString(row.id, 'work_items.id'),
    projectId: asString(row.project_id, 'work_items.project_id'),
    title: asString(row.title, 'work_items.title'),
    status,
    ...(assigneeId === undefined ? {} : { assigneeId }),
    ...(resourceType === undefined ? {} : { resourceType: resourceType as WorkItemResourceType }),
    ...(resourceId === undefined ? {} : { resourceId }),
    version: asVersion(row.version, 'work_items.version'),
    updatedAt: asTimestamp(row.updated_at, 'work_items.updated_at'),
  };
}

function mapVisibleChatRow(row: PgRow): VisibleChatRecord {
  const role = asString(row.role, 'visible_chat_messages.role');
  if (role !== 'user' && role !== 'assistant') {
    throw new StoreInvariantError('visible_chat_messages.role was not recognized.');
  }
  const modelId = asOptionalString(row.model_id, 'visible_chat_messages.model_id');
  const value = {
    id: asString(row.id, 'visible_chat_messages.id'),
    projectId: asString(row.project_id, 'visible_chat_messages.project_id'),
    actorId: asString(row.actor_id, 'visible_chat_messages.actor_id'),
    role,
    content: asString(row.content, 'visible_chat_messages.content'),
    ...(modelId === undefined ? {} : { modelId }),
    createdAt: asTimestamp(row.created_at, 'visible_chat_messages.created_at'),
  } satisfies VisibleChatRecord;
  toSafePersistableObject({ value });
  return value;
}

function mapApprovalRow(row: PgRow): ApprovalRecord {
  const subjectType = asString(row.subject_type, 'approval_records.subject_type');
  const decision = asString(row.decision, 'approval_records.decision');
  assertApprovalSubjectType(subjectType);
  assertApprovalDecision(decision);
  const rationale = asOptionalString(row.rationale, 'approval_records.rationale');
  const value = {
    id: asString(row.id, 'approval_records.id'),
    projectId: asString(row.project_id, 'approval_records.project_id'),
    actorId: asString(row.actor_id, 'approval_records.actor_id'),
    subjectType,
    subjectId: asString(row.subject_id, 'approval_records.subject_id'),
    subjectVersion: asVersion(row.subject_version, 'approval_records.subject_version'),
    decision,
    ...(rationale === undefined ? {} : { rationale }),
    version: asVersion(row.version, 'approval_records.version'),
    createdAt: asTimestamp(row.created_at, 'approval_records.created_at'),
  } satisfies ApprovalRecord;
  toSafePersistableObject({ value });
  return value;
}

function mapAuditRow(row: PgRow): AuditRecord {
  const details = parsePersistableObject(row.details, 'audit_events.details');
  return {
    id: asString(row.id, 'audit_events.id'),
    labId: asString(row.lab_id, 'audit_events.lab_id'),
    projectId: asString(row.project_id, 'audit_events.project_id'),
    actorId: asString(row.actor_id, 'audit_events.actor_id'),
    action: asString(row.action, 'audit_events.action'),
    entityType: asString(row.entity_type, 'audit_events.entity_type'),
    entityId: asString(row.entity_id, 'audit_events.entity_id'),
    entityVersion: asVersion(row.entity_version, 'audit_events.entity_version'),
    details,
    occurredAt: asTimestamp(row.occurred_at, 'audit_events.occurred_at'),
  };
}

function parsePersistableObject(value: unknown, field: string): SafePersistableObject {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new StoreInvariantError(`${field} was not valid JSON.`);
    }
  }
  return toSafePersistableObject(parsed);
}

function parseIdempotencyEnvelope(value: unknown): IdempotencyEnvelope {
  const parsed = parsePersistableObject(value, 'idempotency_keys.response');
  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.requestHash !== 'string' ||
    (parsed.state !== 'pending' && parsed.state !== 'completed')
  ) {
    throw new StoreInvariantError('The idempotency response envelope was malformed.');
  }
  return parsed as unknown as IdempotencyEnvelope;
}

function stableJson(value: PersistableValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const objectValue = value as PersistableObject;
  const fields = Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(objectValue[key] as PersistableValue)}`);
  return `{${fields.join(',')}}`;
}
