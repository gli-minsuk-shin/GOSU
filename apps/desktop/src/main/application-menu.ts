import type { MenuItemConstructorOptions } from 'electron';
import { DEFAULT_APP_LANGUAGE, type AppLanguage } from '@gosu/contracts';
import { DEFAULT_ASSISTANT_SHORTCUT } from '../shared/assistant-shortcut';
import {
  APP_SHORTCUT_TARGETS,
  DEFAULT_APP_SHORTCUTS,
  type AppShortcuts,
  type AppShortcutTarget,
} from '../shared/app-shortcuts';

type NativeMenuItem = {
  id?: string;
  role?: string;
  label?: string;
  submenu?: { items: readonly NativeMenuItem[] };
};

const roleLabels: Readonly<Record<string, readonly [string, string]>> = {
  filemenu: ['File', '파일'],
  editmenu: ['Edit', '편집'],
  viewmenu: ['View', '보기'],
  windowmenu: ['Window', '윈도우'],
  window: ['Window', '윈도우'],
  help: ['Help', '도움말'],
  services: ['Services', '서비스'],
  hideothers: ['Hide Others', '기타 가리기'],
  unhide: ['Show All', '모두 보기'],
  undo: ['Undo', '실행 취소'],
  redo: ['Redo', '다시 실행'],
  cut: ['Cut', '오려두기'],
  copy: ['Copy', '복사하기'],
  paste: ['Paste', '붙여넣기'],
  pasteandmatchstyle: ['Paste and Match Style', '스타일 일치하여 붙여넣기'],
  delete: ['Delete', '삭제'],
  selectall: ['Select All', '전체 선택'],
  reload: ['Reload', '새로고침'],
  forcereload: ['Force Reload', '강제 새로고침'],
  toggledevtools: ['Toggle Developer Tools', '개발자 도구 켜기/끄기'],
  resetzoom: ['Actual Size', '실제 크기'],
  zoomin: ['Zoom In', '확대'],
  zoomout: ['Zoom Out', '축소'],
  togglespellchecker: ['Check Spelling', '맞춤법 검사'],
  togglefullscreen: ['Toggle Full Screen', '전체 화면 켜기/끄기'],
  minimize: ['Minimize', '최소화'],
  close: ['Close Window', '윈도우 닫기'],
  zoom: ['Zoom', '윈도우 확대'],
  front: ['Bring All to Front', '모두 앞으로 가져오기'],
  startspeaking: ['Start Speaking', '말하기 시작'],
  stopspeaking: ['Stop Speaking', '말하기 중단'],
  showsubstitutions: ['Show Substitutions', '대치 보기'],
  togglesmartquotes: ['Smart Quotes', '스마트 인용 부호'],
  togglesmartdashes: ['Smart Dashes', '스마트 대시'],
  toggletextreplacement: ['Text Replacement', '텍스트 대치'],
  sharemenu: ['Share', '공유'],
  recentdocuments: ['Open Recent', '최근 사용 열기'],
  clearrecentdocuments: ['Clear Menu', '메뉴 지우기'],
  toggletabbar: ['Show Tab Bar', '탭 막대 보기'],
  selectnexttab: ['Show Next Tab', '다음 탭 보기'],
  selectprevioustab: ['Show Previous Tab', '이전 탭 보기'],
  showalltabs: ['Show All Tabs', '모든 탭 보기'],
  mergeallwindows: ['Merge All Windows', '모든 윈도우 통합'],
  movetabtonewwindow: ['Move Tab to New Window', '탭을 새 윈도우로 이동'],
};

/** Inspect the built native menu without recreating Electron's generated submenus. */
export function macApplicationMenuLabelChanges(
  items: readonly NativeMenuItem[],
  language: AppLanguage,
  appName: string,
): readonly { item: NativeMenuItem; label: string }[] {
  const changes: { item: NativeMenuItem; label: string }[] = [];
  for (const item of items) {
    const role = item.role?.toLowerCase();
    const labels =
      item.id === 'app.settings'
        ? ['Settings…', '설정…']
        : item.id === 'view.toggle-project-sidebar'
          ? ['Toggle Project Sidebar', '프로젝트 사이드바 접기/펼치기']
          : role === 'about'
            ? [`About ${appName}`, `${appName} 정보`]
            : role === 'hide'
              ? [`Hide ${appName}`, `${appName} 가리기`]
              : role === 'quit'
                ? [`Quit ${appName}`, `${appName} 종료`]
                : role
                  ? roleLabels[role]
                  : undefined;
    const label = labels?.[language === 'ko' ? 1 : 0];
    if (label) changes.push({ item, label });
    // Services are populated and owned by macOS. Do not relabel service entries.
    if (item.submenu && role !== 'services')
      changes.push(...macApplicationMenuLabelChanges(item.submenu.items, language, appName));
  }
  return changes;
}

export function buildMacApplicationMenuTemplate({
  appName,
  openSettings,
  toggleSidebar,
  openAssistant = () => undefined,
  assistantShortcut = DEFAULT_ASSISTANT_SHORTCUT,
  appShortcuts = DEFAULT_APP_SHORTCUTS,
  openSurface = () => undefined,
  language = DEFAULT_APP_LANGUAGE,
}: {
  appName: string;
  openSettings: () => void;
  toggleSidebar: () => void;
  openAssistant?: () => void;
  assistantShortcut?: string;
  appShortcuts?: AppShortcuts;
  openSurface?: (target: AppShortcutTarget) => void;
  language?: AppLanguage;
}): MenuItemConstructorOptions[] {
  const surfaceLabels: Record<AppShortcutTarget, readonly [string, string]> = {
    calendar: ['캘린더 열기', 'Open Calendar'],
    tasks: ['할 일 열기', 'Open To-do'],
    briefing: ['Briefing Lab 열기', 'Open Briefing Lab'],
    briefingRun: ['새 브리핑 실행', 'Run a New Briefing'],
  };
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          id: 'app.settings',
          label: language === 'ko' ? '설정…' : 'Settings…',
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
          id: 'view.open-assistant',
          label: language === 'ko' ? 'AI 비서 열기' : 'Open AI Assistant',
          accelerator: assistantShortcut,
          click: openAssistant,
        },
        ...APP_SHORTCUT_TARGETS.map((target): MenuItemConstructorOptions => ({
          id: `view.open-${target}`,
          label: surfaceLabels[target][language === 'ko' ? 0 : 1],
          // A shortcut that is turned off keeps its menu item, without a chord.
          ...(appShortcuts[target] ? { accelerator: appShortcuts[target] } : {}),
          click: () => openSurface(target),
        })),
        {
          id: 'view.toggle-project-sidebar',
          label: language === 'ko' ? '프로젝트 사이드바 접기/펼치기' : 'Toggle Project Sidebar',
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
