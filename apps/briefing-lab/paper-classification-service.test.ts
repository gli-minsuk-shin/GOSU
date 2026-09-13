import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { briefingClientContext } from './briefing-client-context';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { LiveSourceService } from './live-source-service';
import { indexSavedPapers, paperLabels } from './src/paper-library-index';
import { classificationDigest } from './paper-classification-data';
import { classifyResolvedPapers, editResolvedPaper } from './paper-classification-service';
import type { classifySavedPaperTexts } from './paper-classification';
import type { assistantModel } from './briefing-assistant';
import { SharedPaperSummaryLibrary } from './paper-summary-library';
import { paperSummaryCandidate } from './src/paper-summary-contract';

const dirs: string[] = [];
const owner = <T>(fn: () => T) => briefingClientContext.run('a'.repeat(64), fn);
const signal = () => new AbortController().signal;
const selection = { providerId: 'codex' as const, modelId: 'fixture-model', reasoning: 'medium' };
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'paper-classification-test-'));
  dirs.push(dir);
  const store = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 3));
  const profile = await owner(() =>
    store.save(
      {
        routineId: 'r',
        name: 'Fixture',
        timeZone: 'Asia/Seoul',
        live: defaultLiveSettings(),
        interest: { keywords: [], excluded: [] },
        preferences: {
          ...defaultAssistantPreferences(),
          modelId: selection.modelId,
          reasoning: selection.reasoning,
          mailAi: false,
        },
      },
      async () => undefined,
    ),
  );
  const save = (summary = 'Stored causal inference summary', privateContext = false) =>
    store.saveBriefing(
      'r',
      {
        overview: 'Saved',
        items: [
          {
            id: 'p',
            summary,
            researchQuestion: 'An estimation problem',
            methodsAndAssumptions: 'Bayesian model',
            importance: 'medium',
            importanceReason: '',
            relevance: '',
            action: '',
            evidenceQuote: 'evidence',
            equationIds: [],
            figureIds: [],
            memorySuggestion: null,
          },
        ],
      },
      [
        {
          id: 'p',
          kind: 'papers',
          title: 'Generic paper',
          sourceUrl: 'https://arxiv.org/abs/2609.00001v1',
          readScope: 'abstract',
        },
      ],
      privateContext,
    );
  await save();
  // Keep each lookup fresh; neither the classifier nor these requests query a paper source.
  const getPapers = async () =>
    store.classificationViews('r', indexSavedPapers(await store.summaryHistory('r')));
  const classifier = vi
    .fn<typeof classifySavedPaperTexts>()
    .mockImplementation(async (items, _selection, _signal, _progress, guard) => {
      await guard();
      return {
        items: items.map((_, n) => ({
          id: `p${n}`,
          categoryId: 'statistics' as const,
          reason: '중심 연구 질문이 통계적 추정입니다.',
          inputTruncated: false,
        })),
        invocation: { providerId: 'codex', model: 'fixture-model', reasoning: 'medium' },
      };
    });
  const resolve = vi
    .fn<typeof assistantModel>()
    .mockResolvedValue({ modelId: selection.modelId } as Awaited<
      ReturnType<typeof assistantModel>
    >);
  const providers = {
    cities: vi.fn(async () => []),
    weather: vi.fn(async () => []),
    papers: vi.fn(async () => []),
  };
  const service = new LiveSourceService(
    undefined,
    providers,
    undefined,
    undefined,
    undefined,
    store,
    undefined,
    resolve,
  );
  service.paperClassifier = classifier;
  const invoke = async (path: string, body: unknown, client = 'a') => {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), {
      method: 'POST',
      url: `/api/briefing-agent/sources${path}`,
      headers: { 'content-type': 'application/json' },
    }) as IncomingMessage;
    let status = 0,
      data = '';
    const res = {
      writeHead: (s: number) => {
        status = s;
      },
      end: (v: string) => {
        data = v;
      },
    };
    await briefingClientContext.run(client.repeat(64), () =>
      service.handle(req, res as unknown as ServerResponse, signal()),
    );
    return { status, data: JSON.parse(data) };
  };
  return { dir, store, profile, save, getPapers, classifier, resolve, providers, service, invoke };
}

