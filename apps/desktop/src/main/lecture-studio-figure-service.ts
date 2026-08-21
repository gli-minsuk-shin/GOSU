import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdtemp, open, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';

import {
  ChooseLectureStudioFiguresInputSchema,
  LECTURE_STUDIO_MAX_FIGURE_BYTES,
  LECTURE_STUDIO_MAX_FIGURES,
  LectureStudioFigureAssetSchema,
  LectureStudioFigureLibraryReceiptSchema,
  LectureStudioFigurePreviewSchema,
  ListLectureStudioFiguresInputSchema,
  PreviewLectureStudioFigureInputSchema,
  RemoveLectureStudioFigureInputSchema,
  type ChooseLectureStudioFiguresInput,
  type LectureStudio,
  type LectureStudioFigureAsset,
  type LectureStudioFigureLibraryReceipt,
  type LectureStudioFigurePreview,
  type LectureStudioFigureSourceFormat,
  type ListLectureStudioFiguresInput,
  type PreviewLectureStudioFigureInput,
  type RemoveLectureStudioFigureInput,
} from '../shared/lecture-studio-contracts';
import {
  PROJECT_CHAT_MAX_ATTACHMENT_BYTES,
  PROJECT_CHAT_MAX_TOTAL_ATTACHMENT_BYTES,
} from '../shared/project-chat-attachment-contracts';
import {
  normalizeProjectChatImage,
  ProjectChatImageExtractionError,
  type NormalizedProjectChatImage,
  type ProjectChatImageFormat,
} from './project-chat-image-extractor';

type MaybePromise<T> = T | Promise<T>;

const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

const SOURCE_FORMAT_BY_EXTENSION: Readonly<Record<string, LectureStudioFigureSourceFormat>> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.gif': 'gif',
  '.webp': 'webp',
  '.tif': 'tiff',
  '.tiff': 'tiff',
  '.bmp': 'bmp',
  '.avif': 'avif',
};

export type LectureStudioFigureRecord = Readonly<{
  asset: LectureStudioFigureAsset;
  bytes: Uint8Array;
}>;

export type AddLectureStudioFigureRecord = Readonly<{
  asset: LectureStudioFigureAsset;
  jpegBytes: Uint8Array;
}>;

/**
 * SQLCipher-backed implementations must enforce Studio state, expectedVersion, max-count,
 * normalized-byte total, and SHA deduplication in one immediate transaction. The service repeats
 * the cheap checks before decoding, but this port is the authoritative race boundary.
 */
export interface LectureStudioFigureStorage {
  getLectureStudio(studioId: string): MaybePromise<LectureStudio | null>;
  listLectureStudioFigures(studioId: string): MaybePromise<readonly LectureStudioFigureAsset[]>;
  getLectureStudioFigure(
    studioId: string,
    figureId: string,
  ): MaybePromise<LectureStudioFigureRecord | null>;
  addLectureStudioFigures(
    input: Readonly<{
      studioId: string;
      expectedVersion: number;
      figures: readonly AddLectureStudioFigureRecord[];
      updatedAt: string;
    }>,
  ): MaybePromise<LectureStudioFigureLibraryReceipt | null>;
  removeLectureStudioFigure(
    input: Readonly<{
      studioId: string;
      expectedVersion: number;
      figureId: string;
      sha256: string;
      updatedAt: string;
    }>,
  ): MaybePromise<LectureStudioFigureLibraryReceipt | null>;
}

export type LectureStudioFigureSnapshot = Readonly<{
  asset: LectureStudioFigureAsset;
  bytes: Buffer;
}>;

export type MaterializedLectureStudioFigures = Readonly<{
  figures: readonly LectureStudioFigureAsset[];
  localImagePaths: readonly string[];
  cleanup(): Promise<void>;
}>;

export type LectureStudioFigureServiceErrorCode =
  | 'figure_invalid'
  | 'figure_unsupported'
  | 'figure_too_large'
  | 'figure_total_too_large'
  | 'figure_too_many'
  | 'figure_extraction_failed'
  | 'figure_studio_not_found'
  | 'figure_scope_unavailable'
  | 'figure_version_conflict'
  | 'figure_not_found'
  | 'figure_in_use'
  | 'figure_storage_failed';

export class LectureStudioFigureServiceError extends Error {
  constructor(readonly code: LectureStudioFigureServiceErrorCode) {
    super(code);
    this.name = 'LectureStudioFigureServiceError';
  }
}

