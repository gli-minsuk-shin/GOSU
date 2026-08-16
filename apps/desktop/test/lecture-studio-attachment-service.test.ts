import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LectureStudioAttachmentService } from '../src/main/lecture-studio-attachment-service';
import {
  LectureExternalSourceManifestAuthenticator,
  LectureExternalSourceError,
  LectureExternalSourceService,
} from '../src/main/lecture-external-source-service';
import { LECTURE_EXTERNAL_SOURCE_SET_TTL_MS } from '../src/shared/lecture-external-source-contracts';
import { LectureStudioSchema, type LectureStudio } from '../src/shared/lecture-studio-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const STUDIO_A_ID = '22222222-2222-4222-8222-222222222222';
const STUDIO_B_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-08-16T00:00:00.000Z';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function studio(id: string, overrides: Partial<LectureStudio> = {}): LectureStudio {
  return LectureStudioSchema.parse({
    schemaVersion: 1,
    id,
    title: `Studio ${id}`,
    kind: 'lecture',
    durationMinutes: null,
    outputProjectId: PROJECT_ID,
    sourceProjectIds: [PROJECT_ID],
    sourceSelection: {
      literature: [{ projectId: PROJECT_ID, recordId: randomUUID() }],
      experiments: [],
      manuscripts: [],
      externalSources: null,
    },
    generationBrief: {
      notesTargetPages: null,
      slidesTargetPages: null,
      detailLevel: 'standard',
      customInstructions: '',
    },
    status: 'ready',
    activeAttemptId: null,
    currentRevision: 1,
    version: 2,
    lastErrorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-lecture-attachment-'));
  roots.push(root);
  const managedRoot = join(root, 'managed');
  await mkdir(managedRoot, { recursive: true });

  let selectedPaths: readonly string[] = [];
  let beforePickerReturns: (() => void | Promise<void>) | null = null;
  let clockMs = Date.parse(NOW);
  let failNextConsume = false;
  const studios = new Map<string, LectureStudio>([
    [STUDIO_A_ID, studio(STUDIO_A_ID)],
    [STUDIO_B_ID, studio(STUDIO_B_ID)],
  ]);
  const authenticator = new LectureExternalSourceManifestAuthenticator({
    rootDirectory: () => managedRoot,
    encryption: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`sealed:${value}`, 'utf8'),
      decryptString: (value) => value.toString('utf8').replace(/^sealed:/u, ''),
    },
  });
  const externalSources = new LectureExternalSourceService({
    rootDirectory: () => managedRoot,
    validateProject: async (projectId) => {
      if (projectId !== PROJECT_ID) throw new Error('not_found');
    },
    chooseFiles: async () => {
      const capturedPaths = selectedPaths;
      const capturedHook = beforePickerReturns;
      await capturedHook?.();
      return capturedPaths;
    },
    extractPdf: async () => {
      throw new Error('PDF extraction is not used by these fixtures');
    },
    manifestAuthenticator: authenticator,
    now: () => new Date(clockMs),
  });
  const attachmentExternalSources = {
    chooseAndStage: (...args: Parameters<LectureExternalSourceService['chooseAndStage']>) =>
      externalSources.chooseAndStage(...args),
    listStaged: (...args: Parameters<LectureExternalSourceService['listStaged']>) =>
      externalSources.listStaged(...args),
    removeStaged: (...args: Parameters<LectureExternalSourceService['removeStaged']>) =>
      externalSources.removeStaged(...args),
    discard: (...args: Parameters<LectureExternalSourceService['discard']>) =>
      externalSources.discard(...args),
    snapshotStaged: (...args: Parameters<LectureExternalSourceService['snapshotStaged']>) =>
      externalSources.snapshotStaged(...args),
    consumeStaged: (...args: Parameters<LectureExternalSourceService['consumeStaged']>) => {
      if (failNextConsume) {
        failNextConsume = false;
        return Promise.reject(new LectureExternalSourceError('lecture_external_source_corrupt'));
      }
      return externalSources.consumeStaged(...args);
    },
  };
  const attachments = new LectureStudioAttachmentService({
    externalSources: attachmentExternalSources,
    getStudio: (studioId) => studios.get(studioId) ?? null,
    now: () => new Date(clockMs),
  });

  return {
    attachments,
    managedRoot,
    root,
    studios,
    select(paths: readonly string[], beforeReturn: (() => void | Promise<void>) | null = null) {
      selectedPaths = paths;
      beforePickerReturns = beforeReturn;
    },
    advanceTime(milliseconds: number) {
      clockMs += milliseconds;
    },
    failConsumeOnce() {
      failNextConsume = true;
    },
  };
}

