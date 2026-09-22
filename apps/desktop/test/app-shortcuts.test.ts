import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShortcutStore } from '../src/main/app-shortcut-store';
import { buildMacApplicationMenuTemplate } from '../src/main/application-menu';
import { installAppShortcutInput } from '../src/main/assistant-shortcut-input';
import {
  AppShortcutsSchema,
  DEFAULT_APP_SHORTCUTS,
  appShortcutOwner,
} from '../src/shared/app-shortcuts';
import { DEFAULT_ASSISTANT_SHORTCUT } from '../src/shared/assistant-shortcut';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const keyDown = (code: string, modifiers: Partial<Record<'meta' | 'shift' | 'alt', boolean>>) =>
  ({
    type: 'keyDown',
    key: code.replace('Key', '').toLowerCase(),
    code,
    meta: false,
    control: false,
    alt: false,
    shift: false,
    isAutoRepeat: false,
    ...modifiers,
  }) as unknown as Electron.Input;

describe('screen shortcuts', () => {
  it('defaults to left-hand ⇧⌘ chords on each screen initial and never lets two screens share one', () => {
    expect(DEFAULT_APP_SHORTCUTS).toEqual({
      calendar: 'CommandOrControl+Shift+C',
      tasks: 'CommandOrControl+Shift+T',
      briefing: 'CommandOrControl+Shift+B',
      // Not a screen: starts a new briefing from the Briefing Lab screen (user request, 0.58.137).
      briefingRun: 'CommandOrControl+Shift+Enter',
    });
    expect(AppShortcutsSchema.safeParse(DEFAULT_APP_SHORTCUTS).success).toBe(true);
    // A settings file saved before 0.58.137 has no such key: it loads, with the default chord.
    expect(
      AppShortcutsSchema.parse({
        calendar: 'CommandOrControl+Alt+K',
        tasks: null,
        briefing: 'Control+Shift+F2',
      }),
    ).toEqual({
      calendar: 'CommandOrControl+Alt+K',
      tasks: null,
      briefing: 'Control+Shift+F2',
      briefingRun: 'CommandOrControl+Shift+Enter',
    });
    // It can be changed to another chord or turned off, and cannot take a chord already in use.
    expect(
      AppShortcutsSchema.safeParse({ ...DEFAULT_APP_SHORTCUTS, briefingRun: 'Control+Alt+R' })
        .success,
    ).toBe(true);
    expect(
      AppShortcutsSchema.safeParse({ ...DEFAULT_APP_SHORTCUTS, briefingRun: null }).success,
    ).toBe(true);
    expect(
      AppShortcutsSchema.safeParse({
        ...DEFAULT_APP_SHORTCUTS,
        briefingRun: DEFAULT_APP_SHORTCUTS.briefing,
      }).success,
    ).toBe(false);
    expect(
      appShortcutOwner(
        'CommandOrControl+Shift+Enter',
        DEFAULT_APP_SHORTCUTS,
        DEFAULT_ASSISTANT_SHORTCUT,
        'tasks',
      ),
    ).toBe('briefingRun');
    // A shortcut can be turned off; a plain key or a duplicate cannot be saved.
    expect(AppShortcutsSchema.safeParse({ ...DEFAULT_APP_SHORTCUTS, tasks: null }).success).toBe(
      true,
    );
    expect(AppShortcutsSchema.safeParse({ ...DEFAULT_APP_SHORTCUTS, tasks: 'T' }).success).toBe(
      false,
    );
    expect(
      AppShortcutsSchema.safeParse({
        ...DEFAULT_APP_SHORTCUTS,
        tasks: DEFAULT_APP_SHORTCUTS.calendar,
      }).success,
    ).toBe(false);
    expect(
      appShortcutOwner(
        DEFAULT_ASSISTANT_SHORTCUT,
        DEFAULT_APP_SHORTCUTS,
        DEFAULT_ASSISTANT_SHORTCUT,
      ),
    ).toBe('assistant');
    expect(
      appShortcutOwner(
        'CommandOrControl+Shift+C',
        DEFAULT_APP_SHORTCUTS,
        DEFAULT_ASSISTANT_SHORTCUT,
        'tasks',
      ),
    ).toBe('calendar');
    expect(
      appShortcutOwner(
        'CommandOrControl+Shift+C',
        DEFAULT_APP_SHORTCUTS,
        DEFAULT_ASSISTANT_SHORTCUT,
        'calendar',
      ),
    ).toBeNull();
  });

  it('opens the matching screen from a focused window and ignores a shortcut that is off', () => {
    const listeners: ((event: Electron.Event, input: Electron.Input) => void)[] = [];
    const contents = {
      on: vi.fn((_name: string, listener: (typeof listeners)[number]) => listeners.push(listener)),
      removeListener: vi.fn(),
    };
    const open = vi.fn();
    let shortcuts = DEFAULT_APP_SHORTCUTS;
    const remove = installAppShortcutInput(contents as never, () => shortcuts, open, 'darwin');
    const press = (input: Electron.Input) => {
      const event = { preventDefault: vi.fn() };
      listeners[0]!(event as unknown as Electron.Event, input);
      return event.preventDefault;
    };
    expect(press(keyDown('KeyT', { meta: true, shift: true }))).toHaveBeenCalledOnce();
    expect(open).toHaveBeenLastCalledWith('tasks');
    press(keyDown('KeyC', { meta: true, shift: true }));
    expect(open).toHaveBeenLastCalledWith('calendar');
    press(keyDown('KeyB', { meta: true, shift: true }));
    expect(open).toHaveBeenLastCalledWith('briefing');
    // ⇧⌘Enter is caught before any page or frame sees it, from the main or the numeric Enter key.
    const enter = { ...keyDown('Enter', { meta: true, shift: true }), key: 'Enter' };
    expect(press(enter)).toHaveBeenCalledOnce();
    expect(open).toHaveBeenLastCalledWith('briefingRun');
    press({ ...enter, code: 'NumpadEnter' });
    expect(open).toHaveBeenCalledTimes(5);
    // Plain Enter and ⌘Enter stay with the page (the chat sends on them).
    expect(press({ ...enter, meta: false, shift: false })).not.toHaveBeenCalled();
    expect(press({ ...enter, shift: false })).not.toHaveBeenCalled();
    // Plain ⌘C stays copy; a held key does not reopen; a disabled chord does nothing.
    expect(press(keyDown('KeyC', { meta: true }))).not.toHaveBeenCalled();
    press({ ...keyDown('KeyT', { meta: true, shift: true }), isAutoRepeat: true });
    expect(open).toHaveBeenCalledTimes(5);
    shortcuts = { ...DEFAULT_APP_SHORTCUTS, briefing: null, briefingRun: 'Control+Alt+R' };
    expect(press(keyDown('KeyB', { meta: true, shift: true }))).not.toHaveBeenCalled();
    // After the user changed the chord, the old one is free again and the new one runs.
    expect(press(enter)).not.toHaveBeenCalled();
    press({ ...keyDown('KeyR', { alt: true }), control: true } as Electron.Input);
    expect(open).toHaveBeenLastCalledWith('briefingRun');
    remove();
    expect(contents.removeListener).toHaveBeenCalledOnce();
  });

  it('keeps the chords across restarts and refuses a damaged file instead of resetting it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gosu-shortcuts-'));
    directories.push(directory);
    const path = join(directory, 'app-shortcuts.v1.json');
    const store = new AppShortcutStore(path);
    expect(await store.load()).toEqual(DEFAULT_APP_SHORTCUTS);
    const next = {
      calendar: 'CommandOrControl+Alt+K',
      tasks: null,
      briefing: 'Control+Shift+F2',
      briefingRun: 'CommandOrControl+Alt+Enter',
    };
    await expect(store.set(next)).resolves.toEqual(next);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(next);
    expect(await new AppShortcutStore(path).load()).toEqual(next);
    await expect(store.set({ ...next, tasks: 'CommandOrControl+Alt+K' })).rejects.toThrow();
    expect(store.get()).toEqual(next);
    await writeFile(path, '{');
    await expect(new AppShortcutStore(path).load()).rejects.toThrow();
  });

  it('lists the screens in the View menu with their chords and routes each click', () => {
    const openSurface = vi.fn();
    const template = buildMacApplicationMenuTemplate({
      appName: 'GOSU',
      openSettings: () => undefined,
      toggleSidebar: () => undefined,
      appShortcuts: { ...DEFAULT_APP_SHORTCUTS, briefing: null },
      openSurface,
      language: 'ko',
    });
    const view = template.find((item) => item.role === 'viewMenu')!
      .submenu as Electron.MenuItemConstructorOptions[];
    const item = (id: string) => view.find((entry) => entry.id === id)!;
    expect(item('view.open-calendar')).toMatchObject({
      label: '캘린더 열기',
      accelerator: 'CommandOrControl+Shift+C',
    });
    expect(item('view.open-tasks').accelerator).toBe('CommandOrControl+Shift+T');
    expect(item('view.open-briefing').label).toBe('Briefing Lab 열기');
    expect('accelerator' in item('view.open-briefing')).toBe(false);
    expect(item('view.open-briefingRun')).toMatchObject({
      label: '새 브리핑 실행',
      accelerator: 'CommandOrControl+Shift+Enter',
    });
    (item('view.open-tasks').click as () => void)();
    expect(openSurface).toHaveBeenCalledWith('tasks');
    // Main and the renderer are wired to the same targets.
    const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    expect(main).toContain("join(app.getPath('userData'), 'app-shortcuts.v1.json')");
    expect(main).toContain('window.webContents.send(APP_NAVIGATION_CHANNELS.openSurface, target);');
    expect(main).toContain("throw new Error('shortcut_in_use');");
    const renderer = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    expect(renderer).toMatch(
      /\} else if \(target === 'briefing'\) \{\s+setBriefingView\('history'\);\s+selectGlobalTab\('briefing-lab'\);\s+\} else selectGlobalTab\(target\);/u,
    );
    // A new briefing starts only from the briefing feed; elsewhere the chord opens Briefing Lab.
    expect(renderer).toMatch(
      /if \(target === 'briefingRun'\) \{\s+if \(briefingFeedShowingRef\.current\) setBriefingRunRequest\(\(request\) => request \+ 1\);\s+else \{\s+setBriefingView\('history'\);\s+selectGlobalTab\('briefing-lab'\);/u,
    );
    expect(renderer).toContain('runRequest={briefingRunRequest}');
  });
});
