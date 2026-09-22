import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectSidebar } from '../../desktop/src/renderer/src/project-sidebar';
import {
  loadProjectNavigationState,
  saveProjectNavigationState,
  orderedSidebarProjects,
} from '../../desktop/src/renderer/src/project-navigation-state';
import '../../desktop/src/renderer/src/styles.css';
const projects = ['Alpha', 'Beta', 'Gamma'].map((name, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  name: `Project ${name}`,
  slug: name,
  version: 1,
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:00Z',
}));
const noop = () => undefined;
function Fixture() {
  const [navigation, setNavigation] = useState(() => loadProjectNavigationState(localStorage));
  const [active, setActive] = useState(projects[0]!.id);
  return (
    <main style={{ display: 'flex', gap: 36, padding: 24 }}>
      <aside style={{ width: 280, flexShrink: 0, padding: 12, background: 'var(--panel)' }}>
        <ProjectSidebar
          projects={projects}
          activeProjectId={active}
          activeTab="chat"
          navigationState={navigation}
          settingsActive={false}
          onNavigationStateChange={(next) => {
            saveProjectNavigationState(localStorage, next);
            setNavigation(next);
          }}
          onSelectProject={setActive}
          onSelectProjectTab={noop}
          onSelectGlobalTab={noop}
          onHideProject={noop}
          onShowProject={noop}
          onShowAllProjects={noop}
          onArchiveProject={noop}
          onRestoreProject={noop}
          onOpenProjectSettings={noop}
          onOpenSettings={noop}
          onNewProject={noop}
        />
      </aside>
      <section>
        <h2>프로젝트 순서 · 검증용</h2>
        <p>프로젝트 이름을 위·아래로 끌어보세요.</p>
        <p id="order-result">
          {orderedSidebarProjects(projects, navigation)
            .map((p) => p.name)
            .join(' → ')}
        </p>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
