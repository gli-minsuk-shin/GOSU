import { expect, it, vi } from 'vitest';
import { draftEmailTask } from './email-task-draft';
import type { runRoutineWithGosuLanguage } from './briefing-native';
const input = {
  routineId: 'r',
  title: 'Re: 검토',
  text: '행사는 10월 3일입니다. 자료 검토 의견은 9월 20일까지 보내주세요.',
  receivedAt: '2026-09-14T00:00:00Z',
};
const task = {
  title: '자료 검토 의견 보내기',
  notes: '자료를 검토하고 의견 전달',
  dueDate: '2026-09-20',
};
const value = {
  task,
  evidenceQuote: '자료 검토 의견은 9월 20일까지 보내주세요.',
  deadlineQuote: '9월 20일까지',
  notice: '수신 연도 기준입니다.',
};
const selection = { providerId: 'codex' as const, modelId: 'test-light', reasoning: 'low' };
function runner(output: unknown) {
  return vi
    .fn<typeof runRoutineWithGosuLanguage>()
    .mockResolvedValue({ answer: JSON.stringify(output) } as Awaited<
      ReturnType<typeof runRoutineWithGosuLanguage>
    >);
}
it('uses a tool-free lightweight job with full evidence and receipt anchor, not a calendar date heuristic', async () => {
  const run = runner(value),
    guard = vi.fn(async () => undefined);
  const result = await draftEmailTask(
    input,
    'Asia/Seoul',
    selection,
    new AbortController().signal,
    guard,
    run,
  );
  expect(result.draft).toEqual(task);
  expect(guard).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0]![0]).toMatchObject({ ...selection, history: [] });
  const job = run.mock.calls[0]![3]!.structuredJob!;
  expect(job.tools).toBeUndefined();
  expect(JSON.parse(job.prompt)).toMatchObject({
    text: input.text,
    receivedAt: input.receivedAt,
    timeZone: 'Asia/Seoul',
  });
  expect(job.instructions).toContain('not the first date');
  expect(job.instructions).toContain('NEVER default to today');
  expect(job.instructions).toContain('deadline time is in notes');
});
it('allows supported actions without a deadline and leaves the date empty', async () => {
  const result = await draftEmailTask(
    input,
    'Asia/Seoul',
    selection,
    new AbortController().signal,
    async () => undefined,
    runner({
      ...value,
      task: { ...task, dueDate: null },
      deadlineQuote: '',
      notice: '마감일 미지정',
    }),
  );
  expect(result.draft.dueDate).toBeNull();
});
it.each([
  { ...value, task: null },
  { ...value, evidenceQuote: 'invented' },
  { ...value, deadlineQuote: '' },
  { ...value, deadlineQuote: 'tomorrow' },
  { ...value, task: { ...task, dueDate: '2026-02-30' } },
])('rejects missing/unsupported task and deadline evidence', async (output) => {
  await expect(
    draftEmailTask(
      input,
      'Asia/Seoul',
      selection,
      new AbortController().signal,
      async () => undefined,
      runner(output),
    ),
  ).rejects.toThrow();
});
it('blocks calls without permission and discards output after revocation or cancellation', async () => {
  const run = runner(value);
  await expect(
    draftEmailTask(
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
  await expect(
    draftEmailTask(
      input,
      'Asia/Seoul',
      selection,
      new AbortController().signal,
      vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('revoked')),
      run,
    ),
  ).rejects.toThrow('revoked');
  const controller = new AbortController();
  run.mockImplementationOnce(async () => {
    controller.abort();
    return { answer: JSON.stringify(value) } as Awaited<
      ReturnType<typeof runRoutineWithGosuLanguage>
    >;
  });
  await expect(
    draftEmailTask(input, 'Asia/Seoul', selection, controller.signal, async () => undefined, run),
  ).rejects.toThrow('source_cancelled');
});
