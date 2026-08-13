import { ModelInvocationSchema } from '@gosu/contracts';
import { z } from 'zod';

import {
  ExperimentIdeaSchema,
  ExperimentMetricPointSchema,
} from './experiment-workspace-contracts';
import { LiteratureRecordSchema } from './literature-contracts';
import { ManuscriptRecordSchema } from './manuscript-workspace-contracts';

export const LECTURE_STUDIO_DURATIONS = [10, 20, 30, 50] as const;
export const LECTURE_STUDIO_MAX_STUDIOS = 100;
export const LECTURE_STUDIO_MAX_SOURCE_PROJECTS = 12;
export const LECTURE_STUDIO_MAX_LITERATURE_SOURCES = 100;
export const LECTURE_STUDIO_MAX_EXPERIMENT_SOURCES = 100;
export const LECTURE_STUDIO_MAX_MANUSCRIPT_SOURCES = 32;
export const LECTURE_STUDIO_MAX_MANUSCRIPT_FILES = 128;
export const LECTURE_STUDIO_MAX_MESSAGES = 2_500;
export const LECTURE_STUDIO_MAX_REVISIONS = 1_000;
export const LECTURE_STUDIO_MAX_MESSAGE_LENGTH = 32_000;
export const LECTURE_STUDIO_MAX_MARKDOWN_LENGTH = 200_000;
export const LECTURE_STUDIO_CANDIDATE_PAGE_MAX = 100;
export const LECTURE_STUDIO_CANDIDATE_METRIC_LIMIT_DEFAULT = 20;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const prefixedSha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const talkDurationSchema = z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(50)]);

export const LectureStudioKindSchema = z.enum(['lecture', 'talk']);
export type LectureStudioKind = z.infer<typeof LectureStudioKindSchema>;

export const LectureStudioDurationSchema = talkDurationSchema;
export type LectureStudioDuration = z.infer<typeof LectureStudioDurationSchema>;

export const LectureStudioStatusSchema = z.enum(['draft', 'generating', 'ready', 'failed']);
export type LectureStudioStatus = z.infer<typeof LectureStudioStatusSchema>;

export const LectureLiteratureSelectionSchema = z
  .object({ projectId: uuidSchema, recordId: uuidSchema })
  .strict();
export type LectureLiteratureSelection = z.infer<typeof LectureLiteratureSelectionSchema>;

export const LectureExperimentSelectionSchema = z
  .object({ projectId: uuidSchema, ideaId: uuidSchema })
  .strict();
export type LectureExperimentSelection = z.infer<typeof LectureExperimentSelectionSchema>;

export const LectureManuscriptSelectionSchema = z
  .object({ projectId: uuidSchema, manuscriptId: uuidSchema })
  .strict();
export type LectureManuscriptSelection = z.infer<typeof LectureManuscriptSelectionSchema>;

export const LectureSourceSelectionSchema = z
  .object({
    literature: z
      .array(LectureLiteratureSelectionSchema)
      .max(LECTURE_STUDIO_MAX_LITERATURE_SOURCES),
    experiments: z
      .array(LectureExperimentSelectionSchema)
      .max(LECTURE_STUDIO_MAX_EXPERIMENT_SOURCES),
    manuscripts: z
      .array(LectureManuscriptSelectionSchema)
      .max(LECTURE_STUDIO_MAX_MANUSCRIPT_SOURCES)
      .default([]),
  })
  .strict()
  .superRefine((selection, context) => {
    if (
      selection.literature.length + selection.experiments.length + selection.manuscripts.length ===
      0
    ) {
      context.addIssue({ code: 'custom', message: 'At least one source must be selected' });
    }
    for (const [key, values] of [
      ['literature', selection.literature.map((item) => `${item.projectId}:${item.recordId}`)],
      ['experiments', selection.experiments.map((item) => `${item.projectId}:${item.ideaId}`)],
      [
        'manuscripts',
        selection.manuscripts.map((item) => `${item.projectId}:${item.manuscriptId}`),
      ],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Source references must be unique',
        });
      }
    }
  });
export type LectureSourceSelection = z.output<typeof LectureSourceSelectionSchema>;

