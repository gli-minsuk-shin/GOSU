import type { WorkspaceTabId } from './workspace-views';

export function desktopContentClassName({
  surface,
  tab,
  hasActiveProject,
}: Readonly<{
  surface: 'workspace' | 'settings';
  tab: WorkspaceTabId;
  hasActiveProject: boolean;
}>) {
  if (surface === 'settings') {
    return 'desktop-content desktop-content-compact desktop-content-settings';
  }
  if (surface === 'workspace' && tab === 'chat') {
    return 'desktop-content desktop-content-chat';
  }
  if (surface === 'workspace' && tab === 'lecture') {
    return 'desktop-content desktop-content-lecture';
  }
  if (surface === 'workspace' && tab === 'tasks') {
    return 'desktop-content desktop-content-tasks';
  }
  if (surface === 'workspace' && tab === 'usage') {
    return 'desktop-content desktop-content-usage';
  }
  if (surface === 'workspace' && (tab === 'search' || tab === 'connections')) {
    return `desktop-content desktop-content-compact desktop-content-${tab}`;
  }
  if (surface === 'workspace' && hasActiveProject && tab === 'literature') {
    return 'desktop-content desktop-content-literature';
  }
  if (surface === 'workspace' && hasActiveProject && tab === 'notes') {
    return 'desktop-content desktop-content-document desktop-content-notes';
  }
  if (surface === 'workspace' && hasActiveProject && tab === 'repository') {
    return 'desktop-content desktop-content-document';
  }
  return 'desktop-content';
}
