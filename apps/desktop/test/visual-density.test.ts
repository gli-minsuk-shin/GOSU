import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
const rule = (selector: string) => css.split(selector + ' {')[1]?.split('}')[0] ?? '';

it('keeps settings navigation content-sized instead of distributing empty vertical space', () => {
  expect(rule('.settings-category-nav')).toContain('align-content: start');
  expect(rule('.settings-category-nav')).toContain('gap: 2px');
  expect(rule('.settings-category-nav button')).toContain('min-height: 48px');
  expect(rule('.settings-card')).toContain('padding: 18px');
  expect(rule('.settings-card')).toContain('gap: 16px');
  expect(css).toMatch(/\.settings-card > h2,[\s\S]*?\.settings-card > p \{\s*margin: 0;/);
});

it('bounds page gutters and improves secondary-text contrast in both themes', () => {
  expect(rule('.desktop-content')).toContain('padding: 20px clamp(16px, 2vw, 28px) 24px');
  expect(css).toContain('--subtle: light-dark(#667269, #9aa59d)');
});
