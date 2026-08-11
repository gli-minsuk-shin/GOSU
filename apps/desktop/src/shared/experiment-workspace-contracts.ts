import { ContentHashSchema, MetricAggregationSchema } from '@gosu/contracts';
import { z } from 'zod';

import { SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS } from './ssh-workspace-contracts';

export const EXPERIMENT_MAX_IDEAS_PER_PROJECT = 500;
export const EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT = 5_000;
export const EXPERIMENT_MAX_LOGGING_FIELDS = 24;
export const EXPERIMENT_MAX_LOGGING_TEMPLATE_REVISIONS_PER_PROJECT = 100;
export const EXPERIMENT_MAX_RUNS_PER_PROJECT = 500;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

export const EXPERIMENT_LOGGING_SYSTEM_FIELDS = [
  'schema_version',
  'template_version',
  'objective_version',
  'occurred_at',
  'event_type',
  'sequence',
  'run_id',
  'trial_id',
  'status',
  'server_label',
] as const;

export const ExperimentLoggingSystemFieldSchema = z.enum(EXPERIMENT_LOGGING_SYSTEM_FIELDS);
export type ExperimentLoggingSystemField = z.infer<typeof ExperimentLoggingSystemFieldSchema>;

const ExperimentLoggingSystemFieldsSchema = z
  .tuple([
    z.literal('schema_version'),
    z.literal('template_version'),
    z.literal('objective_version'),
    z.literal('occurred_at'),
    z.literal('event_type'),
    z.literal('sequence'),
    z.literal('run_id'),
    z.literal('trial_id'),
    z.literal('status'),
    z.literal('server_label'),
  ])
  .readonly();

export const ExperimentLoggingFieldTypeSchema = z.enum(['number', 'integer', 'string', 'boolean']);
export type ExperimentLoggingFieldType = z.infer<typeof ExperimentLoggingFieldTypeSchema>;

export const ExperimentLoggingFieldCategorySchema = z.enum([
  'metric',
  'parameter',
  'progress',
  'resource',
  'artifact',
  'note',
]);
export type ExperimentLoggingFieldCategory = z.infer<typeof ExperimentLoggingFieldCategorySchema>;

export const ExperimentLoggingRequiredAtSchema = z.enum([
  'run-start',
  'progress',
  'run-end',
  'summary',
]);
export type ExperimentLoggingRequiredAt = z.infer<typeof ExperimentLoggingRequiredAtSchema>;

const reservedLoggingKeys = new Set<string>([
  ...EXPERIMENT_LOGGING_SYSTEM_FIELDS,
  'project_id',
  'objective_id',
  'objective_version',
  'template_hash',
  'content_hash',
  'host',
  'hostname',
  'log_path',
  'raw_log',
  'stdout',
  'stderr',
]);
const secretLikeLoggingKey =
  /(?:^|[._-])(?:api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|secret|token|password|passwd|credential|authorization|auth)(?:$|[._-])/i;

export const ExperimentLoggingCustomFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    label: boundedText(80),
    type: ExperimentLoggingFieldTypeSchema,
    category: ExperimentLoggingFieldCategorySchema,
    requiredAt: z
      .array(ExperimentLoggingRequiredAtSchema)
      .min(1)
      .max(ExperimentLoggingRequiredAtSchema.options.length)
      .refine((values) => new Set(values).size === values.length, {
        message: 'Logging field lifecycle entries must be unique',
      }),
    unit: z.string().trim().min(1).max(32).nullable(),
  })
  .strict()
  .refine((field) => !reservedLoggingKeys.has(field.key), {
    message: 'Logging field key is reserved',
    path: ['key'],
  })
  .refine((field) => !secretLikeLoggingKey.test(field.key), {
    message: 'Secret-like logging field keys are not allowed',
    path: ['key'],
  });

export type ExperimentLoggingCustomField = z.infer<typeof ExperimentLoggingCustomFieldSchema>;

export const ExperimentLoggingCustomFieldsSchema = z
  .array(ExperimentLoggingCustomFieldSchema)
  .max(EXPERIMENT_MAX_LOGGING_FIELDS)
  .refine((fields) => new Set(fields.map(({ key }) => key)).size === fields.length, {
    message: 'Logging field keys must be unique',
  });

export const ExperimentLoggingTemplateSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    version: z.number().int().positive(),
    previousRevisionId: uuidSchema.nullable(),
    systemFields: ExperimentLoggingSystemFieldsSchema,
    customFields: ExperimentLoggingCustomFieldsSchema,
    templateHash: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: timestampSchema,
  })
  .strict();

export type ExperimentLoggingTemplate = z.infer<typeof ExperimentLoggingTemplateSchema>;

export const ExperimentRunStatusSchema = z.enum([
  'queued',
  'running',
  'verifying',
  'succeeded',
  'failed',
  'cancelled',
  'lost',
]);
export type ExperimentRunStatus = z.infer<typeof ExperimentRunStatusSchema>;

export const ExperimentRunModeSchema = z.enum(['comparable', 'exploratory']);
export type ExperimentRunMode = z.infer<typeof ExperimentRunModeSchema>;

export const ExperimentRunLoggingTemplateSnapshotSchema = ExperimentLoggingTemplateSchema.pick({
  id: true,
  version: true,
  systemFields: true,
  customFields: true,
  templateHash: true,
})
  .extend({ revisionId: uuidSchema })
  .omit({ id: true })
  .strict();

export type ExperimentRunLoggingTemplateSnapshot = z.infer<
  typeof ExperimentRunLoggingTemplateSnapshotSchema
>;

export const ExperimentRunLatestMetricSchema = z
  .object({
    key: boundedText(128),
    displayName: boundedText(256),
    value: z.number().finite(),
    unit: z.string().trim().min(1).max(64).nullable(),
    recordedAt: timestampSchema,
  })
  .strict();

export type ExperimentRunLatestMetric = z.infer<typeof ExperimentRunLatestMetricSchema>;

export const ExperimentRunLogValidationStateSchema = z.enum([
  'pending',
  'valid',
  'incomplete',
  'invalid',
]);

export const ExperimentRunLogReferenceSchema = z
  .object({
    referenceId: uuidSchema,
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine((value) => !/[\\/\0\r\n]/u.test(value), 'Log display name must not be a path'),
    contentHash: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative().safe(),
    validationState: ExperimentRunLogValidationStateSchema,
    missingFields: z
      .array(z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/))
      .max(EXPERIMENT_MAX_LOGGING_FIELDS + EXPERIMENT_LOGGING_SYSTEM_FIELDS.length)
      .refine((keys) => new Set(keys).size === keys.length, {
        message: 'Missing logging field keys must be unique',
      }),
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.validationState === 'incomplete' && reference.missingFields.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['missingFields'],
        message: 'Incomplete logs must identify at least one missing field',
      });
    }
    if (
      (reference.validationState === 'pending' || reference.validationState === 'valid') &&
      reference.missingFields.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['missingFields'],
        message: 'Pending or valid logs cannot claim missing fields',
      });
    }
  });

export type ExperimentRunLogReference = z.infer<typeof ExperimentRunLogReferenceSchema>;

const terminalRunStatuses = new Set<ExperimentRunStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'lost',
]);

