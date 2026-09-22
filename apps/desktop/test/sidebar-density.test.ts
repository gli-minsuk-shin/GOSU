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
it('puts group headers, project rows and archived names on the icon and label columns of the tools above', () => {
  const columns = 'grid-template-columns: 22px minmax(0, 1fr) auto';
  for (const selector of ['.project-group-toggle', '.project-folder-button']) {
    expect(rule(css, selector)).toContain(columns);
    expect(rule(css, selector)).toContain('column-gap: 8px');
  }
  // 10px of padding plus the 22px slot plus the 8px gap is where ".project-personal-tool" (10px
  // padding, 22px icon slot, 8px gap) starts its label.
  expect(rule(personal, '.project-personal-tool')).toContain('padding: 4px 10px');
  expect(rule(personal, '.project-personal-tool')).toContain('gap: 8px');
  expect(rule(css, '.project-group-toggle')).toContain('padding: 0 6px 0 10px');
  expect(rule(css, '.project-folder-button')).toContain('padding: 0 3px 0 10px');
  expect(rule(css, '.project-secondary-list')).toContain('padding: 0 5px 5px 40px');
  expect(rule(css, '.project-group-toggle')).toContain('min-height: 34px');
  // Nothing in the rail is bold, and a project reads one step smaller than its section's name.
  const headerText = rule(css, '.project-group-toggle strong');
  expect(headerText).toContain('font-size: var(--font-body)');
  expect(headerText).toContain('font-weight: 400');
  expect(headerText).not.toContain('text-transform');
  const projectText = rule(css, '.project-folder-button strong');
  expect(projectText).toContain('font-size: var(--font-meta)');
  expect(projectText).toContain('font-weight: 400');
  // A project's own pages and an archived project read at the project's size, not the section's.
  expect(rule(css, '.project-folder-children button')).toContain('font-size: var(--font-meta)');
  expect(rule(css, '.project-secondary-list button')).toContain('font-size: var(--font-meta)');
  // "+" sits in the column of the row menus, and the Archived count under the Projects count.
  expect(rule(css, '.project-navigation-heading')).toContain(
    'grid-template-columns: minmax(0, 1fr) 28px',
  );
  expect(rule(css, '.project-folder-row')).toContain('grid-template-columns: minmax(0, 1fr) 28px');
  expect(rule(css, '.project-add-button')).toContain('width: 28px');
  expect(rule(css, '.project-secondary-group > .project-group-toggle')).toContain(
    'width: calc(100% - 28px)',
  );
});
