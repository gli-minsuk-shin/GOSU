import { describe, expect, it } from 'vitest';

import {
  latestDueOccurrence,
  nextOccurrences,
  type BriefingSchedule,
  type ScheduleOccurrence,
} from '../src/index.js';

const DAY = 86_400_000;

function schedule(overrides: Partial<BriefingSchedule> = {}): BriefingSchedule {
  return {
    frequency: 'daily',
    interval: 1,
    anchorDate: '2024-01-07',
    timeZone: 'UTC',
    times: ['20:00', '01:30', '02:15'],
    weekdays: [1, 4],
    monthDay: 31,
    ...overrides,
  };
}

function iso(epoch: number) {
  return new Date(epoch).toISOString();
}

function expectLocalLabels(occurrence: ScheduleOccurrence, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(occurrence.scheduledFor))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  expect(occurrence.localDate).toBe(`${parts.year}-${parts.month}-${parts.day}`);
  expect(occurrence.localTime).toBe(`${parts.hour}:${parts.minute}`);
}

const zones = [
  { timeZone: 'UTC', after: ['2026-03-07T00:00:00.000Z', '2026-10-31T00:00:00.000Z'] },
  { timeZone: 'Asia/Seoul', after: ['2026-03-07T00:00:00.000Z', '2026-10-31T00:00:00.000Z'] },
  { timeZone: 'America/New_York', after: ['2026-03-07T00:00:00.000Z', '2026-10-31T00:00:00.000Z'] },
  { timeZone: 'Europe/London', after: ['2026-03-28T00:00:00.000Z', '2026-10-24T00:00:00.000Z'] },
  {
    timeZone: 'Australia/Lord_Howe',
    after: ['2026-04-04T00:00:00.000Z', '2026-10-03T00:00:00.000Z'],
  },
] as const;

