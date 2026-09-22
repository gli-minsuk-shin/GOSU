import { expect, it, vi } from 'vitest';
import { draftEmailEvent, EmailEventRequestSchema } from './email-event-draft';
import type { runRoutineWithGosuLanguage } from './briefing-native';
const input = {
  routineId: 'r',
  title: 'Re: 시험 일정 문의',
  text: '9월 20일 출국. 기존 9월 23일 시험 대신 10월 6일 오후 1시 교수실에서 대체시험을 보기로 확정했습니다.',
  receivedAt: '2026-09-14T00:00:00Z',
};
const event = {
  title: '대체시험',
  start: '2026-10-06T04:00:00Z',
  end: '2026-10-06T05:00:00Z',
  allDay: false,
  timeZone: 'Asia/Seoul',
  location: '교수실',
  notes: '대체시험. 종료 시각은 임시로 1시간 뒤.',
  alarmMinutes: null,
};
const evidenceQuote = '10월 6일 오후 1시 교수실에서 대체시험을 보기로 확정했습니다.';
const selection = { providerId: 'codex' as const, modelId: 'test-fast', reasoning: 'medium' };
function runner(value: unknown) {
  return vi.fn<typeof runRoutineWithGosuLanguage>().mockResolvedValue({
    answer: JSON.stringify(value),
    providerId: 'codex',
    model: 'test-fast',
    reasoning: 'medium',
  } as Awaited<ReturnType<typeof runRoutineWithGosuLanguage>>);
}
it('passes the entire email to a no-tools summary-model job and returns the confirmed appointment, not the first date', async () => {
  expect(
    EmailEventRequestSchema.safeParse({ ...input, receivedAt: '2026-09-14T09:00:00+09:00' })
      .success,
  ).toBe(true);
  const run = runner({
      event,
      evidenceQuote,
      notice: '연도는 수신 연도 기준, 종료는 1시간 후 임시값입니다.',
    }),
    guard = vi.fn(async () => undefined);
  const result = await draftEmailEvent(
    input,
    'Asia/Seoul',
    selection,
    new AbortController().signal,
    guard,
    run,
  );
  expect(result.draft).toEqual({ ...event, calendarId: '' });
  expect(result.notice).toContain(evidenceQuote);
  expect(run.mock.calls[0]![0]).toMatchObject({ ...selection, history: [] });
  const job = run.mock.calls[0]![3]!.structuredJob!;
  expect(job.prompt).toContain(input.text);
  expect(job.instructions).toContain('not the first date');
  expect(job.tools).toBeUndefined();
  expect(guard).toHaveBeenCalledTimes(2);
});
it.each([
  { event: null, evidenceQuote: '', notice: '어떤 날짜의 행사인지 확인해주세요.' },
  { event, evidenceQuote: 'invented quote', notice: '확인' },
  { event: { ...event, timeZone: 'UTC' }, evidenceQuote, notice: '확인' },
  { event: { ...event, end: event.start }, evidenceQuote, notice: '확인' },
])('never falls back to a default today/all-day event for unsupported output', async (value) => {
  await expect(
    draftEmailEvent(
      input,
      'Asia/Seoul',
      selection,
      new AbortController().signal,
      async () => undefined,
      runner(value),
    ),
  ).rejects.toThrow();
});
it('does not invoke the model without permission and discards output after revocation', async () => {
  const run = runner({ event, evidenceQuote, notice: '확인' });
  await expect(
    draftEmailEvent(
      input,
      'Asia/Seoul',
      selection,
      new AbortController().signal,
      async () => {
        throw Error('denied');
      },
      run,
    ),
  ).rejects.toThrow('denied');
  expect(run).not.toHaveBeenCalled();
  const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('revoked'));
  await expect(
    draftEmailEvent(input, 'Asia/Seoul', selection, new AbortController().signal, guard, run),
  ).rejects.toThrow('revoked');
});
it('moves a draft the model put on the wrong weekday to the day its evidence names', async () => {
  // The real case: a Friday 2026-09-18 KST mail said "See you soon on Saturday." and the draft
  // landed on Sunday 2026-09-20.
  const run = runner({
    event: {
      ...event,
      title: '저녁 식사',
      start: '2026-09-20T19:00:00+09:00',
      end: '2026-09-20T21:00:00+09:00',
    },
    evidenceQuote: 'See you soon on Saturday.',
    notice: '시간은 추가 확인 필요',
  });
  const result = await draftEmailEvent(
    {
      routineId: 'r',
      title: 'Dinner',
      text: 'Pilsung and Joseph will join us. See you soon on Saturday.',
      receivedAt: '2026-09-17T21:51:25Z',
    },
    'Asia/Seoul',
    selection,
    new AbortController().signal,
    async () => undefined,
    run,
  );
  expect(result.draft.start).toBe('2026-09-19T10:00:00Z');
  expect(result.draft.end).toBe('2026-09-19T12:00:00Z');
  expect(result.notice).toContain('토요일');
  const prompt = JSON.parse(
    (run.mock.calls[0]![3] as { structuredJob: { prompt: string } }).structuredJob.prompt,
  );
  // The model is given the local receipt day with its weekday, so it needs no date arithmetic.
  expect(prompt.receivedLocal).toBe('2026-09-18 (Fri) 06:51');
});
