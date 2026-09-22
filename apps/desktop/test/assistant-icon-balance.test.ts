import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('uses the same 18px drawing size for assistant, search and notifications without reducing the alignment slot', () => {
  const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
  for (const selector of ['.sidebar-nav-icon-graphic', '.sidebar-nav-icon-assistant']) {
    const rule = css.split(`${selector} {`)[1]!.split('}')[0]!;
    expect(rule).toContain('width: 18px');
    expect(rule).toContain('height: 18px');
  }
  const slot = css.split('.sidebar-nav-icon {')[1]!.split('}')[0]!;
  expect(slot).toContain('width: 22px');
  expect(slot).toContain('height: 22px');
});
