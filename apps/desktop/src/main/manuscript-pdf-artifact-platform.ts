import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { dialog, shell, type BrowserWindow } from 'electron';

import {
  ManuscriptPdfPreviewSchema,
  type ManuscriptPdfPreview,
} from '../shared/manuscript-workspace-contracts';

const MAX_PDF_BYTES = 32 * 1024 * 1024;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const CACHE_MAX_FILES = 12;
const CACHE_MAX_BYTES = 128 * 1024 * 1024;
const CACHE_FILE = /^[0-9a-f-]{36}-manuscript\.pdf$/iu;
const STALE_TEMP_FILE = /^\.gosu-manuscript-[0-9a-f-]{36}\.tmp$/iu;
const cacheOperations = new Map<string, Promise<void>>();

export type ManuscriptPdfArtifactDescriptor = Readonly<{
  artifactId: string;
  pdfSha256: string;
  sizeBytes: number;
}>;

export type ManuscriptPdfArtifactErrorCode =
  | 'manuscript_pdf_invalid'
  | 'manuscript_pdf_cache_failed'
  | 'manuscript_pdf_artifact_not_found'
  | 'manuscript_pdf_export_failed'
  | 'manuscript_pdf_open_failed';

export class ManuscriptPdfArtifactError extends Error {
  constructor(readonly code: ManuscriptPdfArtifactErrorCode) {
    super(code);
    this.name = 'ManuscriptPdfArtifactError';
  }
}

export interface ManuscriptPdfArtifactPlatform {
  stagePdf(document: ManuscriptPdfPreview): Promise<void>;
  exportExisting(
    descriptor: ManuscriptPdfArtifactDescriptor,
    suggestedFileName: string,
  ): Promise<Readonly<{ status: 'cancelled' | 'exported'; fileName: string | null }>>;
  openExisting(descriptor: ManuscriptPdfArtifactDescriptor): Promise<string>;
  revealExisting(descriptor: ManuscriptPdfArtifactDescriptor): Promise<string>;
}

function digest(bytes: Buffer) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function verifiedPreview(document: ManuscriptPdfPreview) {
  const parsed = ManuscriptPdfPreviewSchema.parse(document);
  const bytes = Buffer.from(parsed.pdfBase64, 'base64');
  if (
    bytes.byteLength !== parsed.sizeBytes ||
    bytes.byteLength < 8 ||
    bytes.byteLength > MAX_PDF_BYTES ||
    !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
    digest(bytes) !== parsed.pdfSha256
  ) {
    throw new ManuscriptPdfArtifactError('manuscript_pdf_invalid');
  }
  return { parsed, bytes };
}

async function closeQuietly(handle: FileHandle | undefined) {
  await handle?.close().catch(() => undefined);
}

async function canonicalCacheRoot(requestedRoot: string) {
  if (!isAbsolute(requestedRoot)) {
    throw new ManuscriptPdfArtifactError('manuscript_pdf_cache_failed');
  }
  try {
    await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
    const metadata = await lstat(requestedRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new ManuscriptPdfArtifactError('manuscript_pdf_cache_failed');
    }
    return await realpath(requestedRoot);
  } catch (error) {
    if (error instanceof ManuscriptPdfArtifactError) throw error;
    throw new ManuscriptPdfArtifactError('manuscript_pdf_cache_failed');
  }
}

function cachedPath(root: string, artifactId: string) {
  return join(root, `${artifactId}-manuscript.pdf`);
}

async function readVerifiedCachedPdf(root: string, descriptor: ManuscriptPdfArtifactDescriptor) {
  const path = cachedPath(root, descriptor.artifactId);
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size !== descriptor.sizeBytes ||
      metadata.size < 8 ||
      metadata.size > MAX_PDF_BYTES
    ) {
      throw new ManuscriptPdfArtifactError('manuscript_pdf_invalid');
    }
    const bytes = Buffer.allocUnsafe(metadata.size);
    let offset = 0;
    while (offset < metadata.size) {
      const result = await handle.read(bytes, offset, metadata.size - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (
      offset !== metadata.size ||
      !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
      digest(bytes) !== descriptor.pdfSha256
    ) {
      throw new ManuscriptPdfArtifactError('manuscript_pdf_invalid');
    }
    return { path: await realpath(path), bytes };
  } catch (error) {
    if (error instanceof ManuscriptPdfArtifactError) throw error;
    throw new ManuscriptPdfArtifactError('manuscript_pdf_artifact_not_found');
  } finally {
    await closeQuietly(handle);
  }
}