export const ExperimentRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    ideaId: uuidSchema.nullable(),
    title: boundedText(160),
    status: ExperimentRunStatusSchema,
    mode: ExperimentRunModeSchema,
    serverLabel: boundedText(120),
    trialId: z.string().trim().min(1).max(128),
    objectiveId: uuidSchema.nullable(),
    objectiveVersion: z.number().int().positive().nullable(),
    loggingTemplate: ExperimentRunLoggingTemplateSnapshotSchema,
    progressCurrent: z.number().int().nonnegative().nullable(),
    progressTotal: z.number().int().positive().nullable(),
    currentStep: z.string().trim().min(1).max(160).nullable(),
    latestMetric: ExperimentRunLatestMetricSchema.nullable(),
    logReference: ExperimentRunLogReferenceSchema.nullable(),
    processExitCode: z.number().int().min(0).max(255).nullable(),
    processDurationMs: z.number().int().nonnegative().safe().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.mode === 'comparable' && run.ideaId === null) {
      context.addIssue({
        code: 'custom',
        path: ['ideaId'],
        message: 'Comparable runs need an idea',
      });
    }
    const hasObjective = run.objectiveId !== null && run.objectiveVersion !== null;
    if (run.mode === 'comparable' && !hasObjective) {
      context.addIssue({
        code: 'custom',
        path: ['objectiveId'],
        message: 'Comparable runs need a frozen objective snapshot',
      });
    }
    if (run.mode === 'exploratory' && (run.objectiveId !== null || run.objectiveVersion !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['objectiveId'],
        message: 'Exploratory runs cannot claim comparable objective evidence',
      });
    }
    if (
      run.progressCurrent !== null &&
      run.progressTotal !== null &&
      run.progressCurrent > run.progressTotal
    ) {
      context.addIssue({
        code: 'custom',
        path: ['progressCurrent'],
        message: 'Progress cannot exceed its total',
      });
    }
    if ((run.status === 'running' || run.status === 'verifying') && run.startedAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['startedAt'],
        message: 'Running run needs start time',
      });
    }
    if (terminalRunStatuses.has(run.status) !== (run.completedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Only terminal runs have a completion time',
      });
    }
    if (
      run.status === 'verifying' &&
      (run.logReference?.validationState !== 'pending' ||
        run.processExitCode === null ||
        run.processDurationMs === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['logReference'],
        message: 'Verifying runs need pending log and process receipts',
      });
    }
    if (run.logReference?.validationState === 'pending' && run.status !== 'verifying') {
      context.addIssue({
        code: 'custom',
        path: ['logReference'],
        message: 'Pending log verification must use the verifying run state',
      });
    }
    if ((run.processExitCode === null) !== (run.processDurationMs === null)) {
      context.addIssue({
        code: 'custom',
        path: ['processExitCode'],
        message: 'Process exit code and duration form one receipt',
      });
    }
    if (run.status === 'succeeded' && run.logReference?.validationState !== 'valid') {
      context.addIssue({
        code: 'custom',
        path: ['logReference'],
        message: 'Succeeded runs need a valid log reference',
      });
    }
    if (run.status === 'succeeded' && run.mode === 'comparable' && run.latestMetric === null) {
      context.addIssue({
        code: 'custom',
        path: ['latestMetric'],
        message: 'Succeeded comparable runs need their primary metric',
      });
    }
  });

export type ExperimentRun = z.infer<typeof ExperimentRunSchema>;

export const EXPERIMENT_IDEA_OUTCOMES = [
  'planned',
  'running',
  'success',
  'partial',
  'failed',
  'inconclusive',
] as const;

export const ExperimentIdeaOutcomeSchema = z.enum(EXPERIMENT_IDEA_OUTCOMES);
export type ExperimentIdeaOutcome = z.infer<typeof ExperimentIdeaOutcomeSchema>;

export const ExperimentMetricSourceSchema = z.enum(['manual', 'runner-summary']);
export type ExperimentMetricSource = z.infer<typeof ExperimentMetricSourceSchema>;

export const ExperimentIdeaSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    parentIdeaId: uuidSchema.nullable(),
    title: boundedText(160),
    hypothesis: z.string().trim().max(4_000),
    phase: z.string().trim().max(80),
    outcome: ExperimentIdeaOutcomeSchema,
    resultSummary: z.string().trim().max(4_000),
    version: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .strict();

export type ExperimentIdea = z.infer<typeof ExperimentIdeaSchema>;

export const ExperimentMetricPointSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    ideaId: uuidSchema,
    sequence: z.number().int().positive(),
    objectiveId: uuidSchema,
    objectiveVersion: z.number().int().positive(),
    metricKey: boundedText(128),
    metricDisplayName: boundedText(256),
    direction: z.enum(['maximize', 'minimize']),
    unit: z.string().trim().min(1).max(64).nullable(),
    aggregation: MetricAggregationSchema,
    evaluatorHash: ContentHashSchema,
    datasetHash: ContentHashSchema,
    holdoutHash: ContentHashSchema.nullable(),
    baseline: z.number().finite().nullable(),
    target: z.number().finite().nullable(),
    value: z.number().finite(),
    source: ExperimentMetricSourceSchema,
    trialId: z.string().trim().min(1).max(128).nullable(),
    recordedAt: timestampSchema,
  })
  .strict();

export type ExperimentMetricPoint = z.infer<typeof ExperimentMetricPointSchema>;

