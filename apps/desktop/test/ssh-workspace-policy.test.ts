import { describe, expect, it } from 'vitest';

import {
  RemoteWorkspaceGrantSchema,
  RemoteWorkspaceRootSchema,
  type SshWorkspaceAgentCommand,
} from '../src/shared/ssh-workspace-contracts';
import {
  classifyWorkspaceCommand,
  hardenWorkspaceCommand,
  resolveWorkspaceWorkingDirectory,
} from '../src/main/ssh-workspace-policy';

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

const grant = RemoteWorkspaceGrantSchema.parse({
  schemaVersion: 1,
  id: GRANT_ID,
  projectId: PROJECT_ID,
  connectionId: CONNECTION_ID,
  canonicalRoot: '/root/research-project',
  permissionMode: 'workspace',
  version: 1,
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
});

function command(
  executable: string,
  args: readonly string[] = [],
  overrides: Partial<SshWorkspaceAgentCommand> = {},
): SshWorkspaceAgentCommand {
  return {
    projectId: PROJECT_ID,
    sessionId: '44444444-4444-4444-8444-444444444444',
    attemptId: '55555555-5555-4555-8555-555555555555',
    turnId: 'turn-fixture',
    toolCallId: 'tool-fixture',
    connectionId: CONNECTION_ID,
    grantId: GRANT_ID,
    command: executable,
    args: [...args],
    timeoutSeconds: 30,
    ...overrides,
  };
}

describe('remote workspace boundary', () => {
  it.each(['/workspace', '/app', '/root/project', '/home/research/project', '/srv/project'])(
    'accepts the bounded workspace root %s',
    (root) => expect(RemoteWorkspaceRootSchema.safeParse(root).success).toBe(true),
  );

  it.each([
    '/',
    '/root',
    '/etc',
    '/etc/project',
    '/usr/local/project',
    '/root/project/',
    '/root//project',
    '/root/../etc',
    'root/project',
  ])('rejects the broad or non-canonical workspace root %s', (root) => {
    expect(RemoteWorkspaceRootSchema.safeParse(root).success).toBe(false);
  });

  it('resolves only relative descendants beneath the configured root', () => {
    expect(resolveWorkspaceWorkingDirectory(grant.canonicalRoot, undefined)).toBe(
      grant.canonicalRoot,
    );
    expect(resolveWorkspaceWorkingDirectory(grant.canonicalRoot, 'packages/app')).toBe(
      '/root/research-project/packages/app',
    );
    expect(resolveWorkspaceWorkingDirectory(grant.canonicalRoot, '../other')).toBe(null);
  });

  it.each([
    ['/usr/bin/git', ['status', '--short'], 'inspect'],
    ['/usr/bin/git', ['--no-pager', 'diff', '--stat'], 'inspect'],
    ['/usr/bin/git', ['show', 'HEAD:src/model.py'], 'inspect'],
    ['/usr/bin/python3', ['-m', 'pytest', 'tests'], 'test'],
    ['/usr/bin/node', ['--test', 'test/unit.test.js'], 'test'],
    ['/usr/bin/go', ['test', './...'], 'test'],
    ['/usr/bin/cargo', ['build', '--locked'], 'build'],
    ['/usr/bin/cmake', ['--build', 'build'], 'build'],
  ] as const)('classifies bounded direct argv %s', (executable, args, expected) => {
    expect(classifyWorkspaceCommand(command(executable, args), grant)).toBe(expected);
  });

  it.each([
    ['/bin/bash', ['-lc', 'touch owned']],
    ['/bin/sh', ['-c', 'touch owned']],
    ['/usr/bin/sudo', ['id']],
    ['/usr/bin/python3', ['-c', "open('/etc/passwd')"]],
    ['/usr/bin/node', ['--eval', 'process.exit()']],
    ['/usr/bin/node', ['cleanup.js']],
    ['/usr/bin/git', ['clean', '-fdx']],
    ['/usr/bin/git', ['-C', '/etc', 'status']],
    ['/usr/bin/git', ['-c', 'core.pager=cat', 'status']],
    ['/usr/bin/git', ['show', 'HEAD:../secret']],
    ['/usr/bin/git', ['show', 'main:src/model.py']],
    ['/usr/bin/cat', ['/etc/shadow']],
    ['/usr/bin/cat', ['../secret']],
    ['/usr/bin/rg', ['token', '--glob=/etc/**']],
    ['/usr/bin/make', ['target;touch-owned']],
    ['/usr/bin/curl', ['https://example.test']],
  ] as const)('rejects shell, destructive, or escaping command %s', (executable, args) => {
    expect(classifyWorkspaceCommand(command(executable, args), grant)).toBe(null);
  });

  it('limits diagnostics grants to inspection commands', () => {
    const diagnostics = { ...grant, permissionMode: 'diagnostics' as const };
    expect(classifyWorkspaceCommand(command('/usr/bin/git', ['status']), diagnostics)).toBe(
      'inspect',
    );
    expect(
      classifyWorkspaceCommand(command('/usr/bin/python3', ['-m', 'pytest']), diagnostics),
    ).toBe(null);
  });

  it('hardens Git diff before approval without accepting model-supplied config', () => {
    const requested = command('/usr/bin/git', ['--no-pager', 'diff', '--stat']);
    expect(classifyWorkspaceCommand(requested, grant)).toBe('inspect');
    const hardened = hardenWorkspaceCommand(requested);
    expect(hardened.args).toEqual([
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.pager=cat',
      '-c',
      'color.ui=false',
      '--no-pager',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--stat',
    ]);
    expect(
      classifyWorkspaceCommand(
        command('/usr/bin/git', ['-c', 'diff.external=owned', 'diff']),
        grant,
      ),
    ).toBeNull();
  });
});
