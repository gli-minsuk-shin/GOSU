import type { WebContents } from 'electron';

/** Child-frame loads must not suspend navigation delivery to the already-mounted renderer. */
export function trackMainRendererReadiness(
  contents: Pick<WebContents, 'on' | 'removeListener'>,
  update: (ready: boolean) => void,
) {
  const start = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) update(false);
  };
  const finish = () => update(true);
  const gone = () => update(false);
  contents.on('did-start-navigation', start);
  contents.on('did-finish-load', finish);
  contents.on('render-process-gone', gone);
  return () => {
    contents.removeListener('did-start-navigation', start);
    contents.removeListener('did-finish-load', finish);
    contents.removeListener('render-process-gone', gone);
  };
}
