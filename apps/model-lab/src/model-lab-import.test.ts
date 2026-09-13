import { describe, expect, it } from 'vitest';
import { moduleGradientHealth, runAgentReview } from './model-lab-domain';
import { modelSourceOutputContractFindings, parseModelImportJson } from './model-lab-import';

const validImport = {
  schemaVersion: 1,
  id: 'tiny-model',
  name: 'Tiny model',
  version: 'v1',
  framework: 'PyTorch',
  sourceLabel: 'imported ModelIR',
  sourceArtifacts: [{ path: 'model.py', verified: true }],
  summary: 'A bounded import fixture.',
  intent: {
    statement: 'Map four inputs to two outputs.',
    invariants: ['The output width is two.'],
    expectedInput: ['B', 4],
    expectedOutput: ['B', 2],
  },
  modules: [
    {
      id: 'input',
      name: 'Input',
      kind: 'input',
      group: 'Input',
      stage: 0,
      lane: 0,
      inputShape: ['B', 4],
      outputShape: ['B', 4],
      transform: 'identity',
      activation: null,
      formula: 'h=x',
      explanation: 'Input features.',
      parameterCount: 0,
      codeReference: 'model.py:1',
    },
    {
      id: 'head',
      name: 'Head',
      kind: 'output',
      group: 'Output',
      stage: 1,
      lane: 0,
      inputShape: ['B', 4],
      outputShape: ['B', 2],
      transform: 'Linear(4, 2)',
      activation: null,
      formula: 'z=xW+b',
      explanation: 'Output projection.',
      parameterCount: 10,
      codeReference: 'model.py:2',
    },
  ],
  connections: [
    {
      id: 'edge',
      source: 'input',
      target: 'head',
      tensorName: 'x',
      shape: ['B', 4],
      activationNorm: 1,
    },
  ],
};

