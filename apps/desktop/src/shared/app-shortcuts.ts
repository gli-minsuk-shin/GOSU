import { z } from 'zod';
import { AssistantShortcutSchema } from './assistant-shortcut';

/**
 * In-app shortcuts, beside the AI assistant's own: three jump straight to a personal screen, and
 * `briefingRun` starts a new briefing while Briefing Lab is showing (elsewhere it opens Briefing Lab).
 */
export const APP_SHORTCUT_TARGETS = ['calendar', 'tasks', 'briefing', 'briefingRun'] as const;
export type AppShortcutTarget = (typeof APP_SHORTCUT_TARGETS)[number];
export type AppShortcuts = Readonly<Record<AppShortcutTarget, string | null>>;

/**
 * Left-hand chords on the initial of each screen: ⇧⌘C Calendar, ⇧⌘T To-do, ⇧⌘B Briefing Lab; and
 * ⇧⌘Enter for a new briefing.
 */
export const DEFAULT_APP_SHORTCUTS: AppShortcuts = Object.freeze({
  calendar: 'CommandOrControl+Shift+C',
  tasks: 'CommandOrControl+Shift+T',
  briefing: 'CommandOrControl+Shift+B',
  briefingRun: 'CommandOrControl+Shift+Enter',
});

/** `null` turns one shortcut off. Two screens can never share a chord. */
export const AppShortcutsSchema = z
  .object({
    calendar: AssistantShortcutSchema.nullable(),
    tasks: AssistantShortcutSchema.nullable(),
    briefing: AssistantShortcutSchema.nullable(),
    // Added in 0.58.137. A settings file saved before that has no such key and gets the default;
    // the file itself is only rewritten when the user saves the shortcuts again.
    briefingRun: AssistantShortcutSchema.nullable().default(DEFAULT_APP_SHORTCUTS.briefingRun),
  })
  .strict()
  .refine((value) => {
    const used = Object.values(value).filter((entry): entry is string => entry !== null);
    return new Set(used).size === used.length;
  }, '같은 단축키를 두 화면에 지정할 수 없습니다.');

/** The screen already using this chord (the assistant counts), or null when it is free. */
export function appShortcutOwner(
  chord: string,
  shortcuts: AppShortcuts,
  assistantShortcut: string,
  except?: AppShortcutTarget | 'assistant',
): AppShortcutTarget | 'assistant' | null {
  if (except !== 'assistant' && chord === assistantShortcut) return 'assistant';
  return (
    APP_SHORTCUT_TARGETS.find((target) => target !== except && shortcuts[target] === chord) ?? null
  );
}
