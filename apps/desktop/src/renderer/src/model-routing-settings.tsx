import { useEffect, useState } from 'react';
import {
  defaultModelRouting,
  MODEL_ROUTING_USAGES,
  routedModel,
  usageChoice,
  type ModelRouting,
} from '@gosu/contracts';
import type { CodexModel } from './connections-view';
import { resolveDefaultAiSelection } from './default-ai-selection';
import './model-routing-settings.css';
export const MODEL_USAGE_LABELS = {
  projectChat: 'Project Chat · 새 과학·연구 대화',
  briefing: 'Briefing · 이메일 요약',
  briefingAssistant: '전역 AI 비서 · 프로젝트·메일·일정 대화',
  lecture: '강의·문헌·실험 AI · 새 작업 기본값',
  lightweightTasks: '가벼운 작업 · 이메일에서 일정·할 일 초안 만들기 · 오늘의 격언',
  modelExtraction: 'Model Lab · 모델 구조 추출',
  paperSummary: '논문 요약 AI · 논문 분석과 논문별 질의응답',
};
/** Briefing has no model picker of its own, so "existing" means what the routine ran before. */
const BRIEFING_USAGES: ReadonlySet<string> = new Set([
  'briefing',
  'briefingAssistant',
  'lightweightTasks',
  'paperSummary',
]);
export function modelRoutingIssue(policy: ModelRouting, models: readonly CodexModel[]) {
  const extractionRole = policy.usage.modelExtraction ?? 'existing';
  if (extractionRole !== 'existing' && !policy[extractionRole])
    return '모델 구조 추출에 사용할 빠른 모델 또는 고성능 모델을 먼저 선택해주세요.';
  if (routedModel(policy, 'modelExtraction')?.providerId === 'hermes')
    return '모델 구조 추출은 Codex와 Claude Code 모델을 지원합니다.';
  for (const role of ['lightweight', 'fast', 'strong'] as const) {
    const selection = policy[role];
    if (selection && resolveDefaultAiSelection(selection, models).issue)
      return `${role === 'lightweight' ? '아주 가벼운 모델' : role === 'fast' ? '빠른 모델' : '고성능 모델'}의 모델 또는 추론 수준을 현재 연결에서 사용할 수 없습니다.`;
  }
  if (routedModel(policy, 'lecture')?.providerId === 'hermes')
    return '강의·문서 작업은 Codex와 Claude Code 모델을 지원합니다. 해당 사용처를 다른 역할 또는 기존 설정으로 바꿔주세요.';
  for (const usage of [
    'briefing',
    'briefingAssistant',
    'lightweightTasks',
    'paperSummary',
  ] as const)
    if (routedModel(policy, usage)?.providerId === 'hermes')
      return 'Briefing은 현재 Codex와 Claude Code만 지원합니다.';
  return null;
}
export function ModelRoutingSettings({
  policy,
  models,
  loading,
  error,
  onSave,
  onRefresh,
}: {
  policy: ModelRouting;
  models: readonly CodexModel[];
  loading: boolean;
  error?: string | null;
  onSave: (policy: ModelRouting) => Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(policy),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => setDraft(policy), [policy]);
  const issue = modelRoutingIssue(draft, models);
  const available = models.filter(
    (m, i) =>
      models.findIndex(
        (n) => n.modelId === m.modelId && (n.providerId ?? 'codex') === (m.providerId ?? 'codex'),
      ) === i,
  );
  return (
    <article className="settings-card model-routing-card">
      <header>
        <h2>작업별 AI 모델</h2>
        <p>
          빠른 처리와 깊은 연구에 사용할 모델을 따로 정하세요. 실제 속도·비용은 모델과 입력량에 따라
          달라집니다.
        </p>
      </header>
      <div className="model-routing-profiles">
        {(['lightweight', 'fast', 'strong'] as const).map((role) => {
          const selection = draft[role],
            label =
              role === 'lightweight'
                ? '아주 가벼운 모델'
                : role === 'fast'
                  ? '빠른 모델'
                  : '고성능 모델';
          const selected = models.find(
            (m) =>
              m.modelId === selection?.modelId &&
              (m.providerId ?? 'codex') === selection?.providerId,
          );
          const value = selection ? JSON.stringify([selection.providerId, selection.modelId]) : '';
          return (
            <fieldset key={role}>
              <legend>
                {role === 'lightweight'
                  ? '⚡ 아주 가볍고 빠른 모델'
                  : role === 'fast'
                    ? '⚡ 빠른 모델'
                    : '◈ 고성능 모델'}
              </legend>
              <label>
                {label} 선택
                <select
                  aria-label={`${label} 선택`}
                  disabled={loading || busy}
                  value={value}
                  onChange={(e) => {
                    const model = available.find(
                      (m) =>
                        JSON.stringify([m.providerId ?? 'codex', m.modelId]) === e.target.value,
                    );
                    setDraft({
                      ...draft,
                      [role]: model
                        ? {
                            providerId: model.providerId ?? 'codex',
                            modelId: model.modelId,
                            reasoningOptionId:
                              role === 'lightweight' &&
                              model.reasoningOptions.some((o) => o.id === 'low')
                                ? 'low'
                                : null,
                          }
                        : null,
                    });
                  }}
                >
                  <option value="">미지정 · 기존 설정 유지</option>
                  {selection && !selected && (
                    <option value={value}>사용 불가 · {selection.modelId}</option>
                  )}
                  {available.map((m) => (
                    <option
                      key={JSON.stringify([m.providerId, m.modelId])}
                      value={JSON.stringify([m.providerId ?? 'codex', m.modelId])}
                    >
                      {m.displayName} · {m.providerId ?? 'codex'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                추론 수준
                <select
                  aria-label={`${label} 추론 수준`}
                  value={selection?.reasoningOptionId ?? ''}
                  disabled={loading || busy || !selected}
                  onChange={(e) => {
                    if (selection)
                      setDraft({
                        ...draft,
                        [role]: { ...selection, reasoningOptionId: e.target.value || null },
                      });
                  }}
                >
                  <option value="">모델 기본값</option>
                  {selection?.reasoningOptionId &&
                    !selected?.reasoningOptions.some(
                      (o) => o.id === selection.reasoningOptionId,
                    ) && (
                      <option value={selection.reasoningOptionId}>
                        사용 불가 · {selection.reasoningOptionId}
                      </option>
                    )}
                  {selected?.reasoningOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          );
        })}
      </div>
      <div className="model-routing-usages">
        {MODEL_ROUTING_USAGES.map((usage) => (
          <label key={usage}>
            <span>{MODEL_USAGE_LABELS[usage]}</span>
            <select
              aria-label={MODEL_USAGE_LABELS[usage]}
              value={usageChoice(draft, usage)}
              disabled={loading || busy}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  usage: {
                    ...draft.usage,
                    [usage]: e.target.value as ModelRouting['usage'][typeof usage],
                  },
                })
              }
            >
              <option value="fast">빠른 모델</option>
              {usage !== 'modelExtraction' && <option value="lightweight">아주 가벼운 모델</option>}
              <option value="strong">고성능 모델</option>
              <option value="existing">
                {BRIEFING_USAGES.has(usage) ? '기존 설정 · 루틴이 전에 쓰던 모델' : '기존 설정'}
              </option>
            </select>
          </label>
        ))}
      </div>
      <p className="model-routing-note">
        Model Lab 모델 구조 추출은 지정한 역할을 사용합니다. 기존 설정을 선택하면 Model Lab의 현재
        모델 선택을 유지합니다. 저장된 구조를 재사용할 때는 새 AI 호출이 없습니다.
      </p>
      <p className="model-routing-note">
        Briefing의 이메일 요약, 논문 요약 AI, 전역 AI 비서 대화, 빠른 1차 브리핑과 일정·할 일 초안은
        모두 여기서 지정한 모델로 실행합니다. Briefing에는 모델을 따로 고르는 곳이 없습니다.
        Briefing에서 AI 전달을 허용한 메일·일정 자료는 여기서 지정한 모델의 제공자에게 전달됩니다.
        역할의 모델이 미지정이면 그 루틴이 전에 쓰던 모델로 실행합니다. Project Chat에서는 채팅에서
        직접 고른 모델이 우선합니다. 저장된 요약은 다시 생성하지 않습니다.
      </p>
      {(error || message || (!loading && issue)) && (
        <p role="status">{error || message || issue}</p>
      )}
      <footer>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void onRefresh()}
        >
          모델 목록 새로고침
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={loading || busy || !!issue || JSON.stringify(draft) === JSON.stringify(policy)}
          onClick={async () => {
            setBusy(true);
            setMessage('');
            try {
              await onSave(draft);
              setMessage('저장됨 · 다음 새 작업부터 적용');
            } catch {
              setMessage('설정을 저장하지 못했습니다. 기존 설정을 유지합니다.');
            } finally {
              setBusy(false);
            }
          }}
        >
          모델 사용 설정 저장
        </button>
      </footer>
    </article>
  );
}
export function useModelRouting() {
  const [policy, setPolicy] = useState(defaultModelRouting),
    [ready, setReady] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!window.gosu.briefingLab?.getModelRouting) return;
    void window.gosu.briefingLab
      .getModelRouting()
      .then((value) => {
        if (active) {
          setPolicy(value);
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setError('모델 사용 설정을 읽지 못했습니다. 새 기본 모델 작업을 시작하지 않습니다.');
      });
    return () => {
      active = false;
    };
  }, []);
  return {
    policy,
    ready,
    error,
    save: async (next: ModelRouting) => {
      const saved = await window.gosu.briefingLab.setModelRouting(next);
      setPolicy(saved);
      setReady(true);
      setError(null);
    },
  };
}
