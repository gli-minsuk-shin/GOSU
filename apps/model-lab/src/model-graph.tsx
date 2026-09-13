import { uiText, useUiText } from '@gosu/ui/language';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { formulaDisplayRows } from './formula';
import {
  classifyGradient,
  formatNorm,
  formatShape,
  gradientAt,
  gradientStateAt,
  moduleGradientHealth,
} from './model-lab-domain';
import {
  ModuleNodeView,
  SubgraphBoundaryNodeView,
  type ModuleFlowNode,
  type SubgraphBoundaryFlowNode,
} from './module-node';
import type {
  GradientHealth,
  GradientObservationState,
  GradientProbeName,
  ModelConnection,
  ModelModule,
  ModelSpec,
  TensorShape,
} from './model-lab-schema';
import {
  homogeneousUnknownRepeatSignature,
  repeatedModuleStepStatements,
} from './model-repeat-semantics';
export { repeatedModuleStepStatements } from './model-repeat-semantics';

const nodeTypes = { module: ModuleNodeView, 'subgraph-boundary': SubgraphBoundaryNodeView };

export type ModelGraphChangeKind = 'added' | 'changed';

export type ModelGraphChangeHighlight = Readonly<{
  mode: 'proposal' | 'revision';
  addedModuleIds: readonly string[];
  changedModuleIds: readonly string[];
  removedModuleIds: readonly string[];
  addedConnectionIds: readonly string[];
  changedConnectionIds: readonly string[];
  addedStepIds: readonly string[];
  changedStepIds: readonly string[];
  removedStepLabels: readonly string[];
}>;

type SignalFlowEdge = Edge<
  Readonly<
    Pick<SignalReading, 'health' | 'quantity' | 'tensorName' | 'value'> & {
      changeKind: ModelGraphChangeKind | null;
      rowTransition: ForLoopRowTransition | null;
    }
  >,
  'signal'
>;

export function SignalEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  pathOptions,
  data,
}: EdgeProps<SignalFlowEdge>) {
  useUiText();
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: pathOptions?.borderRadius ?? 18,
    offset: pathOptions?.offset ?? 36,
  });
  const renderedLabelX = data?.rowTransition
    ? (sourceX + targetX) / 2 + (data.rowTransition.side === 'right' ? -92 : 92)
    : labelX;
  const renderedLabelY = data?.rowTransition ? (sourceY + targetY) / 2 : labelY;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={28}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        {...(style === undefined ? {} : { style })}
      />
      {data ? (
        <EdgeLabelRenderer>
          <div
            className={`signal-edge__label signal-edge__label--${data.health}${data.changeKind ? ` signal-edge__label--change-${data.changeKind}` : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${renderedLabelX}px, ${renderedLabelY}px)`,
            }}
            title={`${data.tensorName}: ${data.quantity} ${data.value}`}
            aria-label={`${data.tensorName}: ${data.quantity} ${data.value}`}
          >
            {data.rowTransition ? (
              <span className="signal-edge__row-transition">
                <b>{uiText('NEXT ROW')}</b>
                <strong>
                  {uiText('STEP ')}
                  {data.rowTransition.fromStep}
                  {uiText(' ↓ STEP ')}
                  {data.rowTransition.toStep}
                </strong>
              </span>
            ) : null}
            <span>{data.quantity}</span>
            <strong>{uiText(data.value)}</strong>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = { signal: SignalEdgeView };

const healthColor: Record<GradientHealth, string> = {
  healthy: 'var(--model-health-good)',
  low: 'var(--model-health-low)',
  blocked: 'var(--model-health-bad)',
  exploding: 'var(--model-health-bad)',
  invalid: 'var(--model-health-invalid)',
  'not-applicable': 'var(--model-health-na)',
};

function gradientHealthLabel(health: GradientHealth): string {
  return uiText(
    {
      healthy: 'Healthy',
      low: 'Very small',
      blocked: 'Blocked',
      exploding: 'Exploding',
      invalid: 'Not observed or invalid',
      'not-applicable': 'Not differentiable',
    }[health],
  );
}

export function signalStripAccessibilityProps(signalMode: 'forward' | 'backward') {
  const label = signalMode === 'backward' ? 'gradient' : 'forward tensor';
  return {
    tabIndex: 0,
    'aria-label': `Scrollable ${label} value cards. Use horizontal scrolling to inspect every connection.`,
  } as const;
}

export function backwardSignalNote(model: ModelSpec, probe: GradientProbeName): string {
  const scenarioKind = model.connections[0]?.gradient.scenarioKinds[probe] ?? 'design-only';
  const lossName = model.gradientEvidence?.loss.name.replaceAll('_', '-');
  if (lossName && scenarioKind === 'pytorch-observed') {
    return uiText('Arrows run from the observed {loss} probe objective toward model inputs.', {
      loss: lossName,
    });
  }
  if (lossName && scenarioKind === 'synthetic-stress') {
    return uiText(
      'Arrows show a synthetic stress transform anchored to the observed {loss} probe receipt.',
      { loss: lossName },
    );
  }
  const hasDeclaredObjective = model.modules.some((module) =>
    /(?:probe loss|cross-entropy|\\mathcal\s*L)/iu.test(
      `${module.name} ${module.activation ?? ''} ${module.formula}`,
    ),
  );
  return uiText(
    hasDeclaredObjective
      ? 'Arrows follow the declared loss objective toward inputs; no observed runtime loss receipt is attached.'
      : 'Arrows show intended output-to-input direction; no explicit loss objective or runtime receipt is attached.',
  );
}

export function gradientStrokeWidth(gradient: number, state: GradientObservationState): number {
  if (state !== 'observed' || !Number.isFinite(gradient)) return 2;
  return Math.max(1.5, Math.min(5, 1.6 + Math.log10(Math.max(gradient, 1e-9)) + 3));
}

export type GraphNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

const graphNavigationKeys: readonly GraphNavigationKey[] = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
];

type ModelGraphProps = Readonly<{
  composition: ModelGraphComposition;
  selectedModuleId: string;
  probe: GradientProbeName;
  checkpointIndex: number;
  signalMode: 'forward' | 'backward';
  focusMode: boolean;
  changeHighlight?: ModelGraphChangeHighlight | null;
  openModuleId: string | null;
  onSelectModule: (moduleId: string) => void;
  onOpenModule: (module: ModelModule, graphModel: ModelSpec) => void;
  onToggleSubgraph: (moduleId: string) => void;
}>;

export function modelGraphFitViewOptions(focusMode: boolean) {
  return focusMode
    ? { padding: 0.025, minZoom: 0.64, maxZoom: 1.1 }
    : { padding: 0.045, maxZoom: 1.18 };
}

export function modelGraphViewportKey(
  modelId: string,
  openBlockId: string | null,
  resetNonce: number,
) {
  return JSON.stringify([modelId, openBlockId, resetNonce]);
}

function graphPosition(stage: number, lane: number, laneY: ReadonlyMap<number, number>) {
  return { x: 44 + stage * 390, y: laneY.get(lane) ?? 260 + lane * 245 };
}

const subgraphColumns = 5;
const subgraphColumnGap = 310;
const subgraphHeaderHeight = 76;
const subgraphPadding = 32;
const formulaCardVerticalPadding = 58;

export function estimatedFormulaRowLines(row: string) {
  const physicalLines = row.split(/\r?\n/u).length;
  const latexRows = (row.match(/\\\\/gu)?.length ?? 0) + 1;
  return Math.max(1, physicalLines, latexRows);
}

export function estimatedModuleCardHeight(module: ModelModule) {
  const rows = formulaDisplayRows(module.formula);
  const visualFormulaLines = rows.reduce((total, row) => total + estimatedFormulaRowLines(row), 0);
  return 132 + visualFormulaLines * 27 + (module.repeat ? 68 : 0);
}

export function formulaAwareGridPositions(modules: readonly ModelModule[]) {
  const positions: Array<{ x: number; y: number }> = [];
  let y = subgraphHeaderHeight + subgraphPadding;
  for (let rowStart = 0; rowStart < modules.length; rowStart += subgraphColumns) {
    const rowModules = modules.slice(rowStart, rowStart + subgraphColumns);
    const rowIndex = Math.floor(rowStart / subgraphColumns);
    const rowHeight = Math.max(...rowModules.map(estimatedModuleCardHeight), 0);
    rowModules.forEach((_module, offset) => {
      const column = rowIndex % 2 === 0 ? offset : subgraphColumns - 1 - offset;
      positions[rowStart + offset] = {
        x: subgraphPadding + column * subgraphColumnGap,
        y,
      };
    });
    y += rowHeight + formulaCardVerticalPadding;
  }
  return positions;
}

export function formulaAwareLanePositions(modules: readonly ModelModule[]) {
  const lanes = [...new Set(modules.map((module) => module.lane))].sort(
    (left, right) => left - right,
  );
  const positions = new Map<number, number>();
  let y = 260;
  for (const lane of lanes) {
    positions.set(lane, y);
    const laneHeight = Math.max(
      ...modules.filter((module) => module.lane === lane).map(estimatedModuleCardHeight),
      0,
    );
    y += laneHeight + formulaCardVerticalPadding;
  }
  return positions;
}

export type NestedSubgraphExpansion = Readonly<{
  boundaryId: string;
  parentModuleId: string;
  parentModuleName: string;
  modelId: string;
  modelName: string;
  moduleIds: readonly string[];
  depth: number;
}>;

export type ModelGraphComposition = Readonly<{
  model: ModelSpec;
  expansions: readonly NestedSubgraphExpansion[];
  subgraphTargets: Readonly<
    Record<string, Readonly<{ modelId: string; modelName: string; moduleCount: number }>>
  >;
}>;

export type RepeatedBlockDetail = Readonly<{
  id: string;
  label: string;
  repeatCount: number | string;
  summaryModuleId: string;
  selectionModuleId: string;
  memberModuleIds: readonly string[];
  omittedStepCount: number;
  detailKind: 'modules' | 'steps' | 'semantic blocks';
  detailModel: ModelSpec;
}>;

export const MAX_REPEATED_DETAIL_STEPS = 200;

export type RepeatedBlockHierarchy = Readonly<{
  model: ModelSpec;
  blocks: readonly RepeatedBlockDetail[];
}>;

export function repeatedBlockSummaryId(blockId: string) {
  return `block:${blockId}`;
}

function withoutBlockMetadata(module: ModelModule, stageOffset: number): ModelModule {
  const { block: _block, repeat: _repeat, ...detailModule } = module;
  return { ...detailModule, stage: module.stage - stageOffset };
}

