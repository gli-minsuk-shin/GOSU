import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import {
  BriefingWorkspaceStore,
  retainPaperFigureCache,
  type BriefingHistory,
} from './briefing-workspace-store';
import { BriefingMemoryStore } from './briefing-memory-store';
import { LiveSourceService } from './live-source-service';
import { AppleMailConnection } from './live-mail';
import { CalendarService } from './calendar-service';
import { briefingClientContext } from './briefing-client-context';
import { enrichPaper, loadPaperFigure } from './briefing-paper-evidence';
import { versionedPaperId } from './src/paper-identity';
import { findSavedPaper } from './briefing-paper-cache';
import { readSavedPaperLibrary } from './briefing-knowledge';
import { matchesSavedPaper, paperLabels } from './src/paper-library-index';
import { randomUUID } from 'node:crypto';
import { saveHistoryFeedback } from './briefing-history-feedback';
import type { LiveItem } from './src/live-types';
import type { assistantModel } from './briefing-assistant';
import type { classifySavedPaperTexts } from './paper-classification';
import { BriefingGenerationStore } from './briefing-generation-store';
import { defaultModelRouting } from '@gosu/contracts';
import { savedPaperKey } from './src/paper-library-index';
import {
  briefingProviderSummary,
  briefingRoutedProviders,
  routedBriefingPreferences,
} from './briefing-model-routing';
vi.mock('./briefing-paper-evidence', () => ({
  enrichPaper: vi.fn(),
  loadPaperFigure: vi.fn(),
  scholarCandidates: () => [],
}));
const dirs: string[] = [],
  uri = 'https://arxiv.org/abs/2609.00001v1';
