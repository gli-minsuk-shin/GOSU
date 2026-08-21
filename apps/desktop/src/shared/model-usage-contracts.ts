import { z } from 'zod';

export const MODEL_USAGE_PERIODS = ['day', 'week', 'month'] as const;
export const MODEL_USAGE_WORKLOAD_KINDS = [
  'project_chat',
  'project_chat_title',
  'lecture_generation',
  'literature_organize',
  'experiment_evaluation',
  'hermes_delegation',
] as const;
export const MODEL_USAGE_COVERAGE_KINDS = [
  'pending',
  'exact',
  'partial',
  'unavailable',
  'not_tracked',
] as const;

const timestampSchema = z.string().datetime({ offset: true });
const uuidSchema = z.string().uuid();
const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const nonNegativeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const optionalTokenCountSchema = nonNegativeIntegerSchema.nullable();
const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    );
  }, 'Anchor date must be a valid local calendar date');
const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
      return true;
    } catch {
      return false;
    }
  }, 'Time zone must be an IANA time-zone identifier');

export const ModelUsagePeriodSchema = z.enum(MODEL_USAGE_PERIODS);
export type ModelUsagePeriod = z.infer<typeof ModelUsagePeriodSchema>;

export const ModelUsageWorkloadKindSchema = z.enum(MODEL_USAGE_WORKLOAD_KINDS);
export type ModelUsageWorkloadKind = z.infer<typeof ModelUsageWorkloadKindSchema>;

export const ModelUsageCoverageSchema = z.enum(MODEL_USAGE_COVERAGE_KINDS);
export type ModelUsageCoverage = z.infer<typeof ModelUsageCoverageSchema>;

export const ModelUsageLecturePageInputSchema = z
  .object({
    offset: nonNegativeIntegerSchema.max(100_000),
    limit: z.number().int().min(1).max(100),
    snapshotAt: timestampSchema.optional(),
  })
  .strict();
export type ModelUsageLecturePageInput = z.infer<typeof ModelUsageLecturePageInputSchema>;

export const ModelUsageAnalyticsQuerySchema = z
  .object({
    period: ModelUsagePeriodSchema,
    anchorDate: localDateSchema,
    timeZone: timeZoneSchema,
    projectId: uuidSchema.optional(),
    connectionKey: boundedIdentifierSchema.optional(),
    modelId: boundedIdentifierSchema.optional(),
    workloadKind: ModelUsageWorkloadKindSchema.optional(),
    lecturePage: ModelUsageLecturePageInputSchema.optional(),
  })
  .strict()
  .refine((query) => query.modelId === undefined || query.connectionKey !== undefined, {
    path: ['connectionKey'],
    message: 'A model filter must be qualified by its connection',
  });
export type ModelUsageAnalyticsQuery = z.infer<typeof ModelUsageAnalyticsQuerySchema>;

export const ModelUsageTokenTotalsSchema = z
  .object({
    inputTokens: nonNegativeIntegerSchema,
    outputTokens: nonNegativeIntegerSchema,
    totalTokens: nonNegativeIntegerSchema,
    cachedReadTokens: optionalTokenCountSchema,
    cachedWriteTokens: optionalTokenCountSchema,
    reasoningOutputTokens: optionalTokenCountSchema,
  })
  .strict()
  .superRefine((tokens, context) => {
    const combined = tokens.inputTokens + tokens.outputTokens;
    if (!Number.isSafeInteger(combined) || combined !== tokens.totalTokens) {
      context.addIssue({
        code: 'custom',
        path: ['totalTokens'],
        message: 'Total tokens must be the safe sum of input and output tokens',
      });
    }
    if (tokens.cachedReadTokens !== null && tokens.cachedReadTokens > tokens.inputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['cachedReadTokens'],
        message: 'Cached-read tokens cannot exceed input tokens',
      });
    }
    if (tokens.cachedWriteTokens !== null && tokens.cachedWriteTokens > tokens.inputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['cachedWriteTokens'],
        message: 'Cached-write tokens cannot exceed input tokens',
      });
    }
    if (
      tokens.cachedReadTokens !== null &&
      tokens.cachedWriteTokens !== null &&
      (!Number.isSafeInteger(tokens.cachedReadTokens + tokens.cachedWriteTokens) ||
        tokens.cachedReadTokens + tokens.cachedWriteTokens > tokens.inputTokens)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cachedWriteTokens'],
        message: 'Combined cache tokens cannot exceed input tokens',
      });
    }
    if (
      tokens.reasoningOutputTokens !== null &&
      tokens.reasoningOutputTokens > tokens.outputTokens
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reasoningOutputTokens'],
        message: 'Reasoning-output tokens cannot exceed output tokens',
      });
    }
  });
export type ModelUsageTokenTotals = z.infer<typeof ModelUsageTokenTotalsSchema>;

