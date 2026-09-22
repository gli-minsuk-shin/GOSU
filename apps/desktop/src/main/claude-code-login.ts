import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';

import {
  createNodeClaudeCodeProjectChatPlatform,
  sanitizedClaudeEnvironment,
} from './claude-code-project-chat-adapter';

const CLAUDE_CODE_LOGIN_TIMEOUT_MS = 10 * 60_000;
const CLAUDE_CODE_LOGIN_MAX_OUTPUT_CHARS = 64_000;
const CLAUDE_CODE_LOGIN_HOSTS = ['claude.ai', 'claude.com', 'anthropic.com'] as const;

type ClaudeCodeLoginChild = Pick<
  ChildProcessWithoutNullStreams,
  'stdout' | 'stderr' | 'stdin' | 'kill' | 'once'
>;

export type ClaudeCodeLoginPlatform = Readonly<{
  locateExecutable(): Promise<string | null>;
  spawn(executable: string, args: readonly string[]): ClaudeCodeLoginChild;
  openExternal(url: string): Promise<void>;
  timeoutMs?: number;
}>;

export type ClaudeCodeLoginResult = Readonly<{ status: 'signed_in' }>;

type ActiveLogin = {
  child: ClaudeCodeLoginChild;
  authUrl: string | null;
  cancelled: boolean;
  promise: Promise<ClaudeCodeLoginResult>;
};

// The CLI prints its fallback sign-in URL; only an official Anthropic HTTPS
// origin may ever be opened from it.
export function officialClaudeLoginUrl(output: string): string | null {
  for (const match of output.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    try {
      const url = new URL(match[0]);
      const host = url.hostname.toLowerCase();
      if (
        url.protocol === 'https:' &&
        CLAUDE_CODE_LOGIN_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
      ) {
        return url.toString();
      }
    } catch {
      // Not a URL; keep scanning.
    }
  }
  return null;
}

export function createNodeClaudeCodeLoginPlatform(
  openExternal: (url: string) => Promise<void>,
): ClaudeCodeLoginPlatform {
  const projectChatPlatform = createNodeClaudeCodeProjectChatPlatform();
  return {
    locateExecutable: () => projectChatPlatform.locateExecutable(),
    spawn: (executable, args) =>
      spawn(executable, [...args], {
        cwd: homedir(),
        env: sanitizedClaudeEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    openExternal,
  };
}

/**
 * Runs the official `claude auth login --claudeai` flow so a user can sign in to
 * their Claude subscription from GOSU. Claude Code opens the browser and stores
 * the credential in its own secure storage; GOSU never receives the token, only
 * the process outcome and the official fallback sign-in URL.
 */
export class ClaudeCodeLoginService {
  private active: ActiveLogin | null = null;

  constructor(private readonly platform: ClaudeCodeLoginPlatform) {}

  isInProgress() {
    return this.active !== null;
  }

  login(): Promise<ClaudeCodeLoginResult> {
    return this.active?.promise ?? this.start();
  }

  cancel() {
    const active = this.active;
    if (!active) return false;
    active.cancelled = true;
    active.child.kill('SIGTERM');
    return true;
  }

  /**
   * Claude Code launched without a terminal finishes sign-in by showing an
   * Authentication code in the browser and waiting for it on stdin. The code
   * is forwarded to that process only; GOSU never stores or logs it.
   */
  submitCode(code: unknown) {
    const active = this.active;
    const trimmed = typeof code === 'string' ? code.trim() : '';
    if (!active || !trimmed || trimmed.length > 4096 || /\s/u.test(trimmed)) return false;
    active.child.stdin.write(`${trimmed}\n`);
    return true;
  }

  async openSignInPage() {
    const url = this.active?.authUrl;
    if (!url) return false;
    await this.platform.openExternal(url);
    return true;
  }

  private async start(): Promise<ClaudeCodeLoginResult> {
    const executable = await this.platform.locateExecutable();
    if (this.active) return this.active.promise;
    if (!executable) throw new Error('claude_code_not_detected');

    const child = this.platform.spawn(executable, ['auth', 'login', '--claudeai']);
    const active: ActiveLogin = {
      child,
      authUrl: null,
      cancelled: false,
      promise: Promise.resolve({ status: 'signed_in' }),
    };
    active.promise = new Promise<ClaudeCodeLoginResult>((resolvePromise, rejectPromise) => {
      let output = '';
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdin.end();
        if (this.active === active) this.active = null;
        callback();
      };
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        settle(() => rejectPromise(new Error('claude_code_login_timeout')));
      }, this.platform.timeoutMs ?? CLAUDE_CODE_LOGIN_TIMEOUT_MS);
      const observe = (chunk: Buffer | string) => {
        output = `${output}${chunk.toString()}`.slice(-CLAUDE_CODE_LOGIN_MAX_OUTPUT_CHARS);
        active.authUrl ??= officialClaudeLoginUrl(output);
      };

      child.stdout.on('data', observe);
      child.stderr.on('data', observe);
      child.once('error', () => settle(() => rejectPromise(new Error('claude_code_login_failed'))));
      child.once('close', (code) =>
        settle(() => {
          if (active.cancelled) rejectPromise(new Error('claude_code_login_cancelled'));
          else if (code === 0) resolvePromise({ status: 'signed_in' });
          else rejectPromise(new Error('claude_code_login_failed'));
        }),
      );
      // stdin stays open: the CLI may wait for a pasted code in its manual flow.
    });
    this.active = active;
    return active.promise;
  }
}
