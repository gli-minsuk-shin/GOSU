import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerProjectChatIpc } from '../src/main/project-chat-ipc';
import { ProjectChatServiceError, type ProjectChatService } from '../src/main/project-chat-service';
import { PROJECT_CHAT_IPC_CHANNELS } from '../src/shared/project-chat-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function registerFixture(service: Partial<ProjectChatService>, reportUnexpected = vi.fn()) {
  const handlers = new Map<string, Handler>();
  registerProjectChatIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as ProjectChatService,
    reportUnexpected,
  );
  return { handlers, reportUnexpected };
}

describe('Project chat IPC', () => {
  it('rejects invalid input before invoking the service', async () => {
    const snapshot = vi.fn();
    const { handlers } = registerFixture({ snapshot } as Partial<ProjectChatService>);

    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.snapshot)?.({ projectId: '/' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_chat_input' } });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('returns bounded service errors without leaking details', async () => {
    const send = vi.fn(async () => {
      throw new ProjectChatServiceError('chat_busy');
    });
    const { handlers, reportUnexpected } = registerFixture({ send });

    const result = await handlers.get(PROJECT_CHAT_IPC_CHANNELS.send)?.({
      projectId: randomUUID(),
      message: 'Continue the project',
      requestedModelId: null,
      reasoningOptionId: null,
    });
    expect(result).toEqual({ ok: false, error: { code: 'chat_busy' } });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it('maps unexpected failures to a generic chat error', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('private-path:/Users/researcher/secret');
    });
    const { handlers, reportUnexpected } = registerFixture({ cancel });

    const result = await handlers.get(PROJECT_CHAT_IPC_CHANNELS.cancel)?.({
      projectId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, error: { code: 'chat_unavailable' } });
    expect(JSON.stringify(result)).not.toContain('private-path');
    expect(reportUnexpected).toHaveBeenCalledOnce();
  });

  it('validates profile updates and preserves optimistic conflicts', async () => {
    const projectId = randomUUID();
    const updateProfile = vi.fn(async () => {
      throw new ProjectChatServiceError('chat_profile_conflict');
    });
    const { handlers } = registerFixture({ updateProfile });

    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.updateProfile)?.({
        projectId,
        expectedVersion: 0,
        harnessMode: 'reviewer',
        responseDepth: 'deep',
        contextScope: 'project',
        customInstructions: 'x'.repeat(4_001),
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_chat_input' } });
    expect(updateProfile).not.toHaveBeenCalled();

    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.updateProfile)?.({
        projectId,
        expectedVersion: 0,
        harnessMode: 'reviewer',
        responseDepth: 'deep',
        contextScope: 'project',
        customInstructions: 'Review evidence first.',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'chat_profile_conflict' } });
    expect(updateProfile).toHaveBeenCalledOnce();
  });

  it('exposes strict session commands without accepting extra or malformed fields', async () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const listSessions = vi.fn(async () => []);
    const createSession = vi.fn(async (input) => input);
    const branchSession = vi.fn(async (input) => input);
    const renameSession = vi.fn(async (input) => input);
    const { handlers } = registerFixture({
      listSessions,
      createSession,
      branchSession,
      renameSession,
    });

    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.listSessions)?.({ projectId }),
    ).resolves.toEqual({ ok: true, value: [] });
    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.createSession)?.({
        projectId,
        title: 'Replication plan',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.branchSession)?.({
        projectId,
        sourceSessionId: sessionId,
        branchFromMessageId: messageId,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.renameSession)?.({
        projectId,
        sessionId,
        title: 'A'.repeat(121),
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_chat_input' } });
    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.createSession)?.({
        projectId,
        title: 'Valid title',
        unexpected: true,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_chat_input' } });

    expect(listSessions).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledOnce();
    expect(branchSession).toHaveBeenCalledOnce();
    expect(renameSession).not.toHaveBeenCalled();
  });

  it('preserves bounded session errors and validates session-aware cancel input', async () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const branchSession = vi.fn(async () => {
      throw new ProjectChatServiceError('chat_branch_point_invalid');
    });
    const cancel = vi.fn(async () => ({ accepted: true as const }));
    const revokeSsh = vi.fn(async () => ({ revoked: true as const }));
    const { handlers, reportUnexpected } = registerFixture({ branchSession, cancel, revokeSsh });

    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.branchSession)?.({
        projectId,
        sourceSessionId: sessionId,
        branchFromMessageId: randomUUID(),
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'chat_branch_point_invalid' } });
    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.cancel)?.({ projectId, sessionId }),
    ).resolves.toEqual({ ok: true, value: { accepted: true } });
    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.cancel)?.({ projectId, sessionId, extra: true }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_chat_input' } });
    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.revokeSsh)?.({ projectId, sessionId }),
    ).resolves.toEqual({ ok: true, value: { revoked: true } });
    await expect(
      handlers.get(PROJECT_CHAT_IPC_CHANNELS.revokeSsh)?.({ projectId, sessionId: '/' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_chat_input' } });
    expect(revokeSsh).toHaveBeenCalledExactlyOnceWith({ projectId, sessionId });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });
});
