import { ModelInvocationSchema } from '@gosu/contracts';
import { z } from 'zod';

import {
  LiteratureSearchInputTagsSchema,
  LiteratureSearchTagsSchema,
} from './literature-search-tags';

export const LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT = 500;
export const LITERATURE_MAX_RECORDS_PER_PAGE = LITERATURE_MAX_ACTIVE_RECORDS_PER_PROJECT;
export const LITERATURE_MAX_SEARCH_RESULTS = 50;
export const LITERATURE_MAX_SEARCH_CONFLICT_PREVIEW = 3;
export const LITERATURE_MAX_AI_RECORDS = 50;
export const LITERATURE_MAX_TRANSFER_BYTES = 8 * 1024 * 1024;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalYearSchema = z.number().int().min(1000).max(3000).optional();
const nullableText = (maximum: number) => boundedText(maximum).nullable();
const topicSchema = boundedText(240);

export const LiteratureProviderSchema = z.enum([
  'crossref',
  'semantic-scholar',
  'hugging-face',
  'import',
]);
export const LiteratureSearchProviderSchema = z.enum(['crossref', 'balanced']);
export const LiteratureDiscoveryTierSchema = z.enum(['core', 'rising', 'broad']);
export const LiteratureDiscoveryPolicySchema = z.enum(['crossref-basic', 'balanced-three-layer']);
export const LiteratureDiscoverySignalSchema = z.enum([
  'relevance',
  'citation-authority',
  'recent-momentum',
  'author-impact',
  'hugging-face-index',
]);
export const LiteratureDiscoveryDegradationReasonSchema = z.enum([
  'semantic-scholar-unavailable',
  'semantic-scholar-no-eligible-results',
  'semantic-scholar-insufficient-results',
  'citation-lane-unavailable',
  'recent-lane-unavailable',
  'author-metrics-unavailable',
  'author-metrics-partial',
  'crossref-supplement-unavailable',
  'crossref-citation-lane-unavailable',
  'crossref-recent-lane-unavailable',
  'hugging-face-unavailable',
]);
export const LiteratureDiscoveryReasonSchema = z.enum([
  'high-query-relevance',
  'query-match-candidate',
  'high-citation-impact',
  'established-classic',
  'prominent-author-signal',
  'recent-publication',
  'estimated-citation-momentum',
  'influential-citation-signal',
  'core-impact-threshold-not-met',
  'core-relevance-threshold-not-met',
  'incomplete-bibliographic-metadata',
  'future-publication-year',
  'broad-recall',
]);
export const LiteratureReviewStatusSchema = z.enum([
  'unreviewed',
  'screening',
  'included',
  'excluded',
  'reviewed',
]);
export const LiteratureTransferFormatSchema = z.enum(['json', 'csv', 'bibtex']);
export const LiteratureAiRelevanceSchema = z.enum(['high', 'medium', 'low', 'uncertain']);

export const LiteratureAiProvenanceSchema = z
  .object({
    invocation: ModelInvocationSchema,
    inputSha256: sha256Schema,
    generatedAt: timestampSchema,
    metadataOnly: z.literal(true),
  })
  .strict();

export const LiteratureAiAnnotationsSchema = z
  .object({
    topics: z.array(topicSchema).max(12),
    summary: z.string().trim().max(1_200),
    relevance: LiteratureAiRelevanceSchema,
    studyType: z.string().trim().max(240),
    limitations: z.array(z.string().trim().min(1).max(400)).max(8),
    provenance: LiteratureAiProvenanceSchema,
  })
  .strict();

export const LiteratureManualAnnotationsSchema = z
  .object({
    topics: z.array(topicSchema).max(50),
    summary: z.string().trim().max(8_000),
    relevance: z.string().trim().max(4_000),
  })
  .strict();

export const LiteratureTierCountsSchema = z
  .object({
    core: z.number().int().nonnegative(),
    rising: z.number().int().nonnegative(),
    broad: z.number().int().nonnegative(),
  })
  .strict();

export const LiteratureDiscoveryCoverageSchema = z
  .object({
    source: z.enum(['semantic-scholar', 'crossref', 'hugging-face', 'combined']),
    availableSignals: z
      .array(LiteratureDiscoverySignalSchema)
      .min(1)
      .max(5)
      .refine((signals) => new Set(signals).size === signals.length, {
        message: 'Discovery coverage signals must be unique',
      }),
    degradationReasons: z
      .array(LiteratureDiscoveryDegradationReasonSchema)
      .max(10)
      .refine((reasons) => new Set(reasons).size === reasons.length, {
        message: 'Discovery degradation reasons must be unique',
      }),
  })
  .strict();

const normalizedDiscoveryScore = z.number().finite().min(0).max(1);