function validateStudioSourceBoundary(
  studio: {
    kind: LectureStudioKind;
    durationMinutes: LectureStudioDuration | null;
    outputProjectId: string;
    sourceProjectIds: readonly string[];
    sourceSelection: LectureSourceSelection;
  },
  context: z.RefinementCtx,
) {
  if ((studio.kind === 'talk') !== (studio.durationMinutes !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['durationMinutes'],
      message: 'Talk studios require a duration and lecture studios must not set one',
    });
  }
  if (new Set(studio.sourceProjectIds).size !== studio.sourceProjectIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['sourceProjectIds'],
      message: 'Source project IDs must be unique',
    });
  }
  const selectedProjects = new Set(studio.sourceProjectIds);
  if (!selectedProjects.has(studio.outputProjectId)) {
    context.addIssue({
      code: 'custom',
      path: ['outputProjectId'],
      message: 'The output project must be one of the selected source projects',
    });
  }
  for (const [group, references] of [
    ['literature', studio.sourceSelection.literature],
    ['experiments', studio.sourceSelection.experiments],
    ['manuscripts', studio.sourceSelection.manuscripts],
  ] as const) {
    for (const [index, reference] of references.entries()) {
      if (!selectedProjects.has(reference.projectId)) {
        context.addIssue({
          code: 'custom',
          path: ['sourceSelection', group, index, 'projectId'],
          message: 'Every source must belong to a selected project',
        });
      }
    }
  }
}

const lectureStudioConfigurationShape = {
  title: boundedText(160),
  kind: LectureStudioKindSchema,
  durationMinutes: LectureStudioDurationSchema.nullable(),
  outputProjectId: uuidSchema,
  sourceProjectIds: z.array(uuidSchema).min(1).max(LECTURE_STUDIO_MAX_SOURCE_PROJECTS),
  sourceSelection: LectureSourceSelectionSchema,
} as const;

export const LectureStudioSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    ...lectureStudioConfigurationShape,
    status: LectureStudioStatusSchema,
    activeAttemptId: uuidSchema.nullable(),
    currentRevision: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    lastErrorCode: z.string().trim().min(1).max(128).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((studio, context) => {
    validateStudioSourceBoundary(studio, context);
    if ((studio.status === 'generating') !== (studio.activeAttemptId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['activeAttemptId'],
        message: 'Only a generating studio can have an active attempt',
      });
    }
    if (studio.status !== 'failed' && studio.lastErrorCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['lastErrorCode'],
        message: 'Only a failed studio can retain an error code',
      });
    }
  });
export type LectureStudio = z.infer<typeof LectureStudioSchema>;

export const LectureStudioArtifactSchema = z
  .object({
    kind: z.enum(['lecture-notes', 'slides']),
    relativePath: z
      .string()
      .trim()
      .min(1)
      .max(1_024)
      .refine(
        (value) =>
          !value.startsWith('/') &&
          !value.includes('\\') &&
          value
            .split('/')
            .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
        { message: 'Artifact paths must be safe Research Notes relative paths' },
      ),
    contentSha256: sha256Schema,
    savedAt: timestampSchema,
  })
  .strict();
export type LectureStudioArtifact = z.infer<typeof LectureStudioArtifactSchema>;

export type PendingLectureRevisionArtifacts = Readonly<{
  outputProjectId: string;
  bindingId: string;
  vaultId: string;
  bundleId: string;
  relativeBundlePath: string;
  studioId: string;
  revision: number;
  attemptId: string;
  sourceManifestSha256: string;
  artifacts: readonly [
    Omit<LectureStudioArtifact, 'savedAt'>,
    Omit<LectureStudioArtifact, 'savedAt'>,
  ];
}>;

export const LectureSourceMetricSnapshotSchema = ExperimentMetricPointSchema.pick({
  sequence: true,
  objectiveId: true,
  objectiveVersion: true,
  metricKey: true,
  metricDisplayName: true,
  direction: true,
  unit: true,
  aggregation: true,
  evaluatorHash: true,
  datasetHash: true,
  holdoutHash: true,
  baseline: true,
  target: true,
  value: true,
  trialId: true,
  recordedAt: true,
}).strict();

