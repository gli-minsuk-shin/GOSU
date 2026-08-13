import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { LectureExternalSourceService } from '../src/main/lecture-external-source-service';
import type { LectureOverleafSourceService } from '../src/main/lecture-overleaf-source-service';
import { registerLectureStudioIpc } from '../src/main/lecture-studio-ipc';
import {
  LectureStudioServiceError,
  type LectureStudioService,
} from '../src/main/lecture-studio-service';
import { LECTURE_STUDIO_IPC_CHANNELS } from '../src/shared/lecture-studio-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function fixture(
  service: Partial<LectureStudioService>,
  reportUnexpected = vi.fn(),
  externalSourceOverrides: Partial<LectureExternalSourceService> = {},
  overleafSourceOverrides: Partial<LectureOverleafSourceService> = {},
) {
  const handlers = new Map<string, Handler>();
  const externalSources = {
    chooseAndStage: vi.fn(async () => undefined as never),
    removeStaged: vi.fn(async () => undefined as never),
    discard: vi.fn(async () => undefined as never),
    ...externalSourceOverrides,
  } as LectureExternalSourceService;
  const overleafSources = {
    importOverleaf: vi.fn(async () => undefined as never),
    ...overleafSourceOverrides,
  } as LectureOverleafSourceService;
  registerLectureStudioIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as LectureStudioService,
    externalSources,
    overleafSources,
    reportUnexpected,
  );
  return { handlers, reportUnexpected, externalSources, overleafSources };
}

