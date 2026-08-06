import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRemoteCommand,
  createSshCommandRunner,
  quotePosixToken,
  type SshCommandError,
} from '../src/main/ssh-command-runner';
import {
  SSH_WORKSPACE_FILE_HELPER_SOURCE,
  SSH_WORKSPACE_FILE_MAX_STDIN_BYTES,
} from '../src/main/ssh-workspace-files';

const HELPER_COMMAND = {
  projectId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  attemptId: '33333333-3333-4333-8333-333333333333',
  turnId: 'turn-helper',
  toolCallId: 'tool-helper',
  connectionId: '44444444-4444-4444-8444-444444444444',
  command: '/usr/bin/python3',
  args: ['-I', '-S', '-c', SSH_WORKSPACE_FILE_HELPER_SOURCE],
  timeoutSeconds: 30,
};

describe('bounded OpenSSH command runner', () => {
  let directory: string;
  let executable: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gosu-ssh-runner-'));
    executable = join(directory, 'fake-ssh');
    await writeFile(
      executable,
      `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
const alias = args.at(-2);
const clientLogOption = args.indexOf('-E');
const clientLogPath = clientLogOption >= 0 ? args[clientLogOption + 1] : undefined;
const clientDiagnostic = (message) => {
  if (clientLogPath) appendFileSync(clientLogPath, message);
  else process.stderr.write(message);
};
if (alias === 'unknown-host') {
  clientDiagnostic('Host key verification failed.');
  process.exit(255);
}
if (alias === 'auth-failed') {
  clientDiagnostic('Permission denied (publickey).');
  process.exit(255);
}
if (alias === 'local-warning') {
  clientDiagnostic('Warning: Identity file /Users/researcher/.ssh/id_ed25519 not accessible.');
  process.stderr.write('remote program warning');
  process.exit(0);
}
if (alias === 'remote-failed') {
  process.stderr.write('fixture command failed');
  process.exit(7);
}
if (alias === 'remote-exit-255') {
  process.stderr.write('fixture program chose exit 255');
  process.exit(255);
}
if (alias === 'wait-forever') {
  setInterval(() => undefined, 1000);
} else if (alias === 'mixed-output') {
  process.stdout.write('o'.repeat(1000));
  process.stderr.write('e'.repeat(1000));
} else if (alias === 'large-output') {
  process.stdout.write('x'.repeat(1000));
} else if (alias === 'stdin-capture') {
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify({ args, stdinBase64: Buffer.concat(chunks).toString('base64') }));
  });
} else {
  process.stdout.write(JSON.stringify({
    args,
    environment: {
      askPass: process.env.SSH_ASKPASS,
      askPassRequire: process.env.SSH_ASKPASS_REQUIRE,
      authSock: process.env.SSH_AUTH_SOCK,
      lcAll: process.env.LC_ALL,
    },
  }));
}
`,
      { mode: 0o700 },
    );
    await chmod(executable, 0o700);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('uses a fixed non-interactive policy while retaining alias-based agent authentication', async () => {
    const previousAskPass = process.env.SSH_ASKPASS;
    const previousSocket = process.env.SSH_AUTH_SOCK;
    process.env.SSH_ASKPASS = '/private/untrusted-askpass';
    process.env.SSH_AUTH_SOCK = '/fixture/agent.sock';
    try {
      const result = await createSshCommandRunner(executable)({
        hostAlias: 'research-gpu',
        command: '/usr/bin/nvidia-smi',
        args: ['--query-gpu=name'],
        timeoutSeconds: 5,
      });
      const captured = JSON.parse(result.stdout) as {
        args: string[];
        environment: Record<string, string>;
      };

      expect(captured.args).toEqual(
        expect.arrayContaining([
          '-T',
          '-n',
          'BatchMode=yes',
          'StrictHostKeyChecking=yes',
          'ClearAllForwardings=yes',
          'ForwardAgent=no',
          'ForwardX11=no',
          'PermitLocalCommand=no',
          'RequestTTY=no',
          'LogLevel=ERROR',
          'ControlMaster=no',
          'ForkAfterAuthentication=no',
          'Tunnel=no',
          '--',
          'research-gpu',
        ]),
      );
      expect(captured.args.at(-1)).toBe("exec '/usr/bin/nvidia-smi' '--query-gpu=name'");
      const clientLogOption = captured.args.indexOf('-E');
      expect(clientLogOption).toBeGreaterThanOrEqual(0);
      const clientLogPath = captured.args[clientLogOption + 1];
      expect(clientLogPath).toBeTruthy();
      await expect(access(clientLogPath!)).rejects.toThrow();
      expect(captured.environment).toMatchObject({
        askPass: '/usr/bin/false',
        askPassRequire: 'never',
        authSock: '/fixture/agent.sock',
        lcAll: 'C',
      });
    } finally {
      if (previousAskPass === undefined) delete process.env.SSH_ASKPASS;
      else process.env.SSH_ASKPASS = previousAskPass;
      if (previousSocket === undefined) delete process.env.SSH_AUTH_SOCK;
      else process.env.SSH_AUTH_SOCK = previousSocket;
    }
  });

  it('uses normalized direct fields with no SSH config, raw command, or imported forwarding', async () => {
    const result = await createSshCommandRunner(executable)({
      hostAlias: 'direct-fixture',
      directTarget: {
        host: '203.0.113.10',
        user: 'researcher',
        port: 2222,
        localForwards: [
          {
            bindAddress: '127.0.0.1',
            localPort: 8080,
            destinationHost: 'localhost',
            destinationPort: 8080,
          },
        ],
      },
      command: '/usr/bin/true',
      timeoutSeconds: 5,
    });
    const captured = JSON.parse(result.stdout) as { args: string[] };

    expect(captured.args).toEqual(
      expect.arrayContaining([
        '-F',
        'none',
        '-l',
        'researcher',
        '-p',
        '2222',
        'ClearAllForwardings=yes',
        'GatewayPorts=no',
        '--',
        '203.0.113.10',
      ]),
    );
    expect(captured.args).not.toContain('-L');
    expect(JSON.stringify(captured.args)).not.toContain('8080:localhost:8080');
    expect(JSON.stringify(captured.args)).not.toContain('ssh -p');
  });

  it('quotes every remote token without turning arguments into shell syntax', () => {
    expect(quotePosixToken("alpha'beta")).toBe("'alpha'\"'\"'beta'");
    expect(
      buildRemoteCommand({
        command: 'python3',
        args: ["value'; touch /tmp/not-created", '$HOME', 'two words'],
        workingDirectory: '/srv/research data',
      }),
    ).toBe(
      "cd '/srv/research data' && exec 'python3' 'value'\"'\"'; touch /tmp/not-created' '$HOME' 'two words'",
    );
  });

  it('captures each stdout chunk exactly once', async () => {
    const result = await createSshCommandRunner(executable)({
      hostAlias: 'research-gpu',
      command: '/usr/bin/true',
      timeoutSeconds: 5,
    });

    const captured = JSON.parse(result.stdout) as { args: string[] };
    expect(captured.args.at(-1)).toBe("exec '/usr/bin/true'");
    expect(result.stdout.match(/"args"/gu)).toHaveLength(1);
  });

  it('pipes an exact bounded UTF-8 payload only when the Main process opts in', async () => {
    const stdinText = '{"line":"alpha\\n한글","terminal":null}\n';
    const result = await createSshCommandRunner(executable).executeWorkspaceFileHelper(
      'stdin-capture',
      HELPER_COMMAND,
      stdinText,
    );
    const captured = JSON.parse(result.stdout) as { args: string[]; stdinBase64: string };

    expect(captured.args).not.toContain('-n');
    expect(Buffer.from(captured.stdinBase64, 'base64')).toEqual(Buffer.from(stdinText, 'utf8'));
    expect(captured.args.at(-1)).toContain(quotePosixToken(SSH_WORKSPACE_FILE_HELPER_SOURCE));
  });

  it('retains ignored stdin and OpenSSH -n for ordinary commands', async () => {
    const result = await createSshCommandRunner(executable)({
      hostAlias: 'research-gpu',
      command: '/usr/bin/true',
      timeoutSeconds: 5,
    });
    const captured = JSON.parse(result.stdout) as { args: string[] };

    expect(captured.args).toContain('-n');
  });

  it('accepts only the exact larger fixed helper on the bounded stdin channel', async () => {
    const appOwnedSource = `exec(${JSON.stringify('pass\n'.repeat(700))})`;
    const runner = createSshCommandRunner(executable);
    const result = await runner.executeWorkspaceFileHelper('stdin-capture', HELPER_COMMAND, '{}');
    const captured = JSON.parse(result.stdout) as { args: string[] };

    expect(captured.args.at(-1)).toContain(quotePosixToken(SSH_WORKSPACE_FILE_HELPER_SOURCE));
    expect(() =>
      runner.executeWorkspaceFileHelper(
        'stdin-capture',
        { ...HELPER_COMMAND, args: ['-I', '-S', '-c', appOwnedSource] },
        '{}',
      ),
    ).toThrow(expect.objectContaining<Partial<SshCommandError>>({ kind: 'connection_failed' }));
    expect(() =>
      runner({
        hostAlias: 'research-gpu',
        command: '/usr/bin/python3',
        args: ['-c', appOwnedSource],
        timeoutSeconds: 5,
      }),
    ).toThrow(expect.objectContaining<Partial<SshCommandError>>({ kind: 'connection_failed' }));
  });

  it('rejects a stdin payload larger than 64 KiB before opening SSH', () => {
    expect(() =>
      createSshCommandRunner(executable).executeWorkspaceFileHelper(
        'stdin-capture',
        HELPER_COMMAND,
        '한'.repeat(Math.ceil(SSH_WORKSPACE_FILE_MAX_STDIN_BYTES / 3) + 1),
      ),
    ).toThrow(expect.objectContaining<Partial<SshCommandError>>({ kind: 'connection_failed' }));
  });

  it('returns bounded output and marks truncation without retaining the discarded suffix', async () => {
    const result = await createSshCommandRunner(executable)(
      { hostAlias: 'large-output', command: 'true', timeoutSeconds: 5 },
      { maxOutputCharacters: 64 },
    );

    expect(result.stdout).toBe('x'.repeat(64));
    expect(result.stderr).toBe('');
    expect(result.truncated).toBe(true);
  });

  it('applies one combined stdout and stderr limit', async () => {
    const result = await createSshCommandRunner(executable)(
      { hostAlias: 'mixed-output', command: 'true', timeoutSeconds: 5 },
      { maxOutputCharacters: 64 },
    );

    expect(result.stdout.length + result.stderr.length).toBe(64);
    expect(result.truncated).toBe(true);
  });

  it('returns a remote program non-zero exit status as bounded command output', async () => {
    await expect(
      createSshCommandRunner(executable)({
        hostAlias: 'remote-failed',
        command: 'fixture-command',
        timeoutSeconds: 5,
      }),
    ).resolves.toMatchObject({ exitCode: 7, stderr: 'fixture command failed' });
  });

  it('suppresses successful OpenSSH client warnings while preserving remote stderr', async () => {
    const result = await createSshCommandRunner(executable)({
      hostAlias: 'local-warning',
      command: 'fixture-command',
      timeoutSeconds: 5,
    });

    expect(result).toMatchObject({ exitCode: 0, stderr: 'remote program warning' });
    expect(JSON.stringify(result)).not.toContain('/Users/researcher');
    expect(JSON.stringify(result)).not.toContain('Identity file');
  });

  it('fails closed on ambiguous exit 255 without returning its stderr as remote output', async () => {
    await expect(
      createSshCommandRunner(executable)({
        hostAlias: 'remote-exit-255',
        command: 'fixture-command',
        timeoutSeconds: 5,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SshCommandError>>({ kind: 'connection_failed' }),
    );
  });

  it.each([
    ['unknown-host', 'unknown_host_key'],
    ['auth-failed', 'authentication_failed'],
  ] as const)('maps %s failures to a bounded category', async (hostAlias, kind) => {
    await expect(
      createSshCommandRunner(executable)({ hostAlias, command: 'true', timeoutSeconds: 5 }),
    ).rejects.toEqual(expect.objectContaining<Partial<SshCommandError>>({ kind }));
  });

  it('aborts an active SSH process without returning partial output', async () => {
    const controller = new AbortController();
    const running = createSshCommandRunner(executable)(
      { hostAlias: 'wait-forever', command: 'true', timeoutSeconds: 30 },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 30);

    await expect(running).rejects.toEqual(
      expect.objectContaining<Partial<SshCommandError>>({ kind: 'cancelled' }),
    );
  });
});