async function markdownFiles(root: string, count: number, prefix = 'attachment') {
  const paths = Array.from({ length: count }, (_, index) =>
    join(root, `${prefix}-${index + 1}.md`),
  );
  await Promise.all(
    paths.map((path, index) =>
      writeFile(path, `# Fixture ${index + 1}\nprivate-body-${index + 1}`),
    ),
  );
  return paths;
}

async function directoryEntries(path: string) {
  return readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

describe('LectureStudioAttachmentService', () => {
  it('returns at most five renderer-safe cards without local paths or extracted bodies', async () => {
    const fixture = await harness();
    const five = await markdownFiles(fixture.root, 5);
    fixture.select(five);

    const cards = await fixture.attachments.choose({ studioId: STUDIO_A_ID });

    expect(cards).toHaveLength(5);
    const rendererPayload = JSON.stringify(cards);
    expect(rendererPayload).not.toContain(fixture.root);
    expect(rendererPayload).not.toContain('managedRelativePath');
    expect(rendererPayload).not.toContain('private-body');
    expect(rendererPayload).not.toContain('"content":');
    expect(Object.keys(cards[0]!).sort()).toEqual(
      [
        'byteSize',
        'displayName',
        'expiresAt',
        'extractedCharacters',
        'format',
        'id',
        'reconstructionNotice',
        'sha256',
        'textAvailable',
        'truncated',
        'unitCount',
        'unitLabel',
      ].sort(),
    );

    const six = await markdownFiles(fixture.root, 6, 'overflow');
    fixture.select(six);
    await expect(fixture.attachments.choose({ studioId: STUDIO_B_ID })).rejects.toMatchObject({
      code: 'lecture_external_source_too_many',
    });
  });

  it('does not allow one Studio to prepare or release another Studio attachment', async () => {
    const fixture = await harness();
    const [path] = await markdownFiles(fixture.root, 1);
    fixture.select([path!]);
    const [card] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });

    await expect(
      fixture.attachments.prepare(fixture.studios.get(STUDIO_B_ID)!, [card!.id]),
    ).rejects.toMatchObject({ code: 'lecture_external_source_expired' });
    await expect(
      fixture.attachments.release({ studioId: STUDIO_B_ID, attachmentId: card!.id }),
    ).resolves.toEqual({ released: true });

    const prepared = await fixture.attachments.prepare(fixture.studios.get(STUDIO_A_ID)!, [
      card!.id,
    ]);
    expect(prepared?.snapshots).toHaveLength(1);
    expect(prepared?.snapshots[0]?.content).toContain('private-body-1');
  });

  it('cleans only newly selected files when the Studio changes while the picker is open', async () => {
    const fixture = await harness();
    const [first, staleAddition] = await markdownFiles(fixture.root, 2);
    fixture.select([first!]);
    const [firstCard] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });

    fixture.select([staleAddition!], () => {
      fixture.studios.set(
        STUDIO_A_ID,
        studio(STUDIO_A_ID, {
          status: 'generating',
          activeAttemptId: ATTEMPT_ID,
          currentRevision: 1,
          version: 3,
          updatedAt: '2026-08-16T00:01:00.000Z',
        }),
      );
    });
    await expect(fixture.attachments.choose({ studioId: STUDIO_A_ID })).rejects.toMatchObject({
      code: 'lecture_external_source_scope_mismatch',
    });

    fixture.studios.set(
      STUDIO_A_ID,
      studio(STUDIO_A_ID, { version: 3, updatedAt: '2026-08-16T00:01:00.000Z' }),
    );
    fixture.select([staleAddition!]);
    await expect(fixture.attachments.choose({ studioId: STUDIO_A_ID })).resolves.toHaveLength(1);

    const original = await fixture.attachments.prepare(fixture.studios.get(STUDIO_A_ID)!, [
      firstCard!.id,
    ]);
    expect(original?.snapshots[0]?.content).toContain('private-body-1');
  });

  it('discards a newly created staged set when the first picker becomes stale', async () => {
    const fixture = await harness();
    const [path] = await markdownFiles(fixture.root, 1);
    fixture.select([path!], () => {
      fixture.studios.set(
        STUDIO_A_ID,
        studio(STUDIO_A_ID, {
          status: 'generating',
          activeAttemptId: ATTEMPT_ID,
          version: 3,
        }),
      );
    });

    await expect(fixture.attachments.choose({ studioId: STUDIO_A_ID })).rejects.toMatchObject({
      code: 'lecture_external_source_scope_mismatch',
    });
    expect(await directoryEntries(join(fixture.managedRoot, 'staging', PROJECT_ID))).toEqual([]);
    await expect(access(path!)).resolves.toBeUndefined();
  });

  it('keeps staged attachments after rollback so a failed send can retry', async () => {
    const fixture = await harness();
    const [path] = await markdownFiles(fixture.root, 1);
    fixture.select([path!]);
    const [card] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });
    const current = fixture.studios.get(STUDIO_A_ID)!;

    const first = await fixture.attachments.prepare(current, [card!.id]);
    expect(JSON.stringify(first?.cards)).not.toContain('private-body-1');
    expect(first?.snapshots[0]).toMatchObject({ sourceLabel: 'A1', attachmentId: card!.id });
    expect(first?.snapshots[0]?.content).toContain('private-body-1');
    await first?.rollback();

    const retry = await fixture.attachments.prepare(current, [card!.id]);
    expect(retry?.snapshots[0]?.content).toEqual(first?.snapshots[0]?.content);
  });

  it('consumes only successfully committed attachments and removes the final set', async () => {
    const fixture = await harness();
    const [firstPath, secondPath] = await markdownFiles(fixture.root, 2);
    fixture.select([firstPath!, secondPath!]);
    const [firstCard, secondCard] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });
    const current = fixture.studios.get(STUDIO_A_ID)!;

    const first = await fixture.attachments.prepare(current, [firstCard!.id]);
    await first?.commit();
    await first?.commit();
    await expect(fixture.attachments.prepare(current, [firstCard!.id])).rejects.toMatchObject({
      code: 'lecture_external_source_not_found',
    });

    const second = await fixture.attachments.prepare(current, [secondCard!.id]);
    expect(second?.snapshots[0]?.content).toContain('private-body-2');
    await second?.commit();
    await expect(fixture.attachments.prepare(current, [secondCard!.id])).rejects.toMatchObject({
      code: 'lecture_external_source_expired',
    });
  });

  it('accepts attachments on a failed Studio only when a prior revision remains editable', async () => {
    const fixture = await harness();
    const [path] = await markdownFiles(fixture.root, 1);
    fixture.select([path!]);
    fixture.studios.set(
      STUDIO_A_ID,
      studio(STUDIO_A_ID, {
        status: 'failed',
        currentRevision: 1,
        lastErrorCode: 'lecture_generation_failed',
      }),
    );
    await expect(fixture.attachments.choose({ studioId: STUDIO_A_ID })).resolves.toHaveLength(1);

    fixture.studios.set(
      STUDIO_B_ID,
      studio(STUDIO_B_ID, {
        status: 'failed',
        currentRevision: 0,
        lastErrorCode: 'lecture_generation_failed',
      }),
    );
    fixture.select([path!]);
    await expect(fixture.attachments.choose({ studioId: STUDIO_B_ID })).rejects.toBeInstanceOf(
      LectureExternalSourceError,
    );
  });

  it('allows composer cleanup during generation without mutating the frozen active snapshot', async () => {
    const fixture = await harness();
    const [path] = await markdownFiles(fixture.root, 1);
    fixture.select([path!]);
    const [card] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });
    const prepared = await fixture.attachments.prepare(fixture.studios.get(STUDIO_A_ID)!, [
      card!.id,
    ]);
    fixture.studios.set(
      STUDIO_A_ID,
      studio(STUDIO_A_ID, {
        status: 'generating',
        activeAttemptId: ATTEMPT_ID,
        version: 3,
      }),
    );

    await expect(
      fixture.attachments.release({ studioId: STUDIO_A_ID, attachmentId: card!.id }),
    ).resolves.toEqual({ released: true });
    expect(prepared?.snapshots[0]?.content).toContain('private-body-1');
    await expect(prepared?.commit()).resolves.toBeUndefined();
  });

  it('replaces an expired staged scope instead of permanently bricking the Studio picker', async () => {
    const fixture = await harness();
    const [expiredPath, freshPath] = await markdownFiles(fixture.root, 2);
    fixture.select([expiredPath!]);
    const [expiredCard] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });

    fixture.advanceTime(LECTURE_EXTERNAL_SOURCE_SET_TTL_MS + 1);
    fixture.select([freshPath!]);
    await expect(fixture.attachments.choose({ studioId: STUDIO_A_ID })).rejects.toMatchObject({
      code: 'lecture_external_source_expired',
    });
    const [freshCard] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });

    expect(freshCard?.id).not.toBe(expiredCard?.id);
    const prepared = await fixture.attachments.prepare(fixture.studios.get(STUDIO_A_ID)!, [
      freshCard!.id,
    ]);
    expect(prepared?.snapshots[0]?.content).toContain('private-body-2');
  });

  it('treats release of an expired set as idempotent and permits a fresh selection', async () => {
    const fixture = await harness();
    const [expiredPath, freshPath] = await markdownFiles(fixture.root, 2);
    fixture.select([expiredPath!]);
    const [expiredCard] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });

    fixture.advanceTime(LECTURE_EXTERNAL_SOURCE_SET_TTL_MS + 1);
    await expect(
      fixture.attachments.release({ studioId: STUDIO_A_ID, attachmentId: expiredCard!.id }),
    ).resolves.toEqual({ released: true });

    fixture.select([freshPath!]);
    await expect(fixture.attachments.choose({ studioId: STUDIO_A_ID })).resolves.toHaveLength(1);
  });

  it('retires a corrupt staged scope so the Studio can remove it and select a clean replacement', async () => {
    const fixture = await harness();
    const [corruptPath, freshPath] = await markdownFiles(fixture.root, 2);
    fixture.select([corruptPath!]);
    const [corruptCard] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });
    const [sourceSetId] = await directoryEntries(join(fixture.managedRoot, 'staging', PROJECT_ID));
    await writeFile(
      join(fixture.managedRoot, 'staging', PROJECT_ID, sourceSetId!, 'sources-v1.json'),
      '{"corrupt":true}',
    );

    fixture.select([freshPath!]);
    await expect(fixture.attachments.choose({ studioId: STUDIO_A_ID })).rejects.toMatchObject({
      code: 'lecture_external_source_corrupt',
    });
    await expect(
      fixture.attachments.release({ studioId: STUDIO_A_ID, attachmentId: corruptCard!.id }),
    ).resolves.toEqual({ released: true });
    const [freshCard] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });
    const prepared = await fixture.attachments.prepare(fixture.studios.get(STUDIO_A_ID)!, [
      freshCard!.id,
    ]);
    expect(prepared?.snapshots[0]?.content).toContain('private-body-2');
  });

  it('serializes concurrent first pickers so both results remain in one usable Studio scope', async () => {
    const fixture = await harness();
    const [firstPath, secondPath] = await markdownFiles(fixture.root, 2);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    fixture.select([firstPath!], async () => {
      firstEntered();
      await firstGate;
    });
    const firstPick = fixture.attachments.choose({ studioId: STUDIO_A_ID });
    await firstStarted;

    let secondPickerEntered = false;
    fixture.select([secondPath!], () => {
      secondPickerEntered = true;
    });
    const secondPick = fixture.attachments.choose({ studioId: STUDIO_A_ID });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondPickerEntered).toBe(false);

    releaseFirst();
    const [[firstCard], [secondCard]] = await Promise.all([firstPick, secondPick]);
    expect(secondPickerEntered).toBe(true);
    const prepared = await fixture.attachments.prepare(fixture.studios.get(STUDIO_A_ID)!, [
      firstCard!.id,
      secondCard!.id,
    ]);
    expect(prepared?.snapshots.map((snapshot) => snapshot.content)).toEqual([
      expect.stringContaining('private-body-1'),
      expect.stringContaining('private-body-2'),
    ]);
  });

  it('drops a hidden scope after post-commit cleanup failure so later picks start fresh', async () => {
    const fixture = await harness();
    const [firstPath, secondPath] = await markdownFiles(fixture.root, 2);
    fixture.select([firstPath!]);
    const [firstCard] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });
    const prepared = await fixture.attachments.prepare(fixture.studios.get(STUDIO_A_ID)!, [
      firstCard!.id,
    ]);

    fixture.failConsumeOnce();
    await expect(prepared?.commit()).rejects.toMatchObject({
      code: 'lecture_external_source_corrupt',
    });

    fixture.select([secondPath!]);
    const [secondCard] = await fixture.attachments.choose({ studioId: STUDIO_A_ID });
    expect(secondCard?.id).not.toBe(firstCard?.id);
    const next = await fixture.attachments.prepare(fixture.studios.get(STUDIO_A_ID)!, [
      secondCard!.id,
    ]);
    expect(next?.snapshots[0]?.content).toContain('private-body-2');
  });
});
