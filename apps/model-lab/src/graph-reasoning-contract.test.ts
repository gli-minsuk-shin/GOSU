import { expect, it } from 'vitest';
import { parseModelImportJson } from './model-lab-import';
import { bottleneckAutoencoder } from './sample-models';
import {
  modelToPseudocode,
  parseModelPseudocode,
  initialModelPseudocodeWorkspace,
  serializeModelPseudocodeWorkspace,
  restoreModelPseudocodeWorkspace,
} from './model-pseudocode';
import { MODEL_GRAPH_REASONING_POLICY, graphCardSummary } from './graph-presentation';
import {
  buildModelCopilotInstructions,
  buildModelPseudocodeNormalizerPrompt,
  MODEL_IR_OUTPUT_SCHEMA,
  buildModelBuilderPrompt,
} from '../model-copilot-server';
const first = bottleneckAutoencoder.modules[0]!;
const presentation = {
  purpose: 'Preserve the input features.',
  keyEquation: first.formula,
  shapeNotes: 'B rows, 128 features; no coordinates are changed.',
  uncertainties: ['Runtime execution is not observed.'],
};
const model = (p: unknown) => ({
  ...bottleneckAutoencoder,
  modules: bottleneckAutoencoder.modules.map((m, i) => (i === 0 ? { ...m, presentation: p } : m)),
});
it('resolves an equation index from canonical math and preserves it across pseudocode/restart', () => {
  const { keyEquation: _unused, ...rest } = presentation;
  const parsed = parseModelImportJson(JSON.stringify(model({ ...rest, keyEquationIndex: 0 })));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.model.modules[0]?.presentation?.keyEquation).toBe(first.formula);
  const source = modelToPseudocode(parsed.model);
  const restored = parseModelPseudocode(source, parsed.model.id);
  expect(restored.ok).toBe(true);
  if (restored.ok) expect(restored.model.modules[0]?.presentation).toEqual(presentation);
  const workspace = initialModelPseudocodeWorkspace([parsed.model]);
  expect(
    restoreModelPseudocodeWorkspace(serializeModelPseudocodeWorkspace(workspace), []).models[0]
      ?.modules[0]?.presentation,
  ).toEqual(presentation);
  expect(parseModelImportJson(JSON.stringify(model({ ...rest, keyEquationIndex: 32 }))).ok).toBe(
    false,
  );
});
it('round-trips purpose, grounded equation, tensor notes and explicit uncertainty without changing shapes', () => {
  const result = parseModelImportJson(JSON.stringify(model(presentation)));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.model.modules[0]?.presentation).toEqual(presentation);
    expect(result.model.modules[0]?.inputShape).toEqual(first.inputShape);
    expect(graphCardSummary(result.model.modules[0]!)).toBe(presentation.purpose);
  }
});
it.each([
  { ...presentation, keyEquation: 'H=2Z+F' },
  { ...presentation, keyEquation: 'x' },
  { ...presentation, purpose: '' },
  { ...presentation, uncertainties: Array(5).fill('Unknown') },
  { ...presentation, shapeNotes: 'x'.repeat(601) },
])('rejects ungrounded or malformed card reasoning', (p) => {
  expect(parseModelImportJson(JSON.stringify(model(p))).ok).toBe(false);
});
it('reads old models without inventing a narrative or repairing dimensions', () => {
  const result = parseModelImportJson(JSON.stringify(bottleneckAutoencoder));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.model.modules[0]).not.toHaveProperty('presentation');
});
it('rejects hiding an explicitly unresolved operator behind an empty warning list', () => {
  const value = model({ ...presentation, keyEquation: 'h_0=F_{unresolved}(x)', uncertainties: [] });
  value.modules[0] = { ...value.modules[0]!, formula: 'h_0=F_{unresolved}(x)' };
  const parsed = parseModelImportJson(JSON.stringify(value));
  expect(parsed.ok).toBe(false);
  if (!parsed.ok) expect(parsed.reason).toContain('uncertainty explanation');
});
it('shares tensor-ledger and uncertainty policy between copilot and regeneration with required structured output', () => {
  expect(buildModelCopilotInstructions({})).toContain(MODEL_GRAPH_REASONING_POLICY);
  expect(
    buildModelBuilderPrompt([{ name: 'model.txt', kind: 'text', content: 'H in R^(N x F x h)' }]),
  ).toContain(MODEL_GRAPH_REASONING_POLICY);
  expect(buildModelPseudocodeNormalizerPrompt(bottleneckAutoencoder, 'edit')).toContain(
    MODEL_GRAPH_REASONING_POLICY,
  );
  const schema = MODEL_IR_OUTPUT_SCHEMA.properties.modules.items;
  expect(schema.required).toContain('presentation');
  expect(schema.properties.presentation.required).toEqual([
    'purpose',
    'keyEquationIndex',
    'shapeNotes',
    'uncertainties',
  ]);
  for (const topic of [
    'inner dimensions',
    'Softmax axes',
    'residual operands',
    'runtime observation',
    'do not silently transpose',
  ])
    expect(MODEL_GRAPH_REASONING_POLICY).toContain(topic);
});
