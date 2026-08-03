import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProjectChatView, resolveEffectiveCodexModel } from '../src/renderer/src/project-chat-view';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Agentic study',
  slug: 'agentic-study',
  version: 1,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
} as const;

describe('advanced Project Chat controls', () => {
  it('resolves Auto through the selected native mode before the provider default', () => {
    const models = [
      {
        modelId: 'provider-default',
        displayName: 'Provider default',
        isDefault: true,
        reasoningOptions: [{ id: 'low', label: 'Low', isDefault: true }],
      },
      {
        modelId: 'mode-recommended',
        displayName: 'Mode recommended',
        isDefault: false,
        reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
        supportsPersonality: true,
      },
    ];
    const modes = [
      {
        id: 'future-mode',
        displayName: 'Future mode',
        recommendedModelId: 'mode-recommended',
        recommendedReasoningOptionId: 'high',
      },
    ];

    expect(resolveEffectiveCodexModel(models, modes, null, 'future-mode')?.modelId).toBe(
      'mode-recommended',
    );
    expect(
      resolveEffectiveCodexModel(models, modes, 'provider-default', 'future-mode')?.modelId,
    ).toBe('provider-default');
  });

  it('exposes dynamic reasoning separately from the bounded project harness', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight={false}
        models={[
          {
            modelId: 'fixture-live-model',
            displayName: 'Fixture live model',
            isDefault: true,
            reasoningOptions: [{ id: 'provider-high', label: 'Provider high', isDefault: false }],
            supportsPersonality: true,
          },
        ]}
        collaborationModes={[
          {
            id: 'default',
            displayName: 'Default',
            recommendedModelId: null,
            recommendedReasoningOptionId: null,
          },
          {
            id: 'plan',
            displayName: 'Plan',
            recommendedModelId: null,
            recommendedReasoningOptionId: 'provider-high',
          },
          {
            id: 'auto',
            displayName: 'Provider Auto Mode',
            recommendedModelId: null,
            recommendedReasoningOptionId: null,
          },
        ]}
        selectedModel="fixture-live-model"
        selectedReasoning="provider-high"
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
        initialAdvancedOpen
      />,
    );

    expect(html).toContain('Fixture live model');
    expect(html).toContain('Provider high');
    expect(html).toContain('Advanced agent controls');
    expect(html).toContain('Default');
    expect(html).toContain('Plan');
    expect(html).toContain('Provider Auto Mode');
    expect(html).toContain('<option value="" selected="">Auto · Codex default</option>');
    expect(html).toContain('<option value="auto">Provider Auto Mode</option>');
    expect(html).toContain('Native modes are discovered from the local Codex App Server');
    expect(html).toContain('Answer verbosity');
    expect(html).toContain('Personality');
    expect(html).toContain('Board + Objective');
    expect(html).toContain('Board + Objective read tools');
    expect(html).toContain('Local Notes not authorized');
    expect(html).toContain('Authorize…');
    expect(html).toContain('no shell/network/arbitrary files');
    expect(html).toContain('Edit in Settings…');
  });

  it('pauses a saved Local Notes grant while Main-process capability status is unavailable', () => {
    const profile = {
      ...defaultProjectChatProfile(project.id),
      localNotesVault: { id: 'a'.repeat(64), name: 'Research Vault' },
    };
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile,
        }}
        loading={false}
        inFlight={false}
        models={[]}
        collaborationModes={[]}
        selectedModel={null}
        selectedReasoning={null}
        applyingActionId={null}
        vault={null}
        vaultState="unavailable"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('Local Notes status unavailable');
    expect(html).toContain('This turn is paused to prevent a hidden grant mismatch.');
    expect(html).not.toContain('Authorize…');
  });
});
