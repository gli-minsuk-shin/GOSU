import { describe, expect, it, vi } from 'vitest';

import { registerProjectChatAttachmentIpc } from '../src/main/project-chat-attachment-ipc';
import { ProjectChatAttachmentService } from '../src/main/project-chat-attachment-service';
import { PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS } from '../src/shared/project-chat-attachment-channels';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

describe('Project Chat attachment IPC', () => {
  it('validates strict scope input and returns bounded results', async () => {
    const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
    const service = new ProjectChatAttachmentService({ choosePdfFiles: async () => [] });
    registerProjectChatAttachmentIpc(
      (channel, listener) => handlers.set(channel, listener),
      service,
    );

    await expect(
      handlers.get(PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.choose)?.({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        path: '/Users/private/paper.pdf',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_chat_input' } });
    await expect(
      handlers.get(PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.choose)?.({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      }),
    ).resolves.toEqual({ ok: true, value: [] });
    service.dispose();
  });

  it('does not leak unexpected picker errors through IPC', async () => {
    const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
    const report = vi.fn();
    const service = new ProjectChatAttachmentService({
      choosePdfFiles: async () => {
        throw new Error('/Users/private/secret.pdf');
      },
    });
    registerProjectChatAttachmentIpc(
      (channel, listener) => handlers.set(channel, listener),
      service,
      report,
    );

    await expect(
      handlers.get(PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.choose)?.({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'chat_unavailable' } });
    expect(report).toHaveBeenCalledOnce();
    service.dispose();
  });
});
