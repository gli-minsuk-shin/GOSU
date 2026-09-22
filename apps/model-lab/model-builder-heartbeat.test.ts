import { afterEach, describe, expect, it, vi } from 'vitest';
import { startModelBuilderHeartbeat } from './model-builder-heartbeat';

afterEach(() => vi.useRealTimers());

describe('model import connection heartbeat', () => {
  it('continues reporting past five minutes with the actual extended deadline', async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const stop = startModelBuilderHeartbeat({
      phase: 'llm-running',
      attempt: 1,
      timeoutMs: 900000,
      onProgress,
    });
    await vi.advanceTimersByTimeAsync(360000);
    expect(onProgress).toHaveBeenCalledTimes(24);
    expect(onProgress.mock.lastCall?.[0].message).toContain(
      '360 seconds elapsed · 15 minute limit',
    );
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('describes narrow repairs without claiming to regenerate the whole graph', async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const stop = startModelBuilderHeartbeat({
      phase: 'model-ir-repairing',
      attempt: 2,
      timeoutMs: 600_000,
      responseKind: 'narrative-patches',
      onProgress,
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onProgress.mock.lastCall?.[0].message).toContain('targeted formula/description patches');
    expect(onProgress.mock.lastCall?.[0].message).not.toContain('complete ModelIR');
    stop();
  });
  it('sends progress during a silent provider call without claiming a result', async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const stop = startModelBuilderHeartbeat({
      phase: 'llm-running',
      attempt: 1,
      timeoutMs: 600_000,
      onProgress,
    });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.lastCall?.[0]).toEqual({
      phase: 'llm-running',
      message: expect.stringContaining('45 seconds elapsed'),
    });
    expect(onProgress.mock.lastCall?.[0].message).toContain('Waiting');
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves correction phase and disposes before the first heartbeat for fast replies', async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const stop = startModelBuilderHeartbeat({
      phase: 'model-ir-repairing',
      attempt: 2,
      timeoutMs: 300_000,
      onProgress,
    });
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onProgress).not.toHaveBeenCalled();
  });
});
