/**
 * Email summary batches send nothing but the AI request, so several can run at once; each paper batch
 * also reads arXiv HTML and figures, so fewer run together. Measured on 2026-09-17: one Haiku batch of
 * six items took 17–218s (median about 55s), and a 13-batch run took 15 minutes one batch at a time.
 */
export const EMAIL_SUMMARY_CONCURRENCY = 3;
export const PAPER_SUMMARY_CONCURRENCY = 2;

/**
 * Runs tasks with at most `limit` in flight, starting them in order. A task that throws stops new
 * tasks and aborts the shared signal so in-flight tasks end early; its error is rethrown after every
 * started task has settled, so no batch keeps writing after the run has failed.
 */
export async function runBatchesConcurrently<T>(
  tasks: readonly T[],
  limit: number,
  signal: AbortSignal,
  run: (task: T, signal: AbortSignal) => Promise<void>,
) {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal.aborted) forward();
  else signal.addEventListener('abort', forward, { once: true });
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (!failure && !controller.signal.aborted && next < tasks.length) {
      const task = tasks[next++]!;
      try {
        await run(task, controller.signal);
      } catch (error) {
        failure ??= { error };
        controller.abort();
      }
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, () => worker()),
    );
  } finally {
    signal.removeEventListener('abort', forward);
  }
  // Assigned inside the workers, which control-flow narrowing does not see.
  const failed = failure as { error: unknown } | null;
  if (failed) throw failed.error;
  if (signal.aborted) throw new Error('source_cancelled');
}
