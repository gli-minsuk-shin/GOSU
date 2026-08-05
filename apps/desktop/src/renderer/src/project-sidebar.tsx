import type { Ref } from 'react';

import type { WorkspaceTabId } from './workspace-views';
import { FUTURE_MODULES } from './workspace-views';
import { toggleProjectFolder, type ProjectNavigationState } from './project-navigation-state';
import {
  activeProjects,
  archivedProjects,
  type PortfolioProjectRecord,
} from './project-portfolio-model';

export type ProjectWorkspaceTabId = Extract<
  WorkspaceTabId,
  'chat' | 'repository' | 'board' | 'objective' | 'experiments' | 'literature' | 'notes'
>;
export type GlobalWorkspaceTabId = Extract<WorkspaceTabId, 'connections'>;

const PROJECT_TABS: ReadonlyArray<{
  id: ProjectWorkspaceTabId;
  label: string;
  icon: string;
}> = [
  { id: 'chat', label: 'Project chat', icon: '◈' },
  { id: 'repository', label: 'Repository', icon: '⌘' },
  { id: 'board', label: 'Board', icon: '▦' },
  { id: 'objective', label: 'Goal & Metrics', icon: '◎' },
  { id: 'experiments', label: 'Experiments', icon: '⌁' },
  { id: 'literature', label: 'Literature', icon: '▤' },
  { id: 'notes', label: 'Research Notes', icon: '◇' },
];

const GLOBAL_TABS: ReadonlyArray<{
  id: GlobalWorkspaceTabId;
  label: string;
  icon: string;
}> = [{ id: 'connections', label: 'Connections', icon: '⌁' }];

export interface ProjectSidebarProps {
  projects: readonly PortfolioProjectRecord[];
  activeProjectId: string;
  activeTab: WorkspaceTabId;
  navigationState: ProjectNavigationState;
  settingsActive: boolean;
  disabled?: boolean;
  busyProjectIds?: ReadonlySet<string>;
  onNavigationStateChange: (state: ProjectNavigationState) => void;
  onSelectProject: (projectId: string) => void;
  onSelectProjectTab: (projectId: string, tabId: ProjectWorkspaceTabId) => void;
  onSelectGlobalTab: (tabId: GlobalWorkspaceTabId) => void;
  onHideProject: (projectId: string) => void;
  onShowProject: (projectId: string) => void;
  onShowAllProjects: () => void;
  onArchiveProject: (project: PortfolioProjectRecord) => void;
  onRestoreProject: (project: PortfolioProjectRecord) => void;
  onOpenProjectSettings: (projectId: string) => void;
  onOpenSettings: () => void;
  onNewProject: () => void;
}

