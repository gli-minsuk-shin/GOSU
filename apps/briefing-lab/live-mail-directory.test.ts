import { describe, expect, it, vi } from 'vitest';
import { AppleMailConnection, type runAppleMail } from './live-mail';
import type { MailDirectory, MailDirectoryEntry } from './mail-directory-store';
import type { MailScope } from '@gosu/briefing-core';

const now = Date.parse('2026-09-21T06:00:00Z');
const signal = new AbortController().signal;

function memoryDirectory(initial: MailDirectoryEntry[] = []) {
  const state = { entries: structuredClone(initial), saves: 0 };
  const directory: MailDirectory = {
    load: async () => structuredClone(state.entries),
    save: async (entries) => {
      state.entries = structuredClone(entries);
      state.saves++;
    },
  };
  return { state, directory };
}
function reader(options: { mailboxes?: string[][]; readError?: string } = {}) {
  return vi.fn<typeof runAppleMail>(async (input) => {
    if (input.action === 'discover')
      return {
        accounts: [
          {
            id: 'raw-account',
            name: 'Work',
            addresses: ['me@example.test'],
            mailboxes: (options.mailboxes ?? [['INBOX']]).map((path) => ({
              path,
              name: path.join(' / '),
            })),
            limited: false,
            unavailable: false,
          },
        ],
        limited: false,
      };
    if (input.action !== 'read') throw new Error('unexpected_action');
    if (options.readError) throw new Error(options.readError);
    return {
      account: { id: input.accountId, name: 'Work', addresses: ['me@example.test'] },
      messages: [
        {
          id: '1',
          title: 'Subject',
          sender: 'Sender',
          date: '2026-09-21T05:00:00Z',
          unread: true,
          preview: '',
          bodyUnavailable: false,
        },
      ],
      scanned: 1,
      capped: false,
    };
  });
}
const connect = (read: ReturnType<typeof reader>, directory: MailDirectory | null) =>
  new AppleMailConnection(read, () => now, undefined, null, directory);
async function approvedScope(directory: MailDirectory) {
  const first = connect(reader(), directory);
  const found = await first.discover(signal);
  const scope: MailScope = {
    accountId: found.accounts[0]!.id,
    mailboxId: found.accounts[0]!.mailboxes[0]!.id,
    days: 3,
    limit: 10,
    subject: '',
    sender: '',
    unreadOnly: false,
    bodyPreview: false,
  };
  await first.restorePolicyGrant('routine', scope, signal);
  return scope;
}

describe('Apple Mail mailbox locations across restarts', () => {
  it('reads the approved mailbox after a restart without asking Mail for every mailbox again', async () => {
    const { state, directory } = memoryDirectory();
    const scope = await approvedScope(directory);
    expect(state.entries).toEqual([{ accountId: 'raw-account', path: ['INBOX'] }]);

    const read = reader();
    const restarted = connect(read, directory);
    await restarted.restorePolicyGrant('routine', scope, signal);
    const result = await restarted.collect('routine', scope, signal);

    expect(result.items).toHaveLength(1);
    expect(read.mock.calls.map(([input]) => input.action)).toEqual(['read']);
    expect(read.mock.calls[0]![0]).toMatchObject({ accountId: 'raw-account', path: ['INBOX'] });
  });

  it('saves the location once, not at every briefing', async () => {
    const { state, directory } = memoryDirectory();
    const scope = await approvedScope(directory);
    const restarted = connect(reader(), directory);
    await restarted.restorePolicyGrant('routine', scope, signal);
    await restarted.restorePolicyGrant('routine', scope, signal);
    expect(state.saves).toBe(1);
  });

  it('asks Mail again when the saved entry is for another mailbox than the approved one', async () => {
    const { directory } = memoryDirectory();
    const scope = await approvedScope(directory);
    const other = memoryDirectory([{ accountId: 'raw-account', path: ['Archive'] }]);
    const read = reader();
    const restarted = connect(read, other.directory);
    await restarted.restorePolicyGrant('routine', scope, signal);
    expect(read.mock.calls.map(([input]) => input.action)).toEqual(['discover']);
    expect(other.state.entries).toContainEqual({ accountId: 'raw-account', path: ['INBOX'] });
  });

  it('asks Mail again when the saved locations cannot be read', async () => {
    const scope = await approvedScope(memoryDirectory().directory);
    const read = reader();
    const restarted = connect(read, {
      load: async () => {
        throw new Error('briefing_memory_unreadable');
      },
      save: async () => undefined,
    });
    await restarted.restorePolicyGrant('routine', scope, signal);
    await expect(restarted.collect('routine', scope, signal)).resolves.toMatchObject({
      items: [expect.objectContaining({ kind: 'email' })],
    });
    expect(read.mock.calls.map(([input]) => input.action)).toEqual(['discover', 'read']);
  });

  it('reports a changed mailbox, and forgets it, when Mail no longer has the saved location', async () => {
    const { state, directory } = memoryDirectory();
    const scope = await approvedScope(directory);
    const read = reader({ mailboxes: [['Renamed']], readError: 'mail_mailbox_missing' });
    const restarted = connect(read, directory);
    await restarted.restorePolicyGrant('routine', scope, signal);
    await expect(restarted.collect('routine', scope, signal)).rejects.toThrow(
      'mail_account_refresh_required',
    );
    expect(read.mock.calls.map(([input]) => input.action)).toEqual(['read', 'discover']);
    expect(state.entries).toEqual([]);
  });

  it('keeps the read failure when Mail confirms the saved location', async () => {
    const { state, directory } = memoryDirectory();
    const scope = await approvedScope(directory);
    const read = reader({ readError: 'mail_mailbox_missing' });
    const restarted = connect(read, directory);
    await restarted.restorePolicyGrant('routine', scope, signal);
    await expect(restarted.collect('routine', scope, signal)).rejects.toThrow('mail_unavailable');
    expect(state.entries).toEqual([{ accountId: 'raw-account', path: ['INBOX'] }]);
  });
});
