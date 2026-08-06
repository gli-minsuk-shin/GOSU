import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  sshResourceRefreshIntervalMs,
  startSshResourceRefreshScheduler,
  type SshResourceRefreshSchedulerPlatform,
} from '../src/renderer/src/ssh-resource-refresh-policy';

function schedulerPlatform(initiallyVisible = true) {
  let visible = initiallyVisible;
  let visibilityListener: (() => void) | null = null;
  const platform: SshResourceRefreshSchedulerPlatform = {
    isVisible: () => visible,
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    subscribeVisibility: (callback) => {
      visibilityListener = callback;
      return () => {
        if (visibilityListener === callback) visibilityListener = null;
      };
    },
  };
  return {
    platform,
    setVisible(next: boolean) {
      visible = next;
      visibilityListener?.();
    },
    subscribed: () => visibilityListener !== null,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SSH resource refresh policy', () => {
  it('maps every supported preference to its exact delay', () => {
    expect(sshResourceRefreshIntervalMs('manual')).toBeNull();
    expect(sshResourceRefreshIntervalMs('30s')).toBe(30_000);
    expect(sshResourceRefreshIntervalMs('1m')).toBe(60_000);
    expect(sshResourceRefreshIntervalMs('5m')).toBe(300_000);
    expect(sshResourceRefreshIntervalMs('10m')).toBe(600_000);
  });

  it('does not subscribe, schedule, or refresh in manual mode', async () => {
    vi.useFakeTimers();
    const fixture = schedulerPlatform();
    const refresh = vi.fn();

    const stop = startSshResourceRefreshScheduler({
      interval: 'manual',
      refresh,
      platform: fixture.platform,
    });
    await vi.advanceTimersByTimeAsync(600_000);

    expect(refresh).not.toHaveBeenCalled();
    expect(fixture.subscribed()).toBe(false);
    stop();
  });

  it('refreshes immediately, then waits one full interval after completion', async () => {
    vi.useFakeTimers();
    const fixture = schedulerPlatform();
    const refresh = vi.fn(async () => undefined);
    const stop = startSshResourceRefreshScheduler({
      interval: '1m',
      refresh,
      platform: fixture.platform,
    });

    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
  });

  it('never overlaps a slow refresh with later timer ticks', async () => {
    vi.useFakeTimers();
    const fixture = schedulerPlatform();
    let finishFirstRefresh!: () => void;
    const firstRefresh = new Promise<void>((resolve) => {
      finishFirstRefresh = resolve;
    });
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstRefresh)
      .mockResolvedValue(undefined);
    const stop = startSshResourceRefreshScheduler({
      interval: '30s',
      refresh,
      platform: fixture.platform,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    finishFirstRefresh();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
  });

  it('continues on schedule after one resource refresh fails', async () => {
    vi.useFakeTimers();
    const fixture = schedulerPlatform();
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('server unavailable'))
      .mockResolvedValue(undefined);
    const stop = startSshResourceRefreshScheduler({
      interval: '30s',
      refresh,
      platform: fixture.platform,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
  });

  it('pauses while hidden and performs one immediate refresh when visible again', async () => {
    vi.useFakeTimers();
    const fixture = schedulerPlatform(false);
    const refresh = vi.fn(async () => undefined);
    const stop = startSshResourceRefreshScheduler({
      interval: '30s',
      refresh,
      platform: fixture.platform,
    });

    await vi.advanceTimersByTimeAsync(600_000);
    expect(refresh).not.toHaveBeenCalled();

    fixture.setVisible(true);
    fixture.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    fixture.setVisible(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    fixture.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
  });

  it('cleans up queued and in-flight work without allowing stale timers to re-arm', async () => {
    vi.useFakeTimers();
    const fixture = schedulerPlatform();
    const neverStarted = vi.fn(async () => undefined);
    const stopQueued = startSshResourceRefreshScheduler({
      interval: '1m',
      refresh: neverStarted,
      platform: fixture.platform,
    });
    stopQueued();
    await vi.advanceTimersByTimeAsync(0);
    expect(neverStarted).not.toHaveBeenCalled();
    expect(fixture.subscribed()).toBe(false);

    let finishRefresh!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const refresh = vi.fn(() => inFlight);
    const stopInFlight = startSshResourceRefreshScheduler({
      interval: '1m',
      refresh,
      platform: fixture.platform,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledOnce();

    stopInFlight();
    finishRefresh();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(refresh).toHaveBeenCalledOnce();
    expect(fixture.subscribed()).toBe(false);
  });
});
