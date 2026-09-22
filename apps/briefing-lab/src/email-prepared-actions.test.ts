import { expect, it } from 'vitest';
import { EmailPreparedActionsSchema, validateEmailPreparedActions } from './email-prepared-actions';
import { expandEmailGeneration } from '../briefing-email-generation';
import { BriefingTaskCreateSchema } from './briefing-task-actions';
const quote = '2026년 9월 20일까지 자료 제출';
const task = {
  title: '자료 제출',
  notes: quote,
  dueDate: '2026-09-20',
  evidenceQuote: quote,
  deadlineQuote: quote,
  notice: '명시된 기한',
};
it('accepts legacy date-only task requests but rejects a time without a date or invalid instant', () => {
  const request = {
    routineId: 'r',
    sourceKey: 'm',
    requestId: '11111111-1111-4111-8111-111111111111',
    projectId: null,
    title: '자료 제출',
    notes: '',
    dueDate: null,
    reminderListId: null,
  };
  expect(BriefingTaskCreateSchema.safeParse(request).success).toBe(true);
  expect(
    BriefingTaskCreateSchema.safeParse({ ...request, dueAt: '2026-09-20T04:30:00Z' }).success,
  ).toBe(false);
  expect(
    BriefingTaskCreateSchema.safeParse({ ...request, dueDate: '2026-09-20', dueAt: '15:30' })
      .success,
  ).toBe(false);
});
it('preserves a timed deadline in its timezone, including a different UTC date', () => {
  const timed = { ...task, dueAt: '2026-09-19T15:30:00Z', timeZone: 'Asia/Seoul' };
  expect(() => validateEmailPreparedActions({ event: null, task: timed }, quote)).not.toThrow();
  expect(EmailPreparedActionsSchema.parse({ event: null, task: timed }).task?.dueAt).toBe(
    timed.dueAt,
  );
  for (const invalid of [
    { ...timed, dueDate: null },
    { ...timed, dueDate: '2026-09-21' },
    { ...timed, timeZone: 'Invalid/Zone' },
    { ...timed, deadlineQuote: '' },
  ])
    expect(() => validateEmailPreparedActions({ event: null, task: invalid }, quote)).toThrow();
});
it('validates source-backed deadlines and preserves prepared fields through summary expansion', () => {
  const actions = { event: null, task };
  expect(() => validateEmailPreparedActions(actions, quote)).not.toThrow();
  expect(() => validateEmailPreparedActions(actions, '다른 이메일')).toThrow('evidence');
  const result = expandEmailGeneration({
    overview: '',
    items: [
      {
        id: 'm',
        summary: quote,
        importance: 'high',
        importanceReason: '기한',
        action: quote,
        evidenceQuote: quote,
        memorySuggestion: null,
        preparedActions: actions,
      },
    ],
  });
  expect(result.items[0]?.preparedActions).toEqual(actions);
});
it('allows unresolved actions to stay null and never invents a date', () => {
  expect(EmailPreparedActionsSchema.parse({ event: null, task: null })).toEqual({
    event: null,
    task: null,
  });
  expect(() =>
    validateEmailPreparedActions(
      { event: null, task: { ...task, dueDate: null, deadlineQuote: '' } },
      quote,
    ),
  ).not.toThrow();
  expect(() =>
    validateEmailPreparedActions({ event: null, task: { ...task, deadlineQuote: '' } }, quote),
  ).toThrow();
});
it('rejects reversed event times and unsupported evidence', () => {
  const event = {
    title: '회의',
    start: '2026-09-20T01:00:00Z',
    end: '2026-09-20T02:00:00Z',
    allDay: false,
    timeZone: 'Asia/Seoul',
    location: '회의실',
    notes: '',
    alarmMinutes: null,
    evidenceQuote: quote,
    notice: '',
  };
  expect(() => validateEmailPreparedActions({ event, task: null }, quote)).not.toThrow();
  expect(() =>
    validateEmailPreparedActions({ event: { ...event, end: event.start }, task: null }, quote),
  ).toThrow();
  expect(() => validateEmailPreparedActions({ event, task: null }, '미확인')).toThrow();
});
