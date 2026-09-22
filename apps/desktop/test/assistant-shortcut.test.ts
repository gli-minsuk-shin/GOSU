import { expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MenuItemConstructorOptions } from 'electron';
import { AssistantShortcutStore } from '../src/main/assistant-shortcut-store';
import {
  AssistantShortcutSchema,
  capturedAssistantShortcut,
  DEFAULT_ASSISTANT_SHORTCUT,
} from '../src/shared/assistant-shortcut';
import { buildMacApplicationMenuTemplate } from '../src/main/application-menu';
import { matchesAssistantShortcut } from '../src/shared/assistant-shortcut';
import { installAssistantShortcutInput } from '../src/main/assistant-shortcut-input';
import { EventEmitter } from 'node:events';
import { trackMainRendererReadiness } from '../src/main/renderer-navigation-ready';

it('keeps navigation available after iframe reload and same-document navigation but not main reload/crash', () => {
  const contents = new EventEmitter(),
    update = vi.fn();
  const dispose = trackMainRendererReadiness(contents as never, update);
  contents.emit('did-finish-load');
  expect(update).toHaveBeenLastCalledWith(true);
  contents.emit('did-start-loading');
  contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  expect(update).toHaveBeenCalledTimes(1);
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  expect(update).toHaveBeenLastCalledWith(false);
  contents.emit('did-finish-load');
  expect(update).toHaveBeenLastCalledWith(true);
  contents.emit('render-process-gone');
  expect(update).toHaveBeenLastCalledWith(false);
  dispose();
  expect(contents.eventNames()).toEqual([]);
});

it('recognizes physical keys with Korean/Option input and exact modifiers on each platform', () => {
  expect(
    capturedAssistantShortcut({
      key: 'ㅁ',
      code: 'KeyA',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    }),
  ).toBe('CommandOrControl+Shift+A');
  const input = {
    type: 'keyDown',
    key: ' ',
    code: 'Space',
    meta: true,
    control: false,
    alt: false,
    shift: true,
  };
  expect(matchesAssistantShortcut(DEFAULT_ASSISTANT_SHORTCUT, input, 'darwin')).toBe(true);
  expect(
    matchesAssistantShortcut(DEFAULT_ASSISTANT_SHORTCUT, { ...input, key: 'Process' }, 'darwin'),
  ).toBe(true);
  expect(
    matchesAssistantShortcut(DEFAULT_ASSISTANT_SHORTCUT, { ...input, alt: true }, 'darwin'),
  ).toBe(false);
  expect(
    matchesAssistantShortcut(DEFAULT_ASSISTANT_SHORTCUT, { ...input, type: 'keyUp' }, 'darwin'),
  ).toBe(false);
  expect(
    matchesAssistantShortcut(
      DEFAULT_ASSISTANT_SHORTCUT,
      { ...input, meta: false, control: true },
      'win32',
    ),
  ).toBe(true);
  expect(
    matchesAssistantShortcut(
      'CommandOrControl+Alt+A',
      { ...input, shift: false, alt: true, key: 'å', code: 'KeyA' },
      'darwin',
    ),
  ).toBe(true);
});
it('opens before page/menu handling, suppresses repeat and immediately honors saved changes', () => {
  const contents = new EventEmitter(),
    open = vi.fn(),
    preventDefault = vi.fn();
  let shortcut = DEFAULT_ASSISTANT_SHORTCUT;
  const remove = installAssistantShortcutInput(contents as never, () => shortcut, open, 'darwin');
  const input = {
    type: 'keyDown',
    key: ' ',
    code: 'Space',
    meta: true,
    control: false,
    alt: false,
    shift: true,
    isAutoRepeat: false,
  };
  contents.emit('before-input-event', { preventDefault }, input);
  contents.emit('before-input-event', { preventDefault }, { ...input, isAutoRepeat: true });
  expect(open).toHaveBeenCalledTimes(1);
  expect(preventDefault).toHaveBeenCalledTimes(2);
  shortcut = 'CommandOrControl+Shift+A';
  contents.emit('before-input-event', { preventDefault }, input);
  expect(open).toHaveBeenCalledTimes(1);
  contents.emit('before-input-event', { preventDefault }, { ...input, key: 'ㅁ', code: 'KeyA' });
  expect(open).toHaveBeenCalledTimes(2);
  remove();
  expect(contents.listenerCount('before-input-event')).toBe(0);
});
it('defaults to Command Shift Space and persists a changed shortcut across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-shortcut-'));
  try {
    const path = join(dir, 'shortcut.json'),
      store = new AssistantShortcutStore(path);
    expect(await store.load()).toBe(DEFAULT_ASSISTANT_SHORTCUT);
    await store.set('CommandOrControl+Shift+A');
    expect(await new AssistantShortcutStore(path).load()).toBe('CommandOrControl+Shift+A');
    expect(() => store.set('CommandOrControl+Q')).toThrow();
    expect(JSON.parse(await readFile(path, 'utf8'))).toBe('CommandOrControl+Shift+A');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('captures Space and rejects typing, duplicate modifiers and unsafe accelerators', () => {
  expect(
    capturedAssistantShortcut({
      key: ' ',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    }),
  ).toBe(DEFAULT_ASSISTANT_SHORTCUT);
  for (const key of [
    'Space',
    'A',
    'CommandOrControl+Shift+Shift+A',
    'CommandOrControl+Shift+Q',
    'CommandOrControl+Shift+A;quit',
  ])
    expect(AssistantShortcutSchema.safeParse(key).success).toBe(false);
});
it('uses the current preference in the native menu and opens rather than toggles the assistant', () => {
  const open = vi.fn();
  const menu = buildMacApplicationMenuTemplate({
    appName: 'GOSU',
    openSettings: vi.fn(),
    toggleSidebar: vi.fn(),
    openAssistant: open,
    assistantShortcut: 'CommandOrControl+Alt+A',
  });
  const action = (
    menu.find((i) => i.role === 'viewMenu')!.submenu as MenuItemConstructorOptions[]
  ).find((i) => i.id === 'view.open-assistant')!;
  expect(action.accelerator).toBe('CommandOrControl+Alt+A');
  (action.click as () => void)();
  (action.click as () => void)();
  expect(open).toHaveBeenCalledTimes(2);
});
