import { z } from 'zod';
export const DEFAULT_ASSISTANT_SHORTCUT = 'CommandOrControl+Shift+Space';
export const AssistantShortcutSchema = z
  .string()
  .max(80)
  .refine((value) => {
    const parts = value.split('+'),
      key = parts.pop();
    return (
      !!key &&
      /^(Space|Enter|[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(key) &&
      new Set(parts).size === parts.length &&
      parts.every((p) => ['CommandOrControl', 'Control', 'Alt', 'Shift'].includes(p)) &&
      parts.filter((p) => p === 'CommandOrControl' || p === 'Control').length === 1 &&
      parts.some((p) => p === 'Alt' || p === 'Shift') &&
      !(key === 'Q' && parts.includes('CommandOrControl'))
    );
  }, 'Command/Ctrl와 Shift 또는 Option을 포함한 단축키를 선택해주세요.');
export function capturedAssistantShortcut(e: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  if (e.metaKey && e.ctrlKey) return null;
  const key = shortcutPhysicalKey(e);
  const result = AssistantShortcutSchema.safeParse(
    [
      e.metaKey ? 'CommandOrControl' : e.ctrlKey ? 'Control' : '',
      e.altKey ? 'Alt' : '',
      e.shiftKey ? 'Shift' : '',
      key,
    ]
      .filter(Boolean)
      .join('+'),
  );
  return result.success ? result.data : null;
}
function shortcutPhysicalKey(e: { key: string; code?: string }) {
  if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') return 'Space';
  if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter') return 'Enter';
  if (/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/.test(e.code ?? ''))
    return e.code!.replace(/^(Key|Digit)/, '');
  return e.key.toUpperCase();
}
export function matchesAssistantShortcut(
  shortcut: string,
  input: {
    type: string;
    key: string;
    code?: string;
    meta: boolean;
    control: boolean;
    alt: boolean;
    shift: boolean;
  },
  platform: string,
) {
  if (input.type !== 'keyDown' || !AssistantShortcutSchema.safeParse(shortcut).success)
    return false;
  const parts = shortcut.split('+'),
    key = parts.pop();
  const command = parts.includes('CommandOrControl');
  return (
    key === shortcutPhysicalKey(input) &&
    input.meta === (command && platform === 'darwin') &&
    input.control === (parts.includes('Control') || (command && platform !== 'darwin')) &&
    input.alt === parts.includes('Alt') &&
    input.shift === parts.includes('Shift')
  );
}
export const shortcutLabel = (s: string) =>
  s
    .replace('CommandOrControl', '⌘')
    .replace('Control', 'Ctrl')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace(/\+/g, ' + ');
