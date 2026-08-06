import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SshWorkspaceFileOperation } from '../src/shared/ssh-workspace-contracts';
import {
  SSH_WORKSPACE_FILE_HELPER_PROGRAM,
  SSH_WORKSPACE_FILE_HELPER_SOURCE,
  buildSshWorkspaceFileInvocation,
  parseSshWorkspaceFileOutput,
} from '../src/main/ssh-workspace-files';
import type {
  SshWorkspaceFileInvocation,
  SshWorkspaceFileProtocolError,
} from '../src/main/ssh-workspace-files';

const invocationIdentity = {
  projectId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  attemptId: '33333333-3333-4333-8333-333333333333',
  turnId: '44444444-4444-4444-8444-444444444444',
  toolCallId: '55555555-5555-4555-8555-555555555555',
  connectionId: '66666666-6666-4666-8666-666666666666',
  grantId: '77777777-7777-4777-8777-777777777777',
} as const;

type HelperResult = Readonly<{ exitCode: number | null; stdout: string; stderr: string }>;

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function runHelper(invocation: SshWorkspaceFileInvocation): Promise<HelperResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => {
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    child.stdin.end(Buffer.from(invocation.stdinText, 'utf8'));
  });
}

function operation(
  value:
    | Readonly<{ action: 'list'; maxEntries?: number }>
    | Readonly<{ action: 'read'; relativePath: string; offset?: number; maxCharacters?: number }>
    | Readonly<{
        action: 'write';
        relativePath: string;
        content: string;
        expectedSha256: string | null;
      }>,
) {
  return { ...invocationIdentity, ...value } as SshWorkspaceFileOperation;
}

