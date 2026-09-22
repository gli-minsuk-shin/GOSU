import { Temporal } from 'temporal-polyfill';
import type { EmailPreparedActions } from './email-prepared-actions';

const WEEKDAYS: readonly RegExp[] = [
  /(?:\bsun(?:\.|day)?\b)|일요일/i,
  /(?:\bmon(?:\.|day)?\b)|월요일/i,
  /(?:\btue(?:s|\.|sday)?\b)|화요일/i,
  /(?:\bwed(?:\.|nesday)?\b)|수요일/i,
  /(?:\bthu(?:r|rs|\.|rsday)?\b)|목요일/i,
  /(?:\bfri(?:\.|day)?\b)|금요일/i,
  /(?:\bsat(?:\.|urday)?\b)|토요일/i,
];
/** An explicit calendar date in the evidence is authoritative; only a bare weekday is realigned. */
const EXPLICIT_DATE =
  /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*[/.]\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

/** The single weekday named in the evidence (0 = Sunday), or null when absent or ambiguous. */
export function evidenceWeekday(evidence: string) {
  if (!evidence || EXPLICIT_DATE.test(evidence)) return null;
  const named = WEEKDAYS.flatMap((pattern, day) => (pattern.test(evidence) ? [day] : []));
  return named.length === 1 ? named[0]! : null;
}
function shiftDays(instant: string, timeZone: string, days: number) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timeZone)
    .add({ days })
    .toInstant()
    .toString();
}
function weekdayOfInstant(instant: string, timeZone: string) {
  // Temporal's dayOfWeek is 1 (Monday) to 7 (Sunday); the evidence table starts at Sunday.
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).dayOfWeek % 7;
}
const shortestShift = (named: number, current: number) =>
  (((named - current + 3 + 7) % 7) + 7) % 7 === 0 ? 0 : ((named - current + 3 + 7) % 7) - 3;
const localDate = (instant: string, timeZone: string) =>
  Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toString();

/**
 * Claude placed "See you soon on Saturday." on Sunday 2026-09-20 (2026-09-18 KST mail): with only a
 * weekday in the mail, the model's own date arithmetic put the dinner one day off. When the evidence
 * names exactly one weekday and no explicit date, the draft is moved to that weekday (at most three
 * days either way, keeping the local time) and the change is stated in its notice.
 */
/**
 * A realigned copy of saved drafts, for summaries saved before 0.58.109: the buttons reuse these
 * drafts without another model call, so an old one-day-off draft is corrected when it is opened.
 */
export function alignedPreparedActions(
  actions: EmailPreparedActions | null | undefined,
  fallbackTimeZone: string,
) {
  if (!actions) return actions;
  const copy = structuredClone(actions);
  alignActionsToEvidenceWeekday(copy, fallbackTimeZone);
  return copy;
}
export function alignActionsToEvidenceWeekday(
  actions: EmailPreparedActions,
  fallbackTimeZone: string,
) {
  const changed: string[] = [];
  const label = (day: number) => ['일', '월', '화', '수', '목', '금', '토'][day]!;
  const event = actions.event;
  if (event && !event.allDay) {
    const timeZone = event.timeZone || fallbackTimeZone;
    const named = evidenceWeekday(event.evidenceQuote);
    try {
      if (named !== null) {
        const shift = shortestShift(named, weekdayOfInstant(event.start, timeZone));
        if (shift !== 0) {
          const before = localDate(event.start, timeZone);
          event.start = shiftDays(event.start, timeZone, shift);
          event.end = shiftDays(event.end, timeZone, shift);
          const after = localDate(event.start, timeZone);
          const note = `근거의 ${label(named)}요일에 맞춰 날짜를 ${before}에서 ${after}로 GOSU가 맞췄습니다.`;
          event.notice = `${event.notice} ${note}`.trim().slice(0, 1000);
          changed.push(note);
        }
      }
    } catch {
      // An unparsable instant stays untouched; the existing validation rejects it.
    }
  }
  const task = actions.task;
  if (task?.dueDate) {
    const timeZone = task.timeZone || fallbackTimeZone;
    const named = evidenceWeekday(task.deadlineQuote);
    try {
      if (named !== null) {
        const due = Temporal.PlainDate.from(task.dueDate);
        const shift = shortestShift(named, due.dayOfWeek % 7);
        if (shift !== 0) {
          const before = task.dueDate;
          task.dueDate = due.add({ days: shift }).toString();
          if (task.dueAt) task.dueAt = shiftDays(task.dueAt, timeZone, shift);
          const note = `근거의 ${label(named)}요일에 맞춰 마감일을 ${before}에서 ${task.dueDate}로 GOSU가 맞췄습니다.`;
          task.notice = `${task.notice} ${note}`.trim().slice(0, 1000);
          changed.push(note);
        }
      }
    } catch {
      // Same: an unparsable date is left to validation.
    }
  }
  return changed;
}
