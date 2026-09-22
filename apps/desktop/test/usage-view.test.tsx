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
it('shows assistant workload and per-project resolved model usage in the same report', () => {
  expect(usageModelDisplayName('gpt-6-astra')).toBe('GPT 6 Astra');
  const data = report();
  data.byWorkload.push({ ...data.totals, workloadKind: 'briefing_assistant' });
  data.byProjectModel = data.byModel.map((r) => ({
    ...r,
    projectId: PROJECT_ID,
    projectName: 'Token Research',
  }));
  const html = renderToStaticMarkup(
    <UsageView
      adapter={{ query: async () => data }}
      projects={[project]}
      initialReport={data}
      initialBreakdown="projects"
    />,
  );
  expect(html).toContain('AI 비서');
  expect(html).toContain('프로젝트 내 모델별 사용량');
  expect(html).toContain('gpt-5.6');
  expect(html).toContain('과거 미수집');
});

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
  it('shows what each feature cost, from the models that ran it, and compares models and features by cost first', () => {
    // 2026-09-21: "기능별로 얼마나 썼는지 token 사용량과 함께 돈으로 보여줘 … model 별, 기능별 … 시각화도".
    const data = report();
    const base = data.byModel[0]!;
    // 1,200 input + 300 output per part: one reported turn and one without reported tokens.
    const part = (workloadKind: 'briefing_summary' | 'project_chat', resolvedModelId: string) => ({
      ...base,
      resolvedModelId,
      workloadKind,
    });
    const parts = [
      part('briefing_summary', 'gpt-5.6-luna'),
      part('project_chat', 'gpt-6-astra'),
      part('project_chat', 'gpt-5.3-codex-spark'),
    ];
    const twice = { ...base, turnCount: 4, exactTurnCount: 2, unavailableTurnCount: 2 };
    data.totals = {
      ...base,
      tokens: { ...base.tokens, inputTokens: 3600, outputTokens: 900, totalTokens: 4500 },
      // The parts cover every turn of the report; otherwise they would not be used at all.
      turnCount: 6,
      exactTurnCount: 3,
      unavailableTurnCount: 3,
    };
    data.byModel = parts.map(({ workloadKind: _kind, ...model }) => model);
    data.byWorkload = [
      { ...base, workloadKind: 'briefing_summary' },
      {
        ...twice,
        tokens: { ...base.tokens, inputTokens: 2400, outputTokens: 600, totalTokens: 3000 },
        workloadKind: 'project_chat',
      },
    ].map(
      ({
        connectionKey: _c,
        connectionLabel: _l,
        providerId: _p,
        upstreamProviderId: _u,
        resolvedModelId: _m,
        ...row
      }) => row,
    ) as typeof data.byWorkload;
    data.byWorkloadModel = parts;
    const price = (input: number, output: number) => ({
      inputPerToken: input,
      outputPerToken: output,
      cacheReadPerToken: null,
      cacheWritePerToken: null,
      reasoningOutputPerToken: null,
    });
    const priceStatus = {
      catalog: {
        version: 1 as const,
        sourceUrl: 'https://example.test/prices.json',
        fetchedAt: '2026-09-21T10:40:00.000Z',
        etag: null,
        models: { 'gpt-5.6-luna': price(2e-7, 1.2e-6), 'gpt-6-astra': price(1e-5, 5e-5) },
      },
      lastAttemptAt: '2026-09-21T10:40:00.000Z',
      lastError: null,
    };
    const html = renderToStaticMarkup(
      <UsageView
        adapter={{ query: async () => data }}
        projects={[]}
        initialReport={data}
        initialPriceStatus={priceStatus}
      />,
    );
    // Luna 1200*0.2/M + 300*1.2/M = $0.0006; Astra 1200*10/M + 300*50/M = $0.027.
    const section = html.slice(
      html.indexOf('class="usage-distribution"'),
      html.indexOf('aria-label="Usage by feature"'),
    );
    expect(section).toContain('Usage distribution');
    // Cost is the default comparison: the pressed button, and the expensive feature first.
    expect(section).toMatch(
      /aria-pressed="false">Tokens<\/button><button type="button" aria-pressed="true">API-equivalent/u,
    );
    expect(section.indexOf('Project Chat')).toBeLessThan(section.indexOf('브리핑·요약'));
    expect(section).toContain('$0.027');
    expect(section).toContain('$0.0006');
    expect(section).toContain('1 models without a price are left out');
    // The feature table carries the same amounts, with a "+" where a model had no price.
    const table = html.slice(html.indexOf('aria-label="Usage by feature"'));
    expect(table).toContain('<th scope="col">API-equivalent</th>');
    expect(table).toContain('<th scope="col">Total</th>');
    expect(table).toMatch(/<td title="1 models without a price are left out">\$0\.027\+<\/td>/u);
    expect(table).toContain('<td>$0.0006</td>');
    // One source: the summary card is the sum of the features.
    expect(html).toContain('$0.0276');
    // The switch is a pair of buttons: the page still has exactly its three breakdown tabs.
    expect(html.match(/role="tab"/gu)).toHaveLength(5);
    // The token metric can be asked for; without a price list no amount, column or switch exists.
    const tokens = renderToStaticMarkup(
      <UsageView
        adapter={{ query: async () => data }}
        projects={[]}
        initialReport={data}
        initialPriceStatus={priceStatus}
        initialDistributionMetric="tokens"
      />,
    );
    expect(tokens).toMatch(/aria-pressed="true">Tokens/u);
    const plain = renderToStaticMarkup(
      <UsageView adapter={{ query: async () => data }} projects={[]} initialReport={data} />,
    );
    expect(plain).toContain('Usage distribution');
    expect(plain).not.toContain('aria-pressed="true">API-equivalent');
    expect(plain).not.toContain('API-equivalent');
    expect(plain).not.toContain('$');
  });

  it('shows what the tokens would have cost on an API key, and never guesses a missing price', () => {
    // 1,200 input + 300 output per model row (one reported turn each).
    const data = report();
    const base = data.byModel[0]!;
    data.byModel = [
      { ...base, resolvedModelId: 'gpt-5.6-luna' },
      {
        ...base,
        connectionKey: 'claude-code:account',
        providerId: 'claude-code',
        resolvedModelId: 'claude-code:opus-5',
      },
      { ...base, resolvedModelId: 'gpt-5.3-codex-spark' },
    ];
    const price = (input: number, output: number) => ({
      inputPerToken: input,
      outputPerToken: output,
      cacheReadPerToken: null,
      cacheWritePerToken: null,
      reasoningOutputPerToken: null,
    });
    const html = renderToStaticMarkup(
      <UsageView
        adapter={{ query: async () => data }}
        projects={[]}
        initialReport={data}
        initialPriceStatus={{
          catalog: {
            version: 1,
            sourceUrl: 'https://example.test/prices.json',
            fetchedAt: '2026-09-21T10:40:00.000Z',
            etag: null,
            models: {
              'gpt-5.6-luna': price(2e-7, 1.2e-6),
              'claude-opus-5': price(5e-6, 2.5e-5),
            },
          },
          lastAttemptAt: '2026-09-21T10:40:00.000Z',
          lastError: 'model_prices_network',
        }}
      />,
    );
    // Luna: 1200*0.2/M + 300*1.2/M = $0.0006; Opus 5: 1200*5/M + 300*25/M = $0.0135.
    expect(html).toContain('API-equivalent cost');
    expect(html).toContain('$0.0141');
    expect(html).toContain('1 models without a price are left out');
    expect(html).toContain('$0.0006');
    expect(html).toContain('$0.0135');
    expect(html).toContain('title="Priced as claude-opus-5"');
    expect(html).toContain('Price unknown');
    expect(html).toContain('LiteLLM model_prices_and_context_window.json');
    expect(html).toContain('model_prices_network');
    // Without a price list the view is the token report it was.
    const plain = renderToStaticMarkup(
      <UsageView adapter={{ query: async () => data }} projects={[]} initialReport={data} />,
    );
    expect(plain).not.toContain('API-equivalent');
    expect(plain).not.toContain('usage-price-note');
  });

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
    // The bars carry no hatch: nearly every day has one unreported turn, so the mark said nothing.
    // The caveat stays in words under the chart, in each bar's label and in the table's coverage.
    expect(html).not.toContain('usage-chart-lower-bound');
    expect(html).not.toContain('Hatched bars');
    expect(html).toContain(
      'Known totals exclude turns whose provider did not report token counts.',
    );
    expect(html).toContain('Displayed values are a known lower bound');
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
    expect(html.match(/— <small>Not reported<\/small>/gu)).toHaveLength(4);
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

    // 2026-09-22: the separate model cards are gone; the model list of the distribution carries
    // each model's name, raw id, input, output and total.
    expect(html).not.toContain('Usage by model');
    expect(html).not.toContain('usage-model-card');
    expect(html).toContain('GPT 5.6 Sol');
    expect(html).toContain('gpt-5.6-sol');
    expect(html).toContain('Claude Opus 5');
    expect(html).toContain('claude-opus-5');
    expect(html).toContain('Input: 2,400 tokens');
    expect(html).toContain('Output: 600 tokens');
    expect(html).toContain('3,000 tokens');
    expect(html).toContain('Input: 900 tokens');
    expect(html).toContain('Output: 450 tokens');
    expect(html).toContain('1,350 tokens');
  });

  it('humanizes only recognized model IDs and keeps unknown provider IDs exact', () => {
    expect(usageModelDisplayName('gpt-5.6-sol')).toBe('GPT 5.6 Sol');
    expect(usageModelDisplayName('anthropic/claude-opus-5')).toBe('Claude Opus 5');
    expect(usageModelDisplayName('opaque-provider-default-2026')).toBe(
      'opaque-provider-default-2026',
    );
  });

  // 2026-09-22 user request: "사용량 설정 제일 밑에 Briefing 이랑 논문 요약 tab 넣자. 그걸 제일 많이 쓰잖아?"
  it('opens on a Briefing tab and offers a paper summaries tab, each by day and model with its cost', () => {
    const base = report();
    const day = (
      bucketKey: string,
      workloadKind: 'briefing_summary' | 'paper_summary',
      resolvedModelId: string,
      inputTokens: number,
      outputTokens: number,
    ) => ({
      ...base.byModel[0]!,
      bucketKey,
      workloadKind,
      resolvedModelId,
      tokens: {
        ...base.byModel[0]!.tokens,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cachedReadTokens: 0,
      },
      turnCount: 2,
      exactTurnCount: 2,
      partialTurnCount: 0,
      unavailableTurnCount: 0,
    });
    const data = {
      ...base,
      byDayWorkloadModel: [
        day('2026-08-20', 'briefing_summary', 'gpt-5.6-luna', 1_000_000, 100_000),
        day('2026-08-19', 'briefing_summary', 'gpt-5.6-luna', 500_000, 50_000),
        day('2026-08-20', 'paper_summary', 'claude-opus-5', 200_000, 20_000),
      ],
    };
    const price = (input: number, output: number) => ({
      inputPerToken: input,
      outputPerToken: output,
      cacheReadPerToken: null,
      cacheWritePerToken: null,
      reasoningOutputPerToken: null,
    });
    const priceStatus = {
      catalog: {
        version: 1 as const,
        sourceUrl: 'https://example.test/prices.json',
        fetchedAt: '2026-09-21T10:40:00.000Z',
        etag: null,
        models: { 'gpt-5.6-luna': price(2e-7, 1.2e-6), 'claude-opus-5': price(5e-6, 2.5e-5) },
      },
      lastAttemptAt: '2026-09-21T10:40:00.000Z',
      lastError: null,
    };
    const render = (initialBreakdown?: 'briefing' | 'papers') =>
      renderToStaticMarkup(
        <UsageView
          adapter={{ query: async () => data }}
          projects={[]}
          initialReport={data}
          initialPriceStatus={priceStatus}
          {...(initialBreakdown ? { initialBreakdown } : {})}
        />,
      );
    const tabs = (html: string) =>
      [...html.matchAll(/role="tab" aria-selected="(true|false)"[^>]*>([^<]+)</gu)].map((match) => [
        match[2],
        match[1],
      ]);
    // The two most used features come first, and Briefing is what the screen opens on.
    expect(tabs(render())).toEqual([
      ['Briefing', 'true'],
      ['Paper summaries', 'false'],
      ['Projects', 'false'],
      ['Lecture generations', 'false'],
      ['Providers &amp; models', 'false'],
    ]);
    const briefing = render().slice(render().indexOf('aria-label="Briefing usage by day"'));
    expect(briefing.indexOf('2026-08-20')).toBeLessThan(briefing.indexOf('2026-08-19'));
    expect(briefing).toContain('GPT 5.6 Luna');
    expect(briefing).toContain('1,000,000');
    // 1,000,000 * 0.2/M + 100,000 * 1.2/M = $0.32
    expect(briefing).toContain('$0.32');
    expect(briefing).not.toContain('Claude Opus 5');
    const papers = render('papers');
    const table = papers.slice(papers.indexOf('aria-label="Paper summary usage by day"'));
    expect(table).toContain('Claude Opus 5');
    // 200,000 * 5/M + 20,000 * 25/M = $1.50
    expect(table).toContain('$1.50');
    // Without rows a tab says why instead of showing an empty table.
    const empty = renderToStaticMarkup(
      <UsageView
        adapter={{ query: async () => base }}
        projects={[]}
        initialReport={{ ...base, byDayWorkloadModel: [] }}
        initialBreakdown="papers"
      />,
    );
    expect(empty).toContain('No paper summary usage was recorded in this range');
    expect(empty).toContain('Paper summaries are counted apart from briefings since 0.58.140');
  });

  it('uses one existing tabpanel target for every accessible breakdown tab', () => {
    const html = renderToStaticMarkup(
      <UsageView adapter={adapter} projects={[project]} initialReport={report()} />,
    );
    const controls = [...html.matchAll(/role="tab"[^>]*aria-controls="([^"]+)"/gu)].map(
      (match) => match[1],
    );

    expect(controls).toHaveLength(5);
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
