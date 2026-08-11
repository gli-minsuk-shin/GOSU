import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  GitCommandError,
  createGitCommandRunner,
  type GitCommandRunner,
} from './git-command-runner';

const OVERLEAF_GIT_HOST = 'git.overleaf.com';
const OVERLEAF_WEB_HOST = 'www.overleaf.com';
const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const OVERLEAF_WORKSPACE_ID = /^[0-9a-f]{24}$/u;
const GOSU_BINDING_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEFAULT_MAX_MIRROR_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_AGGREGATE_BYTES = 1024 * 1024 * 1024;

export type OverleafGitRemote = Readonly<{
  workspaceId: string;
  remoteUrl: string;
  webUrl: string;
}>;

export type OverleafGitCheckpointObservation = Readonly<{
  workspaceRevision: string;
  treeRevision: string;
  revisionEnvelopeDigest: string;
}>;

type OverleafGitCredentialPort = Readonly<{
  readByReference(credentialRef: string, expectedWorkspaceId: string): Promise<string>;
}>;

export type OverleafGitTransportErrorCode =
  | 'overleaf_git_url_invalid'
  | 'overleaf_git_unavailable'
  | 'overleaf_git_auth_required'
  | 'overleaf_git_project_not_found'
  | 'overleaf_git_default_branch_missing'
  | 'overleaf_git_remote_rewritten'
  | 'overleaf_git_root_document_missing'
  | 'overleaf_git_checkpoint_too_large'
  | 'overleaf_git_response_invalid';

export class OverleafGitTransportError extends Error {
  constructor(readonly code: OverleafGitTransportErrorCode) {
    super(code);
    this.name = 'OverleafGitTransportError';
  }
}

function mapGitError(error: unknown) {
  if (!(error instanceof GitCommandError)) {
    return new OverleafGitTransportError('overleaf_git_unavailable');
  }
  if (error.kind === 'auth') {
    return new OverleafGitTransportError('overleaf_git_auth_required');
  }
  if (error.kind === 'conflict') {
    return new OverleafGitTransportError('overleaf_git_remote_rewritten');
  }
  return new OverleafGitTransportError('overleaf_git_unavailable');
}

export function parseOverleafGitRemote(value: string): OverleafGitRemote {
  const candidate = value.trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new OverleafGitTransportError('overleaf_git_url_invalid');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLocaleLowerCase('en-US') !== OVERLEAF_GIT_HOST ||
    (url.username !== '' && url.username !== 'git') ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new OverleafGitTransportError('overleaf_git_url_invalid');
  }
  const workspaceId = url.pathname.replace(/^\/+|\/+$/gu, '').replace(/\.git$/u, '');
  if (!OVERLEAF_WORKSPACE_ID.test(workspaceId)) {
    throw new OverleafGitTransportError('overleaf_git_url_invalid');
  }
  return {
    workspaceId,
    remoteUrl: `https://git@${OVERLEAF_GIT_HOST}/${workspaceId}`,
    webUrl: `https://${OVERLEAF_WEB_HOST}/project/${workspaceId}`,
  };
}

function parseAdvertisedHead(output: string) {
  const lines = output.trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    throw new OverleafGitTransportError('overleaf_git_default_branch_missing');
  }
  if (lines.length !== 1) {
    throw new OverleafGitTransportError('overleaf_git_response_invalid');
  }
  const [revision, ref, ...remainder] = lines[0]!.trim().split(/\s+/u);
  if (
    !revision ||
    !FULL_GIT_OBJECT_ID.test(revision) ||
    ref !== 'refs/heads/master' ||
    remainder.length !== 0
  ) {
    throw new OverleafGitTransportError('overleaf_git_response_invalid');
  }
  return revision;
}

function checkpointRef(revision: string) {
  return `refs/gosu/checkpoints/${revision}`;
}

function revisionEnvelopeDigest(revision: string, treeRevision: string) {
  return `sha256:${createHash('sha256')
    .update(`overleaf_git\0${revision}\0${treeRevision}`, 'utf8')
    .digest('hex')}`;
}

