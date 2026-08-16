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

import { PdfPreviewDocumentSchema, type PdfPreviewDocument } from '../shared/pdf-preview-contracts';
import type {
  LectureStudioArtifactFormat,
  LectureStudioPdfKind,
} from '../shared/lecture-studio-contracts';

const MAX_SOURCE_EXPORT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_EXPORT_BYTES = 32 * 1024 * 1024;
const PDF_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const PDF_CACHE_MAX_FILES = 12;
const PDF_CACHE_MAX_BYTES = 128 * 1024 * 1024;
const PDF_CACHE_FILE = /^[0-9a-f-]{36}-(?:lecture-notes|slides)\.pdf$/iu;
const pdfCacheOperations = new Map<string, Promise<void>>();

export type LectureArtifactPlatformExport = Readonly<{
  format: LectureStudioArtifactFormat;
  suggestedFileName: string;
  bytes: Buffer;
}>;

export type LectureArtifactPlatformPdf = Readonly<{
  kind: LectureStudioPdfKind;
  document: PdfPreviewDocument;
}>;

export interface LectureArtifactPlatform {
  exportFile(
    input: LectureArtifactPlatformExport,
  ): Promise<Readonly<{ status: 'cancelled' | 'exported'; fileName: string | null }>>;
  openExisting(path: string): Promise<void>;
  openPdf(input: LectureArtifactPlatformPdf): Promise<string>;
  revealPdf(input: LectureArtifactPlatformPdf): Promise<string>;
  revealExisting(path: string): Promise<void>;
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

async function closeQuietly(handle: FileHandle | undefined) {
  await handle?.close().catch(() => undefined);
}

async function requireRegularFile(path: string) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('lecture_open_failed');
}

type PdfCacheEntry = Readonly<{ path: string; size: number; mtimeMs: number }>;

async function prunePdfCache(root: string, incomingBytes: number) {
  const now = Date.now();
  const entries: PdfCacheEntry[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!PDF_CACHE_FILE.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    const metadata = await lstat(path).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) continue;
    if (now - metadata.mtimeMs > PDF_CACHE_MAX_AGE_MS) {
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
    if (
      retainedFiles < PDF_CACHE_MAX_FILES &&
      retainedBytes + incomingBytes <= PDF_CACHE_MAX_BYTES
    ) {
      break;
    }
    await rm(entry.path, { force: true });
    retainedFiles -= 1;
    retainedBytes -= entry.size;
  }
  if (retainedFiles >= PDF_CACHE_MAX_FILES || retainedBytes + incomingBytes > PDF_CACHE_MAX_BYTES) {
    throw new Error('lecture_open_failed');
  }
}

async function withPdfCacheLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = pdfCacheOperations.get(root) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const current = previous.catch(() => undefined).then(() => gate);
  pdfCacheOperations.set(root, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (pdfCacheOperations.get(root) === current) pdfCacheOperations.delete(root);
  }
}

async function writeAtomicFile(
  requestedPath: string,
  bytes: Buffer,
  maximumBytes: number,
  replaceExisting: boolean,
) {
  if (!isAbsolute(requestedPath) || bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    throw new Error('lecture_export_failed');
  }
  const parent = await realpath(dirname(requestedPath));
  const target = join(parent, basename(requestedPath));
  const temporaryPath = join(parent, `.gosu-lecture-${randomUUID()}.tmp`);
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
    if (!metadata.isFile()) throw new Error('lecture_export_failed');
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;

    try {
      const existing = await lstat(target);
      if (!replaceExisting || existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error('lecture_export_failed');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(temporaryPath, target);
    committed = true;
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('lecture_export_failed', { cause: error });
    }
    throw error;
  } finally {
    await closeQuietly(handle);
    if (!committed) await unlink(temporaryPath).catch(() => undefined);
  }
}

