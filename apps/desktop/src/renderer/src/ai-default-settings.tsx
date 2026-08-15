import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { CodexModel } from './connections-view';
import { resolveDefaultAiSelection } from './default-ai-selection';
import type { DefaultAiSelection } from './user-preferences';
import './ai-default-settings.css';

type Operation = 'refresh' | 'save' | null;

function codexOnlyModels(models: readonly CodexModel[]) {
  return models.filter((model) => model.providerId === undefined || model.providerId === 'codex');
}

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
  const catalog = codexOnlyModels(models);
  const availableModels = uniqueModels(catalog);
  const defaultModels = catalog.filter((model) => model.isDefault);
  const explicitMatches = selection.modelId
    ? catalog.filter((model) => model.modelId === selection.modelId)
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
    return 'The saved model is not in the current Codex catalog. Choose an available model or refresh the catalog before saving.';
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
    (draft.modelId !== saved.modelId || draft.reasoningOptionId !== saved.reasoningOptionId)
  );
}

export function AiDefaultSettings({
  selection,
  models,
  modelsLoading,
  onRefreshModels,
  onSave,
}: {
  selection: DefaultAiSelection;
  models: readonly CodexModel[];
  modelsLoading: boolean;
  onRefreshModels: () => void | Promise<void>;
  onSave: (selection: DefaultAiSelection) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<DefaultAiSelection>(selection);
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(selection);
  }, [selection.modelId, selection.reasoningOptionId]);

  const view = useMemo(() => defaultAiSettingsViewState(draft, models), [draft, models]);
  const issue = describeDefaultAiSelectionIssue(view);
  const displayedIssue = modelsLoading ? null : issue;
  const dirty =
    draft.modelId !== selection.modelId || draft.reasoningOptionId !== selection.reasoningOptionId;
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
      setError('The default AI selection could not be saved. Try again.');
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
          <span>DEFAULT AI</span>
          <h2>Choose the default model and reasoning</h2>
          <p>
            These defaults apply to new Project Chat sessions, new Lecture Studios, and general AI
            actions. Existing scoped choices and generated revisions remain unchanged.
          </p>
        </div>
        <span
          className={`ai-default-status${displayedIssue ? ' state-warning' : ''}`}
          role="status"
          aria-live="polite"
        >
          {status}
        </span>
      </div>

      {error && (
        <div className="error-banner ai-default-message" role="alert">
          {error}
        </div>
      )}
      {displayedIssue && (
        <div className="ai-default-unavailable" id="ai-default-selection-issue" role="alert">
          <strong>Saved default is unavailable</strong>
          <span>{displayedIssue}</span>
        </div>
      )}

      <form className="ai-default-form" onSubmit={(event) => void save(event)}>
        <label htmlFor="ai-default-model">
          Model
          <select
            id="ai-default-model"
            value={draft.modelId ?? ''}
            disabled={busy}
            aria-invalid={(!modelsLoading && view.modelUnavailable) || undefined}
            aria-describedby={
              displayedIssue ? 'ai-default-selection-issue' : 'ai-default-scope-note'
            }
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                modelId: event.target.value === '' ? null : event.target.value,
              }));
              setError(null);
            }}
          >
            {modelOptionMissing && (
              <option value={draft.modelId!}>
                {modelsLoading ? 'Saved model (checking)' : 'Unavailable saved model'} ·{' '}
                {draft.modelId}
              </option>
            )}
            <option value="" disabled={!view.autoAvailable}>
              {modelsLoading
                ? 'Auto · checking provider default…'
                : view.autoAvailable
                  ? 'Auto · provider default'
                  : 'Auto · provider default unavailable'}
            </option>
            {view.availableModels.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.displayName}
                {model.isDefault ? ' · provider default' : ''}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="ai-default-reasoning">
          Reasoning
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
                {modelsLoading ? 'Saved reasoning (checking)' : 'Unavailable saved reasoning'} ·{' '}
                {draft.reasoningOptionId}
              </option>
            )}
            <option value="">Model default</option>
            {reasoningOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
                {option.isDefault ? ' · model default' : ''}
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
            {operation === 'refresh' || modelsLoading ? 'Refreshing…' : 'Refresh models'}
          </button>
          <button type="submit" className="primary-button" disabled={!canSave}>
            {operation === 'save' ? 'Saving…' : 'Save defaults'}
          </button>
        </div>
      </form>

      <div className="ai-default-scope-note" id="ai-default-scope-note">
        <strong>No silent fallback</strong>
        <span>
          If a saved model or reasoning level disappears from Codex, GOSU keeps the missing choice
          visible and stops new default-based AI work until you explicitly save an available one.
        </span>
      </div>
    </article>
  );
}
