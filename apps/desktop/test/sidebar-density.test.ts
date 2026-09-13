import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
const personal = readFileSync(
  new URL('../src/renderer/src/notification-center.css', import.meta.url),
  'utf8',
);
const rule = (text: string, selector: string) =>
  text
    .split(selector + ' {')
    .slice(1)
    .map((part) => part.split('}')[0])
    .join('\n');
it('keeps personal, project and workspace rows at the same compact minimum height', () => {
  expect(rule(personal, '.project-personal-tool')).toContain('min-height: 34px');
  expect(rule(css, '.project-folder-button')).toContain('min-height: 34px');
  expect(rule(css, '.project-global-navigation > button')).toContain('min-height: 34px');
  expect(rule(personal, '.project-personal-tools')).toContain('gap: 2px');
  expect(rule(css, '.project-folder-list')).toContain('gap: 2px');
});
it('does not stretch arbitrary whitespace above local connections', () => {
  expect(rule(css, '.nav-spacer')).toContain('flex: 0 0 12px');
  expect(rule(css, '.desktop-nav')).toContain('padding: 12px 12px');
  expect(rule(css, '.project-group-toggle')).toContain('border-radius: 6px');
});
