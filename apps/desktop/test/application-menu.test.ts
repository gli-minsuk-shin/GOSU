import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { buildMacApplicationMenuTemplate } from '../src/main/application-menu';

describe('macOS application menu', () => {
  it('adds one standard Settings item while preserving the native menu roles', () => {
    const openSettings = vi.fn();
    const template = buildMacApplicationMenuTemplate({ appName: 'GOSU', openSettings });
    const appMenu = template[0];
    const appItems = appMenu?.submenu as MenuItemConstructorOptions[];
    const settings = appItems.find((item) => item.id === 'app.settings');

    expect(appMenu?.label).toBe('GOSU');
    expect(settings).toMatchObject({
      label: 'Settings…',
      accelerator: 'CommandOrControl+,',
    });
    expect(settings?.click).toBe(openSettings);
    expect(appItems.map((item) => item.role).filter(Boolean)).toEqual([
      'about',
      'services',
      'hide',
      'hideOthers',
      'unhide',
      'quit',
    ]);
    expect(template.slice(1).map((item) => item.role)).toEqual([
      'fileMenu',
      'editMenu',
      'viewMenu',
      'windowMenu',
    ]);
  });
});
