import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderFormulaResult } from './formula';
import { composeRepeatedBlocks, MODEL_GRAPH_POINTER_OPTIONS } from './model-graph';
import { modelFormulaConsistencyFindings } from './model-formula-consistency';
import type { ModelModule, ModelSpec } from './model-lab-schema';
import { repeatedModuleStepEntries } from './model-repeat-semantics';
import {
  parsePseudocodeStatement,
  pseudocodeStatementLatex,
  pseudocodeStepName,
} from './repeat-step-description';

// Shaped like a model a project chat added: free-form loop lines no exact step parser knows.
const loop = [
  'for l in range(8):',
  '    film = FiLM(code)                         # blocks.l.film',
  '    # latent cross attention',
  '    q = q_proj(norm_b(B)) * exp(log_temp)     # per-head K->K',
  '    B = B + gamma_B * mix_b(gate_n(softmax(...)) ...)',
  '    B = row_mixer(B, film);  C = feature_mixer(C, film)',
  '    if l in 0..6:',
  '        with autocast(bf16), flash_attention:',
  '            z = axial(ax_norm_b(B), ax_norm_c(C), A)',
  '        B = B + 1.0 * float32(z)',
  '    C_final = C',
].join('\n');

const block: ModelModule = {
  id: 'abcd-block',
  name: 'ABCD block',
  kind: 'merge',
  group: 'abcd-stack',
  stage: 0,
  lane: 0,
  inputShape: ['Q', 'h', 'N', 'K'],
  outputShape: ['Q', 'h', 'P', 'K'],
  transform: loop,
  activation: null,
  formula: 'B\\leftarrow B',
  explanation: 'Eight ABCD blocks.',
  parameterCount: 0,
  codeReference: 'RUN_CONTRACT.json',
  repeat: { count: 8, label: 'ABCD block x8' },
};
const model = {
  id: 'abcd',
  name: 'ABCD',
  version: '1',
  framework: 'PyTorch',
  sourceLabel: 'test',
  sourceArtifacts: [],
  summary: '',
  intent: { statement: '', invariants: [], expectedInput: ['N', 'P'], expectedOutput: ['Q', 'P'] },
  modules: [block],
  connections: [],
  gradientEvidence: null,
} as unknown as ModelSpec;

const steps = (language: 'ko' | 'en') =>
  composeRepeatedBlocks(model, language).blocks[0]!.detailModel.modules;

describe('loop steps without an exact operation parser', () => {
  it('shows each statement as its own equation instead of the not-derived placeholder', () => {
    const modules = steps('ko');
    expect(modules.map((module) => module.name)).toEqual([
      'Compute film via FiLM',
      'Compute q',
      'Residual update B',
      'Update B, C',
      'If l in 0..6',
      'With autocast(bf16), flash_attention',
      'Compute z via axial',
      'Residual update B',
      'Pass C as C_final',
    ]);
    expect(modules.map((module) => module.formula)).toEqual([
      String.raw`\mathrm{film}\leftarrow \operatorname{FiLM}(\mathrm{code})`,
      String.raw`q\leftarrow \operatorname{q\_proj}(\operatorname{norm\_b}(B))\cdot \exp(\mathrm{log\_temp})`,
      String.raw`B\leftarrow B+\gamma_{B}\cdot \operatorname{mix\_b}(\operatorname{gate\_n}(\operatorname{softmax}(\ldots))\,\ldots)`,
      String.raw`B\leftarrow \operatorname{row\_mixer}(B,\mathrm{film});\qquad C\leftarrow \operatorname{feature\_mixer}(C,\mathrm{film})`,
      String.raw`\textbf{if}\ l\in \{0,\ldots,6\}`,
      String.raw`\textbf{with}\ \operatorname{autocast}(\mathrm{bf16}),\ \mathrm{flash\_attention}`,
      String.raw`z\leftarrow \operatorname{axial}(\operatorname{ax\_norm\_b}(B),\operatorname{ax\_norm\_c}(C),A)`,
      String.raw`B\leftarrow B+1.0\,\operatorname{float32}(z)`,
      String.raw`C_{\mathrm{final}}\leftarrow C`,
    ]);
    expect(modules.every((module) => renderFormulaResult(module.formula).valid)).toBe(true);
    // The formula audit (Run checks) accepts them: two assignments stay two clauses.
    expect(
      modelFormulaConsistencyFindings(composeRepeatedBlocks(model).blocks[0]!.detailModel),
    ).toEqual([]);
  });

  it('explains what each step computes, reads and runs under, in the application language', () => {
    const [film, q, elided, pair, condition, context, z, afterWith, alias] = steps('ko');
    expect(q!.explanation.split('\n')).toEqual([
      'q 값을 계산합니다: norm_b(정규화) → q_proj(선형 투영) → exp(지수 함수).',
      '사용한 연산: 곱셈(×).',
      '읽는 값: B, log_temp.',
      'ABCD block x8 반복 1회 안의 2/9번째 단계이며, 이 반복은 8회 수행됩니다.',
      '작성자 메모: per-head K->K · latent cross attention.',
    ]);
    expect(film!.explanation).toContain('film 값을 계산합니다: FiLM(조건 주입).');
    expect(elided!.explanation).toContain('B에 새 항을 더해 잔차(residual) 방식으로 갱신합니다');
    expect(elided!.explanation).toContain(
      '원문에 ...로 생략된 부분이 있어 정확한 연산은 확인되지 않았습니다.',
    );
    expect(pair!.explanation).toContain('B, C 값을 차례로 갱신합니다: row_mixer(혼합)');
    expect(condition!.explanation).toContain(
      'l in 0..6 조건이 참일 때만 아래 들여쓴 단계들이 실행됩니다.',
    );
    expect(context!.explanation).toContain('실행 조건: if l in 0..6 블록 안에서만 실행됩니다.');
    expect(z!.explanation).toContain('실행 조건: if l in 0..6 블록 안에서만 실행됩니다.');
    expect(z!.explanation).toContain(
      '실행 환경: with autocast(bf16), flash_attention 안에서 실행됩니다.',
    );
    // Back at the `with` indentation: still under the `if`, no longer under the `with`.
    expect(afterWith!.explanation).toContain('실행 조건: if l in 0..6');
    expect(afterWith!.explanation).not.toContain('실행 환경');
    expect(alias!.explanation).toContain('C 값을 C_final(으)로 그대로 넘깁니다.');
    // The card summary is the first sentence.
    expect(q!.explanation.split('\n')[0]).not.toContain('Equation');

    const english = steps('en')[1]!.explanation.split('\n');
    expect(english[0]).toBe(
      'Computes q: norm_b (normalization) → q_proj (linear projection) → exp.',
    );
    expect(english).toContain('Pseudocode annotation: per-head K->K · latent cross attention.');
  });

  it('keeps the explicit fallback for text that is not code, and says so', () => {
    const prose: ModelModule = {
      ...block,
      transform: 'for each iteration: refine the estimate; custom opaque operator',
    };
    const [first] = composeRepeatedBlocks({ ...model, modules: [prose] }, 'ko').blocks[0]!
      .detailModel.modules;
    expect(first!.formula).toContain('Equation not deterministically derived from step 1');
    expect(first!.explanation.split('\n')[0]).toBe(
      '원문: refine the estimate (수식으로 해석하지 못한 문장이라 원문을 그대로 보여줍니다.)',
    );
  });
});