function verifiedPdfBytes(document: PdfPreviewDocument) {
  const parsed = PdfPreviewDocumentSchema.parse(document);
  const bytes = Buffer.from(parsed.pdfBase64, 'base64');
  if (
    bytes.byteLength !== parsed.sizeBytes ||
    bytes.byteLength > MAX_PDF_EXPORT_BYTES ||
    !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
    parsed.pdfSha256 !== `sha256:${sha256(bytes)}`
  ) {
    throw new Error('lecture_pdf_invalid');
  }
  return { parsed, bytes };
}

async function cachedPdfMatches(path: string, expected: Buffer) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error('lecture_open_failed', { cause: error });
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== expected.byteLength) {
      throw new Error('lecture_open_failed');
    }
    const bytes = Buffer.allocUnsafe(metadata.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset !== bytes.byteLength || !bytes.equals(expected)) {
      throw new Error('lecture_open_failed');
    }
    return true;
  } finally {
    await handle.close();
  }
}

async function withCachedPdf<T>(
  pdfCacheRoot: () => string,
  input: LectureArtifactPlatformPdf,
  operation: (path: string, fileName: string) => Promise<T> | T,
) {
  const { parsed, bytes } = verifiedPdfBytes(input.document);
  const requestedRoot = pdfCacheRoot();
  if (!isAbsolute(requestedRoot)) throw new Error('lecture_open_failed');
  await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
  const rootMetadata = await lstat(requestedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('lecture_open_failed');
  }
  const root = await realpath(requestedRoot);
  return withPdfCacheLock(root, async () => {
    const fileName = `${parsed.artifactId}-${input.kind}.pdf`;
    const path = join(root, fileName);
    if (!(await cachedPdfMatches(path, bytes))) {
      await prunePdfCache(root, bytes.byteLength);
      await writeAtomicFile(path, bytes, MAX_PDF_EXPORT_BYTES, false);
    }
    return operation(path, fileName);
  });
}

export function createLectureArtifactPlatform(
  window: () => BrowserWindow | undefined,
  pdfCacheRoot: () => string,
): LectureArtifactPlatform {
  return {
    async exportFile(input) {
      const maximumBytes = input.format === 'pdf' ? MAX_PDF_EXPORT_BYTES : MAX_SOURCE_EXPORT_BYTES;
      if (input.bytes.byteLength < 1 || input.bytes.byteLength > maximumBytes) {
        throw new Error('lecture_export_failed');
      }
      const owner = window();
      const options: Electron.SaveDialogOptions = {
        title:
          input.format === 'pdf'
            ? 'Export lecture PDF'
            : input.format === 'latex'
              ? 'Export lecture LaTeX'
              : 'Export lecture Markdown',
        defaultPath: input.suggestedFileName,
        filters: [
          input.format === 'pdf'
            ? { name: 'PDF', extensions: ['pdf'] }
            : input.format === 'latex'
              ? { name: 'LaTeX', extensions: ['tex'] }
              : { name: 'Markdown', extensions: ['md'] },
        ],
      };
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { status: 'cancelled', fileName: null };
      const path = await writeAtomicFile(result.filePath, input.bytes, maximumBytes, true);
      return { status: 'exported', fileName: basename(path).slice(0, 256) };
    },

    async openExisting(path) {
      await requireRegularFile(path);
      const error = await shell.openPath(path);
      if (error) throw new Error('lecture_open_failed');
    },

    async openPdf(input) {
      return withCachedPdf(pdfCacheRoot, input, async (path, fileName) => {
        const error = await shell.openPath(path);
        if (error) {
          await rm(path, { force: true }).catch(() => undefined);
          throw new Error('lecture_open_failed');
        }
        return fileName;
      });
    },

    async revealPdf(input) {
      return withCachedPdf(pdfCacheRoot, input, (path, fileName) => {
        shell.showItemInFolder(path);
        return fileName;
      });
    },

    async revealExisting(path) {
      await requireRegularFile(path);
      shell.showItemInFolder(path);
    },
  };
}

export function lecturePdfExportBytes(document: PdfPreviewDocument) {
  return verifiedPdfBytes(document).bytes;
}