export const LiteratureRankingSignalsSchema = z
  .object({
    tier: LiteratureDiscoveryTierSchema,
    matchedLayers: z.array(LiteratureDiscoveryTierSchema).min(1).max(3),
    tierRank: z.number().int().positive().max(LITERATURE_MAX_SEARCH_RESULTS),
    overallScore: normalizedDiscoveryScore,
    relevanceScore: normalizedDiscoveryScore,
    authorityScore: normalizedDiscoveryScore,
    momentumScore: normalizedDiscoveryScore,
    citationVelocityProxy: z.number().finite().nonnegative().nullable(),
    influentialCitationCount: z.number().int().nonnegative().nullable(),
    maxAuthorHIndex: z.number().int().nonnegative().nullable(),
    reasons: z.array(LiteratureDiscoveryReasonSchema).min(1).max(8),
    signalSources: z
      .array(z.enum(['crossref', 'semantic-scholar', 'hugging-face']))
      .min(1)
      .max(3),
  })
  .strict();

export const LiteratureDiscoverySummarySchema = LiteratureRankingSignalsSchema.extend({
  searchRunId: uuidSchema,
  query: boundedText(1_000),
  policyId: LiteratureDiscoveryPolicySchema,
  policyVersion: z.number().int().positive(),
  classifiedAt: timestampSchema,
}).strict();

export const LiteratureRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    provider: LiteratureProviderSchema,
    providerRecordId: nullableText(2_048),
    canonicalId: nullableText(512).optional(),
    doi: nullableText(512),
    fingerprint: sha256Schema,
    title: boundedText(2_000),
    authors: z.array(boundedText(300)).max(100),
    containerTitle: nullableText(1_000),
    publishedYear: z.number().int().min(1000).max(3000).nullable(),
    sourceTopics: z.array(topicSchema).max(50),
    searchTags: LiteratureSearchTagsSchema.optional(),
    workType: nullableText(120),
    citationCount: z.number().int().nonnegative().nullable(),
    sourceUrl: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => value.startsWith('https://'), 'Literature source URLs must use HTTPS')
      .nullable(),
    citationKey: z.string().trim().max(160),
    reviewStatus: LiteratureReviewStatusSchema,
    manualAnnotations: LiteratureManualAnnotationsSchema,
    aiAnnotations: LiteratureAiAnnotationsSchema.nullable(),
    discovery: LiteratureDiscoverySummarySchema.nullable().optional(),
    annotationVersion: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const LiteratureSearchConflictSchema = z
  .object({
    ordinal: z.number().int().min(1).max(LITERATURE_MAX_SEARCH_RESULTS),
    provider: z.enum(['crossref', 'semantic-scholar', 'hugging-face']),
    providerRecordId: nullableText(2_048),
    canonicalId: nullableText(512),
    doi: nullableText(512),
    fingerprint: sha256Schema,
    title: boundedText(2_000),
    authors: z.array(boundedText(300)).max(100),
    publishedYear: z.number().int().min(1000).max(3000).nullable(),
  })
  .strict();

export const LiteratureSearchRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    projectId: uuidSchema,
    provider: LiteratureSearchProviderSchema,
    policyId: LiteratureDiscoveryPolicySchema.optional(),
    policyVersion: z.number().int().positive().optional(),
    query: boundedText(1_000),
    searchTags: LiteratureSearchTagsSchema.optional(),
    fromYear: z.number().int().min(1000).max(3000).nullable(),
    toYear: z.number().int().min(1000).max(3000).nullable(),
    requestedLimit: z.number().int().min(1).max(LITERATURE_MAX_SEARCH_RESULTS),
    status: z.enum(['running', 'complete', 'failed', 'cancelled']),
    foundCount: z.number().int().nonnegative(),
    retrievedCount: z.number().int().nonnegative().optional(),
    selectedCount: z.number().int().nonnegative().optional(),
    tierCounts: LiteratureTierCountsSchema.optional(),
    coverage: LiteratureDiscoveryCoverageSchema.optional(),
    newCount: z.number().int().nonnegative(),
    updatedCount: z.number().int().nonnegative(),
    unchangedCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative().default(0),
    conflicts: z
      .array(LiteratureSearchConflictSchema)
      .max(LITERATURE_MAX_SEARCH_CONFLICT_PREVIEW)
      .default([]),
    createdAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  })
  .strict();

export const LiteratureSearchInputSchema = z
  .object({
    projectId: uuidSchema,
    query: boundedText(1_000),
    searchTags: LiteratureSearchInputTagsSchema.optional(),
    fromYear: optionalYearSchema,
    toYear: optionalYearSchema,
    limit: z.number().int().min(1).max(LITERATURE_MAX_SEARCH_RESULTS).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.fromYear && input.toYear && input.fromYear > input.toYear) {
      context.addIssue({
        code: 'custom',
        message: 'fromYear must not be later than toYear',
        path: ['fromYear'],
      });
    }
  });

