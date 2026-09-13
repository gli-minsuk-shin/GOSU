import {
  AssistantPreferencesSchema,
  defaultAssistantPreferences,
  type BriefingRoutine,
} from '@gosu/briefing-core';
import type { z } from 'zod';

export const BriefingModelSelectionSchema = AssistantPreferencesSchema.pick({
  providerId: true,
  modelId: true,
  reasoning: true,
}).strict();
export type BriefingModelSelection = z.infer<typeof BriefingModelSelectionSchema>;
export const modelSelection = (value = defaultAssistantPreferences()): BriefingModelSelection => ({
  providerId: value.providerId,
  modelId: value.modelId,
  reasoning: value.reasoning,
});
export function briefingChatContextKey(routine: BriefingRoutine) {
  const { updatedAt: _updatedAt, suggestedQuestions: _questions, live, ...rest } = routine;
  const {
    modelId: _model,
    reasoning: _reasoning,
    mailOpenConfirmation: _mailOpenConfirmation,
    ...scope
  } = live?.assistant ?? defaultAssistantPreferences();
  return JSON.stringify({ ...rest, live: { ...live, assistant: scope } });
}
