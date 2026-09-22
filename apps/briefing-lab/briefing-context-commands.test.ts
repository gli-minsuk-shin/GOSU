import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCodexModelCatalog } from '@gosu/contracts';
import { defaultLiveSettings, defaultAssistantPreferences } from '@gosu/briefing-core';
import { runRoutineWithGosuLanguage } from './briefing-native';
import { LiveSourceService } from './live-source-service';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { BriefingMemoryStore } from './briefing-memory-store';
import { AppleMailConnection } from './live-mail';
import { CalendarService } from './calendar-service';
import { briefingClientContext } from './briefing-client-context';

vi.mock('./briefing-native', () => ({
  routineModels: async () => [
    {
      providerId: 'codex',
      catalog: createCodexModelCatalog([
        { id: 'fixture', model: 'fixture', displayName: 'Fixture', isDefault: true },
      ]),
    },
  ],
  runRoutineWithGosuLanguage: vi.fn(),
}));
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const owner = <T>(fn: () => T) => briefingClientContext.run('c'.repeat(64), fn);
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-context-commands-'));
  dirs.push(dir);
  const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 4));
  await owner(() =>
    store.save(
      {
        routineId: 'r',
        name: 'Synthetic',
        timeZone: 'Asia/Seoul',
        live: defaultLiveSettings(),
        interest: { keywords: [], excluded: [] },
        preferences: { ...defaultAssistantPreferences(), modelId: 'fixture' },
      },
      async () => undefined,
    ),
  );
  const service = new LiveSourceService(
    new AppleMailConnection(),
    { cities: async () => [], weather: async () => [], papers: async () => [] },
    vi.fn(async () => undefined),
    undefined,
    new BriefingMemoryStore(dir, async () => Buffer.alloc(32, 4)),
    store,
    new CalendarService(),
  );
  const post = async (path: string, body: unknown, signal = new AbortController().signal) => {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), {
      method: 'POST',
      url: `/api/briefing-agent/sources${path}`,
      headers: { 'content-type': 'application/json' },
    }) as IncomingMessage;
    const chunks: string[] = [];
    let status = 0;
    const res = {
      headersSent: false,
      writeHead: vi.fn((code: number) => {
        status = code;
        res.headersSent = true;
      }),
      flushHeaders: vi.fn(),
      write: (s: string) => chunks.push(s),
      end: vi.fn((s?: string) => {
        if (s) chunks.push(s);
      }),
      destroyed: false,
    };
    await owner(() => service.handle(req, res as unknown as ServerResponse, signal));
    return {
      status,
      frames: chunks
        .join('\n')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  };
  const profile = (await store.profile('r'))!;
  const append = async (count: number, label: string) => {
    for (let i = 0; i < count; i++)
      await owner(() =>
        store.appendConversation(profile, {
          role: i % 2 ? 'assistant' : 'user',
          text: `${label} message ${i}`,
          createdAt: new Date(Date.UTC(2026, 8, 20, 0, 0, i)).toISOString(),
        }),
      );
  };
  return { store, profile, post, append };
}
const chatAnswer = () => ({
  answer: JSON.stringify({ answer: 'Synthetic answer', events: [], tasks: [] }),
  providerId: 'codex',
  model: 'fixture',
  reasoning: null,
  proposal: null,
  nextDates: [],
});
/** The conversation a chat turn really handed to the model. */
const sentConversation = (call: unknown[]) =>
  (
    JSON.parse((call[3] as { structuredJob: { prompt: string } }).structuredJob.prompt) as {
      untrustedConversation: { role: string; text: string }[];
    }
  ).untrustedConversation;

it('/new: the next turn is sent nothing from before it, while every record stays on disk', async () => {
  const s = await setup();
  await s.append(6, 'old');
  const started = await s.post('/assistant/conversation/new', { routineId: 'r' });
  expect(started.status).toBe(200);
  expect(started.frames[0]).toMatchObject({ started: true, setAside: 6 });

  vi.mocked(runRoutineWithGosuLanguage).mockResolvedValue(chatAnswer());
  await s.post('/assistant/chat', { routineId: 'r', prompt: 'fresh question', history: [] });
  const sent = sentConversation(vi.mocked(runRoutineWithGosuLanguage).mock.calls[0]!);
  expect(JSON.stringify(sent)).not.toContain('old message');

  // The turn after that carries the new context only: one question and one answer.
  await s.post('/assistant/chat', { routineId: 'r', prompt: 'second question', history: [] });
  const next = sentConversation(vi.mocked(runRoutineWithGosuLanguage).mock.calls[1]!);
  expect(next.map((m) => m.text)).toEqual(['fresh question', 'Synthetic answer']);
  expect((await owner(() => s.store.conversationDisplay(s.profile))).messages).toHaveLength(10);

  const display = await s.post('/assistant/conversation/get', { routineId: 'r' });
  expect(display.frames[0]).toMatchObject({
    contextStartedAt: started.frames[0]!.contextStartedAt,
  });
  expect((display.frames[0]!.messages as unknown[]).length).toBe(10);
});

