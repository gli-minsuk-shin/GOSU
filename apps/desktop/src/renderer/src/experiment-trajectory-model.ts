import type {
  ExperimentIdea,
  ExperimentIdeaOutcome,
  ExperimentMetricPoint,
} from '../../shared/experiment-workspace-contracts';

export const EXPERIMENT_CHART_WIDTH = 960;
export const EXPERIMENT_CHART_HEIGHT = 360;

const CHART_PADDING = {
  top: 24,
  right: 24,
  bottom: 52,
  left: 72,
} as const;

export type ExperimentMetricSeries = Readonly<{
  key: string;
  objectiveId: string;
  objectiveVersion: number;
  metricKey: string;
  metricDisplayName: string;
  direction: ExperimentMetricPoint['direction'];
  unit: string | null;
  aggregation: ExperimentMetricPoint['aggregation'];
  evaluatorHash: string;
  datasetHash: string;
  holdoutHash: string | null;
  baseline: number | null;
  target: number | null;
  latestRecordedAt: string;
  points: readonly ExperimentMetricPoint[];
}>;

export type ExperimentChartPoint = Readonly<{
  point: ExperimentMetricPoint;
  x: number;
  y: number;
  bestValue: number;
  bestY: number;
}>;

export type ExperimentChartTick = Readonly<{
  value: number;
  y: number;
}>;

export type ExperimentTimeTick = Readonly<{
  label: string;
  x: number;
}>;

export type ExperimentTrajectoryModel = Readonly<{
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  minValue: number;
  maxValue: number;
  points: readonly ExperimentChartPoint[];
  valuePath: string;
  bestPath: string;
  valueTicks: readonly ExperimentChartTick[];
  timeTicks: readonly ExperimentTimeTick[];
  baselineY: number | null;
  targetY: number | null;
}>;

export type IdeaLineageIssue = Readonly<{
  kind: 'missing-parent' | 'cycle';
  ideaId: string;
}>;

export type IdeaLineageNode = Readonly<{
  idea: ExperimentIdea;
  label: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type IdeaLineageEdge = Readonly<{
  id: string;
  parentId: string;
  childId: string;
  path: string;
}>;

export type IdeaLineageLayout = Readonly<{
  width: number;
  height: number;
  nodes: readonly IdeaLineageNode[];
  edges: readonly IdeaLineageEdge[];
  issues: readonly IdeaLineageIssue[];
}>;

export type ExperimentPhaseSummary = Readonly<{
  phase: string;
  ideaCount: number;
  resultCount: number;
  bestValue: number | null;
}>;

export type ExperimentReportSummary = Readonly<{
  ideaCount: number;
  resultCount: number;
  trialCount: number;
  elapsedMilliseconds: number;
  bestPoint: ExperimentMetricPoint | null;
  improvementFromBaseline: number | null;
  targetReached: boolean | null;
  outcomeCounts: Readonly<Record<ExperimentIdeaOutcome, number>>;
  phases: readonly ExperimentPhaseSummary[];
  bestIdeaPath: readonly ExperimentIdea[];
}>;

function metricSeriesKey(point: ExperimentMetricPoint) {
  return JSON.stringify([
    point.objectiveId,
    point.objectiveVersion,
    point.metricKey,
    point.evaluatorHash,
    point.datasetHash,
    point.holdoutHash ?? 'no-holdout',
  ]);
}

export function sortExperimentMetricPoints(
  points: readonly ExperimentMetricPoint[],
): ExperimentMetricPoint[] {
  return [...points].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.recordedAt.localeCompare(right.recordedAt) ||
      left.id.localeCompare(right.id),
  );
}

export function groupExperimentMetricSeries(
  points: readonly ExperimentMetricPoint[],
): ExperimentMetricSeries[] {
  const groups = new Map<string, ExperimentMetricPoint[]>();
  for (const point of points) {
    const key = metricSeriesKey(point);
    const group = groups.get(key) ?? [];
    group.push(point);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const sorted = sortExperimentMetricPoints(group);
      const latest = sorted.at(-1)!;
      return {
        key,
        objectiveId: latest.objectiveId,
        objectiveVersion: latest.objectiveVersion,
        metricKey: latest.metricKey,
        metricDisplayName: latest.metricDisplayName,
        direction: latest.direction,
        unit: latest.unit,
        aggregation: latest.aggregation,
        evaluatorHash: latest.evaluatorHash,
        datasetHash: latest.datasetHash,
        holdoutHash: latest.holdoutHash,
        baseline: latest.baseline,
        target: latest.target,
        latestRecordedAt: latest.recordedAt,
        points: sorted,
      } satisfies ExperimentMetricSeries;
    })
    .sort(
      (left, right) =>
        right.latestRecordedAt.localeCompare(left.latestRecordedAt) ||
        right.objectiveVersion - left.objectiveVersion ||
        left.metricKey.localeCompare(right.metricKey),
    );
}

