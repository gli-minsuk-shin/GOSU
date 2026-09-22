import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { composeRepeatedBlocks } from './model-graph';
import { ModuleDetailDialog } from './model-lab-app';
import type { ModelModule, ModelSpec } from './model-lab-schema';
import { MAX_MODULE_READING_STEPS, moduleReading } from './module-explanation-text';

const module = (id: string, overrides: Partial<ModelModule> = {}): ModelModule => ({
  id,
  name: id,
  kind: 'linear',
  group: id,
  stage: 0,
  lane: 0,
  inputShape: ['B', 'N', 'K'],
  outputShape: ['B', 'N', 'K'],
  transform: `${id} = f(x)`,
  activation: null,
  formula: 'y=x',
  explanation: `${id} = f(x)`,
  parameterCount: 0,
  codeReference: '',
  ...overrides,
});

const model = (modules: ModelModule[], connections: [string, string, string][] = []) =>
  ({
    id: 'm',
    name: 'M',
    version: '1',
    framework: 'PyTorch',
    sourceLabel: 'test',
    sourceArtifacts: [],
    summary: '',
    intent: { statement: '', invariants: [], expectedInput: ['N'], expectedOutput: ['N'] },
    modules,
    connections: connections.map(([source, target, tensorName], index) => ({
      id: `e${index}`,
      source,
      target,
      tensorName,
      shape: ['N'],
      activationNorm: 0,
      gradient: {
        checkpoints: [1],
        healthy: [0],
        vanishing: [0],
        detached: [0],
        exploding: [0],
        states: {
          healthy: ['not-observed'],
          vanishing: ['not-observed'],
          detached: ['not-observed'],
          exploding: ['not-observed'],
        },
      },
      expectedToCarryGradient: true,
    })),
    gradientEvidence: null,
  }) as unknown as ModelSpec;

const latentInit = module('latent-init', {
  name: 'Latent Init',
  group: 'Embedding',
  transform: [
    'B0 = label_embed(y)                      # Linear 1->K',
    'C0 = feature_embed(feature_descriptor)   # descriptor unknown',
    'for l in range(2):',
    '    B0 = B0 + mix(C0)',
    '    if l == 0:',
    '        C0 = norm(C0)',
  ].join('\n'),
  explanation: 'B0 = label_embed(y)\nC0 = feature_embed(feature_descriptor)',
  activation: 'GELU',
  parameterCount: 1536,
  codeReference: 'model3.py:40-72',
  inputPorts: [{ name: 'y', shape: ['B', 'N'], binding: 'external' }],
  outputPorts: [{ name: 'B0', shape: ['B', 'N', 'K'], binding: 'loop-carried' }],
  presentation: {
    purpose: 'Initial latents',
    keyEquationIndex: 0,
    shapeNotes: 'K is the latent width.',
    uncertainties: ['feature_descriptor is not defined in the source.'],
  } as unknown as NonNullable<ModelModule['presentation']>,
});
const graph = model(
  [module('data-input', { name: 'Data Input', kind: 'input' }), latentInit, module('core')],
  [
    ['data-input', 'latent-init', 'y'],
    ['latent-init', 'core', 'B0'],
  ],
);

