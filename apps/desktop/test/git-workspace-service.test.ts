import { execFileSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitCommandError, createGitCommandRunner } from '../src/main/git-command-runner';
import { GitWorkspaceService } from '../src/main/git-workspace-service';
import type { ProjectRecord, WorkspaceSnapshot } from '../src/shared/workspace-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2026-08-04T00:00:00.000Z';

// These are real Git process integration tests. Keep the timeout above transient macOS I/O and
// process-startup contention while retaining per-test failure bounds.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

function git(root: string, ...arguments_: string[]) {
  return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();
}

function forgeSignedCommit(root: string, parent: string, message: string) {
  const tree = git(root, 'rev-parse', `${parent}^{tree}`);
  const commit = [
    `tree ${tree}`,
    `parent ${parent}`,
    'author GOSU Test <gosu-test@example.invalid> 1 +0000',
    'committer GOSU Test <gosu-test@example.invalid> 2 +0000',
    'gpgsig -----BEGIN PGP SIGNATURE-----',
    ' fake-signature',
    ' -----END PGP SIGNATURE-----',
    '',
    message,
    '',
  ].join('\n');
  return execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    cwd: root,
    encoding: 'utf8',
    input: commit,
  }).trim();
}

async function installFailingVerifier(root: string, executable: string, sentinel: string) {
  await writeFile(executable, `#!/bin/sh\ntouch '${sentinel}'\nexit 1\n`);
  await chmod(executable, 0o755);
  git(root, 'config', 'gpg.program', executable);
}

