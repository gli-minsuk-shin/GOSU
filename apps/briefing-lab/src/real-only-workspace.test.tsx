import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultLiveSettings } from '@gosu/briefing-core';
import { initialWorkspace } from './fixtures';
import { loadWorkspace, runFixture, saveWorkspace, BRIEFING_STORAGE_KEY } from './state';
import { BriefingApp } from './briefing-app';
vi.mock('./live-client', () => ({
  sourceRequest: vi.fn(async () => ({ history: [], preferences: {}, papers: [] })),
  collectSources: vi.fn(),
}));
vi.mock('./routine-client', () => ({ createRoutineClient: () => ({ models: async () => [] }) }));
const now = '2026-09-10T00:00:00Z';
afterEach(() => vi.unstubAllGlobals());
it('starts a real empty personal workspace without sample subscriptions, keywords or a funding demo', () => {
  const result = loadWorkspace({ getItem: () => null }, now);
  expect(result.workspace.routines).toHaveLength(1);
  expect(result.workspace.routines[0]?.sources).toEqual([]);
  expect(result.workspace.routines[0]?.interest.keywords).toEqual([]);
  expect(result.workspace.runs).toEqual([]);
});
it('migrates only explicit fixture records while preserving routine IDs, user sources, live settings and the legacy backup', () => {
  const seeded = runFixture(initialWorkspace(now), 'personal-research', now, 'demo-run');
  const base = {
    ...seeded,
    routines: seeded.routines.map((r, i) =>
      i
        ? r
        : {
            ...r,
            live: defaultLiveSettings(),
            name: 'My configured routine',
            sources: [
              ...r.sources,
              {
                id: 'user-paper',
                kind: 'papers' as const,
                label: 'My source',
                origin: 'user' as const,
                url: 'https://example.org/research',
              },
            ],
          },
    ),
  };
  const legacy = 'gosu.briefing-lab.fixture-workspace.v1';
  const raw = JSON.stringify(base);
  const values = new Map([[legacy, raw]]);
  const restored = loadWorkspace({ getItem: (key) => values.get(key) ?? null }, now).workspace;
  expect(restored.runs).toEqual([]);
  expect(restored.routines.map((r) => r.id)).toEqual(base.routines.map((r) => r.id));
  expect(restored.routines[0]?.live).toEqual(base.routines[0]?.live);
  expect(restored.routines[0]?.interest).toEqual(base.routines[0]?.interest);
  expect(restored.routines[0]?.sources.map((s) => s.id)).toEqual(['user-paper']);
  expect(
    saveWorkspace(
      {
        setItem: (key, value) => {
          values.set(key, value);
        },
      },
      restored,
    ),
  ).toBeNull();
  expect(BRIEFING_STORAGE_KEY).not.toBe(legacy);
  expect(values.get(legacy)).toBe(raw);
  expect(loadWorkspace({ getItem: (key) => values.get(key) ?? null }, now).workspace).toEqual(
    restored,
  );
});
it('does not recover stale demo state over a deliberately empty saved workspace', () => {
  const empty = { schemaVersion: 1, selectedRoutineId: '', routines: [], runs: [] };
  const values = new Map([
    [BRIEFING_STORAGE_KEY, JSON.stringify(empty)],
    ['gosu.briefing-lab.fixture-workspace.v1', JSON.stringify(initialWorkspace(now))],
  ]);
  expect(loadWorkspace({ getItem: (key) => values.get(key) ?? null }, now).workspace).toEqual(
    empty,
  );
});
it('removes sample generation, archive, reset and source pickers from every reachable app screen', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const workspace = runFixture(initialWorkspace(now), 'personal-research', now, 'old-demo');
  const run = vi.fn(),
    reset = vi.fn();
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        <BriefingApp workspace={workspace} onChange={vi.fn()} onRun={run} onReset={reset} />,
      );
    });
    const content = () => JSON.stringify(ui.toJSON());
    const clickText = async (label: string) => {
      await act(() =>
        ui.root
          .findAllByType('button')
          .find((n) => n.children.filter((c) => typeof c === 'string').join('') === label)!
          .props.onClick(),
      );
    };
    expect(content()).not.toContain('샘플 설정 초기화');
    await clickText('루틴 관리');
    expect(content()).not.toContain('샘플');
    await act(() =>
      ui.root.findByProps({ 'aria-label': `${workspace.routines[0]!.name} 설정` }).props.onClick(),
    );
    expect(content()).not.toContain('샘플');
    expect(content()).not.toContain('샘플 브리핑 만들기');
    expect(run).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  } finally {
    await act(() => ui?.unmount());
  }
});
