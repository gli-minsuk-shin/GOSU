import { z } from 'zod';
export {
  AssistantPreferencesSchema,
  defaultAssistantPreferences,
  type AssistantPreferences,
} from '@gosu/briefing-core';
export const EventDraftSchema = z
  .object({
    calendarId: z.string().max(300),
    title: z.string().trim().min(1).max(300),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    allDay: z.boolean(),
    timeZone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'event_timezone_invalid'),
    location: z.string().max(1000),
    notes: z.string().max(6000),
    alarmMinutes: z.number().int().min(0).max(10080).nullable(),
  })
  .strict()
  .refine(
    (e) =>
      Date.parse(e.end) > Date.parse(e.start) &&
      Date.parse(e.end) - Date.parse(e.start) <= 366 * 86400000,
    'event_range_invalid',
  );
export type EventDraft = z.infer<typeof EventDraftSchema>;
export type CalendarInfo = {
  id: string;
  name: string;
  source: string;
  writable: boolean;
  color: string;
};
export type CalendarEvent = EventDraft & {
  id: string;
  fingerprint: string;
  recurring: boolean;
  hasAttendees: boolean;
  contentTruncated?: boolean;
};
export const AssistantAnswerSchema = z
  .object({
    answer: z.string().min(1).max(14000),
    events: z
      .array(
        z
          .object({
            title: z.string().max(300),
            start: z.string().nullable(),
            end: z.string().nullable(),
            allDay: z.boolean(),
            timeZone: z.string().max(100),
            location: z.string().max(1000),
            notes: z.string().max(4000),
            alarmMinutes: z.number().int().min(0).max(10080).nullable(),
            sourceId: z.string().max(200).nullable(),
            evidence: z.string().max(600),
            reason: z.string().max(800),
          })
          .strict(),
      )
      .max(5),
    tasks: z
      .array(
        z
          .object({
            title: z.string().min(1).max(300),
            description: z.string().max(4000),
            deadline: z.string().nullable(),
            target: z.enum(['kanban', 'project-todo']),
            sourceId: z.string().nullable(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type AssistantAnswer = z.infer<typeof AssistantAnswerSchema>;
