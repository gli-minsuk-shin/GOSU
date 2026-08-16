import { z } from 'zod';

export const LECTURE_EXTERNAL_SOURCE_MAX_SOURCES = 12;
export const LECTURE_EXTERNAL_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const LECTURE_EXTERNAL_SOURCE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS = 40_000;
export const LECTURE_EXTERNAL_SOURCE_MAX_TOTAL_EXTRACTED_CHARACTERS = 80_000;
export const LECTURE_EXTERNAL_SOURCE_EXTRACTION_POLICY_VERSION = 1 as const;
export const LECTURE_EXTERNAL_SOURCE_SET_TTL_MS = 60 * 60 * 1_000;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const displayNameSchema = z.string().trim().min(1).max(255);
const safeManagedRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      value
        .split('/')
        .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
    { message: 'Managed source paths must be safe relative paths' },
  );

export const LectureExternalSourceKindSchema = z.enum(['latex', 'markdown', 'pdf']);
export type LectureExternalSourceKind = z.infer<typeof LectureExternalSourceKindSchema>;

export const LectureExternalSourceTextExtractionSchema = z
  .object({
    policyVersion: z.literal(LECTURE_EXTERNAL_SOURCE_EXTRACTION_POLICY_VERSION),
    characterBudget: z
      .number()
      .int()
      .positive()
      .max(LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS),
    unitLabel: z.enum(['part', 'page']),
    unitCount: z.number().int().positive().max(500),
    content: z.string().max(LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS),
    contentSha256: sha256Schema,
    extractedCharacters: z
      .number()
      .int()
      .nonnegative()
      .max(LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS),
    truncated: z.boolean(),
    textAvailable: z.boolean(),
    reconstructionNotice: z.string().trim().min(1).max(240),
  })
  .strict()
  .superRefine((extraction, context) => {
    if (extraction.content.length !== extraction.extractedCharacters) {
      context.addIssue({
        code: 'custom',
        path: ['extractedCharacters'],
        message: 'The extracted character count must match the frozen content',
      });
    }
    if (extraction.textAvailable !== extraction.content.trim().length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['textAvailable'],
        message: 'Text availability must match the frozen content',
      });
    }
  });
export type LectureExternalSourceTextExtraction = z.infer<
  typeof LectureExternalSourceTextExtractionSchema
>;

const sourceBaseShape = {
  schemaVersion: z.literal(1),
  id: uuidSchema,
  projectId: uuidSchema,
  displayName: displayNameSchema,
  kind: LectureExternalSourceKindSchema,
  mediaType: z.enum(['application/x-tex', 'text/markdown', 'application/pdf']),
  byteSize: z.number().int().positive().max(LECTURE_EXTERNAL_SOURCE_MAX_BYTES),
  sourceSha256: sha256Schema,
  extraction: LectureExternalSourceTextExtractionSchema,
  importedAt: timestampSchema,
} as const;

function validateSourceFormat(
  source: {
    kind: LectureExternalSourceKind;
    mediaType: 'application/x-tex' | 'text/markdown' | 'application/pdf';
    extraction: LectureExternalSourceTextExtraction;
  },
  context: z.RefinementCtx,
) {
  const expectedMediaType = {
    latex: 'application/x-tex',
    markdown: 'text/markdown',
    pdf: 'application/pdf',
  }[source.kind];
  if (source.mediaType !== expectedMediaType) {
    context.addIssue({
      code: 'custom',
      path: ['mediaType'],
      message: 'The media type must match the external source kind',
    });
  }
  if (source.extraction.unitLabel !== (source.kind === 'pdf' ? 'page' : 'part')) {
    context.addIssue({
      code: 'custom',
      path: ['extraction', 'unitLabel'],
      message: 'The extraction unit must match the external source kind',
    });
  }
}

function sourceSuffix(kind: LectureExternalSourceKind) {
  return kind === 'latex' ? '.tex' : kind === 'markdown' ? '.md' : '.pdf';
}

export const StagedLectureExternalSourceSchema = z
  .object({
    ...sourceBaseShape,
    sourceSetId: uuidSchema,
    managedRelativePath: safeManagedRelativePath,
  })
  .strict()
  .superRefine((source, context) => {
    validateSourceFormat(source, context);
    const expected = `staging/${source.projectId}/${source.sourceSetId}/${source.id}${sourceSuffix(source.kind)}`;
    if (source.managedRelativePath !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['managedRelativePath'],
        message: 'The staged path must be derived from immutable identities',
      });
    }
  });
export type StagedLectureExternalSource = z.infer<typeof StagedLectureExternalSourceSchema>;

export const LectureExternalSourceSchema = z
  .object({
    ...sourceBaseShape,
    studioId: uuidSchema,
    managedRelativePath: safeManagedRelativePath,
  })
  .strict()
  .superRefine((source, context) => {
    validateSourceFormat(source, context);
    const expected = `studios/${source.projectId}/${source.studioId}/${source.id}${sourceSuffix(source.kind)}`;
    if (source.managedRelativePath !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['managedRelativePath'],
        message: 'The Studio path must be derived from immutable identities',
      });
    }
  });