export const LiteratureSearchReceiptSchema = z
  .object({
    run: LiteratureSearchRunSchema,
    foundCount: z.number().int().nonnegative(),
    newCount: z.number().int().nonnegative(),
    updatedCount: z.number().int().nonnegative(),
    unchangedCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative().default(0),
    retrievedCount: z.number().int().nonnegative().optional(),
    selectedCount: z.number().int().nonnegative().optional(),
    tierCounts: LiteratureTierCountsSchema.optional(),
    coverage: LiteratureDiscoveryCoverageSchema.optional(),
  })
  .strict();

export const ListLiteratureInputSchema = z.object({ projectId: uuidSchema }).strict();

export const LiteratureLibrarySchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: uuidSchema,
    records: z.array(LiteratureRecordSchema).max(LITERATURE_MAX_RECORDS_PER_PAGE),
    total: z.number().int().nonnegative(),
    recentSearches: z.array(LiteratureSearchRunSchema).max(20),
  })
  .strict();

export const UpdateLiteratureAnnotationsInputSchema = z
  .object({
    projectId: uuidSchema,
    recordId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    expectedAnnotationVersion: z.number().int().nonnegative(),
    reviewStatus: LiteratureReviewStatusSchema,
    manualTopics: z.array(topicSchema).max(50),
    manualSummary: z.string().trim().max(8_000),
    manualRelevance: z.string().trim().max(4_000),
  })
  .strict();

export const DeleteLiteratureRecordInputSchema = z
  .object({
    projectId: uuidSchema,
    recordId: uuidSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const DeleteLiteratureRecordReceiptSchema = z
  .object({ projectId: uuidSchema, recordId: uuidSchema, deleted: z.literal(true) })
  .strict();

export const LiteratureImportRequestSchema = z
  .object({
    projectId: uuidSchema,
    format: LiteratureTransferFormatSchema.optional(),
  })
  .strict();

export const LiteratureImportReceiptSchema = z
  .object({
    status: z.enum(['cancelled', 'imported']),
    format: LiteratureTransferFormatSchema.nullable(),
    fileName: z.string().trim().max(255).nullable(),
    importedCount: z.number().int().nonnegative(),
    updatedCount: z.number().int().nonnegative(),
    unchangedCount: z.number().int().nonnegative(),
  })
  .strict();

export const LiteratureExportRequestSchema = z
  .object({
    projectId: uuidSchema,
    format: LiteratureTransferFormatSchema,
    recordIds: z.array(uuidSchema).max(LITERATURE_MAX_RECORDS_PER_PAGE).optional(),
  })
  .strict();

export const LiteratureExportReceiptSchema = z
  .object({
    status: z.enum(['cancelled', 'exported']),
    format: LiteratureTransferFormatSchema,
    fileName: z.string().trim().max(255).nullable(),
    recordCount: z.number().int().nonnegative(),
    sha256: sha256Schema.nullable(),
  })
  .strict();

export const LiteratureAiAnnotationUpdateSchema = z
  .object({
    recordId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    expectedAnnotationVersion: z.number().int().nonnegative(),
    topics: z.array(topicSchema).max(12),
    summary: z.string().trim().max(1_200),
    relevance: LiteratureAiRelevanceSchema,
    studyType: z.string().trim().max(240),
    limitations: z.array(z.string().trim().min(1).max(400)).max(8),
  })
  .strict();

export const LiteratureAiResponseSchema = z
  .object({ updates: z.array(LiteratureAiAnnotationUpdateSchema).max(LITERATURE_MAX_AI_RECORDS) })
  .strict();

export const LITERATURE_AI_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    updates: {
      type: 'array',
      maxItems: LITERATURE_MAX_AI_RECORDS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          recordId: { type: 'string', minLength: 36, maxLength: 36 },
          expectedVersion: { type: 'integer', minimum: 1 },
          expectedAnnotationVersion: { type: 'integer', minimum: 0 },
          topics: {
            type: 'array',
            maxItems: 12,
            items: { type: 'string', minLength: 1, maxLength: 240 },
          },
          summary: { type: 'string', maxLength: 1_200 },
          relevance: { type: 'string', enum: ['high', 'medium', 'low', 'uncertain'] },
          studyType: { type: 'string', maxLength: 240 },
          limitations: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 400 },
          },
        },
        required: [
          'recordId',
          'expectedVersion',
          'expectedAnnotationVersion',
          'topics',
          'summary',
          'relevance',
          'studyType',
          'limitations',
        ],
      },
    },
  },
  required: ['updates'],
} as const;