export const ExperimentWorkspaceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    loggingTemplate: ExperimentLoggingTemplateSchema,
    ideas: z.array(ExperimentIdeaSchema).max(EXPERIMENT_MAX_IDEAS_PER_PROJECT),
    metricPoints: z
      .array(ExperimentMetricPointSchema)
      .max(EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT),
    runs: z.array(ExperimentRunSchema).max(EXPERIMENT_MAX_RUNS_PER_PROJECT),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ideaIds = new Set(snapshot.ideas.map((idea) => idea.id));
    for (const [index, idea] of snapshot.ideas.entries()) {
      if (idea.projectId !== snapshot.projectId) {
        context.addIssue({
          code: 'custom',
          path: ['ideas', index, 'projectId'],
          message: 'Idea must belong to the requested project',
        });
      }
      if (idea.parentIdeaId !== null && !ideaIds.has(idea.parentIdeaId)) {
        context.addIssue({
          code: 'custom',
          path: ['ideas', index, 'parentIdeaId'],
          message: 'Parent idea must be present in the same project snapshot',
        });
      }
    }
    for (const [index, point] of snapshot.metricPoints.entries()) {
      if (point.projectId !== snapshot.projectId) {
        context.addIssue({
          code: 'custom',
          path: ['metricPoints', index, 'projectId'],
          message: 'Metric point must belong to the requested project',
        });
      }
      if (!ideaIds.has(point.ideaId)) {
        context.addIssue({
          code: 'custom',
          path: ['metricPoints', index, 'ideaId'],
          message: 'Metric point must reference an idea in the same project snapshot',
        });
      }
    }
    if (snapshot.loggingTemplate.projectId !== snapshot.projectId) {
      context.addIssue({
        code: 'custom',
        path: ['loggingTemplate', 'projectId'],
        message: 'Logging template must belong to the requested project',
      });
    }
    for (const [index, run] of snapshot.runs.entries()) {
      if (run.projectId !== snapshot.projectId) {
        context.addIssue({
          code: 'custom',
          path: ['runs', index, 'projectId'],
          message: 'Run must belong to the requested project',
        });
      }
      if (run.ideaId !== null && !ideaIds.has(run.ideaId)) {
        context.addIssue({
          code: 'custom',
          path: ['runs', index, 'ideaId'],
          message: 'Run idea must be present in the same project snapshot',
        });
      }
    }
  });

export type ExperimentWorkspaceSnapshot = z.infer<typeof ExperimentWorkspaceSnapshotSchema>;

export const ListExperimentWorkspaceInputSchema = z
  .object({
    projectId: uuidSchema,
  })
  .strict();

export type ListExperimentWorkspaceInput = z.infer<typeof ListExperimentWorkspaceInputSchema>;

export const ReadExperimentRunLogInputSchema = z
  .object({
    projectId: uuidSchema,
    runId: uuidSchema,
    referenceId: uuidSchema,
    offset: z.number().int().nonnegative().optional(),
    maxCharacters: z.number().int().min(1).max(SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS).optional(),
  })
  .strict();

export type ReadExperimentRunLogInput = z.infer<typeof ReadExperimentRunLogInputSchema>;

const ExperimentRunLogContentSchema = z
  .string()
  .refine(
    (value) => [...value].length <= SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS,
    'Experiment log chunk is too long',
  )
  .refine(
    (value) =>
      !/[\p{Cf}\p{Cs}]/u.test(value) &&
      ![...value].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return (
          (code <= 31 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159)
        );
      }),
    'Experiment log contains unsafe control characters',
  );

export const ExperimentRunLogChunkSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: uuidSchema,
    referenceId: uuidSchema,
    displayName: ExperimentRunLogReferenceSchema.shape.displayName,
    contentHash: ContentHashSchema,
    content: ExperimentRunLogContentSchema,
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
    totalCharacters: z.number().int().nonnegative(),
    truncated: z.boolean(),
    validationState: ExperimentRunLogValidationStateSchema,
    missingFields: ExperimentRunLogReferenceSchema.shape.missingFields,
    loadedAt: timestampSchema,
  })
  .strict()
  .refine((chunk) => {
    const end = chunk.offset + [...chunk.content].length;
    return chunk.truncated
      ? chunk.nextOffset === end && end < chunk.totalCharacters
      : chunk.nextOffset === null && end === chunk.totalCharacters;
  }, 'Experiment log offsets are inconsistent');

export type ExperimentRunLogChunk = z.infer<typeof ExperimentRunLogChunkSchema>;

export const CreateExperimentIdeaInputSchema = z
  .object({
    projectId: uuidSchema,
    parentIdeaId: uuidSchema.nullable().optional(),
    title: boundedText(160),
    hypothesis: z.string().trim().max(4_000).default(''),
    phase: z.string().trim().max(80).default(''),
  })
  .strict();

