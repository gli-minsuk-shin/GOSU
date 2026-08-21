import { ModelInvocationSchema } from '@gosu/contracts';
import { z } from 'zod';

import {
  ExperimentIdeaSchema,
  ExperimentMetricPointSchema,
} from './experiment-workspace-contracts';
import { LiteratureRecordSchema } from './literature-contracts';
import { LectureExternalSourceSnapshotSchema } from './lecture-external-source-contracts';
import {
  LECTURE_STUDIO_MAX_ATTACHMENTS,
  LectureStudioAttachmentCardSchema,
  LectureStudioAttachmentFormatSchema,
  LectureStudioAttachmentIdsSchema,
  LectureStudioAttachmentUnitLabelSchema,
} from './lecture-studio-attachment-contracts';
import { ManuscriptRecordSchema } from './manuscript-workspace-contracts';
import { PdfPreviewDocumentSchema } from './pdf-preview-contracts';
import { PROJECT_CHAT_MAX_NORMALIZED_IMAGE_BYTES } from './project-chat-attachment-contracts';

export const LECTURE_STUDIO_DURATIONS = [10, 20, 30, 50] as const;
export const LECTURE_STUDIO_MAX_STUDIOS = 100;
export const LECTURE_STUDIO_MAX_TRASHED_STUDIOS = 1_000;
export const LECTURE_STUDIO_MAX_STORED_STUDIOS =
  LECTURE_STUDIO_MAX_STUDIOS + LECTURE_STUDIO_MAX_TRASHED_STUDIOS;
export const LECTURE_STUDIO_MAX_SOURCE_PROJECTS = 12;
export const LECTURE_STUDIO_MAX_LITERATURE_SOURCES = 100;
export const LECTURE_STUDIO_MAX_EXPERIMENT_SOURCES = 100;
export const LECTURE_STUDIO_MAX_MANUSCRIPT_SOURCES = 32;
export const LECTURE_STUDIO_MAX_EXTERNAL_SOURCES = 12;
export const LECTURE_STUDIO_MAX_MANUSCRIPT_FILES = 128;
export const LECTURE_STUDIO_MAX_GENERATION_INSTRUCTIONS = 6_000;
export const LECTURE_STUDIO_MAX_GENERATION_BRIEF_JSON = 14_000;
export const LECTURE_STUDIO_MAX_STRUCTURE_SECTIONS = 12;
export const LECTURE_STUDIO_MAX_STRUCTURE_SECTION_TITLE = 80;
export const LECTURE_STUDIO_MAX_MESSAGES = 2_500;
export const LECTURE_STUDIO_MAX_REVISIONS = 1_000;
export const LECTURE_STUDIO_MAX_RETAINED_FAILURE_ATTEMPTS = 100;
export const LECTURE_STUDIO_MAX_MESSAGE_LENGTH = 32_000;
export const LECTURE_STUDIO_MAX_MARKDOWN_LENGTH = 200_000;
export const LECTURE_STUDIO_MAX_LATEX_LENGTH = 240_000;
export const LECTURE_STUDIO_MAX_FIGURES = 5;
export const LECTURE_STUDIO_MAX_FIGURE_EDGE = 2_048;
export const LECTURE_STUDIO_MAX_FIGURE_BYTES = PROJECT_CHAT_MAX_NORMALIZED_IMAGE_BYTES;
export const EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION = 'EMPTY LECTURE TRASH';
export const LECTURE_STUDIO_CANDIDATE_PAGE_MAX = 100;
export const LECTURE_STUDIO_CANDIDATE_METRIC_LIMIT_DEFAULT = 20;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const prefixedSha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const talkDurationSchema = z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(50)]);
const containsUnsafeControlCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });

export const LectureStudioKindSchema = z.enum(['lecture', 'talk']);
export type LectureStudioKind = z.infer<typeof LectureStudioKindSchema>;

export const LectureStudioDurationSchema = talkDurationSchema;
export type LectureStudioDuration = z.infer<typeof LectureStudioDurationSchema>;

export const LectureStudioDetailLevelSchema = z.enum([
  'concise',
  'standard',
  'detailed',
  'exhaustive',
]);
export type LectureStudioDetailLevel = z.infer<typeof LectureStudioDetailLevelSchema>;

export const LectureStudioStructureCoverageSchema = z.enum(['notes-and-slides', 'notes-only']);
export type LectureStudioStructureCoverage = z.infer<typeof LectureStudioStructureCoverageSchema>;

export const LectureStudioDocumentFeaturesSchema = z
  .object({
    includeSlideTitlePage: z.boolean(),
    showInlineEvidenceLabels: z.boolean(),
    includeSourcesUsedSection: z.boolean(),
  })
  .strict();
export type LectureStudioDocumentFeatures = z.infer<typeof LectureStudioDocumentFeaturesSchema>;

export const DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES = Object.freeze({
  includeSlideTitlePage: true,
  showInlineEvidenceLabels: true,
  includeSourcesUsedSection: true,
}) satisfies LectureStudioDocumentFeatures;

export function resolveLectureStudioDocumentFeatures(
  value: LectureStudioDocumentFeatures | undefined,
): LectureStudioDocumentFeatures {
  return LectureStudioDocumentFeaturesSchema.parse(
    value ?? DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
  );
}

export const DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE = {
  mode: 'adaptive',
} as const;

export const GOSU_LECTURE_STUDIO_STRUCTURE_TEMPLATE = {
  mode: 'custom',
  sections: [
    { title: 'Overview and learning goals', coverage: 'notes-and-slides' },
    { title: 'Background, definitions, and notation', coverage: 'notes-and-slides' },
    { title: 'Main concepts and evidence', coverage: 'notes-and-slides' },
    { title: 'Methods, examples, and comparisons', coverage: 'notes-and-slides' },
    { title: 'Limitations and open questions', coverage: 'notes-and-slides' },
    { title: 'Summary', coverage: 'notes-and-slides' },
  ],
} as const;

export const LECTURE_STUDIO_SOURCE_LIST_SECTION_TITLES = [
  'Sources used',
  'Source used',
  'Source',
  'Sources',
  'Source list',
  'Sources list',
  'Source section',
  'Sources section',
  'References',
  'Reference list',
  'References list',
  'Reference section',
  'References section',
  'Bibliography',
  'Works cited',
  'Citations',
  'Cited sources',
  'Literature cited',
  '출처 목록',
  '출처 섹션',
  '출처 매핑',
  '참고 문헌',
] as const;

export function normalizeLectureStudioDocumentSectionTitle(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

const hasUnsafeStructureCharacter = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 31 ||
      (codePoint >= 127 && codePoint <= 159) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint === 0x061c ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      codePoint === 0x2060 ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff
    );
  });

export const LectureStudioStructureSectionSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(LECTURE_STUDIO_MAX_STRUCTURE_SECTION_TITLE)
      .transform((value) => value.normalize('NFC'))
      .refine((value) => !hasUnsafeStructureCharacter(value), {
        message: 'Structure section names cannot contain hidden or control characters',
      })
      .refine((value) => !/[\\[\]{}<>]/u.test(value), {
        message: 'Structure section names must be plain text',
      })
      .refine((value) => !['sources used', 'title', 'title slide'].includes(value.toLowerCase()), {
        message: 'Document-level items cannot be added to the custom content flow',
      }),
    coverage: LectureStudioStructureCoverageSchema,
  })
  .strict();
