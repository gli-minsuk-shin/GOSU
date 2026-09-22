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
  expect(Object.keys(schema.properties.items.items.properties)).toHaveLength(8);
  expect(schema.properties.items.items.required).toHaveLength(8);
  expect(schema.properties.items.items.required).toContain('preparedActions');
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
it('realigns a prepared event to the weekday in its evidence and gives the model the local weekday', async () => {
  const saturday: LiveItem = {
    ...mail,
    id: 'dinner',
    title: 'Dinner',
    text: 'Pilsung and Joseph will join us. See you soon on Saturday.',
    publishedAt: '2026-09-17T21:51:25Z',
  };
  const run = vi.fn(async () => ({
    answer: JSON.stringify({
      overview: 'Dinner on Saturday',
      items: [
        {
          id: 'dinner',
          summary: 'Dinner with Pilsung and Joseph on Saturday.',
          importance: 'medium',
          importanceReason: 'Social plan',
          action: 'Confirm the time.',
          evidenceQuote: 'See you soon on Saturday.',
          memorySuggestion: null,
          preparedActions: {
            event: {
              title: '저녁 식사',
              start: '2026-09-20T19:00:00+09:00',
              end: '2026-09-20T21:00:00+09:00',
              allDay: false,
              timeZone: 'Asia/Seoul',
              location: '',
              notes: '',
              alarmMinutes: null,
              evidenceQuote: 'See you soon on Saturday.',
              notice: '시간 확인 필요',
            },
            task: null,
          },
        },
      ],
    }),
    proposal: null,
    providerId: 'codex',
    model: 'test',
    reasoning: 'medium',
    nextDates: [],
  }));
  const result = await analyzeBriefing(
    { ...request, itemIds: ['dinner'] },
    [saturday],
    { keywords: [], excluded: [] },
    new AbortController().signal,
    () => undefined,
    run,
  );
  const event = result.items[0]!.preparedActions!.event!;
  expect(event.start).toBe('2026-09-19T10:00:00Z');
  expect(event.notice).toContain('토요일');
  const prompt = JSON.parse(
    ((run.mock.calls as unknown[][])[0]![3] as { structuredJob: { prompt: string } }).structuredJob
      .prompt,
  );
  expect(prompt.items[0].receivedLocal).toBe('2026-09-18 (Fri) 06:51');
});
