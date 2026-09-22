import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runAppleMail,
  runAppleMailBodies,
  APPLE_MAIL_DISCOVERY_DEADLINE_MS,
  APPLE_MAIL_FIRST_RESPONSE_MS,
  APPLE_MAIL_READ_TIMEOUT_MS,
  type MailReadProgress,
} from './live-mail';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
function fixture(excludeKeys?: string[], limit = 10, progress?: (value: MailReadProgress) => void) {
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
    progress,
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
  expect(f.child.stdin.end).toHaveBeenCalledWith(JSON.stringify({ keys, deliveries: [] }));
  const args = vi.mocked(spawn).mock.calls[0]![1] as string[];
  expect(args.join(' ')).not.toContain(keys[0]);
  expect(JSON.parse(args.at(-1)!)).toMatchObject({ hasExclusions: true });
  f.emit(f.result);
  f.child.emit('close', 0);
  await f.promise;
});

describe('a Mail that answers late', () => {
  // 2026-09-21: on a Mac that was out of memory Mail needed about three minutes to answer its first
  // Apple Event. GOSU gave up after 160 seconds and the whole email section was dropped.
  it('waits longer for the first answer than for the rest of a read, and says how long it has waited', async () => {
    const progress: MailReadProgress[] = [];
    const f = fixture(undefined, 10, (value) => progress.push(value));
    f.emit({ type: 'progress', stage: 'account', scanned: 0 });
    await vi.advanceTimersByTimeAsync(APPLE_MAIL_READ_TIMEOUT_MS + 30_000);
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(progress.at(-1)).toMatchObject({ stage: 'account', waitedSeconds: 180 });
    // Mail answers at last: the read itself still gets its whole deadline from here.
    f.emit({ type: 'answered' });
    f.emit({ type: 'progress', stage: 'mailbox', scanned: 0 });
    await vi.advanceTimersByTimeAsync(APPLE_MAIL_READ_TIMEOUT_MS - 1_000);
    expect(f.child.kill).not.toHaveBeenCalled();
    f.emit(f.result);
    f.child.emit('close', 0);
    expect(await f.promise).toEqual(f.result);
  });
  it('gives up with the account stage when Mail never answers', async () => {
    const f = fixture();
    f.emit({ type: 'progress', stage: 'account', scanned: 0 });
    await vi.advanceTimersByTimeAsync(APPLE_MAIL_FIRST_RESPONSE_MS - 1_000);
    expect(f.child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(f.promise).rejects.toThrow('mail_timeout_account');
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('keeps the read deadline once Mail has answered', async () => {
    const f = fixture();
    f.emit({ type: 'answered' });
    await vi.advanceTimersByTimeAsync(APPLE_MAIL_READ_TIMEOUT_MS);
    await expect(f.promise).rejects.toThrow('mail_timeout_account');
  });
});
describe('mailbox discovery', () => {
  function discovery() {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = runAppleMail({ action: 'discover' }, new AbortController().signal);
    void promise.catch(() => undefined);
    const emit = (value: unknown) => child.stdout.emit('data', JSON.stringify(value) + '\n');
    return { child, promise, emit };
  }
  it('is not stopped while Mail keeps answering, however slowly', async () => {
    const f = discovery();
    f.emit({ type: 'answered' });
    // Two and a half times the silence limit in total, never silent for the whole limit at once.
    for (let walked = 1; walked <= 4; walked++) {
      await vi.advanceTimersByTimeAsync(100_000);
      f.emit({ type: 'progress', stage: 'mailbox', scanned: walked });
    }
    expect(f.child.kill).not.toHaveBeenCalled();
    const result = { accounts: [], limited: false };
    f.emit(result);
    f.child.emit('close', 0);
    expect(await f.promise).toEqual(result);
  });
  it('stops at the stage it reached when Mail goes silent, or at its total deadline', async () => {
    const silent = discovery();
    silent.emit({ type: 'answered' });
    silent.emit({ type: 'progress', stage: 'mailbox', scanned: 4 });
    await vi.advanceTimersByTimeAsync(APPLE_MAIL_READ_TIMEOUT_MS);
    await expect(silent.promise).rejects.toThrow('mail_timeout_mailbox');

    const endless = discovery();
    endless.emit({ type: 'answered' });
    for (let at = 0; at < APPLE_MAIL_DISCOVERY_DEADLINE_MS; at += 60_000) {
      endless.emit({ type: 'progress', stage: 'mailbox', scanned: 1 });
      await vi.advanceTimersByTimeAsync(60_000);
    }
    await expect(endless.promise).rejects.toThrow('mail_timeout_mailbox');
    expect(endless.child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
describe('supervised body reading', () => {
  function bodyChild() {
    return Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      kill: vi.fn(),
    });
  }
  it('moves past a message whose body Mail is still downloading and reads the rest in a new reader', async () => {
    vi.useFakeTimers();
    const first = bodyChild(),
      second = bodyChild();
    vi.mocked(spawn)
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);
    const send = (child: ReturnType<typeof bodyChild>, value: unknown) =>
      child.stdout.emit('data', JSON.stringify(value) + '\n');
    const pending = runAppleMailBodies(
      {
        accountId: 'a',
        path: ['All Mail'],
        items: [{ id: '1', messageId: '<1@x>' }, { id: '2' }, { id: '3' }],
      },
      new AbortController().signal,
      { stallMs: 8_000, startGraceMs: 20_000, deadlineMs: 120_000 },
    );
    send(first, { type: 'body-start', id: '1' });
    send(first, { type: 'body', id: '1', preview: 'First body', bodyUnavailable: false });
    send(first, { type: 'body-start', id: '2' });
    // Message 2 produces nothing: after the stall window the reader is stopped and 3 continues.
    await vi.advanceTimersByTimeAsync(8_001);
    expect(first.kill).toHaveBeenCalled();
    const retry = JSON.parse(vi.mocked(spawn).mock.calls[1]![1]!.at(-1)!);
    expect(retry.items.map((item: { id: string }) => item.id)).toEqual(['3']);
    send(second, { type: 'body-start', id: '3' });
    send(second, { type: 'body', id: '3', preview: 'Third body', bodyUnavailable: false });
    second.emit('close', 0);
    const result = await pending;
    expect(result.stalled).toEqual(['2']);
    expect(result.bodies).toEqual({
      '1': { preview: 'First body', bodyUnavailable: false },
      '2': { preview: '', bodyUnavailable: true },
      '3': { preview: 'Third body', bodyUnavailable: false },
    });
  });
});
