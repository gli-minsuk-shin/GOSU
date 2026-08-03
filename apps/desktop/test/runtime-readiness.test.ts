import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexAppServer } from '../src/main/codex-app-server';
import {
  buildRuntimeReadiness,
  checkSyncApiHealth,
  localDataReadiness,
  normalizeSyncHealthUrl,
} from '../src/main/runtime-readiness';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runtime readiness', () => {
  it('probes a configured Codex executable without starting the App Server', async () => {
    vi.stubEnv('GOSU_CODEX_BIN', process.execPath);
    const server = new CodexAppServer();

    await expect(server.availability()).resolves.toEqual({
      ready: true,
      detail: 'configured_codex_ready',
    });
    expect((server as unknown as { process?: unknown }).process).toBeUndefined();
  });

  it('returns only a safe unavailable state for a missing Codex executable', async () => {
    vi.stubEnv('GOSU_CODEX_BIN', '/definitely-not-installed/gosu-codex');

    await expect(new CodexAppServer().availability()).resolves.toEqual({
      ready: false,
      detail: 'codex_executable_unavailable',
    });
  });

  it('accepts the fixed loopback endpoint and conservative HTTPS endpoints', () => {
    expect(normalizeSyncHealthUrl()).toBe('http://127.0.0.1:4000/v1/health/ready');
    expect(normalizeSyncHealthUrl('http://localhost:4000')).toBe(
      'http://localhost:4000/v1/health/ready',
    );
    expect(normalizeSyncHealthUrl('https://sync.example.test')).toBe(
      'https://sync.example.test/v1/health/ready',
    );
  });

  it.each([
    'http://sync.example.test',
    'https://user:secret@sync.example.test',
    'https://sync.example.test?token=secret',
    'https://sync.example.test/other',
    'https://10.0.0.3',
  ])('rejects unsafe Sync health URL %s', (url) => {
    expect(() => normalizeSyncHealthUrl(url)).toThrow('sync_health_url_rejected');
  });

  it('validates Sync health in the main process without returning its body', async () => {
    const fetchHealth = vi.fn(async () => ({
      ok: true,
      json: async () => ({ service: 'gosu-sync-api', status: 'ready', apiVersion: 1 }),
    }));

    await expect(
      checkSyncApiHealth('http://127.0.0.1:4000', {
        fetch: fetchHealth,
      }),
    ).resolves.toEqual({ ready: true, detail: 'sync_api_ready' });
    expect(fetchHealth).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/v1/health/ready',
      expect.objectContaining({ redirect: 'error', cache: 'no-store' }),
    );
  });

  it('does not issue a request for a rejected Sync URL', async () => {
    const fetchHealth = vi.fn(async () => ({ ok: true, json: async () => ({}) }));

    await expect(checkSyncApiHealth('http://remote.test', { fetch: fetchHealth })).resolves.toEqual(
      { ready: false, detail: 'sync_api_url_rejected' },
    );
    expect(fetchHealth).not.toHaveBeenCalled();
  });

  it('does not trust a successful response from a different service', async () => {
    const fetchHealth = vi.fn(async () => ({
      ok: true,
      json: async () => ({ service: 'other', status: 'ready', apiVersion: 1 }),
    }));

    await expect(
      checkSyncApiHealth('http://127.0.0.1:4000', { fetch: fetchHealth }),
    ).resolves.toEqual({ ready: false, detail: 'sync_api_unavailable' });
  });

  it('reports ready only when local data, Codex, and Sync are all ready', () => {
    const base = {
      app: { version: '0.1.0', platform: 'darwin' as const, packaged: false },
      localData: localDataReadiness(),
      codex: { ready: true, detail: 'bundled_codex_ready' as const },
      syncApi: { ready: true, detail: 'sync_api_ready' },
    };

    expect(buildRuntimeReadiness(base).status).toBe('ready');
    expect(
      buildRuntimeReadiness({
        ...base,
        syncApi: { ready: false, detail: 'sync_api_unreachable' },
      }).status,
    ).toBe('degraded');
    expect(localDataReadiness(new Error('database details'))).toEqual({
      ready: false,
      detail: 'local_database_unavailable',
    });
  });
});
