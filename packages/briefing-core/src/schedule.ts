import type { BriefingSchedule, ScheduleOccurrence } from './types.js';
import { BriefingScheduleSchema, isInstant } from './schema.js';

const DAY = 86_400_000;
const MINUTE = 60_000;
const MAX_SEARCH_DAYS = 200_000;
type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let value = formatters.get(zone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    if (formatters.size >= 100) formatters.clear();
    formatters.set(zone, value);
  }
  return value;
}
function wallAt(epoch: number, zone: string): Wall {
  const parts = Object.fromEntries(
    formatter(zone)
      .formatToParts(epoch)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
  return parts as Wall;
}
function utc(wall: Wall) {
  const value = new Date(0);
  value.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  value.setUTCHours(wall.hour, wall.minute, wall.second, 0);
  return value.getTime();
}
const localDate = (wall: Wall) =>
  `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
const localTime = (wall: Wall) =>
  `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
function dayIndex(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / DAY);
}
function dayWall(index: number): Wall {
  const date = new Date(index * DAY);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}
function resolveWall(day: Wall, time: string, zone: string): ScheduleOccurrence | null {
  const [hour, minute] = time.split(':').map(Number);
  const nominal = utc({ ...day, hour: hour!, minute: minute! });
  const offsets = new Set<number>();
  for (let hours = -72; hours <= 72; hours += 12) {
    const sample = nominal + hours * 3_600_000;
    offsets.add(utc(wallAt(sample, zone)) - sample);
  }
  // A gap advances to the first valid wall minute, including historical skipped whole dates.
  for (let advance = 0; advance <= 26 * 60; advance++) {
    const wanted = nominal + advance * MINUTE;
    const candidates = [...offsets]
      .map((offset) => wanted - offset)
      .filter((epoch) => utc(wallAt(epoch, zone)) === wanted)
      .sort((left, right) => left - right);
    const selected = candidates[0]; // Fall-back repeated time: first occurrence only.
    if (selected !== undefined) {
      const actual = wallAt(selected, zone);
      return {
        scheduledFor: new Date(selected).toISOString(),
        localDate: localDate(actual),
        localTime: localTime(actual),
        adjustment: advance ? 'dst-gap' : 'none',
      };
    }
  }
  return null;
}
function eligible(schedule: BriefingSchedule, index: number, anchor: number): boolean {
  if (index < anchor) return false;
  if (schedule.frequency === 'daily') return (index - anchor) % schedule.interval === 0;
  const weekday = (((index + 4) % 7) + 7) % 7;
  if (schedule.frequency === 'weekly') {
    // Cadence is relative to the ISO Monday week containing the anchor. IDs remain 0 = Sunday.
    const anchorWeekday = (((anchor + 3) % 7) + 7) % 7;
    return (
      Math.floor((index - (anchor - anchorWeekday)) / 7) % schedule.interval === 0 &&
      schedule.weekdays.includes(weekday)
    );
  }
  const current = dayWall(index);
  const start = dayWall(anchor);
  const months = (current.year - start.year) * 12 + current.month - start.month;
  return (
    months % schedule.interval === 0 &&
    current.day === Math.min(schedule.monthDay, daysInMonth(current))
  );
}
function daysInMonth(day: Wall) {
  const next = new Date(utc({ ...day, day: 1 }));
  next.setUTCMonth(next.getUTCMonth() + 1, 0);
  return next.getUTCDate();
}
function occurrencesOn(schedule: BriefingSchedule, index: number): ScheduleOccurrence[] {
  const day = dayWall(index);
  if (day.year > 9999 || day.year < 1) return [];
  return [...schedule.times].sort().flatMap((time) => {
    const value = resolveWall(day, time, schedule.timeZone);
    if (!value) return [];
    return [
      {
        ...value,
        adjustment:
          value.adjustment === 'none' &&
          schedule.frequency === 'monthly' &&
          schedule.monthDay > day.day
            ? ('month-end' as const)
            : value.adjustment,
      },
    ];
  });
}

/** Pure preview only; no timers or operating-system scheduling are installed. */
export function nextOccurrences(
  schedule: BriefingSchedule,
  afterISO: string,
  count = 5,
): ScheduleOccurrence[] {
  const parsed = BriefingScheduleSchema.safeParse(schedule);
  const after = Date.parse(afterISO);
  if (
    !parsed.success ||
    !isInstant(afterISO) ||
    !Number.isFinite(after) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 50
  )
    return [];
  const normalized = parsed.data;
  const anchor = dayIndex(normalized.anchorDate);
  const start = Math.max(anchor, dayIndex(localDate(wallAt(after, normalized.timeZone))) - 2);
  const found = new Map<string, ScheduleOccurrence>();
  for (let index = start; index < start + MAX_SEARCH_DAYS && dayWall(index).year <= 9999; index++) {
    if (!eligible(normalized, index, anchor)) continue;
    for (const item of occurrencesOn(normalized, index)) {
      if (Date.parse(item.scheduledFor) > after && !found.has(item.scheduledFor))
        found.set(item.scheduledFor, item);
    }
    if (found.size >= count)
      return [...found.values()]
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
        .slice(0, count);
  }
  return [...found.values()]
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
    .slice(0, count);
}

/** Coalesce missed previews into the newest due occurrence in (after, now]. */
export function latestDueOccurrence(
  schedule: BriefingSchedule,
  afterISO: string,
  nowISO: string,
): ScheduleOccurrence | null {
  const parsed = BriefingScheduleSchema.safeParse(schedule);
  const after = Date.parse(afterISO),
    now = Date.parse(nowISO);
  if (
    !parsed.success ||
    !isInstant(afterISO) ||
    !isInstant(nowISO) ||
    !Number.isFinite(after) ||
    !Number.isFinite(now) ||
    now <= after
  )
    return null;
  const normalized = parsed.data;
  const anchor = dayIndex(normalized.anchorDate);
  const end = dayIndex(localDate(wallAt(now, normalized.timeZone)));
  const start = Math.max(
    anchor,
    dayIndex(localDate(wallAt(after, normalized.timeZone))) - 2,
    end - MAX_SEARCH_DAYS,
  );
  for (let index = end; index >= start; index--) {
    if (!eligible(normalized, index, anchor)) continue;
    const values = occurrencesOn(normalized, index)
      .filter(
        ({ scheduledFor }) => Date.parse(scheduledFor) > after && Date.parse(scheduledFor) <= now,
      )
      .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
    if (values[0]) return values[0];
  }
  return null;
}
