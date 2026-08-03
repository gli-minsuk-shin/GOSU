import { describe, expect, it } from 'vitest';

import { checkOptimisticVersion } from '../src/index.js';

describe('optimistic sync', () => {
  const current = {
    id: 'task-1',
    version: 7,
    title: 'Run baseline',
  };

  it('returns the next version when the expected version matches', () => {
    expect(checkOptimisticVersion(current, 7, { title: 'Run baseline now' })).toEqual({
      ok: true,
      current,
      expectedVersion: 7,
      nextVersion: 8,
    });
  });

  it('preserves both values for explicit conflict resolution', () => {
    const incoming = { title: 'Competing update' };
    const result = checkOptimisticVersion(current, 6, incoming);

    expect(result).toEqual({
      ok: false,
      conflict: {
        kind: 'version_conflict',
        entityId: 'task-1',
        expectedVersion: 6,
        actualVersion: 7,
        current,
        incoming,
      },
    });
  });
});
