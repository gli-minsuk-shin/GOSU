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
      ].sort(),
    );
    expect([...handlers.keys()]).not.toContain(LECTURE_STUDIO_IPC_CHANNELS.event);
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
