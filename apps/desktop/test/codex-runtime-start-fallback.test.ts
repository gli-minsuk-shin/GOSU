import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveInstalledCodexExecutable } from '@gosu/integrations/codex-runtime-discovery';

import { CodexAppServer } from '../src/main/codex-app-server';

const spawned: { executable: string; env: NodeJS.ProcessEnv }[] = [];
let behaviours: ('exits' | 'answers')[] = [];

vi.mock('@gosu/integrations/codex-runtime-discovery', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveInstalledCodexExecutable: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  spawn: vi.fn((executable: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
    spawned.push({ executable, env: options.env });
    const behaviour = behaviours.shift() ?? 'answers';
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      killed: false,
      kill() {
        child.killed = true;
        return true;
      },
    });
    if (behaviour === 'exits') {
      // A runtime that cannot start: it dies before answering `initialize`.
      setImmediate(() => {
        child.exitCode = 1;
        child.emit('exit', 1, null);
      });
    } else {
      child.stdin.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          const message = JSON.parse(line) as { id?: number; method: string };
          if (message.id !== undefined)
            child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
        }
      });
    }
    return child;
  }),
}));

afterEach(() => {
  spawned.length = 0;
  behaviours = [];
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Codex runtime start', () => {
  it('falls back to the bundled runtime when the newer installed one cannot start', async () => {
    vi.stubEnv('GOSU_CODEX_BIN', '');
    vi.mocked(resolveInstalledCodexExecutable).mockResolvedValue(
      '/Applications/ChatGPT.app/Contents/Resources/codex',
    );
    behaviours = ['exits', 'answers'];
    const server = new CodexAppServer({ stateStorage: 'provider' });
    const diagnostics: string[] = [];
    server.on('diagnostic', (line: string) => diagnostics.push(line));
    await server.start();
    expect(spawned.map((entry) => entry.executable)).toEqual([
      '/Applications/ChatGPT.app/Contents/Resources/codex',
      process.execPath,
    ]);
    expect(spawned[1]!.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(diagnostics.join('\n')).toContain('could not start');
    expect(diagnostics.join('\n')).toContain('using the bundled runtime');
  });

  it('starts a Homebrew runtime with its own directory on PATH and keeps a working one', async () => {
    vi.stubEnv('GOSU_CODEX_BIN', '');
    vi.stubEnv('PATH', '/usr/bin:/bin');
    vi.mocked(resolveInstalledCodexExecutable).mockResolvedValue('/opt/homebrew/bin/codex');
    const server = new CodexAppServer({ stateStorage: 'provider' });
    await server.start();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.executable).toBe('/opt/homebrew/bin/codex');
    expect(spawned[0]!.env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin');
  });

  it('never replaces an explicitly configured binary, and does not retry the bundled runtime', async () => {
    vi.stubEnv('GOSU_CODEX_BIN', '/explicit/codex');
    behaviours = ['exits'];
    await expect(new CodexAppServer({ stateStorage: 'provider' }).start()).rejects.toThrow();
    expect(spawned.map((entry) => entry.executable)).toEqual(['/explicit/codex']);
    spawned.length = 0;
    vi.stubEnv('GOSU_CODEX_BIN', '');
    vi.mocked(resolveInstalledCodexExecutable).mockResolvedValue(process.execPath);
    behaviours = ['exits'];
    await expect(new CodexAppServer({ stateStorage: 'provider' }).start()).rejects.toThrow();
    expect(spawned.map((entry) => entry.executable)).toEqual([process.execPath]);
  });
});