export type LectureStudioStructureSection = z.infer<typeof LectureStudioStructureSectionSchema>;

export const LectureStudioStructureTemplateSchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('adaptive') }).strict(),
    z
      .object({
        mode: z.literal('custom'),
        sections: z
          .array(LectureStudioStructureSectionSchema)
          .min(1)
          .max(LECTURE_STUDIO_MAX_STRUCTURE_SECTIONS),
      })
      .strict(),
  ])
  .superRefine((template, context) => {
    if (template.mode !== 'custom') return;
    const normalizedTitles = template.sections.map((section) => section.title.toLowerCase());
    if (new Set(normalizedTitles).size !== normalizedTitles.length) {
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'Structure section names must be unique',
      });
    }
    if (!template.sections.some((section) => section.coverage === 'notes-and-slides')) {
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'At least one section must be covered in both notes and slides',
      });
    }
  });
export type LectureStudioStructureTemplate = z.infer<typeof LectureStudioStructureTemplateSchema>;

const lectureStudioGenerationBriefShape = {
  notesTargetPages: z.number().int().min(1).max(100).nullable(),
  slidesTargetPages: z.number().int().min(1).max(100).nullable(),
  detailLevel: LectureStudioDetailLevelSchema,
  structure: LectureStudioStructureTemplateSchema,
  // Historical v3 revision snapshots must preserve the exact JSON that was hashed before
  // document features existed. Do not add a Zod default or transform to this field.
  documentFeatures: LectureStudioDocumentFeaturesSchema.optional(),
  customInstructions: z
    .string()
    .trim()
    .max(LECTURE_STUDIO_MAX_GENERATION_INSTRUCTIONS)
    .refine(
      (value) => !containsUnsafeControlCharacter(value),
      'Generation instructions cannot contain control characters',
    ),
} as const;

const lectureStudioGenerationBriefFitsStorage = (brief: unknown) =>
  JSON.stringify(brief).length <= LECTURE_STUDIO_MAX_GENERATION_BRIEF_JSON;

const validateLectureStudioGenerationBrief = (
  brief: {
    slidesTargetPages: number | null;
    documentFeatures?: LectureStudioDocumentFeatures | undefined;
  },
  context: z.RefinementCtx,
) => {
  const features = resolveLectureStudioDocumentFeatures(brief.documentFeatures);
  if (features.includeSlideTitlePage && brief.slidesTargetPages === 1) {
    context.addIssue({
      code: 'custom',
      path: ['slidesTargetPages'],
      message: 'A slide target with a title page must leave room for at least one content page',
    });
  }
};

export const LectureStudioGenerationBriefValueSchema = z
  .object(lectureStudioGenerationBriefShape)
  .strict()
  .superRefine(validateLectureStudioGenerationBrief)
  .refine(lectureStudioGenerationBriefFitsStorage, 'The complete generation options are too large');

export const CurrentLectureStudioGenerationBriefValueSchema = z
  .object({
    ...lectureStudioGenerationBriefShape,
    documentFeatures: LectureStudioDocumentFeaturesSchema,
  })
  .strict()
  .superRefine(validateLectureStudioGenerationBrief)
  .refine(lectureStudioGenerationBriefFitsStorage, 'The complete generation options are too large');

export const LectureStudioGenerationBriefSchema = z
  .object({
    notesTargetPages: lectureStudioGenerationBriefShape.notesTargetPages.default(null),
    slidesTargetPages: lectureStudioGenerationBriefShape.slidesTargetPages.default(null),
    detailLevel: lectureStudioGenerationBriefShape.detailLevel.default('standard'),
    structure: lectureStudioGenerationBriefShape.structure.default({
      ...DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
    }),
    documentFeatures: lectureStudioGenerationBriefShape.documentFeatures,
    customInstructions: lectureStudioGenerationBriefShape.customInstructions.default(''),
  })
  .strict()
  .superRefine(validateLectureStudioGenerationBrief)
  .refine(lectureStudioGenerationBriefFitsStorage, 'The complete generation options are too large')
  .default({
    notesTargetPages: null,
    slidesTargetPages: null,
    detailLevel: 'standard',
    structure: { ...DEFAULT_LECTURE_STUDIO_STRUCTURE_TEMPLATE },
    customInstructions: '',
  });
export type LectureStudioGenerationBrief = z.infer<typeof LectureStudioGenerationBriefSchema>;

export const LectureStudioStatusSchema = z.enum(['draft', 'generating', 'ready', 'failed']);
export type LectureStudioStatus = z.infer<typeof LectureStudioStatusSchema>;

export const LECTURE_GENERATION_PROGRESS_PHASES = [
  'preparing_sources',
  'loading_current_revision',
  'preparing_edit_context',
  'starting_model',
  'generating_draft',
  'revising_draft',
  'model_active',
  'validating_output',
  'correcting_output',
  'compiling_documents',
  'saving_revision',
  'committing_revision',
] as const;

export const LectureGenerationProgressPhaseSchema = z.enum(LECTURE_GENERATION_PROGRESS_PHASES);
export type LectureGenerationProgressPhase = z.infer<typeof LectureGenerationProgressPhaseSchema>;

export const LectureStudioAttemptStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'interrupted',
]);
export type LectureStudioAttemptStatus = z.infer<typeof LectureStudioAttemptStatusSchema>;

export const LectureStudioAttemptValidationPassSchema = z.enum(['initial', 'correction']);
export type LectureStudioAttemptValidationPass = z.infer<
  typeof LectureStudioAttemptValidationPassSchema
>;

export const LectureStudioAttemptValidationCategorySchema = z.enum([
  'response_json',
  'response_schema',
  'latex_grammar',
  'citation_mapping',
  'slide_count',
]);
export type LectureStudioAttemptValidationCategory = z.infer<
  typeof LectureStudioAttemptValidationCategorySchema
>;

/** Keep this fixed enum aligned with the bounded LaTeX validator's public reason vocabulary. */
export const LectureStudioAttemptLatexReasonSchema = z.enum([
  'empty_body',
  'body_too_large',
  'control_character',
  'ambiguous_json_backslash_escape',
  'tex_caret_escape',
  'raw_html',
  'markdown_structure',
  'document_wrapper',
  'raw_comment',
  'raw_parameter',
  'beamer_overlay',
  'beamer_multipage_frame',
  'beamer_frame_option',
  'structural_heading_option',
  'unbalanced_braces',
  'malformed_environment',
  'unsupported_environment',
  'unbalanced_environment',
  'unsupported_command',
  'unsupported_escape',
  'math_delimiter_in_math_environment',
  'unbalanced_math',
  'raw_subscript_or_superscript',
  'raw_alignment_character',
  'raw_tilde',
  'evidence_label_typography',
  'missing_sources_used',
  'missing_frame',
  'invalid_figure_reference',
  'invalid_title',
  'invalid_canonical_wrapper',
]);
export type LectureStudioAttemptLatexReason = z.infer<typeof LectureStudioAttemptLatexReasonSchema>;

export const LectureStudioAttemptLatexDiagnosticSchema = z
  .object({
    document: z.enum(['lecture-notes', 'slides']),
    reason: LectureStudioAttemptLatexReasonSchema,
    /** Count only; diagnostic token text remains ephemeral because it can encode source content. */
    tokenCount: z.number().int().nonnegative().max(32),
  })
  .strict();
