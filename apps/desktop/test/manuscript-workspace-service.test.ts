import { randomUUID } from 'node:crypto';

import type { ManuscriptCheckpointV1 } from '@gosu/contracts';
import { createManuscriptWorkspaceAdapterRegistry } from '@gosu/integrations';
import { describe, expect, it, vi } from 'vitest';

import {
  ManuscriptWorkspaceService,
  type ManuscriptWorkspaceStorage,
} from '../src/main/manuscript-workspace-service';
import { ManuscriptPdfCompilerError } from '../src/main/manuscript-pdf-compiler';
import {
  OverleafGitTransportError,
  type OverleafGitCheckpointObservation,
} from '../src/main/overleaf-git-transport';
import { OverleafGitManuscriptWorkspaceAdapter } from '../src/main/overleaf-git-manuscript-adapter';
import type {
  ManuscriptRecord,
  OverleafGitBindingConfiguration,
  StoredManuscriptWorkspaceConnection,
} from '../src/shared/manuscript-workspace-contracts';
import {
  MANUSCRIPT_CHECKPOINT_MAX_FILE_BYTES,
  MANUSCRIPT_CHECKPOINT_MAX_FILE_METADATA_ENTRIES,
  ManuscriptCheckpointFileListSchema,
  ManuscriptWorkspaceConnectionSchema,
  ReadManuscriptCheckpointFileInputSchema,
} from '../src/shared/manuscript-workspace-contracts';
import type { WorkspaceService } from '../src/main/workspace-service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const REMOTE = 'https://git.overleaf.com/0123456789abcdef01234567';
const PROVIDER_REVISION = 'a'.repeat(40);
const GOSU_REVISION = 'b'.repeat(40);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class MemoryStorage implements ManuscriptWorkspaceStorage {
  readonly manuscripts = new Map<string, ManuscriptRecord>();
  readonly connections = new Map<string, StoredManuscriptWorkspaceConnection>();
  readonly configurations = new Map<string, OverleafGitBindingConfiguration>();
  readonly checkpoints = new Map<string, ManuscriptCheckpointV1>();
  readonly artifactPurgeQueue = new Map<
    string,
    Readonly<{ bindingId: string; projectId: string; providerId: string; queuedAt: string }>
  >();
  readonly credentialCleanupQueue = new Map<
    string,
    Readonly<{ providerId: string; credentialRef: string; queuedAt: string }>
  >();
  readonly actorId = randomUUID();

  listManuscripts(projectId: string) {
    return [...this.manuscripts.values()].filter((record) => record.projectId === projectId);
  }
  getManuscript(projectId: string, manuscriptId: string) {
    const manuscript = this.manuscripts.get(manuscriptId) ?? null;
    return manuscript?.projectId === projectId ? structuredClone(manuscript) : null;
  }
  createManuscript(manuscript: ManuscriptRecord) {
    if (this.manuscripts.has(manuscript.id)) return false;
    this.manuscripts.set(manuscript.id, structuredClone(manuscript));
    return true;
  }
  updateManuscript(manuscript: ManuscriptRecord, expectedVersion: number) {
    const current = this.manuscripts.get(manuscript.id);
    if (
      !current ||
      current.projectId !== manuscript.projectId ||
      current.version !== expectedVersion ||
      manuscript.version !== expectedVersion + 1
    ) {
      return false;
    }
    this.manuscripts.set(manuscript.id, structuredClone(manuscript));
    return true;
  }
  getManuscriptWorkspaceConnection(projectId: string, manuscriptId: string) {
    const connection = this.connections.get(manuscriptId) ?? null;
    return connection?.binding.projectId === projectId && connection.binding.enabled
      ? structuredClone(connection)
      : null;
  }
  getOverleafGitBindingConfiguration(bindingId: string) {
    return structuredClone(this.configurations.get(bindingId) ?? null);
  }
  getManuscriptWorkspacePresentation(bindingId: string) {
    return { workspaceUrl: this.configurations.get(bindingId)?.webUrl ?? null };
  }
  connectOverleafGitWorkspace(
    connection: StoredManuscriptWorkspaceConnection,
    configuration: OverleafGitBindingConfiguration,
    expectedManuscriptVersion: number,
  ) {
    const manuscript = this.manuscripts.get(connection.binding.manuscriptId);
    if (!manuscript || manuscript.version !== expectedManuscriptVersion) return false;
    if (this.connections.get(manuscript.id)?.binding.enabled) return false;
    this.connections.set(manuscript.id, structuredClone(connection));
    this.configurations.set(connection.binding.bindingId, structuredClone(configuration));
    return true;
  }
  updateManuscriptWorkspaceConnection(
    connection: StoredManuscriptWorkspaceConnection,
    expectedBindingVersion: number,
  ) {
    const current = this.connections.get(connection.binding.manuscriptId);
    if (!current || current.binding.version !== expectedBindingVersion) return false;
    this.connections.set(connection.binding.manuscriptId, structuredClone(connection));
    return true;
  }
  latestManuscriptCheckpoint(bindingId: string) {
    return (
      [...this.checkpoints.values()]
        .filter((checkpoint) => checkpoint.bindingId === bindingId)
        .at(-1) ?? null
    );
  }
  latestManuscriptCheckpointForManuscript(projectId: string, manuscriptId: string) {
    return (
      [...this.checkpoints.values()]
        .filter(
          (checkpoint) =>
            checkpoint.projectId === projectId && checkpoint.manuscriptId === manuscriptId,
        )
        .at(-1) ?? null
    );
  }
  getManuscriptCheckpointByProviderRevision(bindingId: string, providerRevision: string) {
    return (
      [...this.checkpoints.values()].find(
        (checkpoint) =>
          checkpoint.bindingId === bindingId && checkpoint.providerRevision === providerRevision,
      ) ?? null
    );
  }
  appendManuscriptCheckpoint(checkpoint: ManuscriptCheckpointV1) {
    const existing = this.getManuscriptCheckpointByProviderRevision(
      checkpoint.bindingId,
      checkpoint.providerRevision!,
    );
    if (existing) return existing;
    this.checkpoints.set(checkpoint.checkpointId, structuredClone(checkpoint));
    return structuredClone(checkpoint);
  }
  disableManuscriptWorkspaceConnection(
    projectId: string,
    manuscriptId: string,
    bindingId: string,
    expectedBindingVersion: number,
    updatedAt: string,
  ) {
    const current = this.connections.get(manuscriptId);
    if (
      !current ||
      current.binding.projectId !== projectId ||
      current.binding.bindingId !== bindingId ||
      current.binding.version !== expectedBindingVersion
    ) {
      return false;
    }
    const configuration = this.configurations.get(bindingId);
    if (configuration) {
      this.credentialCleanupQueue.set(configuration.credentialRef, {
        providerId: current.binding.providerId,
        credentialRef: configuration.credentialRef,
        queuedAt: updatedAt,
      });
    }
    this.connections.set(manuscriptId, {
      ...current,
      binding: {
        ...current.binding,
        enabled: false,
        version: current.binding.version + 1,
        updatedAt,
      },
    });
    return true;
  }
  localManuscriptActorId() {
    return this.actorId;
  }
  listManuscriptArtifactPurgeQueue(
    projectIds?: readonly string[],
    after?: Readonly<{ queuedAt: string; bindingId: string }>,
  ) {
    const selected = projectIds ? new Set(projectIds) : null;
    return [...this.artifactPurgeQueue.values()]
      .filter((entry) => !selected || selected.has(entry.projectId))
      .sort(
        (left, right) =>
          left.queuedAt.localeCompare(right.queuedAt) ||
          left.bindingId.localeCompare(right.bindingId),
      )
      .filter(
        (entry) =>
          !after ||
          entry.queuedAt > after.queuedAt ||
          (entry.queuedAt === after.queuedAt && entry.bindingId > after.bindingId),
      );
  }
  completeManuscriptArtifactPurge(bindingId: string) {
    return this.artifactPurgeQueue.delete(bindingId);
  }
  listManuscriptCredentialCleanupQueue(
    after?: Readonly<{ queuedAt: string; providerId: string; credentialRef: string }>,
  ) {
    return [...this.credentialCleanupQueue.values()]
      .sort(
        (left, right) =>
          left.queuedAt.localeCompare(right.queuedAt) ||
          left.providerId.localeCompare(right.providerId) ||
          left.credentialRef.localeCompare(right.credentialRef),
      )
      .filter(
        (entry) =>
          !after ||
          entry.queuedAt > after.queuedAt ||
          (entry.queuedAt === after.queuedAt && entry.providerId > after.providerId) ||
          (entry.queuedAt === after.queuedAt &&
            entry.providerId === after.providerId &&
            entry.credentialRef > after.credentialRef),
      );
  }
  hasEnabledManuscriptCredentialReference(providerId: string, credentialRef: string) {
    return [...this.connections.values()].some((connection) => {
      const configuration = this.configurations.get(connection.binding.bindingId);
      return (
        connection.binding.enabled &&
        connection.binding.providerId === providerId &&
        configuration?.credentialRef === credentialRef
      );
    });
  }
  completeManuscriptCredentialCleanup(providerId: string, credentialRef: string) {
    const entry = this.credentialCleanupQueue.get(credentialRef);
    return entry?.providerId === providerId && this.credentialCleanupQueue.delete(credentialRef);
  }
}

