import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { SEARCH_IPC_CHANNELS } from '../src/shared/search-channels';

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

describe('search preload bridge', () => {
  it('exposes one typed query operation on a fixed channel', async () => {
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });
    const input = {
      query: 'foundation model',
      scope: { kind: 'global' as const },
      limitPerCategory: 20,
    };
    await api.search.query(input);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(SEARCH_IPC_CHANNELS.search, input);
    expect(Object.keys(api.search)).toEqual(['query']);
  });

  it('does not expose a generic file-search or SQL surface', () => {
    expect(api.search).not.toHaveProperty('readFile');
    expect(api.search).not.toHaveProperty('querySql');
  });

  it('maps rejected IPC calls to the bounded search error', async () => {
    electron.ipcRenderer.invoke.mockRejectedValue(new Error('/private/vault/path'));
    await expect(
      api.search.query({ query: 'paper', scope: { kind: 'global' }, limitPerCategory: 20 }),
    ).rejects.toThrow('search_unavailable');
  });
});
