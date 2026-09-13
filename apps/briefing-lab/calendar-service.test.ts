import { it, expect, vi } from 'vitest';
import { CalendarService } from './calendar-service';
import { calendarInstant, calendarLocal, initialEvent, setEventAllDay } from './src/calendar-dates';
import { calendarWindow } from './briefing-assistant';
import { Temporal } from 'temporal-polyfill';
import type { CalendarAction } from './briefing-workspace-store';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packagedCalendarBinary } from './calendar-native';
it('excludes cancelled EventKit entries before calendar notification/query limits are applied', async () => {
  const source = await readFile(new URL('./calendar-native.ts', import.meta.url), 'utf8');
  expect(source).toContain('.filter{$0.status != .canceled}.sorted');
});
it('uses a fixed bundled Calendar helper for installed apps and never falls back when it is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-calendar-package-'));
  try {
    expect(await packagedCalendarBinary()).toBeUndefined();
    expect(await packagedCalendarBinary(dir)).toBeUndefined();
    await writeFile(join(dir, 'app.asar'), 'fixture');
    await expect(packagedCalendarBinary(dir)).rejects.toThrow();
    const binary = join(dir, 'CalendarBridge.app', 'Contents', 'MacOS', 'CalendarBridge');
    await mkdir(join(dir, 'CalendarBridge.app', 'Contents', 'MacOS'), { recursive: true });
    await writeFile(binary, 'fixture');
    expect(await packagedCalendarBinary(dir)).toBe(binary);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
const draft = {
  calendarId: 'c',
  title: 'Review',
  start: '2026-09-09T01:00:00Z',
  end: '2026-09-09T02:00:00Z',
  allDay: false,
  timeZone: 'Asia/Seoul',
  location: 'Office',
  notes: 'note',
  alarmMinutes: 10,
};
const native = {
  ...draft,
  nativeId: 'native',
  modifiedAt: '2026-09-08T01:00:00Z',
  hasAttendees: false,
  recurring: false,
};
const action = (patch: Partial<CalendarAction> = {}): CalendarAction => ({
  id: 'a',
  routineId: 'r',
  kind: 'create',
  eventId: null,
  fingerprint: null,
  draft,
  state: 'pending',
  createdAt: '2026-09-09T00:00:00Z',
  resultId: null,
  ...patch,
});
function fixture(overrides = {}) {
  const run = vi.fn(async (input: unknown) => {
    const q = input as { action: string };
    if (q.action === 'calendars')
      return {
        calendars: [
          { id: 'c', name: 'Research', source: 'Local', color: '#527d0b', writable: true },
        ],
      };
    if (q.action === 'events') return { events: [{ ...native, ...overrides }], limited: false };
    if (q.action === 'delete') return { deleted: true };
    return { event: native };
  });
  return { run, service: new CalendarService(run) };
}
it('reads only requested calendars and refuses oversized or mismatched scope', async () => {
  const { run, service } = fixture();
  await expect(
    service.events([], draft.start, draft.end, new AbortController().signal),
  ).rejects.toThrow('range');
  expect(run).not.toHaveBeenCalled();
  await expect(
    service.events(['other'], draft.start, draft.end, new AbortController().signal),
  ).rejects.toThrow('scope');
});
it('uses observed fingerprints, original occurrence and a write receipt; a stale client cannot overwrite', async () => {
  const { service, run } = fixture();
  const sig = new AbortController().signal;
  const e = (await service.events(['c'], draft.start, draft.end, sig)).events[0]!;
  await expect(
    service.apply(action({ kind: 'update', eventId: e.id, fingerprint: 'stale' }), sig),
  ).rejects.toThrow('changed');
  await service.apply(action({ kind: 'update', eventId: e.id, fingerprint: e.fingerprint }), sig);
  expect(run.mock.calls.at(-1)?.[0]).toMatchObject({
    action: 'update',
    nativeId: 'native',
    originalStart: draft.start,
    original: native,
  });
});
it('never mutates attendee invitations and never treats a missing write receipt as success', async () => {
  const { service, run } = fixture({ hasAttendees: true });
  const sig = new AbortController().signal,
    e = (await service.events(['c'], draft.start, draft.end, sig)).events[0]!;
  await expect(
    service.apply(action({ kind: 'delete', eventId: e.id, fingerprint: e.fingerprint }), sig),
  ).rejects.toThrow('invitation');
  expect(run.mock.calls.some(([i]) => (i as { action: string }).action === 'delete')).toBe(false);
});
it('handles local day boundaries and DST without treating a day as 24 hours', () => {
  const range = calendarWindow(
    'America/New_York',
    1,
    Temporal.Instant.from('2026-03-08T15:00:00Z'),
  );
  expect(Date.parse(range.end) - Date.parse(range.start)).toBe(23 * 3600000);
  expect(calendarInstant('2026-09-09', 'Asia/Seoul')).toBe('2026-09-08T15:00:00Z');
  expect(calendarLocal('2026-09-08T15:00:00Z', 'Asia/Seoul', true)).toBe('2026-09-09');
  expect(() => calendarInstant('2026-03-08T02:30', 'America/New_York')).toThrow();
  const d = initialEvent('America/New_York', 'c', '2026-03-08', undefined, true);
  expect(Date.parse(d.end) - Date.parse(d.start)).toBe(23 * 3600000);
});
it('native helper scopes recurring mutations to this occurrence and preserves unchanged existing alarms', async () => {
  const source = await readFile(new URL('./calendar-native.ts', import.meta.url), 'utf8');
  expect(source).toContain('span:.thisEvent');
  expect(source).not.toContain('span:.futureEvents');
  expect(source).toContain('requestedAlarm != previousAlarm');
  expect(source).toContain('calendar_invitation_readonly');
  expect(source).toContain('lastModifiedDate');
  expect(source.indexOf('store.reset()')).toBeGreaterThan(source.indexOf('review.runModal()'));
});
it('normalizes all-day toggles to local midnight with an exclusive next-day end', () => {
  const result = setEventAllDay(draft, true);
  expect(result.start).toBe('2026-09-08T15:00:00Z');
  expect(result.end).toBe('2026-09-09T15:00:00Z');
});
it('ignores synchronization timestamps while retaining real-content conflict detection', async () => {
  const changes = { modifiedAt: native.modifiedAt, title: native.title };
  const { service, run } = fixture(changes),
    signal = new AbortController().signal;
  const first = (await service.events(['c'], draft.start, draft.end, signal)).events[0]!;
  changes.modifiedAt = '2026-09-09T00:00:00Z';
  const synced = (await service.events(['c'], draft.start, draft.end, signal)).events[0]!;
  expect(synced.fingerprint).toBe(first.fingerprint);
  await service.apply(
    action({ kind: 'delete', eventId: first.id, fingerprint: first.fingerprint }),
    signal,
    true,
  );
  expect(run.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'delete', directInteraction: true });
  expect(service.observedEvent(first.id)).toBeNull();
  changes.title = 'Changed elsewhere';
  await service.events(['c'], draft.start, draft.end, signal);
  await expect(
    service.apply(
      action({ kind: 'delete', eventId: first.id, fingerprint: first.fingerprint }),
      signal,
    ),
  ).rejects.toThrow('changed');
});
it('requires a verified certificate-signed GOSU parent to suppress native review', async () => {
  const source = await readFile(new URL('./calendar-native.ts', import.meta.url), 'utf8');
  expect(source).toContain('!trustedGosuParent()');
  expect(source).toContain('SecCodeCheckValidity(parent');
  expect(source).toContain('!certs.isEmpty');
  expect(source).toContain('sameContent(fresh,expected)');
});
