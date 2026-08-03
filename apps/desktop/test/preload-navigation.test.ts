import { beforeAll, describe, expect, it, vi } from 'vitest';

import { APP_NAVIGATION_CHANNELS } from '../src/shared/app-navigation-channels';

const electron = vi.hoisted(() => {
  const exposed: unknown[][] = [];
  const listeners = new Map<string, (...arguments_: unknown[]) => void>();
  return {
    exposed,
    listeners,
    contextBridge: {
      exposeInMainWorld: vi.fn((...arguments_: unknown[]) => exposed.push(arguments_)),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn((channel: string, listener: (...arguments_: unknown[]) => void) => {
        listeners.set(channel, listener);
      }),
      removeListener: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
}));

type NavigationApi = {
  app: {
    onOpenSettings: (listener: () => void) => () => void;
  };
  vault: {
    current: () => Promise<unknown>;
  };
};

let api: NavigationApi;

beforeAll(async () => {
  await import('../src/preload/index');
  api = electron.exposed[0]?.[1] as NavigationApi;
});

describe('preload app navigation bridge', () => {
  it('exposes only a fixed settings subscription and buffers an early event', () => {
    expect(Object.keys(api.app)).toEqual(['onOpenSettings']);
    expect(electron.listeners.has(APP_NAVIGATION_CHANNELS.openSettings)).toBe(true);

    electron.listeners.get(APP_NAVIGATION_CHANNELS.openSettings)?.({});
    const listener = vi.fn();
    const unsubscribe = api.app.onOpenSettings(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    electron.listeners.get(APP_NAVIGATION_CHANNELS.openSettings)?.({});
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    const nextListener = vi.fn();
    const unsubscribeNext = api.app.onOpenSettings(nextListener);
    electron.listeners.get(APP_NAVIGATION_CHANNELS.openSettings)?.({});
    expect(listener).toHaveBeenCalledTimes(2);
    expect(nextListener).toHaveBeenCalledTimes(1);
    unsubscribeNext();
  });

  it('ignores unexpected route payloads instead of exposing generic navigation', () => {
    const listener = vi.fn();
    const unsubscribe = api.app.onOpenSettings(listener);

    electron.listeners.get(APP_NAVIGATION_CHANNELS.openSettings)?.({}, 'arbitrary-route');

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('rejects non-function subscribers at the context bridge boundary', () => {
    expect(() => api.app.onOpenSettings('not-a-listener' as unknown as () => void)).toThrow(
      'invalid_open_settings_listener',
    );
  });

  it('exposes the authoritative current Vault through a fixed IPC channel', async () => {
    const selection = { id: 'a'.repeat(64), name: 'Notes', root: '/fixture', files: [] };
    electron.ipcRenderer.invoke.mockResolvedValueOnce(selection);

    await expect(api.vault.current()).resolves.toEqual(selection);
    expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith('gosu:vault:current');
  });
});
