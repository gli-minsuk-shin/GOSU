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

  it('reads bounded raster attachments relative to a note or from the vault root', async () => {
    const root = await temporaryDirectory();
    const notes = join(root, 'notes');
    const figures = join(root, 'figures');
    await mkdir(notes);
    await mkdir(figures);
    await writeFile(join(notes, 'report.md'), '# Report');
    const relativeBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const rootBytes = Buffer.from('GIF89a');
    await writeFile(join(notes, 'curve.png'), relativeBytes);
    await writeFile(join(figures, 'overview.gif'), rootBytes);
    const reader = await VaultReader.open(root);

    await expect(
      reader.readAttachment('notes/report.md', './curve.png?cache=1#learning-curve'),
    ).resolves.toEqual({
      path: 'notes/curve.png',
      mimeType: 'image/png',
      dataBase64: relativeBytes.toString('base64'),
    });
    await expect(
      reader.readAttachment('notes/report.md', '/figures/overview.gif'),
    ).resolves.toEqual({
      path: 'figures/overview.gif',
      mimeType: 'image/gif',
      dataBase64: rootBytes.toString('base64'),
    });
  });

  it('rejects remote sources, traversal, symlinks, and SVG attachments', async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, 'vault');
    const notes = join(root, 'notes');
    await mkdir(root);
    await mkdir(notes);
    await writeFile(join(notes, 'report.md'), '# Report');
    await writeFile(join(parent, 'outside.png'), 'outside');
    await writeFile(join(notes, 'inside.png'), 'inside');
    await writeFile(join(notes, 'disguised.png'), 'not a PNG');
    await writeFile(join(notes, 'diagram.svg'), '<svg></svg>');
    await symlink(join(notes, 'inside.png'), join(notes, 'linked.png'));
    const reader = await VaultReader.open(root);

    await expect(
      reader.readAttachment('notes/report.md', 'https://example.org/tracker.png'),
    ).rejects.toThrow('vault_attachment_source_invalid');
    await expect(reader.readAttachment('notes/report.md', '../../outside.png')).rejects.toThrow(
      'vault_path_escape',
    );
    await expect(
      reader.readAttachment('notes/report.md', '%2e%2e/%2e%2e/outside.png'),
    ).rejects.toThrow('vault_path_escape');
    await expect(reader.readAttachment('notes/report.md', './linked.png')).rejects.toThrow(
      'vault_symlink_not_allowed',
    );
    await expect(reader.readAttachment('notes/report.md', './diagram.svg')).rejects.toThrow(
      'vault_attachment_type_not_allowed',
    );
    await expect(reader.readAttachment('notes/report.md', './disguised.png')).rejects.toThrow(
      'vault_attachment_content_mismatch',
    );
  });

  it('enforces the raster attachment byte cap at read time', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'note.md'), '# Note');
    await writeFile(join(root, 'large.webp'), Buffer.from('12345'));
    const reader = await VaultReader.open(root, { maxAttachmentBytes: 4 });

    await expect(reader.readAttachment('note.md', './large.webp')).rejects.toThrow(
      'vault_attachment_too_large',
    );
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