export const LectureLiteratureSourceSnapshotSchema = z
  .object({
    sourceLabel: boundedText(32),
    projectId: uuidSchema,
    projectName: boundedText(160),
    recordId: uuidSchema,
    recordVersion: z.number().int().positive(),
    annotationVersion: z.number().int().nonnegative(),
    title: boundedText(2_000),
    authors: z.array(boundedText(500)).max(200),
    containerTitle: z.string().trim().min(1).max(1_000).nullable(),
    publishedYear: z.number().int().min(1_000).max(3_000).nullable(),
    doi: z.string().trim().min(1).max(512).nullable(),
    citationKey: z.string().trim().min(1).max(160).nullable(),
    reviewStatus: LiteratureRecordSchema.shape.reviewStatus,
    topics: z.array(boundedText(240)).max(40),
    metadataSummary: z.string().trim().max(8_000),
    metadataOnly: z.literal(true),
  })
  .strict();

export const LectureExperimentSourceSnapshotSchema = z
  .object({
    sourceLabel: boundedText(32),
    projectId: uuidSchema,
    projectName: boundedText(160),
    ideaId: uuidSchema,
    ideaVersion: z.number().int().positive(),
    parentIdeaId: uuidSchema.nullable(),
    title: boundedText(160),
    hypothesis: z.string().trim().max(4_000),
    phase: z.string().trim().max(80),
    outcome: ExperimentIdeaSchema.shape.outcome,
    resultSummary: z.string().trim().max(4_000),
    metrics: z.array(LectureSourceMetricSnapshotSchema).max(1_000),
  })
  .strict();

export const LectureManuscriptSourceFileSchema = z
  .object({
    relativePath: z
      .string()
      .trim()
      .min(1)
      .max(1_024)
      .refine(
        (value) =>
          !value.startsWith('/') &&
          !value.includes('\\') &&
          value
            .split('/')
            .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
        { message: 'Manuscript source paths must be safe checkpoint-relative paths' },
      ),
    contentSha256: sha256Schema,
    content: z.string().max(24_000),
  })
  .strict();

export const LectureManuscriptSourceSnapshotSchema = z
  .object({
    sourceLabel: boundedText(32),
    projectId: uuidSchema,
    projectName: boundedText(160),
    manuscriptId: uuidSchema,
    manuscriptVersion: z.number().int().positive(),
    title: boundedText(160),
    rootDocument: ManuscriptRecordSchema.shape.rootDocument,
    checkpointId: uuidSchema,
    providerId: boundedText(128),
    providerRevision: boundedText(512),
    revisionEnvelopeDigest: prefixedSha256Schema,
    observedAt: timestampSchema,
    files: z
      .array(LectureManuscriptSourceFileSchema)
      .min(1)
      .max(LECTURE_STUDIO_MAX_MANUSCRIPT_FILES),
    contentKind: z.literal('captured_latex'),
    metadataOnly: z.literal(false),
  })
  .strict();

export const LectureSourceManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    selectedProjectIds: z.array(uuidSchema).min(1).max(LECTURE_STUDIO_MAX_SOURCE_PROJECTS),
    literature: z
      .array(LectureLiteratureSourceSnapshotSchema)
      .max(LECTURE_STUDIO_MAX_LITERATURE_SOURCES),
    experiments: z
      .array(LectureExperimentSourceSnapshotSchema)
      .max(LECTURE_STUDIO_MAX_EXPERIMENT_SOURCES),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (new Set(manifest.selectedProjectIds).size !== manifest.selectedProjectIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['selectedProjectIds'],
        message: 'Selected projects must be unique',
      });
    }
    if (manifest.literature.length + manifest.experiments.length === 0) {
      context.addIssue({ code: 'custom', message: 'A source manifest cannot be empty' });
    }
    const projects = new Set(manifest.selectedProjectIds);
    for (const [group, values] of [
      ['literature', manifest.literature],
      ['experiments', manifest.experiments],
    ] as const) {
      const labels = values.map((value) => value.sourceLabel);
      if (new Set(labels).size !== labels.length) {
        context.addIssue({
          code: 'custom',
          path: [group],
          message: 'Source labels must be unique',
        });
      }
      values.forEach((value, index) => {
        if (!projects.has(value.projectId)) {
          context.addIssue({
            code: 'custom',
            path: [group, index, 'projectId'],
            message: 'Manifest sources must belong to a selected project',
          });
        }
      });
    }
  });
export type LectureSourceManifestV1 = z.infer<typeof LectureSourceManifestV1Schema>;

