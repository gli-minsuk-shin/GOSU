import { selectCatalogModelFromList } from '@gosu/contracts';

import type { DefaultAiSelection } from './user-preferences';

export type DefaultAiModelDescriptor = Readonly<{
  providerId?: string;
  modelId: string;
  isDefault: boolean;
  reasoningOptions: readonly Readonly<{ id: string }>[];
}>;

export type DefaultAiSelectionResolution = Readonly<{
  effectiveModelId: string | null;
  issue: 'model_unavailable' | 'reasoning_unavailable' | null;
}>;

/**
 * Checks a saved Settings choice against the currently rendered provider catalog. IDs remain
 * opaque and a removed model or reasoning option is never silently replaced. Electron Main still
 * refreshes the provider catalog and repeats the authority check immediately before every turn.
 */
export function resolveDefaultAiSelection(
  selection: DefaultAiSelection,
  models: readonly DefaultAiModelDescriptor[],
): DefaultAiSelectionResolution {
  if (selection.modelId !== null && selection.providerId === null) {
    return { effectiveModelId: null, issue: 'model_unavailable' };
  }
  const model = selectCatalogModelFromList(models, {
    requestedModelId: selection.modelId,
    providerId: selection.modelId === null ? null : selection.providerId,
  });
  if (!model) return { effectiveModelId: null, issue: 'model_unavailable' };
  if (
    selection.reasoningOptionId !== null &&
    !model.reasoningOptions.some((option) => option.id === selection.reasoningOptionId)
  ) {
    return { effectiveModelId: model.modelId, issue: 'reasoning_unavailable' };
  }
  return { effectiveModelId: model.modelId, issue: null };
}
