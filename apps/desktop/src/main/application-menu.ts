import type { MenuItemConstructorOptions } from 'electron';

export function buildMacApplicationMenuTemplate({
  appName,
  openSettings,
  toggleSidebar,
}: {
  appName: string;
  openSettings: () => void;
  toggleSidebar: () => void;
}): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          id: 'app.settings',
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          click: openSettings,
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      role: 'viewMenu',
      submenu: [
        {
          id: 'view.toggle-project-sidebar',
          label: 'Toggle Project Sidebar',
          accelerator: 'Control+Command+S',
          click: toggleSidebar,
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
}
