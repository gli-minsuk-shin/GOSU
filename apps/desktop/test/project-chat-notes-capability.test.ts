import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveProjectChatNotesGrant } from '../src/main/project-chat-notes-capability';
import type { ProjectAgentVault } from '../src/main/project-agent-tools';
import type { LocalNotesVaultGrant } from '../src/shared/project-chat-contracts';

const projectId = '11111111-1111-4111-8111-111111111111';
const saved: LocalNotesVaultGrant = { id: 'a'.repeat(64), name: 'Research Notes' };

function fixture() {
  const vault = {
    descriptor: vi.fn((): LocalNotesVaultGrant | null => ({ ...saved })),
    matchesGrant: vi.fn(() => true),
    validateGrant: vi.fn(async () => {}),
    listForAgent: vi.fn(async () => {
      throw new Error('Must not enumerate notes');
    }),
    readForAgent: vi.fn(async () => {
      throw new Error('Must not read notes');
    }),
    saveMarkdownForAgent: vi.fn(async () => {
      throw new Error('Must not write notes');
    }),
  } satisfies ProjectAgentVault;
  return vault;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Project Chat saved notes capability preflight', () => {
  it('returns no grant without a provider or explicit saved grant, without inspecting notes', async () => {
    const vault = fixture();
    expect(await resolveProjectChatNotesGrant(undefined, projectId, saved)).toBeNull();
    expect(await resolveProjectChatNotesGrant(vault, projectId, null)).toBeNull();
    expect(await resolveProjectChatNotesGrant(vault, projectId, undefined)).toBeNull();
    expect(vault.descriptor).not.toHaveBeenCalled();
    expect(vault.validateGrant).not.toHaveBeenCalled();
  });

  it.each([undefined, false, true])(
    'preserves saved markdown-create permission %s; empty folders stay authorized',
    async (allowAgentMarkdownCreate) => {
      const vault = fixture();
      const grant = {
        ...saved,
        ...(allowAgentMarkdownCreate === undefined ? {} : { allowAgentMarkdownCreate }),
      };
      vault.descriptor.mockReturnValue({ ...saved, allowAgentMarkdownCreate: true });
      const resolved = await resolveProjectChatNotesGrant(vault, projectId, grant);
      expect(resolved).toEqual(grant);
      expect(resolved).not.toBe(grant);
      expect(vault.descriptor).toHaveBeenCalledTimes(2);
      expect(vault.matchesGrant).toHaveBeenNthCalledWith(1, projectId, grant.id);
      expect(vault.matchesGrant).toHaveBeenNthCalledWith(2, projectId, grant.id);
      expect(vault.validateGrant).toHaveBeenCalledExactlyOnceWith(projectId, grant.id);
      expect(vault.listForAgent).not.toHaveBeenCalled();
      expect(vault.readForAgent).not.toHaveBeenCalled();
      expect(vault.saveMarkdownForAgent).not.toHaveBeenCalled();
    },
  );

  it.each([null, { ...saved, id: 'b'.repeat(64) }, { ...saved, name: 'Different project folder' }])(
    'rejects absent or mismatched current descriptor %j',
    async (descriptor) => {
      const vault = fixture();
      vault.descriptor.mockReturnValue(descriptor);
      expect(await resolveProjectChatNotesGrant(vault, projectId, saved)).toBeNull();
      expect(vault.validateGrant).not.toHaveBeenCalled();
    },
  );

  it('rejects stale binding before any asynchronous validation', async () => {
    const vault = fixture();
    vault.matchesGrant.mockReturnValue(false);
    expect(await resolveProjectChatNotesGrant(vault, projectId, saved)).toBeNull();
    expect(vault.validateGrant).not.toHaveBeenCalled();
  });

  it.each(['descriptor', 'matchesGrant', 'validateGrant'] as const)(
    'fails closed when %s throws',
    async (method) => {
      const vault = fixture();
      vault[method].mockImplementation(() => {
        throw new Error('private filesystem error');
      });
      expect(await resolveProjectChatNotesGrant(vault, projectId, saved)).toBeNull();
    },
  );

  it('fails closed when filesystem grant validation rejects', async () => {
    const vault = fixture();
    vault.validateGrant.mockRejectedValue(new Error('vault_root_changed'));
    expect(await resolveProjectChatNotesGrant(vault, projectId, saved)).toBeNull();
    expect(vault.descriptor).toHaveBeenCalledTimes(1);
  });

  it.each(['id', 'name', 'binding', 'permission'] as const)(
    'rechecks %s after asynchronous validation instead of returning a stale capability',
    async (change) => {
      const vault = fixture();
      const grant = { ...saved, allowAgentMarkdownCreate: false };
      vault.validateGrant.mockImplementation(async () => {
        if (change === 'id') vault.descriptor.mockReturnValue({ ...saved, id: 'b'.repeat(64) });
        if (change === 'name')
          vault.descriptor.mockReturnValue({ ...saved, name: 'Renamed notes' });
        if (change === 'binding') vault.matchesGrant.mockReturnValue(false);
        if (change === 'permission') grant.allowAgentMarkdownCreate = true;
      });
      expect(await resolveProjectChatNotesGrant(vault, projectId, grant)).toBeNull();
    },
  );

  it('times out at 1500ms, releases its timer, and never accepts a late successful validation', async () => {
    vi.useFakeTimers();
    const vault = fixture();
    let complete!: () => void;
    vault.validateGrant.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const resolved = vi.fn();
    const pending = resolveProjectChatNotesGrant(vault, projectId, saved).then(resolved);
    await vi.advanceTimersByTimeAsync(1499);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toHaveBeenCalledExactlyOnceWith(null);
    expect(vi.getTimerCount()).toBe(0);
    complete();
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toHaveBeenCalledExactlyOnceWith(null);
    expect(vault.descriptor).toHaveBeenCalledTimes(1);
    expect(vault.matchesGrant).toHaveBeenCalledTimes(1);
  });

  it('handles late rejection after a shorter timeout without unhandled rejection or note access', async () => {
    vi.useFakeTimers();
    const vault = fixture();
    let reject!: (error: Error) => void;
    vault.validateGrant.mockImplementation(
      () =>
        new Promise<void>((_resolve, decline) => {
          reject = decline;
        }),
    );
    const pending = resolveProjectChatNotesGrant(vault, projectId, saved, { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toBeNull();
    reject(new Error('late vault error'));
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    expect(vault.listForAgent).not.toHaveBeenCalled();
  });

  it('clears a pending timeout on successful preflight', async () => {
    vi.useFakeTimers();
    expect(await resolveProjectChatNotesGrant(fixture(), projectId, saved)).toEqual(saved);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([NaN, Infinity, -1, 0, 60_000])(
    'keeps invalid or longer timeout %s within the default bound',
    async (timeoutMs) => {
      vi.useFakeTimers();
      const vault = fixture();
      vault.validateGrant.mockImplementation(() => new Promise<void>(() => {}));
      const pending = resolveProjectChatNotesGrant(vault, projectId, saved, { timeoutMs });
      await vi.advanceTimersByTimeAsync(1500);
      expect(await pending).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
