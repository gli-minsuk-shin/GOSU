import { routedModel, type ModelRouting, type ModelUsage } from '@gosu/contracts';
import type { AssistantPreferences } from '@gosu/briefing-core';

/** Everything Briefing asks a model to do. Settings → Agent assigns each one a role model. */
export const BRIEFING_MODEL_USAGES = [
  'briefing',
  'briefingAssistant',
  'lightweightTasks',
  'paperSummary',
  'paperChat',
] as const;
export type BriefingModelUsage = (typeof BRIEFING_MODEL_USAGES)[number];

const briefingProvider = (id: string): id is AssistantPreferences['providerId'] =>
  id === 'codex' || id === 'claude-code';

/**
 * Settings → Agent is the only place that picks Briefing's provider, model and reasoning. The
 * selection stored with the routine (from the picker Briefing had until 0.58.135) only runs while
 * the usage's role has no model there ("미지정" or "기존 설정").
 */
export function routedBriefingPreferences(
  preferences: AssistantPreferences,
  policy: ModelRouting | undefined,
  usage: ModelUsage,
): AssistantPreferences {
  const model = policy ? routedModel(policy, usage) : null;
  if (!model || !briefingProvider(model.providerId)) return preferences;
  return {
    ...preferences,
    providerId: model.providerId,
    modelId: model.modelId,
    reasoning: model.reasoningOptionId,
  };
}

/**
 * Which role a chat turn runs on. A question about one paper is 논문 분석·질의응답's work, which is a
 * different job from 논문 요약: summarizing is a quick pass and this is the deep conversation, so the
 * user assigns them separately. While the role is unset `usageChoice` sends it to the assistant's
 * own role, so a turn runs on the model the user talks to, exactly as it did before either role
 * existed.
 */
export function briefingChatUsage(aboutPaper: boolean): BriefingModelUsage {
  return aboutPaper ? 'paperChat' : 'briefingAssistant';
}

/**
 * Providers Settings → Agent sends Briefing work to. The user picked them there, so what a routine
 * allows for AI may go to them without a second provider approval inside Briefing.
 */
export function briefingRoutedProviders(policy: ModelRouting | undefined): string[] {
  if (!policy) return [];
  return [
    ...new Set(
      BRIEFING_MODEL_USAGES.flatMap((usage) => {
        const model = routedModel(policy, usage);
        return model && briefingProvider(model.providerId) ? [model.providerId] : [];
      }),
    ),
  ];
}

export const briefingProviderName = (id: string) =>
  id === 'claude-code' ? 'Claude Code' : id === 'codex' ? 'Codex' : id;

/** One line for approval dialogs: where this routine's AI requests go right now. */
export function briefingProviderSummary(
  preferences: AssistantPreferences,
  policy: ModelRouting | undefined,
) {
  const providers = [
    ...new Set(
      BRIEFING_MODEL_USAGES.map(
        (usage) => routedBriefingPreferences(preferences, policy, usage).providerId,
      ),
    ),
  ];
  return `설정 → Agent의 작업별 AI 모델을 따름 (현재 ${providers.map(briefingProviderName).join(', ')})`;
}