export class LectureStudioFigureService {
  private readonly materializationDirectories = new Set<string>();

  constructor(
    private readonly dependencies: Readonly<{
      storage: LectureStudioFigureStorage;
      chooseFiles?: () => Promise<readonly string[]>;
      normalizeImage?: (
        format: ProjectChatImageFormat,
        bytes: Uint8Array,
      ) => Promise<NormalizedProjectChatImage>;
      temporaryRoot?: () => string;
      now?: () => Date;
    }>,
  ) {}

  async list(input: ListLectureStudioFiguresInput): Promise<readonly LectureStudioFigureAsset[]> {
    const command = ListLectureStudioFiguresInputSchema.parse(input);
    await this.requireMutableStudio(command.studioId);
    return this.validatedLibrary(command.studioId);
  }

  async choose(input: ChooseLectureStudioFiguresInput): Promise<LectureStudioFigureLibraryReceipt> {
    const command = ChooseLectureStudioFiguresInputSchema.parse(input);
    const paths = await this.dependencies.chooseFiles?.();
    if (!paths || paths.length === 0) {
      const studio = await this.requireMutableStudio(command.studioId, command.expectedVersion);
      return LectureStudioFigureLibraryReceiptSchema.parse({
        studio,
        figures: await this.validatedLibrary(command.studioId),
      });
    }
    return this.addPaths({ ...command, paths });
  }

  /** Main-process-only entry point used after preload resolves dropped DOM Files with webUtils. */
  async addPaths(input: Readonly<ChooseLectureStudioFiguresInput & { paths: readonly string[] }>) {
    const command = ChooseLectureStudioFiguresInputSchema.parse({
      studioId: input.studioId,
      expectedVersion: input.expectedVersion,
    });
    const paths = [...input.paths];
    await this.requireMutableStudio(command.studioId, command.expectedVersion);
    const activeFigures = await this.validatedLibrary(command.studioId);
    if (paths.length === 0) {
      throw new LectureStudioFigureServiceError('figure_invalid');
    }
    if (paths.length > LECTURE_STUDIO_MAX_FIGURES || new Set(paths).size !== paths.length) {
      throw new LectureStudioFigureServiceError(
        paths.length > LECTURE_STUDIO_MAX_FIGURES ? 'figure_too_many' : 'figure_invalid',
      );
    }

    const selections = paths.map((path) => {
      if (!isAbsolute(path)) throw new LectureStudioFigureServiceError('figure_invalid');
      const format = SOURCE_FORMAT_BY_EXTENSION[extname(path).toLocaleLowerCase()];
      if (!format) throw new LectureStudioFigureServiceError('figure_unsupported');
      return { path, format } as const;
    });
    const sources: Array<{
      path: string;
      format: LectureStudioFigureSourceFormat;
      bytes: Buffer;
    }> = [];
    let totalBytes = 0;
    for (const selection of selections) {
      const bytes = await readBoundedFigure(selection.path);
      totalBytes += bytes.byteLength;
      if (totalBytes > PROJECT_CHAT_MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new LectureStudioFigureServiceError('figure_total_too_large');
      }
      sources.push({ ...selection, bytes });
    }

    const normalizedByHash = new Map<string, AddLectureStudioFigureRecord>();
    for (const source of sources) {
      let image: NormalizedProjectChatImage;
      try {
        image = await (this.dependencies.normalizeImage ?? normalizeProjectChatImage)(
          source.format,
          new Uint8Array(source.bytes),
        );
      } catch (error) {
        if (error instanceof ProjectChatImageExtractionError) {
          throw new LectureStudioFigureServiceError(
            error.code === 'attachment_too_large'
              ? 'figure_too_large'
              : error.code === 'attachment_invalid'
                ? 'figure_invalid'
                : 'figure_extraction_failed',
          );
        }
        throw new LectureStudioFigureServiceError('figure_extraction_failed');
      }
      const bytes = Buffer.from(image.bytes);
      if (
        image.format !== 'jpeg' ||
        image.sourceFormat !== source.format ||
        bytes.byteLength < 5 ||
        bytes.byteLength > LECTURE_STUDIO_MAX_FIGURE_BYTES ||
        !isExactJpeg(bytes)
      ) {
        throw new LectureStudioFigureServiceError('figure_invalid');
      }
      const digest = sha256(bytes);
      if (normalizedByHash.has(digest)) continue;
      const id = randomUUID();
      let asset: LectureStudioFigureAsset;
      try {
        asset = LectureStudioFigureAssetSchema.parse({
          id,
          studioId: command.studioId,
          displayName: safeDisplayName(source.path),
          fileName: `Figure-${id}.jpg`,
          mediaType: 'image/jpeg',
          sourceFormat: source.format,
          byteSize: bytes.byteLength,
          width: image.width,
          height: image.height,
          sha256: digest,
          origin: 'user',
          createdAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
        });
      } catch {
        throw new LectureStudioFigureServiceError('figure_invalid');
      }
      normalizedByHash.set(digest, { asset, jpegBytes: bytes });
    }

    const activeHashes = new Set(activeFigures.map((figure) => figure.sha256));
    const newFigureCount = [...normalizedByHash.keys()].filter(
      (digest) => !activeHashes.has(digest),
    ).length;
    if (activeFigures.length + newFigureCount > LECTURE_STUDIO_MAX_FIGURES) {
      throw new LectureStudioFigureServiceError('figure_too_many');
    }
    let receipt: LectureStudioFigureLibraryReceipt | null;
    try {
      receipt = await this.dependencies.storage.addLectureStudioFigures({
        studioId: command.studioId,
        expectedVersion: command.expectedVersion,
        figures: [...normalizedByHash.values()],
        updatedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
      });
    } catch (error) {
      if (
        isRecord(error) &&
        (error.code === 'capacity_reached' || error.message === 'capacity_reached')
      ) {
        throw new LectureStudioFigureServiceError('figure_too_many');
      }
      throw new LectureStudioFigureServiceError('figure_storage_failed');
    }
    if (!receipt) throw new LectureStudioFigureServiceError('figure_version_conflict');
    return this.validateReceipt(receipt, command.studioId);
  }

