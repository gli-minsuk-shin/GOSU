import {
  canOpenAgentSettings,
  openAgentSettings,
  usageModelText,
  useBriefingUsageModels,
} from './briefing-agent-models';

/** What each chat is called where the user looks. Deliberately not BRIEFING_USAGE_LABELS: those
 *  name rows in the model list ("AI 비서 대화"), and two tests pin the wording below. */
const BADGE_LABELS = {
  briefingAssistant: 'AI 비서',
  paperChat: '논문 요약 AI',
} as const;

/**
 * One chat's model in its header. Read-only: Settings → Agent picks it, and a click opens that
 * screen. `busy` refreshes the label once a turn ends, in case the model changed meanwhile.
 * `usage` matters because the AI 비서 and 논문 요약 AI are assigned separately: naming the
 * assistant's model over a paper conversation would state something untrue.
 */
export function BriefingModelBadge({
  routineId,
  busy = false,
  usage = 'briefingAssistant',
}: {
  routineId: string;
  busy?: boolean;
  usage?: keyof typeof BADGE_LABELS;
}) {
  const { models } = useBriefingUsageModels(routineId, busy);
  const model = models?.find((m) => m.usage === usage);
  const openable = canOpenAgentSettings();
  return (
    <div className="briefing-title-model">
      <button
        className="briefing-title-model-trigger"
        type="button"
        aria-label={`${BADGE_LABELS[usage]} 모델 · 설정 → Agent에서 변경`}
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
