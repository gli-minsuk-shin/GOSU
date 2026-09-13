import { describe, it, expect, vi } from 'vitest';
import { analyzeBriefing, validateInsights, ANALYSIS_INSTRUCTIONS } from './briefing-analysis';
import type { LiveItem } from './src/live-types';
import {
  BRIEFING_EMPHASIS_POLICY,
  BRIEFING_OVERVIEW_EMPHASIS_POLICY,
} from './briefing-emphasis-policy';
import { EMAIL_ANALYSIS_INSTRUCTIONS } from './briefing-email-generation';
import { buildPaperTagCatalog, PAPER_TAG_POLICY } from './src/paper-tags';
it('instructs source-grounded sparse emphasis without modifying exact evidence or machine fields', () => {
  expect(ANALYSIS_INSTRUCTIONS).toContain(BRIEFING_EMPHASIS_POLICY);
  expect(ANALYSIS_INSTRUCTIONS).toContain('at most 1-2 short key phrases');
  expect(ANALYSIS_INSTRUCTIONS).toContain('comparison and uncertainty intact');
  expect(ANALYSIS_INSTRUCTIONS).toContain('never insert emphasis markers into those data fields');
});
it('applies the same restrained overview guidance to future email and paper summaries', () => {
  expect(ANALYSIS_INSTRUCTIONS).toContain(BRIEFING_OVERVIEW_EMPHASIS_POLICY);
  expect(EMAIL_ANALYSIS_INSTRUCTIONS).toContain(BRIEFING_OVERVIEW_EMPHASIS_POLICY);
});
import { z } from 'zod';
import {
  BriefingGenerationSchema,
  BriefingInsightSchema,
  PAPER_TEMPLATE_FIELDS,
} from './src/briefing-intelligence';
const item: LiveItem = {
  id: 'p',
  kind: 'papers',
  title: 'A method',
  text: 'The method improves convergence.',
  source: 'test',
  details: [],
  readScope: 'abstract',
};
const insight = {
  id: 'p',
  summary: 'Short summary',
  keywords: ['Optimization'],
  detail: 'Method explanation within the supplied evidence',
  researchQuestion: 'Does the method improve convergence on the stated problem?',
  strengths: 'The supplied evidence reports a clear convergence improvement.',
  limitations: 'The excerpt does not establish broader generalization.',
  methodsAndAssumptions:
    'It uses the described optimization procedure and assumes the stated setup.',
  reportedResults: 'The source reports improved convergence.',
  equationExplanations: [],
  importance: 'medium',
  importanceReason: 'Relevant',
  relevance: 'Related to optimization',
  action: 'Read',
  evidenceQuote: 'improves convergence',
  equationIds: [],
  figureIds: [],
  memorySuggestion: null,
};
describe('native evidence-based Briefing analysis', () => {
  it('sends existing tags to the same summary call and only admits one unmatched concept', async () => {
    const run = vi.fn(async () => ({
      answer: JSON.stringify({
        overview: 'Summary',
        items: [{ ...insight, keywords: ['최적화', 'Novel topic', 'Unneeded extra topic'] }],
      }),
      providerId: 'codex',
      model: 'test',
      reasoning: null,
      proposal: null,
      nextDates: [],
    }));
    const catalog = buildPaperTagCatalog([{ tags: ['Optimization'] }]);
    const result = await analyzeBriefing(
      {
        routineId: 'r',
        receiptId: '11111111-1111-4111-8111-111111111111',
        itemIds: ['p'],
        providerId: 'codex',
        modelId: 'test',
        reasoning: null,
        includeMail: false,
        memory: [],
      },
      [item],
      { keywords: [], excluded: [] },
      new AbortController().signal,
      vi.fn(),
      run,
      undefined,
      undefined,
      catalog,
    );
    expect(run).toHaveBeenCalledOnce();
    const options = (
      run.mock.calls[0] as unknown as [
        unknown,
        unknown,
        unknown,
        { structuredJob: { prompt: string; instructions: string } },
      ]
    )[3];
    expect(JSON.parse(options.structuredJob.prompt).existingPaperTags).toEqual([
      { label: 'Optimization', aliases: ['Optimization'] },
    ]);
    expect(options.structuredJob.instructions).toContain(PAPER_TAG_POLICY);
    expect(result.items[0]?.tags).toEqual(['Optimization', 'Novel topic']);
    expect(result.items[0]?.keywords).toEqual(['최적화', 'Novel topic', 'Unneeded extra topic']);
  });
  it('sends provider-valid required fields at every object level while keeping the legacy reader permissive', () => {
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const node = value as Record<string, unknown>;
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect([...((node.required as string[]) ?? [])].sort()).toEqual(
          Object.keys(node.properties as object).sort(),
        );
      }
      Object.values(node).forEach(visit);
    };
    visit(z.toJSONSchema(BriefingGenerationSchema));
    const legacy = { ...insight } as Record<string, unknown>;
    for (const field of PAPER_TEMPLATE_FIELDS) delete legacy[field];
    expect(BriefingInsightSchema.safeParse({ overview: 'Legacy', items: [legacy] }).success).toBe(
      true,
    );
    expect(BriefingGenerationSchema.safeParse({ overview: 'New', items: [legacy] }).success).toBe(
      false,
    );
  });
  it('keeps required paper-template fields empty for email rather than forcing research framing', () => {
    const result = validateInsights({ overview: 'Mail', items: [insight] }, [
      { ...item, kind: 'email' },
    ]);
    for (const field of PAPER_TEMPLATE_FIELDS) expect(result.items[0]![field]).toBe('');
  });
  it('requires rich fields on new generations, correcting an old-style response rather than silently losing detail', async () => {
    const {
      keywords: _keywords,
      detail: _detail,
      researchQuestion: _researchQuestion,
      strengths: _strengths,
      limitations: _limitations,
      methodsAndAssumptions: _methodsAndAssumptions,
      reportedResults: _reportedResults,
      equationExplanations: _equationExplanations,
      ...old
    } = insight;
    const response = (entry: unknown) => ({
      answer: JSON.stringify({ overview: 'Summary', items: [entry] }),
      proposal: null,
      providerId: 'codex',
      model: 'live',
      reasoning: 'high',
      nextDates: [],
    });
    const run = vi
      .fn()
      .mockResolvedValueOnce(response(old))
      .mockResolvedValueOnce(response(insight));
    const result = await analyzeBriefing(
      {
        routineId: 'r',
        receiptId: '11111111-1111-4111-8111-111111111111',
        itemIds: ['p'],
        providerId: 'codex',
        modelId: 'live',
        reasoning: 'high',
        includeMail: false,
        memory: [],
      },
      [item],
      { keywords: [], excluded: [] },
      new AbortController().signal,
      vi.fn(),
      run,
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.items[0]?.detail).toBe(insight.detail);
    expect(result.items[0]?.researchQuestion).toBe(insight.researchQuestion);
    expect(result.items[0]?.limitations).toBe(insight.limitations);
    expect(ANALYSIS_INSTRUCTIONS).toContain('reportedResults');
    expect(ANALYSIS_INSTRUCTIONS).toContain('$$...$$');
    expect(() =>
      validateInsights({ overview: 'Legacy reader', items: [old] }, [item]),
    ).not.toThrow();
  });
  it('accepts four source-backed equations with explanations but rejects unselected explanations', () => {
    const paper = {
      ...item,
      paper: {
        readScope: 'html-excerpt' as const,
        excerpt: item.text,
        equations: ['e1', 'e2', 'e3', 'e4'].map((id) => ({ id, latex: 'x=1' })),
        figures: [],
        sourceUrl: 'https://arxiv.org/html/test',
        note: 'excerpt',
      },
    };
    const detailed = {
      ...insight,
      keywords: ['optimization'],
      detail: 'Method and limitations',
      equationIds: ['e1', 'e2', 'e3', 'e4'],
      equationExplanations: ['e1', 'e2', 'e3', 'e4'].map((equationId) => ({
        equationId,
        explanation: 'Definition of x',
      })),
    };
    expect(
      validateInsights({ overview: 'Summary', items: [detailed] }, [paper]).items[0]?.equationIds,
    ).toHaveLength(4);
    expect(() =>
      validateInsights(
        {
          overview: 'Summary',
          items: [
            { ...detailed, equationExplanations: [{ equationId: 'invented', explanation: 'x' }] },
          ],
        },
        [paper],
      ),
    ).toThrow('reference');
  });
  it('sends explicit email kind and suppresses the research profile/project memory for email-only analysis', async () => {
    const mail = { ...item, kind: 'email' as const, readScope: 'mail-preview' as const };
    const run = vi.fn(async () => ({
      answer: JSON.stringify({ overview: 'Mail', items: [insight] }),
      proposal: null,
      providerId: 'codex',
      model: 'live',
      reasoning: 'high',
      nextDates: [],
    }));
    await analyzeBriefing(
      {
        routineId: 'r',
        receiptId: '11111111-1111-4111-8111-111111111111',
        itemIds: ['p'],
        providerId: 'codex',
        modelId: 'live',
        reasoning: 'high',
        includeMail: true,
        memory: [
          {
            id: 'project',
            routineId: 'r',
            kind: 'project',
            sourceId: 'project-snapshot',
            text: 'Unrelated research project memory',
            createdAt: '2026-09-09T00:00:00Z',
          },
        ],
      },
      [mail],
      { keywords: [{ term: 'quantum research', weight: 5, synonyms: [] }], excluded: [] },
      new AbortController().signal,
      vi.fn(),
      run,
    );
    const options = (run.mock.calls as unknown[][])[0]![3] as {
      structuredJob: { prompt: string; instructions: string };
    };
    const request = JSON.parse(options.structuredJob.prompt);
    expect(request.items[0].kind).toBe('email');
    expect(request.interests).toBeNull();
    expect(request.memory).toEqual([]);
    expect(options.structuredJob.instructions).toContain('EMAIL');
    expect(options.structuredJob.instructions).toContain('deadlines');
  });
  it('allows exactly one evidence correction, verifies it again, and rechecks consent before another native call', async () => {
    const response = (value: unknown) => ({
      answer: JSON.stringify(value),
      proposal: null,
      providerId: 'codex',
      model: 'resolved',
      reasoning: 'high',
      nextDates: [],
    });
    const invalid = {
      overview: 'Bad quote',
      items: [{ ...insight, evidenceQuote: 'invented quote' }],
    };
    const valid = { overview: 'Corrected', items: [insight] };
    const run = vi
      .fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(response(valid));
    const request = {
      routineId: 'r',
      receiptId: '11111111-1111-4111-8111-111111111111',
      itemIds: ['p'],
      providerId: 'codex' as const,
      modelId: 'test',
      reasoning: null,
      includeMail: false,
      memory: [],
    };
    const recheck = vi.fn(),
      progress = vi.fn();
    const result = await analyzeBriefing(
      request,
      [item],
      { keywords: [], excluded: [] },
      new AbortController().signal,
      progress,
      run,
      recheck,
    );
    expect(result.overview).toBe('Corrected');
    expect(run).toHaveBeenCalledTimes(2);
    expect(recheck).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.flat().join(' ')).toContain('quote_unverified');
    run.mockReset().mockResolvedValue(response(invalid));
    await expect(
      analyzeBriefing(
        request,
        [item],
        { keywords: [], excluded: [] },
        new AbortController().signal,
        vi.fn(),
        run,
      ),
    ).rejects.toThrow('quote_unverified');
    expect(run).toHaveBeenCalledTimes(2);
    run.mockClear();
    const revoked = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw new Error('mail_scope_required');
      });
    await expect(
      analyzeBriefing(
        request,
        [item],
        { keywords: [], excluded: [] },
        new AbortController().signal,
        vi.fn(),
        run,
        revoked,
      ),
    ).rejects.toThrow('scope_required');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('requires source quote and exact item/equation/figure IDs', () => {
    expect(validateInsights({ overview: 'Overview', items: [insight] }, [item]).items).toHaveLength(
      1,
    );
    for (const patch of [
      { id: 'fabricated' },
      { evidenceQuote: 'not in the source' },
      { equationIds: ['invented'] },
      { figureIds: ['made-up'] },
    ])
      expect(() =>
        validateInsights({ overview: 'Overview', items: [{ ...insight, ...patch }] }, [item]),
      ).toThrow();
    expect(() => validateInsights({ overview: 'Overview', items: [] }, [item])).toThrow('coverage');
  });
  it('uses GOSU native structured job and scoped memory; does not grant tools from mail content', async () => {
    const run = vi.fn(async () => ({
      answer: JSON.stringify({ overview: 'Summary', items: [insight] }),
      proposal: null,
      providerId: 'codex',
      model: 'resolved',
      reasoning: 'high',
      nextDates: [],
    }));
    const result = await analyzeBriefing(
      {
        routineId: 'r',
        receiptId: '11111111-1111-4111-8111-111111111111',
        itemIds: ['p'],
        providerId: 'codex',
        modelId: 'provider-model',
        reasoning: 'high',
        includeMail: false,
        memory: [],
      },
      [{ ...item, mailMessageUrl: 'message://%3Cprivate-navigation%40example.test%3E' }],
      { keywords: [], excluded: [] },
      new AbortController().signal,
      vi.fn(),
      run,
    );
    expect(result.invocation.model).toBe('resolved');
    expect(ANALYSIS_INSTRUCTIONS).toContain('UNTRUSTED DATA');
    const options = (run.mock.calls as unknown[][])[0]![3] as {
      structuredJob: { prompt: string; instructions: string };
    };
    expect(options.structuredJob.prompt).toContain(item.text);
    expect(options.structuredJob.prompt).not.toContain('message://');
    expect(options.structuredJob.instructions).toContain('gosu.research-agent.policy');
  });
  it('passes structured feedback as personalization while keeping it separate from source evidence', async () => {
    const run = vi.fn(async () => ({
      answer: JSON.stringify({ overview: 'Summary', items: [insight] }),
      proposal: null,
      providerId: 'codex',
      model: 'resolved',
      reasoning: 'high',
      nextDates: [],
    }));
    await analyzeBriefing(
      {
        routineId: 'r',
        receiptId: '11111111-1111-4111-8111-111111111111',
        itemIds: ['p'],
        providerId: 'codex',
        modelId: 'provider-model',
        reasoning: 'high',
        includeMail: false,
        memory: [],
      },
      [item],
      { keywords: [], excluded: [] },
      new AbortController().signal,
      vi.fn(),
      run,
      undefined,
      {
        total: 2,
        important: 1,
        notInterested: 1,
        kindScores: { papers: 1, email: 0 },
        preferredKeywords: [{ term: 'diffusion', score: 1 }],
        avoidedKeywords: [{ term: 'classification', score: -1 }],
      },
    );
    const options = (run.mock.calls as unknown[][])[0]![3] as {
      structuredJob: { prompt: string; instructions: string };
    };
    const request = JSON.parse(options.structuredJob.prompt);
    expect(request.personalization.preferredKeywords).toEqual([{ term: 'diffusion', score: 1 }]);
    expect(options.structuredJob.instructions).toContain('preference signal');
    expect(options.structuredJob.instructions).toContain('source evidence');
  });
});
