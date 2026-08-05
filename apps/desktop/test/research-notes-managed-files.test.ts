import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ResearchNotesManagedFiles,
  safeResearchNotesFolderName,
  type ResearchNotesOwnership,
} from '../src/main/research-notes-managed-files';

const temporaryDirectories: string[] = [];
const OWNERSHIP: ResearchNotesOwnership = {
  schemaVersion: 1,
  projectId: '11111111-1111-4111-8111-111111111111',
  bindingId: 'a'.repeat(64),
  vaultId: 'b'.repeat(64),
  projectName: 'Research Project',
};

async function temporaryVault() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-research-notes-files-'));
  temporaryDirectories.push(root);
  return realpath(root);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('safe Research Notes folder names', () => {
  it('normalizes separators, control characters, compatibility text, and empty names', () => {
    expect(safeResearchNotesFolderName('  ＦＭ／ＬＭ:\n  ')).toBe('FM LM');
    expect(safeResearchNotesFolderName('Model\\Ablation')).toBe('Model Ablation');
    expect(safeResearchNotesFolderName('...')).toBe('Untitled Project');
    expect(safeResearchNotesFolderName('../outside')).toBe('outside');
  });

  it('limits the UTF-8 byte length without cutting a Unicode character', () => {
    const result = safeResearchNotesFolderName('한'.repeat(100));

    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(160);
    expect(result).toMatch(/^한+$/u);
    expect(result.endsWith('�')).toBe(false);
  });
});

