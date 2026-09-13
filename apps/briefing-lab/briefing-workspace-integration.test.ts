import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LiveSourceService } from './live-source-service';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { BriefingMemoryStore } from './briefing-memory-store';
import { CalendarService } from './calendar-service';
import { AppleMailConnection } from './live-mail';
import { briefingClientContext } from './briefing-client-context';
import { SharedPaperSummaryLibrary } from './paper-summary-library';
import { paperSummaryCandidate } from './src/paper-summary-contract';
import { defaultLiveSettings, defaultAssistantPreferences } from '@gosu/briefing-core';
import type { markOriginalMailRead, readOriginalMailStatus } from './briefing-mail-mark-read';
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const scope = {
  accountId: 'a',
  mailboxId: 'box',
  days: 3,
  limit: 10,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: true,
};
const owner = <T>(f: () => T) => briefingClientContext.run('a'.repeat(64), f);
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-service-test-'));
  dirs.push(dir);
  const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 3)),
    mail = new AppleMailConnection(),
    calendar = new CalendarService(),
    consent = vi.fn(async () => undefined),
    memory = new BriefingMemoryStore(dir, async () => Buffer.alloc(32, 3));
  const analyzer = vi.fn(async () => ({
    overview: 'test',
    items: [],
    invocation: { providerId: 'codex', model: 'test', reasoning: 'high' },
    memoryUsed: [],
  }));
  const openMail = vi.fn(async (_url: string, _signal: AbortSignal) => undefined);
  const markMail = vi
    .fn<typeof markOriginalMailRead>()
    .mockImplementation(async (_scope, _id, _url, _signal, guard) => {
      await guard();
      return { status: 'read', markedAt: '2026-09-10T00:00:00Z' };
    });
  const checkMail = vi
    .fn<typeof readOriginalMailStatus>()
    .mockImplementation(async (_scope, _id, _url, _signal, guard) => {
      await guard();
      return { status: 'read', markedAt: '2026-09-10T01:00:00Z' };
    });
  const service = new LiveSourceService(
    mail,
    { cities: async () => [], weather: async () => [], papers: async () => [] },
    consent,
    analyzer,
    memory,
    store,
    calendar,
    undefined,
    openMail,
    markMail,
    checkMail,
  );
  const p = {
    routineId: 'r',
    name: 'test',
    timeZone: 'Asia/Seoul',
    live: { ...defaultLiveSettings(), mail: scope },
    interest: { keywords: [], excluded: [] },
    preferences: {
      ...defaultAssistantPreferences(),
      mailRead: true,
      mailAi: true,
      calendarRead: true,
      calendarIds: ['cal'],
    },
  };
  await owner(() => store.save(p, async () => undefined));
  const invoke = async (path: string, body: unknown, client = 'a') => {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), {
      method: 'POST',
      url: `/api/briefing-agent/sources${path}`,
      headers: { 'content-type': 'application/json' },
    }) as IncomingMessage;
    let status = 0;
    const chunks: string[] = [];
    const res = {
      writeHead: (s: number) => {
        status = s;
      },
      flushHeaders: () => undefined,
      write: (v: string) => chunks.push(v),
      end: (v?: string) => {
        if (v) chunks.push(v);
      },
      destroyed: false,
    };
    await briefingClientContext.run(client.repeat(64), () =>
      service.handle(req, res as unknown as ServerResponse, new AbortController().signal),
    );
    return { status, data: chunks.join('') ? JSON.parse(chunks.join('')) : null };
  };
  return {
    dir,
    store,
    mail,
    calendar,
    consent,
    service,
    p,
    invoke,
    analyzer,
    memory,
    openMail,
    markMail,
    checkMail,
  };
}
it('reconnects the saved scope after native approval without asking for account configuration again', async () => {
  const f = await setup();
  expect(
    (await f.invoke('/assistant/settings/connection-status', { routineId: 'r' }, 'b')).data
      .needsApproval,
  ).toBe(true);
  const before = await f.store.profile('r');
  expect((await f.invoke('/assistant/settings/reconnect', { routineId: 'r' }, 'b')).status).toBe(
    200,
  );
  expect(f.consent).toHaveBeenCalledOnce();
  expect((await f.store.profile('r'))?.live).toEqual(before?.live);
  expect(
    (await f.invoke('/assistant/settings/connection-status', { routineId: 'r' }, 'b')).data
      .needsApproval,
  ).toBe(false);
  await f.invoke('/assistant/settings/reconnect', { routineId: 'r' }, 'b');
  expect(f.consent).toHaveBeenCalledOnce();
});
it('does not acquire ownership when reconnect approval is declined', async () => {
  const f = await setup();
  f.consent.mockRejectedValueOnce(new Error('source_cancelled'));
  const before = await f.store.profile('r');
  expect(
    (await f.invoke('/assistant/settings/reconnect', { routineId: 'r' }, 'b')).status,
  ).not.toBe(200);
  expect(await f.store.profile('r')).toEqual(before);
});
it('rejects client-provided scope changes in the reconnect shortcut', async () => {
  const f = await setup();
  expect(
    (await f.invoke('/assistant/settings/reconnect', { routineId: 'r', live: {} }, 'b')).status,
  ).not.toBe(200);
  expect(f.consent).not.toHaveBeenCalled();
});
it('deletes/restores an owned whole run only after confirmation and cancels only its active summary job', async () => {
  const f = await setup(),
    runId = '11111111-1111-4111-8111-111111111111';
  const profile = await f.store.profile('r');
  await f.store.saveCollection('r', runId, [], profile, new AbortController().signal);
  const anchor = (await f.store.history('r'))[0]!;
  const state = f.service as unknown as {
    receipts: Map<string, unknown>;
    automaticSummaryJobs: Map<string, unknown>;
  };
  state.receipts.set(runId, {
    input: { routineId: 'r' },
    results: [],
    expiresAt: Date.now() + 60000,
  });
  const controller = new AbortController(),
    otherController = new AbortController();
  const job = {
    routineId: 'r',
    receiptId: runId,
    state: 'running',
    controller,
    results: ['old result'],
    updatedAt: 0,
  };
  state.automaticSummaryJobs.set('target', job);
  state.automaticSummaryJobs.set('other', {
    ...job,
    routineId: 'other',
    controller: otherController,
  });
  const input = { routineId: 'r', historyId: anchor.id, confirmed: true };
  expect((await f.invoke('/history/delete', { ...input, confirmed: false })).status).toBe(400);
  expect((await f.invoke('/history/delete', input, 'b')).status).toBe(400);
  expect(controller.signal.aborted).toBe(false);
  const removed = await f.invoke('/history/delete', input);
  expect(removed.status).toBe(200);
  expect(removed.data.historyIds).toEqual([anchor.id]);
  expect(controller.signal.aborted).toBe(true);
  expect(otherController.signal.aborted).toBe(false);
  expect(job.results).toEqual([]);
  expect(state.receipts.has(runId)).toBe(false);
  expect((await f.invoke('/history/list', { routineId: 'r' })).data.history).toEqual([]);
  expect((await f.invoke('/history/deleted', { routineId: 'r' }, 'b')).status).toBe(400);
  expect((await f.invoke('/history/deleted', { routineId: 'r' })).data.removed).toHaveLength(1);
  expect(
    (await f.invoke('/history/restore', { routineId: 'r', deletionId: removed.data.deletionId }))
      .status,
  ).toBe(200);
  expect(await f.store.history('r')).toHaveLength(1);
  expect(await f.store.profile('r')).toEqual(profile);
  expect(f.markMail).not.toHaveBeenCalled();
  expect(f.openMail).not.toHaveBeenCalled();
  expect(f.analyzer).not.toHaveBeenCalled();
  expect(f.consent).not.toHaveBeenCalled();
});
it('shares only explicitly approved cross-app paper analyses and does not change routine history or permissions', async () => {
  const f = await setup();
  const nativeLibrary = new SharedPaperSummaryLibrary(
    f.dir,
    async () => Buffer.alloc(32, 3),
    async (candidate) => [candidate],
  );
  f.service.sharedPaperLibrary = new SharedPaperSummaryLibrary(
    f.dir,
    async () => Buffer.alloc(32, 3),
    async (candidate) => [candidate],
  );
  const candidate = paperSummaryCandidate(
    'https://arxiv.org/abs/2609.00001v1 이 논문 분석해줘',
    '## 연구 질문\n검증용 논문을 분석합니다. '.repeat(4),
  )!;
  const before = await owner(() => f.store.profile('r'));
  expect((await f.invoke('/papers/shared/save', { candidate, confirmed: false })).status).not.toBe(
    200,
  );
  expect(await nativeLibrary.list()).toEqual([]);
  await nativeLibrary.save({ candidate, confirmed: true }, 'GOSU');
  const result = await f.invoke('/papers/saved', { routineId: 'r' });
  expect(result.status).toBe(200);
  expect(result.data.papers).toHaveLength(1);
  expect(result.data.papers[0].historyId).toMatch(/^shared:/);
  expect(result.data.papers[0].item.detail).toBe(candidate.markdown);
  expect(await owner(() => f.store.profile('r'))).toEqual(before);
  expect(await f.store.history('r')).toEqual([]);
  expect(f.analyzer).not.toHaveBeenCalled();
  expect(f.consent).not.toHaveBeenCalled();
  expect(
    (await f.invoke('/papers/shared/save', { candidate, confirmed: true })).data.alreadySaved,
  ).toBe(true);
  expect(await nativeLibrary.list()).toHaveLength(1);
});
it('lists saved paper versions locally, deduplicates copies and excludes email/private records when not allowed', async () => {
  const f = await setup();
  const insight = {
    id: 'p',
    summary: 'Saved paper',
    importance: 'high' as const,
    importanceReason: '',
    relevance: '',
    action: '',
    evidenceQuote: '',
    equationIds: [],
    figureIds: [],
    memorySuggestion: null,
  };
  const source = {
    id: 'p',
    kind: 'papers',
    title: 'Stored paper',
    readScope: 'abstract',
    sourceUrl: 'https://arxiv.org/abs/2609.00001v1',
  };
  await f.store.saveBriefing('r', { overview: 'Old', items: [insight] }, [source]);
  await f.store.saveBriefing('r', { overview: 'Copy', items: [insight] }, [source]);
  await f.store.saveBriefing('r', { overview: 'New version', items: [insight] }, [
    { ...source, sourceUrl: 'https://arxiv.org/abs/2609.00001v2' },
  ]);
  await f.store.saveBriefing(
    'r',
    { overview: 'Private', items: [{ ...insight, id: 'secret' }] },
    [
      {
        ...source,
        id: 'secret',
        title: 'Private paper',
        sourceUrl: 'https://arxiv.org/abs/2609.00002v1',
      },
    ],
    true,
  );
  await owner(() =>
    f.store.save(
      { ...f.p, preferences: { ...f.p.preferences, mailAi: false } },
      async () => undefined,
    ),
  );
  const read = vi.spyOn(f.mail, 'collect');
  const result = await f.invoke('/papers/saved', { routineId: 'r' });
  expect(result.status).toBe(200);
  expect(result.data.papers).toHaveLength(2);
  expect(result.data.privateOmitted).toBe(true);
  expect(
    result.data.papers.map((p: { item: { sourceUrl: string } }) => p.item.sourceUrl).sort(),
  ).toEqual([source.sourceUrl, 'https://arxiv.org/abs/2609.00001v2']);
  expect(JSON.stringify(result)).not.toContain('Private paper');
  expect(f.analyzer).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(f.consent).not.toHaveBeenCalled();
  expect((await f.invoke('/papers/saved', { routineId: 'r' }, 'b')).status).not.toBe(200);
});
async function mailOpenFixture(mode: 'always' | 'ask' | null = 'always') {
  const f = await setup();
  await owner(() =>
    f.store.save(
      {
        ...f.p,
        preferences: {
          ...f.p.preferences,
          mailOpenConfirmation: mode ?? undefined,
          mailRead: false,
          mailAi: false,
          calendarRead: false,
        },
      },
      async () => undefined,
    ),
  );
  const item = {
    id: 'm',
    kind: 'email' as const,
    title: 'Synthetic message',
    text: 'Synthetic',
    readScope: 'mail-metadata' as const,
    source: 'Mail',
    details: [],
    mailMessageUrl: 'message://%3Cfixture%40example.test%3E',
    mailNativeId: '42',
  };
  const historyId = await f.store.saveBriefing(
    'r',
    {
      overview: 'Saved',
      items: [
        {
          id: 'm',
          summary: 'Saved',
          importance: 'high',
          importanceReason: '',
          relevance: '',
          action: '',
          evidenceQuote: 'Synthetic',
          equationIds: [],
          figureIds: [],
          memorySuggestion: null,
        },
      ],
    },
    [item],
  );
  const receiptId = '11111111-1111-4111-8111-111111111111';
  const receipt = {
    input: { routineId: 'r', live: f.p.live, interest: f.p.interest },
    expiresAt: Date.now() + 60000,
    results: [{ items: [item] }],
  };
  (f.service as unknown as { receipts: Map<string, unknown> }).receipts.set(receiptId, receipt);
  return { ...f, item, receipt, receiptId, historyId: historyId! };
}
it.each(['live', 'history'] as const)(
  'opens only the exact owned %s mail source without repeated confirmation in always mode',
  async (source) => {
    const f = await mailOpenFixture();
    const read = vi.spyOn(f.mail, 'collect');
    const target = {
      routineId: 'r',
      itemId: 'm',
      ...(source === 'live' ? { receiptId: f.receiptId } : { historyId: f.historyId }),
    };
    expect(await f.invoke('/mail/open', target)).toEqual({
      status: 200,
      data: { status: 'requested' },
    });
    expect(f.openMail).toHaveBeenCalledWith(f.item.mailMessageUrl, expect.any(AbortSignal));
    expect(f.consent).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(f.analyzer).not.toHaveBeenCalled();
    expect((await f.invoke('/mail/open', target, 'b')).status).not.toBe(200);
    expect(
      (await f.invoke('/mail/open', { ...target, url: 'https://example.test' })).status,
    ).not.toBe(200);
    expect((await f.invoke('/mail/open', { ...target, itemId: 'other' })).status).not.toBe(200);
    expect(f.openMail).toHaveBeenCalledOnce();
  },
);
it.each(['live', 'history'] as const)(
  'marks only the explicit owned %s mail target read and persists a separate action timestamp',
  async (source) => {
    const f = await mailOpenFixture();
    await owner(() =>
      f.store.save(
        { ...f.p, preferences: { ...f.p.preferences, mailRead: true, mailAi: false } },
        async () => undefined,
      ),
    );
    vi.spyOn(f.mail, 'resolveMailbox').mockResolvedValue({
      accountId: 'native-account',
      path: ['Inbox'],
    });
    const target = {
      routineId: 'r',
      itemId: 'm',
      ...(source === 'live' ? { receiptId: f.receiptId } : { historyId: f.historyId }),
    };
    const result = await f.invoke('/mail/mark-read', target);
    expect(result.data).toEqual({ status: 'read', markedAt: '2026-09-10T00:00:00Z' });
    expect(f.markMail).toHaveBeenCalledOnce();
    expect(f.openMail).not.toHaveBeenCalled();
    expect(f.analyzer).not.toHaveBeenCalled();
    const history = await f.store.summaryHistory('r');
    expect(history.find((h) => h.id === f.historyId)?.items[0]?.mailMarkedReadAt).toBe(
      '2026-09-10T00:00:00Z',
    );
    expect(history.find((h) => h.id === f.historyId)?.items[0]?.summary).toBeTruthy();
  },
);
it('marks mail from the second approved account, rejects removed accounts and requires provenance for multiple accounts', async () => {
  const f = await mailOpenFixture();
  const multi = {
    ...f.p,
    live: {
      ...f.p.live,
      mail: { ...scope, additionalAccounts: [{ accountId: 'b', mailboxId: 'box-b' }] },
    },
  };
  await owner(() => f.store.save(multi, async () => undefined));
  const resolve = vi
    .spyOn(f.mail, 'resolveMailbox')
    .mockResolvedValue({ accountId: 'native-b', path: ['Inbox'] });
  const target = { routineId: 'r', itemId: 'm', receiptId: f.receiptId };
  // Historical items with no account attribution must not be guessed in a multi-account scope.
  expect((await f.invoke('/mail/mark-read', target)).status).not.toBe(200);
  Object.assign(f.item, { mailAccount: { id: 'b', name: 'Second', addresses: [] } });
  expect((await f.invoke('/mail/mark-read', target)).status).toBe(200);
  expect(resolve).toHaveBeenCalledWith(
    expect.objectContaining({ accountId: 'b', mailboxId: 'box-b' }),
    expect.any(AbortSignal),
  );
  await owner(() => f.store.save(f.p, async () => undefined));
  expect((await f.invoke('/mail/mark-read', target)).status).not.toBe(200);
  expect(f.markMail).toHaveBeenCalledTimes(1);
});
it('saves a hundred-message limit through the settings API, retains it on reload and explains invalid ranges', async () => {
  const f = await setup();
  const input = {
    routineId: 'r',
    name: f.p.name,
    timeZone: f.p.timeZone,
    interest: f.p.interest,
    live: { ...f.p.live, mail: { ...scope, limit: 100 }, assistant: f.p.preferences },
  };
  expect((await f.invoke('/assistant/settings/save', input)).status).toBe(200);
  const reloaded = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 3));
  expect((await reloaded.profile('r'))?.live.mail?.limit).toBe(100);
  const invalid = await f.invoke('/assistant/settings/save', {
    ...input,
    live: { ...input.live, mail: { ...input.live.mail, limit: 101 } },
  });
  expect(invalid.status).not.toBe(200);
  expect(invalid.data.error).toBe('메일 조회 개수는 1~100 사이의 정수로 입력해주세요.');
  expect((await reloaded.profile('r'))?.live.mail?.limit).toBe(100);
});
it('requires renewed scope approval for added accounts and persists the exact selection across store reloads', async () => {
  const f = await setup();
  const approve = vi.fn(async () => undefined);
  const next = {
    ...f.p,
    live: {
      ...f.p.live,
      mail: {
        ...scope,
        additionalAccounts: [{ accountId: 'b', mailboxId: 'box-b', accountName: 'Second account' }],
      },
    },
  };
  await owner(() => f.store.save(next, approve));
  expect(approve).toHaveBeenCalledOnce();
  expect(approve.mock.calls[0]).toEqual([expect.stringContaining('2개 계정')]);
  const reloaded = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 3));
  const persisted = (await reloaded.profile('r'))!;
  expect(persisted.live.mail?.additionalAccounts?.[0]).toMatchObject({
    accountId: 'b',
    mailboxId: 'box-b',
  });
  await expect(owner(() => reloaded.assertMail('r', scope))).rejects.toThrow(
    'assistant_mail_permission_required',
  );
  await expect(owner(() => reloaded.assertMail('r', persisted.live.mail!))).resolves.toBeTruthy();
});
it.each(['live', 'history'] as const)(
  'reconciles an uncertain %s action through read-only status and persists only verified read state',
  async (source) => {
    const f = await mailOpenFixture();
    await owner(() => f.store.save(f.p, async () => undefined));
    vi.spyOn(f.mail, 'resolveMailbox').mockResolvedValue({
      accountId: 'native-account',
      path: ['Inbox'],
    });
    const target = {
      routineId: 'r',
      itemId: 'm',
      ...(source === 'live' ? { receiptId: f.receiptId } : { historyId: f.historyId }),
    };
    f.markMail.mockRejectedValueOnce(Error('mail_mark_unconfirmed'));
    expect((await f.invoke('/mail/mark-read', target)).data.status).toBe('unconfirmed');
    expect((await f.store.summaryHistory('r'))[0]?.items[0]?.mailMarkedReadAt).toBeUndefined();
    f.checkMail.mockResolvedValueOnce({ status: 'unread' });
    expect((await f.invoke('/mail/read-status', target)).data).toEqual({ status: 'unread' });
    expect((await f.store.summaryHistory('r'))[0]?.items[0]?.mailMarkedReadAt).toBeUndefined();
    const confirmed = await f.invoke('/mail/read-status', target);
    expect(confirmed.data.status).toBe('read');
    expect(f.markMail).toHaveBeenCalledOnce();
    expect(f.checkMail).toHaveBeenCalledTimes(2);
    expect(f.checkMail.mock.calls[1]?.[6]).toBe('42');
    expect((await f.store.summaryHistory('r'))[0]?.items[0]?.mailMarkedReadAt).toBe(
      '2026-09-10T01:00:00Z',
    );
    expect((await f.invoke('/mail/read-status', { ...target, nativeId: '999' })).status).toBe(400);
    expect((await f.invoke('/mail/read-status', target, 'b')).status).toBe(400);
    expect(f.checkMail).toHaveBeenCalledTimes(2);
    expect(f.openMail).not.toHaveBeenCalled();
    expect(f.analyzer).not.toHaveBeenCalled();
  },
);
it('rejects foreign/expired/permission-denied mark-read requests and does not persist unconfirmed native writes', async () => {
  const f = await mailOpenFixture();
  await owner(() => f.store.save(f.p, async () => undefined));
  vi.spyOn(f.mail, 'resolveMailbox').mockResolvedValue({
    accountId: 'native-account',
    path: ['Inbox'],
  });
  const target = { routineId: 'r', itemId: 'm', receiptId: f.receiptId };
  expect((await f.invoke('/mail/mark-read', target, 'b')).status).not.toBe(200);
  expect(
    (await f.invoke('/mail/mark-read', { ...target, url: f.item.mailMessageUrl })).status,
  ).not.toBe(200);
  expect((await f.invoke('/mail/mark-read', { ...target, itemId: 'other' })).status).not.toBe(200);
  expect(f.markMail).not.toHaveBeenCalled();
  f.markMail.mockRejectedValueOnce(new Error('mail_mark_unconfirmed'));
  expect((await f.invoke('/mail/mark-read', target)).data.error).toContain('이미 반영됐을 수');
  expect((await f.store.summaryHistory('r'))[0]?.items[0]?.mailMarkedReadAt).toBeUndefined();
  f.receipt.expiresAt = 0;
  f.markMail.mockClear();
  expect((await f.invoke('/mail/mark-read', target)).status).not.toBe(200);
  expect(f.markMail).not.toHaveBeenCalled();
  await owner(() =>
    f.store.save(
      { ...f.p, preferences: { ...f.p.preferences, mailRead: false } },
      async () => undefined,
    ),
  );
  f.markMail.mockClear();
  expect((await f.invoke('/mail/mark-read', target)).status).not.toBe(200);
  expect(f.markMail).not.toHaveBeenCalled();
});
it('defaults legacy mail-open preferences to always and persists an explicit ask policy', async () => {
  const f = await mailOpenFixture(null);
  const before = await f.store.profile('r');
  expect(before!.preferences.mailOpenConfirmation).toBeUndefined();
  await f.invoke('/mail/open', { routineId: 'r', historyId: f.historyId, itemId: 'm' });
  expect(f.consent).not.toHaveBeenCalled();
  const approve = vi.fn(async () => undefined);
  const saved = await owner(() =>
    f.store.save(
      { ...f.p, preferences: { ...before!.preferences, mailOpenConfirmation: 'ask' } },
      approve,
    ),
  );
  expect(approve).not.toHaveBeenCalled();
  const reopened = new BriefingWorkspaceStore(dirs.at(-1)!, async () => Buffer.alloc(32, 3));
  expect((await reopened.profile('r'))?.preferences.mailOpenConfirmation).toBe('ask');
  expect(saved.preferences.mailRead).toBe(false);
  expect(saved.preferences.mailAi).toBe(false);
  await f.invoke('/mail/open', { routineId: 'r', historyId: f.historyId, itemId: 'm' });
  expect(f.consent).toHaveBeenCalledOnce();
});
it('honors ask cancellation and rechecks settings/source identity after confirmation', async () => {
  const f = await mailOpenFixture('ask');
  const target = { routineId: 'r', receiptId: f.receiptId, itemId: 'm' };
  f.consent.mockRejectedValueOnce(new Error('briefing_native_consent_denied'));
  expect((await f.invoke('/mail/open', target)).status).not.toBe(200);
  expect(f.openMail).not.toHaveBeenCalled();
  f.consent.mockImplementationOnce(async () => {
    f.item.mailMessageUrl = 'message://%3Cchanged%40example.test%3E';
  });
  expect((await f.invoke('/mail/open', target)).status).not.toBe(200);
  expect(f.openMail).not.toHaveBeenCalled();
  f.consent.mockImplementationOnce(async () => {
    await owner(() =>
      f.store.save(
        { ...f.p, preferences: { ...f.p.preferences, mailOpenConfirmation: 'always' } },
        async () => undefined,
      ),
    );
  });
  expect((await f.invoke('/mail/open', target)).status).not.toBe(200);
  expect(f.openMail).not.toHaveBeenCalled();
});
it('rejects expired live targets and does not replay simultaneous handoffs', async () => {
  const f = await mailOpenFixture();
  const target = { routineId: 'r', receiptId: f.receiptId, itemId: 'm' };
  f.receipt.expiresAt = 0;
  expect((await f.invoke('/mail/open', target)).status).not.toBe(200);
  expect(f.openMail).not.toHaveBeenCalled();
  f.receipt.expiresAt = Date.now() + 60000;
  let finish!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.openMail.mockImplementationOnce(async () => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const first = f.invoke('/mail/open', target);
  await ready;
  expect((await f.invoke('/mail/open', target)).status).not.toBe(200);
  finish();
  await first;
  expect(f.openMail).toHaveBeenCalledOnce();
});
it.each([
  { kind: 'papers' },
  { mailMessageUrl: 'https://example.test' },
  { mailMessageUrl: undefined },
])('rejects a non-mail or unverifiable source target %j', async (patch) => {
  const f = await mailOpenFixture();
  Object.assign(f.item, patch);
  expect(
    (await f.invoke('/mail/open', { routineId: 'r', receiptId: f.receiptId, itemId: 'm' })).status,
  ).not.toBe(200);
  expect(f.openMail).not.toHaveBeenCalled();
});
it.each(['email', 'papers'] as const)(
  'restores only current receipt %s votes without reading the source, writing memory or exposing titles',
  async (kind) => {
    const f = await setup();
    const item = {
      id: 'one',
      kind,
      title: 'Canonical private title',
      text: '',
      source: 'Fixture',
      readScope: kind === 'email' ? ('mail-metadata' as const) : ('abstract' as const),
      details: [],
    };
    await f.memory.feedback('r', item, 'important', new AbortController().signal);
    await f.memory.feedback(
      'r',
      { ...item, id: 'outside' },
      'not-interested',
      new AbortController().signal,
    );
    const receiptId = '11111111-1111-4111-8111-111111111111';
    (f.service as unknown as { receipts: Map<string, unknown> }).receipts.set(receiptId, {
      input: { routineId: 'r', live: f.p.live, interest: f.p.interest },
      expiresAt: Date.now() + 60000,
      results: [{ kind, status: 'ready', fetchedAt: '', note: '', items: [item] }],
    });
    const read = vi.spyOn(f.mail, 'collect');
    const before = await f.memory.status('r');
    const result = await f.invoke('/memory/feedback/choices', { routineId: 'r', receiptId });
    expect(result).toEqual({ status: 200, data: { choices: { one: 'important' } } });
    expect(JSON.stringify(result)).not.toContain('Canonical private title');
    expect(await f.memory.status('r')).toEqual(before);
    expect(read).not.toHaveBeenCalled();
    expect(f.analyzer).not.toHaveBeenCalled();
    expect(f.consent).not.toHaveBeenCalled();
    expect(
      (await f.invoke('/memory/feedback/choices', { routineId: 'r', receiptId }, 'b')).status,
    ).not.toBe(200);
    expect(
      (
        await f.invoke('/memory/feedback/choices', {
          routineId: 'r',
          receiptId,
          itemIds: ['outside'],
        })
      ).status,
    ).not.toBe(200);
    expect(
      (await f.invoke('/memory/feedback/choices', { routineId: 'other', receiptId })).status,
    ).not.toBe(200);
  },
);
it('rejects saved-vote lookup when its receipt expires or mail permission changes during lookup', async () => {
  const f = await setup(),
    receiptId = '11111111-1111-4111-8111-111111111111';
  const receipt = {
    input: { routineId: 'r', live: f.p.live, interest: f.p.interest },
    expiresAt: Date.now() - 1,
    results: [{ items: [{ id: 'm', kind: 'email' }] }],
  };
  (f.service as unknown as { receipts: Map<string, unknown> }).receipts.set(receiptId, receipt);
  expect(
    (await f.invoke('/memory/feedback/choices', { routineId: 'r', receiptId })).status,
  ).not.toBe(200);
  receipt.expiresAt = Date.now() + 60000;
  vi.spyOn(f.memory, 'feedbackChoices').mockImplementationOnce(async () => {
    await owner(() =>
      f.store.save(
        { ...f.p, preferences: { ...f.p.preferences, mailRead: false } },
        async () => undefined,
      ),
    );
    return { m: 'important' };
  });
  const result = await f.invoke('/memory/feedback/choices', { routineId: 'r', receiptId });
  expect(result.status).not.toBe(200);
  expect(result.data).not.toHaveProperty('choices');
});
it.each(['email', 'papers'] as const)(
  'saves %s history feedback without a live receipt and restores its choice without losing private taint',
  async (kind) => {
    const f = await setup();
    const source = {
      id: 'stored-item',
      kind,
      title: 'Canonical stored title',
      readScope: kind === 'email' ? 'mail-preview' : 'abstract',
    };
    const id = await f.store.saveBriefing(
      'r',
      {
        overview: 'Summary',
        items: [
          {
            id: source.id,
            summary: 'Stored summary',
            keywords: ['Canonical keyword'],
            importance: 'medium',
            importanceReason: 'Reason',
            relevance: '',
            action: 'Read',
            evidenceQuote: 'Quote',
            equationIds: [],
            figureIds: [],
            memorySuggestion: null,
          },
        ],
      },
      [source],
      true,
    );
    const request = { routineId: 'r', historyId: id, itemId: source.id, decision: 'important' };
    const saved = await f.invoke('/history/feedback', request);
    expect(saved.status).toBe(200);
    expect(saved.data.feedbackProfileRevision).toBe(1);
    expect(f.consent).not.toHaveBeenCalled();
    const entries = (await f.memory.review('r')).entries;
    expect(entries[0]).toMatchObject({
      private: true,
      feedbackDecision: 'important',
      feedbackTitle: 'Canonical stored title',
    });
    expect((await f.invoke('/history/list', { routineId: 'r' })).data.feedback).toEqual({
      'stored-item': 'important',
    });
    expect(
      await new BriefingMemoryStore(f.memory.directory, async () =>
        Buffer.alloc(32, 3),
      ).feedbackChoices('r', ['stored-item']),
    ).toEqual({ 'stored-item': 'important' });
    expect((await f.invoke('/history/feedback', request, 'b')).status).not.toBe(200);
    expect(
      (await f.invoke('/history/feedback', { ...request, title: 'Client injected title' })).status,
    ).not.toBe(200);
    expect(
      (await f.invoke('/history/feedback', { ...request, routineId: 'other' })).status,
    ).not.toBe(200);
    expect((await f.memory.feedbackProfile('r')).feedbackProfileRevision).toBe(1);
    expect(f.analyzer).not.toHaveBeenCalled();
    f.service.close();
  },
);
it('discards a history-feedback write if its saved permission changes before commit', async () => {
  const f = await setup();
  const id = await f.store.saveBriefing(
    'r',
    {
      overview: 'Summary',
      items: [
        {
          id: 'm',
          summary: 'Stored summary',
          importance: 'medium',
          importanceReason: 'Reason',
          relevance: '',
          action: 'Read',
          evidenceQuote: 'Quote',
          equationIds: [],
          figureIds: [],
          memorySuggestion: null,
        },
      ],
    },
    [{ id: 'm', title: 'Mail', kind: 'email', readScope: 'mail-preview' }],
    true,
  );
  const original = f.memory.feedback.bind(f.memory);
  vi.spyOn(f.memory, 'feedback').mockImplementationOnce(async (...args) => {
    await f.store.save(
      { ...f.p, preferences: { ...f.p.preferences, mailAi: false } },
      async () => undefined,
    );
    return original(...args);
  });
  expect(
    (
      await f.invoke('/history/feedback', {
        routineId: 'r',
        historyId: id,
        itemId: 'm',
        decision: 'important',
      })
    ).status,
  ).not.toBe(200);
  expect((await f.memory.review('r')).entries).toEqual([]);
  f.service.close();
});
it('attaches only the approved displayed agenda to its collection and rejects unrelated receipt IDs', async () => {
  const f = await setup();
  const events = vi.spyOn(f.calendar, 'events').mockResolvedValue({
    events: [
      {
        id: 'event',
        fingerprint: 'f',
        modifiedAt: '2026-09-09T00:00:00Z',
        contentTruncated: false,
        calendarId: 'cal',
        title: 'Recorded meeting',
        start: '2026-09-09T01:00:00Z',
        end: '2026-09-09T02:00:00Z',
        timeZone: 'Asia/Seoul',
        allDay: false,
        location: 'Room',
        notes: 'Not archived',
        alarmMinutes: null,
        recurring: false,
        hasAttendees: false,
      },
    ],
    limited: false,
  });
  const results = await owner(() =>
    f.service.collect(
      { routineId: 'r', live: { ...f.p.live, mail: null }, interest: f.p.interest },
      new AbortController().signal,
      vi.fn(),
    ),
  );
  const receiptId = results[0]!.receiptId!;
  const result = await f.invoke('/calendar/agenda', { routineId: 'r', receiptId });
  expect(result.status).toBe(200);
  const saved = (await f.store.history('r')).find((h) => h.snapshot)!;
  expect(saved.snapshot!.calendar![0]!.title).toBe('Recorded meeting');
  expect(JSON.stringify(saved.snapshot)).not.toContain('Not archived');
  expect(saved.private).toBe(true);
  const denied = await f.invoke('/calendar/agenda', {
    routineId: 'r',
    receiptId: '65b89903-365b-4d4e-9b2a-215cb1b5e221',
  });
  expect(denied.status).not.toBe(200);
  expect(events).toHaveBeenCalledOnce();
  f.service.close();
});
it('saved permission eliminates repetitive mail approval but revocation during a read discards its result', async () => {
  const f = await setup();
  vi.spyOn(f.mail, 'restorePolicyGrant').mockResolvedValue();
  vi.spyOn(f.mail, 'collect').mockResolvedValue({ items: [], note: 'read' });
  await owner(() =>
    f.service.collect(
      { routineId: 'r', live: f.p.live, interest: f.p.interest },
      new AbortController().signal,
      vi.fn(),
    ),
  );
  expect(f.consent).not.toHaveBeenCalled();
  vi.mocked(f.mail.collect).mockImplementationOnce(async () => {
    await f.store.save(
      { ...f.p, preferences: { ...f.p.preferences, mailRead: false } },
      async () => undefined,
    );
    return { items: [], note: 'late' };
  });
  const result = await owner(() =>
    f.service.collect(
      { routineId: 'r', live: f.p.live, interest: f.p.interest },
      new AbortController().signal,
      vi.fn(),
    ),
  );
  expect(result.find((r) => r.kind === 'email')?.status).toBe('failed');
  f.service.close();
});
it('distinguishes a saved mail scope from an active short-lived Mail grant', async () => {
  const f = await setup();
  const status = await f.invoke('/mail/status', { routineId: 'r', scope });
  expect(status.data).toMatchObject({
    state: 'configured',
    expiresAt: null,
    mailRead: true,
    mailAi: true,
    approved: true,
  });
  f.service.close();
});
it('uses the default always-allow policy for feedback and supports switching back to per-request confirmation', async () => {
  const f = await setup();
  vi.spyOn(f.mail, 'restorePolicyGrant').mockResolvedValue();
  vi.spyOn(f.mail, 'assertScope').mockImplementation(() => undefined);
  vi.spyOn(f.mail, 'collect').mockResolvedValue({
    items: [
      {
        id: 'mail-1',
        kind: 'email',
        title: 'A useful research update',
        text: 'Short fixture mail',
        source: 'Mail',
        readScope: 'mail-preview',
        details: [],
      },
    ],
    note: 'read',
  });
  const results = await owner(() =>
    f.service.collect(
      { routineId: 'r', live: f.p.live, interest: f.p.interest },
      new AbortController().signal,
      vi.fn(),
    ),
  );
  f.consent.mockClear();
  await f.invoke('/memory/feedback', {
    routineId: 'r',
    receiptId: results.find((result) => result.kind === 'email')!.receiptId,
    itemId: 'mail-1',
    decision: 'important',
  });
  expect(f.consent).not.toHaveBeenCalled();
  await owner(() =>
    f.store.save(
      { ...f.p, preferences: { ...f.p.preferences, confirmationPolicy: 'ask' } },
      async () => undefined,
    ),
  );
  f.consent.mockClear();
  await f.invoke('/memory/feedback', {
    routineId: 'r',
    receiptId: results.find((result) => result.kind === 'email')!.receiptId,
    itemId: 'mail-1',
    decision: 'not-interested',
  });
  expect(f.consent).toHaveBeenCalledOnce();
  f.service.close();
});
it('auto-summary OFF returns without resolving or invoking a provider', async () => {
  const f = await setup();
  const receipt = await f.service.collect(
    { routineId: 'r', live: defaultLiveSettings(), interest: f.p.interest },
    new AbortController().signal,
    vi.fn(),
  );
  await owner(() =>
    f.store.save(
      { ...f.p, preferences: { ...f.p.preferences, autoPaperSummary: false } },
      async () => undefined,
    ),
  );
  const result = await f.invoke('/assistant/auto-analyze', {
    routineId: 'r',
    receiptId: receipt[0]!.receiptId,
    kind: 'papers',
  });
  expect(result.data).toEqual({ skipped: true });
  expect(f.analyzer).not.toHaveBeenCalled();
  f.service.close();
});
it('deactivating a deleted routine revokes every private capability while retaining its history store', async () => {
  const f = await setup();
  expect((await f.invoke('/assistant/settings/deactivate', { routineId: 'r' })).status).toBe(200);
  await owner(async () => {
    await expect(f.store.assertMail('r', scope)).rejects.toThrow();
    await expect(f.store.assertCalendar('r', ['cal'])).rejects.toThrow();
    expect(await f.store.canPrivateAi('r', 'codex')).toBe(false);
  });
  f.service.close();
});
it.each([false, true])(
  'calendar prepare never writes; direct=%s apply stays scoped/idempotent',
  async (direct) => {
    const f = await setup();
    vi.spyOn(f.calendar, 'calendars').mockResolvedValue([
      { id: 'cal', name: 'Research', source: 'Local', writable: true, color: '#527d0b' },
    ]);
    const write = vi
      .spyOn(f.calendar, 'apply')
      .mockResolvedValue({ id: 'created', deleted: false });
    const draft = {
      calendarId: 'cal',
      title: 'Review',
      start: '2026-09-09T01:00:00Z',
      end: '2026-09-09T02:00:00Z',
      allDay: false,
      timeZone: 'Asia/Seoul',
      location: '',
      notes: '',
      alarmMinutes: 10,
    };
    const prepared = await f.invoke('/calendar/prepare', {
      routineId: 'r',
      kind: 'create',
      draft,
      eventId: null,
      fingerprint: null,
    });
    expect(prepared.status).toBe(200);
    expect(write).not.toHaveBeenCalled();
    const body = {
      routineId: 'r',
      actionId: prepared.data.action.id,
      ...(direct ? { direct: true } : {}),
    };
    const applied = await f.invoke('/calendar/apply', body);
    expect(applied.data.id).toBe('created');
    expect((await f.invoke('/calendar/apply', body)).data.alreadyApplied).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[2]).toBe(direct);
    expect((await f.invoke('/calendar/apply', body, 'b')).status).not.toBe(200);
    f.service.close();
  },
);
