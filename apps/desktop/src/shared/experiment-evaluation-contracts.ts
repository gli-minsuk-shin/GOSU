import { ModelInvocationSchema } from '@gosu/contracts';
import { z } from 'zod';

import {
  ExperimentLoggingCustomFieldsSchema,
  ExperimentLoggingFieldCategorySchema,
  ExperimentLoggingFieldTypeSchema,
  ExperimentLoggingRequiredAtSchema,
} from './experiment-workspace-contracts';

export const EXPERIMENT_EVALUATION_MAX_SESSIONS_PER_PROJECT = 100;
export const EXPERIMENT_EVALUATION_MAX_MESSAGES_PER_SESSION = 1_000;
export const EXPERIMENT_EVALUATION_MAX_REVISIONS_PER_SESSION = 100;
export const EXPERIMENT_EVALUATION_MAX_PROFILES_PER_PROJECT = 100;
export const EXPERIMENT_EVALUATION_MAX_MESSAGE_LENGTH = 32_000;
export const EXPERIMENT_EVALUATION_MAX_CODE_LENGTH = 120_000;
export const EXPERIMENT_EVALUATION_MAX_PROMPT_LENGTH = 40_000;
export const EXPERIMENT_EVALUATION_MAX_DRAFT_CHARACTERS = 100_000;
export const EXPERIMENT_EVALUATION_MAX_OUTPUTS = 12;
export const EXPERIMENT_EVALUATION_MAX_TABLE_COLUMNS = 12;
export const EXPERIMENT_EVALUATION_MAX_PLOT_SERIES = 6;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const safePythonFileNameSchema = z
  .string()
  .trim()
  .min(4)
  .max(120)
  .regex(/^[a-z][a-z0-9_-]*\.py$/u);

export const ExperimentEvaluationCadenceSchema = z
  .object({
    unit: z.enum(['step', 'epoch']),
    interval: z.number().int().min(1).max(1_000_000_000),
    startAt: z.number().int().min(0).max(1_000_000_000),
    stopAfter: z.number().int().min(1).max(1_000_000_000).nullable(),
  })
  .strict()
  .refine((cadence) => cadence.stopAfter === null || cadence.stopAfter >= cadence.startAt, {
    path: ['stopAfter'],
    message: 'Evaluation stop must not precede its start',
  });
export type ExperimentEvaluationCadence = z.infer<typeof ExperimentEvaluationCadenceSchema>;

export const ExperimentEvaluationMetricSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_.-]{0,63}$/u),
    displayName: boundedText(120),
    direction: z.enum(['maximize', 'minimize', 'observe']),
    unit: z.string().trim().min(1).max(32).nullable(),
    aggregation: z.enum(['mean', 'median', 'minimum', 'maximum', 'last', 'sum']),
    primary: z.boolean(),
  })
  .strict();
export type ExperimentEvaluationMetric = z.infer<typeof ExperimentEvaluationMetricSchema>;

export const ExperimentEvaluationOutputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('number'),
      title: boundedText(120),
      metricKey: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_.-]{0,63}$/u),
      description: z.string().trim().max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('table'),
      title: boundedText(120),
      columns: z.array(boundedText(80)).min(1).max(EXPERIMENT_EVALUATION_MAX_TABLE_COLUMNS),
      description: z.string().trim().max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('plot'),
      title: boundedText(120),
      plotKind: z.enum(['line', 'bar', 'scatter']),
      xField: boundedText(80),
      yMetricKeys: z
        .array(
          z
            .string()
            .trim()
            .regex(/^[a-z][a-z0-9_.-]{0,63}$/u),
        )
        .min(1)
        .max(EXPERIMENT_EVALUATION_MAX_PLOT_SERIES),
      description: z.string().trim().max(1_000),
    })
    .strict(),
]);
export type ExperimentEvaluationOutput = z.infer<typeof ExperimentEvaluationOutputSchema>;

const PreviewScalarSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const ExperimentEvaluationPreviewSchema = z
  .object({
    dataKind: z.literal('synthetic-preview'),
    evidence: z.literal(false),
    notice: boundedText(500),
    numbers: z
      .array(
        z
          .object({
            label: boundedText(120),
            value: z.number().finite(),
            unit: z.string().trim().min(1).max(32).nullable(),
          })
          .strict(),
      )
      .max(12),
    table: z
      .object({
        title: boundedText(120),
        columns: z.array(boundedText(80)).min(1).max(EXPERIMENT_EVALUATION_MAX_TABLE_COLUMNS),
        rows: z
          .array(z.array(PreviewScalarSchema).max(EXPERIMENT_EVALUATION_MAX_TABLE_COLUMNS))
          .max(24),
      })
      .strict()
      .superRefine((table, context) => {
        for (const [index, row] of table.rows.entries()) {
          if (row.length !== table.columns.length) {
            context.addIssue({
              code: 'custom',
              path: ['rows', index],
              message: 'Every preview row must match the preview columns',
            });
          }
        }
      })
      .nullable(),
    plot: z
      .object({
        title: boundedText(120),
        subtitle: boundedText(240),
        kind: z.enum(['line', 'bar', 'scatter']),
        xLabel: boundedText(80),
        yLabel: boundedText(80),
        series: z
          .array(
            z
              .object({
                name: boundedText(80),
                points: z
                  .array(
                    z
                      .object({
                        x: z.number().finite(),
                        y: z.number().finite(),
                        label: z.string().trim().min(1).max(120).nullable(),
                      })
                      .strict(),
                  )
                  .min(1)
                  .max(32),
              })
              .strict(),
          )
          .min(1)
          .max(EXPERIMENT_EVALUATION_MAX_PLOT_SERIES),
      })
      .strict()
      .nullable(),
    reportMarkdown: z.string().trim().min(1).max(16_000),
  })
  .strict();
export type ExperimentEvaluationPreview = z.infer<typeof ExperimentEvaluationPreviewSchema>;

