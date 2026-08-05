import { ContentHashSchema, MetricAggregationSchema } from '@gosu/contracts';
import { z } from 'zod';

export const EXPERIMENT_MAX_IDEAS_PER_PROJECT = 500;
export const EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT = 5_000;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

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
    ideas: z.array(ExperimentIdeaSchema).max(EXPERIMENT_MAX_IDEAS_PER_PROJECT),
    metricPoints: z
      .array(ExperimentMetricPointSchema)
      .max(EXPERIMENT_MAX_METRIC_POINTS_PER_PROJECT),
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
  });

export type ExperimentWorkspaceSnapshot = z.infer<typeof ExperimentWorkspaceSnapshotSchema>;

export const ListExperimentWorkspaceInputSchema = z
  .object({
    projectId: uuidSchema,
  })
  .strict();

export type ListExperimentWorkspaceInput = z.infer<typeof ListExperimentWorkspaceInputSchema>;

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

export const ExperimentWorkspaceEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('experiment.workspace.changed'),
    projectId: uuidSchema,
    entityType: z.enum(['idea', 'metric-point']),
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
] as const;

export type ExperimentIpcErrorCode = (typeof EXPERIMENT_IPC_ERROR_CODES)[number];

export type ExperimentIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: ExperimentIpcErrorCode }> }>;
