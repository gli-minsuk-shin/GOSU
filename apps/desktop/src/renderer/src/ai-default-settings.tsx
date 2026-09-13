import { uiText, useUiText } from '@gosu/ui/language';

import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { CodexModel } from './connections-view';
import { resolveDefaultAiSelection } from './default-ai-selection';
import type { DefaultAiSelection } from './user-preferences';
import './ai-default-settings.css';

type Operation = 'refresh' | 'save' | null;

function uniqueModels(models: readonly CodexModel[]) {
  const counts = new Map<string, number>();
  for (const model of models) counts.set(model.modelId, (counts.get(model.modelId) ?? 0) + 1);
  return models.filter((model) => counts.get(model.modelId) === 1);
}

export type DefaultAiSettingsViewState = Readonly<{
  catalog: readonly CodexModel[];
  availableModels: readonly CodexModel[];
  selectedModel: CodexModel | null;
  autoAvailable: boolean;
  modelUnavailable: boolean;
  reasoningUnavailable: boolean;
  issue: 'model_unavailable' | 'reasoning_unavailable' | null;
}>;

export function defaultAiSettingsViewState(
  selection: DefaultAiSelection,
  models: readonly CodexModel[],
): DefaultAiSettingsViewState {
  const catalog = models;
  const availableModels = uniqueModels(catalog);
  const defaultModels = catalog.filter((model) => model.isDefault);
  const explicitMatches = selection.modelId
    ? catalog.filter(
        (model) =>
          model.modelId === selection.modelId &&
          (model.providerId ?? 'codex') === selection.providerId,
      )
    : [];
  const selectedModel =
    selection.modelId === null
      ? defaultModels.length === 1
        ? defaultModels[0]!
        : null
      : explicitMatches.length === 1
        ? explicitMatches[0]!
        : null;
  const resolution = resolveDefaultAiSelection(selection, catalog);

  return {
    catalog,
    availableModels,
    selectedModel,
    autoAvailable: defaultModels.length === 1,
    modelUnavailable: resolution.issue === 'model_unavailable',
    reasoningUnavailable: resolution.issue === 'reasoning_unavailable',
    issue: resolution.issue,
  };
}

export function describeDefaultAiSelectionIssue(
  state: Pick<DefaultAiSettingsViewState, 'modelUnavailable' | 'reasoningUnavailable'>,
) {
  if (state.modelUnavailable) {
    return 'The saved model is not in the current connected-provider catalog. Choose an available model or refresh the catalog before saving.';
  }
  if (state.reasoningUnavailable) {
    return 'The saved reasoning level is not available for this model. Choose an available level or refresh the catalog before saving.';
  }
  return null;
}

export function canSaveDefaultAiSelection(
  draft: DefaultAiSelection,
  saved: DefaultAiSelection,
  state: Pick<DefaultAiSettingsViewState, 'issue'>,
  busy: boolean,
) {
  return (
    !busy &&
    state.issue === null &&
    (draft.providerId !== saved.providerId ||
      draft.modelId !== saved.modelId ||
      draft.reasoningOptionId !== saved.reasoningOptionId)
  );
}