async function writeAtomic(
  requestedPath: string,
  bytes: Buffer,
  replaceExisting: boolean,
  errorCode: 'manuscript_pdf_cache_failed' | 'manuscript_pdf_export_failed',
) {
  if (!isAbsolute(requestedPath) || bytes.byteLength < 8 || bytes.byteLength > MAX_PDF_BYTES) {
    throw new ManuscriptPdfArtifactError(errorCode);
  }
  let parent: string;
  try {
    parent = await realpath(dirname(requestedPath));
  } catch {
    throw new ManuscriptPdfArtifactError(errorCode);
  }
  const target = join(parent, basename(requestedPath));
  const temporaryPath = join(parent, `.gosu-manuscript-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  let committed = false;
  try {
    handle = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new ManuscriptPdfArtifactError(errorCode);
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;

    try {
      const existing = await lstat(target);
      if (!replaceExisting || existing.isSymbolicLink() || !existing.isFile()) {
        throw new ManuscriptPdfArtifactError(errorCode);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(temporaryPath, target);
    committed = true;
    return target;
  } catch (error) {
    if (error instanceof ManuscriptPdfArtifactError) throw error;
    throw new ManuscriptPdfArtifactError(errorCode);
  } finally {
    await closeQuietly(handle);
    if (!committed) await unlink(temporaryPath).catch(() => undefined);
  }
}

type CacheEntry = Readonly<{ path: string; size: number; mtimeMs: number }>;

async function pruneCache(root: string, incomingBytes: number) {
  const now = Date.now();
  const entries: CacheEntry[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (STALE_TEMP_FILE.test(entry.name) && entry.isFile() && !entry.isSymbolicLink()) {
      await rm(join(root, entry.name), { force: true }).catch(() => undefined);
      continue;
    }
    if (!CACHE_FILE.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    const metadata = await lstat(path).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) continue;
    if (now - metadata.mtimeMs > CACHE_MAX_AGE_MS) {
      await rm(path, { force: true }).catch(() => undefined);
      continue;
    }
    entries.push({ path, size: metadata.size, mtimeMs: metadata.mtimeMs });
  }
  entries.sort(
    (left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path),
  );
  let retainedBytes = entries.reduce((total, entry) => total + entry.size, 0);
  let retainedFiles = entries.length;
  for (const entry of entries) {
    if (retainedFiles < CACHE_MAX_FILES && retainedBytes + incomingBytes <= CACHE_MAX_BYTES) break;
    await rm(entry.path, { force: true });
    retainedFiles -= 1;
    retainedBytes -= entry.size;
  }
  if (retainedFiles >= CACHE_MAX_FILES || retainedBytes + incomingBytes > CACHE_MAX_BYTES) {
    throw new ManuscriptPdfArtifactError('manuscript_pdf_cache_failed');
  }
}

async function withCacheLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = cacheOperations.get(root) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => undefined).then(() => gate);
  cacheOperations.set(root, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (cacheOperations.get(root) === current) cacheOperations.delete(root);
  }
}

export function createManuscriptPdfArtifactPlatform(
  window: () => BrowserWindow | undefined,
  cacheRoot: () => string,
): ManuscriptPdfArtifactPlatform {
  return {
    async stagePdf(document) {
      try {
        const { parsed, bytes } = verifiedPreview(document);
        const root = await canonicalCacheRoot(cacheRoot());
        await withCacheLock(root, async () => {
          const descriptor = {
            artifactId: parsed.artifactId,
            pdfSha256: parsed.pdfSha256,
            sizeBytes: parsed.sizeBytes,
          } satisfies ManuscriptPdfArtifactDescriptor;
          try {
            await readVerifiedCachedPdf(root, descriptor);
            return;
          } catch (error) {
            if (
              !(error instanceof ManuscriptPdfArtifactError) ||
              error.code !== 'manuscript_pdf_artifact_not_found'
            ) {
              throw error;
            }
          }
          await pruneCache(root, bytes.byteLength);
          await writeAtomic(
            cachedPath(root, parsed.artifactId),
            bytes,
            false,
            'manuscript_pdf_cache_failed',
          );
        });
      } catch (error) {
        if (error instanceof ManuscriptPdfArtifactError) throw error;
        throw new ManuscriptPdfArtifactError('manuscript_pdf_cache_failed');
      }
    },

    async exportExisting(descriptor, suggestedFileName) {
      const root = await canonicalCacheRoot(cacheRoot());
      const bytes = await withCacheLock(root, async () =>
        readVerifiedCachedPdf(root, descriptor).then((artifact) => artifact.bytes),
      );
      const owner = window();
      const options: Electron.SaveDialogOptions = {
        title: 'Export manuscript PDF',
        defaultPath: suggestedFileName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      };
      let result: Electron.SaveDialogReturnValue;
      try {
        result = owner
          ? await dialog.showSaveDialog(owner, options)
          : await dialog.showSaveDialog(options);
      } catch {
        throw new ManuscriptPdfArtifactError('manuscript_pdf_export_failed');
      }
      if (result.canceled || !result.filePath) return { status: 'cancelled', fileName: null };
      const path = await writeAtomic(result.filePath, bytes, true, 'manuscript_pdf_export_failed');
      return { status: 'exported', fileName: basename(path).slice(0, 256) };
    },

    async openExisting(descriptor) {
      const root = await canonicalCacheRoot(cacheRoot());
      return withCacheLock(root, async () => {
        const { path } = await readVerifiedCachedPdf(root, descriptor);
        const error = await shell
          .openPath(path)
          .catch(() => 'The system default application could not be opened.');
        if (error) throw new ManuscriptPdfArtifactError('manuscript_pdf_open_failed');
        return basename(path);
      });
    },

    async revealExisting(descriptor) {
      const root = await canonicalCacheRoot(cacheRoot());
      return withCacheLock(root, async () => {
        const { path } = await readVerifiedCachedPdf(root, descriptor);
        try {
          shell.showItemInFolder(path);
        } catch {
          throw new ManuscriptPdfArtifactError('manuscript_pdf_open_failed');
        }
        return basename(path);
      });
    },
  };
}
