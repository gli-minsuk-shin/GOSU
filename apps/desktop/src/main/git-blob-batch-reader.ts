import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const FULL_GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const HEADER_ALLOWANCE_BYTES = 192;

const SAFE_GIT_OBJECT_ARGUMENTS = [
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
  'core.attributesFile=/dev/null',
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.file.allow=never',
  '-c',
  'protocol.https.allow=never',
  '-c',
  'credential.helper=',
] as const;

export type GitBlobBatchRequest = Readonly<{
  objectId: string;
  expectedSize: number;
}>;

export type GitBlobBatchLimits = Readonly<{
  maxObjects: number;
  maxObjectBytes: number;
  maxTotalBytes: number;
  timeoutMs?: number;
}>;

export type GitBlobBatchReader = (
  cwd: string,
  requests: readonly GitBlobBatchRequest[],
  limits: GitBlobBatchLimits,
) => Promise<ReadonlyMap<string, Uint8Array>>;

export type GitBlobBatchFailureKind = 'invalid' | 'too_large' | 'timeout' | 'unavailable';

export class GitBlobBatchError extends Error {
  constructor(readonly kind: GitBlobBatchFailureKind) {
    super(kind);
    this.name = 'GitBlobBatchError';
  }
}

function safeEnvironment() {
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
    GIT_ALLOW_PROTOCOL: '',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function validateRequests(requests: readonly GitBlobBatchRequest[], limits: GitBlobBatchLimits) {
  if (
    !Number.isSafeInteger(limits.maxObjects) ||
    limits.maxObjects < 1 ||
    !Number.isSafeInteger(limits.maxObjectBytes) ||
    limits.maxObjectBytes < 1 ||
    !Number.isSafeInteger(limits.maxTotalBytes) ||
    limits.maxTotalBytes < 1 ||
    requests.length < 1
  ) {
    throw new GitBlobBatchError('invalid');
  }
  if (requests.length > limits.maxObjects) throw new GitBlobBatchError('too_large');
  const objectIds = new Set<string>();
  let totalBytes = 0;
  let objectIdLength = 0;
  for (const request of requests) {
    if (
      !FULL_GIT_OBJECT_ID.test(request.objectId) ||
      !Number.isSafeInteger(request.expectedSize) ||
      request.expectedSize < 0
    ) {
      throw new GitBlobBatchError('invalid');
    }
    if (objectIdLength !== 0 && request.objectId.length !== objectIdLength) {
      throw new GitBlobBatchError('invalid');
    }
    objectIdLength = request.objectId.length;
    if (objectIds.has(request.objectId)) throw new GitBlobBatchError('invalid');
    objectIds.add(request.objectId);
    if (request.expectedSize > limits.maxObjectBytes) {
      throw new GitBlobBatchError('too_large');
    }
    totalBytes += request.expectedSize;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw new GitBlobBatchError('too_large');
    }
  }
  const maximumOutputBytes = totalBytes + requests.length * HEADER_ALLOWANCE_BYTES;
  if (!Number.isSafeInteger(maximumOutputBytes)) throw new GitBlobBatchError('too_large');
  return maximumOutputBytes;
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams) {
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // The process may already have exited or may not have obtained its process group yet.
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Best effort after an exit race.
  }
}

function parseBatchOutput(
  output: Buffer,
  requests: readonly GitBlobBatchRequest[],
): ReadonlyMap<string, Uint8Array> {
  const blobs = new Map<string, Uint8Array>();
  let cursor = 0;
  for (const request of requests) {
    const headerEnd = output.indexOf(0x0a, cursor);
    if (headerEnd < cursor) throw new GitBlobBatchError('invalid');
    const header = output.subarray(cursor, headerEnd).toString('ascii');
    const match = header.match(/^([0-9a-f]{40}|[0-9a-f]{64}) blob (0|[1-9][0-9]*)$/u);
    if (!match || match[1] !== request.objectId || Number(match[2]) !== request.expectedSize) {
      throw new GitBlobBatchError('invalid');
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + request.expectedSize;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new GitBlobBatchError('invalid');
    }
    blobs.set(request.objectId, output.subarray(contentStart, contentEnd));
    cursor = contentEnd + 1;
  }
  if (cursor !== output.length || blobs.size !== requests.length) {
    throw new GitBlobBatchError('invalid');
  }
  return blobs;
}

export function createGitBlobBatchReader(
  executable = process.platform === 'darwin' ? '/usr/bin/git' : 'git',
): GitBlobBatchReader {
  return (cwd, requests, limits) => {
    let maximumOutputBytes: number;
    try {
      maximumOutputBytes = validateRequests(requests, limits);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let outputBytes = 0;
      let stderrBytes = 0;
      const output: Buffer[] = [];
      const child = spawn(executable, [...SAFE_GIT_OBJECT_ARGUMENTS, 'cat-file', '--batch'], {
        cwd,
        env: safeEnvironment(),
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const finish = (error?: GitBlobBatchError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          terminateProcessTree(child);
          reject(error);
          return;
        }
        try {
          resolve(parseBatchOutput(Buffer.concat(output, outputBytes), requests));
        } catch (parseError) {
          reject(
            parseError instanceof GitBlobBatchError ? parseError : new GitBlobBatchError('invalid'),
          );
        }
      };
      const timer = setTimeout(
        () => finish(new GitBlobBatchError('timeout')),
        limits.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      timer.unref();
      child.once('error', () => finish(new GitBlobBatchError('unavailable')));
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return;
        outputBytes += chunk.byteLength;
        if (!Number.isSafeInteger(outputBytes) || outputBytes > maximumOutputBytes) {
          finish(new GitBlobBatchError('too_large'));
          return;
        }
        output.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (settled) return;
        stderrBytes += chunk.byteLength;
        if (!Number.isSafeInteger(stderrBytes) || stderrBytes > DEFAULT_MAX_STDERR_BYTES) {
          finish(new GitBlobBatchError('too_large'));
        }
      });
      child.once('close', (code, signal) => {
        if (code !== 0 || signal !== null) {
          finish(new GitBlobBatchError('unavailable'));
          return;
        }
        finish();
      });
      child.stdin.once('error', () => finish(new GitBlobBatchError('unavailable')));
      child.stdin.end(`${requests.map((request) => request.objectId).join('\n')}\n`, 'ascii');
    });
  };
}
