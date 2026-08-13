import { describe, expect, it } from 'vitest';

import {
  isCodexUnavailableError,
  mergeProjectChatSessionCatalogUpdate,
  mergeProjectChatSessionSnapshotUpdate,
} from '../src/renderer/src/desktop-app';
import { projectChatSessionKey } from '../src/renderer/src/project-chat-session-state';
import type { ProjectChatSession, ProjectChatSnapshot } from '../src/shared/project-chat-contracts';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';

const projectId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

const placeholderSession: ProjectChatSession = {
  id: sessionId,
  projectId,
  title: 'Branch · Project chat',
  isDefault: false,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
};

describe('Desktop Project Chat session updates', () => {
  it('marks only an actual Codex connection error as a global disconnect', () => {
    expect(isCodexUnavailableError(new Error('lecture_codex_unavailable'))).toBe(true);
    expect(isCodexUnavailableError(new Error('lecture_generation_timed_out'))).toBe(false);
    expect(isCodexUnavailableError(new Error('lecture_generation_failed'))).toBe(false);
    expect(isCodexUnavailableError(new Error('generation failed: codex_unavailable_reason'))).toBe(
      false,
    );
  });

  it('replaces session metadata without replacing transcript state', () => {
    const messages: ProjectChatSnapshot['messages'] = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        projectId,
        role: 'assistant',
        content: 'Existing transcript remains mounted.',
        status: 'complete',
        actions: [],
        createdAt: '2026-08-10T00:00:00.000Z',
        completedAt: '2026-08-10T00:00:00.000Z',
      },
    ];
    const snapshot: ProjectChatSnapshot = {
      schemaVersion: 1,
      projectId,
      session: placeholderSession,
      sessions: [placeholderSession],
      messages,
      attempts: [],
      profile: defaultProjectChatProfile(projectId),
    };
    const sessionKey = projectChatSessionKey(projectId, sessionId);
    const renamedSession: ProjectChatSession = {
      ...placeholderSession,
      title: 'Robust tabular evaluation',
      updatedAt: '2026-08-10T00:00:01.000Z',
    };

    const catalog = mergeProjectChatSessionCatalogUpdate(
      { [projectId]: [placeholderSession] },
      renamedSession,
    );
    const snapshots = mergeProjectChatSessionSnapshotUpdate(
      { [sessionKey]: snapshot },
      renamedSession,
    );

    expect(catalog[projectId]).toEqual([renamedSession]);
    expect(snapshots[sessionKey]?.session).toBe(renamedSession);
    expect(snapshots[sessionKey]?.messages).toBe(messages);
    expect(snapshots[sessionKey]?.attempts).toBe(snapshot.attempts);
  });

  it('adds a catalog-only update without manufacturing an empty transcript', () => {
    const renamedSession: ProjectChatSession = {
      ...placeholderSession,
      title: 'A concise generated title',
      updatedAt: '2026-08-10T00:00:01.000Z',
    };
    const snapshots = {};

    expect(mergeProjectChatSessionCatalogUpdate({}, renamedSession)).toEqual({
      [projectId]: [renamedSession],
    });
    expect(mergeProjectChatSessionSnapshotUpdate(snapshots, renamedSession)).toBe(snapshots);
  });

  it('ignores a delayed generated-title event after a newer manual rename', () => {
    const manualSession: ProjectChatSession = {
      ...placeholderSession,
      title: 'My final session name',
      updatedAt: '2026-08-10T00:00:02.000Z',
    };
    const delayedGeneratedTitle: ProjectChatSession = {
      ...placeholderSession,
      title: 'Generated branch title',
      updatedAt: '2026-08-10T00:00:01.000Z',
    };
    const sessionKey = projectChatSessionKey(projectId, sessionId);
    const snapshot: ProjectChatSnapshot = {
      schemaVersion: 1,
      projectId,
      session: manualSession,
      sessions: [manualSession],
      messages: [],
      attempts: [],
      profile: defaultProjectChatProfile(projectId),
    };

    expect(
      mergeProjectChatSessionCatalogUpdate({ [projectId]: [manualSession] }, delayedGeneratedTitle)[
        projectId
      ],
    ).toEqual([manualSession]);
    expect(
      mergeProjectChatSessionSnapshotUpdate({ [sessionKey]: snapshot }, delayedGeneratedTitle)[
        sessionKey
      ]?.session,
    ).toBe(manualSession);
  });
});
