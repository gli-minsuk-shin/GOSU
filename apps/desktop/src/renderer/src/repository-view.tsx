import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  GitChange,
  GitFilePreview,
  GitTextPreview,
  GitWorkspaceSnapshot,
} from '../../shared/git-workspace-contracts';
import type { ProjectRecord, UpdateProjectRepositoryInput } from '../../shared/workspace-contracts';
import { MarkdownDocument } from './markdown-document';
import { repositoryTreeRows } from './repository-tree-model';
import type { SearchTargetRequest } from './search-results-model';

type RepositoryTab = 'files' | 'changes' | 'history' | 'branches';

const REPOSITORY_TABS: ReadonlyArray<{ id: RepositoryTab; label: string }> = [
  { id: 'files', label: 'Files' },
  { id: 'changes', label: 'Changes' },
  { id: 'history', label: 'History' },
  { id: 'branches', label: 'Branches' },
];

function gitErrorMessage(error: unknown) {
  const code = error instanceof Error ? (error.message.split(':')[0] ?? '') : '';
  const messages: Record<string, string> = {
    repository_identifier_required: 'Enter a GitHub repository as owner/repository first.',
    repository_not_cloned: 'Clone the repository before opening its files.',
    repository_already_cloned: 'This project already has a local Git workspace.',
    repository_root_changed:
      'The local repository no longer matches this project. GOSU stopped before reading it.',
    repository_unsafe:
      'This repository enables a Git hook, filter, or external command. GOSU stopped before reading or changing it.',
    git_unavailable:
      'Git is not available on this Mac. Install Apple Command Line Tools, then retry.',
    git_auth_required:
      'GitHub authentication is required. Sign in through your Mac Git credential helper, then retry.',
    git_dirty_worktree: 'Commit or stage the current changes before switching branches or pulling.',
    git_head_changed:
      'The branch changed since this screen loaded. Refresh and review before retrying.',
    git_index_changed:
      'The staged changes changed since this screen loaded. Refresh and review the exact commit again.',
    git_detached_head: 'Switch to a named branch before creating a commit.',
    git_no_commits: 'Create the first commit before using this Git operation.',
    git_no_remote: 'A safe GitHub origin remote was not found.',
    git_no_upstream: 'The current branch does not have an origin upstream yet. Push it first.',
    git_nothing_to_commit: 'Stage at least one changed file before committing.',
    git_identity_required:
      'Set your Git user.name and user.email, then retry the commit. GOSU reads them only for commit authorship.',
    git_commit_not_available:
      'That object is not a commit in the current branch history. Refresh History and select a listed commit.',
    git_branch_exists: 'That branch already exists.',
    git_branch_not_found: 'That local branch is no longer available.',
    git_conflict:
      'Git stopped because the operation would conflict. No automatic merge was attempted.',
    git_path_blocked:
      'GOSU blocked this file path because it is missing, linked, or outside the repository.',
    git_file_too_large: 'This file is too large for the bounded in-app preview.',
    git_binary_file: 'Binary files are listed but their contents are not returned to the app.',
    git_output_too_large: 'The requested Git output is too large for the safe preview limit.',
    invalid_git_workspace_input: 'The Git request was invalid. Refresh and try again.',
  };
  return (
    messages[code] ??
    'The Git operation could not be completed. Your repository was not reset or cleaned.'
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function changeLabel(change: GitChange, staged: boolean) {
  const code =
    (staged ? change.indexStatus : change.indexStatus === '?' ? '?' : change.worktreeStatus) ?? '';
  return (
    {
      M: 'Modified',
      A: 'Added',
      D: 'Deleted',
      R: 'Renamed',
      C: 'Copied',
      U: 'Conflict',
      '?': 'Untracked',
    }[code] ?? 'Changed'
  );
}

function changePathLabel(change: GitChange, staged: boolean) {
  const renamed = staged ? change.indexStatus === 'R' : change.worktreeStatus === 'R';
  return renamed && change.originalPath ? `${change.originalPath} → ${change.path}` : change.path;
}

export function repositoryParentDirectories(path: string) {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

export function RepositoryView({
  project,
  onUpdateRepository,
  searchTarget = null,
  onSearchTargetHandled = () => undefined,
}: {
  project: ProjectRecord;
  onUpdateRepository: (input: UpdateProjectRepositoryInput) => Promise<boolean>;
  searchTarget?: SearchTargetRequest | null;
  onSearchTargetHandled?: (requestId: number) => void;
}) {
  const [snapshot, setSnapshot] = useState<GitWorkspaceSnapshot | null>(null);
  const [tab, setTab] = useState<RepositoryTab>('files');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [repositoryDraft, setRepositoryDraft] = useState(project.repository ?? '');
  const [search, setSearch] = useState('');
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState('');
  const [filePreview, setFilePreview] = useState<GitFilePreview | null>(null);
  const [diffPreview, setDiffPreview] = useState<GitTextPreview | null>(null);
  const [selectedChange, setSelectedChange] = useState<{
    path: string;
    label: string;
    staged: boolean;
  } | null>(null);
  const [selectedCommit, setSelectedCommit] = useState('');
  const [commitPreview, setCommitPreview] = useState<GitTextPreview | null>(null);
  const [commitSummary, setCommitSummary] = useState('');
  const [commitDescription, setCommitDescription] = useState('');
  const [branchDraft, setBranchDraft] = useState('');
  const [reviewedIndexFingerprint, setReviewedIndexFingerprint] = useState('');
  const [reviewedStagedPaths, setReviewedStagedPaths] = useState<ReadonlySet<string>>(new Set());
  const [pendingSearchFocus, setPendingSearchFocus] = useState<SearchTargetRequest | null>(null);
  const fileElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const fileReadGenerationRef = useRef(0);

  const state = snapshot?.state;
  const rows = useMemo(
    () => repositoryTreeRows(state?.files ?? [], expandedDirectories, search),
    [expandedDirectories, search, state?.files],
  );

  const acceptSnapshot = (next: GitWorkspaceSnapshot) => {
    if (snapshot?.state?.indexFingerprint !== next.state?.indexFingerprint) {
      setSelectedChange(null);
      setDiffPreview(null);
      setReviewedIndexFingerprint('');
      setReviewedStagedPaths(new Set());
    }
    setSnapshot(next);
  };

  const load = async () => {
    const next = await window.gosu.gitWorkspace.snapshot(project.id);
    acceptSnapshot(next);
    return next;
  };

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    fileReadGenerationRef.current += 1;
    setError('');
    setNotice('');
    setSelectedFile('');
    setFilePreview(null);
    setSelectedChange(null);
    setDiffPreview(null);
    setSelectedCommit('');
    setCommitPreview(null);
    setReviewedIndexFingerprint('');
    setReviewedStagedPaths(new Set());
    setRepositoryDraft(project.repository ?? '');
    void window.gosu.gitWorkspace
      .snapshot(project.id)
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(gitErrorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [project.id, project.repository]);

  const run = async (
    label: string,
    operation: () => Promise<GitWorkspaceSnapshot>,
    success: string,
  ) => {
    if (busy) return;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      const next = await operation();
      acceptSnapshot(next);
      setNotice(success);
      return true;
    } catch (reason) {
      setError(gitErrorMessage(reason));
      await load().catch(() => undefined);
      return false;
    } finally {
      setBusy('');
    }
  };

  const selectFile = useCallback(
    async (path: string) => {
      const generation = ++fileReadGenerationRef.current;
      setSelectedFile(path);
      setFilePreview(null);
      setError('');
      try {
        const preview = await window.gosu.gitWorkspace.readFile({ projectId: project.id, path });
        if (fileReadGenerationRef.current === generation) setFilePreview(preview);
      } catch (reason) {
        if (fileReadGenerationRef.current === generation) setError(gitErrorMessage(reason));
      }
    },
    [project.id],
  );

  useEffect(() => {
    if (!searchTarget || !state) return;
    const file = state.files.find(
      ({ kind, path }) => kind === 'file' && path === searchTarget.targetId,
    );
    if (!file) {
      setError(
        'The searched repository file is no longer available. Refresh Search and try again.',
      );
      onSearchTargetHandled(searchTarget.requestId);
      return;
    }
    setTab('files');
    setSearch('');
    setExpandedDirectories(
      (current) => new Set([...current, ...repositoryParentDirectories(file.path)]),
    );
    setPendingSearchFocus(searchTarget);
    void selectFile(file.path);
  }, [onSearchTargetHandled, searchTarget, selectFile, state]);

  useLayoutEffect(() => {
    if (!pendingSearchFocus) return;
    const element = fileElementsRef.current.get(pendingSearchFocus.targetId);
    if (!element) return;
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    element.focus({ preventScroll: true });
    onSearchTargetHandled(pendingSearchFocus.requestId);
    setPendingSearchFocus(null);
  }, [onSearchTargetHandled, pendingSearchFocus, rows, tab]);

  const selectChange = async (change: GitChange, staged: boolean) => {
    const path = change.path;
    setSelectedChange({ path, label: changePathLabel(change, staged), staged });
    setDiffPreview(null);
    setError('');
    try {
      const preview = await window.gosu.gitWorkspace.diff({ projectId: project.id, path, staged });
      setDiffPreview(preview);
      if (staged && state) {
        setReviewedStagedPaths((current) =>
          reviewedIndexFingerprint === state.indexFingerprint
            ? new Set([...current, path])
            : new Set([path]),
        );
        setReviewedIndexFingerprint(state.indexFingerprint);
      }
    } catch (reason) {
      setError(gitErrorMessage(reason));
    }
  };

  const selectCommit = async (sha: string) => {
    setSelectedCommit(sha);
    setCommitPreview(null);
    setError('');
    try {
      setCommitPreview(await window.gosu.gitWorkspace.commitDetail(project.id, sha));
    } catch (reason) {
      setError(gitErrorMessage(reason));
    }
  };

  if (!snapshot && !error) {
    return <div className="loading-state">Reading the project repository…</div>;
  }

  if (!snapshot) {
    return (
      <section className="repository-onboarding card">
        <span className="eyebrow">REPOSITORY UNAVAILABLE</span>
        <h2>GOSU stopped before opening this working copy</h2>
        <div className="notice error" role="alert">
          {error}
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setError('');
            void load().catch((reason: unknown) => setError(gitErrorMessage(reason)));
          }}
        >
          Retry safely
        </button>
      </section>
    );
  }

  if (!snapshot.repository) {
    return (
      <section className="repository-onboarding card">
        <span className="eyebrow">GITHUB REPOSITORY</span>
        <h2>Connect this project to its code and manuscript files</h2>
        <p>
          Enter only an owner/repository identifier. Tokens, SSH addresses, and repository contents
          never enter Hosted Sync.
        </p>
        {error && <div className="notice error">{error}</div>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const repository = repositoryDraft.trim();
            if (!repository || busy) return;
            setBusy('repository');
            setError('');
            void onUpdateRepository({
              projectId: project.id,
              expectedVersion: project.version,
              repository,
            })
              .then((succeeded) => {
                if (succeeded) setNotice('Saved the GitHub repository for this project.');
              })
              .finally(() => setBusy(''));
          }}
        >
          <label>
            GitHub repository
            <input
              value={repositoryDraft}
              onChange={(event) => setRepositoryDraft(event.target.value)}
              placeholder="owner/repository"
              pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"
              required
              disabled={Boolean(busy)}
            />
          </label>
          <button type="submit" className="primary-button" disabled={Boolean(busy)}>
            Save connection
          </button>
        </form>
      </section>
    );
  }

  if (!snapshot.cloned || !state) {
    return (
      <section className="repository-onboarding card">
        <span className="eyebrow">{snapshot.repository}</span>
        <h2>Clone a protected local working copy</h2>
        <p>
          GOSU keeps this clone on your Mac, separate from Project Chat scratch space. GitHub
          credentials remain with your Mac Git credential helper.
        </p>
        {error && <div className="notice error">{error}</div>}
        {notice && <div className="notice success">{notice}</div>}
        <div className="repository-onboarding-actions">
          <button
            type="button"
            className="primary-button"
            disabled={Boolean(busy)}
            onClick={() =>
              void run(
                'clone',
                () => window.gosu.gitWorkspace.clone(project.id),
                'Cloned the repository into this project workspace.',
              )
            }
          >
            {busy === 'clone' ? 'Cloning…' : 'Clone from GitHub'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void window.gosu.openExternal(`https://github.com/${snapshot.repository}`)
            }
          >
            Open on GitHub
          </button>
        </div>
        <details className="repository-change-connection">
          <summary>Change repository before cloning</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const repository = repositoryDraft.trim();
              if (!repository || repository === snapshot.repository || busy) return;
              setBusy('repository');
              setError('');
              void onUpdateRepository({
                projectId: project.id,
                expectedVersion: project.version,
                repository,
              }).finally(() => setBusy(''));
            }}
          >
            <label>
              GitHub repository
              <input
                value={repositoryDraft}
                onChange={(event) => setRepositoryDraft(event.target.value)}
                placeholder="owner/repository"
                pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"
                required
                disabled={Boolean(busy)}
              />
            </label>
            <button
              type="submit"
              className="secondary-button"
              disabled={
                Boolean(busy) ||
                !repositoryDraft.trim() ||
                repositoryDraft.trim() === snapshot.repository
              }
            >
              Update connection
            </button>
          </form>
        </details>
      </section>
    );
  }

  const stagedChanges = state.changes.filter((change) => change.staged);
  const unstagedChanges = state.changes.filter((change) => change.unstaged);
  const stagedPatchReviewed =
    reviewedIndexFingerprint === state.indexFingerprint &&
    stagedChanges.every((change) => reviewedStagedPaths.has(change.path));
  const headCommand = {
    projectId: project.id,
    expectedHead: state.headSha,
    expectedBranch: state.currentBranch,
  };

  return (
    <section className="repository-workspace">
      <header className="repository-toolbar card">
        <div className="repository-identity">
          <span className="eyebrow">{state.repository}</span>
          <strong>{state.currentBranch ?? 'Detached HEAD'}</strong>
          <code>{state.headSha?.slice(0, 8) ?? 'No commits'}</code>
          {state.dirty && <span className="repository-dirty">Uncommitted changes</span>}
          <span>↑ {state.ahead}</span>
          <span>↓ {state.behind}</span>
        </div>
        <div className="repository-toolbar-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={Boolean(busy)}
            onClick={() =>
              void load().catch((reason: unknown) => setError(gitErrorMessage(reason)))
            }
          >
            Refresh
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() =>
              void run(
                'fetch',
                () => window.gosu.gitWorkspace.fetch(headCommand),
                'Fetched the latest GitHub branch information.',
              )
            }
          >
            {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(busy) || state.dirty || !state.upstream || state.detachedHead}
            onClick={() => {
              if (
                !window.confirm(
                  `Pull fast-forward updates into ${state.currentBranch}? GOSU will not merge or rebase.`,
                )
              )
                return;
              void run(
                'pull',
                () => window.gosu.gitWorkspace.pull(headCommand),
                'Fast-forwarded the current branch.',
              );
            }}
          >
            {busy === 'pull' ? 'Pulling…' : 'Pull'}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={Boolean(busy) || state.detachedHead || state.headSha === null}
            onClick={() => {
              if (
                !window.confirm(`Push ${state.currentBranch} to origin? Force push is never used.`)
              )
                return;
              void run(
                'push',
                () => window.gosu.gitWorkspace.push(headCommand),
                'Pushed the current branch to GitHub.',
              );
            }}
          >
            {busy === 'push' ? 'Pushing…' : 'Push'}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void window.gosu.gitWorkspace.reveal(project.id)}
          >
            Finder
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void window.gosu.openExternal(state.githubUrl)}
          >
            GitHub ↗
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div className={`notice ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>
          {error || notice}
        </div>
      )}

      <nav className="repository-tabs" aria-label="Repository views">
        {REPOSITORY_TABS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'changes' && <em>{state.changes.length}</em>}
          </button>
        ))}
      </nav>

      {tab === 'files' && (
        <div className="repository-split card">
          <aside className="repository-browser">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search files"
              aria-label="Search repository files"
            />
            <div className="repository-tree" role="tree">
              {rows.map((row) => {
                const directory = row.kind === 'directory';
                const expanded = expandedDirectories.has(row.path);
                return (
                  <button
                    ref={(element) => {
                      if (element) fileElementsRef.current.set(row.path, element);
                      else fileElementsRef.current.delete(row.path);
                    }}
                    type="button"
                    role="treeitem"
                    key={`${row.kind}:${row.path}`}
                    className={`${selectedFile === row.path ? 'selected' : ''}${pendingSearchFocus?.targetId === row.path ? ' search-target' : ''}`}
                    style={{ paddingInlineStart: `${14 + row.depth * 16}px` }}
                    onClick={() => {
                      if (directory) {
                        const next = new Set(expandedDirectories);
                        if (expanded) next.delete(row.path);
                        else next.add(row.path);
                        setExpandedDirectories(next);
                      } else if (row.kind === 'file') {
                        void selectFile(row.path);
                      }
                    }}
                    disabled={!directory && row.kind !== 'file'}
                    title={row.path}
                  >
                    <span>
                      {directory
                        ? expanded
                          ? '▾'
                          : '▸'
                        : row.kind === 'symlink'
                          ? '↗'
                          : row.kind === 'submodule'
                            ? '▣'
                            : '·'}
                    </span>
                    {row.name}
                  </button>
                );
              })}
            </div>
            {state.filesTruncated && <small>Showing the first 5,000 files.</small>}
          </aside>
          <article className="repository-preview">
            {!selectedFile ? (
              <div className="repository-placeholder">
                Choose a text or Markdown file to preview it.
              </div>
            ) : !filePreview ? (
              <div className="repository-placeholder">Opening {selectedFile}…</div>
            ) : (
              <>
                <header>
                  <strong>{filePreview.path}</strong>
                  <span>
                    {filePreview.sizeBytes.toLocaleString()} bytes
                    {filePreview.truncated ? ' · preview truncated' : ''}
                  </span>
                </header>
                {filePreview.renderMode === 'markdown' ? (
                  <MarkdownDocument
                    notePath={filePreview.path}
                    source={filePreview.content}
                    vaultFiles={state.files
                      .filter((file) => file.kind === 'file')
                      .map((file) => file.path)}
                    onOpenNote={(path) => void selectFile(path)}
                    loadVaultImages={false}
                  />
                ) : (
                  <pre>{filePreview.content}</pre>
                )}
              </>
            )}
          </article>
        </div>
      )}

      {tab === 'changes' && (
        <div className="repository-change-layout">
          <aside className="card repository-change-list">
            <ChangeGroup
              title="Staged changes"
              changes={stagedChanges}
              staged
              onSelect={selectChange}
              onMove={(paths) =>
                void run(
                  'unstage',
                  () => window.gosu.gitWorkspace.unstage({ ...headCommand, paths: [...paths] }),
                  'Moved the selected files out of the next commit.',
                )
              }
              busy={Boolean(busy)}
            />
            <ChangeGroup
              title="Unstaged changes"
              changes={unstagedChanges}
              staged={false}
              onSelect={selectChange}
              onMove={(paths) =>
                void run(
                  'stage',
                  () => window.gosu.gitWorkspace.stage({ ...headCommand, paths: [...paths] }),
                  'Staged the selected files for the next commit.',
                )
              }
              busy={Boolean(busy)}
            />
            <form
              className="repository-commit-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!commitSummary.trim()) return;
                void run(
                  'commit',
                  () =>
                    window.gosu.gitWorkspace.commit({
                      ...headCommand,
                      expectedIndexFingerprint: state.indexFingerprint,
                      summary: commitSummary,
                      ...(commitDescription.trim() ? { description: commitDescription } : {}),
                    }),
                  `Committed the staged changes to ${state.currentBranch ?? 'HEAD'}.`,
                ).then((succeeded) => {
                  if (succeeded) {
                    setCommitSummary('');
                    setCommitDescription('');
                    setDiffPreview(null);
                    setSelectedChange(null);
                    setReviewedIndexFingerprint('');
                    setReviewedStagedPaths(new Set());
                  }
                });
              }}
            >
              <label>
                Commit summary
                <input
                  value={commitSummary}
                  onChange={(event) => setCommitSummary(event.target.value)}
                  maxLength={120}
                  placeholder="Describe this research change"
                  disabled={Boolean(busy)}
                />
              </label>
              <label>
                Description <span>optional</span>
                <textarea
                  value={commitDescription}
                  onChange={(event) => setCommitDescription(event.target.value)}
                  maxLength={4000}
                  rows={3}
                  disabled={Boolean(busy)}
                />
              </label>
              <button
                type="submit"
                className="primary-button"
                disabled={
                  Boolean(busy) ||
                  stagedChanges.length === 0 ||
                  !stagedPatchReviewed ||
                  !commitSummary.trim()
                }
              >
                {busy === 'commit' ? 'Committing…' : `Commit to ${state.currentBranch ?? 'HEAD'}`}
              </button>
              {!stagedPatchReviewed && stagedChanges.length > 0 && (
                <small>
                  Open every staged file above to review the exact patch before committing.
                </small>
              )}
            </form>
          </aside>
          <article className="card repository-diff-preview">
            <header>
              <strong>{selectedChange?.label ?? 'Change preview'}</strong>
              <span>
                {selectedChange
                  ? selectedChange.staged
                    ? 'Staged'
                    : 'Working tree'
                  : 'Select a changed file'}
              </span>
            </header>
            <pre>
              {diffPreview?.content ||
                (selectedChange
                  ? 'No textual diff is available. Open the file from Files for its current contents.'
                  : '')}
            </pre>
          </article>
        </div>
      )}

      {tab === 'history' && (
        <div className="repository-split card">
          <aside className="repository-history-list">
            {state.commits.map((commit) => (
              <button
                type="button"
                key={commit.sha}
                className={selectedCommit === commit.sha ? 'selected' : ''}
                onClick={() => void selectCommit(commit.sha)}
              >
                <strong>{commit.subject}</strong>
                <span>
                  {commit.authorName} · {formatDate(commit.authoredAt)}
                </span>
                <code>{commit.shortSha}</code>
              </button>
            ))}
            {state.historyTruncated && <small>Showing the latest 100 commits.</small>}
          </aside>
          <article className="repository-preview repository-commit-preview">
            <pre>
              {commitPreview?.content ||
                (selectedCommit
                  ? 'Loading commit…'
                  : 'Choose a commit to inspect its metadata, files, and patch.')}
            </pre>
          </article>
        </div>
      )}

      {tab === 'branches' && (
        <div className="repository-branches-layout">
          <form
            className="card repository-branch-form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = branchDraft.trim();
              if (!name) return;
              void run(
                'create-branch',
                () => window.gosu.gitWorkspace.createBranch({ ...headCommand, name }),
                `Created ${name} at the current commit.`,
              ).then((succeeded) => succeeded && setBranchDraft(''));
            }}
          >
            <span className="eyebrow">NEW LOCAL BRANCH</span>
            <label>
              Branch name
              <input
                value={branchDraft}
                onChange={(event) => setBranchDraft(event.target.value)}
                placeholder="experiment/baseline"
                maxLength={200}
                disabled={Boolean(busy)}
              />
            </label>
            <button
              type="submit"
              className="primary-button"
              disabled={Boolean(busy) || !branchDraft.trim() || state.headSha === null}
            >
              Create branch
            </button>
          </form>
          <div className="card repository-branch-list">
            {state.branches.map((branch) => (
              <section key={branch.name} className={branch.current ? 'current' : ''}>
                <div>
                  <strong>{branch.name}</strong>
                  {branch.current && <em>Current</em>}
                  <span>
                    {branch.upstream ?? 'Not published'} · ↑ {branch.ahead} ↓ {branch.behind}
                  </span>
                  <small>
                    {branch.lastCommitSubject} · {formatDate(branch.lastCommitAt)}
                  </small>
                </div>
                {!branch.current && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={Boolean(busy) || state.dirty}
                    onClick={() => {
                      if (!window.confirm(`Switch the clean working tree to ${branch.name}?`))
                        return;
                      void run(
                        'switch-branch',
                        () =>
                          window.gosu.gitWorkspace.switchBranch({
                            ...headCommand,
                            name: branch.name,
                          }),
                        `Switched to ${branch.name}.`,
                      );
                    }}
                  >
                    Switch
                  </button>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ChangeGroup({
  title,
  changes,
  staged,
  onSelect,
  onMove,
  busy,
}: {
  title: string;
  changes: readonly GitChange[];
  staged: boolean;
  onSelect: (change: GitChange, staged: boolean) => Promise<void>;
  onMove: (paths: readonly string[]) => void;
  busy: boolean;
}) {
  return (
    <section className="repository-change-group">
      <header>
        <strong>{title}</strong>
        <span>{changes.length}</span>
        {changes.length > 0 && (
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={() => onMove(changes.map((change) => change.path))}
          >
            {staged ? 'Unstage all' : 'Stage all'}
          </button>
        )}
      </header>
      {changes.length === 0 ? (
        <p>No files</p>
      ) : (
        changes.map((change) => (
          <div key={`${staged ? 'staged' : 'working'}:${change.path}`}>
            <button
              type="button"
              className="repository-change-file"
              onClick={() => void onSelect(change, staged)}
            >
              <span>{changeLabel(change, staged)}</span>
              <strong>{changePathLabel(change, staged)}</strong>
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => onMove([change.path])}
            >
              {staged ? 'Unstage' : 'Stage'}
            </button>
          </div>
        ))
      )}
    </section>
  );
}