export function AiDefaultSettings({
  fallbackOnly = false,
  selection,
  models,
  modelsLoading,
  onRefreshModels,
  onSave,
}: {
  fallbackOnly?: boolean;
  selection: DefaultAiSelection;
  models: readonly CodexModel[];
  modelsLoading: boolean;
  onRefreshModels: () => void | Promise<void>;
  onSave: (selection: DefaultAiSelection) => void | Promise<void>;
}) {
  useUiText();
  const [draft, setDraft] = useState<DefaultAiSelection>(selection);
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(selection);
  }, [selection.modelId, selection.providerId, selection.reasoningOptionId]);

  const view = useMemo(() => defaultAiSettingsViewState(draft, models), [draft, models]);
  const issue = describeDefaultAiSelectionIssue(view);
  const displayedIssue = modelsLoading ? null : issue;
  const dirty =
    draft.providerId !== selection.providerId ||
    draft.modelId !== selection.modelId ||
    draft.reasoningOptionId !== selection.reasoningOptionId;
  const busy = modelsLoading || operation !== null;
  const modelOptionMissing = draft.modelId !== null && view.modelUnavailable;
  const reasoningOptions = view.selectedModel?.reasoningOptions ?? [];
  const reasoningOptionMissing =
    draft.reasoningOptionId !== null &&
    !reasoningOptions.some((option) => option.id === draft.reasoningOptionId);
  const canSave = canSaveDefaultAiSelection(draft, selection, view, busy);

  const refresh = async () => {
    if (busy) return;
    setOperation('refresh');
    setError(null);
    try {
      await onRefreshModels();
    } catch {
      // DesktopApp owns the authoritative Codex connection status and recovery message.
    } finally {
      setOperation(null);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setOperation('save');
    setError(null);
    try {
      await onSave(draft);
    } catch {
      setError(uiText('The default AI selection could not be saved. Try again.'));
    } finally {
      setOperation(null);
    }
  };

  const status = modelsLoading
    ? 'Checking models…'
    : view.issue
      ? 'Needs attention'
      : dirty
        ? 'Unsaved changes'
        : 'Current default';

  return (
    <article className="settings-card ai-default-settings-card">
      <div className="settings-card-heading ai-default-settings-heading">
        <div>
          <span>{uiText('DEFAULT AI')}</span>
          <h2>
            {fallbackOnly
              ? '역할 미지정 시 기본 모델'
              : uiText('Choose the default Project Chat model and reasoning')}
          </h2>
          <p>
            {fallbackOnly
              ? '위의 역할별 모델을 지정하지 않았거나 사용처에서 기존 설정을 선택했을 때 사용합니다. 기존 대화의 선택은 바꾸지 않습니다.'
              : uiText(
                  'These defaults apply to new Project Chat sessions. Lecture Studios and other Codex-native surfaces retain their own provider-compatible defaults. Existing scoped choices remain unchanged.',
                )}
          </p>
        </div>
        <span
          className={`ai-default-status${displayedIssue ? ' state-warning' : ''}`}
          role="status"
          aria-live="polite"
        >
          {uiText(status)}
        </span>
      </div>

      {error && (
        <div className="error-banner ai-default-message" role="alert">
          {error}
        </div>
      )}
      {displayedIssue && (
        <div className="ai-default-unavailable" id="ai-default-selection-issue" role="alert">
          <strong>{uiText('Saved default is unavailable')}</strong>
          <span>{uiText(displayedIssue)}</span>
        </div>
      )}

      <form className="ai-default-form" onSubmit={(event) => void save(event)}>
        <label htmlFor="ai-default-model">
          {uiText('Model')}
          <select
            id="ai-default-model"
            value={draft.modelId ?? ''}
            disabled={busy}
            aria-invalid={(!modelsLoading && view.modelUnavailable) || undefined}
            aria-describedby={
              displayedIssue ? 'ai-default-selection-issue' : 'ai-default-scope-note'
            }
            onChange={(event) => {
              const selectedModel = view.availableModels.find(
                (model) => model.modelId === event.target.value,
              );
              setDraft((current) => ({
                ...current,
                providerId: selectedModel ? (selectedModel.providerId ?? 'codex') : null,
                modelId: event.target.value === '' ? null : event.target.value,
              }));
              setError(null);
            }}
          >
            {modelOptionMissing && (
              <option value={draft.modelId!}>
                {modelsLoading
                  ? uiText('Saved model (checking)')
                  : uiText('Unavailable saved model')}{' '}
                · {draft.modelId}
              </option>
            )}
            <option value="" disabled={!view.autoAvailable}>
              {modelsLoading
                ? uiText('Auto · checking provider default…')
                : view.autoAvailable
                  ? uiText('Auto · provider default')
                  : uiText('Auto · provider default unavailable')}
            </option>
            {view.availableModels.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.displayName}
                {model.isDefault ? uiText(' · provider default') : ''}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="ai-default-reasoning">
          {uiText('Reasoning')}
          <select
            id="ai-default-reasoning"
            value={draft.reasoningOptionId ?? ''}
            disabled={busy || view.selectedModel === null}
            aria-invalid={(!modelsLoading && view.reasoningUnavailable) || undefined}
            aria-describedby={
              displayedIssue ? 'ai-default-selection-issue' : 'ai-default-scope-note'
            }
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                reasoningOptionId: event.target.value === '' ? null : event.target.value,
              }));
              setError(null);
            }}
          >
            {reasoningOptionMissing && (
              <option value={draft.reasoningOptionId!}>
                {modelsLoading
                  ? uiText('Saved reasoning (checking)')
                  : uiText('Unavailable saved reasoning')}{' '}
                · {draft.reasoningOptionId}
              </option>
            )}
            <option value="">{uiText('Model default')}</option>
            {reasoningOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {uiText(option.label)}
                {option.isDefault ? uiText(' · model default') : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="ai-default-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {operation === 'refresh' || modelsLoading
              ? uiText('Refreshing…')
              : uiText('Refresh models')}
          </button>
          <button type="submit" className="primary-button" disabled={!canSave}>
            {operation === 'save' ? uiText('Saving…') : uiText('Save defaults')}
          </button>
        </div>
      </form>

      <div className="ai-default-scope-note" id="ai-default-scope-note">
        <strong>{uiText('No silent fallback')}</strong>
        <span>
          {uiText(
            'If a saved model or reasoning level disappears from its connected provider, GOSU keeps the missing choice visible and stops new Project Chat work from using that default until you explicitly save an available one.',
          )}
        </span>
      </div>
    </article>
  );
}