export type CreateExperimentIdeaInput = z.input<typeof CreateExperimentIdeaInputSchema>;

export const UpdateExperimentIdeaInputSchema = z
  .object({
    projectId: uuidSchema,
    ideaId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    title: boundedText(160),
    hypothesis: z.string().trim().max(4_000),
    phase: z.string().trim().max(80),
    outcome: ExperimentIdeaOutcomeSchema,
    resultSummary: z.string().trim().max(4_000),
  })
  .strict();

export type UpdateExperimentIdeaInput = z.infer<typeof UpdateExperimentIdeaInputSchema>;

export const RecordExperimentMetricInputSchema = z
  .object({
    projectId: uuidSchema,
    ideaId: uuidSchema,
    value: z.number().finite(),
    trialId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export type RecordExperimentMetricInput = z.infer<typeof RecordExperimentMetricInputSchema>;

export const ReviseExperimentLoggingTemplateInputSchema = z
  .object({
    projectId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    customFields: ExperimentLoggingCustomFieldsSchema,
  })
  .strict();

export type ReviseExperimentLoggingTemplateInput = z.infer<
  typeof ReviseExperimentLoggingTemplateInputSchema
>;

export const CreateExperimentRunInputSchema = z
  .object({
    projectId: uuidSchema,
    ideaId: uuidSchema.nullable(),
    title: boundedText(160),
    mode: ExperimentRunModeSchema,
    serverLabel: boundedText(120),
    trialId: z.string().trim().min(1).max(128),
  })
  .strict()
  .refine((input) => input.mode === 'exploratory' || input.ideaId !== null, {
    message: 'Comparable runs need an idea',
    path: ['ideaId'],
  });

export type CreateExperimentRunInput = z.infer<typeof CreateExperimentRunInputSchema>;

const UpdateExperimentRunLatestMetricSchema = ExperimentRunLatestMetricSchema.omit({
  recordedAt: true,
});

export const UpdateExperimentRunInputSchema = z
  .object({
    projectId: uuidSchema,
    runId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    status: ExperimentRunStatusSchema.optional(),
    progressCurrent: z.number().int().nonnegative().nullable().optional(),
    progressTotal: z.number().int().positive().nullable().optional(),
    currentStep: z.string().trim().min(1).max(160).nullable().optional(),
    latestMetric: UpdateExperimentRunLatestMetricSchema.nullable().optional(),
    logReference: ExperimentRunLogReferenceSchema.nullable().optional(),
    processExitCode: z.number().int().min(0).max(255).nullable().optional(),
    processDurationMs: z.number().int().nonnegative().safe().nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.status !== undefined ||
      input.progressCurrent !== undefined ||
      input.progressTotal !== undefined ||
      input.currentStep !== undefined ||
      input.latestMetric !== undefined ||
      input.logReference !== undefined ||
      input.processExitCode !== undefined ||
      input.processDurationMs !== undefined,
    { message: 'At least one run field must change' },
  );

export type UpdateExperimentRunInput = z.infer<typeof UpdateExperimentRunInputSchema>;

export const ExperimentWorkspaceEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('experiment.workspace.changed'),
    projectId: uuidSchema,
    entityType: z.enum(['idea', 'metric-point', 'logging-template', 'run']),
    entityId: uuidSchema,
    occurredAt: timestampSchema,
  })
  .strict();

export type ExperimentWorkspaceEvent = z.infer<typeof ExperimentWorkspaceEventSchema>;

export const EXPERIMENT_IPC_ERROR_CODES = [
  'invalid_experiment_input',
  'experiment_unavailable',
  'experiment_project_not_found',
  'experiment_project_unavailable',
  'experiment_idea_not_found',
  'experiment_parent_not_found',
  'experiment_idea_conflict',
  'experiment_idea_limit_reached',
  'experiment_metric_limit_reached',
  'experiment_objective_required',
  'experiment_logging_template_conflict',
  'experiment_logging_template_limit_reached',
  'experiment_run_not_found',
  'experiment_run_conflict',
  'experiment_run_limit_reached',
  'experiment_run_transition_invalid',
  'experiment_run_log_source_invalid',
  'experiment_run_log_access_required',
  'experiment_run_log_changed',
  'experiment_run_log_unavailable',
] as const;

export type ExperimentIpcErrorCode = (typeof EXPERIMENT_IPC_ERROR_CODES)[number];

export type ExperimentIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: ExperimentIpcErrorCode }> }>;
