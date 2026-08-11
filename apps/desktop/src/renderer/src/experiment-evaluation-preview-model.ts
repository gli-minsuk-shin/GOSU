import type { ExperimentEvaluationPreview } from '../../shared/experiment-evaluation-contracts';

export type EvaluationPreviewChartPoint = Readonly<{
  x: number;
  y: number;
  label: string | null;
  cx: number;
  cy: number;
}>;

export type EvaluationPreviewChartSeries = Readonly<{
  name: string;
  points: readonly EvaluationPreviewChartPoint[];
}>;

export type EvaluationPreviewChart = Readonly<{
  kind: 'line' | 'bar' | 'scatter';
  title: string;
  subtitle: string;
  xLabel: string;
  yLabel: string;
  series: readonly EvaluationPreviewChartSeries[];
  sparse: boolean;
  truncated: boolean;
  totalPoints: number;
  xMinimum: number;
  xMaximum: number;
  yMinimum: number;
  yMaximum: number;
}>;

const LEFT = 54;
const RIGHT = 742;
const TOP = 24;
const BOTTOM = 232;
const MAX_VISIBLE_POINTS = 12;

function extent(values: readonly number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum !== maximum) return { minimum, maximum };
  const padding = Math.max(1, Math.abs(minimum) * 0.05);
  return { minimum: minimum - padding, maximum: maximum + padding };
}

function scale(value: number, minimum: number, maximum: number, start: number, end: number) {
  return start + ((value - minimum) / (maximum - minimum)) * (end - start);
}

export function buildEvaluationPreviewChart(
  preview: ExperimentEvaluationPreview,
): EvaluationPreviewChart | null {
  const plot = preview.plot;
  if (!plot) return null;
  const totalPoints = plot.series.reduce((count, series) => count + series.points.length, 0);
  const visibleSeries = plot.series.map((series) => ({
    ...series,
    points:
      series.points.length > MAX_VISIBLE_POINTS
        ? series.points.slice(-MAX_VISIBLE_POINTS)
        : series.points,
  }));
  const visiblePoints = visibleSeries.flatMap((series) => series.points);
  if (visiblePoints.length === 0) return null;
  const x = extent(visiblePoints.map((point) => point.x));
  const y = extent(visiblePoints.map((point) => point.y));
  return {
    kind: plot.kind,
    title: plot.title,
    subtitle: plot.subtitle,
    xLabel: plot.xLabel,
    yLabel: plot.yLabel,
    series: visibleSeries.map((series) => ({
      name: series.name,
      points: series.points.map((point) => ({
        ...point,
        cx: scale(point.x, x.minimum, x.maximum, LEFT, RIGHT),
        cy: scale(point.y, y.minimum, y.maximum, BOTTOM, TOP),
      })),
    })),
    sparse:
      plot.kind === 'line' && Math.max(...visibleSeries.map((series) => series.points.length)) < 8,
    truncated: visibleSeries.some(
      (series, index) => series.points.length < plot.series[index]!.points.length,
    ),
    totalPoints,
    xMinimum: x.minimum,
    xMaximum: x.maximum,
    yMinimum: y.minimum,
    yMaximum: y.maximum,
  };
}

export function previewSeriesPath(points: readonly EvaluationPreviewChartPoint[]) {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.cx} ${point.cy}`)
    .join(' ');
}
