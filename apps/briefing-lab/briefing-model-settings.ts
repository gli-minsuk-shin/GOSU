import { z } from 'zod';
import { resolveCatalogReasoning } from '@gosu/contracts';
import type { BriefingWorkspaceStore } from './briefing-workspace-store';
import type { assistantModel } from './briefing-assistant';
import { BriefingModelSelectionSchema, modelSelection } from './src/briefing-model-selection';

export const BriefingModelSaveSchema = z
  .object({
    routineId: z.string().min(1).max(128),
    selection: BriefingModelSelectionSchema,
    expectedSelection: BriefingModelSelectionSchema,
  })
  .strict();
export async function saveBriefingModelSelection(
  raw: unknown,
  workspace: BriefingWorkspaceStore,
  resolve: typeof assistantModel,
  consent: (message: string, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
  beforeCommit?: () => void,
) {
  const input = BriefingModelSaveSchema.parse(raw);
  const profile = await workspace.profile(input.routineId);
  if (!profile) throw new Error('assistant_settings_required');
  if (!workspace.owns(profile)) throw new Error('assistant_client_required');
  if (
    JSON.stringify(modelSelection(profile.preferences)) !== JSON.stringify(input.expectedSelection)
  )
    throw new Error('assistant_model_selection_stale');
  if (signal.aborted) throw new Error('source_cancelled');
  const preferences = { ...profile.preferences, ...input.selection };
  const model = await resolve(preferences);
  if (
    model.providerId !== preferences.providerId ||
    (preferences.modelId && model.modelId !== preferences.modelId)
  )
    throw new Error('routine_model_unavailable');
  if (preferences.reasoning && !resolveCatalogReasoning(model, preferences.reasoning))
    throw new Error('routine_reasoning_unavailable');
  const { approvedScope: _approved, updatedAt: _updated, owners: _owners, ...data } = profile;
  const saved = await workspace.save(
    { ...data, preferences, live: { ...data.live, assistant: preferences } },
    (message) => consent(message, signal),
    profile,
    signal,
    beforeCommit,
  );
  return {
    saved: true,
    selection: modelSelection(saved.preferences),
    approved: workspace.approved(saved),
  };
}
