import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Formula } from './formula';
import { formatShape } from './model-lab-domain';
import type { GraphNavigationKey } from './model-graph';
import type { GradientHealth, ModelModule } from './model-lab-schema';

export type ModuleNodeData = Readonly<{
  module: ModelModule;
  health: GradientHealth;
  signalMode: 'forward' | 'backward';
  selectionTargetId: string;
  detailExpanded: boolean;
  detailDialogId: string;
  navigationTargets: Readonly<Partial<Record<GraphNavigationKey, string>>>;
  compositeBlock: Readonly<{
    label: string;
    repeatCount: number | string;
    moduleCount: number;
    onOpen: () => void;
  }> | null;
  subgraph: Readonly<{
    modelName: string;
    moduleCount: number;
    expanded: boolean;
    onToggle: () => void;
  }> | null;
  onActivate: (module: ModelModule) => void;
  onNavigate: (moduleId: string) => void;
}>;

export type ModuleFlowNode = Node<ModuleNodeData, 'module'>;

export type SubgraphBoundaryNodeData = Readonly<{
  parentModuleName: string;
  modelName: string;
  moduleCount: number;
  onCollapse: () => void;
}>;

export type SubgraphBoundaryFlowNode = Node<SubgraphBoundaryNodeData, 'subgraph-boundary'>;

export type ModuleRepeatPresentation = Readonly<{
  count: number | string;
  label: string;
}>;

export function moduleRepeatPresentation(
  module: Pick<ModelModule, 'repeat'>,
): ModuleRepeatPresentation | null {
  const repeat = module.repeat;
  if (!repeat) return null;
  const validCount =
    typeof repeat.count === 'number'
      ? Number.isInteger(repeat.count) && repeat.count >= 2
      : /^[A-Za-z0-9_+\-*/() ]{1,32}$/.test(repeat.count.trim());
  if (!validCount) return null;
  const label = repeat.label.trim();
  if (!label) return null;
  return {
    count: typeof repeat.count === 'number' ? Math.min(repeat.count, 128) : repeat.count.trim(),
    label,
  };
}

export function moduleRepeatStackLayers(repeat: ModuleRepeatPresentation): readonly number[] {
  const visibleCount = typeof repeat.count === 'number' ? Math.min(repeat.count, 3) : 3;
  return Array.from({ length: visibleCount }, (_, index) => index + 1);
}

const healthLabel: Record<GradientHealth, string> = {
  healthy: 'Gradient healthy',
  low: 'Gradient very small',
  blocked: 'Gradient blocked',
  exploding: 'Gradient exploding',
  invalid: 'Gradient invalid',
  'not-applicable': 'Gradient not applicable',
};

