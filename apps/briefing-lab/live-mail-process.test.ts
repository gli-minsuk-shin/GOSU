import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { runAppleMail, APPLE_MAIL_READ_TIMEOUT_MS } from './live-mail';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
function fixture(excludeKeys?: string[], limit = 10) {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as never);
  const controller = new AbortController();
  const promise = runAppleMail(
    {
      action: 'read',
      accountId: 'a',
      path: ['INBOX'],
      since: '2026-09-08T00:00:00Z',
      ...(excludeKeys ? { excludeKeys } : {}),
      scope: {
        accountId: 'a',
        mailboxId: 'b',
        days: 5,
        limit,
        subject: '',
        sender: '',
        unreadOnly: false,
        bodyPreview: true,
      },
    },
    controller.signal,
  );
  void promise.catch(() => undefined);
  const result = {
    messages: [
      {
        id: '1',
        title: 'Fixture',
        sender: 'Fixture',
        date: '2026-09-09T00:00:00Z',
        unread: false,
        preview: '',
        bodyUnavailable: true,
      },
    ],
    scanned: 1,
    capped: true,
  };
  const emit = (value: unknown) => child.stdout.emit('data', JSON.stringify(value) + '\n');
  return { child, controller, promise, result, emit };
}
it('returns validated partial metadata on a body timeout and terminates the reader', async () => {
  const f = fixture();
  f.emit({ type: 'checkpoint', result: f.result });
  f.emit({ type: 'progress', stage: 'body', scanned: 1 });
  await vi.advanceTimersByTimeAsync(APPLE_MAIL_READ_TIMEOUT_MS);
  expect(await f.promise).toMatchObject({ ...f.result, partial: true, stalledStage: 'body' });
  expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
});
it('retains received-message dates and selected account metadata when a later body read times out', async () => {
  const f = fixture();
  f.emit({ type: 'checkpoint', result: f.result });
  f.emit({
    type: 'account-context',
    account: { id: 'a', name: 'Work', addresses: ['work@example.test'] },
  });
  f.emit({ type: 'progress', stage: 'body', scanned: 1 });
  await vi.advanceTimersByTimeAsync(APPLE_MAIL_READ_TIMEOUT_MS);
  expect(await f.promise).toMatchObject({
    account: { id: 'a', name: 'Work', addresses: ['work@example.test'] },
    messages: [{ date: '2026-09-09T00:00:00Z' }],
    partial: true,
  });
});
it('keeps the original-message navigation ID in partial checkpoints without exposing it as progress', async () => {
  const f = fixture();
  f.emit({ type: 'checkpoint', result: f.result });
  f.emit({ type: 'message-link', id: '1', messageId: '<original@example.test>' });
  f.emit({ type: 'message-link', id: 'unknown', messageId: '<wrong@example.test>' });
  await vi.advanceTimersByTimeAsync(APPLE_MAIL_READ_TIMEOUT_MS);
  expect(await f.promise).toMatchObject({
    messages: [{ id: '1', messageId: '<original@example.test>' }],
    partial: true,
  });
});
it('never returns partial private data after user cancellation', async () => {
  const f = fixture();
  f.emit({ type: 'checkpoint', result: f.result });
  f.controller.abort();
  await expect(f.promise).rejects.toThrow('source_cancelled');
});
it('reports the stalled stage without fabricating an empty successful read', async () => {
  const f = fixture();
  f.emit({ type: 'progress', stage: 'metadata', scanned: 0 });
  await vi.advanceTimersByTimeAsync(APPLE_MAIL_READ_TIMEOUT_MS);
  await expect(f.promise).rejects.toThrow('mail_timeout_metadata');
});
it('accepts split frames followed by the normal final result', async () => {
  const f = fixture(),
    frame = JSON.stringify({ type: 'progress', stage: 'metadata', scanned: 0 }) + '\n';
  f.child.stdout.emit('data', frame.slice(0, 12));
  f.child.stdout.emit('data', frame.slice(12));
  f.emit(f.result);
  f.child.emit('close', 0);
  expect(await f.promise).toEqual(f.result);
});
it('supports one hundred bounded previews even when their escaped stream exceeds the old four-megabyte ceiling', async () => {
  const f = fixture(undefined, 100);
  const preview = '\u0001'.repeat(4000);
  const metadata = {
    messages: Array.from({ length: 100 }, (_, id) => ({
      ...f.result.messages[0]!,
      id: String(id),
    })),
    scanned: 100,
    capped: false,
  };
  f.emit({ type: 'checkpoint', result: metadata });
  for (const item of metadata.messages)
    f.emit({ type: 'body', id: item.id, preview, bodyUnavailable: false });
  const result = {
    ...metadata,
    messages: metadata.messages.map((item) => ({ ...item, preview, bodyUnavailable: false })),
  };
  f.emit(result);
  f.child.emit('close', 0);
  expect(((await f.promise) as typeof result).messages).toHaveLength(100);
  expect(f.child.kill).not.toHaveBeenCalled();
});
it('sends the bounded summary fingerprint index through private stdin, never argv or source text', async () => {
  const keys = ['a'.repeat(64), 'b'.repeat(64)];
  const f = fixture(keys);
  expect(f.child.stdin.end).toHaveBeenCalledWith(JSON.stringify(keys));
  const args = vi.mocked(spawn).mock.calls[0]![1] as string[];
  expect(args.join(' ')).not.toContain(keys[0]);
  expect(JSON.parse(args.at(-1)!)).toMatchObject({ hasExclusions: true });
  f.emit(f.result);
  f.child.emit('close', 0);
  await f.promise;
});
