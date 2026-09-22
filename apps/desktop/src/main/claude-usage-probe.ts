import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { UsageLimitError } from '../shared/usage-limit-contracts';
import {
  createNodeClaudeCodeProjectChatPlatform,
  sanitizedClaudeEnvironment,
} from './claude-code-project-chat-adapter';

/**
 * Asks the Claude Code CLI for the data behind its `/usage` screen through the CLI's control
 * channel (`get_usage`). No prompt is sent, so nothing is spent; the CLI uses its own login and GOSU
 * never sees a token. Safe mode keeps the user's hooks, plugins and MCP servers out of these runs,
 * and nothing is written to the session history.
 */
export const CLAUDE_USAGE_PROBE_ARGUMENTS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-mode',
  'dontAsk',
  '--tools',
  '',
  '--safe-mode',
  '--no-chrome',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
  '--no-session-persistence',
] as const;
const MAX_LINE_BYTES = 1_048_576;

export class ClaudeUsageProbeError extends Error {
  constructor(readonly code: UsageLimitError) {
    super(code);
  }
}

export type ClaudeUsageChild = {
  write(line: string): void;
  end(): void;
  kill(): void;
  onLine(listener: (line: string) => void): void;
  onExit(listener: (stderr: string) => void): void;
};
export type ClaudeUsagePlatform = {
  locateExecutable(): Promise<string | null>;
  start(executable: string): ClaudeUsageChild;
};

export function createNodeClaudeUsagePlatform(): ClaudeUsagePlatform {
  return {
    locateExecutable: () => createNodeClaudeCodeProjectChatPlatform().locateExecutable(),
    start(executable) {
      const child = spawn(executable, [...CLAUDE_USAGE_PROBE_ARGUMENTS], {
        cwd: homedir(),
        env: sanitizedClaudeEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let buffer = '',
        stderr = '';
      const lines: ((line: string) => void)[] = [],
        exits: ((stderr: string) => void)[] = [];
      let exited = false;
      const exit = () => {
        if (exited) return;
        exited = true;
        for (const listener of exits) listener(stderr);
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (line.trim()) for (const listener of lines) listener(line);
          index = buffer.indexOf('\n');
        }
        // A line this long is not a control response; drop it instead of growing without bound.
        if (buffer.length > MAX_LINE_BYTES) buffer = '';
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8_192) stderr += chunk;
      });
      child.stdin.on('error', () => undefined);
      child.on('error', exit);
      child.on('exit', exit);
      return {
        write: (line) => void child.stdin.write(line),
        end: () => child.stdin.end(),
        kill: () => void child.kill(),
        onLine: (listener) => void lines.push(listener),
        onExit: (listener) => void exits.push(listener),
      };
    },
  };
}

const authFailure = (value: string) =>
  /\b401\b|unauthori[sz]ed|not logged in|login required|oauth|authenticat/iu.test(value);

export class ClaudeUsageProbe {
  private child: ClaudeUsageChild | null = null;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(private readonly platform: ClaudeUsagePlatform = createNodeClaudeUsagePlatform()) {}

  /**
   * `keepAlive` leaves the CLI running for the next read (about 0.5 s instead of 0.8 s and no
   * process start, at the price of the CLI's memory, about 220 MB); otherwise it exits right away.
   */
  async read(options: { keepAlive: boolean; timeoutMs?: number }): Promise<unknown> {
    const child = await this.ensure();
    const id = `gosu-usage-${randomUUID()}`;
    const answer = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.stop();
        reject(new ClaudeUsageProbeError('usage_limits_timeout'));
      }, options.timeoutMs ?? 20_000);
      this.pending.set(id, { resolve, reject, timer });
    });
    child.write(
      `${JSON.stringify({
        type: 'control_request',
        request_id: id,
        request: { subtype: 'get_usage', skip_behaviors: true },
      })}\n`,
    );
    try {
      return await answer;
    } finally {
      if (!options.keepAlive) this.release();
    }
  }

  private async ensure() {
    if (this.child) return this.child;
    const executable = await this.platform.locateExecutable();
    if (!executable) throw new ClaudeUsageProbeError('usage_limits_unavailable');
    const child = this.platform.start(executable);
    this.child = child;
    child.onLine((line) => this.accept(line));
    child.onExit((stderr) => {
      if (this.child === child) this.child = null;
      const error = new ClaudeUsageProbeError(
        authFailure(stderr) ? 'usage_limits_auth' : 'usage_limits_failed',
      );
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.reject(error);
      }
    });
    return child;
  }

  private accept(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    const { type, response } = message as { type?: unknown; response?: unknown };
    if (type !== 'control_response' || !response || typeof response !== 'object') return;
    const { request_id: id, subtype, error, response: body } = response as Record<string, unknown>;
    const entry = typeof id === 'string' ? this.pending.get(id) : undefined;
    if (!entry || typeof id !== 'string') return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (subtype === 'success') return entry.resolve(body);
    const reason = typeof error === 'string' ? error : '';
    entry.reject(
      new ClaudeUsageProbeError(
        /unsupported control request|not supported/iu.test(reason)
          ? 'usage_limits_unsupported'
          : authFailure(reason)
            ? 'usage_limits_auth'
            : 'usage_limits_failed',
      ),
    );
  }

  /** Lets the CLI end by itself (stdin closed); a CLI that does not is killed after 5 s. */
  private release() {
    const child = this.child;
    if (!child || this.pending.size) return;
    this.child = null;
    child.end();
    const timer = setTimeout(() => child.kill(), 5_000);
    timer.unref?.();
    child.onExit(() => clearTimeout(timer));
  }

  private stop() {
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  close() {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(new ClaudeUsageProbeError('usage_limits_failed'));
    }
    this.stop();
  }
}
