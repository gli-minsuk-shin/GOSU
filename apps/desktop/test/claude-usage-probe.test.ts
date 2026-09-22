import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_USAGE_PROBE_ARGUMENTS,
  ClaudeUsageProbe,
  type ClaudeUsageChild,
  type ClaudeUsagePlatform,
} from '../src/main/claude-usage-probe';

function fakeCli(answer: (request: Record<string, unknown>, child: FakeChild) => void) {
  const children: FakeChild[] = [];
  const platform: ClaudeUsagePlatform = {
    locateExecutable: async () => '/fixture/claude',
    start: () => {
      const child = new FakeChild(answer);
      children.push(child);
      return child;
    },
  };
  return { platform, children };
}
class FakeChild implements ClaudeUsageChild {
  lines: ((line: string) => void)[] = [];
  exits: ((stderr: string) => void)[] = [];
  written: Record<string, unknown>[] = [];
  ended = false;
  killed = false;
  constructor(
    private readonly answer: (request: Record<string, unknown>, child: FakeChild) => void,
  ) {}
  write(line: string) {
    const request = JSON.parse(line) as Record<string, unknown>;
    this.written.push(request);
    queueMicrotask(() => this.answer(request, this));
  }
  end() {
    this.ended = true;
    queueMicrotask(() => this.exit(''));
  }
  kill() {
    this.killed = true;
    this.exit('');
  }
  onLine(listener: (line: string) => void) {
    this.lines.push(listener);
  }
  onExit(listener: (stderr: string) => void) {
    this.exits.push(listener);
  }
  say(value: unknown) {
    for (const listener of this.lines) listener(JSON.stringify(value));
  }
  exit(stderr: string) {
    for (const listener of this.exits.splice(0)) listener(stderr);
  }
}
const success = (
  request: Record<string, unknown>,
  child: FakeChild,
  body: unknown = { ok: true },
) =>
  child.say({
    type: 'control_response',
    response: { subtype: 'success', request_id: request.request_id, response: body },
  });

afterEach(() => vi.useRealTimers());

describe('Claude usage probe', () => {
  it('asks through the control channel only: no prompt, no customizations, nothing saved', async () => {
    expect(CLAUDE_USAGE_PROBE_ARGUMENTS).toEqual(
      expect.arrayContaining([
        '-p',
        '--safe-mode',
        '--no-session-persistence',
        '--strict-mcp-config',
      ]),
    );
    expect(CLAUDE_USAGE_PROBE_ARGUMENTS.join(' ')).toContain('--input-format stream-json');
    expect(CLAUDE_USAGE_PROBE_ARGUMENTS.join(' ')).toContain('--tools  --safe-mode');
    const cli = fakeCli((request, child) => {
      child.say({ type: 'system', subtype: 'init' });
      child.lines.forEach((listener) => listener('not json'));
      child.say({
        type: 'control_response',
        response: { subtype: 'success', request_id: 'other' },
      });
      success(request, child, { subscription_type: 'max' });
    });
    const probe = new ClaudeUsageProbe(cli.platform);
    await expect(probe.read({ keepAlive: false })).resolves.toEqual({ subscription_type: 'max' });
    expect(cli.children).toHaveLength(1);
    const [request] = cli.children[0]!.written;
    expect(request).toMatchObject({
      type: 'control_request',
      request: { subtype: 'get_usage', skip_behaviors: true },
    });
    // Only the control request is ever written: no user message means no model request.
    expect(cli.children[0]!.written.every((r) => r.type === 'control_request')).toBe(true);
    expect(cli.children[0]!.ended).toBe(true);
  });

  it('reuses one CLI while kept alive and starts a new one after it was released', async () => {
    const cli = fakeCli((request, child) => success(request, child));
    const probe = new ClaudeUsageProbe(cli.platform);
    await probe.read({ keepAlive: true });
    await probe.read({ keepAlive: true });
    expect(cli.children).toHaveLength(1);
    expect(cli.children[0]!.ended).toBe(false);
    await probe.read({ keepAlive: false });
    expect(cli.children[0]!.ended).toBe(true);
    await probe.read({ keepAlive: false });
    expect(cli.children).toHaveLength(2);
    probe.close();
  });

  it('reports a stable code for every failure', async () => {
    const none = new ClaudeUsageProbe({ locateExecutable: async () => null, start: vi.fn() });
    await expect(none.read({ keepAlive: false })).rejects.toMatchObject({
      code: 'usage_limits_unavailable',
    });
    const old = fakeCli((request, child) =>
      child.say({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: request.request_id,
          error: 'Unsupported control request subtype: get_usage',
        },
      }),
    );
    await expect(
      new ClaudeUsageProbe(old.platform).read({ keepAlive: false }),
    ).rejects.toMatchObject({ code: 'usage_limits_unsupported' });
    const loggedOut = fakeCli((_request, child) => child.exit('Error: not logged in. Run /login'));
    await expect(
      new ClaudeUsageProbe(loggedOut.platform).read({ keepAlive: false }),
    ).rejects.toMatchObject({ code: 'usage_limits_auth' });
    const crashed = fakeCli((_request, child) => child.exit('segfault'));
    await expect(
      new ClaudeUsageProbe(crashed.platform).read({ keepAlive: false }),
    ).rejects.toMatchObject({ code: 'usage_limits_failed' });
  });

  it('kills a CLI that never answers and starts fresh next time', async () => {
    vi.useFakeTimers();
    let silent = true;
    const cli = fakeCli((request, child) => {
      if (!silent) success(request, child);
    });
    const probe = new ClaudeUsageProbe(cli.platform);
    const failed = probe.read({ keepAlive: true, timeoutMs: 1_000 });
    const outcome = expect(failed).rejects.toMatchObject({ code: 'usage_limits_timeout' });
    await vi.advanceTimersByTimeAsync(1_001);
    await outcome;
    expect(cli.children[0]!.killed).toBe(true);
    silent = false;
    await expect(probe.read({ keepAlive: false })).resolves.toEqual({ ok: true });
    expect(cli.children).toHaveLength(2);
  });
});
