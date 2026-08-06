import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SSH_COMMAND_MAX_OUTPUT_CHARACTERS,
  SshDirectTargetSchema,
  type SshAgentCommand,
  type SshDirectTarget,
} from '../shared/ssh-contracts';
import {
  SSH_WORKSPACE_FILE_HELPER_SOURCE,
  SSH_WORKSPACE_FILE_MAX_STDIN_BYTES,
} from './ssh-workspace-files';

const DEFAULT_EXECUTABLE = process.platform === 'darwin' ? '/usr/bin/ssh' : 'ssh';
const KILL_GRACE_MS = 500;
const CLIENT_DIAGNOSTIC_DIRECTORY_PREFIX = 'gosu-ssh-client-';
const SSH_COMMAND_MAX_INTERNAL_ARGUMENT_CHARACTERS = 32 * 1024;

export type SshCommandFailureKind =
  | 'unavailable'
  | 'unknown_host_key'
  | 'authentication_failed'
  | 'connection_failed'
  | 'timed_out'
  | 'output_too_large'
  | 'cancelled';

export class SshCommandRunnerError extends Error {
  constructor(readonly kind: SshCommandFailureKind) {
    super(kind);
    this.name = 'SshCommandRunnerError';
  }
}

export { SshCommandRunnerError as SshCommandError };

export type SshProcessResult = Readonly<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}>;

export type SshCommandRunOptions = Readonly<{
  signal?: AbortSignal;
  maxOutputCharacters?: number;
  failOnOutputLimit?: boolean;
}>;

type SshInternalRunOptions = SshCommandRunOptions & Readonly<{ stdinText?: string }>;

export type SshRunnableCommand = Readonly<{
  hostAlias: string;
  directTarget?: SshDirectTarget;
  command: string;
  args?: readonly string[];
  workingDirectory?: string;
  timeoutSeconds: number;
}>;

export interface SshCommandRunner {
  (command: SshRunnableCommand, options?: SshCommandRunOptions): Promise<SshProcessResult>;
  testConnection(
    hostAlias: string,
    timeoutSeconds?: number,
    options?: SshCommandRunOptions,
    directTarget?: SshDirectTarget,
  ): Promise<void>;
  execute(
    hostAlias: string,
    command: SshAgentCommand,
    options?: SshCommandRunOptions,
    directTarget?: SshDirectTarget,
  ): Promise<SshProcessResult>;
  executeWorkspaceFileHelper(
    hostAlias: string,
    command: SshAgentCommand,
    stdinText: string,
    options?: SshCommandRunOptions,
    directTarget?: SshDirectTarget,
  ): Promise<SshProcessResult>;
}

export type SshCommandRunnerFactoryOptions = Readonly<{
  executable?: string;
  maxOutputBytes?: number;
}>;

function safeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: 'C',
    SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
    SSH_ASKPASS: '/usr/bin/false',
    SSH_ASKPASS_REQUIRE: 'never',
  };
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** Encode one already-validated token for the remote POSIX shell used by OpenSSH. */
export function quotePosixToken(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function safeOptions(timeoutSeconds: number, pipeStdin = false) {
  const connectTimeout = Math.max(1, Math.min(10, Math.floor(timeoutSeconds)));
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'PermitLocalCommand=no',
    '-o',
    'RequestTTY=no',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ForwardX11=no',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    'NumberOfPasswordPrompts=0',
    '-o',
    'LogLevel=ERROR',
    '-o',
    'EscapeChar=none',
    '-o',
    'ControlMaster=no',
    '-o',
    'ForkAfterAuthentication=no',
    '-o',
    'Tunnel=no',
    '-o',
    'GatewayPorts=no',
    '-o',
    `ConnectTimeout=${connectTimeout}`,
    '-T',
    ...(pipeStdin ? [] : ['-n']),
  ] as const;
}

export function buildRemoteCommand(
  command: Readonly<{
    command: string;
    args?: readonly string[] | undefined;
    workingDirectory?: string | undefined;
  }>,
) {
  const executable = [command.command, ...(command.args ?? [])].map(quotePosixToken).join(' ');
  return command.workingDirectory
    ? `cd ${quotePosixToken(command.workingDirectory)} && exec ${executable}`
    : `exec ${executable}`;
}

