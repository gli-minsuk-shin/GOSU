import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLectureArtifactPlatform } from '../src/main/lecture-artifact-platform';
import type { PdfPreviewDocument } from '../src/shared/pdf-preview-contracts';

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

function pdfDocument(bytes: Buffer): PdfPreviewDocument {
  return {
    schemaVersion: 1,
    artifactId: '7d143229-011a-4ea8-bc5a-6374421c69f7',
    title: 'Lecture notes',
    fileName: 'lecture-notes.pdf',
    compilerDisplayName: 'Test compiler',
    sourceDescription: 'Lecture revision 3',
    pdfSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    sizeBytes: bytes.byteLength,
    compiledAt: '2026-08-13T12:00:00.000+09:00',
    pdfBase64: bytes.toString('base64'),
  };
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'gosu-lecture-artifact-test-'));
  electron.openPath.mockReset().mockResolvedValue('');
  electron.showItemInFolder.mockReset();
  electron.showSaveDialog.mockReset();
});

afterEach(async () => {
  await rm(temporaryRoot, { force: true, recursive: true });
});

describe('Lecture artifact platform', () => {
  it('returns a bounded receipt without writing when export is cancelled', async () => {
    const owner = {} as BrowserWindow;
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    const platform = createLectureArtifactPlatform(
      () => owner,
      () => join(temporaryRoot, 'pdf-cache'),
    );

    await expect(
      platform.exportFile({
        format: 'markdown',
        suggestedFileName: 'Lecture Notes.md',
        bytes: Buffer.from('# Lecture notes\n'),
      }),
    ).resolves.toEqual({ status: 'cancelled', fileName: null });

    expect(electron.showSaveDialog).toHaveBeenCalledWith(owner, {
      title: 'Export lecture Markdown',
      defaultPath: 'Lecture Notes.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    await expect(readdir(temporaryRoot)).resolves.toEqual([]);
  });

  it('atomically replaces a regular export target and removes temporary siblings', async () => {
    const destination = join(temporaryRoot, 'Lecture Notes.md');
    await writeFile(destination, 'old content');
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination });
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => join(temporaryRoot, 'pdf-cache'),
    );

    await expect(
      platform.exportFile({
        format: 'markdown',
        suggestedFileName: 'Lecture Notes.md',
        bytes: Buffer.from('# Exact revision\n'),
      }),
    ).resolves.toEqual({ status: 'exported', fileName: 'Lecture Notes.md' });

    await expect(readFile(destination, 'utf8')).resolves.toBe('# Exact revision\n');
    expect(
      (await readdir(temporaryRoot)).filter((name) => name.startsWith('.gosu-lecture-')),
    ).toEqual([]);
    expect(electron.showSaveDialog.mock.calls[0]).toHaveLength(1);
  });

  it('exports canonical LaTeX with a TeX save dialog instead of treating it as PDF', async () => {
    const destination = join(temporaryRoot, 'Lecture Notes.tex');
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination });
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => join(temporaryRoot, 'pdf-cache'),
    );

    await expect(
      platform.exportFile({
        format: 'latex',
        suggestedFileName: 'Lecture Notes.tex',
        bytes: Buffer.from('\\documentclass{article}\n'),
      }),
    ).resolves.toEqual({ status: 'exported', fileName: 'Lecture Notes.tex' });

    expect(electron.showSaveDialog).toHaveBeenCalledWith({
      title: 'Export lecture LaTeX',
      defaultPath: 'Lecture Notes.tex',
      filters: [{ name: 'LaTeX', extensions: ['tex'] }],
    });
    await expect(readFile(destination, 'utf8')).resolves.toBe('\\documentclass{article}\n');
  });

  it('rejects a symbolic-link export target without changing its destination', async () => {
    const victim = join(temporaryRoot, 'victim.md');
    const destination = join(temporaryRoot, 'Lecture Notes.md');
    await writeFile(victim, 'protected');
    await symlink(victim, destination);
    electron.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination });
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => join(temporaryRoot, 'pdf-cache'),
    );

    await expect(
      platform.exportFile({
        format: 'markdown',
        suggestedFileName: 'Lecture Notes.md',
        bytes: Buffer.from('attacker controlled replacement'),
      }),
    ).rejects.toThrow('lecture_export_failed');

    await expect(readFile(victim, 'utf8')).resolves.toBe('protected');
    expect(
      (await readdir(temporaryRoot)).filter((name) => name.startsWith('.gosu-lecture-')),
    ).toEqual([]);
  });

  it('surfaces an operating-system open failure for an existing artifact', async () => {
    const artifact = join(temporaryRoot, 'Slides.md');
    await writeFile(artifact, '# Slides\n');
    electron.openPath.mockResolvedValueOnce('No application can open this file');
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => join(temporaryRoot, 'pdf-cache'),
    );

    await expect(platform.openExisting(artifact)).rejects.toThrow('lecture_open_failed');
    expect(electron.openPath).toHaveBeenCalledWith(artifact);
  });

  it('verifies and reuses exact cached PDF bytes for open and Finder reveal', async () => {
    const bytes = Buffer.from('%PDF-1.7\n% exact compiled lecture\n%%EOF\n');
    const cache = join(temporaryRoot, 'pdf-cache');
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => cache,
    );

    await expect(
      platform.openPdf({ kind: 'lecture-notes', document: pdfDocument(bytes) }),
    ).resolves.toBe('7d143229-011a-4ea8-bc5a-6374421c69f7-lecture-notes.pdf');
    await expect(
      platform.revealPdf({ kind: 'lecture-notes', document: pdfDocument(bytes) }),
    ).resolves.toBe('7d143229-011a-4ea8-bc5a-6374421c69f7-lecture-notes.pdf');

    const cachedPath = join(cache, '7d143229-011a-4ea8-bc5a-6374421c69f7-lecture-notes.pdf');
    await expect(readFile(cachedPath)).resolves.toEqual(bytes);
    await expect(readdir(cache)).resolves.toEqual([
      '7d143229-011a-4ea8-bc5a-6374421c69f7-lecture-notes.pdf',
    ]);
    expect(electron.openPath).toHaveBeenCalledWith(await realpath(cachedPath));
    expect(electron.showItemInFolder).toHaveBeenCalledWith(await realpath(cachedPath));
  });

  it('bounds the derived PDF cache by evicting the oldest verified entries', async () => {
    const cache = join(temporaryRoot, 'pdf-cache');
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => cache,
    );
    const bytes = Buffer.from('%PDF-1.7\n% bounded compiled lecture\n%%EOF\n');
    const baseTime = new Date(Date.now() - 60_000);

    for (let index = 0; index < 12; index += 1) {
      const artifactId = `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`;
      await platform.openPdf({
        kind: 'lecture-notes',
        document: { ...pdfDocument(bytes), artifactId },
      });
      await utimes(
        join(cache, `${artifactId}-lecture-notes.pdf`),
        baseTime,
        new Date(baseTime.getTime() + index * 1_000),
      );
    }

    const newestArtifactId = '99999999-0000-4000-8000-000000000000';
    await platform.openPdf({
      kind: 'lecture-notes',
      document: { ...pdfDocument(bytes), artifactId: newestArtifactId },
    });

    const cached = (await readdir(cache)).sort();
    expect(cached).toHaveLength(12);
    expect(cached).not.toContain('00000000-0000-4000-8000-000000000000-lecture-notes.pdf');
    expect(cached).toContain(`${newestArtifactId}-lecture-notes.pdf`);
  });

  it('serializes concurrent PDF opens so cache quotas cannot be raced', async () => {
    const cache = join(temporaryRoot, 'pdf-cache');
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => cache,
    );
    const bytes = Buffer.from('%PDF-1.7\n% concurrent bounded lecture\n%%EOF\n');
    const baseTime = new Date(Date.now() - 60_000);

    for (let index = 0; index < 11; index += 1) {
      const artifactId = `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`;
      await platform.openPdf({
        kind: 'lecture-notes',
        document: { ...pdfDocument(bytes), artifactId },
      });
      await utimes(
        join(cache, `${artifactId}-lecture-notes.pdf`),
        baseTime,
        new Date(baseTime.getTime() + index * 1_000),
      );
    }

    const firstArtifactId = '88888888-0000-4000-8000-000000000000';
    const secondArtifactId = '99999999-0000-4000-8000-000000000000';
    await Promise.all([
      platform.openPdf({
        kind: 'lecture-notes',
        document: { ...pdfDocument(bytes), artifactId: firstArtifactId },
      }),
      platform.openPdf({
        kind: 'slides',
        document: { ...pdfDocument(bytes), artifactId: secondArtifactId },
      }),
    ]);

    const cached = (await readdir(cache)).sort();
    expect(cached).toHaveLength(12);
    expect(cached).toContain(`${firstArtifactId}-lecture-notes.pdf`);
    expect(cached).toContain(`${secondArtifactId}-slides.pdf`);
    expect(cached).not.toContain('00000000-0000-4000-8000-000000000000-lecture-notes.pdf');
  });

  it('rejects invalid PDF bytes before creating a cache or opening an application', async () => {
    const invalid = Buffer.from('not a PDF despite matching metadata');
    const cache = join(temporaryRoot, 'pdf-cache');
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => cache,
    );

    await expect(
      platform.openPdf({ kind: 'slides', document: pdfDocument(invalid) }),
    ).rejects.toThrow('lecture_pdf_invalid');
    await expect(
      platform.revealPdf({ kind: 'slides', document: pdfDocument(invalid) }),
    ).rejects.toThrow('lecture_pdf_invalid');

    await expect(readdir(temporaryRoot)).resolves.toEqual([]);
    expect(electron.openPath).not.toHaveBeenCalled();
    expect(electron.showItemInFolder).not.toHaveBeenCalled();
  });

  it('rejects a symbolic-link PDF cache entry without revealing its destination', async () => {
    const bytes = Buffer.from('%PDF-1.7\n% protected cache entry\n%%EOF\n');
    const cache = join(temporaryRoot, 'pdf-cache');
    const victim = join(temporaryRoot, 'victim.pdf');
    const target = join(cache, '7d143229-011a-4ea8-bc5a-6374421c69f7-lecture-notes.pdf');
    await mkdir(cache);
    await writeFile(victim, bytes);
    await symlink(victim, target);
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => cache,
    );

    await expect(
      platform.revealPdf({ kind: 'lecture-notes', document: pdfDocument(bytes) }),
    ).rejects.toThrow('lecture_open_failed');

    await expect(readFile(victim)).resolves.toEqual(bytes);
    expect(electron.showItemInFolder).not.toHaveBeenCalled();
  });

  it('reveals only an existing regular artifact through the operating system shell', async () => {
    const artifact = join(temporaryRoot, 'Lecture Notes.md');
    await writeFile(artifact, '# Lecture notes\n');
    const platform = createLectureArtifactPlatform(
      () => undefined,
      () => join(temporaryRoot, 'pdf-cache'),
    );

    await expect(platform.revealExisting(artifact)).resolves.toBeUndefined();
    expect(electron.showItemInFolder).toHaveBeenCalledOnce();
    expect(electron.showItemInFolder).toHaveBeenCalledWith(artifact);
  });
});