export const LectureSourceManifestV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    selectedProjectIds: z.array(uuidSchema).min(1).max(LECTURE_STUDIO_MAX_SOURCE_PROJECTS),
    literature: z
      .array(LectureLiteratureSourceSnapshotSchema)
      .max(LECTURE_STUDIO_MAX_LITERATURE_SOURCES),
    experiments: z
      .array(LectureExperimentSourceSnapshotSchema)
      .max(LECTURE_STUDIO_MAX_EXPERIMENT_SOURCES),
    manuscripts: z
      .array(LectureManuscriptSourceSnapshotSchema)
      .max(LECTURE_STUDIO_MAX_MANUSCRIPT_SOURCES),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (new Set(manifest.selectedProjectIds).size !== manifest.selectedProjectIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['selectedProjectIds'],
        message: 'Selected projects must be unique',
      });
    }
    if (
      manifest.literature.length + manifest.experiments.length + manifest.manuscripts.length ===
      0
    ) {
      context.addIssue({ code: 'custom', message: 'A source manifest cannot be empty' });
    }
    const projects = new Set(manifest.selectedProjectIds);
    const allLabels = [
      ...manifest.literature.map((value) => value.sourceLabel),
      ...manifest.experiments.map((value) => value.sourceLabel),
      ...manifest.manuscripts.map((value) => value.sourceLabel),
    ];
    if (new Set(allLabels).size !== allLabels.length) {
      context.addIssue({
        code: 'custom',
        path: ['manuscripts'],
        message: 'Source labels must be unique across the manifest',
      });
    }
    for (const [group, values] of [
      ['literature', manifest.literature],
      ['experiments', manifest.experiments],
      ['manuscripts', manifest.manuscripts],
    ] as const) {
      values.forEach((value, index) => {
        if (!projects.has(value.projectId)) {
          context.addIssue({
            code: 'custom',
            path: [group, index, 'projectId'],
            message: 'Manifest sources must belong to a selected project',
          });
        }
      });
    }
  });

export const LectureSourceManifestSchema = z.discriminatedUnion('schemaVersion', [
  LectureSourceManifestV1Schema,
  LectureSourceManifestV2Schema,
]);
export type LectureSourceManifest = z.infer<typeof LectureSourceManifestSchema>;

export const LectureStudioRevisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    studioId: uuidSchema,
    revision: z.number().int().positive(),
    attemptId: uuidSchema,
    sourceManifest: LectureSourceManifestSchema,
    sourceManifestSha256: sha256Schema,
    lectureNotesMarkdown: z.string().min(1).max(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH),
    slidesMarkdown: z.string().min(1).max(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH),
    artifacts: z.array(LectureStudioArtifactSchema).length(2),
    invocation: ModelInvocationSchema,
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((revision, context) => {
    const artifactKinds = new Set(revision.artifacts.map((artifact) => artifact.kind));
    if (!artifactKinds.has('lecture-notes') || !artifactKinds.has('slides')) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'Every revision must record both lecture notes and slides artifacts',
      });
    }
  });
export type LectureStudioRevision = z.infer<typeof LectureStudioRevisionSchema>;

export const LectureStudioMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    studioId: uuidSchema,
    role: z.enum(['user', 'assistant']),
    status: z.enum(['complete', 'failed', 'interrupted']),
    content: z.string().trim().min(1).max(LECTURE_STUDIO_MAX_MESSAGE_LENGTH),
    attemptId: uuidSchema.nullable(),
    revision: z.number().int().positive().nullable(),
    invocation: ModelInvocationSchema.nullable(),
    createdAt: timestampSchema,
    completedAt: timestampSchema,
  })
  .strict()
  .superRefine((message, context) => {
    if (message.role === 'user' && (message.revision !== null || message.invocation !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'User messages cannot claim a generated revision or model invocation',
      });
    }
  });
export type LectureStudioMessage = z.infer<typeof LectureStudioMessageSchema>;

