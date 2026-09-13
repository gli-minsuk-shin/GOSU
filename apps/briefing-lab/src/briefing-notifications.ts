import { z } from 'zod';
const count = z.number().int().nonnegative();
export const BriefingNotificationSchema = z
  .object({
    id: z.string().uuid(),
    routineId: z.string().max(128),
    runId: z.string().uuid(),
    createdAt: z.string().datetime(),
    newEmails: count,
    emailSourceState: z.enum(['ready', 'empty', 'failed', 'disabled']).default('ready'),
    importantEmails: count,
    unclassifiedEmails: count,
    newPapers: count,
    partial: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.importantEmails + value.unclassifiedEmails <= value.newEmails,
    'Invalid email notification counts',
  );
export type BriefingNotification = z.infer<typeof BriefingNotificationSchema>;
export const CalendarNotificationSchema = z
  .object({
    routineId: z.string().min(1).max(128),
    id: z.string().max(256),
    calendarId: z.string().max(256),
    title: z.string().max(1000),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    allDay: z.boolean(),
    timeZone: z.string().max(100),
    alarmMinutes: z.number().nonnegative().nullable(),
  })
  .strict();
export type CalendarNotification = z.infer<typeof CalendarNotificationSchema>;
export const BriefingNotificationSnapshotSchema = z
  .object({
    briefings: z.array(BriefingNotificationSchema).max(200),
    calendar: z.array(CalendarNotificationSchema).max(500),
    calendarState: z.enum(['ready', 'disabled', 'confirmation-required', 'unavailable']),
    calendarLimited: z.boolean(),
  })
  .strict();
export type BriefingNotificationSnapshot = z.infer<typeof BriefingNotificationSnapshotSchema>;
export const BriefingNotificationTargetSchema = z
  .object({
    routineId: z.string().min(1).max(128),
    runId: z.string().uuid(),
    requestId: z.number().int().nonnegative(),
  })
  .strict();
export type BriefingNotificationTarget = z.infer<typeof BriefingNotificationTargetSchema>;
export const briefingNotificationAnchor = (routineId: string, runId: string) =>
  `notification-briefing:${encodeURIComponent(routineId)}:${encodeURIComponent(runId)}`;