export class OverleafGitTransport {
  private readonly rootDirectory: () => string;
  private readonly runGit: GitCommandRunner;
  private readonly credentials: OverleafGitCredentialPort;
  private readonly maxMirrorBytes: number;
  private readonly maxAggregateBytes: number;

  constructor(
    options: Readonly<{
      rootDirectory: () => string;
      credentials: OverleafGitCredentialPort;
      runGit?: GitCommandRunner;
      maxMirrorBytes?: number;
      maxAggregateBytes?: number;
    }>,
  ) {
    this.rootDirectory = options.rootDirectory;
    this.credentials = options.credentials;
    this.runGit = options.runGit ?? createGitCommandRunner();
    this.maxMirrorBytes = options.maxMirrorBytes ?? DEFAULT_MAX_MIRROR_BYTES;
    this.maxAggregateBytes = options.maxAggregateBytes ?? DEFAULT_MAX_AGGREGATE_BYTES;
    if (!Number.isSafeInteger(this.maxMirrorBytes) || this.maxMirrorBytes < 1) {
      throw new Error('overleaf_git_mirror_limit_invalid');
    }
    if (!Number.isSafeInteger(this.maxAggregateBytes) || this.maxAggregateBytes < 1) {
      throw new Error('overleaf_git_aggregate_limit_invalid');
    }
  }

  async inspect(
    remoteValue: string,
    credentialRef: string,
  ): Promise<OverleafGitCheckpointObservation> {
    const remote = parseOverleafGitRemote(remoteValue);
    const root = this.rootDirectory();
    await mkdir(root, { recursive: true, mode: 0o700 });
    try {
      const output = await this.runGit(
        root,
        ['ls-remote', '--refs', remote.remoteUrl, 'refs/heads/master'],
        {
          network: true,
          credential: await this.gitCredential(remote, credentialRef),
          timeoutMs: 30_000,
          maxBytes: 16 * 1024,
        },
      );
      const workspaceRevision = parseAdvertisedHead(output);
      return {
        workspaceRevision,
        // The tree is intentionally unknown until an explicit fetch. Keeping this deterministic
        // prevents a status check from silently downloading manuscript content.
        treeRevision: '',
        revisionEnvelopeDigest: '',
      };
    } catch (error) {
      if (error instanceof OverleafGitTransportError) throw error;
      if (error instanceof Error && error.message === 'overleaf_keychain_unavailable') throw error;
      throw mapGitError(error);
    }
  }

  async fetchCheckpoint(
    bindingId: string,
    remoteValue: string,
    credentialRef: string,
    expectedWorkspaceRevision?: string,
    rootDocument?: string,
  ): Promise<OverleafGitCheckpointObservation> {
    const remote = parseOverleafGitRemote(remoteValue);
    const observed = await this.inspect(remote.remoteUrl, credentialRef);
    if (
      expectedWorkspaceRevision !== undefined &&
      observed.workspaceRevision !== expectedWorkspaceRevision
    ) {
      throw new OverleafGitTransportError('overleaf_git_remote_rewritten');
    }
    return this.fetchExactRevision(
      bindingId,
      remote,
      credentialRef,
      observed.workspaceRevision,
      rootDocument,
    );
  }

  async restoreCheckpoint(
    bindingId: string,
    remoteValue: string,
    credentialRef: string,
    workspaceRevision: string,
    rootDocument: string,
    expectedRevisionEnvelopeDigest: string,
  ) {
    if (!FULL_GIT_OBJECT_ID.test(workspaceRevision)) {
      throw new OverleafGitTransportError('overleaf_git_response_invalid');
    }
    await this.fetchExactRevision(
      bindingId,
      parseOverleafGitRemote(remoteValue),
      credentialRef,
      workspaceRevision,
      rootDocument,
      expectedRevisionEnvelopeDigest,
    );
  }

