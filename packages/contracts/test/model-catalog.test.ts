import { describe, expect, it } from 'vitest';

import {
  CODEX_FALLBACK_CONTEXT_WINDOW_TOKENS,
  createCodexModelCatalog,
  resolveCatalogReasoning,
  selectCatalogModel,
  selectCatalogModelFromList,
  type ProviderCodexModel,
} from '../src/model-catalog.js';
import type { ModelCatalog } from '../src/ai.js';

const fetchedAt = '2026-09-07T00:00:00.000Z';
const wireModel = (overrides: Partial<ProviderCodexModel> = {}): ProviderCodexModel => ({
  id: 'provider-model-a',
  model: 'provider-model-a-native',
  displayName: 'Provider model A',
  isDefault: true,
  defaultReasoningEffort: 'provider-effort',
  supportedReasoningEfforts: [
    { reasoningEffort: 'provider-effort', description: 'Provider default' },
  ],
  ...overrides,
});

describe('shared provider-discovered model catalog', () => {
  it('automatically uses each model maximum and keeps the Astra extension separate from the detected transport', () => {
    const [astra, small, future] = createCodexModelCatalog([
      wireModel({
        id: 'gpt-6-astra',
        nativeDefaultContextWindowTokens: 272000,
        nativeMaxContextWindowTokens: 872000,
        nativeEffectiveContextPercent: 95,
      }),
      wireModel({ id: 'small', nativeDefaultContextWindowTokens: 128000 }),
      wireModel({
        id: 'future',
        nativeDefaultContextWindowTokens: 272000,
        nativeMaxContextWindowTokens: 1500000,
        nativeEffectiveContextPercent: 90,
      }),
    ]).models;
    expect(astra).toMatchObject({
      contextWindowTokens: 828400,
      metadata: {
        requestedContextWindowTokens: 1050000,
        nativeContextWindowTokens: 872000,
        defaultContextWindowTokens: 272000,
      },
    });
    expect(small).toMatchObject({
      contextWindowTokens: 128000,
      metadata: { requestedContextWindowTokens: 128000 },
    });
    expect(future).toMatchObject({
      contextWindowTokens: 1350000,
      metadata: { requestedContextWindowTokens: 1500000 },
    });
    expect(astra?.metadata?.contextConfigurationKey).not.toBe(
      future?.metadata?.contextConfigurationKey,
    );
  });
  it('labels the explicit Astra extended context request as configured, never as provider-reported or a universal fallback', () => {
    const [astra, unknown] = createCodexModelCatalog([
      wireModel({ id: 'gpt-6-astra', contextWindowTokens: 272000 }),
      wireModel({ id: 'unknown-model' }),
    ]).models;
    expect(astra).toMatchObject({
      contextWindowTokens: 272000,
      metadata: { contextWindowSource: 'configured', requestedContextWindowTokens: 1050000 },
    });
    expect(unknown).toMatchObject({
      contextWindowTokens: 128000,
      metadata: { contextWindowSource: 'fallback' },
    });
  });
  it('makes an unknown model and reasoning option selectable as soon as the provider returns them', () => {
    const previous = createCodexModelCatalog([wireModel()], fetchedAt);
    const refreshed = createCodexModelCatalog(
      [
        wireModel({ isDefault: false }),
        wireModel({
          id: 'new-family/unannounced-model',
          model: 'new-native-route',
          displayName: 'A newly released model',
          defaultReasoningEffort: 'provider-future-effort',
          supportedReasoningEfforts: [{ reasoningEffort: 'provider-future-effort' }],
          contextWindowTokens: 1_000_000,
        }),
      ],
      fetchedAt,
    );

    expect(selectCatalogModel(previous)?.modelId).toBe('provider-model-a');
    expect(selectCatalogModel(refreshed)).toMatchObject({
      modelId: 'new-family/unannounced-model',
      contextWindowTokens: 1_000_000,
      metadata: { wireModel: 'new-native-route' },
    });
    expect(resolveCatalogReasoning(selectCatalogModel(refreshed))).toEqual({
      id: 'provider-future-effort',
      label: 'provider-future-effort',
      isDefault: true,
    });
    expect(selectCatalogModel(refreshed, { requestedModelId: 'provider-model-a' })?.modelId).toBe(
      'provider-model-a',
    );
  });

  it('never infers a default from a model name or substitutes an upgrade for a missing pin', () => {
    const catalog = createCodexModelCatalog(
      [
        wireModel({ upgrade: { model: 'next-unavailable-model' } }),
        wireModel({ id: 'bigger-newer-model-9999', isDefault: false }),
        wireModel({ id: 'hidden-model', hidden: true }),
      ],
      fetchedAt,
    );
    expect(catalog.models).toHaveLength(2);
    expect(catalog.models[0]?.replacementModelId).toBe('next-unavailable-model');
    expect(selectCatalogModel(catalog)?.modelId).toBe('provider-model-a');
    expect(
      selectCatalogModel(catalog, { requestedModelId: 'next-unavailable-model' }),
    ).toBeUndefined();
    expect(selectCatalogModel(catalog, { requestedModelId: 'hidden-model' })).toBeUndefined();
    expect(selectCatalogModel(catalog, { requestedModelId: 'removed-pin' })).toBeUndefined();
    expect(resolveCatalogReasoning(catalog.models[0], 'removed-effort')).toBeUndefined();
    expect(
      selectCatalogModel(createCodexModelCatalog([wireModel({ isDefault: false })])),
    ).toBeUndefined();
  });

  it('keeps model and reasoning choices in the requested provider', () => {
    const codex = createCodexModelCatalog([wireModel()], fetchedAt);
    const catalog: ModelCatalog = {
      ...codex,
      providerId: 'project-chat',
      models: [
        ...codex.models,
        { ...codex.models[0]!, providerId: 'other-provider', isDefault: false },
      ],
    };
    expect(selectCatalogModel(catalog, { requestedModelId: 'provider-model-a' })).toBeUndefined();
    expect(
      selectCatalogModel(catalog, { requestedModelId: 'provider-model-a', providerId: 'codex' })
        ?.providerId,
    ).toBe('codex');
    expect(selectCatalogModel(catalog, { providerId: 'other-provider' })).toBeUndefined();
    expect(
      selectCatalogModel(catalog, {
        requestedModelId: 'provider-model-a',
        providerId: 'missing-provider',
      }),
    ).toBeUndefined();
  });

  it('resolves full catalogs and reduced picker lists identically, including legacy Codex records', () => {
    const catalog = createCodexModelCatalog(
      [wireModel({ isDefault: false }), wireModel({ id: 'new-default', displayName: 'New model' })],
      fetchedAt,
    );
    const reduced = catalog.models.map((model) => ({
      modelId: model.modelId,
      displayName: model.displayName,
      isDefault: model.isDefault,
    }));
    for (const requestedModelId of [null, 'provider-model-a', 'new-default', 'removed-model']) {
      const selection = { requestedModelId, providerId: 'codex' };
      expect(selectCatalogModelFromList(reduced, selection)?.displayName).toBe(
        selectCatalogModel(catalog, selection)?.displayName,
      );
    }
    const mixed = [
      ...reduced,
      {
        providerId: 'other-provider',
        modelId: 'new-default',
        displayName: 'Other',
        isDefault: true,
      },
    ];
    expect(selectCatalogModelFromList(mixed, { requestedModelId: 'new-default' })).toBeUndefined();
    expect(selectCatalogModelFromList(mixed, {}, 'codex')?.displayName).toBe('New model');
    expect(
      selectCatalogModelFromList(mixed, {
        requestedModelId: 'new-default',
        providerId: 'other-provider',
      })?.displayName,
    ).toBe('Other');
  });

  it('fingerprints capability and display changes without changing on a refresh timestamp alone', () => {
    const catalog = createCodexModelCatalog([wireModel()], fetchedAt);
    expect(createCodexModelCatalog([wireModel()], '2026-09-08T00:00:00.000Z').catalogVersion).toBe(
      catalog.catalogVersion,
    );
    for (const change of [
      { displayName: 'Renamed by provider' },
      { description: 'New provider description' },
      { model: 'updated-native-route' },
      { contextWindowTokens: 512_000 },
      { isDefault: false },
      { supportedReasoningEfforts: [{ reasoningEffort: 'new-effort' }] },
      { inputModalities: ['text', 'image'] },
      { supportsPersonality: true },
      { upgrade: 'next-provider-model' },
    ] satisfies Partial<ProviderCodexModel>[]) {
      expect(createCodexModelCatalog([wireModel(change)], fetchedAt).catalogVersion).not.toBe(
        catalog.catalogVersion,
      );
    }
  });

  it('uses valid provider context and modalities and supplies only the documented missing-context fallback', () => {
    const absent = createCodexModelCatalog([wireModel()], fetchedAt).models[0]!;
    expect(absent.contextWindowTokens).toBe(CODEX_FALLBACK_CONTEXT_WINDOW_TOKENS);
    expect(absent.modalities).toEqual(['text']);
    expect(
      createCodexModelCatalog(
        [
          wireModel({
            contextWindow: 512_000,
            inputModalities: ['text', 'image', 'audio', 'future-modality'],
          }),
        ],
        fetchedAt,
      ).models[0],
    ).toMatchObject({ contextWindowTokens: 512_000, modalities: ['text', 'image', 'audio'] });
    expect(
      createCodexModelCatalog([
        wireModel({ contextWindow: 512_000, contextWindowTokens: 1_000_000 }),
      ]).models[0]?.contextWindowTokens,
    ).toBe(1_000_000);
    expect(() => createCodexModelCatalog([wireModel({ contextWindowTokens: -1 })])).toThrow();
    expect(() =>
      createCodexModelCatalog([wireModel({ contextWindowTokens: Number.NaN })]),
    ).toThrow();
  });

  it('validates identities and rejects ambiguous duplicate provider records', () => {
    expect(() => createCodexModelCatalog([wireModel({ id: '' })])).toThrow();
    expect(() => createCodexModelCatalog([wireModel(), wireModel()])).toThrow(
      'duplicate_provider_model_id',
    );
    expect(() =>
      createCodexModelCatalog([
        wireModel({
          supportedReasoningEfforts: [{ reasoningEffort: 'same' }, { reasoningEffort: 'same' }],
        }),
      ]),
    ).toThrow('duplicate_provider_reasoning_id');
    expect(resolveCatalogReasoning(undefined)).toBeUndefined();
    expect(createCodexModelCatalog([], fetchedAt).models).toEqual([]);
  });
});
