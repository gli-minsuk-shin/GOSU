export type SearchExecution = Readonly<{
  signal?: AbortSignal;
  deadlineAt?: number;
}>;

export class SearchExecutionCancelledError extends Error {
  constructor() {
    super('search_execution_cancelled');
    this.name = 'SearchExecutionCancelledError';
  }
}

export function isSearchExecutionCancelled(error: unknown) {
  return error instanceof SearchExecutionCancelledError;
}

export function searchExecutionCancelled(execution: SearchExecution) {
  return (
    execution.signal?.aborted === true ||
    (execution.deadlineAt !== undefined && Date.now() >= execution.deadlineAt)
  );
}

export function throwIfSearchExecutionCancelled(execution: SearchExecution) {
  if (searchExecutionCancelled(execution)) throw new SearchExecutionCancelledError();
}

/**
 * Waits only for this search request's remaining budget. The underlying operation is deliberately
 * not trusted to honor AbortSignal; callers can retain it in PendingSearchOperations so a timed-out
 * filesystem operation cannot be multiplied by subsequent searches.
 */
export async function waitForSearchOperation<T>(
  operation: Promise<T>,
  execution: SearchExecution,
): Promise<T> {
  throwIfSearchExecutionCancelled(execution);
  if (!execution.signal && execution.deadlineAt === undefined) return operation;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      execution.signal?.removeEventListener('abort', cancel);
      callback();
    };
    const cancel = () => finish(() => reject(new SearchExecutionCancelledError()));

    if (execution.signal) execution.signal.addEventListener('abort', cancel, { once: true });
    if (execution.deadlineAt !== undefined) {
      const remaining = Math.max(0, execution.deadlineAt - Date.now());
      deadlineTimer = setTimeout(cancel, remaining);
    }
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/** Tracks detached operations after a deadline so later searches do not stack the same local I/O. */
export class PendingSearchOperations {
  private readonly pending = new Set<Promise<unknown>>();

  get busy() {
    return this.pending.size > 0;
  }

  track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    const release = () => this.pending.delete(operation);
    void operation.then(release, release);
    return operation;
  }
}