export const LectureStudioSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    title: lectureStudioConfigurationShape.title,
    kind: LectureStudioKindSchema,
    durationMinutes: LectureStudioDurationSchema.nullable(),
    outputProjectId: uuidSchema,
    status: LectureStudioStatusSchema,
    activeAttemptId: uuidSchema.nullable(),
    currentRevision: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    lastErrorCode: z.string().trim().min(1).max(128).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((studio, context) => {
    if ((studio.kind === 'talk') !== (studio.durationMinutes !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['durationMinutes'],
        message: 'Talk summaries require a duration and lecture summaries must not set one',
      });
    }
    if ((studio.status === 'generating') !== (studio.activeAttemptId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['activeAttemptId'],
        message: 'Only a generating studio summary can have an active attempt',
      });
    }
    if (studio.status !== 'failed' && studio.lastErrorCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['lastErrorCode'],
        message: 'Only a failed studio summary can retain an error code',
      });
    }
  });
export type LectureStudioSummary = z.infer<typeof LectureStudioSummarySchema>;

export const LectureStudioListSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    studios: z.array(LectureStudioSummarySchema).max(LECTURE_STUDIO_MAX_STUDIOS),
  })
  .strict();
export type LectureStudioListSnapshot = z.infer<typeof LectureStudioListSnapshotSchema>;

export const LectureStudioDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    studio: LectureStudioSchema,
    messages: z.array(LectureStudioMessageSchema).max(LECTURE_STUDIO_MAX_MESSAGES),
    revisions: z.array(LectureStudioRevisionSchema).max(LECTURE_STUDIO_MAX_REVISIONS),
  })
  .strict()
  .superRefine((detail, context) => {
    detail.messages.forEach((message, index) => {
      if (message.studioId !== detail.studio.id) {
        context.addIssue({
          code: 'custom',
          path: ['messages', index, 'studioId'],
          message: 'Lecture messages must belong to the detailed studio',
        });
      }
    });
    detail.revisions.forEach((revision, index) => {
      if (
        revision.studioId !== detail.studio.id ||
        revision.revision > detail.studio.currentRevision
      ) {
        context.addIssue({
          code: 'custom',
          path: ['revisions', index, 'revision'],
          message: 'Lecture revisions must belong to the detailed studio history',
        });
      }
    });
  });
export type LectureStudioDetail = z.infer<typeof LectureStudioDetailSchema>;

export const LectureCandidateExperimentSchema = z
  .object({
    idea: ExperimentIdeaSchema,
    metricPoints: z.array(ExperimentMetricPointSchema).max(LECTURE_STUDIO_CANDIDATE_PAGE_MAX),
    metricPointTotal: z.number().int().nonnegative(),
    metricsTruncated: z.boolean(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.metricPointTotal < candidate.metricPoints.length) {
      context.addIssue({
        code: 'custom',
        path: ['metricPointTotal'],
        message: 'Metric totals cannot be smaller than the returned metric page',
      });
    }
    if (candidate.metricsTruncated !== candidate.metricPointTotal > candidate.metricPoints.length) {
      context.addIssue({
        code: 'custom',
        path: ['metricsTruncated'],
        message: 'Metric truncation metadata is inconsistent',
      });
    }
    candidate.metricPoints.forEach((point, index) => {
      if (point.projectId !== candidate.idea.projectId || point.ideaId !== candidate.idea.id) {
        context.addIssue({
          code: 'custom',
          path: ['metricPoints', index, 'ideaId'],
          message: 'Candidate metrics must belong to the candidate idea and project',
        });
      }
    });
  });

