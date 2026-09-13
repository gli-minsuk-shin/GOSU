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
