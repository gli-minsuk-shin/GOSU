import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Formula, MAX_FORMULA_SOURCE_LENGTH, renderFormulaResult } from './formula';
import {
  backwardSignalNote,
  composeRepeatedBlocks,
  composeModelSubgraphs,
  connectionSignalReading,
  findLogicalNeighborId,
  gradientStrokeWidth,
  modelGraphCenterViewOptions,
  modelGraphFitViewOptions,
  nestedModuleId,
  overviewModel,
  signalStripAccessibilityProps,
  signalEndpoints,
} from './model-graph';
import {
  availablePanelMaximum,
  clampPanelWidth,
  copilotContentAccessibilityProps,
  copilotRestoreAccessibilityProps,
  createImportedModelSession,
  createModelChatSession,
  createModelViewSession,
  handoffCopilotFocus,
  isCopilotPanelCollapsed,
  mobileCopilotOpenAfterLayoutChange,
  modelChatSessionKey,
  modelChatSessionWithAttachments,
  modelChatSessionWithDraft,
  modelGraphInstanceKey,
  modelLabShellClassName,
  modelLabWorkbenchClassName,
  MODEL_COPILOT_MAX_WIDTH,
  MODEL_COPILOT_MIN_WIDTH,
  MODEL_SESSION_SIDEBAR_MAX_WIDTH,
  MODEL_SESSION_SIDEBAR_MIN_WIDTH,
  modelSessionDeleteLabel,
  moveModelSessionToTrash,
  ModuleDetailDialog,
  moduleDetailEvidenceSummary,
  moduleDetailGradientEvidence,
  modelViewSessionWithUpdate,
  panelWidthAfterPointerMove,
  panelWidthAfterSeparatorKey,
  replaceModelPreservingOrder,
  shouldHandoffCopilotFocus,
  withoutTrashedModelSessions,
} from './model-lab-app';
import {
  compactModuleFormula,
  isModuleActivationKey,
  moduleRepeatPresentation,
  moduleRepeatStackLayers,
} from './module-node';
import {
  filmTransformerClassifier,
  residualClassifier,
  sampleModels,
  sparkvskLearnedWarmPath,
  tropicLambdaPathCompiler,
} from './sample-models';

