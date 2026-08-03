import type { MenuItemConstructorOptions } from 'electron';

export function buildMacApplicationMenuTemplate({
  appName,
  openSettings,
}: {
  appName: string;
  openSettings: () => void;
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
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}
