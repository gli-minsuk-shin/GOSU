import { useState } from 'react';
import { useSessionHistory } from '../../src/renderer/src/use-session-history';
import { createRoot } from 'react-dom/client';

import '../../src/renderer/src/styles.css';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../../src/renderer/src/project-navigation-state';
import type { PortfolioProjectRecord } from '../../src/renderer/src/project-portfolio-model';
import { ProjectSidebar } from '../../src/renderer/src/project-sidebar';
import type { WorkspaceTabId } from '../../src/renderer/src/workspace-views';

const NOW = '2026-08-13T00:00:00.000Z';
const projects: readonly PortfolioProjectRecord[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'FM-LM',
    slug: 'fm-lm',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Better GBDT',
    slug: 'better-gbdt',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Neural Sampler',
    slug: 'neural-sampler',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  ...['Amortized NPMLE', 'Cheap Bootstrap', 'Generative Bootstrap'].map((name, index) => ({
    id: `sample-project-${index + 4}`,
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  })),
];

function Fixture() {
  const [navigationState, setNavigationState] = useState({
    ...DEFAULT_PROJECT_NAVIGATION_STATE,
    activeGroupExpanded: true,
    expandedProjectIds: [projects[0].id],
  });
  const [activeProjectId, setActiveProjectId] = useState(projects[0].id);
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('chat');
  const [settingsActive, setSettingsActive] = useState(false);
  const [briefingView, setBriefingView] = useState<'history' | 'assistant'>('history');
  const history = useSessionHistory({ activeTab, activeProjectId, settingsActive }, (target) => {
    setActiveTab(target.activeTab);
    setActiveProjectId(target.activeProjectId);
    setSettingsActive(target.settingsActive);
  });
  const activeProject = projects.find((project) => project.id === activeProjectId)!;

  return (
    <main className="sidebar-icon-visual-shell">
      <header className="titlebar sidebar-icon-visual-titlebar">
        <button
          className="session-back-button"
          aria-label="이전 세션으로 돌아가기"
          disabled={!history.canGoBack}
          onClick={history.back}
        >
          ←
        </button>
        <div className="logo">G</div>
        <strong>GOSU</strong>
        <span>Sidebar icon visual QA</span>
      </header>
      <aside className="desktop-nav sidebar-icon-visual-nav" aria-label="Workspace navigation">
        <ProjectSidebar
          briefingView={briefingView}
          onOpenAssistant={() => {
            setBriefingView('assistant');
            setActiveTab('briefing-lab');
            setSettingsActive(false);
          }}
          projects={projects}
          activeProjectId={activeProjectId}
          activeTab={activeTab}
          navigationState={navigationState}
          settingsActive={settingsActive}
          busyProjectIds={new Set([projects[2].id])}
          onNavigationStateChange={setNavigationState}
          onSelectProject={(projectId) => {
            setActiveProjectId(projectId);
            setSettingsActive(false);
          }}
          onSelectProjectTab={(projectId, tabId) => {
            setActiveProjectId(projectId);
            setActiveTab(tabId);
            setSettingsActive(false);
          }}
          onSelectGlobalTab={(tabId) => {
            setBriefingView('history');
            setActiveTab(tabId);
            setSettingsActive(false);
          }}
          onHideProject={() => undefined}
          onShowProject={() => undefined}
          onShowAllProjects={() => undefined}
          onArchiveProject={() => undefined}
          onRestoreProject={() => undefined}
          onOpenProjectSettings={() => undefined}
          onOpenSettings={() => setSettingsActive(true)}
          onNewProject={() => undefined}
        />
      </aside>
      <section className="sidebar-icon-visual-note">
        <span className="sidebar-icon-visual-eyebrow">PROJECT WORKSPACE</span>
        <strong>{activeProject.name}</strong>
        <span>One outline icon family. Projects stay typographic.</span>
        <output
          aria-label="Fixture navigation state"
          data-active-project={activeProjectId}
          data-active-tab={settingsActive ? 'settings' : activeTab}
        >
          {settingsActive ? 'Settings' : activeTab === 'chat' ? 'Project chat' : activeTab}
        </output>
        <span className="sidebar-icon-visual-spec">18px stroke icons · 22px alignment slots</span>
      </section>
    </main>
  );
}

const root = document.querySelector('#root');
if (!root) throw new Error('missing_sidebar_icon_visual_smoke_root');
createRoot(root).render(<Fixture />);