function paddedRange(values: readonly number[]) {
  if (values.length === 0) return { min: 0, max: 1 };
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.05, 1);
    return { min: minimum - padding, max: maximum + padding };
  }
  const padding = (maximum - minimum) * 0.12;
  return { min: minimum - padding, max: maximum + padding };
}

function pathFor(points: readonly { x: number; y: number }[]) {
  return points
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
}

function bestValue(
  previous: number | null,
  next: number,
  direction: ExperimentMetricPoint['direction'],
) {
  if (previous === null) return next;
  return direction === 'maximize' ? Math.max(previous, next) : Math.min(previous, next);
}

function timeTickLabel(value: number, span: number) {
  const date = new Date(value);
  if (span >= 24 * 60 * 60 * 1_000) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function buildExperimentTrajectory(
  series: ExperimentMetricSeries | null,
): ExperimentTrajectoryModel {
  const width = EXPERIMENT_CHART_WIDTH;
  const height = EXPERIMENT_CHART_HEIGHT;
  const plotLeft = CHART_PADDING.left;
  const plotRight = width - CHART_PADDING.right;
  const plotTop = CHART_PADDING.top;
  const plotBottom = height - CHART_PADDING.bottom;

  if (!series || series.points.length === 0) {
    return {
      width,
      height,
      plotLeft,
      plotRight,
      plotTop,
      plotBottom,
      minValue: 0,
      maxValue: 1,
      points: [],
      valuePath: '',
      bestPath: '',
      valueTicks: [],
      timeTicks: [],
      baselineY: null,
      targetY: null,
    };
  }

  const guideValues = [series.baseline, series.target].filter(
    (value): value is number => value !== null,
  );
  const range = paddedRange([...series.points.map(({ value }) => value), ...guideValues]);
  const y = (value: number) =>
    plotBottom - ((value - range.min) / (range.max - range.min)) * (plotBottom - plotTop);

  const recordedTimes = series.points.map(({ recordedAt }) => Date.parse(recordedAt));
  const firstTime = Math.min(...recordedTimes);
  const lastTime = Math.max(...recordedTimes);
  const timeSpan = Math.max(0, lastTime - firstTime);
  const x = (time: number, index: number) =>
    timeSpan === 0
      ? plotLeft + (index / Math.max(series.points.length - 1, 1)) * (plotRight - plotLeft)
      : plotLeft + ((time - firstTime) / timeSpan) * (plotRight - plotLeft);

  let runningBest: number | null = null;
  const chartPoints = series.points.map((point, index) => {
    runningBest = bestValue(runningBest, point.value, series.direction);
    return {
      point,
      x: x(recordedTimes[index]!, index),
      y: y(point.value),
      bestValue: runningBest,
      bestY: y(runningBest),
    } satisfies ExperimentChartPoint;
  });

  const valueTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const value = range.max - ratio * (range.max - range.min);
    return { value, y: plotTop + ratio * (plotBottom - plotTop) };
  });

  const timeTickIndexes = [
    ...new Set([0, Math.floor((series.points.length - 1) / 2), series.points.length - 1]),
  ];
  const timeTicks = timeTickIndexes.map((index) => ({
    label: timeTickLabel(recordedTimes[index]!, timeSpan),
    x: chartPoints[index]!.x,
  }));

  return {
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    minValue: range.min,
    maxValue: range.max,
    points: chartPoints,
    valuePath: pathFor(chartPoints),
    bestPath: pathFor(chartPoints.map(({ x: pointX, bestY }) => ({ x: pointX, y: bestY }))),
    valueTicks,
    timeTicks,
    baselineY: series.baseline === null ? null : y(series.baseline),
    targetY: series.target === null ? null : y(series.target),
  };
}

function compareIdeas(left: ExperimentIdea, right: ExperimentIdea) {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function alphaLabel(index: number) {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    current -= 1;
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26);
  }
  return label;
}