function repeatedStepCode(statement: string) {
  return statement.split(/\s+#/u, 1)[0]!.trim();
}

export type RepeatedLinearOperation = Readonly<{
  output: string;
  input: string;
  inputDimension: string;
  outputDimension: string;
}>;

export function parseRepeatedLinearOperation(statement: string): RepeatedLinearOperation | null {
  const code = repeatedStepCode(statement);
  const canonical = code.match(
    /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*Linear_?\{?\s*([A-Za-z0-9_]+)\s*(?:->|→)\s*([A-Za-z0-9_]+)\s*\}?\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\s*$/u,
  );
  const pythonLike = code.match(
    /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*Linear\s*\(\s*([A-Za-z0-9_]+)\s*,\s*([A-Za-z0-9_]+)\s*\)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\s*$/u,
  );
  const arrowStyle = code.match(
    /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*Linear\s*\(\s*([A-Za-z0-9_]+)\s*(?:->|→)\s*([A-Za-z0-9_]+)\s*\)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\s*$/u,
  );
  const match = canonical ?? pythonLike ?? arrowStyle;
  if (!match) return null;
  return {
    output: match[1]!,
    inputDimension: match[2]!,
    outputDimension: match[3]!,
    input: match[4]!,
  };
}

function repeatedSymbolLatex(symbol: string) {
  const known: Readonly<Record<string, string>> = {
    H: 'H',
    h: 'H',
    H1: 'H_1',
    h1: 'H_1',
    H1_new: String.raw`H_1^{\mathrm{new}}`,
    h1_new: String.raw`H_1^{\mathrm{new}}`,
    H2: 'H_2',
    h2: 'H_2',
    H3: 'H_3',
    h3: 'H_3',
    e_lambda: String.raw`e_\lambda`,
    lambda: String.raw`\lambda`,
    log_lam_mean: String.raw`m_\lambda`,
    tau: String.raw`\tau`,
  };
  return known[symbol] ?? String.raw`\mathrm{${symbol.replaceAll('_', '\\_')}}`;
}

function repeatedExpressionSymbols(expression: string) {
  const ignored = new Set(['dim', 'none', 'true', 'false']);
  return [...expression.matchAll(/[A-Za-z][A-Za-z0-9_]*/gu)]
    .map((match) => match[0]!)
    .filter((symbol) => !ignored.has(symbol.toLocaleLowerCase()))
    .filter((symbol, index, symbols) => symbols.indexOf(symbol) === index)
    .slice(0, 4);
}

function repeatedDimensionLatex(dimension: string) {
  if (/^(?:k|2k|4k)$/iu.test(dimension)) return dimension.toLocaleUpperCase();
  return /^[0-9]+[A-Za-z]+$/u.test(dimension)
    ? dimension
    : /^[0-9]+$/u.test(dimension)
      ? dimension
      : String.raw`\mathrm{${dimension.replaceAll('_', '\\_')}}`;
}

function repeatedLinearFormula(operation: RepeatedLinearOperation) {
  const inputDimension = repeatedDimensionLatex(operation.inputDimension);
  const outputDimension = repeatedDimensionLatex(operation.outputDimension);
  const input = repeatedSymbolLatex(operation.input);
  const output = repeatedSymbolLatex(operation.output);
  const weight =
    operation.inputDimension === '2d' && operation.outputDimension === '512'
      ? 'W_1'
      : operation.inputDimension === '512' && operation.outputDimension === '2d'
        ? 'W_2'
        : 'W';
  const bias = weight === 'W_1' ? 'b_1' : weight === 'W_2' ? 'b_2' : 'b';
  return String.raw`${output}\leftarrow\operatorname{Linear}_{${inputDimension}\to${outputDimension}}(${input})=${weight}${input}+${bias},\quad ${weight}\in\mathbb R^{${outputDimension}\times ${inputDimension}}`;
}

type RepeatedStepOperation =
  | Readonly<{ type: 'concat'; updated: boolean }>
  | Readonly<{ type: 'film-parameters' }>
  | Readonly<{
      type: 'generic-film-parameters';
      input: string;
      inputDimension: string;
      outputDimension: string;
    }>
  | Readonly<{ type: 'coefficient-slice' }>
  | Readonly<{ type: 'scale-slice' }>
  | Readonly<{ type: 'split' }>
  | Readonly<{ type: 'residual-update'; updated: boolean }>
  | Readonly<{ type: 'gelu'; symbol: string }>
  | Readonly<{ type: 'linear'; operation: RepeatedLinearOperation }>
  | Readonly<{ type: 'mlp-chain' }>
  | Readonly<{
      type: 'nested-mlp';
      output: string;
      input: string;
      inputDimension: string;
      hiddenDimension: string;
      outputDimension: string;
    }>
  | Readonly<{
      type: 'linear-after-norm';
      output: string;
      input: string;
      width: string;
    }>
  | Readonly<{ type: 'film'; residualScale: boolean }>
  | Readonly<{ type: 'generic-film'; output: string; input: string }>
  | Readonly<{ type: 'generic-concat'; output: string; inputs: string }>
  | Readonly<{ type: 'generic-norm'; output: string; input: string; width: string | null }>
  | Readonly<{ type: 'generic-sigmoid'; output: string; input: string }>
  | Readonly<{ type: 'generic-tanh'; output: string; input: string; scale: string }>
  | Readonly<{ type: 'slice'; output: string; input: string; slice: string }>
  | Readonly<{ type: 'residual'; output: string; coefficients: string }>
  | Readonly<{ type: 'gradient-projection'; output: string; residual: string }>
  | Readonly<{ type: 'buffer-init'; output: string }>
  | Readonly<{ type: 'buffer-append'; buffer: string; value: string }>
  | Readonly<{ type: 'residual-add' }>
  | Readonly<{ type: 'rmsnorm' }>
  | Readonly<{ type: 'channel-gate' }>
  | Readonly<{ type: 'tanh-saturation'; scale: string }>
  | Readonly<{ type: 'soft-threshold' }>
  | Readonly<{ type: 'generic-soft-threshold'; output: string; input: string; threshold: string }>
  | Readonly<{ type: 'lambda-scale'; output: string; input: string }>
  | Readonly<{ type: 'lasso-residual-correlation'; output: string; coefficients: string }>
  | Readonly<{ type: 'lasso-mlp-chain'; output: string }>
  | Readonly<{ type: 'unknown' }>;

function parseRepeatedStepOperation(statement: string): RepeatedStepOperation {
  const source = repeatedStepCode(statement);
  const normalized = source.toLocaleLowerCase();
  const concat = normalized.match(/^h3\s*=\s*concat\s*\(\s*(h1(?:_new)?)\s*,\s*h2\s*\)\s*$/u);
  if (concat) return { type: 'concat', updated: concat[1] === 'h1_new' };
  if (
    /^\[\s*gamma_j\s*,\s*delta_j\s*\]\s*=\s*split\s*\(\s*linear[\s\S]*\(\s*e_lambda\s*\)\s*,\s*2\s*\)\s*$/u.test(
      normalized,
    )
  ) {
    return { type: 'film-parameters' };
  }
  const genericFilmParameters = normalized.match(
    /^\[?\s*gamma(?:_j)?\s*,\s*delta(?:_j)?\s*\]?\s*=\s*(?:chunk|split)\s*\(\s*linear(?:\^\{?\([^)]*\)\}?)?\s*\(\s*([a-z0-9_]+)\s*(?:,|->|→)\s*([a-z0-9_]+)\s*\)\s*\(\s*([a-z][a-z0-9_]*)\s*\)\s*,\s*2(?:\s*,\s*dim\s*=\s*-?1)?\s*\)\s*$/u,
  );
  if (genericFilmParameters) {
    return {
      type: 'generic-film-parameters',
      inputDimension: genericFilmParameters[1]!,
      outputDimension: genericFilmParameters[2]!,
      input: genericFilmParameters[3]!,
    };
  }
  if (/^h1\s*=\s*h\[:,\s*:d\]\s*$/u.test(normalized)) return { type: 'coefficient-slice' };
  if (/^h2\s*=\s*h\[:,\s*d:\s*\]\s*$/u.test(normalized)) return { type: 'scale-slice' };
  if (/^h1\s*,\s*h2\s*=\s*split\s*\(\s*h\s*\)\s*$/u.test(normalized)) {
    return { type: 'split' };
  }
  const residualUpdate = normalized.match(
    /^(h1(?:_new)?)\s*=\s*x['’]\s*\(\s*y\s*-\s*x\s*h1\s*\)\s*\/\s*n\s*$/u,
  );
  if (residualUpdate) {
    return { type: 'residual-update', updated: residualUpdate[1] === 'h1_new' };
  }
  const lassoResidualCorrelation = source.match(
    /^([a-z][a-z0-9_]*)\s*=\s*x_c\.t\s*@\s*\(\s*broadcast_k\(y_c\)\s*-\s*x_c\s*@\s*([a-z][a-z0-9_]*)\s*\)\s*\/\s*n\s*$/iu,
  );
  if (lassoResidualCorrelation) {
    return {
      type: 'lasso-residual-correlation',
      output: lassoResidualCorrelation[1]!,
      coefficients: lassoResidualCorrelation[2]!,
    };
  }
  const lambdaScale = source.match(
    /^([a-z][a-z0-9_]*)\s*=\s*([a-z][a-z0-9_]*)\s*\/\s*lambda\s*$/iu,
  );
  if (lambdaScale) {
    return { type: 'lambda-scale', output: lambdaScale[1]!, input: lambdaScale[2]! };
  }
  const genericSoftThreshold = source.match(
    /^([a-z][a-z0-9_]*)\s*=\s*soft[_-]?threshold\s*\(\s*([a-z][a-z0-9_]*)\s*,\s*([\s\S]+)\)\s*$/iu,
  );
  const genericThresholdExpression = genericSoftThreshold?.[3]?.replace(/\s+/gu, '');
  if (
    genericSoftThreshold &&
    genericThresholdExpression &&
    (/^[a-z][a-z0-9_]*$/iu.test(genericThresholdExpression) ||
      /^exp\(h2\+log\(lambda\)-log_lam_mean\)$/iu.test(genericThresholdExpression))
  ) {
    return {
      type: 'generic-soft-threshold',
      output: genericSoftThreshold[1]!,
      input: genericSoftThreshold[2]!,
      threshold: genericThresholdExpression,
    };
  }
  const gelu = normalized.match(/^([a-z][a-z0-9_]*)\s*=\s*gelu\s*\(\s*([a-z][a-z0-9_]*)\s*\)\s*$/u);
  if (gelu && gelu[1] === gelu[2]) return { type: 'gelu', symbol: gelu[1]! };
  const linearAfterNorm = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*linear\s*\(\s*([a-z0-9_]+)\s*(?:,|->|→)\s*\2\s*\)\s*\(\s*rmsnorm(?:_[a-z0-9_]+)?\s*\(\s*([\s\S]+)\s*\)\s*\)\s*$/u,
  );
  if (linearAfterNorm) {
    return {
      type: 'linear-after-norm',
      output: linearAfterNorm[1]!,
      width: linearAfterNorm[2]!,
      input: linearAfterNorm[3]!.trim(),
    };
  }
  const linear = parseRepeatedLinearOperation(statement);
  if (linear) return { type: 'linear', operation: linear };
  const nestedMlp = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*linear\s*\(\s*([a-z0-9_]+)\s*(?:,|->|→)\s*([a-z0-9_]+)\s*\)\s*\(\s*gelu\s*\(\s*linear\s*\(\s*([a-z0-9_]+)\s*(?:,|->|→)\s*([a-z0-9_]+)\s*\)\s*\(\s*([a-z][a-z0-9_]*)\s*\)\s*\)\s*\)\s*$/u,
  );
  if (nestedMlp && nestedMlp[2] === nestedMlp[5]) {
    return {
      type: 'nested-mlp',
      output: nestedMlp[1]!,
      hiddenDimension: nestedMlp[2]!,
      outputDimension: nestedMlp[3]!,
      inputDimension: nestedMlp[4]!,
      input: nestedMlp[6]!,
    };
  }
  if (
    /^h3\s*=\s*linear\s*\(\s*2d\s*,\s*512\s*\)\s*(?:->|→)\s*gelu\s*(?:->|→)\s*linear\s*\(\s*512\s*,\s*2d\s*\)\s*$/u.test(
      normalized,
    )
  ) {
    return { type: 'mlp-chain' };
  }
  if (
    /^h3\s*=\s*linear\s*\(\s*2k\s*,\s*4k\s*\)\s*\(\s*h3\s*\)\s*(?:->|→)\s*gelu\s*(?:->|→)\s*rmsnorm\s*\(\s*4k\s*\)\s*(?:->|→)\s*linear\s*\(\s*4k\s*,\s*2k\s*\)\s*$/u.test(
      normalized,
    )
  ) {
    return { type: 'lasso-mlp-chain', output: 'h3' };
  }
  if (/^h3\s*=\s*film\s*\(\s*h3\s*,\s*log\s*\(\s*lambda\s*\)\s*\)\s*$/u.test(normalized)) {
    return { type: 'film', residualScale: true };
  }
  if (/^h3\s*=\s*\(\s*1\s*\+\s*gamma_j\s*\)\s*[*·×]\s*h3\s*\+\s*delta_j\s*$/u.test(normalized)) {
    return { type: 'film', residualScale: true };
  }
  const genericFilm = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*([a-z][a-z0-9_]*)\s*[*·×]\s*\(\s*1(?:\.0)?\s*\+\s*gamma(?:\[[^\]]+\])?\s*\)\s*\+\s*delta(?:\[[^\]]+\])?\s*$/u,
  );
  if (genericFilm) {
    return { type: 'generic-film', output: genericFilm[1]!, input: genericFilm[2]! };
  }
  const genericResidual = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*y(?:_query)?(?:\.unsqueeze\([^)]*\))?\s*-\s*(?:batch_matmul|bmm)\s*\(\s*x(?:_query)?\s*,\s*([a-z][a-z0-9_]*)\s*\)\s*$/u,
  );
  if (genericResidual) {
    return {
      type: 'residual',
      output: genericResidual[1]!,
      coefficients: genericResidual[2]!,
    };
  }
  const projectedGradient = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*(?:batch_matmul|bmm)\s*\(\s*(?:transpose\s*\(\s*x(?:_query)?\s*\)|x(?:_query)?\.transpose\([^)]*\))\s*,\s*([a-z][a-z0-9_]*)\s*\)\s*(?:\/\s*n|[*·×]\s*inv_n)\s*$/u,
  );
  if (projectedGradient) {
    return {
      type: 'gradient-projection',
      output: projectedGradient[1]!,
      residual: projectedGradient[2]!,
    };
  }
  const bufferInit = normalized.match(/^([a-z][a-z0-9_]*)\s*=\s*\[\s*\]\s*$/u);
  if (bufferInit) return { type: 'buffer-init', output: bufferInit[1]! };
  const bufferAppend = normalized.match(
    /^([a-z][a-z0-9_]*)\.append\s*\(\s*([a-z][a-z0-9_]*)\s*\)\s*$/u,
  );
  if (bufferAppend) {
    return { type: 'buffer-append', buffer: bufferAppend[1]!, value: bufferAppend[2]! };
  }
  if (/^h\s*=\s*rmsnorm(?:_?\{?2d\}?)?\s*\(\s*h\s*\)\s*$/u.test(normalized)) {
    return { type: 'rmsnorm' };
  }
  const constructorNorm = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*rmsnorm\s*\(\s*([a-z0-9_]+)\s*\)\s*\(\s*([a-z][a-z0-9_]*)\s*\)\s*$/u,
  );
  if (constructorNorm) {
    return {
      type: 'generic-norm',
      output: constructorNorm[1]!,
      width: constructorNorm[2]!,
      input: constructorNorm[3]!,
    };
  }
  const genericNorm = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*rmsnorm(?:_([a-z0-9_]+))?\s*\(\s*([\s\S]+)\s*\)\s*$/u,
  );
  if (genericNorm) {
    return {
      type: 'generic-norm',
      output: genericNorm[1]!,
      width: genericNorm[2] ?? null,
      input: genericNorm[3]!.trim(),
    };
  }
  const genericSigmoid = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*sigmoid\s*\(\s*([\s\S]+?)\s*\)\s*$/u,
  );
  if (genericSigmoid) {
    return { type: 'generic-sigmoid', output: genericSigmoid[1]!, input: genericSigmoid[2]! };
  }
  const genericTanh = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*(\d+(?:\.\d+)?)\s*[*·×]\s*tanh\s*\(\s*([\s\S]+?)\s*\/\s*(\d+(?:\.\d+)?)\s*\)\s*$/u,
  );
  if (genericTanh && Number(genericTanh[2]) === Number(genericTanh[4])) {
    return {
      type: 'generic-tanh',
      output: genericTanh[1]!,
      scale: genericTanh[2]!,
      input: genericTanh[3]!,
    };
  }
  const genericConcat = normalized.match(
    /^([a-z][a-z0-9_]*)\s*=\s*concat\s*\(\s*([\s\S]+?)(?:\s*,\s*dim\s*=\s*-?\d+)?\s*\)\s*$/u,
  );
  if (genericConcat) {
    return { type: 'generic-concat', output: genericConcat[1]!, inputs: genericConcat[2]!.trim() };
  }
  const slice = normalized.match(/^([a-z][a-z0-9_]*)\s*=\s*([a-z][a-z0-9_]*)\[([^\]]+)\]\s*$/u);
  if (slice) {
    return { type: 'slice', output: slice[1]!, input: slice[2]!, slice: slice[3]!.trim() };
  }
  if (/^h\s*=\s*h\s*\+\s*h3\s*$/u.test(normalized)) return { type: 'residual-add' };
  if (/^h\s*=\s*rmsnorm(?:_?\{?2d\}?)?\s*\(\s*h\s*\)\s*$/u.test(normalized)) {
    return { type: 'rmsnorm' };
  }
  if (/^h\[:,\s*:d\]\s*\*=\s*sigmoid\s*\(\s*h\[:,\s*d:\s*\]\s*\)\s*$/u.test(normalized)) {
    return { type: 'channel-gate' };
  }
  const scale = repeatedTanhSaturationScale(statement);
  if (scale) return { type: 'tanh-saturation', scale };
  if (/^beta\s*=\s*soft-?threshold\s*\(\s*h\s*,\s*tau\s*\)\s*$/u.test(normalized)) {
    return { type: 'soft-threshold' };
  }
  return { type: 'unknown' };
}

