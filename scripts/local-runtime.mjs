import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_SYNC_BASE_URL = 'http://127.0.0.1:4000';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function parseLocalSyncBaseUrl(raw = DEFAULT_SYNC_BASE_URL) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('GOSU_SYNC_API_URL must be a valid URL');
  }

  if (url.protocol !== 'http:') {
    throw new Error('The local launcher only accepts an http:// loopback Sync API URL');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('The local launcher only connects to 127.0.0.1, localhost, or ::1');
  }
  if (!url.port) {
    throw new Error('The local Sync API URL must include an explicit port');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('The local Sync API URL must not contain credentials, a query, or a fragment');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('The local Sync API URL must not contain a path');
  }

  url.pathname = '/';
  return url;
}

export function syncHealthUrl(baseUrl) {
  return new URL('v1/health/ready', parseLocalSyncBaseUrl(baseUrl)).toString();
}

export async function probeSync(
  healthUrl,
  { fetchImpl = globalThis.fetch, timeoutMs = 1_200, signal } = {},
) {
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(healthUrl, {
      headers: { accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
    const payload = await response.json().catch(() => null);
    if (!payload || payload.service !== 'gosu-sync-api') {
      return {
        kind: 'occupied',
        detail: `another service answered on the configured port (HTTP ${response.status})`,
      };
    }
    if (!response.ok) {
      return { kind: 'unavailable', detail: `HTTP ${response.status}` };
    }
    if (payload.status !== 'ready' && payload.status !== 'ok') {
      return { kind: 'unavailable', detail: `service reported ${String(payload.status)}` };
    }

    return {
      kind: 'ready',
      detail: typeof payload.persistence === 'string' ? payload.persistence : 'ready',
    };
  } catch (error) {
    return {
      kind: 'unavailable',
      detail: error instanceof Error ? error.message : 'connection failed',
    };
  }
}

export async function waitForSync(
  healthUrl,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    intervalMs = 250,
    onAttempt = () => {},
    signal,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastResult = { kind: 'unavailable', detail: 'not checked' };

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Sync API startup cancelled');
    attempts += 1;
    lastResult = await probeSync(healthUrl, { fetchImpl, signal });
    onAttempt(lastResult, attempts);
    if (lastResult.kind === 'ready') return lastResult;
    if (lastResult.kind === 'occupied') {
      throw new Error(`Sync API port conflict: ${lastResult.detail}`);
    }
    try {
      await delay(intervalMs, undefined, signal ? { signal } : undefined);
    } catch (error) {
      if (signal?.aborted) throw new Error('Sync API startup cancelled', { cause: error });
      throw error;
    }
  }

  throw new Error(`Sync API did not become ready: ${lastResult.detail}`);
}

export function pnpmInvocation(environment = process.env) {
  const npmExecPath = environment.npm_execpath;
  if (npmExecPath?.match(/\.(?:c?js|mjs)$/u)) {
    return { command: process.execPath, prefixArgs: [npmExecPath] };
  }
  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    prefixArgs: [],
  };
}

export function terminateProcessTree(child, signal = 'SIGTERM') {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
  }
}
