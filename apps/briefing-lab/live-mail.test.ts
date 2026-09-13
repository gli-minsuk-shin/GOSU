import { describe, it, expect, vi } from 'vitest';
import { AppleMailConnection, APPLE_MAIL_READER, type runAppleMail } from './live-mail';
import type { MailScope } from '@gosu/briefing-core';
const now = Date.parse('2026-09-09T00:00:00Z');
async function fixture() {
  const read = vi.fn<typeof runAppleMail>(async (input) =>
    input.action === 'accounts'
      ? { accounts: [{ id: 'raw-account', name: 'Account' }] }
      : input.action === 'mailboxes'
        ? { mailboxes: [{ path: ['INBOX'], name: 'INBOX' }] }
        : {
            account: {
              id: input.action === 'read' ? input.accountId : 'raw-account',
              name: 'Work account',
              addresses: ['work@example.test'],
            },
            messages: [
              {
                id: '1',
                messageId: '<original-message@example.test>',
                title: 'A private title',
                sender: 'Sender',
                date: '2026-09-08T00:00:00Z',
                unread: true,
                preview: 'Private body',
                bodyUnavailable: false,
              },
            ],
            scanned: 1,
            capped: false,
          },
  );
  let time = now;
  const mail = new AppleMailConnection(read, () => time),
    signal = new AbortController().signal;
  const account = (await mail.listAccounts(signal))[0]!,
    box = (await mail.listMailboxes(account.id, signal))[0]!;
  const scope: MailScope = {
    accountId: account.id,
    mailboxId: box.id,
    days: 3,
    limit: 10,
    subject: '',
    sender: '',
    unreadOnly: false,
    bodyPreview: false,
  };
  return {
    read,
    mail,
    scope,
    signal,
    expire: () => {
      time += 31 * 60000;
    },
  };
}
describe('Apple Mail read-only scope', () => {
  it.each([true, false])(
    'exposes the exact native unread flag %s without writing Mail state',
    async (unread) => {
      const f = await fixture();
      f.mail.authorize('r', f.scope);
      f.read.mockResolvedValueOnce({
        messages: [
          {
            id: '1',
            title: 'Notice',
            sender: 'Sender',
            date: '2026-09-08T00:00:00Z',
            unread,
            preview: '',
            bodyUnavailable: false,
          },
        ],
        scanned: 1,
        capped: false,
      });
      const result = await f.mail.collect('r', f.scope, f.signal);
      expect(result.items[0]).toMatchObject({ mailUnread: unread });
      expect(f.read.mock.calls.at(-1)?.[0].action).toBe('read');
      expect(APPLE_MAIL_READER).not.toMatch(/readStatus\s*=/);
    },
  );
  it('rejects receiving-account metadata from outside the selected account', async () => {
    const f = await fixture();
    f.mail.authorize('r', f.scope);
    f.read.mockResolvedValueOnce({
      account: { id: 'different-account', name: 'Other', addresses: ['other@example.test'] },
      messages: [],
      scanned: 0,
      capped: false,
    });
    await expect(f.mail.collect('r', f.scope, f.signal)).rejects.toThrow('scope_response_invalid');
  });
  it('keeps identical message IDs/titles separate across two identically named receiving accounts', async () => {
    const read = vi.fn<typeof runAppleMail>(async (input) => {
      if (input.action === 'accounts')
        return {
          accounts: [
            { id: 'work', name: 'Google' },
            { id: 'personal', name: 'Google' },
          ],
        };
      if (input.action === 'mailboxes') return { mailboxes: [{ path: ['INBOX'], name: 'INBOX' }] };
      if (input.action !== 'read') throw new Error('Unexpected action');
      return {
        account: {
          id: input.accountId,
          name: 'Google',
          addresses: [`${input.accountId}@example.test`],
        },
        messages: [
          {
            id: '1',
            title: 'Same subject',
            sender: 'Sender',
            date: '2026-09-08T00:00:00Z',
            unread: true,
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
    const accounts = await mail.listAccounts(signal),
      items = [];
    for (const account of accounts) {
      const box = (await mail.listMailboxes(account.id, signal))[0]!;
      const scope = {
        accountId: account.id,
        mailboxId: box.id,
        days: 3,
        limit: 10,
        subject: '',
        sender: '',
        unreadOnly: false,
        bodyPreview: false,
      };
      mail.authorize('r', scope);
      items.push((await mail.collect('r', scope, signal)).items[0]!);
    }
    expect(items[0]!.id).not.toBe(items[1]!.id);
    expect(items.map((i) => i.mailAccount!.addresses[0])).toEqual([
      'work@example.test',
      'personal@example.test',
    ]);
    expect(items.map((i) => i.publishedAt)).toEqual([
      '2026-09-08T00:00:00Z',
      '2026-09-08T00:00:00Z',
    ]);
  });
  it('attaches an encoded original-message link even when only metadata was approved', async () => {
    const f = await fixture();
    f.mail.authorize('r', f.scope);
    const result = await f.mail.collect('r', f.scope, f.signal);
    expect(result.items[0]!.mailMessageUrl).toBe('message://%3Coriginal-message%40example.test%3E');
    expect(result.items[0]!.mailNativeId).toBe('1');
    expect(result.items[0]!.readScope).toBe('mail-metadata');
    expect(result.items[0]!.mailAccount).toEqual({
      id: f.scope.accountId,
      name: 'Work account',
      addresses: ['work@example.test'],
    });
    expect(result.items[0]!.publishedAt).toBe('2026-09-08T00:00:00Z');
    expect(result.items[0]!.text).not.toContain('Private body');
    expect(APPLE_MAIL_READER).toContain('ref.messageId()');
    expect(APPLE_MAIL_READER.indexOf('var result=snapshot()')).toBeLessThan(
      APPLE_MAIL_READER.indexOf('ref.messageId()'),
    );
    expect(APPLE_MAIL_READER.indexOf("emit({type:'checkpoint',result:snapshot()})")).toBeLessThan(
      APPLE_MAIL_READER.indexOf('ref.messageId()'),
    );
  });
  it('discovers accounts and their mailboxes in one metadata-only call, without authorizing messages', async () => {
    const read = vi.fn<typeof runAppleMail>(async () => ({
      accounts: [
        {
          id: 'raw-a',
          name: 'Research',
          mailboxes: [{ path: ['INBOX'], name: 'INBOX' }],
          limited: false,
          unavailable: false,
        },
        {
          id: 'raw-b',
          name: 'Unavailable account',
          mailboxes: [],
          limited: false,
          unavailable: true,
        },
      ],
      limited: false,
    }));
    const mail = new AppleMailConnection(read, () => now);
    const data = await mail.discover(new AbortController().signal);
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]![0]).toEqual({ action: 'discover' });
    expect(data.accounts[0]!.mailboxes).toHaveLength(1);
    expect(data.accounts[1]!.unavailable).toBe(true);
    expect(data.accounts[0]!.id).not.toBe('raw-a');
    const scope = {
      accountId: data.accounts[0]!.id,
      mailboxId: data.accounts[0]!.mailboxes[0]!.id,
      days: 3,
      limit: 10,
      subject: '',
      sender: '',
      unreadOnly: false,
      bodyPreview: false,
    };
    expect(mail.status('r', scope).state).toBe('disconnected');
    const grant = mail.authorize('r', scope);
    expect(mail.status('r', scope)).toMatchObject({
      state: 'connected',
      expiresAt: grant.expiresAt,
      accountName: 'Research',
      mailboxName: 'INBOX',
    });
    expect(read).toHaveBeenCalledOnce();
  });
  it('reports grant changes, expiry and revocation without reading Apple Mail', async () => {
    const f = await fixture();
    f.mail.authorize('r', f.scope);
    f.read.mockClear();
    expect(f.mail.status('r', f.scope).state).toBe('connected');
    expect(f.mail.status('another', f.scope).state).toBe('disconnected');
    expect(f.mail.status('r', { ...f.scope, bodyPreview: true }).state).toBe('scope-changed');
    f.expire();
    expect(f.mail.status('r', f.scope).state).toBe('expired');
    f.mail.revoke('r');
    expect(f.mail.status('r', f.scope).state).toBe('disconnected');
    expect(f.read).not.toHaveBeenCalled();
  });
  it('revocation cancels an in-flight read and suppresses its late result', async () => {
    const f = await fixture();
    f.mail.authorize('r', f.scope);
    let finish!: (value: unknown) => void;
    f.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.mail.collect('r', f.scope, f.signal);
    f.mail.revoke('r');
    finish({ messages: [], scanned: 0, capped: false });
    await expect(pending).rejects.toThrow('source_cancelled');
  });
  it('requires an exact per-routine grant and returns metadata only by default', async () => {
    const f = await fixture();
    expect(f.scope.accountId).not.toBe('raw-account');
    await expect(f.mail.collect('r', f.scope, f.signal)).rejects.toThrow('scope_required');
    f.mail.authorize('r', f.scope);
    const result = await f.mail.collect('r', f.scope, f.signal);
    expect(JSON.stringify(result)).not.toContain('Private body');
    expect(result.items[0]!.readScope).toBe('mail-metadata');
    await expect(f.mail.collect('another', f.scope, f.signal)).rejects.toThrow('scope_required');
    await expect(f.mail.collect('r', { ...f.scope, days: 30 }, f.signal)).rejects.toThrow(
      'scope_required',
    );
    f.mail.revoke('r');
    await expect(f.mail.collect('r', f.scope, f.signal)).rejects.toThrow('scope_required');
  });
  it('allows opted-in preview and rejects expired permissions', async () => {
    const f = await fixture();
    const scope = { ...f.scope, bodyPreview: true };
    f.mail.authorize('r', scope);
    expect((await f.mail.collect('r', scope, f.signal)).items[0]!.text).toBe('Private body');
    f.expire();
    await expect(f.mail.collect('r', scope, f.signal)).rejects.toThrow('scope_required');
  });
  it('preserves completed metadata when a preview stalls and labels its actual reading scope', async () => {
    const f = await fixture(),
      scope = { ...f.scope, bodyPreview: true };
    f.mail.authorize('r', scope);
    f.read.mockResolvedValueOnce({
      messages: [
        {
          id: '1',
          title: 'Metadata',
          sender: 'Sender',
          date: '2026-09-08T00:00:00Z',
          unread: true,
          preview: '',
          bodyUnavailable: true,
        },
      ],
      scanned: 1,
      capped: true,
      partial: true,
    });
    const result = await f.mail.collect('r', scope, f.signal);
    expect(result.items[0]?.readScope).toBe('mail-metadata');
    expect(result.note).toContain('확보한 목록');
    expect(result.items[0]?.details.join(' ')).toContain('제목·발신자만');
  });
  it('rejects cross-account mailbox combinations and outside-scope response metadata', async () => {
    const f = await fixture();
    expect(() => f.mail.authorize('r', { ...f.scope, accountId: 'other' })).toThrow();
    const scope = { ...f.scope, subject: 'different subject' };
    f.mail.authorize('r', scope);
    await expect(f.mail.collect('r', scope, f.signal)).rejects.toThrow('scope_response_invalid');
  });
  it('uses fixed argv data, never sending, deleting, opening attachments or setting read status', () => {
    expect(APPLE_MAIL_READER).toContain('JSON.parse(argv[0])');
    expect(APPLE_MAIL_READER).toContain('if(q.scope.bodyPreview)');
    expect(APPLE_MAIL_READER).not.toMatch(
      /\.send\(|\.delete\(|\.move\(|readStatus\s*=|doShellScript|\.attachments\(/,
    );
  });
});
