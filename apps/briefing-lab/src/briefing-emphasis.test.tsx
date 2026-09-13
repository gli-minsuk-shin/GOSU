import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefingMarkdown, BriefingInsightCard } from './briefing-insight-card';
import { BriefingHistoryItem } from './briefing-history-view';

it('keeps at most two short emphasis phrases per paragraph and avoids repeats or whole paragraphs', () => {
  const html = renderToStaticMarkup(
    <BriefingMarkdown
      text={
        '**금요일 오후 3시까지** **참석 여부 회신**이 필요하며 **자료 첨부**도 요청했습니다.\n\n다시 **참석 여부 회신**을 안내합니다.\n\n**이 문장 전체를 강조하지 않습니다.**'
      }
    />,
  );
  expect(html).toContain('<strong>금요일 오후 3시까지</strong>');
  expect(html).toContain('<strong>참석 여부 회신</strong>');
  expect(html.match(/<strong>/g)).toHaveLength(2);
  expect(html).toContain('<p>이 문장 전체를 강조하지 않습니다.</p>');
  expect(html).toContain('자료 첨부');
});
it('uses only exact existing paper keywords for unformatted cached prose, without touching math/code/quotes', () => {
  const html = renderToStaticMarkup(
    <BriefingMarkdown
      text={
        'GraphNets와 GraphNet을 비교하며 sparsity는 아직 검증되지 않았습니다. GraphNet을 평가합니다.\n\n> 원문 GraphNet\n\n`GraphNet` $GraphNet$'
      }
      keywords={['GraphNet', 'sparsity', 'not in source']}
    />,
  );
  expect(html).toContain('GraphNets와 <strong>GraphNet</strong>');
  expect(html).toContain('<strong>sparsity</strong>는 아직 검증되지 않았습니다.');
  expect(html.match(/<strong>/g)).toHaveLength(2);
  expect(html).toContain('<blockquote>\n<p>원문 GraphNet</p>');
  expect(html).toContain('<code>GraphNet</code>');
  expect(html).toContain('katex');
});
it('preserves explicit source titles and user formatting while preferring model phrases over keyword filler', () => {
  const html = renderToStaticMarkup(
    <BriefingMarkdown
      text={'**Paper title**의 **일반화는 미확인**입니다. GraphNet이 사용됐습니다.'}
      emphasizedTitles={['Paper title']}
      keywords={['GraphNet']}
    />,
  );
  expect(html).toContain('<strong>Paper title</strong>');
  expect(html).toContain('<strong>일반화는 미확인</strong>');
  expect(html).not.toContain('<strong>GraphNet</strong>');
  expect(
    renderToStaticMarkup(<BriefingMarkdown text="**사용자 원문 전체**" restrained={false} />),
  ).toBe('<p><strong>사용자 원문 전체</strong></p>');
});
it('renders safe inline emphasis without paragraphs, links or source images', () => {
  const html = renderToStaticMarkup(
    <small>
      <BriefingMarkdown
        inline
        text="**참석 회신**이 필요합니다. [출처](https://example.test) ![외부](https://example.test/img)"
      />
    </small>,
  );
  expect(html).toContain('<strong>참석 회신</strong>');
  expect(html).not.toMatch(/<p>|<a |<img|href=|src=/);
});
it.each(['live', 'history'] as const)(
  'renders email action and priority emphasis in %s without altering verbatim evidence',
  (mode) => {
    const insight = {
      id: 'm',
      summary: '**회신 요청**을 받았습니다.',
      action: '**금요일까지** 참석 여부를 회신하세요.',
      importanceReason: '**일정 변경**으로 확인이 필요합니다.',
      importance: 'high' as const,
      relevance: '',
      evidenceQuote: 'literal **Friday**',
      equationIds: [],
      figureIds: [],
      memorySuggestion: null,
    };
    const item = {
      id: 'm',
      kind: 'email' as const,
      title: 'Notice',
      readScope: 'mail-preview' as const,
      source: 'Apple Mail',
      text: 'literal **Friday**',
      details: [],
    };
    const html = renderToStaticMarkup(
      mode === 'live' ? (
        <BriefingInsightCard item={item} insight={insight} memory={null} routineId="r" />
      ) : (
        <BriefingHistoryItem item={{ ...item, ...insight }} />
      ),
    );
    expect(html).toContain('<strong>금요일까지</strong>');
    expect(html).toContain('<strong>일정 변경</strong>');
    expect(html).not.toContain('**금요일까지**');
    if (mode === 'live') expect(html).toContain('<blockquote>literal **Friday**</blockquote>');
  },
);