export const ModelUsageAggregateSchema = z
  .object({
    tokens: ModelUsageTokenTotalsSchema,
    turnCount: nonNegativeIntegerSchema,
    exactTurnCount: nonNegativeIntegerSchema,
    partialTurnCount: nonNegativeIntegerSchema,
    unavailableTurnCount: nonNegativeIntegerSchema,
  })
  .strict()
  .superRefine((aggregate, context) => {
    const classified =
      aggregate.exactTurnCount + aggregate.partialTurnCount + aggregate.unavailableTurnCount;
    if (!Number.isSafeInteger(classified) || classified !== aggregate.turnCount) {
      context.addIssue({
        code: 'custom',
        path: ['turnCount'],
        message: 'Every included turn must have exactly one coverage classification',
      });
    }
    const reported = aggregate.exactTurnCount + aggregate.partialTurnCount;
    if (
      reported === 0 &&
      (aggregate.tokens.inputTokens !== 0 ||
        aggregate.tokens.outputTokens !== 0 ||
        aggregate.tokens.totalTokens !== 0 ||
        aggregate.tokens.cachedReadTokens !== null ||
        aggregate.tokens.cachedWriteTokens !== null ||
        aggregate.tokens.reasoningOutputTokens !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tokens'],
        message: 'An aggregate without reported turns cannot expose token measurements',
      });
    }
  });
export type ModelUsageAggregate = z.infer<typeof ModelUsageAggregateSchema>;

export const ModelUsageRangeSchema = z
  .object({
    period: ModelUsagePeriodSchema,
    anchorDate: localDateSchema,
    timeZone: timeZoneSchema,
    fromInclusive: timestampSchema,
    toExclusive: timestampSchema,
  })
  .strict()
  .refine((range) => Date.parse(range.fromInclusive) < Date.parse(range.toExclusive), {
    path: ['toExclusive'],
    message: 'Usage range must be ordered',
  });
export type ModelUsageRange = z.infer<typeof ModelUsageRangeSchema>;

export const ModelUsageSeriesRowSchema = ModelUsageAggregateSchema.extend({
  bucketKey: localDateSchema,
  fromInclusive: timestampSchema,
  toExclusive: timestampSchema,
}).strict();
export type ModelUsageSeriesRow = z.infer<typeof ModelUsageSeriesRowSchema>;

export const ModelUsageProjectRowSchema = ModelUsageAggregateSchema.extend({
  projectId: uuidSchema,
  projectName: z.string().trim().min(1).max(512).nullable(),
}).strict();
export type ModelUsageProjectRow = z.infer<typeof ModelUsageProjectRowSchema>;

export const ModelUsageConnectionRowSchema = ModelUsageAggregateSchema.extend({
  connectionKey: boundedIdentifierSchema,
  connectionLabel: z.string().trim().min(1).max(256),
  providerId: boundedIdentifierSchema,
  upstreamProviderId: boundedIdentifierSchema.nullable(),
}).strict();
export type ModelUsageConnectionRow = z.infer<typeof ModelUsageConnectionRowSchema>;

export const ModelUsageModelRowSchema = ModelUsageAggregateSchema.extend({
  connectionKey: boundedIdentifierSchema,
  connectionLabel: z.string().trim().min(1).max(256),
  providerId: boundedIdentifierSchema,
  upstreamProviderId: boundedIdentifierSchema.nullable(),
  resolvedModelId: boundedIdentifierSchema,
}).strict();
export type ModelUsageModelRow = z.infer<typeof ModelUsageModelRowSchema>;

export const ModelUsageWorkloadRowSchema = ModelUsageAggregateSchema.extend({
  workloadKind: ModelUsageWorkloadKindSchema,
}).strict();
export type ModelUsageWorkloadRow = z.infer<typeof ModelUsageWorkloadRowSchema>;

export const ModelUsageLectureConnectionRowSchema = ModelUsageAggregateSchema.extend({
  connectionKey: boundedIdentifierSchema,
  connectionLabel: z.string().trim().min(1).max(256),
  providerId: boundedIdentifierSchema,
  upstreamProviderId: boundedIdentifierSchema.nullable(),
  resolvedModelId: boundedIdentifierSchema.nullable(),
}).strict();
export type ModelUsageLectureConnectionRow = z.infer<typeof ModelUsageLectureConnectionRowSchema>;

