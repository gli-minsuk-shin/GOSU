import { createRoot } from 'react-dom/client';

import '../../src/renderer/src/styles.css';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../../src/renderer/src/project-navigation-state';
import type { PortfolioProjectRecord } from '../../src/renderer/src/project-portfolio-model';
import { ProjectSidebar } from '../../src/renderer/src/project-sidebar';

const NOW = '2026-08-13T00:00:00.000Z';
const projects: readonly PortfolioProjectRecord[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Neural Sampler',
    slug: 'neural-sampler',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Amortized NP Bootstrap',
    slug: 'amortized-np-bootstrap',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Cheap Bootstrap',
    slug: 'cheap-bootstrap',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

function Fixture() {
  return (
    <main className="sidebar-icon-visual-shell">
      <header className="titlebar sidebar-icon-visual-titlebar">
        <div className="logo">G</div>
        <strong>GOSU</strong>
        <span>Sidebar icon visual QA</span>
      </header>
      <aside className="desktop-nav sidebar-icon-visual-nav" aria-label="Workspace navigation">
        <ProjectSidebar
          projects={projects}
          activeProjectId={projects[2].id}
          activeTab="lecture"
          navigationState={{
            ...DEFAULT_PROJECT_NAVIGATION_STATE,
            activeGroupExpanded: true,
            expandedProjectIds: [projects[2].id],
          }}
          settingsActive={false}
          onNavigationStateChange={() => undefined}
          onSelectProject={() => undefined}
          onSelectProjectTab={() => undefined}
          onSelectGlobalTab={() => undefined}
          onHideProject={() => undefined}
          onShowProject={() => undefined}
          onShowAllProjects={() => undefined}
          onArchiveProject={() => undefined}
          onRestoreProject={() => undefined}
          onOpenProjectSettings={() => undefined}
          onOpenSettings={() => undefined}
          onNewProject={() => undefined}
        />
      </aside>
      <section className="sidebar-icon-visual-note">
        <strong>Optical-size check</strong>
        <span>Search 20px · Lecture 17px · shared 24px slot</span>
      </section>
    </main>
  );
}

const root = document.querySelector('#root');
if (!root) throw new Error('missing_sidebar_icon_visual_smoke_root');
createRoot(root).render(<Fixture />);
