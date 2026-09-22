import { useId } from 'react';
import { uiText } from '@gosu/ui/language';
import {
  rankUsageDistribution,
  splitUsageParts,
  type UsageCostState,
  type UsageDistributionMetric,
  type UsageDistributionRow,
  type UsageModelIo,
} from './usage-distribution-model';
import { formatCompactTokenCount, formatTokenCount, formatUsd } from './usage-view-model';
import './usage-distribution.css';

/** Rows shown per list before the rest is summed up in one explicit "N more" line. */
const VISIBLE_ROWS = 12;
/** Models named under a feature bar before the rest is counted. */
const VISIBLE_PARTS = 3;
/** Distinct tones; a model beyond them gets the last, neutral one. */
const TONES = 8;
const toneOf = (row: UsageDistributionRow) => Math.min(row.tone ?? TONES - 1, TONES - 1);
const shareText = (fraction: number) =>
  fraction > 0 && fraction < 0.005 ? '<1%' : `${Math.round(fraction * 100)}%`;

function costText(cost: UsageCostState) {
  if (cost.kind === 'known') return formatUsd(cost.usd);
  if (cost.kind === 'unpriced') return uiText('Price unknown');
  return cost.kind === 'no_breakdown' ? uiText('No model breakdown') : '—';
}

/**
 * Where the tokens and the money went: one ranked list per model and one per feature. Every row
 * shows both numbers; the chosen metric only decides the order, the bar and which number is
 * emphasized. Without a price list there is no cost column and no switch. Presentational: labels and
 * the metric come from the Usage view.
 */
