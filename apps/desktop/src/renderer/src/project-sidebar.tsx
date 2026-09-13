import { uiText } from '@gosu/ui/language';

import { useState, type Ref } from 'react';

import type { WorkspaceTabId } from './workspace-views';
import { FUTURE_MODULES } from './workspace-views';
import { toggleProjectFolder, type ProjectNavigationState } from './project-navigation-state';
import {
  activeProjects,
  archivedProjects,
  type PortfolioProjectRecord,
} from './project-portfolio-model';
import { CollapseChevron } from './ui-primitives';
import { SidebarIcon } from './sidebar-icon';
import {
  EMPTY_NOTIFICATION_CENTER,
  NotificationCenter,
  type NotificationCenterProps,
} from './notification-center';

export type ProjectWorkspaceTabId = Extract<
  WorkspaceTabId,
  | 'chat'
  | 'review'
  | 'model-lab'
  | 'repository'
  | 'manuscript'
  | 'board'
  | 'objective'
  | 'experiments'
  | 'literature'
  | 'notes'
>;
export type GlobalWorkspaceTabId = Extract<
  WorkspaceTabId,
  'connections' | 'lecture' | 'search' | 'tasks' | 'usage' | 'calendar' | 'briefing-lab'
>;

const PROJECT_TABS: ReadonlyArray<{
  id: ProjectWorkspaceTabId;
  label: string;
}> = [
  { id: 'chat', label: 'Project chat' },
  { id: 'model-lab', label: 'Model Lab' },
  { id: 'repository', label: 'Repository' },
  { id: 'manuscript', label: 'Manuscript' },
  { id: 'review', label: 'Critical Review' },
  { id: 'board', label: 'Board' },
  { id: 'objective', label: 'Goal & Metrics' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'literature', label: 'Literature' },
  { id: 'notes', label: 'Research Notes' },
];

const GLOBAL_TABS: ReadonlyArray<{
  id: GlobalWorkspaceTabId;
  label: string;
}> = [
  { id: 'lecture', label: 'Lecture notes & slides' },
  { id: 'connections', label: 'Connections' },
  { id: 'usage', label: 'Usage' },
];

