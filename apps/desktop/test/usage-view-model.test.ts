import { describe, expect, it } from 'vitest';

import type { ModelUsageAggregate } from '../src/shared/model-usage-contracts';
import {
  aggregateTokenValue,
  buildUsageTokenChart,
  describeAggregateCoverage,
  formatUsageRange,
  localCalendarDate,
  summarizeUsageCoverage,
  usageSeriesChartBuckets,
} from '../src/renderer/src/usage-view-model';

function aggregate(overrides: Partial<ModelUsageAggregate> = {}): ModelUsageAggregate {
  return {
    tokens: {
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedReadTokens: null,
      cachedWriteTokens: null,
      reasoningOutputTokens: null,
    },
    turnCount: 1,
    exactTurnCount: 1,
    partialTurnCount: 0,
    unavailableTurnCount: 0,
    ...overrides,
  };
}

describe('usage view truth-preserving model', () => {
  it('distinguishes a reported zero from numeric placeholders for unavailable turns', () => {
    const reportedZero = aggregate({
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedReadTokens: null,
        cachedWriteTokens: null,
        reasoningOutputTokens: null,
      },
    });
    const unavailable = aggregate({
      tokens: reportedZero.tokens,
      exactTurnCount: 0,
      unavailableTurnCount: 1,
    });

    expect(aggregateTokenValue(reportedZero, 'inputTokens')).toBe(0);
    expect(aggregateTokenValue(unavailable, 'inputTokens')).toBeNull();
    expect(describeAggregateCoverage(unavailable)).toBe('0 of 1 turns reported');
  });

  it('fails closed when summing reported values would exceed a safe integer', () => {
    const summary = summarizeUsageCoverage([
      { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 },
      { inputTokens: 1, outputTokens: 0 },
    ]);

    expect(summary.inputTokens).toBeNull();
    expect(summary.outputTokens).toBe(0);
    expect(summary.knownTotalTokens).toBeNull();
    expect(summary.inputReportedTurnCount).toBe(2);
  });

  it('marks chart buckets as lower bounds when any included turn is partial or unavailable', () => {
    const rows = [
      {
        ...aggregate({ turnCount: 2, exactTurnCount: 1, unavailableTurnCount: 1 }),
        bucketKey: '2026-08-20',
        fromInclusive: '2026-08-19T15:00:00.000Z',
        toExclusive: '2026-08-20T15:00:00.000Z',
      },
      {
        ...aggregate({ exactTurnCount: 0, partialTurnCount: 1 }),
        bucketKey: '2026-08-21',
        fromInclusive: '2026-08-20T15:00:00.000Z',
        toExclusive: '2026-08-21T15:00:00.000Z',
      },
    ];
    const buckets = usageSeriesChartBuckets(rows, 'Asia/Seoul');
    const chart = buildUsageTokenChart(buckets);

    expect(buckets.map(({ lowerBound }) => lowerBound)).toEqual([true, true]);
    expect(chart.bars.map(({ incomplete }) => incomplete)).toEqual([true, true]);
    expect(buckets[0]!.accessibleLabel).toContain('known lower bound');
    expect(buckets[0]!.accessibleLabel).toContain('1 of 2 turns reported');
  });

  it('fails closed if reported-turn arithmetic exceeds a safe integer', () => {
    const unsafe = aggregate({
      turnCount: Number.MAX_SAFE_INTEGER,
      exactTurnCount: Number.MAX_SAFE_INTEGER,
      partialTurnCount: 1,
    });

    expect(aggregateTokenValue(unsafe, 'totalTokens')).toBeNull();
    expect(describeAggregateCoverage(unsafe)).toContain('0 of');
  });

  it('uses the requested time zone for local calendar dates and visible report ranges', () => {
    expect(localCalendarDate(new Date('2026-08-19T15:30:00.000Z'), 'Asia/Seoul')).toBe(
      '2026-08-20',
    );
    expect(
      formatUsageRange(
        '2026-08-19T15:00:00.000Z',
        '2026-08-20T15:00:00.000Z',
        'Asia/Seoul',
        'en-US',
      ),
    ).toBe('Aug 20, 2026 · Asia/Seoul');
  });
});
