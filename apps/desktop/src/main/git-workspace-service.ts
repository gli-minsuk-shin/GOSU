import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import {
  GitExistingBranchNameSchema,
  GitFileSearchInputSchema,
  GitRelativePathSchema,
  type GitBranch,
  type GitChange,
  type GitCommit,
  type GitCommitInput,
  type GitCreateBranchInput,
  type GitDiffInput,
  type GitFileEntry,
  type GitFileInput,
  type GitFilePreview,
  type GitFileSearchInput,
  type GitFileSearchResult,
  type GitHeadCommand,
  type GitPathsCommand,
  type GitSwitchBranchInput,
  type GitTextPreview,
  type GitWorkspaceSnapshot,
} from '../shared/git-workspace-contracts';
import type { GitWorkspaceIpcErrorCode } from '../shared/git-workspace-ipc-result';
import { repositoryIdentifierForAgent } from '../shared/repository-identifier';
import type { WorkspaceService } from './workspace-service';
import {
  GitCommandError,
  createGitCommandRunner,
  type GitCommandRunner,
} from './git-command-runner';

const MAX_TREE_ENTRIES = 5_000;
const MAX_SEARCH_SCAN_ENTRIES = 20_000;
const MAX_SEARCH_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_ENTRIES = 100;
const MAX_PREVIEW_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_DIFF_BYTES = 1024 * 1024;
const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UNSAFE_LOCAL_CONFIG_PATTERN =
  '^(include\\.path|includeif\\..*\\.path|core\\.(hookspath|fsmonitor|attributesfile|alternaterefscommand|sshcommand|sparsecheckout|sparsecheckoutcone)|extensions\\.partialclone|remote\\..*\\.(promisor|partialclonefilter)|diff\\..*\\.(command|textconv)|filter\\..*\\.(clean|smudge|process))$';
const UNSAFE_NETWORK_CONFIG_PATTERN =
  '^(url\\..*\\.(push)?insteadof|remote\\.origin\\.(pushurl|uploadpack|receivepack)|http\\..*)$';

type ProjectReader = Pick<WorkspaceService, 'snapshot'>;

export class GitWorkspaceServiceError extends Error {
  constructor(
    readonly code: GitWorkspaceIpcErrorCode,
    readonly details: Readonly<{ currentHead?: string }> = {},
  ) {
    super(code);
    this.name = 'GitWorkspaceServiceError';
  }
}

type GitWorkspaceServiceOptions = Readonly<{
  workspace: ProjectReader;
  rootDirectory: () => string;
  runGit?: GitCommandRunner;
}>;

function cleanDisplay(value: string, maximum = 1_024) {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || (code >= 127 && code <= 159) ? '�' : character;
    })
    .join('')
    .slice(0, maximum);
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function normalizeSearchValue(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function normalizedSearchTokens(query: string) {
  return normalizeSearchValue(query).split(/\s+/u).filter(Boolean).slice(0, 16);
}

function isInside(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function directoryEntryExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function parseGitHubRepository(remote: string) {
  const candidate = remote.trim();
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLocaleLowerCase('en-US') !== 'github.com' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null;
    }
    const parts = url.pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/u, '')
      .split('/');
    return parts.length === 2 ? repositoryIdentifierForAgent(parts.join('/')) : null;
  } catch {
    return null;
  }
}

function nullSeparatedValues(output: string) {
  return output.split('\0').filter((value) => value !== '');
}

function decodeUtf8Preview(bytes: Buffer, boundaryMaySplitCharacter: boolean) {
  const maximumTrim = boundaryMaySplitCharacter ? Math.min(3, bytes.length) : 0;
  for (let trim = 0; trim <= maximumTrim; trim += 1) {
    try {
      const decodedBytes = bytes.subarray(0, bytes.length - trim);
      return {
        content: new TextDecoder('utf-8', { fatal: true }).decode(decodedBytes),
        decodedByteLength: decodedBytes.length,
      };
    } catch {
      // A bounded backtrack distinguishes an incomplete final UTF-8 sequence from binary data.
    }
  }
  throw new GitWorkspaceServiceError('git_binary_file');
}

function parseStatus(output: string): GitChange[] {
  const records = output.split('\0');
  const changes: GitChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const indexStatus = record[0] ?? ' ';
    const worktreeStatus = record[1] ?? ' ';
    const path = record.slice(3);
    const renamed =
      indexStatus === 'R' ||
      indexStatus === 'C' ||
      worktreeStatus === 'R' ||
      worktreeStatus === 'C';
    const originalPath = renamed ? records[index + 1] : undefined;
    if (renamed) index += 1;
    if (!GitRelativePathSchema.safeParse(path).success) continue;
    const conflict =
      indexStatus === 'U' ||
      worktreeStatus === 'U' ||
      (indexStatus === 'A' && worktreeStatus === 'A') ||
      (indexStatus === 'D' && worktreeStatus === 'D');
    changes.push({
      path,
      ...(originalPath && GitRelativePathSchema.safeParse(originalPath).success
        ? { originalPath }
        : {}),
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!',
      unstaged: worktreeStatus !== ' ' || indexStatus === '?',
      conflict,
    });
  }
  return changes;
}

function parseBranches(output: string): GitBranch[] {
  return output
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [name, head, upstream, track, headSha, lastCommitAt, subject, symbolicTarget] =
        line.split('\0');
      if (symbolicTarget) throw new GitWorkspaceServiceError('repository_unsafe');
      if (
        !name ||
        !GitExistingBranchNameSchema.safeParse(name).success ||
        !headSha ||
        !lastCommitAt
      )
        return [];
      const ahead = Number(/ahead (\d+)/u.exec(track ?? '')?.[1] ?? 0);
      const behind = Number(/behind (\d+)/u.exec(track ?? '')?.[1] ?? 0);
      return [
        {
          name,
          current: head === '*',
          ...(upstream ? { upstream: cleanDisplay(upstream, 300) } : {}),
          ahead,
          behind,
          headSha,
          lastCommitAt,
          lastCommitSubject: cleanDisplay(subject ?? '', 1_024),
        },
      ];
    });
}

