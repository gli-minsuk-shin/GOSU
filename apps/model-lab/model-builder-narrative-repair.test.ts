import { describe, expect, it } from 'vitest';
import {
  applyModelBuilderNarrativeRepair,
  MODEL_BUILDER_NARRATIVE_REPAIR_SCHEMA,
  planModelBuilderNarrativeRepair,
} from './model-builder-narrative-repair';

const candidate = {
  id: 'mochi_yuzu',
  modules: [
    {
      id: 'newton_blend',
      transform: 'h = concat(a, b)',
      formula: 'h=a+b',
      explanation: 'Blend state.',
      activation: null,
      inputShape: ['P', 32],
      outputShape: ['P', 64],
      composite: { id: 'round', label: 'Newton round', repeatCount: 4 },
    },
    {
      id: 'newton_system',
      transform: 'gate = sigmoid(z)',
      formula: 'g=z',
      explanation: 'Compute system gate.',
      activation: 'sigmoid',
      inputShape: ['P', 64],
      outputShape: ['P', 64],
    },
    {
      id: 'output',
      transform: 'return h',
      formula: 'y=h',
      explanation: 'Return result.',
      activation: null,
    },
  ],
  connections: [
    {
      id: 'c1',
      source: 'newton_blend',
      target: 'newton_system',
      sourcePort: 'h',
      targetPort: 'h',
      shape: ['P', 64],
    },
  ],
  sourceArtifacts: [{ path: 'mochi_model.py', verified: true }],
};
const reason =
  'Builder audit failed: Semantic architecture quality failed: Newton blend [newton_blend] declares concat in its transform but omits it from the formula. || Formula consistency failed: MOCHI@v1 [mochi_yuzu] — Newton system — newton_system: sigmoid is declared in text but absent from the equation.';
const patches = [
  {
    moduleId: 'newton_blend',
    formula: 'h=\\operatorname{concat}(a,b)',
    explanation: 'Concatenate the two states.',
    activation: null,
  },
  {
    moduleId: 'newton_system',
    formula: 'g=\\sigma(z)',
    explanation: 'Apply sigmoid to obtain the gate.',
    activation: 'sigmoid',
  },
];

