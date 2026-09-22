import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bottleneckAutoencoder } from './sample-models';
import {
  englishGraphName,
  compactGraphShape,
  isSymbolicDimension,
  generatedGraphPresentationError,
  graphCardSummary,
} from './graph-presentation';
it('uses English display identifiers without rewriting the saved model', () => {
  const model = { ...bottleneckAutoencoder, id: 'context-model-aabbccddeeff', name: '문맥 모델' };
  expect(englishGraphName(model.name, model.id)).toBe('Context Model');
  expect(model.name).toBe('문맥 모델');
  expect(englishGraphName('Attention Network', 'id')).toBe('Attention Network');
  expect(englishGraphName('모델', '모델')).toBe('Model');
});
it('flags unsafe old dimensions without inventing a replacement', () => {
  const shape = ['N+9000000000000000000', 32];
  expect(compactGraphShape(shape)).toEqual({ text: '? × 32', uncertain: true });
  expect(shape[0]).toContain('900000');
  expect(compactGraphShape(['N_ctx+N_test', 'K', 'H'])).toEqual({
    text: 'N_ctx+N_test × K × H',
    uncertain: false,
  });
});
it.each(['N_ctx+N_test', 'K*H', '(N+M)/K', '2K', "D'", 'N + 12'])(
  'accepts bounded mathematical shape %s',
  (expression) => expect(isSymbolicDimension(expression)).toBe(true),
);
it.each(['f(x)', 'N[0]', 'N;alert(1)', 'N++M', '(N+M', 'N+', 'N'.repeat(65)])(
  'rejects code or malformed shape %s',
  (expression) => expect(isSymbolicDimension(expression)).toBe(false),
);
it('enforces English generated names and rejects invented unsafe axes separately from legacy reads', () => {
  expect(generatedGraphPresentationError({ ...bottleneckAutoencoder, name: '새 모델' })).toContain(
    'English',
  );
  expect(
    generatedGraphPresentationError({
      ...bottleneckAutoencoder,
      modules: bottleneckAutoencoder.modules.map((m) => ({
        ...m,
        inputShape: ['N+9000000000000000000'],
      })),
    }),
  ).toContain('numeric dimension');
});
it('summarizes purpose and keeps full math in the existing detail panel, with forward flow by default', () => {
  const module = {
    ...bottleneckAutoencoder.modules[0]!,
    explanation: 'First meaningful sentence. Long details follow.',
  };
  expect(graphCardSummary(module)).toBe('First meaningful sentence.');
  const card = readFileSync(new URL('./module-node.tsx', import.meta.url), 'utf8');
  expect(card).not.toContain('title={module.formula}');
  expect(card).toContain('<Formula');
  expect(card).toContain('module-node__key-equation');
  const app = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
  expect(app).toContain("useState<'forward' | 'backward'>('forward')");
  expect(app).toContain('<Formula latex={module.formula}');
});
