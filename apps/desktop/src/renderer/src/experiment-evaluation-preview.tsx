import type { ExperimentEvaluationPreview as EvaluationPreview } from '../../shared/experiment-evaluation-contracts';
import { MarkdownDocument } from './markdown-document';
import {
  buildEvaluationPreviewChart,
  previewSeriesPath,
} from './experiment-evaluation-preview-model';

const SERIES_MARKERS = ['circle', 'square', 'triangle', 'diamond', 'cross', 'ring'] as const;

function formatValue(value: number, unit: string | null) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 5 }).format(value)}${unit ? ` ${unit}` : ''}`;
}

export function ExperimentEvaluationPreview({ preview }: { preview: EvaluationPreview }) {
  const chart = buildEvaluationPreviewChart(preview);
  return (
    <section className="evaluation-preview" aria-label="Illustrative evaluation preview">
      <div className="evaluation-preview-warning" role="status">
        <strong>Illustrative preview · not experiment evidence</strong>
        <span>{preview.notice}</span>
      </div>

      {preview.numbers.length > 0 && (
        <div className="evaluation-preview-kpis">
          {preview.numbers.map((number) => (
            <article key={number.label}>
              <span>{number.label}</span>
              <strong>{formatValue(number.value, number.unit)}</strong>
            </article>
          ))}
        </div>
      )}

      {chart && !chart.sparse && (
        <figure className="evaluation-preview-chart">
          <figcaption>
            <strong>{chart.title}</strong>
            <span>
              {chart.subtitle}
              {chart.truncated ? ` · Last 12 points per series (${chart.totalPoints} total)` : ''}
            </span>
          </figcaption>
          <svg
            viewBox="0 0 780 275"
            role="img"
            aria-labelledby="evaluation-chart-title evaluation-chart-desc"
          >
            <title id="evaluation-chart-title">{chart.title}</title>
            <desc id="evaluation-chart-desc">
              {chart.subtitle}. Synthetic preview only. Series use distinct line and marker styles.
            </desc>
            {[0, 1, 2, 3, 4].map((tick) => {
              const y = 24 + tick * 52;
              const value = chart.yMaximum - ((chart.yMaximum - chart.yMinimum) * tick) / 4;
              return (
                <g key={tick}>
                  <line x1="54" x2="742" y1={y} y2={y} className="evaluation-preview-grid" />
                  <text x="47" y={y + 4} textAnchor="end">
                    {Number(value.toPrecision(4))}
                  </text>
                </g>
              );
            })}
            <text x="398" y="268" textAnchor="middle">
              {chart.xLabel}
            </text>
            <text transform="translate(13 130) rotate(-90)" textAnchor="middle">
              {chart.yLabel}
            </text>
            {chart.series.map((series, seriesIndex) => (
              <g
                key={series.name}
                className={`evaluation-preview-series series-${seriesIndex % 6}`}
              >
                {chart.kind === 'line' && (
                  <path d={previewSeriesPath(series.points)} className="evaluation-preview-line" />
                )}
                {series.points.map((point, pointIndex) => (
                  <PreviewMarker
                    key={`${point.x}:${point.y}:${pointIndex}`}
                    kind={SERIES_MARKERS[seriesIndex % SERIES_MARKERS.length]!}
                    x={point.cx}
                    y={point.cy}
                    bar={chart.kind === 'bar'}
                  />
                ))}
              </g>
            ))}
          </svg>
          <ul className="evaluation-preview-legend">
            {chart.series.map((series, index) => (
              <li key={series.name} className={`series-${index % 6}`}>
                <i aria-hidden="true" />
                {series.name} · {SERIES_MARKERS[index % SERIES_MARKERS.length]}
              </li>
            ))}
          </ul>
        </figure>
      )}

      {chart?.sparse && (
        <div className="evaluation-preview-sparse">
          <strong>Not enough ordered points for a defensible trend line</strong>
          <span>
            GOSU shows the exact KPI and table instead. Add at least eight evaluations to display
            the line.
          </span>
        </div>
      )}

      {preview.table && (
        <section className="evaluation-preview-table">
          <h4>{preview.table.title}</h4>
          <div tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {preview.table.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.table.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((value, column) => (
                      <td key={column}>{value === null ? '—' : String(value)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="evaluation-preview-report">
        <h4>Test report preview</h4>
        <MarkdownDocument
          notePath="Evaluation Preview.md"
          source={preview.reportMarkdown}
          vaultFiles={[]}
          onOpenNote={() => undefined}
          loadVaultImages={false}
        />
      </section>
    </section>
  );
}

function PreviewMarker({
  kind,
  x,
  y,
  bar,
}: {
  kind: (typeof SERIES_MARKERS)[number];
  x: number;
  y: number;
  bar: boolean;
}) {
  if (bar) return <rect x={x - 8} y={y} width="16" height={232 - y} rx="2" />;
  if (kind === 'square') return <rect x={x - 4} y={y - 4} width="8" height="8" />;
  if (kind === 'triangle')
    return <path d={`M ${x} ${y - 5} L ${x + 5} ${y + 4} L ${x - 5} ${y + 4} Z`} />;
  if (kind === 'diamond')
    return <path d={`M ${x} ${y - 5} L ${x + 5} ${y} L ${x} ${y + 5} L ${x - 5} ${y} Z`} />;
  if (kind === 'cross') return <path d={`M ${x - 5} ${y} H ${x + 5} M ${x} ${y - 5} V ${y + 5}`} />;
  if (kind === 'ring') return <circle cx={x} cy={y} r="5" fill="none" strokeWidth="2.5" />;
  return <circle cx={x} cy={y} r="4" />;
}
