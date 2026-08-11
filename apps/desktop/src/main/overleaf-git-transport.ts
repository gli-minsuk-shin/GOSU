import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

import {
  GitCommandError,
  createGitCommandRunner,
  type GitCommandRunner,
} from './git-command-runner';
import {
  GitBlobBatchError,
  createGitBlobBatchReader,
  type GitBlobBatchReader,
} from './git-blob-batch-reader';

const OVERLEAF_GIT_HOST = 'git.overleaf.com';
const OVERLEAF_WEB_HOST = 'www.overleaf.com';
const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const OVERLEAF_WORKSPACE_ID = /^[0-9a-f]{24}$/u;
const GOSU_BINDING_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STALE_ARCHIVE_DIRECTORY =
  /^\.gosu-archive-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEFAULT_MAX_MIRROR_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_AGGREGATE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_FILES = 10_000;
const DEFAULT_MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_TREE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_PATH_BYTES = 1_024;
const MAX_TREE_LIST_BYTES = 16 * 1024 * 1024;
const REVISION_ENVELOPE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BLOCKED_SOURCE_SEGMENTS = new Set(['.git', '.ssh', '.gnupg', '.aws']);
const BLOCKED_SOURCE_NAMES = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  '__proto__',
  'authorized_keys',
  'constructor',
  'credentials',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'known_hosts',
  'prototype',
]);
const BLOCKED_SOURCE_SUFFIXES = ['.key', '.p12', '.pem', '.pfx', '.ppk'] as const;

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

export type OverleafGitCheckpointFile = Readonly<{
  relativePath: string;
  sizeBytes: number;
  textReadable: boolean;
}>;

type VerifiedCheckpointFile = Readonly<{
  path: string;
  byteSize: number;
  blobRevision: string;
  executable: boolean;
}>;

