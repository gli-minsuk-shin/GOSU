import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
const dirs: string[] = [];
const owner = <T>(fn: () => T) => briefingClientContext.run('d'.repeat(64), fn);
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
it('reuses one local-day run and preserves its first weather/calendar while allowing a fresh run after midnight', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-daily-'));
  dirs.push(dir);
  const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 5));
  const p = await owner(() =>
    store.save(
      {
        routineId: 'r',
        name: 'Fixture',
        timeZone: 'Asia/Seoul',
        live: defaultLiveSettings(),
        interest: { keywords: [], excluded: [] },
        preferences: defaultAssistantPreferences(),
      },
      async () => undefined,
    ),
  );
  const c = new AbortController();
  const other = await owner(() => store.save({ ...p, routineId: 'other' }, async () => undefined));
  await owner(() => store.dailyRun(other, c.signal, '2026-09-09T23:00:00Z'));
  const first = await owner(() => store.dailyRun(p, c.signal, '2026-09-10T00:00:00Z'));
  const weather = {
    city: 'Fixture',
    timeZone: p.timeZone,
    localDate: '2026-09-10',
    currentTime: '2026-09-10T00:00:00Z',
    temperature: 20,
    code: 1,
    wind: 1,
    hours: [],
  };
  const collection = (temperature: number) => [
    {
      kind: 'weather' as const,
      status: 'ready' as const,
      fetchedAt: '2026-09-10T00:00:00Z',
      note: '',
      items: [
        {
          id: 'w',
          kind: 'weather' as const,
          title: 'Weather',
          source: 'Fixture',
          text: '',
          readScope: 'forecast' as const,
          details: [],
          weather: { ...weather, temperature },
        },
      ],
    },
  ];
  await store.saveCollection('r', first.runId, collection(20), p, c.signal);
  await store.saveAgendaSnapshot('r', first.runId, [], p, c.signal, '2026-09-09T15:00:00Z');
  const second = await owner(() => store.dailyRun(p, c.signal, '2026-09-10T04:00:00Z'));
  expect((await store.history('r'))[0]?.snapshot?.newItemsSince).toBe('2026-09-10T04:00:00Z');
  await store.saveCollection('r', second.runId, collection(28), p, c.signal);
  const next = await owner(() => store.dailyRun(p, c.signal, '2026-09-10T15:00:00Z'));
  expect(first.runId).toBe(second.runId);
  expect(next.runId).not.toBe(first.runId);
  expect(first.date).toBe('2026-09-10');
  expect(next.date).toBe('2026-09-11');
  expect(second).toMatchObject({ hasWeather: true, hasCalendar: true });
  const sameDay = (await store.history('r')).filter((h) => h.runId === first.runId);
  expect(sameDay).toHaveLength(1);
  expect(sameDay[0]?.snapshot?.weather?.temperature).toBe(20);
  expect(sameDay[0]?.snapshot?.calendar).toEqual([]);
  expect(sameDay[0]?.snapshot?.newItemsSince).toBe('2026-09-10T15:00:00Z');
  const reopened = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 5));
  expect((await reopened.history('other'))[0]?.snapshot?.newItemsSince).toBe(
    '2026-09-09T23:00:00Z',
  );
  expect(
    (await reopened.history('r')).every(
      (h) => h.snapshot?.newItemsSince === '2026-09-10T15:00:00Z',
    ),
  ).toBe(true);
});
