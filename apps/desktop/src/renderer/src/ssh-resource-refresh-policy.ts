export const SSH_RESOURCE_REFRESH_INTERVAL_OPTIONS = Object.freeze([
  {
    id: 'manual',
    label: 'Manual',
    description: 'Refresh only when you ask',
    intervalMs: null,
  },
  {
    id: '30s',
    label: '30 seconds',
    description: 'Fast monitoring',
    intervalMs: 30_000,
  },
  {
    id: '1m',
    label: '1 minute',
    description: 'Recommended',
    intervalMs: 60_000,
  },
  {
    id: '5m',
    label: '5 minutes',
    description: 'Lower network use',
    intervalMs: 300_000,
  },
  {
    id: '10m',
    label: '10 minutes',
    description: 'Occasional checks',
    intervalMs: 600_000,
  },
] as const);

export type SshResourceRefreshInterval =
  (typeof SSH_RESOURCE_REFRESH_INTERVAL_OPTIONS)[number]['id'];

export function isSshResourceRefreshInterval(value: unknown): value is SshResourceRefreshInterval {
  return SSH_RESOURCE_REFRESH_INTERVAL_OPTIONS.some((option) => option.id === value);
}

export function sshResourceRefreshIntervalMs(interval: SshResourceRefreshInterval) {
  return (
    SSH_RESOURCE_REFRESH_INTERVAL_OPTIONS.find((option) => option.id === interval)?.intervalMs ??
    null
  );
}

export function sshResourceRefreshIntervalLabel(interval: SshResourceRefreshInterval) {
  const option = SSH_RESOURCE_REFRESH_INTERVAL_OPTIONS.find(
    (candidate) => candidate.id === interval,
  );
  return interval === 'manual' ? 'Manual refresh' : `Auto refresh · ${option?.label ?? '1 minute'}`;
}

type SchedulerHandle = ReturnType<typeof globalThis.setTimeout>;

export type SshResourceRefreshSchedulerPlatform = Readonly<{
  isVisible(): boolean;
  setTimeout(callback: () => void, delayMs: number): SchedulerHandle;
  clearTimeout(handle: SchedulerHandle): void;
  subscribeVisibility(callback: () => void): () => void;
}>;

export function startSshResourceRefreshScheduler({
  interval,
  refresh,
  platform,
}: Readonly<{
  interval: SshResourceRefreshInterval;
  refresh: () => void | Promise<unknown>;
  platform: SshResourceRefreshSchedulerPlatform;
}>) {
  const intervalMs = sshResourceRefreshIntervalMs(interval);
  if (intervalMs === null) return () => undefined;

  let active = true;
  let running = false;
  let timeoutHandle: SchedulerHandle | null = null;

  const clearScheduledRefresh = () => {
    if (timeoutHandle === null) return;
    platform.clearTimeout(timeoutHandle);
    timeoutHandle = null;
  };

  const scheduleRefresh = (delayMs: number, replace = false) => {
    if (!active || !platform.isVisible() || running) return;
    if (timeoutHandle !== null) {
      if (!replace) return;
      clearScheduledRefresh();
    }
    timeoutHandle = platform.setTimeout(() => {
      timeoutHandle = null;
      void refreshWhenVisible();
    }, delayMs);
  };

  const refreshWhenVisible = async () => {
    if (!active || !platform.isVisible() || running) return;
    running = true;
    try {
      await refresh();
    } catch {
      // A failed sample must not stop later status refreshes.
    } finally {
      running = false;
      scheduleRefresh(intervalMs);
    }
  };

  const handleVisibilityChange = () => {
    if (!platform.isVisible()) {
      clearScheduledRefresh();
      return;
    }
    scheduleRefresh(0, true);
  };

  const unsubscribeVisibility = platform.subscribeVisibility(handleVisibilityChange);
  scheduleRefresh(0);

  return () => {
    if (!active) return;
    active = false;
    clearScheduledRefresh();
    unsubscribeVisibility();
  };
}
