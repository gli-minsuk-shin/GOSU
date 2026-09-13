import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  buildMacApplicationMenuTemplate,
  macApplicationMenuLabelChanges,
} from '../src/main/application-menu';

describe('macOS application menu', () => {
  it('localizes owned Korean labels without changing native roles, shortcuts, or callbacks', () => {
    const openSettings = vi.fn();
    const toggleSidebar = vi.fn();
    const english = buildMacApplicationMenuTemplate({
      appName: 'GOSU',
      openSettings,
      toggleSidebar,
      language: 'en',
    });
    const korean = buildMacApplicationMenuTemplate({
      appName: 'GOSU',
      openSettings,
      toggleSidebar,
      language: 'ko',
    });
    expect(korean.map((item) => item.role)).toEqual(english.map((item) => item.role));
    const settings = (korean[0]!.submenu as MenuItemConstructorOptions[]).find(
      (item) => item.id === 'app.settings',
    );
    expect(settings).toMatchObject({
      label: '설정…',
      accelerator: 'CommandOrControl+,',
      click: openSettings,
    });
    const sidebar = (
      korean.find((item) => item.role === 'viewMenu')!.submenu as MenuItemConstructorOptions[]
    ).find((item) => item.id === 'view.toggle-project-sidebar');
    expect(sidebar).toMatchObject({
      label: '프로젝트 사이드바 접기/펼치기',
      accelerator: 'Control+Command+S',
      click: toggleSidebar,
    });
  });

  it('plans label updates for generated native submenus while preserving unknown OS services', () => {
    const click = vi.fn();
    const undo = { role: 'undo', label: 'Undo', accelerator: 'CommandOrControl+Z', click };
    const paste = { role: 'pasteAndMatchStyle', label: 'Paste and Match Style' };
    const unknown = { id: 'native.os-service', label: 'Send to Notes', click };
    const serviceChild = { role: 'copy', label: 'OS-owned service name', click };
    const menu = [
      {
        role: 'filemenu',
        label: 'File',
        submenu: { items: [{ role: 'close', label: 'Close Window' }] },
      },
      { role: 'editMenu', label: 'Edit', submenu: { items: [undo, paste, unknown] } },
      { role: 'viewMenu', label: 'View' },
      { role: 'windowMenu', label: 'Window' },
      { role: 'services', label: 'Services', submenu: { items: [serviceChild] } },
    ];
    const korean = macApplicationMenuLabelChanges(menu, 'ko', 'GOSU');
    // The planner is pure: native menu objects, roles, and behavior remain intact.
    expect(undo.label).toBe('Undo');
    expect(korean.map((change) => change.label)).toEqual([
      '파일',
      '윈도우 닫기',
      '편집',
      '실행 취소',
      '스타일 일치하여 붙여넣기',
      '보기',
      '윈도우',
      '서비스',
    ]);
    for (const change of korean) change.item.label = change.label;
    expect(undo).toMatchObject({
      role: 'undo',
      label: '실행 취소',
      accelerator: 'CommandOrControl+Z',
      click,
    });
    expect(unknown.label).toBe('Send to Notes');
    expect(serviceChild.label).toBe('OS-owned service name');
    for (const change of macApplicationMenuLabelChanges(menu, 'en', 'GOSU'))
      change.item.label = change.label;
    expect(undo.label).toBe('Undo');
    expect(menu.map((item) => item.label)).toEqual(['File', 'Edit', 'View', 'Window', 'Services']);
  });
  it('adds one standard Settings item while preserving the native menu roles', () => {
    const openSettings = vi.fn();
    const toggleSidebar = vi.fn();
    const template = buildMacApplicationMenuTemplate({
      appName: 'GOSU',
      openSettings,
      toggleSidebar,
    });
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

    const viewMenu = template.find((item) => item.role === 'viewMenu');
    const viewItems = viewMenu?.submenu as MenuItemConstructorOptions[];
    const sidebar = viewItems.find((item) => item.id === 'view.toggle-project-sidebar');
    expect(sidebar).toMatchObject({
      label: 'Toggle Project Sidebar',
      accelerator: 'Control+Command+S',
    });
    expect(sidebar?.click).toBe(toggleSidebar);
    expect(viewItems.map((item) => item.role).filter(Boolean)).toEqual([
      'reload',
      'forceReload',
      'toggleDevTools',
      'resetZoom',
      'zoomIn',
      'zoomOut',
      'togglefullscreen',
    ]);
  });
});