export function UsageDistribution({
  models,
  workloads,
  metric,
  onMetric,
  modelLabel,
  workloadLabel,
}: Readonly<{
  models: readonly UsageDistributionRow[];
  workloads: readonly UsageDistributionRow[];
  metric: UsageDistributionMetric;
  onMetric: (metric: UsageDistributionMetric) => void;
  modelLabel: (modelId: string) => string;
  workloadLabel: (kind: string) => string;
}>) {
  const headingId = `usage-distribution-${useId().replaceAll(':', '')}`;
  const rows = [...models, ...workloads];
  if (!rows.some((row) => row.tokens !== null)) return null;
  const priced = rows.some((row) => row.cost !== null);
  const active: UsageDistributionMetric = priced ? metric : 'tokens';
  const split = workloads.some((row) => row.parts?.length);
  return (
    <section className="usage-distribution" aria-labelledby={headingId}>
      <header>
        <div>
          <span className="eyebrow">{uiText('BY MODEL AND FEATURE')}</span>
          <h3 id={headingId}>{uiText('Usage distribution')}</h3>
        </div>
        {priced && (
          <div className="usage-distribution-metric" role="group" aria-label={uiText('Compare by')}>
            {(['tokens', 'usd'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={active === value}
                onClick={() => onMetric(value)}
              >
                {value === 'tokens' ? uiText('Tokens') : uiText('API-equivalent')}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="usage-distribution-grid">
        <UsageDistributionList
          title={uiText('Models')}
          rows={models}
          metric={active}
          priced={priced}
          label={(row) => modelLabel(row.id)}
          swatches={split}
          partLabel={modelLabel}
        />
        <UsageDistributionList
          title={uiText('Features')}
          rows={workloads}
          metric={active}
          priced={priced}
          label={(row) => workloadLabel(row.id)}
          swatches={false}
          partLabel={modelLabel}
        />
      </div>
      {split && (
        <p className="usage-distribution-note">
          {uiText(
            'Each feature’s bar is split by the models that ran it; the colors are those of the model list.',
          )}
        </p>
      )}
      {priced && (
        <p className="usage-distribution-note">
          {uiText(
            'A feature’s amount is the sum over the models that ran it. Estimate at standard API prices · not a bill.',
          )}
        </p>
      )}
    </section>
  );
}

function UsageDistributionList({
  title,
  rows,
  metric,
  priced,
  label,
  swatches,
  partLabel,
}: Readonly<{
  title: string;
  rows: readonly UsageDistributionRow[];
  metric: UsageDistributionMetric;
  priced: boolean;
  label: (row: UsageDistributionRow) => string;
  /** The model list doubles as the legend of the feature bars. */
  swatches: boolean;
  partLabel: (modelId: string) => string;
}>) {
  const titleId = `usage-distribution-list-${useId().replaceAll(':', '')}`;
  const ranked = rankUsageDistribution(rows, metric);
  if (!ranked.length) return null;
  const shown = ranked.slice(0, VISIBLE_ROWS);
  return (
    <div className="usage-distribution-list">
      <h4 id={titleId}>
        {title}
        {ranked.some((row) => row.io) && (
          <span className="usage-distribution-io-legend" aria-hidden="true">
            <i data-io="input" />
            {uiText('Input')}
            <i data-io="output" />
            {uiText('Output')}
          </span>
        )}
      </h4>
      <ol aria-labelledby={titleId}>
        {shown.map((row) => {
          const name = label(row);
          const excluded = row.cost?.kind === 'known' ? row.cost.excludedModelIds.length : 0;
          return (
            <li key={row.key} data-unknown={row.value === null ? '' : undefined}>
              <div className="usage-distribution-row">
                <span
                  className="usage-distribution-name"
                  title={[name, row.id !== name ? row.id : null, row.connectionLabel]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  {swatches && (
                    <i
                      className="usage-distribution-swatch"
                      data-tone={toneOf(row)}
                      aria-hidden="true"
                    />
                  )}
                  {name}
                  {row.connectionLabel && <small> · {row.connectionLabel}</small>}
                </span>
                <span
                  className="usage-distribution-value"
                  data-active={metric === 'tokens' ? '' : undefined}
                >
                  <span aria-hidden="true">{formatCompactTokenCount(row.tokens)}</span>
                  <span className="sr-only">
                    {row.tokens === null
                      ? uiText('Not reported')
                      : uiText('{tokens} tokens', { tokens: formatTokenCount(row.tokens) })}
                  </span>
                </span>
                {priced && row.cost && (
                  <span
                    className="usage-distribution-value cost"
                    data-active={metric === 'usd' ? '' : undefined}
                    data-state={row.cost.kind}
                    title={
                      row.pricedAs ? uiText('Priced as {key}', { key: row.pricedAs }) : undefined
                    }
                  >
                    <span aria-hidden="true">{costText(row.cost)}</span>
                    <span className="sr-only">
                      {uiText('API-equivalent {cost}', { cost: costText(row.cost) })}
                    </span>
                  </span>
                )}
              </div>
              <UsageDistributionBar row={row} metric={metric} partLabel={partLabel} />
              {excluded > 0 && (
                <small className="usage-distribution-excluded">
                  {uiText('{count} models without a price are left out', { count: excluded })}
                </small>
              )}
            </li>
          );
        })}
      </ol>
      {ranked.length > shown.length && (
        <p className="usage-distribution-more">
          {uiText('{count} more', { count: ranked.length - shown.length })}
        </p>
      )}
    </div>
  );
}

/**
 * One row's bar. A feature with a model breakdown gets one segment per model, in the model's tone,
 * and the models are named under it with their share, so the colors never have to be decoded. The
 * bar is hidden from assistive technology; the same facts follow as text.
 */
function UsageDistributionBar({
  row,
  metric,
  partLabel,
}: Readonly<{
  row: UsageDistributionRow & { share: number };
  metric: UsageDistributionMetric;
  partLabel: (modelId: string) => string;
}>) {
  const parts = row.parts?.length ? splitUsageParts(row.parts, metric) : [];
  if (row.io) return <UsageModelIoBar row={row} io={row.io} metric={metric} />;
  if (!parts.length)
    return (
      <span className="usage-distribution-bar" aria-hidden="true">
        <i style={{ width: `${row.share}%` }} />
      </span>
    );
  const text = (part: (typeof parts)[number]) =>
    part.fraction !== null
      ? shareText(part.fraction)
      : metric === 'usd' && part.cost
        ? costText(part.cost)
        : '—';
  const name = (part: (typeof parts)[number]) =>
    `${partLabel(part.id)}${part.connectionLabel ? ` · ${part.connectionLabel}` : ''}`;
  const detail = (part: (typeof parts)[number]) =>
    [
      name(part),
      part.tokens === null
        ? uiText('Not reported')
        : uiText('{tokens} tokens', { tokens: formatTokenCount(part.tokens) }),
      part.cost ? costText(part.cost) : null,
      part.fraction !== null ? shareText(part.fraction) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  const shown = parts.slice(0, VISIBLE_PARTS);
  return (
    <>
      <span className="usage-distribution-bar" data-split="" aria-hidden="true">
        <span style={{ width: `${row.share}%` }}>
          {parts.map((part) =>
            part.fraction ? (
              <i
                key={part.key}
                className="usage-distribution-segment"
                data-tone={toneOf(part)}
                style={{ width: `${part.fraction * 100}%` }}
                title={detail(part)}
              />
            ) : null,
          )}
        </span>
      </span>
      <span className="usage-distribution-parts" aria-hidden="true">
        {shown.map((part) => (
          <span key={part.key} title={detail(part)}>
            <i className="usage-distribution-swatch" data-tone={toneOf(part)} />
            <span className="usage-distribution-part-name">{name(part)}</span> {text(part)}
          </span>
        ))}
        {parts.length > shown.length && (
          <span>{uiText('{count} more', { count: parts.length - shown.length })}</span>
        )}
      </span>
      <span className="sr-only">
        {uiText('Models: {models}', {
          models: parts.map((part) => `${name(part)} ${text(part)}`).join(', '),
        })}
      </span>
    </>
  );
}

/**
 * A model's bar, split into input and output by the chosen metric, with the numbers under it. It
 * replaces the separate model cards: input, output, cache reads and calls are all here. Money is
 * split only when the model has a price; the token numbers are always said.
 */
function UsageModelIoBar({
  row,
  io,
  metric,
}: Readonly<{
  row: UsageDistributionRow & { share: number };
  io: UsageModelIo;
  metric: UsageDistributionMetric;
}>) {
  const money = metric === 'usd' && io.inputUsd !== null && io.outputUsd !== null;
  const input = money ? io.inputUsd! : io.inputTokens,
    output = money ? io.outputUsd! : io.outputTokens;
  const total = input + output;
  // By cost, a model without a price has no bar at all (the row says "Price unknown").
  const drawn = metric === 'tokens' || money;
  const figure = (label: string, exact: string, compact: string, side?: 'input' | 'output') => (
    <span>
      {side && <i className="usage-distribution-io-swatch" data-io={side} aria-hidden="true" />}
      <span aria-hidden="true">{`${label} ${compact}`}</span>
      <span className="sr-only">{`${label}: ${exact}`}</span>
    </span>
  );
  const tokens = (value: number) => uiText('{tokens} tokens', { tokens: formatTokenCount(value) });
  return (
    <>
      <span className="usage-distribution-bar" data-split="" aria-hidden="true">
        <span style={{ width: `${drawn ? row.share : 0}%` }}>
          {drawn &&
            total > 0 &&
            (['input', 'output'] as const).map((side) => {
              const value = side === 'input' ? input : output;
              return value > 0 ? (
                <i
                  key={side}
                  className="usage-distribution-io-segment"
                  data-io={side}
                  style={{ width: `${(value / total) * 100}%` }}
                />
              ) : null;
            })}
        </span>
      </span>
      <span className="usage-distribution-io">
        {money
          ? figure(uiText('Input'), formatUsd(io.inputUsd!), formatUsd(io.inputUsd!), 'input')
          : figure(
              uiText('Input'),
              tokens(io.inputTokens),
              formatCompactTokenCount(io.inputTokens),
              'input',
            )}
        {money
          ? figure(uiText('Output'), formatUsd(io.outputUsd!), formatUsd(io.outputUsd!), 'output')
          : figure(
              uiText('Output'),
              tokens(io.outputTokens),
              formatCompactTokenCount(io.outputTokens),
              'output',
            )}
        {io.cachedReadTokens !== null &&
          io.cachedReadTokens > 0 &&
          figure(
            uiText('Cached read'),
            tokens(io.cachedReadTokens),
            formatCompactTokenCount(io.cachedReadTokens),
          )}
        <span>{uiText('{count} calls', { count: row.turnCount.toLocaleString() })}</span>
      </span>
    </>
  );
}
