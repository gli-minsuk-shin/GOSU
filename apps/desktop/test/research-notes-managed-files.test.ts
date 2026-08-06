import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ResearchNotesManagedFiles,
  safeResearchNotesFolderName,
  type ResearchNotesOwnership,
  type ResearchNotesPendingMarkdownBundle,
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

function pendingJournal(bundleId: string, attemptId: string): ResearchNotesPendingMarkdownBundle {
  return {
    schemaVersion: 1,
    kind: 'lecture-revision',
    projectId: OWNERSHIP.projectId,
    bindingId: OWNERSHIP.bindingId,
    vaultId: OWNERSHIP.vaultId,
    bundleId,
    studioId: '33333333-3333-4333-8333-333333333333',
    revision: 1,
    attemptId,
    sourceManifestSha256: 'c'.repeat(64),
    files: [
      { name: 'Lecture Notes.md', contentSha256: '0'.repeat(64) },
      { name: 'Slides.md', contentSha256: '0'.repeat(64) },
    ],
  };
}

async function pendingFixture() {
  const root = await temporaryVault();
  const writer = new ResearchNotesManagedFiles(root);
  await writer.createProjectWorkspace(
    'Research Project',
    OWNERSHIP,
    ['Lecture Notes & Slides'],
    {},
  );
  return { root, projectRoot: join(root, 'GOSU', 'Research Project'), writer };
}

async function createPendingBundle(
  writer: ResearchNotesManagedFiles,
  relativeBundlePath: string,
  bundleId: string,
  attemptId: string,
) {
  await writer.createUserMarkdownBundle(
    'Research Project',
    relativeBundlePath,
    [
      { name: 'Lecture Notes.md', content: `# Notes for ${relativeBundlePath}\n` },
      { name: 'Slides.md', content: `# Slides for ${relativeBundlePath}\n` },
    ],
    pendingJournal(bundleId, attemptId),
    OWNERSHIP,
  );
}