export const ExperimentEvaluationDraftSchema = z
  .object({
    title: boundedText(160),
    purpose: boundedText(2_000),
    cadence: ExperimentEvaluationCadenceSchema,
    metrics: z
      .array(ExperimentEvaluationMetricSchema)
      .min(1)
      .max(8)
      .refine((metrics) => new Set(metrics.map((metric) => metric.key)).size === metrics.length, {
        message: 'Evaluation metric keys must be unique',
      })
      .refine((metrics) => metrics.filter((metric) => metric.primary).length <= 1, {
        message: 'At most one evaluation metric may be primary',
      }),
    evaluationPolicy: boundedText(8_000),
    experimentRules: z.array(boundedText(1_000)).max(24),
    loggingFields: ExperimentLoggingCustomFieldsSchema,
    outputs: z
      .array(ExperimentEvaluationOutputSchema)
      .min(1)
      .max(EXPERIMENT_EVALUATION_MAX_OUTPUTS),
    referenceCode: z
      .object({
        language: z.literal('python'),
        fileName: safePythonFileNameSchema,
        content: z.string().trim().min(1).max(EXPERIMENT_EVALUATION_MAX_CODE_LENGTH),
      })
      .strict(),
    promptTemplate: z.string().trim().min(1).max(EXPERIMENT_EVALUATION_MAX_PROMPT_LENGTH),
    preview: ExperimentEvaluationPreviewSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    const metricsByKey = new Map(draft.metrics.map((metric) => [metric.key, metric]));
    const metricKeys = new Set(metricsByKey.keys());
    const previewNumberLabels = new Set(draft.preview.numbers.map((number) => number.label));
    const previewPlotSeries = new Set(
      draft.preview.plot?.series.map((series) => series.name) ?? [],
    );
    for (const kind of ['table', 'plot'] as const) {
      if (draft.outputs.filter((output) => output.kind === kind).length > 1) {
        context.addIssue({
          code: 'custom',
          path: ['outputs'],
          message: `Evaluation draft may declare at most one ${kind} output`,
        });
      }
    }
    for (const [index, output] of draft.outputs.entries()) {
      if (output.kind === 'number' && !metricKeys.has(output.metricKey)) {
        context.addIssue({
          code: 'custom',
          path: ['outputs', index, 'metricKey'],
          message: 'Number output must reference a declared evaluation metric',
        });
      }
      if (output.kind === 'number') {
        const metric = metricsByKey.get(output.metricKey);
        if (
          metric &&
          !previewNumberLabels.has(metric.displayName) &&
          !previewNumberLabels.has(output.title)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['preview', 'numbers'],
            message: 'Every number output must have a matching synthetic preview value',
          });
        }
      }
      if (output.kind === 'table') {
        if (!draft.preview.table) {
          context.addIssue({
            code: 'custom',
            path: ['preview', 'table'],
            message: 'Every table output must have a synthetic table preview',
          });
        } else {
          for (const column of output.columns) {
            if (!draft.preview.table.columns.includes(column)) {
              context.addIssue({
                code: 'custom',
                path: ['preview', 'table', 'columns'],
                message: 'Synthetic table preview must include every declared output column',
              });
            }
          }
        }
      }
      if (output.kind !== 'plot') continue;
      if (new Set(output.yMetricKeys).size !== output.yMetricKeys.length) {
        context.addIssue({
          code: 'custom',
          path: ['outputs', index, 'yMetricKeys'],
          message: 'Plot metric references must be unique',
        });
      }
      for (const [metricIndex, metricKey] of output.yMetricKeys.entries()) {
        if (!metricKeys.has(metricKey)) {
          context.addIssue({
            code: 'custom',
            path: ['outputs', index, 'yMetricKeys', metricIndex],
            message: 'Plot output must reference a declared evaluation metric',
          });
        }
        const metric = metricsByKey.get(metricKey);
        if (
          metric &&
          !previewPlotSeries.has(metric.displayName) &&
          !previewPlotSeries.has(metric.key)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['preview', 'plot', 'series'],
            message: 'Synthetic plot preview must include every declared metric series',
          });
        }
      }
      if (!draft.preview.plot) {
        context.addIssue({
          code: 'custom',
          path: ['preview', 'plot'],
          message: 'Every plot output must have a synthetic plot preview',
        });
      } else if (draft.preview.plot.kind !== output.plotKind) {
        context.addIssue({
          code: 'custom',
          path: ['preview', 'plot', 'kind'],
          message: 'Synthetic plot preview kind must match the declared plot output',
        });
      }
    }
    if (JSON.stringify(draft).length > EXPERIMENT_EVALUATION_MAX_DRAFT_CHARACTERS) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Evaluation draft exceeds the revisable context budget',
      });
    }
  });
export type ExperimentEvaluationDraft = z.infer<typeof ExperimentEvaluationDraftSchema>;

export const ExperimentEvaluationSessionStatusSchema = z.enum([
  'draft',
  'generating',
  'ready',
  'failed',
  'archived',
]);
export type ExperimentEvaluationSessionStatus = z.infer<
  typeof ExperimentEvaluationSessionStatusSchema
>;

export const ExperimentEvaluationSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    title: boundedText(160),
    status: ExperimentEvaluationSessionStatusSchema,
    activeAttemptId: uuidSchema.nullable(),
    currentRevision: z.number().int().nonnegative(),
    acceptedProfileId: uuidSchema.nullable(),
    version: z.number().int().positive(),
    lastErrorCode: z.string().trim().min(1).max(128).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((session, context) => {
    if ((session.status === 'generating') !== (session.activeAttemptId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['activeAttemptId'],
        message: 'Only a generating evaluation session has an active attempt',
      });
    }
    if (session.status !== 'failed' && session.lastErrorCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['lastErrorCode'],
        message: 'Only a failed evaluation session retains an error',
      });
    }
  });
