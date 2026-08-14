import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createManuscriptPdfArtifactPlatform } from '../src/main/manuscript-pdf-artifact-platform';
import type { ManuscriptPdfPreview } from '../src/shared/manuscript-workspace-contracts';

const electron = vi.hoisted(() => ({
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: { showSaveDialog: electron.showSaveDialog },
  shell: {
    openPath: electron.openPath,
    showItemInFolder: electron.showItemInFolder,
  },
}));

let temporaryRoot = '';

function preview(bytes: Buffer, artifactId = '11111111-1111-4111-8111-111111111111') {
  return {
    schemaVersion: 1,
    artifactId,
    projectId: '22222222-2222-4222-8222-222222222222',
    manuscriptId: '33333333-3333-4333-8333-333333333333',
    checkpointId: '44444444-4444-4444-8444-444444444444',
    providerRevision: 'a'.repeat(40),
    rootDocument: 'paper/main.tex',
    providerAhead: false,
    compiler: {
      kind: 'latexmk',
      displayName: 'MacTeX latexmk',
      version: '4.87',
      engine: 'xelatex',
      engineDisplayName: 'XeLaTeX',
    },
    pdfSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    sizeBytes: bytes.byteLength,
    compiledAt: '2026-08-14T00:00:00.000+09:00',
    pdfBase64: bytes.toString('base64'),
  } satisfies ManuscriptPdfPreview;
}