export const ModelUsageLectureGenerationRowSchema = z
  .object({
    studioId: uuidSchema,
    studioTitle: z.string().trim().min(1).max(512),
    attemptId: uuidSchema,
    projectId: uuidSchema,
    projectName: z.string().trim().min(1).max(512).nullable(),
    status: z.enum(['running', 'succeeded', 'failed', 'interrupted']),
    startedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
    coverage: ModelUsageCoverageSchema,
    tokens: ModelUsageTokenTotalsSchema.nullable(),
    turnCount: nonNegativeIntegerSchema,
    byConnection: z.array(ModelUsageLectureConnectionRowSchema).max(100),
  })
  .strict()
  .superRefine((row, context) => {
    if ((row.status === 'running') !== (row.completedAt === null)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Only a running lecture attempt may omit completion time',
      });
    }
    if (row.coverage === 'pending' && row.status !== 'running') {
      context.addIssue({
        code: 'custom',
        path: ['coverage'],
        message: 'Pending coverage is reserved for a running attempt',
      });
    }
    const reported = row.coverage === 'exact' || row.coverage === 'partial';
    if (reported !== (row.tokens !== null) || (reported && row.turnCount < 1)) {
      context.addIssue({
        code: 'custom',
        path: ['tokens'],
        message: 'Only an attempt with reported turns may expose known token totals',
      });
    }
    if (
      (row.coverage === 'not_tracked' || row.coverage === 'pending') &&
      (row.turnCount !== 0 || row.byConnection.length !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['turnCount'],
        message: 'An untracked or pending attempt cannot expose finalized usage turns',
      });
    }
  });
export type ModelUsageLectureGenerationRow = z.infer<typeof ModelUsageLectureGenerationRowSchema>;

export const ModelUsageLectureGenerationPageSchema = z
  .object({
    items: z.array(ModelUsageLectureGenerationRowSchema).max(100),
    total: nonNegativeIntegerSchema,
    offset: nonNegativeIntegerSchema,
    limit: z.number().int().min(1).max(100),
    snapshotAt: timestampSchema,
  })
  .strict()
  .superRefine((page, context) => {
    const validOffset = page.total === 0 ? page.offset === 0 : page.offset < page.total;
    const expectedLength = Math.min(page.limit, Math.max(0, page.total - page.offset));
    if (!validOffset || page.items.length !== expectedLength) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Lecture usage page metadata must describe one bounded in-range window',
      });
    }
  });
export type ModelUsageLectureGenerationPage = z.infer<typeof ModelUsageLectureGenerationPageSchema>;

export const ModelUsageAnalyticsReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: timestampSchema,
    trackingStartedAt: timestampSchema,
    localOnly: z.literal(true),
    rangeCoverage: z.enum(['complete', 'partial', 'not_tracked']),
    range: ModelUsageRangeSchema,
    totals: ModelUsageAggregateSchema,
    series: z.array(ModelUsageSeriesRowSchema).max(31),
    byProject: z.array(ModelUsageProjectRowSchema).max(1_000),
    byConnection: z.array(ModelUsageConnectionRowSchema).max(1_000),
    byModel: z.array(ModelUsageModelRowSchema).max(1_000),
    byWorkload: z.array(ModelUsageWorkloadRowSchema).max(MODEL_USAGE_WORKLOAD_KINDS.length),
    lectureGenerations: ModelUsageLectureGenerationPageSchema,
  })
  .strict()
  .superRefine((report, context) => {
    const rangeStart = Date.parse(report.range.fromInclusive);
    const rangeEnd = Date.parse(report.range.toExclusive);
    const trackingStarted = Date.parse(report.trackingStartedAt);
    const generated = Date.parse(report.generatedAt);
    if (Date.parse(report.lectureGenerations.snapshotAt) > generated) {
      context.addIssue({
        code: 'custom',
        path: ['lectureGenerations', 'snapshotAt'],
        message: 'Lecture pagination snapshot cannot be newer than the report',
      });
    }
    if (trackingStarted > generated) {
      context.addIssue({
        code: 'custom',
        path: ['trackingStartedAt'],
        message: 'Usage tracking cannot start after report generation',
      });
    }
    const expectedCoverage =
      trackingStarted >= rangeEnd
        ? 'not_tracked'
        : trackingStarted <= rangeStart
          ? 'complete'
          : 'partial';
    if (report.rangeCoverage !== expectedCoverage) {
      context.addIssue({
        code: 'custom',
        path: ['rangeCoverage'],
        message: 'Range coverage must reflect the local tracking start',
      });
    }
    const keys = new Set<string>();
    let previousEnd = rangeStart;
    for (const [index, bucket] of report.series.entries()) {
      const bucketStart = Date.parse(bucket.fromInclusive);
      const bucketEnd = Date.parse(bucket.toExclusive);
      if (
        keys.has(bucket.bucketKey) ||
        bucketStart < rangeStart ||
        bucketEnd > rangeEnd ||
        bucketStart < previousEnd ||
        bucketStart >= bucketEnd
      ) {
        context.addIssue({
          code: 'custom',
          path: ['series', index],
          message: 'Usage series buckets must be unique, ordered, non-overlapping, and contained',
        });
      }
      keys.add(bucket.bucketKey);
      previousEnd = bucketEnd;
    }
  });
export type ModelUsageAnalyticsReport = z.infer<typeof ModelUsageAnalyticsReportSchema>;
