import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SettingsView } from '../src/renderer/src/settings-view';
import { DEFAULT_USER_PREFERENCES } from '../src/renderer/src/user-preferences';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';
import type { WorkspaceSnapshot } from '../src/shared/workspace-contracts';

const snapshot: WorkspaceSnapshot = {
  schemaVersion: 1,
  revision: 4,
  projects: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Active study',
      slug: 'active-study',
      version: 2,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Recoverable study',
      slug: 'recoverable-study',
      trashedAt: '2026-08-04T01:00:00.000Z',
      version: 3,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T01:00:00.000Z',
    },
  ],
  tasks: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      projectId: '22222222-2222-4222-8222-222222222222',
      title: 'Preserved task',
      status: 'backlog',
      version: 1,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
  ],
  objectives: [],
};

function renderSettings(initialCategory: 'appearance' | 'board' | 'projects' | 'agent') {
  return renderToStaticMarkup(
    <SettingsView
      preferences={DEFAULT_USER_PREFERENCES}
      onChange={vi.fn()}
      workspaceSnapshot={snapshot}
      busyAction={null}
      chatBusyProjectIds={new Set()}
      onRenameProject={vi.fn()}
      onTrashProject={vi.fn()}
      onRestoreProject={vi.fn()}
      agentProject={snapshot.projects[0]}
      agentProfile={defaultProjectChatProfile(snapshot.projects[0]!.id)}
      agentProfileLoading={false}
      onUpdateAgentProfile={vi.fn()}
      initialCategory={initialCategory}
    />,
  );
}

describe('separated application Settings', () => {
  it('keeps theme and readable font-size controls together under Appearance', () => {
    const html = renderSettings('appearance');

    expect(html).toContain('aria-label="Settings categories"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('FONT SIZE');
    expect(html).toContain('12 px base');
    expect(html).toContain('18 px base');
  });

  it('shows active projects and recoverable Trash without offering permanent deletion', () => {
    const html = renderSettings('projects');

    expect(html).toContain('ACTIVE PROJECTS');
    expect(html).toContain('Active study');
    expect(html).toContain('Move to Trash');
    expect(html).toContain('Recoverable study');
    expect(html).toContain('1 tasks');
    expect(html).toContain('Restore');
    expect(html).toContain('does not permanently delete projects');
    expect(html).not.toContain('Delete permanently');
  });

  it('separates harness, response depth, context, and project instructions from model choice', () => {
    const html = renderSettings('agent');

    expect(html).toContain('AGENT HARNESS');
    expect(html).toContain('Research copilot');
    expect(html).toContain('Planner');
    expect(html).toContain('Reviewer');
    expect(html).toContain('Response depth');
    expect(html).toContain('Local context scope');
    expect(html).toContain('PROJECT INSTRUCTIONS');
    expect(html).toContain('No shell · no file access · no network · no tools · no subagents');
  });
});
