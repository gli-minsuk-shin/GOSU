import { expect, it, vi } from 'vitest';
import { AppleMailConnection, type runAppleMail } from './live-mail';
import { resolveMailSearch } from './briefing-mail-search';
const now = Date.parse('2026-09-10T12:00:00Z');
async function fixture() {
  const read = vi.fn<typeof runAppleMail>().mockImplementation(async (q) => {
    if (q.action === 'discover')
      return {
        limited: false,
        accounts: ['work', 'personal'].map((id) => ({
          id,
          name: 'Google',
          addresses: [`${id}@example.test`],
          limited: false,
          unavailable: false,
          mailboxes: [{ name: 'All Mail', path: ['All Mail'] }],
        })),
      };
    if (q.action !== 'read') throw new Error('unexpected action');
    return {
      account: { id: q.accountId, name: 'Google', addresses: [`${q.accountId}@example.test`] },
      messages: [
        {
          id: '501',
          title: 'New articles',
          sender: 'Google Scholar <scholaralerts-noreply@google.com>',
          date: '2026-09-08T01:00:00.000Z',
          unread: false,
          preview: '',
          bodyUnavailable: false,
        },
      ],
      scanned: 1,
      capped: false,
    };
  });
  const mail = new AppleMailConnection(read, () => now),
    signal = new AbortController().signal;
  const accounts = (await mail.discover(signal)).accounts;
  const scope = {
    accountId: accounts[0]!.id,
    mailboxId: accounts[0]!.mailboxes[0]!.id,
    additionalAccounts: [{ accountId: accounts[1]!.id, mailboxId: accounts[1]!.mailboxes[0]!.id }],
    days: 10,
    limit: 50,
    sender: '',
    subject: '',
    unreadOnly: false,
    bodyPreview: false,
  };
  mail.authorize('r', scope);
  const search = resolveMailSearch(
    {
      query: 'Google Scholar',
      account: 'personal@example.test',
      from: '2026-09-08',
      to: '2026-09-09',
    },
    scope,
    'Asia/Seoul',
    now,
  )!;
  return { mail, read, scope, signal, search };
}
it('narrows to the requested receiving address despite identical account names, applies query before limits and uses no briefing exclusions/onboarding', async () => {
  const f = await fixture();
  const result = await f.mail.collect('r', f.scope, f.signal, undefined, undefined, f.search);
  const requests = f.read.mock.calls.flatMap(([q]) => (q.action === 'read' ? [q] : []));
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    accountId: 'personal',
    search: f.search,
    scope: { limit: 50, bodyPreview: false },
  });
  expect(requests[0]?.excludeKeys).toBeUndefined();
  expect(result.items[0]).toMatchObject({
    readScope: 'mail-metadata',
    mailAccount: { addresses: ['personal@example.test'] },
  });
  expect(result.note).not.toContain('메일함 앞부분');
});
it('does not substitute another account when the requested account is not connected', async () => {
  const f = await fixture();
  await expect(
    f.mail.collect('r', f.scope, f.signal, undefined, undefined, {
      ...f.search,
      account: 'unconnected@example.test',
    }),
  ).rejects.toThrow('mail_search_account_not_connected');
  expect(f.read.mock.calls.filter(([q]) => q.action === 'read')).toHaveLength(0);
});
it.each(['date', 'sender', 'unread'] as const)(
  'rejects native results outside the narrowed %s scope',
  async (kind) => {
    const f = await fixture();
    const search = kind === 'sender' ? { ...f.search, sender: 'approved sender' } : f.search;
    const scope = { ...f.scope, unreadOnly: kind === 'unread' };
    f.mail.authorize('r', scope);
    if (kind === 'date')
      f.read.mockResolvedValueOnce({
        messages: [
          {
            id: '1',
            title: 'New',
            sender: 'Google Scholar',
            date: '2026-09-09T01:00:00.000Z',
            unread: false,
            preview: '',
            bodyUnavailable: false,
          },
        ],
        scanned: 1,
        capped: false,
      });
    await expect(
      f.mail.collect('r', scope, f.signal, undefined, undefined, search),
    ).rejects.toThrow('mail_scope_response_invalid');
  },
);
it('propagates revocation to a targeted lookup and discards its late result', async () => {
  const f = await fixture();
  let finish: (value: unknown) => void = () => undefined;
  let requestSignal: AbortSignal | undefined;
  f.read.mockImplementationOnce(async (_q, signal) => {
    requestSignal = signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = f.mail.collect('r', f.scope, f.signal, undefined, undefined, f.search);
  f.mail.revoke('r');
  expect(requestSignal?.aborted).toBe(true);
  finish({ messages: [], scanned: 0, capped: false });
  await expect(pending).rejects.toThrow('source_cancelled');
});
