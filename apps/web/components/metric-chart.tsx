import type { TrialPoint } from '../lib/demo-data';

export function MetricChart({ points }: { points: TrialPoint[] }) {
  const width = 620;
  const height = 220;
  const pad = 28;
  const values = points.map((point) => point.value);
  const min = Math.min(...values) - 0.6;
  const max = Math.max(...values) + 0.6;
  const x = (index: number) => pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - ((value - min) / (max - min)) * (height - pad * 2);
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`)
    .join(' ');

  return (
    <svg
      className="metric-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Validation accuracy by trial"
    >
      <defs>
        <linearGradient id="metric-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9ef01a" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#9ef01a" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map((line) => {
        const lineY = pad + (line / 3) * (height - pad * 2);
        return (
          <line
            key={line}
            x1={pad}
            x2={width - pad}
            y1={lineY}
            y2={lineY}
            stroke="rgba(255,255,255,.08)"
          />
        );
      })}
      <path
        d={`${path} L ${x(points.length - 1)} ${height - pad} L ${x(0)} ${height - pad} Z`}
        fill="url(#metric-area)"
      />
      <path
        d={path}
        fill="none"
        stroke="#9ef01a"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, index) => (
        <g key={point.trial}>
          <circle
            cx={x(index)}
            cy={y(point.value)}
            r={index === points.length - 1 ? 6 : 3.5}
            fill="#0d140c"
            stroke="#9ef01a"
            strokeWidth="2"
          />
          <text x={x(index)} y={height - 8} textAnchor="middle" className="axis-label">
            T{point.trial}
          </text>
        </g>
      ))}
    </svg>
  );
}
