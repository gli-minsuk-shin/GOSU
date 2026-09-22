import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
const rule = (selector: string) => {
  return css
    .split(selector + ' {')
    .slice(1)
    .map((part) => part.split('}')[0])
    .join('\n');
};
it('anchors collapse to the generation button row rather than centering on multiline status', () => {
  expect(rule('.briefing-main-header > .briefing-main-actions')).toContain(
    'align-items: flex-start',
  );
  expect(rule('.briefing-collapse-all')).toContain('width: 34px');
  expect(rule('.briefing-collapse-all')).toContain('height: 34px');
  expect(rule('.briefing-collapse-all')).toContain('flex: 0 0 34px');
});
it('reserves a responsive progress column instead of letting expanded text resize the toolbar', () => {
  // The column is reserved whenever a progress box or an alert sits inside the controls; progress
  // shown beside the title (0.58.106) floats its detail and leaves the buttons their natural width.
  const flat = css.replace(/\s+/g, ' ');
  const reserved = flat
    .split(
      ".briefing-main-header > .briefing-main-actions:has( .briefing-generation-controls > .briefing-generation-progress, .briefing-generation-controls > [role='alert'], .briefing-generation-controls > .briefing-generation-alert ) {",
    )[1]
    ?.split('}')[0];
  expect(reserved).toContain('width: min(420px, 100%)');
  const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  expect(styles.split('.briefing-generation-controls {')[1]!.split('}')[0]).toContain(
    'grid-template-columns: minmax(0, 1fr)',
  );
  expect(
    styles
      .split(
        '.briefing-generation-controls:has(.briefing-generation-progress) .briefing-generation-buttons {',
      )[1]!
      .split('}')[0],
  ).toContain('justify-self: end');
});
const bodySelector =
  '.briefing-history-run > :is(.briefing-history-weather, .briefing-history-calendar) > .briefing-live-source-body';
it('uses one compact bottom inset for both weather and agenda, without stacking footer gaps', () => {
  const flatCss = css.replace(/\s+/g, ' ');
  const body = flatCss.split(bodySelector + ' {')[1]?.split('}')[0] ?? '';
  expect(body).toContain('padding-bottom: 8px');
  expect(body).toContain('margin-bottom: 0');
  expect(body).toContain('gap: 8px');
  const footer =
    flatCss.split(bodySelector + ' > .briefing-bottom-collapse {')[1]?.split('}')[0] ?? '';
  expect(footer).toContain('margin: 0');
  expect(rule('.briefing-history-weather .briefing-weather-card')).toContain('margin-bottom: 0');
});
it('sizes History by actual content rather than remembered offscreen heights or stretched grid rows', () => {
  const run = rule('.briefing-history-run');
  expect(run).not.toContain('content-visibility: auto');
  expect(run).not.toContain('contain-intrinsic-size: auto 1000px');
  expect(run).toContain('align-content: start');
  expect(run).toContain('grid-auto-rows: max-content');
  expect(rule('.briefing-history-feed')).toContain('align-items: start');
});
it('explicitly removes closed section bodies from layout while retaining a compact, accessible header', () => {
  expect(rule('details.briefing-content-section:not([open]) > :not(summary)')).toContain(
    'display: none',
  );
  const section = rule('details.briefing-content-section:not([open])');
  expect(section).toContain('display: block');
  expect(section).toContain('gap: 0');
  expect(section).toContain('min-height: 0');
  expect(section).toContain('height: auto');
  const summary = rule('details.briefing-content-section:not([open]) > summary');
  expect(summary).toContain('min-height: 44px');
  expect(summary).toContain('padding: 8px 44px 8px 14px');
  expect(css).not.toContain('.briefing-assistant-summary { display: none');
});
