import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  escapeLatexTextUnderscores,
  Formula,
  formulaDisplayRows,
  formulaSourceForRendering,
  MAX_FORMULA_SOURCE_LENGTH,
  renderFormulaResult,
} from './formula';
import {
  backwardSignalNote,
  CenterModelGraphButton,
  composeRepeatedBlocks,
  composeModelSubgraphs,
  connectionHandleEndpoints,
  estimatedModuleCardHeight,
  estimatedFormulaRowLines,
  connectionSignalReading,
  findLogicalNeighborId,
  formulaAwareGridPositions,
  formulaAwareBoundaryYPositions,
  formulaAwareLanePositions,
  forLoopOrderFlowDirection,
  forLoopRowTransition,
  gradientStrokeWidth,
  lassoRefinementSemanticSteps,
  MAX_REPEATED_DETAIL_STEPS,
  modelFormulaAuditScope,
  modelGraphFitViewOptions,
  modelGraphViewportKey,
  nestedModuleId,
  overviewModel,
  parseRepeatedLinearOperation,
  repeatedModuleStepStatements,
  repeatedStepFormula,
  repeatedStepName,
  repeatedTanhSaturationScale,
  signalStripAccessibilityProps,
  signalEndpoints,
} from './model-graph';
import {
  availablePanelMaximum,
  modelLabPrimaryFloor,
  clampPanelWidth,
  footerHeightAfterPointerMove,
  footerHeightAfterSeparatorKey,
  MODEL_SESSION_FOOTER_MAX_HEIGHT,
  MODEL_SESSION_FOOTER_MIN_HEIGHT,
  readModelSessionFooterHeight,
  readModelSessionSections,
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
  modelChatSessionWithMessage,
  modelGraphInstanceKey,
  modelGraphChangeHighlightFromSummary,
  modelImportJobAfterProgress,
  modelImportPhaseLabel,
  modelLabShellClassName,
  modelLabWorkbenchClassName,
  loadModelLabPermanentMemory,
  loadModelLabPermanentMemoryFromBrowser,
  modelPythonDownloadName,
  pseudocodeLineOffset,
  modelViewSessionAfterRevision,
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
  MODEL_LAB_MEMORY_STORAGE_MAX_CHARACTERS,
  panelWidthAfterPointerMove,
  panelWidthAfterSeparatorKey,
  persistModelLabPermanentMemory,
  persistModelLabPermanentMemoryToBrowser,
  replaceModelPreservingOrder,
  restoreModelLabPermanentMemory,
  shouldHandoffCopilotFocus,
  toggleModelTreeExpansion,
  withoutTrashedModelSessions,
} from './model-lab-app';
import {
  compactModuleFormula,
  isModuleActivationKey,
  moduleHandlePorts,
  moduleFormulaAccessibilityLabel,
  moduleRepeatPresentation,
  moduleRepeatStackLayers,
} from './module-node';
import { modelPseudocodeChangeSummary } from './model-pseudocode';
import { modelFormulaConsistencyFindings, runAgentReview } from './model-lab-domain';
import {
  filmTransformerClassifier,
  residualClassifier,
  sampleModels,
  sparkvskLearnedWarmPath,
  tropicLambdaPathCompiler,
} from './sample-models';

