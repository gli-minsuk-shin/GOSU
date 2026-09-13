import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
import { AppleMailConnection, type runAppleMail } from './live-mail';
import { LiveSourceService } from './live-source-service';
import { mailSummaryKey } from './briefing-mail-ingestion';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function fixture(limit = 50) {
  const dir = await mkdtemp(join(tmpdir(), 'mail-ingestion-test-'));
  dirs.push(dir);
  const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 5));
  const date = new Date(Date.now() - 3_600_000).toISOString();
  const read = vi.fn<typeof runAppleMail>(async (q) => {
    if (q.action === 'discover')
      return {
        limited: false,
        accounts: [
          {
            id: 'native-a',
            name: 'Synthetic',
            mailboxes: [{ path: ['Inbox'], name: 'Inbox' }],
            limited: false,
            unavailable: false,
          },
        ],
      };
    if (q.action !== 'read') throw Error('Unexpected request');
    const messages = Array.from({ length: 120 }, (_, i) => ({
      id: String(i),
      title: 'Same subject',
      sender: 'Sender',
      date,
      unread: true,
      preview: 'PRIVATE_SYNTHETIC_BODY',
      bodyUnavailable: false,
    }));
    const selected = messages.filter(
      (m) =>
        !q.excludeKeys?.includes(
          mailSummaryKey(digest([q.accountId, q.path, m.id]), m.date, m.title),
        ),
    );
    return {
      account: { id: 'native-a', name: 'Synthetic', addresses: ['a@example.test'] },
      messages: selected.slice(0, q.scope.limit),
      scanned: 120,
      capped: true,
      skipped: messages.length - selected.length,
    };
  });
  const mail = new AppleMailConnection(read),
    signal = new AbortController().signal;
  const catalog = await mail.discover(signal),
    account = catalog.accounts[0]!;
  const scope = {
    accountId: account.id,
    mailboxId: account.mailboxes[0]!.id,
    days: 3,
    limit,
    subject: '',
    sender: '',
    unreadOnly: false,
    bodyPreview: true,
  };
  const live = {
    ...defaultLiveSettings(),
    mail: scope,
    papers: { enabled: false, scholarAlerts: false, days: 3, limit: 10, author: '' },
  };
  const profile = await owner(() =>
    store.save(
      {
        routineId: 'r',
        name: 'Synthetic',
        timeZone: 'Asia/Seoul',
        live,
        interest: { keywords: [], excluded: [] },
        preferences: { ...defaultAssistantPreferences(), mailRead: true, mailAi: true },
      },
      async () => undefined,
    ),
  );
  const service = new LiveSourceService(
    mail,
    undefined,
    async () => undefined,
    undefined,
    undefined,
    store,
  );
  const collect = (controller = new AbortController(), persist = true) =>
    owner(() =>
      service.collect(
        { routineId: 'r', live, interest: { keywords: [], excluded: [] } },
        controller.signal,
        () => undefined,
        persist,
      ),
    );
  return { dir, store, read, profile, collect, scope, date };
}
it.each([50, 100])(
  'returns three initially then up to %i, persists state, skips saved summaries, and permits explicit refresh',
  async (limit) => {
    const f = await fixture(limit);
    const first = (await f.collect())[0]!;
    expect(first.items).toHaveLength(3);
    expect(first.notice).toContain('첫 연결');
    expect(first.notice).toContain('최대 3개');
    expect(JSON.stringify(first)).not.toContain('excludeKeys');
    expect(JSON.stringify(first)).not.toContain('completedAccounts');
    expect((await f.store.history('r'))[0]?.snapshot?.sources[0]?.notice).toBe(first.notice);
    const reopened = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 5));
    expect((await owner(() => reopened.mailReadPlan('r', f.scope))).initial).toBe(false);
    // A successful read without a saved summary must not create a skip marker.
    expect((await owner(() => reopened.mailReadPlan('r', f.scope))).excludeKeys).toEqual([]);
    await f.store.saveBriefing(
      'r',
      {
        overview: 'Completed',
        items: first.items.map((item) => ({
          id: item.id,
          summary: 'Saved AI summary',
          importance: 'medium' as const,
          importanceReason: '',
          relevance: '',
          action: '',
          evidenceQuote: 'PRIVATE_SYNTHETIC_BODY',
          equationIds: [],
          figureIds: [],
          memorySuggestion: null,
        })),
      },
      first.items,
      true,
      f.profile,
    );
    const next = (await f.collect())[0]!;
    expect(next.items).toHaveLength(limit);
    expect(next.items.every((i) => !first.items.some((old) => old.id === i.id))).toBe(true);
    expect(next.notice).toContain('동일 메일 3개');
    const refreshed = (await f.collect(new AbortController(), false))[0]!;
    expect(refreshed.items.some((i) => i.id === first.items[0]!.id)).toBe(true);
    expect(refreshed.notice).toBeUndefined();
    expect(await readFile(join(f.dir, 'workspace.v1.enc.json'), 'utf8')).not.toContain(
      'PRIVATE_SYNTHETIC_BODY',
    );
  },
);
it.each(['failure', 'cancel'] as const)(
  'does not consume first-connection state after %s',
  async (mode) => {
    const f = await fixture(),
      controller = new AbortController();
    f.read.mockImplementationOnce(async () => {
      if (mode === 'cancel') controller.abort();
      throw Error('mail_timeout_metadata');
    });
    if (mode === 'failure') expect((await f.collect(controller))[0]?.status).toBe('failed');
    else await expect(f.collect(controller)).rejects.toThrow();
    const retry = (await f.collect())[0]!;
    expect(retry.items).toHaveLength(3);
    expect(retry.notice).toContain('첫 연결');
  },
);
it('never commits onboarding or provides skip metadata after scope revocation or for another client', async () => {
  const f = await fixture();
  await expect(
    briefingClientContext.run('b'.repeat(64), () => f.store.mailReadPlan('r', f.scope)),
  ).rejects.toThrow('permission_required');
  await owner(() =>
    f.store.save(
      { ...f.profile, preferences: { ...f.profile.preferences, mailRead: false } },
      async () => undefined,
    ),
  );
  await expect(
    f.store.completeMailRead(f.profile, [f.scope.accountId], new AbortController().signal),
  ).rejects.toThrow('settings_changed');
});
