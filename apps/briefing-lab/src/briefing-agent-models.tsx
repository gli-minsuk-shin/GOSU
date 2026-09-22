import { useEffect, useState } from 'react';
import { sourceRequest } from './live-client';
import { isGosuEmbedded } from './desktop-bridge';

/** What runs for one Briefing usage right now, as `/assistant/model/current` reports it. */
export type BriefingUsageModel = {
  usage: 'briefing' | 'briefingAssistant' | 'lightweightTasks';
  providerId: string;
  modelId: string | null;
  displayName: string;
  reasoning: string | null;
  /** Settings → Agent assigned this model; false means the routine's earlier selection still runs. */
  assigned: boolean;
  available: boolean;
};
export const BRIEFING_USAGE_LABELS: Record<BriefingUsageModel['usage'], string> = {
  briefing: '이메일·논문 요약',
  briefingAssistant: 'AI 비서 대화',
  lightweightTasks: '빠른 1차 브리핑 · 일정·할 일 초안',
};
const providerName = (id: string) =>
  id === 'claude-code' ? 'Claude Code' : id === 'codex' ? 'Codex' : id;
export const usageModelText = (model: BriefingUsageModel) =>
  `${providerName(model.providerId)} · ${model.displayName}${model.reasoning ? ` · ${model.reasoning}` : ''}`;

/** Briefing has no model picker: the desktop app opens Settings → Agent, where the models are set. */
export const canOpenAgentSettings = () => isGosuEmbedded();
export function openAgentSettings() {
  if (isGosuEmbedded()) window.parent.postMessage({ type: 'gosu-open-agent-settings' }, '*');
}

export function useBriefingUsageModels(routineId: string, refreshKey: unknown = null) {
  const [models, setModels] = useState<BriefingUsageModel[] | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let revision = 0;
    const refresh = () => {
      const expected = ++revision;
      void sourceRequest<{ usages?: BriefingUsageModel[] }>(
        '/assistant/model/current',
        { routineId },
        controller.signal,
      )
        .then((value) => {
          if (controller.signal.aborted || expected !== revision) return;
          setModels(value.usages ?? []);
          setError('');
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted || expected !== revision) return;
          setModels(null);
          setError(e instanceof Error ? e.message : '현재 AI 모델을 확인하지 못했습니다.');
        });
    };
    refresh();
    // Settings → Agent lives in another window area: coming back may mean the models changed.
    if (typeof window !== 'undefined') window.addEventListener?.('focus', refresh);
    return () => {
      controller.abort();
      if (typeof window !== 'undefined') window.removeEventListener?.('focus', refresh);
    };
  }, [routineId, refreshKey]);
  return { models, error };
}

/** Read-only: which model each Briefing usage runs on, and where to change it. */
export function BriefingAgentModels({ routineId }: { routineId: string }) {
  const { models, error } = useBriefingUsageModels(routineId);
  return (
    <div className="briefing-agent-models" role="group" aria-label="Briefing AI 모델">
      <div>
        <b>AI 모델</b>
        <p>
          Briefing의 모든 AI 작업은 GOSU 설정 → Agent의 ‘작업별 AI 모델’에서 정한 모델로 실행합니다.
          Briefing에는 모델을 따로 고르는 곳이 없습니다.
        </p>
      </div>
      {models && models.length > 0 && (
        <dl>
          {models.map((model) => (
            <div key={model.usage}>
              <dt>{BRIEFING_USAGE_LABELS[model.usage]}</dt>
              <dd>
                {usageModelText(model)}
                {!model.assigned && (
                  <small>
                    설정 → Agent에서 이 작업의 모델이 미지정입니다. 지정하기 전까지 이 루틴이 전에
                    쓰던 모델로 실행합니다.
                  </small>
                )}
                {!model.available && (
                  <small role="alert">
                    현재 연결에서 이 모델을 쓸 수 없습니다. 설정 → Agent에서 제공자 연결과 모델을
                    확인해주세요.
                  </small>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {error && (
        <p role="status" className="briefing-muted">
          {error}
        </p>
      )}
      {canOpenAgentSettings() && (
        <button type="button" className="briefing-button" onClick={openAgentSettings}>
          설정 → Agent 열기
        </button>
      )}
    </div>
  );
}
