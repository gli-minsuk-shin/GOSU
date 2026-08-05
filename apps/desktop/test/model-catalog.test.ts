import { describe, expect, it } from 'vitest';

import { createInvocation, recordModelReroute, toModelCatalog } from '../src/main/model-catalog';
import type { CodexModel } from '../src/main/codex-app-server';

const fixtureModels: CodexModel[] = [
  {
    id: 'provider-default',
    model: 'provider-default',
    displayName: 'Provider default',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced reasoning' }],
    inputModalities: ['text', 'image'],
  },
];

describe('dynamic Codex model catalog', () => {
  it('shows a provider model added after the app was built', () => {
    const futureModel = {
      ...fixtureModels[0]!,
      id: 'future-provider-model',
      model: 'future-provider-model',
      displayName: 'Future provider model',
      isDefault: false,
    };
    const catalog = toModelCatalog([...fixtureModels, futureModel], '2026-08-03T00:00:00Z');

    expect(catalog.models.map((model) => model.modelId)).toContain('future-provider-model');
  });

  it('uses exact native reasoning IDs as compact labels without an app-owned enum', () => {
    const catalog = toModelCatalog(
      [
        {
          ...fixtureModels[0]!,
          defaultReasoningEffort: 'xhigh',
          supportedReasoningEfforts: [
            { reasoningEffort: 'medium', description: 'A deliberately long provider summary' },
            { reasoningEffort: 'xhigh', description: 'Another deliberately long summary' },
            { reasoningEffort: 'future-ultra', description: 'Introduced after this app shipped' },
          ],
        },
      ],
      '2026-08-03T00:00:00Z',
    );

    expect(catalog.models[0]?.reasoningOptions).toEqual([
      { id: 'medium', label: 'medium', isDefault: false },
      { id: 'xhigh', label: 'xhigh', isDefault: true },
      { id: 'future-ultra', label: 'future-ultra', isDefault: false },
    ]);
  });

  it('does not invent a reasoning option when model/list provides none', () => {
    const catalog = toModelCatalog(
      [
        {
          id: 'provider-without-reasoning-options',
          model: 'provider-without-reasoning-options',
          displayName: 'Provider without reasoning options',
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: 'provider-default-not-in-options',
        },
      ],
      '2026-08-03T00:00:00Z',
    );

    expect(catalog.models[0]?.reasoningOptions).toEqual([]);
    expect(catalog.models[0]?.modalities).toEqual(['text']);
  });

  it('records the exact selected model, catalog snapshot and later reroute', () => {
    const catalog = toModelCatalog(fixtureModels, '2026-08-03T00:00:00Z');
    const invocation = createInvocation({
      catalog,
      requestedModelId: 'provider-default',
      reasoningOptionId: 'medium',
      startedAt: '2026-08-03T00:00:01Z',
    });

    expect(invocation).toMatchObject({
      requestedModelId: 'provider-default',
      resolvedModelId: 'provider-default',
      catalogVersion: catalog.catalogVersion,
    });
    expect(recordModelReroute(invocation, 'provider-reroute').resolvedModelId).toBe(
      'provider-reroute',
    );
  });

  it.each([
    {
      capability: 'personality support',
      mutate: (model: CodexModel): CodexModel => ({ ...model, supportsPersonality: true }),
    },
    {
      capability: 'default reasoning effort',
      mutate: (model: CodexModel): CodexModel => ({
        ...model,
        defaultReasoningEffort: 'high',
      }),
    },
    {
      capability: 'provider wire model',
      mutate: (model: CodexModel): CodexModel => ({
        ...model,
        model: 'provider-default-revision-2',
      }),
    },
  ])('changes catalogVersion when only $capability changes', ({ mutate }) => {
    const baselineModel: CodexModel = {
      ...fixtureModels[0]!,
      supportsPersonality: false,
      supportedReasoningEfforts: [
        { reasoningEffort: 'medium', description: 'Balanced reasoning' },
        { reasoningEffort: 'high', description: 'More reasoning' },
      ],
    };
    const baseline = toModelCatalog([baselineModel], '2026-08-03T00:00:00Z');
    const changed = toModelCatalog([mutate(baselineModel)], '2026-08-03T00:00:00Z');

    expect(changed.catalogVersion).not.toBe(baseline.catalogVersion);
  });

  it('does not silently fall back when a selected model disappeared', () => {
    const catalog = toModelCatalog(fixtureModels, '2026-08-03T00:00:00Z');

    expect(() =>
      createInvocation({
        catalog,
        requestedModelId: 'removed-model',
        reasoningOptionId: null,
      }),
    ).toThrow('selected_model_not_in_catalog');
  });
});