export type LectureStudioAttemptLatexDiagnostic = z.infer<
  typeof LectureStudioAttemptLatexDiagnosticSchema
>;

export const LectureStudioAttemptValidationSchema = z
  .object({
    pass: LectureStudioAttemptValidationPassSchema,
    category: LectureStudioAttemptValidationCategorySchema,
    diagnostics: z.array(LectureStudioAttemptLatexDiagnosticSchema).max(2),
    recordedAt: timestampSchema,
  })
  .strict()
  .superRefine((validation, context) => {
    const documents = validation.diagnostics.map((diagnostic) => diagnostic.document);
    if (new Set(documents).size !== documents.length) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostics'],
        message: 'Lecture attempt diagnostics must contain at most one result per document',
      });
    }
    if ((validation.category === 'latex_grammar') !== validation.diagnostics.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostics'],
        message: 'Only LaTeX grammar failures can retain bounded document diagnostics',
      });
    }
  });
export type LectureStudioAttemptValidation = z.infer<typeof LectureStudioAttemptValidationSchema>;

export const LectureStudioAttemptPhaseSchema = z
  .object({
    phase: LectureGenerationProgressPhaseSchema,
    sequence: z.number().int().positive().max(10_000),
    occurredAt: timestampSchema,
  })
  .strict();
export type LectureStudioAttemptPhase = z.infer<typeof LectureStudioAttemptPhaseSchema>;

export const LectureStudioAttemptTerminalCodeSchema = z.enum([
  'application_interrupted',
  'lecture_source_not_found',
  'lecture_source_conflict',
  'lecture_context_too_large',
  'lecture_research_notes_required',
  'lecture_codex_unavailable',
  'lecture_auth_required',
  'lecture_generation_timed_out',
  'lecture_usage_limit_exceeded',
  'lecture_generation_interrupted',
  'lecture_generation_failed',
  'lecture_figure_model_unsupported',
  'lecture_invalid_response',
  'lecture_invalid_response_json',
  'lecture_invalid_response_schema',
  'lecture_invalid_latex_grammar',
  'lecture_invalid_citation_mapping',
  'lecture_invalid_slide_count',
  'lecture_persistence_failed',
  'lecture_cancelled',
  'lecture_pdf_compiler_unavailable',
  'lecture_pdf_compile_failed',
  'lecture_pdf_too_large',
  'lecture_pdf_invalid',
]);
export type LectureStudioAttemptTerminalCode = z.infer<
  typeof LectureStudioAttemptTerminalCodeSchema
>;

/**
 * A content-free, bounded record of one generation attempt. It deliberately cannot contain
 * prompts, candidate output, source text, paths, provider messages, compiler output, or stderr.
 */
export const LectureStudioAttemptSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    studioId: uuidSchema,
    status: LectureStudioAttemptStatusSchema,
    requestedModelId: z.string().trim().min(1).max(256).nullable(),
    resolvedModelId: z.string().trim().min(1).max(256).nullable(),
    providerId: z.string().trim().min(1).max(128).nullable(),
    catalogVersion: z.string().trim().min(1).max(128).nullable(),
    reasoningOptionId: z.string().trim().min(1).max(128).nullable(),
    phases: z.array(LectureStudioAttemptPhaseSchema).max(LECTURE_GENERATION_PROGRESS_PHASES.length),
    validations: z.array(LectureStudioAttemptValidationSchema).max(2),
    terminalCode: LectureStudioAttemptTerminalCodeSchema.nullable(),
    startedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    const invocationFields = [attempt.resolvedModelId, attempt.providerId, attempt.catalogVersion];
    if (!invocationFields.every((value) => value === null) && !invocationFields.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        path: ['resolvedModelId'],
        message: 'Resolved model identity fields must be recorded together',
      });
    }
    const isRunning = attempt.status === 'running';
    const isSucceeded = attempt.status === 'succeeded';
    if (
      (isRunning && (attempt.completedAt !== null || attempt.terminalCode !== null)) ||
      (!isRunning && attempt.completedAt === null) ||
      (isSucceeded && attempt.terminalCode !== null) ||
      (!isRunning && !isSucceeded && attempt.terminalCode === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalCode'],
        message: 'Lecture attempt terminal fields do not match its status',
      });
    }
    if (isSucceeded && attempt.resolvedModelId === null) {
      context.addIssue({
        code: 'custom',
        path: ['resolvedModelId'],
        message: 'A successful Lecture attempt must retain its resolved model identity',
      });
    }
    const phases = attempt.phases;
    if (new Set(phases.map((entry) => entry.phase)).size !== phases.length) {
      context.addIssue({
        code: 'custom',
        path: ['phases'],
        message: 'Lecture attempt phases retain only their first occurrence',
      });
    }
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index]!;
      const previous = phases[index - 1];
      if (
        Date.parse(phase.occurredAt) < Date.parse(attempt.startedAt) ||
        (previous !== undefined &&
          (phase.sequence <= previous.sequence ||
            Date.parse(phase.occurredAt) < Date.parse(previous.occurredAt)))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['phases', index],
          message: 'Lecture attempt phases must be chronological',
        });
      }
    }
    const validations = attempt.validations;
    if (
      new Set(validations.map((validation) => validation.pass)).size !== validations.length ||
      validations[0]?.pass === 'correction' ||
      (validations[1] !== undefined && validations[1].pass !== 'correction')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validations'],
        message: 'Lecture attempt validation passes must be initial then correction',
      });
    }
    for (const [index, validation] of validations.entries()) {
      const previous = validations[index - 1];
      if (
        Date.parse(validation.recordedAt) < Date.parse(attempt.startedAt) ||
        (previous !== undefined &&
          Date.parse(validation.recordedAt) < Date.parse(previous.recordedAt))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['validations', index, 'recordedAt'],
          message: 'Lecture attempt validations cannot predate the attempt',
        });
      }
    }
    const completedAt = attempt.completedAt;
    if (
      completedAt !== null &&
      (Date.parse(completedAt) < Date.parse(attempt.startedAt) ||
        phases.some((phase) => Date.parse(phase.occurredAt) > Date.parse(completedAt)) ||
        validations.some(
          (validation) => Date.parse(validation.recordedAt) > Date.parse(completedAt),
        ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Lecture attempt completion must follow all recorded activity',
      });
    }
  });
export type LectureStudioAttempt = z.infer<typeof LectureStudioAttemptSchema>;

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

export const LectureExternalSourceSelectionSchema = z
  .object({
    sourceSetId: uuidSchema,
    sourceIds: z.array(uuidSchema).min(1).max(LECTURE_STUDIO_MAX_EXTERNAL_SOURCES),
  })
  .strict()
  .refine((value) => new Set(value.sourceIds).size === value.sourceIds.length, {
    path: ['sourceIds'],
    message: 'External source IDs must be unique',
  });