export function buildIdeaLineageLabels(ideas: readonly ExperimentIdea[]) {
  const sorted = [...ideas].sort(compareIdeas);
  const byId = new Map(sorted.map((idea) => [idea.id, idea]));
  const children = new Map<string, ExperimentIdea[]>();
  for (const idea of sorted) {
    if (!idea.parentIdeaId || !byId.has(idea.parentIdeaId)) continue;
    const siblings = children.get(idea.parentIdeaId) ?? [];
    siblings.push(idea);
    children.set(idea.parentIdeaId, siblings);
  }
  children.forEach((siblings) => siblings.sort(compareIdeas));

  const labels = new Map<string, string>();
  const roots = sorted.filter((idea) => !idea.parentIdeaId || !byId.has(idea.parentIdeaId));
  roots.forEach((root, rootIndex) => {
    const rootLabel = alphaLabel(rootIndex);
    const visit = (idea: ExperimentIdea, label: string, visited: Set<string>) => {
      if (visited.has(idea.id)) return;
      labels.set(idea.id, label);
      const nextVisited = new Set(visited).add(idea.id);
      (children.get(idea.id) ?? []).forEach((child, childIndex) =>
        visit(child, `${label}-${childIndex + 1}`, nextVisited),
      );
    };
    visit(root, rootLabel, new Set());
  });
  sorted.forEach((idea, index) => {
    if (!labels.has(idea.id)) labels.set(idea.id, `?${index + 1}`);
  });
  return labels;
}