describe('Briefing schedule preview/due invariants', () => {
  for (const { timeZone, after } of zones) {
    for (const afterISO of after) {
      it.each([
        { frequency: 'daily', interval: 2 },
        { frequency: 'weekly', interval: 2 },
        { frequency: 'monthly', interval: 1 },
      ] as const)(
        `${timeZone} after ${afterISO}: $frequency × $interval is unique, ordered, strictly after, and consistent with due lookup`,
        (recurrence) => {
          const input = schedule({ ...recurrence, timeZone });
          const original = structuredClone(input);
          const preview = nextOccurrences(input, afterISO);
          expect(preview).toHaveLength(5);
          const epochs = preview.map(({ scheduledFor }) => Date.parse(scheduledFor));
          expect(new Set(epochs).size).toBe(5);
          expect(
            epochs.every((epoch, index) => epoch > (epochs[index - 1] ?? Date.parse(afterISO))),
          ).toBe(true);
          for (const item of preview) expectLocalLabels(item, timeZone);

          // Due lookup is checked against a separately requested forward preview, including
          // both sides of a boundary. A due interval is (after, now], not [after, now].
          for (const now of [epochs[0]! - 1, epochs[0]!, epochs[2]! + 1, epochs[4]!]) {
            const expected =
              preview.filter(({ scheduledFor }) => Date.parse(scheduledFor) <= now).at(-1) ?? null;
            expect(latestDueOccurrence(input, afterISO, iso(now))).toEqual(expected);
          }
          expect(
            latestDueOccurrence(input, preview[0]!.scheduledFor, preview[0]!.scheduledFor),
          ).toBeNull();
          expect(
            latestDueOccurrence(input, preview[0]!.scheduledFor, iso(epochs[1]! - 1)),
          ).toBeNull();
          expect(nextOccurrences(input, preview[0]!.scheduledFor, 4)).toEqual(preview.slice(1));
          expect(input).toEqual(original);
        },
      );
    }
  }

  it('keeps every-third-day spacing in local calendar days over an offset change', () => {
    const input = schedule({
      timeZone: 'America/New_York',
      anchorDate: '2026-03-03',
      interval: 3,
      times: ['08:00'],
    });
    const preview = nextOccurrences(input, '2026-03-02T00:00:00.000Z');
    expect(preview.map(({ localDate }) => localDate)).toEqual([
      '2026-03-03',
      '2026-03-06',
      '2026-03-09',
      '2026-03-12',
      '2026-03-15',
    ]);
    expect(preview.map(({ localTime }) => localTime)).toEqual(Array(5).fill('08:00'));
    const epochs = preview.map(({ scheduledFor }) => Date.parse(scheduledFor));
    expect(epochs[2]! - epochs[1]!).toBe(3 * DAY - 3_600_000);
  });

  it('keeps a two-week Monday/Thursday pattern anchored to the configured start week', () => {
    const input = schedule({
      frequency: 'weekly',
      interval: 2,
      anchorDate: '2026-02-02',
      times: ['08:00'],
    });
    expect(
      nextOccurrences(input, '2026-02-01T00:00:00.000Z').map(({ localDate }) => localDate),
    ).toEqual(['2026-02-02', '2026-02-05', '2026-02-16', '2026-02-19', '2026-03-02']);
  });

  it.each([
    ['2024', ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31']],
    ['2025', ['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31']],
  ] as const)(
    'clamps monthly day 31 correctly in %s without changing subsequent months',
    (year, dates) => {
      const input = schedule({
        frequency: 'monthly',
        anchorDate: `${year}-01-01`,
        monthDay: 31,
        times: ['08:00'],
      });
      const preview = nextOccurrences(input, `${year}-01-01T00:00:00.000Z`);
      expect(preview.map(({ localDate }) => localDate)).toEqual(dates);
      expect(preview.map(({ adjustment }) => adjustment)).toEqual([
        'none',
        'month-end',
        'none',
        'month-end',
        'none',
      ]);
      expect(
        latestDueOccurrence(input, `${year}-01-01T00:00:00.000Z`, `${year}-05-31T08:00:00.000Z`),
      ).toEqual(preview.at(-1));
    },
  );

  it('honors a 12-month interval anchored in leap February', () => {
    const input = schedule({
      frequency: 'monthly',
      interval: 12,
      anchorDate: '2024-02-01',
      monthDay: 31,
      times: ['08:00'],
    });
    expect(
      nextOccurrences(input, '2024-02-01T00:00:00.000Z').map(({ localDate }) => localDate),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it.each([
    {
      timeZone: 'America/New_York',
      anchorDate: '2026-03-08',
      after: '2026-03-08T05:00:00.000Z',
      times: ['02:00', '02:15', '03:00'],
      localTime: '03:00',
    },
    {
      timeZone: 'Australia/Lord_Howe',
      anchorDate: '2026-10-04',
      after: '2026-10-03T13:00:00.000Z',
      times: ['02:00', '02:15', '02:30'],
      localTime: '02:30',
    },
  ])(
    'deduplicates delivery times that converge across the DST gap in $timeZone',
    ({ after, localTime, ...options }) => {
      const input = schedule(options);
      const preview = nextOccurrences(input, after);
      expect(preview.filter(({ localDate }) => localDate === input.anchorDate)).toHaveLength(1);
      expect(preview[0]).toMatchObject({
        localDate: input.anchorDate,
        localTime,
        adjustment: 'dst-gap',
      });
      expect(latestDueOccurrence(input, after, preview[0]!.scheduledFor)).toEqual(preview[0]);
      expect(nextOccurrences(input, preview[0]!.scheduledFor, 1)[0]!.localDate).not.toBe(
        input.anchorDate,
      );
    },
  );

  it('does not deliver a second occurrence of a repeated fall-back wall time', () => {
    const input = schedule({
      timeZone: 'America/New_York',
      anchorDate: '2026-11-01',
      times: ['01:30'],
    });
    const preview = nextOccurrences(input, '2026-11-01T04:00:00.000Z');
    expect(preview[0]!.scheduledFor).toBe('2026-11-01T05:30:00.000Z');
    expect(
      latestDueOccurrence(input, preview[0]!.scheduledFor, '2026-11-01T06:45:00.000Z'),
    ).toBeNull();
    expect(nextOccurrences(input, '2026-11-01T05:30:00.000Z', 1)[0]!.localDate).toBe('2026-11-02');
  });

  it('never emits before the anchor and respects the finite year-9999 boundary', () => {
    const input = schedule({ anchorDate: '2026-10-01', times: ['08:00'] });
    expect(
      latestDueOccurrence(input, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z'),
    ).toBeNull();
    expect(nextOccurrences(input, '2026-09-01T00:00:00.000Z', 1)[0]!.localDate).toBe('2026-10-01');
    const finalDay = schedule({ anchorDate: '9999-12-31', times: ['08:00'] });
    const preview = nextOccurrences(finalDay, '9999-12-30T00:00:00.000Z');
    expect(preview).toHaveLength(1);
    expect(preview[0]!.scheduledFor).toBe('9999-12-31T08:00:00.000Z');
    expect(nextOccurrences(finalDay, preview[0]!.scheduledFor)).toEqual([]);
    expect(
      latestDueOccurrence(finalDay, preview[0]!.scheduledFor, '9999-12-31T23:59:59.999Z'),
    ).toBeNull();
  });
});
