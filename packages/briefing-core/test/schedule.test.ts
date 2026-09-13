import { describe, expect, it } from 'vitest';
import { latestDueOccurrence, nextOccurrences } from '../src/schedule.js';
import type { BriefingSchedule } from '../src/types.js';

const daily: BriefingSchedule = {
  frequency: 'daily',
  interval: 1,
  anchorDate: '2026-09-08',
  timeZone: 'Asia/Seoul',
  times: ['08:00'],
  weekdays: [],
  monthDay: 1,
};
describe('pure briefing schedule preview', () => {
  it('converts Seoul time to UTC and is strictly after the supplied clock', () => {
    const first = nextOccurrences(daily, '2026-09-07T22:59:59Z');
    expect(first).toHaveLength(5);
    expect(first[0]).toEqual({
      scheduledFor: '2026-09-07T23:00:00.000Z',
      localDate: '2026-09-08',
      localTime: '08:00',
      adjustment: 'none',
    });
    expect(nextOccurrences(daily, first[0]!.scheduledFor, 1)[0]?.localDate).toBe('2026-09-09');
  });
  it('keeps the first execution at or after the anchor and supports two times every two days', () => {
    const values = nextOccurrences(
      { ...daily, interval: 2, times: ['20:00', '08:00'] },
      '2026-09-01T00:00:00Z',
      5,
    );
    expect(values.map(({ localDate, localTime }) => `${localDate} ${localTime}`)).toEqual([
      '2026-09-08 08:00',
      '2026-09-08 20:00',
      '2026-09-10 08:00',
      '2026-09-10 20:00',
      '2026-09-12 08:00',
    ]);
  });
  it('uses Sunday weekday zero within an ISO Monday anchor-week cadence', () => {
    const schedule = { ...daily, frequency: 'weekly' as const, interval: 2, weekdays: [0, 3] };
    expect(
      nextOccurrences(schedule, '2026-09-07T00:00:00Z', 4).map(({ localDate }) => localDate),
    ).toEqual(['2026-09-09', '2026-09-13', '2026-09-23', '2026-09-27']);
  });
  it('does not include the pre-anchor weekday in the anchor week', () => {
    const schedule = { ...daily, frequency: 'weekly' as const, weekdays: [0] };
    expect(nextOccurrences(schedule, '2026-09-01T00:00:00Z', 1)[0]?.localDate).toBe('2026-09-13');
  });
  it('clamps monthly day 31 to month end without drifting future months', () => {
    const schedule = {
      ...daily,
      frequency: 'monthly' as const,
      anchorDate: '2026-01-01',
      monthDay: 31,
    };
    expect(
      nextOccurrences(schedule, '2026-01-01T00:00:00Z', 4).map(({ localDate, adjustment }) => [
        localDate,
        adjustment,
      ]),
    ).toEqual([
      ['2026-01-31', 'none'],
      ['2026-02-28', 'month-end'],
      ['2026-03-31', 'none'],
      ['2026-04-30', 'month-end'],
    ]);
  });
  it('handles leap years and multi-month intervals', () => {
    const schedule = {
      ...daily,
      frequency: 'monthly' as const,
      interval: 2,
      anchorDate: '2028-02-01',
      monthDay: 31,
    };
    expect(
      nextOccurrences(schedule, '2028-02-01T00:00:00Z', 3).map(({ localDate }) => localDate),
    ).toEqual(['2028-02-29', '2028-04-30', '2028-06-30']);
  });
  it('skips an anchor month whose chosen day precedes the anchor', () => {
    expect(
      nextOccurrences(
        { ...daily, frequency: 'monthly', anchorDate: '2026-09-15', monthDay: 1 },
        '2026-09-01T00:00:00Z',
        1,
      )[0]?.localDate,
    ).toBe('2026-10-01');
  });
  it('advances nonexistent New York 02:30 to 03:00, not 03:30', () => {
    const schedule = {
      ...daily,
      anchorDate: '2026-01-01',
      timeZone: 'America/New_York',
      times: ['02:30'],
    };
    expect(nextOccurrences(schedule, '2026-03-07T08:00:00Z', 1)[0]).toEqual({
      scheduledFor: '2026-03-08T07:00:00.000Z',
      localDate: '2026-03-08',
      localTime: '03:00',
      adjustment: 'dst-gap',
    });
  });
  it('uses only the first occurrence of the duplicated New York 01:30', () => {
    const schedule = {
      ...daily,
      anchorDate: '2026-01-01',
      timeZone: 'America/New_York',
      times: ['01:30'],
    };
    expect(
      nextOccurrences(schedule, '2026-11-01T00:00:00Z', 2).map(({ scheduledFor }) => scheduledFor),
    ).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
    expect(nextOccurrences(schedule, '2026-11-01T05:45:00Z', 1)[0]?.scheduledFor).toBe(
      '2026-11-02T06:30:00.000Z',
    );
  });
  it('deduplicates configured times that collide at the end of a DST gap', () => {
    const schedule = {
      ...daily,
      anchorDate: '2026-01-01',
      timeZone: 'America/New_York',
      times: ['02:15', '02:30', '03:00'],
    };
    const values = nextOccurrences(schedule, '2026-03-07T09:00:00Z', 2);
    expect(values.map(({ scheduledFor }) => scheduledFor)).toEqual([
      '2026-03-08T07:00:00.000Z',
      '2026-03-09T06:15:00.000Z',
    ]);
  });
  it('handles non-hour daylight-saving gaps', () => {
    const schedule = {
      ...daily,
      anchorDate: '2026-01-01',
      timeZone: 'Australia/Lord_Howe',
      times: ['02:10'],
    };
    const first = nextOccurrences(schedule, '2026-10-03T16:00:00Z', 1)[0];
    // At the supplied clock the Oct 4 gap-adjusted 02:30 has already passed.
    expect(first?.localDate).toBe('2026-10-05');
    expect(nextOccurrences(schedule, '2026-10-03T14:00:00Z', 1)[0]).toMatchObject({
      localDate: '2026-10-04',
      localTime: '02:30',
      adjustment: 'dst-gap',
    });
  });
  it('handles a skipped whole civil date and does not duplicate the resulting instant', () => {
    const schedule = {
      ...daily,
      anchorDate: '2011-12-30',
      timeZone: 'Pacific/Apia',
      times: ['00:00'],
    };
    const values = nextOccurrences(schedule, '2011-12-29T00:00:00Z', 2);
    expect(values[0]).toMatchObject({
      localDate: '2011-12-31',
      localTime: '00:00',
      adjustment: 'dst-gap',
    });
    expect(new Set(values.map(({ scheduledFor }) => scheduledFor)).size).toBe(2);
  });
  it('coalesces many missed runs to the latest one in (after, now]', () => {
    const latest = latestDueOccurrence(daily, '2026-09-08T00:00:00Z', '2026-09-12T00:00:00Z');
    expect(latest?.scheduledFor).toBe('2026-09-11T23:00:00.000Z');
    expect(latestDueOccurrence(daily, latest!.scheduledFor, latest!.scheduledFor)).toBeNull();
    expect(latestDueOccurrence(daily, '2026-09-11T22:00:00Z', latest!.scheduledFor)).toEqual(
      latest,
    );
  });
  it('never coalesces a second DST-fold occurrence', () => {
    const schedule = {
      ...daily,
      anchorDate: '2026-01-01',
      timeZone: 'America/New_York',
      times: ['01:30'],
    };
    expect(
      latestDueOccurrence(schedule, '2026-11-01T05:30:00Z', '2026-11-01T07:00:00Z'),
    ).toBeNull();
  });
  it('keeps two independent routines at separate times', () => {
    const after = '2026-09-07T20:00:00Z';
    expect(nextOccurrences(daily, after, 1)[0]?.scheduledFor).toBe('2026-09-07T23:00:00.000Z');
    expect(nextOccurrences({ ...daily, times: ['09:00'] }, after, 1)[0]?.scheduledFor).toBe(
      '2026-09-08T00:00:00.000Z',
    );
  });
  it.each([
    { ...daily, timeZone: 'Not/AZone' },
    { ...daily, timeZone: '+09:00' },
    { ...daily, times: ['24:00'] },
    { ...daily, times: ['08:00', '08:00'] },
    { ...daily, interval: 0 },
    { ...daily, anchorDate: '2026-02-30' },
    { ...daily, frequency: 'weekly' as const, weekdays: [] },
  ])('fails safely for invalid schedule %j', (schedule) => {
    expect(nextOccurrences(schedule, '2026-09-08T00:00:00Z')).toEqual([]);
    expect(
      latestDueOccurrence(schedule, '2026-09-07T00:00:00Z', '2026-09-08T00:00:00Z'),
    ).toBeNull();
  });
  it('rejects non-ISO clocks and unbounded preview counts', () => {
    expect(nextOccurrences(daily, '2026-09-08')).toEqual([]);
    expect(nextOccurrences(daily, '2026-09-08T00:00:00Z', 51)).toEqual([]);
    expect(nextOccurrences(daily, '2026-09-08T00:00:00Z', -1)).toEqual([]);
    expect(latestDueOccurrence(daily, 'bad', '2026-09-08T00:00:00Z')).toBeNull();
  });
});