export type ExperimentEvaluationSession = z.infer<typeof ExperimentEvaluationSessionSchema>;

export const ExperimentEvaluationMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    sessionId: uuidSchema,
    role: z.enum(['user', 'assistant']),
    status: z.enum(['complete', 'failed', 'interrupted']),
    content: boundedText(EXPERIMENT_EVALUATION_MAX_MESSAGE_LENGTH),
    attemptId: uuidSchema.nullable(),
    revision: z.number().int().positive().nullable(),
    invocation: ModelInvocationSchema.nullable(),
    createdAt: timestampSchema,
    completedAt: timestampSchema,
  })
  .strict()
  .refine(
    (message) =>
      message.role === 'assistant' || (message.revision === null && message.invocation === null),
    { path: ['revision'], message: 'User messages cannot claim generated revisions' },
  );
export type ExperimentEvaluationMessage = z.infer<typeof ExperimentEvaluationMessageSchema>;

export const ExperimentEvaluationRevisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    sessionId: uuidSchema,
    revision: z.number().int().positive(),
    attemptId: uuidSchema,
    draft: ExperimentEvaluationDraftSchema,
    contentHash: sha256Schema,
    invocation: ModelInvocationSchema,
    createdAt: timestampSchema,
  })
  .strict();
export type ExperimentEvaluationRevision = z.infer<typeof ExperimentEvaluationRevisionSchema>;

export const ExperimentEvaluationProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    name: boundedText(160),
    sourceSessionId: uuidSchema,
    sourceRevisionId: uuidSchema,
    draft: ExperimentEvaluationDraftSchema,
    contentHash: sha256Schema,
    codePolicyHash: sha256Schema,
    invocation: ModelInvocationSchema,
    codePath: z.string().trim().min(1).max(1_024),
    promptPath: z.string().trim().min(1).max(1_024),
    useCount: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    lastUsedAt: timestampSchema,
  })
  .strict();
export type ExperimentEvaluationProfile = z.infer<typeof ExperimentEvaluationProfileSchema>;

export const ExperimentEvaluationSessionDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    session: ExperimentEvaluationSessionSchema,
    messages: z.array(ExperimentEvaluationMessageSchema).max(100),
    currentRevision: ExperimentEvaluationRevisionSchema.nullable(),
  })
  .strict();
export type ExperimentEvaluationSessionDetail = z.infer<
  typeof ExperimentEvaluationSessionDetailSchema
>;

export const ExperimentEvaluationListSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    sessions: z
      .array(ExperimentEvaluationSessionSchema)
      .max(EXPERIMENT_EVALUATION_MAX_SESSIONS_PER_PROJECT),
    profiles: z
      .array(ExperimentEvaluationProfileSchema)
      .max(EXPERIMENT_EVALUATION_MAX_PROFILES_PER_PROJECT),
  })
  .strict();
export type ExperimentEvaluationListSnapshot = z.infer<
  typeof ExperimentEvaluationListSnapshotSchema
>;

export const ListExperimentEvaluationsInputSchema = z.object({ projectId: uuidSchema }).strict();
export type ListExperimentEvaluationsInput = z.infer<typeof ListExperimentEvaluationsInputSchema>;

export const ExperimentEvaluationDetailInputSchema = z
  .object({ projectId: uuidSchema, sessionId: uuidSchema })
  .strict();
export type ExperimentEvaluationDetailInput = z.infer<typeof ExperimentEvaluationDetailInputSchema>;

export const CreateExperimentEvaluationSessionInputSchema = z
  .object({
    projectId: uuidSchema,
    title: boundedText(160).default('Evaluation session'),
  })
  .strict();
export type CreateExperimentEvaluationSessionInput = z.input<
  typeof CreateExperimentEvaluationSessionInputSchema
>;

