import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { APPLE_MAIL_READER, MailReadStream } from './live-mail';
import { mailSummaryKey, nativeMailHash } from './briefing-mail-ingestion';

const digest = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
function nativeFixture(
  limit: number,
  excludedIds: number[] = [],
  original = '',
  attachmentCount = 0,
) {
  const date = new Date(Date.now() - 3_600_000),
    title = '동일 제목 · synthetic';
  const excludeKeys = excludedIds.map((id) =>
    mailSummaryKey(digest(['a', ['Inbox'], String(id)]), date.toISOString(), title),
  );
  const body = vi.fn(() => 'Synthetic preview');
  const link = vi.fn(() => 'synthetic@example.test');
  const source = vi.fn(() => original);
  const messages = Array.from({ length: 120 }, (_, id) => () => ({
    exists: () => true,
    dateReceived: () => date,
    readStatus: () => false,
    subject: () => title,
    sender: () => 'Sender',
    id: () => id,
    content: body,
    messageId: link,
    source,
    mailAttachments: () => Array.from({ length: attachmentCount }),
  }));
  const account = {
    id: () => 'a',
    name: () => 'Synthetic',
    emailAddresses: () => ['a@example.test'],
    mailboxes: () => [{ name: () => 'Inbox', mailboxes: () => [], messages }],
  };
  const frames: string[] = [];
  const foundation = Object.assign((s: string) => ({ dataUsingEncoding: () => s }), {
    NSUTF8StringEncoding: 4,
    NSString: { alloc: { initWithDataEncoding: (s: string) => s } },
    NSFileHandle: {
      fileHandleWithStandardInput: { readDataToEndOfFile: JSON.stringify(excludeKeys) },
      fileHandleWithStandardOutput: { writeData: (s: string) => frames.push(s) },
    },
  });
  const run = runInNewContext(`${APPLE_MAIL_READER}; run`, {
    Application: () => ({ accounts: () => [account] }),
    ObjC: { import: () => undefined, unwrap: (s: unknown) => s },
    $: foundation,
  });
  const result = JSON.parse(
    run([
      JSON.stringify({
        action: 'read',
        accountId: 'a',
        path: ['Inbox'],
        since: new Date(Date.now() - 86_400_000).toISOString(),
        hasExclusions: true,
        scope: { days: 1, limit, subject: '', sender: '', unreadOnly: false, bodyPreview: true },
      }),
    ]),
  );
  return { result, body, link, frames, source };
}
it('verifies bounded complete source locally without emitting it, and skips attachments', () => {
  const raw =
    'From: sender@example.test\nDate: Fri, 11 Sep 2026 09:00:00 +0900\nMessage-ID: <synthetic@example.test>\nContent-Type: text/plain\n\nONLY_RAW_SOURCE_CONTENT';
  const f = nativeFixture(1, [], raw);
  expect(f.result.messages[0].contentProof.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(f.result.messages[0].contentProof.previewDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(f.result) + f.frames.join('')).not.toContain('ONLY_RAW_SOURCE_CONTENT');
  const stream = new MailReadStream();
  for (const frame of f.frames) expect(stream.accept(frame)).toBe(true);
  expect(stream.partial()?.messages[0]?.contentProof).toEqual(f.result.messages[0].contentProof);
  const attached = nativeFixture(1, [], raw, 1);
  expect(attached.source).not.toHaveBeenCalled();
  expect(attached.result.messages[0].contentProof).toBeUndefined();
});
it.each([50, 100])(
  'skips completed summaries before body/link access and fills %i new messages',
  (limit) => {
    const f = nativeFixture(limit, [0, 1]);
    expect(f.result.messages).toHaveLength(limit);
    expect(f.result.messages[0].id).toBe('2');
    expect(f.result.skipped).toBe(2);
    expect(f.body).toHaveBeenCalledTimes(limit);
    expect(f.link).toHaveBeenCalledTimes(limit);
    const stream = new MailReadStream();
    for (const frame of f.frames) expect(stream.accept(frame)).toBe(true);
    expect(stream.partial()?.messages).toHaveLength(limit);
  },
);
it('does not fetch fifty bodies on first connection and keeps distinct messages with identical titles', () => {
  const f = nativeFixture(3, [0]);
  expect(f.body).toHaveBeenCalledTimes(3);
  expect(f.result.messages.map((m: { id: string }) => m.id)).toEqual(['1', '2', '3']);
});
it.skipIf(process.platform !== 'darwin')(
  'checks the exact hash function and UTF-8 stdin bridge in real JXA without invoking Mail',
  async () => {
    const input = JSON.stringify(['계정', ['받은 편지함'], '123']);
    const code = `function run(){ObjC.import('Foundation');var value=ObjC.unwrap($.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile,$.NSUTF8StringEncoding));var hash=${nativeMailHash.toString()};return hash(value);}`;
    const result = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', code],
        { timeout: 4000 },
        (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
      );
      child.stdin!.end(input);
    });
    expect(result).toBe(createHash('sha256').update(input).digest('hex'));
  },
);
