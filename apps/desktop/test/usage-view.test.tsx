import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ModelUsageAnalyticsReport } from '../src/shared/model-usage-contracts';
import type { ProjectRecord } from '../src/shared/workspace-contracts';
import {
  UsageView,
  buildUsageAnalyticsQueries,
  shouldRetainUsageReport,
  usageModelDisplayName,
} from '../src/renderer/src/usage-view';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';

const project: ProjectRecord = {
  id: PROJECT_ID,
  name: 'Token Research',
  slug: 'token-research',
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

function report(overrides: Partial<ModelUsageAnalyticsReport> = {}): ModelUsageAnalyticsReport {
  const aggregate = {
    tokens: {
      inputTokens: 1_200,
      outputTokens: 300,
      totalTokens: 1_500,
      cachedReadTokens: null,
      cachedWriteTokens: null,
      reasoningOutputTokens: null,
    },
    turnCount: 2,
    exactTurnCount: 1,
    partialTurnCount: 0,
    unavailableTurnCount: 1,
  } as const;
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-20T04:00:00.000Z',
    trackingStartedAt: '2026-08-01T00:00:00.000Z',
    localOnly: true,
    rangeCoverage: 'complete',
    range: {
      period: 'day',
      anchorDate: '2026-08-20',
      timeZone: 'Asia/Seoul',
      fromInclusive: '2026-08-19T15:00:00.000Z',
      toExclusive: '2026-08-20T15:00:00.000Z',
    },
    totals: aggregate,
    series: [
      {
        ...aggregate,
        bucketKey: '2026-08-20',
        fromInclusive: '2026-08-19T15:00:00.000Z',
        toExclusive: '2026-08-20T15:00:00.000Z',
      },
    ],
    byProject: [{ ...aggregate, projectId: PROJECT_ID, projectName: project.name }],
    byConnection: [
      {
        ...aggregate,
        connectionKey: 'codex:chatgpt-account',
        connectionLabel: 'ChatGPT account',
        providerId: 'codex',
        upstreamProviderId: 'openai',
      },
    ],
    byModel: [
      {
        ...aggregate,
        connectionKey: 'codex:chatgpt-account',
        connectionLabel: 'ChatGPT account',
        providerId: 'codex',
        upstreamProviderId: 'openai',
        resolvedModelId: 'gpt-5.6',
      },
    ],
    byWorkload: [{ ...aggregate, workloadKind: 'lecture_generation' }],
    lectureGenerations: {
      items: [
        {
          studioId: STUDIO_ID,
          studioTitle: 'Bootstrap',
          attemptId: ATTEMPT_ID,
          projectId: PROJECT_ID,
          projectName: project.name,
          status: 'succeeded',
          startedAt: '2026-08-20T03:00:00.000Z',
          completedAt: '2026-08-20T03:07:00.000Z',
          coverage: 'partial',
          tokens: aggregate.tokens,
          turnCount: 1,
          byConnection: [
            {
              ...aggregate,
              turnCount: 1,
              unavailableTurnCount: 0,
              connectionKey: 'codex:chatgpt-account',
              connectionLabel: 'ChatGPT account',
              providerId: 'codex',
              upstreamProviderId: 'openai',
              resolvedModelId: 'gpt-5.6',
            },
          ],
        },
      ],
      total: 1,
      offset: 0,
      limit: 25,
      snapshotAt: '2026-08-20T04:00:00.000Z',
    },
    ...overrides,
  };
}

const adapter = { query: vi.fn() };