export const OrganizeLiteratureInputSchema = z
  .object({
    projectId: uuidSchema,
    recordIds: z.array(uuidSchema).min(1).max(LITERATURE_MAX_AI_RECORDS),
    requestedModelId: boundedText(256).nullable().optional(),
    reasoningOptionId: boundedText(128).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.recordIds).size !== input.recordIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'recordIds must be unique',
        path: ['recordIds'],
      });
    }
  });

export const LiteratureOrganizeReceiptSchema = z
  .object({
    projectId: uuidSchema,
    requestedCount: z.number().int().positive().max(LITERATURE_MAX_AI_RECORDS),
    updatedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    invocation: ModelInvocationSchema,
    inputSha256: sha256Schema,
    completedAt: timestampSchema,
  })
  .strict();

export const LITERATURE_IPC_ERROR_CODES = [
  'invalid_literature_input',
  'literature_project_not_found',
  'literature_project_unavailable',
  'literature_provider_unavailable',
  'literature_rate_limited',
  'literature_record_not_found',
  'literature_record_conflict',
  'literature_record_limit_reached',
  'literature_identity_conflict',
  'literature_import_invalid',
  'literature_import_too_large',
  'literature_export_too_large',
  'literature_ai_busy',
  'literature_ai_unavailable',
  'literature_ai_invalid_response',
  'literature_ai_conflict',
  'literature_unavailable',
] as const;

export type LiteratureProvider = z.infer<typeof LiteratureProviderSchema>;
export type LiteratureSearchProvider = z.infer<typeof LiteratureSearchProviderSchema>;
export type LiteratureDiscoveryTier = z.infer<typeof LiteratureDiscoveryTierSchema>;
export type LiteratureDiscoveryPolicy = z.infer<typeof LiteratureDiscoveryPolicySchema>;
export type LiteratureDiscoverySignal = z.infer<typeof LiteratureDiscoverySignalSchema>;
export type LiteratureDiscoveryDegradationReason = z.infer<
  typeof LiteratureDiscoveryDegradationReasonSchema
>;
export type LiteratureDiscoveryCoverage = z.infer<typeof LiteratureDiscoveryCoverageSchema>;
export type LiteratureDiscoveryReason = z.infer<typeof LiteratureDiscoveryReasonSchema>;
export type LiteratureTierCounts = z.infer<typeof LiteratureTierCountsSchema>;
export type LiteratureRankingSignals = z.infer<typeof LiteratureRankingSignalsSchema>;
export type LiteratureDiscoverySummary = z.infer<typeof LiteratureDiscoverySummarySchema>;
export type LiteratureReviewStatus = z.infer<typeof LiteratureReviewStatusSchema>;
export type LiteratureTransferFormat = z.infer<typeof LiteratureTransferFormatSchema>;
export type LiteratureAiProvenance = z.infer<typeof LiteratureAiProvenanceSchema>;
export type LiteratureAiAnnotations = z.infer<typeof LiteratureAiAnnotationsSchema>;
export type LiteratureRecord = z.infer<typeof LiteratureRecordSchema>;
export type LiteratureSearchConflict = z.infer<typeof LiteratureSearchConflictSchema>;
export type LiteratureSearchRun = z.infer<typeof LiteratureSearchRunSchema>;
export type LiteratureSearchInput = z.infer<typeof LiteratureSearchInputSchema>;
export type LiteratureSearchReceipt = z.infer<typeof LiteratureSearchReceiptSchema>;
export type ListLiteratureInput = z.infer<typeof ListLiteratureInputSchema>;
export type LiteratureLibrary = z.infer<typeof LiteratureLibrarySchema>;
export type UpdateLiteratureAnnotationsInput = z.infer<
  typeof UpdateLiteratureAnnotationsInputSchema
>;
export type DeleteLiteratureRecordInput = z.infer<typeof DeleteLiteratureRecordInputSchema>;
export type DeleteLiteratureRecordReceipt = z.infer<typeof DeleteLiteratureRecordReceiptSchema>;
export type LiteratureImportRequest = z.infer<typeof LiteratureImportRequestSchema>;
export type LiteratureImportReceipt = z.infer<typeof LiteratureImportReceiptSchema>;
export type LiteratureExportRequest = z.infer<typeof LiteratureExportRequestSchema>;
export type LiteratureExportReceipt = z.infer<typeof LiteratureExportReceiptSchema>;
export type LiteratureAiAnnotationUpdate = z.infer<typeof LiteratureAiAnnotationUpdateSchema>;
export type LiteratureAiResponse = z.infer<typeof LiteratureAiResponseSchema>;
export type OrganizeLiteratureInput = z.infer<typeof OrganizeLiteratureInputSchema>;
export type LiteratureOrganizeReceipt = z.infer<typeof LiteratureOrganizeReceiptSchema>;
export type LiteratureIpcErrorCode = (typeof LITERATURE_IPC_ERROR_CODES)[number];
export type LiteratureIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: LiteratureIpcErrorCode }> }>;
