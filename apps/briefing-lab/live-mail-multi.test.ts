import { expect, it, vi } from 'vitest';
import { mailTargets, type MailScope } from '@gosu/briefing-core';
import { AppleMailConnection, type runAppleMail } from './live-mail';
const now = Date.parse('2026-09-10T09:00:00Z');
async function fixture() {
  const read = vi.fn<typeof runAppleMail>(async (q) => {
    if (q.action === 'discover')
      return {
        limited: false,
        accounts: ['a', 'b'].map((id) => ({
          id,
          name: `Account ${id}`,
          limited: false,
          unavailable: false,
          mailboxes: [{ path: ['Inbox'], name: 'Inbox' }],
        })),
      };
    if (q.action !== 'read') throw Error('Unexpected action');
    return {
      account: {
        id: q.accountId,
        name: `Account ${q.accountId}`,
        addresses: [`${q.accountId}@example.test`],
      },
      messages: [
        {
          id: '1',
          title: 'Same subject',
          sender: 'Sender',
          date: new Date(now - (q.accountId === 'b' ? 1000 : 2000)).toISOString(),
          unread: true,
          preview: 'Private preview',
          bodyUnavailable: false,
        },
      ],
      scanned: 1,
      capped: false,
    };
  });
  const mail = new AppleMailConnection(read, () => now);
  const signal = new AbortController().signal;
  const catalog = await mail.discover(signal);
  const targets = catalog.accounts.map((a) => ({ accountId: a.id, mailboxId: a.mailboxes[0]!.id }));
  const scope: MailScope = {
    ...targets[0]!,
    additionalAccounts: targets.slice(1),
    days: 3,
    limit: 10,
    subject: '',
    sender: '',
    unreadOnly: true,
    bodyPreview: false,
  };
  mail.authorize('r', scope);
  return { mail, read, signal, scope };
}
it('reads exactly two selected mailboxes, preserves attribution and a global received-time limit', async () => {
  const f = await fixture();
  const result = await f.mail.collect('r', f.scope, f.signal);
  expect(result.items.map((i) => i.mailAccount?.addresses[0])).toEqual([
    'b@example.test',
    'a@example.test',
  ]);
  expect(new Set(result.items.map((i) => i.id)).size).toBe(2);
  expect(
    result.items.every((i) => i.readScope === 'mail-metadata' && !i.text.includes('Private')),
  ).toBe(true);
  expect(
    f.read.mock.calls
      .filter(([q]) => q.action === 'read')
      .map(([q]) => q.action === 'read' && q.accountId),
  ).toEqual(['a', 'b']);
  const capped = { ...f.scope, limit: 1 };
  f.mail.authorize('r', capped);
  expect((await f.mail.collect('r', capped, f.signal)).items).toHaveLength(1);
});
it('summarizes one verified cross-account delivery group while preserving both recipients', async () => {
  const f = await fixture();
  f.read.mockImplementation(async (q) => {
    if (q.action !== 'read') throw Error('unexpected');
    return {
      messages: [
        {
          id: '1',
          title: 'Same subject',
          sender: 'Sender',
          date: new Date(now - 1000).toISOString(),
          unread: true,
          preview: 'Identical body',
          bodyUnavailable: false,
          contentProof: {
            version: 1,
            digest: 'a'.repeat(64),
            previewDigest: 'b'.repeat(64),
            length: 100,
          },
        },
      ],
      scanned: 1,
      capped: false,
    };
  });
  const scope = { ...f.scope, bodyPreview: true };
  f.mail.authorize('r', scope);
  const result = await f.mail.collect('r', scope, f.signal);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]!.mailCopies).toHaveLength(2);
});
it.each([50, 100])(
  'allocates the global native read budget %i before fetching bodies, including explicit chat/refresh reads',
  async (limit) => {
    const f = await fixture();
    const scope = { ...f.scope, limit };
    f.mail.authorize('r', scope);
    const result = await f.mail.collect('r', scope, f.signal);
    const limits = f.read.mock.calls.flatMap(([q]) => (q.action === 'read' ? [q.scope.limit] : []));
    expect(limits).toEqual([limit / 2, limit / 2]);
    expect(limits.reduce((n, count) => n + count, 0)).toBe(limit);
    expect(result.notice).toBeUndefined();
  },
);
it('keeps successful accounts on a source timeout but fails closed on a scope/integrity error', async () => {
  const f = await fixture();
  f.read.mockRejectedValueOnce(Error('mail_timeout_metadata'));
  const result = await f.mail.collect('r', f.scope, f.signal);
  expect(result.items).toHaveLength(1);
  expect(result.note).toContain('1개 계정 조회 실패');
  f.read.mockRejectedValueOnce(Error('mail_scope_response_invalid'));
  await expect(f.mail.collect('r', f.scope, f.signal)).rejects.toThrow(
    'mail_scope_response_invalid',
  );
});
it('requires the entire exact approved selection and rejects cross-account mailbox IDs', async () => {
  const f = await fixture();
  await expect(
    f.mail.collect('r', { ...f.scope, additionalAccounts: [] }, f.signal),
  ).rejects.toThrow('mail_scope_required');
  const targets = mailTargets(f.scope);
  expect(() =>
    f.mail.authorize('r', {
      ...f.scope,
      additionalAccounts: [{ ...targets[1]!, mailboxId: targets[0]!.mailboxId }],
    }),
  ).toThrow('mail_account_refresh_required');
});
it('revocation cancels every account read and discards all late results', async () => {
  const f = await fixture();
  const signals: AbortSignal[] = [];
  const complete: (() => void)[] = [];
  f.read.mockImplementation(
    (_q, signal) =>
      new Promise((resolve) => {
        signals.push(signal);
        complete.push(() => resolve({ messages: [], scanned: 0, capped: false }));
      }),
  );
  const pending = f.mail.collect('r', f.scope, f.signal);
  expect(signals).toHaveLength(2);
  f.mail.revoke('r');
  expect(signals.every((s) => s.aborted)).toBe(true);
  complete.forEach((done) => done());
  await expect(pending).rejects.toThrow(/source_cancelled|mail_scope_required/);
});
