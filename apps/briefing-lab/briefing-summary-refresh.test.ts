import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { BriefingMemoryStore } from './briefing-memory-store';
import { briefingClientContext } from './briefing-client-context';
import { LiveSourceService, sourceError } from './live-source-service';
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
it('distinguishes ownership, changed settings and private AI approval failures', () => {
  expect(sourceError(new Error('assistant_client_required'))).toContain('소유권');
  expect(sourceError(new Error('assistant_private_ai_required'))).toContain('AI 제공자');
  expect(sourceError(new Error('assistant_settings_changed'))).toContain('작업 중 설정이 변경');
});
async function fixture(kind: 'papers' | 'email' = 'papers', missingBody = false) {
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
    readScope: kind === 'papers' ? 'abstract' : missingBody ? 'mail-metadata' : 'mail-preview',
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
  const consent = vi.fn(async () => undefined);
  const service = new LiveSourceService(
    mail,
    providers,
    consent,
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
    consent,
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
it('reacquires missing email bodies instead of reusing metadata-only receipts', async () => {
  const f = await fixture('email', true);
  vi.mocked(f.mail.collect)
    .mockClear()
    .mockResolvedValue({
      items: [{ ...f.item, readScope: 'mail-preview', text: 'Recovered original body' }],
      note: 'fixture',
    });
  await owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()));
  expect(f.mail.collect).toHaveBeenCalledOnce();
  expect(f.analyzer.mock.calls[1]![1][0]!.text).toBe('Recovered original body');
  f.service.close();
});

it('preserves the saved summary without invoking AI if the body is still unavailable', async () => {
  const f = await fixture('email', true);
  const before = await f.workspace.summaryHistory('r');
  await expect(owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()))).rejects.toThrow(
    'briefing_refresh_body_unavailable',
  );
  expect(f.analyzer).toHaveBeenCalledOnce();
  expect(await f.workspace.summaryHistory('r')).toEqual(before);
  f.service.close();
});

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
  vi.mocked(f.mail.collect).mockClear();
  f.service.close();
  await owner(() =>
    f.workspace.save(
      { ...f.p, preferences: { ...f.p.preferences, mailAi: false } },
      async () => undefined,
    ),
  );
  await expect(owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()))).rejects.toThrow(
    'briefing_refresh_ai_disabled',
  );
  expect(f.mail.collect).not.toHaveBeenCalled();
  expect(f.model).not.toHaveBeenCalled();
});
it.each([false, true])(
  'renews an expired saved approval before refreshing (restart=%s)',
  async (restart) => {
    const f = await fixture('email');
    if (restart) f.service.close();
    await f.workspace['state'].mutate((s) => {
      s.profiles[0]!.approvedScope = null;
    });
    const before = await f.workspace.profile('r');
    const refreshed = await owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()));
    expect(f.consent).toHaveBeenCalledOnce();
    const saved = (await f.workspace.profile('r'))!;
    expect(f.workspace.approved(saved)).toBe(true);
    expect(saved.preferences).toEqual(before!.preferences);
    expect(saved.live).toEqual(before!.live);
    await owner(() =>
      f.service.refreshSummary(
        { ...f.request, historyId: refreshed.historyId! },
        f.signal,
        vi.fn(),
      ),
    );
    expect(f.consent).toHaveBeenCalledOnce();
    expect(f.analyzer).toHaveBeenCalledTimes(3);
    f.service.close();
  },
);
it('does not prompt again when the saved approval is already valid after restart', async () => {
  const f = await fixture('email');
  f.service.close();
  await owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()));
  expect(f.consent).not.toHaveBeenCalled();
  expect(f.analyzer).toHaveBeenCalledTimes(2);
});
it('keeps history and permissions unchanged when approval renewal is declined', async () => {
  const f = await fixture('email');
  f.service.close();
  await f.workspace['state'].mutate((s) => {
    s.profiles[0]!.approvedScope = null;
  });
  const before = await f.workspace.profile('r');
  const history = await f.workspace.summaryHistory('r');
  vi.mocked(f.mail.collect).mockClear();
  f.consent.mockRejectedValueOnce(new Error('source_cancelled'));
  await expect(owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()))).rejects.toThrow(
    'source_cancelled',
  );
  expect(f.consent).toHaveBeenCalledOnce();
  expect(f.mail.collect).not.toHaveBeenCalled();
  expect(f.model).not.toHaveBeenCalled();
  expect(await f.workspace.profile('r')).toEqual(before);
  expect(await f.workspace.summaryHistory('r')).toEqual(history);
});
it.each(['mailRead', 'mailAi'] as const)(
  'never enables disabled %s during refresh',
  async (permission) => {
    const f = await fixture('email');
    f.service.close();
    await owner(() =>
      f.workspace.save(
        { ...f.p, preferences: { ...f.p.preferences, [permission]: false } },
        async () => undefined,
      ),
    );
    vi.mocked(f.mail.collect).mockClear();
    await expect(
      owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn())),
    ).rejects.toThrow(
      permission === 'mailRead' ? 'briefing_refresh_mail_disabled' : 'briefing_refresh_ai_disabled',
    );
    expect(f.consent).not.toHaveBeenCalled();
    expect(f.mail.collect).not.toHaveBeenCalled();
    expect(f.model).not.toHaveBeenCalled();
    expect((await f.workspace.profile('r'))!.preferences[permission]).toBe(false);
  },
);
it('does not overwrite a settings edit made while renewal consent is pending', async () => {
  const f = await fixture('email');
  f.service.close();
  await f.workspace['state'].mutate((s) => {
    s.profiles[0]!.approvedScope = null;
  });
  f.consent.mockImplementationOnce(async () => {
    await owner(() =>
      f.workspace.save(
        { ...f.p, preferences: { ...f.p.preferences, mailAi: false } },
        async () => undefined,
      ),
    );
  });
  vi.mocked(f.mail.collect).mockClear();
  await expect(owner(() => f.service.refreshSummary(f.request, f.signal, vi.fn()))).rejects.toThrow(
    'assistant_settings_changed',
  );
  expect((await f.workspace.profile('r'))!.preferences.mailAi).toBe(false);
  expect(f.mail.collect).not.toHaveBeenCalled();
  expect(f.model).not.toHaveBeenCalled();
});
it('uses the same renewal gate for a live receipt refresh', async () => {
  const f = await fixture('email');
  const [receiptId] = f.service['receipts'].keys();
  await f.workspace['state'].mutate((s) => {
    s.profiles[0]!.approvedScope = null;
  });
  await owner(() =>
    f.service.refreshSummary({ routineId: 'r', itemId: f.item.id, receiptId }, f.signal, vi.fn()),
  );
  expect(f.consent).toHaveBeenCalledOnce();
  expect(f.analyzer).toHaveBeenCalledTimes(2);
  f.service.close();
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
