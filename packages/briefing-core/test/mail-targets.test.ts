import { expect, it } from 'vitest';
import {
  MailScopeSchema,
  mailTargets,
  withMailTargets,
  DEFAULT_MAIL_LIMIT,
} from '../src/live-settings';
const scope = {
  accountId: 'a',
  mailboxId: 'box-a',
  days: 3,
  limit: 10,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: true,
};
it('keeps the default at fifty while accepting a hundred and rejecting higher limits', () => {
  expect(DEFAULT_MAIL_LIMIT).toBe(50);
  expect(MailScopeSchema.parse({ ...scope, limit: DEFAULT_MAIL_LIMIT }).limit).toBe(50);
  expect(MailScopeSchema.parse({ ...scope, limit: 100 }).limit).toBe(100);
  expect(MailScopeSchema.safeParse({ ...scope, limit: 101 }).success).toBe(false);
});
it('round trips legacy scope without silently selecting extra accounts', () => {
  expect(MailScopeSchema.parse(scope)).toEqual(scope);
  expect(mailTargets(scope)).toEqual([{ accountId: 'a', mailboxId: 'box-a' }]);
});
it('retains filters, promotes the remaining account on delete, and represents no connections as null', () => {
  const targets = [
    ...mailTargets(scope),
    { accountId: 'b', mailboxId: 'box-b', accountName: 'Work' },
  ];
  const multi = MailScopeSchema.parse(withMailTargets(scope, targets));
  expect(mailTargets(multi)).toEqual(targets);
  expect(withMailTargets(multi, targets.slice(1))).toEqual({ ...scope, ...targets[1] });
  expect(withMailTargets(multi, [])).toBeNull();
});
it('rejects duplicate accounts, mismatched-shaped targets and more than five accounts', () => {
  expect(
    MailScopeSchema.safeParse({ ...scope, additionalAccounts: [mailTargets(scope)[0]] }).success,
  ).toBe(false);
  expect(
    MailScopeSchema.safeParse({
      ...scope,
      additionalAccounts: [{ accountId: 'b', mailboxId: 'b', command: 'read all' }],
    }).success,
  ).toBe(false);
  expect(
    MailScopeSchema.safeParse({
      ...scope,
      additionalAccounts: Array.from({ length: 5 }, (_, i) => ({
        accountId: String(i),
        mailboxId: String(i),
      })),
    }).success,
  ).toBe(false);
});
