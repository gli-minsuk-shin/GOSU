import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { MANUSCRIPT_WORKSPACE_IPC_CHANNELS } from '../src/shared/manuscript-workspace-channels';

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

describe('Manuscript Workspace preload bridge', () => {
  it('exposes only fixed manuscript operations and no generic Git or publish escape hatch', () => {
    expect(Object.keys(api.manuscriptWorkspace)).toEqual([
      'list',
      'create',
      'update',
      'connectOverleafGit',
      'inspect',
      'fetchCheckpoint',
      'disconnect',
    ]);
    expect(api.manuscriptWorkspace).not.toHaveProperty('run');
    expect(api.manuscriptWorkspace).not.toHaveProperty('exec');
    expect(api.manuscriptWorkspace).not.toHaveProperty('push');
    expect(api.manuscriptWorkspace).not.toHaveProperty('publish');
  });

  it('maps each operation to its exact allowlisted channel and payload', async () => {
    const projectId = '994495b1-38fb-4a01-917d-63583e6a0e23';
    const manuscriptId = '7f10c680-22d8-4907-a835-b83c6ed36621';
    const bindingId = 'a5201ac9-c425-4afe-a059-c8c7e893dd30';
    const bindingCommand = {
      projectId,
      manuscriptId,
      bindingId,
      expectedBindingVersion: 1,
    };
    const providerRevision = 'a'.repeat(40);
    const token = 'renderer-to-main-one-shot-token';
    for (let index = 0; index < 7; index += 1) {
      electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true, value: { call: index + 1 } });
    }

    await api.manuscriptWorkspace.list(projectId);
    await api.manuscriptWorkspace.create({
      projectId,
      title: 'Main paper',
      rootDocument: 'paper/main.tex',
    });
    await api.manuscriptWorkspace.update({
      projectId,
      manuscriptId,
      expectedVersion: 1,
      title: 'Renamed paper',
      rootDocument: 'manuscript/main.tex',
    });
    await api.manuscriptWorkspace.connectOverleafGit({
      projectId,
      manuscriptId,
      expectedManuscriptVersion: 1,
      providerId: 'overleaf_git',
      remoteUrl: 'https://git.overleaf.com/0123456789abcdef01234567',
      accessToken: token,
    });
    await api.manuscriptWorkspace.inspect(bindingCommand);
    await api.manuscriptWorkspace.fetchCheckpoint({
      ...bindingCommand,
      expectedProviderRevision: providerRevision,
    });
    await api.manuscriptWorkspace.disconnect(bindingCommand);

    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      [MANUSCRIPT_WORKSPACE_IPC_CHANNELS.list, { projectId }],
      [
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.create,
        { projectId, title: 'Main paper', rootDocument: 'paper/main.tex' },
      ],
      [
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.update,
        {
          projectId,
          manuscriptId,
          expectedVersion: 1,
          title: 'Renamed paper',
          rootDocument: 'manuscript/main.tex',
        },
      ],
      [
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.connectOverleafGit,
        {
          projectId,
          manuscriptId,
          expectedManuscriptVersion: 1,
          providerId: 'overleaf_git',
          remoteUrl: 'https://git.overleaf.com/0123456789abcdef01234567',
          accessToken: token,
        },
      ],
      [MANUSCRIPT_WORKSPACE_IPC_CHANNELS.inspect, bindingCommand],
      [
        MANUSCRIPT_WORKSPACE_IPC_CHANNELS.fetchCheckpoint,
        { ...bindingCommand, expectedProviderRevision: providerRevision },
      ],
      [MANUSCRIPT_WORKSPACE_IPC_CHANNELS.disconnect, bindingCommand],
    ]);
  });

  it('redacts rejected invokes and unknown response errors', async () => {
    electron.ipcRenderer.invoke
      .mockRejectedValueOnce(new Error('token=private-overleaf-token'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'private-provider-error' } });

    await expect(
      api.manuscriptWorkspace.list('994495b1-38fb-4a01-917d-63583e6a0e23'),
    ).rejects.toThrow('manuscript_workspace_unavailable');
    await expect(
      api.manuscriptWorkspace.create({
        projectId: '994495b1-38fb-4a01-917d-63583e6a0e23',
        title: 'Main paper',
        rootDocument: 'paper/main.tex',
      }),
    ).rejects.toThrow('manuscript_workspace_unavailable');
  });

  it('preserves an allowlisted provider error without exposing private detail', async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'overleaf_git_auth_required' },
    });

    await expect(
      api.manuscriptWorkspace.list('994495b1-38fb-4a01-917d-63583e6a0e23'),
    ).rejects.toThrow('overleaf_git_auth_required');
  });
});
