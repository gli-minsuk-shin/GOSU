import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setUiLanguage } from '@gosu/ui/language';
import { UsageDistribution } from '../src/renderer/src/usage-distribution';
import type {
  UsageCostState,
  UsageDistributionRow,
} from '../src/renderer/src/usage-distribution-model';

const row = (
  id: string,
  tokens: number | null,
  cost: UsageCostState | null,
  connectionLabel: string | null = null,
): UsageDistributionRow => ({
  key: `${id}|${connectionLabel}`,
  id,
  connectionLabel,
  turnCount: 3,
  tokens,
  cost,
});
const known = (usd: number, excluded: string[] = []): UsageCostState => ({
  kind: 'known',
  usd,
  excludedModelIds: excluded,
});
const MODELS = [
  row('gpt-5.6-luna', 9_999_000, known(1.29)),
  row('gpt-6-astra', 916_000, known(8.5)),
  row('gpt-5.3-codex-spark', 19_200, { kind: 'unpriced', modelIds: ['gpt-5.3-codex-spark'] }),
];
const FEATURES = [
  row('briefing_summary', 9_810_000, known(1.24)),
  row('project_chat', 590_000, known(3.87, ['gpt-5.3-codex-spark'])),
  row('lecture_generation', null, { kind: 'unreported' }),
];
const labels = {
  modelLabel: (id: string) => id.toUpperCase(),
  workloadLabel: (kind: string) => `feature:${kind}`,
};
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  setUiLanguage('en');
  vi.unstubAllGlobals();
});

