import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefingMarkdown } from './briefing-insight-card';

it('bolds exact email, paper and news titles without changing surrounding prose', () => {
  const html = renderToStaticMarkup(
    <BriefingMarkdown
      text={'메일 [행사] 등록 안내와 논문 GraphNet, 뉴스 New research funding을 확인하세요.'}
      emphasizedTitles={['[행사] 등록 안내', 'Graph', 'GraphNet', 'New research funding']}
    />,
  );
  for (const title of ['[행사] 등록 안내', 'GraphNet', 'New research funding'])
    expect(html).toContain(`<strong>${title}</strong>`);
  expect(html).not.toContain('<strong>Graph</strong>Net');
});
it('does not double-bold, match fragments of words, or alter code, math, URLs and untrusted markup', () => {
  const html = renderToStaticMarkup(
    <BriefingMarkdown
      text={
        '**GraphNet** GraphNets `GraphNet` $GraphNet$ [GraphNet](https://example.test/GraphNet) <script>GraphNet</script>'
      }
      emphasizedTitles={['GraphNet']}
    />,
  );
  expect(html).not.toContain('<strong><strong>');
  expect(html).toContain(' GraphNets ');
  expect(html).toContain('<code>GraphNet</code>');
  expect(html).toContain('katex');
  expect(html).not.toContain('href=');
  expect(html).not.toContain('<script>');
  // Raw tags are discarded; their harmless text still receives literal title formatting.
  expect(html.match(/<strong>GraphNet<\/strong>/g)).toHaveLength(3);
});
