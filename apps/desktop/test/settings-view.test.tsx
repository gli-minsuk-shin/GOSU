import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SettingsView, type SettingsCategory } from '../src/renderer/src/settings-view';
import type { OverleafPersonalTokenUiState } from '../src/renderer/src/overleaf-personal-token-ui';
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
} from '../src/renderer/src/user-preferences';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';
import {
  GOSU_LECTURE_STUDIO_STRUCTURE_TEMPLATE,
  type LectureStudioListSnapshot,
} from '../src/shared/lecture-studio-contracts';
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

const codexModels = [
  {
    providerId: 'codex',
    modelId: 'provider-default',
    displayName: 'Codex Default',
    isDefault: true,
    reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
  },
] as const;

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
  initialCategory: SettingsCategory,
  agentProfile = defaultProjectChatProfile(snapshot.projects[0]!.id),
  lectureSnapshot: LectureStudioListSnapshot | null = lectureTrashSnapshot,
  overleafPersonalTokenState: OverleafPersonalTokenUiState = 'configured',
  preferences: UserPreferences = DEFAULT_USER_PREFERENCES,
) {
  return renderToStaticMarkup(
    <SettingsView
      preferences={preferences}
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
      overleafPersonalTokenState={overleafPersonalTokenState}
      onRefreshOverleafPersonalToken={vi.fn()}
      onSaveOverleafPersonalToken={vi.fn()}
      onRemoveOverleafPersonalToken={vi.fn()}
      models={codexModels}
      modelsLoading={false}
      onRefreshModels={vi.fn()}
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

  it('adds one dedicated Lecture defaults category without changing the existing categories', () => {
    const html = renderSettings('lecture');
    const navigationLabels = [
      'Appearance',
      'Board defaults',
      'Lecture defaults',
      'Projects',
      'Trash',
      'Overleaf',
      'Servers',
      'AI Agent',
    ];

    for (const label of navigationLabels) {
      expect(html.match(new RegExp(`<strong>${label}</strong>`, 'gu'))).toHaveLength(1);
    }
    expect(html).toContain(
      '<button type="button" class="active" aria-current="page"><i aria-hidden="true">▤</i><strong>Lecture defaults</strong>',
    );
    expect(html).toContain('Notes &amp; slides structure');
  });

  it('shows adjustable workspace and project Lecture defaults without document locks', () => {
    const adaptiveHtml = renderSettings('lecture');
    expect(adaptiveHtml).toContain('LECTURE DEFAULTS');
    expect(adaptiveHtml).toContain('Choose default structure and document elements');
    expect(adaptiveHtml).toContain('Existing Studios and saved revisions do not change.');
    expect(adaptiveHtml).toContain('checked="" value="adaptive"');
    expect(adaptiveHtml).toContain('<strong>Current default</strong>');
    expect(adaptiveHtml).toContain('class="ghost-button" disabled="">Revert changes</button>');
    expect(adaptiveHtml).toContain('class="primary-button" disabled=""');
    expect(adaptiveHtml).toContain('>Save default structure</button>');
    expect(adaptiveHtml).toContain('Visible document elements');
    expect(adaptiveHtml).toContain('<option value="" selected="">Workspace</option>');
    expect(adaptiveHtml).toContain(
      `<option value="${snapshot.projects[0]!.id}">Active study</option>`,
    );
    expect(adaptiveHtml).not.toContain('>Archived study</option>');
    expect(adaptiveHtml.match(/type="checkbox"/gu)).toHaveLength(3);
    expect(adaptiveHtml).toContain('Show a title page in slides');
    expect(adaptiveHtml).toContain('Show source markers in notes and slides');
    expect(adaptiveHtml).toContain('Add a Sources used list to notes');
    expect(adaptiveHtml).toContain(
      'Hidden markers still retain the revision&#x27;s evidence record.',
    );
    expect(adaptiveHtml).not.toContain('Locked');
    expect(adaptiveHtml).toContain('>Save workspace defaults</button>');

    const customHtml = renderSettings(
      'lecture',
      defaultProjectChatProfile(snapshot.projects[0]!.id),
      lectureTrashSnapshot,
      'configured',
      {
        ...DEFAULT_USER_PREFERENCES,
        defaultLectureStructure: structuredClone(GOSU_LECTURE_STUDIO_STRUCTURE_TEMPLATE),
      },
    );
    expect(customHtml).toContain('checked="" value="custom"');
    expect(customHtml).toContain('6 sections');
    expect(customHtml).toContain('Overview and learning goals');
    expect(customHtml).toContain('Methods, examples, and comparisons');
    expect(customHtml).toContain('Load GOSU outline');

    const source = readFileSync(
      new URL('../src/renderer/src/settings-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain("| 'lecture'");
    expect(source).toContain("onClick={() => selectCategory('lecture')}");
    expect(source).toContain(
      'JSON.stringify(lectureStructureDraft) !== JSON.stringify(preferences.defaultLectureStructure)',
    );
    expect(source).toContain("lectureStructureDirty ? 'Unsaved changes' : 'Current default'");
    expect(source).toContain(
      'setLectureStructureDraft(structuredClone(preferences.defaultLectureStructure))',
    );
    expect(source).toContain('resetDisabled={!lectureStructureDirty}');
    expect(source).toContain('disabled={!lectureStructureDirty || !lectureStructureValid}');
    expect(source).toContain('defaultLectureStructure: structuredClone(normalized.data)');
    expect(source).toContain('resolveLectureDocumentFeaturesForProject');
    expect(source).toContain('Customize for this project');
    expect(source).toContain('Use workspace defaults');
    expect(source).toContain('lectureDocumentFeaturesByProjectId: {');
    expect(source).toContain('defaultLectureDocumentFeatures: structuredClone(normalized.data)');
  });

  it('blocks source-list aliases from new workspace Lecture defaults', () => {
    const html = renderSettings(
      'lecture',
      defaultProjectChatProfile(snapshot.projects[0]!.id),
      lectureTrashSnapshot,
      'configured',
      {
        ...DEFAULT_USER_PREFERENCES,
        defaultLectureStructure: {
          mode: 'custom',
          sections: [{ title: 'References', coverage: 'notes-and-slides' }],
        },
      },
    );

    expect(html).toContain(
      'Source lists are controlled by Document elements. Choose a content topic instead.',
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(
      '<button type="button" class="primary-button" disabled="">Save default structure</button>',
    );

    const source = readFileSync(
      new URL('../src/renderer/src/settings-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('if (!lectureStructureValid) return;');
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
        overleafPersonalTokenState="configured"
        onRefreshOverleafPersonalToken={vi.fn()}
        onSaveOverleafPersonalToken={vi.fn()}
        onRemoveOverleafPersonalToken={vi.fn()}
        models={codexModels}
        modelsLoading={false}
        onRefreshModels={vi.fn()}
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

    expect(html).toContain('DEFAULT AI');
    expect(html).toContain('Auto · provider default');
    expect(html).toContain('Save defaults');
    expect(html).toContain('Existing scoped choices and generated revisions remain unchanged');
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

  it('keeps OpenClaw detection-only and offers the verified Hermes runtime', () => {
    const html = renderSettings('agent');

    expect(html).toContain('OPTIONAL AGENT ADD-ONS');
    expect(html).toContain('OpenClaw');
    expect(html).toContain('Hermes Agent');
    expect(html).toContain('Detect local installation');
    expect(html).toContain('without running it');
    expect(html).toContain('Use verified Hermes runtime');
    expect(html).toContain('credentials remain in the isolated local profile');
    expect(html).toContain('Hermes is pinned, local, and never an automatic fallback');
    expect(html).toContain('never searches PATH or silently falls back to another version');
    expect(html).toContain('only native tools are project-scoped file read and search');
    expect(html).toContain('read-only tools do not show mutation approval prompts');
    expect(html).toContain('File writes, terminal, processes, code execution, web');
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

  it('stores one reusable Overleaf token without ever displaying its saved value', () => {
    const html = renderSettings('overleaf');

    expect(html).toContain('<strong>Overleaf</strong>');
    expect(html).toContain('Use one token for every new Overleaf link');
    expect(html).toContain('Saved');
    expect(html).toContain('type="password"');
    expect(html).toContain('placeholder="Enter a new token to replace it"');
    expect(html).toContain('>Replace</button>');
    expect(html).toContain('>Clear</button>');
    expect(html).toContain('operating-system secure storage');
    expect(html).toContain('Existing linked manuscripts');
    expect(html).toContain('does not revoke the token in Overleaf');
    expect(html).not.toContain('macOS Keychain');
  });

  it('keeps replace and clear recovery available when the saved token cannot be read', () => {
    const html = renderSettings(
      'overleaf',
      defaultProjectChatProfile(snapshot.projects[0]!.id),
      lectureTrashSnapshot,
      'unavailable',
    );

    expect(html).toContain('Status unavailable');
    expect(html).toContain('Retry the check, or replace or clear the saved data to recover.');
    expect(html).toContain('>Replace</button>');
    expect(html).toContain('>Clear</button>');
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
