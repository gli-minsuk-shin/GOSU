import { describe, expect, it } from 'vitest';

import {
  ProjectChatLoadGuard,
  clearProjectChatLoading,
  markProjectChatLoading,
  mergeProjectChatSnapshot,
  shouldHydrateProjectChat,
} from '../src/renderer/src/project-chat-load-guard';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

describe('ProjectChatLoadGuard', () => {
  it('hydrates the current project profile for Chat and Local Notes only', () => {
    expect(shouldHydrateProjectChat('chat', 'project-a')).toBe(true);
    expect(shouldHydrateProjectChat('notes', 'project-a')).toBe(true);
    expect(shouldHydrateProjectChat('board', 'project-a')).toBe(false);
    expect(shouldHydrateProjectChat('notes', '')).toBe(false);
  });

  it('tracks simultaneous profile hydration independently for each project', () => {
    const loadingA = markProjectChatLoading(new Set(), 'project-a');
    const loadingBoth = markProjectChatLoading(loadingA, 'project-b');
    const onlyB = clearProjectChatLoading(loadingBoth, 'project-a');

    expect(loadingBoth).toEqual(new Set(['project-a', 'project-b']));
    expect(onlyB).toEqual(new Set(['project-b']));
    expect(clearProjectChatLoading(onlyB, 'project-b')).toEqual(new Set());
  });

  it('rejects a stale snapshot that resolves after a turn event', () => {
    const guard = new ProjectChatLoadGuard();
    const request = guard.begin('project-a');

    guard.observeEvent('project-a');

    expect(guard.canApply(request)).toBe(false);
    expect(guard.isLatestRequest(request)).toBe(true);
  });

  it('invalidates an outstanding hydration after a local profile mutation', () => {
    const guard = new ProjectChatLoadGuard();
    const request = guard.begin(PROJECT_ID);

    guard.invalidateProject(PROJECT_ID);

    expect(guard.canApply(request)).toBe(false);
    expect(guard.isLatestRequest(request)).toBe(true);
  });

  it('never lets an older hydrated profile replace a newer local profile', () => {
    const newerProfile = {
      ...defaultProjectChatProfile(PROJECT_ID),
      version: 2,
      localNotesVault: { id: 'a'.repeat(64), name: 'Research Vault' },
    };
    const olderProfile = {
      ...defaultProjectChatProfile(PROJECT_ID),
      version: 1,
      localNotesVault: null,
    };
    const current = {
      schemaVersion: 1 as const,
      projectId: PROJECT_ID,
      messages: [],
      attempts: [],
      profile: newerProfile,
    };
    const delayed = {
      schemaVersion: 1 as const,
      projectId: PROJECT_ID,
      messages: [],
      attempts: [],
      profile: olderProfile,
    };

    expect(mergeProjectChatSnapshot(current, delayed).profile).toEqual(newerProfile);
  });

  it('allows only the latest response for one project without affecting another project', () => {
    const guard = new ProjectChatLoadGuard();
    const older = guard.begin('project-a');
    const otherProject = guard.begin('project-b');
    const newer = guard.begin('project-a');

    expect(guard.canApply(older)).toBe(false);
    expect(guard.canApply(newer)).toBe(true);
    expect(guard.canApply(otherProject)).toBe(true);
  });
});