export type LectureExternalSource = z.infer<typeof LectureExternalSourceSchema>;

export const LectureExternalSourceExtractionViewSchema = z
  .object({
    policyVersion: z.literal(LECTURE_EXTERNAL_SOURCE_EXTRACTION_POLICY_VERSION),
    characterBudget: z
      .number()
      .int()
      .positive()
      .max(LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS),
    unitLabel: z.enum(['part', 'page']),
    unitCount: z.number().int().positive().max(500),
    extractedCharacters: z
      .number()
      .int()
      .nonnegative()
      .max(LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS),
    truncated: z.boolean(),
    textAvailable: z.boolean(),
    reconstructionNotice: z.string().trim().min(1).max(240),
  })
  .strict();
export type LectureExternalSourceExtractionView = z.infer<
  typeof LectureExternalSourceExtractionViewSchema
>;

const externalSourceCardShape = {
  schemaVersion: z.literal(1),
  id: uuidSchema,
  projectId: uuidSchema,
  displayName: displayNameSchema,
  kind: LectureExternalSourceKindSchema,
  mediaType: z.enum(['application/x-tex', 'text/markdown', 'application/pdf']),
  byteSize: z.number().int().positive().max(LECTURE_EXTERNAL_SOURCE_MAX_BYTES),
  sourceSha256: sha256Schema,
  extraction: LectureExternalSourceExtractionViewSchema,
  importedAt: timestampSchema,
} as const;

// Renderer-safe cards never reveal source-machine or Main-managed filesystem paths.
export const StagedLectureExternalSourceCardSchema = z
  .object({ ...externalSourceCardShape, sourceSetId: uuidSchema })
  .strict();
export type StagedLectureExternalSourceCard = z.infer<typeof StagedLectureExternalSourceCardSchema>;

export const LectureExternalSourceCardSchema = z
  .object({ ...externalSourceCardShape, studioId: uuidSchema })
  .strict();
export type LectureExternalSourceCard = z.infer<typeof LectureExternalSourceCardSchema>;

function validateSourceCollection(
  sources: readonly (StagedLectureExternalSource | LectureExternalSource)[],
  context: z.RefinementCtx,
) {
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    context.addIssue({ code: 'custom', path: ['sources'], message: 'Source IDs must be unique' });
  }
  if (
    new Set(sources.map((source) => `${source.kind}:${source.sourceSha256}`)).size !==
    sources.length
  ) {
    context.addIssue({
      code: 'custom',
      path: ['sources'],
      message: 'Identical source content cannot be imported twice',
    });
  }
  const totalBytes = sources.reduce((sum, source) => sum + source.byteSize, 0);
  const totalCharacters = sources.reduce(
    (sum, source) => sum + source.extraction.extractedCharacters,
    0,
  );
  if (totalBytes > LECTURE_EXTERNAL_SOURCE_MAX_TOTAL_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['sources'],
      message: 'Total source bytes exceed the limit',
    });
  }
  if (totalCharacters > LECTURE_EXTERNAL_SOURCE_MAX_TOTAL_EXTRACTED_CHARACTERS) {
    context.addIssue({
      code: 'custom',
      path: ['sources'],
      message: 'Total extracted source text exceeds the limit',
    });
  }
}

export const StagedLectureExternalSourceSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    sources: z.array(StagedLectureExternalSourceSchema).max(LECTURE_EXTERNAL_SOURCE_MAX_SOURCES),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((set, context) => {
    validateSourceCollection(set.sources, context);
    set.sources.forEach((source, index) => {
      if (source.projectId !== set.projectId || source.sourceSetId !== set.id) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index],
          message: 'Every staged source must belong to this project and source set',
        });
      }
    });
    if (Date.parse(set.expiresAt) <= Date.parse(set.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'A staged source set must expire after it is created',
      });
    }
  });
export type StagedLectureExternalSourceSet = z.infer<typeof StagedLectureExternalSourceSetSchema>;

export const StagedLectureExternalSourceSetViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    sources: z
      .array(StagedLectureExternalSourceCardSchema)
      .max(LECTURE_EXTERNAL_SOURCE_MAX_SOURCES),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();
export type StagedLectureExternalSourceSetView = z.infer<
  typeof StagedLectureExternalSourceSetViewSchema
>;

export const SnapshotStagedLectureExternalSourcesInputSchema = z
  .object({
    projectId: uuidSchema,
    sourceSetId: uuidSchema,
    sourceIds: z.array(uuidSchema).min(1).max(LECTURE_EXTERNAL_SOURCE_MAX_SOURCES),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.sourceIds).size !== input.sourceIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceIds'],
        message: 'Staged source IDs must be unique',
      });
    }
  });