describe('targeted Model Builder narrative repair', () => {
  it('plans both actual concat and sigmoid findings by exact module ID', () => {
    const plan = planModelBuilderNarrativeRepair(JSON.stringify(candidate), reason);
    expect(plan?.moduleIds).toEqual(['newton_blend', 'newton_system']);
    expect(plan?.modules.map((module) => module.id)).toEqual(['newton_blend', 'newton_system']);
    expect(MODEL_BUILDER_NARRATIVE_REPAIR_SCHEMA.additionalProperties).toBe(false);
    expect(MODEL_BUILDER_NARRATIVE_REPAIR_SCHEMA.properties.patches.items.required).toEqual([
      'moduleId',
      'formula',
      'explanation',
      'activation',
    ]);
  });

  it('changes only requested narrative fields and preserves all architecture and other modules', () => {
    const originalJson = JSON.stringify(candidate);
    const plan = planModelBuilderNarrativeRepair(originalJson, reason)!;
    const result = JSON.parse(applyModelBuilderNarrativeRepair(plan, JSON.stringify({ patches })));
    expect(result).toEqual({
      ...candidate,
      modules: candidate.modules.map((module, index) =>
        index < 2
          ? {
              ...module,
              formula: patches[index]!.formula,
              explanation: patches[index]!.explanation,
              activation: patches[index]!.activation,
            }
          : module,
      ),
    });
    expect(JSON.stringify(plan.candidate)).toBe(originalJson);
    expect(result.connections).toEqual(candidate.connections);
    expect(result.modules[0].transform).toBe(candidate.modules[0]!.transform);
    expect(result.modules[0].composite).toEqual(candidate.modules[0]!.composite);
  });

  it.each([
    'Graph structure failed: Missing sourcePort.',
    'Source-output contract failed: source output missing.',
    'Source provenance failed: unknown artifact.',
    'Semantic architecture quality failed: Composite block “round” has inconsistent label or repeatCount metadata.',
    'Semantic architecture quality failed: 10 connected one-line atomic modules form an unbranched same-shape path.',
    'Formula consistency failed: Newton system — newton_system: computed named value unused is neither consumed nor exported.',
    'Semantic architecture quality failed: Newton blend [newton_blend] has mismatched loop ownership.',
  ])('does not apply a narrative shortcut when any non-narrative finding exists: %s', (extra) => {
    expect(
      planModelBuilderNarrativeRepair(JSON.stringify(candidate), `${reason} || ${extra}`),
    ).toBeNull();
  });

  it('rejects unknown targets, ambiguous candidate IDs, and more than six targeted modules', () => {
    expect(
      planModelBuilderNarrativeRepair(
        JSON.stringify(candidate),
        reason.replace(/newton_blend/g, 'newton_blend_typo'),
      ),
    ).toBeNull();
    expect(
      planModelBuilderNarrativeRepair(
        JSON.stringify({ ...candidate, modules: [...candidate.modules, candidate.modules[0]] }),
        reason,
      ),
    ).toBeNull();
    const many = Array.from({ length: 7 }, (_, index) => ({ id: `m${index}`, formula: 'h=z' }));
    expect(
      planModelBuilderNarrativeRepair(
        JSON.stringify({ modules: many }),
        `Formula consistency failed: ${many.map((module) => `Node — ${module.id}: sigmoid is declared in text but absent from the equation.`).join(' | ')}`,
      ),
    ).toBeNull();
  });

  it.each([
    { patches: [patches[0]] },
    { patches: [patches[0], patches[0]] },
    { patches: [patches[0], { ...patches[1], moduleId: 'output' }] },
    { patches: [patches[0], { ...patches[1], transform: 'replace architecture' }] },
    { patches: [patches[0], { ...patches[1], formula: null }] },
    {
      patches: [
        patches[0],
        { moduleId: 'newton_system', formula: 'g=sigmoid(z)', explanation: 'Gate' },
      ],
    },
    { patches: [patches[0], { ...patches[1], formula: '' }] },
    { patches, candidate: {} },
  ])('rejects malformed, incomplete, duplicated or unauthorized patch fields: %j', (response) => {
    const plan = planModelBuilderNarrativeRepair(JSON.stringify(candidate), reason)!;
    expect(() => applyModelBuilderNarrativeRepair(plan, JSON.stringify(response))).toThrow(
      'model_builder_narrative_repair_invalid',
    );
  });

  it.each([
    ['moduleId', 120],
    ['formula', 2_000],
    ['explanation', 2_000],
    ['activation', 160],
  ] as const)('matches the ModelIR parser %s length boundary of %i', (field, maximum) => {
    const value = 'x'.repeat(maximum);
    const source = structuredClone(candidate);
    let auditReason = reason;
    if (field === 'moduleId') {
      source.modules[0]!.id = value;
      source.connections[0]!.source = value;
      auditReason = reason.replaceAll('newton_blend', value);
    }
    const plan = planModelBuilderNarrativeRepair(JSON.stringify(source), auditReason)!;
    expect(plan).not.toBeNull();
    const update = { patches: [{ ...patches[0], [field]: value }, patches[1]] };
    expect(() => applyModelBuilderNarrativeRepair(plan, JSON.stringify(update))).not.toThrow();
    const tooLong = { patches: [{ ...patches[0], [field]: `${value}x` }, patches[1]] };
    expect(() => applyModelBuilderNarrativeRepair(plan, JSON.stringify(tooLong))).toThrow(
      'model_builder_narrative_repair_invalid',
    );
    const properties = MODEL_BUILDER_NARRATIVE_REPAIR_SCHEMA.properties.patches.items.properties;
    expect(properties[field].maxLength).toBe(maximum);
    expect(properties[field].minLength).toBe(1);
    if (field === 'moduleId') {
      source.modules[0]!.id = `${value}x`;
      expect(
        planModelBuilderNarrativeRepair(
          JSON.stringify(source),
          auditReason.replaceAll(value, `${value}x`),
        ),
      ).toBeNull();
    }
  });

  it('rejects a blank string activation but accepts null as the no-activation value', () => {
    const plan = planModelBuilderNarrativeRepair(JSON.stringify(candidate), reason)!;
    expect(() =>
      applyModelBuilderNarrativeRepair(
        plan,
        JSON.stringify({ patches: [{ ...patches[0], activation: ' ' }, patches[1]] }),
      ),
    ).toThrow('model_builder_narrative_repair_invalid');
    expect(() => applyModelBuilderNarrativeRepair(plan, JSON.stringify({ patches }))).not.toThrow();
  });
});
