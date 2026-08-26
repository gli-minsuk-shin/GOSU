import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type ReactFlowInstance,
} from '@xyflow/react';
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
} from './model-lab-schema';

const nodeTypes = { module: ModuleNodeView, 'subgraph-boundary': SubgraphBoundaryNodeView };

type SignalFlowEdge = Edge<
  Readonly<Pick<SignalReading, 'health' | 'quantity' | 'tensorName' | 'value'>>,
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
            className={`signal-edge__label signal-edge__label--${data.health}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            title={`${data.tensorName}: ${data.quantity} ${data.value}`}
            aria-label={`${data.tensorName}: ${data.quantity} ${data.value}`}
          >
            <span>{data.quantity}</span>
            <strong>{data.value}</strong>
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
  return {
    healthy: 'Healthy',
    low: 'Very small',
    blocked: 'Blocked',
    exploding: 'Exploding',
    invalid: 'Not observed or invalid',
    'not-applicable': 'Not differentiable',
  }[health];
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
    return `Arrows run from the observed ${lossName} probe objective toward model inputs.`;
  }
  if (lossName && scenarioKind === 'synthetic-stress') {
    return `Arrows show a synthetic stress transform anchored to the observed ${lossName} probe receipt.`;
  }
  const hasDeclaredObjective = model.modules.some((module) =>
    /(?:probe loss|cross-entropy|\\mathcal\s*L)/iu.test(
      `${module.name} ${module.activation ?? ''} ${module.formula}`,
    ),
  );
  return hasDeclaredObjective
    ? 'Arrows follow the declared loss objective toward inputs; no observed runtime loss receipt is attached.'
    : 'Arrows show intended output-to-input direction; no explicit loss objective or runtime receipt is attached.';
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
  openModuleId: string | null;
  onSelectModule: (moduleId: string) => void;
  onOpenModule: (module: ModelModule, graphModel: ModelSpec) => void;
  onToggleSubgraph: (moduleId: string) => void;
}>;

export function modelGraphFitViewOptions(focusMode: boolean) {
  return focusMode
    ? { padding: 0.06, minZoom: 0.58, maxZoom: 0.9 }
    : { padding: 0.12, maxZoom: 1.05 };
}

export function modelGraphCenterViewOptions(focusMode: boolean) {
  const initialOptions = modelGraphFitViewOptions(focusMode);
  return {
    padding: initialOptions.padding,
    minZoom: 0.22,
    maxZoom: initialOptions.maxZoom,
    duration: 420,
  };
}

function graphPosition(stage: number, lane: number) {
  return { x: 44 + stage * 350, y: 260 + lane * 190 };
}

const subgraphColumns = 5;
const subgraphColumnGap = 270;
const subgraphRowGap = 245;
const subgraphHeaderHeight = 76;
const subgraphPadding = 32;

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
  memberModuleIds: readonly string[];
  detailModel: ModelSpec;
}>;

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
      memberModuleIds: members.map((module) => module.id),
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

function subgraphGridPosition(index: number) {
  const row = Math.floor(index / subgraphColumns);
  const offset = index % subgraphColumns;
  const column = row % 2 === 0 ? offset : subgraphColumns - 1 - offset;
  return {
    x: subgraphPadding + column * subgraphColumnGap,
    y: subgraphHeaderHeight + subgraphPadding + row * subgraphRowGap,
  };
}

function subgraphBoundarySize(moduleCount: number) {
  const columns = Math.min(subgraphColumns, Math.max(1, moduleCount));
  const rows = Math.max(1, Math.ceil(moduleCount / subgraphColumns));
  return {
    width: subgraphPadding * 2 + (columns - 1) * subgraphColumnGap + 220,
    height: subgraphHeaderHeight + subgraphPadding * 2 + rows * subgraphRowGap,
  };
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

export function ModelGraph({
  composition,
  selectedModuleId,
  probe,
  checkpointIndex,
  signalMode,
  focusMode,
  openModuleId,
  onSelectModule,
  onOpenModule,
  onToggleSubgraph,
}: ModelGraphProps) {
  const flowInstanceRef = useRef<ReactFlowInstance<
    ModuleFlowNode | SubgraphBoundaryFlowNode,
    SignalFlowEdge
  > | null>(null);
  const hierarchy = useMemo(() => composeRepeatedBlocks(composition.model), [composition.model]);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const openBlock = hierarchy.blocks.find((block) => block.id === openBlockId) ?? null;
  const visibleComposition = useMemo<ModelGraphComposition>(
    () =>
      openBlock
        ? { model: openBlock.detailModel, expansions: [], subgraphTargets: {} }
        : { ...composition, model: hierarchy.model },
    [composition, hierarchy.model, openBlock],
  );
  const graphModel = visibleComposition.model;
  const blockBySummaryModuleId = useMemo(
    () => new Map(hierarchy.blocks.map((block) => [block.summaryModuleId, block])),
    [hierarchy.blocks],
  );
  const centerVisibleGraph = useCallback(() => {
    requestAnimationFrame(() => {
      void flowInstanceRef.current?.fitView(modelGraphCenterViewOptions(focusMode));
    });
  }, [focusMode]);
  const openRepeatedBlock = useCallback(
    (block: RepeatedBlockDetail) => {
      setOpenBlockId(block.id);
      const firstModuleId = block.memberModuleIds[0];
      if (firstModuleId) onSelectModule(firstModuleId);
      centerVisibleGraph();
    },
    [centerVisibleGraph, onSelectModule],
  );
  const closeRepeatedBlock = useCallback(() => {
    setOpenBlockId(null);
    centerVisibleGraph();
  }, [centerVisibleGraph]);
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
    const boundaryNodes: SubgraphBoundaryFlowNode[] = visibleComposition.expansions.map(
      (expansion, expansionIndex) => {
        const size = subgraphBoundarySize(expansion.moduleIds.length);
        return {
          id: expansion.boundaryId,
          type: 'subgraph-boundary',
          position: {
            x: 44,
            y: 560 + expansionIndex * (size.height + 70),
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
      return {
        id: module.id,
        type: 'module',
        position: openBlock
          ? subgraphGridPosition(moduleIndex)
          : nested
            ? subgraphGridPosition(nested.index)
            : graphPosition(module.stage, module.lane),
        ...(nested ? { parentId: nested.expansion.boundaryId, extent: 'parent' as const } : {}),
        focusable: false,
        selected: compositeBlock
          ? compositeBlock.memberModuleIds.includes(selectedModuleId)
          : moduleRepresentsSelection(module.id, selectedModuleId),
        data: {
          module,
          health: moduleGradientHealth(graphModel, module.id, probe, checkpointIndex),
          signalMode,
          selectionTargetId: compositeBlock?.memberModuleIds[0] ?? selectionTargetId(module.id),
          detailExpanded: openModuleId === module.id,
          detailDialogId: 'model-module-detail-dialog',
          navigationTargets,
          compositeBlock: compositeBlock
            ? {
                label: compositeBlock.label,
                repeatCount: compositeBlock.repeatCount,
                moduleCount: compositeBlock.memberModuleIds.length,
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
    blockBySummaryModuleId,
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

  const edges = useMemo<SignalFlowEdge[]>(
    () =>
      graphModel.connections.map((connection) => {
        const reading = connectionSignalReading(connection, probe, checkpointIndex, signalMode);
        const endpoints = signalEndpoints(connection, signalMode);
        const gradient = gradientAt(connection, probe, checkpointIndex);
        const gradientState = gradientStateAt(connection, probe, checkpointIndex);
        return {
          id: connection.id,
          source: endpoints.source,
          target: endpoints.target,
          type: 'signal',
          pathOptions: { borderRadius: 18, offset: 36 },
          animated: signalMode === 'backward' && reading.health === 'healthy',
          data: {
            health: reading.health,
            quantity: reading.quantity,
            tensorName: reading.tensorName,
            value: reading.value,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color:
              signalMode === 'backward' ? healthColor[reading.health] : 'var(--model-edge-forward)',
          },
          ariaLabel:
            signalMode === 'backward'
              ? `Backward gradient for ${connection.tensorName}, from ${endpoints.source} toward ${endpoints.target}, ${reading.health}`
              : `Forward tensor ${connection.tensorName}, from ${endpoints.source} to ${endpoints.target}`,
          style: {
            stroke:
              signalMode === 'backward' ? healthColor[reading.health] : 'var(--model-edge-forward)',
            strokeWidth:
              signalMode === 'backward' ? gradientStrokeWidth(gradient, gradientState) : 2,
          },
        };
      }),
    [checkpointIndex, graphModel, probe, signalMode],
  );

  return (
    <div
      className={`model-graph${openBlock ? ' model-graph--block-open' : ''}`}
      data-testid="model-graph"
    >
      {openBlock ? (
        <div className="model-graph__block-drilldown" role="navigation" aria-label="Block detail">
          <button className="quiet-button" type="button" onClick={closeRepeatedBlock}>
            ← Whole model
          </button>
          <span>
            <small>INSIDE COMPOSITE BLOCK</small>
            <strong>{openBlock.label}</strong>
            <b>
              One iteration · {openBlock.memberModuleIds.length} modules · repeated ×
              {openBlock.repeatCount}
            </b>
            {signalMode === 'backward' ? <em>{backwardSignalNote(graphModel, probe)}</em> : null}
          </span>
        </div>
      ) : null}
      <div className="model-graph__canvas">
        {signalMode === 'backward' && !openBlock ? (
          <p className="model-graph__signal-note" role="note">
            {backwardSignalNote(graphModel, probe)}
          </p>
        ) : null}
        <button
          className="quiet-button model-graph__center-button"
          type="button"
          aria-label="Center all model boxes in the graph viewport"
          onClick={() => {
            void flowInstanceRef.current?.fitView(modelGraphCenterViewOptions(focusMode));
          }}
        >
          <span aria-hidden="true">◎</span>
          Center model boxes
        </button>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={modelGraphFitViewOptions(focusMode)}
          onInit={(instance) => {
            flowInstanceRef.current = instance;
          }}
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
          aria-label={`${graphModel.name} interactive hierarchical module graph${openBlock ? `, inside ${openBlock.label}` : ''}`}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => {
              const data = node.data as ModuleFlowNode['data'];
              return healthColor[data.health];
            }}
            aria-label="Model graph minimap"
          />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </div>
      <section
        className="model-graph__readings"
        aria-label={
          signalMode === 'backward' ? 'Gradient signal readings' : 'Forward signal readings'
        }
      >
        <div className="model-graph__readings-heading">
          <strong>{signalMode === 'backward' ? 'Gradient values' : 'Tensor values'}</strong>
          <span>Kept outside module cards so every value remains readable.</span>
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
}

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
    formula: String.raw`T=U^{\top}(XX^{\top}/p)U,\quad c,r\leftarrow\operatorname{SPARKBlock}_{1:4}(c,r,X,g)`,
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
    formula: String.raw`q_q=\operatorname{MLP}_q([\operatorname{PenEnc}(\rho');\log r_q;\log\lambda_q;\log s_y;\log\lambda_{\max}])`,
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
    formula: String.raw`\log d_{qj}=\log d^{base}_{qj}+(1-I_{quad})\operatorname{head}_{vs}(h_{qj})`,
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