function repeatedStepLocalShapes(
  statement: string,
  parentShape: TensorShape,
  previousStatement: string | undefined,
): Readonly<{ inputShape: TensorShape; outputShape: TensorShape }> {
  const operation = parseRepeatedStepOperation(statement);
  const prefix = parentShape.slice(0, -1);
  const dimension = (value: string) => (/^\d+$/u.test(value) ? Number(value) : value);
  if (operation.type === 'linear') {
    return {
      inputShape: [...prefix, dimension(operation.operation.inputDimension)],
      outputShape: [...prefix, dimension(operation.operation.outputDimension)],
    };
  }
  if (operation.type === 'nested-mlp') {
    return {
      inputShape: [...prefix, dimension(operation.inputDimension)],
      outputShape: [...prefix, dimension(operation.outputDimension)],
    };
  }
  if (operation.type === 'linear-after-norm') {
    const width = dimension(operation.width);
    return { inputShape: [...prefix, width], outputShape: [...prefix, width] };
  }
  if (operation.type === 'gelu' && previousStatement) {
    const previous = parseRepeatedStepOperation(previousStatement);
    if (previous.type === 'linear') {
      const width = dimension(previous.operation.outputDimension);
      return { inputShape: [...prefix, width], outputShape: [...prefix, width] };
    }
  }
  if (operation.type === 'coefficient-slice' || operation.type === 'scale-slice') {
    return { inputShape: parentShape, outputShape: [...prefix, 'd'] };
  }
  if (operation.type === 'residual-update') {
    return { inputShape: [...prefix, 'd'], outputShape: [...prefix, 'd'] };
  }
  if (operation.type === 'concat') {
    return { inputShape: [...prefix, 'd ⊕ d'], outputShape: parentShape };
  }
  if (
    operation.type === 'generic-soft-threshold' ||
    operation.type === 'lambda-scale' ||
    operation.type === 'lasso-residual-correlation'
  ) {
    return { inputShape: [...prefix, 'K'], outputShape: [...prefix, 'K'] };
  }
  if (operation.type === 'generic-norm' && operation.width?.toLocaleLowerCase() === 'k') {
    return { inputShape: [...prefix, 'K'], outputShape: [...prefix, 'K'] };
  }
  if (operation.type === 'lasso-mlp-chain') {
    return { inputShape: parentShape, outputShape: parentShape };
  }
  if (operation.type === 'slice' && /(?:^|:)k(?::|$)/iu.test(operation.slice)) {
    return { inputShape: parentShape, outputShape: [...prefix, 'K'] };
  }
  if (
    (operation.type === 'slice' && /32/u.test(operation.slice)) ||
    (operation.type === 'generic-sigmoid' && /32/u.test(operation.input)) ||
    (operation.type === 'generic-tanh' && /32/u.test(operation.input))
  ) {
    return { inputShape: parentShape, outputShape: [...prefix, 32] };
  }
  return { inputShape: parentShape, outputShape: parentShape };
}

export function repeatedStepName(statement: string, index: number) {
  const operation = parseRepeatedStepOperation(statement);
  switch (operation.type) {
    case 'concat':
      return 'Recombine updated hidden state';
    case 'film-parameters':
    case 'generic-film-parameters':
      return 'Generate FiLM parameters';
    case 'coefficient-slice':
      return 'Extract coefficient channels';
    case 'scale-slice':
      return 'Extract scale / threshold channels';
    case 'split':
      return 'Split hidden state';
    case 'residual-update':
      return 'Residual / gradient update';
    case 'gelu':
      return 'GELU activation';
    case 'linear': {
      const { output, inputDimension, outputDimension } = operation.operation;
      if (
        output.toLocaleLowerCase() === 'h3' &&
        inputDimension === '2d' &&
        outputDimension === '512'
      ) {
        return 'Expand hidden channels';
      }
      if (
        output.toLocaleLowerCase() === 'h3' &&
        inputDimension === '512' &&
        outputDimension === '2d'
      ) {
        return 'Project back to 2d';
      }
      return `Linear ${inputDimension} → ${outputDimension}`;
    }
    case 'mlp-chain':
      return 'Residual MLP';
    case 'nested-mlp':
      return `Residual MLP ${operation.inputDimension} → ${operation.hiddenDimension} → ${operation.outputDimension}`;
    case 'linear-after-norm':
      return 'Normalize and project state';
    case 'film':
    case 'generic-film':
      return 'FiLM conditioning';
    case 'generic-concat':
      return 'Concatenate state tensors';
    case 'generic-norm':
      return 'Normalize residual state';
    case 'generic-sigmoid':
      return 'Compute channel gate';
    case 'generic-tanh':
      return 'Bound auxiliary channels';
    case 'slice':
      return 'Slice tensor channels';
    case 'residual':
      return 'Compute regression residual';
    case 'gradient-projection':
      return 'Project residual gradient';
    case 'buffer-init':
      return 'Initialize chunk buffer';
    case 'buffer-append':
      return 'Collect mapped chunk';
    case 'residual-add':
      return 'Residual add';
    case 'rmsnorm':
      return 'Normalize state';
    case 'channel-gate':
      return 'Channel gate';
    case 'tanh-saturation':
      return 'Soft saturation';
    case 'soft-threshold':
    case 'generic-soft-threshold':
      return 'Adaptive threshold';
    case 'lambda-scale':
      return 'Lambda scaling';
    case 'lasso-residual-correlation':
      return 'Residual-correlation reprojection';
    case 'lasso-mlp-chain':
      return '2K → 4K → 2K correction MLP';
    case 'unknown':
      return `Custom operation · step ${index + 1}`;
  }
}

function repeatedStepKind(statement: string): ModelModule['kind'] {
  const operation = parseRepeatedStepOperation(statement);
  if (
    operation.type === 'rmsnorm' ||
    operation.type === 'generic-norm' ||
    operation.type === 'linear-after-norm'
  ) {
    return 'normalization';
  }
  if (
    operation.type === 'gelu' ||
    operation.type === 'channel-gate' ||
    operation.type === 'generic-sigmoid' ||
    operation.type === 'tanh-saturation' ||
    operation.type === 'generic-tanh' ||
    operation.type === 'soft-threshold' ||
    operation.type === 'generic-soft-threshold'
  ) {
    return 'activation';
  }
  if (
    operation.type === 'concat' ||
    operation.type === 'generic-concat' ||
    operation.type === 'film' ||
    operation.type === 'generic-film' ||
    operation.type === 'residual-add'
  ) {
    return 'merge';
  }
  return 'linear';
}

function repeatedStepActivation(statement: string) {
  const operation = parseRepeatedStepOperation(statement);
  if (
    operation.type === 'gelu' ||
    operation.type === 'mlp-chain' ||
    operation.type === 'nested-mlp'
  ) {
    return 'GELU';
  }
  if (
    operation.type === 'rmsnorm' ||
    operation.type === 'generic-norm' ||
    operation.type === 'linear-after-norm'
  ) {
    return 'RMSNorm';
  }
  if (operation.type === 'channel-gate' || operation.type === 'generic-sigmoid') return 'sigmoid';
  if (operation.type === 'tanh-saturation' || operation.type === 'generic-tanh') return 'tanh';
  if (operation.type === 'soft-threshold' || operation.type === 'generic-soft-threshold') {
    return 'soft-threshold';
  }
  if (operation.type === 'lasso-mlp-chain') return 'GELU + RMSNorm';
  return null;
}

export function repeatedTanhSaturationScale(statement: string): string | null {
  const code = repeatedStepCode(statement);
  const match = code.match(
    /^h\[:,\s*d:\s*\]\s*(?:=|←|<-)\s*(\d+(?:\.\d+)?)\s*[*·×]\s*tanh\s*\(\s*h\[:,\s*d:\s*\]\s*\/\s*(\d+(?:\.\d+)?)\s*\)\s*$/iu,
  );
  if (!match) return null;
  const multiplier = Number(match[1]);
  const divisor = Number(match[2]);
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier !== divisor) return null;
  return match[1] ?? null;
}

