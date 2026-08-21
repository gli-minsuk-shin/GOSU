import { createHash } from 'node:crypto';
import { lstat, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LectureStudioFigureService,
  LectureStudioFigureServiceError,
  type AddLectureStudioFigureRecord,
  type LectureStudioFigureRecord,
  type LectureStudioFigureStorage,
} from '../src/main/lecture-studio-figure-service';
import type { NormalizedProjectChatImage } from '../src/main/project-chat-image-extractor';
import {
  LectureStudioFigureLibraryReceiptSchema,
  LectureStudioSchema,
  type LectureStudio,
  type LectureStudioFigureAsset,
} from '../src/shared/lecture-studio-contracts';

const STUDIO_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RECORD_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-20T00:00:00.000Z');
const NORMALIZED_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x11, 0x22, 0xff, 0xd9]);

function fixtureStudio(overrides: Partial<LectureStudio> = {}) {
  return LectureStudioSchema.parse({
    schemaVersion: 1,
    id: STUDIO_ID,
    title: 'Figure library',
    kind: 'lecture',
    durationMinutes: null,
    outputProjectId: PROJECT_ID,
    sourceProjectIds: [PROJECT_ID],
    sourceSelection: {
      literature: [{ projectId: PROJECT_ID, recordId: RECORD_ID }],
      experiments: [],
      manuscripts: [],
      externalSources: null,
    },
    generationBrief: {
      notesTargetPages: null,
      slidesTargetPages: null,
      detailLevel: 'standard',
      structure: { mode: 'adaptive' },
      customInstructions: '',
    },
    status: 'draft',
    activeAttemptId: null,
    currentRevision: 0,
    version: 1,
    lastErrorCode: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  });
}

class MemoryFigureStorage implements LectureStudioFigureStorage {
  studio = fixtureStudio();
  readonly records = new Map<string, LectureStudioFigureRecord>();
  readonly activeIds = new Set<string>();
  removeError: Error | null = null;

  getLectureStudio(studioId: string) {
    return studioId === this.studio.id ? this.studio : null;
  }

  listLectureStudioFigures(studioId: string) {
    if (studioId !== this.studio.id) return [];
    return [...this.activeIds]
      .map((id) => this.records.get(id)?.asset)
      .filter((asset): asset is LectureStudioFigureAsset => asset !== undefined);
  }

  getLectureStudioFigure(studioId: string, figureId: string) {
    return studioId === this.studio.id ? (this.records.get(figureId) ?? null) : null;
  }

  addLectureStudioFigures(input: {
    studioId: string;
    expectedVersion: number;
    figures: readonly AddLectureStudioFigureRecord[];
    updatedAt: string;
  }) {
    if (
      input.studioId !== this.studio.id ||
      input.expectedVersion !== this.studio.version ||
      this.studio.trashedAt ||
      this.studio.status === 'generating'
    ) {
      return null;
    }
    const activeHashes = new Set(
      this.listLectureStudioFigures(input.studioId).map((asset) => asset.sha256),
    );
    let added = 0;
    for (const figure of input.figures) {
      if (activeHashes.has(figure.asset.sha256)) continue;
      activeHashes.add(figure.asset.sha256);
      this.records.set(figure.asset.id, {
        asset: structuredClone(figure.asset),
        bytes: Buffer.from(figure.jpegBytes),
      });
      this.activeIds.add(figure.asset.id);
      added += 1;
    }
    if (this.activeIds.size > 5) throw new Error('too_many');
    if (added > 0) {
      this.studio = LectureStudioSchema.parse({
        ...this.studio,
        version: this.studio.version + 1,
        updatedAt: input.updatedAt,
      });
    }
    return LectureStudioFigureLibraryReceiptSchema.parse({
      studio: this.studio,
      figures: this.listLectureStudioFigures(input.studioId),
    });
  }

  removeLectureStudioFigure(input: {
    studioId: string;
    expectedVersion: number;
    figureId: string;
    sha256: string;
    updatedAt: string;
  }) {
    if (this.removeError) throw this.removeError;
    const record = this.records.get(input.figureId);
    if (
      input.studioId !== this.studio.id ||
      input.expectedVersion !== this.studio.version ||
      !record ||
      record.asset.sha256 !== input.sha256 ||
      !this.activeIds.has(input.figureId)
    ) {
      return null;
    }
    this.activeIds.delete(input.figureId);
    this.studio = LectureStudioSchema.parse({
      ...this.studio,
      version: this.studio.version + 1,
      updatedAt: input.updatedAt,
    });
    return LectureStudioFigureLibraryReceiptSchema.parse({
      studio: this.studio,
      figures: this.listLectureStudioFigures(input.studioId),
    });
  }
}

