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
  if (surface === 'workspace' && tab === 'chat') {
    return 'desktop-content desktop-content-chat';
  }
  if (surface === 'workspace' && hasActiveProject && (tab === 'notes' || tab === 'repository')) {
    return 'desktop-content desktop-content-document';
  }
  return 'desktop-content';
}
