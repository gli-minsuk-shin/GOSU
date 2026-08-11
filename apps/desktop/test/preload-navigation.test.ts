import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AGENT_ADD_ON_CHANNELS } from '../src/shared/agent-addon-channels';
import { APP_NAVIGATION_CHANNELS } from '../src/shared/app-navigation-channels';
import type { AgentAddOnId } from '../src/shared/agent-addon-contracts';

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
    onToggleSidebar: (listener: () => void) => () => void;
  };
  agentAddOns: {
    status: (ids: readonly AgentAddOnId[]) => Promise<unknown>;
    connect: (id: AgentAddOnId) => Promise<unknown>;
    disconnect: (id: AgentAddOnId) => Promise<unknown>;
  };
};

let api: NavigationApi;

beforeAll(async () => {
  await import('../src/preload/index');
  api = electron.exposed[0]?.[1] as NavigationApi;
});

describe('preload app navigation bridge', () => {
  it('exposes only a fixed settings subscription and buffers an early event', () => {
    expect(Object.keys(api.app)).toEqual(['onOpenSettings', 'onToggleSidebar']);
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

  it('buffers sidebar menu toggles by parity and supports unsubscribe', () => {
    expect(electron.listeners.has(APP_NAVIGATION_CHANNELS.toggleSidebar)).toBe(true);

    electron.listeners.get(APP_NAVIGATION_CHANNELS.toggleSidebar)?.({});
    electron.listeners.get(APP_NAVIGATION_CHANNELS.toggleSidebar)?.({});
    const evenListener = vi.fn();
    const unsubscribeEven = api.app.onToggleSidebar(evenListener);
    expect(evenListener).not.toHaveBeenCalled();

    electron.listeners.get(APP_NAVIGATION_CHANNELS.toggleSidebar)?.({});
    expect(evenListener).toHaveBeenCalledTimes(1);
    unsubscribeEven();

    electron.listeners.get(APP_NAVIGATION_CHANNELS.toggleSidebar)?.({});
    const nextListener = vi.fn();
    const unsubscribeNext = api.app.onToggleSidebar(nextListener);
    expect(nextListener).toHaveBeenCalledTimes(1);
    unsubscribeNext();
  });

  it('ignores unexpected route payloads instead of exposing generic navigation', () => {
    const listener = vi.fn();
    const unsubscribe = api.app.onOpenSettings(listener);

    electron.listeners.get(APP_NAVIGATION_CHANNELS.openSettings)?.({}, 'arbitrary-route');
    const sidebarListener = vi.fn();
    const unsubscribeSidebar = api.app.onToggleSidebar(sidebarListener);
    electron.listeners.get(APP_NAVIGATION_CHANNELS.toggleSidebar)?.({}, 'arbitrary-route');

    expect(listener).not.toHaveBeenCalled();
    expect(sidebarListener).not.toHaveBeenCalled();
    unsubscribe();
    unsubscribeSidebar();
  });

  it('rejects non-function subscribers at the context bridge boundary', () => {
    expect(() => api.app.onOpenSettings('not-a-listener' as unknown as () => void)).toThrow(
      'invalid_open_settings_listener',
    );
    expect(() => api.app.onToggleSidebar('not-a-listener' as unknown as () => void)).toThrow(
      'invalid_toggle_sidebar_listener',
    );
  });

  it('does not expose a Vault-wide filesystem bridge to the Renderer', () => {
    expect('vault' in api).toBe(false);
  });

  it('exposes fixed add-on status and explicit local lifecycle channels', async () => {
    const statuses = [{ id: 'openclaw', state: 'not_detected', evidence: null, connected: false }];
    electron.ipcRenderer.invoke.mockResolvedValueOnce(statuses);

    await expect(api.agentAddOns.status(['openclaw'])).resolves.toEqual(statuses);
    expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(AGENT_ADD_ON_CHANNELS.status, {
      ids: ['openclaw'],
    });
    const connected = { id: 'hermes', connected: true };
    electron.ipcRenderer.invoke.mockResolvedValueOnce(connected);
    await expect(api.agentAddOns.connect('hermes')).resolves.toEqual(connected);
    expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(AGENT_ADD_ON_CHANNELS.connect, {
      id: 'hermes',
    });
    const disconnected = { id: 'hermes', connected: false };
    electron.ipcRenderer.invoke.mockResolvedValueOnce(disconnected);
    await expect(api.agentAddOns.disconnect('hermes')).resolves.toEqual(disconnected);
    expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(AGENT_ADD_ON_CHANNELS.disconnect, {
      id: 'hermes',
    });
    expect(Object.keys(api.agentAddOns)).toEqual(['status', 'connect', 'disconnect']);
  });
});
