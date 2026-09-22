import { z } from 'zod';
import { Temporal } from 'temporal-polyfill';
import type { MailScope } from '@gosu/briefing-core';

export const MailSearchRequestSchema = z
  .object({
    query: z.string().max(300),
    sender: z.string().max(300).optional(),
    subject: z.string().max(300).optional(),
    account: z.string().max(320).optional(),
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
  })
  .strict();
export type MailSearchRequest = z.infer<typeof MailSearchRequestSchema>;
export type MailSearch = {
  query: string;
  sender: string;
  subject: string;
  account: string;
  from: string;
  to: string;
};
/** "All mail" arrives as a very early date; older than this is kept to a sane floor. */
export const MAIL_SEARCH_EARLIEST = Date.UTC(1990, 0, 1);
export function resolveMailSearch(
  request: MailSearchRequest,
  scope: MailScope,
  timeZone: string,
  now = Date.now(),
): MailSearch | undefined {
  const input = MailSearchRequestSchema.parse(request);
  if (!Object.values(input).some((v) => v?.trim())) return undefined;
  const parse = (value: string | undefined, fallback: number) => {
    if (!value?.trim()) return fallback;
    try {
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? Temporal.PlainDate.from(value).toZonedDateTime(timeZone).epochMilliseconds
        : Temporal.Instant.from(value).epochMilliseconds;
    } catch {
      throw new Error('mail_search_range_invalid');
    }
  };
  // The saved days are the briefing's collection window. For a search they are only the default:
  // a request that names an earlier `from` is searched as asked (2026-09-22 user decision: "메일 조회
  // 범위는 Briefing 만들 때만 적용"). Accounts, mailboxes and the saved filters still bound it.
  const requestedStart = parse(input.from, now - scope.days * 86400000),
    requestedEnd = parse(input.to, now + 60000);
  if (requestedEnd <= requestedStart) throw new Error('mail_search_range_invalid');
  const start = Math.max(requestedStart, MAIL_SEARCH_EARLIEST),
    end = Math.min(requestedEnd, now + 60000);
  // Nothing can have arrived in a window that lies wholly in the future.
  if (end <= start) throw new Error('mail_search_outside_scope');
  return {
    query: input.query.trim().toLowerCase().replace(/\s+/g, ' '),
    sender: (input.sender ?? '').trim().toLowerCase(),
    subject: (input.subject ?? '').trim().toLowerCase(),
    account: (input.account ?? '').trim().toLowerCase(),
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
  };
}
/** Self-contained: embedded in the fixed JXA script, with all values supplied only through JSON. */
export function nativeMailSearchPredicate(
  search: MailSearch,
  scope: Pick<MailScope, 'sender' | 'subject' | 'unreadOnly'>,
) {
  const rules: Record<string, unknown>[] = [
    { dateReceived: { _greaterThanEquals: new Date(search.from) } },
    { dateReceived: { _lessThan: new Date(search.to) } },
  ];
  [scope.sender, search.sender]
    .filter(Boolean)
    .forEach((term) => rules.push({ sender: { _contains: term } }));
  [scope.subject, search.subject]
    .filter(Boolean)
    .forEach((term) => rules.push({ subject: { _contains: term } }));
  if (scope.unreadOnly) rules.push({ readStatus: false });
  search.query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .forEach((term) =>
      rules.push({ _or: [{ sender: { _contains: term } }, { subject: { _contains: term } }] }),
    );
  return { _and: rules };
}
/** Independent host recheck. A search never weakens the saved sender/subject/unread filters. */
export function matchesMailSearch(
  item: { title: string; sender: string; date: string },
  search: MailSearch,
) {
  const text = `${item.title} ${item.sender}`.toLowerCase();
  return (
    Date.parse(item.date) >= Date.parse(search.from) &&
    Date.parse(item.date) < Date.parse(search.to) &&
    item.sender.toLowerCase().includes(search.sender) &&
    item.title.toLowerCase().includes(search.subject) &&
    search.query
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => text.includes(term.toLowerCase()))
  );
}
/**
 * The words a search must contain, for narrowing candidates in Mail's index before Mail is asked.
 * The saved scope filters are included: the reader applies them to every message anyway.
 */
export function mailSearchIndexTerms(
  search: MailSearch,
  scope: Pick<MailScope, 'sender' | 'subject'>,
) {
  const clean = (values: readonly string[]) => [
    ...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)),
  ];
  return {
    sender: clean([scope.sender, search.sender]),
    subject: clean([scope.subject, search.subject]),
    any: clean(search.query.split(/\s+/)),
  };
}
