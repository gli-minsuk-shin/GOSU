import { describe, it, expect } from 'vitest';
import { openBriefingVault, saveBriefingVault, BRIEFING_MEMORY_KEY } from './briefing-memory-vault';
import {
  relatedBriefingMemory,
  rememberBriefingEntry,
  prioritizeBriefingItems,
  type BriefingMemory,
} from './briefing-intelligence';
const memory: BriefingMemory = {
  version: 1,
  entries: [
    {
      id: 'a',
      routineId: 'one',
      kind: 'preference',
      text: 'Prefer reproducible optimization research',
      sourceId: 'user',
      createdAt: '2026-09-09T00:00:00Z',
    },
    {
      id: 'b',
      routineId: 'two',
      kind: 'project',
      text: 'Other private project',
      sourceId: 'other',
      createdAt: '2026-09-09T00:00:00Z',
    },
  ],
};
describe('Briefing encrypted memory', () => {
  it('orders reviewed importance within a section without mutating source receipts', () => {
    const items = [{ id: 'low' }, { id: 'high' }, { id: 'new' }];
    const insights = {
      overview: 'test',
      items: [
        { id: 'low', importance: 'low' as const },
        { id: 'high', importance: 'high' as const },
      ].map((item) => ({
        ...item,
        summary: 'summary',
        importanceReason: 'reason',
        relevance: 'relevance',
        action: '',
        evidenceQuote: 'source',
        equationIds: [],
        figureIds: [],
        memorySuggestion: null,
      })),
    };
    expect(prioritizeBriefingItems(items, insights).map((i) => i.id)).toEqual([
      'high',
      'low',
      'new',
    ]);
    expect(items.map((i) => i.id)).toEqual(['low', 'high', 'new']);
  });
  it('replaces reviewed snapshots without accumulating contradictory project versions and never silently evicts memory', () => {
    const full: BriefingMemory = {
      version: 1,
      entries: Array.from({ length: 300 }, (_, i) => ({
        ...memory.entries[0]!,
        id: String(i),
        sourceId: String(i),
      })),
    };
    expect(() => rememberBriefingEntry(full, { ...memory.entries[0]!, sourceId: 'new' })).toThrow(
      '300',
    );
    expect(full.entries).toHaveLength(300);
    const replaced = rememberBriefingEntry(full, {
      ...full.entries[0]!,
      text: 'Reviewed replacement',
    });
    expect(replaced.entries).toHaveLength(300);
    expect(replaced.entries.at(-1)!.text).toBe('Reviewed replacement');
  });
  it('roundtrips encryption, never persists plaintext/password, rejects wrong keys and preserves ciphertext', async () => {
    let saved: string | null = null;
    const storage = {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    };
    const vault = await openBriefingVault(storage, 'synthetic-test-password');
    await saveBriefingVault(storage, vault, memory);
    expect(saved).not.toContain('reproducible');
    expect(saved).not.toContain('synthetic-test-password');
    expect((await openBriefingVault(storage, 'synthetic-test-password')).memory).toEqual(memory);
    const before = saved;
    await expect(openBriefingVault(storage, 'wrong-test-password')).rejects.toThrow('보존');
    expect(saved).toBe(before);
    expect(BRIEFING_MEMORY_KEY).not.toContain('model-lab');
  });
  it('rejects stale-tab saves instead of silently losing learned memory', async () => {
    let saved: string | null = null;
    const storage = {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    };
    const a = await openBriefingVault(storage, 'synthetic-test-password');
    await saveBriefingVault(storage, a, memory);
    const b = await openBriefingVault(storage, 'synthetic-test-password');
    await saveBriefingVault(storage, a, { version: 1, entries: [] });
    await expect(saveBriefingVault(storage, b, memory)).rejects.toThrow('다른 창');
  });
  it('retrieves only the selected routine memory and respects bounds', () => {
    expect(relatedBriefingMemory(memory, 'one', 'optimization').map((e) => e.id)).toEqual(['a']);
  });
});
