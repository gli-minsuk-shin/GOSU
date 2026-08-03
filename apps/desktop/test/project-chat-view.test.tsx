import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProjectChatView } from '../src/renderer/src/project-chat-view';
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
          },
        ]}
        selectedModel="fixture-live-model"
        selectedReasoning="provider-high"
        applyingActionId={null}
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
    expect(html).toContain('Copilot');
    expect(html).toContain('Planner');
    expect(html).toContain('Reviewer');
    expect(html).toContain('Response depth');
    expect(html).toContain('Board + Objective');
    expect(html).toContain('No shell · no files · no network · no tools · no subagents');
    expect(html).toContain('Edit in Settings…');
  });
});
