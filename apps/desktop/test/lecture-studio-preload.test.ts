import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { LECTURE_STUDIO_IPC_CHANNELS } from '../src/shared/lecture-studio-channels';

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

beforeEach(() => {
  electron.ipcRenderer.invoke.mockReset();
  electron.ipcRenderer.on.mockClear();
  electron.ipcRenderer.removeListener.mockClear();
});

describe('Lecture Studio preload bridge', () => {
  it('maps detail to its fixed IPC channel and exact input only', async () => {
    const studioId = '11111111-1111-4111-8111-111111111111';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.lectureStudio.detail({ studioId });

    expect(electron.ipcRenderer.invoke).toHaveBeenCalledTimes(1);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(LECTURE_STUDIO_IPC_CHANNELS.detail, {
      studioId,
    });
  });

  it('maps bounded PDF preview compilation to its fixed channel', async () => {
    const input = {
      studioId: '11111111-1111-4111-8111-111111111111',
      revision: 3,
      kind: 'slides' as const,
      contentSha256: 'a'.repeat(64),
    };
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.lectureStudio.compilePdf(input);

    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      LECTURE_STUDIO_IPC_CHANNELS.compilePdf,
      input,
    );
  });

  it('maps revision-bound export, open, and reveal actions to fixed channels', async () => {
    const binding = {
      studioId: '11111111-1111-4111-8111-111111111111',
      revisionId: '22222222-2222-4222-8222-222222222222',
      revision: 3,
      kind: 'lecture-notes' as const,
      artifactContentSha256: 'a'.repeat(64),
    };
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.lectureStudio.exportArtifact({ ...binding, format: 'markdown' });
    await api.lectureStudio.exportArtifact({ ...binding, format: 'latex' });
    await api.lectureStudio.openArtifact({ ...binding, format: 'pdf' });
    await api.lectureStudio.revealArtifact(binding);

    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      LECTURE_STUDIO_IPC_CHANNELS.exportArtifact,
      { ...binding, format: 'markdown' },
    );
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      LECTURE_STUDIO_IPC_CHANNELS.exportArtifact,
      { ...binding, format: 'latex' },
    );
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      LECTURE_STUDIO_IPC_CHANNELS.openArtifact,
      { ...binding, format: 'pdf' },
    );
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      LECTURE_STUDIO_IPC_CHANNELS.revealArtifact,
      binding,
    );
  });

  it('maps rejected or undeclared detail results to bounded unavailability', async () => {
    electron.ipcRenderer.invoke
      .mockRejectedValueOnce(new Error('/Users/researcher/private-lecture.md'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'undeclared_error' } });

    await expect(api.lectureStudio.detail({ studioId: crypto.randomUUID() })).rejects.toThrow(
      'lecture_unavailable',
    );
    await expect(api.lectureStudio.detail({ studioId: crypto.randomUUID() })).rejects.toThrow(
      'lecture_unavailable',
    );
  });
});