export type OverleafGitMaterializedTree = Readonly<{
  destinationDirectory: string;
  fileCount: number;
  totalBytes: number;
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
  | 'overleaf_git_checkpoint_file_not_found'
  | 'overleaf_git_checkpoint_file_not_text'
  | 'overleaf_git_checkpoint_tree_unsafe'
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

function responseInvalid(): never {
  throw new OverleafGitTransportError('overleaf_git_response_invalid');
}

function checkpointTooLarge(): never {
  throw new OverleafGitTransportError('overleaf_git_checkpoint_too_large');
}

function checkpointTreeUnsafe(): never {
  throw new OverleafGitTransportError('overleaf_git_checkpoint_tree_unsafe');
}

function hasUnsafePathCharacter(value: string) {
  if (/\p{Cf}|\p{Cs}/u.test(value)) return true;
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function validateCheckpointPath(value: string) {
  if (
    value.length < 1 ||
    Buffer.byteLength(value, 'utf8') > MAX_SOURCE_PATH_BYTES ||
    value !== value.trim() ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    value.includes('\ufffd') ||
    /^[A-Za-z]:/u.test(value) ||
    hasUnsafePathCharacter(value)
  ) {
    checkpointTreeUnsafe();
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    checkpointTreeUnsafe();
  }
  for (const segment of segments) {
    const normalized = segment.normalize('NFC').toLocaleLowerCase('en-US');
    if (
      BLOCKED_SOURCE_SEGMENTS.has(normalized) ||
      BLOCKED_SOURCE_NAMES.has(normalized) ||
      normalized === '.env' ||
      normalized.startsWith('.env.') ||
      normalized.startsWith('.gosu-') ||
      BLOCKED_SOURCE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
    ) {
      checkpointTreeUnsafe();
    }
  }
  return segments;
}

function collisionKey(value: string) {
  return value.normalize('NFC').toLocaleLowerCase('en-US');
}

function gitBlobRevision(bytes: Uint8Array, objectIdLength: number) {
  const algorithm = objectIdLength === 40 ? 'sha1' : objectIdLength === 64 ? 'sha256' : null;
  if (!algorithm) responseInvalid();
  return createHash(algorithm)
    .update(`blob ${bytes.byteLength}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function sourceDirectories(files: readonly VerifiedCheckpointFile[]) {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }
  return directories;
}

function textReadableSourcePath(path: string) {
  return /(?:^|\.)((?:bib|biblatex|cfg|cls|csv|def|dtx|ins|json|ldf|lua|md|sty|tex|txt|ya?ml))$/iu.test(
    path,
  );
}

export class OverleafGitTransport {
  private readonly rootDirectory: () => string;
  private readonly runGit: GitCommandRunner;
  private readonly readGitBlobs: GitBlobBatchReader;
  private readonly credentials: OverleafGitCredentialPort;
  private readonly maxMirrorBytes: number;
  private readonly maxAggregateBytes: number;
  private readonly maxSourceFiles: number;
  private readonly maxSourceFileBytes: number;
  private readonly maxSourceTreeBytes: number;
  private readonly maxSourceTextBytes: number;

  constructor(
    options: Readonly<{
      rootDirectory: () => string;
      credentials: OverleafGitCredentialPort;
      runGit?: GitCommandRunner;
      readGitBlobs?: GitBlobBatchReader;
      maxMirrorBytes?: number;
      maxAggregateBytes?: number;
      maxSourceFiles?: number;
      maxSourceFileBytes?: number;
      maxSourceTreeBytes?: number;
      maxSourceTextBytes?: number;
    }>,
  ) {
    this.rootDirectory = options.rootDirectory;
    this.credentials = options.credentials;
    this.runGit = options.runGit ?? createGitCommandRunner();
    this.readGitBlobs = options.readGitBlobs ?? createGitBlobBatchReader();
    this.maxMirrorBytes = options.maxMirrorBytes ?? DEFAULT_MAX_MIRROR_BYTES;
    this.maxAggregateBytes = options.maxAggregateBytes ?? DEFAULT_MAX_AGGREGATE_BYTES;
    this.maxSourceFiles = options.maxSourceFiles ?? DEFAULT_MAX_SOURCE_FILES;
    this.maxSourceFileBytes = options.maxSourceFileBytes ?? DEFAULT_MAX_SOURCE_FILE_BYTES;
    this.maxSourceTreeBytes = options.maxSourceTreeBytes ?? DEFAULT_MAX_SOURCE_TREE_BYTES;
    this.maxSourceTextBytes = options.maxSourceTextBytes ?? DEFAULT_MAX_SOURCE_TEXT_BYTES;
    if (!Number.isSafeInteger(this.maxMirrorBytes) || this.maxMirrorBytes < 1) {
      throw new Error('overleaf_git_mirror_limit_invalid');
    }
    if (!Number.isSafeInteger(this.maxAggregateBytes) || this.maxAggregateBytes < 1) {
      throw new Error('overleaf_git_aggregate_limit_invalid');
    }
    if (!Number.isSafeInteger(this.maxSourceFiles) || this.maxSourceFiles < 1) {
      throw new Error('overleaf_git_source_file_count_limit_invalid');
    }
    if (!Number.isSafeInteger(this.maxSourceFileBytes) || this.maxSourceFileBytes < 1) {
      throw new Error('overleaf_git_source_file_limit_invalid');
    }
    if (!Number.isSafeInteger(this.maxSourceTreeBytes) || this.maxSourceTreeBytes < 1) {
      throw new Error('overleaf_git_source_tree_limit_invalid');
    }
    if (!Number.isSafeInteger(this.maxSourceTextBytes) || this.maxSourceTextBytes < 1) {
      throw new Error('overleaf_git_source_text_limit_invalid');
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

  /**
   * Removes only abandoned legacy archive staging directories created by older builds.
   *
   * Binding directories, checkpoint mirrors, files, symlinks and any name outside the exact
   * GOSU staging pattern are preserved. Current builds read exact blob objects without archives,
   * but the application still performs this bounded migration cleanup once at startup.
   */
  async reconcileStaleArchives(): Promise<void> {
    const root = this.rootDirectory();
    if (!isAbsolute(root)) responseInvalid();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const canonicalRoot = await realpath(root);
    const bindings = await readdir(canonicalRoot, { withFileTypes: true });
    for (const binding of bindings) {
      if (!binding.isDirectory() || !GOSU_BINDING_ID.test(binding.name)) continue;
      const bindingPath = join(canonicalRoot, binding.name);
      const bindingStat = await lstat(bindingPath).catch(() => null);
      if (!bindingStat?.isDirectory() || bindingStat.isSymbolicLink()) continue;
      const canonicalBinding = await realpath(bindingPath).catch(() => null);
      if (
        !canonicalBinding ||
        dirname(canonicalBinding) !== canonicalRoot ||
        basename(canonicalBinding) !== binding.name
      ) {
        continue;
      }
      const entries = await readdir(canonicalBinding, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || !STALE_ARCHIVE_DIRECTORY.test(entry.name)) continue;
        const archivePath = join(canonicalBinding, entry.name);
        const archiveStat = await lstat(archivePath).catch(() => null);
        if (!archiveStat?.isDirectory() || archiveStat.isSymbolicLink()) continue;
        const canonicalArchive = await realpath(archivePath).catch(() => null);
        if (
          !canonicalArchive ||
          dirname(canonicalArchive) !== canonicalBinding ||
          basename(canonicalArchive) !== entry.name
        ) {
          continue;
        }
        await rm(canonicalArchive, { recursive: true, force: true });
      }
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

  async listCheckpointFiles(
    bindingId: string,
    revision: string,
    rootDocument: string,
    expectedRevisionEnvelopeDigest: string,
  ): Promise<readonly OverleafGitCheckpointFile[]> {
    const checkpoint = await this.requireVerifiedCheckpoint(
      bindingId,
      revision,
      rootDocument,
      expectedRevisionEnvelopeDigest,
    );
    return checkpoint.files.map((file) => ({
      relativePath: file.path,
      sizeBytes: file.byteSize,
      textReadable: file.byteSize <= this.maxSourceTextBytes && textReadableSourcePath(file.path),
    }));
  }

  async readCheckpointText(
    bindingId: string,
    revision: string,
    rootDocument: string,
    expectedRevisionEnvelopeDigest: string,
    filePath: string,
  ): Promise<string> {
    validateCheckpointPath(filePath);
    const checkpoint = await this.requireVerifiedCheckpoint(
      bindingId,
      revision,
      rootDocument,
      expectedRevisionEnvelopeDigest,
    );
    const file = checkpoint.files.find((candidate) => candidate.path === filePath);
    if (!file) {
      throw new OverleafGitTransportError('overleaf_git_checkpoint_file_not_found');
    }
    if (file.byteSize > this.maxSourceTextBytes || !textReadableSourcePath(file.path)) {
      throw new OverleafGitTransportError('overleaf_git_checkpoint_file_not_text');
    }
    const blobs = await this.readCheckpointBlobs(checkpoint.mirror, [file]);
    const bytes = blobs.get(file.blobRevision);
    if (!bytes) responseInvalid();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new OverleafGitTransportError('overleaf_git_checkpoint_file_not_text');
    }
  }

  async materializeCheckpoint(
    bindingId: string,
    revision: string,
    rootDocument: string,
    expectedRevisionEnvelopeDigest: string,
    destinationDirectory: string,
  ): Promise<OverleafGitMaterializedTree> {
    const destination = await this.requireEmptyDestination(destinationDirectory);
    const checkpoint = await this.requireVerifiedCheckpoint(
      bindingId,
      revision,
      rootDocument,
      expectedRevisionEnvelopeDigest,
    );
    const blobs = await this.readCheckpointBlobs(checkpoint.mirror, checkpoint.files);
    const directories = [...sourceDirectories(checkpoint.files)].sort((left, right) => {
      const depth = left.split('/').length - right.split('/').length;
      return depth === 0 ? left.localeCompare(right, 'en-US') : depth;
    });
    for (const directory of directories) {
      const path = join(destination, ...directory.split('/'));
      await mkdir(path, { mode: 0o700 });
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) responseInvalid();
    }
    for (const file of checkpoint.files) {
      const bytes = blobs.get(file.blobRevision);
      if (!bytes) responseInvalid();
      const destinationPath = join(destination, ...file.path.split('/'));
      const handle = await open(
        destinationPath,
        fsConstants.O_WRONLY |
          fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          (fsConstants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.size !== file.byteSize) responseInvalid();
      } finally {
        await handle.close();
      }
    }
    return {
      destinationDirectory: destination,
      fileCount: checkpoint.files.length,
      totalBytes: checkpoint.files.reduce((sum, file) => sum + file.byteSize, 0),
    };
  }

  async removeBindingArtifacts(bindingId: string) {
    await rm(this.bindingDirectory(bindingId), { recursive: true, force: true });
  }

  private async requireVerifiedCheckpoint(
    bindingId: string,
    revision: string,
    rootDocument: string,
    expectedRevisionEnvelopeDigest: string,
  ) {
    if (
      !FULL_GIT_OBJECT_ID.test(revision) ||
      !REVISION_ENVELOPE_DIGEST.test(expectedRevisionEnvelopeDigest)
    ) {
      responseInvalid();
    }
    validateCheckpointPath(rootDocument);
    const mirror = this.mirrorPath(bindingId);
    const revisionRef = checkpointRef(revision);
    try {
      const storedRevision = (
        await this.runGit(mirror, ['rev-parse', '--verify', `${revisionRef}^{commit}`], {
          maxBytes: 4_096,
        })
      ).trim();
      if (storedRevision !== revision) responseInvalid();
      const treeRevision = (
        await this.runGit(mirror, ['rev-parse', '--verify', `${storedRevision}^{tree}`], {
          maxBytes: 4_096,
        })
      ).trim();
      if (
        !FULL_GIT_OBJECT_ID.test(treeRevision) ||
        revisionEnvelopeDigest(storedRevision, treeRevision) !== expectedRevisionEnvelopeDigest
      ) {
        responseInvalid();
      }
      await this.verifyRootDocument(mirror, storedRevision, rootDocument);
      await this.verifyCheckpointConnectivity(mirror, storedRevision);
      const files = await this.readCheckpointTree(mirror, storedRevision);
      if (!files.some((file) => file.path === rootDocument)) {
        throw new OverleafGitTransportError('overleaf_git_root_document_missing');
      }
      return { mirror, files } as const;
    } catch (error) {
      if (error instanceof OverleafGitTransportError) throw error;
      if (error instanceof GitCommandError && error.kind === 'output_too_large') {
        checkpointTooLarge();
      }
      throw mapGitError(error);
    }
  }

  private async readCheckpointTree(mirror: string, revisionRef: string) {
    const output = await this.runGit(
      mirror,
      ['ls-tree', '-r', '-z', '--full-tree', '--long', revisionRef],
      { maxBytes: MAX_TREE_LIST_BYTES },
    );
    if (!output.endsWith('\0')) responseInvalid();
    const records = output.slice(0, -1).split('\0');
    if (records.length > this.maxSourceFiles) checkpointTooLarge();
    const files: VerifiedCheckpointFile[] = [];
    const collisionEntries = new Map<
      string,
      Readonly<{ path: string; kind: 'directory' | 'file' }>
    >();
    let totalBytes = 0;
    for (const record of records) {
      const separator = record.indexOf('\t');
      if (separator < 1) responseInvalid();
      const header = record.slice(0, separator);
      const path = record.slice(separator + 1);
      const match = header.match(
        /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +(0|[1-9][0-9]*|-)$/u,
      );
      if (!match || (match[1] !== '100644' && match[1] !== '100755') || match[2] !== 'blob') {
        checkpointTreeUnsafe();
      }
      const byteSize = Number(match[4]);
      if (!Number.isSafeInteger(byteSize) || byteSize < 0) responseInvalid();
      if (byteSize > this.maxSourceFileBytes) checkpointTooLarge();
      totalBytes += byteSize;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > this.maxSourceTreeBytes) {
        checkpointTooLarge();
      }
      const segments = validateCheckpointPath(path);
      for (let index = 0; index < segments.length; index += 1) {
        const prefix = segments.slice(0, index + 1).join('/');
        const kind = index === segments.length - 1 ? 'file' : 'directory';
        const key = collisionKey(prefix);
        const existing = collisionEntries.get(key);
        if (existing && (existing.path !== prefix || existing.kind !== kind || kind === 'file')) {
          checkpointTreeUnsafe();
        }
        collisionEntries.set(key, { path: prefix, kind });
      }
      files.push({
        path,
        byteSize,
        blobRevision: match[3]!,
        executable: match[1] === '100755',
      });
    }
    return files.sort((left, right) => left.path.localeCompare(right.path, 'en-US'));
  }

  private async readCheckpointBlobs(
    mirror: string,
    expectedFiles: readonly VerifiedCheckpointFile[],
  ) {
    if (expectedFiles.length < 1) responseInvalid();
    const expectedByObject = new Map<string, number>();
    for (const file of expectedFiles) {
      const existingSize = expectedByObject.get(file.blobRevision);
      if (existingSize !== undefined && existingSize !== file.byteSize) responseInvalid();
      expectedByObject.set(file.blobRevision, file.byteSize);
    }
    const expectedTotalBytes = [...expectedByObject.values()].reduce((sum, size) => sum + size, 0);
    if (!Number.isSafeInteger(expectedTotalBytes) || expectedTotalBytes > this.maxSourceTreeBytes) {
      checkpointTooLarge();
    }
    try {
      const blobs = await this.readGitBlobs(
        mirror,
        [...expectedByObject].map(([objectId, expectedSize]) => ({ objectId, expectedSize })),
        {
          maxObjects: this.maxSourceFiles,
          maxObjectBytes: this.maxSourceFileBytes,
          maxTotalBytes: this.maxSourceTreeBytes,
          timeoutMs: 30_000,
        },
      );
      if (blobs.size !== expectedByObject.size) checkpointTreeUnsafe();
      for (const [objectId, expectedSize] of expectedByObject) {
        const bytes = blobs.get(objectId);
        if (
          !bytes ||
          bytes.byteLength !== expectedSize ||
          gitBlobRevision(bytes, objectId.length) !== objectId
        ) {
          checkpointTreeUnsafe();
        }
      }
      return blobs;
    } catch (error) {
      if (error instanceof OverleafGitTransportError) throw error;
      if (error instanceof GitBlobBatchError) {
        if (error.kind === 'too_large') {
          checkpointTooLarge();
        }
        if (error.kind === 'invalid') {
          checkpointTreeUnsafe();
        }
      }
      throw new OverleafGitTransportError('overleaf_git_unavailable');
    }
  }

  private async requireEmptyDestination(destinationDirectory: string) {
    if (!isAbsolute(destinationDirectory)) responseInvalid();
    const destination = resolve(destinationDirectory);
    const transportRoot = resolve(this.rootDirectory());
    if (
      destination === sep ||
      destination === transportRoot ||
      destination.startsWith(`${transportRoot}${sep}`)
    ) {
      responseInvalid();
    }
    let metadata;
    try {
      metadata = await lstat(destination);
    } catch {
      responseInvalid();
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) responseInvalid();
    if ((await readdir(destination)).length !== 0) responseInvalid();
    return destination;
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
