import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/renderer/src/usage-view.css', import.meta.url), 'utf8');

it('lets the Usage page scroll while the cursor is over a table', () => {
  // 2026-09-21: `overscroll-behavior: contain` on the table scroller kept the vertical wheel, so
  // the page did not move with the cursor over a table, even one too short to scroll itself.
  const rule = /\.usage-table-scroll \{([^}]*)\}/u.exec(styles)?.[1] ?? '';
  expect(rule).toContain('overflow: auto');
  expect(rule).toContain('overscroll-behavior-x: contain');
  expect(rule).toContain('overscroll-behavior-y: auto');
  expect(rule).not.toMatch(/overscroll-behavior: contain/u);
});
