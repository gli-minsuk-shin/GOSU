import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogRefreshPlatform } from '@gosu/contracts';

import type { CodexModel } from '../src/renderer/src/connections-view';
import { startDesktopModelCatalogRefresh } from '../src/renderer/src/desktop-model-catalog-refresh';

const platform: ModelCatalogRefreshPlatform = {
  isVisible: () => true,
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
  subscribeFocus: () => () => undefined,
  subscribeVisibility: () => () => undefined,
};
const existing: CodexModel = {
  modelId: 'gpt-existing',
  displayName: 'Existing model',
  isDefault: true,
  reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
};
const released: CodexModel = {
  modelId: 'gpt-6-astra',
  displayName: 'GPT-6-Astra',
  isDefault: true,
  reasoningOptions: [{ id: 'ultra', label: 'Ultra', isDefault: true }],
};

afterEach(() => vi.useRealTimers());

describe('desktop live model catalog refresh', () => {
  it('publishes a newly released model and its reasoning options through discovery only', async () => {
    vi.useFakeTimers();
    const bridge = {
      listModels: vi.fn().mockResolvedValueOnce([existing]).mockResolvedValue([existing, released]),
      reconnect: vi.fn(),
    };
    const publishModels = vi.fn();
    const stop = startDesktopModelCatalogRefresh(
      { ...bridge, publishModels, isReconnecting: () => false },
      platform,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(publishModels).toHaveBeenLastCalledWith([existing]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(publishModels).toHaveBeenLastCalledWith([existing, released]);
    expect(bridge.reconnect).not.toHaveBeenCalled();
    stop();
  });

  it('keeps the last catalog during transient failure and publishes again after recovery', async () => {
    vi.useFakeTimers();
    const listModels = vi
      .fn()
      .mockResolvedValueOnce([existing])
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([existing, released]);
    const publishModels = vi.fn();
    const stop = startDesktopModelCatalogRefresh(
      { listModels, publishModels, isReconnecting: () => false },
      platform,
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(publishModels).toHaveBeenCalledTimes(1);
    expect(publishModels).toHaveBeenLastCalledWith([existing]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(publishModels).toHaveBeenLastCalledWith([existing, released]);
    stop();
  });

  it('does not compete with explicit authentication or reconnect work', async () => {
    vi.useFakeTimers();
    let reconnecting = true;
    let finish!: (models: CodexModel[]) => void;
    const listModels = vi.fn(() => new Promise<CodexModel[]>((resolve) => (finish = resolve)));
    const publishModels = vi.fn();
    const stop = startDesktopModelCatalogRefresh(
      { listModels, publishModels, isReconnecting: () => reconnecting },
      platform,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(listModels).not.toHaveBeenCalled();
    reconnecting = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listModels).toHaveBeenCalledOnce();
    reconnecting = true;
    finish([existing]);
    await vi.advanceTimersByTimeAsync(0);
    expect(publishModels).not.toHaveBeenCalled();
    stop();
  });

  it('does not publish an in-flight result after the desktop unmounts', async () => {
    vi.useFakeTimers();
    let finish!: (models: CodexModel[]) => void;
    const listModels = vi.fn(() => new Promise<CodexModel[]>((resolve) => (finish = resolve)));
    const publishModels = vi.fn();
    const stop = startDesktopModelCatalogRefresh(
      { listModels, publishModels, isReconnecting: () => false },
      platform,
    );
    await vi.advanceTimersByTimeAsync(0);
    stop();
    finish([released]);
    await vi.advanceTimersByTimeAsync(0);
    expect(publishModels).not.toHaveBeenCalled();
  });
});
