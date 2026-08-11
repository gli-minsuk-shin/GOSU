import { describe, expect, it } from 'vitest';

import {
  buildEvaluationPreviewChart,
  previewSeriesPath,
} from '../src/renderer/src/experiment-evaluation-preview-model';
import {
  ExperimentEvaluationPreviewSchema,
  type ExperimentEvaluationPreview,
} from '../src/shared/experiment-evaluation-contracts';

function preview(
  pointCount: number,
  kind: 'line' | 'bar' | 'scatter' = 'line',
): ExperimentEvaluationPreview {
  return ExperimentEvaluationPreviewSchema.parse({
    dataKind: 'synthetic-preview',
    evidence: false,
    notice: 'Illustrative values only; no experiment was executed.',
    numbers: [],
    table: null,
    plot: {
      title: 'Illustrative validation trajectory',
      subtitle: 'Synthetic preview every 100 steps',
      kind,
      xLabel: 'Step',
      yLabel: 'Validation loss',
      series: [
        {
          name: 'Validation loss',
          points: Array.from({ length: pointCount }, (_, index) => ({
            x: index,
            y: 100 - index * 2,
            label: `step ${index}`,
          })),
        },
      ],
    },
    reportMarkdown: '# Synthetic preview\n\nNo experiment was executed.',
  });
}

describe('Experiment Evaluation preview chart model', () => {
  it('returns no chart when the preview does not declare a plot', () => {
    const withoutPlot = { ...preview(8), plot: null };

    expect(buildEvaluationPreviewChart(withoutPlot)).toBeNull();
  });

  it('marks fewer than eight ordered line points as sparse without suppressing other chart kinds', () => {
    expect(buildEvaluationPreviewChart(preview(7, 'line'))?.sparse).toBe(true);
    expect(buildEvaluationPreviewChart(preview(8, 'line'))?.sparse).toBe(false);
    expect(buildEvaluationPreviewChart(preview(3, 'bar'))?.sparse).toBe(false);
    expect(buildEvaluationPreviewChart(preview(3, 'scatter'))?.sparse).toBe(false);
  });

  it('keeps the latest twelve points, preserves the original count, and scales them safely', () => {
    const chart = buildEvaluationPreviewChart(preview(15));

    expect(chart).not.toBeNull();
    expect(chart?.totalPoints).toBe(15);
    expect(chart?.truncated).toBe(true);
    expect(chart?.series[0]?.points).toHaveLength(12);
    expect(chart?.series[0]?.points[0]?.x).toBe(3);
    expect(chart?.series[0]?.points.at(-1)?.x).toBe(14);
    expect(chart?.xMinimum).toBe(3);
    expect(chart?.xMaximum).toBe(14);
    for (const point of chart?.series[0]?.points ?? []) {
      expect(Number.isFinite(point.cx)).toBe(true);
      expect(Number.isFinite(point.cy)).toBe(true);
      expect(point.cx).toBeGreaterThanOrEqual(54);
      expect(point.cx).toBeLessThanOrEqual(742);
      expect(point.cy).toBeGreaterThanOrEqual(24);
      expect(point.cy).toBeLessThanOrEqual(232);
    }
  });

  it('pads equal-value extents so a single point still has finite centered coordinates', () => {
    const chart = buildEvaluationPreviewChart(preview(1));
    const point = chart?.series[0]?.points[0];

    expect(chart?.xMinimum).toBeLessThan(0);
    expect(chart?.xMaximum).toBeGreaterThan(0);
    expect(chart?.yMinimum).toBeLessThan(100);
    expect(chart?.yMaximum).toBeGreaterThan(100);
    expect(point).toMatchObject({ cx: 398, cy: 128 });
  });

  it('builds a deterministic SVG path in visible point order', () => {
    const points = buildEvaluationPreviewChart(preview(2))?.series[0]?.points ?? [];

    expect(previewSeriesPath(points)).toBe(
      `M ${points[0]?.cx} ${points[0]?.cy} L ${points[1]?.cx} ${points[1]?.cy}`,
    );
    expect(previewSeriesPath([])).toBe('');
  });
});