function descriptor(document: ManuscriptPdfPreview) {
  return {
    artifactId: document.artifactId,
    pdfSha256: document.pdfSha256,
    sizeBytes: document.sizeBytes,
  };
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'gosu-manuscript-artifact-test-'));
  electron.openPath.mockReset().mockResolvedValue('');
  electron.showItemInFolder.mockReset();
  electron.showSaveDialog.mockReset();
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe('Manuscript PDF artifact platform', () => {
  it('stages exact verified bytes once and opens or reveals only that regular cached PDF', async () => {
    const bytes = Buffer.from('%PDF-1.7\n% exact manuscript\n%%EOF\n');
    const document = preview(bytes);
    const cache = join(temporaryRoot, 'cache');
    const platform = createManuscriptPdfArtifactPlatform(
      () => undefined,
      () => cache,
    );

    await platform.stagePdf(document);
    await platform.stagePdf(document);
    await expect(platform.openExisting(descriptor(document))).resolves.toBe(
      `${document.artifactId}-manuscript.pdf`,
    );
    await expect(platform.revealExisting(descriptor(document))).resolves.toBe(
      `${document.artifactId}-manuscript.pdf`,
    );

    await expect(readFile(join(cache, `${document.artifactId}-manuscript.pdf`))).resolves.toEqual(
      bytes,
    );
    expect(await readdir(cache)).toEqual([`${document.artifactId}-manuscript.pdf`]);
    expect(electron.openPath).toHaveBeenCalledOnce();
    expect(electron.showItemInFolder).toHaveBeenCalledOnce();
  });

  it('exports from Main-owned cached bytes and rejects a symbolic-link destination', async () => {
    const bytes = Buffer.from('%PDF-1.7\n% export manuscript\n%%EOF\n');
    const document = preview(bytes);
    const cache = join(temporaryRoot, 'cache');
    const owner = {} as BrowserWindow;
    const platform = createManuscriptPdfArtifactPlatform(
      () => owner,
      () => cache,
    );
    await platform.stagePdf(document);

    const destination = join(temporaryRoot, 'Paper.pdf');
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination });
    await expect(platform.exportExisting(descriptor(document), 'Main-paper.pdf')).resolves.toEqual({
      status: 'exported',
      fileName: 'Paper.pdf',
    });
    await expect(readFile(destination)).resolves.toEqual(bytes);
    expect(electron.showSaveDialog).toHaveBeenCalledWith(owner, {
      title: 'Export manuscript PDF',
      defaultPath: 'Main-paper.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    const victim = join(temporaryRoot, 'victim.pdf');
    const linkedDestination = join(temporaryRoot, 'linked.pdf');
    await writeFile(victim, 'protected');
    await symlink(victim, linkedDestination);
    electron.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: linkedDestination,
    });
    await expect(platform.exportExisting(descriptor(document), 'Main-paper.pdf')).rejects.toThrow(
      'manuscript_pdf_export_failed',
    );
    await expect(readFile(victim, 'utf8')).resolves.toBe('protected');
  });

  it('does not create an export when the save dialog is cancelled', async () => {
    const bytes = Buffer.from('%PDF-1.7\n% cancelled export\n%%EOF\n');
    const document = preview(bytes);
    const cache = join(temporaryRoot, 'cache');
    const platform = createManuscriptPdfArtifactPlatform(
      () => undefined,
      () => cache,
    );
    await platform.stagePdf(document);
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: true });

    await expect(platform.exportExisting(descriptor(document), 'Main-paper.pdf')).resolves.toEqual({
      status: 'cancelled',
      fileName: null,
    });
    expect((await readdir(temporaryRoot)).sort()).toEqual(['cache']);
  });

  it('rejects invalid staged bytes and a mismatched artifact fence before OS actions', async () => {
    const bytes = Buffer.from('not actually a PDF');
    const document = preview(bytes);
    const cache = join(temporaryRoot, 'cache');
    const platform = createManuscriptPdfArtifactPlatform(
      () => undefined,
      () => cache,
    );

    await expect(platform.stagePdf(document)).rejects.toThrow('manuscript_pdf_invalid');
    const valid = preview(Buffer.from('%PDF-1.7\n% valid bytes\n%%EOF\n'));
    await platform.stagePdf(valid);
    await expect(
      platform.openExisting({
        artifactId: valid.artifactId,
        pdfSha256: `sha256:${'0'.repeat(64)}`,
        sizeBytes: valid.sizeBytes,
      }),
    ).rejects.toThrow('manuscript_pdf_invalid');
    expect(electron.openPath).not.toHaveBeenCalled();
  });

  it('rejects non-absolute or symbolic-link cache roots and surfaces OS open failures', async () => {
    const bytes = Buffer.from('%PDF-1.7\n% cache boundary\n%%EOF\n');
    const document = preview(bytes);
    const relative = createManuscriptPdfArtifactPlatform(
      () => undefined,
      () => 'relative/cache',
    );
    await expect(relative.stagePdf(document)).rejects.toThrow('manuscript_pdf_cache_failed');

    const realCache = join(temporaryRoot, 'real-cache');
    const linkedCache = join(temporaryRoot, 'linked-cache');
    await writeFile(realCache, 'not a directory');
    await symlink(realCache, linkedCache);
    const linked = createManuscriptPdfArtifactPlatform(
      () => undefined,
      () => linkedCache,
    );
    await expect(linked.stagePdf(document)).rejects.toThrow('manuscript_pdf_cache_failed');

    const cache = join(temporaryRoot, 'cache');
    const platform = createManuscriptPdfArtifactPlatform(
      () => undefined,
      () => cache,
    );
    await platform.stagePdf(document);
    electron.openPath.mockResolvedValueOnce('No application can open this PDF');
    await expect(platform.openExisting(descriptor(document))).rejects.toThrow(
      'manuscript_pdf_open_failed',
    );
  });

  it('serializes an OS open against concurrent cache pruning', async () => {
    const cache = join(temporaryRoot, 'cache');
    const platform = createManuscriptPdfArtifactPlatform(
      () => undefined,
      () => cache,
    );
    const bytes = Buffer.from('%PDF-1.7\n% race-safe manuscript\n%%EOF\n');
    const documents: ManuscriptPdfPreview[] = [];
    for (let index = 0; index < 12; index += 1) {
      const artifactId = `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`;
      const document = preview(bytes, artifactId);
      documents.push(document);
      await platform.stagePdf(document);
    }

    let releaseOpen!: () => void;
    const openGate = new Promise<string>((resolve) => {
      releaseOpen = () => resolve('');
    });
    electron.openPath.mockReturnValueOnce(openGate);
    const opening = platform.openExisting(descriptor(documents[0]!));
    await vi.waitFor(() => expect(electron.openPath).toHaveBeenCalledOnce());

    const incoming = preview(bytes, '99999999-0000-4000-8000-000000000000');
    const staging = platform.stagePdf(incoming);
    await Promise.resolve();
    expect(await readdir(cache)).toContain(`${documents[0]!.artifactId}-manuscript.pdf`);

    releaseOpen();
    await expect(opening).resolves.toBe(`${documents[0]!.artifactId}-manuscript.pdf`);
    await staging;
    const cached = await readdir(cache);
    expect(cached).toHaveLength(12);
    expect(cached).toContain(`${incoming.artifactId}-manuscript.pdf`);
    expect(cached).not.toContain(`${documents[0]!.artifactId}-manuscript.pdf`);
  });
});
