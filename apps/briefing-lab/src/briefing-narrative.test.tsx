import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefingNarrative, narrativeHints } from './briefing-narrative';
import { BriefingHistoryFeed } from './briefing-history-view';
const item = {
  id: 'p',
  title: 'Paper [A+B]',
  kind: 'papers' as const,
  readScope: 'abstract',
  summary: '**GraphNet**을 검토합니다.',
  importance: 'high',
  relevance: '',
  keywords: ['GraphNet', 'sparsity', 'robustness'],
};
it('emphasizes exact saved titles, methods and dates in old plain summaries without modifying stored text', () => {
  const text = 'Paper [A+B]는 GraphNet을 사용합니다. 9월 20일까지 검토하세요.';
  const before = JSON.stringify(item);
  const html = renderToStaticMarkup(<BriefingNarrative text={text} items={[item]} />);
  expect(html).toContain('<strong>Paper [A+B]</strong>');
  expect(html).toContain('<strong>GraphNet</strong>');
  expect(html).toContain('<strong>9월 20일까지</strong>');
  expect(JSON.stringify(item)).toBe(before);
  expect(text).not.toContain('**');
});
it('keeps non-title emphasis restrained and leaves uncertainty intact', () => {
  const html = renderToStaticMarkup(
    <BriefingNarrative
      text="GraphNet과 sparsity 및 robustness를 검토하지만 효과는 확정되지 않았습니다."
      items={[item]}
    />,
  );
  expect(html.match(/<strong>/g)).toHaveLength(2);
  expect(html).toContain('효과는 확정되지 않았습니다.');
  expect(narrativeHints('마감일은 없습니다.', [item]).keywords).toEqual([]);
});
it('emphasizes complete titles before title-fragment keywords can split them', () => {
  const source = {
    ...item,
    title: 'GraphNet: Sparse Learning',
    keywords: ['GraphNet', 'Sparse'],
    summary: '**sparsity**를 분석합니다.',
  };
  const html = renderToStaticMarkup(
    <BriefingNarrative
      text="GraphNet: Sparse Learning은 sparsity를 활용합니다."
      items={[source]}
    />,
  );
  expect(html).toContain('<strong>GraphNet: Sparse Learning</strong>');
  expect(html).toContain('<strong>sparsity</strong>');
});
it('protects code, quotes, math and URLs from inferred keyword emphasis', () => {
  const text =
    'https://example.test/GraphNet\n\n`GraphNet`\n\n> GraphNet\n\n$GraphNet$\n\nGraphNet은 검증이 필요합니다.';
  const html = renderToStaticMarkup(<BriefingNarrative text={text} items={[item]} />);
  expect(html).toContain('<code>GraphNet</code>');
  expect(html).toContain('<p>GraphNet</p>');
  expect(html).toContain('https://example.test/GraphNet');
  expect(html).toContain('katex');
  expect(html.match(/<strong>/g)).toHaveLength(1);
});
it('separates saved overview batches and uses only their own source context', () => {
  const base = {
    routineId: 'r',
    runId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-09-13T00:00:00Z',
    kind: 'briefing' as const,
    private: false,
  };
  const history = [
    {
      ...base,
      id: 'a',
      answer: 'GraphNet 참고 문장입니다.',
      items: [{ ...item, id: 'other', title: 'Unrelated', summary: '검토', keywords: [] }],
    },
    { ...base, id: 'b', answer: 'Paper [A+B]와 GraphNet을 확인합니다.', items: [item] },
  ];
  const html = renderToStaticMarkup(<BriefingHistoryFeed history={history} />)
    .split('<div class="briefing-narrative-body">')[1]!
    .split('</details>')[0]!;
  expect(html.match(/class="briefing-narrative-entry"/g)).toHaveLength(2);
  expect(html).toContain('<p>GraphNet 참고 문장입니다.</p>');
  expect(html).toContain('<strong>GraphNet</strong>');
  const css = readFileSync(new URL('./briefing-narrative.css', import.meta.url), 'utf8');
  expect(css).toContain('Pretendard Variable');
  expect(css).toContain('line-height: 1.78');
  expect(css).not.toMatch(/https?:\/\//);
});