export const LectureCandidateManuscriptSchema = z
  .object({
    manuscript: ManuscriptRecordSchema,
    availability: z.enum(['ready', 'capture_required', 'unconnected']),
    checkpointId: uuidSchema.nullable(),
    providerRevision: z.string().trim().min(1).max(512).nullable(),
    observedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((candidate, context) => {
    const captured = candidate.checkpointId !== null && candidate.observedAt !== null;
    if ((candidate.availability === 'ready') !== captured) {
      context.addIssue({
        code: 'custom',
        path: ['availability'],
        message: 'Only a ready manuscript candidate can expose a captured checkpoint',
      });
    }
  });

export const LectureCandidatePageSchema = z
  .object({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(LECTURE_STUDIO_CANDIDATE_PAGE_MAX),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.hasMore !== page.offset + page.limit < page.total) {
      context.addIssue({
        code: 'custom',
        path: ['hasMore'],
        message: 'Candidate pagination metadata is inconsistent',
      });
    }
  });

export const LectureCandidateProjectSchema = z
  .object({
    projectId: uuidSchema,
    projectName: boundedText(160),
    literatureRecords: z.array(LiteratureRecordSchema).max(LECTURE_STUDIO_CANDIDATE_PAGE_MAX),
    literaturePage: LectureCandidatePageSchema,
    experiments: z.array(LectureCandidateExperimentSchema).max(LECTURE_STUDIO_CANDIDATE_PAGE_MAX),
    experimentPage: LectureCandidatePageSchema,
    manuscripts: z
      .array(LectureCandidateManuscriptSchema)
      .max(LECTURE_STUDIO_MAX_MANUSCRIPT_SOURCES),
  })
  .strict()
  .superRefine((project, context) => {
    project.literatureRecords.forEach((record, index) => {
      if (record.projectId !== project.projectId) {
        context.addIssue({
          code: 'custom',
          path: ['literatureRecords', index, 'projectId'],
          message: 'Literature candidates must belong to the candidate project',
        });
      }
    });
    project.experiments.forEach((experiment, index) => {
      if (experiment.idea.projectId !== project.projectId) {
        context.addIssue({
          code: 'custom',
          path: ['experiments', index, 'idea', 'projectId'],
          message: 'Experiment candidates must belong to the candidate project',
        });
      }
    });
    project.manuscripts.forEach((candidate, index) => {
      if (candidate.manuscript.projectId !== project.projectId) {
        context.addIssue({
          code: 'custom',
          path: ['manuscripts', index, 'manuscript', 'projectId'],
          message: 'Manuscript candidates must belong to the candidate project',
        });
      }
    });
    if (project.literatureRecords.length > project.literaturePage.limit) {
      context.addIssue({
        code: 'custom',
        path: ['literatureRecords'],
        message: 'Literature candidate pages cannot exceed the requested limit',
      });
    }
    if (
      project.literatureRecords.length >
      Math.max(0, project.literaturePage.total - project.literaturePage.offset)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['literatureRecords'],
        message: 'Literature candidate rows exceed the reported total',
      });
    }
    if (project.experiments.length > project.experimentPage.limit) {
      context.addIssue({
        code: 'custom',
        path: ['experiments'],
        message: 'Experiment candidate pages cannot exceed the requested limit',
      });
    }
    if (
      project.experiments.length >
      Math.max(0, project.experimentPage.total - project.experimentPage.offset)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['experiments'],
        message: 'Experiment candidate rows exceed the reported total',
      });
    }
  });

export const LectureSourceCandidatesSchema = z
  .object({
    schemaVersion: z.literal(1),
    projects: z.array(LectureCandidateProjectSchema).max(LECTURE_STUDIO_MAX_SOURCE_PROJECTS),
  })
  .strict()
  .refine(
    (candidates) =>
      new Set(candidates.projects.map((project) => project.projectId)).size ===
      candidates.projects.length,
    { path: ['projects'], message: 'Candidate projects must be unique' },
  );
export type LectureSourceCandidates = z.infer<typeof LectureSourceCandidatesSchema>;

export const ListLectureStudiosInputSchema = z.object({}).strict();
export type ListLectureStudiosInput = z.infer<typeof ListLectureStudiosInputSchema>;

export const LectureStudioDetailInputSchema = z.object({ studioId: uuidSchema }).strict();
export type LectureStudioDetailInput = z.infer<typeof LectureStudioDetailInputSchema>;

export const ListLectureCandidatesInputSchema = z
  .object({
    projectIds: z.array(uuidSchema).min(1).max(LECTURE_STUDIO_MAX_SOURCE_PROJECTS),
    literatureOffset: z.number().int().nonnegative().default(0),
    literatureLimit: z
      .number()
      .int()
      .positive()
      .max(LECTURE_STUDIO_CANDIDATE_PAGE_MAX)
      .default(LECTURE_STUDIO_CANDIDATE_PAGE_MAX),
    experimentOffset: z.number().int().nonnegative().default(0),
    experimentLimit: z
      .number()
      .int()
      .positive()
      .max(LECTURE_STUDIO_CANDIDATE_PAGE_MAX)
      .default(LECTURE_STUDIO_CANDIDATE_PAGE_MAX),
    metricPointLimit: z
      .number()
      .int()
      .positive()
      .max(LECTURE_STUDIO_CANDIDATE_PAGE_MAX)
      .default(LECTURE_STUDIO_CANDIDATE_METRIC_LIMIT_DEFAULT),
    includeUnreviewed: z.boolean().default(false),
  })
  .strict()
  .refine((input) => new Set(input.projectIds).size === input.projectIds.length, {
    path: ['projectIds'],
    message: 'Project IDs must be unique',
  });
