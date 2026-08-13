import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SettingsView } from '../src/renderer/src/settings-view';
import { DEFAULT_USER_PREFERENCES } from '../src/renderer/src/user-preferences';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';
import type { LectureStudioListSnapshot } from '../src/shared/lecture-studio-contracts';
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
      archivedAt: '2026-08-04T01:30:00.000Z',
      version: 1,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      projectId: '11111111-1111-4111-8111-111111111111',
      title: 'Deleted Board task',
      status: 'planned',
      archivedAt: '2026-08-04T02:00:00.000Z',
      version: 2,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T02:00:00.000Z',
    },
    {
      id: '77777777-7777-4777-8777-777777777777',
      projectId: '44444444-4444-4444-8444-444444444444',
      title: 'Archived-project task',
      status: 'review',
      archivedAt: '2026-08-04T02:30:00.000Z',
      version: 3,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T02:30:00.000Z',
    },
  ],
  objectives: [],
};

const lectureTrashSnapshot: LectureStudioListSnapshot = {
  schemaVersion: 1,
  studios: [
    {
      schemaVersion: 1,
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Recoverable lecture',
      kind: 'lecture',
      durationMinutes: null,
      outputProjectId: snapshot.projects[0]!.id,
      status: 'idle',
      activeAttemptId: null,
      currentRevision: 3,
      version: 4,
      lastErrorCode: null,
      trashedAt: '2026-08-04T03:00:00.000Z',
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T03:00:00.000Z',
    },
  ],
};

function renderSettings(
  initialCategory: 'appearance' | 'board' | 'projects' | 'trash' | 'servers' | 'agent',
  agentProfile = defaultProjectChatProfile(snapshot.projects[0]!.id),
  lectureSnapshot: LectureStudioListSnapshot | null = lectureTrashSnapshot,
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
      onEmptyProjectTrash={vi.fn()}
      lectureTrashSnapshot={lectureSnapshot}
      lectureTrashState={lectureSnapshot ? 'ready' : 'loading'}
      onRetryLectureTrash={vi.fn()}
      onRestoreLectureStudio={vi.fn()}
      onEmptyLectureStudioTrash={vi.fn()}
      onRestoreTask={vi.fn()}
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

  it('keeps project lifecycle controls separate from the unified Trash manager', () => {
    const html = renderSettings('projects');

    expect(html).toContain('ACTIVE PROJECTS');
    expect(html).toContain('Active study');
    expect(html).toContain('Move to Trash');
    expect(html).toContain('Archive');
    expect(html).toContain('Archived study');
    expect(html).toContain('Restore to active');
    expect(html).not.toContain('Recoverable study');
    expect(html).not.toContain('Permanently remove trashed projects');
  });

  it('manages project, Lecture Studio, and Board task trash from one Trash category', () => {
    const html = renderSettings('trash');

    expect(html).toContain('<strong>Trash</strong>');
    expect(html).not.toContain('<strong>Lecture Trash</strong>');
    expect(html).toContain('Projects in Trash');
    expect(html).toContain('Recoverable study');
    expect(html).toContain('Permanently remove trashed projects');
    expect(html).toContain('Lecture Studios in Trash');
    expect(html).toContain('Recoverable lecture');
    expect(html).toContain('Permanently remove trashed Lecture Studios');
    expect(html).toContain('Deleted Board tasks');
    expect(html).toContain('Deleted Board task');
    expect(html).toContain('Archived-project task');
    expect(html).toContain('Restore the parent project to active projects first');
    expect(html).toContain('Parent project is archived. Restore it to Active in Projects');
    expect(html).toContain('aria-describedby="trash-task-help-');
    expect(html).not.toContain('Preserved task');
    expect(html).toContain('4 items in Trash');
    expect(html).toContain('1 project · 1 Lecture Studio · 2 Board tasks');
    expect(html).toContain('does not currently permanently purge individual');
  });

  it('keeps project and task Trash usable while Lecture Studios are still loading', () => {
    const html = renderSettings('trash', defaultProjectChatProfile(snapshot.projects[0]!.id), null);

    expect(html).toContain('3 items currently shown');
    expect(html).toContain('Recoverable study');
    expect(html).toContain('Deleted Board task');
    expect(html).toContain('Lecture Studios loading');
    expect(html).toContain('Loading Lecture Studios…');
  });

  it('surfaces Lecture Trash load failure without hiding project and task recovery', () => {
    const html = renderToStaticMarkup(
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
        onEmptyProjectTrash={vi.fn()}
        lectureTrashSnapshot={null}
        lectureTrashState="error"
        onRetryLectureTrash={vi.fn()}
        onRestoreLectureStudio={vi.fn()}
        onEmptyLectureStudioTrash={vi.fn()}
        onRestoreTask={vi.fn()}
        agentProject={snapshot.projects[0]}
        agentProfile={defaultProjectChatProfile(snapshot.projects[0]!.id)}
        agentProfileLoading={false}
        collaborationModes={[]}
        vault={null}
        vaultState="ready"
        onUpdateAgentProfile={vi.fn()}
        initialCategory="trash"
      />,
    );

    expect(html).toContain('Lecture Studios could not be loaded');
    expect(html).toContain('Lecture Studios unavailable');
    expect(html).toContain('Recoverable study');
    expect(html).toContain('Deleted Board task');
    expect(html).toContain('Retry');
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

  it('keeps OpenClaw detection-only and offers an explicit BYO Hermes connection', () => {
    const html = renderSettings('agent');

    expect(html).toContain('OPTIONAL AGENT ADD-ONS');
    expect(html).toContain('OpenClaw');
    expect(html).toContain('Hermes Agent');
    expect(html).toContain('Detect local installation');
    expect(html).toContain('without running it');
    expect(html).toContain('Connect existing Hermes (BYO)');
    expect(html).toContain('GOSU neither copies nor synchronizes its credentials');
    expect(html).toContain('Hermes is optional, local, and never an automatic fallback');
    expect(html).toContain('native tool surface is disabled');
    expect(html).toContain('Hermes turns do not show tool approval prompts');
    expect(html).toContain('Terminal, processes, code execution, files, web, browser automation');
    expect(html).toContain('OpenClaw remains detection-only');
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
