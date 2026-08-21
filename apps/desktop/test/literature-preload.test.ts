import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GosuDesktopApi } from '../src/preload/index';
import { LITERATURE_IPC_CHANNELS } from '../src/shared/literature-channels';

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

describe('Literature preload bridge', () => {
  it('maps the typed literature surface to fixed IPC channels', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const recordId = '22222222-2222-4222-8222-222222222222';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.literature.list({ projectId });
    await api.literature.search({ projectId, query: 'bounded agents', limit: 20 });
    await api.literature.updateAnnotations({
      projectId,
      recordId,
      expectedVersion: 3,
      expectedAnnotationVersion: 2,
      reviewStatus: 'included',
      manualTopics: ['evaluation'],
      manualSummary: 'Verified summary',
      manualRelevance: 'Directly supports the objective.',
    });
    await api.literature.deleteRecord({ projectId, recordId, expectedVersion: 3 });
    await api.literature.importRecords({ projectId, format: 'bibtex' });
    await api.literature.exportRecords({ projectId, format: 'csv', recordIds: [recordId] });
    await api.literature.organize({ projectId, recordIds: [recordId] });
    await api.literature.cancelOrganize({ projectId });

    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      [LITERATURE_IPC_CHANNELS.list, { projectId }],
      [LITERATURE_IPC_CHANNELS.search, { projectId, query: 'bounded agents', limit: 20 }],
      [
        LITERATURE_IPC_CHANNELS.updateAnnotations,
        {
          projectId,
          recordId,
          expectedVersion: 3,
          expectedAnnotationVersion: 2,
          reviewStatus: 'included',
          manualTopics: ['evaluation'],
          manualSummary: 'Verified summary',
          manualRelevance: 'Directly supports the objective.',
        },
      ],
      [LITERATURE_IPC_CHANNELS.deleteRecord, { projectId, recordId, expectedVersion: 3 }],
      [LITERATURE_IPC_CHANNELS.importRecords, { projectId, format: 'bibtex' }],
      [LITERATURE_IPC_CHANNELS.exportRecords, { projectId, format: 'csv', recordIds: [recordId] }],
      [LITERATURE_IPC_CHANNELS.organize, { projectId, recordIds: [recordId] }],
      [LITERATURE_IPC_CHANNELS.cancelOrganize, { projectId }],
    ]);
  });

  it('keeps dialog file paths and contents outside the renderer contract', () => {
    const exposed = JSON.stringify(Object.keys(api.literature));

    expect(exposed).not.toContain('path');
    expect(exposed).not.toContain('content');
    expect(api.literature).not.toHaveProperty('readFile');
    expect(api.literature).not.toHaveProperty('writeFile');
  });

  it('maps malformed and rejected results to the bounded unavailable error', async () => {
    electron.ipcRenderer.invoke
      .mockRejectedValueOnce(new Error('/Users/researcher/private-review.bib'))
      .mockResolvedValueOnce({ ok: false, error: { code: 'undeclared_error' } });

    await expect(api.literature.list({ projectId: crypto.randomUUID() })).rejects.toThrow(
      'literature_unavailable',
    );
    await expect(
      api.literature.search({ projectId: crypto.randomUUID(), query: 'safe error' }),
    ).rejects.toThrow('literature_unavailable');
  });
});
