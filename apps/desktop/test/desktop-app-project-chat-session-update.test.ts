import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  codexAuthenticationUiUpdate,
  codexSurfaceDefaultFromProjectChatDefault,
  isCodexUnavailableError,
  mergeProjectChatSessionCatalogUpdate,
  mergeProjectChatSessionSnapshotUpdate,
  projectChatSelectionFromDefault,
  shouldReplaceBusyHermesTurn,
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
  it('replaces only an active Hermes turn instead of leaving the new message queued', () => {
    expect(shouldReplaceBusyHermesTurn('hermes', true, false)).toBe(true);
    expect(shouldReplaceBusyHermesTurn('hermes', false, true)).toBe(true);
    expect(shouldReplaceBusyHermesTurn('hermes', false, false)).toBe(false);
    expect(shouldReplaceBusyHermesTurn('codex', true, true)).toBe(false);
  });

  it('snapshots the provider-qualified Settings default into each new Project Chat scope', () => {
    expect(
      projectChatSelectionFromDefault({
        providerId: null,
        modelId: null,
        reasoningOptionId: 'high',
      }),
    ).toEqual({
      providerId: null,
      modelId: null,
      reasoningOptionId: 'high',
    });
    expect(
      projectChatSelectionFromDefault({
        providerId: 'claude-code',
        modelId: 'claude-code:opus',
        reasoningOptionId: 'high',
      }),
    ).toEqual({
      providerId: 'claude-code',
      modelId: 'claude-code:opus',
      reasoningOptionId: 'high',
    });
  });

  it('keeps non-chat Codex surfaces on a compatible default', () => {
    expect(
      codexSurfaceDefaultFromProjectChatDefault({
        providerId: 'claude-code',
        modelId: 'claude-code:sonnet',
        reasoningOptionId: 'high',
      }),
    ).toEqual({ providerId: null, modelId: null, reasoningOptionId: 'high' });
    const codex = {
      providerId: 'codex',
      modelId: 'gpt-current',
      reasoningOptionId: 'xhigh',
    } as const;
    expect(codexSurfaceDefaultFromProjectChatDefault(codex)).toBe(codex);
  });

  it('routes provider-qualified defaults to Project Chat and Codex-compatible defaults elsewhere', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );

    expect(source.match(/projectChatSelectionFromDefault\(routedProjectDefault\)/gu)).toHaveLength(
      1,
    );
    expect(source).toContain("routedModel(modelRouting.policy, 'projectChat')");
    // A chat follows Settings → Agent unless its own menu picked a model; opening a chat no longer
    // saves the default of the day as if it were that pick.
    expect(source).toContain(
      "const followsSettings = loaded.status === 'missing' || loaded.status === 'inherited';",
    );
    expect(source).not.toContain("loaded.status === 'missing' && modelRouting.ready");
    expect(source).toContain('if (selection !== saved && !followsSettings) {');
    expect(source).toContain("activeTab === 'lecture' && modelRouting.ready");
    expect(source.match(/loadScopedProjectChatModelSelection\(/gu)).toHaveLength(2);
    expect(source).toContain(
      'setProjectChatModelSelection(loadScopedProjectChatModelSelection(projectId, sessionId))',
    );
    expect(source).toContain(
      'codexSurfaceDefaultFromProjectChatDefault(preferences.defaultAiSelection)',
    );
    expect(
      source.match(/requestedModelId=\{codexSurfaceDefaultAiSelection\.modelId\}/gu),
    ).toHaveLength(2);
    expect(
      source.match(/reasoningOptionId=\{codexSurfaceDefaultAiSelection\.reasoningOptionId\}/gu),
    ).toHaveLength(2);
    expect(source).toContain('defaultModelSelection={codexSurfaceDefaultAiSelection}');
    expect(source).toContain('requestedModelId: projectChatModelSelection.modelId');
    expect(source).toContain('reasoningOptionId: projectChatModelSelection.reasoningOptionId');
  });

  it('refreshes models only after successful Codex authentication completion', () => {
    expect(codexAuthenticationUiUpdate({ type: 'login.completed', success: true })).toEqual({
      connectionState: 'checking',
      status: 'Codex sign-in completed. Refreshing models…',
      refreshModels: true,
    });
    expect(codexAuthenticationUiUpdate({ type: 'login.completed', success: false })).toEqual({
      connectionState: 'auth-required',
      status: 'Codex sign-in did not complete. Try signing in again.',
      refreshModels: false,
    });
  });

  it('marks only an actual Codex connection error as a global disconnect', () => {
    expect(isCodexUnavailableError(new Error('lecture_codex_unavailable'))).toBe(true);
    expect(isCodexUnavailableError(new Error('lecture_generation_timed_out'))).toBe(false);
    expect(isCodexUnavailableError(new Error('lecture_auth_required'))).toBe(false);
    expect(isCodexUnavailableError(new Error('lecture_generation_interrupted'))).toBe(false);
    expect(isCodexUnavailableError(new Error('lecture_usage_limit_exceeded'))).toBe(false);
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
