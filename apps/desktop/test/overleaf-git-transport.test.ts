import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OverleafGitTransport, parseOverleafGitRemote } from '../src/main/overleaf-git-transport';
import type { OverleafGitTransportError } from '../src/main/overleaf-git-transport';
import { createGitCommandRunner, type GitCommandRunner } from '../src/main/git-command-runner';
import type { GitBlobBatchReader } from '../src/main/git-blob-batch-reader';

const CREDENTIAL_REF = 'overleaf-git:0123456789abcdef01234567:01234567-89ab-4cde-8fab-0123456789ab';
const credentials = { readByReference: async () => 'private-overleaf-token' };
const BINDING_ID = '01234567-89ab-4cde-8fab-0123456789ab';

type CheckpointFixtureFile = Readonly<{
  path: string;
  bytes: Uint8Array;
  mode?: '100644' | '100755' | '120000' | '160000';
  type?: 'blob' | 'commit';
}>;

function checkpointDigest(revision: string, tree: string) {
  return `sha256:${createHash('sha256')
    .update(`overleaf_git\0${revision}\0${tree}`, 'utf8')
    .digest('hex')}`;
}

function fixtureBlobRevision(bytes: Uint8Array) {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function checkpointFixtureRunner(
  input: Readonly<{
    revision: string;
    tree: string;
    files: readonly CheckpointFixtureFile[];
  }>,
) {
  return vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
    if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{commit}')) {
      return `${input.revision}\n`;
    }
    if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{tree}')) {
      return `${input.tree}\n`;
    }
    if (arguments_[0] === 'ls-tree' && arguments_.includes('-r')) {
      return input.files
        .map((file, index) => {
          const mode = file.mode ?? '100644';
          const type = file.type ?? (mode === '160000' ? 'commit' : 'blob');
          const size = type === 'commit' ? '-' : file.bytes.byteLength;
          const objectId =
            type === 'blob'
              ? fixtureBlobRevision(file.bytes)
              : (index + 1).toString(16).padStart(40, '0');
          return `${mode} ${type} ${objectId} ${String(size).padStart(7)}\t${file.path}\0`;
        })
        .join('');
    }
    if (arguments_[0] === 'ls-tree') {
      const rootDocument = arguments_.at(-1);
      const file = input.files.find((candidate) => candidate.path === rootDocument);
      if (!file) return '';
      const mode = file.mode ?? '100644';
      const type = file.type ?? (mode === '160000' ? 'commit' : 'blob');
      const objectId = type === 'blob' ? fixtureBlobRevision(file.bytes) : 'a'.repeat(40);
      return `${mode} ${type} ${objectId}\t${file.path}\0`;
    }
    if (arguments_[0] === 'cat-file' || arguments_[0] === 'fsck') return '';
    throw new Error(`unexpected_git_command:${arguments_.join(' ')}`);
  });
}

function checkpointFixtureBlobReader(
  input: Readonly<{
    files: readonly CheckpointFixtureFile[];
    blobFiles?: readonly CheckpointFixtureFile[];
  }>,
) {
  return vi.fn<GitBlobBatchReader>(async (_cwd, requests, limits) => {
    expect(requests.length).toBeLessThanOrEqual(limits.maxObjects);
    const available = new Map(
      (input.blobFiles ?? input.files)
        .filter((file) => (file.type ?? 'blob') === 'blob')
        .map((file) => [fixtureBlobRevision(file.bytes), file.bytes] as const),
    );
    const result = new Map<string, Uint8Array>();
    for (const request of requests) {
      const bytes = available.get(request.objectId);
      if (bytes) result.set(request.objectId, bytes);
    }
    return result;
  });
}

function checkpointFixtureTransport(
  root: string,
  input: Readonly<{
    revision: string;
    tree: string;
    files: readonly CheckpointFixtureFile[];
    blobFiles?: readonly CheckpointFixtureFile[];
  }>,
  limits: Readonly<{
    maxSourceFiles?: number;
    maxSourceFileBytes?: number;
    maxSourceTreeBytes?: number;
    maxSourceTextBytes?: number;
  }> = {},
) {
  const runGit = checkpointFixtureRunner(input);
  return {
    runGit,
    transport: new OverleafGitTransport({
      rootDirectory: () => root,
      credentials,
      runGit,
      readGitBlobs: checkpointFixtureBlobReader(input),
      ...limits,
    }),
  } as const;
}

