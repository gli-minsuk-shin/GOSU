export interface VersionedEntity {
  readonly id: string;
  readonly version: number;
}

export interface OptimisticVersionAccepted<T extends VersionedEntity> {
  readonly ok: true;
  readonly current: T;
  readonly expectedVersion: number;
  readonly nextVersion: number;
}

export interface OptimisticVersionConflict<T extends VersionedEntity> {
  readonly ok: false;
  readonly conflict: {
    readonly kind: 'version_conflict';
    readonly entityId: string;
    readonly expectedVersion: number;
    readonly actualVersion: number;
    readonly current: T;
    readonly incoming: unknown;
  };
}

export type OptimisticVersionResult<T extends VersionedEntity> =
  OptimisticVersionAccepted<T> | OptimisticVersionConflict<T>;

/**
 * Checks an optimistic command without applying last-write-wins semantics.
 * The caller must persist `nextVersion` in the same transaction as its outbox
 * event when this returns `ok: true`.
 */
export function checkOptimisticVersion<T extends VersionedEntity>(
  current: T,
  expectedVersion: number,
  incoming: unknown,
): OptimisticVersionResult<T> {
  if (current.version !== expectedVersion) {
    return {
      ok: false,
      conflict: {
        kind: 'version_conflict',
        entityId: current.id,
        expectedVersion,
        actualVersion: current.version,
        current,
        incoming,
      },
    };
  }

  return {
    ok: true,
    current,
    expectedVersion,
    nextVersion: current.version + 1,
  };
}
