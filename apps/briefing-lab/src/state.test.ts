import { describe, expect, it, vi } from 'vitest';
import { fixtureEvidence, initialWorkspace } from './fixtures';
import { defaultLiveSettings } from '@gosu/briefing-core';
import { withoutSampleContent } from './workspace-defaults';
import {
  BRIEFING_STORAGE_KEY,
  loadWorkspace,
  MAX_SAVED_RUNS,
  runFixture,
  saveWorkspace,
} from './state';

const NOW = '2026-09-08T10:00:00.000Z';
describe('Briefing Lab fixture workspace', () => {
  it('persists actual source configuration per routine without saving source results or resetting legacy data', () => {
    const original = initialWorkspace(NOW);
    const live = {
      ...defaultLiveSettings(),
      weather: {
        id: 1,
        name: 'Selected city',
        latitude: 37,
        longitude: 127,
        country: 'KR',
        timeZone: 'Asia/Seoul',
      },
      papers: { enabled: true, days: 7, limit: 5, author: 'Author' },
    };
    const next = {
      ...original,
      routines: original.routines.map((r, index) => (index === 0 ? { ...r, live } : r)),
    };
    let saved = '';
    expect(
      saveWorkspace(
        {
          setItem: (_key, value) => {
            saved = value;
          },
        },
        next,
      ),
    ).toBeNull();
    const restored = loadWorkspace({ getItem: () => saved }, NOW);
    expect(restored.workspace.routines[0]!.live).toEqual(live);
    expect(restored.workspace.routines[1]).toEqual(withoutSampleContent(original).routines[1]);
    expect(restored.workspace.runs).toEqual([]);
    expect(saved).not.toContain('fetchedAt');
    expect(saved).not.toContain('mail-preview');
  });
  it('opens one empty draft without starting a run, using no account or location data', () => {
    const read = vi.fn(() => null);
    const result = loadWorkspace({ getItem: read }, NOW);
    expect(read).toHaveBeenCalledWith(BRIEFING_STORAGE_KEY);
    expect(result.error).toBeNull();
    expect(result.writable).toBe(true);
    expect(result.workspace.routines.map((r) => [r.kind, r.state, r.schedule.times])).toEqual([
      ['personal', 'draft', ['08:00']],
    ]);
    expect(result.workspace.routines.every((r) => r.countries.length === 0)).toBe(true);
    expect(result.workspace.runs).toEqual([]);
  });
  it('persists edits and intentionally removed sources without reseeding on refresh', () => {
    const original = initialWorkspace(NOW);
    const next = {
      ...original,
      routines: original.routines.map((r, i) =>
        i === 0
          ? {
              ...r,
              name: '나의 주간 연구',
              sources: [],
              schedule: { ...r.schedule, frequency: 'weekly' as const, times: ['11:30'] },
            }
          : r,
      ),
    };
    let persisted = '';
    expect(
      saveWorkspace(
        {
          setItem: (key, value) => {
            expect(key).toBe(BRIEFING_STORAGE_KEY);
            persisted = value;
          },
        },
        next,
      ),
    ).toBeNull();
    const restored = loadWorkspace({ getItem: () => persisted }, NOW);
    expect(restored.workspace).toEqual(withoutSampleContent(next));
    expect(restored.workspace.routines[1]).toEqual(withoutSampleContent(original).routines[1]);
    expect(restored.workspace.runs).toEqual([]);
  });
  it('preserves unreadable original data rather than silently replacing it', () => {
    const raw = '{ broken json';
    const result = loadWorkspace({ getItem: () => raw }, NOW);
    expect(result.writable).toBe(false);
    expect(result.error).toContain('원본은 보존');
    expect(result.workspace.runs).toEqual([]);
  });
  it('reports blocked storage and quota failures without claiming persistence', () => {
    expect(
      loadWorkspace(
        {
          getItem: () => {
            throw new Error('blocked');
          },
        },
        NOW,
      ).writable,
    ).toBe(false);
    expect(
      saveWorkspace(
        {
          setItem: () => {
            throw new Error('quota');
          },
        },
        initialWorkspace(NOW),
      ),
    ).toContain('저장하지 못했습니다');
  });
  it('rejects invalid data before writing and rejects oversized restore payloads', () => {
    const write = vi.fn();
    expect(
      saveWorkspace({ setItem: write }, { ...initialWorkspace(NOW), selectedRoutineId: 'missing' }),
    ).not.toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(loadWorkspace({ getItem: () => 'x'.repeat(4_000_001) }, NOW).writable).toBe(false);
  });
  it('runs only the selected routine and preserves immutable settings/history across later edits', () => {
    const original = initialWorkspace(NOW);
    const one = runFixture(original, 'personal-research', NOW, 'first');
    expect(original.runs).toEqual([]);
    expect(one.runs[0]?.mode).toBe('fixture');
    expect(one.runs[0]?.routineId).toBe('personal-research');
    expect(
      one.runs[0]?.items.every(
        (i) => i.evidence.readScope === 'fixture' && i.evidence.kind !== 'funding',
      ),
    ).toBe(true);
    expect(one.runs[0]?.items.some((i) => i.evidence.id === 'demo-task-no-deadline')).toBe(false);
    expect(one.runs[0]?.items.some((i) => i.evidence.id === 'demo-task')).toBe(true);
    const changed = {
      ...one,
      routines: one.routines.map((r, i) =>
        i === 0
          ? {
              ...r,
              sources: [],
              interest: { keywords: [], excluded: [] },
              schedule: { ...r.schedule, times: ['12:00'] },
            }
          : r,
      ),
    };
    const two = runFixture(changed, 'funding-research', NOW, 'second');
    expect(two.runs[0]).toEqual(one.runs[0]);
    expect(two.runs[0]?.scheduleSnapshot.times).toEqual(['08:00']);
    expect(two.runs[1]?.items.every((i) => i.evidence.kind === 'funding')).toBe(true);
    // Historical source references remain valid after removing a subscription.
    expect(saveWorkspace({ setItem: vi.fn() }, two)).toBeNull();
  });
  it('does not duplicate an already applied run and bounds history storage', () => {
    let workspace = initialWorkspace(NOW);
    workspace = runFixture(workspace, 'personal-research', NOW, 'same');
    expect(runFixture(workspace, 'personal-research', NOW, 'same')).toBe(workspace);
    for (let i = 0; i < MAX_SAVED_RUNS; i++)
      workspace = runFixture(workspace, 'personal-research', NOW, `bounded-${i}`);
    expect(workspace.runs).toHaveLength(MAX_SAVED_RUNS);
    expect(workspace.runs[0]?.id).toBe('bounded-0');
    expect(saveWorkspace({ setItem: vi.fn() }, workspace)).toBeNull();
  });
  it('rejects execution of a missing routine and keeps every fixture explicitly synthetic', () => {
    expect(() => runFixture(initialWorkspace(NOW), 'missing', NOW, 'run')).toThrow(
      'routine_not_found',
    );
    expect(fixtureEvidence(NOW).every((e) => e.readScope === 'fixture')).toBe(true);
    expect(fixtureEvidence(NOW).some((e) => /ICLR.*실제/.test(e.summary))).toBe(true);
  });
});
