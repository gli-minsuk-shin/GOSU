import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerGitWorkspaceIpc } from '../src/main/git-workspace-ipc';
import {
  GitWorkspaceServiceError,
  type GitWorkspaceService,
} from '../src/main/git-workspace-service';
import { GIT_WORKSPACE_IPC_CHANNELS } from '../src/shared/git-workspace-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function registerFixture(
  service: Partial<GitWorkspaceService>,
  platform: Readonly<{ reveal(path: string): Promise<void> | void }> = { reveal: vi.fn() },
  reportUnexpected = vi.fn(),
) {
  const handlers = new Map<string, Handler>();
  registerGitWorkspaceIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as GitWorkspaceService,
    platform,
    reportUnexpected,
  );
  return { handlers, platform, reportUnexpected };
}

describe('Git Workspace IPC', () => {
  it('registers only the fixed, typed Git command surface', () => {
    const { handlers } = registerFixture({});

    expect([...handlers.keys()].sort()).toEqual(Object.values(GIT_WORKSPACE_IPC_CHANNELS).sort());
    expect([...handlers.keys()]).not.toContain('gosu:git-workspace:run');
    expect([...handlers.keys()]).not.toContain('gosu:shell:exec');
  });

  it('rejects traversal paths, option-like branches, and abbreviated object IDs before service use', async () => {
    const readFile = vi.fn();
    const switchBranch = vi.fn();
    const commitDetail = vi.fn();
    const { handlers } = registerFixture({ readFile, switchBranch, commitDetail });
    const projectId = randomUUID();
    const expectedHead = 'a'.repeat(40);

    await expect(
      handlers.get(GIT_WORKSPACE_IPC_CHANNELS.readFile)?.({ projectId, path: '../private.key' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_git_workspace_input' } });
    await expect(
      handlers.get(GIT_WORKSPACE_IPC_CHANNELS.switchBranch)?.({
        projectId,
        expectedHead,
        expectedBranch: 'main',
        name: '--detach',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_git_workspace_input' } });
    await expect(
      handlers.get(GIT_WORKSPACE_IPC_CHANNELS.commitDetail)?.({
        projectId,
        commitSha: 'deadbeef',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_git_workspace_input' } });

    expect(readFile).not.toHaveBeenCalled();
    expect(switchBranch).not.toHaveBeenCalled();
    expect(commitDetail).not.toHaveBeenCalled();
  });

  it('routes validated commands without adding renderer-controlled arguments', async () => {
    const projectId = randomUUID();
    const expectedHead = 'b'.repeat(40);
    const expectedBranch = 'main';
    const snapshotValue = {
      schemaVersion: 1 as const,
      projectId,
      repository: 'gosu/research',
      cloned: false,
    };
    const snapshot = vi.fn(async () => snapshotValue);
    const readFile = vi.fn(async () => ({
      path: 'docs/paper.md',
      sizeBytes: 7,
      renderMode: 'markdown' as const,
      content: '# Paper',
      truncated: false,
    }));
    const stage = vi.fn(async () => snapshotValue);
    const fetch = vi.fn(async () => snapshotValue);
    const { handlers } = registerFixture({ snapshot, readFile, stage, fetch });

    await expect(
      handlers.get(GIT_WORKSPACE_IPC_CHANNELS.snapshot)?.({ projectId }),
    ).resolves.toEqual({ ok: true, value: snapshotValue });
    await expect(
      handlers.get(GIT_WORKSPACE_IPC_CHANNELS.readFile)?.({
        projectId,
        path: 'docs/paper.md',
      }),
    ).resolves.toMatchObject({ ok: true, value: { content: '# Paper' } });
    await expect(
      handlers.get(GIT_WORKSPACE_IPC_CHANNELS.stage)?.({
        projectId,
        expectedHead,
        expectedBranch,
        paths: ['docs/paper.md'],
      }),
    ).resolves.toEqual({ ok: true, value: snapshotValue });
    await expect(
      handlers.get(GIT_WORKSPACE_IPC_CHANNELS.fetch)?.({
        projectId,
        expectedHead,
        expectedBranch,
      }),
    ).resolves.toEqual({ ok: true, value: snapshotValue });

    expect(snapshot).toHaveBeenCalledExactlyOnceWith(projectId);
    expect(readFile).toHaveBeenCalledExactlyOnceWith({ projectId, path: 'docs/paper.md' });
    expect(stage).toHaveBeenCalledExactlyOnceWith({
      projectId,
      expectedHead,
      expectedBranch,
      paths: ['docs/paper.md'],
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith({ projectId, expectedHead, expectedBranch });
  });

  it('preserves only the bounded optimistic-head detail from service errors', async () => {
    const currentHead = 'c'.repeat(40);
    const fetch = vi.fn(async () => {
      throw new GitWorkspaceServiceError('git_head_changed', { currentHead });
    });
    const { handlers, reportUnexpected } = registerFixture({ fetch });

    const result = await handlers.get(GIT_WORKSPACE_IPC_CHANNELS.fetch)?.({
      projectId: randomUUID(),
      expectedHead: 'd'.repeat(40),
      expectedBranch: 'main',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'git_head_changed', currentHead },
    });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it('maps unexpected failures to a generic result without reflecting private diagnostics', async () => {
    const diff = vi.fn(async () => {
      throw new Error('private-path:/Users/researcher/secret-dataset');
    });
    const { handlers, reportUnexpected } = registerFixture({ diff });

    const result = await handlers.get(GIT_WORKSPACE_IPC_CHANNELS.diff)?.({
      projectId: randomUUID(),
      path: 'paper.tex',
      staged: false,
    });

    expect(result).toEqual({ ok: false, error: { code: 'git_workspace_unavailable' } });
    expect(JSON.stringify(result)).not.toContain('secret-dataset');
    expect(reportUnexpected).toHaveBeenCalledOnce();
  });

  it('reveals only the validated app-owned path returned by the service', async () => {
    const projectId = randomUUID();
    const revealPath = vi.fn(async () => `/fixture/git-workspaces/${projectId}`);
    const reveal = vi.fn(async () => undefined);
    const { handlers } = registerFixture({ revealPath }, { reveal });

    await expect(handlers.get(GIT_WORKSPACE_IPC_CHANNELS.reveal)?.({ projectId })).resolves.toEqual(
      { ok: true, value: { revealed: true } },
    );
    expect(revealPath).toHaveBeenCalledExactlyOnceWith(projectId);
    expect(reveal).toHaveBeenCalledExactlyOnceWith(`/fixture/git-workspaces/${projectId}`);
  });
});