describe('module reading without AI', () => {
  it('explains a module whose pseudocode has no notes: kind, order of computation, shapes and wiring', () => {
    const reading = moduleReading(graph, latentInit, null, 'ko');
    // The stored "explanation" only repeats part of the source, so it is not shown as notes…
    const bare = moduleReading(
      graph,
      { ...latentInit, explanation: latentInit.transform },
      null,
      'ko',
    );
    expect(bare.authored).toBeNull();
    // …yet the module is still explained.
    expect(bare.overview[0]).toBe(
      'Latent Init: 선형 변환 모듈 — 학습되는 가중치로 값을 다른 표현 공간으로 옮깁니다.',
    );
    expect(bare.overview).toContain('그래프에서는 "Embedding" 묶음에 속합니다.');
    expect(bare.overview).toContain('입력 차원 [B, N, K] → 출력 차원 [B, N, K].');
    expect(bare.overview).toContain('입력 포트: y [B, N] (외부 입력).');
    expect(bare.overview).toContain('출력 포트: B0 [B, N, K] (반복 사이에 전달).');
    // Every statement is read in order, with nesting and the author's comment kept.
    expect(reading.steps.map((step) => [step.depth, step.code])).toEqual([
      [0, 'B0 = label_embed(y)'],
      [0, 'C0 = feature_embed(feature_descriptor)'],
      [0, 'for l in range(2):'],
      [1, 'B0 = B0 + mix(C0)'],
      [1, 'if l == 0:'],
      [2, 'C0 = norm(C0)'],
    ]);
    expect(reading.steps[0]!.text).toContain('B0 값을 계산합니다');
    expect(reading.steps[0]!.text).toContain('작성자 메모: Linear 1->K.');
    expect(reading.steps[2]!.text).toContain('range(2)을(를) 도는 동안');
    expect(reading.steps[3]!.text).toContain('잔차(residual)');
    expect(reading.steps[4]!.text).toContain('조건이 참일 때만');
    expect(reading.wiring).toEqual([
      '활성화 함수: GELU.',
      '학습 파라미터: 1,536개.',
      '받는 값: y ← Data Input.',
      '내보내는 값: B0 → core.',
      '차원 메모: K is the latent width.',
      '확인되지 않은 점: feature_descriptor is not defined in the source.',
      '근거 코드 위치: model3.py:40-72.',
    ]);
    expect(reading.caveat).toContain('검증이 아니며');
    // Real notes are kept as the author wrote them, above the reading.
    expect(reading.authored).toBe(latentInit.explanation);
    const english = moduleReading(graph, latentInit, null, 'en');
    expect(english.overview[0]).toBe(
      'Latent Init: a linear transform module that moves values into another representation with learned weights.',
    );
    expect(english.steps[2]!.text).toBe(
      'Loop: repeats the indented lines below for l in range(2).',
    );
  });

  it('bounds a long source and reads a loop step from its own generated description', () => {
    const long = module('long', {
      transform: Array.from({ length: 20 }, (_value, index) => `h${index} = f(h)`).join('\n'),
    });
    const reading = moduleReading(model([long]), long, null, 'en');
    expect(reading.steps).toHaveLength(MAX_MODULE_READING_STEPS);
    expect(reading.omittedSteps).toBe(8);
    // An unreadable statement stays as written instead of being guessed.
    const odd = module('odd', { transform: '??? ->> !!!' });
    expect(moduleReading(model([odd]), odd, null, 'ko').steps[0]!.text).toBe(
      '규칙으로 풀어 읽지 못한 문장이라 원문 그대로 둡니다.',
    );
    const topLevel = model([
      module('abcd', {
        name: 'ABCD block',
        transform: ['for l in range(8):', '    q = q_proj(B)', '    B = B + mix(q)'].join('\n'),
        repeat: { count: 8, label: 'ABCD block x8' },
      }),
    ]);
    expect(moduleReading(topLevel, topLevel.modules[0]!, null, 'ko').overview).toContain(
      '같은 구조를 8회 반복합니다 (ABCD block x8). 그래프에서 이 블록을 열면 반복 1회 안의 단계를 하나씩 볼 수 있습니다.',
    );
    const loopGraph = composeRepeatedBlocks(topLevel, 'ko').blocks[0]!.detailModel;
    const step = loopGraph.modules[0]!;
    const stepReading = moduleReading(loopGraph, step, topLevel.modules[0]!, 'ko');
    expect(stepReading.authored).toBeNull();
    expect(stepReading.steps).toEqual([]);
    expect(stepReading.overview[0]).toContain('q 값을 계산합니다');
    expect(stepReading.overview.some((line) => line.includes('번째 단계'))).toBe(true);
    expect(stepReading.overview.at(-1)).toMatch(/^입력 차원 \[.*\] → 출력 차원 \[.*\]\.$/u);
  });

  it('shows the reading in the module detail even when no AI explanation exists', () => {
    const markup = renderToStaticMarkup(
      createElement(ModuleDetailDialog, {
        model: graph,
        module: { ...latentInit, explanation: latentInit.transform },
        probe: 'healthy',
        checkpointIndex: 0,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain('At a glance');
    expect(markup).toContain('Computation order');
    expect(markup).toContain('Wiring and evidence');
    expect(markup).toContain('<code>for l in range(2):</code>');
    expect(markup).toContain('Computes B0');
    expect(markup).not.toContain('Author notes');
    // The dialog is still described by the explanation block.
    expect(markup).toContain('aria-describedby="module-detail-notes"');
    expect(markup).toContain('id="module-detail-notes"');
  });
});
