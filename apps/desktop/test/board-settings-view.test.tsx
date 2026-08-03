import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BoardView } from '../src/renderer/src/board-view';
import { SettingsView } from '../src/renderer/src/settings-view';
import { DEFAULT_USER_PREFERENCES } from '../src/renderer/src/user-preferences';

describe('Board settings UI', () => {
  it('makes every project column directly discoverable as renameable', () => {
    const html = renderToStaticMarkup(
      <BoardView
        project={{
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Research project',
          slug: 'research-project',
          version: 1,
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:00.000Z',
        }}
        tasks={[]}
        busyAction={null}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onUpdateBoardSettings={vi.fn()}
        onSetTaskArchived={vi.fn()}
      />,
    );

    expect(html).toContain('Rename columns &amp; settings');
    expect(html).toContain('aria-label="Rename Backlog column"');
    expect(html.match(/class="column-rename-button"/g)).toHaveLength(5);
  });

  it('shows a persisted new-project Board template editor in Settings', () => {
    const html = renderToStaticMarkup(
      <SettingsView
        preferences={DEFAULT_USER_PREFERENCES}
        onChange={vi.fn()}
        workspaceSnapshot={null}
        busyAction={null}
        chatBusyProjectIds={new Set()}
        onRenameProject={vi.fn()}
        onTrashProject={vi.fn()}
        onRestoreProject={vi.fn()}
        agentProject={undefined}
        agentProfile={undefined}
        agentProfileLoading={false}
        vault={null}
        vaultState="ready"
        onUpdateAgentProfile={vi.fn()}
        initialCategory="board"
      />,
    );

    expect(html).toContain('DEFAULT BOARD TEMPLATE');
    expect(html).toContain('Save default template');
    expect(html).toContain('Canonical: backlog');
    expect(html).toContain('Backlog → Planned → In Progress → Review → Done');
    expect(html).toContain('existing project Boards stay unchanged');
  });
});
