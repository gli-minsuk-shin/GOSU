import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitChange, GitWorkspaceSnapshot } from '../src/shared/git-workspace-contracts';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const hookState = vi.hoisted(() => ({
  index: 0,
  snapshot: null as unknown,
  tab: 'changes',
  commitSummary: '',
  commitDescription: '',
  reviewedIndexFingerprint: '',
  reviewedStagedPaths: new Set<string>(),
  setters: new Map<number, unknown>(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: () => undefined,
    useMemo: <Value,>(factory: () => Value) => factory(),
    useState: <Value,>(initial: Value) => {
      const index = hookState.index++;
      const overrides = new Map<number, unknown>([
        [0, hookState.snapshot],
        [1, hookState.tab],
        [14, hookState.commitSummary],
        [15, hookState.commitDescription],
        [17, hookState.reviewedIndexFingerprint],
        [18, hookState.reviewedStagedPaths],
      ]);
      const setter = vi.fn();
      hookState.setters.set(index, setter);
      return [overrides.has(index) ? (overrides.get(index) as Value) : initial, setter];
    },
  };
});

import { RepositoryView } from '../src/renderer/src/repository-view';

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Repository project',
  slug: 'repository-project',
  repository: 'gosu/research-os',
  version: 3,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T01:00:00.000Z',
};

const headSha = 'a'.repeat(40);
const indexFingerprint = 'b'.repeat(64);
const snapshot: GitWorkspaceSnapshot = {
  schemaVersion: 1,
  projectId: project.id,
  repository: project.repository ?? null,
  cloned: true,
  state: {
    repository: project.repository ?? '',
    githubUrl: 'https://github.com/gosu/research-os',
    currentBranch: 'main',
    detachedHead: false,
    headSha,
    indexFingerprint,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    dirty: true,
    files: [
      { path: 'paper/new-name.tex', kind: 'file' },
      { path: 'results/metric.json', kind: 'file' },
    ],
    filesTruncated: false,
    changes: [
      {
        path: 'paper/new-name.tex',
        originalPath: 'paper/old-name.tex',
        indexStatus: 'R',
        worktreeStatus: ' ',
        staged: true,
        unstaged: false,
        conflict: false,
      },
      {
        path: 'results/metric.json',
        indexStatus: 'A',
        worktreeStatus: ' ',
        staged: true,
        unstaged: false,
        conflict: false,
      },
    ],
    branches: [],
    commits: [],
    historyTruncated: false,
  },
};

function prepareRender({
  activeSnapshot = snapshot,
  summary = '',
  description = '',
  reviewedFingerprint = '',
  reviewedPaths = new Set<string>(),
}: {
  activeSnapshot?: GitWorkspaceSnapshot;
  summary?: string;
  description?: string;
  reviewedFingerprint?: string;
  reviewedPaths?: ReadonlySet<string>;
} = {}) {
  hookState.index = 0;
  hookState.snapshot = activeSnapshot;
  hookState.tab = 'changes';
  hookState.commitSummary = summary;
  hookState.commitDescription = description;
  hookState.reviewedIndexFingerprint = reviewedFingerprint;
  hookState.reviewedStagedPaths = new Set(reviewedPaths);
  hookState.setters.clear();
}

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement {
  if (isValidElement(node)) {
    if (predicate(node)) return node;
    const props = node.props as { children?: ReactNode };
    return findElement(props.children, predicate);
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return findElement(child as ReactNode, predicate);
      } catch {
        // Keep walking siblings until the requested element is found.
      }
    }
  }
  throw new Error('element_not_found');
}

function stateSetter(index: number) {
  const setter = hookState.setters.get(index) as ReturnType<typeof vi.fn> | undefined;
  if (!setter) throw new Error(`missing_state_setter:${index}`);
  return setter;
}

function commitIsDisabled(html: string) {
  const match = html.match(/<button type="submit" class="primary-button"([^>]*)>/u);
  if (!match) throw new Error('commit_button_not_found');
  return match[1]?.includes('disabled=""') ?? false;
}

beforeEach(() => {
  vi.restoreAllMocks();
  prepareRender();
});

