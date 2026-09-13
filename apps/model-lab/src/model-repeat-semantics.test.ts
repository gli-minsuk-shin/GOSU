import { describe, expect, it } from 'vitest';
import {
  modelSemanticArchitectureFindings,
  repeatedModuleStepStatements,
} from './model-repeat-semantics';
import { residualClassifier } from './sample-models';

const complexRepeatTransform = [
  'for j in range(1, L):',
  '  H = Linear(2K, 2K)(H)',
  '  A, F = split(H)',
  '  B = soft_threshold(A, tau)',
  '  G = X.T @ (y - X @ B) / N',
  '  R = RMSNorm(G / lambda)',
  '  Z = concat(R, F)',
  '  C = MLP(Z)',
  '  H = H + C',
].join('\n');

describe('Model repeat semantic harness', () => {
  it('rejects a complex repeated body that would collapse into atomic UI cards', () => {
    const repeated = {
      ...residualClassifier.modules[1]!,
      id: 'complex-repeat',
      name: 'Iterative refinement',
      transform: complexRepeatTransform,
      formula: String.raw`H_j=\mathcal B(H_{j-1})`,
      repeat: { count: 'L-1', label: 'refinement iterations' },
    };
    const model = { ...residualClassifier, modules: [repeated], connections: [] };

    expect(repeatedModuleStepStatements(repeated)).toHaveLength(8);
    expect(modelSemanticArchitectureFindings(model)).toEqual(
      expect.arrayContaining([expect.stringContaining('no inspectable semantic composite block')]),
    );
  });

  it('allows a homogeneous compact repeat and an explicit connected semantic composite', () => {
    const homogeneous = {
      ...residualClassifier.modules[1]!,
      transform: Array.from(
        { length: 8 },
        (_value, index) => `H = Linear(d, d)(H) # ${index}`,
      ).join('\n'),
      repeat: { count: 8, label: 'shared linear refinement' },
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [homogeneous],
        connections: [],
      }),
    ).toEqual([]);

    const domainSpecific = {
      ...homogeneous,
      transform: Array.from(
        { length: 8 },
        (_value, index) => `s${index + 1} = domain_step_${index + 1}(s${index})`,
      ).join('\n'),
      formula: String.raw`s_8=\mathcal D(s_0)`,
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [domainSpecific],
        connections: [],
      }).some((finding) => finding.includes('no inspectable semantic composite block')),
    ).toBe(true);

    const homogeneousDomainSpecific = {
      ...domainSpecific,
      transform: Array.from(
        { length: 8 },
        (_value, index) => `s${index + 1} = domain_step(s${index})`,
      ).join('\n'),
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [homogeneousDomainSpecific],
        connections: [],
      }).some((finding) => finding.includes('no inspectable semantic composite block')),
    ).toBe(false);

    const edge = residualClassifier.connections[0]!;
    const source = residualClassifier.modules.find((module) => module.id === edge.source)!;
    const target = residualClassifier.modules.find((module) => module.id === edge.target)!;
    const block = { id: 'semantic-repeat', label: 'Semantic refinement', repeatCount: 'L-1' };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [
          { ...source, block },
          { ...target, block },
        ],
        connections: [edge],
      }),
    ).toEqual([]);

    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [{ ...source, repeat: { count: 3, label: 'ambiguous' }, block }],
        connections: [],
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('both repeat and shared block')]));

    const orphanLoopPort = {
      ...source,
      inputPorts: [
        {
          name: 'state',
          shape: source.inputShape,
          binding: 'loop-carried' as const,
          bindingId: 'orphan-loop',
        },
      ],
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [orphanLoopPort],
        connections: [],
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('without repeat or shared block')]));
  });

  it('rejects generic module dumps and executable transforms with placeholder formulas', () => {
    const genericModules = Array.from({ length: 4 }, (_value, index) => ({
      ...residualClassifier.modules[1]!,
      id: `generic-${index}`,
      name: `Custom operation · step ${index + 1}`,
      stage: index,
      transform: 'H = Linear(d, d)(H)',
      formula: 'Equation not deterministically derived',
    }));
    const findings = modelSemanticArchitectureFindings({
      ...residualClassifier,
      modules: genericModules,
      connections: [],
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('generic step/layer names'),
        expect.stringContaining('placeholder formula'),
      ]),
    );

    for (const transform of ['h = MLP(x)', 'h = Conv2d(x)', 'h = Attention(q, k, v)']) {
      const projectionMismatch = {
        ...residualClassifier.modules[1]!,
        id: `projection-${transform.split(' ')[2]}`,
        name: 'Projection block',
        transform,
        formula: 'h=x',
        explanation: 'Computes the projection.',
      };
      expect(
        modelSemanticArchitectureFindings({
          ...residualClassifier,
          modules: [projectionMismatch],
          connections: [],
        }).some((finding) => finding.includes('omits it from the formula')),
      ).toBe(true);
    }

    const sourceExactProjectionFormulas = [
      ['h = MLP(x)', String.raw`h=B\phi(Ax+a)+b`],
      ['y = Conv2d(x)', String.raw`y_{i,j}=\sum_{u,v}K_{u,v}x_{i-u,j-v}`],
      ['h = Embedding(x)', String.raw`h_i=e_{x_i}`],
      ['h = Attention(q, k, v)', String.raw`h=\operatorname{softmax}(QK^\top)V`],
      ['y = Linear(d, d)(x)', String.raw`y=\Phi x+b`],
    ] as const;
    for (const [transform, formula] of sourceExactProjectionFormulas) {
      const sourceExact = {
        ...residualClassifier.modules[1]!,
        id: `source-exact-${transform.split(' ')[2]}`,
        name: 'Source-exact projection',
        transform,
        formula,
        explanation: 'Computes the source-defined projection.',
      };
      expect(
        modelSemanticArchitectureFindings({
          ...residualClassifier,
          modules: [sourceExact],
          connections: [],
        }).some((finding) => finding.includes('omits it from the formula')),
      ).toBe(false);
    }

    const affine = {
      ...residualClassifier.modules[1]!,
      transform: 'h = Linear(64, 32)(x)',
      formula: 'h=A x+b',
      explanation: 'Projects the input features.',
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [affine],
        connections: [],
      }).some((finding) => finding.includes('omits linear')),
    ).toBe(false);

    const narrativeMismatch = {
      ...residualClassifier.modules[1]!,
      id: 'narrative-mismatch',
      name: 'Threshold block',
      transform: 'B = soft_threshold(A, exp(F))',
      formula: 'B=A',
      explanation: 'Applies sigmoid gating.',
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [narrativeMismatch],
        connections: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('omits it from the formula'),
        expect.stringContaining('explanation claims sigmoid'),
      ]),
    );

    const shapeExplanation = {
      ...residualClassifier.modules[1]!,
      explanation: 'Maps output shape [B, N] to [B, K].',
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [shapeExplanation],
        connections: [],
      }).some((finding) => finding.includes('explanation claims concat')),
    ).toBe(false);
    const discrepancyExplanation = {
      ...shapeExplanation,
      explanation: 'Design note mentions sigmoid, but executable Python does not apply sigmoid.',
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [discrepancyExplanation],
        connections: [],
      }).some((finding) => finding.includes('explanation claims sigmoid')),
    ).toBe(false);
    const solverVocabulary = {
      ...shapeExplanation,
      transform: 'z = PCG(A, b)',
      formula: String.raw`z=A^{-1}b`,
      explanation:
        'Solves the linear system and reuses an exponentially parameterized cache from an earlier stage.',
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [solverVocabulary],
        connections: [],
      }).some(
        (finding) =>
          finding.includes('explanation claims linear') ||
          finding.includes('explanation claims exp'),
      ),
    ).toBe(false);

    for (const formula of [
      'No equation available',
      'Equation unavailable',
      'Unable to derive equation',
      'Source does not provide an equation',
      'Equation could not be derived from source',
      'No closed-form expression is given',
      'Mathematical form is unspecified',
      'Source lacks a formula',
    ]) {
      const unavailable = {
        ...residualClassifier.modules[1]!,
        id: `unavailable-${formula.length}`,
        transform: 'h = spectral_transform(x)',
        formula,
      };
      expect(
        modelSemanticArchitectureFindings({
          ...residualClassifier,
          modules: [unavailable],
          connections: [],
        }).some((finding) => finding.includes('placeholder formula')),
      ).toBe(true);
    }
    for (const formula of [
      String.raw`x\mapsto f(x)`,
      String.raw`p(y\mid x)\propto e^{z_y}`,
      String.raw`a\approx b`,
    ]) {
      const relational = {
        ...residualClassifier.modules[1]!,
        id: `relation-${formula.length}`,
        transform: 'h = custom_operator(x)',
        formula,
      };
      expect(
        modelSemanticArchitectureFindings({
          ...residualClassifier,
          modules: [relational],
          connections: [],
        }).some((finding) => finding.includes('no mathematical relation')),
      ).toBe(false);
    }

    const giantModule = {
      ...residualClassifier.modules[1]!,
      id: 'giant-module',
      name: 'Giant refinement',
      transform: `${complexRepeatTransform.replace('for j in range(1, L):\n', '')}\nH4 = Linear(H3)\nH5 = GELU(H4)\nH6 = RMSNorm(H5)\nH7 = H + H6\nH8 = Linear(H7)`,
      formula: String.raw`H=\operatorname{RMSNorm}(H+C)`,
    };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: [giantModule],
        connections: [],
      }).some((finding) => finding.includes('packs 13 mixed executable statements')),
    ).toBe(true);
  });

  it('rejects a long connected top-level chain of one-line atomic operators', () => {
    const base = residualClassifier.modules[1]!;
    const modules = Array.from({ length: 5 }, (_value, index) => ({
      ...base,
      id: `atomic-${index + 1}`,
      name: `Feature projection ${index + 1}`,
      group: 'Atomic trunk',
      stage: index,
      inputShape: ['B', 'd'],
      outputShape: ['B', 'd'],
      transform: `H${index + 1} = Linear(d, d)(H${index})`,
      formula: String.raw`H_{${index + 1}}=\operatorname{Linear}(H_{${index}})`,
    }));
    const edge = residualClassifier.connections[0]!;
    const connections = modules.slice(1).map((target, index) => ({
      ...edge,
      id: `atomic-edge-${index + 1}`,
      source: modules[index]!.id,
      target: target.id,
    }));

    expect(
      modelSemanticArchitectureFindings({ ...residualClassifier, modules, connections }),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('connected one-line atomic modules')]),
    );
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: modules.slice(0, 4),
        connections: connections.slice(0, 3),
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('unbranched same-shape path')]));
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: modules.slice(0, 3),
        connections: connections.slice(0, 2),
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('unbranched same-shape path')]));

    const renamedModules = modules.map((module, index) => ({
      ...module,
      name: [
        'Feature mixer',
        'Channel calibrator',
        'Latent adapter',
        'State refiner',
        'Output tuner',
      ][index]!,
    }));
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: renamedModules,
        connections,
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('unbranched same-shape path')]));

    const block = { id: 'atomic-block', label: 'Atomic dump', repeatCount: 5 };
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: modules.map((module) => ({ ...module, block })),
        connections,
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('unbranched same-shape path')]));

    const shapeChangingModules = modules.map((module, index) => ({
      ...module,
      inputShape: ['B', index + 1],
      outputShape: ['B', index + 2],
    }));
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: shapeChangingModules,
        connections,
      }).some((finding) => finding.includes('unbranched same-shape path')),
    ).toBe(false);

    const domainStages = modules.slice(0, 3).map((module, index) => ({
      ...module,
      name: ['Denoise stage', 'Alignment stage', 'Calibration stage'][index]!,
      transform: `s${index + 1} = ${['denoise', 'align', 'calibrate'][index]}(s${index})`,
      formula: String.raw`s_{${index + 1}}=\operatorname{${
        ['Denoise', 'Align', 'Calibrate'][index]!
      }}(s_{${index}})`,
    }));
    expect(
      modelSemanticArchitectureFindings({
        ...residualClassifier,
        modules: domainStages,
        connections: connections.slice(0, 2),
      }).some((finding) => finding.includes('unbranched same-shape path')),
    ).toBe(false);
  });
});
