import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { LECTURE_STUDIO_IPC_CHANNELS } from '../src/shared/lecture-studio-channels';
import {
  ChooseLectureStudioFiguresInputSchema,
  GetLectureStudioEditDraftInputSchema,
  LECTURE_STUDIO_MAX_FIGURES,
  LECTURE_STUDIO_MAX_MARKDOWN_LENGTH,
  LectureStudioAttemptLatexReasonSchema,
  LectureStudioEditDraftSchema,
  LectureStudioFigureAssetSchema,
  LectureStudioFigurePreviewSchema,
  LectureStudioRevisionSchema,
  ListLectureStudioFiguresInputSchema,
  PreviewLectureStudioFigureInputSchema,
  RemoveLectureStudioFigureInputSchema,
  SaveLectureStudioManualRevisionInputSchema,
  type LectureStudioFigureAsset,
} from '../src/shared/lecture-studio-contracts';

const timestamp = '2026-08-20T00:00:00.000Z';

function figureFixture(studioId: string): LectureStudioFigureAsset {
  const id = randomUUID();
  return LectureStudioFigureAssetSchema.parse({
    id,
    studioId,
    displayName: 'Estimator geometry.png',
    fileName: `Figure-${id}.jpg`,
    mediaType: 'image/jpeg',
    sourceFormat: 'png',
    byteSize: 1_024,
    width: 640,
    height: 480,
    sha256: 'a'.repeat(64),
    origin: 'user',
    createdAt: timestamp,
  });
}

function revisionFixture(kind: 'model' | 'manual') {
  const projectId = randomUUID();
  const studioId = randomUUID();
  const baseRevisionId = randomUUID();
  const invocation = {
    schemaVersion: 1 as const,
    invocationId: randomUUID(),
    providerId: 'codex',
    requestedModelId: null,
    resolvedModelId: 'gpt-5.6-sol',
    catalogVersion: 'catalog-v1',
    reasoningOptionId: 'high',
    startedAt: timestamp,
  };
  return {
    schemaVersion: 4 as const,
    id: randomUUID(),
    studioId,
    revision: kind === 'manual' ? 2 : 1,
    attemptId: randomUUID(),
    sourceManifest: {
      schemaVersion: 1 as const,
      selectedProjectIds: [projectId],
      literature: [
        {
          sourceLabel: 'P1',
          projectId,
          projectName: 'Project',
          recordId: randomUUID(),
          recordVersion: 1,
          annotationVersion: 0,
          title: 'Paper',
          authors: [],
          containerTitle: null,
          publishedYear: null,
          doi: null,
          citationKey: null,
          reviewStatus: 'included' as const,
          topics: [],
          metadataSummary: '',
          metadataOnly: true as const,
        },
      ],
      experiments: [],
    },
    sourceManifestSha256: 'b'.repeat(64),
    lectureNotesLatex: '\\section{Notes}',
    slidesLatex: '\\begin{frame}{Slide}Content\\end{frame}',
    generationBriefSnapshot: {
      notesTargetPages: null,
      slidesTargetPages: null,
      detailLevel: 'standard' as const,
      structure: { mode: 'adaptive' as const },
      documentFeatures: {
        includeSlideTitlePage: true,
        showInlineEvidenceLabels: true,
        includeSourcesUsedSection: true,
      },
      customInstructions: '',
    },
    generationBriefSha256: 'c'.repeat(64),
    authoringPolicyVersion: 7,
    authoringPolicySha256: 'd'.repeat(64),
    authorship:
      kind === 'model'
        ? ({ kind: 'model' } as const)
        : ({
            kind: 'manual',
            baseRevisionId,
            baseRevision: 1,
            editedKinds: ['lecture-notes'] as const,
          } as const),
    figureAssets: [figureFixture(studioId)],
    artifacts: [
      {
        kind: 'lecture-notes' as const,
        relativePath: 'Lecture Notes.tex',
        contentSha256: 'e'.repeat(64),
        savedAt: timestamp,
      },
      {
        kind: 'slides' as const,
        relativePath: 'Slides.tex',
        contentSha256: 'f'.repeat(64),
        savedAt: timestamp,
      },
    ],
    invocation: kind === 'model' ? invocation : null,
    createdAt: timestamp,
  };
}

