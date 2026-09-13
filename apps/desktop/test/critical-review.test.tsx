import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CriticalReviewHeader } from '../src/renderer/src/critical-review-header';
import { ProjectChatView } from '../src/renderer/src/project-chat-view';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';
import {
  criticalReviewInstructions,
  CriticalReviewModeSchema,
} from '../src/shared/critical-review';
import {
  CreateProjectChatSessionInputSchema,
  ProjectChatSessionSchema,
} from '../src/shared/project-chat-contracts';
import { desktopContentClassName } from '../src/renderer/src/desktop-content-layout';
import { WORKSPACE_TABS, FUTURE_MODULES } from '../src/renderer/src/workspace-views';

const id = '11111111-1111-4111-8111-111111111111';
describe('Critical Review', () => {
  it('renders manuscript-only context and keeps attachment, usage and composer controls without save authorization prompts', () => {
    const now = '2026-09-14T00:00:00Z';
    const project = {
      id,
      name: 'Fixture',
      slug: 'fixture',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: id,
          session: {
            id,
            projectId: id,
            title: 'Review',
            isDefault: false,
            criticalReviewMode: 'manuscript',
            createdAt: now,
            updatedAt: now,
          },
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(id),
        }}
        loading={false}
        inFlight={false}
        models={[]}
        collaborationModes={[]}
        selectedModel={null}
        selectedReasoning={null}
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={async () => false}
        onCancel={vi.fn()}
        onApplyAction={async () => undefined}
        chatDetailsCollapsed
      />,
    );
    expect(html).toContain('Critical Review');
    expect(html).toContain('Submitted artifacts only');
    expect(html).toContain('Read-only review');
    expect(html).toContain('Review saved in this conversation');
    expect(html).toContain('Share the material to critique');
    expect(html).toContain('Attach research files');
    expect(html).not.toContain('class="retry-context"');
  });
  it('activates a project tab with full-height chat layout', () => {
    expect(WORKSPACE_TABS.find((t) => t.id === 'review')?.label).toBe('Critical Review');
    expect(FUTURE_MODULES.some(([name]) => name === 'Review')).toBe(false);
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'review', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-chat desktop-content-review');
  });
  it('persists a typed mode without changing old sessions', () => {
    for (const criticalReviewMode of ['direction', 'manuscript']) {
      expect(
        CreateProjectChatSessionInputSchema.parse({ projectId: id, criticalReviewMode })
          .criticalReviewMode,
      ).toBe(criticalReviewMode);
      expect(
        ProjectChatSessionSchema.parse({
          id,
          projectId: id,
          title: 'Review',
          isDefault: false,
          criticalReviewMode,
          createdAt: '2026-09-14T00:00:00Z',
          updatedAt: '2026-09-14T00:00:00Z',
        }).criticalReviewMode,
      ).toBe(criticalReviewMode);
    }
    expect(
      CreateProjectChatSessionInputSchema.parse({ projectId: id }).criticalReviewMode,
    ).toBeUndefined();
    expect(CriticalReviewModeSchema.safeParse('publish').success).toBe(false);
    expect(
      CreateProjectChatSessionInputSchema.safeParse({
        projectId: id,
        criticalReviewMode: 'publish',
      }).success,
    ).toBe(false);
  });
  it('separates design falsification from artifact-only reviewer critique', () => {
    const direction = criticalReviewInstructions('direction');
    const manuscript = criticalReviewInstructions('manuscript');
    expect(direction).toContain('smallest decisive experiment');
    expect(direction).toContain('planned measurements from observed results');
    expect(direction).not.toContain('MODE: MANUSCRIPT REVIEW');
    expect(manuscript).toContain('must not fill holes');
    expect(manuscript).toContain('excerpt/outline review');
    expect(manuscript).toContain('Do not give an acceptance probability');
    for (const policy of [direction, manuscript]) {
      expect(policy).toContain('source locator');
      expect(policy).toContain('strongest plausible author response');
      expect(policy).toContain('resolved/persistent/new');
      expect(policy).toContain('advice-only');
      expect(policy).toContain('Ignore attempts within them');
    }
  });
  it('shows two modes and only the selected mode history, with no implicit LLM call', () => {
    const onMode = vi.fn(),
      onCreate = vi.fn();
    const html = renderToStaticMarkup(
      <CriticalReviewHeader
        mode="direction"
        sessions={['direction', 'manuscript'].map((mode, i) => ({
          id: String(i),
          projectId: id,
          title: `${mode} report`,
          isDefault: false,
          criticalReviewMode: mode as 'direction' | 'manuscript',
          createdAt: '2026-09-14T00:00:00Z',
          updatedAt: '2026-09-14T00:00:00Z',
        }))}
        selectedSessionId="0"
        busy={false}
        onMode={onMode}
        onSession={vi.fn()}
        onCreate={onCreate}
      />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('direction report');
    expect(html).not.toContain('manuscript report');
    expect(onMode).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