export type LectureExternalSourceSelection = z.infer<typeof LectureExternalSourceSelectionSchema>;

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
    externalSources: LectureExternalSourceSelectionSchema.nullable().default(null),
  })
  .strict()
  .superRefine((selection, context) => {
    if (
      selection.literature.length +
        selection.experiments.length +
        selection.manuscripts.length +
        (selection.externalSources?.sourceIds.length ?? 0) ===
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
  generationBrief: LectureStudioGenerationBriefSchema,
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
    trashedAt: timestampSchema.optional(),
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
    if (studio.trashedAt !== undefined && studio.status === 'generating') {
      context.addIssue({
        code: 'custom',
        path: ['trashedAt'],
        message: 'A generating Studio cannot be moved to Trash',
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

export const LectureStudioFigureSourceFormatSchema = z.enum([
  'png',
  'jpeg',
  'gif',
  'webp',
  'tiff',
  'bmp',
  'avif',
]);
export type LectureStudioFigureSourceFormat = z.infer<typeof LectureStudioFigureSourceFormatSchema>;

/**
 * Content-free metadata for one normalized figure owned by a Lecture Studio. The corresponding
 * JPEG bytes remain main-process-only and are never embedded in a Renderer snapshot.
 */
export const LectureStudioFigureAssetSchema = z
  .object({
    id: uuidSchema,
    studioId: uuidSchema,
    displayName: boundedText(256).refine(
      (value) => !containsUnsafeControlCharacter(value) && !/[\\/]/u.test(value),
      'Figure names must be path-free and must not contain unsafe control characters',
    ),
    fileName: boundedText(64),
    mediaType: z.literal('image/jpeg'),
    sourceFormat: LectureStudioFigureSourceFormatSchema,
    byteSize: z.number().int().positive().max(LECTURE_STUDIO_MAX_FIGURE_BYTES),
    width: z.number().int().positive().max(LECTURE_STUDIO_MAX_FIGURE_EDGE),
    height: z.number().int().positive().max(LECTURE_STUDIO_MAX_FIGURE_EDGE),
    sha256: sha256Schema,
    origin: z.literal('user'),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((figure, context) => {
    if (figure.fileName !== `Figure-${figure.id}.jpg`) {
      context.addIssue({
        code: 'custom',
        path: ['fileName'],
        message: 'Figure file names must be derived from their opaque ID',
      });
    }
  });
export type LectureStudioFigureAsset = z.infer<typeof LectureStudioFigureAssetSchema>;

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
  generationBriefSha256?: string;
  authoringPolicyVersion?: number;
  authoringPolicySha256?: string;
  figureAssets?: readonly LectureStudioFigureAsset[];
  /** Exact V2 recovery journal entries: two UTF-8 TeX files plus zero to five JPEG figures. */
  bundleFiles?: readonly Readonly<{
    name: string;
    contentSha256: string;
    byteSize: number;
    encoding: 'utf8' | 'binary';
  }>[];
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
    totalCharacters: z.number().int().nonnegative().max(2_000_000).optional(),
    contentComplete: z.boolean().optional(),
    extractionPolicyVersion: z.literal(1).optional(),
    content: z.string().max(80_000),
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

export const LectureStudioAttachmentSnapshotSchema = z
  .object({
    sourceLabel: z.string().regex(/^A[1-5]$/u),
    attachmentId: uuidSchema,
    projectId: uuidSchema,
    studioId: uuidSchema,
    displayName: z.string().trim().min(1).max(255),
    format: LectureStudioAttachmentFormatSchema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    sourceSha256: sha256Schema,
    unitLabel: LectureStudioAttachmentUnitLabelSchema,
    unitCount: z.number().int().positive().max(500),
    content: z.string().min(1).max(60_000),
    contentSha256: sha256Schema,
    extractedCharacters: z.number().int().positive().max(60_000),
    truncated: z.boolean(),
    reconstructionNotice: z.string().trim().min(1).max(240),
    capturedAt: timestampSchema,
  })
  .strict()
  .superRefine((attachment, context) => {
    if (attachment.content.length !== attachment.extractedCharacters) {
      context.addIssue({
        code: 'custom',
        path: ['extractedCharacters'],
        message: 'Attachment extracted characters must match its frozen content',
      });
    }
    if (attachment.unitLabel !== (attachment.format === 'pdf' ? 'page' : 'part')) {
      context.addIssue({
        code: 'custom',
        path: ['unitLabel'],
        message: 'Attachment unit label must match its format',
      });
    }
  });
export type LectureStudioAttachmentSnapshot = z.infer<typeof LectureStudioAttachmentSnapshotSchema>;

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

export const LectureSourceManifestV3Schema = z
  .object({
    schemaVersion: z.literal(3),
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
    externalSources: z
      .array(LectureExternalSourceSnapshotSchema)
      .max(LECTURE_STUDIO_MAX_EXTERNAL_SOURCES),
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
      manifest.literature.length +
        manifest.experiments.length +
        manifest.manuscripts.length +
        manifest.externalSources.length ===
      0
    ) {
      context.addIssue({ code: 'custom', message: 'A source manifest cannot be empty' });
    }
    const projects = new Set(manifest.selectedProjectIds);
    const groups = [
      manifest.literature,
      manifest.experiments,
      manifest.manuscripts,
      manifest.externalSources,
    ] as const;
    const labels = groups.flatMap((values) => values.map((value) => value.sourceLabel));
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: 'custom',
        path: ['externalSources'],
        message: 'Source labels must be unique across the manifest',
      });
    }
    groups.forEach((values, groupIndex) => {
      const groupName = (['literature', 'experiments', 'manuscripts', 'externalSources'] as const)[
        groupIndex
      ];
      values.forEach((value, index) => {
        if (!projects.has(value.projectId)) {
          context.addIssue({
            code: 'custom',
            path: [groupName ?? 'externalSources', index, 'projectId'],
            message: 'Manifest sources must belong to a selected project',
          });
        }
      });
    });
  });

export const LectureSourceManifestV4Schema = z
  .object({
    schemaVersion: z.literal(4),
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
    externalSources: z
      .array(LectureExternalSourceSnapshotSchema)
      .max(LECTURE_STUDIO_MAX_EXTERNAL_SOURCES),
    turnAttachments: z
      .array(LectureStudioAttachmentSnapshotSchema)
      .min(1)
      .max(LECTURE_STUDIO_MAX_ATTACHMENTS),
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
    const projects = new Set(manifest.selectedProjectIds);
    const groups = [
      manifest.literature,
      manifest.experiments,
      manifest.manuscripts,
      manifest.externalSources,
      manifest.turnAttachments,
    ] as const;
    const labels = groups.flatMap((values) => values.map((value) => value.sourceLabel));
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: 'custom',
        path: ['turnAttachments'],
        message: 'Source labels must be unique across the manifest',
      });
    }
    groups.forEach((values, groupIndex) => {
      const groupName = (
        ['literature', 'experiments', 'manuscripts', 'externalSources', 'turnAttachments'] as const
      )[groupIndex];
      values.forEach((value, index) => {
        if (!projects.has(value.projectId)) {
          context.addIssue({
            code: 'custom',
            path: [groupName ?? 'turnAttachments', index, 'projectId'],
            message: 'Manifest sources must belong to a selected project',
          });
        }
      });
    });
    manifest.turnAttachments.forEach((attachment, index) => {
      if (attachment.sourceLabel !== `A${index + 1}`) {
        context.addIssue({
          code: 'custom',
          path: ['turnAttachments', index, 'sourceLabel'],
          message: 'Turn attachment labels must be canonical and ordered',
        });
      }
    });
  });

export const LectureSourceManifestSchema = z.discriminatedUnion('schemaVersion', [
  LectureSourceManifestV1Schema,
  LectureSourceManifestV2Schema,
  LectureSourceManifestV3Schema,
  LectureSourceManifestV4Schema,
]);
export type LectureSourceManifest = z.infer<typeof LectureSourceManifestSchema>;

const LectureStudioEditedKindsSchema = z
  .array(z.enum(['lecture-notes', 'slides']))
  .min(1)
  .max(2)
  .refine(
    (values) => new Set(values).size === values.length,
    'Edited document kinds must be unique',
  );

export const LectureStudioRevisionAuthorshipSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('model') }).strict(),
  z
    .object({
      kind: z.literal('manual'),
      baseRevisionId: uuidSchema,
      baseRevision: z.number().int().positive(),
      editedKinds: LectureStudioEditedKindsSchema,
    })
    .strict(),
]);
export type LectureStudioRevisionAuthorship = z.infer<typeof LectureStudioRevisionAuthorshipSchema>;

