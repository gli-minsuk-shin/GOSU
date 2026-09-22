import { describe, expect, it } from 'vitest';

import {
  MODEL_USAGE_WORKLOAD_KINDS,
  ModelUsageAnalyticsQuerySchema,
  ModelUsageAnalyticsReportSchema,
  ModelUsageAggregateSchema,
  ModelUsageLectureGenerationPageSchema,
  ModelUsageLectureGenerationRowSchema,
  ModelUsageTokenTotalsSchema,
} from '../src/shared/model-usage-contracts';

const zeroAggregate = {
  tokens: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedReadTokens: null,
    cachedWriteTokens: null,
    reasoningOutputTokens: null,
  },
  turnCount: 0,
  exactTurnCount: 0,
  partialTurnCount: 0,
  unavailableTurnCount: 0,
} as const;

describe('model usage contracts', () => {
  it('rejects unsafe or internally inconsistent token totals', () => {
    expect(
      ModelUsageTokenTotalsSchema.safeParse({
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 1,
        totalTokens: Number.MAX_SAFE_INTEGER,
        cachedReadTokens: null,
        cachedWriteTokens: null,
        reasoningOutputTokens: null,
      }).success,
    ).toBe(false);
    expect(
      ModelUsageTokenTotalsSchema.safeParse({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 16,
        cachedReadTokens: 2,
        cachedWriteTokens: null,
        reasoningOutputTokens: 1,
      }).success,
    ).toBe(false);
    expect(
      ModelUsageTokenTotalsSchema.safeParse({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cachedReadTokens: 7,
        cachedWriteTokens: 4,
        reasoningOutputTokens: 1,
      }).success,
    ).toBe(false);
  });

  it('does not expose zero-valued measurements when no turn reported usage', () => {
    expect(ModelUsageAggregateSchema.parse(zeroAggregate).tokens.cachedReadTokens).toBeNull();
    expect(
      ModelUsageAggregateSchema.safeParse({
        ...zeroAggregate,
        tokens: { ...zeroAggregate.tokens, cachedReadTokens: 0 },
      }).success,
    ).toBe(false);
  });

  it('requires an opaque model filter to be qualified by connection', () => {
    expect(
      ModelUsageAnalyticsQuerySchema.safeParse({
        period: 'month',
        anchorDate: '2026-08-20',
        timeZone: 'Asia/Seoul',
        modelId: 'configured-model',
      }).success,
    ).toBe(false);
  });

  it('keeps unavailable finalized lecture turns countable without inventing tokens', () => {
    expect(
      ModelUsageLectureGenerationRowSchema.parse({
        studioId: '11111111-1111-4111-8111-111111111111',
        studioTitle: 'Bootstrap',
        attemptId: '22222222-2222-4222-8222-222222222222',
        projectId: '33333333-3333-4333-8333-333333333333',
        projectName: 'Statistics',
        status: 'failed',
        startedAt: '2026-08-20T00:00:00.000Z',
        completedAt: '2026-08-20T00:01:00.000Z',
        coverage: 'unavailable',
        tokens: null,
        turnCount: 1,
        byConnection: [
          {
            connectionKey: 'codex:chatgpt',
            connectionLabel: 'ChatGPT',
            providerId: 'codex',
            upstreamProviderId: null,
            resolvedModelId: 'gpt-5',
            tokens: zeroAggregate.tokens,
            turnCount: 1,
            exactTurnCount: 0,
            partialTurnCount: 0,
            unavailableTurnCount: 1,
          },
        ],
      }).coverage,
    ).toBe('unavailable');
  });

  it('rejects out-of-range Lecture pagination metadata', () => {
    expect(
      ModelUsageLectureGenerationPageSchema.safeParse({
        items: [],
        total: 1,
        offset: 100,
        limit: 25,
        snapshotAt: '2026-08-20T02:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('validates range chronology by instant instead of timestamp text', () => {
    const parsed = ModelUsageAnalyticsReportSchema.safeParse({
      schemaVersion: 1,
      generatedAt: '2026-08-20T02:00:00.000Z',
      trackingStartedAt: '2026-08-20T00:00:00.000Z',
      localOnly: true,
      rangeCoverage: 'complete',
      range: {
        period: 'day',
        anchorDate: '2026-08-20',
        timeZone: 'UTC',
        fromInclusive: '2026-08-20T01:00:00+01:00',
        toExclusive: '2026-08-20T01:30:00+02:00',
      },
      totals: zeroAggregate,
      series: [],
      byProject: [],
      byConnection: [],
      byModel: [],
      byWorkload: [],
      lectureGenerations: {
        items: [],
        total: 0,
        offset: 0,
        limit: 25,
        snapshotAt: '2026-08-20T02:00:00.000Z',
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a report with or without the feature-by-model breakdown, and checks its rows strictly', () => {
    const report = {
      schemaVersion: 1,
      generatedAt: '2026-08-20T02:00:00.000Z',
      trackingStartedAt: '2026-08-01T00:00:00.000Z',
      localOnly: true,
      rangeCoverage: 'complete',
      range: {
        period: 'day',
        anchorDate: '2026-08-20',
        timeZone: 'UTC',
        fromInclusive: '2026-08-20T00:00:00.000Z',
        toExclusive: '2026-08-21T00:00:00.000Z',
      },
      totals: zeroAggregate,
      series: [],
      byProject: [],
      byConnection: [],
      byModel: [],
      byWorkload: [],
      lectureGenerations: {
        items: [],
        total: 0,
        offset: 0,
        limit: 25,
        snapshotAt: '2026-08-20T02:00:00.000Z',
      },
    };
    const part = {
      ...zeroAggregate,
      workloadKind: 'briefing_summary',
      connectionKey: 'codex:native',
      connectionLabel: 'codex · GOSU',
      providerId: 'codex',
      upstreamProviderId: null,
      resolvedModelId: 'gpt-5.6-luna',
    };
    // Reports from before 0.58.138 have no such field.
    expect(ModelUsageAnalyticsReportSchema.safeParse(report).success).toBe(true);
    expect(
      ModelUsageAnalyticsReportSchema.safeParse({ ...report, byWorkloadModel: [part] }).success,
    ).toBe(true);
    for (const bad of [
      { ...part, workloadKind: 'something_else' },
      { ...part, usd: 1 },
      { ...part, resolvedModelId: '' },
    ])
      expect(
        ModelUsageAnalyticsReportSchema.safeParse({ ...report, byWorkloadModel: [bad] }).success,
      ).toBe(false);
    // Cut at 1,000 rows like the other model breakdowns; more is a bug in the producer.
    expect(
      ModelUsageAnalyticsReportSchema.safeParse({
        ...report,
        byWorkloadModel: Array.from({ length: 1001 }, () => part),
      }).success,
    ).toBe(false);
  });
  it('knows paper summaries as a feature of their own and accepts the daily feature-by-model rows', () => {
    expect(MODEL_USAGE_WORKLOAD_KINDS).toContain('paper_summary');
    const report = {
      schemaVersion: 1,
      generatedAt: '2026-08-20T02:00:00.000Z',
      trackingStartedAt: '2026-08-01T00:00:00.000Z',
      localOnly: true,
      rangeCoverage: 'complete',
      range: {
        period: 'day',
        anchorDate: '2026-08-20',
        timeZone: 'UTC',
        fromInclusive: '2026-08-20T00:00:00.000Z',
        toExclusive: '2026-08-21T00:00:00.000Z',
      },
      totals: zeroAggregate,
      series: [],
      byProject: [],
      byConnection: [],
      byModel: [],
      byWorkload: [],
      lectureGenerations: {
        items: [],
        total: 0,
        offset: 0,
        limit: 25,
        snapshotAt: '2026-08-20T02:00:00.000Z',
      },
    };
    const day = {
      ...zeroAggregate,
      bucketKey: '2026-08-20',
      workloadKind: 'paper_summary',
      connectionKey: 'codex:native',
      connectionLabel: 'codex · GOSU',
      providerId: 'codex',
      upstreamProviderId: null,
      resolvedModelId: 'gpt-5.6-luna',
    };
    const parse = (rows: unknown) =>
      ModelUsageAnalyticsReportSchema.safeParse({ ...report, byDayWorkloadModel: rows }).success;
    expect(parse([day])).toBe(true);
    // Reports from before 0.58.140 have no such field.
    expect(ModelUsageAnalyticsReportSchema.safeParse(report).success).toBe(true);
    expect(parse([{ ...day, bucketKey: '20 August' }])).toBe(false);
    expect(parse([{ ...day, extra: 1 }])).toBe(false);
    expect(parse(Array.from({ length: 1001 }, () => day))).toBe(false);
  });
});
