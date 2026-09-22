export const isGosuEmbedded = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location?.search ?? '').get('embedded') === 'gosu' &&
  window.parent !== window;
export function isDesktopNavigation(event: MessageEvent) {
  return (
    isGosuEmbedded() &&
    event.source === window.parent &&
    (event.origin === 'null' || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(event.origin)) &&
    event.data?.type === 'gosu-briefing-navigation' &&
    ['calendar', 'history', 'settings', 'papers', 'manage', 'assistant'].includes(event.data?.view)
  );
}

/**
 * ⇧⌘Enter (⇧Ctrl+Enter elsewhere): run a new briefing now. Not while an IME is composing. Only used
 * when Briefing Lab runs on its own: inside GOSU the chord is a setting (Settings → Shortcuts), the
 * main process catches it before any page, and the shell sends `gosu-briefing-run-now`.
 */
export function isBriefingRunShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing' | 'repeat'
  >,
) {
  return (
    event.key === 'Enter' &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.isComposing &&
    !event.repeat
  );
}
/** The desktop shell saw the shortcut while its own window (not this frame) had the focus. */
export function isDesktopBriefingRun(event: MessageEvent) {
  return (
    isGosuEmbedded() &&
    event.source === window.parent &&
    (event.origin === 'null' || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(event.origin)) &&
    event.data?.type === 'gosu-briefing-run-now'
  );
}