  async preview(input: PreviewLectureStudioFigureInput): Promise<LectureStudioFigurePreview> {
    const command = PreviewLectureStudioFigureInputSchema.parse(input);
    await this.requireMutableStudio(command.studioId);
    const record = await this.storedFigure(command.studioId, command.figureId);
    if (!record || record.asset.sha256 !== command.sha256) {
      throw new LectureStudioFigureServiceError('figure_not_found');
    }
    const snapshot = validateStoredFigure(record, command.studioId);
    return LectureStudioFigurePreviewSchema.parse({
      schemaVersion: 1,
      figure: snapshot.asset,
      jpegBase64: snapshot.bytes.toString('base64'),
    });
  }

  async remove(input: RemoveLectureStudioFigureInput): Promise<LectureStudioFigureLibraryReceipt> {
    const command = RemoveLectureStudioFigureInputSchema.parse(input);
    await this.requireMutableStudio(command.studioId, command.expectedVersion);
    const active = await this.validatedLibrary(command.studioId);
    if (
      !active.some((figure) => figure.id === command.figureId && figure.sha256 === command.sha256)
    ) {
      throw new LectureStudioFigureServiceError('figure_not_found');
    }
    let receipt: LectureStudioFigureLibraryReceipt | null;
    try {
      receipt = await this.dependencies.storage.removeLectureStudioFigure({
        ...command,
        updatedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'figure_in_use' || error.message === 'lecture_figure_in_use')
      ) {
        throw new LectureStudioFigureServiceError('figure_in_use');
      }
      throw new LectureStudioFigureServiceError('figure_storage_failed');
    }
    if (!receipt) throw new LectureStudioFigureServiceError('figure_version_conflict');
    return this.validateReceipt(receipt, command.studioId);
  }

  /** Exact immutable byte copies for compiler and Research Notes revision publication. */
  async snapshotFigures(
    studioId: string,
    figureIds?: readonly string[],
  ): Promise<readonly LectureStudioFigureSnapshot[]> {
    await this.requireMutableStudio(studioId);
    const assets = await this.selectAssets(studioId, figureIds);
    const snapshots: LectureStudioFigureSnapshot[] = [];
    for (const asset of assets) {
      const record = await this.storedFigure(studioId, asset.id);
      if (!record || record.asset.sha256 !== asset.sha256) {
        throw new LectureStudioFigureServiceError('figure_not_found');
      }
      snapshots.push(validateStoredFigure(record, studioId));
    }
    return snapshots;
  }

