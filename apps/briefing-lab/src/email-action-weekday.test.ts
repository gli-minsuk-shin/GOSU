import { describe, expect, it } from 'vitest';
import { alignActionsToEvidenceWeekday, evidenceWeekday } from './email-action-weekday';
import type { EmailPreparedActions } from './email-prepared-actions';

const event = (start: string, end: string, evidenceQuote: string) => ({
  title: '저녁 식사',
  start,
  end,
  allDay: false,
  timeZone: 'Asia/Seoul',
  location: '서울',
  notes: '',
  alarmMinutes: 60,
  evidenceQuote,
  notice: '시간 확인 필요',
});
const actions = (value: Partial<EmailPreparedActions>): EmailPreparedActions => ({
  event: null,
  task: null,
  ...value,
});

describe('weekday named in the evidence', () => {
  it('reads one weekday in either language and ignores ambiguity or an explicit date', () => {
    expect(evidenceWeekday('See you soon on Saturday.')).toBe(6);
    expect(evidenceWeekday('토요일 저녁에 봬요')).toBe(6);
    expect(evidenceWeekday('Let us meet Tue. evening')).toBe(2);
    expect(evidenceWeekday('Saturday or Sunday both work')).toBeNull();
    expect(evidenceWeekday('Saturday 2026-09-26 works')).toBeNull();
    expect(evidenceWeekday('토요일(9월 26일)에 봬요')).toBeNull();
    expect(evidenceWeekday('Dinner next week')).toBeNull();
    // Words that merely contain a weekday name are not a weekday.
    expect(evidenceWeekday('Our Sunbeam project meeting')).toBeNull();
  });

  it('moves a dinner Claude put on Sunday back to the Saturday its evidence names', () => {
    // The real 2026-09-18 KST mail: "See you soon on Saturday." was drafted on Sunday 2026-09-20.
    const value = actions({
      event: event(
        '2026-09-20T19:00:00+09:00',
        '2026-09-20T21:00:00+09:00',
        'See you soon on Saturday.',
      ),
    });
    const changed = alignActionsToEvidenceWeekday(value, 'Asia/Seoul');
    expect(value.event!.start).toBe('2026-09-19T10:00:00Z');
    expect(value.event!.end).toBe('2026-09-19T12:00:00Z');
    expect(changed).toHaveLength(1);
    expect(value.event!.notice).toContain('토요일');
    expect(value.event!.notice).toContain('2026-09-19');
    // Already correct, or an explicit date in the evidence: nothing moves.
    const correct = actions({
      event: event(
        '2026-09-19T19:00:00+09:00',
        '2026-09-19T21:00:00+09:00',
        'See you on Saturday.',
      ),
    });
    expect(alignActionsToEvidenceWeekday(correct, 'Asia/Seoul')).toEqual([]);
    expect(correct.event!.start).toBe('2026-09-19T19:00:00+09:00');
    const dated = actions({
      event: event(
        '2026-09-20T19:00:00+09:00',
        '2026-09-20T21:00:00+09:00',
        'Saturday 9/26 dinner',
      ),
    });
    expect(alignActionsToEvidenceWeekday(dated, 'Asia/Seoul')).toEqual([]);
  });

  it('keeps the local clock time when it moves a draft across a daylight-saving change', () => {
    const value = actions({
      event: {
        ...event('2026-03-09T19:00:00-04:00', '2026-03-09T21:00:00-04:00', 'See you Saturday.'),
        timeZone: 'America/New_York',
      },
    });
    alignActionsToEvidenceWeekday(value, 'Asia/Seoul');
    // 2026-03-09 is a Monday; the Saturday before it is 2026-03-07, still on standard time.
    expect(value.event!.start).toBe('2026-03-08T00:00:00Z');
    expect(value.event!.timeZone).toBe('America/New_York');
  });

  it('realigns a task deadline from its deadline quote and leaves other drafts alone', () => {
    const value = actions({
      task: {
        title: '예산안 검토',
        notes: '',
        dueDate: '2026-09-20',
        dueAt: '2026-09-20T18:00:00+09:00',
        timeZone: 'Asia/Seoul',
        evidenceQuote: '예산안 검토 부탁드립니다',
        deadlineQuote: '금요일까지 회신 부탁드립니다',
        notice: '',
      },
    });
    expect(alignActionsToEvidenceWeekday(value, 'Asia/Seoul')).toHaveLength(1);
    expect(value.task!.dueDate).toBe('2026-09-18');
    expect(value.task!.dueAt).toBe('2026-09-18T09:00:00Z');
    expect(value.task!.notice).toContain('금요일');
    expect(alignActionsToEvidenceWeekday(actions({}), 'Asia/Seoul')).toEqual([]);
  });
});