describe('Model graph interaction contract', () => {
  it('routes repeated-block handles by row and labels only actual row turns', () => {
    expect(Array.from({ length: 5 }, (_, index) => forLoopOrderFlowDirection(index))).toEqual([
      'left-to-right',
      'left-to-right',
      'left-to-right',
      'left-to-right',
      'left-to-right',
    ]);
    expect(forLoopOrderFlowDirection(5)).toBe('right-to-left');
    expect(forLoopOrderFlowDirection(10)).toBe('left-to-right');
    expect(forLoopRowTransition(3, 4)).toBeNull();
    expect(forLoopRowTransition(4, 5)).toEqual({ fromStep: 5, toStep: 6, side: 'right' });
    expect(forLoopRowTransition(9, 10)).toEqual({ fromStep: 10, toStep: 11, side: 'left' });
    expect(forLoopRowTransition(4, 7)).toBeNull();
  });

  it('keeps repeated-block execution arrows forward while retaining selected signal labels', () => {
    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    const nodeSource = readFileSync(new URL('./module-node.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(graphSource).toMatch(
      /const endpoints = openBlock\s+\? \{ source: connection\.source, target: connection\.target \}/u,
    );
    expect(graphSource).toMatch(
      /uiText\('STEP '\)[\s\S]*?data.rowTransition.fromStep[\s\S]*?uiText\(' ↓ STEP '\)/u,
    );
    expect(graphSource).toContain('Follow STEP numbers. Each NEXT ROW arrow turns down');
    expect(nodeSource).toContain("orderFlowDirection === 'left-to-right'");
    expect(styles).toContain('.signal-edge__row-transition {');
  });

  it('transcribes a compound operation literally when no exact step parser consumes it', () => {
    const compound = 'H3 = GELU(H3) + b';
    expect(repeatedStepName(compound, 6)).toBe('Update H3');
    // The statement itself, every operand kept: never a narrower GELU-only interpretation.
    expect(repeatedStepFormula(compound, 6)).toBe(
      String.raw`H_{3}\leftarrow \operatorname{GELU}(H_{3})+b`,
    );
    expect(renderFormulaResult(repeatedStepFormula(compound, 6)).valid).toBe(true);
    // Text that is not code keeps the explicit fallback.
    expect(repeatedStepName('custom opaque operator', 6)).toBe('Custom operation · step 7');
  });

  it('normalizes a general Python FiLM loop into named modules with rendered equations', () => {
    const generalFilmBlock = {
      ...residualClassifier.modules[1]!,
      id: 'general-film-block',
      name: 'General penalty FiLM refinement',
      inputShape: ['Q', 'P', 64],
      outputShape: ['Q', 'P', 64],
      repeat: { count: 23, label: 'ResidualFiLMBlock layers 1 through 23' },
      transform: [
        'for block in 23 residual blocks;',
        'beta_channels = h[:,:,:32];',
        'auxiliary_channels = h[:,:,32:];',
        'residual = y_query - batch_matmul(X_query, beta_channels);',
        'projected = batch_matmul(transpose(X_query), residual) / N;',
        'block_input = concat(projected, auxiliary_channels);',
        'correction = Linear(512 -> 64)(GELU(Linear(64 -> 512)(block_input)));',
        'gamma, delta = chunk(Linear(256 -> 128)(embedding), 2);',
        'correction = correction * (1 + gamma[:,None,:]) + delta[:,None,:];',
        'updated = Linear(64 -> 64)(RMSNorm(h + correction));',
        'gate = sigmoid(updated[:,:,32:]);',
        'auxiliary = 5 * tanh(updated[:,:,32:] / 5);',
        'h = concat(updated[:,:,:32] * gate, auxiliary)',
      ].join(' '),
    };
    const block = composeRepeatedBlocks({
      ...residualClassifier,
      modules: [generalFilmBlock],
      connections: [],
    }).blocks[0];
    const detailModules = block?.detailModel.modules ?? [];

    expect(repeatedModuleStepStatements(generalFilmBlock)).toHaveLength(12);
    expect(detailModules).toHaveLength(12);
    expect(detailModules.map((module) => module.name)).toEqual([
      'Slice tensor channels',
      'Slice tensor channels',
      'Compute regression residual',
      'Project residual gradient',
      'Concatenate state tensors',
      'Residual MLP 64 → 512 → 64',
      'Generate FiLM parameters',
      'FiLM conditioning',
      'Normalize and project state',
      'Compute channel gate',
      'Bound auxiliary channels',
      'Concatenate state tensors',
    ]);
    expect(detailModules.every((module) => !module.name.startsWith('Custom operation'))).toBe(true);
    expect(
      detailModules.every(
        (module) => !module.formula.includes('Equation not deterministically derived'),
      ),
    ).toBe(true);
    expect(detailModules.every((module) => renderFormulaResult(module.formula).valid)).toBe(true);
    expect(modelFormulaConsistencyFindings(block!.detailModel)).toEqual([]);
    expect(detailModules[5]?.formula).toContain(
      String.raw`\operatorname{Linear}_{512\to64}\!\left(\operatorname{GELU}`,
    );
    expect(detailModules[8]?.formula).toContain(
      String.raw`\operatorname{Linear}_{64\to64}\!\left(\operatorname{RMSNorm}_{64}`,
    );
  });

  it('collapses chunk-loop control flow while preserving every semantic FiLM operation', () => {
    const chunkedFilmBlock = {
      ...residualClassifier.modules[1]!,
      id: 'chunked-film-block',
      inputShape: ['Q', 'P', 64],
      outputShape: ['Q', 'P', 64],
      repeat: { count: 23, label: 'ResidualFiLMBlock layers 1 through 23' },
      transform: [
        'outputs = [];',
        'for start in range(0, P, 32768):;',
        'stop = min(start + 32768, P);',
        'selected = block_input[:, start:stop];',
        'correction_chunk = Linear(512,64)(GELU(Linear(64,512)(selected)));',
        'gamma, delta = chunk(Linear(256,128)(embedding), 2);',
        'correction_chunk = correction_chunk * (1 + gamma[:,None,:]) + delta[:,None,:];',
        'outputs.append(correction_chunk);',
        'correction = concat(outputs, dim=1);',
        'updated = RMSNorm_64(h + correction);',
        'updated = Linear(64,64)(updated);',
        'raw_auxiliary = updated[...,32:];',
        'gate = sigmoid(raw_auxiliary);',
        'clipped_auxiliary = 5 * tanh(raw_auxiliary / 5);',
        'h = concat(updated[...,:32] * gate, clipped_auxiliary)',
      ].join(' '),
    };
    const statements = repeatedModuleStepStatements(chunkedFilmBlock);
    const block = composeRepeatedBlocks({
      ...residualClassifier,
      modules: [chunkedFilmBlock],
      connections: [],
    }).blocks[0];
    const detailModules = block?.detailModel.modules ?? [];

    expect(statements.some((statement) => /^for\b|^stop\s*=/u.test(statement))).toBe(false);
    expect(detailModules).toHaveLength(13);
    expect(detailModules.every((module) => !module.name.startsWith('Custom operation'))).toBe(true);
    expect(
      detailModules.every(
        (module) => !module.formula.includes('Equation not deterministically derived'),
      ),
    ).toBe(true);
    expect(detailModules.every((module) => renderFormulaResult(module.formula).valid)).toBe(true);
    expect(modelFormulaConsistencyFindings(block!.detailModel)).toEqual([]);
  });

  it('shows concise, provider-qualified progress for an active LLM graph import', () => {
    const updated = modelImportJobAfterProgress(
      {
        id: 'build-1',
        name: 'model.pdf',
        status: 'model-building',
        phase: 'sources-prepared',
        detail: 'Prepared PDF evidence.',
        runLabel: 'Auto routing',
        events: ['Prepared PDF evidence.'],
      },
      {
        phase: 'selection-resolved',
        message: 'GPT-5.6 Sol selected with high reasoning.',
        providerId: 'codex',
        modelId: 'gpt-5.6-sol',
        modelLabel: 'GPT-5.6 Sol',
        reasoning: 'high',
      },
    );
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');

    expect(updated).toMatchObject({
      phase: 'selection-resolved',
      runLabel: 'OpenAI · Codex · GPT-5.6 Sol · high',
      detail: 'GPT-5.6 Sol selected with high reasoning.',
    });
    expect(updated.events).toHaveLength(2);
    expect(modelImportPhaseLabel('llm-running')).toBe('LLM RUNNING');
    expect(modelImportPhaseLabel('model-ir-validating')).toBe('VALIDATING MODELIR');
    expect(modelImportPhaseLabel('model-ir-repairing')).toBe('CORRECTING MODELIR');
    expect(modelImportPhaseLabel('cache-hit')).toBe('CANONICAL CACHE HIT');
    expect(appSource).toContain('aria-live="polite"');
    expect(appSource).toContain('Graph import status');
    expect(appSource).toContain('Local ModelIR validation · No LLM');
  });

  it('audits base models and every generated detail graph with the same formula rules', () => {
    const scope = modelFormulaAuditScope(sampleModels);
    const materializedModuleIds = scope.flatMap((model) =>
      model.modules.map((module) => module.id),
    );
    expect(scope.length).toBeGreaterThan(sampleModels.length);
    expect(scope.some((model) => model.id.includes('::block::'))).toBe(true);
    expect(materializedModuleIds).toEqual(
      expect.arrayContaining([
        'residual-block-summary',
        'sparkvsk-trunk-summary',
        'tropic-candidate-summary',
        'block:film-transformer-block',
      ]),
    );
    expect(
      materializedModuleIds.some(
        (id) => id.startsWith('[') && id.includes('"tropic-spark-warm-path"'),
      ),
    ).toBe(true);
    expect(modelFormulaConsistencyFindings(scope)).toEqual([]);
  });

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
    const portedConnection = { ...connection, sourcePort: 'hidden out', targetPort: 'hidden in' };
    expect(connectionHandleEndpoints(portedConnection, 'forward')).toEqual({
      sourceHandle: 'hidden out',
      targetHandle: 'hidden in',
    });
    expect(connectionHandleEndpoints(portedConnection, 'backward')).toEqual({
      sourceHandle: 'hidden in',
      targetHandle: 'hidden out',
    });
  });

  it('routes each named internal port to a distinct React Flow handle', () => {
    const module = {
      ...residualClassifier.modules[1]!,
      inputPorts: [
        { name: 'A', shape: ['B', 64], binding: 'internal' as const },
        { name: 'lambda', shape: [1, 1], binding: 'external' as const },
        { name: 'F', shape: ['B', 64], binding: 'internal' as const },
      ],
      outputPorts: [
        { name: 'hidden', shape: ['B', 64], binding: 'internal' as const },
        { name: 'result', shape: ['B', 64], binding: 'external' as const },
      ],
    };
    expect(moduleHandlePorts(module, 'forward', null, 'target')?.map((port) => port.name)).toEqual([
      'A',
      'F',
    ]);
    expect(moduleHandlePorts(module, 'forward', null, 'source')?.map((port) => port.name)).toEqual([
      'hidden',
    ]);
    expect(moduleHandlePorts(module, 'backward', null, 'source')?.map((port) => port.name)).toEqual(
      ['A', 'F'],
    );
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
    expect(graphCardSource).toContain('module-node__loop');
    expect(graphCardSource).toContain('×{repeats}');
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
    expect(hierarchy.model.connections).toHaveLength(7);
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

  it('keeps named boundary ports and parallel tensors connected when collapsing a block', () => {
    const original = structuredClone(filmTransformerClassifier);
    const first = composeRepeatedBlocks(original).blocks[0]!;
    const incoming = original.connections.find(
      (c) => !first.memberModuleIds.includes(c.source) && first.memberModuleIds.includes(c.target),
    )!;
    const model = {
      ...original,
      connections: [
        ...original.connections,
        { ...incoming, id: 'parallel-boundary', tensorName: 'auxiliary', targetPort: 'auxiliary' },
      ],
    };
    const before = JSON.stringify(model);
    const hierarchy = composeRepeatedBlocks(model);
    const summary = hierarchy.model.modules.find((m) => m.id === first.summaryModuleId)!;
    const boundary = hierarchy.model.connections.filter((c) => c.target === summary.id);
    expect(boundary.length).toBeGreaterThanOrEqual(2);
    for (const c of boundary)
      expect(summary.inputPorts?.some((p) => p.name === c.targetPort)).toBe(true);
    for (const c of hierarchy.model.connections.filter((c) => c.source === summary.id)) {
      expect(summary.outputPorts?.some((p) => p.name === c.sourcePort)).toBe(true);
    }
    expect(JSON.stringify(model)).toBe(before);
  });

  it('expands one repeated Refinement module into an inspectable for-loop step graph', () => {
    const refinement = {
      ...residualClassifier.modules[1]!,
      id: 'iterative-refinement',
      name: 'Residual-FiLM Refinement Block',
      inputShape: ['P', '2d'],
      outputShape: ['P', '2d'],
      transform: [
        'For j in range(1, L):',
        '  H1, H2 = split(H)',
        "  H1 = X' (y - X H1) / N",
        '  H3 = Linear(2d, 512) -> GELU -> Linear(512, 2d)',
        '  H3 = FiLM(H3, log(lambda))',
        '  H = H + H3',
        '  H = RMSNorm(H)',
        '  H[:,:d] *= sigmoid(H[:,d:])',
        '  H[:,d:] = 5 * tanh(H[:,d:] / 5)',
      ].join('\n'),
      repeat: { count: 'L-1', label: 'refinement iterations' },
    };
    const model = { ...residualClassifier, modules: [refinement], connections: [] };
    const hierarchy = composeRepeatedBlocks(model);
    const block = hierarchy.blocks[0];

    expect(repeatedModuleStepStatements(refinement)).toHaveLength(8);
    expect(
      repeatedModuleStepStatements({
        transform:
          'For each iteration: split H into H1 and H2; update H1 from the residual; apply Linear and GELU; affine-modulate with FiLM; add the residual; apply RMSNorm; gate with sigmoid; softly saturate with tanh',
      }),
    ).toHaveLength(8);
    expect(
      repeatedModuleStepStatements({
        transform: 'head_vs MLP(Fh → 192 → 192 → 1)',
      }),
    ).toEqual(['head_vs MLP(Fh → 192 → 192 → 1)']);
    expect(
      repeatedModuleStepStatements({
        transform: [
          'For j in range(1, L):',
          '  # data-consistency update',
          "  H1_new = X' (y - X H1) / N",
          '  # residual recombination',
          '  H3 = concat(H1_new, H2)',
        ].join('\n'),
      }),
    ).toEqual([
      "H1_new = X' (y - X H1) / N # data-consistency update",
      'H3 = concat(H1_new, H2) # residual recombination',
    ]);
    expect(block).toMatchObject({
      id: 'repeat:iterative-refinement',
      summaryModuleId: 'iterative-refinement',
      selectionModuleId: 'iterative-refinement',
      repeatCount: 'L-1',
      detailKind: 'steps',
    });
    expect(block?.detailModel.modules).toHaveLength(8);
    expect(block?.detailModel.connections).toHaveLength(7);
    expect(block?.detailModel.modules.map((module) => module.name)).toEqual([
      'Split hidden state',
      'Residual / gradient update',
      'Residual MLP',
      'FiLM conditioning',
      'Residual add',
      'Normalize state',
      'Channel gate',
      'Soft saturation',
    ]);
    expect(block?.detailModel.modules.map((module) => module.formula)).toEqual([
      String.raw`H_1=H_{:,:d},\qquad H_2=H_{:,d:}`,
      String.raw`H_1\leftarrow X^{\top}(y-XH_1)/N`,
      String.raw`H_3\leftarrow\operatorname{Linear}_{512\to2d}\!\left(\operatorname{GELU}\!\left(\operatorname{Linear}_{2d\to512}(H_3)\right)\right)`,
      String.raw`H_3\leftarrow(1+\gamma^{(j)})\odot H_3+\delta^{(j)}`,
      String.raw`H\leftarrow H+H_3`,
      String.raw`H\leftarrow\operatorname{RMSNorm}_{2d}(H)`,
      String.raw`H_{:,:d}\leftarrow H_{:,:d}\odot\sigma(H_{:,d:})`,
      String.raw`H_{:,d:}\leftarrow5\tanh\!\left(H_{:,d:}/5\right)`,
    ]);
    expect(repeatedStepFormula('custom opaque operator', 2)).toContain(
      'Equation not deterministically derived from step 3',
    );
    const thresholdSlotSlice = 'H2 = H[:, d:] # [P, d] scale / threshold slots';
    expect(repeatedStepName(thresholdSlotSlice, 1)).toBe('Extract scale / threshold channels');
    expect(repeatedStepFormula(thresholdSlotSlice, 1)).toBe(String.raw`H_2=H_{:,d:}`);
    expect(renderFormulaResult(repeatedStepFormula(thresholdSlotSlice, 1))).toMatchObject({
      valid: true,
    });
    expect(
      renderFormulaResult(repeatedStepFormula('beta = soft-threshold(H, tau)', 8)),
    ).toMatchObject({ valid: true });
    const sliceHierarchy = composeRepeatedBlocks({
      ...model,
      modules: [
        {
          ...refinement,
          transform: [
            'For j in range(1, L):',
            '  H1 = H[:, :d] # coefficient channels',
            `  ${thresholdSlotSlice}`,
          ].join('\n'),
        },
      ],
    });
    expect(sliceHierarchy.blocks[0]?.detailModel.modules[1]).toMatchObject({
      name: 'Extract scale / threshold channels',
      transform: 'H2 = H[:, d:]',
      formula: String.raw`H_2=H_{:,d:}`,
      explanation: expect.stringContaining(
        'Pseudocode annotation: [P, d] scale / threshold slots.',
      ),
    });
    expect(
      block?.detailModel.connections.every(
        (connection) => connection.gradient.states.healthy[0] === 'not-observed',
      ),
    ).toBe(true);
    expect(hierarchy.model.modules).toHaveLength(1);
  });

  it('groups the learned LASSO loop into four semantic blocks with consistent formulas and a visible skip', () => {
    const refinement = {
      ...residualClassifier.modules[1]!,
      id: 'iterative_refinement',
      name: 'LASSO-Aware Residual Refinement',
      inputShape: ['P', '2K'],
      outputShape: ['P', '2K'],
      transform: [
        'For j in range(1, L):',
        '  H = Linear(2K, 2K)(H)',
        '  H1 = H[:, :K]',
        '  H2 = H[:, K:]',
        '  H1 = soft_threshold(H1, exp(H2 + log(lambda) - log_lam_mean))',
        '  H1 = X_c.T @ (broadcast_K(y_c) - X_c @ H1) / N',
        '  H1 = H1 / lambda',
        '  H1 = RMSNorm(K)(H1)',
        '  H3 = concat([H1, H2], dim=1)',
        '  H3 = Linear(2K, 4K)(H3) → GELU → RMSNorm(4K) → Linear(4K, 2K)',
        '  H = H + H3',
      ].join('\n'),
      repeat: { count: 'L-1', label: 'For j in range(1, L)' },
    };
    const semantic = lassoRefinementSemanticSteps(refinement);
    const block = composeRepeatedBlocks({
      ...residualClassifier,
      modules: [refinement],
      connections: [],
    }).blocks[0];

    expect(repeatedModuleStepStatements(refinement)).toHaveLength(10);
    expect(semantic?.map((step) => step.name)).toEqual([
      'State projection + K/K split',
      'Lambda-conditioned soft threshold',
      'Normalized LASSO reprojection',
      'Residual MLP fusion + state update',
    ]);
    expect(block?.detailModel.modules).toHaveLength(4);
    expect(block?.detailModel.connections).toHaveLength(6);
    expect(block?.detailKind).toBe('semantic blocks');
    expect(block?.omittedStepCount).toBe(0);
    expect(block?.detailModel.modules.map((module) => module.name)).toEqual(
      semantic?.map((step) => step.name),
    );
    expect(
      block?.detailModel.modules.every(
        (module) =>
          !module.name.startsWith('Custom operation') &&
          !module.formula.includes('Equation not deterministically derived'),
      ),
    ).toBe(true);
    expect(block?.detailModel.modules[2]).toMatchObject({
      inputShape: ['P', 'K'],
      outputShape: ['P', 'K'],
      activation: 'RMSNorm',
    });
    expect(block?.detailModel.modules[2]?.formula).toContain(
      String.raw`R_j=\operatorname{RMSNorm}_K(G_j)`,
    );
    expect(block?.detailModel.modules[2]?.formula).not.toContain('K+H_1');
    expect(block?.detailModel.modules[3]?.formula).toContain(
      String.raw`\operatorname{Linear}_{2K\to4K}`,
    );
    expect(block?.detailModel.modules[0]?.formula).not.toContain('Linear^{(j)}');
    expect(block?.detailModel.modules[3]?.formula).not.toContain('Linear^{(j)}');
    expect(block?.detailModel.modules[3]?.formula).toContain(String.raw`H_j=\widetilde H_j+C_j`);
    expect(block?.detailModel.modules[3]?.inputPorts).toEqual([
      { name: 'Rⱼ', shape: ['P', 'K'] },
      { name: 'Fⱼ', shape: ['P', 'K'] },
      { name: 'H̃ⱼ skip', shape: ['P', '2K'] },
    ]);
    expect(block?.detailModel.modules[0]?.inputPorts).toEqual([
      {
        name: 'Hⱼ₋₁',
        shape: ['P', '2K'],
        binding: 'loop-carried',
        bindingId: 'iterative_refinement',
      },
    ]);
    expect(block?.detailModel.modules[3]?.outputPorts).toEqual([
      {
        name: 'Hⱼ',
        shape: ['P', '2K'],
        binding: 'loop-carried',
        bindingId: 'iterative_refinement',
      },
    ]);
    expect(
      block?.detailModel.connections.map((connection) => [
        connection.sourcePort,
        connection.targetPort,
      ]),
    ).toEqual([
      ['Aⱼ', 'Aⱼ'],
      ['Fⱼ', 'Fⱼ'],
      ['β̂ⱼ', 'β̂ⱼ'],
      ['Rⱼ', 'Rⱼ'],
      ['Fⱼ', 'Fⱼ'],
      ['H̃ⱼ', 'H̃ⱼ skip'],
    ]);
    expect(
      block?.detailModel.connections.some(
        (connection) =>
          connection.source === block.detailModel.modules[0]?.id &&
          connection.target === block.detailModel.modules[3]?.id &&
          connection.tensorName === 'H̃ⱼ projected-state skip',
      ),
    ).toBe(true);
    expect(
      block?.detailModel.modules.every((module) => renderFormulaResult(module.formula).valid),
    ).toBe(true);
    expect(modelFormulaConsistencyFindings(block!.detailModel)).toEqual([]);
    expect(
      runAgentReview(block!.detailModel, 'healthy', 4).find(
        (review) => review.id === 'shape-auditor',
      )?.status,
    ).toBe('pass');
    const missingSkipModel = {
      ...block!.detailModel,
      connections: block!.detailModel.connections.filter(
        (connection) => connection.targetPort !== 'H̃ⱼ skip',
      ),
    };
    expect(
      runAgentReview(missingSkipModel, 'healthy', 4).find((review) => review.id === 'shape-auditor')
        ?.evidence,
    ).toContain('Residual MLP fusion + state update.H̃ⱼ skip has no incoming edge.');
    const unboundModel = {
      ...block!.detailModel,
      connections: block!.detailModel.connections.map((connection, index) => {
        if (index !== 0) return connection;
        const { targetPort: _omitted, ...unboundConnection } = connection;
        return unboundConnection;
      }),
    };
    expect(
      runAgentReview(unboundModel, 'healthy', 4).find((review) => review.id === 'shape-auditor')
        ?.status,
    ).toBe('error');
    const mispairedLoopModel = {
      ...block!.detailModel,
      modules: block!.detailModel.modules.map((module, index) =>
        index === 3
          ? {
              ...module,
              outputPorts: module.outputPorts!.map((port) => ({
                ...port,
                bindingId: 'different-loop',
              })),
            }
          : module,
      ),
    };
    expect(
      runAgentReview(mispairedLoopModel, 'healthy', 4).find(
        (review) => review.id === 'shape-auditor',
      )?.evidence,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('iterative_refinement'),
        expect.stringContaining('different-loop'),
      ]),
    );

    expect(repeatedStepFormula('H1 = RMSNorm(K)(H1)', 6)).toBe(
      String.raw`H_1\leftarrow\operatorname{RMSNorm}_{K}\!\left(H_1\right)`,
    );
    expect(repeatedStepFormula(refinement.transform.split('\n')[4]!.trim(), 3)).not.toContain(
      'Equation not deterministically derived',
    );
    expect(repeatedStepFormula('H1 = soft_threshold(H1, tau)', 3)).toContain(String.raw`;\tau`);
    expect(repeatedStepFormula('z = soft_threshold(x, tau)', 3)).toContain(
      String.raw`\mathrm{z}\leftarrow\operatorname{ST}\!\left(\mathrm{x};\tau\right)`,
    );
    expect(repeatedStepFormula('Z = soft_threshold(X, Tau)', 3)).toContain(
      String.raw`\mathrm{Z}\leftarrow\operatorname{ST}\!\left(\mathrm{X};\mathrm{Tau}\right)`,
    );
    expect(repeatedStepFormula('H1 = soft_threshold(H1, learned_threshold(H2))', 3)).toBe(
      String.raw`H_{1}\leftarrow \operatorname{soft\_threshold}(H_{1},\operatorname{learned\_threshold}(H_{2}))`,
    );
  });

  it('collapses a homogeneous custom repeat into one inspectable operator instead of custom cards', () => {
    const repeated = {
      ...residualClassifier.modules[1]!,
      id: 'domain-repeat',
      name: 'Domain refinement',
      transform: Array.from(
        { length: 8 },
        (_value, index) => `s${index + 1} = domain_step(s${index})`,
      ).join('\n'),
      formula: String.raw`s_{j+1}=\operatorname{DomainStep}(s_j)`,
      repeat: { count: 8, label: 'domain refinement' },
    };
    const hierarchy = composeRepeatedBlocks({
      ...residualClassifier,
      modules: [repeated],
      connections: [],
    });
    const detail = hierarchy.blocks[0];

    expect(detail?.detailKind).toBe('semantic blocks');
    expect(detail?.detailModel.modules).toHaveLength(1);
    expect(detail?.detailModel.modules[0]).toMatchObject({
      name: 'Domain refinement operator',
      transform: 's1 = domain_step(s0)',
      formula: repeated.formula,
    });
  });

  it('preserves a thirteenth repeated operation and its literal tanh saturation scale', () => {
    const refinement = {
      ...residualClassifier.modules[1]!,
      id: 'refine-thirteen-steps',
      inputShape: ['P', '2d'],
      outputShape: ['P', '2d'],
      repeat: { count: 'L-1', label: 'j = 1 .. L-1' },
      transform: [
        'For j in range(1, L):',
        '  H1 = H[:, :d]',
        '  H2 = H[:, d:]',
        "  H1 = X' (y - X H1) / N",
        '  H3 = concat(H1, H2)',
        '  H3 = Linear_{2d->512}(H3)',
        '  H3 = GELU(H3)',
        '  H3 = Linear_{512->2d}(H3)',
        '  [gamma_j, delta_j] = split(Linear^{(j)}_{256->128}(e_lambda), 2)',
        '  H3 = (1 + gamma_j) * H3 + delta_j',
        '  H = H + H3',
        '  H = RMSNorm_{2d}(H)',
        '  H = Linear_{2d->2d}(H)',
        '  H[:, d:] = 7 * tanh(H[:, d:] / 7)',
      ].join('\n'),
    };
    const statements = repeatedModuleStepStatements(refinement);
    const block = composeRepeatedBlocks({
      ...residualClassifier,
      modules: [refinement],
      connections: [],
    }).blocks[0];

    expect(statements).toHaveLength(13);
    expect(statements.at(-1)).toBe('H[:, d:] = 7 * tanh(H[:, d:] / 7)');
    expect(repeatedTanhSaturationScale(statements.at(-1)!)).toBe('7');
    expect(repeatedStepFormula(statements.at(-1)!, 12)).toBe(
      String.raw`H_{:,d:}\leftarrow7\tanh\!\left(H_{:,d:}/7\right)`,
    );
    expect(block?.detailModel.modules).toHaveLength(13);
    expect(block?.detailModel.connections).toHaveLength(12);
    expect(block?.omittedStepCount).toBe(0);
    expect(block?.detailModel.modules.at(-1)).toMatchObject({
      name: 'Soft saturation',
      activation: 'tanh',
      formula: String.raw`H_{:,d:}\leftarrow7\tanh\!\left(H_{:,d:}/7\right)`,
    });
    expect(renderFormulaResult(block!.detailModel.modules.at(-1)!.formula)).toMatchObject({
      valid: true,
    });
    expect(parseRepeatedLinearOperation('H = Linear_{2d->2d}(H)')).toEqual({
      output: 'H',
      input: 'H',
      inputDimension: '2d',
      outputDimension: '2d',
    });
    expect(repeatedStepName('H = Linear_{2d->2d}(H)', 11)).toBe('Linear 2d → 2d');
    const singleLinearFormula = repeatedStepFormula('H = Linear_{2d->2d}(H)', 11);
    expect(singleLinearFormula).toBe(
      String.raw`H\leftarrow\operatorname{Linear}_{2d\to2d}(H)=WH+b,\quad W\in\mathbb R^{2d\times 2d}`,
    );
    expect(singleLinearFormula).not.toContain('GELU');
    expect(block?.detailModel.modules[8]?.formula).toBe(
      String.raw`H_3\leftarrow(1+\gamma^{(j)})\odot H_3+\delta^{(j)}`,
    );
    expect(block?.detailModel.modules[11]).toMatchObject({
      name: 'Linear 2d → 2d',
      transform: 'H = Linear_{2d->2d}(H)',
      activation: null,
      formula: singleLinearFormula,
    });
    expect(block?.detailModel.modules[4]).toMatchObject({
      inputShape: ['P', '2d'],
      outputShape: ['P', 512],
    });
    expect(block?.detailModel.modules[5]).toMatchObject({
      inputShape: ['P', 512],
      outputShape: ['P', 512],
    });
    expect(block?.detailModel.modules[6]).toMatchObject({
      inputShape: ['P', 512],
      outputShape: ['P', '2d'],
    });
    expect(
      block?.detailModel.modules.every(
        (module) =>
          module.formula.length > 0 &&
          !module.formula.includes('No separate equation was specified'),
      ),
    ).toBe(true);
    expect(
      block?.detailModel.modules.every((module) => renderFormulaResult(module.formula).valid),
    ).toBe(true);
    expect(repeatedTanhSaturationScale('H[:, d:] = 5 * tanh(H[:, d:] / 5)')).toBe('5');
    expect(repeatedTanhSaturationScale('H[:, d:] = 2.5 * tanh(H[:, d:] / 2.5)')).toBe('2.5');
    expect(repeatedTanhSaturationScale('H[:, d:] = 7 * tanh(H[:, d:] / 5)')).toBeNull();
    // Mismatched scales are not normalized into the saturation form: both stay as written.
    expect(repeatedStepFormula('H[:, d:] = 7 * tanh(H[:, d:] / 5)', 12)).toBe(
      String.raw`H_{:,d:}\leftarrow 7\,\tanh(H_{:,d:}/5)`,
    );
  });

  it('keeps long loop source lossless while visibly bounding only graph rendering', () => {
    const operations = Array.from(
      { length: MAX_REPEATED_DETAIL_STEPS + 1 },
      (_, index) => `H = H + step_${index + 1}`,
    );
    const refinement = {
      ...residualClassifier.modules[1]!,
      id: 'refine-overflow',
      repeat: { count: 'L-1', label: 'long refinement' },
      transform: ['For j in range(1, L):', ...operations.map((line) => `  ${line}`)].join('\n'),
    };
    const parsed = repeatedModuleStepStatements(refinement);
    const block = composeRepeatedBlocks({
      ...residualClassifier,
      modules: [refinement],
      connections: [],
    }).blocks[0];
    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');

    expect(parsed).toHaveLength(MAX_REPEATED_DETAIL_STEPS + 1);
    expect(parsed.at(-1)).toBe(`H = H + step_${MAX_REPEATED_DETAIL_STEPS + 1}`);
    expect(block?.detailModel.modules).toHaveLength(MAX_REPEATED_DETAIL_STEPS);
    expect(block?.omittedStepCount).toBe(1);
    expect(graphSource).toContain('additional operation');
    expect(graphSource).toContain('remain in the pseudocode and revision');
  });

  it('renders a composite block as a click-to-drill-down card instead of internal sequence text', () => {
    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    const nodeSource = readFileSync(new URL('./module-node.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(nodeSource).toContain('module-node--composite');
    expect(nodeSource).toContain('Open block →');
    expect(graphSource).toContain('INSIDE COMPOSITE BLOCK');
    expect(graphSource).toContain('INSIDE REPEATED FOR-LOOP');
    expect(graphSource).toContain("openBlock.detailKind === 'steps'");
    expect(graphSource).toContain('← Whole model');
    expect(styles).toContain('14px -14px 0 -1px var(--model-surface)');
  });

  it('renders wrapped HTML edge labels above the graph instead of clipped SVG text', () => {
    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(graphSource).toContain('<EdgeLabelRenderer>');
    expect(graphSource).toContain('signal-edge__label signal-edge__label--${data.health}');
    expect(graphSource).toContain('signal-edge__label--change-${data.changeKind}');
    expect(graphSource).toContain("type: 'signal'");
    expect(graphSource).not.toContain('labelBgPadding');
    expect(styles).toMatch(
      /\.signal-edge__label \{[\s\S]*?max-width: 136px;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/u,
    );
  });

  it('highlights changed proposal blocks and edges without applying the revision', () => {
    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    const nodeSource = readFileSync(new URL('./module-node.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(graphSource).toContain('PROPOSAL PREVIEW · GRAPH NOT APPLIED');
    expect(graphSource).toContain('Graph change highlight');
    expect(graphSource).toContain('changeKind');
    expect(nodeSource).toContain('module-node__change-badge');
    expect(nodeSource).toContain('MODIFIED');
    expect(styles).toContain('.module-node--change-changed {');
    expect(styles).toContain('.module-node--change-added {');
    expect(styles).toContain('.signal-edge__label--change-changed {');
  });

  it('renders a bounded key equation on cards while preserving full equations in details', () => {
    const latex = String.raw`h_1 = \operatorname{GELU}(xW_p + b_p)`;
    const rendered = renderFormulaResult(latex, false);
    expect(rendered.valid).toBe(true);
    if (!rendered.valid) return;
    expect(rendered.html).toContain('class="katex"');
    expect(rendered.html).toContain('<math');
    expect(renderFormulaResult(latex, false)).toBe(rendered);

    const graphCardSource = readFileSync(new URL('./module-node.tsx', import.meta.url), 'utf8');
    expect(graphCardSource).toContain('formulaDisplayRows(module.formula)');
    expect(graphCardSource).toContain('<Formula');
    expect(graphCardSource).toContain('module.presentation?.keyEquation ?? formulaRows[0]');
    expect(graphCardSource).toContain('module-node__purpose');
    expect(graphCardSource).toContain('module-node__io');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    expect(appSource).toContain('<Formula latex={module.formula}');
    expect(graphCardSource).not.toContain('ƒ {compactFormula}');
  });

  it('renders source identifiers inside LaTeX text blocks without losing underscores', () => {
    const latex = String.raw`x=x_0,\quad \text{when certified_rounds}=0`;
    expect(escapeLatexTextUnderscores(latex)).toContain(String.raw`certified\_rounds`);
    expect(renderFormulaResult(latex, true)).toMatchObject({ valid: true });
  });

  it('renders independent multiline definitions as aligned rows instead of one equality chain', () => {
    const latex = String.raw`m_\lambda=-\frac{1}{K}\sum_{k=1}^{K}\log\lambda_k
s=\frac{X_c^{\top}y_c}{N}\in\mathbb{R}^{P\times 1}
H_0=\operatorname{Linear}_{1\to d}(s)\in\mathbb{R}^{P\times 2K},\quad d=2K`;
    const displaySource = formulaSourceForRendering(latex, true);
    const inlineSource = formulaSourceForRendering(latex, false);
    const rendered = renderFormulaResult(latex, true);

    expect(displaySource).toContain(String.raw`\begin{aligned}`);
    expect(displaySource).toContain(String.raw`m_\lambda&=`);
    expect(displaySource).toContain(String.raw`\\ s&=`);
    expect(displaySource).toContain(String.raw`\\ H_0&=`);
    expect(displaySource).toContain(String.raw`\\ d&=`);
    expect(inlineSource.match(/\\mathrel\{;\}/gu)).toHaveLength(3);
    expect(rendered).toMatchObject({ valid: true });
    if (rendered.valid) expect(rendered.html.match(/<mtr>/gu)).toHaveLength(4);
    const matrix = String.raw`A=\begin{pmatrix}
1&0\\
0&1
\end{pmatrix}`;
    expect(formulaSourceForRendering(matrix, true)).toBe(matrix);
    expect(renderFormulaResult(matrix, true)).toMatchObject({ valid: true });
  });

  it('lists each module equation on its own card row', () => {
    const rows = formulaDisplayRows(
      [
        String.raw`T_j=\exp(F_j+\log\lambda-m_\lambda)`,
        String.raw`\widehat\beta_j=\operatorname{ST}(A_j;T_j)`,
        String.raw`H_j=\widetilde H_j+C_j`,
      ].join('\n'),
    );
    expect(rows).toEqual([
      String.raw`T_j=\exp(F_j+\log\lambda-m_\lambda)`,
      String.raw`\widehat\beta_j=\operatorname{ST}(A_j;T_j)`,
      String.raw`H_j=\widetilde H_j+C_j`,
    ]);
    expect(rows.every((row) => renderFormulaResult(row, false).valid)).toBe(true);
    expect(formulaDisplayRows(String.raw`a=f(x), \quad b=g(a)`)).toEqual([
      String.raw`a=f(x)`,
      String.raw`b=g(a)`,
    ]);
    expect(formulaDisplayRows(String.raw`v=(a,\quad b)`)).toEqual([String.raw`v=(a,\quad b)`]);
    expect(formulaDisplayRows(String.raw`f(x,\quad y)=z`)).toEqual([String.raw`f(x,\quad y)=z`]);
    expect(moduleFormulaAccessibilityLabel(rows)).toContain('3 equations');
    expect(moduleFormulaAccessibilityLabel(rows)).toContain('T_j=');
    const mixedMatrix = String.raw`a=f(x)
B=\begin{pmatrix}
1&0\\
0&1
\end{pmatrix}
c=g(B)`;
    const mixedRows = formulaDisplayRows(mixedMatrix);
    expect(mixedRows).toHaveLength(3);
    expect(mixedRows[1]).toContain(String.raw`\begin{pmatrix}`);
    expect(mixedRows[1]).toContain(String.raw`\end{pmatrix}`);
    expect(mixedRows.every((row) => renderFormulaResult(row, true).valid)).toBe(true);
    const sameLineMixed = formulaDisplayRows(
      String.raw`a=f(x),\quad B=\begin{pmatrix}1&0\\0&1\end{pmatrix},\quad c=g(B)`,
    );
    expect(sameLineMixed).toHaveLength(3);
    expect(sameLineMixed[1]).toContain(String.raw`\begin{pmatrix}`);
    const alignedRow = String.raw`\begin{aligned}a&=1\\b&=2\\c&=3\\d&=4\\e&=5\\f&=6\\g&=7\end{aligned}`;
    expect(estimatedFormulaRowLines(alignedRow)).toBe(7);

    const tallModule = {
      ...residualClassifier.modules[1]!,
      formula: Array.from(
        { length: 6 },
        (_value, index) => `h_${index + 1}=f_${index + 1}(h_${index})`,
      ).join('\n'),
      lane: 0,
    };
    const shortModule = { ...residualClassifier.modules[1]!, id: 'short-formula', lane: 1 };
    expect(estimatedModuleCardHeight(tallModule)).toBe(estimatedModuleCardHeight(shortModule));
    const gridModules = [
      tallModule,
      ...Array.from({ length: 5 }, (_value, index) => ({
        ...shortModule,
        id: `grid-${index}`,
      })),
    ];
    const gridPositions = formulaAwareGridPositions(gridModules);
    expect(gridPositions[5]!.y - gridPositions[0]!.y).toBeGreaterThanOrEqual(
      estimatedModuleCardHeight(tallModule),
    );
    const lanePositions = formulaAwareLanePositions([tallModule, shortModule]);
    expect(lanePositions.get(1)! - lanePositions.get(0)!).toBeGreaterThanOrEqual(
      estimatedModuleCardHeight(tallModule),
    );
    const boundaryPositions = formulaAwareBoundaryYPositions(
      [tallModule],
      [gridModules, [shortModule]],
    );
    expect(boundaryPositions[0]!).toBeGreaterThan(
      (lanePositions.get(0) ?? 0) + estimatedModuleCardHeight(tallModule),
    );
    expect(boundaryPositions[1]!).toBeGreaterThan(
      boundaryPositions[0]! + estimatedModuleCardHeight(tallModule),
    );
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
    expect(modelGraphFitViewOptions(true).minZoom).toBeGreaterThanOrEqual(0.64);
    expect(modelGraphFitViewOptions(false).minZoom).toBeUndefined();
  });

  it('renders an accessible icon-only center control that invokes its center action', () => {
    let centerCalls = 0;
    const button = createElement(CenterModelGraphButton, {
      onClick: () => {
        centerCalls += 1;
      },
    });
    const markup = renderToStaticMarkup(button);

    expect(markup).toContain(
      'aria-label="Reset the canonical layout and center all model boxes in the graph viewport"',
    );
    expect(markup).toContain('title="Center model boxes"');
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"[^>]*focusable="false"/u);
    expect(markup.replace(/<[^>]*>/gu, '').trim()).toBe('');
    expect(centerCalls).toBe(0);
    button.props.onClick();
    expect(centerCalls).toBe(1);
  });

  it('remounts the canonical graph layout before centering boxes that were moved off-screen', () => {
    expect(modelGraphViewportKey('model-a', null, 0)).not.toBe(
      modelGraphViewportKey('model-a', null, 1),
    );
    expect(modelGraphViewportKey('model-a', null, 1)).not.toBe(
      modelGraphViewportKey('model-a', 'block-1', 1),
    );

    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    expect(graphSource).toContain('Center model boxes');
    expect(graphSource).toContain(
      'Reset the canonical layout and center all model boxes in the graph viewport',
    );
    expect(graphSource).toContain(
      'key={modelGraphViewportKey(graphModel.id, openBlockId, viewportResetNonce)}',
    );
    expect(graphSource).toContain('setViewportResetNonce((current) => current + 1)');
    expect(graphSource).toContain('onClick={resetAndCenterVisibleGraph}');
    expect(graphSource).not.toContain('flowInstanceRef');
  });

  it('folds prototype chrome into a compact header and gives the viewport to the graph', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('<details className="model-lab-about">');
    expect(appSource).not.toContain('<section className="prototype-boundary"');
    expect(appSource).not.toContain('<section className="workspace-bar"');
    expect(styles).toMatch(
      /\.model-lab-header \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) auto;[\s\S]*?min-height: 58px;[\s\S]*?padding: 8px 12px;/u,
    );
    expect(styles).toMatch(
      /\.graph-workspace \{[\s\S]*?height: calc\(100dvh - 76px\);[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\) auto;/u,
    );
    expect(styles).toMatch(/\.graph-toolbar \{[\s\S]*?min-height: 46px;[\s\S]*?padding: 6px 8px;/u);
    expect(styles).toMatch(
      /\.model-graph__readings \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\);[\s\S]*?padding: 6px 8px;/u,
    );
  });

  it('keeps focus beside graph modes and diagnostics compact at narrow breakpoints', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const source = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    const toolbar = source.slice(
      source.indexOf('<div className="graph-toolbar">'),
      source.indexOf('<ModelGraph\n'),
    );
    expect(toolbar).toContain('graph-toolbar__primary');
    expect(toolbar.indexOf('focus-mode-toggle')).toBeLessThan(
      toolbar.indexOf('graph-toolbar__diagnostics'),
    );
    expect(toolbar).toContain("signalMode === 'backward'");
    expect(styles).toContain('min-block-size: max-content;');
    expect(styles).toMatch(/\.graph-toolbar__primary \.focus-mode-toggle \{\s*margin-left: auto;/u);
    expect(styles).toMatch(
      /\.graph-toolbar \.graph-toolbar__primary \.segmented-control \{\s*width: auto;/u,
    );
    expect(styles).toMatch(/\.graph-toolbar \.graph-toolbar__diagnostics label \{\s*width: auto;/u);
    expect(styles).toMatch(/\.graph-toolbar \.graph-toolbar__diagnostics input \{\s*width: 90px;/u);
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

  it('lets the sidebar footer be dragged taller or shorter and remembers folded sections', () => {
    // 2026-09-21: import status, builder LLM and the import button took most of the sidebar, so
    // the model tree had a few rows. Dragging the separator up gives the footer room; arrows too.
    expect(footerHeightAfterPointerMove(240, 500, 440)).toBe(300);
    expect(footerHeightAfterPointerMove(240, 500, 560)).toBe(180);
    expect(footerHeightAfterSeparatorKey(240, 'ArrowUp')).toBe(256);
    expect(footerHeightAfterSeparatorKey(240, 'ArrowDown')).toBe(224);
    expect(footerHeightAfterSeparatorKey(240, 'Home')).toBe(MODEL_SESSION_FOOTER_MIN_HEIGHT);
    expect(footerHeightAfterSeparatorKey(240, 'End')).toBe(MODEL_SESSION_FOOTER_MAX_HEIGHT);
    expect(footerHeightAfterSeparatorKey(240, 'Tab')).toBe(240);
    expect(readModelSessionFooterHeight('300')).toBe(300);
    expect(readModelSessionFooterHeight('12')).toBe(MODEL_SESSION_FOOTER_MIN_HEIGHT);
    expect(readModelSessionFooterHeight('nope')).toBeNull();
    expect(readModelSessionFooterHeight(null)).toBeNull();
    expect(readModelSessionSections(null)).toEqual({ imports: true, builder: false });
    expect(readModelSessionSections('{"builder":true}')).toEqual({ imports: true, builder: true });
    expect(readModelSessionSections('broken')).toEqual({ imports: true, builder: false });
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    expect(styles).toMatch(
      /\.model-session-sidebar \{[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto auto;/u,
    );
    expect(styles).toMatch(/\.panel-resizer--session-footer \{[^}]*cursor: row-resize;/u);
    expect(styles).toContain('.model-session-sidebar--collapsed > .panel-resizer--session-footer');
    expect(styles).toMatch(
      /\.model-session-sidebar:not\(\.model-session-sidebar--collapsed\) > footer \{[^}]*overflow-y: auto;/u,
    );
    // The import button is a small pill beside its note, not a full-width bar.
    expect(styles).toMatch(
      /\.model-session-footer-actions \.attachment-button \{[^}]*min-height: 30px;/u,
    );
    expect(styles).not.toMatch(/> footer \.attachment-button \{[^}]*width: 100%;/u);
    expect(appSource).toContain('className="panel-resizer panel-resizer--session-footer"');
    expect(appSource).toContain('aria-orientation="horizontal"');
    expect(appSource.match(/className="model-session-section"/gu)).toHaveLength(2);
  });

  it('clamps panel widths while reserving a usable graph workspace', () => {
    expect(clampPanelWidth(120, 190, 420)).toBe(190);
    expect(clampPanelWidth(900, 300, 620)).toBe(620);
    // The graph's floor is proportional below 1,368px, so a narrow workspace still leaves the
    // sidebars somewhere to move. It was a flat 520 and this case answered 356.
    expect(modelLabPrimaryFloor(1_280)).toBe(486);
    expect(modelLabPrimaryFloor(2_140)).toBe(520);
    expect(availablePanelMaximum(1_280, 390, 190, 420)).toBe(390);
    expect(availablePanelMaximum(2_140, 390, 190, 420)).toBe(420);
  });

  it('lets the Model Assistant chat use the whole window height', () => {
    // Measured in a real browser at a 1,400px window: the panel stopped at 900px and left 429
    // empty pixels under it while the conversation itself had 641. Removing the cap took the
    // conversation to 1,127. The viewport is the only bound this panel needs.
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const sidebar = /\.model-chat--sidebar \{[^}]*\}/u.exec(styles)?.[0] ?? '';

    expect(sidebar).toContain('height: calc(100dvh - 32px)');
    expect(sidebar).not.toContain('max-height');
  });

  it('leaves the Model Assistant resize bar somewhere to move at GOSU pane widths', () => {
    // Measured before this: a workspace of 1,040px or less gave the bar zero travel and 1,100px
    // gave it fourteen pixels, so dragging it did nothing the user could see. The model list is at
    // its default 252 and the assistant's own floor is 300.
    const travel = (workspaceWidth: number) =>
      availablePanelMaximum(workspaceWidth, 252, 300, 620) - 300;

    expect(travel(960)).toBeGreaterThan(0);
    expect(travel(1_040)).toBeGreaterThan(50);
    expect(travel(1_100)).toBeGreaterThan(100);
    // A wide window still hands the assistant its full range.
    expect(availablePanelMaximum(1_920, 252, 300, 620)).toBe(620);
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

    sessions = modelChatSessionWithMessage(sessions, nextRevision, replacement, {
      id: 'revision-comment-1',
      modelId: replacement.id,
      modelVersion: replacement.version,
      createdAt: '2026-08-30T00:00:00.000Z',
      role: 'assistant',
      body: 'Revision 1 changes the prediction head and needs a shape check.',
      trace: ['Automatic Model Assistant revision comment'],
    });
    expect(sessions[nextRevision]?.messages.at(-1)?.body).toContain('needs a shape check');
    expect(sessions[firstRevision]?.messages).toHaveLength(1);
  });

  it('restores only bounded schema-valid permanent memories from local storage', () => {
    const memory = (index: number) => ({
      schemaVersion: 1 as const,
      id: `memory-${index}`,
      scopeType: 'model' as const,
      scopeId: residualClassifier.id,
      kind: 'constraint' as const,
      userRequest: 'Always preserve the residual connection.',
      outcome: 'The residual connection remains an explicit model invariant.',
      keywords: ['residual', 'connection'],
      importance: 85,
      sourceId: `assistant-${index}`,
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    });
    const stored = Array.from({ length: 1_002 }, (_, index) => memory(index));

    const restored = restoreModelLabPermanentMemory(JSON.stringify(stored));

    expect(restored).toHaveLength(1_000);
    expect(restored[0]?.id).toBe('memory-2');
    expect(restored.at(-1)?.id).toBe('memory-1001');
    expect(
      restoreModelLabPermanentMemory(
        JSON.stringify([memory(1), { ...memory(2), kind: 'unsupported-memory-kind' }]),
      ).map((entry) => entry.id),
    ).toEqual(['memory-1']);
    expect(restoreModelLabPermanentMemory('{invalid-json')).toEqual([]);
    expect(restoreModelLabPermanentMemory(JSON.stringify({ entries: stored }))).toEqual([]);
    expect(restoreModelLabPermanentMemory('x'.repeat(1_000_001))).toEqual([]);
    const largeValidStore = Array.from({ length: 1_000 }, (_, index) => ({
      ...memory(index),
      userRequest: `Always preserve constraint ${index} ${'u'.repeat(330)}`,
      outcome: `Durable outcome ${index} ${'o'.repeat(1_100)}`,
    }));
    const boundedLargeStore = restoreModelLabPermanentMemory(JSON.stringify(largeValidStore));
    expect(boundedLargeStore.length).toBeGreaterThan(0);
    expect(boundedLargeStore.length).toBeLessThan(1_000);
    expect(JSON.stringify(boundedLargeStore).length).toBeLessThanOrEqual(
      MODEL_LAB_MEMORY_STORAGE_MAX_CHARACTERS,
    );
  });

  it('reports a local permanent-memory write failure instead of claiming it was saved', () => {
    const memory = restoreModelLabPermanentMemory(
      JSON.stringify([
        {
          schemaVersion: 1,
          id: 'memory-write-failure',
          scopeType: 'model',
          scopeId: residualClassifier.id,
          kind: 'preference',
          userRequest: 'I prefer concise model explanations.',
          outcome: 'Model explanations will remain concise.',
          keywords: ['concise', 'explanations'],
          importance: 70,
          sourceId: 'assistant-write-failure',
          createdAt: '2026-08-31T00:00:00.000Z',
          updatedAt: '2026-08-31T00:00:00.000Z',
        },
      ]),
    );
    const storage = {
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
    };

    expect(persistModelLabPermanentMemory(storage, memory)).toBe('failed');
    const source = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    expect(source).toContain(
      "memoryPersistenceStatus === 'saved' ? uiText('saved') : uiText('not saved')",
    );
  });

  it('fails closed instead of crashing when local permanent-memory reads are denied', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('Storage denied', 'SecurityError');
      },
    };

    expect(loadModelLabPermanentMemory(storage)).toEqual({ entries: [], status: 'failed' });
    const deniedBrowser = Object.defineProperty({}, 'localStorage', {
      get() {
        throw new DOMException('Storage denied', 'SecurityError');
      },
    }) as Pick<Window, 'localStorage'>;
    expect(loadModelLabPermanentMemoryFromBrowser(deniedBrowser)).toEqual({
      entries: [],
      status: 'failed',
    });
    expect(persistModelLabPermanentMemoryToBrowser(deniedBrowser, [])).toBe('failed');
  });

  it('opens a committed revision on the changed block in the expanded graph', () => {
    const changedModel = {
      ...residualClassifier,
      modules: residualClassifier.modules.map((module) =>
        module.id === 'residual-mlp'
          ? { ...module, transform: `${module.transform} + FiLM(log(lambda))` }
          : module,
      ),
    };
    expect(modelViewSessionAfterRevision(residualClassifier, changedModel)).toEqual({
      selectedModuleId: 'residual-mlp',
      graphDetail: 'expanded',
      expandedSubgraphModuleIds: [],
    });
  });

  it('maps pseudocode changes to proposal and revision graph highlights', () => {
    const changedModel = {
      ...residualClassifier,
      modules: residualClassifier.modules.map((module) =>
        module.id === 'head' ? { ...module, name: 'Updated head' } : module,
      ),
      connections: residualClassifier.connections.map((connection) =>
        connection.id === 'e-merge-head'
          ? { ...connection, tensorName: 'updated hidden state' }
          : connection,
      ),
    };
    const summary = modelPseudocodeChangeSummary(residualClassifier, changedModel);
    expect(modelGraphChangeHighlightFromSummary(summary, 'proposal')).toEqual({
      mode: 'proposal',
      addedModuleIds: [],
      changedModuleIds: ['head'],
      removedModuleIds: [],
      addedConnectionIds: [],
      changedConnectionIds: ['e-merge-head'],
      addedStepIds: [],
      changedStepIds: [],
      removedStepLabels: [],
    });
  });

  it('propagates a repeated Block modification to the exact expanded step node', () => {
    const baseRefine = {
      ...residualClassifier.modules[1]!,
      id: 'refine',
      name: 'Unrolled FiLM Refinement Iteration',
      repeat: { count: 'L-1', label: 'j = 1 .. L-1' },
      transform: [
        'For j in range(1, L):',
        '  H1 = H[:, :d]',
        '  H2 = H[:, d:]',
        "  H1_new = X' (y - X H1) / N",
        '  H3 = H',
      ].join('\n'),
    };
    const previousModel = { ...residualClassifier, modules: [baseRefine], connections: [] };
    const nextModel = {
      ...previousModel,
      modules: [
        {
          ...baseRefine,
          transform: baseRefine.transform.replace('H3 = H', 'H3 = concat(H1_new, H2)'),
        },
      ],
    };
    const highlight = modelGraphChangeHighlightFromSummary(
      modelPseudocodeChangeSummary(previousModel, nextModel),
      'proposal',
      previousModel,
      nextModel,
    );
    expect(highlight.changedModuleIds).toEqual(['refine']);
    expect(highlight.changedStepIds).toEqual(['repeat-step:refine:4']);
    expect(highlight.addedStepIds).toEqual([]);
    expect(repeatedStepName('H3 = concat(H1_new, H2)', 3)).toBe('Recombine updated hidden state');
    expect(repeatedStepFormula('H3 = concat(H1_new, H2)', 3)).toBe(
      String.raw`H_3=\operatorname{concat}(H_1^{\mathrm{new}},H_2)`,
    );
    expect(repeatedStepFormula('H3 = concat(H1, H2)', 3)).toBe(
      String.raw`H_3=\operatorname{concat}(H_1,H_2)`,
    );
    expect(renderFormulaResult(repeatedStepFormula('H3 = concat(H1_new, H2)', 3))).toMatchObject({
      valid: true,
    });
    expect(repeatedStepName('H3 = Linear_{2d->512}(H3)', 6)).toBe('Expand hidden channels');
    expect(repeatedStepFormula('H3 = Linear_{2d->512}(H3)', 6)).toContain(
      String.raw`W_1\in\mathbb R^{512\times 2d}`,
    );
    expect(repeatedStepName('H3 = GELU(H3)', 7)).toBe('GELU activation');
    expect(repeatedStepFormula('H3 = GELU(H3)', 7)).toBe(
      String.raw`H_3\leftarrow\operatorname{GELU}(H_3)`,
    );
    const filmParameterStep = '[gamma_j, delta_j] = split(Linear^{(j)}_{256->128}(e_lambda), 2)';
    expect(repeatedStepName(filmParameterStep, 9)).toBe('Generate FiLM parameters');
    expect(renderFormulaResult(repeatedStepFormula(filmParameterStep, 9))).toMatchObject({
      valid: true,
    });
  });

  it('uses a revision-qualified safe filename for Python artifact downloads', () => {
    expect(modelPythonDownloadName('Single-λ LASSO / Foundation Model', 7)).toBe(
      'single-lasso-foundation-model-r7.py',
    );
  });

  it('maps a diff line to the matching textarea selection offset', () => {
    expect(pseudocodeLineOffset('line one\nline two\nline three', 1)).toBe(0);
    expect(pseudocodeLineOffset('line one\nline two\nline three', 2)).toBe(9);
    expect(pseudocodeLineOffset('line one\nline two\nline three', 3)).toBe(18);
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

  it('nests module blocks under expandable model folders using the GOSU sidebar hierarchy', () => {
    expect(toggleModelTreeExpansion(['model-a'], 'model-b')).toEqual(['model-b']);
    expect(toggleModelTreeExpansion(['model-a'], 'model-a')).toEqual([]);

    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(appSource).toContain('className="model-session-tree"');
    expect(appSource).toContain('className="model-tree-folder-button"');
    expect(appSource).toContain('className="model-tree-folder-children"');
    expect(appSource).toContain('<ModelTreeChevron expanded={expanded} />');
    expect(appSource).toContain(
      "aria-label={uiText('{value0} module blocks', { value0: candidate.name })}",
    );
    expect(appSource).not.toContain('id="active-model-modules"');
    expect(styles).toMatch(
      /\.model-tree-folder-button \{[\s\S]*?grid-template-columns: 20px 24px minmax\(0, 1fr\);/u,
    );
    expect(styles).toMatch(
      /\.model-tree-folder-children \{[\s\S]*?margin: 0 7px 7px 18px;[\s\S]*?padding-left: 10px;[\s\S]*?border-left: 1px solid var\(--model-border\);/u,
    );
    expect(styles).toContain('.model-tree-folder.selected .model-tree-folder-button');
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
    expect(modelGraphInstanceKey(residualClassifier.id, 0, false, [], false, false)).not.toBe(
      modelGraphInstanceKey(
        residualClassifier.id,
        0,
        false,
        [],
        false,
        false,
        'proposal-head-changed',
      ),
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

  it('keeps only the visible Assistant toggle focusable across desktop and mobile layouts', () => {
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

  it('hands focus to the control revealed by every Assistant panel transition', () => {
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

  it('closes the transient mobile Assistant drawer whenever the breakpoint changes', () => {
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
    expect(appSource).toContain(
      'const modelSessionsPanelCollapsed = !workspaceEmpty && modelSessionsCollapsed;',
    );
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
    expect(appSource).toContain('Source files use the selected LLM.');
    expect(appSource).toContain('import creates a separate model session.');
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
