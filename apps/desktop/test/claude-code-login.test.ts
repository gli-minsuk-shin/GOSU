import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  ClaudeCodeLoginService,
  officialClaudeLoginUrl,
  type ClaudeCodeLoginPlatform,
} from '../src/main/claude-code-login';

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit('close', null));
      return true;
    }),
  });
  return child;
}

function fixture(overrides: Partial<ClaudeCodeLoginPlatform> = {}) {
  const child = fakeChild();
  const platform = {
    locateExecutable: vi.fn(async () => '/Users/test/.local/bin/claude'),
    spawn: vi.fn(() => child as never),
    openExternal: vi.fn(async () => undefined),
    ...overrides,
  };
  return { child, platform, service: new ClaudeCodeLoginService(platform) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ClaudeCodeLoginService', () => {
  it('runs the official subscription login and resolves only after the CLI exits successfully', async () => {
    const { child, platform, service } = fixture();
    const login = service.login();
    await flush();

    expect(platform.spawn).toHaveBeenCalledExactlyOnceWith('/Users/test/.local/bin/claude', [
      'auth',
      'login',
      '--claudeai',
    ]);
    expect(service.isInProgress()).toBe(true);
    child.stdout.write('Opening browser to sign in…\n');
    child.emit('close', 0);

    await expect(login).resolves.toEqual({ status: 'signed_in' });
    expect(service.isInProgress()).toBe(false);
  });

  it('shares one in-flight login instead of starting a second CLI process', async () => {
    const { child, platform, service } = fixture();
    const first = service.login();
    await flush();
    const second = service.login();
    child.emit('close', 0);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(platform.spawn).toHaveBeenCalledOnce();
  });

  it('reopens only the official sign-in URL printed by the CLI', async () => {
    const { child, platform, service } = fixture();
    const login = service.login();
    await flush();

    await expect(service.openSignInPage()).resolves.toBe(false);
    child.stdout.write(
      "If the browser didn't open, visit: https://claude.ai/oauth/authorize?code=true&state=abc\n",
    );
    await expect(service.openSignInPage()).resolves.toBe(true);
    expect(platform.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://claude.ai/oauth/authorize?code=true&state=abc',
    );
    child.emit('close', 0);
    await login;
  });

  it('forwards a pasted authentication code only to the active login process', async () => {
    const { child, service } = fixture();
    expect(service.submitCode('code-before-login')).toBe(false);

    const login = service.login();
    await flush();
    const written: string[] = [];
    child.stdin.on('data', (chunk: Buffer) => written.push(chunk.toString()));

    expect(service.submitCode('')).toBe(false);
    expect(service.submitCode('has whitespace')).toBe(false);
    expect(service.submitCode(42)).toBe(false);
    expect(service.submitCode('  abc#def_123  ')).toBe(true);
    await flush();
    expect(written.join('')).toBe('abc#def_123\n');

    child.emit('close', 0);
    await expect(login).resolves.toEqual({ status: 'signed_in' });
    expect(service.submitCode('code-after-login')).toBe(false);
  });

  it('rejects non-official or non-HTTPS URLs', () => {
    expect(officialClaudeLoginUrl('visit: http://claude.ai/oauth')).toBeNull();
    expect(officialClaudeLoginUrl('visit: https://claude.ai.evil.example/oauth')).toBeNull();
    expect(officialClaudeLoginUrl('visit: https://platform.claude.com/oauth/x')).toBe(
      'https://platform.claude.com/oauth/x',
    );
  });

  it('reports cancellation, failure, timeout, and a missing CLI with stable codes', async () => {
    const cancelled = fixture();
    const cancelledLogin = cancelled.service.login();
    await flush();
    expect(cancelled.service.cancel()).toBe(true);
    await expect(cancelledLogin).rejects.toThrow(/^claude_code_login_cancelled$/);

    const failed = fixture();
    const failedLogin = failed.service.login();
    await flush();
    failed.child.stderr.write('PRIVATE_PROVIDER_OUTPUT');
    failed.child.emit('close', 1);
    await expect(failedLogin).rejects.toThrow(/^claude_code_login_failed$/);

    const timedOut = fixture({ timeoutMs: 5 });
    await expect(timedOut.service.login()).rejects.toThrow(/^claude_code_login_timeout$/);
    expect(timedOut.child.kill).toHaveBeenCalled();

    const missing = fixture({ locateExecutable: vi.fn(async () => null) });
    await expect(missing.service.login()).rejects.toThrow(/^claude_code_not_detected$/);
    expect(missing.platform.spawn).not.toHaveBeenCalled();
  });
});
