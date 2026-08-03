import { afterEach, describe, expect, it } from 'vitest';
import { createSyncApiApplication } from '../src/application.js';
import { loadSyncApiConfig } from '../src/config.js';

describe('versioned health endpoints', () => {
  const applications: Awaited<ReturnType<typeof createSyncApiApplication>>[] = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.close()));
  });

  async function application() {
    const app = await createSyncApiApplication(loadSyncApiConfig({ NODE_ENV: 'test' }));
    applications.push(app);
    await app.init();
    return app.getHttpAdapter().getInstance();
  }

  it('serves unauthenticated liveness without exposing configuration or tenant data', async () => {
    const server = await application();
    const response = await server.inject({ method: 'GET', url: '/v1/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'alive',
      service: 'gosu-sync-api',
      apiVersion: 1,
    });
  });

  it('serves unauthenticated readiness only after the Nest application initializes', async () => {
    const server = await application();
    const response = await server.inject({ method: 'GET', url: '/v1/health/ready?probe=1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      service: 'gosu-sync-api',
      apiVersion: 1,
    });
  });

  it('does not broaden the unauthenticated exception to ordinary versioned routes', async () => {
    const server = await application();
    const response = await server.inject({ method: 'GET', url: '/v1/bootstrap' });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('lab-demo');
    expect(response.body).not.toContain('owner');
  });
});
