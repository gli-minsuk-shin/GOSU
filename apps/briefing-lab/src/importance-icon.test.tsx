import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportanceIcon } from './importance-icon';
it.each([
  ['high', '높음', 3],
  ['medium', '보통', 2],
  ['low', '낮음', 1],
] as const)(
  'uses distinct filled bar counts and accessible tooltip for %s',
  (level, label, bars) => {
    const html = renderToStaticMarkup(<ImportanceIcon level={level} />);
    expect(html).toContain(`aria-label="중요도 · ${label}"`);
    expect(html).toContain(`title="중요도 · ${label}"`);
    expect(html.match(/opacity="1"/g)).toHaveLength(bars);
    expect(html).not.toContain('role="button"');
  },
);
it.each(['uncertain', 'pending'] as const)('does not present %s as low importance', (level) => {
  const html = renderToStaticMarkup(<ImportanceIcon level={level} paper />);
  expect(html).toContain('<circle');
  expect(html).not.toContain('<rect');
  expect(html).toContain(level === 'pending' ? '분석 전' : '판단 보류');
});
