import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  LECTURE_STUDIO_CANDIDATE_PAGE_MAX,
  LECTURE_STUDIO_IPC_ERROR_CODES,
  LectureSourceCandidatesSchema,
  LectureStudioDetailSchema,
  LectureStudioListSnapshotSchema,
  LectureStudioSchema,
  LectureStudioSummarySchema,
  ListLectureCandidatesInputSchema,
} from '../src/shared/lecture-studio-contracts';

const timestamp = '2026-08-06T00:00:00.000Z';

function studioFixture() {
  const projectId = randomUUID();
  return LectureStudioSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    title: 'Cross-project research lecture',
    kind: 'talk',
    durationMinutes: 20,
    outputProjectId: projectId,
    sourceProjectIds: [projectId],
    sourceSelection: {
      literature: [{ projectId, recordId: randomUUID() }],
      experiments: [],
    },
    status: 'draft',
    activeAttemptId: null,
    currentRevision: 0,
    version: 1,
    lastErrorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

describe('Lecture Studio list and detail contracts', () => {
  it('keeps the list payload to summaries without source selections or Markdown history', () => {
    const studio = studioFixture();
    const summary = LectureStudioSummarySchema.parse({
      schemaVersion: studio.schemaVersion,
      id: studio.id,
      title: studio.title,
      kind: studio.kind,
      durationMinutes: studio.durationMinutes,
      outputProjectId: studio.outputProjectId,
      status: studio.status,
      activeAttemptId: studio.activeAttemptId,
      currentRevision: studio.currentRevision,
      version: studio.version,
      lastErrorCode: studio.lastErrorCode,
      createdAt: studio.createdAt,
      updatedAt: studio.updatedAt,
    });

    const snapshot = LectureStudioListSnapshotSchema.parse({
      schemaVersion: 1,
      studios: [summary],
    });

    expect(snapshot.studios).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain('sourceSelection');
    expect(JSON.stringify(snapshot)).not.toContain('messages');
    expect(JSON.stringify(snapshot)).not.toContain('revisions');
  });

  it('scopes every detailed message to the requested studio', () => {
    const studio = studioFixture();
    expect(() =>
      LectureStudioDetailSchema.parse({
        schemaVersion: 1,
        studio,
        messages: [
          {
            schemaVersion: 1,
            id: randomUUID(),
            studioId: randomUUID(),
            role: 'user',
            status: 'complete',
            content: 'Revise the introduction.',
            attemptId: null,
            revision: null,
            invocation: null,
            createdAt: timestamp,
            completedAt: timestamp,
          },
        ],
        revisions: [],
      }),
    ).toThrow();
  });
});

describe('Lecture Studio candidate pagination contracts', () => {
  it('applies deterministic bounded defaults without weakening selected-source contracts', () => {
    const parsed = ListLectureCandidatesInputSchema.parse({ projectIds: [randomUUID()] });
    expect(parsed).toMatchObject({
      literatureOffset: 0,
      literatureLimit: LECTURE_STUDIO_CANDIDATE_PAGE_MAX,
      experimentOffset: 0,
      experimentLimit: LECTURE_STUDIO_CANDIDATE_PAGE_MAX,
      metricPointLimit: 20,
      includeUnreviewed: false,
    });
  });

  it('rejects inconsistent page metadata before it crosses IPC', () => {
    expect(() =>
      LectureSourceCandidatesSchema.parse({
        schemaVersion: 1,
        projects: [
          {
            projectId: randomUUID(),
            projectName: 'Project',
            literatureRecords: [],
            literaturePage: { offset: 0, limit: 10, total: 11, hasMore: false },
            experiments: [],
            experimentPage: { offset: 0, limit: 10, total: 0, hasMore: false },
          },
        ],
      }),
    ).toThrow();
  });
});

describe('Lecture Studio failure contracts', () => {
  it('exposes a stable typed capacity error across IPC', () => {
    expect(LECTURE_STUDIO_IPC_ERROR_CODES).toContain('lecture_capacity_reached');
  });
});