describe('ResearchNotesManagedFiles', () => {
  it('creates an owned default workspace idempotently without overwriting user edits', async () => {
    const root = await temporaryVault();
    const writer = new ResearchNotesManagedFiles(root);
    const templates = {
      'Experiments/Experiment Log.md': '# Experiment Log\n',
      'Project Progress/Project Progress.md': '# Project Progress\n',
    };

    await writer.createProjectWorkspace(
      'Research Project',
      OWNERSHIP,
      ['Literature', 'Papers', 'Experiments', 'Project Progress', 'Idea Development'],
      templates,
    );
    await writeFile(
      join(root, 'GOSU', 'Research Project', 'Experiments', 'Experiment Log.md'),
      '# Human edit\n',
    );
    await writer.createProjectWorkspace(
      'Research Project',
      OWNERSHIP,
      ['Literature', 'Papers', 'Experiments', 'Project Progress', 'Idea Development'],
      templates,
    );

    await expect(writer.readOwnership('Research Project')).resolves.toEqual(OWNERSHIP);
    await expect(
      readFile(join(root, 'GOSU', 'Research Project', 'Experiments', 'Experiment Log.md'), 'utf8'),
    ).resolves.toBe('# Human edit\n');
    for (const folder of [
      'Literature',
      'Papers',
      'Experiments',
      'Project Progress',
      'Idea Development',
    ]) {
      expect((await lstat(join(root, 'GOSU', 'Research Project', folder))).isDirectory()).toBe(
        true,
      );
    }
  });

  it('rejects an existing project folder owned by another binding', async () => {
    const root = await temporaryVault();
    const writer = new ResearchNotesManagedFiles(root);
    await writer.createProjectWorkspace('Research Project', OWNERSHIP, [], {});

    await expect(
      writer.createProjectWorkspace(
        'Research Project',
        { ...OWNERSHIP, bindingId: 'c'.repeat(64) },
        [],
        {},
      ),
    ).rejects.toThrow('research_notes_folder_conflict');
  });

  it('rejects traversal and symlinked workspace paths', async () => {
    const root = await temporaryVault();
    const outside = await mkdtemp(join(tmpdir(), 'gosu-research-notes-outside-'));
    temporaryDirectories.push(outside);
    const writer = new ResearchNotesManagedFiles(root);
    await mkdir(join(root, 'GOSU'));
    await symlink(outside, join(root, 'GOSU', 'Linked Project'));

    await expect(
      writer.createProjectWorkspace('Linked Project', OWNERSHIP, ['Literature'], {}),
    ).rejects.toThrow('research_notes_folder_conflict');
    await expect(
      writer.createProjectWorkspace('../Outside', OWNERSHIP, ['Literature'], {}),
    ).rejects.toThrow('research_notes_path_escape');
  });

  it('rejects a project root replaced by a symlink before any managed or user write', async () => {
    const root = await temporaryVault();
    const outside = await mkdtemp(join(tmpdir(), 'gosu-research-notes-replacement-'));
    temporaryDirectories.push(outside);
    const writer = new ResearchNotesManagedFiles(root);
    await writer.createProjectWorkspace(
      'Research Project',
      OWNERSHIP,
      ['Literature', 'Papers'],
      {},
    );
    await rename(join(root, 'GOSU', 'Research Project'), join(root, 'GOSU', 'Moved Project'));
    await symlink(outside, join(root, 'GOSU', 'Research Project'));

    await expect(
      writer.writeManagedMarkdown(
        'Research Project',
        'Literature/Literature Review.md',
        '# Must stay in the Vault\n',
        OWNERSHIP,
      ),
    ).rejects.toThrow('research_notes_folder_ownership_changed');
    await expect(
      writer.createUserMarkdown(
        'Research Project',
        'Papers/paper.md',
        '# Must stay in the Vault\n',
        OWNERSHIP,
      ),
    ).rejects.toThrow('research_notes_folder_ownership_changed');
  });

  it('updates managed files atomically and creates user notes only once', async () => {
    const root = await temporaryVault();
    const writer = new ResearchNotesManagedFiles(root);
    await writer.createProjectWorkspace(
      'Research Project',
      OWNERSHIP,
      ['Literature', 'Papers'],
      {},
    );

    await writer.writeManagedMarkdown(
      'Research Project',
      'Literature/Literature Review.md',
      `${managedHeader()}# First projection\n`,
      OWNERSHIP,
    );
    await writer.writeManagedMarkdown(
      'Research Project',
      'Literature/Literature Review.md',
      `${managedHeader()}# Second projection\n`,
      OWNERSHIP,
    );
    expect(
      await readFile(
        join(root, 'GOSU', 'Research Project', 'Literature', 'Literature Review.md'),
        'utf8',
      ),
    ).toBe(`${managedHeader()}# Second projection\n`);

    await expect(
      writer.createUserMarkdown('Research Project', 'Papers/paper.md', '# First note\n', OWNERSHIP),
    ).resolves.toBe(true);
    await expect(
      writer.createUserMarkdown(
        'Research Project',
        'Papers/paper.md',
        '# Replacement\n',
        OWNERSHIP,
      ),
    ).resolves.toBe(false);
    await expect(
      readFile(join(root, 'GOSU', 'Research Project', 'Papers', 'paper.md'), 'utf8'),
    ).resolves.toBe('# First note\n');
  });

  it('rejects managed and user writes after the ownership marker changes', async () => {
    const root = await temporaryVault();
    const writer = new ResearchNotesManagedFiles(root);
    await writer.createProjectWorkspace(
      'Research Project',
      OWNERSHIP,
      ['Literature', 'Papers'],
      {},
    );
    await writeFile(
      join(root, 'GOSU', 'Research Project', '.gosu-project.json'),
      `${JSON.stringify({ ...OWNERSHIP, bindingId: 'c'.repeat(64) }, null, 2)}\n`,
    );

    await expect(
      writer.writeManagedMarkdown(
        'Research Project',
        'Literature/Literature Review.md',
        `${managedHeader()}# Generated review\n`,
        OWNERSHIP,
      ),
    ).rejects.toThrow('research_notes_folder_ownership_changed');
    await expect(
      writer.createUserMarkdown(
        'Research Project',
        'Papers/paper.md',
        '# Generated note\n',
        OWNERSHIP,
      ),
    ).rejects.toThrow('research_notes_folder_ownership_changed');
    await expect(
      readFile(join(root, 'GOSU', 'Research Project', 'Literature', 'Literature Review.md')),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, 'GOSU', 'Research Project', 'Papers', 'paper.md')),
    ).rejects.toThrow();
  });

  it('does not replace a user-authored file at a managed projection path', async () => {
    const root = await temporaryVault();
    const writer = new ResearchNotesManagedFiles(root);
    await writer.createProjectWorkspace('Research Project', OWNERSHIP, ['Literature'], {});
    const path = join(root, 'GOSU', 'Research Project', 'Literature', 'Literature Review.md');
    await writeFile(path, '# My hand-written literature review\n');

    await expect(
      writer.writeManagedMarkdown(
        'Research Project',
        'Literature/Literature Review.md',
        `${managedHeader()}# Generated review\n`,
        OWNERSHIP,
      ),
    ).rejects.toThrow('research_notes_folder_conflict');
    await expect(readFile(path, 'utf8')).resolves.toBe('# My hand-written literature review\n');
  });

  it('renames only the owned folder and fails closed on destination collisions', async () => {
    const root = await temporaryVault();
    const writer = new ResearchNotesManagedFiles(root);
    await writer.createProjectWorkspace('Old Name', OWNERSHIP, ['Literature'], {
      'Literature/Literature Review.md': '# Evidence\n',
    });
    await mkdir(join(root, 'GOSU', 'Occupied Name'));

    await expect(
      writer.renameProjectWorkspace('Old Name', 'Occupied Name', {
        ...OWNERSHIP,
        projectName: 'Occupied Name',
      }),
    ).rejects.toThrow('research_notes_folder_conflict');
    await expect(lstat(join(root, 'GOSU', 'Old Name'))).resolves.toBeDefined();

    const renamedOwnership = { ...OWNERSHIP, projectName: 'New Name' };
    await writer.renameProjectWorkspace('Old Name', 'New Name', renamedOwnership);
    await expect(
      readFile(join(root, 'GOSU', 'New Name', 'Literature', 'Literature Review.md'), 'utf8'),
    ).resolves.toBe('# Evidence\n');
    await expect(writer.readOwnership('New Name')).resolves.toEqual(renamedOwnership);

    await expect(
      writer.renameProjectWorkspace('Old Name', 'New Name', renamedOwnership),
    ).resolves.toBeUndefined();
  });
});

function managedHeader() {
  return `---\ngosu_project_id: ${JSON.stringify(OWNERSHIP.projectId)}\n---\n<!-- GOSU-MANAGED-FILE v1: fixture -->\n`;
}