describe('RepositoryView change safety', () => {
  it('shows both the old and new paths for a rename', () => {
    const html = renderToStaticMarkup(
      <RepositoryView project={project} onUpdateRepository={vi.fn()} />,
    );

    expect(html.replaceAll(/<[^>]+>/gu, '')).toContain('paper/old-name.tex → paper/new-name.tex');
  });

  it('commits against the exact index fingerprint from the rendered snapshot', async () => {
    const commit = vi.fn().mockResolvedValue(snapshot);
    vi.stubGlobal('window', {
      gosu: {
        gitWorkspace: { commit },
      },
    });
    prepareRender({
      summary: 'Record reproducible result',
      description: 'Keep the evaluator lineage with the manuscript.',
    });

    const view = RepositoryView({ project, onUpdateRepository: vi.fn() });
    const form = findElement(
      view,
      (element) => (element.props as { className?: string }).className === 'repository-commit-form',
    );
    const preventDefault = vi.fn();
    const { onSubmit } = form.props as {
      onSubmit: (event: { preventDefault: () => void }) => void;
    };

    onSubmit({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(commit).toHaveBeenCalledWith({
        projectId: project.id,
        expectedHead: headSha,
        expectedBranch: 'main',
        expectedIndexFingerprint: indexFingerprint,
        summary: 'Record reproducible result',
        description: 'Keep the evaluator lineage with the manuscript.',
      }),
    );
  });

  it('requires every staged diff to be reviewed for the current index and clears review after unstage changes it', async () => {
    const diff = vi.fn().mockResolvedValue({ content: 'reviewed patch', truncated: false });
    const changedIndexSnapshot: GitWorkspaceSnapshot = {
      ...snapshot,
      state: {
        ...snapshot.state!,
        indexFingerprint: 'c'.repeat(64),
        changes: snapshot.state!.changes.slice(1),
      },
    };
    const unstage = vi.fn().mockResolvedValue(changedIndexSnapshot);
    vi.stubGlobal('window', {
      gosu: {
        gitWorkspace: { diff, unstage },
      },
    });

    prepareRender({ summary: 'Commit reviewed patches' });
    let html = renderToStaticMarkup(
      <RepositoryView project={project} onUpdateRepository={vi.fn()} />,
    );
    expect(commitIsDisabled(html)).toBe(true);
    expect(html).toContain('Open every staged file above');

    prepareRender({ summary: 'Commit reviewed patches' });
    let view = RepositoryView({ project, onUpdateRepository: vi.fn() });
    let stagedGroup = findElement(
      view,
      (element) => (element.props as { title?: string }).title === 'Staged changes',
    );
    let groupProps = stagedGroup.props as {
      changes: readonly GitChange[];
      onSelect: (change: GitChange, staged: boolean) => Promise<void>;
      onMove: (paths: readonly string[]) => void;
    };
    await groupProps.onSelect(groupProps.changes[0]!, true);
    expect(diff).toHaveBeenLastCalledWith({
      projectId: project.id,
      path: 'paper/new-name.tex',
      staged: true,
    });
    expect(stateSetter(17)).toHaveBeenLastCalledWith(indexFingerprint);
    let reviewUpdater = stateSetter(18).mock.calls.at(-1)?.[0] as (
      current: ReadonlySet<string>,
    ) => ReadonlySet<string>;
    const firstReviewedPaths = reviewUpdater(new Set());
    expect([...firstReviewedPaths]).toEqual(['paper/new-name.tex']);

    prepareRender({
      summary: 'Commit reviewed patches',
      reviewedFingerprint: indexFingerprint,
      reviewedPaths: firstReviewedPaths,
    });
    html = renderToStaticMarkup(<RepositoryView project={project} onUpdateRepository={vi.fn()} />);
    expect(commitIsDisabled(html)).toBe(true);

    prepareRender({
      summary: 'Commit reviewed patches',
      reviewedFingerprint: indexFingerprint,
      reviewedPaths: firstReviewedPaths,
    });
    view = RepositoryView({ project, onUpdateRepository: vi.fn() });
    stagedGroup = findElement(
      view,
      (element) => (element.props as { title?: string }).title === 'Staged changes',
    );
    groupProps = stagedGroup.props as typeof groupProps;
    await groupProps.onSelect(groupProps.changes[1]!, true);
    reviewUpdater = stateSetter(18).mock.calls.at(-1)?.[0] as (
      current: ReadonlySet<string>,
    ) => ReadonlySet<string>;
    const allReviewedPaths = reviewUpdater(firstReviewedPaths);
    expect([...allReviewedPaths]).toEqual(['paper/new-name.tex', 'results/metric.json']);

    prepareRender({
      summary: 'Commit reviewed patches',
      reviewedFingerprint: indexFingerprint,
      reviewedPaths: allReviewedPaths,
    });
    html = renderToStaticMarkup(<RepositoryView project={project} onUpdateRepository={vi.fn()} />);
    expect(commitIsDisabled(html)).toBe(false);
    expect(html).not.toContain('Open every staged file above');

    prepareRender({
      summary: 'Commit reviewed patches',
      reviewedFingerprint: indexFingerprint,
      reviewedPaths: allReviewedPaths,
    });
    view = RepositoryView({ project, onUpdateRepository: vi.fn() });
    stagedGroup = findElement(
      view,
      (element) => (element.props as { title?: string }).title === 'Staged changes',
    );
    groupProps = stagedGroup.props as typeof groupProps;
    groupProps.onMove(['paper/new-name.tex']);

    await vi.waitFor(() =>
      expect(unstage).toHaveBeenCalledWith({
        projectId: project.id,
        expectedHead: headSha,
        expectedBranch: 'main',
        paths: ['paper/new-name.tex'],
      }),
    );
    await vi.waitFor(() => expect(stateSetter(17)).toHaveBeenCalledWith(''));
    const clearedPaths = stateSetter(18).mock.calls.find(
      ([value]) => value instanceof Set && value.size === 0,
    )?.[0] as ReadonlySet<string> | undefined;
    expect(clearedPaths).toEqual(new Set());
  });
});
