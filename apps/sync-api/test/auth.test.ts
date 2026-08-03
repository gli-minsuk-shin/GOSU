import { UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateHeaders } from '../src/auth.js';

describe('development authentication', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('requires subject, lab, and role headers instead of granting a default Owner', async () => {
    vi.stubEnv('GOSU_AUTH_MODE', 'development');
    vi.stubEnv('NODE_ENV', 'test');

    await expect(authenticateHeaders({})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      authenticateHeaders({
        'x-gosu-sub': 'researcher-fixture',
        'x-gosu-lab': 'lab-demo',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a complete explicit development identity outside production', async () => {
    vi.stubEnv('GOSU_AUTH_MODE', 'development');
    vi.stubEnv('NODE_ENV', 'test');

    await expect(
      authenticateHeaders({
        'x-gosu-sub': 'researcher-fixture',
        'x-gosu-lab': 'lab-demo',
        'x-gosu-role': 'researcher',
      }),
    ).resolves.toMatchObject({
      subject: 'researcher-fixture',
      labId: 'lab-demo',
      role: 'researcher',
    });
  });
});
