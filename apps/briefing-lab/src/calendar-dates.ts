import { Temporal } from 'temporal-polyfill';
import type { EventDraft } from './workspace-contracts';
export function setEventAllDay(draft: EventDraft, allDay: boolean): EventDraft {
  if (!allDay) return { ...draft, allDay };
  const start = Temporal.Instant.from(draft.start).toZonedDateTimeISO(draft.timeZone).startOfDay();
  const originalEnd = Temporal.Instant.from(draft.end).toZonedDateTimeISO(draft.timeZone);
  let end = originalEnd.startOfDay();
  if (originalEnd.epochMilliseconds > end.epochMilliseconds) end = end.add({ days: 1 });
  if (end.epochMilliseconds <= start.epochMilliseconds) end = start.add({ days: 1 });
  return { ...draft, allDay, start: start.toInstant().toString(), end: end.toInstant().toString() };
}
export function calendarInstant(value: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return Temporal.PlainDate.from(value).toZonedDateTime(timeZone).toInstant().toString();
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return Temporal.Instant.from(value).toString();
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timeZone, { disambiguation: 'reject' })
    .toInstant()
    .toString();
}
export function calendarLocal(instant: string, timeZone: string, allDay = false) {
  const z = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
  return allDay
    ? z.toPlainDate().toString()
    : z.toPlainDateTime().toString({ smallestUnit: 'minute' });
}
export function initialEvent(
  timeZone: string,
  calendarId = '',
  start?: string,
  end?: string,
  allDay = false,
): EventDraft {
  const beginning = start
    ? calendarInstant(start, timeZone)
    : Temporal.Now.zonedDateTimeISO(timeZone)
        .round({ smallestUnit: 'hour', roundingMode: 'ceil' })
        .toInstant()
        .toString();
  const ending = end
    ? calendarInstant(end, timeZone)
    : Temporal.Instant.from(beginning)
        .toZonedDateTimeISO(timeZone)
        .add(allDay ? { days: 1 } : { hours: 1 })
        .toInstant()
        .toString();
  return {
    calendarId,
    title: '',
    start: beginning,
    end: ending,
    timeZone,
    allDay,
    location: '',
    notes: '',
    alarmMinutes: 10,
  };
}
