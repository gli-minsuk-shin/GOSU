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
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Archived study',
      slug: 'archived-study',
      archivedAt: '2026-08-04T00:30:00.000Z',
      version: 2,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:30:00.000Z',
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

function renderSettings(
  initialCategory: 'appearance' | 'board' | 'projects' | 'servers' | 'agent',
  agentProfile = defaultProjectChatProfile(snapshot.projects[0]!.id),
) {
  return renderToStaticMarkup(
    <SettingsView
      preferences={DEFAULT_USER_PREFERENCES}
      onChange={vi.fn()}
      workspaceSnapshot={snapshot}
      busyAction={null}
      chatBusyProjectIds={new Set()}
      onRenameProject={vi.fn()}
      onSetProjectArchived={vi.fn()}
      onTrashProject={vi.fn()}
      onRestoreProject={vi.fn()}
      agentProject={snapshot.projects[0]}
      agentProfile={agentProfile}
      agentProfileLoading={false}
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
          recommendedReasoningOptionId: 'medium',
        },
        {
          id: 'auto',
          displayName: 'Provider Auto Mode',
          recommendedModelId: null,
          recommendedReasoningOptionId: null,
        },
      ]}
      vault={null}
      vaultState="ready"
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

  it('shows active, archived, and recoverable Trash projects without permanent deletion', () => {
    const html = renderSettings('projects');

    expect(html).toContain('ACTIVE PROJECTS');
    expect(html).toContain('Active study');
    expect(html).toContain('Move to Trash');
    expect(html).toContain('Archive');
    expect(html).toContain('Archived study');
    expect(html).toContain('Restore to active');
    expect(html).toContain('Recoverable study');
    expect(html).toContain('1 tasks');
    expect(html).toContain('Restore');
    expect(html).toContain('does not permanently delete projects');
    expect(html).not.toContain('Delete permanently');
  });

  it('separates native Codex mode, personality, context, and project instructions from model choice', () => {
    const html = renderSettings('agent');

    expect(html).toContain('NATIVE CODEX HARNESS');
    expect(html).toContain('Default');
    expect(html).toContain('Plan');
    expect(html).toContain('Provider Auto Mode');
    expect(html).toContain('Answer verbosity');
    expect(html).toContain('Personality');
    expect(html).toContain('Local context scope');
    expect(html).toContain('WEB SEARCH');
    expect(html).toContain('Cached (recommended)');
    expect(html).toContain('Live');
    expect(html).toContain('Disabled');
    expect(html).toContain('does not enable shell networking, the browser, MCP servers');
    expect(html).toContain('PROJECT INSTRUCTIONS');
    expect(html).toContain('RESEARCH NOTES ACCESS');
    expect(html).toContain('Authorize reads and create-only automatic Markdown saves');
    expect(html).toContain('create reusable Markdown deliverables');
    expect(html).toContain('without asking on every task');
    expect(html).toContain('Listing notes sends their display titles and opaque IDs');
    expect(html).toContain('content SHA-256, offset, and total character');
    expect(html).toContain('A different existing file is never overwritten');
    expect(html).toContain('newly created Markdown body');
    expect(html).toContain('Codex sandbox: project-bound reads');
    expect(html).toContain('no direct shell, filesystem, raw network, browser');
    expect(html).toContain('foreground Python');
    expect(html).toContain('experiments are limited to 120 seconds');
    expect(html).toContain('Raw shells, inline Python');
  });

  it('offers detection-only OpenClaw and Hermes add-ons without claiming a connection', () => {
    const html = renderSettings('agent');

    expect(html).toContain('OPTIONAL AGENT ADD-ONS');
    expect(html).toContain('OpenClaw');
    expect(html).toContain('Hermes Agent');
    expect(html).toContain('Detect local installation');
    expect(html).toContain('without running it');
    expect(html).toContain('No installer, credentials, process launch, chat routing');
    expect(html).not.toContain('Connected to OpenClaw');
    expect(html).not.toContain('Connected to Hermes');
  });

  it('offers persisted manual through ten-minute server refresh choices', () => {
    const html = renderSettings('servers');

    expect(html).toContain('SERVER MONITORING');
    expect(html).toContain('Manual');
    expect(html).toContain('30 seconds');
    expect(html).toContain('1 minute');
    expect(html).toContain('5 minutes');
    expect(html).toContain('10 minutes');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('only while Connections or Project Chat is visible');
    const selectedChoice = html
      .match(/<button[^>]*aria-pressed="true"[^>]*>.*?<\/button>/g)
      ?.find((button) => button.includes('1 minute'));
    expect(selectedChoice).toContain('<strong>1 minute</strong>');
  });

  it('keeps a migrated Reviewer profile in compatibility mode until a native mode is chosen', () => {
    const html = renderSettings('agent', {
      ...defaultProjectChatProfile(snapshot.projects[0]!.id),
      harnessMode: 'reviewer',
      collaborationModeId: 'default',
    });

    expect(html).toContain('Legacy Reviewer · choose a native mode to leave');
  });
});
