import {
  canOpenAgentSettings,
  openAgentSettings,
  usageModelText,
  useBriefingUsageModels,
} from './briefing-agent-models';

/**
 * The assistant's model in the chat header. Read-only: Settings → Agent picks it, and a click opens
 * that screen. `busy` refreshes the label once a turn ends, in case the model changed meanwhile.
 */
export function BriefingModelBadge({
  routineId,
  busy = false,
}: {
  routineId: string;
  busy?: boolean;
}) {
  const { models } = useBriefingUsageModels(routineId, busy);
  const model = models?.find((m) => m.usage === 'briefingAssistant');
  const openable = canOpenAgentSettings();
  return (
    <div className="briefing-title-model">
      <button
        className="briefing-title-model-trigger"
        type="button"
        aria-label="AI 비서 모델 · 설정 → Agent에서 변경"
        title={`${model ? usageModelText(model) : '모델 확인 중'} · 모델은 GOSU 설정 → Agent의 ‘작업별 AI 모델’에서 바꿉니다.`}
        data-readonly={openable ? undefined : ''}
        onClick={openAgentSettings}
      >
        <span>{model?.displayName ?? '모델 확인 중…'}</span>
        <small>{model?.reasoning ?? '기본'}</small>
      </button>
    </div>
  );
}
