import { z } from 'zod';
import { createHash } from 'node:crypto';
import { runCalendarNative } from './calendar-native';
import { EventDraftSchema, type CalendarInfo } from './src/workspace-contracts';
import type { CalendarAction } from './briefing-workspace-store';
const BaseEvent = z
  .object({
    nativeId: z.string(),
    modifiedAt: z.string(),
    calendarId: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    timeZone: z.string(),
    location: z.string(),
    notes: z.string(),
    alarmMinutes: z.number().nullable(),
    recurring: z.boolean(),
    hasAttendees: z.boolean(),
    contentTruncated: z.boolean().default(false),
  })
  .strict();
type NativeEvent = z.infer<typeof BaseEvent>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function eventFingerprint(event: NativeEvent) {
  const { modifiedAt: _syncTimestamp, ...content } = event;
  return hash(content);
}
export class CalendarService {
  private observed = new Map<string, NativeEvent>();
  constructor(private readonly run = runCalendarNative) {}
  authorize(signal: AbortSignal) {
    return this.run({ action: 'authorize' }, signal);
  }
  async calendars(signal: AbortSignal): Promise<CalendarInfo[]> {
    const raw = await this.run({ action: 'calendars' }, signal);
    return z
      .object({
        calendars: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              source: z.string(),
              writable: z.boolean(),
              color: z.string(),
            }),
          )
          .max(100),
      })
      .parse(raw).calendars;
  }
  async events(calendarIds: string[], start: string, end: string, signal: AbortSignal) {
    if (
      !calendarIds.length ||
      new Set(calendarIds).size !== calendarIds.length ||
      !Number.isFinite(Date.parse(start)) ||
      !Number.isFinite(Date.parse(end)) ||
      Date.parse(end) <= Date.parse(start) ||
      Date.parse(end) - Date.parse(start) > 93 * 86400000
    )
      throw new Error('calendar_range_invalid');
    const raw = z
      .object({ events: z.array(BaseEvent).max(500), limited: z.boolean() })
      .parse(await this.run({ action: 'events', calendarIds, start, end }, signal));
    const events = raw.events.map((native) => {
      if (!calendarIds.includes(native.calendarId)) throw new Error('calendar_scope_invalid');
      const id = hash([native.calendarId, native.nativeId, native.start]);
      this.observed.set(id, native);
      const { nativeId: _id, ...event } = native;
      return { ...event, id, fingerprint: eventFingerprint(native) };
    });
    while (this.observed.size > 2000) this.observed.delete(this.observed.keys().next().value!);
    return { events, limited: raw.limited };
  }
  observedEvent(id: string) {
    return this.observed.get(id) ?? null;
  }
  async apply(action: CalendarAction, signal: AbortSignal, directInteraction = false) {
    const draft = EventDraftSchema.parse(action.draft);
    const calendars = await this.calendars(signal);
    if (!calendars.some((c) => c.id === draft.calendarId && c.writable))
      throw new Error('calendar_readonly');
    let original: NativeEvent | null = null;
    if (action.kind !== 'create') {
      if (!action.eventId) throw new Error('calendar_event_missing');
      original = this.observedEvent(action.eventId);
      if (
        !original ||
        eventFingerprint(original) !== action.fingerprint ||
        original.calendarId !== draft.calendarId
      )
        throw new Error('calendar_event_changed');
      if (original.hasAttendees) throw new Error('calendar_invitation_readonly');
      if (original.contentTruncated) throw new Error('calendar_content_readonly');
    }
    const raw = (await this.run(
      {
        action: action.kind,
        directInteraction,
        draft,
        ...(original
          ? { nativeId: original.nativeId, originalStart: original.start, original }
          : {}),
      },
      signal,
    )) as { event?: unknown; deleted?: boolean };
    if (action.kind === 'delete') {
      if (!raw.deleted) throw new Error('calendar_write_uncertain');
      this.observed.delete(action.eventId!);
      return { id: action.eventId!, deleted: true };
    }
    const native = BaseEvent.parse(raw.event),
      id = hash([native.calendarId, native.nativeId, native.start]);
    if (!native.nativeId) throw new Error('calendar_write_uncertain');
    this.observed.set(id, native);
    return { id, deleted: false };
  }
}
