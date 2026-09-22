import { routedModel, type ModelRouting } from '@gosu/contracts';
import type { ModelLabModelSelection } from './src/model-lab-runtime-adapter';

export function modelExtractionSelection(
  policy: ModelRouting | undefined,
  current: ModelLabModelSelection | undefined,
): ModelLabModelSelection | undefined {
  const role = policy?.usage.modelExtraction ?? 'existing';
  if (!policy || role === 'existing') return current;
  const model = routedModel(policy, 'modelExtraction');
  if (!model) throw new Error('model_extraction_role_unconfigured');
  if (model.providerId !== 'codex' && model.providerId !== 'claude-code')
    throw new Error('model_extraction_provider_unsupported');
  return {
    providerId: model.providerId,
    requestedModelId: model.modelId,
    reasoningOptionId: model.reasoningOptionId,
  };
}
