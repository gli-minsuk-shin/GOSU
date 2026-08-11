import { randomUUID } from 'node:crypto';

import {
  ManuscriptCheckpointV1Schema,
  ManuscriptSyncAnchorV1Schema,
  ManuscriptWorkspaceBindingV1Schema,
  type ManuscriptCheckpointV1,
} from '@gosu/contracts';
import {
  deriveManuscriptSyncState,
  type ManuscriptWorkspaceAdapter,
  type ManuscriptWorkspaceAdapterRegistry,
} from '@gosu/integrations';

import {
  ConnectOverleafGitInputSchema,
  CreateManuscriptInputSchema,
  FetchManuscriptCheckpointInputSchema,
  CompileManuscriptPdfInputSchema,
  ListManuscriptCheckpointFilesInputSchema,
  ManuscriptBindingCommandSchema,
  ManuscriptCheckpointFileChunkSchema,
  ManuscriptCheckpointFileListSchema,
  ManuscriptPdfPreviewSchema,
  ManuscriptProjectInputSchema,
  ReadManuscriptCheckpointFileInputSchema,
  ManuscriptRecordSchema,
  ManuscriptWorkspaceConnectionSchema,
  ManuscriptWorkspaceSnapshotSchema,
  UpdateManuscriptInputSchema,
  type ConnectOverleafGitInput,
  type CreateManuscriptInput,
  type FetchManuscriptCheckpointInput,
  type CompileManuscriptPdfInput,
  type ListManuscriptCheckpointFilesInput,
  type ManuscriptBindingCommand,
  type ManuscriptRecord,
  type ManuscriptWorkspaceConnection,
  type ManuscriptWorkspaceSnapshot,
  type ManuscriptCheckpointFileChunk,
  type ManuscriptCheckpointFileList,
  type ManuscriptPdfPreview,
  type OverleafGitBindingConfiguration,
  type StoredManuscriptWorkspaceConnection,
  type ReadManuscriptCheckpointFileInput,
  type UpdateManuscriptInput,
} from '../shared/manuscript-workspace-contracts';
import type { ManuscriptWorkspaceIpcErrorCode } from '../shared/manuscript-workspace-ipc-result';
import type { OverleafGitCredentialStore } from './overleaf-git-credential-store';
import { ManuscriptPdfCompilerError, type ManuscriptPdfCompiler } from './manuscript-pdf-compiler';
import { OverleafGitTransportError, parseOverleafGitRemote } from './overleaf-git-transport';
import type { OverleafGitTransport } from './overleaf-git-transport';
import type { WorkspaceService } from './workspace-service';

type MaybePromise<T> = T | Promise<T>;

export interface ManuscriptWorkspaceStorage {
  listManuscripts(projectId: string): MaybePromise<readonly ManuscriptRecord[]>;
  getManuscript(projectId: string, manuscriptId: string): MaybePromise<ManuscriptRecord | null>;
  createManuscript(manuscript: ManuscriptRecord): MaybePromise<boolean>;
  updateManuscript(manuscript: ManuscriptRecord, expectedVersion: number): MaybePromise<boolean>;
  getManuscriptWorkspaceConnection(
    projectId: string,
    manuscriptId: string,
  ): MaybePromise<StoredManuscriptWorkspaceConnection | null>;
  getManuscriptWorkspacePresentation(
    bindingId: string,
  ): MaybePromise<Readonly<{ workspaceUrl: string | null }>>;
  connectOverleafGitWorkspace(
    connection: StoredManuscriptWorkspaceConnection,
    configuration: OverleafGitBindingConfiguration,
    expectedManuscriptVersion: number,
  ): MaybePromise<boolean>;
  updateManuscriptWorkspaceConnection(
    connection: StoredManuscriptWorkspaceConnection,
    expectedBindingVersion: number,
  ): MaybePromise<boolean>;
  latestManuscriptCheckpoint(bindingId: string): MaybePromise<ManuscriptCheckpointV1 | null>;
  latestManuscriptCheckpointForManuscript(
    projectId: string,
    manuscriptId: string,
  ): MaybePromise<ManuscriptCheckpointV1 | null>;
  getManuscriptCheckpointByProviderRevision(
    bindingId: string,
    providerRevision: string,
  ): MaybePromise<ManuscriptCheckpointV1 | null>;
  appendManuscriptCheckpoint(
    checkpoint: ManuscriptCheckpointV1,
  ): MaybePromise<ManuscriptCheckpointV1>;
  disableManuscriptWorkspaceConnection(
    projectId: string,
    manuscriptId: string,
    bindingId: string,
    expectedBindingVersion: number,
    updatedAt: string,
  ): MaybePromise<boolean>;
  localManuscriptActorId(): MaybePromise<string>;
  listManuscriptArtifactPurgeQueue(
    projectIds?: readonly string[],
    after?: Readonly<{ queuedAt: string; bindingId: string }>,
  ): MaybePromise<
    readonly Readonly<{
      bindingId: string;
      projectId: string;
      providerId: string;
      queuedAt: string;
    }>[]
  >;
  completeManuscriptArtifactPurge(bindingId: string): MaybePromise<boolean>;
  listManuscriptCredentialCleanupQueue(
    after?: Readonly<{ queuedAt: string; providerId: string; credentialRef: string }>,
  ): MaybePromise<
    readonly Readonly<{
      providerId: string;
      credentialRef: string;
      queuedAt: string;
    }>[]
  >;
  hasEnabledManuscriptCredentialReference(
    providerId: string,
    credentialRef: string,
  ): MaybePromise<boolean>;
  completeManuscriptCredentialCleanup(
    providerId: string,
    credentialRef: string,
  ): MaybePromise<boolean>;
}