it('classifies existing saved summaries, persists encrypted across restart and never calls arXiv or re-summarizes on reading', async () => {
  const f = await setup();
  const before = (await f.getPapers())[0]!;
  const target = { key: before.classificationKey, expectedRevision: 0 };
  expect(paperLabels(before.item).categories).toEqual(['분류 대기']);
  expect((await f.invoke('/papers/classify', { routineId: 'r', targets: [target] })).status).toBe(
    200,
  );
  expect(f.classifier).toHaveBeenCalledOnce();
  expect(f.classifier.mock.calls[0]?.[0][0]?.methodsAndAssumptions).toBe('Bayesian model');
  expect(f.classifier.mock.calls[0]?.[1]).toEqual(selection);
  expect(f.providers.papers).not.toHaveBeenCalled();
  const reopened = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 3));
  const after = indexSavedPapers(await reopened.summaryHistory('r'))[0]!;
  expect(after.savedAt).toBe(before.savedAt);
  expect(after.item.summary).toBe(before.item.summary);
  expect(after.item.classification).toMatchObject({
    categoryId: 'statistics',
    source: 'ai',
    revision: 1,
    summaryDigest: classificationDigest(before.item),
  });
  expect(await readFile(join(f.dir, 'workspace.v1.enc.json'), 'utf8')).not.toContain('통계적');
  await f.invoke('/papers/saved', { routineId: 'r' });
  await f.invoke('/papers/classify', {
    routineId: 'r',
    targets: [{ ...target, expectedRevision: 1 }],
  });
  expect(f.classifier).toHaveBeenCalledOnce();
});
it('lets the user correct a category without inference and protects it from explicit AI refresh or stale edits', async () => {
  const f = await setup(),
    paper = (await f.getPapers())[0]!;
  const target = { key: paper.classificationKey, expectedRevision: 0 };
  expect(
    (
      await f.invoke('/papers/classification/edit', {
        routineId: 'r',
        target,
        categoryId: 'learning',
      })
    ).status,
  ).toBe(200);
  expect(f.classifier).not.toHaveBeenCalled();
  expect(
    (
      await f.invoke('/papers/classify', {
        routineId: 'r',
        targets: [{ ...target, expectedRevision: 1 }],
        refresh: true,
      })
    ).data,
  ).toEqual({ saved: [], skipped: 1 });
  expect(f.classifier).not.toHaveBeenCalled();
  expect(
    (await f.invoke('/papers/classification/edit', { routineId: 'r', target, categoryId: 'other' }))
      .status,
  ).not.toBe(200);
  expect((await f.getPapers())[0]?.item.classification).toMatchObject({
    source: 'user',
    categoryId: 'learning',
  });
});
it('does not overwrite a manual edit or changed source summary while an AI classification is in flight', async () => {
  const f = await setup(),
    paper = (await f.getPapers())[0]!;
  f.classifier.mockImplementationOnce(async () => {
    await editResolvedPaper(f.store, f.profile, paper, 0, 'science', signal());
    return {
      items: [
        { id: 'p0', categoryId: 'statistics', reason: 'Old AI result', inputTruncated: false },
      ],
      invocation: { providerId: 'codex', model: 'fixture-model', reasoning: null },
    };
  });
  const saved = await owner(() =>
    classifyResolvedPapers(
      f.store,
      f.profile,
      [paper],
      selection,
      f.classifier,
      signal(),
      () => undefined,
    ),
  );
  expect(saved).toEqual([]);
  expect((await f.getPapers())[0]?.item.classification?.categoryId).toBe('science');
  await f.save('A changed scientific summary');
  expect((await f.getPapers())[0]?.item.classification).toMatchObject({
    categoryId: 'science',
    stale: true,
  });
  const f2 = await setup(),
    old = (await f2.getPapers())[0]!;
  f2.classifier.mockImplementationOnce(async () => {
    await f2.save('Different saved scientific results');
    return {
      items: [
        { id: 'p0', categoryId: 'statistics', reason: 'Stale result', inputTruncated: false },
      ],
      invocation: { providerId: 'codex', model: 'fixture-model', reasoning: null },
    };
  });
  expect(
    await owner(() =>
      classifyResolvedPapers(
        f2.store,
        f2.profile,
        [old],
        selection,
        f2.classifier,
        signal(),
        () => undefined,
      ),
    ),
  ).toEqual([]);
});
it('rejects foreign owners, invented targets, duplicate ids, private shared AI without permission and revoked settings', async () => {
  const f = await setup(),
    paper = (await f.getPapers())[0]!;
  const target = { key: paper.classificationKey, expectedRevision: 0 };
  expect(
    (await f.invoke('/papers/classify', { routineId: 'r', targets: [target] }, 'b')).status,
  ).not.toBe(200);
  expect(
    (
      await f.invoke('/papers/classify', {
        routineId: 'r',
        targets: [{ ...target, key: '0'.repeat(64) }],
      })
    ).status,
  ).not.toBe(200);
  expect(
    (await f.invoke('/papers/classify', { routineId: 'r', targets: [target, target] })).status,
  ).not.toBe(200);
  const shared = new SharedPaperSummaryLibrary(
    join(f.dir, 'shared'),
    async () => Buffer.alloc(32, 3),
    async (candidate) => [candidate],
  );
  await shared.save(
    {
      candidate: paperSummaryCandidate(
        'Explain https://arxiv.org/abs/2609.00001v1',
        '**A paper**\nSaved analysis',
      ),
      confirmed: true,
    },
    'Briefing Lab',
  );
  f.service.sharedPaperLibrary = shared;
  const sharedPaper = (await f.invoke('/papers/saved', { routineId: 'r' })).data.papers.find(
    (p: { historyId: string }) => p.historyId.startsWith('shared:'),
  );
  expect(
    (
      await f.invoke('/papers/classify', {
        routineId: 'r',
        targets: [{ key: sharedPaper.classificationKey, expectedRevision: 0 }],
      })
    ).status,
  ).not.toBe(200);
  expect(f.classifier).not.toHaveBeenCalled();
  f.classifier.mockImplementationOnce(async () => {
    await f.store.save({ ...f.profile, name: 'Changed' }, async () => undefined);
    return {
      items: [{ id: 'p0', categoryId: 'statistics', reason: 'Invalidated', inputTruncated: false }],
      invocation: { providerId: 'codex', model: 'fixture-model', reasoning: null },
    };
  });
  expect(
    (await f.invoke('/papers/classify', { routineId: 'r', targets: [target] })).status,
  ).not.toBe(200);
  expect((await f.getPapers())[0]?.item.classification).toBeUndefined();
});