describe('fixed remote workspace file helper', () => {
  let temporaryDirectory: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'gosu-workspace-files-'));
    await mkdir(join(temporaryDirectory, 'workspace'));
    workspaceRoot = await realpath(join(temporaryDirectory, 'workspace'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('keeps the executable and helper source app-owned and sends only bounded JSON on stdin', () => {
    const invocation = buildSshWorkspaceFileInvocation(
      operation({
        action: 'write',
        relativePath: 'analysis/example.py',
        content: 'print("model supplied content")\n',
        expectedSha256: null,
      }),
      workspaceRoot,
      workspaceRoot,
    );

    expect(invocation.command).toBe('/usr/bin/python3');
    expect(invocation.args).toEqual(['-I', '-S', '-c', SSH_WORKSPACE_FILE_HELPER_SOURCE]);
    expect(SSH_WORKSPACE_FILE_HELPER_SOURCE.length).toBeLessThanOrEqual(32 * 1024);
    expect([...SSH_WORKSPACE_FILE_HELPER_SOURCE].some((character) => character <= '\u001f')).toBe(
      false,
    );
    expect(invocation.args.join(' ')).not.toContain('model supplied content');
    expect(JSON.parse(invocation.stdinText)).toMatchObject({
      schemaVersion: 1,
      action: 'write',
      workspaceRoot,
      workingDirectory: workspaceRoot,
      relativePath: 'analysis/example.py',
      content: 'print("model supplied content")\n',
      expectedSha256: null,
    });
    expect(Buffer.byteLength(invocation.stdinText, 'utf8')).toBeLessThanOrEqual(64 * 1024);
  });

  it('creates, reads, lists, and hash-checks an atomic UTF-8 source replacement', async () => {
    await mkdir(join(workspaceRoot, 'analysis'));
    const initial = 'print("처음")\n';
    const create = await runHelper(
      buildSshWorkspaceFileInvocation(
        operation({
          action: 'write',
          relativePath: 'analysis/example.py',
          content: initial,
          expectedSha256: null,
        }),
        workspaceRoot,
        workspaceRoot,
      ),
    );

    expect(create.exitCode).toBe(0);
    expect(create.stderr).toBe('');
    expect(parseSshWorkspaceFileOutput(create.stdout)).toEqual({
      schemaVersion: 1,
      action: 'write',
      relativePath: 'analysis/example.py',
      created: true,
      previousSha256: null,
      contentSha256: sha256(initial),
      sizeBytes: Buffer.byteLength(initial),
    });
    expect(await readFile(join(workspaceRoot, 'analysis/example.py'), 'utf8')).toBe(initial);

    const read = await runHelper(
      buildSshWorkspaceFileInvocation(
        operation({
          action: 'read',
          relativePath: 'analysis/example.py',
          offset: 0,
          maxCharacters: 3,
        }),
        workspaceRoot,
        workspaceRoot,
      ),
    );
    expect(parseSshWorkspaceFileOutput(read.stdout)).toMatchObject({
      action: 'read',
      relativePath: 'analysis/example.py',
      content: 'pri',
      contentSha256: sha256(initial),
      offset: 0,
      nextOffset: 3,
      totalCharacters: initial.length,
      truncated: true,
    });

    const list = await runHelper(
      buildSshWorkspaceFileInvocation(
        operation({ action: 'list', maxEntries: 20 }),
        workspaceRoot,
        workspaceRoot,
      ),
    );
    expect(parseSshWorkspaceFileOutput(list.stdout)).toEqual({
      schemaVersion: 1,
      action: 'list',
      entries: [
        {
          relativePath: 'analysis/example.py',
          sizeBytes: Buffer.byteLength(initial),
        },
      ],
      truncated: false,
    });

    await chmod(join(workspaceRoot, 'analysis/example.py'), 0o755);
    const replacement = 'print("updated")\n';
    const replace = await runHelper(
      buildSshWorkspaceFileInvocation(
        operation({
          action: 'write',
          relativePath: 'analysis/example.py',
          content: replacement,
          expectedSha256: sha256(initial),
        }),
        workspaceRoot,
        workspaceRoot,
      ),
    );
    expect(parseSshWorkspaceFileOutput(replace.stdout)).toMatchObject({
      action: 'write',
      created: false,
      previousSha256: sha256(initial),
      contentSha256: sha256(replacement),
    });
    expect((await stat(join(workspaceRoot, 'analysis/example.py'))).mode & 0o777).toBe(0o755);
    expect(await readFile(join(workspaceRoot, 'analysis/example.py'), 'utf8')).toBe(replacement);
  });

  it('fails a stale replace without changing the remote file', async () => {
    const path = join(workspaceRoot, 'result.py');
    await writeFile(path, 'print("current")\n');
    const stale = await runHelper(
      buildSshWorkspaceFileInvocation(
        operation({
          action: 'write',
          relativePath: 'result.py',
          content: 'print("stale overwrite")\n',
          expectedSha256: '0'.repeat(64),
        }),
        workspaceRoot,
        workspaceRoot,
      ),
    );

    expect(stale.exitCode).toBe(3);
    expect(parseSshWorkspaceFileOutput(stale.stdout)).toEqual({
      schemaVersion: 1,
      action: 'write',
      error: 'ssh_workspace_file_conflict',
    });
    expect(await readFile(path, 'utf8')).toBe('print("current")\n');
  });

  it('reports an uncertain commit when confirmation fails after the atomic mutation', async () => {
    const path = join(workspaceRoot, 'uncertain.py');
    const invocation = buildSshWorkspaceFileInvocation(
      operation({
        action: 'write',
        relativePath: 'uncertain.py',
        content: 'print("committed")\n',
        expectedSha256: null,
      }),
      workspaceRoot,
      workspaceRoot,
    );
    const failingProgram = SSH_WORKSPACE_FILE_HELPER_PROGRAM.replace(
      'os.fsync(parent)',
      "raise OSError('fixture post-commit confirmation failure')",
    );
    expect(failingProgram).not.toBe(SSH_WORKSPACE_FILE_HELPER_PROGRAM);

    const result = await runHelper({
      ...invocation,
      args: ['-I', '-S', '-c', `exec(${JSON.stringify(failingProgram)})`],
    });

    expect(result.exitCode).toBe(3);
    expect(parseSshWorkspaceFileOutput(result.stdout)).toEqual({
      schemaVersion: 1,
      action: 'write',
      error: 'ssh_workspace_file_commit_uncertain',
    });
    expect(await readFile(path, 'utf8')).toBe('print("committed")\n');
  });

  it('uses Unicode scalar offsets for astral text pagination', async () => {
    await writeFile(join(workspaceRoot, 'unicode.txt'), 'A😀B');
    const result = await runHelper(
      buildSshWorkspaceFileInvocation(
        operation({ action: 'read', relativePath: 'unicode.txt', offset: 1, maxCharacters: 1 }),
        workspaceRoot,
        workspaceRoot,
      ),
    );

    expect(parseSshWorkspaceFileOutput(result.stdout)).toMatchObject({
      action: 'read',
      content: '😀',
      offset: 1,
      nextOffset: 2,
      totalCharacters: 3,
      truncated: true,
    });
  });

  it('rejects traversal, secret-like names, symlinks, and binary content on the remote host', async () => {
    const outside = join(workspaceRoot, '..', 'outside-file.txt');
    await writeFile(outside, 'outside');
    await writeFile(join(workspaceRoot, '.env.local'), 'TOKEN=fixture');
    await symlink(outside, join(workspaceRoot, 'linked.txt'));
    await writeFile(join(workspaceRoot, 'binary.dat'), Buffer.from([0, 1, 2, 3]));

    const base = buildSshWorkspaceFileInvocation(
      operation({ action: 'list', maxEntries: 10 }),
      workspaceRoot,
      workspaceRoot,
    );
    const maliciousRequest = (request: Record<string, unknown>) =>
      runHelper({ ...base, stdinText: JSON.stringify(request) });
    const common = {
      schemaVersion: 1,
      workspaceRoot,
      workingDirectory: workspaceRoot,
    };

    for (const relativePath of ['../outside-file.txt', '.env.local', 'linked.txt']) {
      const result = await maliciousRequest({
        ...common,
        action: 'read',
        relativePath,
        offset: 0,
        maxCharacters: 100,
      });
      expect(result.exitCode).toBe(3);
      expect(parseSshWorkspaceFileOutput(result.stdout)).toMatchObject({
        action: 'read',
        error: 'ssh_workspace_file_not_allowed',
      });
    }

    const surrogatePath = await maliciousRequest({
      ...common,
      action: 'read',
      relativePath: 'raw\uDCFF.py',
      offset: 0,
      maxCharacters: 100,
    });
    expect(surrogatePath.exitCode).toBe(3);
    expect(parseSshWorkspaceFileOutput(surrogatePath.stdout)).toEqual({
      schemaVersion: 1,
      action: 'read',
      error: 'ssh_workspace_file_invalid',
    });

    const binary = await maliciousRequest({
      ...common,
      action: 'read',
      relativePath: 'binary.dat',
      offset: 0,
      maxCharacters: 100,
    });
    expect(parseSshWorkspaceFileOutput(binary.stdout)).toMatchObject({
      action: 'read',
      error: 'ssh_workspace_file_not_allowed',
    });
    expect(await readFile(outside, 'utf8')).toBe('outside');
  });

  it('bounds list output and omits secret-like and symlink entries', async () => {
    await mkdir(join(workspaceRoot, 'src'));
    for (let index = 0; index < 30; index += 1) {
      await writeFile(
        join(workspaceRoot, 'src', `file-${index.toString().padStart(2, '0')}.ts`),
        'x',
      );
    }
    await writeFile(join(workspaceRoot, '.env'), 'SECRET=fixture');
    await writeFile(join(workspaceRoot, 'bad\\name.ts'), 'x');
    await writeFile(join(workspaceRoot, ' padded.ts'), 'x');
    await writeFile(join(workspaceRoot, 'hidden\u202Etxt.py'), 'x');
    await symlink(join(workspaceRoot, 'src', 'file-00.ts'), join(workspaceRoot, 'linked.ts'));

    const result = await runHelper(
      buildSshWorkspaceFileInvocation(
        operation({ action: 'list', maxEntries: 5 }),
        workspaceRoot,
        workspaceRoot,
      ),
    );
    const parsed = parseSshWorkspaceFileOutput(result.stdout);

    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(32 * 1024);
    expect(parsed).toMatchObject({ action: 'list', truncated: true });
    if ('entries' in parsed) {
      expect(parsed.entries).toHaveLength(5);
      expect(parsed.entries.every((entry) => entry.relativePath.startsWith('src/file-'))).toBe(
        true,
      );
      expect(parsed.entries.some((entry) => entry.relativePath.includes('\u202E'))).toBe(false);
    }
  });

  it.skipIf(process.platform !== 'linux')(
    'skips a pre-existing non-UTF-8 filename without invalidating the full listing',
    async () => {
      await writeFile(join(workspaceRoot, 'visible.py'), 'print("visible")\n');
      const rawPath = Buffer.concat([
        Buffer.from(`${workspaceRoot}/raw-`, 'utf8'),
        Buffer.from([0xff]),
        Buffer.from('.py', 'utf8'),
      ]);
      await writeFile(rawPath, 'print("raw")\n');

      const result = await runHelper(
        buildSshWorkspaceFileInvocation(
          operation({ action: 'list', maxEntries: 20 }),
          workspaceRoot,
          workspaceRoot,
        ),
      );

      expect(result.exitCode).toBe(0);
      expect(parseSshWorkspaceFileOutput(result.stdout)).toEqual({
        schemaVersion: 1,
        action: 'list',
        entries: [{ relativePath: 'visible.py', sizeBytes: 17 }],
        truncated: false,
      });
    },
  );

  it('rejects oversized input and malformed or over-permissive helper output', () => {
    expect(() =>
      buildSshWorkspaceFileInvocation(
        operation({
          action: 'write',
          relativePath: 'large.txt',
          content: '한'.repeat(20_000),
          expectedSha256: null,
        }),
        workspaceRoot,
        workspaceRoot,
      ),
    ).toThrow(
      expect.objectContaining<Partial<SshWorkspaceFileProtocolError>>({
        kind: 'input_too_large',
      }),
    );
    expect(() => parseSshWorkspaceFileOutput('not-json')).toThrow(
      expect.objectContaining<Partial<SshWorkspaceFileProtocolError>>({ kind: 'invalid_output' }),
    );
    expect(() =>
      parseSshWorkspaceFileOutput(
        JSON.stringify({
          schemaVersion: 1,
          action: 'list',
          entries: [],
          truncated: false,
          unexpected: true,
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<SshWorkspaceFileProtocolError>>({
        kind: 'invalid_output',
      }),
    );
    expect(() =>
      parseSshWorkspaceFileOutput(
        JSON.stringify({
          schemaVersion: 1,
          action: 'read',
          relativePath: '.env.local',
          content: 'SECRET=fixture',
          contentSha256: '0'.repeat(64),
          offset: 0,
          nextOffset: null,
          totalCharacters: 14,
          truncated: false,
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<SshWorkspaceFileProtocolError>>({
        kind: 'invalid_output',
      }),
    );
  });
});
