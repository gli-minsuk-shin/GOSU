import { expect, it, vi, afterEach } from 'vitest';
import { commonsImageResults, searchAssistantImages } from './briefing-web-images';
const payload = {
  query: {
    pages: {
      '1': {
        title: 'File:Campus.jpg',
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/Campus.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Campus.jpg',
            extmetadata: {
              Artist: { value: '<b>Author</b>' },
              LicenseShortName: { value: 'CC BY-SA' },
            },
          },
        ],
      },
    },
  },
};
afterEach(() => vi.unstubAllGlobals());
it('keeps actual public image/source/license metadata and strips markup', () => {
  const thumbnail = JSON.parse(JSON.stringify(payload));
  thumbnail.query.pages['1'].imageinfo[0].thumburl =
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a9/Campus.jpg/640px-Campus.jpg';
  expect(commonsImageResults(thumbnail)).toHaveLength(1);
  expect(commonsImageResults(payload)[0]).toMatchObject({
    title: 'Campus.jpg',
    author: 'Author',
    license: 'CC BY-SA',
  });
  const forged = structuredClone(payload);
  forged.query.pages['1'].imageinfo[0]!.url = 'https://localhost/private';
  expect(commonsImageResults(forged)).toEqual([]);
  expect(() => commonsImageResults({ error: { code: 'ratelimited' } })).toThrow('source_error');
});
it('uses one fixed source, bounded query and cached results without duplicate requests', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetcher);
  const query = 'Synthetic Campus';
  expect((await searchAssistantImages(query, new AbortController().signal)).images).toHaveLength(1);
  expect((await searchAssistantImages(query, new AbortController().signal)).cached).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.origin).toBe('https://commons.wikimedia.org');
  expect(url.searchParams.get('gsrsearch')).toBe(query);
  expect(options.redirect).toBe('error');
  await expect(
    searchAssistantImages('x'.repeat(201), new AbortController().signal),
  ).rejects.toThrow();
  await expect(searchAssistantImages('Other', AbortSignal.abort())).rejects.toThrow();
});
