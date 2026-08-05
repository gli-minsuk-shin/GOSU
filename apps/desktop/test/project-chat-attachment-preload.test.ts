import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS } from '../src/shared/project-chat-attachment-channels';

const electron = vi.hoisted(() => {
  const exposed: unknown[][] = [];
  return {
    exposed,
    contextBridge: {
      exposeInMainWorld: vi.fn((...arguments_: unknown[]) => exposed.push(arguments_)),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
}));

let api: GosuDesktopApi;

beforeAll(async () => {
  await import('../src/preload/index');
  api = electron.exposed[0]?.[1] as GosuDesktopApi;
});

beforeEach(() => electron.ipcRenderer.invoke.mockReset());

describe('Project Chat attachment preload bridge', () => {
  it('maps only opaque scoped inputs to fixed picker and release channels', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const attachmentId = '33333333-3333-4333-8333-333333333333';
    electron.ipcRenderer.invoke
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: { released: true } });

    await api.projectChat.chooseAttachments({ projectId, sessionId });
    await api.projectChat.releaseAttachment({ projectId, sessionId, attachmentId });

    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      [PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.choose, { projectId, sessionId }],
      [PROJECT_CHAT_ATTACHMENT_IPC_CHANNELS.release, { projectId, sessionId, attachmentId }],
    ]);
    expect(api.projectChat).not.toHaveProperty('choosePdfAttachments');
    expect(api.projectChat).not.toHaveProperty('releasePdfAttachment');
    expect(api.projectChat).not.toHaveProperty('readAttachmentFile');
    expect(api.projectChat).not.toHaveProperty('readPdfFile');
    expect(api.projectChat).not.toHaveProperty('openPath');
  });
});
