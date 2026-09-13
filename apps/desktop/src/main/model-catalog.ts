import { randomUUID } from 'node:crypto';

import {
  createCodexModelCatalog,
  selectCatalogModel,
  ModelInvocationSchema,
  type ModelCatalog,
  type ModelInvocation,
} from '@gosu/contracts';

import type { CodexModel } from './codex-app-server';

const PROVIDER_ID = 'codex';
export const CODEX_CONTEXT_WINDOW_TOKENS = 128_000;

export function toModelCatalog(
  wireModels: readonly CodexModel[],
  fetchedAt = new Date().toISOString(),
): ModelCatalog {
  return createCodexModelCatalog(wireModels, fetchedAt);
}

export function createInvocation(input: {
  catalog: ModelCatalog;
  requestedModelId: string | null;
  reasoningOptionId: string | null;
  startedAt?: string;
}): ModelInvocation {
  const requestedModel = selectCatalogModel(input.catalog, {
    requestedModelId: input.requestedModelId,
    providerId: PROVIDER_ID,
  });

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
