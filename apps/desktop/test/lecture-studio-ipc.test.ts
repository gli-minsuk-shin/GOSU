import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { registerLectureStudioIpc } from '../src/main/lecture-studio-ipc';
import {
  LectureStudioServiceError,
  type LectureStudioService,
} from '../src/main/lecture-studio-service';
import { LECTURE_STUDIO_IPC_CHANNELS } from '../src/shared/lecture-studio-channels';

type Handler = (...arguments_: unknown[]) => unknown;

function fixture(service: Partial<LectureStudioService>, reportUnexpected = vi.fn()) {
  const handlers = new Map<string, Handler>();
  registerLectureStudioIpc(
    (channel, handler) => handlers.set(channel, handler),
    service as LectureStudioService,
    reportUnexpected,
  );
  return { handlers, reportUnexpected };
}

describe('Lecture Studio IPC boundary', () => {
  it('registers only the fixed workspace-level lecture surface', () => {
    const { handlers } = fixture({});

    expect([...handlers.keys()].sort()).toEqual(
      [
        LECTURE_STUDIO_IPC_CHANNELS.list,
        LECTURE_STUDIO_IPC_CHANNELS.detail,
        LECTURE_STUDIO_IPC_CHANNELS.candidates,
        LECTURE_STUDIO_IPC_CHANNELS.create,
        LECTURE_STUDIO_IPC_CHANNELS.generate,
        LECTURE_STUDIO_IPC_CHANNELS.send,
        LECTURE_STUDIO_IPC_CHANNELS.cancel,
        LECTURE_STUDIO_IPC_CHANNELS.compilePdf,
      ].sort(),
    );
    expect([...handlers.keys()]).not.toContain(LECTURE_STUDIO_IPC_CHANNELS.event);
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