describe('project-scoped Git workspace', () => {
  let rootDirectory: string;
  let repositoryRoot: string;
  let project: ProjectRecord;
  let service: GitWorkspaceService;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), 'gosu-git-workspace-'));
    repositoryRoot = join(rootDirectory, PROJECT_ID);
    await mkdir(repositoryRoot, { recursive: true });
    git(repositoryRoot, 'init', '--initial-branch=main');
    git(repositoryRoot, 'config', 'user.name', 'GOSU Test');
    git(repositoryRoot, 'config', 'user.email', 'gosu-test@example.invalid');
    git(repositoryRoot, 'remote', 'add', 'origin', 'https://github.com/example/research.git');
    await mkdir(join(repositoryRoot, 'src'));
    await writeFile(join(repositoryRoot, 'README.md'), '# Reproducible study\n\nInitial result.\n');
    await writeFile(join(repositoryRoot, 'src', 'metric.ts'), 'export const score = 0.8;\n');
    git(repositoryRoot, 'add', '--', 'README.md', 'src/metric.ts');
    git(repositoryRoot, 'commit', '-m', 'Initial research fixture');
    project = {
      id: PROJECT_ID,
      name: 'Research fixture',
      slug: 'research-fixture',
      repository: 'example/research',
      version: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
    service = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
    });
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  it('lists files, branches, status, history, Markdown, and bounded commit detail', async () => {
    const snapshot = await service.snapshot(PROJECT_ID);

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      projectId: PROJECT_ID,
      repository: 'example/research',
      cloned: true,
      state: {
        currentBranch: 'main',
        dirty: false,
        ahead: 0,
        behind: 0,
      },
    });
    expect(snapshot.state?.files.map((file) => file.path)).toEqual(['README.md', 'src/metric.ts']);
    expect(snapshot.state?.branches).toHaveLength(1);
    expect(snapshot.state?.commits[0]).toMatchObject({ subject: 'Initial research fixture' });

    await expect(
      service.readFile({ projectId: PROJECT_ID, path: 'README.md' }),
    ).resolves.toMatchObject({
      renderMode: 'markdown',
      content: expect.stringContaining('Reproducible study'),
      truncated: false,
    });
    await expect(service.commitDetail(PROJECT_ID, snapshot.state!.headSha!)).resolves.toMatchObject(
      {
        content: expect.stringContaining('Initial research fixture'),
      },
    );
  });

  it('reads only the validated HEAD revision for manuscript provenance', async () => {
    const realRunGit = createGitCommandRunner();
    const runGit = vi.fn(
      (cwd: string, arguments_: readonly string[], options?: Parameters<typeof realRunGit>[2]) =>
        realRunGit(cwd, arguments_, options),
    );
    service = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit,
    });

    await expect(service.revision(PROJECT_ID)).resolves.toBe(
      git(repositoryRoot, 'rev-parse', 'HEAD'),
    );

    const invokedCommands = runGit.mock.calls.map(([, arguments_]) => arguments_.join(' '));
    expect(invokedCommands.some((command) => command.startsWith('status '))).toBe(false);
    expect(invokedCommands.some((command) => command.startsWith('ls-files '))).toBe(false);
    expect(invokedCommands.some((command) => command.startsWith('for-each-ref '))).toBe(false);
    expect(invokedCommands.some((command) => command.startsWith('rev-list '))).toBe(false);
    expect(invokedCommands.some((command) => command.startsWith('log '))).toBe(false);
  });

  it('searches archived repository filenames without loading status, branches, or history', async () => {
    project = { ...project, archivedAt: new Date().toISOString() };
    const realRunGit = createGitCommandRunner();
    const runGit = vi.fn(
      (cwd: string, arguments_: readonly string[], options?: Parameters<typeof realRunGit>[2]) =>
        realRunGit(cwd, arguments_, options),
    );
    service = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit,
    });

    await expect(
      service.searchFiles({ projectId: PROJECT_ID, query: 'metric ts', limit: 20 }),
    ).resolves.toMatchObject({
      entries: [{ path: 'src/metric.ts', kind: 'file' }],
      scannedEntries: 2,
      truncated: false,
      incomplete: false,
    });
    await expect(
      service.searchFiles({ projectId: PROJECT_ID, query: 'm', limit: 1 }),
    ).resolves.toMatchObject({
      entries: expect.any(Array),
      scannedEntries: 2,
      truncated: true,
      incomplete: false,
    });
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'project_archived',
    });

    const invokedCommands = runGit.mock.calls.map(([, arguments_]) => arguments_.join(' '));
    expect(invokedCommands.some((command) => command.startsWith('ls-files '))).toBe(true);
    expect(invokedCommands.some((command) => command.startsWith('status '))).toBe(false);
    expect(invokedCommands.some((command) => command.startsWith('for-each-ref '))).toBe(false);
    expect(invokedCommands.some((command) => command.startsWith('rev-list '))).toBe(false);
    expect(invokedCommands.some((command) => command.startsWith('log '))).toBe(false);
  });

  it('never searches repository files for a trashed project', async () => {
    project = { ...project, trashedAt: new Date().toISOString() };

    await expect(
      service.searchFiles({ projectId: PROJECT_ID, query: 'metric', limit: 20 }),
    ).rejects.toMatchObject({ code: 'project_trashed' });
  });

  it('never executes a configured signature verifier while reading history or commit detail', async () => {
    const parent = git(repositoryRoot, 'rev-parse', 'HEAD');
    const signedCommit = forgeSignedCommit(repositoryRoot, parent, 'Signed research fixture');
    git(repositoryRoot, 'update-ref', 'refs/heads/main', signedCommit, parent);
    git(repositoryRoot, 'config', 'log.showSignature', 'true');

    const historySentinel = join(rootDirectory, 'history-verifier-ran');
    await installFailingVerifier(
      repositoryRoot,
      join(rootDirectory, 'history-verifier'),
      historySentinel,
    );
    const snapshot = await service.snapshot(PROJECT_ID);
    expect(snapshot.state?.commits[0]).toMatchObject({
      sha: signedCommit,
      subject: 'Signed research fixture',
    });
    await expect(access(historySentinel)).rejects.toThrow();

    const detailSentinel = join(rootDirectory, 'detail-verifier-ran');
    await installFailingVerifier(
      repositoryRoot,
      join(rootDirectory, 'detail-verifier'),
      detailSentinel,
    );
    await expect(service.commitDetail(PROJECT_ID, signedCommit)).resolves.toMatchObject({
      content: expect.stringContaining('Signed research fixture'),
    });
    await expect(access(detailSentinel)).rejects.toThrow();
  });

  it('does not let commit control characters forge extra history records', async () => {
    const parent = git(repositoryRoot, 'rev-parse', 'HEAD');
    const crafted = forgeSignedCommit(
      repositoryRoot,
      parent,
      `Real subject\u001e${parent}\u001fInjected author\u001f2026-08-04T00:00:00Z\u001fInjected row`,
    );
    git(repositoryRoot, 'update-ref', 'refs/heads/main', crafted, parent);

    const snapshot = await service.snapshot(PROJECT_ID);
    expect(snapshot.state?.commits.map((commit) => commit.sha)).toEqual([crafted, parent]);
    expect(snapshot.state?.commits[0]?.subject).toContain('Real subject');
    expect(snapshot.state?.commits[0]?.subject).not.toContain('\u001e');
    expect(snapshot.state?.commits).toHaveLength(2);
  });

  it('ignores replacement refs while reading history and commit detail', async () => {
    const originalHead = git(repositoryRoot, 'rev-parse', 'HEAD');
    const tree = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');
    const replacement = git(
      repositoryRoot,
      'commit-tree',
      tree,
      '-m',
      'Injected replacement content',
    );
    git(repositoryRoot, 'replace', originalHead, replacement);

    const snapshot = await service.snapshot(PROJECT_ID);
    expect(snapshot.state?.headSha).toBe(originalHead);
    expect(snapshot.state?.commits[0]).toMatchObject({
      sha: originalHead,
      subject: 'Initial research fixture',
    });

    const detail = await service.commitDetail(PROJECT_ID, originalHead);
    expect(detail.content).toContain('Initial research fixture');
    expect(detail.content).not.toContain('Injected replacement content');
  });

  it('returns commit detail only for reachable commit objects', async () => {
    const blob = git(repositoryRoot, 'rev-parse', 'HEAD:README.md');
    const tree = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');
    const unreachableCommit = git(
      repositoryRoot,
      'commit-tree',
      tree,
      '-m',
      'Unreachable forged commit',
    );

    for (const objectId of [blob, tree, unreachableCommit]) {
      await expect(service.commitDetail(PROJECT_ID, objectId)).rejects.toMatchObject({
        code: 'git_commit_not_available',
      });
    }
  });

  it('blocks binary content and symlink escapes without returning outside files', async () => {
    await writeFile(join(repositoryRoot, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(rootDirectory, 'outside.txt'), 'private outside text');
    await symlink(join(rootDirectory, 'outside.txt'), join(repositoryRoot, 'outside-link.txt'));

    await expect(
      service.readFile({ projectId: PROJECT_ID, path: 'binary.bin' }),
    ).rejects.toMatchObject({ code: 'git_binary_file' });
    await expect(
      service.readFile({ projectId: PROJECT_ID, path: 'outside-link.txt' }),
    ).rejects.toMatchObject({ code: 'git_path_blocked' });
    await expect(
      service.readFile({ projectId: PROJECT_ID, path: '../outside.txt' }),
    ).rejects.toMatchObject({ code: 'git_path_blocked' });
  });

  it('keeps a UTF-8 preview textual when truncation lands inside a multibyte character', async () => {
    const prefix = 'a'.repeat(512 * 1024 - 1);
    await writeFile(join(repositoryRoot, 'boundary.md'), `${prefix}€after-boundary\n`);

    const preview = await service.readFile({ projectId: PROJECT_ID, path: 'boundary.md' });

    expect(preview).toMatchObject({
      renderMode: 'markdown',
      sizeBytes: Buffer.byteLength(`${prefix}€after-boundary\n`),
      truncated: true,
    });
    expect(preview.content).toBe(prefix);
    expect(preview.content).not.toContain('�');
  });

  it('reviews, stages, commits, and bypasses repository hooks', async () => {
    await writeFile(join(repositoryRoot, 'src', 'metric.ts'), 'export const score = 0.83;\n');
    const before = await service.snapshot(PROJECT_ID);
    const head = before.state!.headSha;
    const expectedBranch = before.state!.currentBranch;

    expect(before.state?.changes).toEqual([
      expect.objectContaining({ path: 'src/metric.ts', staged: false, unstaged: true }),
    ]);
    await expect(
      service.diff({ projectId: PROJECT_ID, path: 'src/metric.ts', staged: false }),
    ).resolves.toMatchObject({ content: expect.stringContaining('0.83') });

    const hook = join(repositoryRoot, '.git', 'hooks', 'pre-commit');
    const sentinel = join(rootDirectory, 'hook-ran');
    await writeFile(hook, `#!/bin/sh\ntouch '${sentinel}'\nexit 1\n`);
    await chmod(hook, 0o755);

    const staged = await service.stage({
      projectId: PROJECT_ID,
      expectedHead: head,
      expectedBranch,
      paths: ['src/metric.ts'],
    });
    expect(staged.state?.changes[0]).toMatchObject({ staged: true, unstaged: false });

    const committed = await service.commit({
      projectId: PROJECT_ID,
      expectedHead: head,
      expectedBranch,
      expectedIndexFingerprint: staged.state!.indexFingerprint,
      summary: 'Improve baseline metric',
      description: 'Records the bounded fixture improvement.',
    });
    expect(committed.state?.dirty).toBe(false);
    expect(committed.state?.commits[0]?.subject).toBe('Improve baseline metric');
    await expect(access(sentinel)).rejects.toThrow();
  });

  it('rejects a stale index and commits exactly the reviewed tree during an index race', async () => {
    await writeFile(join(repositoryRoot, 'src', 'metric.ts'), 'export const score = 0.84;\n');
    const initial = await service.snapshot(PROJECT_ID);
    const staged = await service.stage({
      projectId: PROJECT_ID,
      expectedHead: initial.state!.headSha,
      expectedBranch: initial.state!.currentBranch,
      paths: ['src/metric.ts'],
    });
    const reviewedFingerprint = staged.state!.indexFingerprint;
    const reviewedTree = git(repositoryRoot, 'write-tree');

    await writeFile(join(repositoryRoot, 'README.md'), '# Unreviewed index change\n');
    git(repositoryRoot, 'add', '--', 'README.md');
    await expect(
      service.commit({
        projectId: PROJECT_ID,
        expectedHead: initial.state!.headSha,
        expectedBranch: initial.state!.currentBranch,
        expectedIndexFingerprint: reviewedFingerprint,
        summary: 'Commit reviewed tree',
      }),
    ).rejects.toMatchObject({ code: 'git_index_changed' });
    expect(git(repositoryRoot, 'rev-parse', 'HEAD')).toBe(initial.state!.headSha);

    git(repositoryRoot, 'restore', '--staged', '--worktree', '--', 'README.md');
    expect((await service.snapshot(PROJECT_ID)).state?.indexFingerprint).toBe(reviewedFingerprint);

    const actual = createGitCommandRunner();
    let raced = false;
    const racingService = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: async (root, arguments_, options) => {
        if (!raced && (arguments_.includes('commit') || arguments_.includes('commit-tree'))) {
          raced = true;
          await writeFile(join(root, 'surprise.txt'), 'must not enter reviewed commit\n');
          git(root, 'add', '--', 'surprise.txt');
        }
        return actual(root, arguments_, options);
      },
    });

    const committed = await racingService.commit({
      projectId: PROJECT_ID,
      expectedHead: initial.state!.headSha,
      expectedBranch: initial.state!.currentBranch,
      expectedIndexFingerprint: reviewedFingerprint,
      summary: 'Commit reviewed tree',
    });

    expect(raced).toBe(true);
    expect(git(repositoryRoot, 'rev-parse', `${committed.state!.headSha}^{tree}`)).toBe(
      reviewedTree,
    );
    expect(() =>
      git(repositoryRoot, 'cat-file', '-e', `${committed.state!.headSha}:surprise.txt`),
    ).toThrow();
  });

  it('treats renderer paths literally when diffing and staging unusual filenames', async () => {
    await writeFile(join(repositoryRoot, '*'), 'literal star: initial\n');
    await writeFile(join(repositoryRoot, 'secret.txt'), 'secret: initial\n');
    git(repositoryRoot, 'add', '--all');
    git(repositoryRoot, 'commit', '-m', 'Add unusual path fixture');
    await writeFile(join(repositoryRoot, '*'), 'literal star: changed\n');
    await writeFile(join(repositoryRoot, 'secret.txt'), 'secret: must remain unstaged\n');
    const snapshot = await service.snapshot(PROJECT_ID);

    const preview = await service.diff({ projectId: PROJECT_ID, path: '*', staged: false });
    expect(preview.content).toContain('literal star: changed');
    expect(preview.content).not.toContain('must remain unstaged');

    await service.stage({
      projectId: PROJECT_ID,
      expectedHead: snapshot.state!.headSha,
      expectedBranch: snapshot.state!.currentBranch,
      paths: ['*'],
    });
    expect(git(repositoryRoot, 'diff', '--cached', '--name-only', '-z').split('\0')).toEqual([
      '*',
      '',
    ]);
  });

  it('reviews and unstages both sides of a staged rename', async () => {
    await writeFile(join(repositoryRoot, 'old-result.txt'), 'reviewed result\n');
    git(repositoryRoot, 'add', '--', 'old-result.txt');
    git(repositoryRoot, 'commit', '-m', 'Add rename fixture');
    git(repositoryRoot, 'mv', 'old-result.txt', 'new-result.txt');
    const snapshot = await service.snapshot(PROJECT_ID);
    expect(snapshot.state?.changes).toContainEqual(
      expect.objectContaining({
        path: 'new-result.txt',
        originalPath: 'old-result.txt',
        indexStatus: 'R',
      }),
    );

    const preview = await service.diff({
      projectId: PROJECT_ID,
      path: 'new-result.txt',
      staged: true,
    });
    expect(preview.content).toContain('old-result.txt');
    expect(preview.content).toContain('new-result.txt');

    const unstaged = await service.unstage({
      projectId: PROJECT_ID,
      expectedHead: snapshot.state!.headSha,
      expectedBranch: snapshot.state!.currentBranch,
      paths: ['new-result.txt'],
    });
    expect(unstaged.state?.changes.some((change) => change.staged)).toBe(false);
    expect(git(repositoryRoot, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('creates and switches clean local branches but rejects stale or dirty transitions', async () => {
    const initial = await service.snapshot(PROJECT_ID);
    const head = initial.state!.headSha;
    const expectedBranch = initial.state!.currentBranch;
    const created = await service.createBranch({
      projectId: PROJECT_ID,
      expectedHead: head,
      expectedBranch,
      name: 'experiment/baseline',
    });
    expect(created.state?.branches.map((branch) => branch.name)).toContain('experiment/baseline');

    git(repositoryRoot, 'switch', 'experiment/baseline');
    await expect(
      service.createBranch({
        projectId: PROJECT_ID,
        expectedHead: head,
        expectedBranch,
        name: 'experiment/stale-screen',
      }),
    ).rejects.toMatchObject({ code: 'git_head_changed' });
    git(repositoryRoot, 'switch', 'main');

    await writeFile(join(repositoryRoot, 'README.md'), '# Dirty worktree\n');
    await expect(
      service.switchBranch({
        projectId: PROJECT_ID,
        expectedHead: head,
        expectedBranch,
        name: 'experiment/baseline',
      }),
    ).rejects.toMatchObject({ code: 'git_dirty_worktree' });

    git(repositoryRoot, 'restore', '--', 'README.md');
    await expect(
      service.switchBranch({
        projectId: PROJECT_ID,
        expectedHead: '0'.repeat(40),
        expectedBranch,
        name: 'experiment/baseline',
      }),
    ).rejects.toMatchObject({ code: 'git_head_changed' });

    const switched = await service.switchBranch({
      projectId: PROJECT_ID,
      expectedHead: head,
      expectedBranch,
      name: 'experiment/baseline',
    });
    expect(switched.state?.currentBranch).toBe('experiment/baseline');
  });

  it('anchors a newly created branch to the reviewed HEAD during a local race', async () => {
    const initial = await service.snapshot(PROJECT_ID);
    const reviewedHead = initial.state!.headSha!;
    const actual = createGitCommandRunner();
    let raced = false;
    const racingService = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: async (root, arguments_, options) => {
        if (!raced && arguments_[0] === 'branch') {
          raced = true;
          git(root, 'commit', '--allow-empty', '-m', 'External branch race');
        }
        return actual(root, arguments_, options);
      },
    });

    await racingService.createBranch({
      projectId: PROJECT_ID,
      expectedHead: reviewedHead,
      expectedBranch: 'main',
      name: 'experiment/reviewed-anchor',
    });

    expect(raced).toBe(true);
    expect(git(repositoryRoot, 'rev-parse', 'refs/heads/experiment/reviewed-anchor')).toBe(
      reviewedHead,
    );
    expect(git(repositoryRoot, 'rev-parse', 'refs/heads/main')).not.toBe(reviewedHead);
  });

  it('rejects HEAD and local branch symbolic refs outside the direct local-branch topology', async () => {
    const head = git(repositoryRoot, 'rev-parse', 'HEAD');
    git(repositoryRoot, 'update-ref', 'refs/remotes/origin/main', head);
    git(repositoryRoot, 'symbolic-ref', 'HEAD', 'refs/remotes/origin/main');

    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });

    git(repositoryRoot, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    git(repositoryRoot, 'symbolic-ref', 'refs/heads/alias', 'refs/heads/main');
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });
  });

  it('rejects symbolic origin tracking refs before they can target a local branch', async () => {
    const initial = await service.snapshot(PROJECT_ID);
    git(repositoryRoot, 'branch', 'victim');
    git(repositoryRoot, 'symbolic-ref', 'refs/remotes/origin/main', 'refs/heads/victim');
    const actual = createGitCommandRunner();
    const guardedService = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: (root, arguments_, options) =>
        arguments_[0] === 'fetch'
          ? Promise.reject(new GitCommandError('failed'))
          : actual(root, arguments_, options),
    });

    await expect(
      guardedService.fetch({
        projectId: PROJECT_ID,
        expectedHead: initial.state!.headSha,
        expectedBranch: initial.state!.currentBranch,
      }),
    ).rejects.toMatchObject({ code: 'repository_unsafe' });
  });

  it('switches only the superproject when local config enables recursive submodules', async () => {
    const submoduleSource = join(rootDirectory, 'submodule-source');
    await mkdir(submoduleSource);
    git(submoduleSource, 'init', '--initial-branch=main');
    git(submoduleSource, 'config', 'user.name', 'GOSU Submodule');
    git(submoduleSource, 'config', 'user.email', 'gosu-submodule@example.invalid');
    git(submoduleSource, 'commit', '--allow-empty', '-m', 'First submodule revision');
    const firstSubmoduleHead = git(submoduleSource, 'rev-parse', 'HEAD');
    git(submoduleSource, 'commit', '--allow-empty', '-m', 'Second submodule revision');
    const secondSubmoduleHead = git(submoduleSource, 'rev-parse', 'HEAD');

    git(
      repositoryRoot,
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      '--',
      submoduleSource,
      'modules/fixture',
    );
    git(repositoryRoot, 'commit', '-am', 'Add submodule at second revision');
    git(repositoryRoot, 'switch', '-c', 'submodule/first-revision');
    git(
      repositoryRoot,
      'update-index',
      '--cacheinfo',
      `160000,${firstSubmoduleHead},modules/fixture`,
    );
    git(repositoryRoot, 'commit', '-m', 'Point submodule at first revision');
    git(repositoryRoot, 'switch', 'main');
    git(repositoryRoot, 'config', 'submodule.recurse', 'true');
    const initial = await service.snapshot(PROJECT_ID);

    const switched = await service.switchBranch({
      projectId: PROJECT_ID,
      expectedHead: initial.state!.headSha,
      expectedBranch: initial.state!.currentBranch,
      name: 'submodule/first-revision',
    });

    expect(switched.state?.currentBranch).toBe('submodule/first-revision');
    expect(git(join(repositoryRoot, 'modules', 'fixture'), 'rev-parse', 'HEAD')).toBe(
      secondSubmoduleHead,
    );
    expect(secondSubmoduleHead).not.toBe(firstSubmoduleHead);
  });

  it('supports an unborn branch through stage, unstage, and the first commit', async () => {
    const emptyId = '33333333-3333-4333-8333-333333333333';
    const emptyRoot = join(rootDirectory, emptyId);
    await mkdir(emptyRoot);
    git(emptyRoot, 'init', '--initial-branch=main');
    git(emptyRoot, 'config', 'user.name', 'GOSU Test');
    git(emptyRoot, 'config', 'user.email', 'gosu-test@example.invalid');
    git(emptyRoot, 'remote', 'add', 'origin', 'https://github.com/example/empty-research.git');
    project = {
      ...project,
      id: emptyId,
      slug: 'empty-research',
      repository: 'example/empty-research',
    };

    const empty = await service.snapshot(emptyId);
    expect(empty.state).toMatchObject({
      currentBranch: 'main',
      headSha: null,
      commits: [],
      branches: [],
    });

    await writeFile(join(emptyRoot, 'README.md'), '# First result\n');
    const command = { projectId: emptyId, expectedHead: null, expectedBranch: 'main' } as const;
    const staged = await service.stage({ ...command, paths: ['README.md'] });
    expect(staged.state?.changes[0]).toMatchObject({ staged: true });
    const unstaged = await service.unstage({ ...command, paths: ['README.md'] });
    expect(unstaged.state?.changes[0]).toMatchObject({ staged: false, unstaged: true });
    const restaged = await service.stage({ ...command, paths: ['README.md'] });
    const committed = await service.commit({
      ...command,
      expectedIndexFingerprint: restaged.state!.indexFingerprint,
      summary: 'Initial research commit',
    });
    expect(committed.state?.headSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(committed.state?.commits[0]?.subject).toBe('Initial research commit');
  });

  it('clones into an atomic app-owned workspace before reading the working tree', async () => {
    const cloneId = '44444444-4444-4444-8444-444444444444';
    const sourceRoot = join(rootDirectory, 'clone-source');
    const bareRoot = join(rootDirectory, 'clone-source.git');
    await mkdir(sourceRoot);
    git(sourceRoot, 'init', '--initial-branch=main');
    git(sourceRoot, 'config', 'user.name', 'GOSU Test');
    git(sourceRoot, 'config', 'user.email', 'gosu-test@example.invalid');
    await writeFile(join(sourceRoot, 'paper.md'), '# Cloned paper\n');
    git(sourceRoot, 'add', '--', 'paper.md');
    git(sourceRoot, 'commit', '-m', 'Create paper fixture');
    git(rootDirectory, 'clone', '--bare', sourceRoot, bareRoot);
    project = {
      ...project,
      id: cloneId,
      slug: 'cloned-research',
      repository: 'example/cloned-research',
    };
    const actual = createGitCommandRunner();
    const cloneCalls: Array<{ arguments_: readonly string[]; network: boolean }> = [];
    const checkoutCalls: string[][] = [];
    const cloneService = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: async (root, arguments_, options) => {
        if (arguments_[0] === 'clone') {
          cloneCalls.push({ arguments_, network: options?.network === true });
          const destination = arguments_.at(-1)!;
          git(root, 'clone', '--no-checkout', bareRoot, destination);
          git(
            destination,
            'remote',
            'set-url',
            'origin',
            'https://github.com/example/cloned-research.git',
          );
          return '';
        }
        if (arguments_[0] === 'checkout') checkoutCalls.push([...arguments_]);
        return actual(root, arguments_, options);
      },
    });

    const cloned = await cloneService.clone(cloneId);

    expect(cloneCalls).toEqual([
      expect.objectContaining({
        arguments_: expect.arrayContaining(['--no-recurse-submodules', '--no-checkout']),
        network: true,
      }),
    ]);
    expect(checkoutCalls).toEqual([['checkout', '--force', '--no-recurse-submodules']]);
    expect(cloned).toMatchObject({ cloned: true, state: { currentBranch: 'main' } });
    expect(cloned.state?.files.map((file) => file.path)).toContain('paper.md');
    await expect(
      cloneService.readFile({ projectId: cloneId, path: 'paper.md' }),
    ).resolves.toMatchObject({ content: '# Cloned paper\n', renderMode: 'markdown' });
  });

  it('keeps an empty GitHub clone usable on its unborn default branch', async () => {
    const cloneId = '55555555-5555-4555-8555-555555555555';
    const bareRoot = join(rootDirectory, 'empty-source.git');
    await mkdir(bareRoot);
    git(bareRoot, 'init', '--bare', '--initial-branch=main');
    project = {
      ...project,
      id: cloneId,
      slug: 'empty-clone',
      repository: 'example/empty-clone',
    };
    const actual = createGitCommandRunner();
    const cloneService = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: async (root, arguments_, options) => {
        if (arguments_[0] === 'clone') {
          const destination = arguments_.at(-1)!;
          git(root, 'clone', '--no-checkout', bareRoot, destination);
          git(
            destination,
            'remote',
            'set-url',
            'origin',
            'https://github.com/example/empty-clone.git',
          );
          return '';
        }
        return actual(root, arguments_, options);
      },
    });

    await expect(cloneService.clone(cloneId)).resolves.toMatchObject({
      cloned: true,
      state: { currentBranch: 'main', headSha: null, files: [], commits: [] },
    });
  });

  it('rejects local includes, HTTP overrides, and alternate-ref commands before use', async () => {
    const initial = await service.snapshot(PROJECT_ID);
    const includedConfig = join(rootDirectory, 'included-git-config');
    await writeFile(includedConfig, '[filter "included"]\n\tsmudge = /usr/bin/false\n');
    git(repositoryRoot, 'config', 'include.path', includedConfig);
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });
    git(repositoryRoot, 'config', '--unset-all', 'include.path');

    const actual = createGitCommandRunner();
    const guardedService = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: (root, arguments_, options) =>
        arguments_[0] === 'fetch'
          ? Promise.reject(new GitCommandError('failed'))
          : actual(root, arguments_, options),
    });
    git(repositoryRoot, 'config', 'http.proxy', 'https://proxy.example.invalid');
    await expect(
      guardedService.fetch({
        projectId: PROJECT_ID,
        expectedHead: initial.state!.headSha,
        expectedBranch: initial.state!.currentBranch,
      }),
    ).rejects.toMatchObject({ code: 'repository_unsafe' });
    git(repositoryRoot, 'config', '--unset-all', 'http.proxy');

    git(repositoryRoot, 'config', 'core.alternateRefsCommand', '/usr/bin/false');
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });
  });

  it('rejects alternate object stores, grafts, and promisor metadata', async () => {
    const objectsInfo = join(repositoryRoot, '.git', 'objects', 'info');
    const gitInfo = join(repositoryRoot, '.git', 'info');
    const packDirectory = join(repositoryRoot, '.git', 'objects', 'pack');
    await mkdir(objectsInfo, { recursive: true });
    await mkdir(gitInfo, { recursive: true });
    await mkdir(packDirectory, { recursive: true });

    const alternateRepository = join(rootDirectory, 'alternate-objects');
    await mkdir(alternateRepository);
    git(alternateRepository, 'init');
    const alternates = join(objectsInfo, 'alternates');
    await writeFile(alternates, `${join(alternateRepository, '.git', 'objects')}\n`);
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });
    await rm(alternates, { force: true });

    const httpAlternates = join(objectsInfo, 'http-alternates');
    await writeFile(httpAlternates, 'https://objects.example.invalid/repository/objects\n');
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });
    await rm(httpAlternates, { force: true });

    const grafts = join(gitInfo, 'grafts');
    await writeFile(grafts, `${git(repositoryRoot, 'rev-parse', 'HEAD')}\n`);
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });
    await rm(grafts, { force: true });

    const promisorMarker = join(packDirectory, 'untrusted.promisor');
    await writeFile(promisorMarker, 'untrusted promisor metadata\n');
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });
    await rm(promisorMarker, { force: true });

    git(repositoryRoot, 'config', 'remote.origin.promisor', 'true');
    git(repositoryRoot, 'config', 'remote.origin.partialclonefilter', 'blob:none');
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });
  });

  it('rejects Git admin-file symlinks before they can write outside the workspace', async () => {
    const outside = join(rootDirectory, 'outside-admin-target');
    await writeFile(outside, 'must remain unchanged\n');
    const fetchHead = join(repositoryRoot, '.git', 'FETCH_HEAD');
    await rm(fetchHead, { force: true });
    await symlink(outside, fetchHead);

    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_unsafe',
    });
    expect(await readFile(outside, 'utf8')).toBe('must remain unchanged\n');
  });

  it('rejects ambiguous origins, push URLs, and local URL rewrites before network access', async () => {
    const initial = await service.snapshot(PROJECT_ID);
    const command = {
      projectId: PROJECT_ID,
      expectedHead: initial.state!.headSha,
      expectedBranch: initial.state!.currentBranch,
    };

    git(repositoryRoot, 'config', '--add', 'remote.origin.url', 'ext::unsafe-transport');
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_root_changed',
    });
    git(repositoryRoot, 'config', '--unset-all', 'remote.origin.url');
    git(
      repositoryRoot,
      'config',
      '--add',
      'remote.origin.url',
      'https://github.com/example/research.git',
    );

    git(
      repositoryRoot,
      'remote',
      'set-url',
      'origin',
      'https://github.com:444/example/research.git',
    );
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'repository_root_changed',
    });
    git(repositoryRoot, 'remote', 'set-url', 'origin', 'https://github.com/example/research.git');

    git(repositoryRoot, 'config', 'remote.origin.pushurl', 'https://github.com/example/other.git');
    await expect(service.fetch(command)).rejects.toMatchObject({ code: 'git_no_remote' });
    git(repositoryRoot, 'config', '--unset-all', 'remote.origin.pushurl');

    git(repositoryRoot, 'config', 'url.https://example.invalid/.insteadOf', 'https://github.com/');
    await expect(service.fetch(command)).rejects.toMatchObject({ code: 'repository_unsafe' });
  });

  it('confines Fetch to origin tracking refs even when repository config targets a local branch', async () => {
    const bareRoot = join(rootDirectory, 'fetch-source.git');
    git(rootDirectory, 'clone', '--bare', repositoryRoot, bareRoot);
    git(repositoryRoot, 'branch', 'victim');
    git(repositoryRoot, 'switch', 'victim');
    await writeFile(join(repositoryRoot, 'victim.txt'), 'must remain on the victim branch\n');
    git(repositoryRoot, 'add', '--', 'victim.txt');
    git(repositoryRoot, 'commit', '-m', 'Victim branch commit');
    const victimBefore = git(repositoryRoot, 'rev-parse', 'refs/heads/victim');
    git(repositoryRoot, 'switch', 'main');
    git(
      repositoryRoot,
      'config',
      '--replace-all',
      'remote.origin.fetch',
      '+refs/heads/main:refs/heads/victim',
    );
    const initial = await service.snapshot(PROJECT_ID);
    const actual = createGitCommandRunner();
    const captured: string[][] = [];
    const confined = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: async (root, arguments_, options) => {
        if (arguments_[0] === 'fetch') {
          captured.push([...arguments_]);
          git(
            root,
            'fetch',
            '--recurse-submodules=no',
            '--no-tags',
            '--no-prune',
            '--no-write-fetch-head',
            bareRoot,
            arguments_.at(-1)!,
          );
          return '';
        }
        return actual(root, arguments_, options);
      },
    });

    await confined.fetch({
      projectId: PROJECT_ID,
      expectedHead: initial.state!.headSha,
      expectedBranch: initial.state!.currentBranch,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.slice(0, -1)).toEqual([
      'fetch',
      '--recurse-submodules=no',
      '--no-tags',
      '--no-prune',
      '--no-write-fetch-head',
      'https://github.com/example/research.git',
    ]);
    expect(captured[0]?.at(-1)).toMatch(/^\+refs\/heads\/\*:refs\/gosu\/fetch\/[0-9a-f]+\/\*$/u);
    expect(git(repositoryRoot, 'rev-parse', 'refs/heads/victim')).toBe(victimBefore);
  });

  it('fast-forwards Pull without honoring a configured local-branch fetch destination', async () => {
    const bareRoot = join(rootDirectory, 'pull-source.git');
    const upstreamRoot = join(rootDirectory, 'pull-upstream');
    git(rootDirectory, 'clone', '--bare', repositoryRoot, bareRoot);
    git(repositoryRoot, 'fetch', bareRoot, '+refs/heads/main:refs/remotes/origin/main');
    git(repositoryRoot, 'branch', '--set-upstream-to=origin/main', 'main');

    git(rootDirectory, 'clone', bareRoot, upstreamRoot);
    git(upstreamRoot, 'config', 'user.name', 'GOSU Upstream');
    git(upstreamRoot, 'config', 'user.email', 'gosu-upstream@example.invalid');
    await writeFile(join(upstreamRoot, 'upstream.txt'), 'fast-forward result\n');
    git(upstreamRoot, 'add', '--', 'upstream.txt');
    git(upstreamRoot, 'commit', '-m', 'Upstream research result');
    git(upstreamRoot, 'push', 'origin', 'main');
    const upstreamHead = git(bareRoot, 'rev-parse', 'refs/heads/main');

    git(repositoryRoot, 'branch', 'victim');
    git(repositoryRoot, 'switch', 'victim');
    await writeFile(join(repositoryRoot, 'victim.txt'), 'must survive pull\n');
    git(repositoryRoot, 'add', '--', 'victim.txt');
    git(repositoryRoot, 'commit', '-m', 'Protect victim branch');
    const victimBefore = git(repositoryRoot, 'rev-parse', 'refs/heads/victim');
    git(repositoryRoot, 'switch', 'main');
    git(
      repositoryRoot,
      'config',
      '--replace-all',
      'remote.origin.fetch',
      '+refs/heads/main:refs/heads/victim',
    );
    const initial = await service.snapshot(PROJECT_ID);
    const actual = createGitCommandRunner();
    const fetchCalls: string[][] = [];
    const confined = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: async (root, arguments_, options) => {
        if (arguments_.includes('@{upstream}')) return 'origin/main\n';
        if (arguments_[0] === 'fetch') {
          fetchCalls.push([...arguments_]);
          git(
            root,
            'fetch',
            '--recurse-submodules=no',
            '--no-tags',
            '--no-prune',
            bareRoot,
            arguments_.at(-1)!,
          );
          return '';
        }
        return actual(root, arguments_, options);
      },
    });

    const pulled = await confined.pull({
      projectId: PROJECT_ID,
      expectedHead: initial.state!.headSha,
      expectedBranch: initial.state!.currentBranch,
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.slice(0, -1)).toEqual([
      'fetch',
      '--recurse-submodules=no',
      '--no-tags',
      '--no-prune',
      '--no-write-fetch-head',
      'https://github.com/example/research.git',
    ]);
    expect(fetchCalls[0]?.at(-1)).toMatch(
      /^\+refs\/heads\/main:refs\/gosu\/fetch\/[0-9a-f]+\/main$/u,
    );
    expect(pulled.state?.headSha).toBe(upstreamHead);
    expect(git(repositoryRoot, 'rev-parse', 'refs/heads/victim')).toBe(victimBefore);
  });

  it('never executes a configured signature verifier while fast-forwarding Pull', async () => {
    const initialHead = git(repositoryRoot, 'rev-parse', 'HEAD');
    const signedCommit = forgeSignedCommit(repositoryRoot, initialHead, 'Signed upstream result');
    git(repositoryRoot, 'update-ref', 'refs/remotes/origin/main', signedCommit);
    git(repositoryRoot, 'branch', '--set-upstream-to=origin/main', 'main');
    git(repositoryRoot, 'config', 'merge.verifySignatures', 'true');
    const sentinel = join(rootDirectory, 'merge-verifier-ran');
    await installFailingVerifier(repositoryRoot, join(rootDirectory, 'merge-verifier'), sentinel);
    const initial = await service.snapshot(PROJECT_ID);
    const actual = createGitCommandRunner();
    const mergeCalls: string[][] = [];
    const confined = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: async (root, arguments_, options) => {
        if (arguments_[0] === 'fetch') {
          const destination = arguments_.at(-1)?.split(':').at(-1);
          if (!destination) throw new Error('missing temporary fetch destination');
          git(root, 'update-ref', destination, signedCommit);
          return '';
        }
        if (arguments_[0] === 'merge') mergeCalls.push([...arguments_]);
        return actual(root, arguments_, options);
      },
    });

    const pulled = await confined.pull({
      projectId: PROJECT_ID,
      expectedHead: initial.state!.headSha,
      expectedBranch: initial.state!.currentBranch,
    });

    expect(mergeCalls).toEqual([
      ['merge', '--ff-only', '--no-edit', '--no-verify', '--no-verify-signatures', signedCommit],
    ]);
    expect(pulled.state?.headSha).toBe(signedCommit);
    await expect(access(sentinel)).rejects.toThrow();
  });

  it('pushes only the reviewed commit and never follows configured tags', async () => {
    const bareRoot = join(rootDirectory, 'push-target.git');
    await mkdir(bareRoot);
    git(bareRoot, 'init', '--bare', '--initial-branch=main');
    git(repositoryRoot, 'config', 'push.followTags', 'true');
    git(repositoryRoot, 'tag', '-a', 'release-surprise', '-m', 'Must remain local');
    const initial = await service.snapshot(PROJECT_ID);
    const actual = createGitCommandRunner();
    const pushCalls: string[][] = [];
    const confined = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: async (root, arguments_, options) => {
        if (arguments_[0] === 'push') {
          pushCalls.push([...arguments_]);
          git(
            root,
            'push',
            '--recurse-submodules=no',
            '--no-follow-tags',
            '--signed=no',
            bareRoot,
            arguments_.at(-1)!,
          );
          return '';
        }
        return actual(root, arguments_, options);
      },
    });

    const pushed = await confined.push({
      projectId: PROJECT_ID,
      expectedHead: initial.state!.headSha,
      expectedBranch: initial.state!.currentBranch,
    });

    expect(pushCalls).toEqual([
      [
        'push',
        '--recurse-submodules=no',
        '--no-follow-tags',
        '--signed=no',
        'https://github.com/example/research.git',
        `${initial.state!.headSha}:refs/heads/main`,
      ],
    ]);
    expect(git(bareRoot, 'rev-parse', 'refs/heads/main')).toBe(initial.state!.headSha);
    expect(() => git(bareRoot, 'rev-parse', '--verify', 'refs/tags/release-surprise')).toThrow();
    expect(pushed.state?.upstream).toBe('origin/main');
  });

  it('anchors Push to the reviewed SHA if the local branch changes during the network call', async () => {
    const bareRoot = join(rootDirectory, 'push-race-target.git');
    await mkdir(bareRoot);
    git(bareRoot, 'init', '--bare', '--initial-branch=main');
    const initial = await service.snapshot(PROJECT_ID);
    const reviewedHead = initial.state!.headSha!;
    const actual = createGitCommandRunner();
    const confined = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: async (root, arguments_, options) => {
        if (arguments_[0] === 'push') {
          git(root, 'commit', '--allow-empty', '-m', 'External race commit');
          git(
            root,
            'push',
            '--recurse-submodules=no',
            '--no-follow-tags',
            '--signed=no',
            bareRoot,
            arguments_.at(-1)!,
          );
          return '';
        }
        return actual(root, arguments_, options);
      },
    });

    await expect(
      confined.push({
        projectId: PROJECT_ID,
        expectedHead: reviewedHead,
        expectedBranch: 'main',
      }),
    ).rejects.toMatchObject({ code: 'git_head_changed' });
    expect(git(bareRoot, 'rev-parse', 'refs/heads/main')).toBe(reviewedHead);
    expect(git(repositoryRoot, 'rev-parse', 'refs/heads/main')).not.toBe(reviewedHead);
  });

  it('maps bounded Git runner failures instead of leaking an unexpected IPC failure', async () => {
    const actual = createGitCommandRunner();
    const bounded = new GitWorkspaceService({
      workspace: { snapshot: async () => workspaceSnapshot(project) },
      rootDirectory: () => rootDirectory,
      runGit: (root, arguments_, options) =>
        arguments_[0] === 'status'
          ? Promise.reject(new GitCommandError('output_too_large'))
          : actual(root, arguments_, options),
    });

    await expect(bounded.snapshot(PROJECT_ID)).rejects.toMatchObject({
      code: 'git_output_too_large',
    });
  });

  it('blocks configured filters and inactive or cross-project access', async () => {
    const before = await service.snapshot(PROJECT_ID);
    const sentinel = join(rootDirectory, 'filter-ran');
    const executable = join(rootDirectory, 'unsafe-filter');
    await writeFile(executable, `#!/bin/sh\ntouch '${sentinel}'\ncat\n`);
    await chmod(executable, 0o755);
    await writeFile(join(repositoryRoot, '.gitattributes'), '*.ts filter=unsafe\n');
    git(repositoryRoot, 'config', 'filter.unsafe.clean', executable);
    await writeFile(join(repositoryRoot, 'src', 'metric.ts'), 'export const score = 0.9;\n');

    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({ code: 'repository_unsafe' });
    await expect(
      service.diff({ projectId: PROJECT_ID, path: 'src/metric.ts', staged: false }),
    ).rejects.toMatchObject({ code: 'repository_unsafe' });
    await expect(access(sentinel)).rejects.toThrow();

    await expect(
      service.stage({
        projectId: PROJECT_ID,
        expectedHead: before.state!.headSha,
        expectedBranch: before.state!.currentBranch,
        paths: ['src/metric.ts'],
      }),
    ).rejects.toMatchObject({ code: 'repository_unsafe' });

    await expect(service.snapshot('22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({
      code: 'project_not_found',
    });

    project = { ...project, archivedAt: new Date().toISOString() };
    await expect(service.snapshot(PROJECT_ID)).rejects.toMatchObject({ code: 'project_archived' });
  });
});

function workspaceSnapshot(project: ProjectRecord): WorkspaceSnapshot {
  return {
    schemaVersion: 1,
    revision: 1,
    projects: [project],
    tasks: [],
    objectives: [],
  };
}
