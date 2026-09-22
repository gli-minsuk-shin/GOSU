import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  mailReadNotice,
  mailSummaryKey,
  nativeMailHash,
  planMailRead,
} from './briefing-mail-ingestion';
const scope = {
  accountId: 'a',
  mailboxId: 'inbox-a',
  days: 3,
  limit: 50,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: true,
};
it('starts with three total messages and uses fifty only after the first successful read', () => {
  expect(planMailRead(scope, []).budgets).toEqual([{ accountId: 'a', limit: 3 }]);
  expect(planMailRead(scope, ['a']).budgets).toEqual([{ accountId: 'a', limit: 50 }]);
  expect(planMailRead({ ...scope, limit: 2 }, []).budgets[0]?.limit).toBe(2);
});
it('keeps the total onboarding cap at three across new accounts and caps later added accounts at three', () => {
  const multi = {
    ...scope,
    additionalAccounts: ['b', 'c', 'd', 'e'].map((id) => ({ accountId: id, mailboxId: id })),
  };
  const first = planMailRead(multi, []);
  expect(first.budgets.reduce((n, b) => n + b.limit, 0)).toBe(3);
  const mixed = planMailRead(multi, ['a', 'b', 'c']);
  expect(mixed.budgets.reduce((n, b) => n + b.limit, 0)).toBe(50);
  expect(
    mixed.budgets.filter((b) => ['d', 'e'].includes(b.accountId)).every((b) => b.limit <= 3),
  ).toBe(true);
});
it.each(['plain', '한글 이름', '😀 supplementary', '"\\\n', 'x'.repeat(10000)])(
  'matches host SHA256 for native identity %s',
  (input) => {
    expect(nativeMailHash(input)).toBe(createHash('sha256').update(input).digest('hex'));
  },
);
it('never identifies a summarized email by subject alone or across reused source IDs', () => {
  const key = mailSummaryKey('id-a', '2026-09-10T00:00:00Z', 'Same title');
  expect(key).not.toBe(mailSummaryKey('id-b', '2026-09-10T00:00:00Z', 'Same title'));
  expect(key).not.toBe(mailSummaryKey('id-a', '2026-09-11T00:00:00Z', 'Same title'));
  expect(key).not.toBe(mailSummaryKey('id-a', '2026-09-10T00:00:00Z', 'Changed title'));
});
it('writes a read notice only for a first connection or a newly added account', () => {
  expect(mailReadNotice(planMailRead(scope, ['a']), scope, 74)).toBe('');
  expect(mailReadNotice(planMailRead(scope, []), scope, 0)).toContain('첫 연결에서는');
});