export type SnapshotStagedLectureExternalSourcesInput = z.infer<
  typeof SnapshotStagedLectureExternalSourcesInputSchema
>;

export const LectureExternalSourceListSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    studioId: uuidSchema,
    sources: z.array(LectureExternalSourceSchema).max(LECTURE_EXTERNAL_SOURCE_MAX_SOURCES),
  })
  .strict()
  .superRefine((list, context) => {
    validateSourceCollection(list.sources, context);
    list.sources.forEach((source, index) => {
      if (source.projectId !== list.projectId || source.studioId !== list.studioId) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index],
          message: 'Every source must belong to this project and Studio',
        });
      }
    });
  });
export type LectureExternalSourceList = z.infer<typeof LectureExternalSourceListSchema>;

export const LectureExternalSourceListViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    studioId: uuidSchema,
    sources: z.array(LectureExternalSourceCardSchema).max(LECTURE_EXTERNAL_SOURCE_MAX_SOURCES),
  })
  .strict();
export type LectureExternalSourceListView = z.infer<typeof LectureExternalSourceListViewSchema>;

export const StageLectureExternalSourcesInputSchema = z
  .object({ projectId: uuidSchema, sourceSetId: uuidSchema.nullable().default(null) })
  .strict();
export type StageLectureExternalSourcesInput = z.infer<
  typeof StageLectureExternalSourcesInputSchema
>;

export const ListStagedLectureExternalSourcesInputSchema = z
  .object({ projectId: uuidSchema, sourceSetId: uuidSchema })
  .strict();
export type ListStagedLectureExternalSourcesInput = z.infer<
  typeof ListStagedLectureExternalSourcesInputSchema
>;

export const DiscardLectureExternalSourceSetInputSchema =
  ListStagedLectureExternalSourcesInputSchema;
export type DiscardLectureExternalSourceSetInput = z.infer<
  typeof DiscardLectureExternalSourceSetInputSchema
>;

export const LectureExternalSourceScopeInputSchema = z
  .object({ projectId: uuidSchema, studioId: uuidSchema })
  .strict();
export type LectureExternalSourceScopeInput = z.infer<typeof LectureExternalSourceScopeInputSchema>;

export const ListLectureExternalSourcesInputSchema = LectureExternalSourceScopeInputSchema;
export type ListLectureExternalSourcesInput = z.infer<typeof ListLectureExternalSourcesInputSchema>;

export const ClaimLectureExternalSourceSetInputSchema =
  LectureExternalSourceScopeInputSchema.extend({
    sourceSetId: uuidSchema,
    selectedSourceIds: z.array(uuidSchema).min(1).max(LECTURE_EXTERNAL_SOURCE_MAX_SOURCES),
  })
    .strict()
    .refine((input) => new Set(input.selectedSourceIds).size === input.selectedSourceIds.length, {
      path: ['selectedSourceIds'],
      message: 'Selected external source IDs must be unique',
    });
export type ClaimLectureExternalSourceSetInput = z.infer<
  typeof ClaimLectureExternalSourceSetInputSchema
>;

export const RemoveLectureExternalSourceInputSchema = LectureExternalSourceScopeInputSchema.extend({
  sourceId: uuidSchema,
}).strict();
export type RemoveLectureExternalSourceInput = z.infer<
  typeof RemoveLectureExternalSourceInputSchema
>;

export const RemoveStagedLectureExternalSourceInputSchema =
  ListStagedLectureExternalSourcesInputSchema.extend({ sourceId: uuidSchema }).strict();
export type RemoveStagedLectureExternalSourceInput = z.infer<
  typeof RemoveStagedLectureExternalSourceInputSchema
>;

export const SnapshotLectureExternalSourcesInputSchema =
  LectureExternalSourceScopeInputSchema.extend({
    sourceIds: z.array(uuidSchema).min(1).max(LECTURE_EXTERNAL_SOURCE_MAX_SOURCES),
  })
    .strict()
    .refine((input) => new Set(input.sourceIds).size === input.sourceIds.length, {
      path: ['sourceIds'],
      message: 'Snapshot source IDs must be unique',
    });
export type SnapshotLectureExternalSourcesInput = z.infer<
  typeof SnapshotLectureExternalSourcesInputSchema
>;

export const PurgeLectureExternalSourcesInputSchema = LectureExternalSourceScopeInputSchema;
export type PurgeLectureExternalSourcesInput = z.infer<
  typeof PurgeLectureExternalSourcesInputSchema
>;

// Immutable source-manifest form. It intentionally omits every managed/local path.
export const LectureExternalSourceSnapshotSchema = z
  .object({
    ...sourceBaseShape,
    studioId: uuidSchema,
    sourceLabel: z.string().regex(/^F(?:[1-9]|1[0-2])$/u),
  })
  .strict()
  .superRefine(validateSourceFormat);
export type LectureExternalSourceSnapshot = z.infer<typeof LectureExternalSourceSnapshotSchema>;
