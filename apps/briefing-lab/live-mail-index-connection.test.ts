import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import type { MailScope } from '@gosu/briefing-core';
import { AppleMailConnection, APPLE_MAIL_READER, type runAppleMail } from './live-mail';
import type { MailIndexReader } from './live-mail-index';

const now = Date.parse('2026-09-09T00:00:00Z');
const message = {
  id: '7',
  messageId: '<seven@example.test>',
  title: 'Subject',
  sender: 'Sender',
  date: '2026-09-08T00:00:00Z',
  unread: true,
  preview: '',
  bodyUnavailable: false,
};

async function fixture(readIndex: MailIndexReader) {
  const read = vi.fn<typeof runAppleMail>(async (input) =>
    input.action === 'accounts'
      ? { accounts: [{ id: 'raw-account', name: 'Account' }] }
      : input.action === 'mailboxes'
        ? { mailboxes: [{ path: ['All Mail'], name: 'All Mail' }] }
        : { messages: [message], scanned: 1, capped: false },
  );
  const mail = new AppleMailConnection(read, () => now, undefined, readIndex);
  const signal = new AbortController().signal;
  const account = (await mail.listAccounts(signal))[0]!;
  const box = (await mail.listMailboxes(account.id, signal))[0]!;
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
  mail.authorize('r', scope);
  return { read, mail, scope, signal };
}
const reads = (read: ReturnType<typeof vi.fn<typeof runAppleMail>>) =>
  read.mock.calls.map(([input]) => input).filter((input) => input.action === 'read');

describe('Mail index in the connection', () => {
  it("hands Mail's index ids to the reader for the approved window", async () => {
    const readIndex = vi.fn<MailIndexReader>(() => ({
      total: 1,
      messages: [{ id: '7', date: message.date }],
    }));
    const f = await fixture(readIndex);
    const result = await f.mail.collect('r', f.scope, f.signal);
    expect(readIndex).toHaveBeenCalledWith('raw-account', ['All Mail'], {
      after: now - 3 * 86400000,
      limit: 2000,
    });
    expect(reads(f.read)).toEqual([
      expect.objectContaining({ indexed: [{ id: '7', date: message.date }], indexedTotal: 1 }),
    ]);
    expect(result).not.toHaveProperty('warning');
  });

  it('reads the slow way with a Full Disk Access warning when the index cannot be opened', async () => {
    const f = await fixture(() => {
      throw new Error('mail_index_permission_required');
    });
    const result = await f.mail.collect('r', f.scope, f.signal);
    expect(reads(f.read)[0]).not.toHaveProperty('indexed');
    expect(result.items).toHaveLength(1);
    expect(result.warning).toContain('전체 디스크 접근 권한');
  });

  it('reads again without the index when Mail disagrees with it', async () => {
    const f = await fixture(() => ({ total: 1, messages: [{ id: '7', date: message.date }] }));
    f.read.mockRejectedValueOnce(new Error('mail_index_mismatch'));
    const result = await f.mail.collect('r', f.scope, f.signal);
    const [first, second] = reads(f.read);
    expect(first).toHaveProperty('indexed');
    expect(second).not.toHaveProperty('indexed');
    expect(result.items).toHaveLength(1);
    expect(result.warning).toContain('받은 시각이 Mail과 달라');
  });
});