describe('Lecture Studio IPC boundary', () => {
  it('registers only the fixed workspace-level lecture surface', () => {
    const { handlers } = fixture({});

    expect([...handlers.keys()].sort()).toEqual(
      [
        LECTURE_STUDIO_IPC_CHANNELS.list,
        LECTURE_STUDIO_IPC_CHANNELS.detail,
        LECTURE_STUDIO_IPC_CHANNELS.candidates,
        LECTURE_STUDIO_IPC_CHANNELS.stageExternalSources,
        LECTURE_STUDIO_IPC_CHANNELS.removeStagedExternalSource,
        LECTURE_STUDIO_IPC_CHANNELS.discardExternalSourceSet,
        LECTURE_STUDIO_IPC_CHANNELS.importOverleaf,
        LECTURE_STUDIO_IPC_CHANNELS.create,
        LECTURE_STUDIO_IPC_CHANNELS.generate,
        LECTURE_STUDIO_IPC_CHANNELS.send,
        LECTURE_STUDIO_IPC_CHANNELS.cancel,
        LECTURE_STUDIO_IPC_CHANNELS.trash,
        LECTURE_STUDIO_IPC_CHANNELS.restore,
        LECTURE_STUDIO_IPC_CHANNELS.emptyTrash,
        LECTURE_STUDIO_IPC_CHANNELS.compilePdf,
        LECTURE_STUDIO_IPC_CHANNELS.exportArtifact,
        LECTURE_STUDIO_IPC_CHANNELS.openArtifact,
        LECTURE_STUDIO_IPC_CHANNELS.revealArtifact,
      ].sort(),
    );
    expect([...handlers.keys()]).not.toContain(LECTURE_STUDIO_IPC_CHANNELS.event);
  });

  it('routes only exact staged-file and Overleaf source commands', async () => {
    const projectId = randomUUID();
    const sourceSetId = randomUUID();
    const sourceId = randomUUID();
    const chooseAndStage = vi.fn(async () => undefined as never);
    const removeStaged = vi.fn(async () => undefined as never);
    const discard = vi.fn(async () => undefined as never);
    const importOverleaf = vi.fn(async () => undefined as never);
    const { handlers } = fixture(
      {},
      vi.fn(),
      { chooseAndStage, removeStaged, discard },
      { importOverleaf },
    );
    const stageCommand = { projectId, sourceSetId: null };
    const removeCommand = { projectId, sourceSetId, sourceId };
    const discardCommand = { projectId, sourceSetId };
    const overleafCommand = {
      projectId,
      title: 'Imported Overleaf source',
      rootDocument: 'main.tex',
      remoteUrl: 'https://git.overleaf.com/fixture-project',
      accessToken: 'write-only-fixture-token',
    };

    await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.stageExternalSources)?.(stageCommand);
    await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.removeStagedExternalSource)?.(removeCommand);
    await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.discardExternalSourceSet)?.(discardCommand);
    const overleafResult = await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.importOverleaf)?.(
      overleafCommand,
    );

    expect(chooseAndStage).toHaveBeenCalledWith(stageCommand);
    expect(removeStaged).toHaveBeenCalledWith(removeCommand);
    expect(discard).toHaveBeenCalledWith(discardCommand);
    expect(importOverleaf).toHaveBeenCalledWith(overleafCommand);
    expect(JSON.stringify(overleafResult)).not.toContain(overleafCommand.accessToken);

    for (const [channel, malicious] of [
      [
        LECTURE_STUDIO_IPC_CHANNELS.stageExternalSources,
        { ...stageCommand, path: '/Users/researcher/private.tex' },
      ],
      [
        LECTURE_STUDIO_IPC_CHANNELS.removeStagedExternalSource,
        { ...removeCommand, managedPath: '/tmp/source.pdf' },
      ],
      [
        LECTURE_STUDIO_IPC_CHANNELS.discardExternalSourceSet,
        { ...discardCommand, deletePath: '/tmp/staged' },
      ],
      [
        LECTURE_STUDIO_IPC_CHANNELS.importOverleaf,
        { ...overleafCommand, localClonePath: '/tmp/overleaf' },
      ],
    ] as const) {
      await expect(handlers.get(channel)?.(malicious)).resolves.toEqual({
        ok: false,
        error: { code: 'invalid_lecture_input' },
      });
    }
    expect(chooseAndStage).toHaveBeenCalledTimes(1);
    expect(removeStaged).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(importOverleaf).toHaveBeenCalledTimes(1);
  });

  it('validates recoverable Trash commands and never accepts renderer deletion targets', async () => {
    const trash = vi.fn(async (input) => ({ ...input }));
    const restore = vi.fn(async (input) => ({ ...input }));
    const emptyTrash = vi.fn(async () => ({
      schemaVersion: 1 as const,
      idempotencyKey: randomUUID(),
      removedStudios: [],
      completedAt: new Date().toISOString(),
    }));
    const { handlers } = fixture({ trash, restore, emptyTrash });
    const command = { studioId: randomUUID(), expectedVersion: 3 };
    await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.trash)?.(command);
    await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.restore)?.(command);
    expect(trash).toHaveBeenCalledWith(command);
    expect(restore).toHaveBeenCalledWith(command);

    await expect(
      handlers.get(LECTURE_STUDIO_IPC_CHANNELS.emptyTrash)?.({
        idempotencyKey: randomUUID(),
        confirmation: 'EMPTY LECTURE TRASH',
        targets: [
          {
            studioId: randomUUID(),
            expectedVersion: 1,
            trashedAt: new Date().toISOString(),
          },
        ],
        path: '/tmp/unsafe',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_lecture_input' } });
    expect(emptyTrash).not.toHaveBeenCalled();

    await expect(
      handlers.get(LECTURE_STUDIO_IPC_CHANNELS.emptyTrash)?.({
        idempotencyKey: randomUUID(),
        confirmation: 'EMPTY LECTURE TRASH',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_lecture_input' } });
    expect(emptyTrash).not.toHaveBeenCalled();
  });

  it('accepts only revision-bound artifact actions without renderer paths or bytes', async () => {
    const exportArtifact = vi.fn(async () => ({
      schemaVersion: 1 as const,
      status: 'exported' as const,
      format: 'markdown' as const,
      fileName: 'Lecture Notes.md',
      relativePath: 'Lecture Notes & Slides/Studio/Lecture Notes.md',
    }));
    const openArtifact = vi.fn(async () => ({
      schemaVersion: 1 as const,
      status: 'opened' as const,
      format: 'pdf' as const,
      fileName: 'Lecture Notes.pdf',
      relativePath: 'Lecture Notes & Slides/Studio/Lecture Notes.md',
    }));
    const revealArtifact = vi.fn(async () => ({
      schemaVersion: 1 as const,
      status: 'revealed' as const,
      format: null,
      fileName: 'Lecture Notes.md',
      relativePath: 'Lecture Notes & Slides/Studio/Lecture Notes.md',
    }));
    const { handlers } = fixture({ exportArtifact, openArtifact, revealArtifact });
    const binding = {
      studioId: randomUUID(),
      revisionId: randomUUID(),
      revision: 3,
      kind: 'lecture-notes' as const,
      artifactContentSha256: 'a'.repeat(64),
    };

    await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.exportArtifact)?.({
      ...binding,
      format: 'markdown',
    });
    await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.openArtifact)?.({
      ...binding,
      format: 'pdf',
    });
    await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.revealArtifact)?.(binding);

    expect(exportArtifact).toHaveBeenCalledWith({ ...binding, format: 'markdown' });
    expect(openArtifact).toHaveBeenCalledWith({ ...binding, format: 'pdf' });
    expect(revealArtifact).toHaveBeenCalledWith(binding);

    for (const [channel, malicious] of [
      [
        LECTURE_STUDIO_IPC_CHANNELS.exportArtifact,
        { ...binding, format: 'markdown', path: '/tmp/x' },
      ],
      [
        LECTURE_STUDIO_IPC_CHANNELS.openArtifact,
        { ...binding, format: 'pdf', pdfBase64: 'unsafe' },
      ],
      [LECTURE_STUDIO_IPC_CHANNELS.revealArtifact, { ...binding, absolutePath: '/tmp/x' }],
    ] as const) {
      await expect(handlers.get(channel)?.(malicious)).resolves.toEqual({
        ok: false,
        error: { code: 'invalid_lecture_input' },
      });
    }
    expect(exportArtifact).toHaveBeenCalledTimes(1);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(revealArtifact).toHaveBeenCalledTimes(1);
  });

  it('accepts only an exact lecture revision PDF binding', async () => {
    const compilePdf = vi.fn(async () => ({
      schemaVersion: 1 as const,
      artifactId: randomUUID(),
      title: 'Lecture notes PDF',
      fileName: 'Lecture Notes.pdf',
      compilerDisplayName: 'Local XeLaTeX',
      sourceDescription: 'Fixture · revision 2',
      pdfSha256: `sha256:${'b'.repeat(64)}`,
      sizeBytes: 16,
      compiledAt: '2026-08-13T00:00:00.000Z',
      pdfBase64: Buffer.from('%PDF-1.7\n%%EOF').toString('base64'),
    }));
    const { handlers } = fixture({ compilePdf });
    const command = {
      studioId: randomUUID(),
      revision: 2,
      kind: 'lecture-notes' as const,
      contentSha256: 'a'.repeat(64),
    };

    await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.compilePdf)?.(command);
    expect(compilePdf).toHaveBeenCalledWith(command);

    await expect(
      handlers.get(LECTURE_STUDIO_IPC_CHANNELS.compilePdf)?.({
        ...command,
        markdown: '# renderer controlled source',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_lecture_input' } });
    expect(compilePdf).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid duration, empty source selection, and extra renderer fields', async () => {
    const create = vi.fn();
    const detail = vi.fn();
    const generate = vi.fn();
    const { handlers } = fixture({ create, detail, generate });
    const projectId = randomUUID();

    await expect(
      handlers.get(LECTURE_STUDIO_IPC_CHANNELS.create)?.({
        title: 'Bad talk',
        kind: 'talk',
        durationMinutes: 15,
        outputProjectId: projectId,
        sourceProjectIds: [projectId],
        sourceSelection: { literature: [], experiments: [] },
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_lecture_input' } });
    await expect(
      handlers.get(LECTURE_STUDIO_IPC_CHANNELS.detail)?.({ studioId: 'not-a-uuid' }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_lecture_input' } });
    await expect(
      handlers.get(LECTURE_STUDIO_IPC_CHANNELS.generate)?.({
        studioId: randomUUID(),
        expectedVersion: 1,
        requestedModelId: null,
        reasoningOptionId: null,
        dynamicTools: [{ name: 'shell' }],
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_lecture_input' } });
    expect(create).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns bounded service errors without exposing local diagnostics', async () => {
    const studioId = randomUUID();
    const generate = vi.fn(async () => {
      throw new LectureStudioServiceError('lecture_research_notes_required');
    });
    const { handlers, reportUnexpected } = fixture({ generate });

    await expect(
      handlers.get(LECTURE_STUDIO_IPC_CHANNELS.generate)?.({
        studioId,
        expectedVersion: 1,
        requestedModelId: null,
        reasoningOptionId: null,
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'lecture_research_notes_required' } });
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it('maps unexpected failures to a generic unavailable result', async () => {
    const list = vi.fn(async () => {
      throw new Error('/Users/researcher/private-lecture.md');
    });
    const { handlers, reportUnexpected } = fixture({ list });

    const result = await handlers.get(LECTURE_STUDIO_IPC_CHANNELS.list)?.({});
    expect(result).toEqual({ ok: false, error: { code: 'lecture_unavailable' } });
    expect(JSON.stringify(result)).not.toContain('private-lecture');
    expect(reportUnexpected).toHaveBeenCalledOnce();
  });
});
