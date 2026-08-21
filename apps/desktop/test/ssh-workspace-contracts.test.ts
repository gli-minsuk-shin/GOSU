import { describe, expect, it } from 'vitest';

import {
  EnableTrustedRemoteWorkspaceInputSchema,
  SSH_WORKSPACE_FILE_MAX_CHARACTERS,
  SshWorkspaceFileOperationSchema,
} from '../src/shared/ssh-workspace-contracts';

const invocation = {
  projectId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  attemptId: '33333333-3333-4333-8333-333333333333',
  turnId: 'turn-1',
  toolCallId: 'tool-1',
  connectionId: '44444444-4444-4444-8444-444444444444',
  grantId: '55555555-5555-4555-8555-555555555555',
};

describe('SSH workspace file contracts', () => {
  it('requires both explicit trusted-workspace confirmations', () => {
    const base = {
      projectId: invocation.projectId,
      grantId: invocation.grantId,
      expectedVersion: 1,
      confirmTrustedWorkspaceRisk: true,
    };
    expect(EnableTrustedRemoteWorkspaceInputSchema.safeParse(base).success).toBe(false);
    expect(
      EnableTrustedRemoteWorkspaceInputSchema.safeParse({
        ...base,
        confirmNoRemoteSandbox: true,
      }).success,
    ).toBe(true);
    expect(
      EnableTrustedRemoteWorkspaceInputSchema.safeParse({
        ...base,
        confirmNoRemoteSandbox: true,
        confirmRootTrustedWorkspaceRisk: true,
      }).success,
    ).toBe(true);
  });

  it('accepts bounded list, read, create, and expected-hash replacement requests', () => {
    expect(SshWorkspaceFileOperationSchema.parse({ ...invocation, action: 'list' })).toMatchObject({
      action: 'list',
      maxEntries: 100,
    });
    expect(
      SshWorkspaceFileOperationSchema.parse({
        ...invocation,
        action: 'read',
        relativePath: 'src/train.py',
      }),
    ).toMatchObject({ action: 'read', offset: 0, maxCharacters: 16_000 });
    expect(
      SshWorkspaceFileOperationSchema.safeParse({
        ...invocation,
        action: 'write',
        relativePath: 'src/train.py',
        content: 'print("ready")\n',
        expectedSha256: null,
      }).success,
    ).toBe(true);
    expect(
      SshWorkspaceFileOperationSchema.safeParse({
        ...invocation,
        action: 'write',
        relativePath: 'src/train.py',
        content: 'print("updated")\n',
        expectedSha256: 'a'.repeat(64),
      }).success,
    ).toBe(true);
  });

  it.each([
    '/etc/passwd',
    '../outside.py',
    'src/../../outside.py',
    '.git/config',
    '.ssh/config',
    'config/.env.production',
    'keys/id_ed25519',
    'keys/server.pem',
    'src/normal\u202Eyp.txt',
    'src/raw\uDCFF.py',
  ])('rejects unsafe or sensitive file path %s before approval', (relativePath) => {
    expect(
      SshWorkspaceFileOperationSchema.safeParse({
        ...invocation,
        action: 'read',
        relativePath,
      }).success,
    ).toBe(false);
    expect(
      SshWorkspaceFileOperationSchema.safeParse({
        ...invocation,
        action: 'write',
        relativePath: 'src/train.py',
        content: 'safe\uD800hidden',
        expectedSha256: null,
      }).success,
    ).toBe(false);
  });

  it('rejects NUL and oversized write content before approval', () => {
    expect(
      SshWorkspaceFileOperationSchema.safeParse({
        ...invocation,
        action: 'write',
        relativePath: 'src/train.py',
        content: 'bad\u0000content',
        expectedSha256: null,
      }).success,
    ).toBe(false);
    expect(
      SshWorkspaceFileOperationSchema.safeParse({
        ...invocation,
        action: 'write',
        relativePath: 'src/train.py',
        content: 'safe\u202Ehidden',
        expectedSha256: null,
      }).success,
    ).toBe(false);
    expect(
      SshWorkspaceFileOperationSchema.safeParse({
        ...invocation,
        action: 'write',
        relativePath: 'src/train.py',
        content: 'x'.repeat(SSH_WORKSPACE_FILE_MAX_CHARACTERS + 1),
        expectedSha256: null,
      }).success,
    ).toBe(false);
  });
});