describe('Overleaf Git checkpoint transport', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gosu-overleaf-git-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reconciles only exact stale archive directories inside verified binding directories', async () => {
    const binding = join(root, BINDING_ID);
    const stale = join(binding, '.gosu-archive-11111111-1111-4111-8111-111111111111');
    const preservedDirectory = join(binding, '.gosu-archive-not-a-uuid');
    const preservedFile = join(binding, '.gosu-archive-33333333-3333-4333-8333-333333333333');
    const nonBindingArchive = join(
      root,
      'not-a-binding',
      '.gosu-archive-44444444-4444-4444-8444-444444444444',
    );
    const outside = await mkdtemp(join(tmpdir(), 'gosu-overleaf-archive-outside-'));
    const preservedSymlink = join(binding, '.gosu-archive-22222222-2222-4222-8222-222222222222');
    try {
      await Promise.all([
        mkdir(stale, { recursive: true }),
        mkdir(preservedDirectory, { recursive: true }),
        mkdir(nonBindingArchive, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(join(stale, 'checkpoint.zip'), 'abandoned source archive'),
        writeFile(preservedFile, 'not a directory'),
        writeFile(join(outside, 'keep.txt'), 'outside'),
      ]);
      await symlink(outside, preservedSymlink);
      const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials });

      await transport.reconcileStaleArchives();

      await expect(access(stale)).rejects.toBeDefined();
      await expect(access(preservedDirectory)).resolves.toBeUndefined();
      await expect(access(preservedFile)).resolves.toBeUndefined();
      await expect(access(preservedSymlink)).resolves.toBeUndefined();
      await expect(access(nonBindingArchive)).resolves.toBeUndefined();
      await expect(access(join(outside, 'keep.txt'))).resolves.toBeUndefined();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('normalizes the official copied and credential-free HTTPS project endpoints', () => {
    expect(parseOverleafGitRemote('https://git@git.overleaf.com/0123456789abcdef01234567')).toEqual(
      {
        workspaceId: '0123456789abcdef01234567',
        remoteUrl: 'https://git.overleaf.com/0123456789abcdef01234567',
        webUrl: 'https://www.overleaf.com/project/0123456789abcdef01234567',
      },
    );
    expect(parseOverleafGitRemote('https://git.overleaf.com/0123456789abcdef01234567.git')).toEqual(
      expect.objectContaining({ workspaceId: '0123456789abcdef01234567' }),
    );
  });

  it.each([
    'http://git.overleaf.com/0123456789abcdef01234567',
    'https://GIT@git.overleaf.com/0123456789abcdef01234567',
    'https://other@git.overleaf.com/0123456789abcdef01234567',
    'https://git:secret@git.overleaf.com/0123456789abcdef01234567',
    'https://evil.example/0123456789abcdef01234567',
    'https://git.overleaf.com/not-a-project',
    'https://git.overleaf.com/0123456789abcdef01234567?token=secret',
    'https://git@git.overleaf.com/0123456789abcdef01234567#fragment',
  ])('rejects unsafe or non-official remotes: %s', (remote) => {
    expect(() => parseOverleafGitRemote(remote)).toThrow(
      expect.objectContaining<Partial<OverleafGitTransportError>>({
        code: 'overleaf_git_url_invalid',
      }),
    );
  });

  it('checks the advertised master without downloading manuscript content', async () => {
    const revision = 'a'.repeat(40);
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      expect(arguments_).toEqual([
        'ls-remote',
        '--refs',
        'https://git.overleaf.com/0123456789abcdef01234567',
        'refs/heads/master',
      ]);
      return `${revision}\trefs/heads/master\n`;
    });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });

    await expect(
      transport.inspect('https://git@git.overleaf.com/0123456789abcdef01234567', CREDENTIAL_REF),
    ).resolves.toEqual({
      workspaceRevision: revision,
      treeRevision: '',
      revisionEnvelopeDigest: '',
    });
    expect(runGit).toHaveBeenCalledOnce();
    expect(runGit.mock.calls[0]?.[2]).toMatchObject({
      network: true,
      credential: {
        username: 'git',
        scopeUrl: 'https://git.overleaf.com/0123456789abcdef01234567',
      },
    });
  });

  it('reports a missing Overleaf master branch without relying on Git exit-code mode', async () => {
    const runGit = vi.fn<GitCommandRunner>(async () => '');
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });

    await expect(
      transport.inspect('https://git.overleaf.com/0123456789abcdef01234567', CREDENTIAL_REF),
    ).rejects.toMatchObject({ code: 'overleaf_git_default_branch_missing' });
    expect(runGit.mock.calls[0]?.[1]).not.toContain('--exit-code');
  });

  it('fails closed when an expected remote revision changed before fetch', async () => {
    const runGit = vi.fn<GitCommandRunner>(async () => `${'b'.repeat(40)}\trefs/heads/master\n`);
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });

    await expect(
      transport.fetchCheckpoint(
        '01234567-89ab-4cde-8fab-0123456789ab',
        'https://git.overleaf.com/0123456789abcdef01234567',
        CREDENTIAL_REF,
        'a'.repeat(40),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<OverleafGitTransportError>>({
        code: 'overleaf_git_remote_rewritten',
      }),
    );
    expect(runGit).toHaveBeenCalledOnce();
  });

  it('never constructs push, merge, rebase, or force operations', async () => {
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const commands: string[][] = [];
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      commands.push([...arguments_]);
      if (arguments_[0] === 'ls-remote') return `${revision}\trefs/heads/master\n`;
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{commit}')) {
        return `${revision}\n`;
      }
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{tree}')) {
        return `${tree}\n`;
      }
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.startsWith('refs/gosu/checkpoints')) {
        throw new Error('missing');
      }
      if (arguments_[0] === 'rev-parse') return 'true\n';
      if (arguments_[0] === 'ls-tree') {
        return `100644 blob ${'e'.repeat(40)}\tpaper/main.tex\0`;
      }
      return '';
    });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });

    const checkpoint = await transport.fetchCheckpoint(
      '01234567-89ab-4cde-8fab-0123456789ab',
      'https://git@git.overleaf.com/0123456789abcdef01234567',
      CREDENTIAL_REF,
      undefined,
      'paper/main.tex',
    );

    expect(checkpoint).toMatchObject({ workspaceRevision: revision, treeRevision: tree });
    expect(checkpoint.revisionEnvelopeDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const flat = commands.flat();
    expect(flat).not.toContain('push');
    expect(flat).not.toContain('merge');
    expect(flat).not.toContain('rebase');
    expect(flat).not.toContain('--force');
    expect(commands.some((command) => command[0] === 'fetch')).toBe(true);
    expect(commands.find((command) => command[0] === 'fetch')).toContain('--depth=1');
    expect(commands.flat()).not.toContain('https://git@git.overleaf.com/0123456789abcdef01234567');
    expect(
      runGit.mock.calls
        .filter(([, , options]) => options?.network)
        .every(
          ([, , options]) =>
            options?.credential?.scopeUrl === 'https://git.overleaf.com/0123456789abcdef01234567',
        ),
    ).toBe(true);
    expect(commands.some((command) => command[0] === 'update-ref')).toBe(true);
  });

  it('rejects and prunes a fetched checkpoint that exceeds the local mirror quota', async () => {
    const bindingId = '01234567-89ab-4cde-8fab-0123456789ab';
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const mirror = join(root, bindingId, 'mirror.git');
    await mkdir(mirror, { recursive: true });
    const commands: string[][] = [];
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      commands.push([...arguments_]);
      if (arguments_[0] === 'ls-remote') return `${revision}\trefs/heads/master\n`;
      if (arguments_[0] === 'fetch') {
        await writeFile(join(mirror, 'incoming.pack'), Buffer.alloc(128));
        return '';
      }
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{commit}')) {
        return `${revision}\n`;
      }
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{tree}')) {
        return `${tree}\n`;
      }
      if (arguments_[0] === 'rev-parse') return 'true\n';
      return '';
    });
    const transport = new OverleafGitTransport({
      rootDirectory: () => root,
      credentials,
      runGit,
      maxMirrorBytes: 64,
    });

    await expect(
      transport.fetchCheckpoint(
        bindingId,
        'https://git.overleaf.com/0123456789abcdef01234567',
        CREDENTIAL_REF,
        revision,
      ),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_too_large' });

    expect(commands).toContainEqual(['reflog', 'expire', '--expire=now', '--all']);
    expect(commands).toContainEqual(['gc', '--prune=now']);
    expect(
      commands.some(
        (command) =>
          command[0] === 'update-ref' &&
          command[1] === '--no-deref' &&
          command[2]?.startsWith('refs/gosu/checkpoints/'),
      ),
    ).toBe(false);
  });

  it('prunes unverified objects even when the fetch command fails after writing data', async () => {
    const bindingId = '01234567-89ab-4cde-8fab-0123456789ab';
    const revision = 'c'.repeat(40);
    const mirror = join(root, bindingId, 'mirror.git');
    await mkdir(mirror, { recursive: true });
    const commands: string[][] = [];
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      commands.push([...arguments_]);
      if (arguments_[0] === 'rev-parse') return 'true\n';
      if (arguments_[0] === 'fetch') {
        await writeFile(join(mirror, 'interrupted.pack'), Buffer.alloc(128));
        throw new Error('simulated_fetch_failure');
      }
      return '';
    });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });

    await expect(
      transport.restoreCheckpoint(
        bindingId,
        'https://git.overleaf.com/0123456789abcdef01234567',
        CREDENTIAL_REF,
        revision,
        'paper/main.tex',
        `sha256:${'d'.repeat(64)}`,
      ),
    ).rejects.toMatchObject({ code: 'overleaf_git_unavailable' });

    expect(commands).toContainEqual(['reflog', 'expire', '--expire=now', '--all']);
    expect(commands).toContainEqual(['gc', '--prune=now']);
  });

  it('rejects a new fetch when retained manuscript mirrors exceed the aggregate quota', async () => {
    const bindingId = '01234567-89ab-4cde-8fab-0123456789ab';
    const mirror = join(root, bindingId, 'mirror.git');
    await mkdir(mirror, { recursive: true });
    await writeFile(join(root, 'retained-sibling.pack'), Buffer.alloc(128));
    const commands: string[][] = [];
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      commands.push([...arguments_]);
      if (arguments_[0] === 'rev-parse') return 'true\n';
      return '';
    });
    const transport = new OverleafGitTransport({
      rootDirectory: () => root,
      credentials,
      runGit,
      maxMirrorBytes: 1_024,
      maxAggregateBytes: 64,
    });

    await expect(
      transport.restoreCheckpoint(
        bindingId,
        'https://git.overleaf.com/0123456789abcdef01234567',
        CREDENTIAL_REF,
        'c'.repeat(40),
        'paper/main.tex',
        `sha256:${'d'.repeat(64)}`,
      ),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_too_large' });
    expect(commands.some((command) => command[0] === 'fetch')).toBe(false);
  });

  it('removes only the validated binding artifact directory', async () => {
    const bindingId = '01234567-89ab-4cde-8fab-0123456789ab';
    const bindingDirectory = join(root, bindingId);
    const sibling = join(root, 'keep.txt');
    await mkdir(join(bindingDirectory, 'mirror.git'), { recursive: true });
    await writeFile(join(bindingDirectory, 'mirror.git', 'paper.pack'), 'fixture');
    await writeFile(sibling, 'keep');
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials });

    await transport.removeBindingArtifacts(bindingId);

    await expect(access(bindingDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(sibling)).resolves.toBeUndefined();
    await expect(transport.removeBindingArtifacts('../unsafe')).rejects.toMatchObject({
      code: 'overleaf_git_response_invalid',
    });
  });

  it('validates the stored commit, tree, root document, and revision envelope', async () => {
    const bindingId = '01234567-89ab-4cde-8fab-0123456789ab';
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      if (arguments_.at(-1)?.endsWith('^{commit}')) return `${revision}\n`;
      if (arguments_.at(-1)?.endsWith('^{tree}')) return `${tree}\n`;
      if (arguments_[0] === 'ls-tree') {
        return `100644 blob ${'e'.repeat(40)}\tpaper/main.tex\0`;
      }
      if (arguments_[0] === 'cat-file') return '';
      if (arguments_[0] === 'fsck') return '';
      throw new Error('unexpected_command');
    });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });
    const digest = `sha256:${createHash('sha256')
      .update(`overleaf_git\0${revision}\0${tree}`, 'utf8')
      .digest('hex')}`;

    await expect(
      transport.hasCheckpoint(bindingId, revision, 'paper/main.tex', digest),
    ).resolves.toBe(true);
    await expect(
      transport.hasCheckpoint(bindingId, revision, 'paper/main.tex', `sha256:${'0'.repeat(64)}`),
    ).resolves.toBe(false);
  });

  it('rejects a stored checkpoint when the root blob object is missing', async () => {
    const bindingId = '01234567-89ab-4cde-8fab-0123456789ab';
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      if (arguments_.at(-1)?.endsWith('^{commit}')) return `${revision}\n`;
      if (arguments_.at(-1)?.endsWith('^{tree}')) return `${tree}\n`;
      if (arguments_[0] === 'ls-tree') {
        return `100644 blob ${'e'.repeat(40)}\tpaper/main.tex\0`;
      }
      if (arguments_[0] === 'cat-file') throw new Error('missing_blob');
      throw new Error('unexpected_command');
    });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });
    const digest = `sha256:${createHash('sha256')
      .update(`overleaf_git\0${revision}\0${tree}`, 'utf8')
      .digest('hex')}`;

    await expect(
      transport.hasCheckpoint(bindingId, revision, 'paper/main.tex', digest),
    ).resolves.toBe(false);
  });

  it('rejects a stored checkpoint when another reachable manuscript object is missing', async () => {
    const bindingId = '01234567-89ab-4cde-8fab-0123456789ab';
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      if (arguments_[0] === 'fsck') throw new Error('missing_reachable_object');
      if (arguments_.at(-1)?.endsWith('^{commit}')) return `${revision}\n`;
      if (arguments_.at(-1)?.endsWith('^{tree}')) return `${tree}\n`;
      if (arguments_[0] === 'ls-tree') {
        return `100644 blob ${'e'.repeat(40)}\tpaper/main.tex\0`;
      }
      if (arguments_[0] === 'cat-file') return '';
      throw new Error('unexpected_command');
    });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });
    const digest = `sha256:${createHash('sha256')
      .update(`overleaf_git\0${revision}\0${tree}`, 'utf8')
      .digest('hex')}`;

    await expect(
      transport.hasCheckpoint(bindingId, revision, 'paper/main.tex', digest),
    ).resolves.toBe(false);
  });

  it('restores an exact historical checkpoint without requiring it to remain remote HEAD', async () => {
    const bindingId = '01234567-89ab-4cde-8fab-0123456789ab';
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const commands: string[][] = [];
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      commands.push([...arguments_]);
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{commit}')) {
        return `${revision}\n`;
      }
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{tree}')) {
        return `${tree}\n`;
      }
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.startsWith('refs/gosu/checkpoints')) {
        throw new Error('missing');
      }
      if (arguments_[0] === 'rev-parse') return 'true\n';
      if (arguments_[0] === 'ls-tree') {
        return `100644 blob ${'e'.repeat(40)}\tpaper/main.tex\0`;
      }
      return '';
    });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });
    const digest = `sha256:${createHash('sha256')
      .update(`overleaf_git\0${revision}\0${tree}`, 'utf8')
      .digest('hex')}`;

    await expect(
      transport.restoreCheckpoint(
        bindingId,
        'https://git.overleaf.com/0123456789abcdef01234567',
        CREDENTIAL_REF,
        revision,
        'paper/main.tex',
        digest,
      ),
    ).resolves.toBeUndefined();

    expect(commands.some((command) => command[0] === 'ls-remote')).toBe(false);
    expect(commands.find((command) => command[0] === 'fetch')?.at(-1)).toMatch(
      new RegExp(`^${revision}:refs/gosu/incoming/`, 'u'),
    );
  });

  it('rejects a missing, symlinked, or non-file root TeX document', async () => {
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const commands: string[][] = [];
    const runGit = vi.fn<GitCommandRunner>(async (_cwd, arguments_) => {
      commands.push([...arguments_]);
      if (arguments_[0] === 'ls-remote') return `${revision}\trefs/heads/master\n`;
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{commit}')) {
        return `${revision}\n`;
      }
      if (arguments_[0] === 'rev-parse' && arguments_.at(-1)?.endsWith('^{tree}')) {
        return `${tree}\n`;
      }
      if (arguments_[0] === 'rev-parse') return 'true\n';
      if (arguments_[0] === 'ls-tree') {
        return `120000 blob ${'e'.repeat(40)}\tpaper/main.tex\0`;
      }
      return '';
    });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });

    await expect(
      transport.fetchCheckpoint(
        '01234567-89ab-4cde-8fab-0123456789ab',
        'https://git.overleaf.com/0123456789abcdef01234567',
        CREDENTIAL_REF,
        revision,
        'paper/main.tex',
      ),
    ).rejects.toMatchObject({ code: 'overleaf_git_root_document_missing' });
    expect(commands).toContainEqual(['reflog', 'expire', '--expire=now', '--all']);
    expect(commands).toContainEqual(['gc', '--prune=now']);
  });

  it('lists bounded regular files and reads exact UTF-8 text from a verified checkpoint', async () => {
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const files = [
      { path: 'main.tex', bytes: Buffer.from('Hello, \\LaTeX!\n', 'utf8') },
      { path: 'figures/result.png', bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) },
    ] as const;
    const { runGit, transport } = checkpointFixtureTransport(root, { revision, tree, files });
    const digest = checkpointDigest(revision, tree);

    await expect(
      transport.listCheckpointFiles(BINDING_ID, revision, 'main.tex', digest),
    ).resolves.toEqual([
      { relativePath: 'figures/result.png', sizeBytes: 4, textReadable: false },
      { relativePath: 'main.tex', sizeBytes: 15, textReadable: true },
    ]);
    await expect(
      transport.readCheckpointText(BINDING_ID, revision, 'main.tex', digest, 'main.tex'),
    ).resolves.toBe('Hello, \\LaTeX!\n');
    await expect(
      transport.readCheckpointText(BINDING_ID, revision, 'main.tex', digest, 'figures/result.png'),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_file_not_text' });
    await expect(
      transport.readCheckpointText(BINDING_ID, revision, 'main.tex', digest, 'missing.tex'),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_file_not_found' });
    expect(runGit.mock.calls.some((call) => call[1][0] === 'archive')).toBe(false);
  });

  it('validates the checkpoint binding, revision, envelope, and root before source access', async () => {
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const files = [{ path: 'main.tex', bytes: Buffer.from('main') }] as const;
    const transport = new OverleafGitTransport({
      rootDirectory: () => root,
      credentials,
      runGit: checkpointFixtureRunner({ revision, tree, files }),
    });
    const digest = checkpointDigest(revision, tree);

    await expect(
      transport.listCheckpointFiles('../unsafe', revision, 'main.tex', digest),
    ).rejects.toMatchObject({ code: 'overleaf_git_response_invalid' });
    await expect(
      transport.listCheckpointFiles(BINDING_ID, 'not-a-revision', 'main.tex', digest),
    ).rejects.toMatchObject({ code: 'overleaf_git_response_invalid' });
    await expect(
      transport.listCheckpointFiles(BINDING_ID, revision, 'main.tex', `sha256:${'0'.repeat(64)}`),
    ).rejects.toMatchObject({ code: 'overleaf_git_response_invalid' });
    await expect(
      transport.listCheckpointFiles(BINDING_ID, revision, 'missing.tex', digest),
    ).rejects.toMatchObject({ code: 'overleaf_git_root_document_missing' });
  });

  it('materializes the verified binary tree only into an existing empty directory', async () => {
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const files = [
      { path: 'main.tex', bytes: Buffer.from('\\documentclass{article}\n', 'utf8') },
      { path: 'figures/result.png', bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) },
    ] as const;
    const { transport } = checkpointFixtureTransport(root, { revision, tree, files });
    const destination = await mkdtemp(join(tmpdir(), 'gosu-overleaf-materialized-'));
    const nonempty = await mkdtemp(join(tmpdir(), 'gosu-overleaf-nonempty-'));
    await writeFile(join(nonempty, 'keep.txt'), 'keep');
    try {
      await expect(
        transport.materializeCheckpoint(
          BINDING_ID,
          revision,
          'main.tex',
          checkpointDigest(revision, tree),
          destination,
        ),
      ).resolves.toEqual({
        destinationDirectory: destination,
        fileCount: 2,
        totalBytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
      });
      await expect(readFile(join(destination, 'main.tex'), 'utf8')).resolves.toBe(
        '\\documentclass{article}\n',
      );
      await expect(readFile(join(destination, 'figures', 'result.png'))).resolves.toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      );
      expect((await lstat(join(destination, 'main.tex'))).isSymbolicLink()).toBe(false);
      await expect(
        transport.materializeCheckpoint(
          BINDING_ID,
          revision,
          'main.tex',
          checkpointDigest(revision, tree),
          nonempty,
        ),
      ).rejects.toMatchObject({ code: 'overleaf_git_response_invalid' });
    } finally {
      await rm(destination, { recursive: true, force: true });
      await rm(nonempty, { recursive: true, force: true });
    }
  });

  it('reads exact committed blobs despite export-ignore/export-subst and preserves binary images', async () => {
    const mirror = join(root, BINDING_ID, 'mirror.git');
    await mkdir(mirror, { recursive: true });
    const runGit = createGitCommandRunner();
    await runGit(mirror, ['init', '--initial-branch=master', '.']);
    const exactIgnored = 'This committed source must not disappear.\n';
    const exactSubstitution = 'Checkpoint identity: $Format:%H$\n';
    const binaryImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a, 0x1a]);
    await mkdir(join(mirror, 'figures'));
    await Promise.all([
      writeFile(
        join(mirror, '.gitattributes'),
        'ignored.tex export-ignore\nsubst.tex export-subst\n',
      ),
      writeFile(join(mirror, 'main.tex'), '\\input{ignored}\\input{subst}\n'),
      writeFile(join(mirror, 'ignored.tex'), exactIgnored),
      writeFile(join(mirror, 'subst.tex'), exactSubstitution),
      writeFile(join(mirror, 'figures', 'result.png'), binaryImage),
    ]);
    await runGit(mirror, ['add', '--all']);
    await runGit(mirror, [
      '-c',
      'user.name=GOSU Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--no-gpg-sign',
      '-m',
      'exact blob fixture',
    ]);
    const revision = (await runGit(mirror, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    const tree = (await runGit(mirror, ['rev-parse', '--verify', 'HEAD^{tree}'])).trim();
    await runGit(mirror, ['update-ref', `refs/gosu/checkpoints/${revision}`, revision]);
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });
    const destination = await mkdtemp(join(tmpdir(), 'gosu-overleaf-exact-blobs-'));
    try {
      await expect(
        transport.readCheckpointText(
          BINDING_ID,
          revision,
          'main.tex',
          checkpointDigest(revision, tree),
          'ignored.tex',
        ),
      ).resolves.toBe(exactIgnored);
      await expect(
        transport.readCheckpointText(
          BINDING_ID,
          revision,
          'main.tex',
          checkpointDigest(revision, tree),
          'subst.tex',
        ),
      ).resolves.toBe(exactSubstitution);
      await expect(
        transport.materializeCheckpoint(
          BINDING_ID,
          revision,
          'main.tex',
          checkpointDigest(revision, tree),
          destination,
        ),
      ).resolves.toMatchObject({ fileCount: 5 });
      await expect(readFile(join(destination, 'ignored.tex'), 'utf8')).resolves.toBe(exactIgnored);
      await expect(readFile(join(destination, 'subst.tex'), 'utf8')).resolves.toBe(
        exactSubstitution,
      );
      await expect(readFile(join(destination, 'figures', 'result.png'))).resolves.toEqual(
        binaryImage,
      );
    } finally {
      await rm(destination, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: 'symbolic link',
      files: [
        { path: 'main.tex', bytes: Buffer.from('main') },
        { path: 'shortcut.tex', bytes: Buffer.from('main.tex'), mode: '120000' as const },
      ],
    },
    {
      name: 'gitlink',
      files: [
        { path: 'main.tex', bytes: Buffer.from('main') },
        {
          path: 'vendor',
          bytes: new Uint8Array(),
          mode: '160000' as const,
          type: 'commit' as const,
        },
      ],
    },
    {
      name: 'traversal path',
      files: [
        { path: 'main.tex', bytes: Buffer.from('main') },
        { path: '../escape.tex', bytes: Buffer.from('escape') },
      ],
    },
    {
      name: 'secret path',
      files: [
        { path: 'main.tex', bytes: Buffer.from('main') },
        { path: '.env', bytes: Buffer.from('TOKEN=fixture') },
      ],
    },
    {
      name: 'case-folded directory collision',
      files: [
        { path: 'main.tex', bytes: Buffer.from('main') },
        { path: 'Paper/a.tex', bytes: Buffer.from('a') },
        { path: 'paper/b.tex', bytes: Buffer.from('b') },
      ],
    },
    {
      name: 'NFC file collision',
      files: [
        { path: 'main.tex', bytes: Buffer.from('main') },
        { path: 'caf\u00e9.tex', bytes: Buffer.from('a') },
        { path: 'cafe\u0301.tex', bytes: Buffer.from('b') },
      ],
    },
    {
      name: 'control-character path',
      files: [
        { path: 'main.tex', bytes: Buffer.from('main') },
        { path: 'bad\nname.tex', bytes: Buffer.from('bad') },
      ],
    },
  ])('rejects an unsafe checkpoint tree containing a $name', async ({ files }) => {
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const runGit = checkpointFixtureRunner({ revision, tree, files });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });

    await expect(
      transport.listCheckpointFiles(
        BINDING_ID,
        revision,
        'main.tex',
        checkpointDigest(revision, tree),
      ),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_tree_unsafe' });
  });

  it('enforces file-count, per-file, aggregate-tree, and UTF-8 text limits', async () => {
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const files = [
      { path: 'main.tex', bytes: Uint8Array.from([0xc3, 0x28]) },
      { path: 'other.tex', bytes: Buffer.from('1234') },
    ] as const;
    const digest = checkpointDigest(revision, tree);

    await expect(
      new OverleafGitTransport({
        rootDirectory: () => root,
        credentials,
        runGit: checkpointFixtureRunner({ revision, tree, files }),
        maxSourceFiles: 1,
      }).listCheckpointFiles(BINDING_ID, revision, 'main.tex', digest),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_too_large' });
    await expect(
      new OverleafGitTransport({
        rootDirectory: () => root,
        credentials,
        runGit: checkpointFixtureRunner({ revision, tree, files }),
        maxSourceFileBytes: 3,
      }).listCheckpointFiles(BINDING_ID, revision, 'main.tex', digest),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_too_large' });
    await expect(
      new OverleafGitTransport({
        rootDirectory: () => root,
        credentials,
        runGit: checkpointFixtureRunner({ revision, tree, files }),
        maxSourceTreeBytes: 5,
      }).listCheckpointFiles(BINDING_ID, revision, 'main.tex', digest),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_too_large' });
    await expect(
      checkpointFixtureTransport(root, { revision, tree, files }).transport.readCheckpointText(
        BINDING_ID,
        revision,
        'main.tex',
        digest,
        'main.tex',
      ),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_file_not_text' });
  });

  it('rejects blob bytes that do not match the verified tree object ID', async () => {
    const revision = 'c'.repeat(40);
    const tree = 'd'.repeat(40);
    const files = [{ path: 'main.tex', bytes: Buffer.from('verified') }] as const;
    const blobFiles = [{ path: 'main.tex', bytes: Buffer.from('changed!') }] as const;
    const { transport } = checkpointFixtureTransport(root, {
      revision,
      tree,
      files,
      blobFiles,
    });

    await expect(
      transport.readCheckpointText(
        BINDING_ID,
        revision,
        'main.tex',
        checkpointDigest(revision, tree),
        'main.tex',
      ),
    ).rejects.toMatchObject({ code: 'overleaf_git_checkpoint_tree_unsafe' });
  });
});
