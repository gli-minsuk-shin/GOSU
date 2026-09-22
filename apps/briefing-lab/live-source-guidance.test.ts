import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingGuidanceStore } from './briefing-guidance-store';
import { BriefingMemoryStore } from './briefing-memory-store';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { LiveSourceService } from './live-source-service';
import { AppleMailConnection } from './live-mail';
import type { analyzeBriefing } from './briefing-analysis';

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
async function fixture(withGuidance = true) {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-guidance-service-'));
  dirs.push(dir);
  const key = async () => Buffer.alloc(32, 3);
  const analyzer = vi.fn<typeof analyzeBriefing>(async () => ({
    overview: 'Summary',
    items: [
      {
        id: 'p',
        summary: 'Summary',
        importance: 'medium' as const,
        importanceReason: 'Related',
        relevance: 'Optimization',
        action: 'Read',
        evidenceQuote: paper.text,
        equationIds: [],
        figureIds: [],
        memorySuggestion: null,
      },
    ],
    invocation: { providerId: 'codex', model: 'fixture', reasoning: 'high' },
    memoryUsed: [],
  }));
  const memory = new BriefingMemoryStore(dir, key);
  const service = new LiveSourceService(
    new AppleMailConnection(),
    { cities: async () => [], weather: async () => [], papers: async () => [paper] },
    vi.fn(async () => undefined),
    analyzer,
    memory,
    new BriefingWorkspaceStore(dir, key),
  );
  if (withGuidance) service.guidance = new BriefingGuidanceStore(dir, key);
  const signal = new AbortController().signal;
  const call = async (path: string, body: unknown) => {
    const request = Object.assign(Readable.from([JSON.stringify(body)]), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: `/api/briefing-agent/sources${path}`,
    }) as IncomingMessage;
    const response = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, destroyed: false };
    await service.handle(request, response as unknown as ServerResponse, signal);
    return {
      code: response.writeHead.mock.calls[0]![0] as number,
      body: JSON.parse(response.end.mock.calls[0]![0] as string),
    };
  };
  return { service, analyzer, signal, call, memory };
}

it('lists, adds, edits and deletes guidance lines through the routes', async () => {
  const f = await fixture();
  expect((await f.call('/assistant/guidance/list', { routineId: 'r' })).body).toEqual({
    items: [],
  });
  const added = await f.call('/assistant/guidance/add', {
    routineId: 'r',
    text: 'nrf.re.kr 메일은 반드시 포함',
  });
  expect(added.code).toBe(200);
  const id = added.body.items[0].id as string;
  const edited = await f.call('/assistant/guidance/edit', {
    routineId: 'r',
    id,
    text: 'yonsei.ac.kr 메일은 반드시 포함',
  });
  expect(edited.body.items.map((i: { text: string }) => i.text)).toEqual([
    'yonsei.ac.kr 메일은 반드시 포함',
  ]);
  const removed = await f.call('/assistant/guidance/delete', { routineId: 'r', id });
  expect(removed.body).toEqual({ items: [] });
  f.service.close();
});

it('explains a rejected line or a missing store instead of failing silently', async () => {
  const f = await fixture();
  const empty = await f.call('/assistant/guidance/add', { routineId: 'r', text: '  ' });
  expect(empty.code).toBe(400);
  expect(empty.body.error).toContain('300자');
  const missing = await f.call('/assistant/guidance/delete', {
    routineId: 'r',
    id: crypto.randomUUID(),
  });
  expect(missing.body.error).toContain('이미 삭제');
  f.service.close();
  const none = await fixture(false);
  const unavailable = await none.call('/assistant/guidance/list', { routineId: 'r' });
  expect(unavailable.code).toBe(400);
  expect(unavailable.body.error).toContain('브리핑 지침');
  none.service.close();
});

it('hands the routine guidance to the summary call', async () => {
  const f = await fixture();
  await f.service.guidance!.add('r', '최적화 논문은 방법을 자세히');
  const results = await f.service.collect(
    { routineId: 'r', live: defaultLiveSettings(), interest: { keywords: [], excluded: [] } },
    f.signal,
    vi.fn(),
  );
  await f.service.analyze(
    {
      routineId: 'r',
      receiptId: results[0]!.receiptId!,
      itemIds: ['p'],
      providerId: 'codex',
      modelId: 'fixture',
      reasoning: 'high',
      includeMail: false,
      memory: [],
    },
    f.signal,
    vi.fn(),
  );
  const guidance = f.analyzer.mock.calls[0]![10];
  expect(guidance?.map((g) => g.text)).toEqual(['최적화 논문은 방법을 자세히']);
  f.service.close();
});

it('gives the rating profile a way to find the senders of rated emails', async () => {
  const f = await fixture();
  const profile = vi.spyOn(f.memory, 'feedbackProfile');
  const results = await f.service.collect(
    { routineId: 'r', live: defaultLiveSettings(), interest: { keywords: [], excluded: [] } },
    f.signal,
    vi.fn(),
  );
  await f.service.analyze(
    {
      routineId: 'r',
      receiptId: results[0]!.receiptId!,
      itemIds: ['p'],
      providerId: 'codex',
      modelId: 'fixture',
      reasoning: 'high',
      includeMail: false,
      memory: [],
    },
    f.signal,
    vi.fn(),
  );
  const senderOf = profile.mock.calls[0]![2];
  expect(typeof senderOf).toBe('function');
  // A paper has no sender.
  expect(senderOf!('p')).toBeUndefined();
  f.service.close();
});