function parseCommitMetadata(output: string, expectedObjectIds: readonly string[]) {
  const fields = output.split('\0');
  if (fields.length !== expectedObjectIds.length * 5 + 1 || fields.at(-1) !== '') {
    throw new GitWorkspaceServiceError('repository_unsafe');
  }
  const commits: GitCommit[] = [];
  for (let index = 0; index < expectedObjectIds.length; index += 1) {
    const offset = index * 5;
    const [sha, authorName, authoredAt, subject, separator] = fields.slice(offset, offset + 5);
    if (
      !sha ||
      sha !== expectedObjectIds[index] ||
      !FULL_OBJECT_ID_PATTERN.test(sha) ||
      !authoredAt ||
      Number.isNaN(new Date(authoredAt).valueOf()) ||
      separator !== ''
    ) {
      throw new GitWorkspaceServiceError('repository_unsafe');
    }
    commits.push({
      sha,
      shortSha: sha.slice(0, 12),
      subject: cleanDisplay(subject ?? '', 1_024),
      authorName: cleanDisplay(authorName ?? '', 300),
      authoredAt,
      refs: [],
    });
  }
  return commits;
}

function commandError(error: unknown): GitWorkspaceServiceError {
  if (!(error instanceof GitCommandError))
    return new GitWorkspaceServiceError('git_operation_failed');
  switch (error.kind) {
    case 'unavailable':
      return new GitWorkspaceServiceError('git_unavailable');
    case 'auth':
      return new GitWorkspaceServiceError('git_auth_required');
    case 'conflict':
      return new GitWorkspaceServiceError('git_conflict');
    case 'output_too_large':
      return new GitWorkspaceServiceError('git_output_too_large');
    default:
      return new GitWorkspaceServiceError('git_operation_failed');
  }
}

export class GitWorkspaceService {
  private readonly workspace: ProjectReader;
  private readonly rootDirectory: () => string;
  private readonly runGit: GitCommandRunner;
  private readonly projectTails = new Map<string, Promise<void>>();

  constructor(options: GitWorkspaceServiceOptions) {
    this.workspace = options.workspace;
    this.rootDirectory = options.rootDirectory;
    this.runGit = options.runGit ?? createGitCommandRunner();
  }

  snapshot(projectId: string): Promise<GitWorkspaceSnapshot> {
    return this.exclusive(projectId, () => this.snapshotUnlocked(projectId));
  }

  /** Lightweight manuscript provenance read: validates the owned worktree and resolves HEAD only. */
  revision(projectId: string): Promise<string | null> {
    return this.exclusive(projectId, async () => {
      const { repository } = await this.requireActiveProject(projectId);
      const root = this.repositoryRoot(projectId);
      if (!repository || !(await pathExists(root))) return null;
      await this.validateRepositoryAt(root, repository);
      return (await this.currentHeadState(root)).headSha;
    });
  }

  /** Read-only filename search. Archived projects remain searchable; Trash never does. */
  searchFiles(input: GitFileSearchInput, signal?: AbortSignal): Promise<GitFileSearchResult> {
    signal?.throwIfAborted();
    const command = GitFileSearchInputSchema.parse(input);
    return this.exclusive(command.projectId, async () => {
      signal?.throwIfAborted();
      const { repository } = await this.requireSearchableProject(command.projectId);
      const root = this.repositoryRoot(command.projectId);
      if (!repository || !(await pathExists(root))) {
        return { entries: [], scannedEntries: 0, truncated: false, incomplete: false };
      }
      signal?.throwIfAborted();
      await this.validateRepositoryAt(root, repository);
      signal?.throwIfAborted();
      return this.searchFileIndex(root, command.query, command.limit, signal);
    });
  }

  clone(projectId: string): Promise<GitWorkspaceSnapshot> {
    return this.exclusive(projectId, async () => {
      const { repository } = await this.requireActiveProject(projectId);
      if (!repository) throw new GitWorkspaceServiceError('repository_identifier_required');
      const destination = this.repositoryRoot(projectId);
      if (await pathExists(destination)) {
        throw new GitWorkspaceServiceError('repository_already_cloned');
      }
      const parent = dirname(destination);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const temporary = join(parent, `${projectId}.clone-${randomUUID()}`);
      try {
        await this.runGit(
          parent,
          [
            'clone',
            '--origin',
            'origin',
            '--no-recurse-submodules',
            '--no-checkout',
            '--',
            `https://github.com/${repository}.git`,
            temporary,
          ],
          { timeoutMs: 120_000, maxBytes: 4 * 1024 * 1024, network: true },
        );
        await this.validateRepositoryAt(temporary, repository);
        await this.assertOrigin(temporary, repository);
        await this.assertSafeMutationConfiguration(temporary);
        const clonedHead = await this.tryRun(temporary, ['rev-parse', '--verify', 'HEAD']);
        if (clonedHead) {
          await this.runGit(temporary, ['checkout', '--force', '--no-recurse-submodules']);
        }
        if (await pathExists(destination)) {
          throw new GitWorkspaceServiceError('repository_already_cloned');
        }
        await rename(temporary, destination);
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        throw commandError(error);
      } finally {
        await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      }
      return this.snapshotUnlocked(projectId);
    });
  }

