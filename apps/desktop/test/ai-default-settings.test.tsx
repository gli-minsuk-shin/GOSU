import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  AiDefaultSettings,
  canSaveDefaultAiSelection,
  defaultAiSettingsViewState,
  describeDefaultAiSelectionIssue,
} from '../src/renderer/src/ai-default-settings';
import { DEFAULT_AI_SELECTION } from '../src/renderer/src/user-preferences';

const models = [
  {
    providerId: 'codex',
    modelId: 'provider-default',
    displayName: 'Codex Default',
    isDefault: true,
    reasoningOptions: [
      { id: 'medium', label: 'Medium', isDefault: false },
      { id: 'high', label: 'High', isDefault: true },
    ],
  },
  {
    providerId: 'codex',
    modelId: 'explicit-model',
    displayName: 'Codex Explicit',
    isDefault: false,
    reasoningOptions: [
      { id: 'high', label: 'High', isDefault: true },
      { id: 'ultra', label: 'Ultra', isDefault: false },
    ],
  },
  {
    providerId: 'hermes',
    modelId: 'hermes-local',
    displayName: 'Hermes Local',
    isDefault: false,
    reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
  },
] as const;

function render(selection = DEFAULT_AI_SELECTION, loading = false) {
  return renderToStaticMarkup(
    <AiDefaultSettings
      selection={selection}
      models={models}
      modelsLoading={loading}
      onRefreshModels={vi.fn()}
      onSave={vi.fn()}
    />,
  );
}

describe('default AI Settings', () => {
  it('shows Auto with the saved high reasoning and only the Codex catalog', () => {
    const html = render();

    expect(html).toContain('Choose the default model and reasoning');
    expect(html).toContain('Auto · provider default');
    expect(html).toContain('value="high" selected=""');
    expect(html).toContain('Codex Explicit');
    expect(html).not.toContain('Hermes Local');
    expect(html).toContain('Refresh models');
    expect(html).toContain('Save defaults');
    expect(html).toContain('new Project Chat sessions, new Lecture Studios, and general AI');
    expect(html).toContain('Existing scoped choices and generated revisions remain unchanged');
    expect(html).toContain('No silent fallback');
  });

  it('keeps a missing saved model visible and blocks saving it', () => {
    const selection = { modelId: 'retired-model', reasoningOptionId: 'high' } as const;
    const html = render(selection);
    const state = defaultAiSettingsViewState(selection, models);

    expect(state.issue).toBe('model_unavailable');
    expect(describeDefaultAiSelectionIssue(state)).toContain('not in the current Codex catalog');
    expect(html).toContain('Unavailable saved model · retired-model');
    expect(html).toContain('Saved default is unavailable');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('class="primary-button" disabled=""');
  });

  it('keeps a missing reasoning choice visible instead of silently downgrading it', () => {
    const selection = { modelId: 'explicit-model', reasoningOptionId: 'maximum' } as const;
    const html = render(selection);
    const state = defaultAiSettingsViewState(selection, models);

    expect(state.issue).toBe('reasoning_unavailable');
    expect(describeDefaultAiSelectionIssue(state)).toContain('not available for this model');
    expect(html).toContain('Unavailable saved reasoning · maximum');
    expect(html).toContain('value="maximum" selected=""');
  });

  it('allows saving only a changed selection that resolves exactly in the live catalog', () => {
    const saved = DEFAULT_AI_SELECTION;
    const validDraft = { modelId: 'explicit-model', reasoningOptionId: 'ultra' } as const;
    const missingDraft = { modelId: 'retired-model', reasoningOptionId: 'high' } as const;

    expect(
      canSaveDefaultAiSelection(
        validDraft,
        saved,
        defaultAiSettingsViewState(validDraft, models),
        false,
      ),
    ).toBe(true);
    expect(
      canSaveDefaultAiSelection(saved, saved, defaultAiSettingsViewState(saved, models), false),
    ).toBe(false);
    expect(
      canSaveDefaultAiSelection(
        missingDraft,
        saved,
        defaultAiSettingsViewState(missingDraft, models),
        false,
      ),
    ).toBe(false);
    expect(
      canSaveDefaultAiSelection(
        validDraft,
        saved,
        defaultAiSettingsViewState(validDraft, models),
        true,
      ),
    ).toBe(false);
  });

  it('exposes accessible labels and a compact responsive layout', () => {
    const html = render(DEFAULT_AI_SELECTION, true);
    const styles = readFileSync(
      new URL('../src/renderer/src/ai-default-settings.css', import.meta.url),
      'utf8',
    );

    expect(html).toContain('for="ai-default-model"');
    expect(html).toContain('for="ai-default-reasoning"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Checking models…');
    expect(html).toContain('Refreshing…');
    expect(html).toContain('Auto · checking provider default…');
    expect(html).not.toContain('Saved default is unavailable');
    expect(styles).toMatch(/\.ai-default-form\s*\{[^}]*grid-template-columns:/su);
    expect(styles).toContain('@media (max-width: 760px)');
  });
});