describe('usage distribution lists', () => {
  it('shows tokens and money on every row, ordered by the chosen metric, unknown amounts last', () => {
    const html = renderToStaticMarkup(
      <UsageDistribution
        models={MODELS}
        workloads={FEATURES}
        metric="usd"
        onMetric={vi.fn()}
        {...labels}
      />,
    );
    // By cost the expensive model leads although the cheap one used ten times the tokens.
    expect(html.indexOf('GPT-6-ASTRA')).toBeLessThan(html.indexOf('GPT-5.6-LUNA'));
    expect(html.indexOf('GPT-5.6-LUNA')).toBeLessThan(html.indexOf('GPT-5.3-CODEX-SPARK'));
    expect(html).toContain('$8.50');
    expect(html).toContain('916,000 tokens');
    // Unknown is said, never drawn as zero: a dashed track and the reason.
    expect(html).toContain('Price unknown');
    expect(html).toMatch(/<li data-unknown="">.*GPT-5\.3-CODEX-SPARK/su);
    expect(html).toContain('width:0%');
    // A feature priced only in part says what was left out.
    expect(html).toContain('1 models without a price are left out');
    expect(html).toContain('A feature’s amount is the sum over the models that ran it.');
    // By tokens the order flips; both numbers stay on the row.
    const byTokens = renderToStaticMarkup(
      <UsageDistribution
        models={MODELS}
        workloads={FEATURES}
        metric="tokens"
        onMetric={vi.fn()}
        {...labels}
      />,
    );
    expect(byTokens.indexOf('GPT-5.6-LUNA')).toBeLessThan(byTokens.indexOf('GPT-6-ASTRA'));
    expect(byTokens).toContain('$1.29');
  });

  it('has no cost column and no switch without a price list, and is absent without reported tokens', () => {
    const plain = (rows: UsageDistributionRow[]) => rows.map((r) => ({ ...r, cost: null }));
    const html = renderToStaticMarkup(
      <UsageDistribution
        models={plain(MODELS)}
        workloads={plain(FEATURES)}
        metric="usd"
        onMetric={vi.fn()}
        {...labels}
      />,
    );
    expect(html).toContain('GPT-5.6-LUNA');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('API-equivalent');
    expect(html).not.toContain('$');
    // Ranked by tokens although the caller asked for cost.
    expect(html.indexOf('GPT-5.6-LUNA')).toBeLessThan(html.indexOf('GPT-6-ASTRA'));
    expect(
      renderToStaticMarkup(
        <UsageDistribution
          models={[row('m', null, null)]}
          workloads={[]}
          metric="usd"
          onMetric={vi.fn()}
          {...labels}
        />,
      ),
    ).toBe('');
  });

  it('switches the metric with two pressed-state buttons, not tabs, and labels the lists for a screen reader', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onMetric = vi.fn();
    await act(() => {
      renderer = create(
        <UsageDistribution
          models={MODELS}
          workloads={FEATURES}
          metric="usd"
          onMetric={onMetric}
          {...labels}
        />,
      );
    });
    const buttons = renderer!.root.findAllByType('button');
    expect(buttons.map((b) => [b.props.children, b.props['aria-pressed']])).toEqual([
      ['Tokens', false],
      ['API-equivalent', true],
    ]);
    await act(() => buttons[0]!.props.onClick());
    expect(onMetric).toHaveBeenCalledWith('tokens');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('"role":"tab"');
    const section = renderer!.root.findByType('section');
    expect(renderer!.root.findByProps({ id: section.props['aria-labelledby'] }).type).toBe('h3');
    for (const list of renderer!.root.findAllByType('ol'))
      expect(renderer!.root.findByProps({ id: list.props['aria-labelledby'] }).type).toBe('h4');
    // The bar only compares; its value is in the text, so it is hidden from assistive technology.
    for (const bar of renderer!.root.findAllByProps({ className: 'usage-distribution-bar' }))
      expect(bar.props['aria-hidden']).toBe('true');
  });

  it('names the connection beside a model, keeps a long id readable, and caps a long list explicitly', () => {
    const long = 'vendor/experimental-' + 'x'.repeat(200);
    const many = Array.from({ length: 15 }, (_, index) =>
      row(`model-${index}`, 1000 - index, known(1)),
    );
    const html = renderToStaticMarkup(
      <UsageDistribution
        models={[row(long, 5_000, known(2), 'ChatGPT'), ...many]}
        workloads={[]}
        metric="tokens"
        onMetric={vi.fn()}
        modelLabel={(id) => id}
        workloadLabel={(kind) => kind}
      />,
    );
    expect(html).toContain('<small> · ChatGPT</small>');
    expect(html).toContain(`title="${long} · ChatGPT"`);
    // 16 rows: twelve shown, the rest counted, never silently dropped.
    expect(html.match(/<li/gu)).toHaveLength(12);
    expect(html).toContain('4 more');
    // A list without rows is not drawn as an empty heading.
    expect(html).not.toContain('Features');
  });

  it('reads in Korean', () => {
    setUiLanguage('ko');
    const html = renderToStaticMarkup(
      <UsageDistribution
        models={MODELS}
        workloads={FEATURES}
        metric="usd"
        onMetric={vi.fn()}
        {...labels}
      />,
    );
    for (const text of [
      '사용 분포',
      '모델별 · 기능별',
      '토큰',
      'API 환산',
      '가격 미확인',
      '기능의 금액은',
    ])
      expect(html).toContain(text);
  });
  // 2026-09-21 user request: which models ran each feature, as a stacked bar under the feature.
  it('splits each feature bar by model, in the model list’s tones, and names the models under it', () => {
    const toned = MODELS.map((model, tone) => ({ ...model, tone }));
    const part = (index: number, tokens: number | null, cost: UsageCostState | null) => ({
      ...toned[index]!,
      tokens,
      cost,
    });
    const features: UsageDistributionRow[] = [
      {
        ...FEATURES[0]!,
        parts: [part(0, 9_000_000, known(1.0)), part(1, 810_000, known(0.24))],
      },
      {
        ...FEATURES[1]!,
        parts: [
          part(1, 570_800, known(3.87)),
          part(2, 19_200, { kind: 'unpriced', modelIds: ['gpt-5.3-codex-spark'] }),
        ],
      },
      { ...FEATURES[2]!, parts: null },
    ];
    const render = (metric: 'tokens' | 'usd') =>
      renderToStaticMarkup(
        <UsageDistribution
          models={toned}
          workloads={features}
          metric={metric}
          onMetric={vi.fn()}
          {...labels}
        />,
      );
    const byCost = render('usd');
    // The model list is the legend: one swatch per model, in its tone.
    expect(byCost.match(/usage-distribution-swatch/gu)).toHaveLength(
      toned.length + 2 + 2, // the model rows, and the models named under two features
    );
    // Briefing: $1.00 + $0.24 -> 81% and 19% of the bar.
    expect(byCost).toMatch(
      /usage-distribution-segment" data-tone="0" style="width:80\.6\d*%"[^>]*title="GPT-5\.6-LUNA · 9,000,000 tokens · \$1\.00 · 81%"/u,
    );
    expect(byCost).toContain('GPT-5.6-LUNA</span> 81%');
    expect(byCost).toContain('GPT-6-ASTRA</span> 19%');
    // Project Chat by cost: the unpriced model has no segment and says why instead of a share.
    expect(byCost).toMatch(/GPT-5\.3-CODEX-SPARK<\/span> Price unknown/u);
    expect(byCost.match(/usage-distribution-segment"/gu)).toHaveLength(3);
    // By tokens the same model gets its share, and a segment.
    const byTokens = render('tokens');
    expect(byTokens).toContain('GPT-5.3-CODEX-SPARK</span> 3%');
    expect(byTokens.match(/usage-distribution-segment"/gu)).toHaveLength(4);
    // A feature without a breakdown keeps its plain bar; rows are still one list item each.
    expect(byCost.match(/<li/gu)).toHaveLength(toned.length + features.length);
    // Said in words for a screen reader, since the bar is hidden from it.
    expect(byCost).toContain('Models: GPT-5.6-LUNA 81%, GPT-6-ASTRA 19%');
    expect(byCost).toContain('Each feature’s bar is split by the models that ran it');
    setUiLanguage('ko');
    expect(render('usd')).toContain('기능의 막대는 그 기능을 실행한 모델별로 나뉩니다');
  });
  // 2026-09-22 user request: no separate model cards; the model list shows input and output apart.
  it('splits each model bar into input and output, by the chosen metric, and says the numbers', () => {
    const models: UsageDistributionRow[] = [
      {
        ...MODELS[0]!,
        tone: 0,
        turnCount: 310,
        pricedAs: 'gpt-5.6-luna',
        io: {
          inputTokens: 9_000_000,
          outputTokens: 999_000,
          cachedReadTokens: 7_400_000,
          inputUsd: 0.9,
          outputUsd: 0.39,
        },
      },
      {
        ...MODELS[2]!,
        tone: 1,
        io: {
          inputTokens: 18_000,
          outputTokens: 1_200,
          cachedReadTokens: null,
          inputUsd: null,
          outputUsd: null,
        },
      },
      { ...row('silent-model', null, { kind: 'unreported' }), tone: 2, io: null },
    ];
    const render = (metric: 'tokens' | 'usd') =>
      renderToStaticMarkup(
        <UsageDistribution
          models={models}
          workloads={[]}
          metric={metric}
          onMetric={vi.fn()}
          {...labels}
        />,
      );
    const byTokens = render('tokens');
    // 9,000,000 of 9,999,000 tokens are input.
    expect(byTokens).toMatch(
      /usage-distribution-io-segment" data-io="input" style="width:90\.0\d*%"/u,
    );
    expect(byTokens).toMatch(
      /usage-distribution-io-segment" data-io="output" style="width:9\.9\d*%"/u,
    );
    // Exact numbers for a screen reader, compact ones for the eye; cache reads and calls are kept.
    expect(byTokens).toContain('Input: 9,000,000 tokens');
    expect(byTokens).toContain('Output: 999,000 tokens');
    expect(byTokens).toContain('Cached read: 7,400,000 tokens');
    expect(byTokens).toContain('310 calls');
    // A legend says which color is which, once per list.
    expect(byTokens.match(/usage-distribution-io-legend/gu)).toHaveLength(1);
    // By cost the split is of money; the priced-as entry is the amount's tooltip.
    const byCost = render('usd');
    expect(byCost).toMatch(/data-io="input" style="width:69\.7\d*%"/u);
    expect(byCost).toContain('Input: $0.90');
    expect(byCost).toContain('Output: $0.39');
    expect(byCost).toContain('title="Priced as gpt-5.6-luna"');
    // A model without a price still shows its token split in words, and no money bar.
    expect(byCost).toContain('Input: 18,000 tokens');
    // A model that reported nothing has nothing to split.
    expect(byTokens.match(/usage-distribution-io"/gu)).toHaveLength(2);
  });
});
