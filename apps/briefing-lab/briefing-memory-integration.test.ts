import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, it, expect, vi } from 'vitest';
import { defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingMemoryStore } from './briefing-memory-store';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { LiveSourceService } from './live-source-service';
import { AppleMailConnection } from './live-mail';
import type { analyzeBriefing } from './briefing-analysis';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
const dirs: string[] = [];
afterEach(async () => {
  for (const p of dirs.splice(0)) await rm(p, { recursive: true, force: true });
});
const paper = {
  id: 'p',
  kind: 'papers' as const,
  title: 'Evidence paper',
  text: 'Current source evidence',
  source: 'fixture',
  readScope: 'abstract' as const,
  details: [],
};
const insight = {
  id: 'p',
  summary: 'An automatic research memory',
  importance: 'medium' as const,
  importanceReason: 'Related',
  relevance: 'Optimization',
  action: 'Read',
  evidenceQuote: paper.text,
  equationIds: [],
  figureIds: [],
  memorySuggestion: null,
};
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-memory-integration-'));
  dirs.push(dir);
  const memory = new BriefingMemoryStore(dir, async () => Buffer.alloc(32, 1));
  const consent = vi.fn(async () => undefined);
  const analyzer = vi.fn<typeof analyzeBriefing>(async (input) => ({
    overview: 'Summary',
    items: [insight],
    invocation: { providerId: 'codex', model: 'fixture', reasoning: 'high' },
    memoryUsed: input.memory.map((e) => e.id),
  }));
  const workspace = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 1));
  const service = new LiveSourceService(
    new AppleMailConnection(),
    { cities: async () => [], weather: async () => [], papers: async () => [paper] },
    consent,
    analyzer,
    memory,
    workspace,
  );
  const signal = new AbortController().signal;
  const results = await service.collect(
    { routineId: 'r', live: defaultLiveSettings(), interest: { keywords: [], excluded: [] } },
    signal,
    vi.fn(),
  );
  const input = {
    routineId: 'r',
    receiptId: results[0]!.receiptId!,
    itemIds: ['p'],
    providerId: 'codex',
    modelId: 'fixture',
    reasoning: 'high',
    includeMail: false,
    memory: [],
  };
  return { memory, consent, analyzer, service, signal, input, workspace };
}
it('reuses only the current feedback revision and records the revision used before an in-flight change', async () => {
  const f = await fixture();
  const first = await f.service.analyze(f.input, f.signal, vi.fn());
  expect(first.cache).toMatchObject({
    feedbackProfileRevision: 0,
    reusedItemIds: [],
    generatedItemIds: ['p'],
  });
  const second = await f.service.analyze(f.input, f.signal, vi.fn());
  expect(second.cache).toMatchObject({
    feedbackProfileRevision: 0,
    reusedItemIds: ['p'],
    generatedItemIds: [],
  });
  expect(f.analyzer).toHaveBeenCalledOnce();
  await f.memory.feedback('r', paper, 'important', f.signal);
  f.analyzer.mockImplementationOnce(async () => {
    await f.memory.feedback('r', paper, 'not-interested', f.signal);
    return {
      overview: 'Updated',
      items: [insight],
      invocation: { providerId: 'codex', model: 'fixture', reasoning: 'high' },
      memoryUsed: [],
    };
  });
  const third = await f.service.analyze(f.input, f.signal, vi.fn());
  expect(third.cache.feedbackProfileRevision).toBe(1);
  expect((await f.workspace.history('r'))[0]!.feedbackProfileRevision).toBe(1);
  await f.service.analyze(f.input, f.signal, vi.fn());
  expect(f.analyzer).toHaveBeenCalledTimes(3);
  f.service.close();
});
it('preserves the original summary time across reuse and bypasses it only on explicit refresh', async () => {
  const f = await fixture();
  const first = await f.service.analyze(f.input, f.signal, vi.fn());
  const second = await f.service.analyze(f.input, f.signal, vi.fn());
  expect(first.provenance?.p?.summarizedAt).toEqual(expect.any(String));
  expect(second.provenance?.p).toEqual({ ...first.provenance?.p, reused: true });
  expect((await f.workspace.history('r'))[0]!.items[0]!.provenance).toEqual(second.provenance?.p);
  await f.service.analyze({ ...f.input, refresh: true }, f.signal, vi.fn());
  expect(f.analyzer).toHaveBeenCalledTimes(2);
  f.service.close();
});
it('does not reuse a summary when an identical id/title has different observed content', async () => {
  const f = await fixture();
  await f.service.analyze(f.input, f.signal, vi.fn());
  const original = paper.text;
  try {
    paper.text = 'Changed source evidence';
    const collected = await f.service.collect(
      { routineId: 'r', live: defaultLiveSettings(), interest: { keywords: [], excluded: [] } },
      f.signal,
      vi.fn(),
      false, // Explicit raw re-read: a new briefing intentionally omits already summarized papers.
    );
    const changed = await f.service.analyze(
      { ...f.input, receiptId: collected[0]!.receiptId! },
      f.signal,
      vi.fn(),
    );
    expect(changed.cache.reusedItemIds).toEqual([]);
    expect(f.analyzer).toHaveBeenCalledTimes(2);
  } finally {
    paper.text = original;
    f.service.close();
  }
});
it('serves a verified cache without needing an available model connection', async () => {
  const f = await fixture();
  await f.service.analyze(f.input, f.signal, vi.fn());
  const connect = vi.fn(async () => {
    throw new Error('routine_model_unavailable');
  });
  const cached = await f.service.analyze(f.input, f.signal, vi.fn(), true, undefined, connect);
  expect(cached.cache.reusedItemIds).toEqual(['p']);
  expect(connect).not.toHaveBeenCalled();
  expect(f.analyzer).toHaveBeenCalledOnce();
  f.service.close();
});
it('does not reuse unversioned history or a cache when the feedback snapshot is unreadable', async () => {
  const f = await fixture();
  await f.workspace.saveBriefing('r', { overview: 'Legacy', items: [insight] }, [paper]);
  await f.service.analyze(f.input, f.signal, vi.fn());
  expect(f.analyzer).toHaveBeenCalledOnce();
  vi.spyOn(f.memory, 'feedbackProfile').mockRejectedValue(new Error('briefing_memory_unreadable'));
  const result = await f.service.analyze(f.input, f.signal, vi.fn());
  expect(result.cache.feedbackProfileRevision).toBeNull();
  expect(result.cache.reusedItemIds).toEqual([]);
  expect(f.analyzer).toHaveBeenCalledTimes(2);
  f.service.close();
});
it('keeps summaries influenced by private feedback private and misses that cache without private-AI scope', async () => {
  const f = await fixture();
  vi.spyOn(f.memory, 'related').mockResolvedValue([]);
  await f.memory.feedback('r', { ...paper, kind: 'email' }, 'important', f.signal);
  const privateAi = vi.spyOn(f.workspace, 'canPrivateAi').mockResolvedValue(true);
  await f.service.analyze(f.input, f.signal, vi.fn());
  expect((await f.workspace.history('r'))[0]!.private).toBe(true);
  privateAi.mockResolvedValue(false);
  await f.service.analyze(f.input, f.signal, vi.fn());
  expect(f.analyzer).toHaveBeenCalledTimes(2);
  expect(f.analyzer.mock.calls[1]![7]).toMatchObject({ total: 0, hasPrivateFeedback: false });
  f.service.close();
});
it('preserves a cached summary private taint even when no private memory is retrieved this time', async () => {
  const f = await fixture();
  await f.memory.importEntries('r', [
    {
      id: 'private-context',
      routineId: 'r',
      kind: 'project',
      text: 'Private project preference',
      sourceId: 'project',
      createdAt: new Date().toISOString(),
    },
  ]);
  vi.spyOn(f.workspace, 'canPrivateAi').mockResolvedValue(true);
  await f.service.analyze(f.input, f.signal, vi.fn());
  vi.spyOn(f.memory, 'related').mockResolvedValue([]);
  const reused = await f.service.analyze(f.input, f.signal, vi.fn());
  expect(reused.cache.reusedItemIds).toEqual(['p']);
  expect(f.analyzer).toHaveBeenCalledOnce();
  expect((await f.workspace.history('r'))[0]!.private).toBe(true);
  expect(
    (await f.memory.review('r')).entries.find((e) => e.sourceId === 'analysis:p')!.private,
  ).toBe(true);
  f.service.close();
});
it('auto-saves without browser memory or manual input and injects backend memory on the next native turn', async () => {
  const f = await fixture();
  // Exercise a new inference, not the independently tested saved-summary cache.
  vi.spyOn(f.workspace, 'summaryHistory').mockResolvedValue([]);
  const first = await f.service.analyze(f.input, f.signal, vi.fn());
  expect(first.memorySave.state).toBe('saved');
  expect(first.memoryUsed).toEqual([]);
  expect((await f.memory.status('r')).count).toBe(2);
  const second = await f.service.analyze(f.input, f.signal, vi.fn());
  expect(second.memoryUsed).toHaveLength(2);
  expect(
    f.analyzer.mock.calls[1]![0].memory.some((e) => e.text.includes('automatic research memory')),
  ).toBe(true);
  expect(f.consent).not.toHaveBeenCalled();
  f.service.close();
});
it('archives a collection before inference and links later summary batches to the same briefing', async () => {
  const f = await fixture();
  const initial = await f.workspace.history('r');
  expect(initial[0]!.runId).toBe(f.input.receiptId);
  expect(initial[0]!.snapshot!.sources).toContainEqual(
    expect.objectContaining({
      kind: 'papers',
      status: 'ready',
      count: 1,
    }),
  );
  expect(initial[0]!.items).toEqual([]);
  expect(f.analyzer).not.toHaveBeenCalled();
  await f.service.analyze(f.input, f.signal, vi.fn());
  const saved = await f.workspace.history('r');
  expect(saved).toHaveLength(2);
  expect(new Set(saved.map((h) => h.runId))).toEqual(new Set([f.input.receiptId]));
  f.service.close();
});
it('keeps retrieved sources visible with an explicit warning when archiving fails', async () => {
  const f = await fixture();
  vi.spyOn(f.workspace, 'saveCollection').mockRejectedValue(
    new Error('briefing_memory_unreadable'),
  );
  const results = await f.service.collect(
    { routineId: 'r', live: defaultLiveSettings(), interest: { keywords: [], excluded: [] } },
    f.signal,
    vi.fn(),
  );
  expect(results[0]!.status).toBe('ready');
  expect(results[0]!.historyWarning).toContain('이력 저장 실패');
  expect(results[0]!.items).toHaveLength(1);
  f.service.close();
});
it('returns the completed summary with a visible memory warning on storage failure, and never saves failed inference', async () => {
  const f = await fixture();
  vi.spyOn(f.workspace, 'summaryHistory').mockResolvedValue([]);
  const record = vi
    .spyOn(f.memory, 'record')
    .mockRejectedValue(new Error('briefing_memory_keychain_unavailable'));
  const result = await f.service.analyze(f.input, f.signal, vi.fn());
  expect(result.items[0]!.summary).toBe(insight.summary);
  expect(result.memorySave.state).toBe('failed');
  expect(result.memorySave.warning).toContain('Keychain');
  record.mockClear();
  f.analyzer.mockRejectedValueOnce(new Error('routine_timeout'));
  await expect(f.service.analyze(f.input, f.signal, vi.fn())).rejects.toThrow('timeout');
  expect(record).not.toHaveBeenCalled();
  f.service.close();
});
it('requires native consent before stored private context can be sent and cannot leak another routine memory', async () => {
  const f = await fixture();
  await f.memory.importEntries('r', [
    {
      id: 'private',
      routineId: 'r',
      kind: 'project',
      text: 'Private reviewed project context',
      sourceId: 'project',
      createdAt: new Date().toISOString(),
    },
  ]);
  await f.memory.importEntries('other', [
    {
      id: 'other',
      routineId: 'other',
      kind: 'project',
      text: 'Other private project',
      sourceId: 'other',
      createdAt: new Date().toISOString(),
    },
  ]);
  f.consent.mockRejectedValueOnce(new Error('native_consent_denied'));
  await expect(f.service.analyze(f.input, f.signal, vi.fn())).rejects.toThrow('denied');
  expect(f.analyzer).not.toHaveBeenCalled();
  await f.service.analyze(f.input, f.signal, vi.fn());
  expect(f.analyzer.mock.calls[0]![0].memory.map((e) => e.id)).toEqual(['private']);
  f.service.close();
});
it('exposes only counts until native review approval and requires scoped editor capability for memory changes', async () => {
  const f = await fixture();
  await f.service.analyze(f.input, f.signal, vi.fn());
  const call = async (path: string, body: unknown) => {
    const request = Object.assign(Readable.from([JSON.stringify(body)]), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: `/api/briefing-agent/sources${path}`,
    }) as IncomingMessage;
    const response = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, destroyed: false };
    await f.service.handle(request, response as unknown as ServerResponse, f.signal);
    return {
      code: response.writeHead.mock.calls[0]![0] as number,
      body: JSON.parse(response.end.mock.calls[0]![0] as string),
    };
  };
  const status = await call('/memory/status', { routineId: 'r' });
  expect(status.body.count).toBe(2);
  expect(JSON.stringify(status.body)).not.toContain('automatic research memory');
  f.consent.mockRejectedValueOnce(new Error('native_consent_denied'));
  const denied = await call('/memory/review', { routineId: 'r' });
  expect(denied.code).toBe(400);
  expect(JSON.stringify(denied.body)).not.toContain('automatic research memory');
  const review = await call('/memory/review', { routineId: 'r' });
  expect(review.code).toBe(200);
  const entry = review.body.entries[0];
  expect(
    (
      await call('/memory/edit', {
        routineId: 'other',
        token: review.body.token,
        id: entry.id,
        revision: review.body.revision,
        text: 'illegal',
      })
    ).code,
  ).toBe(400);
  const updated = await call('/memory/edit', {
    routineId: 'r',
    token: review.body.token,
    id: entry.id,
    revision: review.body.revision,
    text: 'Reviewed change',
  });
  expect(updated.code).toBe(200);
  expect(updated.body.entries.some((e: { text: string }) => e.text === 'Reviewed change')).toBe(
    true,
  );
  f.service.close();
});