describe('Lecture Studio immutable manual revision contracts', () => {
  it('accepts V4 model and manual provenance while preserving nullable invocation semantics', () => {
    const model = revisionFixture('model');
    const manual = revisionFixture('manual');
    expect(LectureStudioRevisionSchema.parse(model).schemaVersion).toBe(4);
    expect(LectureStudioRevisionSchema.parse(manual).schemaVersion).toBe(4);
    expect(
      LectureStudioRevisionSchema.safeParse({ ...manual, invocation: model.invocation }).success,
    ).toBe(false);
    expect(LectureStudioRevisionSchema.safeParse({ ...model, invocation: null }).success).toBe(
      false,
    );
    expect(
      LectureStudioRevisionSchema.safeParse({
        ...manual,
        authorship: { ...manual.authorship, editedKinds: ['slides', 'slides'] },
      }).success,
    ).toBe(false);
  });

  it('keeps figure DTOs content-free, normalized, bounded, and Studio-scoped', () => {
    const studioId = randomUUID();
    const figure = figureFixture(studioId);
    expect(JSON.stringify(figure)).not.toContain('bytes');
    expect(JSON.stringify(figure)).not.toContain('/private/');
    expect(
      LectureStudioFigureAssetSchema.safeParse({ ...figure, fileName: 'chosen-name.jpg' }).success,
    ).toBe(false);
    expect(
      LectureStudioEditDraftSchema.safeParse({
        schemaVersion: 1,
        studioId,
        studioVersion: 2,
        baseRevisionId: randomUUID(),
        baseRevision: 1,
        lectureNotesLatexBody: '\\section{Notes}',
        slidesLatexBody: '\\begin{frame}{Slide}Body\\end{frame}',
        figures: Array.from({ length: LECTURE_STUDIO_MAX_FIGURES + 1 }, () =>
          figureFixture(studioId),
        ),
      }).success,
    ).toBe(false);
  });

  it('requires exact version/base fences and body-only LaTeX for drafts and saves', () => {
    const studioId = randomUUID();
    const baseRevisionId = randomUUID();
    const fence = { studioId, expectedVersion: 3, baseRevisionId, baseRevision: 2 };
    expect(GetLectureStudioEditDraftInputSchema.parse(fence)).toEqual(fence);
    expect(
      GetLectureStudioEditDraftInputSchema.safeParse({ ...fence, expectedVersion: 0 }).success,
    ).toBe(false);
    const save = {
      ...fence,
      lectureNotesLatexBody: '\\section{Edited notes}',
      slidesLatexBody: '\\begin{frame}{Edited slide}Body\\end{frame}',
    };
    expect(SaveLectureStudioManualRevisionInputSchema.parse(save)).toEqual(save);
    expect(
      SaveLectureStudioManualRevisionInputSchema.safeParse({
        ...save,
        lectureNotesLatexBody: '\\documentclass{article}\\begin{document}wrapped\\end{document}',
      }).success,
    ).toBe(false);
    expect(
      SaveLectureStudioManualRevisionInputSchema.safeParse({
        ...save,
        lectureNotesLatexBody: 'x'.repeat(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      SaveLectureStudioManualRevisionInputSchema.safeParse({
        ...save,
        localPath: '/private/tmp/Lecture Notes.tex',
      }).success,
    ).toBe(false);
  });
});

describe('Lecture Studio figure IPC contracts', () => {
  it('keeps list/add/remove/preview inputs strict and preview payload hash-bound', () => {
    const studioId = randomUUID();
    const figure = figureFixture(studioId);
    expect(ListLectureStudioFiguresInputSchema.parse({ studioId })).toEqual({ studioId });
    expect(ChooseLectureStudioFiguresInputSchema.parse({ studioId, expectedVersion: 2 })).toEqual({
      studioId,
      expectedVersion: 2,
    });
    expect(
      RemoveLectureStudioFigureInputSchema.parse({
        studioId,
        expectedVersion: 2,
        figureId: figure.id,
        sha256: figure.sha256,
      }),
    ).toMatchObject({ figureId: figure.id, sha256: figure.sha256 });
    expect(
      PreviewLectureStudioFigureInputSchema.parse({
        studioId,
        figureId: figure.id,
        sha256: figure.sha256,
      }),
    ).toMatchObject({ figureId: figure.id, sha256: figure.sha256 });
    expect(
      LectureStudioFigurePreviewSchema.parse({
        schemaVersion: 1,
        figure,
        jpegBase64: Buffer.from('jpeg').toString('base64'),
      }).figure.sha256,
    ).toBe(figure.sha256);
  });

  it('publishes the exact bounded channels and figure diagnostic reason', () => {
    expect(LECTURE_STUDIO_IPC_CHANNELS).toMatchObject({
      editDraft: 'gosu:lecture-studio:edit-draft',
      saveManualRevision: 'gosu:lecture-studio:save-manual-revision',
      listFigures: 'gosu:lecture-studio:list-figures',
      chooseFigures: 'gosu:lecture-studio:choose-figures',
      stageDroppedFigures: 'gosu:lecture-studio:stage-dropped-figures',
      removeFigure: 'gosu:lecture-studio:remove-figure',
      previewFigure: 'gosu:lecture-studio:preview-figure',
    });
    expect(LectureStudioAttemptLatexReasonSchema.parse('invalid_figure_reference')).toBe(
      'invalid_figure_reference',
    );
  });
});
