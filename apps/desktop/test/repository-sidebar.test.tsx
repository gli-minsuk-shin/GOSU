import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../src/renderer/src/project-navigation-state';
import type { PortfolioProjectRecord } from '../src/renderer/src/project-portfolio-model';
import { ProjectSidebar, type ProjectSidebarProps } from '../src/renderer/src/project-sidebar';

const project: PortfolioProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Git Workspace',
  slug: 'git-workspace',
  repository: 'gosu/research-os',
  version: 1,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

function renderSidebar(overrides: Partial<ProjectSidebarProps> = {}) {
  const props: ProjectSidebarProps = {
    projects: [project],
    activeProjectId: project.id,
    activeTab: 'repository',
    navigationState: {
      ...DEFAULT_PROJECT_NAVIGATION_STATE,
      expandedProjectIds: [project.id],
    },
    settingsActive: false,
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

describe('repository project navigation', () => {
  it('shows Repository inside an expanded project and marks it as the current page', () => {
    const html = renderSidebar();

    expect(html).toContain('Git Workspace sections');
    expect(html).toMatch(/class="active" aria-current="page"[^>]*><span[^>]*>⌘<\/span>Repository/);
  });

  it('does not expose project-local repository navigation while its folder is collapsed', () => {
    const html = renderSidebar({
      navigationState: {
        ...DEFAULT_PROJECT_NAVIGATION_STATE,
        expandedProjectIds: [],
      },
    });

    expect(html).not.toContain('Git Workspace sections');
    expect(html).not.toContain('>Repository</button>');
  });

  it('does not mark Repository active while project settings are open', () => {
    const html = renderSidebar({ settingsActive: true });

    expect(html).toContain('>Repository</button>');
    expect(html).not.toMatch(/class="active" aria-current="page"[^>]*>.*Repository/);
  });
});