type RepositoryRevisionPort = Readonly<{
  revision(projectId: string): Promise<string | null>;
}>;

type CredentialStore = Pick<OverleafGitCredentialStore, 'stage'>;
type CheckpointTransport = Pick<
  OverleafGitTransport,
  'inspect' | 'fetchCheckpoint' | 'hasCheckpoint' | 'listCheckpointFiles' | 'readCheckpointText'
>;

export class ManuscriptWorkspaceServiceError extends Error {
  constructor(
    readonly code: Exclude<
      ManuscriptWorkspaceIpcErrorCode,
      'invalid_manuscript_workspace_input' | 'manuscript_workspace_unavailable'
    >,
  ) {
    super(code);
    this.name = 'ManuscriptWorkspaceServiceError';
  }
}

type ManuscriptWorkspaceServiceOptions = Readonly<{
  storage: ManuscriptWorkspaceStorage;
  workspace: WorkspaceService;
  repository: RepositoryRevisionPort;
  adapters: ManuscriptWorkspaceAdapterRegistry;
  overleafGit: CheckpointTransport;
  pdfCompiler?: Pick<ManuscriptPdfCompiler, 'compile'>;
  credentials: CredentialStore;
  now?: () => Date;
}>;

const MAX_MANUSCRIPTS_PER_PROJECT = 32;
const MAX_ARTIFACT_PURGE_RECONCILIATION_BATCHES = 64;

function mapProviderError(error: unknown): ManuscriptWorkspaceServiceError {
  if (error instanceof ManuscriptWorkspaceServiceError) return error;
  if (error instanceof OverleafGitTransportError) {
    switch (error.code) {
      case 'overleaf_git_checkpoint_file_not_found':
        return new ManuscriptWorkspaceServiceError('manuscript_checkpoint_file_not_found');
      case 'overleaf_git_checkpoint_file_not_text':
        return new ManuscriptWorkspaceServiceError('manuscript_checkpoint_file_not_text');
      case 'overleaf_git_checkpoint_tree_unsafe':
        return new ManuscriptWorkspaceServiceError('manuscript_checkpoint_tree_unsafe');
      case 'overleaf_git_url_invalid':
      case 'overleaf_git_auth_required':
      case 'overleaf_git_project_not_found':
      case 'overleaf_git_default_branch_missing':
      case 'overleaf_git_remote_rewritten':
      case 'overleaf_git_root_document_missing':
      case 'overleaf_git_checkpoint_too_large':
        return new ManuscriptWorkspaceServiceError(error.code);
      default:
        return new ManuscriptWorkspaceServiceError('manuscript_provider_unavailable');
    }
  }
  if (error instanceof ManuscriptPdfCompilerError) {
    return new ManuscriptWorkspaceServiceError(error.code);
  }
  if (error instanceof Error) {
    if (error.message === 'overleaf_keychain_unavailable') {
      return new ManuscriptWorkspaceServiceError('overleaf_keychain_unavailable');
    }
    if (error.message === 'overleaf_token_invalid') {
      return new ManuscriptWorkspaceServiceError('overleaf_token_invalid');
    }
  }
  return new ManuscriptWorkspaceServiceError('manuscript_provider_unavailable');
}

