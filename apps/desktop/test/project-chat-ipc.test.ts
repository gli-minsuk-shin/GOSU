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
});