describe('Model graph interaction contract', () => {
  it('reverses graph endpoints for backward gradients so arrows travel output to input', () => {
    const connection = residualClassifier.connections[0];
    expect(connection).toBeDefined();
    if (!connection) return;

    expect(signalEndpoints(connection, 'forward')).toEqual({
      source: connection.source,
      target: connection.target,
    });
    expect(signalEndpoints(connection, 'backward')).toEqual({
      source: connection.target,
      target: connection.source,
    });
  });

  it('maps arrow keys to connected or spatially adjacent modules', () => {
    expect(
      findLogicalNeighborId(
        residualClassifier.modules,
        residualClassifier.connections,
        'projection',
        'ArrowLeft',
      ),
    ).toBe('input');
    expect(
      findLogicalNeighborId(
        residualClassifier.modules,
        residualClassifier.connections,
        'projection',
        'ArrowRight',
      ),
    ).toBe('pre-norm');
    expect(
      findLogicalNeighborId(
        residualClassifier.modules,
        residualClassifier.connections,
        'skip',
        'ArrowUp',
      ),
    ).toBe('residual-mlp');
  });

  it('keeps formulas readable within compact graph cards', () => {
    expect(compactModuleFormula(String.raw`h_1 = \operatorname{GELU}(xW_p + b_p)`)).toBe(
      'h_1 = GELU(xW_p + b_p)',
    );
    expect(compactModuleFormula('x'.repeat(80))).toHaveLength(52);
    expect(compactModuleFormula('x'.repeat(80))).toMatch(/…$/);
  });

  it('renders repeated layers as one explicit stacked block instead of an arrow-only chain', () => {
    const repeatedBlock = sparkvskLearnedWarmPath.modules.find(
      (module) => module.id === 'sparkvsk-message-passing',
    );
    const repeatedHead = sparkvskLearnedWarmPath.modules.find(
      (module) => module.id === 'sparkvsk-correction-head',
    );
    const singleBlock = filmTransformerClassifier.modules.find(
      (module) => module.id === 'tf-attention',
    );

    expect(repeatedBlock).toBeDefined();
    expect(repeatedHead).toBeDefined();
    expect(singleBlock).toBeDefined();
    if (!repeatedBlock || !repeatedHead || !singleBlock) return;
    expect(moduleRepeatPresentation(repeatedBlock)).toEqual({
      count: 4,
      label: 'SPARK block',
    });
    expect(moduleRepeatPresentation(repeatedHead)).toEqual({
      count: 3,
      label: 'Linear layer',
    });
    expect(moduleRepeatPresentation(singleBlock)).toBeNull();
    expect(moduleRepeatStackLayers({ count: 4, label: 'SPARK block' })).toEqual([1, 2, 3]);
    expect(moduleRepeatStackLayers({ count: 2, label: 'Linear layer' })).toEqual([1, 2]);
    expect(moduleRepeatStackLayers({ count: 'L-1', label: 'Iterative block' })).toEqual([1, 2, 3]);

    const graphCardSource = readFileSync(new URL('./module-node.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(graphCardSource).toContain('data-repeat-count={repeat?.count}');
    expect(graphCardSource).toContain('module-node__repeat-layers');
    expect(graphCardSource).toContain('same block composed');
    expect(styles).toContain('.module-node__repeat-layers i:nth-child(3)');
    expect(styles).not.toContain('.module-node--stacked::before');
    expect(styles).not.toContain('.module-node--stacked::after');
  });

  it('collapses a repeated multi-module composition into one block and exposes one iteration', () => {
    const hierarchy = composeRepeatedBlocks(filmTransformerClassifier);
    const block = hierarchy.blocks[0];

    expect(block).toMatchObject({
      id: 'film-transformer-block',
      label: 'FiLM-conditioned Transformer block',
      repeatCount: 'L',
    });
    expect(block?.memberModuleIds).toHaveLength(10);
    expect(block?.detailModel.modules).toHaveLength(10);
    expect(block?.detailModel.connections).toHaveLength(10);
    expect(block?.detailModel.modules.every((module) => module.block === undefined)).toBe(true);
    expect(hierarchy.model.modules).toHaveLength(6);
    expect(hierarchy.model.connections).toHaveLength(5);
    expect(hierarchy.model.modules.some((module) => module.id === block?.summaryModuleId)).toBe(
      true,
    );
    expect(
      hierarchy.model.modules.some((module) => block?.memberModuleIds.includes(module.id)),
    ).toBe(false);
    expect(
      hierarchy.model.connections.every(
        (connection) =>
          !block?.memberModuleIds.includes(connection.source) &&
          !block?.memberModuleIds.includes(connection.target),
      ),
    ).toBe(true);
  });

  it('renders a composite block as a click-to-drill-down card instead of internal sequence text', () => {
    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    const nodeSource = readFileSync(new URL('./module-node.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(nodeSource).toContain('module-node--composite');
    expect(nodeSource).toContain('Open block details →');
    expect(graphSource).toContain('INSIDE COMPOSITE BLOCK');
    expect(graphSource).toContain('← Whole model');
    expect(styles).toContain('14px -14px 0 -1px var(--model-surface)');
  });

  it('renders wrapped HTML edge labels above the graph instead of clipped SVG text', () => {
    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(graphSource).toContain('<EdgeLabelRenderer>');
    expect(graphSource).toContain(
      'className={`signal-edge__label signal-edge__label--${data.health}`}',
    );
    expect(graphSource).toContain("type: 'signal'");
    expect(graphSource).not.toContain('labelBgPadding');
    expect(styles).toMatch(
      /\.signal-edge__label \{[\s\S]*?max-width: 136px;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/u,
    );
  });

  it('renders graph-card formulas as bounded, untrusted KaTeX with MathML', () => {
    const latex = String.raw`h_1 = \operatorname{GELU}(xW_p + b_p)`;
    const rendered = renderFormulaResult(latex, false);
    expect(rendered.valid).toBe(true);
    if (!rendered.valid) return;
    expect(rendered.html).toContain('class="katex"');
    expect(rendered.html).toContain('<math');
    expect(renderFormulaResult(latex, false)).toBe(rendered);

    const graphCardSource = readFileSync(new URL('./module-node.tsx', import.meta.url), 'utf8');
    expect(graphCardSource).toContain('<Formula latex={module.formula} displayMode={false} />');
    expect(graphCardSource).not.toContain('ƒ {compactFormula}');
  });

  it('strict-renders every bundled module formula through the safe KaTeX boundary', () => {
    const formulas = sampleModels.flatMap((model) => model.modules.map((module) => module.formula));
    expect(formulas).toHaveLength(53);
    expect(formulas.every((formula) => renderFormulaResult(formula, false).valid)).toBe(true);
  });

  it('shows TROPIC compiler edges as non-differentiable instead of inventing gradients', () => {
    const reading = connectionSignalReading(
      tropicLambdaPathCompiler.connections[0]!,
      'healthy',
      4,
      'backward',
    );
    expect(reading).toMatchObject({
      health: 'not-applicable',
      observationState: 'not-applicable',
      value: 'not-applicable',
    });
    expect(backwardSignalNote(tropicLambdaPathCompiler, 'healthy')).toContain(
      'no explicit loss objective or runtime receipt',
    );
  });

  it('uses an explicit text fallback for invalid, trusted-command, and oversized formulas', () => {
    expect(renderFormulaResult(String.raw`\frac{`, true)).toMatchObject({ valid: false });
    expect(renderFormulaResult(String.raw`\href{javascript:alert(1)}{x}`, false)).toMatchObject({
      valid: false,
      reason: 'Formula contains a command that requires KaTeX trust.',
    });
    expect(renderFormulaResult('x'.repeat(MAX_FORMULA_SOURCE_LENGTH + 1))).toMatchObject({
      valid: false,
    });
    const fallback = renderToStaticMarkup(createElement(Formula, { latex: String.raw`\frac{` }));
    expect(fallback).toContain('formula--invalid');
    expect(fallback).toContain('Formula unavailable');
  });

  it('opens module detail only for activation keys, not graph navigation keys', () => {
    expect(isModuleActivationKey('Enter')).toBe(true);
    expect(isModuleActivationKey(' ')).toBe(true);
    expect(isModuleActivationKey('ArrowRight')).toBe(false);
  });

  it('renders an accessible enlarged module detail with complete design and gradient evidence', () => {
    const module = residualClassifier.modules.find((candidate) => candidate.id === 'projection');
    expect(module).toBeDefined();
    if (!module) return;
    const markup = renderToStaticMarkup(
      createElement(ModuleDetailDialog, {
        model: residualClassifier,
        module,
        probe: 'healthy',
        checkpointIndex: 4,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain('id="model-module-detail-dialog"');
    expect(markup).toContain('aria-labelledby="module-detail-title"');
    expect(markup).toContain('What this module does');
    expect(markup).toContain('Module equation');
    expect(markup).toContain('Input shape');
    expect(markup).toContain('Output shape');
    expect(markup).toContain('Linear transform / operation');
    expect(markup).toContain('Activation');
    expect(markup).toContain('Parameters');
    expect(markup).toContain('Code reference');
    expect(markup).toContain('Forward input tensors');
    expect(markup).toContain('Forward output tensors');
    expect(markup).toContain('Backward gradient');
    expect(markup).toContain('Mean healthy-probe activation RMS');
    expect(markup).toContain('gradient expected');
    expect(markup).toContain('Model-wide coverage');
    expect(markup).toContain('class="katex-display"');
  });

  it('keeps the clicked residual summary and its aggregate boundary evidence authoritative', () => {
    const graphModel = overviewModel(residualClassifier, 'overview');
    const summary = graphModel.modules.find(
      (candidate) => candidate.id === 'residual-block-summary',
    );
    expect(summary?.name).toBe('Residual block');
    expect(
      moduleDetailGradientEvidence(graphModel, 'residual-block-summary', 'healthy', 4),
    ).toHaveLength(2);
  });

  it('collapses TROPIC to a readable six-stage overview while preserving all expanded modules', () => {
    const overview = overviewModel(tropicLambdaPathCompiler, 'overview');
    const expanded = overviewModel(tropicLambdaPathCompiler, 'expanded');
    expect(overview.modules.map((module) => module.id)).toEqual([
      'tropic-task',
      'tropic-spark-warm-path',
      'tropic-candidate-summary',
      'tropic-path-summary',
      'tropic-audit',
      'tropic-output-summary',
    ]);
    expect(overview.connections).toHaveLength(5);
    expect(expanded.modules).toHaveLength(13);
    expect(expanded.connections).toHaveLength(12);
    expect(
      overview.modules.every((module) => renderFormulaResult(module.formula, false).valid),
    ).toBe(true);
    const moduleById = new Map(overview.modules.map((module) => [module.id, module]));
    expect(
      overview.connections.every((connection) => {
        const source = moduleById.get(connection.source);
        const target = moduleById.get(connection.target);
        return (
          JSON.stringify(source?.outputShape) === JSON.stringify(connection.shape) &&
          JSON.stringify(target?.inputShape) === JSON.stringify(connection.shape)
        );
      }),
    ).toBe(true);
  });

  it('offers a readable SPARKVSK overview and preserves its full 13-stage internal graph', () => {
    const overview = overviewModel(sparkvskLearnedWarmPath, 'overview');
    const expanded = overviewModel(sparkvskLearnedWarmPath, 'expanded');
    expect(overview.modules.map((module) => module.id)).toEqual([
      'sparkvsk-input-summary',
      'sparkvsk-trunk-summary',
      'sparkvsk-conditioning-summary',
      'sparkvsk-scale-summary',
      'sparkvsk-solve-summary',
      'sparkvsk-output',
    ]);
    expect(overview.modules.map((module) => module.stage)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(overview.connections).toHaveLength(5);
    expect(expanded.modules).toHaveLength(13);
    expect(expanded.connections).toHaveLength(12);
    expect(
      overview.modules.every((module) => renderFormulaResult(module.formula, false).valid),
    ).toBe(true);
    const moduleById = new Map(overview.modules.map((module) => [module.id, module]));
    expect(
      overview.connections.every((connection) => {
        const source = moduleById.get(connection.source);
        const target = moduleById.get(connection.target);
        return (
          JSON.stringify(source?.outputShape) === JSON.stringify(connection.shape) &&
          JSON.stringify(target?.inputShape) === JSON.stringify(connection.shape)
        );
      }),
    ).toBe(true);
    expect(
      overview.modules.find((module) => module.id === 'sparkvsk-conditioning-summary')?.formula,
    ).toContain(String.raw`\log\lambda_q`);
    expect(
      overview.modules.find((module) => module.id === 'sparkvsk-trunk-summary')?.repeat,
    ).toEqual({ count: 4, label: 'SPARK block' });
    expect(
      overview.modules.find((module) => module.id === 'sparkvsk-scale-summary')?.repeat,
    ).toEqual({ count: 3, label: 'Linear layer' });
  });

  it('shows repeated depth in the enlarged module detail', () => {
    const module = sparkvskLearnedWarmPath.modules.find(
      (candidate) => candidate.id === 'sparkvsk-message-passing',
    );
    expect(module).toBeDefined();
    if (!module) return;
    const markup = renderToStaticMarkup(
      createElement(ModuleDetailDialog, {
        model: sparkvskLearnedWarmPath,
        module,
        probe: 'healthy',
        checkpointIndex: 4,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain('Repeated stack');
    expect(markup).toContain('4 × SPARK block');
  });

  it('expands SPARKVSK as namespaced submodules inside the TROPIC graph', () => {
    const parentGraph = overviewModel(tropicLambdaPathCompiler, 'overview');
    const composition = composeModelSubgraphs(parentGraph, sampleModels, [
      'tropic-spark-warm-path',
    ]);
    const childIds = sparkvskLearnedWarmPath.modules.map((module) =>
      nestedModuleId('tropic-spark-warm-path', module.id),
    );
    expect(composition.model.modules).toHaveLength(parentGraph.modules.length + childIds.length);
    expect(composition.model.connections).toHaveLength(
      parentGraph.connections.length + sparkvskLearnedWarmPath.connections.length,
    );
    expect(composition.model.modules.map((module) => module.id)).toEqual(
      expect.arrayContaining(['tropic-spark-warm-path', ...childIds]),
    );
    expect(composition.expansions).toEqual([
      expect.objectContaining({
        parentModuleId: 'tropic-spark-warm-path',
        modelName: 'SPARKVSK learned warm path',
        moduleIds: childIds,
      }),
    ]);
    expect(composition.model.modules.find((module) => module.id === childIds[5])?.group).toContain(
      'SPARKVSK learned warm path',
    );
  });

  it('uses the same subgraph composition for an arbitrary host module', () => {
    const host: typeof residualClassifier = {
      ...residualClassifier,
      id: 'generic-hierarchical-host',
      modules: residualClassifier.modules.map((module) =>
        module.id === 'projection'
          ? { ...module, subgraph: { modelId: filmTransformerClassifier.id } }
          : module,
      ),
    };
    const composition = composeModelSubgraphs(
      host,
      [host, filmTransformerClassifier],
      ['projection'],
    );
    expect(composition.subgraphTargets.projection).toEqual({
      modelId: filmTransformerClassifier.id,
      modelName: filmTransformerClassifier.name,
      moduleCount: filmTransformerClassifier.modules.length,
    });
    expect(composition.expansions[0]?.moduleIds).toHaveLength(
      filmTransformerClassifier.modules.length,
    );
  });

  it('advertises a generic inline subgraph action from module detail', () => {
    const warmPath = tropicLambdaPathCompiler.modules.find(
      (module) => module.id === 'tropic-spark-warm-path',
    );
    expect(warmPath).toBeDefined();
    if (!warmPath) return;
    const markup = renderToStaticMarkup(
      createElement(ModuleDetailDialog, {
        model: tropicLambdaPathCompiler,
        module: warmPath,
        probe: 'healthy',
        checkpointIndex: 4,
        onClose: () => undefined,
        subgraphAction: {
          modelName: sparkvskLearnedWarmPath.name,
          moduleCount: sparkvskLearnedWarmPath.modules.length,
          expanded: false,
          onToggle: () => undefined,
        },
      }),
    );
    expect(markup).toContain('Expand');
    expect(markup).toContain('13');
    expect(markup).toContain('submodules');
    expect(markup).toContain('inside graph');
  });

  it('reports mixed FiLM edge observations without calling the whole module blocked', () => {
    const evidence = moduleDetailGradientEvidence(
      filmTransformerClassifier,
      'tf-film',
      'detached',
      4,
    );
    expect(new Set(evidence.map((reading) => reading.direction))).toEqual(
      new Set(['incoming', 'outgoing']),
    );
    expect(new Set(evidence.map((reading) => reading.state))).toEqual(
      new Set(['observed', 'detached']),
    );
    expect(moduleDetailEvidenceSummary(evidence)).toBe('Mixed edge observations');
    expect(evidence.every((reading) => reading.shape.length > 0)).toBe(true);
  });

  it('labels module-detail tensor topology separately from backward gradient direction', () => {
    const evidence = moduleDetailGradientEvidence(residualClassifier, 'projection', 'healthy', 4);
    expect(evidence).toContainEqual(
      expect.objectContaining({
        direction: 'incoming',
        forwardRoute: 'input → projection',
        backwardGradientRoute: 'projection → input',
      }),
    );
    expect(evidence).toContainEqual(
      expect.objectContaining({
        direction: 'outgoing',
        forwardRoute: 'projection → pre-norm',
        backwardGradientRoute: 'pre-norm → projection',
      }),
    );
  });

  it('uses a finite fallback width when gradient evidence is detached or absent', () => {
    expect(gradientStrokeWidth(Number.NaN, 'detached')).toBe(2);
    expect(gradientStrokeWidth(Number.NaN, 'not-observed')).toBe(2);
    expect(gradientStrokeWidth(0.0042, 'observed')).toBeGreaterThanOrEqual(1.5);
    expect(Number.isFinite(gradientStrokeWidth(0.0042, 'observed'))).toBe(true);
  });

  it('provides unobscured signal-strip values with the same logical direction as the graph', () => {
    const connection = residualClassifier.connections[0];
    expect(connection).toBeDefined();
    if (!connection) return;

    const backward = connectionSignalReading(connection, 'healthy', 4, 'backward');
    expect(backward).toMatchObject({
      tensorName: connection.tensorName,
      quantity: `∥∂L/∂${connection.tensorName}∥`,
      route: `${connection.target} → ${connection.source}`,
      observationState: 'observed',
    });
    expect(backward.value).not.toBe('not-observed');

    const forward = connectionSignalReading(connection, 'healthy', 4, 'forward');
    expect(forward.route).toBe(`${connection.source} → ${connection.target}`);
    expect(forward.quantity).toContain('activation RMS');
  });

  it('exposes a distinct shell state for the graph-only focus view', () => {
    expect(modelLabShellClassName(false)).toBe('model-lab-shell');
    expect(modelLabShellClassName(true)).toBe('model-lab-shell model-lab-shell--focus');
    expect(modelLabShellClassName(false, true)).toBe(
      'model-lab-shell model-lab-shell--sessions-collapsed',
    );
    expect(modelGraphFitViewOptions(true).minZoom).toBeGreaterThanOrEqual(0.58);
    expect(modelGraphFitViewOptions(false).minZoom).toBeUndefined();
  });

  it('offers an always-visible action that centers every model box without manual panning', () => {
    expect(modelGraphCenterViewOptions(false)).toEqual({
      padding: 0.12,
      minZoom: 0.22,
      maxZoom: 1.05,
      duration: 420,
    });
    expect(modelGraphCenterViewOptions(true)).toEqual({
      padding: 0.06,
      minZoom: 0.22,
      maxZoom: 0.9,
      duration: 420,
    });

    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    expect(graphSource).toContain('Center model boxes');
    expect(graphSource).toContain('Center all model boxes in the graph viewport');
    expect(graphSource).toContain('fitView(modelGraphCenterViewOptions(focusMode))');
  });

  it('resizes both desktop sidebars in the correct pointer and keyboard directions', () => {
    expect(panelWidthAfterPointerMove('model-sessions', 252, 100, 140)).toBe(292);
    expect(panelWidthAfterPointerMove('copilot', 390, 100, 140)).toBe(350);

    expect(
      panelWidthAfterSeparatorKey(
        'model-sessions',
        252,
        'ArrowRight',
        MODEL_SESSION_SIDEBAR_MIN_WIDTH,
        MODEL_SESSION_SIDEBAR_MAX_WIDTH,
      ),
    ).toBe(268);
    expect(
      panelWidthAfterSeparatorKey(
        'copilot',
        390,
        'ArrowLeft',
        MODEL_COPILOT_MIN_WIDTH,
        MODEL_COPILOT_MAX_WIDTH,
      ),
    ).toBe(406);
    expect(
      panelWidthAfterSeparatorKey(
        'copilot',
        390,
        'Home',
        MODEL_COPILOT_MIN_WIDTH,
        MODEL_COPILOT_MAX_WIDTH,
      ),
    ).toBe(MODEL_COPILOT_MIN_WIDTH);
  });

  it('clamps panel widths while reserving a usable graph workspace', () => {
    expect(clampPanelWidth(120, 190, 420)).toBe(190);
    expect(clampPanelWidth(900, 300, 620)).toBe(620);
    expect(availablePanelMaximum(1_280, 390, 190, 420)).toBe(356);
    expect(availablePanelMaximum(2_140, 390, 190, 420)).toBe(420);
  });

  it('describes the real FiLM probe objective without claiming it is missing', () => {
    expect(backwardSignalNote(filmTransformerClassifier, 'healthy')).toContain(
      'observed cross-entropy probe objective',
    );
    expect(backwardSignalNote(filmTransformerClassifier, 'vanishing')).toContain(
      'synthetic stress transform',
    );
    expect(backwardSignalNote(residualClassifier, 'healthy')).toContain(
      'observed cross-entropy probe objective',
    );
  });

  it('makes the complete signal strip keyboard-scrollable and self-describing', () => {
    expect(signalStripAccessibilityProps('backward')).toEqual({
      tabIndex: 0,
      'aria-label':
        'Scrollable gradient value cards. Use horizontal scrolling to inspect every connection.',
    });
  });

  it('keeps generated-model sessions ordered and isolates chat drafts by content revision', () => {
    const replacement = { ...residualClassifier, name: 'Replacement at the same position' };
    const replaced = replaceModelPreservingOrder(
      [residualClassifier, filmTransformerClassifier],
      replacement,
    );
    expect(replaced.map((model) => model.id)).toEqual([
      residualClassifier.id,
      filmTransformerClassifier.id,
    ]);
    expect(replaced[0]).toBe(replacement);

    const firstRevision = modelChatSessionKey(residualClassifier, 0);
    const nextRevision = modelChatSessionKey(residualClassifier, 1);
    let sessions = { [firstRevision]: createModelChatSession(residualClassifier) };
    sessions = modelChatSessionWithDraft(
      sessions,
      firstRevision,
      residualClassifier,
      'draft for revision zero',
    );
    sessions = modelChatSessionWithDraft(
      sessions,
      nextRevision,
      replacement,
      'draft for replacement',
    );
    expect(sessions[firstRevision]?.draft).toBe('draft for revision zero');
    expect(sessions[nextRevision]?.draft).toBe('draft for replacement');

    sessions = modelChatSessionWithAttachments(sessions, firstRevision, residualClassifier, [
      {
        id: 'attachment-1',
        size: 42,
        artifact: {
          name: 'question.md',
          mediaType: 'text/markdown',
          kind: 'text',
          encoding: 'utf8',
          content: 'Check this against revision zero.',
        },
      },
    ]);
    expect(sessions[firstRevision]?.attachments.map((entry) => entry.artifact.name)).toEqual([
      'question.md',
    ]);
    expect(sessions[nextRevision]?.attachments).toEqual([]);
  });

  it('always imports into a separate model session instead of replacing an existing model', () => {
    const existing = [residualClassifier, filmTransformerClassifier];
    const registration = createImportedModelSession(existing, {
      ...residualClassifier,
      summary: 'Newly reconstructed source',
    });

    expect(registration.identifierChanged).toBe(true);
    expect(registration.models).toHaveLength(existing.length + 1);
    expect(registration.models[0]).toBe(residualClassifier);
    expect(registration.model.id).toBe(`${residualClassifier.id}-import-2`);
    expect(registration.model.name).toBe(`${residualClassifier.name} (import 2)`);
    expect(registration.models.at(-1)).toBe(registration.model);

    const secondRegistration = createImportedModelSession(registration.models, residualClassifier);
    expect(secondRegistration.model.id).toBe(`${residualClassifier.id}-import-3`);
    expect(secondRegistration.models).toHaveLength(existing.length + 2);
  });

  it('moves model sessions to Trash and selects an adjacent active model when necessary', () => {
    const models = [residualClassifier, filmTransformerClassifier, tropicLambdaPathCompiler];
    const inactiveMove = moveModelSessionToTrash(
      models,
      [],
      residualClassifier.id,
      filmTransformerClassifier.id,
    );
    expect(inactiveMove).toEqual({
      activeModelId: residualClassifier.id,
      moved: true,
      reason: null,
      trashedModelIds: [filmTransformerClassifier.id],
    });

    const activeMove = moveModelSessionToTrash(
      models,
      inactiveMove.trashedModelIds,
      residualClassifier.id,
      residualClassifier.id,
    );
    expect(activeMove.activeModelId).toBe(tropicLambdaPathCompiler.id);
    expect(activeMove.trashedModelIds).toEqual([
      filmTransformerClassifier.id,
      residualClassifier.id,
    ]);
  });

  it('labels the model-session removal action as Delete', () => {
    expect(modelSessionDeleteLabel('TROPIC λ-path compiler')).toBe('Delete TROPIC λ-path compiler');
  });

  it('keeps one active model and permanently purges only matching chat/view session keys', () => {
    expect(
      moveModelSessionToTrash(
        [residualClassifier],
        [],
        residualClassifier.id,
        residualClassifier.id,
      ),
    ).toMatchObject({ moved: false, reason: 'last-active-model' });

    const residualRevisionZero = modelChatSessionKey(residualClassifier, 0);
    const residualRevisionOne = modelChatSessionKey(residualClassifier, 1);
    const filmRevisionZero = modelChatSessionKey(filmTransformerClassifier, 0);
    const cleaned = withoutTrashedModelSessions(
      {
        [residualRevisionZero]: 'residual-v0',
        [residualRevisionOne]: 'residual-v1',
        [filmRevisionZero]: 'film-v0',
        legacy: 'keep-unknown-key',
      },
      [residualClassifier.id],
    );

    expect(cleaned).toEqual({
      [filmRevisionZero]: 'film-v0',
      legacy: 'keep-unknown-key',
    });
  });

  it('uses collision-free model session keys even when identifiers contain separators', () => {
    expect(modelChatSessionKey({ id: 'a::b', version: 'c' }, 0)).not.toBe(
      modelChatSessionKey({ id: 'a', version: 'b::c' }, 0),
    );
    expect(modelGraphInstanceKey(residualClassifier.id, 0, false)).not.toBe(
      modelGraphInstanceKey(residualClassifier.id, 1, false),
    );
    expect(modelGraphInstanceKey(residualClassifier.id, 0, false, [])).not.toBe(
      modelGraphInstanceKey(residualClassifier.id, 0, false, ['projection']),
    );
    expect(modelGraphInstanceKey(residualClassifier.id, 0, false, [], false, false)).not.toBe(
      modelGraphInstanceKey(residualClassifier.id, 0, false, [], true, false),
    );
    expect(modelGraphInstanceKey(residualClassifier.id, 0, false, [], false, false)).not.toBe(
      modelGraphInstanceKey(residualClassifier.id, 0, false, [], false, true),
    );
  });

  it('restores module selection and graph detail independently for each model revision', () => {
    const firstRevision = modelChatSessionKey(residualClassifier, 0);
    const nextRevision = modelChatSessionKey(residualClassifier, 1);
    let views = { [firstRevision]: createModelViewSession(residualClassifier) };
    views = modelViewSessionWithUpdate(views, firstRevision, residualClassifier, {
      selectedModuleId: 'merge',
      graphDetail: 'expanded',
    });
    views = modelViewSessionWithUpdate(views, nextRevision, residualClassifier, {
      selectedModuleId: 'projection',
    });
    expect(views[firstRevision]).toEqual({
      selectedModuleId: 'merge',
      graphDetail: 'expanded',
      expandedSubgraphModuleIds: [],
    });
    expect(views[nextRevision]).toEqual({
      selectedModuleId: 'projection',
      graphDetail: 'overview',
      expandedSubgraphModuleIds: [],
    });
  });

  it('keeps only the visible Copilot toggle focusable across desktop and mobile layouts', () => {
    expect(isCopilotPanelCollapsed(false, false, false)).toBe(false);
    expect(isCopilotPanelCollapsed(false, true, true)).toBe(true);
    expect(isCopilotPanelCollapsed(true, false, false)).toBe(true);
    expect(isCopilotPanelCollapsed(true, true, true)).toBe(false);
    expect(copilotContentAccessibilityProps(true)).toEqual({
      inert: true,
      'aria-hidden': true,
    });
    expect(copilotRestoreAccessibilityProps(false)).toEqual({ hidden: true });
    expect(copilotRestoreAccessibilityProps(true)).toEqual({ hidden: false });
    expect(modelLabWorkbenchClassName(true)).toContain('copilot-collapsed');
  });

  it('hands focus to the control revealed by every Copilot panel transition', () => {
    const focused: string[] = [];
    const scheduleImmediately = (callback: () => void) => callback();
    const targets = {
      restore: { focus: () => focused.push('restore') },
      composer: { focus: () => focused.push('composer') },
      close: { focus: () => focused.push('close') },
    };

    handoffCopilotFocus(true, targets, scheduleImmediately);
    handoffCopilotFocus(false, targets, scheduleImmediately);
    handoffCopilotFocus(false, { ...targets, composer: null }, scheduleImmediately);

    expect(focused).toEqual(['restore', 'composer', 'close']);
  });

  it('routes breakpoint-derived panel changes through focus handoff only when focus was inside', () => {
    const desktopOpen = isCopilotPanelCollapsed(false, false, false);
    const mobileClosed = isCopilotPanelCollapsed(true, false, false);
    expect(desktopOpen).toBe(false);
    expect(mobileClosed).toBe(true);
    expect(shouldHandoffCopilotFocus(desktopOpen, mobileClosed, true)).toBe(true);
    expect(shouldHandoffCopilotFocus(desktopOpen, mobileClosed, false)).toBe(false);
    expect(shouldHandoffCopilotFocus(mobileClosed, mobileClosed, true)).toBe(false);
  });

  it('closes the transient mobile Copilot drawer whenever the breakpoint changes', () => {
    expect(mobileCopilotOpenAfterLayoutChange(true, true, true)).toBe(true);
    expect(mobileCopilotOpenAfterLayoutChange(true, false, true)).toBe(false);
    expect(mobileCopilotOpenAfterLayoutChange(false, true, true)).toBe(false);
  });

  it('keeps both navigation rails out of graph focus mode and lets the graph fill the viewport', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('.model-lab-shell--focus > .model-session-sidebar');
    expect(styles).toContain('.model-lab-shell--focus > .panel-resizer');
    expect(styles).toContain('.model-lab-shell--focus .model-chat--sidebar');
    expect(styles).toContain('.model-lab-shell--focus .model-lab-primary');
    expect(styles).toContain('height: 100dvh;');
  });

  it('uses adjustable sidebar columns and a dedicated collapsed model-session rail', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    expect(styles).toContain('var(--model-session-sidebar-width, 252px)');
    expect(styles).toContain('var(--model-copilot-width, 390px)');
    expect(styles).toContain('.model-lab-shell--sessions-collapsed');
    expect(styles).toContain('.model-session-sidebar--collapsed .model-session-sidebar__restore');
    expect(styles).toContain('.panel-resizer:focus-visible');
    expect(styles).toContain('grid-template-rows: 52px;');
    expect(styles).toContain('writing-mode: horizontal-tb;');
    expect(appSource).toContain('const modelSessionsPanelCollapsed = modelSessionsCollapsed;');
    expect(appSource).not.toContain('hidden={stackedSessionLayout}');
    expect(modelLabShellClassName(false, true)).not.toContain('model-lab-shell--focus');
  });

  it('keeps main content in the third desktop grid column when the hidden resizer is removed', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(styles).toMatch(/\.model-lab-content \{\s+grid-column: 3;\s+width: 100%;\s+\}/);
    expect(styles).toMatch(/\.panel-resizer--model-sessions \{\s+grid-column: 2;\s+\}/);
    expect(styles).toMatch(/\.model-session-sidebar \{\s+grid-column: 1;/);
    expect(styles).toMatch(
      /@media \(max-width: 900px\)[\s\S]*\.model-session-sidebar,\s+\.model-lab-content \{\s+grid-column: 1;/,
    );
  });

  it('keeps new-model import visible on narrow layouts and labels its separate-session boundary', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    expect(styles).toMatch(
      /@media \(max-width: 900px\)[\s\S]*\.model-session-sidebar:not\(\.model-session-sidebar--collapsed\) > footer \{\s+display: grid;/,
    );
    expect(appSource).toContain(
      'Always creates a separate model session; it never attaches to or replaces the current',
    );
    expect(appSource).not.toContain('aria-label="Attached model context"');
  });

  it('keeps import activity and controls hidden inside the collapsed models rail', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(/\.model-session-sidebar--collapsed > footer \{\s+display: none;/);
    expect(styles).toMatch(
      /\.model-session-sidebar:not\(\.model-session-sidebar--collapsed\) > footer \{\s+display: grid;/,
    );
    expect(styles).not.toMatch(/(?:^|\n)\.model-session-sidebar > footer \{/);
  });

  it('keeps enlarged module detail single-column and scroll-safe on mobile', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('.module-detail-dialog__body {');
    expect(styles).toContain('overflow: auto;');
    expect(styles).toContain('.module-detail-facts,\n  .module-detail-evidence__groups {');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(styles).toContain('overflow-wrap: anywhere;');
  });
});