export function ModuleNodeView({ data, selected }: NodeProps<ModuleFlowNode>) {
  const {
    module,
    health,
    detailDialogId,
    detailExpanded,
    navigationTargets,
    compositeBlock,
    subgraph,
    onActivate,
    onNavigate,
    signalMode,
  } = data;
  const compactFormula = compactModuleFormula(module.formula);
  const repeat = moduleRepeatPresentation(module);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (isModuleActivationKey(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (compositeBlock) compositeBlock.onOpen();
      else onActivate(module);
      return;
    }
    if (!isGraphNavigationKey(event.key)) return;
    const neighborId = navigationTargets[event.key];
    if (!neighborId) return;
    event.preventDefault();
    event.stopPropagation();
    onNavigate(neighborId);
  };

  const backward = signalMode === 'backward';
  return (
    <article
      className={`module-node module-node--${health}${selected ? ' module-node--selected' : ''}${repeat ? ' module-node--stacked' : ''}${compositeBlock ? ' module-node--composite' : ''}`}
      data-model-node-id={module.id}
      data-repeat-count={repeat?.count}
    >
      {backward
        ? module.kind !== 'input' && <Handle type="source" position={Position.Left} />
        : module.kind !== 'input' && <Handle type="target" position={Position.Left} />}
      <button
        className="module-node__content"
        type="button"
        aria-pressed={selected}
        aria-haspopup={compositeBlock ? undefined : 'dialog'}
        aria-expanded={compositeBlock ? undefined : detailExpanded}
        aria-controls={compositeBlock ? undefined : detailDialogId}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space"
        aria-label={`${module.name}. ${repeat ? `Repeated stack of ${repeat.count} ${repeat.label}. ` : ''}${healthLabel[health]}. ${module.transform}. Formula ${compactFormula}`}
        onClick={(event) => {
          event.stopPropagation();
          if (compositeBlock) compositeBlock.onOpen();
          else onActivate(module);
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="module-node__topline">
          <span>{module.group}</span>
          <span className="module-node__health" aria-label={healthLabel[health]}>
            <span aria-hidden="true" />
            {health === 'healthy'
              ? 'flowing'
              : health === 'not-applicable'
                ? 'not applicable'
                : health}
          </span>
        </div>
        {repeat ? (
          <div
            className="module-node__repeat"
            aria-label={`${repeat.count} repeated ${repeat.label}`}
          >
            <span className="module-node__repeat-layers" aria-hidden="true">
              {moduleRepeatStackLayers(repeat).map((layer) => (
                <i key={layer} data-repeat-layer={layer}>
                  <span>BLOCK</span>
                </i>
              ))}
            </span>
            <span className="module-node__repeat-copy">
              <strong>{repeat.label}</strong>
              <small>same block composed</small>
            </span>
            <strong className="module-node__repeat-count">×{repeat.count}</strong>
          </div>
        ) : null}
        {compositeBlock ? (
          <div className="module-node__composite-summary">
            <strong>{compositeBlock.label}</strong>
            <code>
              {formatShape(module.inputShape)} → {formatShape(module.outputShape)}
            </code>
            <span>One iteration · {compositeBlock.moduleCount} internal modules</span>
            <b>Open block details →</b>
          </div>
        ) : (
          <>
            <strong>{module.name}</strong>
            <code>
              {formatShape(module.inputShape)} → {formatShape(module.outputShape)}
            </code>
            <div className="module-node__operation">{module.transform}</div>
            <div className="module-node__activation">{module.activation ?? 'No activation'}</div>
            <div
              className="module-node__formula"
              title={module.formula}
              aria-label={`Formula ${compactFormula}`}
            >
              <Formula latex={module.formula} displayMode={false} />
            </div>
          </>
        )}
      </button>
      {subgraph ? (
        <button
          className="module-node__subgraph-toggle"
          type="button"
          aria-expanded={subgraph.expanded}
          onClick={(event) => {
            event.stopPropagation();
            subgraph.onToggle();
          }}
        >
          <span aria-hidden="true">{subgraph.expanded ? '−' : '+'}</span>
          {subgraph.expanded ? 'Collapse' : 'Expand'} {subgraph.moduleCount} submodules
        </button>
      ) : null}
      {backward
        ? module.kind !== 'output' &&
          module.kind !== 'objective' && <Handle type="target" position={Position.Right} />
        : module.kind !== 'output' &&
          module.kind !== 'objective' && <Handle type="source" position={Position.Right} />}
    </article>
  );
}

export function SubgraphBoundaryNodeView({ data }: NodeProps<SubgraphBoundaryFlowNode>) {
  return (
    <section className="subgraph-boundary" aria-label={`${data.modelName} expanded submodules`}>
      <header>
        <span>
          INSIDE {data.parentModuleName} · {data.moduleCount} SUBMODULES
        </span>
        <strong>{data.modelName}</strong>
        <button className="nodrag" type="button" onClick={data.onCollapse}>
          Collapse
        </button>
      </header>
    </section>
  );
}

export function isModuleActivationKey(key: string) {
  return key === 'Enter' || key === ' ';
}

export function compactModuleFormula(formula: string, maxLength = 52) {
  const compact = formula
    .replace(/\\operatorname\{([^}]+)\}/g, '$1')
    .replace(/\\(?:left|right)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function isGraphNavigationKey(key: string): key is GraphNavigationKey {
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key);
}
