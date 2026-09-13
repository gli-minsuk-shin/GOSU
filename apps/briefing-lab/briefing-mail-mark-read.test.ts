import { expect, it, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn } from 'node:child_process';
import {
  APPLE_MAIL_MARK_READ,
  markOriginalMailRead,
  runMailMarkRead,
  readOriginalMailStatus,
} from './briefing-mail-mark-read';
import { appleMailMessageUrl } from './src/apple-mail-url';
const mailbox = { accountId: 'native-account', path: ['Inbox'] },
  url = appleMailMessageUrl('original@example.test')!;
const itemId = createHash('sha256')
  .update(JSON.stringify([mailbox.accountId, mailbox.path, '42']))
  .digest('hex');
it('locates a legacy message using bounded native IDs without two mailbox-wide whose searches', () => {
  const message = { id: () => 42, exists: () => true, messageId: () => 'original@example.test' };
  const messages = Object.assign([() => message], {
    whose: () => {
      throw Error('Unbounded mailbox search');
    },
  });
  const box = { name: () => 'Inbox', mailboxes: () => [], messages };
  const run = runInNewContext(`${APPLE_MAIL_MARK_READ}\nrun`, {
    Application: () => ({
      accounts: () => [{ id: () => mailbox.accountId, mailboxes: () => [box] }],
    }),
  });
  expect(
    JSON.parse(
      run([
        JSON.stringify({
          ...mailbox,
          action: 'locate',
          messageId: 'original@example.test',
          itemId,
        }),
      ]),
    ),
  ).toMatchObject({ ids: ['42'] });
});
it('confirms through a fresh native reference after delayed read state, without repeating the write', () => {
  let marked = false,
    reads = 0;
  const writes = vi.fn();
  const resolve = () => {
    const stale = reads++ < 2;
    const message = { id: () => 42, exists: () => true, messageId: () => 'original@example.test' };
    Object.defineProperty(message, 'readStatus', {
      get: () => () => (stale ? false : marked),
      set: (value: boolean) => {
        marked = value;
        writes(value);
      },
    });
    return message;
  };
  const box = { name: () => 'Inbox', mailboxes: () => [], messages: { byId: resolve } };
  const run = runInNewContext(`${APPLE_MAIL_MARK_READ}\nrun`, {
    Application: () => ({
      accounts: () => [{ id: () => mailbox.accountId, mailboxes: () => [box] }],
    }),
    ObjC: { import: () => undefined },
    $: { NSThread: { sleepForTimeInterval: () => undefined } },
  });
  expect(
    JSON.parse(
      run([
        JSON.stringify({
          ...mailbox,
          action: 'mark-read',
          nativeId: '42',
          messageId: 'original@example.test',
        }),
      ]),
    ),
  ).toMatchObject({ status: 'read', id: '42' });
  expect(writes).toHaveBeenCalledExactlyOnceWith(true);
});
afterEach(() => vi.useRealTimers());
it('uses a stored native-ID hint only after exact fingerprint verification and never scans the mailbox', async () => {
  const run = vi.fn<typeof runMailMarkRead>().mockResolvedValue({ status: 'read', id: '42' });
  const guard = vi.fn(async () => undefined);
  await expect(
    markOriginalMailRead(mailbox, itemId, url, new AbortController().signal, guard, run, '42'),
  ).resolves.toMatchObject({ status: 'read' });
  expect(run.mock.calls.map(([q]) => q.action)).toEqual(['mark-read']);
  run.mockClear();
  await expect(
    markOriginalMailRead(mailbox, itemId, url, new AbortController().signal, guard, run, '41'),
  ).rejects.toThrow('target_missing');
  expect(run).not.toHaveBeenCalled();
});
it('reconciles a lost write acknowledgment with one read-only check, never repeating the setter', async () => {
  const run = vi
    .fn<typeof runMailMarkRead>()
    .mockResolvedValueOnce({ ids: ['42'] })
    .mockRejectedValueOnce(Error('mail_mark_unconfirmed'))
    .mockResolvedValueOnce({ status: 'read', id: '42' });
  await expect(
    markOriginalMailRead(
      mailbox,
      itemId,
      url,
      new AbortController().signal,
      async () => undefined,
      run,
    ),
  ).resolves.toMatchObject({ status: 'read' });
  expect(run.mock.calls.map(([q]) => q.action)).toEqual(['locate', 'mark-read', 'read-status']);
});
it('never reports success for an unread or still-unverifiable flag and does not rewrite during reconciliation', async () => {
  for (const outcome of ['unread', 'missing'] as const) {
    const run = vi
      .fn<typeof runMailMarkRead>()
      .mockRejectedValueOnce(Error('mail_mark_unconfirmed'));
    if (outcome === 'unread') run.mockResolvedValueOnce({ status: 'unread', id: '42' });
    else run.mockRejectedValueOnce(Error('mail_mark_unconfirmed'));
    await expect(
      markOriginalMailRead(
        mailbox,
        itemId,
        url,
        new AbortController().signal,
        async () => undefined,
        run,
        '42',
      ),
    ).rejects.toThrow(outcome === 'unread' ? 'mail_mark_not_applied' : 'mail_mark_unconfirmed');
    expect(run.mock.calls.map(([q]) => q.action)).toEqual(['mark-read', 'read-status']);
  }
});
it('status-only recovery has no mark action and preserves the exact target guard', async () => {
  const run = vi.fn<typeof runMailMarkRead>().mockResolvedValue({ status: 'unread', id: '42' });
  expect(
    await readOriginalMailStatus(
      mailbox,
      itemId,
      url,
      new AbortController().signal,
      async () => undefined,
      run,
      '42',
    ),
  ).toEqual({ status: 'unread' });
  expect(run.mock.calls.map(([q]) => q.action)).toEqual(['read-status']);
});
it('locates within one mailbox and verifies the exact host item fingerprint before the single write', async () => {
  const run = vi
    .fn<typeof runMailMarkRead>()
    .mockResolvedValueOnce({ ids: ['41', '42', '42'] })
    .mockResolvedValueOnce({ status: 'read', id: '42' });
  const guard = vi.fn(async () => undefined);
  expect(
    await markOriginalMailRead(mailbox, itemId, url, new AbortController().signal, guard, run),
  ).toMatchObject({ status: 'read' });
  expect(run.mock.calls.map(([q]) => q.action)).toEqual(['locate', 'mark-read']);
  expect(run.mock.calls[1]?.[0]).toMatchObject({
    ...mailbox,
    nativeId: '42',
    messageId: 'original@example.test',
  });
  expect(guard).toHaveBeenCalledTimes(3);
});
it('never writes a foreign native ID, missing target, cancelled operation or revoked profile', async () => {
  const run = vi.fn<typeof runMailMarkRead>().mockResolvedValue({ ids: ['41'] });
  await expect(
    markOriginalMailRead(
      mailbox,
      itemId,
      url,
      new AbortController().signal,
      async () => undefined,
      run,
    ),
  ).rejects.toThrow('mail_mark_target_missing');
  expect(run).toHaveBeenCalledOnce();
  run.mockClear().mockResolvedValue({ ids: ['42'] });
  const guard = vi
    .fn(async () => undefined)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('assistant_settings_changed'));
  await expect(
    markOriginalMailRead(mailbox, itemId, url, new AbortController().signal, guard, run),
  ).rejects.toThrow('settings_changed');
  expect(run).toHaveBeenCalledOnce();
  const c = new AbortController();
  run.mockClear().mockImplementation(async () => {
    c.abort();
    return { ids: ['42'] };
  });
  await expect(
    markOriginalMailRead(mailbox, itemId, url, c.signal, async () => undefined, run),
  ).rejects.toThrow('source_cancelled');
  expect(run).toHaveBeenCalledOnce();
});
it('fixed native script writes only readStatus and rechecks the RFC ID; repeated reads are idempotent', () => {
  let read = false,
    messageId = 'original@example.test';
  const writes = vi.fn();
  const message = { id: () => 42, exists: () => true, messageId: () => messageId };
  Object.defineProperty(message, 'readStatus', {
    get: () => () => read,
    set: (value: boolean) => {
      read = value;
      writes(value);
    },
  });
  const box = {
    name: () => 'Inbox',
    mailboxes: () => [],
    messages: {
      whose: () => () => [message],
      byId: (id: number) => {
        expect(id).toBe(42);
        return message;
      },
    },
  };
  const run = runInNewContext(`${APPLE_MAIL_MARK_READ}\nrun`, {
    Application: () => ({
      accounts: () => [{ id: () => mailbox.accountId, mailboxes: () => [box] }],
    }),
  }) as (args: string[]) => string;
  const input = { ...mailbox, action: 'mark-read', nativeId: '42', messageId };
  expect(JSON.parse(run([JSON.stringify(input)]))).toEqual({ status: 'read', id: '42' });
  run([JSON.stringify(input)]);
  expect(writes).toHaveBeenCalledExactlyOnceWith(true);
  read = false;
  expect(JSON.parse(run([JSON.stringify({ ...input, action: 'read-status' })]))).toEqual({
    status: 'unread',
    id: '42',
  });
  expect(writes).toHaveBeenCalledOnce();
  messageId = 'changed@example.test';
  expect(() => run([JSON.stringify(input)])).toThrow('mail_mark_target_missing');
  expect(writes).toHaveBeenCalledOnce();
  expect(APPLE_MAIL_MARK_READ).not.toMatch(
    /\.send\(|\.delete\(|\.move\(|\.content\(|\.activate\(|readStatus\s*=\s*false/,
  );
});
it('uses fixed script argv, bounds native work and treats unknown completion as uncertain without retry', async () => {
  vi.useFakeTimers();
  const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  const child = Object.assign(new EventEmitter(), { stdout, stderr, kill: vi.fn() });
  const run = vi.fn(() => child as unknown as ChildProcess);
  const promise = runMailMarkRead(
    { ...mailbox, action: 'mark-read', nativeId: '42', messageId: 'original@example.test' },
    new AbortController().signal,
    run as unknown as typeof spawn,
    'darwin',
  );
  const failed = expect(promise).rejects.toThrow('mail_mark_unconfirmed');
  await vi.advanceTimersByTimeAsync(15000);
  await failed;
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0]).toMatchObject([
    '/usr/bin/osascript',
    ['-l', 'JavaScript', '-e', APPLE_MAIL_MARK_READ, expect.any(String)],
    { shell: false },
  ]);
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
});