describe('Model Lab JSON import', () => {
  it('accepts compact symbolic dimensions used in human architecture notes', () => {
    const imported = structuredClone(validImport);
    imported.intent.expectedOutput = ['B', '2d'];
    imported.modules[1]!.outputShape = ['B', '2d'];
    const result = parseModelImportJson(JSON.stringify(imported));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.intent.expectedOutput).toEqual(['B', '2d']);
    expect(result.model.modules[1]?.outputShape).toEqual(['B', '2d']);
  });

  it('imports bounded architecture JSON without inventing runtime gradient evidence', () => {
    const result = parseModelImportJson(JSON.stringify(validImport));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.connections[0]?.gradient.states.healthy).toEqual([
      'not-observed',
      'not-observed',
      'not-observed',
      'not-observed',
      'not-observed',
    ]);
    expect(result.model.sourceArtifacts).toEqual([{ path: 'model.py', verified: true }]);
    const gradientReview = runAgentReview(result.model, 'healthy', 0).find(
      (review) => review.id === 'autograd-inspector',
    );
    expect(gradientReview?.status).toBe('warning');
    expect(gradientReview?.summary).toContain('not observed');
    expect(gradientReview?.evidence.some((finding) => finding.includes('not-observed'))).toBe(true);
  });

  it('preserves named ports and exact edge bindings while rejecting ambiguous port metadata', () => {
    const ported = structuredClone(validImport);
    Object.assign(ported.modules[0]!, {
      inputPorts: [{ name: 'features', shape: ['B', 4], binding: 'external' }],
      outputPorts: [{ name: 'hidden', shape: ['B', 4], binding: 'internal' }],
    });
    Object.assign(ported.modules[1]!, {
      inputPorts: [{ name: 'hidden', shape: ['B', 4], binding: 'internal' }],
      outputPorts: [{ name: 'prediction', shape: ['B', 2], binding: 'external' }],
    });
    Object.assign(ported.connections[0]!, {
      sourcePort: 'hidden',
      targetPort: 'hidden',
    });
    for (const module of ported.modules) Object.assign(module, { subgraph: null });

    const result = parseModelImportJson(JSON.stringify(ported));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.modules[0]?.outputPorts).toEqual([
      { name: 'hidden', shape: ['B', 4], binding: 'internal' },
    ]);
    expect(result.model.modules.every((module) => module.subgraph === undefined)).toBe(true);
    expect(result.model.connections[0]).toMatchObject({
      sourcePort: 'hidden',
      targetPort: 'hidden',
    });

    const mixed = JSON.parse(JSON.stringify(ported)) as {
      modules: Array<Record<string, unknown>>;
      connections: Array<Record<string, unknown>>;
    };
    delete mixed.modules[1]!.inputPorts;
    delete mixed.connections[0]!.targetPort;
    const mixedResult = parseModelImportJson(JSON.stringify(mixed));
    expect(mixedResult.ok).toBe(true);
    if (mixedResult.ok) {
      expect(mixedResult.model.connections[0]).toMatchObject({ sourcePort: 'hidden' });
      expect(mixedResult.model.connections[0]?.targetPort).toBeUndefined();
    }

    const duplicate = structuredClone(ported) as unknown as {
      modules: Array<{
        outputPorts?: Array<{
          name: string;
          shape: Array<string | number>;
          binding: string;
        }>;
      }>;
    };
    duplicate.modules[0]!.outputPorts!.push({
      name: 'hidden',
      shape: ['B', 4],
      binding: 'internal',
    });
    const duplicateResult = parseModelImportJson(JSON.stringify(duplicate));
    expect(duplicateResult).toMatchObject({ ok: false });
    if (!duplicateResult.ok) expect(duplicateResult.reason).toContain('names must be unique');

    const wrongBinding = structuredClone(ported) as unknown as {
      connections: Array<{ targetPort?: string }>;
    };
    wrongBinding.connections[0]!.targetPort = 'prediction';
    const wrongBindingResult = parseModelImportJson(JSON.stringify(wrongBinding));
    expect(wrongBindingResult).toMatchObject({ ok: false });
    if (!wrongBindingResult.ok) expect(wrongBindingResult.reason).toContain('unknown targetPort');

    const unqualifiedSubgraph = JSON.parse(JSON.stringify(ported)) as {
      modules: Array<Record<string, unknown>>;
    };
    unqualifiedSubgraph.modules[0]!.subgraph = { modelId: 'not-in-builder-registry' };
    const builderSubgraphResult = parseModelImportJson(JSON.stringify(unqualifiedSubgraph), {
      enforceSourceOutputContracts: true,
      allowSubgraphs: false,
    });
    expect(builderSubgraphResult).toMatchObject({ ok: false });
    if (!builderSubgraphResult.ok) {
      expect(builderSubgraphResult.reason).toContain('unqualified subgraph');
    }

    const provenanceCandidate = JSON.parse(JSON.stringify(ported)) as {
      sourceArtifacts: Array<{ path: string; verified: boolean }>;
      modules: Array<Record<string, unknown>>;
    };
    provenanceCandidate.sourceArtifacts = [{ path: 'hallucinated.py', verified: true }];
    for (const module of provenanceCandidate.modules) {
      module.codeReference = 'model.py, source anchor';
    }
    const normalizedProvenance = parseModelImportJson(JSON.stringify(provenanceCandidate), {
      enforceSourceOutputContracts: true,
      sourceArtifactNames: ['model.py'],
    });
    expect(normalizedProvenance.ok).toBe(true);
    if (normalizedProvenance.ok) {
      expect(normalizedProvenance.model.sourceArtifacts).toEqual([
        { path: 'model.py', verified: true },
      ]);
    }
    provenanceCandidate.modules[0]!.codeReference = 'data.py:1';
    const rejectedProvenance = parseModelImportJson(JSON.stringify(provenanceCandidate), {
      enforceSourceOutputContracts: true,
      sourceArtifactNames: ['model.py'],
    });
    expect(rejectedProvenance).toMatchObject({ ok: false });
    if (!rejectedProvenance.ok) {
      expect(rejectedProvenance.reason).toContain('Source provenance failed');
    }

    const missingBoundaryKinds = JSON.parse(JSON.stringify(ported)) as {
      modules: Array<Record<string, unknown>>;
    };
    for (const module of missingBoundaryKinds.modules) module.kind = 'linear';
    const missingBoundaryResult = parseModelImportJson(JSON.stringify(missingBoundaryKinds), {
      enforceSourceOutputContracts: true,
    });
    expect(missingBoundaryResult).toMatchObject({ ok: false });
    if (!missingBoundaryResult.ok) {
      expect(missingBoundaryResult.reason).toContain('no input-kind boundary module');
      expect(missingBoundaryResult.reason).toContain(
        'no output/objective terminal boundary module',
      );
    }
    const objectiveTerminal = JSON.parse(JSON.stringify(ported)) as {
      modules: Array<Record<string, unknown>>;
    };
    objectiveTerminal.modules.at(-1)!.kind = 'objective';
    expect(
      parseModelImportJson(JSON.stringify(objectiveTerminal), {
        enforceSourceOutputContracts: true,
      }).ok,
    ).toBe(true);
  });

  it('uses the strict builder profile to reject incomplete ports and atomic repeat expansion', () => {
    const ported = JSON.parse(JSON.stringify(validImport)) as {
      modules: Array<Record<string, unknown>>;
      connections: Array<Record<string, unknown>>;
    };
    Object.assign(ported.modules[0]!, {
      inputPorts: [{ name: 'features', shape: ['B', 4], binding: 'external' }],
      outputPorts: [{ name: 'hidden', shape: ['B', 4], binding: 'internal' }],
    });
    Object.assign(ported.modules[1]!, {
      inputPorts: [{ name: 'hidden', shape: ['B', 4], binding: 'internal' }],
      outputPorts: [{ name: 'prediction', shape: ['B', 2], binding: 'external' }],
    });
    Object.assign(ported.connections[0]!, { sourcePort: 'hidden', targetPort: 'hidden' });
    const disconnected = structuredClone(ported);
    disconnected.connections = [];
    const disconnectedResult = parseModelImportJson(JSON.stringify(disconnected), {
      enforceSourceOutputContracts: true,
    });
    expect(disconnectedResult).toMatchObject({ ok: false });
    if (!disconnectedResult.ok)
      expect(disconnectedResult.reason).toContain('Graph structure failed');

    const atomicRepeat = JSON.parse(JSON.stringify(validImport)) as {
      modules: Array<Record<string, unknown>>;
    };
    Object.assign(atomicRepeat.modules[1]!, {
      repeat: { count: 'L-1', label: 'iterative refinement' },
      transform: [
        'for j in range(1, L):',
        '  H = Linear(2K, 2K)(H)',
        '  A, F = split(H)',
        '  B = soft_threshold(A, tau)',
        '  G = X.T @ (y - X @ B) / N',
        '  R = RMSNorm(G / lambda)',
        '  Z = concat(R, F)',
        '  C = MLP(Z)',
        '  H = H + C',
      ].join('\n'),
      formula: String.raw`H_j=\operatorname{RMSNorm}(\mathcal B(H_{j-1}))`,
    });
    expect(parseModelImportJson(JSON.stringify(atomicRepeat)).ok).toBe(true);
    const strictAtomic = parseModelImportJson(JSON.stringify(atomicRepeat), {
      enforceSourceOutputContracts: true,
    });
    expect(strictAtomic).toMatchObject({ ok: false });
    if (!strictAtomic.ok) {
      expect(strictAtomic.reason).toContain('Semantic architecture quality failed');
      expect(strictAtomic.reason).toContain('2–6 dependency-connected modules');
    }

    const semanticComposite = JSON.parse(JSON.stringify(ported)) as {
      modules: Array<Record<string, unknown>>;
    };
    for (const module of semanticComposite.modules) {
      module.block = {
        id: 'semantic-refinement',
        label: 'Semantic refinement',
        repeatCount: 'L-1',
      };
    }
    expect(
      parseModelImportJson(JSON.stringify(semanticComposite), {
        enforceSourceOutputContracts: true,
      }).ok,
    ).toBe(true);
  });

  it('rejects imported models whose operation text contradicts their equation', () => {
    const imported = structuredClone(validImport);
    imported.modules[1]!.transform = 'H = Linear_{2d->2d}(H)';
    imported.modules[1]!.formula = String.raw`H_3=W_2\operatorname{GELU}(W_1H+b_1)+b_2`;

    const result = parseModelImportJson(JSON.stringify(imported));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Formula consistency failed');
    expect(result.reason).toContain('single Linear transform is represented as a multi-layer MLP');
  });

  it('rejects formulas that the production KaTeX renderer cannot display', () => {
    const imported = structuredClone(validImport);
    imported.modules[1]!.formula = String.raw`z=\frac{x`;

    const result = parseModelImportJson(JSON.stringify(imported));

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain('formula is not renderable');
  });

  it('rejects differently shaped live outputs from one ModelIR v1 module but permits typed fan-out', () => {
    const mismatched = structuredClone(validImport);
    mismatched.connections[0]!.shape = ['B', 3];
    const rejected = parseModelImportJson(JSON.stringify(mismatched), {
      enforceSourceOutputContracts: true,
    });

    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.reason).toContain('Graph structure failed');
    expect(rejected.reason).toContain('edge declares [B × 3]');

    const fanOut = structuredClone(validImport);
    fanOut.modules.push({ ...structuredClone(validImport.modules[1]!), id: 'head-2' });
    fanOut.connections.push({
      ...structuredClone(validImport.connections[0]!),
      id: 'edge-2',
      target: 'head-2',
    });
    Object.assign(fanOut.modules[0]!, {
      inputPorts: [{ name: 'features', shape: ['B', 4], binding: 'external' }],
      outputPorts: [{ name: 'hidden', shape: ['B', 4], binding: 'internal' }],
    });
    for (const module of fanOut.modules.slice(1)) {
      Object.assign(module, {
        inputPorts: [{ name: 'hidden', shape: ['B', 4], binding: 'internal' }],
        outputPorts: [{ name: 'prediction', shape: ['B', 2], binding: 'external' }],
      });
    }
    for (const connection of fanOut.connections) {
      Object.assign(connection, { sourcePort: 'hidden', targetPort: 'hidden' });
    }
    const accepted = parseModelImportJson(JSON.stringify(fanOut), {
      enforceSourceOutputContracts: true,
    });
    expect(accepted.ok).toBe(true);
  });

  it('rejects a high-confidence computed value that is neither consumed nor exported', () => {
    const imported = structuredClone(validImport);
    imported.modules[1]!.transform = 'a = slice(x); gate = sigmoid(a); h = concat(x, a)';
    imported.modules[1]!.formula =
      'a=\\operatorname{slice}(x),\\quad gate=\\sigma(a),\\quad h=\\operatorname{concat}(x,a)';

    const result = parseModelImportJson(JSON.stringify(imported), {
      enforceSourceOutputContracts: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('computed named value gate is neither consumed nor exported');
  });

  it('splits an independent lambda summary away from the correlation embedding', () => {
    const module = (input: {
      id: string;
      name: string;
      kind: string;
      stage: number;
      lane: number;
      inputShape: Array<string | number>;
      outputShape: Array<string | number>;
      transform: string;
      formula: string;
    }) => ({
      ...input,
      group: 'Learned solver',
      activation: null,
      explanation: input.transform,
      parameterCount: 0,
      codeReference: 'new_model4.rtf',
    });
    const grouped = {
      ...structuredClone(validImport),
      id: 'lasso-path-fixture',
      intent: {
        statement: 'Produce a LASSO path.',
        invariants: [],
        expectedInput: ['N', 'P'],
        expectedOutput: ['P', 'K'],
      },
      modules: [
        module({
          id: 'x',
          name: 'X',
          kind: 'input',
          stage: 0,
          lane: 0,
          inputShape: ['N', 'P'],
          outputShape: ['N', 'P'],
          transform: 'X_out = X_c',
          formula: 'X_{out}=X_c',
        }),
        module({
          id: 'y',
          name: 'y',
          kind: 'input',
          stage: 0,
          lane: 1,
          inputShape: ['N', 1],
          outputShape: ['N', 1],
          transform: 'y_out = y_c',
          formula: 'y_{out}=y_c',
        }),
        module({
          id: 'lambda',
          name: 'Lambda',
          kind: 'input',
          stage: 0,
          lane: 2,
          inputShape: [1, 'K'],
          outputShape: [1, 'K'],
          transform: 'lambda_out = lambda',
          formula: '\\lambda_{out}=\\lambda',
        }),
        module({
          id: 'statistic_embedding',
          name: 'Correlation Statistic Embedding',
          kind: 'linear',
          stage: 1,
          lane: 0,
          inputShape: ['N', 'P'],
          outputShape: ['H0', 'log_lam_mean'],
          transform:
            'log_lam_mean = -mean(log(lambda))\nH_stat = X_c.T @ y_c / N\nH = Linear(1, d)(H_stat)',
          formula:
            'm_\\lambda=-\\frac1K\\sum_k\\log\\lambda_k\ns=\\frac{X_c^\\top y_c}{N}\nH_0=\\operatorname{Linear}_{1\\to2K}(s)',
        }),
        module({
          id: 'refine',
          name: 'Refine',
          kind: 'linear',
          stage: 2,
          lane: 0,
          inputShape: ['P', '2K'],
          outputShape: ['P', '2K'],
          transform: 'T = exp(H + log(lambda) - log_lam_mean)',
          formula: 'T=\\exp(H+\\log\\lambda-m_\\lambda)',
        }),
        module({
          id: 'out',
          name: 'Output',
          kind: 'output',
          stage: 3,
          lane: 0,
          inputShape: ['P', '2K'],
          outputShape: ['P', 'K'],
          transform: 'beta = slice(H)',
          formula: '\\beta=H_{:,1:K}',
        }),
      ],
      connections: [
        {
          id: 'x-stat',
          source: 'x',
          target: 'statistic_embedding',
          tensorName: 'X_c',
          shape: ['N', 'P'],
          activationNorm: 0,
        },
        {
          id: 'y-stat',
          source: 'y',
          target: 'statistic_embedding',
          tensorName: 'y_c',
          shape: ['N', 1],
          activationNorm: 0,
        },
        {
          id: 'lambda-stat',
          source: 'lambda',
          target: 'statistic_embedding',
          tensorName: 'lambda',
          shape: [1, 'K'],
          activationNorm: 0,
        },
        {
          id: 'stat-h',
          source: 'statistic_embedding',
          target: 'refine',
          tensorName: 'H_0',
          shape: ['P', '2K'],
          activationNorm: 0,
        },
        {
          id: 'stat-mean',
          source: 'statistic_embedding',
          target: 'refine',
          tensorName: 'log_lam_mean',
          shape: [1, 1],
          activationNorm: 0,
        },
        {
          id: 'refine-out',
          source: 'refine',
          target: 'out',
          tensorName: 'H',
          shape: ['P', '2K'],
          activationNorm: 0,
        },
      ],
    };

    const result = parseModelImportJson(JSON.stringify(grouped));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = result.model.modules.find(
      (candidate) => candidate.id === 'statistic_embedding-lambda-summary',
    );
    const embedding = result.model.modules.find(
      (candidate) => candidate.id === 'statistic_embedding',
    );
    expect(summary).toMatchObject({
      name: 'Lambda Log Summary',
      inputShape: [1, 'K'],
      outputShape: [1, 1],
    });
    expect(embedding).toMatchObject({ outputShape: ['P', '2K'] });
    expect(embedding?.inputShape.join(' ')).not.toMatch(/lambda|lam_/iu);
    expect(embedding?.transform).not.toContain('log_lam_mean');
    expect(embedding?.formula).not.toContain('m_\\lambda');
    expect(result.model.connections.find((edge) => edge.id === 'lambda-stat')?.target).toBe(
      summary?.id,
    );
    expect(result.model.connections.find((edge) => edge.id === 'stat-mean')?.source).toBe(
      summary?.id,
    );
    expect(modelSourceOutputContractFindings(result.model)).toEqual([]);

    const conditionedGrouped = structuredClone(grouped);
    const conditionedEmbedding = conditionedGrouped.modules.find(
      (candidate) => candidate.id === 'statistic_embedding',
    )!;
    conditionedEmbedding.transform = conditionedEmbedding.transform.replace(
      'H = Linear(1, d)(H_stat)',
      'H = Linear(2, d)(concat(H_stat, log_lam_mean))',
    );
    conditionedEmbedding.formula = conditionedEmbedding.formula.replace(
      'H_0=\\operatorname{Linear}_{1\\to2K}(s)',
      'H_0=\\operatorname{Linear}_{2\\to2K}([s;m_\\lambda])',
    );
    const conditioned = parseModelImportJson(JSON.stringify(conditionedGrouped));
    expect(conditioned.ok).toBe(true);
    if (conditioned.ok) {
      expect(
        conditioned.model.modules.some((candidate) => candidate.id.endsWith('lambda-summary')),
      ).toBe(false);
    }

    const lambdaScaledGrouped = structuredClone(grouped);
    const lambdaScaledEmbedding = lambdaScaledGrouped.modules.find(
      (candidate) => candidate.id === 'statistic_embedding',
    )!;
    lambdaScaledEmbedding.transform = lambdaScaledEmbedding.transform
      .replace('log(lambda)', 'log(lam)')
      .replace('H = Linear(1, d)(H_stat)', 'H = H_stat / lam');
    lambdaScaledEmbedding.formula = lambdaScaledEmbedding.formula
      .replace('\\log\\lambda_k', '\\log lam_k')
      .replace('H_0=\\operatorname{Linear}_{1\\to2K}(s)', 'H_0=s/\\mathrm{lam}');
    const lambdaScaled = parseModelImportJson(JSON.stringify(lambdaScaledGrouped));
    expect(lambdaScaled.ok).toBe(true);
    if (lambdaScaled.ok) {
      expect(
        lambdaScaled.model.modules.some((candidate) => candidate.id.endsWith('lambda-summary')),
      ).toBe(false);
      expect(
        lambdaScaled.model.connections.find((connection) => connection.id === 'lambda-stat')
          ?.target,
      ).toBe('statistic_embedding');
    }
  });

  it('preserves an imported non-differentiable edge as not applicable', () => {
    const imported = {
      ...structuredClone(validImport),
      connections: validImport.connections.map((connection) => ({
        ...structuredClone(connection),
        expectedToCarryGradient: false,
      })),
    };
    const result = parseModelImportJson(JSON.stringify(imported));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.connections[0]?.gradient.states.healthy).toEqual(
      Array(5).fill('not-applicable'),
    );
    expect(moduleGradientHealth(result.model, 'input', 'exploding', 4)).toBe('not-applicable');
  });

  it('preserves a bounded generic subgraph reference on any imported module', () => {
    const imported = {
      ...structuredClone(validImport),
      modules: validImport.modules.map((module, index) =>
        index === 0
          ? { ...structuredClone(module), subgraph: { modelId: 'nested-model' } }
          : module,
      ),
    };
    const result = parseModelImportJson(JSON.stringify(imported));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.modules[0]?.subgraph).toEqual({ modelId: 'nested-model' });
  });

  it('preserves bounded repeated-layer metadata for stacked block rendering', () => {
    const imported = {
      ...structuredClone(validImport),
      modules: validImport.modules.map((module, index) =>
        index === 1
          ? {
              ...structuredClone(module),
              repeat: { count: 6, label: 'Transformer encoder block' },
            }
          : module,
      ),
    };
    const result = parseModelImportJson(JSON.stringify(imported));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.modules[1]?.repeat).toEqual({
      count: 6,
      label: 'Transformer encoder block',
    });
  });

  it('preserves a symbolic repeated block boundary shared by its internal modules', () => {
    const imported = {
      ...structuredClone(validImport),
      modules: validImport.modules.map((module) => ({
        ...structuredClone(module),
        block: { id: 'iterative-body', label: 'Iterative residual block', repeatCount: 'L-1' },
      })),
    };
    const result = parseModelImportJson(JSON.stringify(imported));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.modules.map((module) => module.block)).toEqual([
      { id: 'iterative-body', label: 'Iterative residual block', repeatCount: 'L-1' },
      { id: 'iterative-body', label: 'Iterative residual block', repeatCount: 'L-1' },
    ]);
  });

  it('rejects unsafe symbolic repeated block counts', () => {
    const imported = {
      ...structuredClone(validImport),
      modules: validImport.modules.map((module) => ({
        ...structuredClone(module),
        block: { id: 'iterative-body', label: 'Block', repeatCount: '<script>' },
      })),
    };
    const result = parseModelImportJson(JSON.stringify(imported));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('block.repeatCount');
  });

  it('treats a strict-output null repeat field as an unrepeated module', () => {
    const imported = {
      ...validImport,
      modules: validImport.modules.map((module) => ({ ...structuredClone(module), repeat: null })),
    };
    const result = parseModelImportJson(JSON.stringify(imported));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.modules.every((module) => module.repeat === undefined)).toBe(true);
  });

  it('rejects repeated-layer counts outside the bounded visualization range', () => {
    const imported = {
      ...structuredClone(validImport),
      modules: validImport.modules.map((module, index) =>
        index === 1 ? { ...structuredClone(module), repeat: { count: 1, label: 'Layer' } } : module,
      ),
    };
    const result = parseModelImportJson(JSON.stringify(imported));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('repeat.count');
  });

  it('rejects graph edges that reference unknown modules', () => {
    const invalid = structuredClone(validImport);
    invalid.connections[0]!.target = 'missing';
    const result = parseModelImportJson(JSON.stringify(invalid));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('unknown module');
  });

  it('rejects unbounded symbolic dimensions and unknown keys never become executable code', () => {
    const invalid = structuredClone(validImport);
    invalid.modules[0]!.inputShape = ['../../secret'];
    const result = parseModelImportJson(JSON.stringify(invalid));
    expect(result.ok).toBe(false);
  });

  it('rejects unbounded graph coordinates before they reach React Flow', () => {
    const invalid = structuredClone(validImport);
    invalid.modules[0]!.stage = 1e308;
    invalid.modules[0]!.lane = 101;
    const result = parseModelImportJson(JSON.stringify(invalid));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('stage');
  });

  it('rejects duplicate connection ids', () => {
    const invalid = structuredClone(validImport);
    invalid.connections.push(structuredClone(invalid.connections[0]!));
    const result = parseModelImportJson(JSON.stringify(invalid));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('connection ids');
  });
});
