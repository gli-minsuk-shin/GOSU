import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OverleafGitTransport,
  OverleafGitTransportError,
  parseOverleafGitRemote,
} from '../src/main/overleaf-git-transport';
import type { GitCommandRunner } from '../src/main/git-command-runner';

const CREDENTIAL_REF = 'overleaf-git:0123456789abcdef01234567:01234567-89ab-4cde-8fab-0123456789ab';
const credentials = { readByReference: async () => 'private-overleaf-token' };

describe('Overleaf Git checkpoint transport', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gosu-overleaf-git-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('normalizes only the official credential-free HTTPS project endpoint', () => {
    expect(parseOverleafGitRemote('https://git@git.overleaf.com/0123456789abcdef01234567')).toEqual(
      {
        workspaceId: '0123456789abcdef01234567',
        remoteUrl: 'https://git@git.overleaf.com/0123456789abcdef01234567',
        webUrl: 'https://www.overleaf.com/project/0123456789abcdef01234567',
      },
    );
    expect(parseOverleafGitRemote('https://git.overleaf.com/0123456789abcdef01234567.git')).toEqual(
      expect.objectContaining({ workspaceId: '0123456789abcdef01234567' }),
    );
  });

  it.each([
    'http://git.overleaf.com/0123456789abcdef01234567',
    'https://git:secret@git.overleaf.com/0123456789abcdef01234567',
    'https://evil.example/0123456789abcdef01234567',
    'https://git.overleaf.com/not-a-project',
    'https://git.overleaf.com/0123456789abcdef01234567?token=secret',
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
        'https://git@git.overleaf.com/0123456789abcdef01234567',
        'refs/heads/master',
      ]);
      return `${revision}\trefs/heads/master\n`;
    });
    const transport = new OverleafGitTransport({ rootDirectory: () => root, credentials, runGit });

    await expect(
      transport.inspect('https://git.overleaf.com/0123456789abcdef01234567', CREDENTIAL_REF),
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
        scopeUrl: 'https://git@git.overleaf.com/0123456789abcdef01234567',
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
      'https://git.overleaf.com/0123456789abcdef01234567',
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
});