  readFile(input: GitFileInput): Promise<GitFilePreview> {
    return this.exclusive(input.projectId, async () => {
      const { root } = await this.requireRepository(input.projectId);
      const path = await this.safeRegularFile(root, input.path);
      const metadata = await stat(path);
      if (metadata.size > MAX_PREVIEW_FILE_BYTES) {
        throw new GitWorkspaceServiceError('git_file_too_large');
      }
      const length = Math.min(metadata.size, MAX_PREVIEW_BYTES);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.dev !== metadata.dev || current.ino !== metadata.ino) {
          throw new GitWorkspaceServiceError('git_path_blocked');
        }
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, 0);
        const contentBytes = buffer.subarray(0, bytesRead);
        if (contentBytes.subarray(0, 8_192).includes(0)) {
          throw new GitWorkspaceServiceError('git_binary_file');
        }
        const decoded = decodeUtf8Preview(contentBytes, metadata.size > bytesRead);
        return {
          path: input.path,
          sizeBytes: metadata.size,
          renderMode: /\.(?:md|mdx|markdown)$/iu.test(input.path) ? 'markdown' : 'text',
          content: decoded.content,
          truncated: metadata.size > decoded.decodedByteLength,
        };
      } finally {
        await handle.close();
      }
    });
  }

  diff(input: GitDiffInput): Promise<GitTextPreview> {
    return this.exclusive(input.projectId, async () => {
      const { root } = await this.requireRepository(input.projectId);
      await this.assertSafeMutationConfiguration(root);
      const changes = parseStatus(
        await this.runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      );
      const selected = changes.find((change) => change.path === input.path);
      const renamed = input.staged
        ? selected?.indexStatus === 'R'
        : selected?.worktreeStatus === 'R';
      const paths =
        renamed && selected?.originalPath ? [selected.originalPath, input.path] : [input.path];
      try {
        const content = await this.runGit(
          root,
          [
            'diff',
            ...(input.staged ? ['--cached'] : []),
            '--no-ext-diff',
            '--no-textconv',
            '--no-color',
            '--unified=3',
            '--',
            ...paths,
          ],
          { maxBytes: MAX_DIFF_BYTES },
        );
        return { content, truncated: false };
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        throw commandError(error);
      }
    });
  }

  commitDetail(projectId: string, commitSha: string): Promise<GitTextPreview> {
    return this.exclusive(projectId, async () => {
      const { root } = await this.requireRepository(projectId);
      const head = await this.currentHeadState(root);
      if (!head.headSha) throw new GitWorkspaceServiceError('git_no_commits');
      const [objectType, reachable] = await Promise.all([
        this.tryRun(root, ['cat-file', '-t', commitSha]),
        this.tryRun(root, ['merge-base', '--is-ancestor', commitSha, head.headSha]),
      ]);
      if (objectType?.trim() !== 'commit' || reachable === null) {
        throw new GitWorkspaceServiceError('git_commit_not_available');
      }
      try {
        const content = await this.runGit(
          root,
          [
            'show',
            '--no-show-signature',
            '--no-ext-diff',
            '--no-textconv',
            '--no-color',
            '--format=fuller',
            '--stat',
            '--patch',
            '--max-count=1',
            commitSha,
            '--',
          ],
          { maxBytes: MAX_DIFF_BYTES },
        );
        return { content, truncated: false };
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        throw commandError(error);
      }
    });
  }

  stage(input: GitPathsCommand): Promise<GitWorkspaceSnapshot> {
    return this.mutatePaths(input, async (root, paths) => {
      await this.assertSafeAttributes(root, paths);
      await this.runGit(root, ['add', '--', ...paths]);
    });
  }

  unstage(input: GitPathsCommand): Promise<GitWorkspaceSnapshot> {
    return this.mutatePaths(
      input,
      async (root, paths) => {
        await this.runGit(
          root,
          input.expectedHead === null
            ? ['rm', '--cached', '--force', '--ignore-unmatch', '--', ...paths]
            : ['restore', '--staged', '--', ...paths],
        );
      },
      true,
    );
  }

  commit(input: GitCommitInput): Promise<GitWorkspaceSnapshot> {
    return this.exclusive(input.projectId, async () => {
      const { root } = await this.requireRepository(input.projectId);
      await this.assertExpectedState(root, input);
      await this.assertSafeMutationConfiguration(root);
      if (input.expectedBranch === null) {
        throw new GitWorkspaceServiceError('git_detached_head');
      }
      const changes = parseStatus(
        await this.runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      );
      if (changes.some((change) => change.conflict)) {
        throw new GitWorkspaceServiceError('git_conflict');
      }
      if (!changes.some((change) => change.staged)) {
        throw new GitWorkspaceServiceError('git_nothing_to_commit');
      }
      if ((await this.indexFingerprint(root)) !== input.expectedIndexFingerprint) {
        throw new GitWorkspaceServiceError('git_index_changed');
      }
      const identity = await this.commitIdentity(root);
      try {
        const treeSha = (await this.runGit(root, ['write-tree'], { maxBytes: 4_096 })).trim();
        if (!FULL_OBJECT_ID_PATTERN.test(treeSha)) {
          throw new GitWorkspaceServiceError('repository_unsafe');
        }
        if ((await this.indexFingerprint(root)) !== input.expectedIndexFingerprint) {
          throw new GitWorkspaceServiceError('git_index_changed');
        }
        const commitSha = (
          await this.runGit(root, [
            '-c',
            `user.name=${identity.name}`,
            '-c',
            `user.email=${identity.email}`,
            'commit-tree',
            treeSha,
            ...(input.expectedHead ? ['-p', input.expectedHead] : []),
            '-m',
            input.summary,
            ...(input.description ? ['-m', input.description] : []),
          ])
        ).trim();
        if (!FULL_OBJECT_ID_PATTERN.test(commitSha)) {
          throw new GitWorkspaceServiceError('repository_unsafe');
        }
        await this.assertExpectedState(root, input);
        const branchRef = `refs/heads/${input.expectedBranch}`;
        await this.assertDirectRef(root, branchRef);
        try {
          await this.runGit(root, [
            'update-ref',
            '--no-deref',
            '-m',
            `commit: ${input.summary}`,
            branchRef,
            commitSha,
            input.expectedHead ?? '0'.repeat(commitSha.length),
          ]);
        } catch (error) {
          await this.assertExpectedState(root, input);
          throw error;
        }
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        throw commandError(error);
      }
      return this.snapshotUnlocked(input.projectId);
    });
  }

  createBranch(input: GitCreateBranchInput): Promise<GitWorkspaceSnapshot> {
    return this.exclusive(input.projectId, async () => {
      const { root } = await this.requireRepository(input.projectId);
      await this.assertExpectedState(root, input);
      await this.assertSafeMutationConfiguration(root);
      if (input.expectedHead === null) throw new GitWorkspaceServiceError('git_no_commits');
      const branches = await this.branches(root);
      if (branches.some((branch) => branch.name === input.name)) {
        throw new GitWorkspaceServiceError('git_branch_exists');
      }
      try {
        await this.runGit(root, ['check-ref-format', '--branch', input.name]);
        await this.runGit(root, ['branch', '--', input.name, input.expectedHead]);
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        throw commandError(error);
      }
      return this.snapshotUnlocked(input.projectId);
    });
  }

  switchBranch(input: GitSwitchBranchInput): Promise<GitWorkspaceSnapshot> {
    return this.exclusive(input.projectId, async () => {
      const { root } = await this.requireRepository(input.projectId);
      await this.assertExpectedState(root, input);
      await this.assertSafeMutationConfiguration(root);
      await this.assertClean(root);
      const branches = await this.branches(root);
      if (!branches.some((branch) => branch.name === input.name)) {
        throw new GitWorkspaceServiceError('git_branch_not_found');
      }
      try {
        await this.runGit(root, ['switch', '--no-recurse-submodules', '--', input.name]);
      } catch (error) {
        throw commandError(error);
      }
      return this.snapshotUnlocked(input.projectId);
    });
  }

  fetch(input: GitHeadCommand): Promise<GitWorkspaceSnapshot> {
    return this.exclusive(input.projectId, async () => {
      const { root, repository } = await this.requireRepository(input.projectId);
      await this.assertExpectedState(root, input);
      await this.assertOrigin(root, repository);
      try {
        await this.fetchRemoteHeads(root, repository);
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        throw commandError(error);
      }
      return this.snapshotUnlocked(input.projectId);
    });
  }

  pull(input: GitHeadCommand): Promise<GitWorkspaceSnapshot> {
    return this.exclusive(input.projectId, async () => {
      const { root, repository } = await this.requireRepository(input.projectId);
      await this.assertExpectedState(root, input);
      await this.assertSafeMutationConfiguration(root);
      await this.assertClean(root);
      await this.assertOrigin(root, repository);
      const upstream = await this.tryRun(root, [
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{upstream}',
      ]);
      const currentBranch = input.expectedBranch;
      const upstreamBranch = upstream?.trim();
      if (
        !currentBranch ||
        !upstreamBranch?.startsWith('origin/') ||
        upstreamBranch.slice('origin/'.length) !== currentBranch
      ) {
        throw new GitWorkspaceServiceError('git_no_upstream');
      }
      try {
        const fetched = await this.fetchRemoteHeads(root, repository, currentBranch);
        const remoteHead = fetched.get(currentBranch);
        if (!remoteHead) throw new GitWorkspaceServiceError('git_branch_not_found');
        await this.assertExpectedState(root, input);
        await this.assertClean(root);
        await this.runGit(root, [
          'merge',
          '--ff-only',
          '--no-edit',
          '--no-verify',
          '--no-verify-signatures',
          remoteHead,
        ]);
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        throw commandError(error);
      }
      return this.snapshotUnlocked(input.projectId);
    });
  }

  push(input: GitHeadCommand): Promise<GitWorkspaceSnapshot> {
    return this.exclusive(input.projectId, async () => {
      const { root, repository } = await this.requireRepository(input.projectId);
      await this.assertExpectedState(root, input);
      await this.assertOrigin(root, repository);
      if (input.expectedHead === null) throw new GitWorkspaceServiceError('git_no_commits');
      const branch = input.expectedBranch;
      if (!branch || !GitExistingBranchNameSchema.safeParse(branch).success) {
        throw new GitWorkspaceServiceError('git_branch_not_found');
      }
      const upstream = (
        await this.tryRun(root, [
          'rev-parse',
          '--abbrev-ref',
          '--symbolic-full-name',
          '@{upstream}',
        ])
      )?.trim();
      if (upstream && upstream !== `origin/${branch}`) {
        throw new GitWorkspaceServiceError('git_no_upstream');
      }
      const previousTrackingHead = (await this.trackingHeads(root)).get(branch);
      try {
        await this.runGit(
          root,
          [
            'push',
            '--recurse-submodules=no',
            '--no-follow-tags',
            '--signed=no',
            `https://github.com/${repository}.git`,
            `${input.expectedHead}:refs/heads/${branch}`,
          ],
          { timeoutMs: 60_000, network: true },
        );
        await this.assertExpectedState(root, input);
        await this.updateTrackingRef(root, branch, input.expectedHead, previousTrackingHead);
        if (!upstream) {
          await this.runGit(root, ['branch', `--set-upstream-to=origin/${branch}`, '--', branch]);
        }
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        throw commandError(error);
      }
      return this.snapshotUnlocked(input.projectId);
    });
  }

  async revealPath(projectId: string) {
    const { root } = await this.requireRepository(projectId);
    return root;
  }

  private async snapshotUnlocked(projectId: string): Promise<GitWorkspaceSnapshot> {
    const { repository } = await this.requireActiveProject(projectId);
    const root = this.repositoryRoot(projectId);
    const cloned = await pathExists(root);
    if (!repository || !cloned) {
      return { schemaVersion: 1, projectId, repository, cloned: false };
    }
    await this.validateRepositoryAt(root, repository);
    await this.assertSafeMutationConfiguration(root);
    const headState = await this.currentHeadState(root);
    const [upstreamOutput, statusOutput, files, branches, history] = await Promise.all([
      this.tryRun(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
      this.runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      this.files(root),
      this.branches(root),
      this.history(root, headState.headSha),
    ]);
    const { headSha, currentBranch } = headState;
    const upstream = upstreamOutput?.trim() || undefined;
    let ahead = 0;
    let behind = 0;
    if (upstream && headSha) {
      const counts = await this.tryRun(root, [
        'rev-list',
        '--left-right',
        '--count',
        `HEAD...${upstream}`,
      ]);
      const [aheadText, behindText] = counts?.trim().split(/\s+/u) ?? [];
      ahead = Number(aheadText ?? 0);
      behind = Number(behindText ?? 0);
    }
    const changes = parseStatus(statusOutput);
    return {
      schemaVersion: 1,
      projectId,
      repository,
      cloned: true,
      state: {
        repository,
        githubUrl: `https://github.com/${repository}`,
        currentBranch,
        detachedHead: currentBranch === null,
        headSha,
        indexFingerprint: files.indexFingerprint,
        ...(upstream ? { upstream } : {}),
        ahead,
        behind,
        dirty: changes.length > 0,
        files: files.entries,
        filesTruncated: files.truncated,
        changes,
        branches,
        commits: history.commits,
        historyTruncated: history.truncated,
      },
    };
  }

  private async files(root: string) {
    const [pathsOutput, stagesOutput] = await Promise.all([
      this.runGit(root, ['ls-files', '-co', '--exclude-standard', '-z'], {
        maxBytes: 4 * 1024 * 1024,
      }),
      this.runGit(root, ['ls-files', '--stage', '-z'], { maxBytes: 4 * 1024 * 1024 }),
    ]);
    const modes = new Map<string, string>();
    for (const record of stagesOutput.split('\0')) {
      const separatorIndex = record.indexOf('\t');
      if (separatorIndex === -1) continue;
      const metadata = record.slice(0, separatorIndex).split(' ');
      const path = record.slice(separatorIndex + 1);
      if (metadata[0] && GitRelativePathSchema.safeParse(path).success)
        modes.set(path, metadata[0]);
    }
    const paths = [
      ...new Set(
        pathsOutput.split('\0').filter((path) => GitRelativePathSchema.safeParse(path).success),
      ),
    ].sort((left, right) => left.localeCompare(right));
    const entries: GitFileEntry[] = paths.slice(0, MAX_TREE_ENTRIES).map((path) => ({
      path,
      kind:
        modes.get(path) === '120000'
          ? 'symlink'
          : modes.get(path) === '160000'
            ? 'submodule'
            : 'file',
    }));
    return {
      entries,
      truncated: paths.length > MAX_TREE_ENTRIES,
      indexFingerprint: createHash('sha256').update(stagesOutput).digest('hex'),
    };
  }

  private async searchFileIndex(
    root: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<GitFileSearchResult> {
    signal?.throwIfAborted();
    const [pathsOutput, stagesOutput] = await Promise.all([
      this.runGit(root, ['ls-files', '-co', '--exclude-standard', '-z'], {
        maxBytes: MAX_SEARCH_INDEX_BYTES,
        ...(signal ? { signal } : {}),
      }),
      this.runGit(root, ['ls-files', '--stage', '-z'], {
        maxBytes: MAX_SEARCH_INDEX_BYTES,
        ...(signal ? { signal } : {}),
      }),
    ]);
    const modes = new Map<string, string>();
    for (const record of stagesOutput.split('\0')) {
      const separatorIndex = record.indexOf('\t');
      if (separatorIndex === -1) continue;
      const metadata = record.slice(0, separatorIndex).split(' ');
      const path = record.slice(separatorIndex + 1);
      if (metadata[0] && GitRelativePathSchema.safeParse(path).success) {
        modes.set(path, metadata[0]);
      }
    }
    const rawPaths = pathsOutput.split('\0').filter(Boolean);
    const invalidPathFound = rawPaths.some(
      (path) => !GitRelativePathSchema.safeParse(path).success,
    );
    const paths = [
      ...new Set(rawPaths.filter((path) => GitRelativePathSchema.safeParse(path).success)),
    ].sort((left, right) => left.localeCompare(right));
    const visiblePaths = paths.slice(0, MAX_SEARCH_SCAN_ENTRIES);
    const tokens = normalizedSearchTokens(query);
    const matches: GitFileEntry[] = [];
    let scannedEntries = 0;
    for (const path of visiblePaths) {
      signal?.throwIfAborted();
      scannedEntries += 1;
      const mode = modes.get(path);
      const kind = mode === '120000' ? 'symlink' : mode === '160000' ? 'submodule' : 'file';
      if (kind !== 'file' || !tokens.every((token) => normalizeSearchValue(path).includes(token))) {
        continue;
      }
      matches.push({ path, kind });
      if (matches.length > limit) break;
    }
    return {
      entries: matches.slice(0, limit),
      scannedEntries,
      truncated: matches.length > limit,
      incomplete: invalidPathFound || paths.length > visiblePaths.length,
    };
  }

  private async indexFingerprint(root: string) {
    const stages = await this.runGit(root, ['ls-files', '--stage', '-z'], {
      maxBytes: 4 * 1024 * 1024,
    });
    return createHash('sha256').update(stages).digest('hex');
  }

  private async branches(root: string) {
    const output = await this.runGit(root, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(objectname)%00%(committerdate:iso-strict)%00%(subject)%00%(symref)',
      'refs/heads',
    ]);
    return parseBranches(output);
  }

  private async history(root: string, headSha: string | null) {
    if (!headSha) return { commits: [], truncated: false };
    const objectIdOutput = await this.runGit(root, [
      'rev-list',
      `--max-count=${MAX_HISTORY_ENTRIES + 1}`,
      headSha,
    ]);
    const objectIds = objectIdOutput.split('\n').filter(Boolean);
    if (objectIds.some((objectId) => !FULL_OBJECT_ID_PATTERN.test(objectId))) {
      throw new GitWorkspaceServiceError('repository_unsafe');
    }
    const visibleObjectIds = objectIds.slice(0, MAX_HISTORY_ENTRIES);
    if (visibleObjectIds.length === 0) return { commits: [], truncated: false };
    const metadata = await this.runGit(root, [
      'log',
      '--no-show-signature',
      '--no-walk=unsorted',
      '-z',
      '--format=%H%x00%an%x00%aI%x00%s%x00',
      ...visibleObjectIds,
      '--',
    ]);
    return {
      commits: parseCommitMetadata(metadata, visibleObjectIds),
      truncated: objectIds.length > MAX_HISTORY_ENTRIES,
    };
  }

  private async mutatePaths(
    input: GitPathsCommand,
    operation: (root: string, paths: readonly string[]) => Promise<void>,
    expandStagedRenames = false,
  ) {
    return this.exclusive(input.projectId, async () => {
      const { root } = await this.requireRepository(input.projectId);
      await this.assertExpectedState(root, input);
      await this.assertSafeMutationConfiguration(root);
      const changes = parseStatus(
        await this.runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      );
      const known = new Set(
        changes.flatMap((change) => [
          change.path,
          ...(change.originalPath ? [change.originalPath] : []),
        ]),
      );
      const requestedPaths = [...new Set(input.paths)];
      if (requestedPaths.some((path) => !known.has(path))) {
        throw new GitWorkspaceServiceError('git_path_blocked');
      }
      const paths = [
        ...new Set(
          requestedPaths.flatMap((path) => {
            const change = changes.find((candidate) => candidate.path === path);
            return expandStagedRenames && change?.indexStatus === 'R' && change.originalPath
              ? [change.originalPath, path]
              : [path];
          }),
        ),
      ];
      try {
        await operation(root, paths);
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        throw commandError(error);
      }
      return this.snapshotUnlocked(input.projectId);
    });
  }

  private async requireActiveProject(projectId: string) {
    const resolved = await this.requireSearchableProject(projectId);
    if (resolved.project.archivedAt) throw new GitWorkspaceServiceError('project_archived');
    return resolved;
  }

  private async requireSearchableProject(projectId: string) {
    const snapshot = await this.workspace.snapshot();
    const project = snapshot.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new GitWorkspaceServiceError('project_not_found');
    if (project.trashedAt) throw new GitWorkspaceServiceError('project_trashed');
    return { project, repository: repositoryIdentifierForAgent(project.repository) };
  }

  private repositoryRoot(projectId: string) {
    return join(this.rootDirectory(), projectId);
  }

  private async requireRepository(projectId: string) {
    const { repository } = await this.requireActiveProject(projectId);
    if (!repository) throw new GitWorkspaceServiceError('repository_identifier_required');
    const root = this.repositoryRoot(projectId);
    if (!(await pathExists(root))) throw new GitWorkspaceServiceError('repository_not_cloned');
    await this.validateRepositoryAt(root, repository);
    return { root: await realpath(root), repository };
  }

  private async validateRepositoryAt(root: string, expectedRepository: string) {
    let actualRoot: string;
    try {
      const requestedRoot = await lstat(root);
      if (!requestedRoot.isDirectory() || requestedRoot.isSymbolicLink()) {
        throw new Error('unsafe_repository_root');
      }
      actualRoot = await realpath(root);
      const expectedRoot = join(await realpath(dirname(root)), basename(root));
      if (actualRoot !== expectedRoot) throw new Error('unexpected_repository_root');
      const rootStat = await stat(actualRoot);
      if (!rootStat.isDirectory()) throw new Error('not_directory');
      if (typeof process.getuid === 'function' && rootStat.uid !== process.getuid()) {
        throw new Error('wrong_owner');
      }
      const gitMetadata = await lstat(join(actualRoot, '.git'));
      if (!gitMetadata.isDirectory() || gitMetadata.isSymbolicLink())
        throw new Error('unsafe_git_dir');
    } catch {
      throw new GitWorkspaceServiceError('repository_root_changed');
    }
    await this.validateGitAdmin(actualRoot);
    try {
      const unsafeMetadata = [
        join(actualRoot, '.git', 'objects', 'info', 'alternates'),
        join(actualRoot, '.git', 'objects', 'info', 'http-alternates'),
        join(actualRoot, '.git', 'info', 'grafts'),
        join(actualRoot, '.git', 'commondir'),
      ];
      if ((await Promise.all(unsafeMetadata.map(directoryEntryExists))).some(Boolean)) {
        throw new GitWorkspaceServiceError('repository_unsafe');
      }
      const packDirectory = join(actualRoot, '.git', 'objects', 'pack');
      if (await directoryEntryExists(packDirectory)) {
        const packEntries = await readdir(packDirectory);
        if (packEntries.some((entry) => entry.endsWith('.promisor'))) {
          throw new GitWorkspaceServiceError('repository_unsafe');
        }
      }
    } catch (error) {
      if (error instanceof GitWorkspaceServiceError) throw error;
      throw new GitWorkspaceServiceError('repository_unsafe');
    }
    try {
      const topLevel = (await this.runGit(actualRoot, ['rev-parse', '--show-toplevel'])).trim();
      if ((await realpath(topLevel)) !== actualRoot) {
        throw new GitWorkspaceServiceError('repository_root_changed');
      }
      const remoteOutput = await this.tryRun(actualRoot, [
        'config',
        '-z',
        '--get-all',
        'remote.origin.url',
      ]);
      const remoteValues = remoteOutput ? nullSeparatedValues(remoteOutput) : [];
      if (
        remoteValues.length !== 1 ||
        parseGitHubRepository(remoteValues[0] ?? '') !== expectedRepository
      ) {
        throw new GitWorkspaceServiceError('repository_root_changed');
      }
      await this.assertSafeMutationConfiguration(actualRoot);
    } catch (error) {
      if (error instanceof GitWorkspaceServiceError) throw error;
      throw commandError(error);
    }
  }

  private async safeRegularFile(root: string, relativePath: string) {
    const parsed = GitRelativePathSchema.safeParse(relativePath);
    if (!parsed.success) throw new GitWorkspaceServiceError('git_path_blocked');
    const candidate = resolve(root, ...relativePath.split('/'));
    if (!isInside(root, candidate) || candidate === root) {
      throw new GitWorkspaceServiceError('git_path_blocked');
    }
    try {
      const linkMetadata = await lstat(candidate);
      if (!linkMetadata.isFile() || linkMetadata.isSymbolicLink()) throw new Error('unsafe');
      const actual = await realpath(candidate);
      if (!isInside(root, actual)) throw new Error('escaped');
      return actual;
    } catch {
      throw new GitWorkspaceServiceError('git_path_blocked');
    }
  }

  private async validateGitAdmin(root: string) {
    const gitRoot = join(root, '.git');
    const inspect = async (
      relativePath: string,
      expected: 'file' | 'directory',
      optional = false,
    ) => {
      const candidate = join(gitRoot, ...relativePath.split('/'));
      try {
        const metadata = await lstat(candidate);
        if (
          metadata.isSymbolicLink() ||
          (expected === 'file' && (!metadata.isFile() || metadata.nlink !== 1)) ||
          (expected === 'directory' && !metadata.isDirectory())
        ) {
          throw new GitWorkspaceServiceError('repository_unsafe');
        }
        const actual = await realpath(candidate);
        if (!isInside(gitRoot, actual)) throw new GitWorkspaceServiceError('repository_unsafe');
      } catch (error) {
        if (error instanceof GitWorkspaceServiceError) throw error;
        if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw new GitWorkspaceServiceError('repository_unsafe');
      }
    };
    await Promise.all([
      inspect('HEAD', 'file'),
      inspect('config', 'file'),
      inspect('config.worktree', 'file', true),
      inspect('objects', 'directory'),
      inspect('objects/info', 'directory', true),
      inspect('objects/pack', 'directory', true),
      inspect('refs', 'directory'),
      inspect('logs', 'directory', true),
      inspect('index', 'file', true),
      inspect('packed-refs', 'file', true),
      inspect('COMMIT_EDITMSG', 'file', true),
      inspect('FETCH_HEAD', 'file', true),
      inspect('ORIG_HEAD', 'file', true),
      inspect('MERGE_HEAD', 'file', true),
      inspect('MERGE_MSG', 'file', true),
      inspect('MERGE_MODE', 'file', true),
      inspect('CHERRY_PICK_HEAD', 'file', true),
      inspect('REVERT_HEAD', 'file', true),
      inspect('SQUASH_MSG', 'file', true),
    ]);
  }

  private async assertExpectedState(root: string, expected: GitHeadCommand) {
    const current = await this.currentHeadState(root);
    if (
      current.headSha !== expected.expectedHead ||
      current.currentBranch !== expected.expectedBranch
    ) {
      throw new GitWorkspaceServiceError(
        'git_head_changed',
        current.headSha ? { currentHead: current.headSha } : {},
      );
    }
  }

  private async currentHeadState(root: string) {
    const [headOutput, symbolicHeadOutput] = await Promise.all([
      this.tryRun(root, ['rev-parse', '--verify', 'HEAD']),
      this.tryRun(root, ['symbolic-ref', '--quiet', 'HEAD']),
    ]);
    const headSha = headOutput?.trim() || null;
    if (headSha && !FULL_OBJECT_ID_PATTERN.test(headSha)) {
      throw new GitWorkspaceServiceError('repository_unsafe');
    }
    const symbolicHead = symbolicHeadOutput?.trim() || null;
    if (!symbolicHead) return { headSha, currentBranch: null };
    if (!symbolicHead.startsWith('refs/heads/')) {
      throw new GitWorkspaceServiceError('repository_unsafe');
    }
    const currentBranch = symbolicHead.slice('refs/heads/'.length);
    if (!GitExistingBranchNameSchema.safeParse(currentBranch).success) {
      throw new GitWorkspaceServiceError('repository_unsafe');
    }
    await this.assertDirectRef(root, symbolicHead);
    return { headSha, currentBranch };
  }

  private async assertDirectRef(root: string, refName: string) {
    if (!refName.startsWith('refs/')) throw new GitWorkspaceServiceError('repository_unsafe');
    const symbolicTarget = await this.tryRun(root, ['symbolic-ref', '--quiet', refName]);
    if (symbolicTarget?.trim()) throw new GitWorkspaceServiceError('repository_unsafe');
    const components = refName.split('/');
    for (const base of [join(root, '.git'), join(root, '.git', 'logs')]) {
      if (base.endsWith(`${sep}logs`) && !(await directoryEntryExists(base))) continue;
      let candidate = base;
      for (let index = 0; index < components.length; index += 1) {
        candidate = join(candidate, components[index] ?? '');
        try {
          const metadata = await lstat(candidate);
          if (metadata.isSymbolicLink()) throw new GitWorkspaceServiceError('repository_unsafe');
          const isLast = index === components.length - 1;
          if (
            (!isLast && !metadata.isDirectory()) ||
            (isLast && (!metadata.isFile() || metadata.nlink !== 1))
          ) {
            throw new GitWorkspaceServiceError('repository_unsafe');
          }
        } catch (error) {
          if (error instanceof GitWorkspaceServiceError) throw error;
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
          throw new GitWorkspaceServiceError('repository_unsafe');
        }
      }
    }
  }

  private async commitIdentity(root: string) {
    const read = async (key: 'user.name' | 'user.email', maximum: number) => {
      try {
        const value = (
          await this.runGit(root, ['config', '--get', key], {
            allowUserConfig: true,
            maxBytes: 4_096,
          })
        ).trim();
        return value.length > 0 && value.length <= maximum && !hasControlCharacter(value)
          ? value
          : null;
      } catch (error) {
        if (error instanceof GitCommandError && error.kind === 'failed') return null;
        throw commandError(error);
      }
    };
    const [name, email] = await Promise.all([read('user.name', 300), read('user.email', 320)]);
    if (!name || !email) throw new GitWorkspaceServiceError('git_identity_required');
    return { name, email };
  }

  private async assertSafeMutationConfiguration(root: string) {
    for (const scope of ['--local', '--worktree'] as const) {
      const unsafe = await this.tryRun(root, [
        'config',
        scope,
        '--get-regexp',
        UNSAFE_LOCAL_CONFIG_PATTERN,
      ]);
      if (unsafe?.trim()) throw new GitWorkspaceServiceError('repository_unsafe');
    }
  }

  private async assertSafeAttributes(root: string, paths: readonly string[]) {
    const output = await this.tryRun(root, ['check-attr', '-z', 'filter', '--', ...paths]);
    if (!output) return;
    const fields = output.split('\0');
    for (let index = 2; index < fields.length; index += 3) {
      const value = fields[index];
      if (value && value !== 'unspecified' && value !== 'unset') {
        throw new GitWorkspaceServiceError('repository_unsafe');
      }
    }
  }

  private async assertClean(root: string) {
    const status = await this.runGit(root, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
    if (status !== '') throw new GitWorkspaceServiceError('git_dirty_worktree');
  }

  private async trackingHeads(root: string) {
    const output = await this.runGit(root, [
      'for-each-ref',
      '--format=%(refname)%00%(objectname)%00%(symref)',
      'refs/remotes/origin',
    ]);
    const heads = new Map<string, string>();
    for (const line of output.split('\n').filter(Boolean)) {
      const [refName, objectId, symbolicTarget] = line.split('\0');
      if (refName === 'refs/remotes/origin/HEAD' && symbolicTarget) continue;
      if (
        !refName?.startsWith('refs/remotes/origin/') ||
        symbolicTarget ||
        !objectId ||
        !FULL_OBJECT_ID_PATTERN.test(objectId)
      ) {
        throw new GitWorkspaceServiceError('repository_unsafe');
      }
      const branch = refName.slice('refs/remotes/origin/'.length);
      if (!GitExistingBranchNameSchema.safeParse(branch).success) {
        throw new GitWorkspaceServiceError('repository_unsafe');
      }
      await this.assertDirectRef(root, refName);
      heads.set(branch, objectId);
    }
    return heads;
  }

  private async fetchRemoteHeads(root: string, repository: string, branch?: string) {
    const previous = await this.trackingHeads(root);
    const session = randomUUID().replaceAll('-', '');
    const prefix = `refs/gosu/fetch/${session}/`;
    const refspec = branch
      ? `+refs/heads/${branch}:${prefix}${branch}`
      : `+refs/heads/*:${prefix}*`;
    const temporaryRefs = new Map<string, string>();
    try {
      await this.assertDirectRef(root, `${prefix}${branch ?? 'preflight'}`);
      await this.runGit(
        root,
        [
          'fetch',
          '--recurse-submodules=no',
          '--no-tags',
          '--no-prune',
          '--no-write-fetch-head',
          `https://github.com/${repository}.git`,
          refspec,
        ],
        { timeoutMs: 60_000, network: true },
      );
      const output = await this.runGit(root, [
        'for-each-ref',
        '--format=%(refname)%00%(objectname)%00%(symref)',
        prefix,
      ]);
      for (const line of output.split('\n').filter(Boolean)) {
        const [refName, objectId, symbolicTarget] = line.split('\0');
        if (
          !refName?.startsWith(prefix) ||
          symbolicTarget ||
          !objectId ||
          !FULL_OBJECT_ID_PATTERN.test(objectId)
        ) {
          throw new GitWorkspaceServiceError('repository_unsafe');
        }
        const fetchedBranch = refName.slice(prefix.length);
        if (!GitExistingBranchNameSchema.safeParse(fetchedBranch).success) {
          throw new GitWorkspaceServiceError('repository_unsafe');
        }
        await this.assertDirectRef(root, refName);
        temporaryRefs.set(fetchedBranch, objectId);
      }
      if (temporaryRefs.size > MAX_TREE_ENTRIES) {
        throw new GitWorkspaceServiceError('git_output_too_large');
      }
      for (const [fetchedBranch, objectId] of temporaryRefs) {
        await this.updateTrackingRef(root, fetchedBranch, objectId, previous.get(fetchedBranch));
      }
      return temporaryRefs;
    } finally {
      for (const [fetchedBranch, objectId] of temporaryRefs) {
        const refName = `${prefix}${fetchedBranch}`;
        await this.runGit(root, ['update-ref', '--no-deref', '-d', refName, objectId]).catch(
          () => undefined,
        );
      }
    }
  }

  private async updateTrackingRef(
    root: string,
    branch: string,
    objectId: string,
    previousObjectId: string | undefined,
  ) {
    if (!GitExistingBranchNameSchema.safeParse(branch).success) {
      throw new GitWorkspaceServiceError('repository_unsafe');
    }
    const refName = `refs/remotes/origin/${branch}`;
    await this.assertDirectRef(root, refName);
    try {
      await this.runGit(root, [
        'update-ref',
        '--no-deref',
        refName,
        objectId,
        previousObjectId ?? '0'.repeat(objectId.length),
      ]);
    } catch {
      await this.assertDirectRef(root, refName);
      throw new GitWorkspaceServiceError('git_head_changed');
    }
  }

  private async assertOrigin(root: string, expectedRepository: string) {
    const remoteOutput = await this.tryRun(root, [
      'config',
      '-z',
      '--get-all',
      'remote.origin.url',
    ]);
    const remotes = remoteOutput ? nullSeparatedValues(remoteOutput) : [];
    const pushUrlOutput = await this.tryRun(root, [
      'config',
      '-z',
      '--get-all',
      'remote.origin.pushurl',
    ]);
    if (
      remotes.length !== 1 ||
      parseGitHubRepository(remotes[0] ?? '') !== expectedRepository ||
      (pushUrlOutput ? nullSeparatedValues(pushUrlOutput).length > 0 : false)
    ) {
      throw new GitWorkspaceServiceError('git_no_remote');
    }
    for (const scope of ['--local', '--worktree'] as const) {
      const unsafe = await this.tryRun(root, [
        'config',
        scope,
        '--get-regexp',
        UNSAFE_NETWORK_CONFIG_PATTERN,
      ]);
      if (unsafe?.trim()) throw new GitWorkspaceServiceError('repository_unsafe');
    }
  }

  private async tryRun(root: string, arguments_: readonly string[]) {
    try {
      return await this.runGit(root, arguments_);
    } catch (error) {
      if (error instanceof GitCommandError && error.kind === 'failed') return null;
      throw commandError(error);
    }
  }

  private async exclusive<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.projectTails.get(projectId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.then(() => gate);
    this.projectTails.set(projectId, tail);
    await previous;
    try {
      return await operation();
    } catch (error) {
      if (error instanceof GitCommandError) throw commandError(error);
      throw error;
    } finally {
      release();
      if (this.projectTails.get(projectId) === tail) this.projectTails.delete(projectId);
    }
  }
}