export function repeatedStepFormula(statement: string, index: number) {
  const operation = parseRepeatedStepOperation(statement);
  if (operation.type === 'concat') {
    return operation.updated
      ? String.raw`H_3=\operatorname{concat}(H_1^{\mathrm{new}},H_2)`
      : String.raw`H_3=\operatorname{concat}(H_1,H_2)`;
  }
  if (operation.type === 'film-parameters') {
    return String.raw`[\gamma^{(j)},\delta^{(j)}]=\operatorname{split}\!\left(\operatorname{Linear}_{256\to128}(e_\lambda),2\right)`;
  }
  if (operation.type === 'generic-film-parameters') {
    const input = repeatedSymbolLatex(operation.input);
    const inputDimension = repeatedDimensionLatex(operation.inputDimension);
    const outputDimension = repeatedDimensionLatex(operation.outputDimension);
    return String.raw`[\gamma,\delta]\leftarrow\operatorname{chunk}_2\!\left(\operatorname{Linear}_{${inputDimension}\to${outputDimension}}(${input})\right)`;
  }
  if (operation.type === 'coefficient-slice') return String.raw`H_1=H_{:,:d}`;
  if (operation.type === 'scale-slice') return String.raw`H_2=H_{:,d:}`;
  if (operation.type === 'split') {
    return String.raw`H_1=H_{:,:d},\qquad H_2=H_{:,d:}`;
  }
  if (operation.type === 'residual-update') {
    return operation.updated
      ? String.raw`H_1^{\mathrm{new}}=X^{\top}(y-XH_1)/N`
      : String.raw`H_1\leftarrow X^{\top}(y-XH_1)/N`;
  }
  if (operation.type === 'gelu') {
    const symbol = repeatedSymbolLatex(operation.symbol.toLocaleUpperCase());
    return String.raw`${symbol}\leftarrow\operatorname{GELU}(${symbol})`;
  }
  if (operation.type === 'linear') return repeatedLinearFormula(operation.operation);
  if (operation.type === 'nested-mlp') {
    const output = repeatedSymbolLatex(operation.output);
    const input = repeatedSymbolLatex(operation.input);
    return String.raw`${output}\leftarrow\operatorname{Linear}_{${operation.hiddenDimension}\to${operation.outputDimension}}\!\left(\operatorname{GELU}\!\left(\operatorname{Linear}_{${operation.inputDimension}\to${operation.hiddenDimension}}(${input})\right)\right)`;
  }
  if (operation.type === 'linear-after-norm') {
    const output = repeatedSymbolLatex(operation.output);
    const inputs = repeatedExpressionSymbols(operation.input).map(repeatedSymbolLatex);
    const state = inputs.length > 0 ? inputs.join('+') : 'H';
    return String.raw`${output}\leftarrow\operatorname{Linear}_{${operation.width}\to${operation.width}}\!\left(\operatorname{RMSNorm}_{${operation.width}}(${state})\right)`;
  }
  if (operation.type === 'film') {
    return String.raw`H_3\leftarrow(1+\gamma^{(j)})\odot H_3+\delta^{(j)}`;
  }
  if (operation.type === 'generic-film') {
    const output = repeatedSymbolLatex(operation.output);
    const input = repeatedSymbolLatex(operation.input);
    return String.raw`${output}\leftarrow(1+\gamma_{:,1,:})\odot${input}+\delta_{:,1,:}`;
  }
  if (operation.type === 'mlp-chain') {
    return String.raw`H_3\leftarrow\operatorname{Linear}_{512\to2d}\!\left(\operatorname{GELU}\!\left(\operatorname{Linear}_{2d\to512}(H_3)\right)\right)`;
  }
  if (operation.type === 'residual-add') {
    return String.raw`H\leftarrow H+H_3`;
  }
  if (operation.type === 'rmsnorm') {
    return String.raw`H\leftarrow\operatorname{RMSNorm}_{2d}(H)`;
  }
  if (operation.type === 'channel-gate') {
    return String.raw`H_{:,:d}\leftarrow H_{:,:d}\odot\sigma(H_{:,d:})`;
  }
  if (operation.type === 'generic-concat') {
    const output = repeatedSymbolLatex(operation.output);
    const inputs = repeatedExpressionSymbols(operation.inputs).map(repeatedSymbolLatex);
    const operands = inputs.length > 0 ? inputs.join(',') : String.raw`\mathrm{tensors}`;
    return String.raw`${output}\leftarrow\operatorname{concat}\!\left(${operands}\right)`;
  }
  if (operation.type === 'generic-norm') {
    const output = repeatedSymbolLatex(operation.output);
    const inputs = repeatedExpressionSymbols(operation.input).map(repeatedSymbolLatex);
    const state = inputs.length > 0 ? inputs.join('+') : 'H';
    const width = operation.width ? `_{${repeatedDimensionLatex(operation.width)}}` : '';
    return String.raw`${output}\leftarrow\operatorname{RMSNorm}${width}\!\left(${state}\right)`;
  }
  if (operation.type === 'generic-sigmoid') {
    const output = repeatedSymbolLatex(operation.output);
    const [input = 'H'] = repeatedExpressionSymbols(operation.input).map(repeatedSymbolLatex);
    return String.raw`${output}\leftarrow\sigma(${input})`;
  }
  if (operation.type === 'generic-tanh') {
    const output = repeatedSymbolLatex(operation.output);
    const [input = 'H'] = repeatedExpressionSymbols(operation.input).map(repeatedSymbolLatex);
    return String.raw`${output}\leftarrow${operation.scale}\tanh\!\left(${input}/${operation.scale}\right)`;
  }
  if (operation.type === 'slice') {
    const output = repeatedSymbolLatex(operation.output);
    const input = repeatedSymbolLatex(operation.input);
    return String.raw`${output}\leftarrow\operatorname{slice}_{\mathrm{channels}}(${input})`;
  }
  if (operation.type === 'residual') {
    const output = repeatedSymbolLatex(operation.output);
    const coefficients = repeatedSymbolLatex(operation.coefficients);
    return String.raw`${output}\leftarrow y-X${coefficients}`;
  }
  if (operation.type === 'gradient-projection') {
    const output = repeatedSymbolLatex(operation.output);
    const residual = repeatedSymbolLatex(operation.residual);
    return String.raw`${output}\leftarrow X^{\top}${residual}/N`;
  }
  if (operation.type === 'buffer-init') {
    const output = repeatedSymbolLatex(operation.output);
    return String.raw`${output}\leftarrow[\,]`;
  }
  if (operation.type === 'buffer-append') {
    const buffer = repeatedSymbolLatex(operation.buffer);
    const value = repeatedSymbolLatex(operation.value);
    return String.raw`${buffer}\leftarrow\operatorname{append}(${buffer},${value})`;
  }
  if (operation.type === 'tanh-saturation') {
    const scale = operation.scale;
    return scale
      ? String.raw`H_{:,d:}\leftarrow${scale}\tanh\!\left(H_{:,d:}/${scale}\right)`
      : String.raw`H_{:,d:}\leftarrow s\tanh\!\left(H_{:,d:}/s\right)`;
  }
  if (operation.type === 'soft-threshold') {
    return String.raw`\beta\leftarrow\operatorname{SoftThreshold}(H,\tau)`;
  }
  if (operation.type === 'generic-soft-threshold') {
    const output = repeatedSymbolLatex(operation.output);
    const input = repeatedSymbolLatex(operation.input);
    const threshold =
      operation.threshold.toLocaleLowerCase() === 'exp(h2+log(lambda)-log_lam_mean)'
        ? String.raw`\exp(H_2+\log\lambda-m_\lambda)`
        : repeatedSymbolLatex(operation.threshold);
    return String.raw`${output}\leftarrow\operatorname{ST}\!\left(${input};${threshold}\right)`;
  }
  if (operation.type === 'lambda-scale') {
    const output = repeatedSymbolLatex(operation.output);
    const input = repeatedSymbolLatex(operation.input);
    return String.raw`${output}\leftarrow${input}\oslash\lambda`;
  }
  if (operation.type === 'lasso-residual-correlation') {
    const output = repeatedSymbolLatex(operation.output);
    const coefficients = repeatedSymbolLatex(operation.coefficients);
    return String.raw`${output}\leftarrow X_c^\top(y_c\mathbf 1_K^\top-X_c${coefficients})/N`;
  }
  if (operation.type === 'lasso-mlp-chain') {
    return String.raw`H_3\leftarrow\operatorname{Linear}_{4K\to2K}\!\left(\operatorname{RMSNorm}_{4K}\!\left(\operatorname{GELU}\!\left(\operatorname{Linear}_{2K\to4K}(H_3)\right)\right)\right)`;
  }
  return String.raw`\text{Equation not deterministically derived from step ${index + 1}}`;
}

function designOnlyStepGradient(): ModelConnection['gradient'] {
  const notObserved = Array.from({ length: 5 }, (): GradientObservationState => 'not-observed');
  const zero = [0, 0, 0, 0, 0];
  return {
    checkpoints: [1, 2, 3, 4, 5],
    healthy: zero,
    vanishing: zero,
    detached: zero,
    exploding: zero,
    states: {
      healthy: notObserved,
      vanishing: notObserved,
      detached: notObserved,
      exploding: notObserved,
    },
    scenarioKinds: {
      healthy: 'design-only',
      vanishing: 'design-only',
      detached: 'design-only',
      exploding: 'design-only',
    },
    scenarioLabels: {
      healthy: 'No runtime receipt exists for this synthesized loop step',
      vanishing: 'No runtime receipt exists for this synthesized loop step',
      detached: 'No runtime receipt exists for this synthesized loop step',
      exploding: 'No runtime receipt exists for this synthesized loop step',
    },
  };
}

type RepeatedSemanticStep = Readonly<{
  name: string;
  transform: string;
  formula: string;
  explanation: string;
  kind: ModelModule['kind'];
  activation: string | null;
  inputShape: TensorShape;
  outputShape: TensorShape;
  inputPorts?: ModelModule['inputPorts'];
  outputPorts?: ModelModule['outputPorts'];
}>;

export function lassoRefinementSemanticSteps(
  module: Pick<ModelModule, 'id' | 'transform' | 'outputShape'>,
): readonly RepeatedSemanticStep[] | null {
  const statements = repeatedModuleStepStatements(module);
  if (statements.length !== 10) return null;
  const compact = statements.map((statement) =>
    repeatedStepCode(statement).toLocaleLowerCase().replace(/\s+/gu, ''),
  );
  if (
    !/^h=linear\(2k,2k\)\(h\)$/u.test(compact[0]!) ||
    !/^h1=h\[:,:k\]$/u.test(compact[1]!) ||
    !/^h2=h\[:,k:\]$/u.test(compact[2]!) ||
    !/^h1=soft[_-]?threshold\(h1,exp\(h2\+log\(lambda\)-log_lam_mean\)\)$/u.test(compact[3]!) ||
    !/^h1=x_c\.t@\(broadcast_k\(y_c\)-x_c@h1\)\/n$/u.test(compact[4]!) ||
    !/^h1=h1\/lambda$/u.test(compact[5]!) ||
    !/^h1=rmsnorm\(k\)\(h1\)$/u.test(compact[6]!) ||
    !/^h3=concat\(\[h1,h2\],dim=1\)$/u.test(compact[7]!) ||
    !/^h3=linear\(2k,4k\)\(h3\)→gelu→rmsnorm\(4k\)→linear\(4k,2k\)$/u.test(compact[8]!) ||
    !/^h=h\+h3$/u.test(compact[9]!)
  ) {
    return null;
  }
  const stateShape = module.outputShape;
  const pathShape: TensorShape = [...stateShape.slice(0, -1), 'K'];
  return [
    {
      name: 'State projection + K/K split',
      transform: statements.slice(0, 3).map(repeatedStepCode).join('\n'),
      formula: String.raw`\widetilde H_j=\operatorname{Linear}_{2K\to2K}(H_{j-1})
A_j=\widetilde H_{j,:,:K},\qquad F_j=\widetilde H_{j,:,K:}`,
      explanation:
        'Projects the previous 2K-channel state, then splits it into K candidate-coefficient channels Aⱼ and K free threshold-state channels Fⱼ.',
      kind: 'linear',
      activation: null,
      inputShape: stateShape,
      outputShape: stateShape,
      inputPorts: [
        {
          name: 'Hⱼ₋₁',
          shape: stateShape,
          binding: 'loop-carried',
          bindingId: module.id,
        },
      ],
      outputPorts: [
        { name: 'H̃ⱼ', shape: stateShape },
        { name: 'Aⱼ', shape: pathShape },
        { name: 'Fⱼ', shape: pathShape },
      ],
    },
    {
      name: 'Lambda-conditioned soft threshold',
      transform: repeatedStepCode(statements[3]!),
      formula: String.raw`T_j=\exp(F_j+\log\lambda-m_\lambda)
\widehat\beta_j=\operatorname{ST}(A_j;T_j)`,
      explanation:
        'Applies the RTF-declared lambda-conditioned pointwise soft threshold. This is design-source evidence; the executable newmodel4 implementation uses raw log-lambda without mλ.',
      kind: 'activation',
      activation: 'soft-threshold',
      inputShape: pathShape,
      outputShape: pathShape,
      inputPorts: [
        { name: 'Aⱼ', shape: pathShape },
        { name: 'Fⱼ', shape: pathShape },
        { name: 'λ', shape: [1, 'K'], binding: 'external' },
        { name: 'mλ', shape: [1, 1], binding: 'external' },
      ],
      outputPorts: [{ name: 'β̂ⱼ', shape: pathShape }],
    },
    {
      name: 'Normalized LASSO reprojection',
      transform: statements.slice(4, 7).map(repeatedStepCode).join('\n'),
      formula: String.raw`G_j=\frac{X_c^\top(y_c\mathbf 1_K^\top-X_c\widehat\beta_j)}{N\lambda}
R_j=\operatorname{RMSNorm}_K(G_j)`,
      explanation:
        'Computes the residual correlation for all K paths, divides columnwise by lambda, and applies RMSNorm over the K path channels.',
      kind: 'normalization',
      activation: 'RMSNorm',
      inputShape: pathShape,
      outputShape: pathShape,
      inputPorts: [
        { name: 'β̂ⱼ', shape: pathShape },
        { name: 'X_c', shape: ['N', 'P'], binding: 'external' },
        { name: 'y_c', shape: ['N', 1], binding: 'external' },
        { name: 'λ', shape: [1, 'K'], binding: 'external' },
      ],
      outputPorts: [{ name: 'Rⱼ', shape: pathShape }],
    },
    {
      name: 'Residual MLP fusion + state update',
      transform: statements.slice(7, 10).map(repeatedStepCode).join('\n'),
      formula: String.raw`Z_j=[R_j,F_j]
C_j=\operatorname{Linear}_{4K\to2K}\!\left(\operatorname{RMSNorm}_{4K}\!\left(\operatorname{GELU}\!\left(\operatorname{Linear}_{2K\to4K}(Z_j)\right)\right)\right)
H_j=\widetilde H_j+C_j`,
      explanation:
        'Concatenates the normalized reprojection with the retained free channels, applies the complete correction MLP, and adds it to the projected-state skip path.',
      kind: 'merge',
      activation: 'GELU + RMSNorm',
      inputShape: pathShape,
      outputShape: stateShape,
      inputPorts: [
        { name: 'Rⱼ', shape: pathShape },
        { name: 'Fⱼ', shape: pathShape },
        { name: 'H̃ⱼ skip', shape: stateShape },
      ],
      outputPorts: [
        { name: 'Hⱼ', shape: stateShape, binding: 'loop-carried', bindingId: module.id },
      ],
    },
  ];
}

