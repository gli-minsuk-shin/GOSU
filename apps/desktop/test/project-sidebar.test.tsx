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

  it('smoothly collapses the desktop sidebar without moving content between grid rows', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.desktop-shell\s*\{[^}]*--sidebar-width:\s*280px;[^}]*grid-template:\s*58px minmax\(0, 1fr\) \/ var\(--sidebar-width\) minmax\(0, 1fr\);[^}]*transition:\s*grid-template-columns 240ms/su,
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

  it('keeps responsive collapse behavior and respects reduced-motion preferences', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.desktop-shell,\s*\.desktop-nav\s*\{\s*transition:\s*none;/su,
    );
    expect(styles).toMatch(
      /@media \(max-width: 860px\)[\s\S]*?\.desktop-shell\.sidebar-collapsed \.desktop-nav\s*\{\s*display:\s*none;/u,
    );
  });

  it('takes a collapsed sidebar out of keyboard and accessibility navigation', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    const toggleHandler = source.match(
      /const toggleProjectSidebarVisibility = useCallback\(\(\) => \{(?<body>[\s\S]*?)\n  \}, \[updateProjectNavigation\]\);/u,
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
    expect(html).toContain('Experiments');
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

  it('keeps Connections, Local notes, and Settings as global navigation', () => {
    const html = renderSidebar();

    expect(html).toContain('Workspace');
    expect(html).toContain('Connections');
    expect(html).toContain('Local notes');
    expect(html).toContain('Settings');
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
  });

  it('marks only a selected global destination active when settings are closed', () => {
    const html = renderSidebar({ activeTab: 'notes' });

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Local notes');
  });
});
