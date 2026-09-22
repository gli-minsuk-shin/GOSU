import { describe, expect, it } from 'vitest';
import { runBatchesConcurrently } from './briefing-batch-pool';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('summary batch pool', () => {
  it('keeps at most the limit in flight and starts every task in order', async () => {
    const gates = Array.from({ length: 7 }, deferred);
    const started: number[] = [];
    let inFlight = 0,
      peak = 0;
    const done = runBatchesConcurrently(
      [0, 1, 2, 3, 4, 5, 6],
      3,
      new AbortController().signal,
      async (i) => {
        started.push(i);
        peak = Math.max(peak, ++inFlight);
        await gates[i]!.promise;
        inFlight--;
      },
    );
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[1]!.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    for (const gate of gates) gate.resolve();
    await done;
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(3);
  });

  it('stops new tasks on a failure, aborts the in-flight ones and rethrows after they settle', async () => {
    const started: number[] = [];
    const settled: number[] = [];
    const done = runBatchesConcurrently(
      [0, 1, 2, 3, 4],
      2,
      new AbortController().signal,
      async (i, signal) => {
        started.push(i);
        if (i === 0) {
          await tick();
          throw new Error('assistant_settings_changed');
        }
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        settled.push(i);
      },
    );
    await expect(done).rejects.toThrow('assistant_settings_changed');
    expect(started).toEqual([0, 1]);
    expect(settled).toEqual([1]);
  });

  it('reports cancellation of the whole run', async () => {
    const controller = new AbortController();
    const done = runBatchesConcurrently([0, 1, 2], 2, controller.signal, async (_i, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
    });
    controller.abort();
    await expect(done).rejects.toThrow('source_cancelled');
  });
});
