import { describe, expect, it } from 'vitest';

import {
  SshResourceRequestGuard,
  sshResourceProfilesKey,
} from '../src/renderer/src/ssh-resource-request-guard';
import type { SshConnectionProfile } from '../src/shared/ssh-contracts';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';

function profileFixture(overrides: Partial<SshConnectionProfile> = {}): SshConnectionProfile {
  return {
    schemaVersion: 1,
    id: CONNECTION_ID,
    label: 'Fixture GPU',
    hostAlias: 'fixture-gpu',
    version: 1,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('SSH resource request guard', () => {
  it('rejects old renderer responses after a profile changes or disappears', () => {
    const guard = new SshResourceRequestGuard();
    expect(guard.reconcile([profileFixture()])).toEqual([CONNECTION_ID]);
    const original = guard.token(CONNECTION_ID)!;
    expect(guard.accepts(original)).toBe(true);

    expect(guard.reconcile([profileFixture()])).toEqual([]);
    expect(guard.accepts(original)).toBe(true);

    expect(
      guard.reconcile([
        profileFixture({
          hostAlias: 'replacement-gpu',
          version: 2,
          updatedAt: '2026-08-06T00:01:00.000Z',
        }),
      ]),
    ).toEqual([CONNECTION_ID]);
    const replacement = guard.token(CONNECTION_ID)!;
    expect(guard.accepts(original)).toBe(false);
    expect(guard.accepts(replacement)).toBe(true);
    expect(replacement.generation).toBeGreaterThan(original.generation);

    expect(guard.reconcile([])).toEqual([CONNECTION_ID]);
    expect(guard.token(CONNECTION_ID)).toBeNull();
    expect(guard.accepts(replacement)).toBe(false);
  });

  it('uses version, host, and normalized direct target in a stable polling key', () => {
    const second = profileFixture({
      id: '22222222-2222-4222-8222-222222222222',
      hostAlias: 'direct-fixture',
      directTarget: {
        host: 'fixture.invalid',
        user: 'researcher',
        port: 2222,
        localForwards: [],
      },
    });
    const original = sshResourceProfilesKey([second, profileFixture()]);
    expect(sshResourceProfilesKey([profileFixture(), second])).toBe(original);
    expect(sshResourceProfilesKey([profileFixture(), { ...second, version: 2 }])).not.toBe(
      original,
    );
    expect(
      sshResourceProfilesKey([
        profileFixture(),
        { ...second, directTarget: { ...second.directTarget!, port: 2223 } },
      ]),
    ).not.toBe(original);
  });
});