export interface ProjectSidebarProps {
  briefingView?: 'history' | 'papers' | 'manage' | 'assistant';
  onOpenAssistant?: () => void;
  onSelectBriefingView?: (view: 'history' | 'papers' | 'manage') => void;
  notifications?: NotificationCenterProps;
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
  const label = uiText(collapsed ? 'Show project sidebar' : 'Hide project sidebar');
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
  briefingView = 'history',
  onSelectBriefingView,
  onOpenAssistant,
  notifications = EMPTY_NOTIFICATION_CENTER,
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
  const [briefingExpanded, setBriefingExpanded] = useState(false);
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
    <nav className="project-navigation" aria-label={uiText('Projects and workspace navigation')}>
      <div
        className="project-quick-actions"
        role="group"
        aria-label={uiText('Workspace shortcuts')}
      >
        <button
          type="button"
          className={`project-quick-action${!settingsActive && activeTab === 'briefing-lab' && briefingView === 'assistant' ? ' active' : ''}`}
          aria-label="AI 비서"
          title="AI 비서 · 일정, 메일, 논문, 프로젝트"
          onClick={onOpenAssistant}
        >
          <SidebarIcon name="assistant" />
        </button>
        {(['search'] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            className={`project-quick-action${!settingsActive && activeTab === tab ? ' active' : ''}`}
            aria-current={!settingsActive && activeTab === tab ? 'page' : undefined}
            aria-label={uiText(tab === 'search' ? 'Search' : 'Tasks')}
            title={uiText(tab === 'search' ? 'Search' : 'Tasks')}
            onClick={() => onSelectGlobalTab(tab)}
          >
            <SidebarIcon name={tab} />
          </button>
        ))}
        <NotificationCenter {...notifications} />
      </div>
      <div className="project-personal-tools" role="group" aria-label="Personal workspace">
        {(
          [
            { id: 'calendar', label: 'Calendar' },
            { id: 'tasks', label: 'To-do list' },
            { id: 'briefing-lab', label: 'Briefing Lab' },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`project-personal-tool${!settingsActive && activeTab === id ? ' active' : ''}`}
            aria-current={!settingsActive && activeTab === id ? 'page' : undefined}
            aria-label={label}
            aria-expanded={id === 'briefing-lab' ? briefingExpanded : undefined}
            onClick={() => {
              if (id === 'briefing-lab') setBriefingExpanded((value) => !value);
              onSelectGlobalTab(id);
            }}
          >
            <SidebarIcon name={id} />
            <span>{label}</span>
            {id === 'briefing-lab' && (
              <CollapseChevron direction={briefingExpanded ? 'down' : 'right'} />
            )}
          </button>
        ))}
        {briefingExpanded && (
          <div className="briefing-subnavigation" role="group" aria-label="Briefing Lab 하위 세션">
            {(
              [
                { view: 'history', label: '개인 연구 브리핑' },
                { view: 'papers', label: '논문 요약' },
                { view: 'manage', label: '루틴 관리' },
              ] as const
            ).map(({ view, label }) => (
              <button
                key={view}
                aria-current={
                  !settingsActive && activeTab === 'briefing-lab' && briefingView === view
                    ? 'page'
                    : undefined
                }
                onClick={() => onSelectBriefingView?.(view)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="project-navigation-heading">
        <button
          type="button"
          className="project-group-toggle"
          aria-label={uiText('Active projects')}
          aria-expanded={navigationState.activeGroupExpanded}
          onClick={() => updateGroup('activeGroupExpanded', !navigationState.activeGroupExpanded)}
        >
          <CollapseChevron direction={navigationState.activeGroupExpanded ? 'down' : 'right'} />
          <strong>{uiText('Projects')}</strong>
          <em>{working.length}</em>
        </button>
        <button
          type="button"
          className="project-add-button"
          aria-label={uiText('Create a new project')}
          title={uiText('New project')}
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
              {working.length === 0
                ? uiText('No active projects')
                : uiText('All active projects are hidden')}
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
                        <CollapseChevron direction={expanded ? 'down' : 'right'} />
                      </span>
                      <strong>{project.name}</strong>
                      {busy && (
                        <i
                          className="project-running-indicator"
                          title={uiText('Codex is running')}
                        />
                      )}
                    </button>
                    <details className="project-folder-menu">
                      <summary
                        aria-label={uiText('Actions for {name}', { name: project.name })}
                        title={uiText('Project actions')}
                      >
                        •••
                      </summary>
                      <div role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={disabled || busy}
                          title={
                            busy
                              ? uiText(
                                  'Stop or wait for the active Codex turn before hiding this project',
                                )
                              : undefined
                          }
                          onClick={() => onHideProject(project.id)}
                        >
                          {uiText('Hide locally')}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={disabled || busy}
                          title={
                            busy
                              ? uiText('Stop or wait for the active Codex turn first')
                              : undefined
                          }
                          onClick={() => onArchiveProject(project)}
                        >
                          {uiText('Archive')}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => onOpenProjectSettings(project.id)}
                        >
                          {uiText('Project settings')}
                        </button>
                      </div>
                    </details>
                  </div>

                  {expanded && (
                    <div
                      className="project-folder-children"
                      aria-label={uiText('{name} sections', { name: project.name })}
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
                          <SidebarIcon name={tab.id} />
                          {uiText(tab.label)}
                        </button>
                      ))}
                      {FUTURE_MODULES.map(([label]) => (
                        <button
                          type="button"
                          className="coming-soon"
                          key={label}
                          disabled
                          title={uiText('{name} is not implemented yet', { name: uiText(label) })}
                        >
                          <SidebarIcon name="review" />
                          {uiText(label)}
                          <em>{uiText('Later')}</em>
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
            <CollapseChevron direction={navigationState.hiddenGroupExpanded ? 'down' : 'right'} />
            <strong>{uiText('Hidden projects')}</strong>
            <em>{hidden.length}</em>
          </button>
          {navigationState.hiddenGroupExpanded && (
            <div className="project-secondary-list">
              {hidden.map((project) => (
                <div key={project.id}>
                  <span title={project.name}>{project.name}</span>
                  <button type="button" onClick={() => onShowProject(project.id)}>
                    {uiText('Show')}
                  </button>
                </div>
              ))}
              <button type="button" className="project-show-all" onClick={onShowAllProjects}>
                {uiText('Show all')}
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
            <CollapseChevron direction={navigationState.archivedGroupExpanded ? 'down' : 'right'} />
            <strong>{uiText('Archived')}</strong>
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
                    {uiText('Restore')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="project-global-navigation">
        <small>{uiText('Workspace')}</small>
        {GLOBAL_TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={!settingsActive && activeTab === tab.id ? 'active' : ''}
            aria-current={!settingsActive && activeTab === tab.id ? 'page' : undefined}
            onClick={() => onSelectGlobalTab(tab.id)}
          >
            <SidebarIcon name={tab.id} />
            {uiText(tab.label)}
          </button>
        ))}
        <button
          type="button"
          className={settingsActive ? 'active' : ''}
          aria-current={settingsActive ? 'page' : undefined}
          onClick={onOpenSettings}
        >
          <SidebarIcon name="settings" />
          {uiText('Settings')}
          <em>⌘,</em>
        </button>
      </div>
    </nav>
  );
}
