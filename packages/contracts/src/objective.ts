import { z } from 'zod';

import { ContentHashSchema, EntityIdSchema, IsoDateTimeSchema } from './common.js';

export const MetricDirectionSchema = z.enum(['maximize', 'minimize']);
export type MetricDirection = z.infer<typeof MetricDirectionSchema>;

export const MetricAggregationSchema = z.enum(['mean', 'median', 'minimum', 'maximum', 'last']);
export type MetricAggregation = z.infer<typeof MetricAggregationSchema>;

export const PrimaryMetricSchema = z
  .object({
    key: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(256),
    direction: MetricDirectionSchema,
    unit: z.string().trim().min(1).max(64).nullable(),
    aggregation: MetricAggregationSchema,
    evaluatorHash: ContentHashSchema,
    datasetHash: ContentHashSchema,
    holdoutHash: ContentHashSchema.nullable(),
    baseline: z.number().finite().nullable(),
    target: z.number().finite().nullable(),
  })
  .strict();
export type PrimaryMetric = z.infer<typeof PrimaryMetricSchema>;

export const GuardrailOperatorSchema = z.enum(['lt', 'lte', 'gt', 'gte']);
export type GuardrailOperator = z.infer<typeof GuardrailOperatorSchema>;

export const MetricGuardrailSchema = z
  .object({
    metricKey: z.string().trim().min(1).max(128),
    operator: GuardrailOperatorSchema,
    threshold: z.number().finite(),
  })
  .strict();
export type MetricGuardrail = z.infer<typeof MetricGuardrailSchema>;

export const ExperimentBudgetSchema = z
  .object({
    maxTrials: z.number().int().positive(),
    maxConcurrentTrials: z.number().int().positive(),
    maxWallTimeSeconds: z.number().int().positive(),
    maxGpuHours: z.number().finite().nonnegative(),
    maxFailures: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((budget, context) => {
    if (budget.maxConcurrentTrials > budget.maxTrials) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'maxConcurrentTrials cannot exceed maxTrials',
        path: ['maxConcurrentTrials'],
      });
    }
  });
export type ExperimentBudget = z.infer<typeof ExperimentBudgetSchema>;

export const BudgetUsageSchema = z
  .object({
    trialsStarted: z.number().int().nonnegative(),
    activeTrials: z.number().int().nonnegative(),
    wallTimeSeconds: z.number().finite().nonnegative(),
    gpuHours: z.number().finite().nonnegative(),
    failures: z.number().int().nonnegative(),
  })
  .strict();
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

export const GuardrailActionSchema = z.enum(['pause', 'stop', 'fail']);
export type GuardrailAction = z.infer<typeof GuardrailActionSchema>;

export const StopPolicySchema = z
  .object({
    stopWhenTargetReached: z.boolean(),
    guardrailAction: GuardrailActionSchema,
    maxConsecutiveNoImprovement: z.number().int().positive().nullable(),
  })
  .strict();
export type StopPolicy = z.infer<typeof StopPolicySchema>;

export const ObjectiveVersionSchema = z
  .object({
    schemaVersion: z.literal(1),
    objectiveVersionId: EntityIdSchema,
    projectId: EntityIdSchema,
    version: z.number().int().positive(),
    goal: z.string().trim().min(1).max(4_000),
    primaryMetric: PrimaryMetricSchema,
    guardrails: z.array(MetricGuardrailSchema),
    budget: ExperimentBudgetSchema,
    stopPolicy: StopPolicySchema,
    createdBy: EntityIdSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((objective, context) => {
    if (objective.primaryMetric.target === null && objective.stopPolicy.stopWhenTargetReached) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'stopWhenTargetReached requires a primary metric target',
        path: ['stopPolicy', 'stopWhenTargetReached'],
      });
    }
  });
export type ObjectiveVersion = z.infer<typeof ObjectiveVersionSchema>;

export const ObjectiveSnapshotSchema = z
  .object({
    objectiveVersionId: EntityIdSchema,
    version: z.number().int().positive(),
    primaryMetric: PrimaryMetricSchema,
    budget: ExperimentBudgetSchema,
  })
  .strict();
export type ObjectiveSnapshot = z.infer<typeof ObjectiveSnapshotSchema>;
