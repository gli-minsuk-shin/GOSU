import { describe, expect, it } from 'vitest';

import { resolveDefaultAiSelection } from '../src/renderer/src/default-ai-selection';
import { DEFAULT_AI_SELECTION } from '../src/renderer/src/user-preferences';

const models = [
  {
    providerId: 'codex',
    modelId: 'provider-default',
    isDefault: true,
    reasoningOptions: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
  },
  {
    providerId: 'codex',
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
      resolveDefaultAiSelection(
        { providerId: 'codex', modelId: 'explicit-model', reasoningOptionId: 'medium' },
        models,
      ),
    ).toEqual({ effectiveModelId: 'explicit-model', issue: null });
  });

  it('fails closed when high is unavailable on either Auto or an explicit model', () => {
    const noHighDefault = [
      {
        providerId: 'codex',
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
        { providerId: 'codex', modelId: 'provider-default', reasoningOptionId: 'ultra' },
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
        {
          providerId: 'codex',
          modelId: 'second-default',
          isDefault: true,
          reasoningOptions: [{ id: 'high' }],
        },
      ]),
    ).toEqual({ effectiveModelId: null, issue: 'model_unavailable' });
    expect(
      resolveDefaultAiSelection(
        { providerId: 'codex', modelId: 'removed-model', reasoningOptionId: 'high' },
        models,
      ),
    ).toEqual({ effectiveModelId: null, issue: 'model_unavailable' });
  });

  it('allows an explicit provider-default reasoning choice', () => {
    expect(
      resolveDefaultAiSelection(
        { providerId: null, modelId: null, reasoningOptionId: null },
        models,
      ),
    ).toEqual({
      effectiveModelId: 'provider-default',
      issue: null,
    });
  });

  it('resolves the same opaque model ID only within its saved provider', () => {
    const sharedModels = [
      ...models,
      {
        providerId: 'claude-code',
        modelId: 'explicit-model',
        isDefault: false,
        reasoningOptions: [{ id: 'high' }],
      },
    ];

    expect(
      resolveDefaultAiSelection(
        { providerId: 'claude-code', modelId: 'explicit-model', reasoningOptionId: 'high' },
        sharedModels,
      ),
    ).toEqual({ effectiveModelId: 'explicit-model', issue: null });
  });
});