describe('literal statement transcription', () => {
  it('covers keyword arguments, slices, powers, tuples, augmented updates and pipes', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      [
        'a = softmax(x, dim=-1)',
        String.raw`a\leftarrow \operatorname{softmax}(x,\mathrm{dim}\coloneqq -1)`,
      ],
      ['H1 = H[:, :d]', String.raw`H_{1}\leftarrow H_{:,:d}`],
      [
        'y = x ** 2 / sqrt(abs(v) + eps)',
        String.raw`y\leftarrow {x}^{2}/\sqrt{\left|v\right|+\epsilon}`,
      ],
      ['u, m = out(h)', String.raw`(u,m)\leftarrow \operatorname{out}(h)`],
      [
        '[gamma_j, delta_j] = split(x, 2)',
        String.raw`(\gamma_{j},\delta_{j})\leftarrow \operatorname{split}(x,2)`,
      ],
      ['B += f(B)', String.raw`B\leftarrow B+\operatorname{f}(B)`],
      ['H -> Linear(1, 2d)', String.raw`H\rightarrow \operatorname{Linear}(1,2d)`],
      ['W = Linear(2d, 512)(H3)', String.raw`W\leftarrow \operatorname{Linear}(2d,512)(H_{3})`],
      [
        't = lambda * rho96 * 1e-6',
        String.raw`t\leftarrow \lambda\cdot \rho_{96}\cdot 1\times10^{-6}`,
      ],
      ['a = (b - c) - (d + e)', String.raw`a\leftarrow b-c-(d+e)`],
    ];
    cases.forEach(([code, expected]) => {
      expect(pseudocodeStatementLatex(code)).toBe(expected);
      expect(renderFormulaResult(expected).valid).toBe(true);
    });
  });

  it('refuses what it cannot read exactly', () => {
    [
      'refine the estimate',
      'x = y if c else z',
      's = "text"',
      '가중치 = 업데이트(B)',
      'x = (a',
    ].forEach((code) => {
      expect(parsePseudocodeStatement(code)).toBeNull();
      expect(pseudocodeStatementLatex(code)).toBeNull();
      expect(pseudocodeStepName(code)).toBeNull();
    });
  });

  it('tracks if/else/with headers by indentation', () => {
    const entries = repeatedModuleStepEntries({
      transform: [
        'for j in range(L):',
        '  if j == 0:',
        '    a = f(x)',
        '  else:',
        '    a = g(x)',
        '  b = h(a)',
      ].join('\n'),
    });
    expect(entries).toEqual([
      { statement: 'if j == 0:', context: [] },
      { statement: 'a = f(x)', context: ['if j == 0'] },
      { statement: 'else:', context: [] },
      { statement: 'a = g(x)', context: ['else'] },
      { statement: 'b = h(a)', context: [] },
    ]);
  });
});

describe('Model Lab graph pointer', () => {
  it('always pans on drag and never starts box selection, even with Shift', () => {
    expect(MODEL_GRAPH_POINTER_OPTIONS).toEqual({
      panOnDrag: true,
      selectionOnDrag: false,
      selectionKeyCode: null,
    });
    const source = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/<ReactFlow[\s\S]*?\{\.\.\.MODEL_GRAPH_POINTER_OPTIONS\}[\s\S]*?>/u);
  });

  it('keeps line breaks in a module explanation', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(styles).toMatch(/\.module-detail-notes p \{[^}]*white-space: pre-line;/u);
  });
});
