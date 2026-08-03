import { isIP } from 'node:net';

import type { ComponentReadiness, RuntimeReadiness } from '../shared/runtime-contracts';

export type { ComponentReadiness, RuntimeReadiness } from '../shared/runtime-contracts';

export const DEFAULT_SYNC_API_URL = 'http://127.0.0.1:4000';

type HealthFetch = (
  input: string,
  init: { signal: AbortSignal; redirect: 'error'; cache: 'no-store'; headers: { accept: string } },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

function isLoopbackHost(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

export function normalizeSyncHealthUrl(rawUrl = DEFAULT_SYNC_API_URL) {
  const url = new URL(rawUrl);
  const isHttps = url.protocol === 'https:';
  const isLoopbackHttp = url.protocol === 'http:' && isLoopbackHost(url.hostname);
  const numericHost = isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0;

  if (
    (!isHttps && !isLoopbackHttp) ||
    (isHttps && numericHost && !isLoopbackHost(url.hostname)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('sync_health_url_rejected');
  }
  url.pathname = '/v1/health/ready';
  return url.href;
}

export async function checkSyncApiHealth(
  rawUrl: string | undefined,
  options: { timeoutMs?: number; fetch?: HealthFetch } = {},
): Promise<ComponentReadiness> {
  let url: string;
  try {
    url = normalizeSyncHealthUrl(rawUrl);
  } catch {
    return { ready: false, detail: 'sync_api_url_rejected' };
  }

  const controller = new AbortController();
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 1_500, 100), 5_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetchHealth = options.fetch ?? (fetch as HealthFetch);
    const response = await fetchHealth(url, {
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const payload = response.ok ? await response.json() : null;
    const isGosuReadiness =
      typeof payload === 'object' &&
      payload !== null &&
      'service' in payload &&
      payload.service === 'gosu-sync-api' &&
      'status' in payload &&
      payload.status === 'ready' &&
      'apiVersion' in payload &&
      payload.apiVersion === 1;
    return response.ok && isGosuReadiness
      ? { ready: true, detail: 'sync_api_ready' }
      : { ready: false, detail: 'sync_api_unavailable' };
  } catch {
    return { ready: false, detail: 'sync_api_unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

export function localDataReadiness(error?: unknown): ComponentReadiness {
  if (!error) return { ready: true, detail: 'encrypted_local_data_ready' };
  return {
    ready: false,
    detail:
      error instanceof Error && error.message === 'secure_local_storage_unavailable'
        ? 'secure_local_storage_unavailable'
        : 'local_database_unavailable',
  };
}

export function buildRuntimeReadiness(input: Omit<RuntimeReadiness, 'status'>): RuntimeReadiness {
  return {
    status:
      input.localData.ready && input.codex.ready && input.syncApi.ready ? 'ready' : 'degraded',
    ...input,
  };
}
