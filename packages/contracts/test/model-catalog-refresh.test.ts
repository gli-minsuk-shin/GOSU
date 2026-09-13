import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startModelCatalogAutoRefresh,
  type ModelCatalogRefreshPlatform,
} from '../src/model-catalog-refresh';

function fixture(initiallyVisible = true) {
  let visible = initiallyVisible;
  const focus = new EventTarget();
  const visibility = new EventTarget();
  const subscribe = (target: EventTarget, listener: () => void) => {
    target.addEventListener('change', listener);
    return () => target.removeEventListener('change', listener);
  };
  const platform: ModelCatalogRefreshPlatform = {
    isVisible: () => visible,
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
    subscribeFocus: (listener) => subscribe(focus, listener),
    subscribeVisibility: (listener) => subscribe(visibility, listener),
  };
  return {
    platform,
    focus: () => focus.dispatchEvent(new Event('change')),
    setVisible: (next: boolean) => {
      visible = next;
      visibility.dispatchEvent(new Event('change'));
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('shared model catalog automatic discovery', () => {
  it('discovers on mount and every minute without requiring an app update', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const stop = startModelCatalogAutoRefresh({ refresh }, fixture().platform);

    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('pauses while hidden and coalesces focus with visibility on return', async () => {
    vi.useFakeTimers();
    const page = fixture(false);
    const refresh = vi.fn(async () => undefined);
    const stop = startModelCatalogAutoRefresh({ refresh }, page.platform);

    page.focus();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).not.toHaveBeenCalled();
    page.setVisible(true);
    page.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    page.setVisible(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    page.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('refreshes on focus while already visible', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const refresh = vi.fn(async () => undefined);
    const stop = startModelCatalogAutoRefresh({ refresh }, page.platform);
    await vi.advanceTimersByTimeAsync(0);
    page.focus();
    page.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not overlap slow requests and recovers after a discovery failure', async () => {
    vi.useFakeTimers();
    const page = fixture();
    let reject!: (error: Error) => void;
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise((_, fail) => (reject = fail)))
      .mockResolvedValue(undefined);
    const stop = startModelCatalogAutoRefresh({ refresh }, page.platform);
    await vi.advanceTimersByTimeAsync(0);
    page.focus();
    page.setVisible(false);
    page.setVisible(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    reject(new Error('temporary discovery failure'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('aborts a pending publication and removes timers and listeners when disposed', async () => {
    vi.useFakeTimers();
    const page = fixture();
    let finish!: () => void;
    let signal!: AbortSignal;
    const refresh = vi.fn(
      (nextSignal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal = nextSignal;
          finish = resolve;
        }),
    );
    const stop = startModelCatalogAutoRefresh({ refresh }, page.platform);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    stop();
    expect(signal.aborted).toBe(true);
    finish();
    page.focus();
    page.setVisible(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an invalid interval instead of starting a busy polling loop', () => {
    for (const intervalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        startModelCatalogAutoRefresh({ refresh: vi.fn(), intervalMs }, fixture().platform),
      ).toThrow('model_catalog_refresh_interval_invalid');
    }
  });
});
