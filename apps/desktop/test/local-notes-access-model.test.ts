import { describe, expect, it } from 'vitest';

import { buildLocalNotesGrantUpdate } from '../src/renderer/src/local-notes-access-model';
import type { ProjectChatProfile } from '../src/shared/project-chat-contracts';

describe('Local Notes grant profile update', () => {
  it('preserves every advanced agent setting while omitting storage-only profile fields', () => {
    const profile: ProjectChatProfile = {
      schemaVersion: 1,
      projectId: '11111111-1111-4111-8111-111111111111',
      version: 7,
      harnessMode: 'reviewer',
      responseDepth: 'deep',
      collaborationModeId: 'future-native-mode',
      personality: 'pragmatic',
      responseVerbosity: 'high',
      contextScope: 'objective',
      localNotesVault: { id: 'a'.repeat(64), name: 'Previous Vault' },
      customInstructions: 'Keep evidence and project decisions traceable.',
      instructionRevision: {
        id: '22222222-2222-4222-8222-222222222222',
        revision: 7,
        contentSha256: 'c'.repeat(64),
        createdAt: '2026-08-04T01:00:00.000Z',
      },
      updatedAt: '2026-08-04T01:00:00.000Z',
    };
    const nextGrant = { id: 'b'.repeat(64), name: 'Current Vault' };

    const update = buildLocalNotesGrantUpdate(profile, nextGrant);

    expect(update).toEqual({
      projectId: profile.projectId,
      expectedVersion: profile.version,
      harnessMode: 'reviewer',
      responseDepth: 'deep',
      collaborationModeId: 'future-native-mode',
      personality: 'pragmatic',
      responseVerbosity: 'high',
      contextScope: 'objective',
      localNotesVault: nextGrant,
      customInstructions: 'Keep evidence and project decisions traceable.',
    });
    expect(update).not.toHaveProperty('schemaVersion');
    expect(update).not.toHaveProperty('instructionRevision');
    expect(update).not.toHaveProperty('updatedAt');
  });

  it('uses the same bounded update shape when access is revoked', () => {
    const profile: ProjectChatProfile = {
      schemaVersion: 1,
      projectId: '11111111-1111-4111-8111-111111111111',
      version: 0,
      harnessMode: 'context',
      responseDepth: 'standard',
      collaborationModeId: null,
      personality: 'auto',
      responseVerbosity: 'auto',
      contextScope: 'project',
      localNotesVault: { id: 'a'.repeat(64), name: 'Research Vault' },
      customInstructions: '',
      instructionRevision: null,
      updatedAt: null,
    };

    expect(buildLocalNotesGrantUpdate(profile, null)).toMatchObject({
      projectId: profile.projectId,
      expectedVersion: 0,
      localNotesVault: null,
    });
  });
});
