import { describe, expect, it } from 'vitest';

import type {
  ExperimentIdea,
  ExperimentMetricPoint,
} from '../src/shared/experiment-workspace-contracts';
import {
  bestExperimentMetricPoint,
  buildExperimentReportSummary,
  buildExperimentTrajectory,
  buildIdeaLineageLabels,
  groupExperimentMetricSeries,
  layoutIdeaLineage,
  metricImprovementFromBaseline,
} from '../src/renderer/src/experiment-trajectory-model';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OBJECTIVE_ID = '22222222-2222-4222-8222-222222222222';
const EVALUATOR_HASH = 'a'.repeat(64);
const DATASET_HASH = 'b'.repeat(64);
const HOLDOUT_HASH = 'c'.repeat(64);

function idea(id: string, title: string, overrides: Partial<ExperimentIdea> = {}): ExperimentIdea {
  return {
    schemaVersion: 1,
    id,
    projectId: PROJECT_ID,
    parentIdeaId: null,
    title,
    hypothesis: '',
    phase: 'Phase 1',
    outcome: 'planned',
    resultSummary: '',
    version: 1,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

function point(
  id: string,
  sequence: number,
  value: number,
  overrides: Partial<ExperimentMetricPoint> = {},
): ExperimentMetricPoint {
  return {
    schemaVersion: 1,
    id,
    projectId: PROJECT_ID,
    ideaId: '33333333-3333-4333-8333-333333333333',
    sequence,
    objectiveId: OBJECTIVE_ID,
    objectiveVersion: 1,
    metricKey: 'accuracy',
    metricDisplayName: 'Validation accuracy',
    direction: 'maximize',
    unit: '%',
    aggregation: 'mean',
    evaluatorHash: EVALUATOR_HASH,
    datasetHash: DATASET_HASH,
    holdoutHash: HOLDOUT_HASH,
    baseline: 50,
    target: 55,
    value,
    source: 'manual',
    trialId: null,
    recordedAt: `2026-08-06T0${sequence}:00:00.000Z`,
    ...overrides,
  };
}

describe('experiment metric series and trajectory', () => {
  it('sorts points by sequence and builds direction-aware best-so-far values', () => {
    const series = groupExperimentMetricSeries([
      point('44444444-4444-4444-8444-444444444444', 2, 49),
      point('55555555-5555-4555-8555-555555555555', 1, 51),
      point('66666666-6666-4666-8666-666666666666', 3, 54),
    ])[0]!;
    const chart = buildExperimentTrajectory(series);

    expect(series.points.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(chart.points.map(({ bestValue }) => bestValue)).toEqual([51, 51, 54]);
    expect(chart.valuePath).toMatch(/^M /u);
    expect(chart.bestPath).toMatch(/^M /u);
    expect(chart.baselineY).not.toBeNull();
    expect(chart.targetY).not.toBeNull();
  });

  it('uses lower values as better for minimize metrics and reports positive improvement', () => {
    const points = [
      point('44444444-4444-4444-8444-444444444444', 1, 12, {
        direction: 'minimize',
        baseline: 15,
        target: 10,
      }),
      point('55555555-5555-4555-8555-555555555555', 2, 13, {
        direction: 'minimize',
        baseline: 15,
        target: 10,
      }),
      point('66666666-6666-4666-8666-666666666666', 3, 9, {
        direction: 'minimize',
        baseline: 15,
        target: 10,
      }),
    ];
    const series = groupExperimentMetricSeries(points)[0]!;

    expect(buildExperimentTrajectory(series).points.map(({ bestValue }) => bestValue)).toEqual([
      12, 12, 9,
    ]);
    expect(bestExperimentMetricPoint(points)?.value).toBe(9);
    expect(metricImprovementFromBaseline(9, 15, 'minimize')).toBe(6);
  });

  it('never groups points across evaluator, dataset, holdout, objective, or metric boundaries', () => {
    const base = point('44444444-4444-4444-8444-444444444444', 1, 51);
    const groups = groupExperimentMetricSeries([
      base,
      point('55555555-5555-4555-8555-555555555555', 2, 52, {
        evaluatorHash: 'd'.repeat(64),
      }),
      point('66666666-6666-4666-8666-666666666666', 3, 53, {
        datasetHash: 'e'.repeat(64),
      }),
      point('77777777-7777-4777-8777-777777777777', 4, 54, {
        holdoutHash: null,
      }),
      point('88888888-8888-4888-8888-888888888888', 5, 55, {
        objectiveVersion: 2,
      }),
      point('99999999-9999-4999-8999-999999999999', 6, 56, {
        metricKey: 'accuracy:robust',
      }),
    ]);

    expect(groups).toHaveLength(6);
    expect(new Set(groups.map(({ key }) => key)).size).toBe(6);
  });

  it('returns a stable empty chart without inventing data', () => {
    const chart = buildExperimentTrajectory(null);
    expect(chart.points).toEqual([]);
    expect(chart.valuePath).toBe('');
    expect(chart.bestPath).toBe('');
  });
});

describe('experiment idea lineage', () => {
  it('assigns stable A, A-1, A-1-1 labels and visible parent edges', () => {
    const root = idea('33333333-3333-4333-8333-333333333333', 'Idea A');
    const child = idea('44444444-4444-4444-8444-444444444444', 'Idea A-1', {
      parentIdeaId: root.id,
      createdAt: '2026-08-06T01:00:00.000Z',
    });
    const grandchild = idea('55555555-5555-4555-8555-555555555555', 'Idea A-1-1', {
      parentIdeaId: child.id,
      createdAt: '2026-08-06T02:00:00.000Z',
    });
    const labels = buildIdeaLineageLabels([grandchild, child, root]);
    const layout = layoutIdeaLineage([grandchild, child, root]);

    expect(labels.get(root.id)).toBe('A');
    expect(labels.get(child.id)).toBe('A-1');
    expect(labels.get(grandchild.id)).toBe('A-1-1');
    expect(layout.nodes.map(({ depth }) => depth)).toEqual([0, 1, 2]);
    expect(layout.edges).toHaveLength(2);
    expect(layout.issues).toEqual([]);
  });

  it('reports missing parents and cycles without recursing forever', () => {
    const missing = idea('33333333-3333-4333-8333-333333333333', 'Missing parent', {
      parentIdeaId: '99999999-9999-4999-8999-999999999999',
    });
    const first = idea('44444444-4444-4444-8444-444444444444', 'Cycle A', {
      parentIdeaId: '55555555-5555-4555-8555-555555555555',
    });
    const second = idea('55555555-5555-4555-8555-555555555555', 'Cycle B', {
      parentIdeaId: first.id,
    });
    const layout = layoutIdeaLineage([missing, first, second]);

    expect(layout.nodes).toHaveLength(3);
    expect(layout.issues.some(({ kind }) => kind === 'missing-parent')).toBe(true);
    expect(layout.issues.some(({ kind }) => kind === 'cycle')).toBe(true);
  });
});

describe('experiment report summary', () => {
  it('derives only saved counts, outcomes, elapsed time, phases, and best lineage', () => {
    const root = idea('33333333-3333-4333-8333-333333333333', 'Baseline idea', {
      outcome: 'partial',
    });
    const child = idea('44444444-4444-4444-8444-444444444444', 'Improved idea', {
      parentIdeaId: root.id,
      phase: 'Phase 2',
      outcome: 'success',
      createdAt: '2026-08-06T01:00:00.000Z',
      updatedAt: '2026-08-06T03:00:00.000Z',
    });
    const series = groupExperimentMetricSeries([
      point('55555555-5555-4555-8555-555555555555', 1, 51, { ideaId: root.id }),
      point('66666666-6666-4666-8666-666666666666', 2, 56, {
        ideaId: child.id,
        trialId: 'trial-2',
      }),
    ])[0]!;
    const report = buildExperimentReportSummary([root, child], series);

    expect(report.ideaCount).toBe(2);
    expect(report.resultCount).toBe(2);
    expect(report.trialCount).toBe(1);
    expect(report.bestPoint?.ideaId).toBe(child.id);
    expect(report.improvementFromBaseline).toBe(6);
    expect(report.targetReached).toBe(true);
    expect(report.outcomeCounts.success).toBe(1);
    expect(report.outcomeCounts.partial).toBe(1);
    expect(report.bestIdeaPath.map(({ id }) => id)).toEqual([root.id, child.id]);
    expect(report.phases.map(({ phase }) => phase)).toEqual(['Phase 1', 'Phase 2']);
    expect(report.elapsedMilliseconds).toBeGreaterThan(0);
  });
});