export class ManuscriptWorkspaceService {
  private readonly storage: ManuscriptWorkspaceStorage;
  private readonly workspace: WorkspaceService;
  private readonly repository: RepositoryRevisionPort;
  private readonly adapters: ManuscriptWorkspaceAdapterRegistry;
  private readonly overleafGit: CheckpointTransport;
  private readonly pdfCompiler: Pick<ManuscriptPdfCompiler, 'compile'>;
  private readonly credentials: CredentialStore;
  private readonly now: () => Date;
  private readonly tails = new Map<string, Promise<void>>();

  constructor(options: ManuscriptWorkspaceServiceOptions) {
    this.storage = options.storage;
    this.workspace = options.workspace;
    this.repository = options.repository;
    this.adapters = options.adapters;
    this.overleafGit = options.overleafGit;
    this.pdfCompiler =
      options.pdfCompiler ??
      ({
        compile: async () => {
          throw new ManuscriptPdfCompilerError('manuscript_pdf_compiler_unavailable');
        },
      } satisfies Pick<ManuscriptPdfCompiler, 'compile'>);
    this.credentials = options.credentials;
    this.now = options.now ?? (() => new Date());
  }

  async list(input: { projectId: string }): Promise<ManuscriptWorkspaceSnapshot> {
    const command = ManuscriptProjectInputSchema.parse(input);
    await this.requireActiveProject(command.projectId);
    const manuscripts = await this.storage.listManuscripts(command.projectId);
    const connections = await Promise.all(
      manuscripts.map((manuscript) =>
        this.storage.getManuscriptWorkspaceConnection(command.projectId, manuscript.id),
      ),
    );
    const gosuRevision = connections.some((connection) => connection?.binding.enabled)
      ? await this.repository.revision(command.projectId)
      : null;
    const items = await Promise.all(
      manuscripts.map(async (manuscript, index) => ({
        manuscript: ManuscriptRecordSchema.parse(manuscript),
        connection: await this.connectionView(manuscript, connections[index] ?? null, gosuRevision),
      })),
    );
    return ManuscriptWorkspaceSnapshotSchema.parse({
      schemaVersion: 1,
      projectId: command.projectId,
      providers: this.adapters.descriptors(),
      manuscripts: items,
    });
  }

