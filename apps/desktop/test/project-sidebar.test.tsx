import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ProjectSidebar,
  ProjectSidebarToggle,
  type ProjectSidebarProps,
} from '../src/renderer/src/project-sidebar';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../src/renderer/src/project-navigation-state';
import type { PortfolioProjectRecord } from '../src/renderer/src/project-portfolio-model';

const baseProject: PortfolioProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Active Alpha',
  slug: 'active-alpha',
  version: 1,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const projects: readonly PortfolioProjectRecord[] = [
  baseProject,
  {
    ...baseProject,
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Hidden Beta',
    slug: 'hidden-beta',
  },
  {
    ...baseProject,
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Archived Gamma',
    slug: 'archived-gamma',
    archivedAt: '2026-08-04T01:00:00.000Z',
  },
  {
    ...baseProject,
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Trashed Delta',
    slug: 'trashed-delta',
    trashedAt: '2026-08-04T02:00:00.000Z',
  },
];

function renderSidebar(overrides: Partial<ProjectSidebarProps> = {}) {
  const props: ProjectSidebarProps = {
    projects,
    activeProjectId: baseProject.id,
    activeTab: 'chat',
    navigationState: {
      ...DEFAULT_PROJECT_NAVIGATION_STATE,
      expandedProjectIds: [baseProject.id],
      hiddenProjectIds: ['22222222-2222-4222-8222-222222222222'],
      hiddenGroupExpanded: true,
      archivedGroupExpanded: true,
    },
    settingsActive: false,
    busyProjectIds: new Set([baseProject.id]),
    onNavigationStateChange: vi.fn(),
    onSelectProject: vi.fn(),
    onSelectProjectTab: vi.fn(),
    onSelectGlobalTab: vi.fn(),
    onHideProject: vi.fn(),
    onShowProject: vi.fn(),
    onShowAllProjects: vi.fn(),
    onArchiveProject: vi.fn(),
    onRestoreProject: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onOpenSettings: vi.fn(),
    onNewProject: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(<ProjectSidebar {...props} />);
}

describe('folder-style project sidebar', () => {
  it('keeps an accessible titlebar control available in both sidebar states', () => {
    const expanded = renderToStaticMarkup(
      <ProjectSidebarToggle collapsed={false} onToggle={vi.fn()} />,
    );
    const collapsed = renderToStaticMarkup(<ProjectSidebarToggle collapsed onToggle={vi.fn()} />);

    expect(expanded).toContain('aria-label="Hide project sidebar"');
    expect(expanded).toContain('aria-controls="workspace-sidebar"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(collapsed).toContain('aria-label="Show project sidebar"');
    expect(collapsed).toContain('aria-expanded="false"');
  });

  it('uses larger fixed sidebar icons and disclosure chevrons without changing labels', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
    const html = renderSidebar();

    expect(styles).toMatch(/\.sidebar-toggle-button\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/su);
    expect(styles).toMatch(
      /\.sidebar-toggle-button svg\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;[^}]*stroke-width:\s*1\.6;/su,
    );
    expect(styles).toMatch(
      /\.sidebar-nav-icon\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*font-size:\s*18px;/su,
    );
    expect(styles).toMatch(
      /\.project-folder-chevron \.collapse-chevron,[^}]*\.project-group-toggle > \.collapse-chevron\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/su,
    );
    expect(styles).toMatch(/\.project-folder-icon\s*\{[^}]*font-size:\s*18px;/su);
    expect(html).toContain('class="sidebar-nav-icon"');
    expect(html).toContain('class="collapse-chevron"');
    expect(html).toContain('aria-label="Active projects"');
  });

  it('smoothly collapses the desktop sidebar without moving content between grid rows', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.desktop-shell\s*\{[^}]*--sidebar-width:\s*var\(--project-sidebar-width, 280px\);[^}]*--titlebar-height:\s*46px;[^}]*grid-template:\s*var\(--titlebar-height\) minmax\(0, 1fr\) \/ var\(--sidebar-width\) minmax\(\s*0,\s*1fr\s*\);[^}]*transition:\s*grid-template-columns 240ms/su,
    );
    expect(styles).toMatch(
      /\.desktop-shell\.sidebar-collapsed\s*\{\s*--sidebar-width:\s*0px;\s*\}/su,
    );
    expect(styles).toMatch(
      /\.desktop-content\s*\{\s*grid-row:\s*2;\s*grid-column:\s*2;[^}]*scrollbar-gutter:\s*stable;/su,
    );
    expect(styles).toMatch(
      /\.desktop-shell\.sidebar-collapsed \.desktop-nav\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*visibility:\s*hidden;/su,
    );
    expect(styles).not.toContain('.desktop-nav[hidden]');
  });

  it('uses one compact titlebar height across desktop and responsive layouts', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.titlebar\s*\{[^}]*grid-row:\s*1;[^}]*grid-column:\s*1 \/ -1;[^}]*height:\s*var\(--titlebar-height\);/su,
    );
    expect(styles).toMatch(
      /\.titlebar \.logo\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*border-radius:\s*7px;/su,
    );
    expect(styles).toMatch(
      /@media \(max-width: 860px\)[\s\S]*?grid-template:\s*var\(--titlebar-height\) auto minmax\(0, 1fr\) \/ 1fr;[\s\S]*?grid-template:\s*var\(--titlebar-height\) minmax\(0, 1fr\) \/ 1fr;[\s\S]*?\.desktop-nav\s*\{[^}]*max-height:\s*min\(320px, 40vh\);/u,
    );
    expect(styles).not.toMatch(/grid-template:\s*58px/u);
  });

  it('pins window chrome and delegates scrolling to the sidebar and page panes', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /html,\s*body,\s*#root\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su,
    );
    expect(styles).toMatch(
      /\.desktop-shell\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su,
    );
    expect(styles).not.toMatch(/\.desktop-shell\s*\{[^}]*min-height:\s*100vh;/su);
    expect(styles).toMatch(
      /\.desktop-nav\s*\{[^}]*grid-row:\s*2;[^}]*grid-column:\s*1;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*scrollbar-gutter:\s*stable;/su,
    );
    expect(styles).toMatch(
      /\.desktop-content\s*\{[^}]*grid-row:\s*2;[^}]*grid-column:\s*2;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*scrollbar-gutter:\s*stable;/su,
    );
  });

  it('keeps responsive collapse behavior and respects reduced-motion preferences', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.desktop-shell,\s*\.desktop-nav,\s*\.notes-layout,\s*\.project-chat-workspace,\s*\.resize-handle::after\s*\{\s*transition:\s*none;/su,
    );
    expect(styles).toMatch(
      /@media \(max-width: 860px\)[\s\S]*?\.desktop-shell\.sidebar-collapsed \.desktop-nav\s*\{\s*display:\s*none;/u,
    );
  });

  it('exposes a mouse and keyboard accessible persisted sidebar resize separator', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
    const source = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('label="Resize projects sidebar"');
    expect(source).toContain("'--project-sidebar-width': `${projectNavigation.sidebarWidth}px`");
    expect(source).toContain('saveProjectNavigationState(window.localStorage, projectNavigation)');
    expect(styles).toMatch(
      /\.project-sidebar-resize-handle\s*\{[^}]*position:\s*absolute;[^}]*left:\s*calc\(var\(--sidebar-width\) - 5px\);/su,
    );
    expect(styles).toMatch(/\.desktop-shell\.sidebar-resizing\s*\{\s*transition:\s*none;/su);
  });

  it('stacks the session rail before two maximized sidebars can consume the chat pane', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.project-chat-workspace\s*\{\s*grid-template:\s*auto minmax\(0, 1fr\) \/ 1fr;\s*\}[\s\S]*?\.project-chat-session-resize-handle\s*\{\s*display:\s*none;/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.project-chat-session-list\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/u,
    );
    expect(861).toBeLessThanOrEqual(1180);
    expect(styles).not.toContain('min(var(--project-sidebar-width, 280px), 34vw)');
    expect(styles).not.toContain('min(var(--project-chat-session-rail-width, 184px), 32%)');
  });

  it('takes a collapsed sidebar out of keyboard and accessibility navigation', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    const toggleHandler = source.match(
      /const toggleProjectSidebarVisibility = useCallback\(\(\) => \{(?<body>[\s\S]*?)\n {2}\}, \[updateProjectNavigation\]\);/u,
    )?.groups?.body;

    expect(source).toContain('aria-hidden={projectNavigation.sidebarCollapsed}');
    expect(source).toContain('inert={projectNavigation.sidebarCollapsed ? true : undefined}');
    expect(toggleHandler).toBeDefined();
    expect(toggleHandler).toContain('sidebarToggleRef.current?.focus()');
    expect(toggleHandler).toContain('updateProjectNavigation(next)');
    expect(toggleHandler?.indexOf('sidebarToggleRef.current?.focus()')).toBeLessThan(
      toggleHandler?.indexOf('updateProjectNavigation(next)') ?? 0,
    );
  });

  it('shows active project folders and the expanded project sections', () => {
    const html = renderSidebar();

    expect(html).toContain('Projects');
    expect(html).toContain('aria-label="Create a new project"');
    expect(html).toContain('Active Alpha');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Project chat');
    expect(html).toContain('Board');
    expect(html).toContain('Goal &amp; Metrics');
    expect(html).toContain('Literature');
    expect(html).toContain('Experiments');
    expect(html).not.toContain('References');
    expect(html).toContain('Codex is running');
    expect(html).toContain('Hide locally');
    expect(html).toContain('before hiding this project');
    expect(html).toContain('Archive');
    expect(html).toContain('Project settings');
    expect(html).not.toContain('Trashed Delta');
  });

  it('keeps hidden and archived projects recoverable in separate groups', () => {
    const html = renderSidebar();

    expect(html).toContain('Hidden projects');
    expect(html).toContain('Hidden Beta');
    expect(html).toContain('Show all');
    expect(html).toContain('Archived');
    expect(html).toContain('Archived Gamma');
    expect(html).toContain('Restore');
  });

  it('keeps Lecture Studio, Connections, and Settings global while Research Notes stays project-scoped', () => {
    const html = renderSidebar();
    const projectNotesPosition = html.indexOf('Research Notes');
    const workspaceNavigationPosition = html.indexOf('<small>Workspace</small>');

    expect(html).toContain('Workspace');
    expect(html).toContain('Connections');
    expect(html).toContain('Lecture notes &amp; slides');
    expect(html).toContain('Research Notes');
    expect(html).toContain('Settings');
    expect(html.match(/Research Notes/gu)).toHaveLength(1);
    expect(projectNotesPosition).toBeGreaterThan(-1);
    expect(projectNotesPosition).toBeLessThan(workspaceNavigationPosition);
    expect(html.indexOf('Lecture notes &amp; slides')).toBeGreaterThan(workspaceNavigationPosition);
  });

  it('does not render project children while the active group is minimized', () => {
    const html = renderSidebar({
      navigationState: {
        ...DEFAULT_PROJECT_NAVIGATION_STATE,
        expandedProjectIds: [baseProject.id],
        activeGroupExpanded: false,
      },
    });

    expect(html).toContain('Projects');
    expect(html).not.toContain('Active Alpha');
    expect(html).not.toContain('Project chat');
    expect(html).not.toContain('Research Notes');
  });

  it('marks the selected project Research Notes destination active', () => {
    const html = renderSidebar({ activeTab: 'notes' });

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Research Notes');
  });
});
