import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsageLimitService, usageLimitErrorCode } from '../src/main/usage-limit-service';
import type { UsageLimitStatus } from '../src/shared/usage-limit-contracts';
import { CLAUDE_USAGE, CODEX_RATE_LIMITS } from './usage-limit-fixtures';

const failure = (code: string) => Object.assign(new Error(code), { code });
async function fixture(options: { claudeConnected?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gosu-usage-limits-'));
  const codex = { read: vi.fn(async (): Promise<unknown> => CODEX_RATE_LIMITS) };
  let connected = options.claudeConnected ?? true;
  const claude = {
    connected: vi.fn(() => connected),
    read: vi.fn(async (_keepAlive: boolean): Promise<unknown> => CLAUDE_USAGE),
    close: vi.fn(),
  };
  const pushed: UsageLimitStatus[] = [];
  let now = Date.parse('2026-09-21T12:00:00Z');
  const service = new UsageLimitService(
    directory,
    { codex, claude },
    (status) => pushed.push(status),
    () => now,
  );
  return {
    directory,
    codex,
    claude,
    pushed,
    service,
    connect: (value: boolean) => (connected = value),
    advance: (ms: number) => (now += ms),
  };
}
const provider = (status: UsageLimitStatus, id: 'codex' | 'claude-code') =>
  status.providers.find((p) => p.providerId === id)!;

afterEach(() => vi.useRealTimers());

describe('UsageLimitService', () => {
  it('reads both CLIs, keeps what they report and pushes the change', async () => {
    const f = await fixture();
    const status = await f.service.refresh();
    expect(provider(status, 'codex')).toMatchObject({
      connected: true,
      plan: 'pro',
      error: null,
      fetchedAt: '2026-09-21T12:00:00.000Z',
    });
    expect(provider(status, 'codex').windows.map((w) => w.kind)).toEqual(['weekly']);
    expect(provider(status, 'claude-code').windows.map((w) => w.kind)).toEqual([
      'session',
      'weekly',
      'weekly-model',
    ]);
    expect(f.pushed.at(0)!.refreshing).toBe(true);
    expect(f.pushed.at(-1)).toEqual(status);
    expect(status.refreshing).toBe(false);
  });

  it('does not ask a CLI that is not connected in GOSU, and hides one that is not logged in', async () => {
    const f = await fixture({ claudeConnected: false });
    f.codex.read.mockRejectedValueOnce(failure('codex_auth_required'));
    const status = await f.service.refresh();
    expect(f.claude.read).not.toHaveBeenCalled();
    expect(provider(status, 'claude-code')).toMatchObject({
      connected: false,
      windows: [],
      error: null,
    });
    expect(provider(status, 'codex')).toMatchObject({
      connected: false,
      windows: [],
      error: 'usage_limits_auth',
    });
    // Connecting later shows it on the next read.
    f.connect(true);
    expect(provider(await f.service.refresh(true), 'claude-code').connected).toBe(true);
  });

  it('keeps the last good numbers when a later read fails, says why, and waits longer', async () => {
    const f = await fixture();
    await f.service.refresh();
    f.claude.read.mockRejectedValue(failure('usage_limits_timeout'));
    const failed = await f.service.refresh();
    expect(provider(failed, 'claude-code')).toMatchObject({
      connected: true,
      error: 'usage_limits_timeout',
      fetchedAt: '2026-09-21T12:00:00.000Z',
    });
    expect(provider(failed, 'claude-code').windows).toHaveLength(3);
    // The scheduled read after a failure is skipped until the waiting time has passed...
    f.claude.read.mockClear();
    f.advance(60_000);
    await f.service.refresh();
    expect(f.claude.read).not.toHaveBeenCalled();
    // ...but "refresh now" always asks.
    f.claude.read.mockResolvedValue(CLAUDE_USAGE);
    const recovered = await f.service.refresh(true);
    expect(f.claude.read).toHaveBeenCalledTimes(1);
    expect(provider(recovered, 'claude-code').error).toBeNull();
  });

  it('flags an answer it cannot read instead of showing nothing', async () => {
    const f = await fixture();
    f.codex.read.mockResolvedValue({ unexpected: true });
    expect(provider(await f.service.refresh(), 'codex').error).toBe('usage_limits_format');
    expect(usageLimitErrorCode(new Error('Codex request timed out: account/rateLimits/read'))).toBe(
      'usage_limits_timeout',
    );
    expect(usageLimitErrorCode(failure('codex_unavailable'))).toBe('usage_limits_unavailable');
    expect(usageLimitErrorCode(new Error('-32601 method not found'))).toBe(
      'usage_limits_unsupported',
    );
    expect(usageLimitErrorCode('anything')).toBe('usage_limits_failed');
  });

  it('runs one read at a time and takes the numbers Codex pushes after a turn', async () => {
    const f = await fixture();
    let release!: (value: unknown) => void;
    f.codex.read.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = f.service.refresh(),
      second = f.service.refresh();
    expect(second).toBe(first);
    release(CODEX_RATE_LIMITS);
    await first;
    expect(f.codex.read).toHaveBeenCalledTimes(1);
    f.service.acceptCodexNotification('turn/completed', {});
    f.service.acceptCodexNotification('account/rateLimits/updated', {
      rateLimits: { primary: { usedPercent: 55, windowDurationMins: 10080, resetsAt: 1790556720 } },
    });
    expect(provider(f.service.status(), 'codex').windows[0]!.usedPercent).toBe(55);
    expect(provider(f.pushed.at(-1)!, 'codex').windows[0]!.usedPercent).toBe(55);
  });

  it('saves the two settings privately, survives a restart and refuses other values', async () => {
    const f = await fixture();
    expect((await f.service.load()).refreshSeconds).toBe(600);
    const saved = await f.service.configure({
      version: 1,
      refreshSeconds: 10,
      showInTitleBar: false,
    });
    expect(saved.settings).toEqual({ version: 1, refreshSeconds: 10, showInTitleBar: false });
    expect((await stat(f.service.path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(f.service.path, 'utf8'))).toEqual(saved.settings);
    const again = new UsageLimitService(f.directory, { codex: f.codex, claude: f.claude });
    expect(await again.load()).toEqual(saved.settings);
    await expect(
      f.service.configure({ version: 1, refreshSeconds: 7, showInTitleBar: true }),
    ).rejects.toThrow();
    expect(f.service.status().settings.refreshSeconds).toBe(10);
    await writeFile(f.service.path, '{broken');
    await expect(again.load()).rejects.toThrow('usage_limit_settings_unreadable');
    // The defaults run, every status says why, and saving again clears it.
    expect(again.status().settingsError).toBe('usage_limit_settings_unreadable');
    expect(
      (await again.configure({ version: 1, refreshSeconds: 60, showInTitleBar: true }))
        .settingsError,
    ).toBeNull();
  });

  it('polls at the chosen interval only while the window shows, keeping the Claude CLI for short ones', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    await f.service.configure({ version: 1, refreshSeconds: 10, showInTitleBar: true });
    f.service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.codex.read).toHaveBeenCalledTimes(1);
    expect(f.claude.read).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.codex.read).toHaveBeenCalledTimes(2);
    // Hidden or minimized: no reads, and the kept CLI is let go.
    f.service.setActive(false);
    expect(f.claude.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.codex.read).toHaveBeenCalledTimes(2);
    // Shown again: refreshed at once.
    f.service.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.codex.read).toHaveBeenCalledTimes(3);
    // A long interval starts the CLI for each read instead of keeping it.
    await f.service.configure({ version: 1, refreshSeconds: 600, showInTitleBar: true });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.claude.read).toHaveBeenLastCalledWith(false);
    f.service.close();
    const reads = f.codex.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_200_000);
    expect(f.codex.read).toHaveBeenCalledTimes(reads);
  });
});