const LectureStudioRevisionBaseSchema = z.object({
  id: uuidSchema,
  studioId: uuidSchema,
  revision: z.number().int().positive(),
  attemptId: uuidSchema,
  sourceManifest: LectureSourceManifestSchema,
  sourceManifestSha256: sha256Schema,
  artifacts: z.array(LectureStudioArtifactSchema).length(2),
  invocation: ModelInvocationSchema,
  createdAt: timestampSchema,
});

export const LectureStudioRevisionV1Schema = LectureStudioRevisionBaseSchema.extend({
  schemaVersion: z.literal(1),
  lectureNotesMarkdown: z.string().min(1).max(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH),
  slidesMarkdown: z.string().min(1).max(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH),
}).strict();

export const LectureStudioRevisionV2Schema = LectureStudioRevisionBaseSchema.extend({
  schemaVersion: z.literal(2),
  lectureNotesLatex: z.string().min(1).max(LECTURE_STUDIO_MAX_LATEX_LENGTH),
  slidesLatex: z.string().min(1).max(LECTURE_STUDIO_MAX_LATEX_LENGTH),
}).strict();

export const LectureStudioRevisionV3Schema = LectureStudioRevisionBaseSchema.extend({
  schemaVersion: z.literal(3),
  lectureNotesLatex: z.string().min(1).max(LECTURE_STUDIO_MAX_LATEX_LENGTH),
  slidesLatex: z.string().min(1).max(LECTURE_STUDIO_MAX_LATEX_LENGTH),
  generationBriefSnapshot: LectureStudioGenerationBriefValueSchema,
  generationBriefSha256: sha256Schema,
  authoringPolicyVersion: z.number().int().positive(),
  authoringPolicySha256: sha256Schema,
}).strict();

export const LectureStudioRevisionV4Schema = LectureStudioRevisionBaseSchema.extend({
  schemaVersion: z.literal(4),
  lectureNotesLatex: z.string().min(1).max(LECTURE_STUDIO_MAX_LATEX_LENGTH),
  slidesLatex: z.string().min(1).max(LECTURE_STUDIO_MAX_LATEX_LENGTH),
  generationBriefSnapshot: LectureStudioGenerationBriefValueSchema,
  generationBriefSha256: sha256Schema,
  authoringPolicyVersion: z.number().int().positive(),
  authoringPolicySha256: sha256Schema,
  invocation: ModelInvocationSchema.nullable(),
  authorship: LectureStudioRevisionAuthorshipSchema,
  figureAssets: z.array(LectureStudioFigureAssetSchema).max(LECTURE_STUDIO_MAX_FIGURES),
})
  .strict()
  .superRefine((revision, context) => {
    if ((revision.authorship.kind === 'model') !== (revision.invocation !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['invocation'],
        message: 'Model revisions require an invocation and manual revisions must not claim one',
      });
    }
    if (
      revision.authorship.kind === 'manual' &&
      (revision.authorship.baseRevision >= revision.revision ||
        revision.authorship.baseRevision + 1 !== revision.revision)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorship', 'baseRevision'],
        message: 'Manual revisions must directly follow their exact base revision',
      });
    }
    const figureIds = revision.figureAssets.map((figure) => figure.id);
    const figureHashes = revision.figureAssets.map((figure) => figure.sha256);
    if (
      new Set(figureIds).size !== figureIds.length ||
      new Set(figureHashes).size !== figureHashes.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['figureAssets'],
        message: 'Revision figures must have unique IDs and content hashes',
      });
    }
    revision.figureAssets.forEach((figure, index) => {
      if (figure.studioId !== revision.studioId) {
        context.addIssue({
          code: 'custom',
          path: ['figureAssets', index, 'studioId'],
          message: 'Revision figures must belong to the same Lecture Studio',
        });
      }
    });
  });
export type LectureStudioRevisionV4 = z.infer<typeof LectureStudioRevisionV4Schema>;

export const LectureStudioRevisionSchema = z
  .discriminatedUnion('schemaVersion', [
    LectureStudioRevisionV1Schema,
    LectureStudioRevisionV2Schema,
    LectureStudioRevisionV3Schema,
    LectureStudioRevisionV4Schema,
  ])
  .superRefine((revision, context) => {
    if (
      (revision.schemaVersion === 3 || revision.schemaVersion === 4) &&
      revision.authoringPolicyVersion >= 7 &&
      revision.generationBriefSnapshot.documentFeatures === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['generationBriefSnapshot', 'documentFeatures'],
        message: 'Current authoring-policy revisions must freeze document features',
      });
    }
    const artifactKinds = new Set(revision.artifacts.map((artifact) => artifact.kind));
    if (!artifactKinds.has('lecture-notes') || !artifactKinds.has('slides')) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'Every revision must record both lecture notes and slides artifacts',
      });
    }
    if (
      revision.sourceManifest.schemaVersion === 4 &&
      revision.sourceManifest.turnAttachments.some(
        (attachment) => attachment.studioId !== revision.studioId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceManifest', 'turnAttachments'],
        message: 'Turn attachments must belong to the revision Lecture Studio',
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
    attachments: z
      .array(LectureStudioAttachmentCardSchema)
      .max(LECTURE_STUDIO_MAX_ATTACHMENTS)
      .optional(),
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
    if (message.role !== 'user' && (message.attachments?.length ?? 0) > 0) {
      context.addIssue({
        code: 'custom',
        path: ['attachments'],
        message: 'Only user messages can carry attachment receipts',
      });
    }
    if (
      message.attachments &&
      new Set(message.attachments.map((attachment) => attachment.id)).size !==
        message.attachments.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['attachments'],
        message: 'Message attachment IDs must be unique',
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
    trashedAt: timestampSchema.optional(),
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
    if (studio.trashedAt !== undefined && studio.status === 'generating') {
      context.addIssue({
        code: 'custom',
        path: ['trashedAt'],
        message: 'A generating Studio summary cannot be in Trash',
      });
    }
  });
export type LectureStudioSummary = z.infer<typeof LectureStudioSummarySchema>;

export const LectureStudioListSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    studios: z.array(LectureStudioSummarySchema).max(LECTURE_STUDIO_MAX_STORED_STUDIOS),
  })
  .strict();
export type LectureStudioListSnapshot = z.infer<typeof LectureStudioListSnapshotSchema>;

