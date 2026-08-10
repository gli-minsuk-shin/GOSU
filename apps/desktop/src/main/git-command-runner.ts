import { execFile } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const SAFE_GIT_CONFIG = [
  '--no-replace-objects',
  '--literal-pathspecs',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.askPass=/usr/bin/false',
  '-c',
  'core.pager=cat',
  '-c',
  'color.ui=false',
  '-c',
  'log.showSignature=false',
  '-c',
  'merge.verifySignatures=false',
  '-c',
  'merge.autoStash=false',
  '-c',
  'commit.gpgSign=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'diff.external=',
  '-c',
  'core.attributesFile=/dev/null',
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.https.allow=always',
  '-c',
  'http.sslVerify=true',
  '-c',
  'http.followRedirects=initial',
  '-c',
  'credential.helper=',
  ...(process.platform === 'darwin' ? ['-c', 'credential.helper=osxkeychain'] : []),
] as const;

export type GitCommandFailureKind =
  'unavailable' | 'timeout' | 'output_too_large' | 'auth' | 'conflict' | 'failed';

export class GitCommandError extends Error {
  constructor(readonly kind: GitCommandFailureKind) {
    super(kind);
    this.name = 'GitCommandError';
  }
}

export type GitCommandRunner = (
  cwd: string,
  arguments_: readonly string[],
  options?: Readonly<{
    timeoutMs?: number;
    maxBytes?: number;
    network?: boolean;
    allowUserConfig?: boolean;
    signal?: AbortSignal;
  }>,
) => Promise<string>;

function safeEnvironment(allowUserConfig = false) {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/usr/bin/false',
    SSH_ASKPASS: '/usr/bin/false',
    GCM_INTERACTIVE: 'never',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_PAGER: 'cat',
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_ATTR_NOSYSTEM: '1',
    ...(!allowUserConfig ? { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } : {}),
  };
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function classifyFailure(
  error: Readonly<{ code?: string | number | null; killed?: boolean }>,
  stderr: string,
) {
  if (
    error.code === 'ENOENT' ||
    /xcrun: error|command line tools|active developer path|unable to find utility.+git/iu.test(
      stderr,
    )
  )
    return 'unavailable' as const;
  if (error.killed || error.code === 'ETIMEDOUT') return 'timeout' as const;
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'output_too_large' as const;
  if (
    /authentication failed|could not read username|terminal prompts disabled|permission denied|repository not found/iu.test(
      stderr,
    )
  ) {
    return 'auth' as const;
  }
  if (
    /\bconflict\b|unmerged files|would be overwritten|not possible to fast-forward|divergent branches/iu.test(
      stderr,
    )
  ) {
    return 'conflict' as const;
  }
  return 'failed' as const;
}

export function createGitCommandRunner(
  executable = process.platform === 'darwin' ? '/usr/bin/git' : 'git',
): GitCommandRunner {
  return (cwd, arguments_, options = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        executable,
        [...SAFE_GIT_CONFIG, ...arguments_],
        {
          cwd,
          env: safeEnvironment(Boolean(options.allowUserConfig)),
          encoding: 'utf8',
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: options.maxBytes ?? DEFAULT_MAX_BYTES,
          windowsHide: true,
          signal: options.signal,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new GitCommandError(classifyFailure(error, stderr)));
            return;
          }
          resolve(stdout);
        },
      );
    });
}
