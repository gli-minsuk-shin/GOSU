import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  appendModelPseudocodeRevision,
  attachModelPythonArtifact,
  classifyModelPseudocodeUpdate,
  createModelPseudocodeNormalizer,
  initialModelPseudocodeRevision,
  initialModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_HEADER,
  MODEL_PSEUDOCODE_LLM_GUIDE,
  MODEL_PSEUDOCODE_NORMALIZE_ENDPOINT,
  MODEL_PSEUDOCODE_RECONCILE_ENDPOINT,
  modelPseudocodeLineDiffSummary,
  modelPseudocodeLineDiffHunks,
  modelPseudocodeChangeSummary,
  modelPseudocodeNarrativeReconciliationIssues,
  modelPseudocodeNarrativeReconciliationModuleIds,
  modelPseudocodeRevisionCommentPrompt,
  modelPseudocodeRevisionRows,
  modelToPseudocode,
  parseModelPseudocode,
  restoreModelPseudocodeWorkspace,
  serializeModelPseudocodeWorkspace,
} from './model-pseudocode';
import { residualClassifier, sampleModels } from './sample-models';

describe('GOSU Model Pseudocode', () => {
  it('round-trips every bundled ModelIR through one stable text template', () => {
    for (const model of sampleModels) {
      const source = modelToPseudocode(model);
      expect(source.startsWith(`${MODEL_PSEUDOCODE_HEADER}\n`)).toBe(true);
      expect(source).toContain('BLOCK ');
      expect(source).not.toContain('\nMODULE ');
      expect(source).not.toContain('END CONNECT');
      expect(source).toContain(' GRADIENT ');
      const parsed = parseModelPseudocode(source, model.id);
      expect(parsed.ok, parsed.ok ? undefined : parsed.reason).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.model).toMatchObject({
        id: model.id,
        name: model.name,
        framework: model.framework,
      });
      expect(parsed.model.modules).toHaveLength(model.modules.length);
      expect(parsed.model.connections).toHaveLength(model.connections.length);
      expect(parsed.normalized).toBe(source);
    }
  });

  it('round-trips named multi-port contracts and exact connection bindings', () => {
    const edge = residualClassifier.connections[0]!;
    const sourceModule = residualClassifier.modules.find((module) => module.id === edge.source)!;
    const targetModule = residualClassifier.modules.find((module) => module.id === edge.target)!;
    const portedModel = {
      ...residualClassifier,
      intent: {
        ...residualClassifier.intent,
        expectedInput: sourceModule.inputShape,
        expectedOutput: targetModule.outputShape,
      },
      modules: [
        {
          ...sourceModule,
          block: {
            id: 'roundtrip-loop',
            label: 'Round-trip loop',
            repeatCount: 'L-1',
          },
          inputPorts: [
            {
              name: 'external input',
              shape: sourceModule.inputShape,
              binding: 'external' as const,
            },
            {
              name: 'carry in',
              shape: edge.shape,
              binding: 'loop-carried' as const,
              bindingId: 'roundtrip-loop',
            },
          ],
          outputPorts: [
            { name: 'projected state', shape: edge.shape, binding: 'internal' as const },
          ],
        },
        {
          ...targetModule,
          block: {
            id: 'roundtrip-loop',
            label: 'Round-trip loop',
            repeatCount: 'L-1',
          },
          inputPorts: [
            { name: 'projected state', shape: edge.shape, binding: 'internal' as const },
          ],
          outputPorts: [
            {
              name: 'external output',
              shape: targetModule.outputShape,
              binding: 'external' as const,
            },
            {
              name: 'carry out',
              shape: edge.shape,
              binding: 'loop-carried' as const,
              bindingId: 'roundtrip-loop',
            },
          ],
        },
      ],
      connections: [
        {
          ...edge,
          sourcePort: 'projected state',
          targetPort: 'projected state',
        },
      ],
    };

    const source = modelToPseudocode(portedModel);
    expect(source).toContain('output_port: internal | "projected state"');
    expect(source).toContain('input_port: loop-carried | "carry in"');
    expect(source).toContain('| "roundtrip-loop"');
    expect(source).toContain('PORTS "projected state" -> "projected state"');
    const parsed = parseModelPseudocode(source, portedModel.id);
    expect(parsed.ok, parsed.ok ? undefined : parsed.reason).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.model.modules[0]?.outputPorts).toEqual(portedModel.modules[0]?.outputPorts);
    expect(parsed.model.connections[0]).toMatchObject({
      sourcePort: 'projected state',
      targetPort: 'projected state',
    });
    expect(parsed.normalized).toBe(source);

    const disconnected = parseModelPseudocode(
      modelToPseudocode({ ...portedModel, connections: [] }),
      portedModel.id,
    );
    expect(disconnected).toMatchObject({ ok: false });
    if (!disconnected.ok) expect(disconnected.reason).toContain('Graph structure failed');
  });

  it('updates module pseudocode deterministically and rejects broken graph references', () => {
    const source = modelToPseudocode(residualClassifier);
    const updated = source.replace(
      /BLOCK projection "Input projection"[\s\S]*?END BLOCK/u,
      (block) =>
        block
          .replace('BLOCK projection "Input projection"', 'BLOCK projection "Editable projection"')
          .replace('  activation: GELU', '  activation: SiLU')
          .replace('\\operatorname{GELU}', '\\operatorname{SiLU}'),
    );
    const parsed = parseModelPseudocode(updated, residualClassifier.id);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.model.modules.find((module) => module.id === 'projection')).toMatchObject({
      name: 'Editable projection',
      activation: 'SiLU',
    });

    const inconsistent = source.replace('  activation: GELU', '  activation: SiLU');
    const inconsistentResult = parseModelPseudocode(inconsistent, residualClassifier.id);
    expect(inconsistentResult).toMatchObject({ ok: false });
    if (!inconsistentResult.ok) {
      expect(inconsistentResult.reason).toContain('Formula consistency failed');
      expect(inconsistentResult.reason).toContain('single Linear transform');
    }

    const broken = updated.replace(
      'CONNECT e-input-projection input -> projection',
      'CONNECT e-input-projection missing-module -> projection',
    );
    const rejected = parseModelPseudocode(broken, residualClassifier.id);
    expect(rejected).toMatchObject({ ok: false });
    if (!rejected.ok) expect(rejected.reason).toContain('unknown module');
  });

  it('keeps repeated atomic operations inside one editable human-scale block', () => {
    const baseModule = residualClassifier.modules[1]!;
    const compactModel = {
      ...residualClassifier,
      modules: [
        {
          ...baseModule,
          id: 'conditional-trunk',
          name: 'Conditional residual trunk',
          group: 'Conditional residual trunk',
          stage: 0,
          lane: 0,
          inputShape: ['P', '2d'],
          outputShape: ['P', '2d'],
          transform: [
            'H = beta_base',
            'H -> Linear(1, 2d)',
            'for j in range(1, L):',
            '  H1, H2 = split(H)',
            '  H3 = MLP(concat(H1, H2)) + FiLM(log(lambda))',
            '  H = RMSNorm(H + H3)',
          ].join('\n'),
          formula:
            'H^{(j+1)}=\\operatorname{RMSNorm}(H^{(j)}+\\operatorname{FiLM}(\\operatorname{MLP}^{\\mathrm{GELU}}(H^{(j)}),\\lambda))',
          explanation: 'One editable block contains the complete repeated computation.',
          parameterCount: 0,
          codeReference: residualClassifier.sourceLabel,
          repeat: { count: 'L-1', label: 'conditional residual layers' },
        },
      ],
      connections: [],
    };
    const source = modelToPseudocode(compactModel);
    expect(source.match(/^BLOCK /gmu)).toHaveLength(1);
    expect(source).toContain('for j in range(1, L):');
    expect(source).toContain('H3 = MLP(concat(H1, H2)) + FiLM(log(lambda))');
    expect(source).toContain('  repeat: "L-1" | conditional residual layers');
    expect(source).not.toContain('  stage:');
    expect(source).not.toContain('  lane:');
    expect(parseModelPseudocode(source, compactModel.id)).toMatchObject({ ok: true });
  });

  it('migrates legacy verbose MODULE revisions to the compact BLOCK template', () => {
    const legacy = `# GOSU Model Pseudocode v2
MODEL legacy-model "Legacy model"
  version: v1
  framework: design-only
  source: legacy editor
  summary: |
    Legacy verbose revision.
  intent: |
    Preserve old local revisions.
  input: [B, 8]
  output: [B, 2]
END MODEL

MODULE legacy-block "Legacy block"
  kind: output
  group: Output
  stage: 0
  lane: 0
  input: [B, 8]
  output: [B, 2]
  transform: |
    Linear(8, 2)
  activation: none
  equation: |
    z=xW+b
  notes: |
    Legacy module metadata.
  parameters: 18
  code: legacy.txt
  repeat: none
  block: none
  subgraph: none
END MODULE
`;
    const parsed = parseModelPseudocode(legacy, 'legacy-model');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.normalized).toContain('BLOCK legacy-block "Legacy block"');
    expect(parsed.normalized).toContain('  do: |\n    Linear(8, 2)');
    expect(parsed.normalized).not.toContain('\nMODULE ');
  });

  it('stores branches from older revisions and returns navigable tree rows', () => {
    const initial = initialModelPseudocodeRevision(residualClassifier, '2026-08-29T00:00:00.000Z');
    const first = appendModelPseudocodeRevision([initial], {
      parentRevision: 0,
      model: residualClassifier,
      pseudocode: initial.pseudocode,
      originalDraft: 'A residual classifier with a two-layer block.',
      createdAt: '2026-08-29T00:01:00.000Z',
    });
    const branched = appendModelPseudocodeRevision(first, {
      parentRevision: 0,
      model: residualClassifier,
      pseudocode: initial.pseudocode,
      createdAt: '2026-08-29T00:02:00.000Z',
      label: 'Alternative branch',
    });
    expect(
      modelPseudocodeRevisionRows(branched).map((row) => [row.revision.revision, row.depth]),
    ).toEqual([
      [0, 0],
      [1, 1],
      [2, 1],
    ]);
    expect(first[1]?.originalDraft).toBe('A residual classifier with a two-layer block.');
  });

  it('persists validated revision trees locally and rejects corrupt snapshots', () => {
    const initial = initialModelPseudocodeWorkspace([residualClassifier]);
    const root = initial.histories[residualClassifier.id]![0]!;
    const history = appendModelPseudocodeRevision([root], {
      parentRevision: 0,
      model: residualClassifier,
      pseudocode: root.pseudocode,
      originalDraft: 'Human architecture notes kept with the normalized revision.',
      createdAt: '2026-08-29T00:03:00.000Z',
    });
    const histories = {
      [residualClassifier.id]: attachModelPythonArtifact(history, 1, {
        schemaVersion: 1,
        modelId: residualClassifier.id,
        revision: 1,
        filename: 'model.py',
        entrypoint: 'ResidualClassifier',
        framework: 'PyTorch',
        implementationStatus: 'executable',
        dependencies: ['torch'],
        generatedAt: '2026-08-29T00:04:00.000Z',
        sourceSha256: 'a'.repeat(64),
        absolutePath: '/tmp/gosu/residual/r1/model.py',
        manifestPath: '/tmp/gosu/residual/r1/manifest.json',
        generator: 'fixture',
      }),
    };
    const serialized = serializeModelPseudocodeWorkspace({
      histories,
      selectedRevisions: { [residualClassifier.id]: 1 },
      activeModelId: residualClassifier.id,
      trashedModelIds: [],
    });
    const restored = restoreModelPseudocodeWorkspace(serialized, sampleModels);
    expect(restored.models).toHaveLength(1);
    expect(restored.selectedRevisions[residualClassifier.id]).toBe(1);
    expect(restored.histories[residualClassifier.id]).toHaveLength(2);
    expect(restored.histories[residualClassifier.id]?.[1]?.originalDraft).toBe(
      'Human architecture notes kept with the normalized revision.',
    );
    expect(restored.histories[residualClassifier.id]?.[1]?.pythonArtifact).toMatchObject({
      entrypoint: 'ResidualClassifier',
      revision: 1,
    });

    const rejected = restoreModelPseudocodeWorkspace(
      '{"schemaVersion":1,"histories":{"broken":[{"bad":true}]}}',
      sampleModels,
    );
    expect(rejected.models).toHaveLength(sampleModels.length);
    expect(rejected.activeModelId).toBe(sampleModels[0]?.id);
  });

  it('normalizes free-form drafts through the selected Builder LLM without updating a graph', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: residualClassifier,
            trace: ['Codex CLI · gpt-5.6-sol', 'Reasoning high'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const normalizer = createModelPseudocodeNormalizer(fetchImpl as typeof fetch);
    const result = await normalizer.normalize({
      baseModel: residualClassifier,
      source: 'For layer in blocks: h = h + MLP(LN(h))',
      selection: {
        providerId: 'codex',
        requestedModelId: 'gpt-5.6-sol',
        reasoningOptionId: 'high',
      },
    });
    expect(result.pseudocode.startsWith(MODEL_PSEUDOCODE_HEADER)).toBe(true);
    expect(result.trace).toContain('Reasoning high');
    expect(fetchImpl).toHaveBeenCalledWith(
      MODEL_PSEUDOCODE_NORMALIZE_ENDPOINT,
      expect.objectContaining({ method: 'POST' }),
    );
    const request = (fetchImpl.mock.calls[0] as unknown as [unknown, RequestInit])[1];
    expect(JSON.parse(String(request.body))).toMatchObject({
      source: 'For layer in blocks: h = h + MLP(LN(h))',
      selection: { requestedModelId: 'gpt-5.6-sol', reasoningOptionId: 'high' },
    });
  });

  it('requests bounded narrative patches without authorizing graph topology changes', async () => {
    const intended = {
      ...residualClassifier,
      modules: residualClassifier.modules.map((module) =>
        module.id === 'residual-mlp'
          ? {
              ...module,
              transform: `${module.transform} + FiLM(log(lambda))`,
              formula: `${module.formula}+\\operatorname{FiLM}(h,\\lambda)`,
              explanation: `${module.explanation} Lambda conditions the correction.`,
            }
          : module,
      ),
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ model: intended, trace: ['Bounded narrative patches'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const normalizer = createModelPseudocodeNormalizer(fetchImpl as typeof fetch);
    await expect(
      normalizer.reconcileNarrative({
        baseModel: residualClassifier,
        intendedModel: intended,
        moduleIds: ['residual-mlp'],
        selection: {
          providerId: 'codex',
          requestedModelId: 'gpt-5.6-sol',
          reasoningOptionId: 'high',
        },
      }),
    ).resolves.toMatchObject({ model: { id: residualClassifier.id } });
    expect(fetchImpl).toHaveBeenCalledWith(
      MODEL_PSEUDOCODE_RECONCILE_ENDPOINT,
      expect.objectContaining({ method: 'POST' }),
    );
    const request = (fetchImpl.mock.calls[0] as unknown as [unknown, RequestInit])[1];
    expect(JSON.parse(String(request.body))).toMatchObject({
      moduleIds: ['residual-mlp'],
      intendedModel: { id: residualClassifier.id },
    });
  });

  it('commits valid templates directly and routes free-form drafts to LLM normalization', () => {
    const canonical = modelToPseudocode(residualClassifier);
    expect(classifyModelPseudocodeUpdate(canonical, residualClassifier.id)).toMatchObject({
      kind: 'commit',
      model: { id: residualClassifier.id },
      pseudocode: canonical,
    });
    const freeForm = classifyModelPseudocodeUpdate(
      'Repeat a residual MLP block four times, then add a classification head.',
      residualClassifier.id,
    );
    expect(freeForm).toMatchObject({ kind: 'normalize' });
    if (freeForm.kind === 'normalize') {
      expect(freeForm.reason).toContain('first line');
    }
  });

  it('summarizes the original-to-normalized line diff for review', () => {
    const original = 'input\nblock\noutput';
    const proposed = 'input\nblock v2\noutput\nloss';
    expect(modelPseudocodeLineDiffSummary(original, proposed)).toEqual({
      originalLines: 3,
      normalizedLines: 4,
      addedLines: 2,
      removedLines: 1,
    });
    expect(modelPseudocodeLineDiffHunks(original, proposed)).toEqual([
      {
        id: 'hunk-1',
        originalStart: 2,
        originalEnd: 2,
        proposedStart: 2,
        proposedEnd: 2,
        originalLines: ['block'],
        proposedLines: ['block v2'],
      },
      {
        id: 'hunk-2',
        originalStart: 4,
        originalEnd: 3,
        proposedStart: 4,
        proposedEnd: 4,
        originalLines: [],
        proposedLines: ['loss'],
      },
    ]);
    expect(modelPseudocodeLineDiffHunks(original, original)).toEqual([]);
    expect(modelPseudocodeLineDiffSummary(original, original)).toMatchObject({
      addedLines: 0,
      removedLines: 0,
    });
  });

  it('builds a bounded revision comment prompt from architecture deltas', () => {
    const changed = {
      ...residualClassifier,
      modules: residualClassifier.modules.map((module) =>
        module.id === 'head'
          ? { ...module, outputShape: ['B', 2], transform: 'Linear(256, 2)' }
          : module,
      ),
    };
    const prompt = modelPseudocodeRevisionCommentPrompt({
      previousModel: residualClassifier,
      nextModel: changed,
      fromRevision: 2,
      toRevision: 3,
    });
    expect(prompt).toContain('revision r3');
    expect(prompt).toContain('r2');
    expect(prompt).toContain('Changed modules: head');
    expect(prompt).toContain('runtime 결과를 추측하지 말고');
  });

  it('explains changed fields and requests LLM reconciliation when formulas lag behind code', () => {
    const transformOnly = {
      ...residualClassifier,
      modules: residualClassifier.modules.map((module) =>
        module.id === 'residual-mlp'
          ? { ...module, transform: `${module.transform} + FiLM(log(lambda))` }
          : module,
      ),
    };
    expect(modelPseudocodeChangeSummary(residualClassifier, transformOnly).lines).toContain(
      'Changed Residual transform (residual-mlp): transform',
    );
    expect(
      modelPseudocodeNarrativeReconciliationIssues(residualClassifier, transformOnly)[0],
    ).toContain('formula and explanation did not change');
    expect(
      modelPseudocodeNarrativeReconciliationModuleIds(residualClassifier, transformOnly),
    ).toEqual(['residual-mlp']);

    const reconciled = {
      ...transformOnly,
      modules: transformOnly.modules.map((module) =>
        module.id === 'residual-mlp'
          ? {
              ...module,
              formula: `${module.formula}+\\operatorname{FiLM}(h,\\lambda)`,
              explanation: `${module.explanation} The correction is conditioned by lambda.`,
            }
          : module,
      ),
    };
    expect(modelPseudocodeNarrativeReconciliationIssues(residualClassifier, reconciled)).toEqual(
      [],
    );
  });

  it('exposes the editor, update action, revision tree, and future experiment boundary', () => {
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(appSource).toContain("aria-label={uiText('Model pseudocode editor')}");
    expect(appSource).toContain('Update graph');
    expect(appSource).not.toContain('Interpret & normalize');
    expect(appSource).toContain('Apply as revision');
    expect(appSource).toContain('Review normalized pseudocode changes');
    expect(appSource).toContain('classifyModelPseudocodeUpdate');
    expect(appSource).toContain('Review LLM edit proposal');
    expect(appSource).toContain('Model Assistant prepared a pseudocode and graph proposal');
    expect(appSource).toContain("purpose: 'revision-comment'");
    expect(appSource).toContain('modelPseudocodeRevisionCommentPrompt');
    expect(appSource).toContain('Architecture update receipt');
    expect(appSource).toContain('modelPseudocodeNarrativeReconciliationIssues');
    expect(appSource).toContain('LLM mapped:');
    expect(appSource).toContain('Jump to changed lines');
    expect(appSource).toContain('jumpToPseudocodeDiffHunk');
    expect(appSource).toContain('The LLM returned an identical draft');
    expect(styles).toContain('.model-pseudocode-diff-jump {');
    expect(styles).toContain('pre > span.is-active');
    expect(appSource).toContain('Template guide · shared with the LLM normalizer');
    expect(appSource).toContain('Original free-form draft retained with this revision');
    expect(appSource).toContain('modelPseudocodeNormalizer.normalize');
    expect(appSource).toContain("aria-label={uiText('Model pseudocode revision tree')}");
    expect(appSource).toContain('VERSIONED CODE ARTIFACT · REVISION');
    expect(appSource).toContain('Generated Python model source');
    expect(appSource).toContain('Experiment handoff receipt ready');
    expect(appSource).toContain('generatePythonArtifact(nextModel, 0)');
    expect(appSource).toContain('generatePythonArtifact(nextModel, nextRevision.revision)');
    expect(styles).toContain('.model-pseudocode-studio {');
    expect(styles).toContain('.model-pseudocode-revision-tree {');
    expect(styles).toContain('.model-pseudocode-normalization-review {');
    expect(styles).toContain('.model-pseudocode-diff {');
    expect(styles).toContain('.model-pseudocode-original {');
    expect(MODEL_PSEUDOCODE_LLM_GUIDE).toContain(
      'BLOCK <stable-id> "Human-readable architectural block"',
    );
    expect(MODEL_PSEUDOCODE_LLM_GUIDE).toContain('Prefer 3-8 meaningful');
  });
});