it('/new on an empty context reports that nothing changed instead of drawing a second line', async () => {
  const s = await setup();
  const result = await s.post('/assistant/conversation/new', { routineId: 'r' });
  expect(result.frames[0]).toEqual({ started: false, contextStartedAt: '', setAside: 0 });
});

it('/compact: summarizes everything but the latest four now, saves one checkpoint and adds no message', async () => {
  const s = await setup();
  await s.append(12, 'earlier');
  vi.mocked(runRoutineWithGosuLanguage).mockResolvedValue({
    ...chatAnswer(),
    answer: JSON.stringify({ summary: 'Synthetic summary of the earlier part.' }),
  });
  const result = await s.post('/assistant/conversation/compact', { routineId: 'r' });
  expect(result.status).toBe(200);
  const summarizer = vi.mocked(runRoutineWithGosuLanguage).mock.calls;
  expect(summarizer).toHaveLength(1);
  const handed = JSON.parse(summarizer[0]![3]!.structuredJob!.prompt) as {
    olderMessages: unknown[];
  };
  expect(handed.olderMessages).toHaveLength(8);
  expect(result.frames.some((f) => f.type === 'progress')).toBe(true);
  const done = result.frames.find((f) => f.type === 'result')!.result as {
    compacted: boolean;
    summarizedMessages: number;
    contextUsage: { compressedMessages: number; includedMessages: number; totalMessages: number };
  };
  expect(done).toMatchObject({
    compacted: true,
    summarizedMessages: 8,
    contextUsage: { compressedMessages: 8, includedMessages: 4, totalMessages: 12 },
  });
  expect(await owner(() => s.store.conversation(s.profile))).toHaveLength(12);
  expect((await owner(() => s.store.conversationCheckpoint(s.profile)))?.through).toBe(8);

  // Asked again with nothing new: no model call and a plain "nothing to do".
  const again = await s.post('/assistant/conversation/compact', { routineId: 'r' });
  expect(vi.mocked(runRoutineWithGosuLanguage)).toHaveBeenCalledTimes(1);
  expect(again.frames.find((f) => f.type === 'result')!.result).toMatchObject({
    compacted: false,
    summarizedMessages: 0,
  });

  // The next turn gets the summary in place of the eight records, then the four raw ones.
  vi.mocked(runRoutineWithGosuLanguage).mockResolvedValue(chatAnswer());
  await s.post('/assistant/chat', { routineId: 'r', prompt: 'continue', history: [] });
  const sent = sentConversation(vi.mocked(runRoutineWithGosuLanguage).mock.calls[1]!);
  expect(JSON.stringify(sent)).toContain('Synthetic summary of the earlier part.');
  expect(JSON.stringify(sent)).not.toContain('earlier message 3');
  expect(JSON.stringify(sent)).toContain('earlier message 11');
});

it('/compact reports a failed summary with its reason and saves nothing', async () => {
  const s = await setup();
  await s.append(12, 'earlier');
  vi.mocked(runRoutineWithGosuLanguage).mockRejectedValue(new Error('routine_timeout'));
  const result = await s.post('/assistant/conversation/compact', { routineId: 'r' });
  const failure = result.frames.find((f) => f.type === 'error');
  expect(String(failure?.message)).toContain('시간이 초과');
  expect(result.frames.some((f) => f.type === 'result')).toBe(false);
  expect(await owner(() => s.store.conversationCheckpoint(s.profile))).toBeUndefined();
});

it('refuses both commands while an answer is running, with a reason that names them', async () => {
  const s = await setup();
  await s.append(6, 'old');
  let release!: () => void;
  const running = new Promise<void>((resolve) => (release = resolve));
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  vi.mocked(runRoutineWithGosuLanguage).mockImplementation(async () => {
    entered();
    await running;
    return chatAnswer();
  });
  const chat = s.post('/assistant/chat', { routineId: 'r', prompt: 'long question', history: [] });
  await started;
  for (const path of ['/assistant/conversation/new', '/assistant/conversation/compact']) {
    const refused = await s.post(path, { routineId: 'r' });
    expect(refused.status).toBe(400);
    expect(String(refused.frames[0]!.error)).toContain('/new와 /compact');
  }
  release();
  await chat;
  // The running answer was appended to the context it was planned against.
  expect(await owner(() => s.store.conversation(s.profile))).toHaveLength(8);
  const after = await s.post('/assistant/conversation/new', { routineId: 'r' });
  expect(after.frames[0]).toMatchObject({ started: true, setAside: 8 });
});
