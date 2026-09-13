import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import type { ChildProcess, spawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { openOriginalMail } from './briefing-mail-open';
import { MailOpenRequestSchema } from './src/mail-open-contract';
const url = 'message://%3Cfixture%40example.test%3E';
afterEach(() => vi.useRealTimers());
function fixture() {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
  const run = vi.fn(() => child as unknown as ChildProcess);
  return { child, run, spawn: run as unknown as typeof spawn };
}
it('hands only a canonical original-message URL to Apple Mail without a shell or inherited secrets', async () => {
  const f = fixture();
  const done = openOriginalMail(url, new AbortController().signal, f.spawn, 'darwin');
  f.child.emit('close', 0);
  await done;
  expect(f.run.mock.calls).toEqual([
    [
      '/usr/bin/open',
      ['-b', 'com.apple.mail', url],
      { shell: false, stdio: 'ignore', env: { PATH: '/usr/bin:/bin', HOME: homedir() } },
    ],
  ]);
});
it.each([
  'https://example.test',
  'mailto:test@example.test',
  'file:///tmp/test',
  'message://%3Cid%40example.test%3E?other=1',
])('never launches a foreign or noncanonical target %s', async (value) => {
  const f = fixture();
  await expect(
    openOriginalMail(value, new AbortController().signal, f.spawn, 'darwin'),
  ).rejects.toThrow('mail_open_target_invalid');
  expect(f.run).not.toHaveBeenCalled();
});
it('does not launch when cancelled or unavailable on this platform', async () => {
  const f = fixture(),
    c = new AbortController();
  c.abort();
  await expect(openOriginalMail(url, c.signal, f.spawn, 'darwin')).rejects.toThrow(
    'source_cancelled',
  );
  await expect(
    openOriginalMail(url, new AbortController().signal, f.spawn, 'linux'),
  ).rejects.toThrow('mail_open_macos_required');
  expect(f.run).not.toHaveBeenCalled();
});
it('cancels or times out an unacknowledged handoff without retrying', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const rejected = expect(
    openOriginalMail(url, new AbortController().signal, f.spawn, 'darwin'),
  ).rejects.toThrow('mail_open_timeout');
  await vi.advanceTimersByTimeAsync(10000);
  await rejected;
  expect(f.child.kill).toHaveBeenCalledWith('SIGTERM');
  expect(f.run).toHaveBeenCalledOnce();
  const next = fixture(),
    c = new AbortController();
  const aborted = expect(openOriginalMail(url, c.signal, next.spawn, 'darwin')).rejects.toThrow(
    'source_cancelled',
  );
  c.abort();
  await aborted;
  expect(next.child.kill).toHaveBeenCalledOnce();
});
it('reports native failure without copying diagnostic text', async () => {
  const f = fixture();
  const rejected = expect(
    openOriginalMail(url, new AbortController().signal, f.spawn, 'darwin'),
  ).rejects.toThrow('mail_open_failed');
  f.child.emit('error', new Error('private diagnostic'));
  await rejected;
});
it('accepts exactly one server source identity and no client policy/URL/app override', () => {
  const target = { routineId: 'r', historyId: 'h', itemId: 'm' };
  expect(MailOpenRequestSchema.safeParse(target).success).toBe(true);
  for (const patch of [
    { url },
    { application: 'Other' },
    { mailOpenConfirmation: 'always' },
    { confirmed: true },
    { receiptId: '11111111-1111-4111-8111-111111111111' },
  ])
    expect(MailOpenRequestSchema.safeParse({ ...target, ...patch }).success).toBe(false);
});
