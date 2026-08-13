import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LectureExternalSourceManifestAuthenticator,
  LectureExternalSourceError,
  LectureExternalSourceService,
} from '../src/main/lecture-external-source-service';
import {
  ProjectChatPdfExtractionError,
  type ExtractedProjectChatPdf,
} from '../src/main/project-chat-pdf-extractor';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const STUDIO_ID = '33333333-3333-4333-8333-333333333333';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-lecture-external-source-'));
  roots.push(root);
  return root;
}

function extractedPdf(text = 'Selectable PDF theorem evidence'): ExtractedProjectChatPdf {
  return {
    pageCount: 2,
    pages: [
      { pageNumber: 1, text },
      { pageNumber: 2, text: 'Second page result' },
    ],
    extractedCharacters: text.length + 'Second page result'.length,
    truncated: false,
    textAvailable: true,
  };
}

function service(
  root: string,
  chooseFiles: () => Promise<readonly string[]>,
  options: {
    now?: () => Date;
    extractPdf?: (bytes: Uint8Array, maxCharacters: number) => Promise<ExtractedProjectChatPdf>;
    removeManagedDirectory?: (directory: string) => Promise<void>;
  } = {},
) {
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^sealed:/u, ''),
  };
  return new LectureExternalSourceService({
    rootDirectory: () => join(root, 'managed'),
    chooseFiles,
    validateProject: async (projectId) => {
      if (projectId !== PROJECT_ID) throw new Error('not_found');
    },
    manifestAuthenticator: new LectureExternalSourceManifestAuthenticator({
      rootDirectory: () => join(root, 'managed'),
      encryption,
    }),
    ...options,
  });
}