  /**
   * Resolves the exact immutable assets recorded on a historical revision. Unlike the active
   * library path, this intentionally works while a Studio is generating and after an asset was
   * detached. Storage.getLectureStudioFigure therefore includes retained detached rows.
   */
  async snapshotRevisionFigures(
    studioId: string,
    exactAssets: readonly LectureStudioFigureAsset[],
  ): Promise<readonly LectureStudioFigureSnapshot[]> {
    if (
      exactAssets.length > LECTURE_STUDIO_MAX_FIGURES ||
      new Set(exactAssets.map((asset) => asset.id)).size !== exactAssets.length ||
      new Set(exactAssets.map((asset) => asset.sha256)).size !== exactAssets.length
    ) {
      throw new LectureStudioFigureServiceError('figure_invalid');
    }
    const expected = exactAssets.map((asset) => {
      try {
        return LectureStudioFigureAssetSchema.parse(structuredClone(asset));
      } catch {
        throw new LectureStudioFigureServiceError('figure_invalid');
      }
    });
    if (expected.some((asset) => asset.studioId !== studioId)) {
      throw new LectureStudioFigureServiceError('figure_invalid');
    }
    const snapshots: LectureStudioFigureSnapshot[] = [];
    for (const asset of expected) {
      const record = await this.storedFigure(studioId, asset.id);
      if (!record) throw new LectureStudioFigureServiceError('figure_not_found');
      const snapshot = validateStoredFigure(record, studioId);
      if (JSON.stringify(snapshot.asset) !== JSON.stringify(asset)) {
        throw new LectureStudioFigureServiceError('figure_storage_failed');
      }
      snapshots.push(snapshot);
    }
    return snapshots;
  }

  /**
   * Materializes selected immutable JPEGs only for one native Codex turn. Call cleanup on every
   * terminal, cancellation, and error path; dispose() is the shutdown fallback.
   */
  async materializeActiveFigures(
    studioId: string,
    figureIds?: readonly string[],
  ): Promise<MaterializedLectureStudioFigures> {
    const snapshots = await this.snapshotFigures(studioId, figureIds);
    const directory = await mkdtemp(
      join(this.dependencies.temporaryRoot?.() ?? tmpdir(), 'gosu-chat-image-'),
    );
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      this.materializationDirectories.delete(directory);
      await rm(directory, { recursive: true, force: true });
    };
    try {
      await chmod(directory, 0o700);
      this.materializationDirectories.add(directory);
      const paths: string[] = [];
      for (const snapshot of snapshots) {
        const path = join(directory, snapshot.asset.fileName);
        await writeFile(path, snapshot.bytes, { flag: 'wx', mode: 0o600 });
        paths.push(path);
      }
      return {
        figures: snapshots.map((snapshot) => snapshot.asset),
        localImagePaths: paths,
        cleanup,
      };
    } catch (error) {
      await cleanup().catch(() => undefined);
      if (error instanceof LectureStudioFigureServiceError) throw error;
      throw new LectureStudioFigureServiceError('figure_storage_failed');
    }
  }

  async dispose() {
    await Promise.all(
      [...this.materializationDirectories].map(async (directory) => {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        this.materializationDirectories.delete(directory);
      }),
    );
  }

  private async selectAssets(studioId: string, figureIds?: readonly string[]) {
    const figures = await this.validatedLibrary(studioId);
    if (!figureIds) return figures;
    if (
      figureIds.length > LECTURE_STUDIO_MAX_FIGURES ||
      new Set(figureIds).size !== figureIds.length
    ) {
      throw new LectureStudioFigureServiceError('figure_invalid');
    }
    const byId = new Map(figures.map((figure) => [figure.id, figure]));
    return figureIds.map((id) => {
      const figure = byId.get(id);
      if (!figure) throw new LectureStudioFigureServiceError('figure_not_found');
      return figure;
    });
  }

  private async storedFigure(studioId: string, figureId: string) {
    try {
      return await this.dependencies.storage.getLectureStudioFigure(studioId, figureId);
    } catch {
      throw new LectureStudioFigureServiceError('figure_storage_failed');
    }
  }

  private async requireMutableStudio(studioId: string, expectedVersion?: number) {
    let studio: LectureStudio | null;
    try {
      studio = await this.dependencies.storage.getLectureStudio(studioId);
    } catch {
      throw new LectureStudioFigureServiceError('figure_storage_failed');
    }
    if (!studio) throw new LectureStudioFigureServiceError('figure_studio_not_found');
    if (studio.trashedAt !== undefined || studio.status === 'generating') {
      throw new LectureStudioFigureServiceError('figure_scope_unavailable');
    }
    if (expectedVersion !== undefined && studio.version !== expectedVersion) {
      throw new LectureStudioFigureServiceError('figure_version_conflict');
    }
    return studio;
  }

  private async validatedLibrary(studioId: string) {
    let parsed: LectureStudioFigureAsset[];
    try {
      parsed = (await this.dependencies.storage.listLectureStudioFigures(studioId)).map((figure) =>
        LectureStudioFigureAssetSchema.parse(structuredClone(figure)),
      );
    } catch {
      throw new LectureStudioFigureServiceError('figure_storage_failed');
    }
    if (
      parsed.length > LECTURE_STUDIO_MAX_FIGURES ||
      new Set(parsed.map((figure) => figure.id)).size !== parsed.length ||
      new Set(parsed.map((figure) => figure.sha256)).size !== parsed.length ||
      parsed.some((figure) => figure.studioId !== studioId)
    ) {
      throw new LectureStudioFigureServiceError('figure_storage_failed');
    }
    return parsed;
  }

  private validateReceipt(receipt: LectureStudioFigureLibraryReceipt, studioId: string) {
    let parsed: LectureStudioFigureLibraryReceipt;
    try {
      parsed = LectureStudioFigureLibraryReceiptSchema.parse(structuredClone(receipt));
    } catch {
      throw new LectureStudioFigureServiceError('figure_storage_failed');
    }
    if (
      parsed.studio.id !== studioId ||
      parsed.studio.trashedAt !== undefined ||
      parsed.studio.status === 'generating' ||
      parsed.figures.some((figure) => figure.studioId !== studioId) ||
      new Set(parsed.figures.map((figure) => figure.id)).size !== parsed.figures.length ||
      new Set(parsed.figures.map((figure) => figure.sha256)).size !== parsed.figures.length
    ) {
      throw new LectureStudioFigureServiceError('figure_storage_failed');
    }
    return parsed;
  }
}

