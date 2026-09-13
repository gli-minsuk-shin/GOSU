import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { analyzeBriefing } from './briefing-analysis';
import { EmailGenerationSchema, expandEmailGeneration } from './briefing-email-generation';
import type { LiveItem } from './src/live-types';
const mail: LiveItem = {
  id: 'm',
  kind: 'email',
  title: 'Reply request',
  text: 'Reply by September 11 at 17:00.',
  source: 'Synthetic',
  readScope: 'mail-preview',
  details: [],
};
const output = {
  overview: 'Reply required',
  items: [
    {
      id: 'm',
      summary: 'Reply requested.',
      importance: 'high',
      importanceReason: 'Explicit deadline',
      action: 'Reply by September 11 at 17:00.',
      evidenceQuote: mail.text,
      memorySuggestion: null,
    },
  ],
};
const request = {
  routineId: 'r',
  receiptId: '11111111-1111-4111-8111-111111111111',
  itemIds: ['m'],
  providerId: 'codex' as const,
  modelId: 'test',
  reasoning: 'medium',
  includeMail: true,
  memory: [],
};
it('generates seven email fields, then restores the existing insight shape without another LLM call', async () => {
  const run = vi.fn(async () => ({
    answer: JSON.stringify(output),
    proposal: null,
    nextDates: [],
    providerId: 'codex',
    model: 'test',
    reasoning: 'medium',
  }));
  const result = await analyzeBriefing(
    request,
    [mail],
    { keywords: [], excluded: [] },
    AbortSignal.timeout(1000),
    () => undefined,
    run,
  );
  expect(run).toHaveBeenCalledOnce();
  const options = (run.mock.calls as unknown[][])[0]![3] as {
    structuredJob: { instructions: string; schema: Record<string, unknown> };
  };
  const schema = options.structuredJob.schema as {
    properties: {
      items: { items: { properties: object; required: string[]; additionalProperties: boolean } };
    };
  };
  expect(Object.keys(schema.properties.items.items.properties)).toHaveLength(7);
  expect(schema.properties.items.items.required).toHaveLength(7);
  expect(schema.properties.items.items.additionalProperties).toBe(false);
  expect(options.structuredJob.instructions).not.toContain('PAPERS:');
  expect(result.items[0]).toMatchObject({
    relevance: '',
    researchQuestion: '',
    equationIds: [],
    tags: [],
    evidenceQuote: mail.text,
  });
});
it('keeps strict objects and exact quote/ID checks for compact email output, with one bounded correction', async () => {
  expect(EmailGenerationSchema.safeParse({ ...output, extra: true }).success).toBe(false);
  expect(z.toJSONSchema(EmailGenerationSchema).additionalProperties).toBe(false);
  expect(expandEmailGeneration(output).items[0]?.methodsAndAssumptions).toBe('');
  const run = vi.fn(async () => ({
    answer: JSON.stringify({
      ...output,
      items: [{ ...output.items[0], evidenceQuote: 'Invented deadline' }],
    }),
    proposal: null,
    nextDates: [],
    providerId: 'codex',
    model: 'test',
    reasoning: 'medium',
  }));
  const consent = vi.fn();
  await expect(
    analyzeBriefing(
      request,
      [mail],
      { keywords: [], excluded: [] },
      AbortSignal.timeout(1000),
      () => undefined,
      run,
      consent,
    ),
  ).rejects.toThrow('quote_unverified');
  expect(run).toHaveBeenCalledTimes(2);
  expect(consent).toHaveBeenCalledTimes(2);
});
it('corrects a priority-only answer into actual content while allowing importance to remain uncertain', async () => {
  const response = (summary: string) => ({
    answer: JSON.stringify({
      ...output,
      items: [{ ...output.items[0], summary, importance: 'uncertain' }],
    }),
    proposal: null,
    nextDates: [],
    providerId: 'codex',
    model: 'test',
    reasoning: 'medium',
  });
  const run = vi
    .fn()
    .mockResolvedValueOnce(response('중요도를 판단할 수 없습니다.'))
    .mockResolvedValue(response('9월 11일 오후 5시까지 회신을 요청하는 메일입니다.'));
  const result = await analyzeBriefing(
    request,
    [mail],
    { keywords: [], excluded: [] },
    AbortSignal.timeout(1000),
    () => undefined,
    run,
  );
  expect(run).toHaveBeenCalledTimes(2);
  expect(result.items[0]?.summary).toContain('회신을 요청');
  expect(result.items[0]?.importance).toBe('uncertain');
});