export const LectureStudioDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    studio: LectureStudioSchema,
    messages: z.array(LectureStudioMessageSchema).max(LECTURE_STUDIO_MAX_MESSAGES),
    revisions: z.array(LectureStudioRevisionSchema).max(LECTURE_STUDIO_MAX_REVISIONS),
    lastAttempt: LectureStudioAttemptSchema.nullable().optional(),
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
    if (detail.lastAttempt && detail.lastAttempt.studioId !== detail.studio.id) {
      context.addIssue({
        code: 'custom',
        path: ['lastAttempt', 'studioId'],
        message: 'The latest Lecture attempt must belong to the detailed studio',
      });
    }
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

export const ListLectureStudiosInputSchema = z
  .object({ includeTrashed: z.boolean().default(false) })
  .strict();
export type ListLectureStudiosInput = z.input<typeof ListLectureStudiosInputSchema>;

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
  'sourceSelection' | 'generationBrief'
> & {
  sourceSelection: Omit<LectureSourceSelection, 'manuscripts' | 'externalSources'> & {
    manuscripts?: LectureSourceSelection['manuscripts'];
    externalSources?: LectureSourceSelection['externalSources'];
  };
  generationBrief?: LectureStudioGenerationBrief;
};

const lectureTurnShape = {
  studioId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  requestedModelId: boundedText(256).nullable(),
  reasoningOptionId: boundedText(128).nullable(),
} as const;

export const GenerateLectureStudioInputSchema = z.object(lectureTurnShape).strict();
export type GenerateLectureStudioInput = z.infer<typeof GenerateLectureStudioInputSchema>;

export const UpdateLectureStudioGenerationBriefInputSchema = z
  .object({
    studioId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    generationBrief: CurrentLectureStudioGenerationBriefValueSchema,
  })
  .strict();
export type UpdateLectureStudioGenerationBriefInput = z.infer<
  typeof UpdateLectureStudioGenerationBriefInputSchema
>;

const LectureStudioManualLatexBodySchema = z
  .string()
  .min(1)
  // Body validation is bounded at 200k; the larger full-LaTeX limit reserves wrapper headroom.
  .max(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH)
  .refine(
    (value) =>
      !/\\(?:documentclass|begin\s*\{\s*document\s*\}|end\s*\{\s*document\s*\})/iu.test(value) &&
      !value.includes('% GOSU-CONTENT-BEGIN') &&
      !value.includes('% GOSU-CONTENT-END'),
    'Manual LaTeX edits must contain a document body, not a wrapper',
  );

export const GetLectureStudioEditDraftInputSchema = z
  .object({
    studioId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    baseRevisionId: uuidSchema,
    baseRevision: z.number().int().positive(),
  })
  .strict();
export type GetLectureStudioEditDraftInput = z.infer<typeof GetLectureStudioEditDraftInputSchema>;

export const LectureStudioEditDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    studioId: uuidSchema,
    studioVersion: z.number().int().positive(),
    baseRevisionId: uuidSchema,
    baseRevision: z.number().int().positive(),
    lectureNotesLatexBody: LectureStudioManualLatexBodySchema,
    slidesLatexBody: LectureStudioManualLatexBodySchema,
    figures: z.array(LectureStudioFigureAssetSchema).max(LECTURE_STUDIO_MAX_FIGURES),
  })
  .strict()
  .superRefine((draft, context) => {
    const ids = draft.figures.map((figure) => figure.id);
    const hashes = draft.figures.map((figure) => figure.sha256);
    if (new Set(ids).size !== ids.length || new Set(hashes).size !== hashes.length) {
      context.addIssue({
        code: 'custom',
        path: ['figures'],
        message: 'Draft figures must have unique IDs and content hashes',
      });
    }
    draft.figures.forEach((figure, index) => {
      if (figure.studioId !== draft.studioId) {
        context.addIssue({
          code: 'custom',
          path: ['figures', index, 'studioId'],
          message: 'Draft figures must belong to the same Lecture Studio',
        });
      }
    });
  });
export type LectureStudioEditDraft = z.infer<typeof LectureStudioEditDraftSchema>;

export const SaveLectureStudioManualRevisionInputSchema = z
  .object({
    studioId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    baseRevisionId: uuidSchema,
    baseRevision: z.number().int().positive(),
    lectureNotesLatexBody: LectureStudioManualLatexBodySchema,
    slidesLatexBody: LectureStudioManualLatexBodySchema,
  })
  .strict();
export type SaveLectureStudioManualRevisionInput = z.infer<
  typeof SaveLectureStudioManualRevisionInputSchema
>;

export const LectureStudioManualRevisionReceiptSchema = z
  .object({
    studio: LectureStudioSchema,
    revision: LectureStudioRevisionV4Schema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.revision.studioId !== receipt.studio.id ||
      receipt.revision.revision !== receipt.studio.currentRevision ||
      receipt.studio.status !== 'ready'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A manual revision receipt must identify the exact ready Studio revision',
      });
    }
  });
export type LectureStudioManualRevisionReceipt = z.infer<
  typeof LectureStudioManualRevisionReceiptSchema
>;

export const ListLectureStudioFiguresInputSchema = z.object({ studioId: uuidSchema }).strict();
export type ListLectureStudioFiguresInput = z.infer<typeof ListLectureStudioFiguresInputSchema>;

export const ChooseLectureStudioFiguresInputSchema = z
  .object({
    studioId: uuidSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type ChooseLectureStudioFiguresInput = z.infer<typeof ChooseLectureStudioFiguresInputSchema>;

export const RemoveLectureStudioFigureInputSchema = z
  .object({
    studioId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    figureId: uuidSchema,
    sha256: sha256Schema,
  })
  .strict();
export type RemoveLectureStudioFigureInput = z.infer<typeof RemoveLectureStudioFigureInputSchema>;

export const PreviewLectureStudioFigureInputSchema = z
  .object({
    studioId: uuidSchema,
    figureId: uuidSchema,
    sha256: sha256Schema,
  })
  .strict();
export type PreviewLectureStudioFigureInput = z.infer<typeof PreviewLectureStudioFigureInputSchema>;

export const LectureStudioFigureLibraryReceiptSchema = z
  .object({
    studio: LectureStudioSchema,
    figures: z.array(LectureStudioFigureAssetSchema).max(LECTURE_STUDIO_MAX_FIGURES),
  })
  .strict()
  .superRefine((receipt, context) => {
    const ids = receipt.figures.map((figure) => figure.id);
    const hashes = receipt.figures.map((figure) => figure.sha256);
    if (new Set(ids).size !== ids.length || new Set(hashes).size !== hashes.length) {
      context.addIssue({
        code: 'custom',
        path: ['figures'],
        message: 'Figure library entries must have unique IDs and content hashes',
      });
    }
    receipt.figures.forEach((figure, index) => {
      if (figure.studioId !== receipt.studio.id) {
        context.addIssue({
          code: 'custom',
          path: ['figures', index, 'studioId'],
          message: 'Figure library entries must belong to the receipt Studio',
        });
      }
    });
  });
export type LectureStudioFigureLibraryReceipt = z.infer<
  typeof LectureStudioFigureLibraryReceiptSchema
>;

const LECTURE_STUDIO_MAX_FIGURE_BASE64_LENGTH = Math.ceil(LECTURE_STUDIO_MAX_FIGURE_BYTES / 3) * 4;

export const LectureStudioFigurePreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    figure: LectureStudioFigureAssetSchema,
    jpegBase64: z
      .string()
      .min(4)
      .max(LECTURE_STUDIO_MAX_FIGURE_BASE64_LENGTH)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  })
  .strict();
