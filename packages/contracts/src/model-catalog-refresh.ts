export const MODEL_CATALOG_REFRESH_INTERVAL_MS = 60_000;

type RefreshTimer = ReturnType<typeof globalThis.setTimeout>;

export interface ModelCatalogRefreshPlatform {
  isVisible(): boolean;
  setTimeout(callback: () => void, delayMs: number): RefreshTimer;
  clearTimeout(timer: RefreshTimer): void;
  subscribeFocus(callback: () => void): () => void;
  subscribeVisibility(callback: () => void): () => void;
}

function browserRefreshPlatform(): ModelCatalogRefreshPlatform {
  return {
    isVisible: () => document.visibilityState !== 'hidden',
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
    subscribeFocus: (callback) => {
      window.addEventListener('focus', callback);
      return () => window.removeEventListener('focus', callback);
    },
    subscribeVisibility: (callback) => {
      document.addEventListener('visibilitychange', callback);
      return () => document.removeEventListener('visibilitychange', callback);
    },
  };
}

/** Both apps discover models on mount, resume, and while visible, without overlapping requests. */
export function startModelCatalogAutoRefresh(
  options: {
    refresh: (signal: AbortSignal) => Promise<unknown> | void;
    intervalMs?: number;
  },
  platform: ModelCatalogRefreshPlatform = browserRefreshPlatform(),
): () => void {
  const intervalMs = options.intervalMs ?? MODEL_CATALOG_REFRESH_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('model_catalog_refresh_interval_invalid');
  }
  const controller = new AbortController();
  let running = false;
  let timer: RefreshTimer | null = null;

  const clearScheduled = () => {
    if (timer === null) return;
    platform.clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    if (controller.signal.aborted || running || !platform.isVisible()) return;
    clearScheduled();
    timer = platform.setTimeout(() => {
      timer = null;
      void refresh();
    }, delayMs);
  };

  const refresh = async () => {
    if (controller.signal.aborted || running || !platform.isVisible()) return;
    running = true;
    try {
      await options.refresh(controller.signal);
    } catch {
      // Background discovery failures retain each caller's last successful catalog.
    } finally {
      running = false;
      schedule(intervalMs);
    }
  };

  const resume = () => {
    if (!platform.isVisible()) {
      clearScheduled();
      return;
    }
    schedule(0);
  };
  const unsubscribeFocus = platform.subscribeFocus(resume);
  const unsubscribeVisibility = platform.subscribeVisibility(resume);
  schedule(0);

  return () => {
    if (controller.signal.aborted) return;
    controller.abort();
    clearScheduled();
    unsubscribeFocus();
    unsubscribeVisibility();
  };
}
