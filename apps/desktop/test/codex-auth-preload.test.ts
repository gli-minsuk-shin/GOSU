import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { CODEX_AUTH_IPC_CHANNELS } from '../src/shared/codex-auth-channels';

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

let api: GosuDesktopApi;

beforeAll(async () => {
  await import('../src/preload/index');
  api = electron.exposed[0]?.[1] as GosuDesktopApi;
});

beforeEach(() => {
  electron.ipcRenderer.on.mockClear();
  electron.ipcRenderer.removeListener.mockClear();
});

describe('Codex authentication preload boundary', () => {
  it('subscribes only to the fixed channel, parses the exact event, and unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = api.codex.onAuthenticationEvent(listener);
    const handler = electron.listeners.get(CODEX_AUTH_IPC_CHANNELS.event);

    expect(handler).toBeTypeOf('function');
    handler?.({}, { type: 'login.completed', success: true });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'login.completed', success: true });

    handler?.({}, { type: 'login.completed', success: true, error: 'raw-provider-error' });
    handler?.({}, { type: 'arbitrary', success: true });
    handler?.({}, { type: 'login.completed', success: 'yes' });
    handler?.({}, { type: 'login.completed', success: false }, 'extra-payload');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledExactlyOnceWith(
      CODEX_AUTH_IPC_CHANNELS.event,
      handler,
    );
  });

  it('rejects non-function subscribers', () => {
    expect(() => api.codex.onAuthenticationEvent('not-a-listener' as never)).toThrow(
      'invalid_codex_authentication_listener',
    );
  });
});