  async create(input: CreateManuscriptInput): Promise<ManuscriptWorkspaceSnapshot> {
    const command = CreateManuscriptInputSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      const manuscripts = await this.storage.listManuscripts(command.projectId);
      if (manuscripts.length >= MAX_MANUSCRIPTS_PER_PROJECT) {
        throw new ManuscriptWorkspaceServiceError('manuscript_limit_reached');
      }
      const now = this.now().toISOString();
      const manuscript = ManuscriptRecordSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        projectId: command.projectId,
        title: command.title,
        rootDocument: command.rootDocument,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      if (!(await this.storage.createManuscript(manuscript))) {
        throw new ManuscriptWorkspaceServiceError('manuscript_conflict');
      }
      return this.list({ projectId: command.projectId });
    });
  }

  async update(input: UpdateManuscriptInput): Promise<ManuscriptWorkspaceSnapshot> {
    const command = UpdateManuscriptInputSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      const current = await this.requireManuscript(command.projectId, command.manuscriptId);
      if (current.version !== command.expectedVersion) {
        throw new ManuscriptWorkspaceServiceError('manuscript_conflict');
      }
      const updated = ManuscriptRecordSchema.parse({
        ...current,
        title: command.title,
        rootDocument: command.rootDocument,
        version: current.version + 1,
        updatedAt: this.now().toISOString(),
      });
      if (!(await this.storage.updateManuscript(updated, command.expectedVersion))) {
        throw new ManuscriptWorkspaceServiceError('manuscript_conflict');
      }
      return this.list({ projectId: command.projectId });
    });
  }

  async connectOverleafGit(input: ConnectOverleafGitInput): Promise<ManuscriptWorkspaceSnapshot> {
    const command = ConnectOverleafGitInputSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      const manuscript = await this.requireManuscript(command.projectId, command.manuscriptId);
      if (manuscript.version !== command.expectedManuscriptVersion) {
        throw new ManuscriptWorkspaceServiceError('manuscript_conflict');
      }
      if (await this.storage.getManuscriptWorkspaceConnection(command.projectId, manuscript.id)) {
        throw new ManuscriptWorkspaceServiceError('manuscript_binding_exists');
      }
      try {
        const remote = parseOverleafGitRemote(command.remoteUrl);
        await this.exclusive(
          this.providerWorkspaceQueueKey(command.providerId, remote.workspaceId),
          async () => {
            const provider = this.adapterFor(command.providerId).descriptor;
            const credentialStage = await this.credentials.stage(
              remote.remoteUrl,
              command.accessToken,
            );
            try {
              const [observation, gosuRevision] = await Promise.all([
                this.overleafGit.inspect(remote.remoteUrl, credentialStage.credentialRef),
                this.repository.revision(command.projectId),
              ]);
              const now = this.now().toISOString();
              const bindingId = randomUUID();
              const binding = ManuscriptWorkspaceBindingV1Schema.parse({
                schemaVersion: 1,
                bindingId,
                projectId: command.projectId,
                manuscriptId: manuscript.id,
                providerId: provider.providerId,
                capabilitiesSnapshot: provider.capabilities,
                // Linking is not an authority handoff. The read-only v1 adapter can observe and
                // fetch provider checkpoints while GOSU remains the declared draft authority.
                authority: 'gosu',
                enabled: true,
                version: 1,
                createdAt: now,
                updatedAt: now,
              });
              const connection: StoredManuscriptWorkspaceConnection = {
                binding,
                anchor: ManuscriptSyncAnchorV1Schema.parse({
                  schemaVersion: 1,
                  bindingId,
                  generation: 0,
                  lastCommonRevision: null,
                  providerRevision: null,
                  gosuRevision,
                  updatedAt: now,
                }),
                lifecycle: 'ready',
                lastObservedProviderRevision: observation.workspaceRevision,
                lastObservedAt: now,
                lastFailureCode: null,
              };
              const stored = await this.storage.connectOverleafGitWorkspace(
                connection,
                {
                  bindingId,
                  remoteUrl: remote.remoteUrl,
                  workspaceId: remote.workspaceId,
                  webUrl: remote.webUrl,
                  credentialRef: credentialStage.credentialRef,
                },
                command.expectedManuscriptVersion,
              );
              if (!stored) throw new ManuscriptWorkspaceServiceError('manuscript_conflict');
              // The DB now durably references this immutable credential. A marker cleanup failure
              // is reconciled on startup and must not roll back the already-committed binding.
              await credentialStage.commit().catch(() => undefined);
            } catch (error) {
              try {
                await credentialStage.rollback();
              } catch (rollbackError) {
                throw mapProviderError(rollbackError);
              }
              throw error;
            }
          },
        );
      } catch (error) {
        throw mapProviderError(error);
      }
      return this.list({ projectId: command.projectId });
    });
  }

  async inspect(input: ManuscriptBindingCommand): Promise<ManuscriptWorkspaceSnapshot> {
    const command = ManuscriptBindingCommandSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      await this.requireManuscript(command.projectId, command.manuscriptId);
      const { connection, adapter } = await this.requireConnection(command);
      return this.withProviderWorkspaceLock(adapter, connection.binding, async () => {
        try {
          const observation = await adapter.inspect(connection.binding);
          const updated = await this.updateObservation(
            connection,
            command.expectedBindingVersion,
            observation.providerRevision,
            null,
          );
          if (!updated) throw new ManuscriptWorkspaceServiceError('manuscript_binding_conflict');
        } catch (error) {
          await this.recordFailure(connection, command.expectedBindingVersion, error);
          throw mapProviderError(error);
        }
        return this.list({ projectId: command.projectId });
      });
    });
  }

  async fetchCheckpoint(
    input: FetchManuscriptCheckpointInput,
  ): Promise<ManuscriptWorkspaceSnapshot> {
    const command = FetchManuscriptCheckpointInputSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      const manuscript = await this.requireManuscript(command.projectId, command.manuscriptId);
      const { connection, adapter } = await this.requireConnection(command);
      const expectedRevision =
        command.expectedProviderRevision ?? connection.lastObservedProviderRevision;
      if (!expectedRevision) {
        throw new ManuscriptWorkspaceServiceError('manuscript_provider_revision_required');
      }
      return this.withProviderWorkspaceLock(adapter, connection.binding, async () => {
        try {
          const existing = await this.storage.getManuscriptCheckpointByProviderRevision(
            connection.binding.bindingId,
            expectedRevision,
          );
          if (existing) {
            const artifactPresent =
              !adapter.hasCheckpointArtifact ||
              (await adapter.hasCheckpointArtifact(connection.binding, existing));
            if (!artifactPresent && adapter.restoreCheckpointArtifact) {
              await adapter.restoreCheckpointArtifact({
                binding: connection.binding,
                checkpoint: existing,
                idempotencyKey: `${connection.binding.bindingId}:restore:${existing.checkpointId}`,
                fencingToken: connection.anchor.generation,
              });
            }
            if (artifactPresent || adapter.restoreCheckpointArtifact) {
              // This is a receipt/artifact repair, not a fresh provider observation. A stale P1
              // retry must never roll a newer observed P2 back to P1.
              return this.list({ projectId: command.projectId });
            }
          }
          if (!adapter.fetchCheckpoint) {
            throw new ManuscriptWorkspaceServiceError('manuscript_provider_unavailable');
          }
          const now = this.now().toISOString();
          const previous = await this.storage.latestManuscriptCheckpointForManuscript(
            command.projectId,
            manuscript.id,
          );
          const gosuRevision = await this.repository.revision(command.projectId);
          const checkpointId = randomUUID();
          const actorId = await this.storage.localManuscriptActorId();
          const result = await adapter.fetchCheckpoint({
            binding: connection.binding,
            expectedProviderRevision: expectedRevision,
            rootDocument: manuscript.rootDocument,
            idempotencyKey: [
              connection.binding.bindingId,
              'fetch',
              expectedRevision,
              gosuRevision ?? 'none',
            ].join(':'),
            fencingToken: connection.anchor.generation,
          });
          if (result.providerRevision !== expectedRevision) {
            throw new ManuscriptWorkspaceServiceError('manuscript_provider_unavailable');
          }
          const checkpoint = ManuscriptCheckpointV1Schema.parse({
            schemaVersion: 1,
            checkpointId,
            bindingId: connection.binding.bindingId,
            projectId: command.projectId,
            manuscriptId: manuscript.id,
            providerId: connection.binding.providerId,
            direction: 'fetch',
            sourceAuthority: 'provider',
            sourceRevision: result.providerRevision,
            gosuRevision,
            providerRevision: result.providerRevision,
            cursor: result.cursor,
            revisionEnvelopeDigest: result.revisionEnvelopeDigest,
            rootDocument: manuscript.rootDocument,
            baseCheckpointId: previous?.checkpointId ?? null,
            actorId,
            observedAt: now,
          });
          await this.storage.appendManuscriptCheckpoint(checkpoint);
          const updated = await this.updateObservation(
            connection,
            command.expectedBindingVersion,
            checkpoint.providerRevision,
            null,
          );
          if (!updated) throw new ManuscriptWorkspaceServiceError('manuscript_binding_conflict');
        } catch (error) {
          await this.recordFailure(connection, command.expectedBindingVersion, error);
          throw mapProviderError(error);
        }
        return this.list({ projectId: command.projectId });
      });
    });
  }

  async listCheckpointFiles(
    input: ListManuscriptCheckpointFilesInput,
  ): Promise<ManuscriptCheckpointFileList> {
    const command = ListManuscriptCheckpointFilesInputSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      const { connection, checkpoint } = await this.requireLatestCheckpoint(command);
      try {
        const files = await this.overleafGit.listCheckpointFiles(
          connection.binding.bindingId,
          checkpoint.providerRevision ?? checkpoint.sourceRevision,
          checkpoint.rootDocument,
          checkpoint.revisionEnvelopeDigest,
        );
        return ManuscriptCheckpointFileListSchema.parse({
          schemaVersion: 1,
          projectId: command.projectId,
          manuscriptId: command.manuscriptId,
          checkpointId: checkpoint.checkpointId,
          providerRevision: checkpoint.providerRevision ?? checkpoint.sourceRevision,
          files,
        });
      } catch (error) {
        throw mapProviderError(error);
      }
    });
  }

  async readCheckpointFile(
    input: ReadManuscriptCheckpointFileInput,
  ): Promise<ManuscriptCheckpointFileChunk> {
    const command = ReadManuscriptCheckpointFileInputSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      const { connection, checkpoint } = await this.requireLatestCheckpoint(command);
      try {
        const content = await this.overleafGit.readCheckpointText(
          connection.binding.bindingId,
          checkpoint.providerRevision ?? checkpoint.sourceRevision,
          checkpoint.rootDocument,
          checkpoint.revisionEnvelopeDigest,
          command.relativePath,
        );
        const offset = Math.min(command.offset ?? 0, content.length);
        const maxCharacters = command.maxCharacters ?? 24_000;
        const chunk = content.slice(offset, offset + maxCharacters);
        const nextOffset = offset + chunk.length;
        return ManuscriptCheckpointFileChunkSchema.parse({
          schemaVersion: 1,
          projectId: command.projectId,
          manuscriptId: command.manuscriptId,
          checkpointId: checkpoint.checkpointId,
          providerRevision: checkpoint.providerRevision ?? checkpoint.sourceRevision,
          relativePath: command.relativePath,
          offset,
          nextOffset,
          truncated: nextOffset < content.length,
          content: chunk,
        });
      } catch (error) {
        throw mapProviderError(error);
      }
    });
  }

  async compilePdf(input: CompileManuscriptPdfInput): Promise<ManuscriptPdfPreview> {
    const command = CompileManuscriptPdfInputSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      const { connection, checkpoint } = await this.requireLatestCheckpoint(command);
      try {
        const compiled = await this.pdfCompiler.compile(
          connection.binding.bindingId,
          checkpoint,
          command.engine,
        );
        return ManuscriptPdfPreviewSchema.parse({
          schemaVersion: 1,
          ...compiled,
          projectId: command.projectId,
          manuscriptId: command.manuscriptId,
          checkpointId: checkpoint.checkpointId,
          providerRevision: checkpoint.providerRevision ?? checkpoint.sourceRevision,
          rootDocument: checkpoint.rootDocument,
          providerAhead:
            connection.lastObservedProviderRevision !== null &&
            connection.lastObservedProviderRevision !==
              (checkpoint.providerRevision ?? checkpoint.sourceRevision),
          compiledAt: this.now().toISOString(),
        });
      } catch (error) {
        throw mapProviderError(error);
      }
    });
  }

  async disconnect(input: ManuscriptBindingCommand): Promise<ManuscriptWorkspaceSnapshot> {
    const command = ManuscriptBindingCommandSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      await this.requireActiveProject(command.projectId);
      await this.requireConnection(command);
      const removed = await this.storage.disableManuscriptWorkspaceConnection(
        command.projectId,
        command.manuscriptId,
        command.bindingId,
        command.expectedBindingVersion,
        this.now().toISOString(),
      );
      if (!removed) throw new ManuscriptWorkspaceServiceError('manuscript_binding_conflict');
      await this.reconcileCredentialCleanupQueue().catch(() => undefined);
      return this.list({ projectId: command.projectId });
    });
  }

  private async requireLatestCheckpoint(command: {
    projectId: string;
    manuscriptId: string;
    checkpointId: string;
  }) {
    await this.requireActiveProject(command.projectId);
    await this.requireManuscript(command.projectId, command.manuscriptId);
    const connection = await this.storage.getManuscriptWorkspaceConnection(
      command.projectId,
      command.manuscriptId,
    );
    if (!connection?.binding.enabled) {
      throw new ManuscriptWorkspaceServiceError('manuscript_binding_not_found');
    }
    if (connection.binding.providerId !== 'overleaf_git') {
      throw new ManuscriptWorkspaceServiceError('manuscript_provider_unavailable');
    }
    const checkpoint = await this.storage.latestManuscriptCheckpointForManuscript(
      command.projectId,
      command.manuscriptId,
    );
    if (
      !checkpoint ||
      checkpoint.checkpointId !== command.checkpointId ||
      checkpoint.bindingId !== connection.binding.bindingId
    ) {
      throw new ManuscriptWorkspaceServiceError('manuscript_checkpoint_not_found');
    }
    return { connection, checkpoint };
  }

  runWhenProjectsIdle<T>(projectIds: readonly string[], operation: () => Promise<T>): Promise<T> {
    const ids = [...new Set(projectIds)].sort();
    const acquire = (index: number): Promise<T> => {
      const projectId = ids[index];
      return projectId ? this.exclusive(projectId, () => acquire(index + 1)) : operation();
    };
    return acquire(0);
  }

  /**
   * Drains the durable metadata-to-filesystem handoff. A failed provider cleanup remains queued
   * for startup or the next Trash purge; metadata is acknowledged only after artifact removal.
   */
  async reconcileArtifactPurgeQueue(projectIds?: readonly string[]) {
    let completed = 0;
    let cursor: Readonly<{ queuedAt: string; bindingId: string }> | undefined;
    for (let batch = 0; batch < MAX_ARTIFACT_PURGE_RECONCILIATION_BATCHES; batch += 1) {
      const entries = await this.storage.listManuscriptArtifactPurgeQueue(projectIds, cursor);
      if (entries.length === 0) break;
      for (const entry of entries) {
        try {
          const adapter = this.adapters.adapter(entry.providerId);
          if (!adapter.purgeBindingArtifacts) continue;
          await adapter.purgeBindingArtifacts(entry.bindingId);
          if (await this.storage.completeManuscriptArtifactPurge(entry.bindingId)) {
            completed += 1;
          }
        } catch {
          // Fail closed: keep the durable row so a later startup can retry exact-scope cleanup.
        }
      }
      const last = entries.at(-1)!;
      cursor = { queuedAt: last.queuedAt, bindingId: last.bindingId };
    }
    await this.reconcileCredentialCleanupQueue();
    return completed;
  }

  async reconcileCredentialCleanupQueue() {
    let completed = 0;
    let cursor:
      Readonly<{ queuedAt: string; providerId: string; credentialRef: string }> | undefined;
    for (let batch = 0; batch < MAX_ARTIFACT_PURGE_RECONCILIATION_BATCHES; batch += 1) {
      const entries = await this.storage.listManuscriptCredentialCleanupQueue(cursor);
      if (entries.length === 0) break;
      for (const entry of entries) {
        try {
          const adapter = this.adapters.adapter(entry.providerId);
          if (!adapter.purgeCredential || !adapter.credentialConcurrencyKey) continue;
          const concurrencyKey = await adapter.credentialConcurrencyKey(entry.credentialRef);
          await this.exclusive(
            this.providerWorkspaceQueueKey(entry.providerId, concurrencyKey),
            async () => {
              if (
                await this.storage.hasEnabledManuscriptCredentialReference(
                  entry.providerId,
                  entry.credentialRef,
                )
              ) {
                return;
              }
              await adapter.purgeCredential!(entry.credentialRef);
              if (
                await this.storage.completeManuscriptCredentialCleanup(
                  entry.providerId,
                  entry.credentialRef,
                )
              ) {
                completed += 1;
              }
            },
          );
        } catch {
          // Keep the durable row for a later retry; other credentials continue independently.
        }
      }
      const last = entries.at(-1)!;
      cursor = {
        queuedAt: last.queuedAt,
        providerId: last.providerId,
        credentialRef: last.credentialRef,
      };
    }
    return completed;
  }

  private async connectionView(
    manuscript: ManuscriptRecord,
    stored: StoredManuscriptWorkspaceConnection | null,
    gosuRevision: string | null,
  ): Promise<ManuscriptWorkspaceConnection | null> {
    if (!stored || !stored.binding.enabled) return null;
    const presentation = await this.storage.getManuscriptWorkspacePresentation(
      stored.binding.bindingId,
    );
    const checkpoint = await this.storage.latestManuscriptCheckpointForManuscript(
      manuscript.projectId,
      manuscript.id,
    );
    let adapter: ManuscriptWorkspaceAdapter;
    try {
      adapter = this.adapters.adapter(stored.binding.providerId);
    } catch {
      return ManuscriptWorkspaceConnectionSchema.parse({
        binding: stored.binding,
        providerDisplayName: stored.binding.providerId,
        workspaceUrl: presentation.workspaceUrl,
        lifecycle: 'failed',
        syncState: 'failed',
        anchor: stored.anchor,
        lastObservedProviderRevision: stored.lastObservedProviderRevision,
        lastObservedAt: stored.lastObservedAt,
        lastFailureCode: 'provider_adapter_unavailable',
        lastCheckpoint: checkpoint,
      });
    }
    return ManuscriptWorkspaceConnectionSchema.parse({
      binding: stored.binding,
      providerDisplayName: adapter.descriptor.displayName,
      workspaceUrl: presentation.workspaceUrl,
      lifecycle: stored.lifecycle,
      syncState: deriveManuscriptSyncState({
        linked: true,
        lifecycle: stored.lifecycle,
        anchor: stored.anchor,
        providerRevision: stored.lastObservedProviderRevision,
        gosuRevision,
      }),
      anchor: stored.anchor,
      lastObservedProviderRevision: stored.lastObservedProviderRevision,
      lastObservedAt: stored.lastObservedAt,
      lastFailureCode: stored.lastFailureCode,
      lastCheckpoint: checkpoint,
    });
  }

  private async updateObservation(
    current: StoredManuscriptWorkspaceConnection,
    expectedVersion: number,
    providerRevision: string | null,
    failureCode: string | null,
  ) {
    if (current.binding.version !== expectedVersion) {
      throw new ManuscriptWorkspaceServiceError('manuscript_binding_conflict');
    }
    const now = this.now().toISOString();
    return this.storage.updateManuscriptWorkspaceConnection(
      {
        ...current,
        lifecycle: failureCode ? 'failed' : 'ready',
        lastObservedProviderRevision: providerRevision,
        lastObservedAt: now,
        lastFailureCode: failureCode,
      },
      expectedVersion,
    );
  }

  private async recordFailure(
    current: StoredManuscriptWorkspaceConnection,
    expectedVersion: number,
    error: unknown,
  ) {
    const code = mapProviderError(error).code;
    if (current.binding.version !== expectedVersion) return;
    const now = this.now().toISOString();
    const lifecycle = code === 'overleaf_git_remote_rewritten' ? 'blocked' : 'failed';
    await Promise.resolve(
      this.storage.updateManuscriptWorkspaceConnection(
        {
          ...current,
          lifecycle,
          lastObservedAt: now,
          lastFailureCode: code,
        },
        expectedVersion,
      ),
    ).catch(() => false);
  }

  private async requireConnection(command: ManuscriptBindingCommand) {
    const connection = await this.storage.getManuscriptWorkspaceConnection(
      command.projectId,
      command.manuscriptId,
    );
    if (
      !connection ||
      !connection.binding.enabled ||
      connection.binding.bindingId !== command.bindingId
    ) {
      throw new ManuscriptWorkspaceServiceError('manuscript_binding_not_found');
    }
    if (connection.binding.version !== command.expectedBindingVersion) {
      throw new ManuscriptWorkspaceServiceError('manuscript_binding_conflict');
    }
    return { connection, adapter: this.adapterFor(connection.binding.providerId) };
  }

  private adapterFor(providerId: string) {
    try {
      return this.adapters.adapter(providerId);
    } catch {
      throw new ManuscriptWorkspaceServiceError('manuscript_provider_unavailable');
    }
  }

  private async requireManuscript(projectId: string, manuscriptId: string) {
    const manuscript = await this.storage.getManuscript(projectId, manuscriptId);
    if (!manuscript) throw new ManuscriptWorkspaceServiceError('manuscript_not_found');
    return ManuscriptRecordSchema.parse(manuscript);
  }

  private async requireActiveProject(projectId: string) {
    const snapshot = await this.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new ManuscriptWorkspaceServiceError('project_not_found');
    if (project.trashedAt) throw new ManuscriptWorkspaceServiceError('project_trashed');
    if (project.archivedAt) throw new ManuscriptWorkspaceServiceError('project_archived');
    return project;
  }

  private async withProviderWorkspaceLock<T>(
    adapter: ManuscriptWorkspaceAdapter,
    binding: StoredManuscriptWorkspaceConnection['binding'],
    operation: () => Promise<T>,
  ) {
    const concurrencyKey = adapter.workspaceConcurrencyKey
      ? await adapter.workspaceConcurrencyKey(binding)
      : binding.bindingId;
    return this.exclusive(
      this.providerWorkspaceQueueKey(binding.providerId, concurrencyKey),
      operation,
    );
  }

  private providerWorkspaceQueueKey(providerId: string, concurrencyKey: string) {
    if (
      concurrencyKey.length < 1 ||
      concurrencyKey.length > 512 ||
      [...concurrencyKey].some((character) => (character.codePointAt(0) ?? 0) < 32)
    ) {
      throw new ManuscriptWorkspaceServiceError('manuscript_provider_unavailable');
    }
    return `manuscript-provider:${JSON.stringify([providerId, concurrencyKey])}`;
  }

  private async exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.tails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
