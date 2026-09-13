import { routedModel, type ModelRouting, type ModelUsage } from '@gosu/contracts';
import type { AssistantPreferences } from '@gosu/briefing-core';
export function routedBriefingPreferences(
  preferences: AssistantPreferences,
  policy: ModelRouting | undefined,
  usage: ModelUsage,
) {
  if (preferences.modelId || !policy) return preferences;
  const model = routedModel(policy, usage);
  if (!model) return preferences;
  // A model routing preference is not permission to send private data to another provider.
  if (model.providerId !== preferences.providerId)
    throw new Error('model_routing_provider_permission_required');
  return { ...preferences, modelId: model.modelId, reasoning: model.reasoningOptionId };
}
