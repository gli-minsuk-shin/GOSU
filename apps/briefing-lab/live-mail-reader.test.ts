import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { APPLE_MAIL_READER, MailReadStream } from './live-mail';

function execute(bodyPreview: boolean) {
  const content = vi.fn(() => 'fixture body'),
    emitted: unknown[] = [];
  const messages = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (!/^\d+$/.test(String(key))) throw Error('unbounded_mailbox_access');
        const n = Number(key);
        return () => ({
          exists: () => n < 300,
          id: () => n,
          dateReceived: () => new Date('2026-09-09T00:00:00Z'),
          readStatus: () => false,
          subject: () => 'Fixture subject',
          sender: () => 'Fixture sender',
          content,
        });
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
it('reads only bounded message references without enumerating or filtering the whole All Mail mailbox', () => {
  const f = execute(false);
  expect(f.result.messages).toHaveLength(10);
  expect(f.result.scanned).toBe(10);
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
  expect(stream.partial()).toMatchObject({ partial: true, scanned: 10 });
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