export const SendExperimentEvaluationMessageInputSchema = z
  .object({
    projectId: uuidSchema,
    sessionId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    message: boundedText(EXPERIMENT_EVALUATION_MAX_MESSAGE_LENGTH),
    requestedModelId: z.string().trim().min(1).max(256).nullable().optional(),
    reasoningOptionId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict();
export type SendExperimentEvaluationMessageInput = z.infer<
  typeof SendExperimentEvaluationMessageInputSchema
>;

export const ApproveExperimentEvaluationInputSchema = z
  .object({
    projectId: uuidSchema,
    sessionId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    revision: z.number().int().positive(),
    profileName: boundedText(160),
  })
  .strict();
export type ApproveExperimentEvaluationInput = z.infer<
  typeof ApproveExperimentEvaluationInputSchema
>;

export const ReuseExperimentEvaluationProfileInputSchema = z
  .object({ projectId: uuidSchema, profileId: uuidSchema })
  .strict();
export type ReuseExperimentEvaluationProfileInput = z.infer<
  typeof ReuseExperimentEvaluationProfileInputSchema
>;

export const ExperimentEvaluationTurnReceiptSchema = z
  .object({
    session: ExperimentEvaluationSessionSchema,
    revision: ExperimentEvaluationRevisionSchema,
    assistantMessage: ExperimentEvaluationMessageSchema,
  })
  .strict();
export type ExperimentEvaluationTurnReceipt = z.infer<typeof ExperimentEvaluationTurnReceiptSchema>;

export const ExperimentEvaluationApprovalReceiptSchema = z
  .object({
    session: ExperimentEvaluationSessionSchema,
    profile: ExperimentEvaluationProfileSchema,
  })
  .strict();
export type ExperimentEvaluationApprovalReceipt = z.infer<
  typeof ExperimentEvaluationApprovalReceiptSchema
>;

export const ExperimentEvaluationEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('experiment.evaluation.changed'),
    projectId: uuidSchema,
    sessionId: uuidSchema,
    entityType: z.enum(['session', 'revision', 'profile']),
    entityId: uuidSchema,
    occurredAt: timestampSchema,
  })
  .strict();
export type ExperimentEvaluationEvent = z.infer<typeof ExperimentEvaluationEventSchema>;

export const ExperimentEvaluationGenerationOutputSchema = z
  .object({
    reply: boundedText(EXPERIMENT_EVALUATION_MAX_MESSAGE_LENGTH),
    sessionTitle: boundedText(160),
    draft: ExperimentEvaluationDraftSchema,
  })
  .strict();

