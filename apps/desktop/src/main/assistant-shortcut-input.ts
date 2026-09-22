import type { WebContents } from 'electron';
import { matchesAssistantShortcut } from '../shared/assistant-shortcut';
import {
  APP_SHORTCUT_TARGETS,
  type AppShortcuts,
  type AppShortcutTarget,
} from '../shared/app-shortcuts';

/** Handle focused renderer/iframe input before page handlers and menu shortcuts. */
export function installAssistantShortcutInput(
  contents: Pick<WebContents, 'on' | 'removeListener'>,
  shortcut: () => string,
  open: () => void,
  platform = process.platform,
) {
  const listener = (event: Electron.Event, input: Electron.Input) => {
    if (!matchesAssistantShortcut(shortcut(), input, platform)) return;
    event.preventDefault();
    if (!input.isAutoRepeat) open();
  };
  contents.on('before-input-event', listener);
  return () => contents.removeListener('before-input-event', listener);
}

/** The same interception for the Calendar, To-do and Briefing Lab chords. */
export function installAppShortcutInput(
  contents: Pick<WebContents, 'on' | 'removeListener'>,
  shortcuts: () => AppShortcuts,
  open: (target: AppShortcutTarget) => void,
  platform = process.platform,
) {
  const listener = (event: Electron.Event, input: Electron.Input) => {
    const current = shortcuts();
    const target = APP_SHORTCUT_TARGETS.find((candidate) => {
      const chord = current[candidate];
      return chord !== null && matchesAssistantShortcut(chord, input, platform);
    });
    if (!target) return;
    event.preventDefault();
    if (!input.isAutoRepeat) open(target);
  };
  contents.on('before-input-event', listener);
  return () => contents.removeListener('before-input-event', listener);
}
