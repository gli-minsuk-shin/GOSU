import { createHash, randomUUID } from 'node:crypto';

import {
  ModelCatalogSchema,
  ModelInvocationSchema,
  type ModelCatalog,
  type ModelInvocation,
} from '@gosu/contracts';

import type { CodexModel } from './codex-app-server';

const PROVIDER_ID = 'codex';

function catalogHash(models: readonly CodexModel[]) {
  const canonical = models.map((model) => ({
    id: model.id,
    wireModel: model.model,
    displayName: model.displayName,
    isDefault: model.isDefault,
    defaultReasoningEffort: model.defaultReasoningEffort ?? null,
    reasoning: model.supportedReasoningEfforts ?? [],
    // Do not invent visual support when an older provider catalog omits capability metadata.
    modalities: model.inputModalities ?? ['text'],
    supportsPersonality: model.supportsPersonality ?? false,
    upgrade: model.upgrade ?? null,
  }));

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function toModelCatalog(
  wireModels: readonly CodexModel[],
  fetchedAt = new Date().toISOString(),
): ModelCatalog {
  const visible = wireModels.filter((model) => !model.hidden);
  const catalogVersion = catalogHash(visible);

  return ModelCatalogSchema.parse({
    schemaVersion: 1,
    providerId: PROVIDER_ID,
    catalogVersion,
    fetchedAt,
    models: visible.map((model) => ({
      schemaVersion: 1,
      providerId: PROVIDER_ID,
      modelId: model.id,
      displayName: model.displayName,
      catalogVersion,
      isDefault: model.isDefault,
      modalities: model.inputModalities ?? ['text'],
      reasoningOptions: (model.supportedReasoningEfforts ?? []).map((option) => ({
        id: option.reasoningEffort,
        // The App Server owns this opaque vocabulary. Keep the picker compact and let future
        // native options appear without a GOSU enum or a rewritten display name.
        label: option.reasoningEffort,
        isDefault: option.reasoningEffort === model.defaultReasoningEffort,
      })),
      ...(model.upgrade ? { replacementModelId: model.upgrade } : {}),
      metadata: {
        wireModel: model.model,
        supportsPersonality: model.supportsPersonality ?? false,
      },
    })),
  });
}

export function createInvocation(input: {
  catalog: ModelCatalog;
  requestedModelId: string | null;
  reasoningOptionId: string | null;
  startedAt?: string;
}): ModelInvocation {
  const defaultModel = input.catalog.models.find((model) => model.isDefault);
  const requestedModel = input.requestedModelId
    ? input.catalog.models.find((model) => model.modelId === input.requestedModelId)
    : defaultModel;

  if (!requestedModel) {
    throw new Error(
      input.requestedModelId ? 'selected_model_not_in_catalog' : 'provider_default_model_missing',
    );
  }

  return ModelInvocationSchema.parse({
    schemaVersion: 1,
    invocationId: randomUUID(),
    providerId: PROVIDER_ID,
    requestedModelId: input.requestedModelId,
    resolvedModelId: requestedModel.modelId,
    catalogVersion: input.catalog.catalogVersion,
    reasoningOptionId: input.reasoningOptionId,
    startedAt: input.startedAt ?? new Date().toISOString(),
  });
}

export function recordModelReroute(invocation: ModelInvocation, resolvedModelId: string) {
  return ModelInvocationSchema.parse({ ...invocation, resolvedModelId });
}