const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
beforeEach(() => {
  vi.mocked(enrichPaper)
    .mockReset()
    .mockImplementation(async (item) => ({
      ...item,
      paper: {
        readScope: 'html-excerpt',
        excerpt: 'Verified fixture body',
        sourceUrl: item.sourceUrl!.replace('/abs/', '/html/'),
        note: 'Fixture',
        equations: [{ id: 'e', latex: 'x^2' }],
        figures: [
          {
            id: 'f',
            caption: 'Source figure',
            assetUrl: item.sourceUrl!.replace('/abs/', '/html/') + '/figure.webp',
          },
        ],
      },
    }));
  vi.mocked(loadPaperFigure).mockReset().mockResolvedValue('data:image/webp;base64,UklGRg==');
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'paper-cache-'));
  dirs.push(dir);
  const workspace = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 4)),
    memory = new BriefingMemoryStore(dir, async () => Buffer.alloc(32, 4));
  const item: LiveItem = {
    id: '2609.00001',
    kind: 'papers',
    title: 'Synthetic paper',
    text: 'The original abstract.',
    source: 'arXiv',
    sourceUrl: uri,
    publishedAt: '2026-09-09T00:00:00Z',
    bibliography: { authors: ['Alice'], venue: 'Fixture Journal 2026', source: 'arXiv' },
    readScope: 'abstract',
    details: ['Authors', 'Updated metadata'],
  };
  await owner(() =>
    workspace.save(
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
  const insight = {
    id: item.id,
    summary: 'Saved scientific summary',
    importance: 'high' as const,
    importanceReason: 'Source-backed',
    relevance: 'Old research connection',
    action: 'Read',
    researchQuestion: 'Question',
    strengths: 'Strength',
    limitations: 'Limitation',
    methodsAndAssumptions: 'Method',
    reportedResults: 'Result',
    keywords: ['Method'],
    detail: 'Details',
    evidenceQuote: item.text,
    equationIds: ['e'],
    equationExplanations: [{ equationId: 'e', explanation: 'Exact equation' }],
    figureIds: ['f'],
    memorySuggestion: null,
  };
  const analyzer = vi.fn(async () => ({
    overview: 'Overview',
    items: [insight],
    invocation: { providerId: 'codex', model: 'test', reasoning: null },
    memoryUsed: [],
  }));
  const providers = {
    cities: vi.fn(async () => []),
    weather: vi.fn(async (): Promise<LiveItem[]> => []),
    papers: vi.fn(async () => [item]),
  };
  const service = new LiveSourceService(
    new AppleMailConnection(),
    providers,
    async () => undefined,
    analyzer,
    memory,
    workspace,
    new CalendarService(),
    async (preferences) =>
      ({ modelId: preferences.modelId || 'test' }) as Awaited<ReturnType<typeof assistantModel>>,
  );
  const request = {
    routineId: 'r',
    receiptId: '11111111-1111-4111-8111-111111111111',
    itemIds: [item.id],
    providerId: 'codex',
    modelId: 'test',
    reasoning: null,
    includeMail: false,
    memory: [],
  };
  (service as unknown as { receipts: Map<string, unknown> }).receipts.set(request.receiptId, {
    input: {
      routineId: 'r',
      live: defaultLiveSettings(),
      interest: { keywords: [], excluded: [] },
    },
    expiresAt: Date.now() + 60000,
    results: [{ kind: 'papers', items: [item] }],
  });
  const analyze = (refresh = false) =>
    owner(() => service.analyze({ ...request, refresh }, new AbortController().signal, vi.fn()));
  return { dir, workspace, memory, item, insight, analyzer, providers, service, request, analyze };
}
it('routes actual summary execution while preserving cached summaries, explicit choices and provider permissions', async () => {
  const f = await setup();
  const policy = defaultModelRouting();
  policy.fast = { providerId: 'codex', modelId: 'fast-fixture', reasoningOptionId: 'low' };
  f.service.modelRouting = async () => policy;
  await f.analyze();
  expect(f.analyzer.mock.calls.at(-1)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ modelId: 'fast-fixture', reasoning: 'low' }),
    ]),
  );
  policy.fast.modelId = 'other-fast-fixture';
  await f.analyze();
  expect(f.analyzer).toHaveBeenCalledTimes(1);
  const prefs = { ...defaultAssistantPreferences(), modelId: 'explicit-model' };
  // Settings → Agent decides every Briefing usage: a model stored with the routine (from the picker
  // Briefing had until 0.58.135) wins nowhere, not even in the assistant chat.
  expect(routedBriefingPreferences(prefs, policy, 'briefing')).toMatchObject({
    modelId: 'other-fast-fixture',
    reasoning: 'low',
  });
  policy.strong = { providerId: 'claude-code', modelId: 'strong-fixture', reasoningOptionId: null };
  expect(routedBriefingPreferences(prefs, policy, 'briefingAssistant')).toMatchObject({
    providerId: 'claude-code',
    modelId: 'strong-fixture',
    reasoning: null,
  });
  // A role without a model leaves the stored selection running.
  expect(routedBriefingPreferences(prefs, policy, 'lightweightTasks')).toBe(prefs);
  expect(routedBriefingPreferences(prefs, undefined, 'briefing')).toBe(prefs);
  expect(briefingRoutedProviders(policy).sort()).toEqual(['claude-code', 'codex']);
  expect(briefingRoutedProviders(undefined)).toEqual([]);
  expect(briefingProviderSummary(prefs, policy)).toBe(
    '설정 → Agent의 작업별 AI 모델을 따름 (현재 Codex, Claude Code)',
  );
  // The summary role on another provider runs there: the stored provider is only a fallback.
  policy.fast.providerId = 'claude-code';
  await f.analyze(true);
  expect(f.analyzer).toHaveBeenCalledTimes(2);
  expect(f.analyzer.mock.calls.at(-1)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ providerId: 'claude-code', modelId: 'other-fast-fixture' }),
    ]),
  );
  expect((await f.workspace.profile('r'))!.preferences.providerId).toBe('codex');
});
it('passes persisted exact summary identities into candidate selection before applying the arXiv display limit', async () => {
  const f = await setup();
  await f.analyze();
  const p = (await f.workspace.profile('r'))!;
  await owner(() =>
    f.service.collect(
      { routineId: 'r', live: p.live, interest: p.interest },
      new AbortController().signal,
      vi.fn(),
      true,
    ),
  );
  expect(f.providers.papers.mock.calls[0]).toEqual(
    expect.arrayContaining([new Set([savedPaperKey(f.item)])]),
  );
  expect(f.analyzer).toHaveBeenCalledOnce();
  expect(
    (await f.workspace.summaryHistory('r'))
      .flatMap((h) => h.items)
      .some((i) => i.summary === f.insight.summary),
  ).toBe(true);
  f.service.close();
});
it('generates one daily package, fetches weather only once and appends only new exact-version paper summaries', async () => {
  const f = await setup();
  const p = (await f.workspace.profile('r'))!;
  await owner(() =>
    f.workspace.save(
      {
        ...p,
        live: {
          ...p.live,
          weather: {
            id: 1,
            name: 'Fixture city',
            latitude: 37,
            longitude: 127,
            country: 'KR',
            timeZone: 'Asia/Seoul',
          },
        },
      },
      async () => undefined,
    ),
  );
  f.providers.weather.mockResolvedValue([
    {
      id: 'w',
      kind: 'weather',
      source: 'Fixture',
      title: 'Weather',
      text: '',
      details: [],
      readScope: 'forecast',
      weather: {
        city: 'Fixture city',
        timeZone: 'Asia/Seoul',
        localDate: '2026-09-10',
        currentTime: new Date().toISOString(),
        temperature: 20,
        wind: 2,
        code: 1,
        hours: [],
      },
    },
  ]);
  const engine = f.service.enableGeneration(
    new BriefingGenerationStore(f.dir, async () => Buffer.alloc(32, 4)),
    false,
  );
  const analyze = f.service.analyze.bind(f.service);
  vi.spyOn(f.service, 'analyze').mockImplementation(async (...args) => {
    expect((await owner(() => engine.status('r'))).job?.progress).toEqual({
      stage: 'summarize',
      completed: 0,
      total: 1,
    });
    return analyze(...args);
  });
  await owner(() => engine.start('r'));
  await engine.wait('r');
  expect((await owner(() => engine.status('r'))).job).toMatchObject({
    state: 'complete',
    error: null,
    progress: { stage: 'finalize', completed: 0, total: null },
  });
  expect(f.analyzer).toHaveBeenCalledOnce();
  const first = (await f.workspace.history('r')).find((h) => h.items.length)!;
  expect(first.items[0]?.addedAt).toBeTruthy();
  await owner(() => engine.start('r'));
  await engine.wait('r');
  expect(f.analyzer).toHaveBeenCalledOnce();
  expect(f.providers.weather).toHaveBeenCalledOnce();
  const newItem = { ...f.item, id: '2609.00002', sourceUrl: 'https://arxiv.org/abs/2609.00002v1' };
  f.providers.papers.mockResolvedValue([f.item, newItem]);
  f.analyzer.mockResolvedValue({
    overview: 'New paper',
    items: [{ ...f.insight, id: newItem.id }],
    invocation: { providerId: 'codex', model: 'test', reasoning: null },
    memoryUsed: [],
  });
  await owner(() => engine.start('r'));
  await engine.wait('r');
  const history = await f.workspace.history('r');
  expect(f.analyzer).toHaveBeenCalledTimes(2);
  expect(new Set(history.map((h) => h.runId)).size).toBe(1);
  expect(
    history
      .flatMap((h) => h.items)
      .map((i) => i.id)
      .sort(),
  ).toEqual([f.item.id, newItem.id]);
  expect(history.find((h) => h.items.some((i) => i.id === f.item.id))?.items[0]?.addedAt).toBe(
    first.items[0]?.addedAt,
  );
  expect((await owner(() => engine.status('r'))).job?.newCount).toBe(1);
  engine.close();
});
it('collects permitted GOSU todos into the existing agenda without inference and refreshes completed items away', async () => {
  const f = await setup();
  const p = (await f.workspace.profile('r'))!;
  await owner(() =>
    f.workspace.save(
      {
        ...p,
        live: { ...p.live, papers: { ...p.live.papers, enabled: false } },
        preferences: { ...p.preferences, todoRead: true },
      },
      async () => {},
    ),
  );
  const read = vi.fn(async () => ({
    items: [
      {
        id: 'todo',
        title: 'Review',
        projectName: 'Project',
        status: 'planned' as const,
        dueDate: '2026-09-11',
      },
    ],
    limited: false,
    fetchedAt: '2026-09-11T00:00:00Z',
  }));
  f.service.todoReader = read;
  const engine = f.service.enableGeneration(
    new BriefingGenerationStore(f.dir, async () => Buffer.alloc(32, 4)),
    false,
  );
  await owner(() => engine.start('r'));
  await engine.wait('r');
  expect((await owner(() => engine.status('r'))).job).toMatchObject({
    state: 'complete',
    todoCount: 1,
  });
  expect(
    (await f.workspace.history('r')).some((h) => h.snapshot?.todos?.items[0]?.id === 'todo'),
  ).toBe(true);
  expect(f.analyzer).not.toHaveBeenCalled();
  read.mockResolvedValue({ items: [], limited: false, fetchedAt: '2026-09-11T01:00:00Z' });
  await owner(() => engine.start('r'));
  await engine.wait('r');
  expect((await f.workspace.history('r')).find((h) => h.snapshot)?.snapshot?.todos?.items).toEqual(
    [],
  );
  engine.close();
});
it('collects only unseen papers for a new briefing but retains saved summaries and explicit raw reads', async () => {
  const f = await setup();
  await f.analyze();
  const input = {
    routineId: 'r',
    live: defaultLiveSettings(),
    interest: { keywords: [], excluded: [] },
  };
  const fresh = await owner(() => f.service.collect(input, new AbortController().signal, vi.fn()));
  expect(fresh.find((r) => r.kind === 'papers')?.items).toEqual([]);
  expect(fresh.find((r) => r.kind === 'papers')?.notice).toContain('새 논문이 없습니다');
  expect(
    (await f.workspace.summaryHistory('r')).some((h) => h.items.some((i) => i.id === f.item.id)),
  ).toBe(true);
  const raw = await owner(() =>
    f.service.collect(input, new AbortController().signal, vi.fn(), false),
  );
  expect(raw.find((r) => r.kind === 'papers')?.items).toHaveLength(1);
  expect(f.analyzer).toHaveBeenCalledOnce();
});
it('loads and saves source equations and images for the fourth paper too, then reuses all without source calls', async () => {
  const f = await setup();
  const items = Array.from({ length: 4 }, (_, n) => ({
    ...f.item,
    id: `2609.1000${n}`,
    sourceUrl: `https://arxiv.org/abs/2609.1000${n}v1`,
  }));
  f.providers.papers.mockResolvedValue(items);
  const results = await owner(() =>
    f.service.collect(
      { routineId: 'r', live: defaultLiveSettings(), interest: { keywords: [], excluded: [] } },
      new AbortController().signal,
      vi.fn(),
    ),
  );
  f.analyzer.mockResolvedValue({
    overview: 'All',
    items: items.map((i) => ({ ...f.insight, id: i.id })),
    invocation: { providerId: 'codex', model: 'test', reasoning: null },
    memoryUsed: [],
  });
  const request = {
    ...f.request,
    receiptId: results[0]!.receiptId,
    itemIds: items.map((i) => i.id),
  };
  await owner(() => f.service.analyze(request, new AbortController().signal, vi.fn()));
  expect(enrichPaper).toHaveBeenCalledTimes(4);
  expect(loadPaperFigure).toHaveBeenCalledTimes(4);
  const saved = (await f.workspace.summaryHistory('r')).flatMap((h) => h.items);
  expect(saved.find((i) => i.id === items[3]!.id)).toMatchObject({
    equations: [{ latex: 'x^2', explanation: 'Exact equation' }],
    figures: [{ imageData: 'data:image/webp;base64,UklGRg==' }],
  });
  await owner(() => f.service.analyze(request, new AbortController().signal, vi.fn()));
  expect(enrichPaper).toHaveBeenCalledTimes(4);
  expect(loadPaperFigure).toHaveBeenCalledTimes(4);
  expect(f.analyzer).toHaveBeenCalledOnce();
});
it('does not silently evict saved library figures after the former 3MB cache budget', async () => {
  const f = await setup();
  const imageData = 'data:image/webp;base64,' + 'A'.repeat(400000);
  for (let n = 0; n < 8; n++) {
    const id = `2609.2000${n}`;
    await f.workspace.saveBriefing('r', { overview: 'Stored', items: [{ ...f.insight, id }] }, [
      {
        ...f.item,
        id,
        sourceUrl: `https://arxiv.org/abs/${id}v1`,
        paper: {
          readScope: 'html-excerpt',
          excerpt: 'Evidence',
          sourceUrl: `https://arxiv.org/html/${id}v1`,
          note: 'Fixture',
          equations: [{ id: 'e', latex: 'x^2' }],
          figures: [
            {
              id: 'f',
              caption: 'Figure',
              assetUrl: `https://arxiv.org/html/${id}v1/figure.webp`,
              imageData,
            },
          ],
        },
      },
    ]);
  }
  const reopened = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 4));
  const state = await (
    reopened as unknown as {
      state: {
        read(): Promise<{
          paperArchive: Array<{
            items: Array<{
              figures?: Array<{ imageData?: string }>;
              equations?: Array<{ latex: string }>;
            }>;
          }>;
        }>;
      };
    }
  ).state.read();
  expect(state.paperArchive).toHaveLength(8);
  expect(state.paperArchive.every((h) => h.items[0]?.figures?.[0]?.imageData === imageData)).toBe(
    true,
  );
  expect(state.paperArchive.every((h) => h.items[0]?.equations?.[0]?.latex === 'x^2')).toBe(true);
});
it('classifies newly saved summaries automatically but never classifies on cached-only summary reuse', async () => {
  const f = await setup();
  const classifier = vi.fn<typeof classifySavedPaperTexts>().mockResolvedValue({
    items: [{ id: 'p0', categoryId: 'statistics', reason: 'Saved methods', inputTruncated: false }],
    invocation: { providerId: 'codex', model: 'test', reasoning: null },
  });
  f.service.paperClassifier = classifier;
  await f.analyze();
  expect(classifier).toHaveBeenCalledOnce();
  expect((await f.workspace.summaryHistory('r'))[0]?.items[0]?.classification?.categoryId).toBe(
    'statistics',
  );
  const second = await f.analyze();
  expect(second.cache.generatedItemIds).toEqual([]);
  expect(classifier).toHaveBeenCalledOnce();
  expect(f.analyzer).toHaveBeenCalledOnce();
});
it('preserves a successful summary when the optional automatic classification fails', async () => {
  const f = await setup();
  f.service.paperClassifier = vi
    .fn<typeof classifySavedPaperTexts>()
    .mockRejectedValue(new Error('provider unavailable'));
  const result = await f.analyze();
  expect(result.historyId).toBeTruthy();
  expect((await f.workspace.summaryHistory('r'))[0]?.items[0]?.summary).toBe(f.insight.summary);
  expect((await f.workspace.summaryHistory('r'))[0]?.items[0]?.classification).toBeUndefined();
});
it('persists source publication separately from summary/save dates across cache reuse and restart, without inferring missing publication', async () => {
  const f = await setup();
  await f.analyze();
  const first = (await f.workspace.summaryHistory('r'))[0]!.items[0]!;
  expect(first.paperPublishedAt).toBe(new Date(f.item.publishedAt!).toISOString());
  await f.analyze();
  const restarted = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 4));
  const saved = (await restarted.summaryHistory('r'))[0]!.items[0]!;
  expect(saved.paperPublishedAt).toBe(first.paperPublishedAt);
  expect(saved.bibliography).toEqual(f.item.bibliography);
  expect(saved.provenance?.summarizedAt).toBe(first.provenance?.summarizedAt);
  expect(f.analyzer).toHaveBeenCalledOnce();
  const { publishedAt: _publishedAt, ...withoutPublication } = f.item;
  await f.workspace.saveBriefing('r', { overview: 'Updated', items: [f.insight] }, [
    withoutPublication,
  ]);
  const refreshed = (await f.workspace.summaryHistory('r'))[0]!.items[0]!;
  expect(refreshed.equations?.[0]?.latex).toBe('x^2');
  expect(refreshed.figures?.[0]?.imageData).toBe('data:image/webp;base64,UklGRg==');
  expect((await f.workspace.summaryHistory('r'))[0]!.items[0]!.paperPublishedAt).toBe(
    first.paperPublishedAt,
  );
  await f.workspace.saveBriefing(
    'r',
    { overview: 'Unknown', items: [{ ...f.insight, id: 'unknown' }] },
    [
      {
        ...withoutPublication,
        id: 'unknown',
        sourceUrl: 'https://example.org/unknown-paper',
      },
    ],
  );
  expect((await f.workspace.summaryHistory('r'))[0]!.items[0]!.paperPublishedAt).toBeUndefined();
});
it('reuses the same version before any arXiv HTML/image work and preserves equations, images and original time', async () => {
  const f = await setup();
  const first = await f.analyze();
  vi.mocked(enrichPaper).mockRejectedValue(new Error('arxiv blocked'));
  vi.mocked(loadPaperFigure).mockRejectedValue(new Error('arxiv blocked'));
  const second = await f.analyze();
  expect(f.analyzer).toHaveBeenCalledTimes(1);
  expect(enrichPaper).toHaveBeenCalledTimes(1);
  expect(loadPaperFigure).toHaveBeenCalledTimes(1);
  expect(f.providers.papers).not.toHaveBeenCalled();
  expect(second.cache.reusedItemIds).toEqual([f.item.id]);
  expect(second.provenance[f.item.id]?.summarizedAt).toBe(
    first.provenance[f.item.id]?.summarizedAt,
  );
  expect(second.evidence[0]?.paper?.equations[0]?.latex).toBe('x^2');
  expect(second.evidence[0]?.paper?.figures[0]?.imageData).toBe('data:image/webp;base64,UklGRg==');
  const reopened = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 4));
  expect((await reopened.history('r'))[0]?.items[0]?.figures?.[0]?.imageData).toBe(
    'data:image/webp;base64,UklGRg==',
  );
});
it('retains searchable paper summaries across more than 60 briefing runs, including encrypted restart and cache reuse', async () => {
  const f = await setup();
  const first = await f.analyze();
  for (let n = 0; n < 61; n++)
    await f.workspace.saveCollection('r', randomUUID(), [], null, new AbortController().signal);
  expect((await f.workspace.history('r', '', 600)).flatMap((h) => h.items)).toHaveLength(1);
  const reopened = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 4));
  const library = await owner(() =>
    readSavedPaperLibrary(reopened, 'r', new AbortController().signal, 'scientific'),
  );
  expect(library.papers).toHaveLength(1);
  const saved = library.papers[0]!;
  await owner(() =>
    saveHistoryFeedback(
      { routineId: 'r', historyId: saved.historyId, itemId: saved.item.id, decision: 'important' },
      reopened,
      f.memory,
      async () => undefined,
      new AbortController().signal,
    ),
  );
  expect(await f.memory.feedbackChoices('r', [saved.item.id])).toEqual({
    [saved.item.id]: 'important',
  });
  const cleared = await owner(() =>
    saveHistoryFeedback(
      { routineId: 'r', historyId: saved.historyId, itemId: saved.item.id, decision: null },
      reopened,
      f.memory,
      async () => undefined,
      new AbortController().signal,
    ),
  );
  expect(cleared.decision).toBeNull();
  expect(await f.memory.feedbackChoices('r', [saved.item.id])).toEqual({});
  expect(library.papers[0]?.item.provenance?.summarizedAt).toBe(
    first.provenance[f.item.id]?.summarizedAt,
  );
  expect(await reopened.summaryHistory('other')).toEqual([]);
  await expect(readSavedPaperLibrary(reopened, 'r', new AbortController().signal)).rejects.toThrow(
    'assistant_client_required',
  );
  vi.mocked(enrichPaper).mockRejectedValue(new Error('offline'));
  const second = await f.analyze();
  expect(second.cache.reusedItemIds).toEqual([f.item.id]);
  expect(f.analyzer).toHaveBeenCalledTimes(1);
});
it('uses persisted categories instead of title heuristics and searches all five saved sections', () => {
  const paper = {
    historyId: 'h',
    savedAt: '2026-09-09',
    item: {
      id: 'p',
      title: 'Efficient diffusion',
      summary: '',
      importance: 'high',
      relevance: '',
      readScope: 'abstract',
      keywords: ['Diffusion', ' diffusion ', 'Bayesian'],
      limitations: 'Small cohort limitation',
      classification: {
        taxonomyVersion: 1 as const,
        categoryId: 'statistics' as const,
        source: 'ai' as const,
        reason: 'Saved contribution',
        classifiedAt: '2026-09-10T00:00:00Z',
        summaryDigest: 'a'.repeat(64),
        revision: 1,
      },
    },
  };
  expect(paperLabels(paper.item)).toEqual({
    tags: ['Diffusion', 'Bayesian'],
    categories: ['통계·최적화'],
  });
  expect(matchesSavedPaper(paper, 'COHORT', '통계·최적화', 'bayesian')).toBe(true);
  expect(matchesSavedPaper(paper, '', '컴퓨터 비전')).toBe(false);
  expect(paperLabels({ ...paper.item, classification: undefined }).categories).toEqual([
    '분류 대기',
  ]);
});
it('keeps old personalization explicitly dated after feedback changes, without re-analysis or relabeling its revision', async () => {
  const f = await setup();
  await f.analyze();
  await f.memory.feedback('r', f.item, 'important', new AbortController().signal);
  const second = await f.analyze(),
    third = await f.analyze();
  expect(f.analyzer).toHaveBeenCalledTimes(1);
  expect(enrichPaper).toHaveBeenCalledTimes(1);
  for (const result of [second, third])
    expect(result.provenance[f.item.id]).toMatchObject({
      feedbackProfileRevision: 0,
      personalizationStale: true,
      reused: true,
    });
});
it.each(['version', 'metadata', 'explicit'] as const)(
  'does not silently reuse on %s change/refresh',
  async (change) => {
    const f = await setup();
    await f.analyze();
    if (change === 'version') f.item.sourceUrl = 'https://arxiv.org/abs/2609.00001v2';
    if (change === 'metadata') f.item.text = 'Changed abstract';
    const result = await f.analyze(change === 'explicit');
    expect(f.analyzer).toHaveBeenCalledTimes(2);
    expect(enrichPaper).toHaveBeenCalledTimes(2);
    expect(result.provenance[f.item.id]?.reused).toBe(false);
  },
);
it('reads a legacy version-bound snapshot without inventing a generation date or source digest', async () => {
  const f = await setup();
  await f.workspace.saveBriefing('r', { overview: 'Legacy', items: [f.insight] }, [f.item]);
  const result = await f.analyze();
  expect(f.analyzer).not.toHaveBeenCalled();
  expect(enrichPaper).not.toHaveBeenCalled();
  expect(result.provenance[f.item.id]).toMatchObject({
    version: 2,
    sourceDigest: null,
    summarizedAt: null,
    reused: true,
  });
});
it('never reuses a privately influenced paper after private AI permission is absent', async () => {
  const f = await setup();
  await f.workspace.saveBriefing(
    'r',
    { overview: 'Private', items: [{ ...f.insight, summary: 'Private old interpretation' }] },
    [f.item],
    true,
  );
  const result = await f.analyze();
  expect(f.analyzer).toHaveBeenCalledTimes(1);
  expect(result.items[0]?.summary).not.toContain('Private old');
});
it('does not silently read a private saved snapshot under ask-every-time policy', async () => {
  const f = await setup();
  const p = (await f.workspace.profile('r'))!;
  await owner(() =>
    f.workspace.save(
      { ...p, preferences: { ...p.preferences, mailAi: true, confirmationPolicy: 'ask' } },
      async () => undefined,
    ),
  );
  await f.workspace.saveBriefing(
    'r',
    { overview: 'Private', items: [{ ...f.insight, summary: 'Private old interpretation' }] },
    [f.item],
    true,
  );
  const result = await f.analyze();
  expect(result.items[0]?.summary).not.toContain('Private old');
  expect(f.analyzer).toHaveBeenCalledOnce();
});
it('requires exact versioned arXiv identity, not a title, versionless URL or lookalike host', () => {
  expect(versionedPaperId(uri)).toBe('2609.00001v1');
  expect(versionedPaperId('https://arxiv.org/pdf/hep-th/9901001v2.pdf')).toBe('hep-th/9901001v2');
  for (const url of [
    'https://arxiv.org/abs/2609.00001',
    'https://arxiv.org.evil.test/abs/2609.00001v1',
    'https://user@arxiv.org/abs/2609.00001v1',
    uri + '?x=1',
  ])
    expect(versionedPaperId(url)).toBeNull();
  expect(
    findSavedPaper(
      {
        id: 'x',
        kind: 'papers',
        title: 'same',
        sourceUrl: uri,
        source: '',
        readScope: 'abstract',
        text: '',
        details: [],
      },
      [],
    ),
  ).toBeNull();
});
it('bounds cached image bytes without deleting older summaries or captions', () => {
  const entry = (id: string) =>
    ({
      id,
      routineId: 'r',
      createdAt: '2026-09-09T00:00:00Z',
      kind: 'briefing',
      answer: 'Keep',
      private: false,
      items: [
        {
          id,
          kind: 'papers',
          title: 'Keep title',
          summary: 'Keep summary',
          importance: 'high',
          relevance: '',
          readScope: 'abstract',
          figures: [
            {
              id: 'f',
              caption: 'Keep caption',
              assetUrl: uri + '/x',
              imageData: 'data:image/webp;base64,UklGRg==',
            },
          ],
        },
      ],
    }) as BriefingHistory;
  const newer = entry('new'),
    older = entry('old');
  const result = retainPaperFigureCache(
    [older, newer],
    newer.items[0]!.figures![0]!.imageData!.length,
  );
  expect(result[1]!.items[0]!.figures![0]!.imageData).toBeTruthy();
  expect(result[0]!.items[0]!.figures![0]).not.toHaveProperty('imageData');
  expect(result[0]!.items[0]!.summary).toBe('Keep summary');
  expect(older.items[0]!.figures![0]!.imageData).toBeTruthy();
});

// 2026-09-22 user request: the Usage screen gets a tab for paper summaries, so their model calls
// are recorded as a feature of their own instead of inside "브리핑·요약".
it('records the model calls of a paper-only summary as paper_summary usage', async () => {
  const { configureNativeUsageObserver, observeNativeUsage } =
    await import('./native-usage-observer');
  const seen: string[] = [];
  configureNativeUsageObserver(async (event) => {
    seen.push(event.workloadKind);
  });
  try {
    const s = await setup();
    // The real analyzer reports its usage from inside the call; the scope must reach it there.
    s.analyzer.mockImplementation(async () => {
      await observeNativeUsage({
        invocation: {} as never,
        usage: undefined,
        completedAt: '2026-09-22T00:00:00.000Z',
        successful: true,
      });
      return {
        overview: 'Overview',
        items: [s.insight],
        invocation: { providerId: 'codex', model: 'test', reasoning: null },
        memoryUsed: [],
      };
    });
    await s.analyze();
    expect(seen).toEqual(['paper_summary']);
  } finally {
    configureNativeUsageObserver(undefined);
  }
});
