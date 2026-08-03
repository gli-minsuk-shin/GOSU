import { describe, expect, it, vi } from 'vitest';

import { isSupervisorAlive, parseSupervisorPid } from '../src/main/supervisor-liveness';

describe('local supervisor liveness', () => {
  it('accepts only positive safe integer process identifiers', () => {
    expect(parseSupervisorPid('42')).toBe(42);
    expect(parseSupervisorPid(undefined)).toBeNull();
    expect(parseSupervisorPid('0')).toBeNull();
    expect(parseSupervisorPid('42x')).toBeNull();
    expect(parseSupervisorPid(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
  });

  it('uses signal zero without terminating a live supervisor', () => {
    const signalCheck = vi.fn();

    expect(isSupervisorAlive(42, signalCheck)).toBe(true);
    expect(signalCheck).toHaveBeenCalledWith(42, 0);
  });

  it('treats only ESRCH as a dead supervisor', () => {
    expect(
      isSupervisorAlive(42, () => {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      }),
    ).toBe(false);
    expect(
      isSupervisorAlive(42, () => {
        throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
      }),
    ).toBe(true);
  });
});