export function buildSshArguments(hostAlias: string, command: SshAgentCommand) {
  return buildSshArgumentsForTarget(hostAlias, command);
}

function directTargetArguments(target: SshDirectTarget | undefined) {
  if (!target) return [] as const;
  const parsed = SshDirectTargetSchema.parse(target);
  return [
    '-F',
    'none',
    ...(parsed.user ? ['-l', parsed.user] : []),
    ...(parsed.port ? ['-p', String(parsed.port)] : []),
  ] as const;
}

export function buildSshArgumentsForTarget(
  hostAlias: string,
  command: SshAgentCommand,
  directTarget?: SshDirectTarget,
) {
  return [
    ...safeOptions(command.timeoutSeconds),
    ...directTargetArguments(directTarget),
    '--',
    directTarget?.host ?? hostAlias,
    buildRemoteCommand(command),
  ] as const;
}

function classifyTransportDiagnostic(stderr: string): SshCommandFailureKind | null {
  if (
    /host key verification failed|remote host identification has changed|no .+ host key is known/iu.test(
      stderr,
    )
  ) {
    return 'unknown_host_key';
  }
  if (
    /permission denied|authentication failed|no supported authentication methods/iu.test(stderr)
  ) {
    return 'authentication_failed';
  }
  if (
    /ssh: connect to host|could not resolve hostname|connection (?:closed|refused|reset|timed out)|kex_exchange_identification|network is unreachable|no route to host|operation timed out|broken pipe/iu.test(
      stderr,
    )
  ) {
    return 'connection_failed';
  }
  return null;
}

async function createClientDiagnosticLog() {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), CLIENT_DIAGNOSTIC_DIRECTORY_PREFIX));
    const path = join(directory, 'openssh.log');
    await writeFile(path, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { directory, path };
  } catch {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw new SshCommandRunnerError('unavailable');
  }
}

function isolateClientDiagnostics(arguments_: readonly string[], clientDiagnosticPath: string) {
  const optionBoundary = arguments_.indexOf('--');
  if (optionBoundary < 0) throw new SshCommandRunnerError('connection_failed');
  return [
    ...arguments_.slice(0, optionBoundary),
    '-E',
    clientDiagnosticPath,
    ...arguments_.slice(optionBoundary),
  ];
}

function isAbortError(signal: AbortSignal | undefined) {
  return signal?.aborted === true;
}

function validateRequest(command: SshRunnableCommand, maxArgumentCharacters = 1_024) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(command.hostAlias)) {
    throw new SshCommandRunnerError('connection_failed');
  }
  if (!/^(?!-)[A-Za-z0-9_./+:-]{1,128}$/u.test(command.command)) {
    throw new SshCommandRunnerError('connection_failed');
  }
  if (
    !Number.isInteger(command.timeoutSeconds) ||
    command.timeoutSeconds < 1 ||
    command.timeoutSeconds > 120 ||
    (command.args?.length ?? 0) > 32 ||
    [command.workingDirectory, ...(command.args ?? [])].some(
      (value) =>
        value !== undefined &&
        (value.length > maxArgumentCharacters ||
          [...value].some((character) => {
            const code = character.codePointAt(0) ?? 0;
            return code <= 31 || (code >= 127 && code <= 159);
          })),
    ) ||
    (command.workingDirectory !== undefined && !command.workingDirectory.startsWith('/'))
  ) {
    throw new SshCommandRunnerError('connection_failed');
  }
  if (command.directTarget && !SshDirectTargetSchema.safeParse(command.directTarget).success) {
    throw new SshCommandRunnerError('connection_failed');
  }
}

function validateInternalRunOptions(options: SshInternalRunOptions) {
  if (
    options.stdinText !== undefined &&
    Buffer.byteLength(options.stdinText, 'utf8') > SSH_WORKSPACE_FILE_MAX_STDIN_BYTES
  ) {
    throw new SshCommandRunnerError('connection_failed');
  }
}