export const EXPERIMENT_EVALUATION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'sessionTitle', 'draft'],
  properties: {
    reply: { type: 'string', minLength: 1, maxLength: EXPERIMENT_EVALUATION_MAX_MESSAGE_LENGTH },
    sessionTitle: { type: 'string', minLength: 1, maxLength: 160 },
    draft: {
      type: 'object',
      additionalProperties: false,
      required: [
        'title',
        'purpose',
        'cadence',
        'metrics',
        'evaluationPolicy',
        'experimentRules',
        'loggingFields',
        'outputs',
        'referenceCode',
        'promptTemplate',
        'preview',
      ],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 160 },
        purpose: { type: 'string', minLength: 1, maxLength: 2_000 },
        cadence: {
          type: 'object',
          additionalProperties: false,
          required: ['unit', 'interval', 'startAt', 'stopAfter'],
          properties: {
            unit: { type: 'string', enum: ['step', 'epoch'] },
            interval: { type: 'integer', minimum: 1, maximum: 1_000_000_000 },
            startAt: { type: 'integer', minimum: 0, maximum: 1_000_000_000 },
            stopAfter: {
              anyOf: [{ type: 'integer', minimum: 1, maximum: 1_000_000_000 }, { type: 'null' }],
            },
          },
        },
        metrics: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'displayName', 'direction', 'unit', 'aggregation', 'primary'],
            properties: {
              key: { type: 'string', pattern: '^[a-z][a-z0-9_.-]{0,63}$' },
              displayName: { type: 'string', minLength: 1, maxLength: 120 },
              direction: { type: 'string', enum: ['maximize', 'minimize', 'observe'] },
              unit: { anyOf: [{ type: 'string', minLength: 1, maxLength: 32 }, { type: 'null' }] },
              aggregation: {
                type: 'string',
                enum: ['mean', 'median', 'minimum', 'maximum', 'last', 'sum'],
              },
              primary: { type: 'boolean' },
            },
          },
        },
        evaluationPolicy: { type: 'string', minLength: 1, maxLength: 8_000 },
        experimentRules: {
          type: 'array',
          maxItems: 24,
          items: { type: 'string', minLength: 1, maxLength: 1_000 },
        },
        loggingFields: {
          type: 'array',
          maxItems: 24,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'label', 'type', 'category', 'requiredAt', 'unit'],
            properties: {
              key: { type: 'string', pattern: '^[a-z][a-z0-9_.-]{0,63}$' },
              label: { type: 'string', minLength: 1, maxLength: 80 },
              type: { type: 'string', enum: ExperimentLoggingFieldTypeSchema.options },
              category: { type: 'string', enum: ExperimentLoggingFieldCategorySchema.options },
              requiredAt: {
                type: 'array',
                minItems: 1,
                maxItems: ExperimentLoggingRequiredAtSchema.options.length,
                items: { type: 'string', enum: ExperimentLoggingRequiredAtSchema.options },
              },
              unit: { anyOf: [{ type: 'string', minLength: 1, maxLength: 32 }, { type: 'null' }] },
            },
          },
        },
        outputs: {
          type: 'array',
          minItems: 1,
          maxItems: EXPERIMENT_EVALUATION_MAX_OUTPUTS,
          items: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'title', 'metricKey', 'description'],
                properties: {
                  kind: { const: 'number' },
                  title: { type: 'string', minLength: 1, maxLength: 120 },
                  metricKey: { type: 'string', pattern: '^[a-z][a-z0-9_.-]{0,63}$' },
                  description: { type: 'string', maxLength: 1_000 },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'title', 'columns', 'description'],
                properties: {
                  kind: { const: 'table' },
                  title: { type: 'string', minLength: 1, maxLength: 120 },
                  columns: {
                    type: 'array',
                    minItems: 1,
                    maxItems: EXPERIMENT_EVALUATION_MAX_TABLE_COLUMNS,
                    items: { type: 'string', minLength: 1, maxLength: 80 },
                  },
                  description: { type: 'string', maxLength: 1_000 },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'title', 'plotKind', 'xField', 'yMetricKeys', 'description'],
                properties: {
                  kind: { const: 'plot' },
                  title: { type: 'string', minLength: 1, maxLength: 120 },
                  plotKind: { type: 'string', enum: ['line', 'bar', 'scatter'] },
                  xField: { type: 'string', minLength: 1, maxLength: 80 },
                  yMetricKeys: {
                    type: 'array',
                    minItems: 1,
                    maxItems: EXPERIMENT_EVALUATION_MAX_PLOT_SERIES,
                    items: { type: 'string', pattern: '^[a-z][a-z0-9_.-]{0,63}$' },
                  },
                  description: { type: 'string', maxLength: 1_000 },
                },
              },
            ],
          },
        },
        referenceCode: {
          type: 'object',
          additionalProperties: false,
          required: ['language', 'fileName', 'content'],
          properties: {
            language: { const: 'python' },
            fileName: { type: 'string', pattern: '^[a-z][a-z0-9_-]*\\.py$' },
            content: {
              type: 'string',
              minLength: 1,
              maxLength: EXPERIMENT_EVALUATION_MAX_CODE_LENGTH,
            },
          },
        },
        promptTemplate: {
          type: 'string',
          minLength: 1,
          maxLength: EXPERIMENT_EVALUATION_MAX_PROMPT_LENGTH,
        },
        preview: {
          type: 'object',
          additionalProperties: false,
          required: [
            'dataKind',
            'evidence',
            'notice',
            'numbers',
            'table',
            'plot',
            'reportMarkdown',
          ],
          properties: {
            dataKind: { const: 'synthetic-preview' },
            evidence: { const: false },
            notice: { type: 'string', minLength: 1, maxLength: 500 },
            numbers: {
              type: 'array',
              maxItems: 12,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'value', 'unit'],
                properties: {
                  label: { type: 'string', minLength: 1, maxLength: 120 },
                  value: { type: 'number' },
                  unit: {
                    anyOf: [{ type: 'string', minLength: 1, maxLength: 32 }, { type: 'null' }],
                  },
                },
              },
            },
            table: {
              anyOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['title', 'columns', 'rows'],
                  properties: {
                    title: { type: 'string', minLength: 1, maxLength: 120 },
                    columns: {
                      type: 'array',
                      minItems: 1,
                      maxItems: EXPERIMENT_EVALUATION_MAX_TABLE_COLUMNS,
                      items: { type: 'string', minLength: 1, maxLength: 80 },
                    },
                    rows: {
                      type: 'array',
                      maxItems: 24,
                      items: {
                        type: 'array',
                        maxItems: EXPERIMENT_EVALUATION_MAX_TABLE_COLUMNS,
                        items: {
                          anyOf: [
                            { type: 'string', maxLength: 500 },
                            { type: 'number' },
                            { type: 'boolean' },
                            { type: 'null' },
                          ],
                        },
                      },
                    },
                  },
                },
                { type: 'null' },
              ],
            },
            plot: {
              anyOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['title', 'subtitle', 'kind', 'xLabel', 'yLabel', 'series'],
                  properties: {
                    title: { type: 'string', minLength: 1, maxLength: 120 },
                    subtitle: { type: 'string', minLength: 1, maxLength: 240 },
                    kind: { type: 'string', enum: ['line', 'bar', 'scatter'] },
                    xLabel: { type: 'string', minLength: 1, maxLength: 80 },
                    yLabel: { type: 'string', minLength: 1, maxLength: 80 },
                    series: {
                      type: 'array',
                      minItems: 1,
                      maxItems: EXPERIMENT_EVALUATION_MAX_PLOT_SERIES,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['name', 'points'],
                        properties: {
                          name: { type: 'string', minLength: 1, maxLength: 80 },
                          points: {
                            type: 'array',
                            minItems: 1,
                            maxItems: 32,
                            items: {
                              type: 'object',
                              additionalProperties: false,
                              required: ['x', 'y', 'label'],
                              properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                                label: {
                                  anyOf: [
                                    { type: 'string', minLength: 1, maxLength: 120 },
                                    { type: 'null' },
                                  ],
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                { type: 'null' },
              ],
            },
            reportMarkdown: { type: 'string', minLength: 1, maxLength: 16_000 },
          },
        },
      },
    },
  },
} as const;

export const EXPERIMENT_EVALUATION_IPC_ERROR_CODES = [
  'invalid_experiment_evaluation_input',
  'experiment_evaluation_unavailable',
  'experiment_evaluation_project_not_found',
  'experiment_evaluation_project_unavailable',
  'experiment_evaluation_session_not_found',
  'experiment_evaluation_profile_not_found',
  'experiment_evaluation_version_conflict',
  'experiment_evaluation_busy',
  'experiment_evaluation_codex_unavailable',
  'experiment_evaluation_invalid_response',
  'experiment_evaluation_revision_not_found',
  'experiment_evaluation_revision_conflict',
  'experiment_evaluation_capacity_reached',
  'experiment_evaluation_artifact_failed',
] as const;
export type ExperimentEvaluationIpcErrorCode =
  (typeof EXPERIMENT_EVALUATION_IPC_ERROR_CODES)[number];

export type ExperimentEvaluationIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: ExperimentEvaluationIpcErrorCode }> }>;
