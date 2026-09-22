import { uiText, useUiText } from '@gosu/ui/language';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Formula, formulaDisplayRows } from './formula';
import { compactGraphShape, englishGraphName, graphCardSummary } from './graph-presentation';
import type { GraphNavigationKey } from './model-graph';
import type { GradientHealth, ModelModule } from './model-lab-schema';

export type ModuleNodeData = Readonly<{
  module: ModelModule;
  stageLabel?: string;
  changeKind: 'added' | 'changed' | null;
  health: GradientHealth;
  signalMode: 'forward' | 'backward';
  orderFlowDirection: 'left-to-right' | 'right-to-left' | null;
  selectionTargetId: string;
  detailExpanded: boolean;
  detailDialogId: string;
  /** A Model Assistant discussion of this module (or of a step inside it) is saved. */
  explained?: boolean;
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
    explained,
    navigationTargets,
    compositeBlock,
    subgraph,
    onActivate,
    onNavigate,
    signalMode,
    orderFlowDirection,
  } = data;
  const formulaRows = formulaDisplayRows(module.formula);
  const repeat = moduleRepeatPresentation(module);
  const input = compactGraphShape(module.inputShape),
    output = compactGraphShape(module.outputShape);
  const label = englishGraphName(
    compositeBlock?.label ?? module.name,
    module.id,
    'Processing Block',
  );
  const repeats = repeat?.count ?? compositeBlock?.repeatCount;

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
          title={port.name}
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
      className={`module-node module-node--story module-node--${signalMode} module-node--${health}${selected ? ' module-node--selected' : ''}${compositeBlock ? ' module-node--composite' : ''}${explained ? ' module-node--explained' : ''}${changeKind ? ` module-node--change-${changeKind}` : ''}`}
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
        aria-label={`${label}. ${repeats ? `Repeated ${repeats} times. ` : ''}${signalMode === 'backward' ? healthLabel[health] : 'Architecture block'}. ${explained ? 'AI explanation saved. ' : ''}Open details for full equations and ports.`}
        onClick={(event) => {
          event.stopPropagation();
          if (compositeBlock) compositeBlock.onOpen();
          else onActivate(module);
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="module-node__topline">
          <span>
            <b className="module-node__stage">{data.stageLabel ?? `S${module.stage + 1}`}</b>{' '}
            {module.kind.toUpperCase()}
          </span>
          <span className="module-node__topline-end">
            {explained ? (
              <span
                className="module-node__ai-badge"
                title={uiText(
                  'Model Assistant explained this module in detail. Open details to read it.',
                )}
              >
                <span aria-hidden="true">✦</span>
                {uiText('AI explained')}
              </span>
            ) : null}
            {repeats ? (
              <b className="module-node__loop">×{repeats}</b>
            ) : signalMode === 'backward' ? (
              <span className="module-node__health" aria-label={uiText(healthLabel[health])}>
                {uiText(health)}
              </span>
            ) : null}
          </span>
        </div>
        <strong className="module-node__story-title" title={label}>
          {label}
        </strong>
        <div className="module-node__reasoning">
          <p className="module-node__purpose" title={graphCardSummary(module)}>
            {compositeBlock
              ? `${uiText('One iteration · ')}${compositeBlock.moduleCount} ${uiText('internal stages')}`
              : graphCardSummary(module)}
          </p>
          {!compositeBlock && (
            <div
              className="module-node__key-equation"
              title={uiText('Stored design equation · not runtime verification')}
            >
              <Formula
                latex={module.presentation?.keyEquation ?? formulaRows[0] ?? module.formula}
              />
            </div>
          )}
          {module.presentation?.shapeNotes && (
            <small className="module-node__shape-notes" title={module.presentation.shapeNotes}>
              {module.presentation.shapeNotes}
            </small>
          )}
        </div>
        <div className="module-node__io">
          <span>
            <small>
              IN{(module.inputPorts?.length ?? 0) > 1 ? ` · ${module.inputPorts!.length}` : ''}
            </small>
            <code>{input.text}</code>
          </span>
          <span>
            <small>
              OUT{(module.outputPorts?.length ?? 0) > 1 ? ` · ${module.outputPorts!.length}` : ''}
            </small>
            <code>{output.text}</code>
          </span>
        </div>
        <div className="module-node__story-footer">
          <small
            className={input.uncertain || output.uncertain ? 'module-node__dimension-warning' : ''}
            title={module.presentation?.uncertainties.join('\n')}
          >
            {input.uncertain || output.uncertain
              ? uiText('Stored shape invalid · see equations')
              : module.presentation?.uncertainties.length
                ? module.presentation.uncertainties[0]
                : `${formulaRows.length} ${uiText('equations in details')}`}
          </small>
          <b>{compositeBlock ? uiText('Open block →') : uiText('Details →')}</b>
        </div>
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