describe('LectureExternalSourceService', () => {
  it('stages tex, Markdown, and PDF as Main-owned copies without exposing local paths', async () => {
    const root = await fixtureRoot();
    const latex = join(root, 'proof.tex');
    const markdown = join(root, 'notes.md');
    const pdf = join(root, 'paper.pdf');
    await writeFile(latex, String.raw`\section{Proof}\(x^2\)`);
    await writeFile(markdown, '# Notes\n\nBounded evidence.');
    await writeFile(pdf, '%PDF-fixture');
    const extractPdf = vi.fn(async () => extractedPdf());
    const importer = service(root, async () => [latex, markdown, pdf], { extractPdf });

    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });

    expect(staged.sources.map((source) => source.kind)).toEqual(['latex', 'markdown', 'pdf']);
    expect(staged.sources[2]?.extraction).toMatchObject({
      unitLabel: 'page',
      unitCount: 2,
      textAvailable: true,
      truncated: false,
      reconstructionNotice:
        'Selectable PDF text only; figures, scans, equations-as-images, and page layout are not reconstructed.',
    });
    expect(extractPdf).toHaveBeenCalledWith(expect.any(Uint8Array), 40_000);
    expect(JSON.stringify(staged)).not.toContain(root);
    expect(JSON.stringify(staged)).not.toContain('managedRelativePath');
    expect(JSON.stringify(staged)).not.toContain('Selectable PDF theorem evidence');
    expect(JSON.stringify(staged)).not.toContain('contentSha256');
    await expect(access(latex)).resolves.toBeUndefined();
    for (const source of staged.sources) {
      await expect(
        access(
          join(
            root,
            'managed',
            'staging',
            PROJECT_ID,
            staged.id,
            `${source.id}${source.kind === 'latex' ? '.tex' : source.kind === 'markdown' ? '.md' : '.pdf'}`,
          ),
        ),
      ).resolves.toBeUndefined();
    }
  });

  it('appends to one staged set, rejects duplicate content, and keeps cancellation unchanged', async () => {
    const root = await fixtureRoot();
    const first = join(root, 'first.md');
    const second = join(root, 'second.tex');
    await writeFile(first, '# First');
    await writeFile(second, String.raw`\section{Second}`);
    let selection: readonly string[] = [first];
    const importer = service(root, async () => selection);
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    selection = [];
    const unchanged = await importer.chooseAndStage({
      projectId: PROJECT_ID,
      sourceSetId: staged.id,
    });
    expect(unchanged).toEqual(staged);

    selection = [second];
    const appended = await importer.chooseAndStage({
      projectId: PROJECT_ID,
      sourceSetId: staged.id,
    });
    expect(appended.id).toBe(staged.id);
    expect(appended.sources).toHaveLength(2);

    selection = [first];
    await expect(
      importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: staged.id }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_invalid');
    expect(
      (await importer.listStaged({ projectId: PROJECT_ID, sourceSetId: staged.id })).sources,
    ).toHaveLength(2);
  });

  it('serializes concurrent appends to one set without losing sources or bypassing collection limits', async () => {
    const root = await fixtureRoot();
    const first = join(root, 'first.md');
    const second = join(root, 'second.md');
    const third = join(root, 'third.md');
    await writeFile(first, '# First');
    await writeFile(second, '# Second');
    await writeFile(third, '# Third');
    const selections: string[][] = [[first], [second], [third]];
    const importer = service(root, async () => selections.shift() ?? []);
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });

    const [firstAppend, secondAppend] = await Promise.all([
      importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: staged.id }),
      importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: staged.id }),
    ]);

    expect([firstAppend.sources.length, secondAppend.sources.length].sort()).toEqual([2, 3]);
    const final = await importer.listStaged({ projectId: PROJECT_ID, sourceSetId: staged.id });
    expect(final.sources.map((source) => source.displayName)).toEqual([
      'first.md',
      'second.md',
      'third.md',
    ]);
    await Promise.all(
      final.sources.map((source) =>
        expect(
          access(join(root, 'managed', 'staging', PROJECT_ID, staged.id, `${source.id}.md`)),
        ).resolves.toBeUndefined(),
      ),
    );
  });

  it('rechecks the source-count cap inside the append queue and leaves no rejected copy behind', async () => {
    const root = await fixtureRoot();
    const initial = await Promise.all(
      Array.from({ length: 11 }, async (_, index) => {
        const path = join(root, `initial-${index}.md`);
        await writeFile(path, `# Initial ${index}`);
        return path;
      }),
    );
    const twelfth = join(root, 'twelfth.md');
    const thirteenth = join(root, 'thirteenth.md');
    await writeFile(twelfth, '# Twelfth');
    await writeFile(thirteenth, '# Thirteenth');
    const selections: string[][] = [initial, [twelfth], [thirteenth]];
    const importer = service(root, async () => selections.shift() ?? []);
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });

    const appends = await Promise.allSettled([
      importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: staged.id }),
      importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: staged.id }),
    ]);

    expect(appends.filter((append) => append.status === 'fulfilled')).toHaveLength(1);
    expect(appends.find((append) => append.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'lecture_external_source_too_many' }),
    });
    const final = await importer.listStaged({ projectId: PROJECT_ID, sourceSetId: staged.id });
    expect(final.sources).toHaveLength(12);
    expect(final.sources.map((source) => source.displayName)).toContain('twelfth.md');
    expect(final.sources.map((source) => source.displayName)).not.toContain('thirteenth.md');
  });

  it('claims selected sources before Studio persistence and freezes only requested snapshots', async () => {
    const root = await fixtureRoot();
    const first = join(root, 'first.md');
    const second = join(root, 'second.tex');
    await writeFile(first, '# Included');
    await writeFile(second, String.raw`\section{Excluded}`);
    const importer = service(root, async () => [first, second]);
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    const selectedSourceId = staged.sources[0]!.id;

    const claimed = await importer.claim({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceSetId: staged.id,
      selectedSourceIds: [selectedSourceId],
    });

    expect(claimed.sources).toHaveLength(1);
    expect(claimed.sources[0]).toMatchObject({ id: selectedSourceId, studioId: STUDIO_ID });
    expect(JSON.stringify(claimed)).not.toContain('managedRelativePath');
    expect(
      (await importer.listStaged({ projectId: PROJECT_ID, sourceSetId: staged.id })).sources,
    ).toHaveLength(2);
    const snapshots = await importer.snapshots({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceIds: [selectedSourceId],
    });
    expect(snapshots).toEqual([
      expect.objectContaining({
        sourceLabel: 'F1',
        id: selectedSourceId,
        sourceSha256: claimed.sources[0]!.sourceSha256,
        extraction: expect.objectContaining({ content: '# Included' }),
      }),
    ]);
    expect(JSON.stringify(snapshots)).not.toContain(root);
    expect(JSON.stringify(snapshots)).not.toContain('managedRelativePath');
  });

  it('leases a staged set to one claim and permits an idempotent retry only for that claim', async () => {
    const root = await fixtureRoot();
    const markdown = join(root, 'source.md');
    await writeFile(markdown, '# Claimed once');
    const importer = service(root, async () => [markdown]);
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    const sourceId = staged.sources[0]!.id;
    const otherStudioId = '44444444-4444-4444-8444-444444444444';

    const claims = await Promise.allSettled([
      importer.claim({
        projectId: PROJECT_ID,
        studioId: STUDIO_ID,
        sourceSetId: staged.id,
        selectedSourceIds: [sourceId],
      }),
      importer.claim({
        projectId: PROJECT_ID,
        studioId: otherStudioId,
        sourceSetId: staged.id,
        selectedSourceIds: [sourceId],
      }),
    ]);

    expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
    const rejected = claims.find((claim) => claim.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'lecture_external_source_invalid' }),
    });
    const winner = claims[0]!.status === 'fulfilled' ? STUDIO_ID : otherStudioId;
    const retried = await importer.claim({
      projectId: PROJECT_ID,
      studioId: winner,
      sourceSetId: staged.id,
      selectedSourceIds: [sourceId],
    });
    expect(retried.sources).toHaveLength(1);
    await expect(
      importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: staged.id }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_invalid');

    await importer.purgeStudio({ projectId: PROJECT_ID, studioId: winner });
    await expect(
      importer.claim({
        projectId: PROJECT_ID,
        studioId: otherStudioId,
        sourceSetId: staged.id,
        selectedSourceIds: [sourceId],
      }),
    ).resolves.toMatchObject({ sources: [expect.objectContaining({ id: sourceId })] });
  });

  it('keeps authenticated policy-v1 tex, Markdown, and PDF snapshots stable without re-extraction', async () => {
    const root = await fixtureRoot();
    const latex = join(root, 'proof.tex');
    const markdown = join(root, 'notes.md');
    const pdf = join(root, 'paper.pdf');
    await writeFile(latex, String.raw`\section{V1 theorem}\(x^2\geq 0\)`);
    await writeFile(markdown, '# V1 notes\n\nFrozen Markdown evidence.');
    await writeFile(pdf, '%PDF-policy-v1-fixture');
    const firstExtractor = vi.fn(async () => extractedPdf('Golden V1 PDF evidence'));
    const stagedBy = service(root, async () => [latex, markdown, pdf], {
      extractPdf: firstExtractor,
    });
    const staged = await stagedBy.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    await stagedBy.claim({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceSetId: staged.id,
      selectedSourceIds: staged.sources.map(({ id }) => id),
    });

    // Simulate a later app whose current PDF extractor emits different text. An old authenticated
    // policy-v1 Studio must reuse its frozen extraction instead of being reinterpreted by it.
    const futureExtractor = vi.fn(async () => extractedPdf('Different future extraction'));
    const reopened = service(root, async () => [], { extractPdf: futureExtractor });
    const snapshots = await reopened.snapshots({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceIds: staged.sources.map(({ id }) => id),
    });

    expect(firstExtractor).toHaveBeenCalledOnce();
    expect(futureExtractor).not.toHaveBeenCalled();
    expect(snapshots.map(({ kind, extraction }) => [kind, extraction.policyVersion])).toEqual([
      ['latex', 1],
      ['markdown', 1],
      ['pdf', 1],
    ]);
    expect(snapshots[0]?.extraction.content).toBe(String.raw`\section{V1 theorem}\(x^2\geq 0\)`);
    expect(snapshots[1]?.extraction.content).toBe('# V1 notes\n\nFrozen Markdown evidence.');
    expect(snapshots[2]?.extraction.content).toContain('Golden V1 PDF evidence');
    expect(snapshots[2]?.extraction.content).not.toContain('Different future extraction');
  });

  it('detects managed-copy tampering before source manifest generation', async () => {
    const root = await fixtureRoot();
    const markdown = join(root, 'source.md');
    await writeFile(markdown, '# Original');
    const importer = service(root, async () => [markdown]);
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    const sourceId = staged.sources[0]!.id;
    await importer.claim({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceSetId: staged.id,
      selectedSourceIds: [sourceId],
    });
    await writeFile(
      join(root, 'managed', 'studios', PROJECT_ID, STUDIO_ID, `${sourceId}.md`),
      '# Tampered',
    );

    await expect(
      importer.snapshots({ projectId: PROJECT_ID, studioId: STUDIO_ID, sourceIds: [sourceId] }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_corrupt');
  });

  it('detects extraction-manifest tampering even when the managed bytes are unchanged', async () => {
    const root = await fixtureRoot();
    const markdown = join(root, 'source.md');
    await writeFile(markdown, '# Immutable extraction');
    const importer = service(root, async () => [markdown]);
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    const sourceId = staged.sources[0]!.id;
    await importer.claim({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceSetId: staged.id,
      selectedSourceIds: [sourceId],
    });
    const manifestPath = join(root, 'managed', 'studios', PROJECT_ID, STUDIO_ID, 'sources-v1.json');
    const envelope = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      payloadJson: string;
    };
    const manifest = JSON.parse(envelope.payloadJson) as {
      sources: Array<{ extraction: { content: string; contentSha256: string } }>;
    };
    manifest.sources[0]!.extraction.content = '# Forged extraction';
    envelope.payloadJson = JSON.stringify(manifest);
    await writeFile(manifestPath, JSON.stringify(envelope));

    await expect(
      importer.snapshots({ projectId: PROJECT_ID, studioId: STUDIO_ID, sourceIds: [sourceId] }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_corrupt');
  });

  it('maps invalid and encrypted PDFs and rejects cross-project source-set access', async () => {
    const root = await fixtureRoot();
    const invalid = join(root, 'invalid.pdf');
    await writeFile(invalid, 'not-pdf');
    await expect(
      service(root, async () => [invalid]).chooseAndStage({
        projectId: PROJECT_ID,
        sourceSetId: null,
      }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_invalid');

    const encrypted = join(root, 'encrypted.pdf');
    await writeFile(encrypted, '%PDF-encrypted');
    const encryptedImporter = service(root, async () => [encrypted], {
      extractPdf: async () => {
        throw new ProjectChatPdfExtractionError('pdf_attachment_encrypted');
      },
    });
    await expect(
      encryptedImporter.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_encrypted');

    const scan = join(root, 'scan.pdf');
    await writeFile(scan, '%PDF-scan');
    const scanImporter = service(root, async () => [scan], {
      extractPdf: async () => ({
        pageCount: 2,
        pages: [
          { pageNumber: 1, text: '   ' },
          { pageNumber: 2, text: '\n' },
        ],
        extractedCharacters: 4,
        truncated: false,
        textAvailable: false,
      }),
    });
    await expect(
      scanImporter.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_extraction_failed');

    const blankMarkdown = join(root, 'blank.md');
    await writeFile(blankMarkdown, ' \n\t ');
    await expect(
      service(root, async () => [blankMarkdown]).chooseAndStage({
        projectId: PROJECT_ID,
        sourceSetId: null,
      }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_extraction_failed');

    const markdown = join(root, 'scoped.md');
    await writeFile(markdown, '# Scoped');
    const importer = service(root, async () => [markdown]);
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    await expect(
      importer.listStaged({ projectId: OTHER_PROJECT_ID, sourceSetId: staged.id }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_scope_mismatch');
  });

  it('removes/discards staged copies and reconciles expired source sets on access', async () => {
    const root = await fixtureRoot();
    const first = join(root, 'first.md');
    const second = join(root, 'second.md');
    await writeFile(first, '# First');
    await writeFile(second, '# Second');
    let now = new Date('2026-08-14T00:00:00.000Z');
    const importer = service(root, async () => [first, second], { now: () => now });
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    const removed = await importer.removeStaged({
      projectId: PROJECT_ID,
      sourceSetId: staged.id,
      sourceId: staged.sources[0]!.id,
    });
    expect(removed.sources).toHaveLength(1);
    await importer.discard({ projectId: PROJECT_ID, sourceSetId: staged.id });
    await expect(
      access(join(root, 'managed', 'staging', PROJECT_ID, staged.id)),
    ).rejects.toHaveProperty('code', 'ENOENT');

    const expiring = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    now = new Date(expiring.expiresAt);
    expect(await importer.cleanupExpired()).toEqual({ removedSourceSets: 1 });
    await expect(
      importer.listStaged({ projectId: PROJECT_ID, sourceSetId: expiring.id }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_not_found');
    await expect(
      access(join(root, 'managed', 'staging', PROJECT_ID, expiring.id)),
    ).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('purges a claimed Studio source directory as create rollback or permanent cleanup', async () => {
    const root = await fixtureRoot();
    const markdown = join(root, 'source.md');
    await writeFile(markdown, '# Rollback');
    const importer = service(root, async () => [markdown]);
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    await importer.claim({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceSetId: staged.id,
      selectedSourceIds: [staged.sources[0]!.id],
    });
    await importer.purgeStudio({ projectId: PROJECT_ID, studioId: STUDIO_ID });
    await expect(
      access(join(root, 'managed', 'studios', PROJECT_ID, STUDIO_ID)),
    ).rejects.toHaveProperty('code', 'ENOENT');
    expect(await readFile(markdown, 'utf8')).toBe('# Rollback');

    // The immutable staged set remains available after rollback, so the same create can retry.
    const retried = await importer.claim({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceSetId: staged.id,
      selectedSourceIds: [staged.sources[0]!.id],
    });
    expect(retried.sources).toHaveLength(1);
    await importer.discard({ projectId: PROJECT_ID, sourceSetId: staged.id });
    await expect(
      importer.listStaged({ projectId: PROJECT_ID, sourceSetId: staged.id }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_not_found');
  });

  it('releases a failed create claim when cleanup is deferred and still leases one retry', async () => {
    const root = await fixtureRoot();
    const markdown = join(root, 'source.md');
    await writeFile(markdown, '# Retry after deferred cleanup');
    const removeManagedDirectory = vi.fn(async () => {
      throw new Error('temporary_cleanup_failure');
    });
    const importer = service(root, async () => [markdown], { removeManagedDirectory });
    const staged = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    const sourceId = staged.sources[0]!.id;
    await importer.claim({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceSetId: staged.id,
      selectedSourceIds: [sourceId],
    });

    await expect(
      importer.rollbackClaim({ projectId: PROJECT_ID, studioId: STUDIO_ID }),
    ).resolves.toEqual({ rolledBack: true, cleanupPending: true });
    const retryStudioA = '44444444-4444-4444-8444-444444444444';
    const retryStudioB = '55555555-5555-4555-8555-555555555555';
    const retries = await Promise.allSettled([
      importer.claim({
        projectId: PROJECT_ID,
        studioId: retryStudioA,
        sourceSetId: staged.id,
        selectedSourceIds: [sourceId],
      }),
      importer.claim({
        projectId: PROJECT_ID,
        studioId: retryStudioB,
        sourceSetId: staged.id,
        selectedSourceIds: [sourceId],
      }),
    ]);

    expect(retries.filter((retry) => retry.status === 'fulfilled')).toHaveLength(1);
    expect(retries.find((retry) => retry.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'lecture_external_source_invalid' }),
    });
    expect(removeManagedDirectory).toHaveBeenCalledOnce();
  });

  it('reconciles only unowned identity-verified Studio copies after a prior purge failure', async () => {
    const root = await fixtureRoot();
    const markdown = join(root, 'source.md');
    await writeFile(markdown, '# Durable source');
    const importer = service(root, async () => [markdown]);
    const first = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    await importer.claim({
      projectId: PROJECT_ID,
      studioId: STUDIO_ID,
      sourceSetId: first.id,
      selectedSourceIds: [first.sources[0]!.id],
    });
    const ownedStudioId = '44444444-4444-4444-8444-444444444444';
    const second = await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
    await importer.claim({
      projectId: PROJECT_ID,
      studioId: ownedStudioId,
      sourceSetId: second.id,
      selectedSourceIds: [second.sources[0]!.id],
    });

    await expect(
      importer.cleanupOrphanedStudios([{ projectId: PROJECT_ID, studioId: ownedStudioId }]),
    ).resolves.toEqual({ removedStudioDirectories: 1, removedClaimDirectories: 0 });
    await expect(
      access(join(root, 'managed', 'studios', PROJECT_ID, STUDIO_ID)),
    ).rejects.toHaveProperty('code', 'ENOENT');
    await expect(
      access(join(root, 'managed', 'studios', PROJECT_ID, ownedStudioId)),
    ).resolves.toBeUndefined();
  });

  it('uses bounded typed failures rather than leaking raw filesystem errors', async () => {
    const root = await fixtureRoot();
    const importer = service(root, async () => [join(root, 'missing.md')]);
    try {
      await importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null });
      expect.unreachable('Missing files must not stage');
    } catch (error) {
      expect(error).toBeInstanceOf(LectureExternalSourceError);
      expect((error as LectureExternalSourceError).code).toBe('lecture_external_source_invalid');
      expect((error as Error).message).not.toContain(root);
    }
  });

  it('rejects a symlinked managed staging boundary before writing outside userData', async () => {
    const root = await fixtureRoot();
    const outside = await fixtureRoot();
    const managed = join(root, 'managed');
    await writeFile(join(root, 'source.md'), '# Boundary');
    await mkdir(managed, { recursive: true });
    await symlink(outside, join(managed, 'staging'));
    const importer = service(root, async () => [join(root, 'source.md')]);

    await expect(
      importer.chooseAndStage({ projectId: PROJECT_ID, sourceSetId: null }),
    ).rejects.toHaveProperty('code', 'lecture_external_source_corrupt');
  });
});