function normalizer(bytes = NORMALIZED_JPEG) {
  return vi.fn(
    async (format: NormalizedProjectChatImage['sourceFormat']) =>
      ({
        format: 'jpeg',
        bytes,
        width: 640,
        height: 480,
        sourceFormat: format,
        sourceFrameCount: 1,
      }) satisfies NormalizedProjectChatImage,
  );
}

describe('LectureStudioFigureService', () => {
  let root: string;
  let storage: MemoryFigureStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gosu-lecture-figures-test-'));
    storage = new MemoryFigureStorage();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads main-owned absolute paths, normalizes once, deduplicates by normalized SHA, and returns cards only', async () => {
    const first = join(root, 'first.png');
    const second = join(root, 'second.jpeg');
    await Promise.all([writeFile(first, 'source-a'), writeFile(second, 'source-b')]);
    const normalizeImage = normalizer();
    const service = new LectureStudioFigureService({
      storage,
      normalizeImage,
      temporaryRoot: () => root,
      now: () => NOW,
    });

    const receipt = await service.addPaths({
      studioId: STUDIO_ID,
      expectedVersion: 1,
      paths: [first, second],
    });

    expect(normalizeImage).toHaveBeenCalledTimes(2);
    expect(receipt.studio.version).toBe(2);
    expect(receipt.figures).toHaveLength(1);
    expect(receipt.figures[0]).toMatchObject({
      studioId: STUDIO_ID,
      displayName: 'first.png',
      mediaType: 'image/jpeg',
      sourceFormat: 'png',
      byteSize: NORMALIZED_JPEG.byteLength,
      sha256: createHash('sha256').update(NORMALIZED_JPEG).digest('hex'),
    });
    expect(receipt.figures[0]?.fileName).toBe(`Figure-${receipt.figures[0]?.id}.jpg`);
    expect(receipt.figures[0]).not.toHaveProperty('bytes');
    expect(receipt.figures[0]).not.toHaveProperty('path');
  });

  it('previews bounded exact bytes and materializes private 0700/0600 native image inputs', async () => {
    const path = join(root, 'plot.png');
    await writeFile(path, 'source');
    const service = new LectureStudioFigureService({
      storage,
      normalizeImage: normalizer(),
      temporaryRoot: () => root,
      now: () => NOW,
    });
    const added = await service.addPaths({
      studioId: STUDIO_ID,
      expectedVersion: 1,
      paths: [path],
    });
    const figure = added.figures[0]!;

    await expect(
      service.preview({ studioId: STUDIO_ID, figureId: figure.id, sha256: figure.sha256 }),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      figure,
      jpegBase64: NORMALIZED_JPEG.toString('base64'),
    });
    const materialized = await service.materializeActiveFigures(STUDIO_ID, [figure.id]);
    expect(materialized.figures).toEqual([figure]);
    expect(materialized.localImagePaths).toHaveLength(1);
    await expect(readFile(materialized.localImagePaths[0]!)).resolves.toEqual(NORMALIZED_JPEG);
    expect((await lstat(join(materialized.localImagePaths[0]!, '..'))).mode & 0o777).toBe(0o700);
    expect((await lstat(materialized.localImagePaths[0]!)).mode & 0o777).toBe(0o600);

    await materialized.cleanup();
    await materialized.cleanup();
    await expect(lstat(materialized.localImagePaths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps detached rows available for exact historical revision snapshots', async () => {
    const path = join(root, 'historical.png');
    await writeFile(path, 'source');
    const service = new LectureStudioFigureService({
      storage,
      normalizeImage: normalizer(),
      now: () => NOW,
    });
    const added = await service.addPaths({
      studioId: STUDIO_ID,
      expectedVersion: 1,
      paths: [path],
    });
    const figure = added.figures[0]!;
    await service.remove({
      studioId: STUDIO_ID,
      expectedVersion: added.studio.version,
      figureId: figure.id,
      sha256: figure.sha256,
    });
    storage.studio = fixtureStudio({
      status: 'generating',
      activeAttemptId: '44444444-4444-4444-8444-444444444444',
      version: storage.studio.version,
    });

    await expect(service.snapshotFigures(STUDIO_ID, [figure.id])).rejects.toMatchObject({
      code: 'figure_scope_unavailable',
    });
    await expect(service.snapshotRevisionFigures(STUDIO_ID, [figure])).resolves.toMatchObject([
      { asset: figure, bytes: NORMALIZED_JPEG },
    ]);
  });

  it('fails closed for symlinks, relative paths, unsupported extensions, stale hashes, and tampered stored bytes', async () => {
    const target = join(root, 'target.png');
    const linked = join(root, 'linked.png');
    await writeFile(target, 'source');
    await symlink(target, linked);
    const service = new LectureStudioFigureService({
      storage,
      normalizeImage: normalizer(),
      now: () => NOW,
    });

    await expect(
      service.addPaths({ studioId: STUDIO_ID, expectedVersion: 1, paths: [linked] }),
    ).rejects.toMatchObject({ code: 'figure_invalid' });
    await expect(
      service.addPaths({ studioId: STUDIO_ID, expectedVersion: 1, paths: ['relative.png'] }),
    ).rejects.toMatchObject({ code: 'figure_invalid' });
    const text = join(root, 'source.svg');
    await writeFile(text, '<svg/>');
    await expect(
      service.addPaths({ studioId: STUDIO_ID, expectedVersion: 1, paths: [text] }),
    ).rejects.toMatchObject({ code: 'figure_unsupported' });

    const added = await service.addPaths({
      studioId: STUDIO_ID,
      expectedVersion: 1,
      paths: [target],
    });
    const figure = added.figures[0]!;
    await expect(
      service.preview({ studioId: STUDIO_ID, figureId: figure.id, sha256: '0'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'figure_not_found' });
    storage.records.set(figure.id, {
      asset: figure,
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xd9]),
    });
    await expect(
      service.preview({ studioId: STUDIO_ID, figureId: figure.id, sha256: figure.sha256 }),
    ).rejects.toMatchObject({ code: 'figure_storage_failed' });
  });

  it('rejects more than five selections and a source larger than 20 MiB before decoding', async () => {
    const normalizeImage = normalizer();
    const service = new LectureStudioFigureService({ storage, normalizeImage, now: () => NOW });
    const paths = Array.from({ length: 6 }, (_, index) => join(root, `${index}.png`));
    await Promise.all(paths.map((path) => writeFile(path, 'source')));

    await expect(
      service.addPaths({ studioId: STUDIO_ID, expectedVersion: 1, paths }),
    ).rejects.toMatchObject({ code: 'figure_too_many' });

    const oversized = join(root, 'oversized.png');
    const handle = await open(oversized, 'w');
    await handle.truncate(20 * 1024 * 1024 + 1);
    await handle.close();
    await expect(
      service.addPaths({ studioId: STUDIO_ID, expectedVersion: 1, paths: [oversized] }),
    ).rejects.toMatchObject({ code: 'figure_too_large' });
    expect(normalizeImage).not.toHaveBeenCalled();
  });

  it('maps the storage in-use sentinel and preserves CAS conflicts', async () => {
    const path = join(root, 'plot.png');
    await writeFile(path, 'source');
    const service = new LectureStudioFigureService({
      storage,
      normalizeImage: normalizer(),
      now: () => NOW,
    });
    const added = await service.addPaths({
      studioId: STUDIO_ID,
      expectedVersion: 1,
      paths: [path],
    });
    const figure = added.figures[0]!;
    storage.removeError = new Error('lecture_figure_in_use');

    await expect(
      service.remove({
        studioId: STUDIO_ID,
        expectedVersion: added.studio.version,
        figureId: figure.id,
        sha256: figure.sha256,
      }),
    ).rejects.toEqual(new LectureStudioFigureServiceError('figure_in_use'));
    storage.removeError = null;
    await expect(
      service.remove({
        studioId: STUDIO_ID,
        expectedVersion: added.studio.version + 1,
        figureId: figure.id,
        sha256: figure.sha256,
      }),
    ).rejects.toMatchObject({ code: 'figure_version_conflict' });
  });

  it('cleans up every outstanding native-image materialization on dispose', async () => {
    const path = join(root, 'plot.png');
    await writeFile(path, 'source');
    const service = new LectureStudioFigureService({
      storage,
      normalizeImage: normalizer(),
      temporaryRoot: () => root,
      now: () => NOW,
    });
    const added = await service.addPaths({
      studioId: STUDIO_ID,
      expectedVersion: 1,
      paths: [path],
    });
    const materialized = await service.materializeActiveFigures(STUDIO_ID, [added.figures[0]!.id]);

    await service.dispose();

    await expect(lstat(materialized.localImagePaths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