async function readBoundedFigure(path: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= 0) {
      throw new LectureStudioFigureServiceError('figure_invalid');
    }
    if (metadata.size > PROJECT_CHAT_MAX_ATTACHMENT_BYTES) {
      throw new LectureStudioFigureServiceError('figure_too_large');
    }
    const bytes = Buffer.allocUnsafe(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== bytes.length) throw new LectureStudioFigureServiceError('figure_invalid');
    const extra = Buffer.allocUnsafe(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) {
      throw new LectureStudioFigureServiceError('figure_too_large');
    }
    return bytes;
  } catch (error) {
    if (error instanceof LectureStudioFigureServiceError) throw error;
    throw new LectureStudioFigureServiceError('figure_invalid');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function validateStoredFigure(
  record: LectureStudioFigureRecord,
  studioId: string,
): LectureStudioFigureSnapshot {
  let asset: LectureStudioFigureAsset;
  try {
    asset = LectureStudioFigureAssetSchema.parse(structuredClone(record.asset));
  } catch {
    throw new LectureStudioFigureServiceError('figure_storage_failed');
  }
  const bytes = Buffer.from(record.bytes);
  if (
    asset.studioId !== studioId ||
    bytes.byteLength !== asset.byteSize ||
    bytes.byteLength > LECTURE_STUDIO_MAX_FIGURE_BYTES ||
    sha256(bytes) !== asset.sha256 ||
    !isExactJpeg(bytes)
  ) {
    throw new LectureStudioFigureServiceError('figure_storage_failed');
  }
  return { asset, bytes };
}

function safeDisplayName(path: string) {
  const singleLine = [...basename(path)]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('');
  return singleLine.replace(/\s+/gu, ' ').trim().slice(0, 256) || 'Figure';
}

function isExactJpeg(bytes: Uint8Array) {
  return (
    bytes.byteLength >= 5 &&
    Buffer.from(bytes.subarray(0, JPEG_START.length)).equals(JPEG_START) &&
    Buffer.from(bytes.subarray(bytes.byteLength - JPEG_END.length)).equals(JPEG_END)
  );
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
