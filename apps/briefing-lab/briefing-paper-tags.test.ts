import { expect, it } from 'vitest';
import { catalogForHistory, curateHistoryTags } from './briefing-paper-tags';
import type { BriefingHistory } from './briefing-workspace-store';
import { matchesSavedPaper, paperLabels } from './src/paper-library-index';
const record = (
  id: string,
  routineId: string,
  keywords: string[],
  privateFlag = false,
): BriefingHistory => ({
  id,
  routineId,
  createdAt: '2026-09-10T00:00:00Z',
  kind: 'briefing',
  private: privateFlag,
  answer: 'Unchanged overview',
  items: [
    {
      id,
      kind: 'papers',
      title: 'Unchanged paper',
      summary: 'Saved result',
      readScope: 'abstract',
      importance: 'high',
      relevance: '',
      keywords,
    },
  ],
});
it('cleans old stored tags without rewriting their source keywords or summaries', () => {
  const raw = [
    record('a', 'r', [
      'LLM',
      'large language models',
      '대규모 언어 모델',
      'optimization',
      'optimisation',
    ]),
    record('b', 'r', ['LLMs', '최적화']),
  ];
  const cleaned = curateHistoryTags(raw);
  expect(catalogForHistory(raw, 'r')).toHaveLength(2);
  expect(cleaned[0]?.items[0]?.tags).toEqual(['Large language models', 'Optimization']);
  expect(raw[0]?.items[0]?.tags).toBeUndefined();
  expect(cleaned[0]?.answer).toBe(raw[0]?.answer);
  expect(cleaned[0]?.items[0]?.keywords).toEqual(raw[0]?.items[0]?.keywords);
  const paper = { historyId: 'a', savedAt: raw[0]!.createdAt, item: cleaned[0]!.items[0]! };
  expect(matchesSavedPaper(paper, 'LLM')).toBe(true);
  expect(matchesSavedPaper(paper, 'optimisation')).toBe(true);
  expect(
    matchesSavedPaper(
      { ...paper, item: { ...paper.item, keywords: ['Large language models', 'Optimization'] } },
      'LLM optimisation',
    ),
  ).toBe(true);
  expect(paperLabels(paper.item).tags).toHaveLength(2);
});
it('never lets another routine or private-only vocabulary rename a public tag', () => {
  const raw = [
    record('a', 'r', ['Public Topic']),
    record('b', 'r', ['SECRET TOPIC'], true),
    record('c', 'other', ['Other Topic']),
  ];
  expect(catalogForHistory(raw, 'r').map((t) => t.label)).toEqual(['Public Topic']);
  expect(catalogForHistory(raw, 'r', true)).toHaveLength(2);
  expect(curateHistoryTags(raw)[0]?.items[0]?.tags).toEqual(['Public Topic']);
});