function repeatedModuleDetail(model: ModelSpec, module: ModelModule): RepeatedBlockDetail | null {
  if (!module.repeat || module.block) return null;
  const statements = repeatedModuleStepStatements(module);
  if (statements.length < 2) return null;
  const homogeneousUnknown = homogeneousUnknownRepeatSignature(module);
  const semanticSteps =
    lassoRefinementSemanticSteps(module) ??
    (homogeneousUnknown
      ? [
          {
            name: `${module.name} operator`,
            transform: repeatedStepCode(statements[0]!),
            formula: module.formula,
            explanation: module.explanation,
            kind: module.kind,
            activation: module.activation,
            inputShape: module.inputShape,
            outputShape: module.outputShape,
            inputPorts: module.inputPorts,
            outputPorts: module.outputPorts,
          },
        ]
      : null);
  const visibleStatements = semanticSteps ? [] : statements.slice(0, MAX_REPEATED_DETAIL_STEPS);
  const detailStepCount = semanticSteps?.length ?? visibleStatements.length;
  const memberModuleIds = Array.from(
    { length: detailStepCount },
    (_statement, index) => `repeat-step:${module.id}:${index + 1}`,
  );
  const modules: ModelModule[] = semanticSteps
    ? semanticSteps.map((step, index) => ({
        id: memberModuleIds[index]!,
        name: step.name,
        kind: step.kind,
        group: `FOR-LOOP · semantic block ${index + 1}`,
        stage: index,
        lane: 0,
        inputShape: step.inputShape,
        outputShape: step.outputShape,
        ...(step.inputPorts ? { inputPorts: step.inputPorts } : {}),
        ...(step.outputPorts ? { outputPorts: step.outputPorts } : {}),
        transform: step.transform,
        activation: step.activation,
        formula: step.formula,
        explanation: step.explanation,
        parameterCount: 0,
        codeReference: module.codeReference,
      }))
    : visibleStatements.map((statement, index) => {
        const operation = repeatedStepCode(statement);
        const localShapes = repeatedStepLocalShapes(
          statement,
          module.outputShape,
          visibleStatements[index - 1],
        );
        const annotation = statement
          .slice(operation.length)
          .replace(/^\s*#\s*/u, '')
          .trim();
        return {
          id: memberModuleIds[index]!,
          name: repeatedStepName(statement, index),
          kind: repeatedStepKind(statement),
          group: `FOR-LOOP · step ${index + 1}`,
          stage: index,
          lane: 0,
          inputShape: index === 0 ? module.inputShape : localShapes.inputShape,
          outputShape: localShapes.outputShape,
          transform: operation,
          activation: repeatedStepActivation(statement),
          formula: repeatedStepFormula(statement, index),
          explanation: [
            `Operation inside one ${module.repeat?.label} iteration: ${operation}.`,
            ...(annotation ? [`Pseudocode annotation: ${annotation}.`] : []),
          ].join(' '),
          parameterCount: 0,
          codeReference: module.codeReference,
        };
      });
  const semanticConnection = (
    suffix: string,
    sourceIndex: number,
    targetIndex: number,
    sourcePort: string,
    targetPort: string,
    tensorName: string,
    shape: TensorShape,
  ): ModelConnection => ({
    id: `repeat-edge:${module.id}:${suffix}`,
    source: modules[sourceIndex]!.id,
    target: modules[targetIndex]!.id,
    sourcePort,
    targetPort,
    tensorName,
    shape,
    activationNorm: 0,
    gradient: designOnlyStepGradient(),
    expectedToCarryGradient: true,
  });
  const connections: ModelConnection[] = semanticSteps
    ? semanticSteps.length === 1
      ? []
      : [
          semanticConnection(
            'candidate-channels',
            0,
            1,
            'Aⱼ',
            'Aⱼ',
            'Aⱼ candidate channels',
            semanticSteps[1]!.outputShape,
          ),
          semanticConnection(
            'free-channels-threshold',
            0,
            1,
            'Fⱼ',
            'Fⱼ',
            'Fⱼ threshold state',
            semanticSteps[1]!.outputShape,
          ),
          semanticConnection(
            'thresholded-coefficients',
            1,
            2,
            'β̂ⱼ',
            'β̂ⱼ',
            'β̂ⱼ thresholded coefficients',
            semanticSteps[2]!.inputShape,
          ),
          semanticConnection(
            'normalized-reprojection',
            2,
            3,
            'Rⱼ',
            'Rⱼ',
            'Rⱼ normalized reprojection',
            semanticSteps[3]!.inputShape,
          ),
          semanticConnection(
            'free-channels-mlp',
            0,
            3,
            'Fⱼ',
            'Fⱼ',
            'Fⱼ retained free channels',
            semanticSteps[3]!.inputShape,
          ),
          semanticConnection(
            'projected-state-skip',
            0,
            3,
            'H̃ⱼ',
            'H̃ⱼ skip',
            'H̃ⱼ projected-state skip',
            module.outputShape,
          ),
        ]
    : modules.slice(1).map((target, index) => ({
        id: `repeat-edge:${module.id}:${index + 1}`,
        source: modules[index]!.id,
        target: target.id,
        tensorName: `iteration state ${index + 1}`,
        shape: target.inputShape,
        activationNorm: 0,
        gradient: designOnlyStepGradient(),
        expectedToCarryGradient: true,
      }));
  return {
    id: `repeat:${module.id}`,
    label: module.repeat.label,
    repeatCount: module.repeat.count,
    summaryModuleId: module.id,
    selectionModuleId: module.id,
    memberModuleIds,
    omittedStepCount: semanticSteps ? 0 : statements.length - visibleStatements.length,
    detailKind: semanticSteps ? 'semantic blocks' : 'steps',
    detailModel: {
      ...model,
      id: `${model.id}::repeat::${module.id}`,
      name: `${module.name} · one loop iteration`,
      summary: semanticSteps
        ? `One expanded for-loop iteration of ${module.repeat.label}, grouped from ${statements.length} source operations into ${semanticSteps.length} semantic sub-blocks and repeated ${module.repeat.count} times.`
        : `One expanded for-loop iteration of ${module.repeat.label}, synthesized from ${statements.length} human-readable pseudocode steps and repeated ${module.repeat.count} times.`,
      intent: {
        ...model.intent,
        expectedInput: module.inputShape,
        expectedOutput: module.outputShape,
      },
      modules,
      connections,
      gradientEvidence: null,
    },
  };
}

export function composeRepeatedBlocks(model: ModelSpec): RepeatedBlockHierarchy {
  const grouped = new Map<string, ModelModule[]>();
  model.modules.forEach((module) => {
    if (!module.block) return;
    const members = grouped.get(module.block.id) ?? [];
    members.push(module);
    grouped.set(module.block.id, members);
  });

  const blockByMemberId = new Map<string, RepeatedBlockDetail>();
  const summaryByBlockId = new Map<string, ModelModule>();
  const blocks: RepeatedBlockDetail[] = [];

  grouped.forEach((unsortedMembers, blockId) => {
    const members = [...unsortedMembers].sort(
      (left, right) => left.stage - right.stage || left.lane - right.lane,
    );
    const descriptor = members[0]?.block;
    if (!descriptor || members.length < 2) return;
    if (
      members.some(
        (module) =>
          module.block?.label !== descriptor.label ||
          module.block.repeatCount !== descriptor.repeatCount,
      )
    ) {
      return;
    }
    const memberIds = new Set(members.map((module) => module.id));
    const incoming = model.connections.filter(
      (connection) => !memberIds.has(connection.source) && memberIds.has(connection.target),
    );
    const outgoing = model.connections.filter(
      (connection) => memberIds.has(connection.source) && !memberIds.has(connection.target),
    );
    const entry =
      members.find((module) => incoming.some((connection) => connection.target === module.id)) ??
      members[0]!;
    const exit =
      [...members]
        .reverse()
        .find((module) => outgoing.some((connection) => connection.source === module.id)) ??
      members.at(-1)!;
    const stageOffset = Math.min(...members.map((module) => module.stage));
    const detailModules = members.map((module) => withoutBlockMetadata(module, stageOffset));
    const detailConnections = model.connections.filter(
      (connection) => memberIds.has(connection.source) && memberIds.has(connection.target),
    );
    const summaryModuleId = repeatedBlockSummaryId(blockId);
    const detailModel: ModelSpec = {
      ...model,
      id: `${model.id}::block::${blockId}`,
      name: descriptor.label,
      summary: `One inspectable iteration of ${descriptor.label}, composed from ${members.length} internal modules and repeated ${descriptor.repeatCount} times.`,
      intent: {
        ...model.intent,
        expectedInput: entry.inputShape,
        expectedOutput: exit.outputShape,
      },
      modules: detailModules,
      connections: detailConnections,
    };
    const block: RepeatedBlockDetail = {
      id: blockId,
      label: descriptor.label,
      repeatCount: descriptor.repeatCount,
      summaryModuleId,
      selectionModuleId: members[0]!.id,
      memberModuleIds: members.map((module) => module.id),
      omittedStepCount: 0,
      detailKind: 'modules',
      detailModel,
    };
    const summary: ModelModule = {
      id: summaryModuleId,
      name: descriptor.label,
      kind: 'merge',
      group: 'COMPOSITE BLOCK',
      stage: stageOffset,
      lane: Math.min(...members.map((module) => module.lane)),
      inputShape: entry.inputShape,
      outputShape: exit.outputShape,
      transform: `${members.length} internal modules per iteration`,
      activation: null,
      formula: String.raw`h^{(t+1)}=\mathcal B_{\theta}\!\left(h^{(t)}\right)`,
      explanation: `Collapsed ${descriptor.label}. Open the block to inspect one iteration's internal modules and connections.`,
      parameterCount: members.reduce((total, module) => total + module.parameterCount, 0),
      codeReference: [...new Set(members.map((module) => module.codeReference))].join('; '),
      repeat: { count: descriptor.repeatCount, label: descriptor.label },
    };
    blocks.push(block);
    summaryByBlockId.set(blockId, summary);
    members.forEach((module) => blockByMemberId.set(module.id, block));
  });

  model.modules.forEach((module) => {
    const detail = repeatedModuleDetail(model, module);
    if (detail) blocks.push(detail);
  });

  if (blocks.length === 0) return { model, blocks };

  const emittedBlocks = new Set<string>();
  const collapsedModules = model.modules.flatMap((module) => {
    const block = blockByMemberId.get(module.id);
    if (!block) return [module];
    if (emittedBlocks.has(block.id)) return [];
    emittedBlocks.add(block.id);
    const summary = summaryByBlockId.get(block.id);
    return summary ? [summary] : [];
  });
  const visibleStages = [...new Set(collapsedModules.map((module) => module.stage))].sort(
    (left, right) => left - right,
  );
  const denseStage = new Map(visibleStages.map((stage, index) => [stage, index]));
  const modules = collapsedModules.map((module) => ({
    ...module,
    stage: denseStage.get(module.stage) ?? module.stage,
  }));
  const remappedConnections = model.connections.flatMap((connection) => {
    const sourceBlock = blockByMemberId.get(connection.source);
    const targetBlock = blockByMemberId.get(connection.target);
    if (sourceBlock && targetBlock && sourceBlock.id === targetBlock.id) return [];
    return [
      {
        ...connection,
        id: JSON.stringify(['block-edge', connection.id]),
        source: sourceBlock?.summaryModuleId ?? connection.source,
        target: targetBlock?.summaryModuleId ?? connection.target,
      },
    ];
  });
  const connectionByRoute = new Map<string, ModelConnection>();
  remappedConnections.forEach((connection) => {
    const route = JSON.stringify([connection.source, connection.target]);
    if (!connectionByRoute.has(route)) connectionByRoute.set(route, connection);
  });

  return { model: { ...model, modules, connections: [...connectionByRoute.values()] }, blocks };
}

export function modelFormulaAuditScope(models: readonly ModelSpec[]): readonly ModelSpec[] {
  const materialized = models.flatMap((model) => {
    const hierarchy = composeRepeatedBlocks(model);
    const expandedSubgraphIds = model.modules
      .filter((module) => module.subgraph)
      .map((module) => module.id);
    const composedSubgraphs = composeModelSubgraphs(model, models, expandedSubgraphIds).model;
    return [
      model,
      overviewModel(model, 'overview'),
      hierarchy.model,
      composedSubgraphs,
      ...hierarchy.blocks.map((block) => block.detailModel),
    ];
  });
  const seen = new Set<string>();
  return materialized.filter((model) => {
    const signature = JSON.stringify([
      model.id,
      model.modules.map((module) => [
        module.id,
        module.name,
        module.transform,
        module.activation,
        module.formula,
      ]),
    ]);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function nestedModuleId(parentModuleId: string, childModuleId: string) {
  return JSON.stringify([parentModuleId, childModuleId]);
}

function nestedConnectionId(parentModuleId: string, childConnectionId: string) {
  return JSON.stringify([parentModuleId, childConnectionId]);
}

export function composeModelSubgraphs(
  model: ModelSpec,
  modelRegistry: readonly ModelSpec[],
  expandedModuleIds: readonly string[],
): ModelGraphComposition {
  const registry = new Map(modelRegistry.map((candidate) => [candidate.id, candidate]));
  const expanded = new Set(expandedModuleIds);
  const modules: ModelModule[] = [...model.modules];
  const connections: ModelConnection[] = [...model.connections];
  const expansions: NestedSubgraphExpansion[] = [];
  const subgraphTargets: Record<
    string,
    Readonly<{ modelId: string; modelName: string; moduleCount: number }>
  > = {};

  const visit = (parentModule: ModelModule, depth: number, ancestry: ReadonlySet<string>) => {
    const reference = parentModule.subgraph;
    if (!reference) return;
    const childModel = registry.get(reference.modelId);
    if (!childModel || ancestry.has(childModel.id)) return;
    subgraphTargets[parentModule.id] = {
      modelId: childModel.id,
      modelName: childModel.name,
      moduleCount: childModel.modules.length,
    };
    if (!expanded.has(parentModule.id)) return;

    const childModules = childModel.modules.map((childModule) => ({
      ...childModule,
      id: nestedModuleId(parentModule.id, childModule.id),
      group: `${childModel.name} · ${childModule.group}`,
      lane: parentModule.lane + 2 + depth * 2 + childModule.lane,
    }));
    const childIdByOriginalId = new Map(
      childModel.modules.map((childModule, index) => [childModule.id, childModules[index]!.id]),
    );
    const childConnections = childModel.connections.flatMap((connection) => {
      const source = childIdByOriginalId.get(connection.source);
      const target = childIdByOriginalId.get(connection.target);
      return source && target
        ? [
            {
              ...connection,
              id: nestedConnectionId(parentModule.id, connection.id),
              source,
              target,
            },
          ]
        : [];
    });
    modules.push(...childModules);
    connections.push(...childConnections);
    expansions.push({
      boundaryId: JSON.stringify(['subgraph', parentModule.id]),
      parentModuleId: parentModule.id,
      parentModuleName: parentModule.name,
      modelId: childModel.id,
      modelName: childModel.name,
      moduleIds: childModules.map((childModule) => childModule.id),
      depth,
    });
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(childModel.id);
    childModules.forEach((childModule) => visit(childModule, depth + 1, nextAncestry));
  };

  model.modules.forEach((module) => visit(module, 0, new Set([model.id])));
  return {
    model: { ...model, modules, connections },
    expansions,
    subgraphTargets,
  };
}

export type ForLoopOrderFlowDirection = 'left-to-right' | 'right-to-left';

export type ForLoopRowTransition = Readonly<{
  fromStep: number;
  toStep: number;
  side: 'left' | 'right';
}>;

export function forLoopOrderFlowDirection(index: number): ForLoopOrderFlowDirection {
  return Math.floor(index / subgraphColumns) % 2 === 0 ? 'left-to-right' : 'right-to-left';
}

export function forLoopRowTransition(
  sourceIndex: number,
  targetIndex: number,
): ForLoopRowTransition | null {
  if (targetIndex !== sourceIndex + 1) return null;
  const sourceRow = Math.floor(sourceIndex / subgraphColumns);
  const targetRow = Math.floor(targetIndex / subgraphColumns);
  if (sourceRow === targetRow) return null;
  return {
    fromStep: sourceIndex + 1,
    toStep: targetIndex + 1,
    side: sourceRow % 2 === 0 ? 'right' : 'left',
  };
}

function subgraphBoundarySize(modules: readonly ModelModule[]) {
  const columns = Math.min(subgraphColumns, Math.max(1, modules.length));
  const positions = formulaAwareGridPositions(modules);
  const bottom = Math.max(
    ...modules.map(
      (module, index) => (positions[index]?.y ?? 0) + estimatedModuleCardHeight(module),
    ),
    subgraphHeaderHeight,
  );
  return {
    width: subgraphPadding * 2 + (columns - 1) * subgraphColumnGap + 260,
    height: bottom + subgraphPadding,
  };
}

export function formulaAwareBoundaryYPositions(
  topLevelModules: readonly ModelModule[],
  expansionModules: readonly (readonly ModelModule[])[],
) {
  const lanePositions = formulaAwareLanePositions(topLevelModules);
  const topLevelBottom = Math.max(
    ...topLevelModules.map(
      (module) => (lanePositions.get(module.lane) ?? 260) + estimatedModuleCardHeight(module),
    ),
    490,
  );
  let nextY = Math.max(560, topLevelBottom + 70);
  return expansionModules.map((modules) => {
    const y = nextY;
    nextY += subgraphBoundarySize(modules).height + 70;
    return y;
  });
}

export type SignalReading = Readonly<{
  id: string;
  tensorName: string;
  quantity: string;
  value: string;
  route: string;
  health: GradientHealth;
  observationState: GradientObservationState;
}>;

export function signalEndpoints(
  connection: Pick<ModelConnection, 'source' | 'target'>,
  signalMode: 'forward' | 'backward',
) {
  return signalMode === 'backward'
    ? { source: connection.target, target: connection.source }
    : { source: connection.source, target: connection.target };
}

export function connectionHandleEndpoints(
  connection: Pick<ModelConnection, 'sourcePort' | 'targetPort'>,
  signalMode: 'forward' | 'backward',
  forceForward = false,
) {
  return forceForward || signalMode === 'forward'
    ? { sourceHandle: connection.sourcePort, targetHandle: connection.targetPort }
    : { sourceHandle: connection.targetPort, targetHandle: connection.sourcePort };
}

export function connectionSignalReading(
  connection: ModelConnection,
  probe: GradientProbeName,
  checkpointIndex: number,
  signalMode: 'forward' | 'backward',
): SignalReading {
  const endpoints = signalEndpoints(connection, signalMode);
  const gradient = gradientAt(connection, probe, checkpointIndex);
  const observationState = gradientStateAt(connection, probe, checkpointIndex);
  const health = classifyGradient(gradient, connection.expectedToCarryGradient, observationState);

  return {
    id: connection.id,
    tensorName: connection.tensorName,
    quantity:
      signalMode === 'backward'
        ? `∥∂L/∂${connection.tensorName}∥`
        : `${formatShape(connection.shape)} activation RMS`,
    value:
      signalMode === 'backward'
        ? observationState === 'observed'
          ? formatNorm(gradient)
          : observationState
        : formatNorm(connection.activationNorm),
    route: `${endpoints.source} → ${endpoints.target}`,
    health,
    observationState,
  };
}

export function findLogicalNeighborId(
  modules: readonly ModelModule[],
  connections: readonly Pick<ModelConnection, 'source' | 'target'>[],
  currentId: string,
  key: GraphNavigationKey,
): string | undefined {
  const current = modules.find((module) => module.id === currentId);
  if (!current) return undefined;

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const candidates = connections
      .flatMap((connection) => {
        if (key === 'ArrowRight' && connection.source === currentId) return [connection.target];
        if (key === 'ArrowLeft' && connection.target === currentId) return [connection.source];
        return [];
      })
      .map((id) => modules.find((module) => module.id === id))
      .filter((module): module is ModelModule => module !== undefined);

    return candidates.sort(
      (left, right) =>
        Math.abs(left.lane - current.lane) - Math.abs(right.lane - current.lane) ||
        Math.abs(left.stage - current.stage) - Math.abs(right.stage - current.stage),
    )[0]?.id;
  }

  const verticalCandidates = modules.filter((module) =>
    key === 'ArrowUp' ? module.lane < current.lane : module.lane > current.lane,
  );
  return verticalCandidates.sort(
    (left, right) =>
      Math.abs(left.stage - current.stage) - Math.abs(right.stage - current.stage) ||
      Math.abs(left.lane - current.lane) - Math.abs(right.lane - current.lane),
  )[0]?.id;
}

function selectionTargetId(moduleId: string) {
  return (
    {
      'residual-block-summary': 'merge',
      'tropic-candidate-summary': 'tropic-lattice',
      'tropic-path-summary': 'tropic-viterbi',
      'tropic-output-summary': 'tropic-output',
      'sparkvsk-input-summary': 'sparkvsk-standardize',
      'sparkvsk-trunk-summary': 'sparkvsk-message-passing',
      'sparkvsk-conditioning-summary': 'sparkvsk-lambda-query',
      'sparkvsk-scale-summary': 'sparkvsk-lqa-merge',
      'sparkvsk-solve-summary': 'sparkvsk-ipcg',
    }[moduleId] ?? moduleId
  );
}

function moduleRepresentsSelection(moduleId: string, selectedModuleId: string): boolean {
  if (moduleId === selectedModuleId) return true;
  const representedModules: Readonly<Record<string, readonly string[]>> = {
    'residual-block-summary': ['pre-norm', 'residual-mlp', 'skip', 'merge'],
    'tropic-candidate-summary': [
      'tropic-substrate',
      'tropic-restricted-stats',
      'tropic-seeds',
      'tropic-lattice',
      'tropic-expand',
    ],
    'tropic-path-summary': ['tropic-nodes', 'tropic-channels', 'tropic-viterbi'],
    'tropic-output-summary': ['tropic-scatter', 'tropic-output'],
    'sparkvsk-input-summary': ['sparkvsk-task', 'sparkvsk-standardize'],
    'sparkvsk-trunk-summary': [
      'sparkvsk-krylov-features',
      'sparkvsk-embeddings',
      'sparkvsk-message-passing',
    ],
    'sparkvsk-conditioning-summary': ['sparkvsk-lambda-query', 'sparkvsk-query-fusion'],
    'sparkvsk-scale-summary': [
      'sparkvsk-correction-head',
      'sparkvsk-lqa-merge',
      'sparkvsk-scale-clamp',
    ],
    'sparkvsk-solve-summary': ['sparkvsk-ipcg', 'sparkvsk-mm-refinement'],
  };
  return representedModules[moduleId]?.includes(selectedModuleId) ?? false;
}

function focusModuleCard(moduleId: string) {
  requestAnimationFrame(() => {
    const cards = document.querySelectorAll<HTMLElement>('[data-model-node-id]');
    const target = Array.from(cards).find((card) => card.dataset.modelNodeId === moduleId);
    target?.focus();
  });
}

export function CenterModelGraphButton({ onClick }: Readonly<{ onClick: () => void }>) {
  useUiText();
  return (
    <button
      className="quiet-button model-graph__center-button"
      type="button"
      aria-label={uiText(
        'Reset the canonical layout and center all model boxes in the graph viewport',
      )}
      title={uiText('Center model boxes')}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        <rect x="8" y="8" width="8" height="8" rx="1.5" />
      </svg>
    </button>
  );
}

export const ModelGraph = memo(function ModelGraph({
  composition,
  selectedModuleId,
  probe,
  checkpointIndex,
  signalMode,
  focusMode,
  changeHighlight,
  openModuleId,
  onSelectModule,
  onOpenModule,
  onToggleSubgraph,
}: ModelGraphProps) {
  useUiText();
  const hierarchy = useMemo(() => composeRepeatedBlocks(composition.model), [composition.model]);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [viewportResetNonce, setViewportResetNonce] = useState(0);
  const openBlock = hierarchy.blocks.find((block) => block.id === openBlockId) ?? null;
  const visibleComposition = useMemo<ModelGraphComposition>(
    () =>
      openBlock
        ? { model: openBlock.detailModel, expansions: [], subgraphTargets: {} }
        : { ...composition, model: hierarchy.model },
    [composition, hierarchy.model, openBlock],
  );
  const graphModel = visibleComposition.model;
  const addedModuleIds = useMemo(
    () => new Set(changeHighlight?.addedModuleIds ?? []),
    [changeHighlight?.addedModuleIds],
  );
  const changedModuleIds = useMemo(
    () => new Set(changeHighlight?.changedModuleIds ?? []),
    [changeHighlight?.changedModuleIds],
  );
  const changedConnectionIds = useMemo(
    () => new Set(changeHighlight?.changedConnectionIds ?? []),
    [changeHighlight?.changedConnectionIds],
  );
  const addedConnectionIds = useMemo(
    () => new Set(changeHighlight?.addedConnectionIds ?? []),
    [changeHighlight?.addedConnectionIds],
  );
  const addedStepIds = useMemo(
    () => new Set(changeHighlight?.addedStepIds ?? []),
    [changeHighlight?.addedStepIds],
  );
  const changedStepIds = useMemo(
    () => new Set(changeHighlight?.changedStepIds ?? []),
    [changeHighlight?.changedStepIds],
  );
  const blockBySummaryModuleId = useMemo(
    () => new Map(hierarchy.blocks.map((block) => [block.summaryModuleId, block])),
    [hierarchy.blocks],
  );
  const resetAndCenterVisibleGraph = useCallback(() => {
    setViewportResetNonce((current) => current + 1);
  }, []);
  const openRepeatedBlock = useCallback(
    (block: RepeatedBlockDetail) => {
      setOpenBlockId(block.id);
      onSelectModule(block.selectionModuleId);
      resetAndCenterVisibleGraph();
    },
    [onSelectModule, resetAndCenterVisibleGraph],
  );
  const closeRepeatedBlock = useCallback(() => {
    setOpenBlockId(null);
    resetAndCenterVisibleGraph();
  }, [resetAndCenterVisibleGraph]);
  useEffect(() => {
    if (openBlockId && !hierarchy.blocks.some((block) => block.id === openBlockId)) {
      setOpenBlockId(null);
    }
  }, [hierarchy.blocks, openBlockId]);
  const moduleExpansion = useMemo(
    () =>
      new Map(
        visibleComposition.expansions.flatMap((expansion) =>
          expansion.moduleIds.map((moduleId, index) => [moduleId, { expansion, index }] as const),
        ),
      ),
    [visibleComposition.expansions],
  );
  const nodes = useMemo<(ModuleFlowNode | SubgraphBoundaryFlowNode)[]>(() => {
    const openBlockPositions = formulaAwareGridPositions(graphModel.modules);
    const topLevelModules = graphModel.modules.filter((module) => !moduleExpansion.has(module.id));
    const lanePositions = formulaAwareLanePositions(topLevelModules);
    const moduleById = new Map(graphModel.modules.map((module) => [module.id, module] as const));
    const nestedPositions = new Map<string, { x: number; y: number }>();
    const expansionModuleGroups = visibleComposition.expansions.map((expansion) =>
      expansion.moduleIds.flatMap((moduleId) => {
        const module = moduleById.get(moduleId);
        return module ? [module] : [];
      }),
    );
    for (const [expansionIndex, expansion] of visibleComposition.expansions.entries()) {
      const expansionModules = expansionModuleGroups[expansionIndex] ?? [];
      formulaAwareGridPositions(expansionModules).forEach((position, index) => {
        const moduleId = expansion.moduleIds[index];
        if (moduleId) nestedPositions.set(moduleId, position);
      });
    }
    const boundaryYPositions = formulaAwareBoundaryYPositions(
      topLevelModules,
      expansionModuleGroups,
    );
    const boundaryNodes: SubgraphBoundaryFlowNode[] = visibleComposition.expansions.map(
      (expansion, expansionIndex) => {
        const expansionModules = expansionModuleGroups[expansionIndex] ?? [];
        const size = subgraphBoundarySize(expansionModules);
        return {
          id: expansion.boundaryId,
          type: 'subgraph-boundary',
          position: {
            x: 44,
            y: boundaryYPositions[expansionIndex] ?? 560,
          },
          style: { width: size.width, height: size.height, zIndex: -1 },
          selectable: false,
          draggable: true,
          data: {
            parentModuleName: expansion.parentModuleName,
            modelName: expansion.modelName,
            moduleCount: expansion.moduleIds.length,
            onCollapse: () => onToggleSubgraph(expansion.parentModuleId),
          },
        };
      },
    );
    const moduleNodes: ModuleFlowNode[] = graphModel.modules.map((module, moduleIndex) => {
      const navigationTargets = Object.fromEntries(
        graphNavigationKeys.flatMap((key) => {
          const neighborId = findLogicalNeighborId(
            graphModel.modules,
            graphModel.connections,
            module.id,
            key,
          );
          return neighborId ? [[key, neighborId]] : [];
        }),
      );
      const nested = moduleExpansion.get(module.id);
      const target = visibleComposition.subgraphTargets[module.id];
      const compositeBlock = blockBySummaryModuleId.get(module.id);
      const changeKind: ModelGraphChangeKind | null =
        addedModuleIds.has(module.id) || addedStepIds.has(module.id)
          ? 'added'
          : changedModuleIds.has(module.id) || changedStepIds.has(module.id)
            ? 'changed'
            : null;
      return {
        id: module.id,
        type: 'module',
        position: openBlock
          ? openBlockPositions[moduleIndex]!
          : nested
            ? (nestedPositions.get(module.id) ?? { x: subgraphPadding, y: subgraphHeaderHeight })
            : graphPosition(module.stage, module.lane, lanePositions),
        ...(nested ? { parentId: nested.expansion.boundaryId, extent: 'parent' as const } : {}),
        focusable: false,
        selected: compositeBlock
          ? compositeBlock.memberModuleIds.includes(selectedModuleId)
          : moduleRepresentsSelection(module.id, selectedModuleId),
        data: {
          module,
          changeKind,
          health: moduleGradientHealth(graphModel, module.id, probe, checkpointIndex),
          signalMode,
          orderFlowDirection: openBlock ? forLoopOrderFlowDirection(moduleIndex) : null,
          selectionTargetId: compositeBlock?.memberModuleIds[0] ?? selectionTargetId(module.id),
          detailExpanded: openModuleId === module.id,
          detailDialogId: 'model-module-detail-dialog',
          navigationTargets,
          compositeBlock: compositeBlock
            ? {
                label: compositeBlock.label,
                repeatCount: compositeBlock.repeatCount,
                moduleCount: compositeBlock.memberModuleIds.length,
                detailKind: compositeBlock.detailKind,
                onOpen: () => openRepeatedBlock(compositeBlock),
              }
            : null,
          subgraph: target
            ? {
                modelName: target.modelName,
                moduleCount: target.moduleCount,
                expanded: visibleComposition.expansions.some(
                  (expansion) => expansion.parentModuleId === module.id,
                ),
                onToggle: () => onToggleSubgraph(module.id),
              }
            : null,
          onActivate: (activatedModule: ModelModule) => {
            if (compositeBlock) {
              openRepeatedBlock(compositeBlock);
              return;
            }
            onSelectModule(selectionTargetId(activatedModule.id));
            onOpenModule(activatedModule, graphModel);
          },
          onNavigate: (nodeId: string) => {
            onSelectModule(selectionTargetId(nodeId));
            focusModuleCard(nodeId);
          },
        },
      };
    });
    return [...boundaryNodes, ...moduleNodes];
  }, [
    checkpointIndex,
    addedModuleIds,
    addedStepIds,
    blockBySummaryModuleId,
    changedModuleIds,
    changedStepIds,
    graphModel,
    moduleExpansion,
    onOpenModule,
    openRepeatedBlock,
    onSelectModule,
    onToggleSubgraph,
    openModuleId,
    openBlock,
    probe,
    selectedModuleId,
    signalMode,
    visibleComposition.expansions,
    visibleComposition.subgraphTargets,
  ]);

  const signalReadings = useMemo(
    () =>
      graphModel.connections.map((connection) =>
        connectionSignalReading(connection, probe, checkpointIndex, signalMode),
      ),
    [checkpointIndex, graphModel.connections, probe, signalMode],
  );

  const edges = useMemo<SignalFlowEdge[]>(() => {
    const moduleIndexById = new Map(
      graphModel.modules.map((module, moduleIndex) => [module.id, moduleIndex] as const),
    );
    return graphModel.connections.map((connection) => {
      const reading = connectionSignalReading(connection, probe, checkpointIndex, signalMode);
      const sourceIndex = moduleIndexById.get(connection.source);
      const targetIndex = moduleIndexById.get(connection.target);
      const rowTransition =
        openBlock && sourceIndex !== undefined && targetIndex !== undefined
          ? forLoopRowTransition(sourceIndex, targetIndex)
          : null;
      const endpoints = openBlock
        ? { source: connection.source, target: connection.target }
        : signalEndpoints(connection, signalMode);
      const handleEndpoints = connectionHandleEndpoints(connection, signalMode, Boolean(openBlock));
      const gradient = gradientAt(connection, probe, checkpointIndex);
      const gradientState = gradientStateAt(connection, probe, checkpointIndex);
      const changeKind: ModelGraphChangeKind | null = addedConnectionIds.has(connection.id)
        ? 'added'
        : changedConnectionIds.has(connection.id)
          ? 'changed'
          : null;
      const changeColor =
        changeKind === 'added'
          ? 'var(--model-change-added)'
          : changeKind === 'changed'
            ? 'var(--model-change-modified)'
            : null;
      return {
        id: connection.id,
        source: endpoints.source,
        target: endpoints.target,
        ...(handleEndpoints.sourceHandle ? { sourceHandle: handleEndpoints.sourceHandle } : {}),
        ...(handleEndpoints.targetHandle ? { targetHandle: handleEndpoints.targetHandle } : {}),
        type: 'signal',
        pathOptions: { borderRadius: 18, offset: 36 },
        animated: signalMode === 'backward' && reading.health === 'healthy',
        data: {
          health: reading.health,
          quantity: reading.quantity,
          tensorName: reading.tensorName,
          value: reading.value,
          changeKind,
          rowTransition,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color:
            changeColor ??
            (rowTransition ? 'var(--model-green)' : null) ??
            (signalMode === 'backward' ? healthColor[reading.health] : 'var(--model-edge-forward)'),
        },
        ariaLabel:
          signalMode === 'backward'
            ? `Backward gradient for ${connection.tensorName}, from ${endpoints.source} toward ${endpoints.target}, ${reading.health}`
            : `Forward tensor ${connection.tensorName}, from ${endpoints.source} to ${endpoints.target}`,
        style: {
          stroke:
            changeColor ??
            (rowTransition ? 'var(--model-green)' : null) ??
            (signalMode === 'backward' ? healthColor[reading.health] : 'var(--model-edge-forward)'),
          strokeWidth:
            changeKind !== null
              ? 4.5
              : rowTransition
                ? 3.5
                : signalMode === 'backward'
                  ? gradientStrokeWidth(gradient, gradientState)
                  : 2,
        },
      };
    });
  }, [
    addedConnectionIds,
    changedConnectionIds,
    checkpointIndex,
    graphModel,
    openBlock,
    probe,
    signalMode,
  ]);

  const modifiedBlockStepCount =
    openBlock?.memberModuleIds.filter(
      (moduleId) => addedStepIds.has(moduleId) || changedStepIds.has(moduleId),
    ).length ?? 0;
  const highlightedConnectionCount =
    (changeHighlight?.changedConnectionIds.length ?? 0) +
    (changeHighlight?.addedConnectionIds.length ?? 0);

  return (
    <div
      className={`model-graph${openBlock ? ' model-graph--block-open' : ''}`}
      data-testid="model-graph"
    >
      {openBlock ? (
        <div
          className="model-graph__block-drilldown"
          role="navigation"
          aria-label={uiText('Block detail')}
        >
          <button className="quiet-button" type="button" onClick={closeRepeatedBlock}>
            {uiText('← Whole model')}
          </button>
          <span>
            <small>
              {openBlock.detailKind !== 'modules'
                ? uiText('INSIDE REPEATED FOR-LOOP')
                : uiText('INSIDE COMPOSITE BLOCK')}
            </small>
            <strong>{openBlock.label}</strong>
            <b>
              {uiText('One iteration · ')}
              {openBlock.memberModuleIds.length}
              {openBlock.omittedStepCount > 0
                ? uiText(' of {value0}', {
                    value0: openBlock.memberModuleIds.length + openBlock.omittedStepCount,
                  })
                : ''}{' '}
              {openBlock.detailKind === 'steps'
                ? uiText('steps shown')
                : openBlock.detailKind === 'semantic blocks'
                  ? uiText('semantic blocks')
                  : uiText('modules')}{' '}
              {uiText('· repeated ×')}
              {openBlock.repeatCount}
            </b>
            {openBlock.omittedStepCount > 0 ? (
              <em className="model-graph__block-overflow-note" role="status">
                {uiText(
                  openBlock.omittedStepCount === 1
                    ? 'Graph safety limit: {count} additional operation remains in the pseudocode and revision diff but is not rendered.'
                    : 'Graph safety limit: {count} additional operations remain in the pseudocode and revision diff but are not rendered.',
                  { count: openBlock.omittedStepCount },
                )}
              </em>
            ) : null}
            {changeHighlight &&
            openBlock.memberModuleIds.some(
              (moduleId) => addedStepIds.has(moduleId) || changedStepIds.has(moduleId),
            ) ? (
              <em className="model-graph__block-change-note">
                {uiText(
                  modifiedBlockStepCount === 1
                    ? '{count} modified step in this iteration'
                    : '{count} modified steps in this iteration',
                  { count: modifiedBlockStepCount },
                )}
              </em>
            ) : null}
            {changeHighlight?.removedStepLabels.length ? (
              <em className="model-graph__block-change-note removed">
                {uiText('Removed steps: ')}
                {changeHighlight.removedStepLabels.join(', ')}
              </em>
            ) : null}
            {signalMode === 'backward' ? <em>{backwardSignalNote(graphModel, probe)}</em> : null}
            <em className="model-graph__order-note">
              {uiText(
                'Follow STEP numbers. Each NEXT ROW arrow turns down on the same side, then the next row runs in the opposite direction.',
              )}
            </em>
          </span>
        </div>
      ) : null}
      {changeHighlight && !openBlock ? (
        <div
          className={`model-graph__change-banner model-graph__change-banner--${changeHighlight.mode}`}
          role="status"
          aria-label={uiText('Graph change highlight')}
        >
          <span>
            <small>
              {changeHighlight.mode === 'proposal'
                ? uiText('PROPOSAL PREVIEW · GRAPH NOT APPLIED')
                : uiText('REVISION CHANGE HIGHLIGHT')}
            </small>
            <strong>
              {uiText(
                changeHighlight.addedModuleIds.length === 1
                  ? '{changed} changed · {added} added Block'
                  : '{changed} changed · {added} added Blocks',
                {
                  changed: changeHighlight.changedModuleIds.length,
                  added: changeHighlight.addedModuleIds.length,
                },
              )}
              {' · '}
              {uiText(
                highlightedConnectionCount === 1 ? '{count} changed edge' : '{count} changed edges',
                { count: highlightedConnectionCount },
              )}
            </strong>
          </span>
          <span className="model-graph__change-legend">
            <i data-kind="changed" />
            {uiText(' modified')}
            <i data-kind="added" />
            {uiText(' added')}
          </span>
          {changeHighlight.removedModuleIds.length > 0 ? (
            <em>
              {uiText('Removed in proposal: ')}
              {changeHighlight.removedModuleIds.join(', ')}
            </em>
          ) : null}
        </div>
      ) : null}
      <div className="model-graph__canvas">
        {signalMode === 'backward' && !openBlock ? (
          <p className="model-graph__signal-note" role="note">
            {backwardSignalNote(graphModel, probe)}
          </p>
        ) : null}
        <CenterModelGraphButton onClick={resetAndCenterVisibleGraph} />
        <ReactFlow
          key={modelGraphViewportKey(graphModel.id, openBlockId, viewportResetNonce)}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={modelGraphFitViewOptions(focusMode)}
          minZoom={0.22}
          maxZoom={1.6}
          nodesDraggable
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable
          onNodeClick={(_event, node) => {
            if (node.type !== 'module') return;
            if (node.data.compositeBlock) {
              node.data.compositeBlock.onOpen();
              return;
            }
            onSelectModule(node.data.selectionTargetId);
            onOpenModule(node.data.module, graphModel);
          }}
          aria-label={uiText('{value0} interactive hierarchical module graph{value1}', {
            value0: graphModel.name,
            value1: openBlock ? `, inside ${openBlock.label}` : '',
          })}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => {
              const data = node.data as ModuleFlowNode['data'];
              return healthColor[data.health];
            }}
            aria-label={uiText('Model graph minimap')}
          />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </div>
      <section
        className="model-graph__readings"
        aria-label={
          signalMode === 'backward'
            ? uiText('Gradient signal readings')
            : uiText('Forward signal readings')
        }
      >
        <div className="model-graph__readings-heading">
          <strong>
            {signalMode === 'backward' ? uiText('Gradient values') : uiText('Tensor values')}
          </strong>
          <span>{uiText('Kept outside module cards so every value remains readable.')}</span>
        </div>
        <ul {...signalStripAccessibilityProps(signalMode)}>
          {signalReadings.map((reading) => (
            <li
              key={reading.id}
              className={signalMode === 'backward' ? `signal-reading--${reading.health}` : ''}
            >
              <span>
                {reading.tensorName}
                {signalMode === 'backward' ? ` · ${gradientHealthLabel(reading.health)}` : ''}
              </span>
              <code>{reading.quantity}</code>
              <strong>{reading.value}</strong>
              <small>{reading.route}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
});

export function overviewModel(model: ModelSpec, graphDetail: 'overview' | 'expanded'): ModelSpec {
  if (graphDetail === 'expanded') return model;
  if (model.id === 'tropic-lambda-path-compiler-20260822') return tropicOverviewModel(model);
  if (model.id === 'sparkvsk-learned-warm-path-20260822') return sparkvskOverviewModel(model);
  if (model.id !== 'residual-classifier-v3') return model;
  const moduleById = new Map(model.modules.map((module) => [module.id, module]));
  const connectionById = new Map(
    model.connections.map((connection) => [connection.id, connection]),
  );
  const input = moduleById.get('input');
  const projection = moduleById.get('projection');
  const head = moduleById.get('head');
  const intoBlock = connectionById.get('e-projection-norm');
  const outOfBlock = connectionById.get('e-merge-head');
  const inputEdge = connectionById.get('e-input-projection');
  if (!input || !projection || !head || !intoBlock || !outOfBlock || !inputEdge) return model;
  const residualBlock: ModelModule = {
    id: 'residual-block-summary',
    name: 'Residual block',
    kind: 'merge',
    group: 'Residual block · collapsed',
    stage: 2,
    lane: 0,
    inputShape: ['B', 256],
    outputShape: ['B', 256],
    transform: 'LayerNorm → MLP + identity',
    activation: 'GELU in residual branch',
    formula: String.raw`h_2=h_1+W_2\operatorname{GELU}(W_1\operatorname{LN}(h_1)+b_1)+b_2`,
    explanation:
      'A collapsed view of pre-normalization, residual MLP, identity skip, and addition.',
    parameterCount: 263_424,
    codeReference: 'model.py:26–36',
  };
  const blockInput: ModelConnection = {
    ...intoBlock,
    id: 'e-projection-block-summary',
    target: residualBlock.id,
    tensorName: 'h₁',
  };
  const blockOutput: ModelConnection = {
    ...outOfBlock,
    id: 'e-block-summary-head',
    source: residualBlock.id,
    tensorName: 'h₂',
  };
  return {
    ...model,
    modules: [input, projection, residualBlock, { ...head, stage: 3 }],
    connections: [inputEdge, blockInput, blockOutput],
  };
}

function sparkvskOverviewModel(model: ModelSpec): ModelSpec {
  const moduleById = new Map(model.modules.map((module) => [module.id, module]));
  const connectionById = new Map(
    model.connections.map((connection) => [connection.id, connection]),
  );
  const task = moduleById.get('sparkvsk-task');
  const output = moduleById.get('sparkvsk-output');
  const taskStandardize = connectionById.get('sparkvsk-e-task-standardize');
  const embeddingsBlocks = connectionById.get('sparkvsk-e-embeddings-blocks');
  const fusionHead = connectionById.get('sparkvsk-e-fusion-head');
  const headLqa = connectionById.get('sparkvsk-e-head-lqa');
  const mmOutput = connectionById.get('sparkvsk-e-mm-output');
  if (
    !task ||
    !output ||
    !taskStandardize ||
    !embeddingsBlocks ||
    !fusionHead ||
    !headLqa ||
    !mmOutput
  ) {
    return model;
  }

  const inputSummary: ModelModule = {
    ...task,
    id: 'sparkvsk-input-summary',
    name: 'Standardized regression task',
    group: 'Inputs + standardization · collapsed',
    transform: 'bind X, y, λ path and penalty; standardize X and y',
    formula: String.raw`X\mapsto(X-\mu_X)/s_X,\quad y\mapsto(y-\mu_y)/s_y`,
    explanation:
      'Collapsed view of the regression task bundle and stored normalization statistics.',
  };
  const trunkSummary: ModelModule = {
    id: 'sparkvsk-trunk-summary',
    name: 'Krylov + bipartite learned trunk',
    kind: 'merge',
    group: 'Ridge features + embeddings + four blocks · collapsed',
    stage: 1,
    lane: 0,
    inputShape: ['B', 'n', 'p'],
    outputShape: ['B', 'p', 'd'],
    transform: 'Lanczos ridge banks → coordinate/row embeddings → four gated X↔feature blocks',
    activation: 'LayerNorm + GELU + tanh gates',
    formula: String.raw`T=U^{\top}(XX^{\top}/p)U,\quad c,r\leftarrow\operatorname{SPARKBlock}^{\mathrm{LayerNorm+GELU}+\tanh\text{-gate}}_{1:4}(c,r,X,g)`,
    explanation:
      'Combines the Krylov feature extractor, learned embeddings, and repeated feature/row message passing.',
    parameterCount: 2_390_000,
    repeat: { count: 4, label: 'SPARK block' },
    codeReference: 'TROPIC_PORTABLE_20260822/model_spark_vs_k.py:17-89; model_spark.py:55-101',
  };
  const conditioningSummary: ModelModule = {
    id: 'sparkvsk-conditioning-summary',
    name: 'Explicit penalty + λ injection',
    kind: 'merge',
    group: 'Conditional query + coordinate broadcast · collapsed',
    stage: 2,
    lane: 0,
    inputShape: ['B', 'p', 'd'],
    outputShape: ['B', 'Q', 'p', 'F_h'],
    transform: 'λq=rqλmax; PenEnc(ρ′)+λ features → q; broadcast q over coordinates and fuse',
    activation: 'GELU in PenaltyEncoder and q_emb',
    formula: String.raw`q_q=\operatorname{MLP}^{\mathrm{GELU}}_q([\operatorname{PenEnc}^{\mathrm{GELU}}(\rho');\log r_q;\log\lambda_q;\log s_y;\log\lambda_{\max}])`,
    explanation:
      'Shows the conditioning branch explicitly: λ and penalty information become a learned query injected into every coordinate.',
    parameterCount: 0,
    codeReference: 'TROPIC_PORTABLE_20260822/model_spark_vs.py:29-60, 167-202',
  };
  const scaleSummary: ModelModule = {
    id: 'sparkvsk-scale-summary',
    name: 'Learned diagonal-scale path',
    kind: 'merge',
    group: 'Correction MLP + LQA base + clamp · collapsed',
    stage: 3,
    lane: 0,
    inputShape: ['B', 'Q', 'p', 'F_h'],
    outputShape: ['B', 'Q', 'p'],
    transform: '3-layer head_vs correction + penalty-aware LQA base → bounded log d',
    activation: 'GELU then clamp / exp',
    formula: String.raw`\log d_{qj}=\operatorname{clamp}\!\left(\log d^{base}_{qj}+(1-I_{quad})\operatorname{head}^{\mathrm{GELU}}_{vs}(h_{qj})\right)`,
    explanation:
      'The neural path produces a stable diagonal scale for each λ-coordinate pair rather than emitting β directly.',
    parameterCount: 0,
    repeat: { count: 3, label: 'Linear layer' },
    codeReference: 'TROPIC_PORTABLE_20260822/model_spark_vs.py:190-220',
  };
  const solveSummary: ModelModule = {
    id: 'sparkvsk-solve-summary',
    name: 'Implicit PCG + optional MM',
    kind: 'linear',
    group: 'Differentiable solve + refinement · collapsed',
    stage: 4,
    lane: 0,
    inputShape: ['B', 'Q', 'p'],
    outputShape: ['B', 'Q', 'p'],
    transform: 'K=48 implicit PCG, optionally recomputing penalty slopes for MM iterations',
    activation: null,
    formula: String.raw`\beta^{std}_q=D_qX^{\top}(XD_qX^{\top}+nI)^{-1}y`,
    explanation:
      'Solves the coefficient path without forming a full p × p inverse, then optionally performs iterative reweighting.',
    parameterCount: 0,
    codeReference:
      'TROPIC_PORTABLE_20260822/model_spark_vs_k.py:109-114; model_spark_vs.py:220-229',
  };

  return {
    ...model,
    modules: [
      inputSummary,
      trunkSummary,
      conditioningSummary,
      scaleSummary,
      solveSummary,
      { ...output, stage: 5 },
    ],
    connections: [
      {
        ...taskStandardize,
        id: 'sparkvsk-e-input-trunk-summary',
        source: inputSummary.id,
        target: trunkSummary.id,
      },
      {
        ...embeddingsBlocks,
        id: 'sparkvsk-e-trunk-conditioning-summary',
        source: trunkSummary.id,
        target: conditioningSummary.id,
      },
      {
        ...fusionHead,
        id: 'sparkvsk-e-conditioning-scale-summary',
        source: conditioningSummary.id,
        target: scaleSummary.id,
      },
      {
        ...headLqa,
        id: 'sparkvsk-e-scale-solve-summary',
        source: scaleSummary.id,
        target: solveSummary.id,
      },
      {
        ...mmOutput,
        id: 'sparkvsk-e-solve-output',
        source: solveSummary.id,
      },
    ],
  };
}

function tropicOverviewModel(model: ModelSpec): ModelSpec {
  const moduleById = new Map(model.modules.map((module) => [module.id, module]));
  const connectionById = new Map(
    model.connections.map((connection) => [connection.id, connection]),
  );
  const task = moduleById.get('tropic-task');
  const warmPath = moduleById.get('tropic-spark-warm-path');
  const audit = moduleById.get('tropic-audit');
  const taskWarm = connectionById.get('tropic-e-task-warm');
  const warmSubstrate = connectionById.get('tropic-e-warm-substrate');
  const expandedNodes = connectionById.get('tropic-e-expand-nodes');
  const viterbiAudit = connectionById.get('tropic-e-viterbi-audit');
  const auditScatter = connectionById.get('tropic-e-audit-scatter');
  if (
    !task ||
    !warmPath ||
    !audit ||
    !taskWarm ||
    !warmSubstrate ||
    !expandedNodes ||
    !viterbiAudit ||
    !auditScatter
  ) {
    return model;
  }

  const candidateSummary: ModelModule = {
    id: 'tropic-candidate-summary',
    name: 'Candidate lattice compiler',
    kind: 'linear',
    group: 'Candidate reduction + solves · collapsed',
    stage: 2,
    lane: 0,
    inputShape: ['Q', 'p'],
    outputShape: ['Q', 'L', "K'"],
    transform:
      'GK/ISIS/KCEP → restricted statistics → PATHC seeds → active-set lattice → KKT expansion',
    activation: null,
    formula: String.raw`\mathcal{L}_{1:Q}=\operatorname{ExpandKKT}\!\left(\operatorname{Lattice}(G_C,c_C,\beta^R,\rho')\right)`,
    explanation:
      'Collapsed overview of candidate selection, restricted normal equations, seed construction, active-set closure, and optional full-p expansion.',
    parameterCount: 0,
    codeReference: 'TROPIC_PORTABLE_20260822/tropic.py:89-648',
  };
  const pathSummary: ModelModule = {
    id: 'tropic-path-summary',
    name: 'λ-layer path graph',
    kind: 'linear',
    group: 'Representative nodes + channels + Viterbi · collapsed',
    stage: 3,
    lane: 0,
    inputShape: ['Q', 'L', "K'"],
    outputShape: ['H', 'Q'],
    transform: 'representative nodes → node/transition channels → perturbed Viterbi paths',
    activation: 'argmin',
    formula: String.raw`J_q(j)=\phi_q(j)+\min_i\left[J_{q-1}(i)+\psi_q(i,j)\right]`,
    explanation:
      'Collapsed overview of per-λ node compression, continuity/support transition features, and deterministic dynamic-programming hypotheses.',
    parameterCount: 0,
    codeReference: 'TROPIC_PORTABLE_20260822/tropic.py:356-491',
  };
  const outputSummary: ModelModule = {
    id: 'tropic-output-summary',
    name: 'Full-coordinate β path',
    kind: 'output',
    group: 'Reconstruction + output · collapsed',
    stage: 5,
    lane: 0,
    inputShape: ['Q', "K'"],
    outputShape: ['Q', 'p'],
    transform: 'scatter the audited restricted path back to C ⊂ {1,…,p}',
    activation: null,
    formula: String.raw`\beta^{out}_{q,C}=\beta^*_{q},\qquad\beta^{out}_{q,C^c}=0`,
    explanation:
      'Combines restricted-to-full coordinate reconstruction with the returned compiled λ path.',
    parameterCount: 0,
    codeReference: 'TROPIC_PORTABLE_20260822/tropic.py:665-717',
  };

  return {
    ...model,
    modules: [task, warmPath, candidateSummary, pathSummary, { ...audit, stage: 4 }, outputSummary],
    connections: [
      taskWarm,
      { ...warmSubstrate, id: 'tropic-e-warm-candidate-summary', target: candidateSummary.id },
      {
        ...expandedNodes,
        id: 'tropic-e-candidate-path-summary',
        source: candidateSummary.id,
        target: pathSummary.id,
        tensorName: 'candidate lattice',
      },
      {
        ...viterbiAudit,
        id: 'tropic-e-path-summary-audit',
        source: pathSummary.id,
      },
      {
        ...auditScatter,
        id: 'tropic-e-audit-output-summary',
        target: outputSummary.id,
      },
    ],
  };
}
