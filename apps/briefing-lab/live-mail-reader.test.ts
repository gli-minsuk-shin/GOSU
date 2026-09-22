import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  APPLE_MAIL_METADATA_BUDGET_MS,
  APPLE_MAIL_READ_TIMEOUT_MS,
  APPLE_MAIL_READER,
  MailReadStream,
} from './live-mail';

function execute(bodyPreview: boolean) {
  const content = vi.fn(() => 'fixture body'),
    emitted: unknown[] = [];
  const message = (n: number) => ({
    id: () => n,
    dateReceived: () => new Date('2026-09-09T00:00:00Z'),
    readStatus: () => false,
    subject: () => 'Fixture subject',
    sender: () => 'Fixture sender',
    content,
    messageId: () => `<${n}@fixture.test>`,
    source: () => '',
    mailAttachments: () => [],
  });
  // Mail's own date-bounded query returns id-based references; indexing the mailbox is forbidden.
  const messages = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'whose') return () => () => Array.from({ length: 300 }, (_, n) => message(n));
        throw Error('unbounded_mailbox_access');
      },
    },
  );
  const box = { name: () => 'All Mail', mailboxes: () => [], messages };
  const account = { id: () => 'a', mailboxes: () => [box] };
  const dollar = Object.assign((value: string) => ({ dataUsingEncoding: () => value }), {
    NSUTF8StringEncoding: 4,
    NSFileHandle: {
      fileHandleWithStandardOutput: { writeData: (line: string) => emitted.push(JSON.parse(line)) },
    },
  });
  const sandbox = {
    Application: () => ({ accounts: () => [account] }),
    ObjC: { import: () => undefined },
    $: dollar,
    Date,
  };
  const run = runInNewContext(APPLE_MAIL_READER + ';run', sandbox);
  const result = JSON.parse(
    run([
      JSON.stringify({
        action: 'read',
        accountId: 'a',
        path: ['All Mail'],
        since: '2026-09-08T00:00:00Z',
        scope: { limit: 10, subject: '', sender: '', unreadOnly: false, bodyPreview },
      }),
    ]),
  );
  return { result, content, emitted };
}
function executeWithDates(dates: readonly string[], since: string) {
  const dateReceived = vi.fn();
  const whose = vi.fn();
  const message = (n: number) => ({
    id: () => n,
    dateReceived: () => {
      dateReceived(n);
      return new Date(dates[n]!);
    },
    readStatus: () => false,
    subject: () => 'Fixture subject',
    sender: () => 'Fixture sender',
    content: () => 'fixture body',
  });
  const messages = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key !== 'whose') throw Error('unbounded_mailbox_access');
        return (filter: { dateReceived: { _greaterThan: Date } }) => {
          whose(filter);
          // Mail's list order is not assumed: return matches in the fixture's own order.
          return () =>
            dates
              .map((date, n) => ({ date, n }))
              .filter(({ date }) => Date.parse(date) > filter.dateReceived._greaterThan.getTime())
              .map(({ n }) => message(n));
        };
      },
    },
  );
  const box = { name: () => 'All Mail', mailboxes: () => [], messages };
  const account = { id: () => 'a', mailboxes: () => [box] };
  const dollar = Object.assign((value: string) => ({ dataUsingEncoding: () => value }), {
    NSUTF8StringEncoding: 4,
    NSFileHandle: { fileHandleWithStandardOutput: { writeData: () => undefined } },
  });
  const run = runInNewContext(APPLE_MAIL_READER + ';run', {
    Application: () => ({ accounts: () => [account] }),
    ObjC: { import: () => undefined },
    $: dollar,
    Date,
  });
  const result = JSON.parse(
    run([
      JSON.stringify({
        action: 'read',
        accountId: 'a',
        path: ['All Mail'],
        since,
        scope: { limit: 100, subject: '', sender: '', unreadOnly: false, bodyPreview: false },
      }),
    ]),
  );
  return { result, dateReceived, whose };
}
it('asks Mail once for messages after the window and reads only the references it returns', () => {
  const dates = [
    '2026-09-15T10:00:00Z',
    '2026-09-14T10:00:00Z',
    '2026-09-10T10:00:00Z',
    ...Array.from({ length: 200 }, () => '2026-09-01T00:00:00Z'),
  ];
  const f = executeWithDates(dates, '2026-09-12T00:00:00Z');
  expect(f.whose).toHaveBeenCalledOnce();
  expect(f.result.messages.map((m: { id: string }) => m.id)).toEqual(['0', '1']);
  expect(f.result.scanned).toBe(2);
  // Received times are read only for the two returned references, never for older mail.
  expect(f.dateReceived).toHaveBeenCalledTimes(2);
  expect(f.result.capped).toBe(false);
  expect(f.result.coverage).toMatchObject({ floorReached: true, stoppedBy: 'floor' });

  const quiet = executeWithDates(
    ['2026-09-10T10:00:00Z', ...Array.from({ length: 200 }, () => '2026-09-01T00:00:00Z')],
    '2026-09-12T00:00:00Z',
  );
  expect(quiet.result.messages).toEqual([]);
  expect(quiet.result.scanned).toBe(0);
  expect(quiet.result.coverage).toMatchObject({ floorReached: true });
});
it('orders the returned references newest first even when Mail does not', () => {
  const dates = [
    '2026-09-10T10:00:00Z',
    '2026-09-14T10:00:00Z',
    '2026-09-11T10:00:00Z',
    '2026-09-15T10:00:00Z',
  ];
  const f = executeWithDates(dates, '2026-09-12T00:00:00Z');
  expect(f.result.messages.map((m: { id: string }) => m.id)).toEqual(['3', '1']);
  expect(f.result.scanned).toBe(2);
  expect(f.result.coverage).toMatchObject({ ordered: true, floorReached: true });
});
it('gives the metadata scan most of the process deadline without exceeding it', () => {
  expect(APPLE_MAIL_METADATA_BUDGET_MS).toBeGreaterThan(15_000);
  expect(APPLE_MAIL_METADATA_BUDGET_MS).toBeLessThan(APPLE_MAIL_READ_TIMEOUT_MS);
  expect(APPLE_MAIL_READER).toContain(`Date.now()-began>${APPLE_MAIL_METADATA_BUDGET_MS}`);
  expect(APPLE_MAIL_READER).not.toContain('began>15000');
});
it('never indexes the whole All Mail mailbox and stops at the result limit', () => {
  const f = execute(false);
  expect(f.result.messages).toHaveLength(10);
  // New messages past the limit are still counted for the next briefing, not loaded.
  expect(f.result.scanned).toBe(300);
  expect(f.result.coverage).toMatchObject({
    stoppedBy: 'limit',
    pending: 290,
    pendingComplete: true,
  });
  expect(f.result.capped).toBe(true);
  expect(f.content).not.toHaveBeenCalled();
});
it('checkpoints metadata before reading an opted-in body, keeping stalled previews recoverable', () => {
  const f = execute(true),
    progress = vi.fn(),
    stream = new MailReadStream(progress);
  for (const event of f.emitted) {
    if ((event as { type: string }).type === 'body') break;
    stream.accept(JSON.stringify(event));
  }
  expect(stream.partial()).toMatchObject({ partial: true });
  expect(stream.partial()?.messages).toHaveLength(10);
  expect(stream.partial()?.messages.every((m) => m.bodyUnavailable)).toBe(true);
  stream.accept(
    JSON.stringify({ type: 'body', id: '0', preview: 'completed body', bodyUnavailable: false }),
  );
  expect(stream.partial()?.messages[0]).toMatchObject({
    preview: 'completed body',
    bodyUnavailable: false,
  });
  expect(JSON.stringify(progress.mock.calls)).not.toContain('Fixture');
  expect(new MailReadStream().partial()).toBeNull();
});
it('tells the host when Mail has answered and reports every mailbox a discovery walks', () => {
  const emitted: unknown[] = [];
  const box = (name: string, children: unknown[] = []) => ({
    name: () => name,
    mailboxes: () => children,
  });
  const account = {
    id: () => 'a',
    name: () => 'Work',
    emailAddresses: () => ['me@example.test'],
    mailboxes: () => [box('INBOX'), box('Labels', [box('Private')])],
  };
  const dollar = Object.assign((value: string) => ({ dataUsingEncoding: () => value }), {
    NSUTF8StringEncoding: 4,
    NSFileHandle: {
      fileHandleWithStandardOutput: { writeData: (line: string) => emitted.push(JSON.parse(line)) },
    },
  });
  const run = runInNewContext(APPLE_MAIL_READER + ';run', {
    Application: () => ({ accounts: () => [account] }),
    ObjC: { import: () => undefined },
    $: dollar,
    Date,
  });
  const result = JSON.parse(run([JSON.stringify({ action: 'discover' })]));
  expect(result.accounts[0].mailboxes.map((b: { path: string[] }) => b.path)).toEqual([
    ['INBOX'],
    ['Labels'],
    ['Labels', 'Private'],
  ]);
  // The first line follows Mail's first answer; each later one is a mailbox Mail has answered for.
  expect(emitted).toEqual([
    { type: 'answered' },
    { type: 'progress', stage: 'mailbox', scanned: 1 },
    { type: 'progress', stage: 'mailbox', scanned: 2 },
    { type: 'progress', stage: 'mailbox', scanned: 3 },
  ]);
  const stream = new MailReadStream();
  expect(stream.answered).toBe(false);
  for (const event of emitted) expect(stream.accept(JSON.stringify(event))).toBe(true);
  expect(stream).toMatchObject({ answered: true, stage: 'mailbox' });
});
it('announces the account stage before asking Mail and the answer before any mailbox work', () => {
  const stream = new MailReadStream();
  const [first, second, third] = execute(false).emitted;
  expect([first, second, third]).toEqual([
    { type: 'progress', stage: 'account', scanned: 0 },
    { type: 'answered' },
    { type: 'progress', stage: 'mailbox', scanned: 0 },
  ]);
  stream.accept(JSON.stringify(first));
  expect(stream.answered).toBe(false);
  stream.accept(JSON.stringify(second));
  expect(stream.answered).toBe(true);
});
