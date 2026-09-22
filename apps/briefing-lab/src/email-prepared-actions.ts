import { z } from 'zod';
import { Temporal } from 'temporal-polyfill';
import { EventDraftSchema } from './workspace-contracts';
export const EmailPreparedActionsSchema = z
  .object({
    event: z
      .object(EventDraftSchema.shape)
      .omit({ calendarId: true })
      .extend({ evidenceQuote: z.string().min(1).max(1000), notice: z.string().max(1000) })
      .strict()
      .nullable(),
    task: z
      .object({
        title: z.string().trim().min(2).max(240),
        notes: z.string().max(4000),
        dueDate: z.string().date().nullable(),
        dueAt: z.string().datetime({ offset: true }).nullable().optional(),
        timeZone: z.string().max(100).optional(),
        evidenceQuote: z.string().min(1).max(1000),
        deadlineQuote: z.string().max(1000),
        notice: z.string().max(1000),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type EmailPreparedActions = z.infer<typeof EmailPreparedActionsSchema>;
export function validateEmailPreparedActions(actions: EmailPreparedActions, evidence: string) {
  const match = (quote: string) =>
    quote.trim().length > 0 && evidence.replace(/\s+/g, ' ').includes(quote.replace(/\s+/g, ' '));
  if (actions.event) {
    EventDraftSchema.parse(
      z.object(EventDraftSchema.shape).parse({ ...actions.event, calendarId: '' }),
    );
  }
  if (actions.event && !match(actions.event.evidenceQuote))
    throw Error('email_action_evidence_invalid');
  if (actions.task?.dueAt) {
    if (
      !actions.task.timeZone ||
      !actions.task.dueDate ||
      Temporal.Instant.from(actions.task.dueAt)
        .toZonedDateTimeISO(actions.task.timeZone)
        .toPlainDate()
        .toString() !== actions.task.dueDate
    )
      throw Error('email_action_deadline_invalid');
  }
  if (
    actions.task &&
    (!match(actions.task.evidenceQuote) ||
      (actions.task.dueDate && !match(actions.task.deadlineQuote)))
  )
    throw Error('email_action_evidence_invalid');
}