export function layoutIdeaLineage(ideas: readonly ExperimentIdea[]): IdeaLineageLayout {
  const sorted = [...ideas].sort(compareIdeas);
  const byId = new Map(sorted.map((idea) => [idea.id, idea]));
  const issues: IdeaLineageIssue[] = [];
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  const resolveDepth = (idea: ExperimentIdea): number => {
    const known = depth.get(idea.id);
    if (known !== undefined) return known;
    if (visiting.has(idea.id)) {
      issues.push({ kind: 'cycle', ideaId: idea.id });
      depth.set(idea.id, 0);
      return 0;
    }
    visiting.add(idea.id);
    let value = 0;
    if (idea.parentIdeaId) {
      const parent = byId.get(idea.parentIdeaId);
      if (!parent) {
        issues.push({ kind: 'missing-parent', ideaId: idea.id });
      } else {
        value = resolveDepth(parent) + 1;
      }
    }
    visiting.delete(idea.id);
    if (!depth.has(idea.id)) depth.set(idea.id, value);
    return depth.get(idea.id)!;
  };
  sorted.forEach(resolveDepth);

  const labels = buildIdeaLineageLabels(sorted);
  const layers = new Map<number, ExperimentIdea[]>();
  for (const idea of sorted) {
    const ideaDepth = depth.get(idea.id) ?? 0;
    const layer = layers.get(ideaDepth) ?? [];
    layer.push(idea);
    layers.set(ideaDepth, layer);
  }
  layers.forEach((layer) => layer.sort(compareIdeas));

  const nodeWidth = 190;
  const nodeHeight = 78;
  const columnGap = 58;
  const rowGap = 34;
  const outerPadding = 28;
  const maxDepth = Math.max(0, ...layers.keys());
  const maxRows = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
  const width = Math.max(680, outerPadding * 2 + (maxDepth + 1) * nodeWidth + maxDepth * columnGap);
  const height = Math.max(360, outerPadding * 2 + maxRows * nodeHeight + (maxRows - 1) * rowGap);
  const nodes: IdeaLineageNode[] = [];

  [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .forEach(([ideaDepth, layer]) => {
      const layerHeight = layer.length * nodeHeight + Math.max(0, layer.length - 1) * rowGap;
      const startY = Math.max(outerPadding, (height - layerHeight) / 2);
      layer.forEach((idea, index) => {
        nodes.push({
          idea,
          label: labels.get(idea.id) ?? '?',
          depth: ideaDepth,
          x: outerPadding + ideaDepth * (nodeWidth + columnGap),
          y: startY + index * (nodeHeight + rowGap),
          width: nodeWidth,
          height: nodeHeight,
        });
      });
    });

  const nodeById = new Map(nodes.map((node) => [node.idea.id, node]));
  const edges = nodes.flatMap((node) => {
    if (!node.idea.parentIdeaId) return [];
    const parent = nodeById.get(node.idea.parentIdeaId);
    if (!parent || parent.idea.id === node.idea.id) return [];
    const startX = parent.x + parent.width;
    const startY = parent.y + parent.height / 2;
    const endX = node.x;
    const endY = node.y + node.height / 2;
    const control = Math.max(24, (endX - startX) / 2);
    return [
      {
        id: `${parent.idea.id}:${node.idea.id}`,
        parentId: parent.idea.id,
        childId: node.idea.id,
        path: `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`,
      },
    ];
  });

  return { width, height, nodes, edges, issues };
}

export function bestExperimentMetricPoint(
  points: readonly ExperimentMetricPoint[],
): ExperimentMetricPoint | null {
  const sorted = sortExperimentMetricPoints(points);
  if (sorted.length === 0) return null;
  const direction = sorted.at(-1)!.direction;
  return sorted.reduce((best, point) =>
    direction === 'maximize'
      ? point.value > best.value
        ? point
        : best
      : point.value < best.value
        ? point
        : best,
  );
}

export function metricImprovementFromBaseline(
  value: number,
  baseline: number | null,
  direction: ExperimentMetricPoint['direction'],
) {
  if (baseline === null) return null;
  return direction === 'maximize' ? value - baseline : baseline - value;
}

export function metricTargetReached(
  value: number,
  target: number | null,
  direction: ExperimentMetricPoint['direction'],
) {
  if (target === null) return null;
  return direction === 'maximize' ? value >= target : value <= target;
}

function bestIdeaPath(ideas: readonly ExperimentIdea[], bestPoint: ExperimentMetricPoint | null) {
  if (!bestPoint) return [];
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  const path: ExperimentIdea[] = [];
  const visited = new Set<string>();
  let current = byId.get(bestPoint.ideaId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentIdeaId ? byId.get(current.parentIdeaId) : undefined;
  }
  return path;
}

export function buildExperimentReportSummary(
  ideas: readonly ExperimentIdea[],
  series: ExperimentMetricSeries | null,
): ExperimentReportSummary {
  const points = series?.points ?? [];
  const bestPoint = bestExperimentMetricPoint(points);
  const outcomeCounts: Record<ExperimentIdeaOutcome, number> = {
    planned: 0,
    running: 0,
    success: 0,
    partial: 0,
    failed: 0,
    inconclusive: 0,
  };
  ideas.forEach(({ outcome }) => {
    outcomeCounts[outcome] += 1;
  });

  const phaseNames = [...new Set(ideas.map(({ phase }) => phase.trim()).filter(Boolean))];
  const ideaById = new Map(ideas.map((idea) => [idea.id, idea]));
  const phases = phaseNames.map((phase) => {
    const phaseIdeas = ideas.filter((idea) => idea.phase.trim() === phase);
    const phaseIdeaIds = new Set(phaseIdeas.map(({ id }) => id));
    const phasePoints = points.filter(({ ideaId }) => phaseIdeaIds.has(ideaId));
    return {
      phase,
      ideaCount: phaseIdeas.length,
      resultCount: phasePoints.length,
      bestValue: bestExperimentMetricPoint(phasePoints)?.value ?? null,
    } satisfies ExperimentPhaseSummary;
  });

  const timestamps = [
    ...ideas.map(({ createdAt }) => Date.parse(createdAt)),
    ...ideas.map(({ updatedAt }) => Date.parse(updatedAt)),
    ...points.map(({ recordedAt }) => Date.parse(recordedAt)),
  ].filter(Number.isFinite);
  const elapsedMilliseconds =
    timestamps.length < 2 ? 0 : Math.max(...timestamps) - Math.min(...timestamps);
  const baseline = bestPoint?.baseline ?? series?.baseline ?? null;
  const direction = bestPoint?.direction ?? series?.direction ?? 'maximize';

  return {
    ideaCount: ideas.length,
    resultCount: points.length,
    trialCount: new Set(points.map(({ trialId }) => trialId).filter(Boolean)).size,
    elapsedMilliseconds,
    bestPoint,
    improvementFromBaseline: bestPoint
      ? metricImprovementFromBaseline(bestPoint.value, baseline, direction)
      : null,
    targetReached: bestPoint
      ? metricTargetReached(bestPoint.value, bestPoint.target, direction)
      : null,
    outcomeCounts,
    phases,
    bestIdeaPath: bestIdeaPath(ideas, bestPoint).filter(({ id }) => ideaById.has(id)),
  };
}

export function formatExperimentMetric(value: number, unit: string | null) {
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 4,
    maximumSignificantDigits: 6,
  }).format(value);
  if (!unit) return formatted;
  return unit === '%' ? `${formatted}%` : `${formatted} ${unit}`;
}

export function formatExperimentElapsed(milliseconds: number) {
  if (milliseconds <= 0) return '—';
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}
