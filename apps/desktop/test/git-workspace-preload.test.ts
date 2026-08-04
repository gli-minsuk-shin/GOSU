import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { GIT_WORKSPACE_IPC_CHANNELS } from '../src/shared/git-workspace-channels';

const electron = vi.hoisted(() => {
  const exposed: unknown[][] = [];
  return {
    exposed,
    contextBridge: {
      exposeInMainWorld: vi.fn((...arguments_: unknown[]) => exposed.push(arguments_)),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
}));

let api: GosuDesktopApi;

beforeAll(async () => {
  await import('../src/preload/index');
  api = electron.exposed[0]?.[1] as GosuDesktopApi;
});

beforeEach(() => {
  electron.ipcRenderer.invoke.mockReset();
});

describe('Git Workspace preload bridge', () => {
  it('exposes a fixed Git API without generic invoke or command escape hatches', () => {
    expect(Object.keys(api.gitWorkspace)).toEqual([
      'snapshot',
      'clone',
      'readFile',
      'diff',
      'commitDetail',
      'stage',
      'unstage',
      'commit',
      'createBranch',
      'switchBranch',
      'fetch',
      'pull',
      'push',
      'reveal',
    ]);
    expect(api.gitWorkspace).not.toHaveProperty('run');
    expect(api.gitWorkspace).not.toHaveProperty('exec');
    expect(api.gitWorkspace).not.toHaveProperty('invoke');
  });

  it('translates renderer calls into the exact fixed IPC channels and payloads', async () => {
    const projectId = '994495b1-38fb-4a01-917d-63583e6a0e23';
    const expectedHead = 'a'.repeat(40);
    const expectedBranch = 'main';
    const commitSha = 'b'.repeat(40);
    const responses = Array.from({ length: 14 }, (_, index) => ({ call: index + 1 }));
    for (const value of responses) {
      electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true, value });
    }

    await api.gitWorkspace.snapshot(projectId);
    await api.gitWorkspace.clone(projectId);
    await api.gitWorkspace.readFile({ projectId, path: 'docs/paper.md' });
    await api.gitWorkspace.diff({ projectId, path: 'paper.tex', staged: false });
    await api.gitWorkspace.commitDetail(projectId, commitSha);
    await api.gitWorkspace.stage({
      projectId,
      expectedHead,
      expectedBranch,
      paths: ['paper.tex'],
    });
    await api.gitWorkspace.unstage({
      projectId,
      expectedHead,
      expectedBranch,
      paths: ['paper.tex'],
    });
    await api.gitWorkspace.commit({
      projectId,
      expectedHead,
      expectedBranch,
      expectedIndexFingerprint: 'f'.repeat(64),
      summary: 'Update paper',
      description: 'Verified evidence only.',
    });
    await api.gitWorkspace.createBranch({
      projectId,
      expectedHead,
      expectedBranch,
      name: 'paper/revision',
    });
    await api.gitWorkspace.switchBranch({
      projectId,
      expectedHead,
      expectedBranch,
      name: 'main',
    });
    await api.gitWorkspace.fetch({ projectId, expectedHead, expectedBranch });
    await api.gitWorkspace.pull({ projectId, expectedHead, expectedBranch });
    await api.gitWorkspace.push({ projectId, expectedHead, expectedBranch });
    await api.gitWorkspace.reveal(projectId);

    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      [GIT_WORKSPACE_IPC_CHANNELS.snapshot, { projectId }],
      [GIT_WORKSPACE_IPC_CHANNELS.clone, { projectId }],
      [GIT_WORKSPACE_IPC_CHANNELS.readFile, { projectId, path: 'docs/paper.md' }],
      [GIT_WORKSPACE_IPC_CHANNELS.diff, { projectId, path: 'paper.tex', staged: false }],
      [GIT_WORKSPACE_IPC_CHANNELS.commitDetail, { projectId, commitSha }],
      [
        GIT_WORKSPACE_IPC_CHANNELS.stage,
        { projectId, expectedHead, expectedBranch, paths: ['paper.tex'] },
      ],
      [
        GIT_WORKSPACE_IPC_CHANNELS.unstage,
        { projectId, expectedHead, expectedBranch, paths: ['paper.tex'] },
      ],
      [
        GIT_WORKSPACE_IPC_CHANNELS.commit,
        {
          projectId,
          expectedHead,
          expectedBranch,
          expectedIndexFingerprint: 'f'.repeat(64),
          summary: 'Update paper',
          description: 'Verified evidence only.',
        },
      ],
      [
        GIT_WORKSPACE_IPC_CHANNELS.createBranch,
        { projectId, expectedHead, expectedBranch, name: 'paper/revision' },
      ],
      [
        GIT_WORKSPACE_IPC_CHANNELS.switchBranch,
        { projectId, expectedHead, expectedBranch, name: 'main' },
      ],
      [GIT_WORKSPACE_IPC_CHANNELS.fetch, { projectId, expectedHead, expectedBranch }],
      [GIT_WORKSPACE_IPC_CHANNELS.pull, { projectId, expectedHead, expectedBranch }],
      [GIT_WORKSPACE_IPC_CHANNELS.push, { projectId, expectedHead, expectedBranch }],
      [GIT_WORKSPACE_IPC_CHANNELS.reveal, { projectId }],
    ]);
  });

  it('turns rejected invokes and malformed responses into a bounded public error', async () => {
    electron.ipcRenderer.invoke
      .mockRejectedValueOnce(new Error('private-path:/Users/researcher/.ssh/id_ed25519'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'invented_private_error' } });

    await expect(api.gitWorkspace.snapshot('994495b1-38fb-4a01-917d-63583e6a0e23')).rejects.toThrow(
      'git_workspace_unavailable',
    );
    await expect(api.gitWorkspace.clone('994495b1-38fb-4a01-917d-63583e6a0e23')).rejects.toThrow(
      'git_workspace_unavailable',
    );
  });

  it('preserves the explicit current HEAD only for optimistic-head conflicts', async () => {
    const currentHead = 'c'.repeat(40);
    electron.ipcRenderer.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'git_head_changed', currentHead },
    });

    await expect(
      api.gitWorkspace.fetch({
        projectId: '994495b1-38fb-4a01-917d-63583e6a0e23',
        expectedHead: 'd'.repeat(40),
        expectedBranch: 'main',
      }),
    ).rejects.toThrow(`git_head_changed:${currentHead}`);
  });
});
