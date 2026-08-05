import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { RESEARCH_NOTES_IPC_CHANNELS } from '../src/shared/research-notes-channels';

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
});

describe('Research Notes preload bridge', () => {
  it('maps every project-scoped operation to a fixed IPC channel', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const recordId = '22222222-2222-4222-8222-222222222222';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.researchNotes.current({ projectId });
    await api.researchNotes.chooseVault({ projectId });
    await api.researchNotes.read({ projectId, path: 'Literature/Literature Review.md' });
    await api.researchNotes.readAttachment({
      projectId,
      notePath: 'Papers/Paper.md',
      source: 'figures/result.png',
    });
    await api.researchNotes.syncLiterature({ projectId });
    await api.researchNotes.createPaperNote({ projectId, recordId });

    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      [RESEARCH_NOTES_IPC_CHANNELS.current, { projectId }],
      [RESEARCH_NOTES_IPC_CHANNELS.chooseVault, { projectId }],
      [RESEARCH_NOTES_IPC_CHANNELS.read, { projectId, path: 'Literature/Literature Review.md' }],
      [
        RESEARCH_NOTES_IPC_CHANNELS.readAttachment,
        { projectId, notePath: 'Papers/Paper.md', source: 'figures/result.png' },
      ],
      [RESEARCH_NOTES_IPC_CHANNELS.syncLiterature, { projectId }],
      [RESEARCH_NOTES_IPC_CHANNELS.createPaperNote, { projectId, recordId }],
    ]);
  });

  it('exposes only typed project operations and never a generic filesystem writer', () => {
    expect(Object.keys(api.researchNotes)).toEqual([
      'current',
      'chooseVault',
      'read',
      'readAttachment',
      'syncLiterature',
      'createPaperNote',
    ]);
    expect(api.researchNotes).not.toHaveProperty('write');
    expect(api.researchNotes).not.toHaveProperty('renameFolder');
    expect(api.researchNotes).not.toHaveProperty('delete');
  });

  it('maps rejected or undeclared results to a bounded unavailable error', async () => {
    electron.ipcRenderer.invoke
      .mockRejectedValueOnce(new Error('/Users/researcher/private-vault'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'undeclared_error' } });

    await expect(api.researchNotes.current({ projectId: crypto.randomUUID() })).rejects.toThrow(
      'research_notes_unavailable',
    );
    await expect(api.researchNotes.chooseVault({ projectId: crypto.randomUUID() })).rejects.toThrow(
      'research_notes_unavailable',
    );
  });
});
