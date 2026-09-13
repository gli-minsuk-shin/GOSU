import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultLiveSettings, defaultAssistantPreferences } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-remove-test-'));
  dirs.push(dir);
  const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 5));
  for (const routineId of ['a', 'b'])
    await owner(() =>
      store.save(
        {
          routineId,
          name: 'Synthetic',
          timeZone: 'Asia/Seoul',
          live: defaultLiveSettings(),
          interest: { keywords: [], excluded: [] },
          preferences: defaultAssistantPreferences(),
        },
        async () => undefined,
      ),
    );
  return { store, dir };
}
const summary = (id: string) => ({
  overview: 'Summary',
  items: [
    {
      id,
      summary: 'Synthetic saved summary',
      importance: 'medium' as const,
      importanceReason: '',
      relevance: '',
      action: '',
      evidenceQuote: '',
      equationIds: [],
      figureIds: [],
      memorySuggestion: null,
    },
  ],
});
it('removes one exact run including its split batches, preserves other runs and the paper library, and restores across restart', async () => {
  const f = await fixture(),
    runId = randomUUID(),
    other = randomUUID(),
    signal = new AbortController().signal;
  const profile = await f.store.profile('a');
  await f.store.saveCollection('a', runId, [], profile, signal);
  const anchor = await f.store.saveBriefing(
    'a',
    summary('paper'),
    [{ id: 'paper', title: 'Paper', kind: 'papers', readScope: 'abstract' }],
    false,
    profile,
    undefined,
    runId,
  );
  await f.store.saveBriefing(
    'a',
    summary('email'),
    [{ id: 'email', title: 'Email', kind: 'email', readScope: 'mail-metadata' }],
    true,
    profile,
    undefined,
    runId,
  );
  await f.store.saveCollection('a', other, [], profile, signal);
  await f.store.saveCollection('b', runId, [], await f.store.profile('b'), signal);
  const receipt = await owner(() =>
    f.store.removeHistoryRun({ routineId: 'a', historyId: anchor! }, signal),
  );
  expect(receipt.historyIds).toHaveLength(3);
  expect(
    (await owner(() => f.store.removeHistoryRun({ routineId: 'a', runId }, signal))).deletionId,
  ).toBe(receipt.deletionId);
  expect(await f.store.historyRecord('a', anchor!)).toBeNull();
  expect((await f.store.history('a')).map((h) => h.runId)).toEqual([other]);
  expect(await f.store.history('b')).toHaveLength(1);
  expect(
    (await f.store.summaryHistory('a')).some((h) => h.items.some((i) => i.id === 'paper')),
  ).toBe(true);
  expect(
    (await f.store.summaryHistory('a')).some((h) => h.items.some((i) => i.id === 'email')),
  ).toBe(false);
  await f.store.saveBriefing(
    'a',
    summary('late'),
    [{ id: 'late', title: 'Late email', kind: 'email', readScope: 'mail-metadata' }],
    true,
    profile,
    undefined,
    runId,
  );
  expect(await f.store.history('a')).toHaveLength(1);
  const reopened = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 5));
  expect(await owner(() => reopened.removedBriefings('a'))).toHaveLength(1);
  await owner(() => reopened.restoreHistoryRun('a', receipt.deletionId, signal));
  expect(await reopened.history('a')).toHaveLength(5);
  expect(await owner(() => reopened.removedBriefings('a'))).toHaveLength(0);
});
it('rejects another browser, another routine and cancellation, and does not group legacy records by timestamp', async () => {
  const f = await fixture(),
    signal = new AbortController().signal;
  const a = await f.store.saveBriefing('a', summary('one'), [
    { id: 'one', title: 'One', kind: 'email', readScope: 'mail-metadata' },
  ]);
  await f.store.saveBriefing('a', summary('two'), [
    { id: 'two', title: 'Two', kind: 'email', readScope: 'mail-metadata' },
  ]);
  await expect(
    briefingClientContext.run('b'.repeat(64), () =>
      f.store.removeHistoryRun({ routineId: 'a', historyId: a! }, signal),
    ),
  ).rejects.toThrow('client_required');
  await expect(
    owner(() => f.store.removeHistoryRun({ routineId: 'b', historyId: a! }, signal)),
  ).rejects.toThrow('history_item_missing');
  const abort = new AbortController();
  abort.abort();
  await expect(
    owner(() => f.store.removeHistoryRun({ routineId: 'a', historyId: a! }, abort.signal)),
  ).rejects.toThrow('cancelled');
  const removed = await owner(() =>
    f.store.removeHistoryRun({ routineId: 'a', historyId: a! }, signal),
  );
  expect(removed.historyIds).toEqual([a]);
  expect(await f.store.history('a')).toHaveLength(1);
  const retry = await owner(() =>
    f.store.removeHistoryRun({ routineId: 'a', historyId: a! }, signal),
  );
  expect(retry.deletionId).toBe(removed.deletionId);
  await owner(() => f.store.restoreHistoryRun('a', removed.deletionId, signal));
  const next = await owner(() =>
    f.store.removeHistoryRun({ routineId: 'a', historyId: a! }, signal),
  );
  expect(next.deletionId).not.toBe(removed.deletionId);
  await expect(
    owner(() => f.store.restoreHistoryRun('a', removed.deletionId, signal)),
  ).rejects.toThrow('history_item_missing');
});
it('keeps completed-mail exclusion after a run is removed, without returning the deleted email in History or AI detail reads', async () => {
  const f = await fixture(),
    signal = new AbortController().signal;
  const scope = {
    accountId: 'account',
    mailboxId: 'inbox',
    days: 3,
    limit: 50,
    subject: '',
    sender: '',
    unreadOnly: false,
    bodyPreview: true,
  };
  const profile = await f.store.profile('a');
  await owner(() =>
    f.store.save(
      {
        ...profile!,
        live: { ...profile!.live, mail: scope },
        preferences: { ...profile!.preferences, mailRead: true },
      },
      async () => undefined,
    ),
  );
  const id = 'a'.repeat(64);
  const anchor = await f.store.saveBriefing('a', summary(id), [
    {
      id,
      title: 'Synthetic email',
      kind: 'email',
      readScope: 'mail-preview',
      publishedAt: '2026-09-10T00:00:00Z',
      mailAccount: { id: 'account', name: 'Synthetic', addresses: [] },
    },
  ]);
  const before = await owner(() => f.store.mailReadPlan('a', scope));
  expect(before.excludeKeys).toHaveLength(1);
  await owner(() => f.store.removeHistoryRun({ routineId: 'a', historyId: anchor! }, signal));
  expect((await owner(() => f.store.mailReadPlan('a', scope))).excludeKeys).toEqual(
    before.excludeKeys,
  );
  expect(await f.store.history('a')).toEqual([]);
  expect(await f.store.historyRecord('a', anchor!)).toBeNull();
  expect(await f.store.summaryHistory('a')).toEqual([]);
});
