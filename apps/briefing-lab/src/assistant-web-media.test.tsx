import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { publicWebUrl, mapPreviewUrl } from './assistant-web-media';
import { BriefingMarkdown } from './briefing-insight-card';
import { act, create } from 'react-test-renderer';
import { AssistantWebImage, AssistantWebLink } from './assistant-web-media';
it('loads media only after an explicit click and allows maps to close again', async () => {
  let view!: ReturnType<typeof create>;
  await act(() => {
    view = create(
      <AssistantWebImage src="https://upload.wikimedia.org/example.jpg" alt="Public diagram" />,
    );
  });
  expect(view.root.findAllByType('img')).toHaveLength(0);
  await act(() => view.root.findByType('button').props.onClick());
  expect(view.root.findByType('img').props.referrerPolicy).toBe('no-referrer');
  await act(() => view.root.findByType('img').props.onError());
  expect(view.root.findByType('button').children.join('')).toContain('실패');
  await act(() => view.unmount());
  await act(() => {
    view = create(
      <AssistantWebLink href="https://www.openstreetmap.org/?mlat=37.5&mlon=127">
        Map
      </AssistantWebLink>,
    );
  });
  expect(view.root.findAllByType('iframe')).toHaveLength(0);
  await act(() => view.root.findByType('button').props.onClick());
  expect(view.root.findByType('iframe').props.src).toContain('/export/embed.html');
  await act(() => view.root.findByType('button').props.onClick());
  expect(view.root.findAllByType('iframe')).toHaveLength(0);
  await act(() => view.unmount());
});
it.each([
  'javascript:alert(1)',
  'file:///tmp/private',
  'http://example.org',
  'https://localhost/a',
  'https://127.0.0.1/a',
  'https://[::1]/a',
  'https://user:pass@example.org',
  'https://host.internal/a',
])('rejects unsafe media/link %s', (url) => expect(publicWebUrl(url)).toBeNull());
it('keeps assistant source links, with no external image request until clicked', () => {
  const text =
    '[Source](https://example.org/paper)\n\n![Map photograph](https://upload.wikimedia.org/picture.jpg)';
  const html = renderToStaticMarkup(<BriefingMarkdown text={text} webMedia />);
  expect(html).toContain('href="https://example.org/paper"');
  expect(html).toContain('이미지 보기');
  expect(html).not.toContain('<img');
  const original = renderToStaticMarkup(<BriefingMarkdown text={text} />);
  expect(original).not.toContain('href=');
  expect(original).not.toContain('이미지 보기');
});
it('offers a bounded OSM map preview, not an arbitrary frame or automatic geocoding', () => {
  const url = 'https://www.openstreetmap.org/?mlat=37.5&mlon=127';
  expect(mapPreviewUrl(url)).toContain('https://www.openstreetmap.org/export/embed.html?');
  expect(mapPreviewUrl('https://www.openstreetmap.org/?mlat=91&mlon=127')).toBeNull();
  expect(mapPreviewUrl('https://example.org/?mlat=37&mlon=127')).toBeNull();
  const html = renderToStaticMarkup(<BriefingMarkdown text={`[Map](${url})`} webMedia />);
  expect(html).toContain('지도 표시');
  expect(html).not.toContain('<iframe');
});
