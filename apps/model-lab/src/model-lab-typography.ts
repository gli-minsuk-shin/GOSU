import { parseTypographyMessage } from '@gosu/ui/typography';

/** Accept presentation-only settings from the embedding desktop, never arbitrary CSS or actions. */
export function applyEmbeddedTypography(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  parent: Window,
  root: Pick<HTMLElement, 'dataset'>,
): boolean {
  // Electron's packaged file renderer has the opaque "null" origin. Local development is explicit.
  if (
    event.source !== parent ||
    !['null', 'file://', 'http://localhost:5173', 'http://127.0.0.1:5173'].includes(event.origin)
  )
    return false;
  const message = parseTypographyMessage(event.data);
  if (!message) return false;
  root.dataset.textSize = message.textSize;
  return true;
}

export function installEmbeddedTypography(hosted: boolean) {
  if (!hosted || window.parent === window) return;
  window.addEventListener('message', (event) => {
    applyEmbeddedTypography(event, window.parent, document.documentElement);
  });
}
