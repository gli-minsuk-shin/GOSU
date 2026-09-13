import { afterEach, expect, it, vi } from 'vitest';
import { defaultModelRouting } from '@gosu/contracts';
import { defaultLiveSettings, defaultAssistantPreferences } from '@gosu/briefing-core';
import { initialRealWorkspace } from './src/workspace-defaults';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { preparePaperSummaries } from './paper-summary-ingestion';
import { publicSourceText } from './live-public-http';
import { analyzeBriefing } from './briefing-analysis';
import { assistantModel } from './briefing-assistant';
import { enrichPaper } from './briefing-paper-evidence';
import { sharedPaperView } from './src/shared-paper-view';
import { resolvePaperSaveSource } from './paper-save-source';
vi.mock('./paper-save-source', () => ({ resolvePaperSaveSource: vi.fn() }));
import type { PaperSummaryRecord } from './src/paper-summary-contract';
vi.mock('./live-public-http', () => ({ publicSourceText: vi.fn() }));
vi.mock('./briefing-analysis', () => ({ analyzeBriefing: vi.fn() }));
vi.mock('./briefing-assistant', () => ({ assistantModel: vi.fn() }));
vi.mock('./briefing-paper-evidence', () => ({ enrichPaper: vi.fn(), loadPaperFigure: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const candidate = {
  title: 'Not a paper: user conversation',
  question: '논문 요약에 없는데?',
  markdown: 'Store this conversation',
  sourceUrls: ['https://arxiv.org/abs/2609.00001v1'],
};
const insight = {
  id: '2609.00001v1',
  summary: 'Verified abstract summary',
  importance: 'high' as const,
  importanceReason: '',
  relevance: '',
  action: '',
  evidenceQuote: 'A verified scientific abstract',
  researchQuestion: 'Question',
  strengths: 'Strengths',
  limitations: 'Abstract only',
  methodsAndAssumptions: 'Method',
  reportedResults: 'Reported results',
  equationIds: [],
  figureIds: [],
  memorySuggestion: null,
};
it('rejects conversation-only and nonpaper links before reading sources or calling an LLM', async () => {
  for (const sourceUrls of [[], ['https://example.com/search?q=paper']])
    await expect(preparePaperSummaries({ ...candidate, sourceUrls }, [])).rejects.toThrow(
      '논문 링크',
    );
  expect(publicSourceText).not.toHaveBeenCalled();
  expect(analyzeBriefing).not.toHaveBeenCalled();
});
it('uses verified source title and the summary role, stores five sections, and reuses an existing exact version', async () => {
  vi.mocked(publicSourceText).mockResolvedValue(
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2609.00001v1</id><title>Actual scientific paper title</title><summary>A verified scientific abstract with enough source content.</summary><published>2026-09-01T00:00:00Z</published><updated>2026-09-01T00:00:00Z</updated><author><name>Test Author</name></author></entry></feed>',
  );
  vi.mocked(enrichPaper).mockImplementation(async (item) => item);
  const workspace = initialRealWorkspace('2026-09-13T00:00:00Z');
  vi.spyOn(BriefingWorkspaceStore.prototype, 'desktopConfiguration').mockResolvedValue({
    ...workspace,
    routines: [
      {
        ...workspace.routines[0]!,
        live: { ...defaultLiveSettings(), assistant: defaultAssistantPreferences() },
      },
    ],
  });
  vi.mocked(assistantModel).mockImplementation(
    async (preferences) =>
      ({ modelId: preferences.modelId }) as Awaited<ReturnType<typeof assistantModel>>,
  );
  vi.mocked(analyzeBriefing).mockImplementation(async (_input, items) => ({
    items: [{ ...insight, id: items[0]!.id }],
    overview: '',
    invocation: { providerId: 'codex', model: 'fast-model', reasoning: 'low' },
    memoryUsed: [],
  }));
  const policy = defaultModelRouting();
  policy.fast = { providerId: 'codex', modelId: 'fast-model', reasoningOptionId: 'low' };
  policy.strong = { providerId: 'codex', modelId: 'strong-chat', reasoningOptionId: 'high' };
  const [saved] = await preparePaperSummaries(candidate, [], async () => policy);
  expect(saved?.title).toBe('Actual scientific paper title');
  expect(saved?.markdown).not.toContain(candidate.markdown);
  expect(saved?.markdown).toContain('## 보고된 결과');
  expect(vi.mocked(analyzeBriefing).mock.calls[0]?.[0]).toMatchObject({
    modelId: 'fast-model',
    reasoning: 'low',
    memory: [],
    includeMail: false,
  });
  const record = {
    ...saved!,
    id: 'a'.repeat(64),
    savedAt: new Date().toISOString(),
    origin: 'Briefing Lab',
  } as PaperSummaryRecord;
  expect(sharedPaperView(record).item.provenance?.summarizedAt).toBe(saved!.paper!.summarizedAt);
  await preparePaperSummaries(candidate, [record]);
  expect(publicSourceText).toHaveBeenCalledOnce();
  expect(analyzeBriefing).toHaveBeenCalledOnce();
  vi.mocked(publicSourceText).mockRejectedValueOnce(new Error('source_rate_limited'));
  vi.mocked(resolvePaperSaveSource).mockResolvedValueOnce({
    id: '2609.00001v1',
    kind: 'papers',
    title: 'Verified fallback paper',
    text: 'Public source abstract with verified information.',
    source: 'arXiv article',
    sourceUrl: candidate.sourceUrls[0]!,
    readScope: 'abstract',
    details: [],
  });
  const [fallback] = await preparePaperSummaries(candidate, [], async () => policy);
  expect(fallback?.title).toBe('Verified fallback paper');
  expect(resolvePaperSaveSource).toHaveBeenCalledOnce();
  expect(vi.mocked(analyzeBriefing).mock.calls[1]?.[0].modelId).toBe('fast-model');
});
it('does not accept a search page as paper evidence', async () => {
  vi.mocked(publicSourceText).mockResolvedValue('<html><title>Search results</title></html>');
  await expect(preparePaperSummaries(candidate, [])).rejects.toThrow();
  expect(analyzeBriefing).not.toHaveBeenCalled();
});
