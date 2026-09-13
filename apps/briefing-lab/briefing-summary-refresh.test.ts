import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { BriefingMemoryStore } from './briefing-memory-store';
import { briefingClientContext } from './briefing-client-context';
import { LiveSourceService } from './live-source-service';
import { AppleMailConnection } from './live-mail';
import { CalendarService } from './calendar-service';
import type { analyzeBriefing } from './briefing-analysis';
import type { assistantModel } from './briefing-assistant';
import type { LiveItem } from './src/live-types';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
async function fixture(kind: 'papers' | 'email' = 'papers') {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-refresh-test-'));
  dirs.push(dir);
  const workspace = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 1));
  const memory = new BriefingMemoryStore(dir, async () => Buffer.alloc(32, 1));
  const item: LiveItem = {
    id: 'source1',
    title: 'Original source',
    kind,
    text: 'The original observed content.',
    source: 'synthetic',
    readScope: kind === 'papers' ? 'abstract' : 'mail-preview',
    details: [],
  };
  const providers = {
    cities: vi.fn(async () => []),
    weather: vi.fn(async () => []),
    papers: vi.fn(async () => (kind === 'papers' ? [item] : [])),
  };
  const mail = new AppleMailConnection();
  vi.spyOn(mail, 'restorePolicyGrant').mockResolvedValue(undefined);
  vi.spyOn(mail, 'assertScope').mockImplementation(() => undefined);
  vi.spyOn(mail, 'collect').mockImplementation(async () => ({ items: [item], note: 'fixture' }));
  const analyzer = vi.fn<typeof analyzeBriefing>(async (_input, items) => ({
    overview: 'Fresh overview',
    items: items.map((i) => ({
      id: i.id,
      summary: `Summary of ${i.text}`,
      importance: 'medium',
      importanceReason: 'Fixture',
      relevance: '',
      action: 'Review',
      equationIds: [],
      figureIds: [],
      evidenceQuote: i.text,
      memorySuggestion: null,
    })),
    invocation: { providerId: 'codex', model: 'test', reasoning: null },
    memoryUsed: [],
  }));
  const model = vi.fn(
    async () => ({ modelId: 'test' }) as Awaited<ReturnType<typeof assistantModel>>,
  );
  const service = new LiveSourceService(
    mail,
    providers,
    async () => undefined,
    analyzer,
    memory,
    workspace,
    new CalendarService(),
    model,
  );
  const p = {
    routineId: 'r',
    name: 'Synthetic',
    timeZone: 'Asia/Seoul',
    interest: { keywords: [], excluded: [] },
    live: {
      ...defaultLiveSettings(),
      mail:
        kind === 'email'
          ? {
              accountId: 'a',
              mailboxId: 'inbox',
              days: 3,
              limit: 10,
              subject: '',
              sender: '',
              unreadOnly: false,
              bodyPreview: true,
            }
          : null,
    },
    preferences: {
      ...defaultAssistantPreferences(),
      mailRead: kind === 'email',
      mailAi: kind === 'email',
    },
  };
  const signal = new AbortController().signal;
  const first = await owner(async () => {
    await workspace.save(p, async () => undefined);
    const results = await service.collect(
      { routineId: 'r', live: p.live, interest: p.interest },
      signal,
      vi.fn(),
    );
    return service.analyze(
      {
        routineId: 'r',
        receiptId: results[0]!.receiptId,
        itemIds: [item.id],
        providerId: 'codex',
        modelId: 'test',
        reasoning: null,
        includeMail: kind === 'email',
        memory: [],
      },
      signal,
      vi.fn(),
    );
  });
  return {
    service,
    workspace,
    analyzer,
    providers,
    mail,
    model,
    item,
    p,
    signal,
    first,
    request: { routineId: 'r', historyId: first.historyId!, itemId: item.id },
  };
}
it.each(['papers', 'email'] as const)(
  'explicit %s refresh bypasses matching cache and preserves original history run',
  async (kind) => {
    const f = await fixture(kind);
    const before = await f.workspace.history('r');
    const refreshed = await owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()));
    expect(refreshed.cache).toMatchObject({ generatedItemIds: ['source1'], reusedItemIds: [] });
    expect(f.analyzer).toHaveBeenCalledTimes(2);
    expect(refreshed.provenance.source1!.reused).toBe(false);
    expect((await f.workspace.history('r')).map((h) => h.runId)).toEqual(
      before.map((h) => h.runId),
    );
    f.service.close();
  },
);
it('reacquires expired original sources without archiving raw text or a duplicate collection', async () => {
  const f = await fixture();
  f.service.close(); // a restart loses raw receipts, but keeps encrypted history
  f.item.text = 'New observed content after restart';
  const next = await owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()));
  expect(f.providers.papers).toHaveBeenCalledTimes(2);
  expect(f.providers.weather).not.toHaveBeenCalled();
  expect(f.analyzer.mock.calls[1]![1][0]!.text).toBe(f.item.text);
  expect(next.provenance.source1!.sourceDigest).not.toBe(f.first.provenance.source1!.sourceDigest);
  const history = await f.workspace.history('r');
  expect(history.filter((h) => h.snapshot)).toHaveLength(1);
  expect(history[0]!.items[0]).not.toHaveProperty('text');
  f.service.close();
});
it('keeps the old summary when the original cannot be found and never substitutes its AI summary', async () => {
  const f = await fixture();
  f.service.close();
  f.providers.papers.mockResolvedValue([]);
  const before = await f.workspace.history('r');
  await expect(owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()))).rejects.toThrow(
    'refresh_source_missing',
  );
  expect(f.analyzer).toHaveBeenCalledOnce();
  expect(f.model).not.toHaveBeenCalled();
  expect(await f.workspace.history('r')).toEqual(before);
});
it('rejects foreign browsers, spoofed source text and missing targets before any generation', async () => {
  const f = await fixture();
  await expect(
    briefingClientContext.run('b'.repeat(64), () =>
      f.service.refreshSummary(f.request, f.signal, vi.fn()),
    ),
  ).rejects.toThrow('client_required');
  await expect(
    owner(() => f.service.refreshSummary({ ...f.request, text: 'injected' }, f.signal, vi.fn())),
  ).rejects.toThrow();
  await expect(
    owner(() => f.service.refreshSummary({ ...f.request, itemId: 'foreign' }, f.signal, vi.fn())),
  ).rejects.toThrow('history_item_missing');
  expect(f.analyzer).toHaveBeenCalledOnce();
  f.service.close();
});
it('does not re-read private mail or invoke a model after private-AI permission is revoked', async () => {
  const f = await fixture('email');
  f.service.close();
  await owner(() =>
    f.workspace.save(
      { ...f.p, preferences: { ...f.p.preferences, mailAi: false } },
      async () => undefined,
    ),
  );
  await expect(owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()))).rejects.toThrow(
    'private_ai_required',
  );
  expect(f.mail.collect).toHaveBeenCalledOnce();
  expect(f.model).not.toHaveBeenCalled();
});
it('suppresses a duplicate refresh while the same routine is already regenerating', async () => {
  const f = await fixture();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.model.mockImplementationOnce(async () => {
    await wait;
    return { modelId: 'test' } as Awaited<ReturnType<typeof assistantModel>>;
  });
  const first = owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()));
  await vi.waitFor(() => expect(f.model).toHaveBeenCalledOnce());
  await expect(owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()))).rejects.toThrow(
    'refresh_busy',
  );
  release();
  await first;
  expect(f.analyzer).toHaveBeenCalledTimes(2);
  f.service.close();
});