export function ProjectSidebarToggle({
  collapsed,
  onToggle,
  buttonRef,
}: {
  collapsed: boolean;
  onToggle: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const label = collapsed ? 'Show project sidebar' : 'Hide project sidebar';
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`sidebar-toggle-button${collapsed ? ' collapsed' : ''}`}
      aria-label={label}
      aria-controls="workspace-sidebar"
      aria-expanded={!collapsed}
      title={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <rect x="2" y="2.5" width="14" height="13" rx="2.5" />
        <path d="M6.5 2.5v13" />
      </svg>
    </button>
  );
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  activeTab,
  navigationState,
  settingsActive,
  disabled = false,
  busyProjectIds = new Set(),
  onNavigationStateChange,
  onSelectProject,
  onSelectProjectTab,
  onSelectGlobalTab,
  onHideProject,
  onShowProject,
  onShowAllProjects,
  onArchiveProject,
  onRestoreProject,
  onOpenProjectSettings,
  onOpenSettings,
  onNewProject,
}: ProjectSidebarProps) {
  const hiddenIds = new Set(navigationState.hiddenProjectIds);
  const working = activeProjects(projects);
  const visible = working.filter((project) => !hiddenIds.has(project.id));
  const hidden = working.filter((project) => hiddenIds.has(project.id));
  const archived = archivedProjects(projects);

  const updateGroup = (
    key: 'activeGroupExpanded' | 'hiddenGroupExpanded' | 'archivedGroupExpanded',
    expanded: boolean,
  ) => onNavigationStateChange({ ...navigationState, [key]: expanded });

  return (
    <nav className="project-navigation" aria-label="Projects and workspace navigation">
      <div className="project-navigation-heading">
        <button
          type="button"
          className="project-group-toggle"
          aria-label="Active projects"
          aria-expanded={navigationState.activeGroupExpanded}
          onClick={() => updateGroup('activeGroupExpanded', !navigationState.activeGroupExpanded)}
        >
          <span aria-hidden="true">{navigationState.activeGroupExpanded ? '▾' : '▸'}</span>
          <strong>Projects</strong>
          <em>{working.length}</em>
        </button>
        <button
          type="button"
          className="project-add-button"
          aria-label="Create a new project"
          title="New project"
          onClick={onNewProject}
          disabled={disabled}
        >
          ＋
        </button>
      </div>

      {navigationState.activeGroupExpanded && (
        <div className="project-folder-list">
          {visible.length === 0 ? (
            <p className="project-navigation-empty">
              {working.length === 0 ? 'No active projects' : 'All active projects are hidden'}
            </p>
          ) : (
            visible.map((project) => {
              const expanded = navigationState.expandedProjectIds.includes(project.id);
              const selected = activeProjectId === project.id;
              const busy = busyProjectIds.has(project.id);
              return (
                <section
                  className={`project-folder ${selected ? 'selected' : ''}`}
                  key={project.id}
                >
                  <div className="project-folder-row">
                    <button
                      type="button"
                      className="project-folder-button"
                      aria-expanded={expanded}
                      aria-current={selected ? 'page' : undefined}
                      title={project.name}
                      disabled={disabled}
                      onClick={() => {
                        onSelectProject(project.id);
                        onNavigationStateChange(toggleProjectFolder(navigationState, project.id));
                      }}
                    >
                      <span className="project-folder-chevron" aria-hidden="true">
                        {expanded ? '▾' : '▸'}
                      </span>
                      <span className="project-folder-icon" aria-hidden="true">
                        {expanded ? '▰' : '▱'}
                      </span>
                      <strong>{project.name}</strong>
                      {busy && <i className="project-running-indicator" title="Codex is running" />}
                    </button>
                    <details className="project-folder-menu">
                      <summary aria-label={`Actions for ${project.name}`} title="Project actions">
                        •••
                      </summary>
                      <div role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={disabled || busy}
                          title={
                            busy
                              ? 'Stop or wait for the active Codex turn before hiding this project'
                              : undefined
                          }
                          onClick={() => onHideProject(project.id)}
                        >
                          Hide locally
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={disabled || busy}
                          title={busy ? 'Stop or wait for the active Codex turn first' : undefined}
                          onClick={() => onArchiveProject(project)}
                        >
                          Archive
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => onOpenProjectSettings(project.id)}
                        >
                          Project settings
                        </button>
                      </div>
                    </details>
                  </div>

                  {expanded && (
                    <div
                      className="project-folder-children"
                      aria-label={`${project.name} sections`}
                    >
                      {PROJECT_TABS.map((tab) => (
                        <button
                          type="button"
                          key={tab.id}
                          className={
                            selected && activeTab === tab.id && !settingsActive ? 'active' : ''
                          }
                          aria-current={
                            selected && activeTab === tab.id && !settingsActive ? 'page' : undefined
                          }
                          disabled={disabled}
                          onClick={() => onSelectProjectTab(project.id, tab.id)}
                        >
                          <span aria-hidden="true">{tab.icon}</span>
                          {tab.label}
                        </button>
                      ))}
                      {FUTURE_MODULES.map(([label, icon]) => (
                        <button
                          type="button"
                          className="coming-soon"
                          key={label}
                          disabled
                          title={`${label} is not implemented yet`}
                        >
                          <span aria-hidden="true">{icon}</span>
                          {label}
                          <em>Later</em>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      )}

      {hidden.length > 0 && (
        <section className="project-secondary-group">
          <button
            type="button"
            className="project-group-toggle"
            aria-expanded={navigationState.hiddenGroupExpanded}
            onClick={() => updateGroup('hiddenGroupExpanded', !navigationState.hiddenGroupExpanded)}
          >
            <span aria-hidden="true">{navigationState.hiddenGroupExpanded ? '▾' : '▸'}</span>
            <strong>Hidden projects</strong>
            <em>{hidden.length}</em>
          </button>
          {navigationState.hiddenGroupExpanded && (
            <div className="project-secondary-list">
              {hidden.map((project) => (
                <div key={project.id}>
                  <span title={project.name}>{project.name}</span>
                  <button type="button" onClick={() => onShowProject(project.id)}>
                    Show
                  </button>
                </div>
              ))}
              <button type="button" className="project-show-all" onClick={onShowAllProjects}>
                Show all
              </button>
            </div>
          )}
        </section>
      )}

      {archived.length > 0 && (
        <section className="project-secondary-group">
          <button
            type="button"
            className="project-group-toggle"
            aria-expanded={navigationState.archivedGroupExpanded}
            onClick={() =>
              updateGroup('archivedGroupExpanded', !navigationState.archivedGroupExpanded)
            }
          >
            <span aria-hidden="true">{navigationState.archivedGroupExpanded ? '▾' : '▸'}</span>
            <strong>Archived</strong>
            <em>{archived.length}</em>
          </button>
          {navigationState.archivedGroupExpanded && (
            <div className="project-secondary-list archived">
              {archived.map((project) => (
                <div key={project.id}>
                  <span title={project.name}>{project.name}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRestoreProject(project)}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="project-global-navigation">
        <small>Workspace</small>
        {GLOBAL_TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={!settingsActive && activeTab === tab.id ? 'active' : ''}
            aria-current={!settingsActive && activeTab === tab.id ? 'page' : undefined}
            onClick={() => onSelectGlobalTab(tab.id)}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className={settingsActive ? 'active' : ''}
          aria-current={settingsActive ? 'page' : undefined}
          onClick={onOpenSettings}
        >
          <span aria-hidden="true">⚙</span>
          Settings
          <em>⌘,</em>
        </button>
      </div>
    </nav>
  );
}
