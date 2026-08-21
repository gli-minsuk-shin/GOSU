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
    webUtils: {
      getPathForFile: vi.fn((file: { name: string }) => `/private-drop/${file.name}`),
    },
  };
});

vi.mock('electron', () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
  webUtils: electron.webUtils,
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
  electron.webUtils.getPathForFile.mockClear();
});

describe('Lecture Studio preload bridge', () => {
  it('maps full generation-option updates to their fixed channel', async () => {
    const input = {
      studioId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 5,
      generationBrief: {
        notesTargetPages: 16,
        slidesTargetPages: null,
        detailLevel: 'exhaustive' as const,
        structure: { mode: 'adaptive' as const },
        documentFeatures: {
          includeSlideTitlePage: false,
          showInlineEvidenceLabels: false,
          includeSourcesUsedSection: false,
        },
        customInstructions: 'Retain every proof obligation.',
      },
    };
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.lectureStudio.updateGenerationBrief(input);

    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      LECTURE_STUDIO_IPC_CHANNELS.updateGenerationBrief,
      input,
    );
  });

  it('maps detail to its fixed IPC channel and exact input only', async () => {
    const studioId = '11111111-1111-4111-8111-111111111111';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.lectureStudio.detail({ studioId });

    expect(electron.ipcRenderer.invoke).toHaveBeenCalledTimes(1);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(LECTURE_STUDIO_IPC_CHANNELS.detail, {
      studioId,
    });
  });

  it('maps direct edits and keeps Finder paths inside the preload boundary', async () => {
    const studioId = '11111111-1111-4111-8111-111111111111';
    const baseRevisionId = '22222222-2222-4222-8222-222222222222';
    const editInput = { studioId, expectedVersion: 5, baseRevisionId, baseRevision: 3 };
    const saveInput = {
      ...editInput,
      lectureNotesLatexBody: '\\section{Notes}\nEvidence [P1].',
      slidesLatexBody: '\\begin{frame}{Slide}\nEvidence [P1].\n\\end{frame}',
    };
    const dropped = [{ name: 'figure.png' }] as unknown as readonly File[];
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.lectureStudio.editDraft(editInput);
    await api.lectureStudio.saveManualRevision(saveInput);
    await api.lectureStudio.stageDroppedFigures({ studioId, expectedVersion: 5 }, dropped);

    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      LECTURE_STUDIO_IPC_CHANNELS.editDraft,
      editInput,
    );
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      LECTURE_STUDIO_IPC_CHANNELS.saveManualRevision,
      saveInput,
    );
    expect(electron.webUtils.getPathForFile).toHaveBeenCalledWith(dropped[0]);
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      LECTURE_STUDIO_IPC_CHANNELS.stageDroppedFigures,
      { studioId, expectedVersion: 5, paths: ['/private-drop/figure.png'] },
    );
    expect(JSON.stringify(api.lectureStudio)).not.toContain('/private-drop/figure.png');
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

  it('maps external file staging and Overleaf capture to fixed typed channels', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const sourceSetId = '22222222-2222-4222-8222-222222222222';
    const sourceId = '33333333-3333-4333-8333-333333333333';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: {} });

    await api.lectureStudio.stageExternalSources({ projectId, sourceSetId: null });
    await api.lectureStudio.removeStagedExternalSource({ projectId, sourceSetId, sourceId });
    await api.lectureStudio.discardExternalSourceSet({ projectId, sourceSetId });
    await api.lectureStudio.importOverleaf({
      projectId,
      title: 'Captured paper',
      rootDocument: 'main.tex',
      remoteUrl: 'https://git.overleaf.com/project-id',
    });

    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      LECTURE_STUDIO_IPC_CHANNELS.stageExternalSources,
      { projectId, sourceSetId: null },
    );
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      LECTURE_STUDIO_IPC_CHANNELS.removeStagedExternalSource,
      { projectId, sourceSetId, sourceId },
    );
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      LECTURE_STUDIO_IPC_CHANNELS.discardExternalSourceSet,
      { projectId, sourceSetId },
    );
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      LECTURE_STUDIO_IPC_CHANNELS.importOverleaf,
      expect.objectContaining({ projectId, rootDocument: 'main.tex' }),
    );
  });

  it('maps Lecture Assistant attachment actions to fixed Studio-scoped channels', async () => {
    const studioId = '11111111-1111-4111-8111-111111111111';
    const attachmentId = '22222222-2222-4222-8222-222222222222';
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: [] });

    await api.lectureStudio.chooseAttachments({ studioId });
    await api.lectureStudio.releaseAttachment({ studioId, attachmentId });

    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      LECTURE_STUDIO_IPC_CHANNELS.chooseAttachments,
      { studioId },
    );
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      LECTURE_STUDIO_IPC_CHANNELS.releaseAttachment,
      { studioId, attachmentId },
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
    await api.lectureStudio.revealArtifact({ ...binding, format: 'pdf' });

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
      { ...binding, format: 'pdf' },
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

  it('forwards only strict content-free generation progress events', () => {
    const listener = vi.fn();
    const unsubscribe = api.lectureStudio.onEvent(listener);
    const handler = electron.ipcRenderer.on.mock.calls[0]?.[1] as (
      event: unknown,
      value: unknown,
    ) => void;
    const progress = {
      schemaVersion: 1,
      type: 'lecture.generation.progress',
      studioId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      phase: 'generating_draft',
      sequence: 3,
      startedAt: '2026-08-15T00:00:00.000Z',
      occurredAt: '2026-08-15T00:00:03.000Z',
    } as const;

    handler({}, progress);
    handler({}, { ...progress, providerMessage: 'must not cross IPC' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(progress);
    unsubscribe();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      LECTURE_STUDIO_IPC_CHANNELS.event,
      handler,
    );
  });
});
