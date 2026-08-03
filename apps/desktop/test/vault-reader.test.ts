import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { VaultReader } from '../src/main/vault-reader';

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'gosu-vault-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('read-only Obsidian vault', () => {
  it('reads Markdown within the selected root', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'note.md'), '# Safe note');
    const reader = await VaultReader.open(root);

    await expect(reader.readMarkdown('note.md')).resolves.toEqual({
      path: 'note.md',
      content: '# Safe note',
    });
  });

  it('enforces the Markdown byte cap again at read time', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'large.md'), '12345');
    const reader = await VaultReader.open(root, { maxMarkdownBytes: 4 });

    await expect(reader.readMarkdown('large.md')).rejects.toThrow('markdown_too_large');
  });

  it('rejects traversal, non-Markdown files, and symlinks', async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, 'vault');
    await mkdir(root);
    await writeFile(join(parent, 'outside.md'), 'outside');
    await writeFile(join(root, 'inside.txt'), 'inside');
    await symlink(join(parent, 'outside.md'), join(root, 'link.md'));
    const reader = await VaultReader.open(root);

    await expect(reader.readMarkdown('../outside.md')).rejects.toThrow('vault_path_escape');
    await expect(reader.readMarkdown('inside.txt')).rejects.toThrow('markdown_only');
    await expect(reader.readMarkdown('link.md')).rejects.toThrow('vault_path_escape');
  });

  it('bounds directory and entry traversal independently from file count', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'root.md'), 'root');
    for (const directoryName of ['a', 'b', 'c']) {
      const directory = join(root, directoryName);
      await mkdir(directory);
      await writeFile(join(directory, 'nested.md'), directoryName);
    }

    const directoryLimited = await VaultReader.open(root, { maxDirectories: 1 });
    const entryLimited = await VaultReader.open(root, { maxEntries: 2 });

    expect(await directoryLimited.listMarkdown()).toEqual(['root.md']);
    expect((await entryLimited.listMarkdown()).length).toBeLessThanOrEqual(2);
  });
});