export type ListLectureCandidatesInput = z.input<typeof ListLectureCandidatesInputSchema>;

export const CreateLectureStudioInputSchema = z
  .object(lectureStudioConfigurationShape)
  .strict()
  .superRefine(validateStudioSourceBoundary);
export type CreateLectureStudioInput = Omit<
  z.infer<typeof CreateLectureStudioInputSchema>,
  'sourceSelection'
> & {
  sourceSelection: Omit<LectureSourceSelection, 'manuscripts'> & {
    manuscripts?: LectureSourceSelection['manuscripts'];
  };
};

const lectureTurnShape = {
  studioId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  requestedModelId: boundedText(256).nullable(),
  reasoningOptionId: boundedText(128).nullable(),
} as const;

export const GenerateLectureStudioInputSchema = z.object(lectureTurnShape).strict();
export type GenerateLectureStudioInput = z.infer<typeof GenerateLectureStudioInputSchema>;

export const SendLectureStudioMessageInputSchema = z
  .object({ ...lectureTurnShape, message: boundedText(LECTURE_STUDIO_MAX_MESSAGE_LENGTH) })
  .strict();
export type SendLectureStudioMessageInput = z.infer<typeof SendLectureStudioMessageInputSchema>;

export const CancelLectureStudioInputSchema = z
  .object({
    studioId: uuidSchema,
    attemptId: uuidSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type CancelLectureStudioInput = z.infer<typeof CancelLectureStudioInputSchema>;

export const LectureStudioGenerationOutputSchema = z
  .object({
    reply: boundedText(LECTURE_STUDIO_MAX_MESSAGE_LENGTH),
    lectureNotesMarkdown: z.string().min(1).max(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH),
    slidesMarkdown: z.string().min(1).max(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH),
  })
  .strict();
export type LectureStudioGenerationOutput = z.infer<typeof LectureStudioGenerationOutputSchema>;

export const LECTURE_STUDIO_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string', minLength: 1, maxLength: LECTURE_STUDIO_MAX_MESSAGE_LENGTH },
    lectureNotesMarkdown: {
      type: 'string',
      minLength: 1,
      maxLength: LECTURE_STUDIO_MAX_MARKDOWN_LENGTH,
    },
    slidesMarkdown: {
      type: 'string',
      minLength: 1,
      maxLength: LECTURE_STUDIO_MAX_MARKDOWN_LENGTH,
    },
  },
  required: ['reply', 'lectureNotesMarkdown', 'slidesMarkdown'],
} as const;

export const LectureStudioTurnReceiptSchema = z
  .object({
    studio: LectureStudioSchema,
    revision: LectureStudioRevisionSchema,
    assistantMessage: LectureStudioMessageSchema,
  })
  .strict();
export type LectureStudioTurnReceipt = z.infer<typeof LectureStudioTurnReceiptSchema>;

export const LectureStudioEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('lecture.studio.changed'),
    studioId: uuidSchema,
    status: LectureStudioStatusSchema,
    version: z.number().int().positive(),
    occurredAt: timestampSchema,
  })
  .strict();
export type LectureStudioEvent = z.infer<typeof LectureStudioEventSchema>;

export const LECTURE_STUDIO_IPC_ERROR_CODES = [
  'invalid_lecture_input',
  'lecture_unavailable',
  'lecture_studio_not_found',
  'lecture_version_conflict',
  'lecture_source_not_found',
  'lecture_source_conflict',
  'lecture_context_too_large',
  'lecture_research_notes_required',
  'lecture_busy',
  'lecture_not_active',
  'lecture_codex_unavailable',
  'lecture_invalid_response',
  'lecture_persistence_failed',
  'lecture_capacity_reached',
  'lecture_cancelled',
] as const;
export type LectureStudioIpcErrorCode = (typeof LECTURE_STUDIO_IPC_ERROR_CODES)[number];

export type LectureStudioIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: LectureStudioIpcErrorCode }> }>;
