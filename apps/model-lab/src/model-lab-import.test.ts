import { describe, expect, it } from 'vitest';
import { moduleGradientHealth, runAgentReview } from './model-lab-domain';
import { parseModelImportJson } from './model-lab-import';

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