describe('local model Usage view', () => {
  it('renders known tokens, coverage, stable observed facets, and a lower-bound chart truthfully', () => {
    const html = renderToStaticMarkup(
      <UsageView adapter={adapter} projects={[project]} initialReport={report()} />,
    );

    expect(html).toContain('LOCAL PROVIDER-REPORTED USAGE');
    expect(html).toContain('Missing usage is never estimated or displayed as zero');
    expect(html).toContain('Aug 20, 2026 · Asia/Seoul');
    expect(html).toContain('Updated Aug 20');
    expect(html).toContain('Tracked since Aug 1');
    expect(html).toContain('Known totals are a lower bound');
    expect(html).toContain('1 of 2 turns reported');
    expect(html).toContain('aria-label="Known input tokens: 1,200 tokens"');
    expect(html).toContain('class="usage-chart-lower-bound"');
    expect(html).toContain('The accompanying data table contains the same values');
    expect(html).toContain('All observed connections');
    expect(html).toContain('ChatGPT account · OpenAI via Codex');
    expect(html).toContain('gpt-5.6');
    expect(html).toContain('Project totals use the recorded output owner');
    expect(html).toContain('Linked Lecture source projects are not duplicated');
    expect(html).not.toContain('Cost');
  });

  it('shows reported zero as zero but unavailable numeric placeholders as Not reported', () => {
    const zeroTokens = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedReadTokens: null,
      cachedWriteTokens: null,
      reasoningOutputTokens: null,
    } as const;
    const reportedZero = report({
      totals: {
        tokens: zeroTokens,
        turnCount: 1,
        exactTurnCount: 1,
        partialTurnCount: 0,
        unavailableTurnCount: 0,
      },
      series: [],
    });
    const unavailable = report({
      totals: {
        tokens: zeroTokens,
        turnCount: 1,
        exactTurnCount: 0,
        partialTurnCount: 0,
        unavailableTurnCount: 1,
      },
      series: [],
      byProject: [
        {
          tokens: zeroTokens,
          turnCount: 1,
          exactTurnCount: 0,
          partialTurnCount: 0,
          unavailableTurnCount: 1,
          projectId: PROJECT_ID,
          projectName: null,
        },
      ],
    });

    const zeroHtml = renderToStaticMarkup(
      <UsageView adapter={adapter} projects={[project]} initialReport={reportedZero} />,
    );
    const unavailableHtml = renderToStaticMarkup(
      <UsageView adapter={adapter} projects={[]} initialReport={unavailable} />,
    );

    expect(zeroHtml).toContain('aria-label="Known input tokens: 0 tokens"');
    expect(unavailableHtml).toContain('Known input tokens: Not reported');
    expect(unavailableHtml).toContain('— <small>Not reported</small>');
    expect(unavailableHtml).toContain('Unavailable project · 11111111');
    expect(unavailableHtml).toContain('Turns were recorded, but token counts were not reported');
  });

  it('shows partial tracking history explicitly', () => {
    const html = renderToStaticMarkup(
      <UsageView
        adapter={adapter}
        projects={[project]}
        initialReport={report({ rangeCoverage: 'partial' })}
      />,
    );

    expect(html).toContain('Partial history');
    expect(html).toContain('Tracking started inside this range');
    expect(html).toContain('Earlier turns are not estimated');
  });

  it('distinguishes a range that entirely predates tracking', () => {
    const emptyAggregate = {
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
    const html = renderToStaticMarkup(
      <UsageView
        adapter={adapter}
        projects={[]}
        initialReport={report({
          rangeCoverage: 'not_tracked',
          totals: emptyAggregate,
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
            snapshotAt: '2026-08-20T04:00:00.000Z',
          },
        })}
      />,
    );

    expect(html).toContain('Not tracked in this range');
    expect(html).toContain('Usage was not tracked in this range');
    expect(html).toContain('does not estimate earlier turns');
  });

  it('renders Lecture generation ownership, status, qualified model, and pagination', () => {
    const html = renderToStaticMarkup(
      <UsageView
        adapter={adapter}
        projects={[project]}
        initialReport={report()}
        initialBreakdown="lectures"
      />,
    );

    expect(html).toContain('aria-label="Usage by Lecture generation"');
    expect(html).toContain('Bootstrap');
    expect(html).toContain('Token Research');
    expect(html).toContain('ChatGPT account');
    expect(html).toContain('OpenAI via Codex · GPT 5.6');
    expect(html).toContain('Partial · known lower bound');
    expect(html).toContain('1–1 of 1 generations');
  });

  it('keeps an unavailable terminal Lecture turn visible without displaying token zero', () => {
    const base = report();
    const unavailableLecture = {
      ...base.lectureGenerations.items[0]!,
      coverage: 'unavailable' as const,
      tokens: null,
      turnCount: 1,
      byConnection: [
        {
          ...base.byConnection[0]!,
          tokens: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cachedReadTokens: null,
            cachedWriteTokens: null,
            reasoningOutputTokens: null,
          },
          turnCount: 1,
          exactTurnCount: 0,
          partialTurnCount: 0,
          unavailableTurnCount: 1,
          resolvedModelId: null,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <UsageView
        adapter={adapter}
        projects={[project]}
        initialReport={report({
          lectureGenerations: {
            items: [unavailableLecture],
            total: 1,
            offset: 0,
            limit: 25,
            snapshotAt: base.lectureGenerations.snapshotAt,
          },
        })}
        initialBreakdown="lectures"
      />,
    );

    expect(html).toContain('<td>1</td><td>— Not reported</td>');
    expect(html.match(/— <small>Not reported<\/small>/gu)).toHaveLength(3);
    expect(html).not.toContain('<td>0</td>');
  });

  it('renders provider-qualified connection and model tables without inventing brand mappings', () => {
    const html = renderToStaticMarkup(
      <UsageView
        adapter={adapter}
        projects={[project]}
        initialReport={report()}
        initialBreakdown="providers"
      />,
    );

    expect(html).toContain('Observed connections');
    expect(html).toContain('Observed models');
    expect(html).toContain('Usage by observed connection');
    expect(html).toContain('Usage by observed model');
    expect(html).toContain('OpenAI via Codex');
    expect(html).toContain('gpt-5.6');
  });

  it('keeps every resolved model separate in the primary dashboard with readable exact identities', () => {
    const base = report();
    const html = renderToStaticMarkup(
      <UsageView
        adapter={adapter}
        projects={[project]}
        initialReport={report({
          byModel: [
            {
              ...base.byModel[0]!,
              tokens: {
                ...base.byModel[0]!.tokens,
                inputTokens: 2_400,
                outputTokens: 600,
                totalTokens: 3_000,
              },
              resolvedModelId: 'gpt-5.6-sol',
            },
            {
              ...base.byModel[0]!,
              tokens: {
                ...base.byModel[0]!.tokens,
                inputTokens: 900,
                outputTokens: 450,
                totalTokens: 1_350,
              },
              connectionKey: 'hermes:anthropic',
              connectionLabel: 'Claude account',
              providerId: 'hermes',
              upstreamProviderId: 'anthropic',
              resolvedModelId: 'claude-opus-5',
            },
          ],
        })}
      />,
    );

    expect(html).toContain('Usage by model');
    expect(html).toContain('GPT 5.6 Sol');
    expect(html).toContain('gpt-5.6-sol');
    expect(html).toContain('Claude Opus 5');
    expect(html).toContain('claude-opus-5');
    expect(html).toContain('aria-label="Input: 2,400 tokens"');
    expect(html).toContain('aria-label="Output: 600 tokens"');
    expect(html).toContain('aria-label="Total: 3,000 tokens"');
    expect(html).toContain('aria-label="Input: 900 tokens"');
    expect(html).toContain('aria-label="Output: 450 tokens"');
    expect(html).toContain('aria-label="Total: 1,350 tokens"');
  });

  it('humanizes only recognized model IDs and keeps unknown provider IDs exact', () => {
    expect(usageModelDisplayName('gpt-5.6-sol')).toBe('GPT 5.6 Sol');
    expect(usageModelDisplayName('anthropic/claude-opus-5')).toBe('Claude Opus 5');
    expect(usageModelDisplayName('opaque-provider-default-2026')).toBe(
      'opaque-provider-default-2026',
    );
  });

  it('uses one existing tabpanel target for every accessible breakdown tab', () => {
    const html = renderToStaticMarkup(
      <UsageView adapter={adapter} projects={[project]} initialReport={report()} />,
    );
    const controls = [...html.matchAll(/role="tab"[^>]*aria-controls="([^"]+)"/gu)].map(
      (match) => match[1],
    );

    expect(controls).toHaveLength(3);
    expect(new Set(controls).size).toBe(1);
    expect(html).toContain(`id="${controls[0]}" role="tabpanel"`);
  });

  it('keeps facet discovery unfiltered and binds a model filter to its observed connection', () => {
    const queries = buildUsageAnalyticsQueries({
      period: 'month',
      anchorDate: '2026-08-20',
      timeZone: 'Asia/Seoul',
      projectId: PROJECT_ID,
      connectionKey: 'codex:chatgpt-account',
      modelId: 'gpt-5.6',
      workloadKind: 'lecture_generation',
      lectureOffset: 50,
      lectureSnapshotAt: '2026-08-20T04:00:00.000Z',
    });

    expect(queries.base).toEqual({
      period: 'month',
      anchorDate: '2026-08-20',
      timeZone: 'Asia/Seoul',
      lecturePage: { offset: 0, limit: 25 },
    });
    expect(queries.selected).toMatchObject({
      projectId: PROJECT_ID,
      connectionKey: 'codex:chatgpt-account',
      modelId: 'gpt-5.6',
      workloadKind: 'lecture_generation',
      lecturePage: {
        offset: 50,
        limit: 25,
        snapshotAt: '2026-08-20T04:00:00.000Z',
      },
    });
    const withoutConnection = buildUsageAnalyticsQueries({
      period: 'day',
      anchorDate: '2026-08-20',
      timeZone: 'Asia/Seoul',
      projectId: null,
      connectionKey: null,
      modelId: 'must-not-escape-unqualified',
      workloadKind: null,
      lectureOffset: 0,
      lectureSnapshotAt: null,
    });
    expect(withoutConnection.selected).not.toHaveProperty('modelId');
    expect(shouldRetainUsageReport(JSON.stringify(queries.selected), queries.selected)).toBe(true);
    expect(shouldRetainUsageReport(JSON.stringify(queries.base), queries.selected)).toBe(false);
  });
});