export type LectureStudioFigurePreview = z.infer<typeof LectureStudioFigurePreviewSchema>;

export const SendLectureStudioMessageInputSchema = z
  .object({
    ...lectureTurnShape,
    message: boundedText(LECTURE_STUDIO_MAX_MESSAGE_LENGTH),
    attachmentIds: LectureStudioAttachmentIdsSchema.optional(),
  })
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

export const LectureStudioVersionCommandSchema = z
  .object({ studioId: uuidSchema, expectedVersion: z.number().int().positive() })
  .strict();
export type LectureStudioVersionCommand = z.infer<typeof LectureStudioVersionCommandSchema>;

export const LectureStudioTrashTargetSchema = z
  .object({
    studioId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    trashedAt: timestampSchema,
  })
  .strict();
export type LectureStudioTrashTarget = z.infer<typeof LectureStudioTrashTargetSchema>;

export function buildLectureStudioTrashTargets(
  studios: readonly Pick<LectureStudioSummary, 'id' | 'version' | 'trashedAt'>[],
): LectureStudioTrashTarget[] {
  return studios
    .filter(
      (studio): studio is Pick<LectureStudioSummary, 'id' | 'version'> & { trashedAt: string } =>
        studio.trashedAt !== undefined,
    )
    .map((studio) => ({
      studioId: studio.id,
      expectedVersion: studio.version,
      trashedAt: studio.trashedAt,
    }))
    .sort((left, right) =>
      left.studioId < right.studioId ? -1 : left.studioId > right.studioId ? 1 : 0,
    );
}

export const EmptyLectureStudioTrashInputSchema = z
  .object({
    idempotencyKey: uuidSchema,
    confirmation: z.literal(EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION),
    targets: z.array(LectureStudioTrashTargetSchema).min(1).max(LECTURE_STUDIO_MAX_TRASHED_STUDIOS),
  })
  .strict()
  .superRefine((command, context) => {
    for (let index = 1; index < command.targets.length; index += 1) {
      if (command.targets[index - 1]!.studioId >= command.targets[index]!.studioId) {
        context.addIssue({
          code: 'custom',
          path: ['targets', index, 'studioId'],
          message: 'Lecture Studio Trash targets must be unique and sorted by Studio ID',
        });
      }
    }
  });
export type EmptyLectureStudioTrashInput = z.infer<typeof EmptyLectureStudioTrashInputSchema>;

export const EmptyLectureStudioTrashReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    idempotencyKey: uuidSchema,
    removedStudios: z
      .array(
        z
          .object({
            studioId: uuidSchema,
            title: boundedText(160),
            outputProjectId: uuidSchema,
            revisionCount: z.number().int().nonnegative(),
            messageCount: z.number().int().nonnegative(),
            trashedAt: timestampSchema,
          })
          .strict(),
      )
      .min(1)
      .max(LECTURE_STUDIO_MAX_TRASHED_STUDIOS),
    completedAt: timestampSchema,
  })
  .strict();
export type EmptyLectureStudioTrashReceipt = z.infer<typeof EmptyLectureStudioTrashReceiptSchema>;

export const LectureStudioPdfKindSchema = LectureStudioArtifactSchema.shape.kind;
export type LectureStudioPdfKind = z.infer<typeof LectureStudioPdfKindSchema>;

/** Compile one exact, immutable Lecture Studio revision into an ephemeral local preview. */
export const CompileLectureStudioPdfInputSchema = z
  .object({
    studioId: uuidSchema,
    revision: z.number().int().positive(),
    kind: LectureStudioPdfKindSchema,
    contentSha256: sha256Schema,
  })
  .strict();
export type CompileLectureStudioPdfInput = z.infer<typeof CompileLectureStudioPdfInputSchema>;
export const LectureStudioPdfPreviewSchema = PdfPreviewDocumentSchema;
export type LectureStudioPdfPreview = z.infer<typeof LectureStudioPdfPreviewSchema>;

export const LectureStudioArtifactFormatSchema = z.enum(['markdown', 'latex', 'pdf']);
export type LectureStudioArtifactFormat = z.infer<typeof LectureStudioArtifactFormatSchema>;

const lectureStudioArtifactActionShape = {
  studioId: uuidSchema,
  revisionId: uuidSchema,
  revision: z.number().int().positive(),
  kind: LectureStudioPdfKindSchema,
  artifactContentSha256: sha256Schema,
} as const;

/** Export one exact immutable revision without accepting a Renderer-controlled path or payload. */
export const ExportLectureStudioArtifactInputSchema = z
  .object({
    ...lectureStudioArtifactActionShape,
    format: LectureStudioArtifactFormatSchema,
  })
  .strict();
export type ExportLectureStudioArtifactInput = z.infer<
  typeof ExportLectureStudioArtifactInputSchema
>;

export const OpenLectureStudioArtifactInputSchema = z
  .object({
    ...lectureStudioArtifactActionShape,
    format: LectureStudioArtifactFormatSchema,
  })
  .strict();
export type OpenLectureStudioArtifactInput = z.infer<typeof OpenLectureStudioArtifactInputSchema>;

export const RevealLectureStudioArtifactInputSchema = z
  .object({
    ...lectureStudioArtifactActionShape,
    format: LectureStudioArtifactFormatSchema,
  })
  .strict();
export type RevealLectureStudioArtifactInput = z.infer<
  typeof RevealLectureStudioArtifactInputSchema
>;

export const LectureStudioArtifactActionReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(['cancelled', 'exported', 'opened', 'revealed']),
    format: LectureStudioArtifactFormatSchema.nullable(),
    fileName: z.string().trim().min(1).max(256).nullable(),
    relativePath: z.string().trim().min(1).max(1_024).nullable(),
  })
  .strict();
export type LectureStudioArtifactActionReceipt = z.infer<
  typeof LectureStudioArtifactActionReceiptSchema
>;

export const LectureStudioGenerationOutputSchema = z
  .object({
    reply: boundedText(LECTURE_STUDIO_MAX_MESSAGE_LENGTH),
    lectureNotesLatexBody: z.string().min(1).max(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH),
    slidesLatexBody: z.string().min(1).max(LECTURE_STUDIO_MAX_MARKDOWN_LENGTH),
  })
  .strict();
export type LectureStudioGenerationOutput = z.infer<typeof LectureStudioGenerationOutputSchema>;

export const LECTURE_STUDIO_MAX_REVISION_PATCH_OPERATIONS = 24;
export const LECTURE_STUDIO_MAX_REVISION_PATCH_TEXT_LENGTH = 40_000;
export const LECTURE_STUDIO_MAX_REVISION_PATCH_JSON_LENGTH = 100_000;

export const LectureStudioRevisionPatchOperationSchema = z
  .object({
    document: z.enum(['lecture-notes', 'slides']),
    find: z.string().min(1).max(LECTURE_STUDIO_MAX_REVISION_PATCH_TEXT_LENGTH),
    replace: z.string().max(LECTURE_STUDIO_MAX_REVISION_PATCH_TEXT_LENGTH),
  })
  .strict();

