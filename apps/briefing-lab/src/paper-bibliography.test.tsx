import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newestSummaryFirst, PaperByline, PaperAuthors } from './paper-bibliography';
it('sorts latest summaries first without mutating the source or depending on New acknowledgement', () => {
  const rows = [
    { id: 'old-high', at: '2026-09-10T00:00:00Z' },
    { id: 'new-low', at: '2026-09-11T00:00:00Z' },
    { id: 'unknown', at: undefined },
  ];
  expect(newestSummaryFirst(rows, (r) => r.at).map((r) => r.id)).toEqual([
    'new-low',
    'old-high',
    'unknown',
  ]);
  expect(rows[0]?.id).toBe('old-high');
});
it('shows public date and actual venue, with authors separately in expanded content', () => {
  const bibliography = {
    authors: ['A Author', 'B Author'],
    venue: 'Conference Proceedings 2026',
    source: 'arXiv',
  };
  const html = renderToStaticMarkup(
    <PaperByline publishedAt="2026-09-10T00:00:00Z" bibliography={bibliography} />,
  );
  expect(html).toContain('2026. 09. 10.');
  expect(html).toContain('Conference Proceedings 2026');
  expect(html).not.toContain('A Author');
  expect(renderToStaticMarkup(<PaperAuthors bibliography={bibliography} />)).toContain(
    'A Author, B Author',
  );
});
it('does not invent journal publication or authors for missing metadata', () => {
  expect(
    renderToStaticMarkup(<PaperByline bibliography={{ authors: [], source: 'arXiv' }} />),
  ).toContain('arXiv · 프리프린트');
  expect(renderToStaticMarkup(<PaperByline />)).toContain('공개일 미확인');
  expect(renderToStaticMarkup(<PaperAuthors />)).toContain('저자 정보 미확인');
});
