import { useCallback, useEffect, useState } from 'react';
import type { UsageLimitSettings, UsageLimitStatus } from '../../shared/usage-limit-contracts';
import { describeError } from './ui-primitives';

/**
 * The limits the main process keeps, pushed on every change; `now` ticks for the countdowns. A
 * request that fails (the status cannot be read, a setting cannot be saved) is reported, not dropped.
 */
export function useUsageLimits(reconnectKey: string) {
  const [status, setStatus] = useState<UsageLimitStatus | null>(null),
    [now, setNow] = useState(() => Date.now()),
    [failure, setFailure] = useState<string | null>(null);
  const run = useCallback((request: Promise<UsageLimitStatus> | undefined) => {
    if (!request) return;
    void request.then(
      (value) => {
        setStatus(value);
        setFailure(null);
      },
      (error: unknown) => setFailure(describeError(error)),
    );
  }, []);
  useEffect(() => {
    const api = window.gosu?.usageLimits;
    if (!api) return;
    let active = true;
    void api.status().then(
      (value) => {
        if (active) setStatus(value);
      },
      (error: unknown) => {
        if (active) setFailure(describeError(error));
      },
    );
    const remove = api.onChanged((value) => {
      if (active) setStatus(value);
    });
    return () => {
      active = false;
      remove();
    };
  }, []);
  // A CLI that just connected (or disconnected) should appear (or leave) now, not at the next tick.
  useEffect(() => {
    if (reconnectKey) run(window.gosu?.usageLimits?.refresh());
  }, [reconnectKey, run]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const refresh = useCallback(() => run(window.gosu?.usageLimits?.refresh()), [run]);
  const configure = useCallback(
    (settings: UsageLimitSettings) => run(window.gosu?.usageLimits?.configure(settings)),
    [run],
  );
  return { status, now, failure, refresh, configure };
}