export function createSshCommandRunner(
  optionsOrExecutable: SshCommandRunnerFactoryOptions | string = {},
): SshCommandRunner {
  const options =
    typeof optionsOrExecutable === 'string'
      ? { executable: optionsOrExecutable }
      : optionsOrExecutable;
  const executable = options.executable ?? DEFAULT_EXECUTABLE;
  const maxOutputBytes = Math.max(
    1,
    Math.min(options.maxOutputBytes ?? SSH_COMMAND_MAX_OUTPUT_CHARACTERS, 4 * 1024 * 1024),
  );

  const run = async (
    arguments_: readonly string[],
    timeoutSeconds: number,
    runOptions: SshInternalRunOptions = {},
  ) => {
    validateInternalRunOptions(runOptions);
    if (isAbortError(runOptions.signal)) throw new SshCommandRunnerError('cancelled');
    const clientDiagnostic = await createClientDiagnosticLog();

    try {
      if (isAbortError(runOptions.signal)) throw new SshCommandRunnerError('cancelled');
      return await new Promise<SshProcessResult>((resolve, reject) => {
        const isolatedArguments = isolateClientDiagnostics(arguments_, clientDiagnostic.path);
        const startedAt = Date.now();
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let capturedBytes = 0;
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let settled = false;
        let timedOut = false;
        let outputLimited = false;
        let cancelled = false;
        let forceKillTimer: NodeJS.Timeout | undefined;

        const pipeStdin = runOptions.stdinText !== undefined;
        const child = spawn(executable, isolatedArguments, {
          env: safeEnvironment(),
          shell: false,
          stdio: [pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        if (pipeStdin) {
          // The byte cap is validated before spawning. Buffering once avoids
          // platform newline conversion and sends the exact UTF-8 payload.
          child.stdin?.on('error', () => undefined);
          child.stdin?.end(Buffer.from(runOptions.stdinText!, 'utf8'));
        }

        // This stops only the local OpenSSH transport. It does not claim that the
        // remote process tree was terminated after connectivity is lost.
        const stopLocalTransport = () => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill('SIGTERM');
          forceKillTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          }, KILL_GRACE_MS);
          forceKillTimer.unref?.();
        };
        const timeout = setTimeout(() => {
          timedOut = true;
          stopLocalTransport();
        }, timeoutSeconds * 1_000);
        timeout.unref?.();
        const abort = () => {
          cancelled = true;
          stopLocalTransport();
        };
        runOptions.signal?.addEventListener('abort', abort, { once: true });

        const outputLimit = Math.max(
          1,
          Math.min(runOptions.maxOutputCharacters ?? maxOutputBytes, maxOutputBytes),
        );
        const append = (target: Buffer[], chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const remaining = outputLimit - capturedBytes;
          if (buffer.byteLength > remaining) {
            outputLimited = true;
            if (remaining > 0) target.push(buffer.subarray(0, remaining));
            capturedBytes = outputLimit;
            if (runOptions.failOnOutputLimit) stopLocalTransport();
            return Math.max(0, remaining);
          }
          target.push(buffer);
          capturedBytes += buffer.byteLength;
          return buffer.byteLength;
        };
        child.stdout!.on('data', (chunk: Buffer | string) => {
          stdoutBytes += append(stdout, chunk);
        });
        child.stderr!.on('data', (chunk: Buffer | string) => {
          stderrBytes += append(stderr, chunk);
        });

        const cleanup = () => {
          clearTimeout(timeout);
          if (forceKillTimer) clearTimeout(forceKillTimer);
          runOptions.signal?.removeEventListener('abort', abort);
        };
        const fail = (kind: SshCommandFailureKind) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new SshCommandRunnerError(kind));
        };

        child.once('error', (error: NodeJS.ErrnoException) => {
          fail(error.code === 'ENOENT' ? 'unavailable' : 'connection_failed');
        });
        child.once('close', (code) => {
          void (async () => {
            if (settled) return;
            cleanup();
            if (outputLimited && runOptions.failOnOutputLimit) {
              fail('output_too_large');
              return;
            }
            if (cancelled) {
              fail('cancelled');
              return;
            }
            if (timedOut) {
              fail('timed_out');
              return;
            }
            const stdoutText = Buffer.concat(stdout, stdoutBytes).toString('utf8');
            const stderrText = Buffer.concat(stderr, stderrBytes).toString('utf8');
            const clientDiagnosticText = await readFile(clientDiagnostic.path, 'utf8').catch(
              () => '',
            );
            if (settled) return;
            if (code === null) {
              fail('connection_failed');
              return;
            }
            // Exit 255 is ambiguous: OpenSSH reserves it for client/transport failures,
            // while a remote program can also return it. Fail closed so local config,
            // user, and key-path diagnostics can never become model-visible output.
            if (code === 255) {
              fail(classifyTransportDiagnostic(clientDiagnosticText) ?? 'connection_failed');
              return;
            }
            settled = true;
            resolve({
              exitCode: code,
              stdout: stdoutText,
              stderr: stderrText,
              truncated: outputLimited,
              durationMs: Math.max(0, Date.now() - startedAt),
            });
          })().catch(() => fail('connection_failed'));
        });
      });
    } finally {
      await rm(clientDiagnostic.directory, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const callable = ((command: SshRunnableCommand, runOptions: SshCommandRunOptions = {}) => {
    validateRequest(command);
    return run(
      [
        ...safeOptions(command.timeoutSeconds),
        ...directTargetArguments(command.directTarget),
        '--',
        command.directTarget?.host ?? command.hostAlias,
        buildRemoteCommand(command),
      ],
      command.timeoutSeconds,
      runOptions,
    );
  }) as SshCommandRunner;

  return Object.assign(callable, {
    async testConnection(
      hostAlias: string,
      timeoutSeconds = 10,
      runOptions: SshCommandRunOptions = {},
      directTarget?: SshDirectTarget,
    ) {
      const safeTimeout = Math.max(1, Math.min(10, Math.floor(timeoutSeconds)));
      await callable(
        {
          hostAlias,
          ...(directTarget ? { directTarget } : {}),
          command: 'true',
          timeoutSeconds: safeTimeout,
        },
        runOptions,
      );
    },
    execute(
      hostAlias: string,
      input: SshAgentCommand,
      runOptions: SshCommandRunOptions = {},
      directTarget?: SshDirectTarget,
    ) {
      return callable(
        {
          hostAlias,
          ...(directTarget ? { directTarget } : {}),
          command: input.command,
          args: input.args,
          ...(input.workingDirectory === undefined
            ? {}
            : { workingDirectory: input.workingDirectory }),
          timeoutSeconds: input.timeoutSeconds,
        },
        {
          ...runOptions,
          failOnOutputLimit: runOptions.failOnOutputLimit ?? true,
        },
      );
    },
    executeWorkspaceFileHelper(
      hostAlias: string,
      input: SshAgentCommand,
      stdinText: string,
      runOptions: SshCommandRunOptions = {},
      directTarget?: SshDirectTarget,
    ) {
      const expectedArguments = ['-I', '-S', '-c', SSH_WORKSPACE_FILE_HELPER_SOURCE];
      if (
        input.command !== '/usr/bin/python3' ||
        input.workingDirectory !== undefined ||
        input.timeoutSeconds !== 30 ||
        input.args?.length !== expectedArguments.length ||
        input.args.some((argument, index) => argument !== expectedArguments[index])
      ) {
        throw new SshCommandRunnerError('connection_failed');
      }
      const runnable: SshRunnableCommand = {
        hostAlias,
        ...(directTarget ? { directTarget } : {}),
        command: input.command,
        args: input.args,
        timeoutSeconds: input.timeoutSeconds,
      };
      validateRequest(runnable, SSH_COMMAND_MAX_INTERNAL_ARGUMENT_CHARACTERS);
      const internalOptions: SshInternalRunOptions = {
        ...runOptions,
        failOnOutputLimit: runOptions.failOnOutputLimit ?? true,
        stdinText,
      };
      validateInternalRunOptions(internalOptions);
      return run(
        [
          ...safeOptions(input.timeoutSeconds, true),
          ...directTargetArguments(directTarget),
          '--',
          directTarget?.host ?? hostAlias,
          buildRemoteCommand(input),
        ],
        input.timeoutSeconds,
        internalOptions,
      );
    },
  });
}
