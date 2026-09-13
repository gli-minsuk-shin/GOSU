import { uiText, useUiText } from '@gosu/ui/language';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Formula, formulaDisplayRows } from './formula';
import { formatModuleInputContract, formatModuleOutputContract } from './model-lab-domain';
import type { GraphNavigationKey } from './model-graph';
import type { GradientHealth, ModelModule } from './model-lab-schema';

export type ModuleNodeData = Readonly<{
  module: ModelModule;
  changeKind: 'added' | 'changed' | null;
  health: GradientHealth;
  signalMode: 'forward' | 'backward';
  orderFlowDirection: 'left-to-right' | 'right-to-left' | null;
  selectionTargetId: string;
  detailExpanded: boolean;
  detailDialogId: string;
  navigationTargets: Readonly<Partial<Record<GraphNavigationKey, string>>>;
  compositeBlock: Readonly<{
    label: string;
    repeatCount: number | string;
    moduleCount: number;
    detailKind: 'modules' | 'steps' | 'semantic blocks';
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

export function moduleHandlePorts(
  module: Pick<ModelModule, 'inputPorts' | 'outputPorts'>,
  signalMode: 'forward' | 'backward',
  orderFlowDirection: 'left-to-right' | 'right-to-left' | null,
  handleType: 'source' | 'target',
) {
  const reversePorts = signalMode === 'backward' && orderFlowDirection === null;
  const ports =
    handleType === 'source'
      ? reversePorts
        ? module.inputPorts
        : module.outputPorts
      : reversePorts
        ? module.outputPorts
        : module.inputPorts;
  return ports?.filter((port) => !port.binding || port.binding === 'internal');
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
  useUiText();
  const {
    module,
    changeKind,
    health,
    detailDialogId,
    detailExpanded,
    navigationTargets,
    compositeBlock,
    subgraph,
    onActivate,
    onNavigate,
    signalMode,
    orderFlowDirection,
  } = data;
  const formulaRows = formulaDisplayRows(module.formula);
  const formulaAccessibilityLabel = moduleFormulaAccessibilityLabel(formulaRows);
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
  const leftHandle = orderFlowDirection
    ? orderFlowDirection === 'left-to-right'
      ? 'target'
      : 'source'
    : backward
      ? 'source'
      : 'target';
  const rightHandle = orderFlowDirection
    ? orderFlowDirection === 'left-to-right'
      ? 'source'
      : 'target'
    : backward
      ? 'target'
      : 'source';
  const renderHandles = (
    handleType: 'source' | 'target',
    position: Position,
    legacyAllowed: boolean,
  ) => {
    const ports = moduleHandlePorts(module, signalMode, orderFlowDirection, handleType);
    if (ports) {
      return ports.map((port, index) => (
        <Handle
          id={port.name}
          key={`${handleType}:${port.name}`}
          type={handleType}
          position={position}
          style={{ top: `${((index + 1) / (ports.length + 1)) * 100}%` }}
        />
      ));
    }
    return legacyAllowed ? <Handle type={handleType} position={position} /> : null;
  };
  return (
    <article
      className={`module-node module-node--${health}${selected ? ' module-node--selected' : ''}${repeat ? ' module-node--stacked' : ''}${compositeBlock ? ' module-node--composite' : ''}${changeKind ? ` module-node--change-${changeKind}` : ''}`}
      data-model-node-id={module.id}
      data-repeat-count={repeat?.count}
      data-change-kind={changeKind ?? undefined}
    >
      {changeKind ? (
        <span className="module-node__change-badge">
          {changeKind === 'added' ? uiText('ADDED') : uiText('MODIFIED')}
        </span>
      ) : null}
      {leftHandle === 'source'
        ? renderHandles(
            'source',
            Position.Left,
            module.kind !== 'output' && module.kind !== 'objective',
          )
        : renderHandles('target', Position.Left, module.kind !== 'input')}
      <button
        className="module-node__content"
        type="button"
        aria-pressed={selected}
        aria-haspopup={compositeBlock ? undefined : 'dialog'}
        aria-expanded={compositeBlock ? undefined : detailExpanded}
        aria-controls={compositeBlock ? undefined : detailDialogId}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space"
        aria-label={`${module.name}. ${repeat ? `Repeated stack of ${repeat.count} ${repeat.label}. ` : ''}${healthLabel[health]}. ${module.transform}. ${formulaAccessibilityLabel}`}
        onClick={(event) => {
          event.stopPropagation();
          if (compositeBlock) compositeBlock.onOpen();
          else onActivate(module);
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="module-node__topline">
          <span>{module.group}</span>
          <span className="module-node__health" aria-label={uiText(healthLabel[health])}>
            <span aria-hidden="true" />
            {health === 'healthy'
              ? uiText('flowing')
              : health === 'not-applicable'
                ? uiText('not applicable')
                : uiText(health)}
          </span>
        </div>
        {repeat ? (
          <div
            className="module-node__repeat"
            aria-label={uiText('{value0} repeated {value1}', {
              value0: repeat.count,
              value1: repeat.label,
            })}
          >
            <span className="module-node__repeat-layers" aria-hidden="true">
              {moduleRepeatStackLayers(repeat).map((layer) => (
                <i key={layer} data-repeat-layer={layer}>
                  <span>{uiText('BLOCK')}</span>
                </i>
              ))}
            </span>
            <span className="module-node__repeat-copy">
              <strong>{repeat.label}</strong>
              <small>{uiText('same block composed')}</small>
            </span>
            <strong className="module-node__repeat-count">×{repeat.count}</strong>
          </div>
        ) : null}
        {compositeBlock ? (
          <div className="module-node__composite-summary">
            <strong>{compositeBlock.label}</strong>
            <code>
              {formatModuleInputContract(module)} → {formatModuleOutputContract(module)}
            </code>
            <span>
              {uiText('One iteration · ')}
              {compositeBlock.moduleCount}
              {uiText(' internal ')}
              {compositeBlock.detailKind}
            </span>
            <b>{uiText('Open block details →')}</b>
          </div>
        ) : (
          <>
            <strong>{module.name}</strong>
            <code>
              {formatModuleInputContract(module)} → {formatModuleOutputContract(module)}
            </code>
            <div className="module-node__operation">{module.transform}</div>
            <div className="module-node__activation">
              {module.activation ?? uiText('No activation')}
            </div>
            <div
              className="module-node__formula"
              title={module.formula}
              aria-label={formulaAccessibilityLabel}
            >
              <div className="module-node__formula-list">
                {formulaRows.map((row, index) => (
                  <div
                    className={`module-node__formula-row nowheel nodrag${row.length > 110 ? ' module-node__formula-row--very-long' : row.length > 72 ? ' module-node__formula-row--long' : ''}`}
                    key={`${index}:${row}`}
                  >
                    <Formula latex={row} displayMode={row.includes('\\begin{')} />
                  </div>
                ))}
              </div>
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
          {subgraph.expanded ? uiText('Collapse') : uiText('Expand')} {subgraph.moduleCount}
          {uiText(' submodules')}
        </button>
      ) : null}
      {rightHandle === 'source'
        ? renderHandles(
            'source',
            Position.Right,
            module.kind !== 'output' && module.kind !== 'objective',
          )
        : renderHandles('target', Position.Right, module.kind !== 'input')}
    </article>
  );
}

export function SubgraphBoundaryNodeView({ data }: NodeProps<SubgraphBoundaryFlowNode>) {
  useUiText();
  return (
    <section
      className="subgraph-boundary"
      aria-label={uiText('{value0} expanded submodules', { value0: data.modelName })}
    >
      <header>
        <span>
          {uiText('INSIDE ')}
          {data.parentModuleName} · {data.moduleCount}
          {uiText(' SUBMODULES')}
        </span>
        <strong>{data.modelName}</strong>
        <button className="nodrag" type="button" onClick={data.onCollapse}>
          {uiText('Collapse')}
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

export function moduleFormulaAccessibilityLabel(rows: readonly string[]) {
  const count = rows.length;
  const summaries = rows.map((row) => compactModuleFormula(row, 120)).join('; ');
  return `${count} ${count === 1 ? 'equation' : 'equations'}${summaries ? `: ${summaries}` : ''}`;
}

function isGraphNavigationKey(key: string): key is GraphNavigationKey {
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key);
}