// 2026-09-22 user decision: the saved days bound a briefing, not a search the user asks for.
describe('a search wider than the briefing window', () => {
  const old = { ...message, id: '9', date: '2025-11-02T00:00:00Z', title: 'Grant report' };
  const search = {
    query: 'grant',
    sender: '',
    subject: '',
    account: '',
    from: '2025-01-01T00:00:00.000Z',
    to: new Date(now + 60000).toISOString(),
  };
  it('asks the index for that window with the search words, and the reader for nothing older than asked', async () => {
    const readIndex = vi.fn<MailIndexReader>(() => ({
      total: 1,
      messages: [{ id: '9', date: old.date }],
    }));
    const f = await fixture(readIndex);
    f.read.mockImplementation(async (input) =>
      input.action === 'read' ? { messages: [old], scanned: 1, capped: false } : { done: true },
    );
    const result = await f.mail.collect('r', f.scope, f.signal, undefined, undefined, search);
    expect(readIndex).toHaveBeenCalledWith('raw-account', ['All Mail'], {
      after: Date.parse(search.from) - 1,
      from: Date.parse(search.from),
      before: Date.parse(search.to),
      limit: 2000,
      terms: { sender: [], subject: [], any: ['grant'] },
    });
    expect(reads(f.read)[0]).toMatchObject({
      since: new Date(Date.parse(search.from) - 1).toISOString(),
      indexed: [{ id: '9', date: old.date }],
    });
    // A mail from ten months ago is a valid answer although the briefing reads three days.
    expect(result.items.map((item) => item.title)).toEqual(['Grant report']);
  });
  it('does not make Mail scan the whole mailbox: without the index it says what is needed', async () => {
    const f = await fixture(() => {
      throw new Error('mail_index_permission_required');
    });
    await expect(
      f.mail.collect('r', f.scope, f.signal, undefined, undefined, search),
    ).rejects.toThrow('mail_search_index_required');
    expect(reads(f.read)).toHaveLength(0);
  });
  it('asks to narrow a search that matches more mail than one read may hold', async () => {
    const f = await fixture(() => ({ total: 2001, messages: [{ id: '9', date: old.date }] }));
    await expect(
      f.mail.collect('r', f.scope, f.signal, undefined, undefined, search),
    ).rejects.toThrow('mail_search_too_broad');
    expect(reads(f.read)).toHaveLength(0);
  });
  it('keeps a search inside the briefing window as it was: Mail answers when the index cannot', async () => {
    const f = await fixture(() => {
      throw new Error('mail_index_permission_required');
    });
    const recent = { ...search, from: new Date(now - 2 * 86400000).toISOString() };
    const result = await f.mail.collect('r', f.scope, f.signal, undefined, undefined, {
      ...recent,
      query: 'subject',
    });
    expect(reads(f.read)[0]).not.toHaveProperty('indexed');
    expect(reads(f.read)[0]).toMatchObject({ since: new Date(now - 3 * 86400000).toISOString() });
    expect(result.items).toHaveLength(1);
  });
});

describe('indexed ids in the Mail reader', () => {
  function run(indexed: { id: string; date: string }[], dates: Record<string, string | null>) {
    const byId = vi.fn((id: number) => ({
      id: () => id,
      dateReceived: () => {
        const date = dates[String(id)];
        if (!date) throw Error('message deleted');
        return new Date(date);
      },
      readStatus: () => false,
      subject: () => `Subject ${id}`,
      sender: () => 'Sender',
      messageId: () => `${id}@example.test`,
      content: () => '',
      source: () => '',
      mailAttachments: () => [],
    }));
    const whose = vi.fn(() => {
      throw Error('whose_forbidden');
    });
    const box = { name: () => 'All Mail', mailboxes: () => [], messages: { byId, whose } };
    const reader = runInNewContext(`${APPLE_MAIL_READER}; run`, {
      Application: () => ({ accounts: () => [{ id: () => 'a', mailboxes: () => [box] }] }),
      ObjC: { import: () => undefined },
      $: Object.assign((s: string) => ({ dataUsingEncoding: () => s }), {
        NSUTF8StringEncoding: 4,
        NSFileHandle: { fileHandleWithStandardOutput: { writeData: () => undefined } },
      }),
      Date,
    });
    const execute = () =>
      JSON.parse(
        reader([
          JSON.stringify({
            action: 'read',
            accountId: 'a',
            path: ['All Mail'],
            since: '2026-09-06T00:00:00Z',
            indexed,
            indexedTotal: indexed.length,
            scope: { limit: 10, subject: '', sender: '', unreadOnly: false, bodyPreview: false },
          }),
        ]),
      );
    return { execute, byId, whose };
  }

  it('reads indexed ids without a whose query, skipping a message deleted since the index was read', () => {
    const { execute, byId, whose } = run(
      [
        { id: '9', date: '2026-09-08T12:00:00.000Z' },
        { id: '8', date: '2026-09-08T11:00:00.000Z' },
        { id: '7', date: '2026-09-08T10:00:00.000Z' },
      ],
      { '9': '2026-09-08T12:00:00Z', '8': null, '7': '2026-09-08T10:00:00Z' },
    );
    const result = execute();
    expect(result.messages.map((m: { id: string }) => m.id)).toEqual(['9', '7']);
    expect(whose).not.toHaveBeenCalled();
    expect(byId).toHaveBeenCalledWith(9);
    expect(result.coverage).toMatchObject({ ordered: true, stoppedBy: 'floor' });
  });

  it('refuses the index when a received time disagrees with Mail', () => {
    const { execute } = run([{ id: '9', date: '2026-09-08T12:00:00.000Z' }], {
      '9': '2026-09-08T15:00:00Z',
    });
    expect(execute).toThrow('mail_index_mismatch');
  });
});