async function pendingIndexFiles(projectRoot: string) {
  return (await readdir(join(projectRoot, '.gosu-pending-bundles'))).filter((name) =>
    name.endsWith('.json'),
  );
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

  it('syncs the category directory after an exclusive user Markdown create', async () => {
    const root = await temporaryVault();
    await new ResearchNotesManagedFiles(root).createProjectWorkspace(
      'Research Project',
      OWNERSHIP,
      ['Experiments'],
      {},
    );
    const directorySync = vi.fn(async () => undefined);
    const writer = new ResearchNotesManagedFiles(root, directorySync);

    await expect(
      writer.createUserMarkdown(
        'Research Project',
        'Experiments/Durable result.md',
        '# Durable result\n',
        OWNERSHIP,
      ),
    ).resolves.toBe(true);

    expect(directorySync).toHaveBeenCalledExactlyOnceWith(
      join(root, 'GOSU', 'Research Project', 'Experiments'),
    );
  });

  it('tolerates only an unsupported directory sync and surfaces real I/O uncertainty', async () => {
    const root = await temporaryVault();
    await new ResearchNotesManagedFiles(root).createProjectWorkspace(
      'Research Project',
      OWNERSHIP,
      ['Experiments'],
      {},
    );
    const unsupported = Object.assign(new Error('directory fsync unsupported'), {
      code: 'EINVAL',
    });
    const unsupportedWriter = new ResearchNotesManagedFiles(
      root,
      vi.fn(async () => Promise.reject(unsupported)),
    );

    await expect(
      unsupportedWriter.createUserMarkdown(
        'Research Project',
        'Experiments/Unsupported fsync.md',
        '# Still created\n',
        OWNERSHIP,
      ),
    ).resolves.toBe(true);

    const ioFailure = Object.assign(new Error('directory fsync failed'), { code: 'EIO' });
    const failingWriter = new ResearchNotesManagedFiles(
      root,
      vi.fn(async () => Promise.reject(ioFailure)),
    );
    await expect(
      failingWriter.createUserMarkdown(
        'Research Project',
        'Experiments/Uncertain fsync.md',
        '# Commit uncertain\n',
        OWNERSHIP,
      ),
    ).rejects.toMatchObject({ code: 'EIO' });
    await expect(
      readFile(join(root, 'GOSU', 'Research Project', 'Experiments', 'Uncertain fsync.md'), 'utf8'),
    ).resolves.toBe('# Commit uncertain\n');
  });

  it('rejects user Markdown that the Research Notes reader could not reopen', async () => {
    const root = await temporaryVault();
    const writer = new ResearchNotesManagedFiles(root);
    await writer.createProjectWorkspace('Research Project', OWNERSHIP, ['Papers'], {});

    await expect(
      writer.createUserMarkdown(
        'Research Project',
        'Papers/oversized.md',
        '한'.repeat(700_000),
        OWNERSHIP,
      ),
    ).rejects.toThrow('research_notes_markdown_too_large');
    await expect(
      readFile(join(root, 'GOSU', 'Research Project', 'Papers', 'oversized.md')),
    ).rejects.toThrow();
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

describe('ResearchNotesManagedFiles pending bundle index', () => {
  it('finds a pending bundle after more than 256 confirmed revision folders', async () => {
    const { projectRoot, writer } = await pendingFixture();
    const lectureRoot = join(projectRoot, 'Lecture Notes & Slides');
    await Promise.all(
      Array.from({ length: 300 }, (_, index) =>
        mkdir(join(lectureRoot, `confirmed-${String(index).padStart(3, '0')}`)),
      ),
    );
    const relativeBundlePath = 'Lecture Notes & Slides/zz-pending';
    await createPendingBundle(
      writer,
      relativeBundlePath,
      'd'.repeat(64),
      '44444444-4444-4444-8444-444444444444',
    );

    const pending = await writer.listPendingUserMarkdownBundles(
      'Research Project',
      'Lecture Notes & Slides',
      OWNERSHIP,
    );

    expect(pending).toHaveLength(1);
    expect(pending[0]?.relativeBundlePath).toBe(relativeBundlePath);
  });

  it('durably rotates a bounded scan so active entries cannot starve later ones', async () => {
    const { writer } = await pendingFixture();
    const paths = [
      'Lecture Notes & Slides/a',
      'Lecture Notes & Slides/b',
      'Lecture Notes & Slides/c',
    ];
    const attempts = [
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ];
    for (const [index, path] of paths.entries()) {
      await createPendingBundle(writer, path!, String(index + 1).repeat(64), attempts[index]!);
    }

    const discovered = new Set<string>();
    for (let index = 0; index < paths.length; index += 1) {
      const [entry] = await writer.listPendingUserMarkdownBundles(
        'Research Project',
        'Lecture Notes & Slides',
        OWNERSHIP,
        1,
      );
      expect(entry).toBeDefined();
      discovered.add(entry!.relativeBundlePath);
    }

    expect(discovered).toEqual(new Set(paths));
  });

  it('cleans orphan indexes without removing a conflicting user target', async () => {
    const { projectRoot, writer } = await pendingFixture();
    const missingPath = 'Lecture Notes & Slides/missing-target';
    await createPendingBundle(
      writer,
      missingPath,
      'e'.repeat(64),
      '44444444-4444-4444-8444-444444444444',
    );
    await rm(join(projectRoot, missingPath), { recursive: true });

    await expect(
      writer.listPendingUserMarkdownBundles(
        'Research Project',
        'Lecture Notes & Slides',
        OWNERSHIP,
      ),
    ).resolves.toEqual([]);
    expect(await pendingIndexFiles(projectRoot)).toEqual([]);

    const conflictPath = 'Lecture Notes & Slides/user-conflict';
    await createPendingBundle(
      writer,
      conflictPath,
      'f'.repeat(64),
      '55555555-5555-4555-8555-555555555555',
    );
    await rm(join(projectRoot, conflictPath), { recursive: true });
    await writeFile(join(projectRoot, conflictPath), 'user-owned conflict\n', 'utf8');

    await expect(
      writer.listPendingUserMarkdownBundles(
        'Research Project',
        'Lecture Notes & Slides',
        OWNERSHIP,
      ),
    ).resolves.toEqual([]);
    await expect(readFile(join(projectRoot, conflictPath), 'utf8')).resolves.toBe(
      'user-owned conflict\n',
    );
    expect(await pendingIndexFiles(projectRoot)).toHaveLength(1);
  });

  it('finishes index cleanup when confirmation removed the journal first', async () => {
    const { projectRoot, writer } = await pendingFixture();
    const relativeBundlePath = 'Lecture Notes & Slides/confirmed-before-index-cleanup';
    await createPendingBundle(
      writer,
      relativeBundlePath,
      '9'.repeat(64),
      '44444444-4444-4444-8444-444444444444',
    );
    const bundlePath = join(projectRoot, relativeBundlePath);
    await rm(join(bundlePath, '.gosu-pending-bundle.json'));

    await expect(
      writer.listPendingUserMarkdownBundles(
        'Research Project',
        'Lecture Notes & Slides',
        OWNERSHIP,
      ),
    ).resolves.toEqual([]);
    expect((await readdir(bundlePath)).sort()).toEqual(['Lecture Notes.md', 'Slides.md']);
    expect(await pendingIndexFiles(projectRoot)).toEqual([]);
  });
});

function managedHeader() {
  return `---\ngosu_project_id: ${JSON.stringify(OWNERSHIP.projectId)}\n---\n<!-- GOSU-MANAGED-FILE v1: fixture -->\n`;
}
