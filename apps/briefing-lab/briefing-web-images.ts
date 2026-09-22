import { z } from 'zod';

const Entry = z.object({
  title: z.string(),
  imageinfo: z
    .array(
      z.object({
        thumburl: z.string().url().optional(),
        url: z.string().url(),
        descriptionurl: z.string().url(),
        extmetadata: z.record(z.string(), z.object({ value: z.string() }).passthrough()).optional(),
      }),
    )
    .optional(),
});
const Reply = z.object({
  error: z.unknown().optional(),
  query: z.object({ pages: z.record(z.string(), Entry) }).optional(),
});
const clean = (s: string) => s.replace(/<[^>]*>/g, '').slice(0, 400);
export function commonsImageResults(raw: unknown) {
  const parsed = Reply.parse(raw);
  if (parsed.error) throw Error('image_search_source_error');
  return Object.values(parsed.query?.pages ?? {})
    .flatMap((p) => {
      const i = p.imageinfo?.[0];
      if (!i) return [];
      const image = new URL(i.thumburl ?? i.url),
        source = new URL(i.descriptionurl);
      if (
        image.protocol !== 'https:' ||
        !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(image.hostname) ||
        image.username ||
        image.password ||
        source.protocol !== 'https:' ||
        source.hostname !== 'commons.wikimedia.org' ||
        source.username ||
        source.password
      )
        return [];
      return [
        {
          title: clean(p.title.replace(/^File:/, '')),
          imageUrl: image.href,
          sourceUrl: source.href,
          author: clean(i.extmetadata?.Artist?.value ?? ''),
          license: clean(i.extmetadata?.LicenseShortName?.value ?? 'See source license'),
        },
      ];
    })
    .slice(0, 4);
}
let nextRequestAt = 0;
const cache = new Map<string, { at: number; images: ReturnType<typeof commonsImageResults> }>();
export async function searchAssistantImages(query: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const key = z.string().trim().min(1).max(200).parse(query);
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < 600000)
    return { source: 'Wikimedia Commons', images: saved.images, cached: true };
  if (Date.now() < nextRequestAt) throw Error('image_search_cooldown');
  nextRequestAt = Date.now() + 1000;
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: key,
    gsrnamespace: '6',
    gsrlimit: '4',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
    iiextmetadatafilter: 'Artist|LicenseShortName',
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    redirect: 'error',
    headers: {
      'User-Agent': 'GOSU/0.58 (https://github.com/gli-minsuk-shin/GOSU)',
      Accept: 'application/json',
    },
  });
  if (response.status === 429) nextRequestAt = Date.now() + 600000;
  if (!response.ok) throw Error(`image_search_http_${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw Error('image_search_empty_response');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > 256000) throw Error('image_search_response_too_large');
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel();
  }
  signal.throwIfAborted();
  const images = commonsImageResults(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), images });
  return { source: 'Wikimedia Commons', images, cached: false };
}
