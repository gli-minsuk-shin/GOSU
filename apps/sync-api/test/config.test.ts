import { describe, expect, it } from 'vitest';
import { loadSyncApiConfig } from '../src/config.js';

describe('Sync API configuration', () => {
  it('uses an explicit local-development profile on loopback', () => {
    expect(loadSyncApiConfig({})).toEqual({
      environment: 'development',
      host: '127.0.0.1',
      port: 4000,
      allowedOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
      authMode: 'development',
      persistence: 'memory',
    });
  });

  it('rejects exposing development authentication on a non-loopback interface', () => {
    expect(() =>
      loadSyncApiConfig({
        NODE_ENV: 'development',
        GOSU_SYNC_API_HOST: '0.0.0.0',
        GOSU_AUTH_MODE: 'development',
      }),
    ).toThrowError(expect.objectContaining({ code: 'development_auth_requires_loopback' }));
  });

  it.each(['0', '65536', '4000.5', 'not-a-port'])(
    'rejects invalid port %s before opening a socket',
    (port) => {
      expect(() => loadSyncApiConfig({ GOSU_SYNC_API_PORT: port })).toThrowError(
        expect.objectContaining({ code: 'invalid_sync_api_port' }),
      );
    },
  );

  it.each(['*', 'https://trusted.example/path', 'javascript:alert(1)', ''])(
    'rejects unsafe CORS origin %j',
    (origin) => {
      expect(() => loadSyncApiConfig({ GOSU_ALLOWED_ORIGINS: origin })).toThrowError(
        expect.objectContaining({ code: 'invalid_allowed_origin' }),
      );
    },
  );

  it('does not silently select the incomplete PostgreSQL adapter', () => {
    expect(() => loadSyncApiConfig({ GOSU_PERSISTENCE: 'postgres' })).toThrowError(
      expect.objectContaining({ code: 'persistence_adapter_not_available' }),
    );
  });

  it('fails closed when production settings are omitted', () => {
    expect(() => loadSyncApiConfig({ NODE_ENV: 'production' })).toThrowError(
      expect.objectContaining({ code: 'production_configuration_incomplete' }),
    );
  });

  it('still rejects a fully explicit production profile while persistence is development-only', () => {
    expect(() =>
      loadSyncApiConfig({
        NODE_ENV: 'production',
        GOSU_SYNC_API_HOST: '0.0.0.0',
        GOSU_SYNC_API_PORT: '4000',
        GOSU_ALLOWED_ORIGINS: 'https://research.example',
        GOSU_AUTH_MODE: 'oidc',
        GOSU_OIDC_ISSUER: 'https://identity.example',
        GOSU_OIDC_AUDIENCE: 'gosu-sync-api',
      }),
    ).toThrowError(expect.objectContaining({ code: 'production_persistence_not_available' }));
  });

  it('never lets explicit production configuration retain development authentication', () => {
    expect(() =>
      loadSyncApiConfig({
        NODE_ENV: 'production',
        GOSU_SYNC_API_HOST: '0.0.0.0',
        GOSU_SYNC_API_PORT: '4000',
        GOSU_ALLOWED_ORIGINS: 'https://research.example',
        GOSU_AUTH_MODE: 'development',
      }),
    ).toThrowError(expect.objectContaining({ code: 'production_requires_oidc' }));
  });
});
