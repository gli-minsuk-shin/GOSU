import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_LITERATURE_TRANSFER_BYTES,
  readBoundedLiteratureFile,
  writeAtomicLiteratureFile,
} from '../src/main/literature-transfer-files';

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'gosu-literature-transfer-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('Literature transfer files', () => {
  it('reads a bounded regular file through one no-follow handle', async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, 'review.json');
    await writeFile(path, '{"schemaVersion":1}', { mode: 0o600 });

    await expect(readBoundedLiteratureFile(path)).resolves.toBe('{"schemaVersion":1}');
  });

  it('rejects import and export destination symlinks without touching their targets', async () => {
    const directory = await temporaryDirectory();
    const target = join(directory, 'target.txt');
    const link = join(directory, 'review.json');
    await writeFile(target, 'do not overwrite', { mode: 0o600 });
    await symlink(target, link);

    await expect(readBoundedLiteratureFile(link)).rejects.toThrow('literature_import_invalid');
    await expect(writeAtomicLiteratureFile(link, 'replacement')).rejects.toThrow(
      'literature_export_invalid',
    );
    await expect(readFile(target, 'utf8')).resolves.toBe('do not overwrite');
  });

  it('atomically replaces a regular destination with a private file and removes temp files', async () => {
    const directory = await temporaryDirectory();
    const destination = join(directory, 'review.csv');
    await writeFile(destination, 'old', { mode: 0o644 });

    await writeAtomicLiteratureFile(destination, 'new evidence');

    await expect(readFile(destination, 'utf8')).resolves.toBe('new evidence');
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['review.csv']);
  });

  it('rejects oversized output before creating a temporary file', async () => {
    const directory = await temporaryDirectory();
    await expect(
      writeAtomicLiteratureFile(
        join(directory, 'review.json'),
        'x'.repeat(MAX_LITERATURE_TRANSFER_BYTES + 1),
      ),
    ).rejects.toThrow('literature_export_too_large');
    expect(await readdir(directory)).toEqual([]);
  });
});
