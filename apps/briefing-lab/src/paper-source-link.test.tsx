import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { PaperSourceLink, paperSourceHref } from './paper-source-link';
import { PaperBriefingDisclosure } from './briefing-insight-card';
import { BriefingHistoryItem } from './briefing-history-view';
const url = 'https://example.org/paper/version2';
it('puts the source action in the closed title row for live and saved papers', () => {
  const live = renderToStaticMarkup(
    <PaperBriefingDisclosure title="Paper" sourceUrl={url} keywords={[]}>
      Details
    </PaperBriefingDisclosure>,
  );
  const saved = renderToStaticMarkup(
    <BriefingHistoryItem
      item={{
        id: 'p',
        title: 'Paper',
        kind: 'papers',
        sourceUrl: url,
        summary: 'Summary',
        importance: 'high',
        relevance: '',
        readScope: 'abstract',
      }}
    />,
  );
  for (const html of [live, saved]) {
    expect(html.indexOf('briefing-paper-source-link')).toBeLessThan(html.indexOf('</summary>'));
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('Paper · Open paper source');
  }
});
it.each([
  'javascript:alert(1)',
  'file:///private',
  'https://user:password@example.org/paper',
  'not a url',
  undefined,
])('does not fabricate or expose an unsafe source %s', (source) => {
  expect(paperSourceHref(source)).toBeUndefined();
  const html = renderToStaticMarkup(<PaperSourceLink url={source} title="Paper" />);
  expect(html).not.toContain('href=');
  expect(html).toContain('Paper source link unavailable');
});
it('opens in a separate page without toggling the paper or preventing native navigation', async () => {
  let ui!: ReturnType<typeof create>;
  await act(() => {
    ui = create(<PaperSourceLink url={url} title="Paper" />);
  });
  const link = ui.root.findByType('a'),
    event = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
  link.props.onClick(event);
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(link.props.target).toBe('_blank');
  expect(link.props.rel).toContain('noopener');
  await act(() => ui.unmount());
});