  async hasCheckpoint(
    bindingId: string,
    revision: string,
    rootDocument: string,
    expectedRevisionEnvelopeDigest: string,
  ) {
    if (!FULL_GIT_OBJECT_ID.test(revision)) return false;
    const mirror = this.mirrorPath(bindingId);
    try {
      const ref = checkpointRef(revision);
      const stored = (
        await this.runGit(mirror, ['rev-parse', '--verify', `${ref}^{commit}`], {
          maxBytes: 4_096,
        })
      ).trim();
      if (stored !== revision) return false;
      const treeRevision = (
        await this.runGit(mirror, ['rev-parse', '--verify', `${ref}^{tree}`], {
          maxBytes: 4_096,
        })
      ).trim();
      if (!FULL_GIT_OBJECT_ID.test(treeRevision)) return false;
      await this.verifyRootDocument(mirror, ref, rootDocument);
      await this.verifyCheckpointConnectivity(mirror, ref);
      return revisionEnvelopeDigest(stored, treeRevision) === expectedRevisionEnvelopeDigest;
    } catch {
      return false;
    }
  }

  async removeBindingArtifacts(bindingId: string) {
    await rm(this.bindingDirectory(bindingId), { recursive: true, force: true });
  }

  private async fetchExactRevision(
    bindingId: string,
    remote: OverleafGitRemote,
    credentialRef: string,
    workspaceRevision: string,
    rootDocument?: string,
    expectedRevisionEnvelopeDigest?: string,
  ): Promise<OverleafGitCheckpointObservation> {
    const mirror = this.mirrorPath(bindingId);
    await this.ensureBareMirror(mirror);
    await this.requireStorageWithinLimits(mirror);
    const incomingRef = `refs/gosu/incoming/${randomUUID()}`;
    let fetchAttempted = false;
    let pinned = false;
    try {
      fetchAttempted = true;
      await this.runGit(
        mirror,
        [
          'fetch',
          '--depth=1',
          '--no-tags',
          '--no-recurse-submodules',
          '--no-write-fetch-head',
          remote.remoteUrl,
          `${workspaceRevision}:${incomingRef}`,
        ],
        {
          network: true,
          credential: await this.gitCredential(remote, credentialRef),
          timeoutMs: 120_000,
          maxBytes: 2 * 1024 * 1024,
        },
      );
      const fetchedRevision = (
        await this.runGit(mirror, ['rev-parse', '--verify', `${incomingRef}^{commit}`], {
          maxBytes: 4_096,
        })
      ).trim();
      if (fetchedRevision !== workspaceRevision) {
        throw new OverleafGitTransportError('overleaf_git_response_invalid');
      }
      const treeRevision = (
        await this.runGit(mirror, ['rev-parse', '--verify', `${incomingRef}^{tree}`], {
          maxBytes: 4_096,
        })
      ).trim();
      if (!FULL_GIT_OBJECT_ID.test(treeRevision)) {
        throw new OverleafGitTransportError('overleaf_git_response_invalid');
      }
      if (rootDocument) {
        await this.verifyRootDocument(mirror, incomingRef, rootDocument);
      }
      await this.verifyCheckpointConnectivity(mirror, incomingRef);
      if (
        (await this.directoryBytesUntil(mirror, this.maxMirrorBytes)) > this.maxMirrorBytes ||
        (await this.directoryBytesUntil(this.rootDirectory(), this.maxAggregateBytes)) >
          this.maxAggregateBytes
      ) {
        throw new OverleafGitTransportError('overleaf_git_checkpoint_too_large');
      }
      const envelope = revisionEnvelopeDigest(fetchedRevision, treeRevision);
      if (
        expectedRevisionEnvelopeDigest !== undefined &&
        envelope !== expectedRevisionEnvelopeDigest
      ) {
        throw new OverleafGitTransportError('overleaf_git_response_invalid');
      }
      await this.pinCheckpoint(mirror, fetchedRevision, incomingRef);
      pinned = true;
      return {
        workspaceRevision: fetchedRevision,
        treeRevision,
        revisionEnvelopeDigest: envelope,
      };
    } catch (error) {
      if (fetchAttempted && !pinned) {
        try {
          await this.discardIncomingObjects(mirror, incomingRef);
        } catch {
          throw new OverleafGitTransportError('overleaf_git_unavailable');
        }
      }
      if (error instanceof OverleafGitTransportError) throw error;
      if (error instanceof Error && error.message === 'overleaf_keychain_unavailable') throw error;
      throw mapGitError(error);
    } finally {
      await this.runGit(mirror, ['update-ref', '-d', incomingRef]).catch(() => undefined);
    }
  }