function workspaceFixture() {
  return {
    snapshot: vi.fn(async () => ({
      schemaVersion: 1,
      revision: 1,
      projects: [
        {
          id: PROJECT_ID,
          name: 'Research project',
          version: 1,
          board: { columns: [], template: [] },
          createdAt: '2026-08-11T00:00:00.000Z',
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
        {
          id: OTHER_PROJECT_ID,
          name: 'Second research project',
          version: 1,
          board: { columns: [], template: [] },
          createdAt: '2026-08-11T00:00:00.000Z',
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
      ],
      tasks: [],
      objectives: [],
    })),
  } as unknown as WorkspaceService;
}

function serviceFixture(
  options: { fetchError?: OverleafGitTransportError; inspectError?: Error } = {},
) {
  const storage = new MemoryStorage();
  const commitCredential = vi.fn(async () => undefined);
  const rollbackCredential = vi.fn(async () => undefined);
  const stageCredential = vi.fn(async () => ({
    credentialRef: 'overleaf-git:0123456789abcdef01234567',
    commit: commitCredential,
    rollback: rollbackCredential,
  }));
  const inspect = vi.fn(async (): Promise<OverleafGitCheckpointObservation> => {
    if (options.inspectError) throw options.inspectError;
    return {
      workspaceRevision: PROVIDER_REVISION,
      treeRevision: '',
      revisionEnvelopeDigest: '',
    };
  });
  const fetchCheckpoint = vi.fn(async (): Promise<OverleafGitCheckpointObservation> => {
    if (options.fetchError) throw options.fetchError;
    return {
      workspaceRevision: PROVIDER_REVISION,
      treeRevision: 'c'.repeat(40),
      revisionEnvelopeDigest: `sha256:${'d'.repeat(64)}`,
    };
  });
  const hasCheckpoint = vi.fn(async () => true);
  const listCheckpointFiles = vi.fn(async () => [
    { relativePath: 'paper/main.tex', sizeBytes: 128, textReadable: true },
    { relativePath: 'paper/figure.pdf', sizeBytes: 2_048, textReadable: false },
  ]);
  const readCheckpointText = vi.fn(async () => '0123456789abcdefghijklmnopqrstuvwxyz');
  const restoreCheckpoint = vi.fn(async () => undefined);
  const removeBindingArtifacts = vi.fn(async () => undefined);
  const eraseCredential = vi.fn(async () => undefined);
  const transport = {
    inspect,
    fetchCheckpoint,
    restoreCheckpoint,
    hasCheckpoint,
    listCheckpointFiles,
    readCheckpointText,
    removeBindingArtifacts,
  };
  const compilePdf = vi.fn(async () => ({
    artifactId: '33333333-3333-4333-8333-333333333333',
    compiler: {
      kind: 'latexmk' as const,
      displayName: 'Local MacTeX latexmk',
      version: 'Latexmk, John Collins, 4.87',
      engine: 'xelatex' as const,
      engineDisplayName: 'XeLaTeX',
    },
    pdfSha256: `sha256:${'e'.repeat(64)}`,
    sizeBytes: 9,
    pdfBase64: Buffer.from('%PDF-1.4\n').toString('base64'),
  }));
  const now = () => new Date('2026-08-11T01:02:03.000Z');
  const repositoryRevision = vi.fn(async () => GOSU_REVISION);
  const adapters = createManuscriptWorkspaceAdapterRegistry([
    new OverleafGitManuscriptWorkspaceAdapter(storage, transport, now, {
      eraseByReference: eraseCredential,
    }),
  ]);
  const service = new ManuscriptWorkspaceService({
    storage,
    workspace: workspaceFixture(),
    repository: { revision: repositoryRevision },
    adapters,
    overleafGit: transport,
    pdfCompiler: { compile: compilePdf },
    credentials: { stage: stageCredential },
    now,
  });
  return {
    service,
    storage,
    stageCredential,
    commitCredential,
    rollbackCredential,
    inspect,
    fetchCheckpoint,
    hasCheckpoint,
    listCheckpointFiles,
    readCheckpointText,
    compilePdf,
    restoreCheckpoint,
    removeBindingArtifacts,
    eraseCredential,
    repositoryRevision,
  };
}

async function createAndConnect(fixture: ReturnType<typeof serviceFixture>) {
  const created = await fixture.service.create({
    projectId: PROJECT_ID,
    title: 'Main manuscript',
    rootDocument: 'paper/main.tex',
  });
  const manuscript = created.manuscripts[0]!.manuscript;
  const token = 'private-overleaf-token';
  const connected = await fixture.service.connectOverleafGit({
    projectId: PROJECT_ID,
    manuscriptId: manuscript.id,
    expectedManuscriptVersion: manuscript.version,
    providerId: 'overleaf_git',
    remoteUrl: REMOTE,
    accessToken: token,
  });
  return { manuscript, connection: connected.manuscripts[0]!.connection!, token };
}

async function createConnectAndCapture(fixture: ReturnType<typeof serviceFixture>) {
  const connected = await createAndConnect(fixture);
  const captured = await fixture.service.fetchCheckpoint({
    projectId: PROJECT_ID,
    manuscriptId: connected.manuscript.id,
    bindingId: connected.connection.binding.bindingId,
    expectedBindingVersion: connected.connection.binding.version,
    expectedProviderRevision: PROVIDER_REVISION,
  });
  return {
    ...connected,
    checkpoint: captured.manuscripts[0]!.connection!.lastCheckpoint!,
  };
}

describe('Manuscript workspace service', () => {
  it('accepts transport-sized checkpoint metadata without widening bounded text chunks', () => {
    const files = Array.from(
      { length: MANUSCRIPT_CHECKPOINT_MAX_FILE_METADATA_ENTRIES },
      (_, index) => ({
        relativePath: `figures/result-${index}.bin`,
        sizeBytes: MANUSCRIPT_CHECKPOINT_MAX_FILE_BYTES,
        textReadable: false,
      }),
    );
    const checkpoint = {
      schemaVersion: 1 as const,
      projectId: PROJECT_ID,
      manuscriptId: '33333333-3333-4333-8333-333333333333',
      checkpointId: '44444444-4444-4444-8444-444444444444',
      providerRevision: PROVIDER_REVISION,
      files,
    };

    expect(ManuscriptCheckpointFileListSchema.safeParse(checkpoint).success).toBe(true);
    expect(
      ManuscriptCheckpointFileListSchema.safeParse({
        ...checkpoint,
        files: [
          ...files,
          {
            relativePath: 'figures/one-too-many.bin',
            sizeBytes: 1,
            textReadable: false,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ManuscriptCheckpointFileListSchema.safeParse({
        ...checkpoint,
        files: [
          {
            relativePath: 'figures/oversized.bin',
            sizeBytes: MANUSCRIPT_CHECKPOINT_MAX_FILE_BYTES + 1,
            textReadable: false,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ReadManuscriptCheckpointFileInputSchema.safeParse({
        projectId: PROJECT_ID,
        manuscriptId: checkpoint.manuscriptId,
        checkpointId: checkpoint.checkpointId,
        relativePath: 'paper/main.tex',
        maxCharacters: 24_001,
      }).success,
    ).toBe(false);
  });

  it('does not inspect the Git worktree until a manuscript has an active workspace binding', async () => {
    const fixture = serviceFixture();

    await fixture.service.create({
      projectId: PROJECT_ID,
      title: 'Unlinked draft',
      rootDocument: 'paper/main.tex',
    });

    expect(fixture.repositoryRevision).not.toHaveBeenCalled();
  });

  it('updates manuscript title and root document with an optimistic version guard', async () => {
    const fixture = serviceFixture();
    const created = await fixture.service.create({
      projectId: PROJECT_ID,
      title: 'Draft title',
      rootDocument: 'wrong/main.tex',
    });
    const manuscript = created.manuscripts[0]!.manuscript;

    const updated = await fixture.service.update({
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      expectedVersion: manuscript.version,
      title: 'Corrected title',
      rootDocument: 'paper/main.tex',
    });

    expect(updated.manuscripts[0]!.manuscript).toMatchObject({
      id: manuscript.id,
      title: 'Corrected title',
      rootDocument: 'paper/main.tex',
      version: manuscript.version + 1,
      createdAt: manuscript.createdAt,
      updatedAt: '2026-08-11T01:02:03.000Z',
    });
    await expect(
      fixture.service.update({
        projectId: PROJECT_ID,
        manuscriptId: manuscript.id,
        expectedVersion: manuscript.version,
        title: 'Stale overwrite',
        rootDocument: 'stale/main.tex',
      }),
    ).rejects.toMatchObject({ code: 'manuscript_conflict' });
    expect(fixture.storage.manuscripts.get(manuscript.id)).toMatchObject({
      title: 'Corrected title',
      rootDocument: 'paper/main.tex',
      version: manuscript.version + 1,
    });
  });

  it('returns the bounded Overleaf URL error before credentials or remote access', async () => {
    const fixture = serviceFixture();
    const created = await fixture.service.create({
      projectId: PROJECT_ID,
      title: 'Invalid remote fixture',
      rootDocument: 'paper/main.tex',
    });
    const manuscript = created.manuscripts[0]!.manuscript;

    await expect(
      fixture.service.connectOverleafGit({
        projectId: PROJECT_ID,
        manuscriptId: manuscript.id,
        expectedManuscriptVersion: manuscript.version,
        providerId: 'overleaf_git',
        remoteUrl: 'https://example.invalid/not-overleaf',
        accessToken: 'fixture-token',
      }),
    ).rejects.toMatchObject({ code: 'overleaf_git_url_invalid' });
    expect(fixture.stageCredential).not.toHaveBeenCalled();
    expect(fixture.inspect).not.toHaveBeenCalled();
  });

  it('keeps multiple manuscripts independent and stores no token in portable records', async () => {
    const fixture = serviceFixture();
    const first = await createAndConnect(fixture);
    const second = await fixture.service.create({
      projectId: PROJECT_ID,
      title: 'Supplement',
      rootDocument: 'supplement/main.tex',
    });

    expect(second.manuscripts).toHaveLength(2);
    expect(first.connection.binding.providerId).toBe('overleaf_git');
    expect(first.connection.binding.authority).toBe('gosu');
    expect(first.connection.syncState).toBe('diverged');
    expect(fixture.stageCredential).toHaveBeenCalledExactlyOnceWith(
      'https://git@git.overleaf.com/0123456789abcdef01234567',
      first.token,
    );
    expect(fixture.commitCredential).toHaveBeenCalledOnce();
    expect(fixture.rollbackCredential).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.storage)).not.toContain(first.token);
    expect(JSON.stringify(first.connection.binding)).not.toContain('overleaf.com');
    expect(() =>
      ManuscriptWorkspaceConnectionSchema.parse({
        ...first.connection,
        workspaceUrl: 'https://git:secret@example.invalid/project',
      }),
    ).toThrow();
  });

  it('restores the previous shared workspace credential when remote verification fails', async () => {
    const fixture = serviceFixture({
      inspectError: new OverleafGitTransportError('overleaf_git_auth_required'),
    });
    const created = await fixture.service.create({
      projectId: PROJECT_ID,
      title: 'Rejected credential fixture',
      rootDocument: 'paper/main.tex',
    });
    const manuscript = created.manuscripts[0]!.manuscript;

    await expect(
      fixture.service.connectOverleafGit({
        projectId: PROJECT_ID,
        manuscriptId: manuscript.id,
        expectedManuscriptVersion: manuscript.version,
        providerId: 'overleaf_git',
        remoteUrl: REMOTE,
        accessToken: 'rejected-fixture-token',
      }),
    ).rejects.toMatchObject({ code: 'overleaf_git_auth_required' });
    expect(fixture.rollbackCredential).toHaveBeenCalledOnce();
    expect(fixture.commitCredential).not.toHaveBeenCalled();
    expect(fixture.storage.connections.size).toBe(0);
  });

  it('keeps a shared workspace credential until its final active manuscript disconnects', async () => {
    const fixture = serviceFixture();
    const first = await createAndConnect(fixture);
    const secondCreated = await fixture.service.create({
      projectId: OTHER_PROJECT_ID,
      title: 'Shared Overleaf manuscript',
      rootDocument: 'paper/main.tex',
    });
    const secondManuscript = secondCreated.manuscripts[0]!.manuscript;
    const secondConnected = await fixture.service.connectOverleafGit({
      projectId: OTHER_PROJECT_ID,
      manuscriptId: secondManuscript.id,
      expectedManuscriptVersion: secondManuscript.version,
      providerId: 'overleaf_git',
      remoteUrl: REMOTE,
      accessToken: 'shared-workspace-fixture-token',
    });
    const secondConnection = secondConnected.manuscripts[0]!.connection!;

    await fixture.service.disconnect({
      projectId: PROJECT_ID,
      manuscriptId: first.manuscript.id,
      bindingId: first.connection.binding.bindingId,
      expectedBindingVersion: first.connection.binding.version,
    });

    expect(fixture.eraseCredential).not.toHaveBeenCalled();
    expect(fixture.storage.credentialCleanupQueue.size).toBe(1);

    await fixture.service.disconnect({
      projectId: OTHER_PROJECT_ID,
      manuscriptId: secondManuscript.id,
      bindingId: secondConnection.binding.bindingId,
      expectedBindingVersion: secondConnection.binding.version,
    });

    expect(fixture.eraseCredential).toHaveBeenCalledExactlyOnceWith(
      'overleaf-git:0123456789abcdef01234567',
    );
    expect(fixture.storage.credentialCleanupQueue.size).toBe(0);
  });

  it('serializes credential staging and provider reads for the same workspace across projects', async () => {
    const fixture = serviceFixture();
    const first = await createAndConnect(fixture);
    const secondCreated = await fixture.service.create({
      projectId: OTHER_PROJECT_ID,
      title: 'Concurrent workspace manuscript',
      rootDocument: 'paper/main.tex',
    });
    const secondManuscript = secondCreated.manuscripts[0]!.manuscript;
    const stageStarted = deferred<void>();
    const replacementCommit = vi.fn(async () => undefined);
    const replacementRollback = vi.fn(async () => undefined);
    const releaseStage = deferred<{
      credentialRef: string;
      commit: typeof replacementCommit;
      rollback: typeof replacementRollback;
    }>();
    fixture.inspect.mockClear();
    fixture.stageCredential.mockImplementationOnce(async () => {
      stageStarted.resolve();
      return releaseStage.promise;
    });

    const connect = fixture.service.connectOverleafGit({
      projectId: OTHER_PROJECT_ID,
      manuscriptId: secondManuscript.id,
      expectedManuscriptVersion: secondManuscript.version,
      providerId: 'overleaf_git',
      remoteUrl: REMOTE,
      accessToken: 'replacement-workspace-fixture-token',
    });
    await stageStarted.promise;

    const inspect = fixture.service.inspect({
      projectId: PROJECT_ID,
      manuscriptId: first.manuscript.id,
      bindingId: first.connection.binding.bindingId,
      expectedBindingVersion: first.connection.binding.version,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(fixture.inspect).not.toHaveBeenCalled();

    releaseStage.resolve({
      credentialRef: 'overleaf-git:0123456789abcdef01234567',
      commit: replacementCommit,
      rollback: replacementRollback,
    });
    await Promise.all([connect, inspect]);
    expect(fixture.inspect).toHaveBeenCalledTimes(2);
  });

  it('retains a failed credential cleanup receipt and retries it safely', async () => {
    const fixture = serviceFixture();
    const connected = await createAndConnect(fixture);
    fixture.eraseCredential.mockRejectedValueOnce(new Error('keychain_busy'));

    await fixture.service.disconnect({
      projectId: PROJECT_ID,
      manuscriptId: connected.manuscript.id,
      bindingId: connected.connection.binding.bindingId,
      expectedBindingVersion: connected.connection.binding.version,
    });

    expect(fixture.storage.credentialCleanupQueue.size).toBe(1);
    await expect(fixture.service.reconcileCredentialCleanupQueue()).resolves.toBe(1);
    expect(fixture.eraseCredential).toHaveBeenCalledTimes(2);
    expect(fixture.storage.credentialCleanupQueue.size).toBe(0);
  });

  it('fetches an immutable checkpoint once and treats duplicate revision fetch as idempotent', async () => {
    const fixture = serviceFixture();
    const { manuscript, connection } = await createAndConnect(fixture);
    const input = {
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      bindingId: connection.binding.bindingId,
      expectedBindingVersion: connection.binding.version,
      expectedProviderRevision: PROVIDER_REVISION,
    };

    const first = await fixture.service.fetchCheckpoint(input);
    const second = await fixture.service.fetchCheckpoint(input);

    expect(first.manuscripts[0]!.connection!.lastCheckpoint).toMatchObject({
      direction: 'fetch',
      providerRevision: PROVIDER_REVISION,
      revisionEnvelopeDigest: `sha256:${'d'.repeat(64)}`,
    });
    expect(second.manuscripts[0]!.connection!.lastCheckpoint?.checkpointId).toBe(
      first.manuscripts[0]!.connection!.lastCheckpoint?.checkpointId,
    );
    expect(fixture.storage.checkpoints.size).toBe(1);
    expect(fixture.fetchCheckpoint).toHaveBeenCalledTimes(1);

    const newerProviderRevision = 'e'.repeat(40);
    fixture.inspect.mockResolvedValueOnce({
      workspaceRevision: newerProviderRevision,
      treeRevision: '',
      revisionEnvelopeDigest: '',
    });
    await fixture.service.inspect({
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      bindingId: connection.binding.bindingId,
      expectedBindingVersion: connection.binding.version,
    });
    const staleRetry = await fixture.service.fetchCheckpoint(input);

    expect(staleRetry.manuscripts[0]!.connection!.lastObservedProviderRevision).toBe(
      newerProviderRevision,
    );
    expect(fixture.fetchCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('lists and reads only the exact latest captured checkpoint with bounded chunks', async () => {
    const fixture = serviceFixture();
    const { manuscript, connection, checkpoint } = await createConnectAndCapture(fixture);
    const identity = {
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      checkpointId: checkpoint.checkpointId,
    };

    await expect(fixture.service.listCheckpointFiles(identity)).resolves.toMatchObject({
      schemaVersion: 1,
      ...identity,
      providerRevision: PROVIDER_REVISION,
      files: [
        { relativePath: 'paper/main.tex', sizeBytes: 128, textReadable: true },
        { relativePath: 'paper/figure.pdf', sizeBytes: 2_048, textReadable: false },
      ],
    });
    expect(fixture.listCheckpointFiles).toHaveBeenCalledExactlyOnceWith(
      connection.binding.bindingId,
      PROVIDER_REVISION,
      'paper/main.tex',
      `sha256:${'d'.repeat(64)}`,
    );

    await expect(
      fixture.service.readCheckpointFile({
        ...identity,
        relativePath: 'paper/main.tex',
        offset: 10,
        maxCharacters: 5,
      }),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      ...identity,
      providerRevision: PROVIDER_REVISION,
      relativePath: 'paper/main.tex',
      offset: 10,
      nextOffset: 15,
      truncated: true,
      content: 'abcde',
    });
    expect(fixture.readCheckpointText).toHaveBeenCalledExactlyOnceWith(
      connection.binding.bindingId,
      PROVIDER_REVISION,
      'paper/main.tex',
      `sha256:${'d'.repeat(64)}`,
      'paper/main.tex',
    );
  });

  it('rejects stale or cross-project checkpoint reads before touching provider artifacts', async () => {
    const fixture = serviceFixture();
    const { manuscript } = await createConnectAndCapture(fixture);

    await expect(
      fixture.service.listCheckpointFiles({
        projectId: PROJECT_ID,
        manuscriptId: manuscript.id,
        checkpointId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'manuscript_checkpoint_not_found' });
    await expect(
      fixture.service.readCheckpointFile({
        projectId: OTHER_PROJECT_ID,
        manuscriptId: manuscript.id,
        checkpointId: randomUUID(),
        relativePath: 'paper/main.tex',
      }),
    ).rejects.toMatchObject({ code: 'manuscript_not_found' });
    expect(fixture.listCheckpointFiles).not.toHaveBeenCalled();
    expect(fixture.readCheckpointText).not.toHaveBeenCalled();
  });

  it('maps bounded checkpoint artifact errors without exposing provider diagnostics', async () => {
    const fixture = serviceFixture();
    const { manuscript, checkpoint } = await createConnectAndCapture(fixture);
    fixture.listCheckpointFiles.mockRejectedValueOnce(
      new OverleafGitTransportError('overleaf_git_checkpoint_tree_unsafe'),
    );
    fixture.readCheckpointText.mockRejectedValueOnce(
      new OverleafGitTransportError('overleaf_git_checkpoint_file_not_text'),
    );
    fixture.readCheckpointText.mockRejectedValueOnce(
      new OverleafGitTransportError('overleaf_git_checkpoint_file_not_found'),
    );
    const identity = {
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      checkpointId: checkpoint.checkpointId,
    };

    await expect(fixture.service.listCheckpointFiles(identity)).rejects.toMatchObject({
      code: 'manuscript_checkpoint_tree_unsafe',
    });
    await expect(
      fixture.service.readCheckpointFile({
        ...identity,
        relativePath: 'paper/figure.pdf',
      }),
    ).rejects.toMatchObject({ code: 'manuscript_checkpoint_file_not_text' });
    await expect(
      fixture.service.readCheckpointFile({
        ...identity,
        relativePath: 'paper/missing.tex',
      }),
    ).rejects.toMatchObject({ code: 'manuscript_checkpoint_file_not_found' });
  });

  it('compiles the exact captured checkpoint and marks a newer observed provider revision', async () => {
    const fixture = serviceFixture();
    const { manuscript, connection, checkpoint } = await createConnectAndCapture(fixture);
    const identity = {
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      checkpointId: checkpoint.checkpointId,
      engine: 'xelatex' as const,
    };

    await expect(fixture.service.compilePdf(identity)).resolves.toMatchObject({
      schemaVersion: 1,
      artifactId: '33333333-3333-4333-8333-333333333333',
      projectId: identity.projectId,
      manuscriptId: identity.manuscriptId,
      checkpointId: identity.checkpointId,
      providerRevision: PROVIDER_REVISION,
      rootDocument: 'paper/main.tex',
      providerAhead: false,
      compiler: {
        kind: 'latexmk',
        displayName: 'Local MacTeX latexmk',
        engine: 'xelatex',
        engineDisplayName: 'XeLaTeX',
      },
      pdfSha256: `sha256:${'e'.repeat(64)}`,
      sizeBytes: 9,
      compiledAt: '2026-08-11T01:02:03.000Z',
    });
    expect(fixture.compilePdf).toHaveBeenCalledExactlyOnceWith(
      connection.binding.bindingId,
      checkpoint,
      'xelatex',
    );

    const storedConnection = fixture.storage.connections.get(manuscript.id)!;
    fixture.storage.connections.set(manuscript.id, {
      ...storedConnection,
      lastObservedProviderRevision: 'f'.repeat(40),
    });
    await expect(fixture.service.compilePdf(identity)).resolves.toMatchObject({
      providerAhead: true,
      checkpointId: checkpoint.checkpointId,
      providerRevision: PROVIDER_REVISION,
    });
  });

  it('maps local PDF compiler failures to a bounded service error', async () => {
    const fixture = serviceFixture();
    const { manuscript, checkpoint } = await createConnectAndCapture(fixture);
    fixture.compilePdf.mockRejectedValueOnce(
      new ManuscriptPdfCompilerError('manuscript_pdf_compile_failed'),
    );

    await expect(
      fixture.service.compilePdf({
        projectId: PROJECT_ID,
        manuscriptId: manuscript.id,
        checkpointId: checkpoint.checkpointId,
        engine: 'lualatex',
      }),
    ).rejects.toMatchObject({ code: 'manuscript_pdf_compile_failed' });
  });

  it('fails closed on a stale provider revision and does not append a checkpoint', async () => {
    const fixture = serviceFixture({
      fetchError: new OverleafGitTransportError('overleaf_git_remote_rewritten'),
    });
    const { manuscript, connection } = await createAndConnect(fixture);

    await expect(
      fixture.service.fetchCheckpoint({
        projectId: PROJECT_ID,
        manuscriptId: manuscript.id,
        bindingId: connection.binding.bindingId,
        expectedBindingVersion: connection.binding.version,
        expectedProviderRevision: PROVIDER_REVISION,
      }),
    ).rejects.toMatchObject({ code: 'overleaf_git_remote_rewritten' });
    expect(fixture.storage.checkpoints.size).toBe(0);
    expect(fixture.storage.connections.get(manuscript.id)?.lastFailureCode).toBe(
      'overleaf_git_remote_rewritten',
    );
    expect(fixture.storage.connections.get(manuscript.id)?.lifecycle).toBe('blocked');
  });

  it('rehydrates a historical missing artifact without requiring it to remain remote HEAD', async () => {
    const fixture = serviceFixture();
    const { manuscript, connection } = await createAndConnect(fixture);
    const input = {
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      bindingId: connection.binding.bindingId,
      expectedBindingVersion: connection.binding.version,
      expectedProviderRevision: PROVIDER_REVISION,
    };
    await fixture.service.fetchCheckpoint(input);
    fixture.hasCheckpoint.mockResolvedValueOnce(false);
    fixture.inspect.mockResolvedValue({
      workspaceRevision: 'e'.repeat(40),
      treeRevision: '',
      revisionEnvelopeDigest: '',
    });

    await fixture.service.fetchCheckpoint(input);

    expect(fixture.fetchCheckpoint).toHaveBeenCalledTimes(1);
    expect(fixture.restoreCheckpoint).toHaveBeenCalledExactlyOnceWith(
      connection.binding.bindingId,
      'https://git@git.overleaf.com/0123456789abcdef01234567',
      'overleaf-git:0123456789abcdef01234567',
      PROVIDER_REVISION,
      'paper/main.tex',
      `sha256:${'d'.repeat(64)}`,
    );
    expect(fixture.storage.checkpoints.size).toBe(1);
  });

  it('keeps checkpoint lineage across a workspace adapter reconnect', async () => {
    const fixture = serviceFixture();
    const { manuscript, connection } = await createAndConnect(fixture);
    const first = await fixture.service.fetchCheckpoint({
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      bindingId: connection.binding.bindingId,
      expectedBindingVersion: connection.binding.version,
      expectedProviderRevision: PROVIDER_REVISION,
    });
    const firstCheckpoint = first.manuscripts[0]!.connection!.lastCheckpoint!;
    await fixture.service.disconnect({
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      bindingId: connection.binding.bindingId,
      expectedBindingVersion: connection.binding.version,
    });

    const nextRevision = 'f'.repeat(40);
    fixture.inspect.mockResolvedValue({
      workspaceRevision: nextRevision,
      treeRevision: '',
      revisionEnvelopeDigest: '',
    });
    fixture.fetchCheckpoint.mockResolvedValue({
      workspaceRevision: nextRevision,
      treeRevision: '1'.repeat(40),
      revisionEnvelopeDigest: `sha256:${'2'.repeat(64)}`,
    });
    const reconnected = await fixture.service.connectOverleafGit({
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      expectedManuscriptVersion: manuscript.version,
      providerId: 'overleaf_git',
      remoteUrl: REMOTE,
      accessToken: 'next-private-token',
    });
    const nextConnection = reconnected.manuscripts[0]!.connection!;
    const fetched = await fixture.service.fetchCheckpoint({
      projectId: PROJECT_ID,
      manuscriptId: manuscript.id,
      bindingId: nextConnection.binding.bindingId,
      expectedBindingVersion: nextConnection.binding.version,
      expectedProviderRevision: nextRevision,
    });

    expect(fetched.manuscripts[0]!.connection!.lastCheckpoint).toMatchObject({
      bindingId: nextConnection.binding.bindingId,
      providerRevision: nextRevision,
      baseCheckpointId: firstCheckpoint.checkpointId,
    });
    expect(fixture.storage.checkpoints.size).toBe(2);
  });

  it('acknowledges a durable artifact purge only after the adapter removes its local mirror', async () => {
    const fixture = serviceFixture();
    const bindingId = randomUUID();
    fixture.storage.artifactPurgeQueue.set(bindingId, {
      bindingId,
      projectId: PROJECT_ID,
      providerId: 'overleaf_git',
      queuedAt: '2026-08-11T01:02:03.000Z',
    });

    await expect(fixture.service.reconcileArtifactPurgeQueue([PROJECT_ID])).resolves.toBe(1);
    expect(fixture.removeBindingArtifacts).toHaveBeenCalledExactlyOnceWith(bindingId);
    expect(fixture.storage.artifactPurgeQueue.size).toBe(0);

    const retainedBindingId = randomUUID();
    fixture.storage.artifactPurgeQueue.set(retainedBindingId, {
      bindingId: retainedBindingId,
      projectId: PROJECT_ID,
      providerId: 'overleaf_git',
      queuedAt: '2026-08-11T01:02:04.000Z',
    });
    fixture.removeBindingArtifacts.mockRejectedValueOnce(new Error('filesystem_busy'));

    await expect(fixture.service.reconcileArtifactPurgeQueue([PROJECT_ID])).resolves.toBe(0);
    expect(fixture.storage.artifactPurgeQueue.has(retainedBindingId)).toBe(true);
  });

  it('continues past an unavailable provider without starving later artifact cleanup', async () => {
    const fixture = serviceFixture();
    const unavailableBindingId = randomUUID();
    const overleafBindingId = randomUUID();
    fixture.storage.artifactPurgeQueue.set(unavailableBindingId, {
      bindingId: unavailableBindingId,
      projectId: PROJECT_ID,
      providerId: 'future_cloud_engine',
      queuedAt: '2026-08-11T01:02:03.000Z',
    });
    fixture.storage.artifactPurgeQueue.set(overleafBindingId, {
      bindingId: overleafBindingId,
      projectId: PROJECT_ID,
      providerId: 'overleaf_git',
      queuedAt: '2026-08-11T01:02:04.000Z',
    });

    await expect(fixture.service.reconcileArtifactPurgeQueue([PROJECT_ID])).resolves.toBe(1);

    expect(fixture.storage.artifactPurgeQueue.has(unavailableBindingId)).toBe(true);
    expect(fixture.storage.artifactPurgeQueue.has(overleafBindingId)).toBe(false);
    expect(fixture.removeBindingArtifacts).toHaveBeenCalledExactlyOnceWith(overleafBindingId);
  });
});
