import { describe, expect, it } from 'vitest';

import { resolveDefaultAiSelection } from '../src/renderer/src/default-ai-selection';
import { DEFAULT_AI_SELECTION } from '../src/renderer/src/user-preferences';

const models = [
  {
    modelId: 'provider-default',
    isDefault: true,
    reasoningOptions: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
  },
  {
    modelId: 'explicit-model',
    isDefault: false,
    reasoningOptions: [{ id: 'medium' }, { id: 'high' }],
  },
] as const;

describe('default AI selection', () => {
  it('uses Auto with high reasoning by default when the provider supports it', () => {
    expect(resolveDefaultAiSelection(DEFAULT_AI_SELECTION, models)).toEqual({
      effectiveModelId: 'provider-default',
      issue: null,
    });
  });

  it('preserves opaque explicit model and reasoning IDs without guessing', () => {
    expect(
      resolveDefaultAiSelection({ modelId: 'explicit-model', reasoningOptionId: 'medium' }, models),
    ).toEqual({ effectiveModelId: 'explicit-model', issue: null });
  });

  it('fails closed when high is unavailable on either Auto or an explicit model', () => {
    const noHighDefault = [
      {
        modelId: 'provider-default',
        isDefault: true,
        reasoningOptions: [{ id: 'low' }, { id: 'medium' }],
      },
    ];
    expect(resolveDefaultAiSelection(DEFAULT_AI_SELECTION, noHighDefault)).toEqual({
      effectiveModelId: 'provider-default',
      issue: 'reasoning_unavailable',
    });
    expect(
      resolveDefaultAiSelection(
        { modelId: 'provider-default', reasoningOptionId: 'ultra' },
        noHighDefault,
      ),
    ).toEqual({
      effectiveModelId: 'provider-default',
      issue: 'reasoning_unavailable',
    });
  });

  it('fails closed when Auto has no unique default or an explicit model was removed', () => {
    expect(resolveDefaultAiSelection(DEFAULT_AI_SELECTION, [])).toEqual({
      effectiveModelId: null,
      issue: 'model_unavailable',
    });
    expect(
      resolveDefaultAiSelection(DEFAULT_AI_SELECTION, [
        ...models,
        { modelId: 'second-default', isDefault: true, reasoningOptions: [{ id: 'high' }] },
      ]),
    ).toEqual({ effectiveModelId: null, issue: 'model_unavailable' });
    expect(
      resolveDefaultAiSelection({ modelId: 'removed-model', reasoningOptionId: 'high' }, models),
    ).toEqual({ effectiveModelId: null, issue: 'model_unavailable' });
  });

  it('allows an explicit provider-default reasoning choice', () => {
    expect(resolveDefaultAiSelection({ modelId: null, reasoningOptionId: null }, models)).toEqual({
      effectiveModelId: 'provider-default',
      issue: null,
    });
  });
});