  private async ensureBareMirror(mirror: string) {
    await mkdir(dirname(mirror), { recursive: true, mode: 0o700 });
    try {
      const bare = (await this.runGit(mirror, ['rev-parse', '--is-bare-repository'])).trim();
      if (bare !== 'true') {
        throw new OverleafGitTransportError('overleaf_git_response_invalid');
      }
    } catch (error) {
      if (error instanceof OverleafGitTransportError) throw error;
      await this.runGit(dirname(mirror), ['init', '--bare', '--initial-branch=master', mirror], {
        maxBytes: 64 * 1024,
      }).catch((initError) => {
        throw mapGitError(initError);
      });
    }
  }

  private mirrorPath(bindingId: string) {
    return join(this.bindingDirectory(bindingId), 'mirror.git');
  }

  private bindingDirectory(bindingId: string) {
    if (!GOSU_BINDING_ID.test(bindingId)) {
      throw new OverleafGitTransportError('overleaf_git_response_invalid');
    }
    return join(this.rootDirectory(), bindingId);
  }

  private async requireStorageWithinLimits(mirror: string) {
    if (
      (await this.directoryBytesUntil(mirror, this.maxMirrorBytes)) > this.maxMirrorBytes ||
      (await this.directoryBytesUntil(this.rootDirectory(), this.maxAggregateBytes)) >
        this.maxAggregateBytes
    ) {
      throw new OverleafGitTransportError('overleaf_git_checkpoint_too_large');
    }
  }

  private async directoryBytesUntil(path: string, limit: number): Promise<number> {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
    let bytes = 0;
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        bytes += await this.directoryBytesUntil(child, limit);
      } else {
        bytes += (await lstat(child)).size;
      }
      if (bytes > limit) return bytes;
    }
    return bytes;
  }

  private async discardIncomingObjects(mirror: string, incomingRef: string) {
    await this.runGit(mirror, ['update-ref', '-d', incomingRef]);
    await this.runGit(mirror, ['reflog', 'expire', '--expire=now', '--all']);
    await this.runGit(mirror, ['gc', '--prune=now']);
  }

  private async pinCheckpoint(mirror: string, revision: string, incomingRef: string) {
    const target = checkpointRef(revision);
    const existing = await this.runGit(mirror, ['rev-parse', '--verify', target], {
      maxBytes: 4_096,
    }).catch(() => '');
    if (existing.trim() === revision) return;
    if (existing.trim() !== '') {
      throw new OverleafGitTransportError('overleaf_git_response_invalid');
    }
    await this.runGit(mirror, [
      'update-ref',
      '--no-deref',
      target,
      incomingRef,
      '0'.repeat(revision.length),
    ]);
  }

  private async verifyRootDocument(mirror: string, revisionRef: string, rootDocument: string) {
    const output = await this.runGit(
      mirror,
      ['ls-tree', '-z', '--full-tree', revisionRef, '--', rootDocument],
      { maxBytes: 8 * 1024 },
    );
    const match = output.match(/^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)\0$/u);
    if (!match || match[3] !== rootDocument) {
      throw new OverleafGitTransportError('overleaf_git_root_document_missing');
    }
    await this.runGit(mirror, ['cat-file', '-e', `${match[2]}^{blob}`], { maxBytes: 4_096 });
  }

  private async verifyCheckpointConnectivity(mirror: string, revisionRef: string) {
    await this.runGit(
      mirror,
      ['fsck', '--connectivity-only', '--no-dangling', `${revisionRef}^{commit}`],
      { timeoutMs: 30_000, maxBytes: 256 * 1024 },
    );
  }

  private async gitCredential(remote: OverleafGitRemote, credentialRef: string) {
    return {
      username: 'git',
      password: await this.credentials.readByReference(credentialRef, remote.workspaceId),
      scopeUrl: remote.remoteUrl,
    } as const;
  }
}