export const LectureStudioRevisionPatchOutputSchema = z
  .object({
    reply: boundedText(LECTURE_STUDIO_MAX_MESSAGE_LENGTH),
    edits: z
      .array(LectureStudioRevisionPatchOperationSchema)
      .max(LECTURE_STUDIO_MAX_REVISION_PATCH_OPERATIONS),
  })
  .strict()
  .superRefine((value, context) => {
    if (JSON.stringify(value).length > LECTURE_STUDIO_MAX_REVISION_PATCH_JSON_LENGTH) {
      context.addIssue({
        code: 'custom',
        message: 'Lecture Studio revision patch payload exceeds the bounded JSON size',
      });
    }
  });
export type LectureStudioRevisionPatchOutput = z.infer<
  typeof LectureStudioRevisionPatchOutputSchema
>;

export const LECTURE_STUDIO_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string', minLength: 1, maxLength: LECTURE_STUDIO_MAX_MESSAGE_LENGTH },
    lectureNotesLatexBody: {
      type: 'string',
      minLength: 1,
      maxLength: LECTURE_STUDIO_MAX_MARKDOWN_LENGTH,
      description:
        'Complete bounded LaTeX body for article notes, without a document wrapper or Markdown.',
    },
    slidesLatexBody: {
      type: 'string',
      minLength: 1,
      maxLength: LECTURE_STUDIO_MAX_MARKDOWN_LENGTH,
      description:
        'Complete bounded LaTeX body containing content frame environments; GOSU adds the title frame.',
    },
  },
  required: ['reply', 'lectureNotesLatexBody', 'slidesLatexBody'],
} as const;

export const LECTURE_STUDIO_REVISION_PATCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string', minLength: 1, maxLength: LECTURE_STUDIO_MAX_MESSAGE_LENGTH },
    edits: {
      type: 'array',
      maxItems: LECTURE_STUDIO_MAX_REVISION_PATCH_OPERATIONS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          document: { type: 'string', enum: ['lecture-notes', 'slides'] },
          find: {
            type: 'string',
            minLength: 1,
            maxLength: LECTURE_STUDIO_MAX_REVISION_PATCH_TEXT_LENGTH,
            description:
              'Exact unique substring copied from the current body. Include only enough surrounding text to make the match unique.',
          },
          replace: {
            type: 'string',
            maxLength: LECTURE_STUDIO_MAX_REVISION_PATCH_TEXT_LENGTH,
            description:
              'Bounded replacement for the exact matched substring. Use an empty string to delete it.',
          },
        },
        required: ['document', 'find', 'replace'],
      },
    },
  },
  required: ['reply', 'edits'],
} as const;

export const LectureStudioTurnReceiptSchema = z
  .object({
    studio: LectureStudioSchema,
    revision: LectureStudioRevisionSchema,
    assistantMessage: LectureStudioMessageSchema,
  })
  .strict();
export type LectureStudioTurnReceipt = z.infer<typeof LectureStudioTurnReceiptSchema>;

export const LectureStudioChangedEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('lecture.studio.changed'),
    studioId: uuidSchema,
    status: LectureStudioStatusSchema,
    activeAttemptId: uuidSchema.nullable(),
    version: z.number().int().positive(),
    occurredAt: timestampSchema,
  })
  .strict();

/**
 * A deliberately content-free activity receipt. Progress events expose only GOSU-owned phase
 * labels and timestamps; raw model notifications, source text, paths, tokens, and provider
 * messages never cross the main-process boundary.
 */
export const LectureGenerationProgressEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('lecture.generation.progress'),
    studioId: uuidSchema,
    attemptId: uuidSchema,
    phase: LectureGenerationProgressPhaseSchema,
    sequence: z.number().int().positive().max(10_000),
    startedAt: timestampSchema,
    occurredAt: timestampSchema,
  })
  .strict();
export type LectureGenerationProgressEvent = z.infer<typeof LectureGenerationProgressEventSchema>;

export const LectureStudioEventSchema = z.discriminatedUnion('type', [
  LectureStudioChangedEventSchema,
  LectureGenerationProgressEventSchema,
]);
export type LectureStudioEvent = z.infer<typeof LectureStudioEventSchema>;

export const LECTURE_STUDIO_IPC_ERROR_CODES = [
  'invalid_lecture_input',
  'lecture_unavailable',
  'lecture_studio_not_found',
  'lecture_version_conflict',
  'lecture_source_not_found',
  'lecture_source_conflict',
  'lecture_external_source_invalid',
  'lecture_external_source_unsupported',
  'lecture_external_source_too_large',
  'lecture_external_source_total_too_large',
  'lecture_external_source_too_many',
  'lecture_external_source_encrypted',
  'lecture_external_source_extraction_failed',
  'lecture_external_source_scope_mismatch',
  'lecture_external_source_not_found',
  'lecture_external_source_expired',
  'lecture_external_source_corrupt',
  'lecture_figure_unavailable',
  'lecture_figure_invalid',
  'lecture_figure_too_large',
  'lecture_figure_limit_reached',
  'lecture_figure_in_use',
  'lecture_figure_model_unsupported',
  'lecture_overleaf_source_conflict',
  'lecture_overleaf_source_not_ready',
  'overleaf_git_auth_required',
  'overleaf_git_url_invalid',
  'overleaf_git_project_not_found',
  'overleaf_git_default_branch_missing',
  'overleaf_git_remote_rewritten',
  'overleaf_git_root_document_missing',
  'overleaf_git_checkpoint_too_large',
  'overleaf_keychain_unavailable',
  'overleaf_token_invalid',
  'lecture_context_too_large',
  'lecture_research_notes_required',
  'lecture_busy',
  'lecture_not_active',
  'lecture_codex_unavailable',
  'lecture_auth_required',
  'lecture_generation_timed_out',
  'lecture_usage_limit_exceeded',
  'lecture_generation_interrupted',
  'lecture_generation_failed',
  'lecture_invalid_response',
  'lecture_invalid_response_json',
  'lecture_invalid_response_schema',
  'lecture_invalid_latex_grammar',
  'lecture_invalid_citation_mapping',
  'lecture_invalid_slide_count',
  'lecture_persistence_failed',
  'lecture_capacity_reached',
  'lecture_cancelled',
  'lecture_pdf_compiler_unavailable',
  'lecture_pdf_compile_failed',
  'lecture_pdf_too_large',
  'lecture_pdf_invalid',
  'lecture_artifact_not_found',
  'lecture_artifact_changed',
  'lecture_artifact_unavailable',
  'lecture_export_failed',
  'lecture_open_failed',
  'lecture_studio_trashed',
  'lecture_studio_not_trashed',
  'lecture_trash_empty',
  'lecture_trash_changed',
  'project_not_found',
  'project_archived',
  'project_trashed',
  'manuscript_not_found',
  'manuscript_conflict',
  'manuscript_limit_reached',
  'manuscript_delete_not_allowed',
  'manuscript_binding_not_found',
  'manuscript_binding_conflict',
  'manuscript_binding_exists',
  'manuscript_provider_unavailable',
  'manuscript_provider_revision_required',
  'manuscript_checkpoint_not_found',
  'manuscript_checkpoint_file_not_found',
  'manuscript_checkpoint_file_not_text',
  'manuscript_checkpoint_tree_unsafe',
  'manuscript_pdf_compiler_unavailable',
  'manuscript_pdf_compile_failed',
  'manuscript_pdf_too_large',
  'manuscript_pdf_invalid',
] as const;
export type LectureStudioIpcErrorCode = (typeof LECTURE_STUDIO_IPC_ERROR_CODES)[number];

export type LectureStudioIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: LectureStudioIpcErrorCode }> }>;
