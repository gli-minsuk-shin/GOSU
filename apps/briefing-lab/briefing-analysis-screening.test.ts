import { describe, expect, it, vi } from 'vitest';
import { analyzeBriefing, quoteMatches, screenInsights } from './briefing-analysis';
import type { LiveItem } from './src/live-types';

const paper = (id: string, text: string): LiveItem => ({
  id,
  kind: 'papers',
  title: `Paper ${id}`,
  text,
  source: 'test',
  details: [],
  readScope: 'abstract',
});
const insight = (id: string, evidenceQuote: string) => ({
  id,
  summary: 'Short summary',
  keywords: ['Optimization'],
  detail: 'Method explanation',
  researchQuestion: 'Question?',
  strengths: 'Strength.',
  limitations: 'Limitation.',
  methodsAndAssumptions: 'Method.',
  reportedResults: 'Result.',
  equationExplanations: [],
  importance: 'medium',
  importanceReason: 'Relevant',
  relevance: 'Related',
  action: 'Read',
  evidenceQuote,
  equationIds: [],
  figureIds: [],
  memorySuggestion: null,
});
const items = [
  paper('a', 'The method “improves” convergence — on large problems.'),
  paper('b', 'A second abstract about sparse solvers.'),
  paper('c', 'A third abstract about regularization.'),
];
const response = (value: unknown) => ({
  answer: JSON.stringify(value),
  proposal: null,
  providerId: 'claude-code',
  model: 'claude-haiku-4-5',
  reasoning: 'off',
  nextDates: [],
});
const request = {
  routineId: 'r',
  receiptId: '11111111-1111-4111-8111-111111111111',
  itemIds: ['a', 'b', 'c'],
  providerId: 'claude-code' as const,
  modelId: 'claude-code:haiku',
  reasoning: 'off',
  includeMail: false,
  memory: [
    {
      id: 'm1',
      routineId: 'r',
      kind: 'finding' as const,
      sourceId: 'analysis:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      text: 'An earlier summary',
      createdAt: '2026-09-09T00:00:00Z',
    },
  ],
};

describe('per-item evidence screening', () => {
  it('accepts a quote that differs only in typography, spacing, case or an elided middle', () => {
    const source = 'The method “improves” convergence — on large  problems.';
    expect(quoteMatches('the method "improves" convergence - on large problems', source)).toBe(
      true,
    );
    expect(quoteMatches('The method ... on large problems', source)).toBe(true);
    expect(quoteMatches('The method improves generalization', source)).toBe(false);
    expect(quoteMatches('on large problems ... The method', source)).toBe(false);
    expect(quoteMatches('', source)).toBe(false);
  });

  it('keeps valid items, drops invented ones and reports invalid or missing requested items', () => {
    const { result, rejected } = screenInsights(
      {
        overview: 'Overview',
        items: [
          insight('a', 'the method "improves" convergence'),
          insight('b', 'an invented sentence'),
          // A prior memory entry summarized as if it were an item: never saved.
          insight('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'x'),
        ],
      },
      items,
    );
    expect(result.items.map((entry) => entry.id)).toEqual(['a']);
    expect(rejected).toEqual([
      { id: 'b', code: 'briefing_analysis_quote_unverified' },
      { id: 'c', code: 'briefing_analysis_coverage_invalid' },
    ]);
  });

  it('corrects only the rejected items once, keeps the accepted ones and reports what still failed', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          overview: 'First draft',
          items: [insight('a', 'improves'), insight('b', 'made up'), insight('c', 'made up')],
        }),
      )
      .mockResolvedValueOnce(
        response({
          overview: 'Correction',
          items: [insight('b', 'sparse solvers'), insight('c', 'still made up')],
        }),
      );
    const result = await analyzeBriefing(
      request,
      items,
      { keywords: [], excluded: [] },
      new AbortController().signal,
      vi.fn(),
      run,
    );
    expect(result.items.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(result.overview).toBe('First draft');
    expect(result.rejectedItems).toEqual([{ id: 'c', code: 'briefing_analysis_quote_unverified' }]);
    const prompts = run.mock.calls.map((call) =>
      JSON.parse((call[3] as { structuredJob: { prompt: string } }).structuredJob.prompt),
    );
    // Memory keeps its text but no id that could be mistaken for an item.
    expect(prompts[0].memory).toEqual([{ kind: 'finding', text: 'An earlier summary' }]);
    expect(prompts[1].originalRequest.items.map((entry: { id: string }) => entry.id)).toEqual([
      'b',
      'c',
    ]);
    expect(prompts[1].validationErrors).toHaveLength(2);
  });
});
