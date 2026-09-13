import { DOMParser } from '@xmldom/xmldom';
import sharp from 'sharp';
import { publicSourceBytes, publicSourceText, assertPublicSourceUrl } from './live-public-http';
import type { LiveItem } from './src/live-types';
const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();
export function parsePaperHtml(html: string, sourceUrl: string): NonNullable<LiveItem['paper']> {
  if (html.length > 2_000_000 || /<!ENTITY/i.test(html)) throw new Error('paper_html_invalid');
  const root = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: () => undefined,
      fatalError: () => {
        throw new Error('paper_html_invalid');
      },
    },
  }).parseFromString(html, 'text/html');
  for (const tag of ['script', 'style', 'nav'])
    for (const element of Array.from(root.getElementsByTagName(tag)))
      element.parentNode?.removeChild(element);
  const paragraphs = Array.from(root.getElementsByTagName('p'))
    .filter((p) => (p.getAttribute('class') ?? '').includes('ltx_p'))
    .slice(0, 90)
    .map((p) => normalized(p.textContent ?? ''))
    .filter(Boolean);
  const mathElements = Array.from(root.getElementsByTagName('math'));
  const equations = mathElements
    .map((math, index) => ({ math, index }))
    .sort(
      (a, b) =>
        Number(b.math.getAttribute('display') === 'block') -
        Number(a.math.getAttribute('display') === 'block'),
    )
    .flatMap(({ math, index }) => {
      const latex =
        math.getAttribute('alttext') ||
        Array.from(math.getElementsByTagName('annotation')).find(
          (a) => a.getAttribute('encoding') === 'application/x-tex',
        )?.textContent;
      return latex && latex.length < 2500 ? [{ id: `eq-${index}`, latex }] : [];
    })
    .slice(0, 12);
  const figures = Array.from(root.getElementsByTagName('figure'))
    .flatMap((figure, index) => {
      const image = figure.getElementsByTagName('img')[0],
        caption = normalized(figure.getElementsByTagName('figcaption')[0]?.textContent ?? '');
      if (!image || !caption) return [];
      try {
        const src = image.getAttribute('src') ?? '';
        const asset = src.includes('/') ? new URL(src, sourceUrl) : new URL(src, `${sourceUrl}/`);
        assertPublicSourceUrl(asset);
        if (!asset.pathname.startsWith(`${new URL(sourceUrl).pathname}/`)) return [];
        return [{ id: `fig-${index}`, caption: caption.slice(0, 1800), assetUrl: asset.href }];
      } catch {
        return [];
      }
    })
    .slice(0, 8);
  if (!paragraphs.length) throw new Error('paper_html_unavailable');
  return {
    readScope: 'html-excerpt',
    excerpt: paragraphs.join('\n').slice(0, 24000),
    equations,
    figures,
    sourceUrl,
    note: '공개 HTML의 앞부분 최대 24,000자·수식·그림 캡션을 읽었습니다. 논문 전체를 검증한 것은 아닙니다.',
  };
}
export async function enrichPaper(item: LiveItem, signal: AbortSignal): Promise<LiveItem> {
  const id = item.sourceUrl?.match(/^https:\/\/arxiv\.org\/abs\/([^?#]+)$/)?.[1];
  if (!id) return item;
  const url = `https://arxiv.org/html/${id}`;
  try {
    return { ...item, paper: parsePaperHtml(await publicSourceText(new URL(url), signal), url) };
  } catch (error) {
    if (signal.aborted) throw error;
    if (item.discoverySource === 'google-scholar-alert')
      return {
        ...item,
        details: [
          ...item.details,
          'arXiv 본문을 확인하지 못해 알림 발췌만 사용합니다. 초록이나 논문 전체를 확인한 것은 아닙니다.',
        ],
      };
    return {
      ...item,
      paper: {
        readScope: 'abstract',
        excerpt: item.text,
        equations: [],
        figures: [],
        sourceUrl: item.sourceUrl!,
        note: '공개 HTML 본문/그림을 읽지 못해 초록만 사용했습니다. PDF·유료 원문을 우회하지 않았습니다.',
      },
    };
  }
}
export async function loadPaperFigure(
  assetUrl: string,
  sourceUrl: string,
  signal: AbortSignal,
  read = publicSourceBytes,
) {
  const url = new URL(assetUrl),
    source = new URL(sourceUrl);
  assertPublicSourceUrl(url);
  if (url.origin !== source.origin || !url.pathname.startsWith(`${source.pathname}/`))
    throw new Error('figure_scope_invalid');
  const bytes = await read(url, signal);
  const decoder = sharp(bytes, { limitInputPixels: 16_000_000 });
  const metadata = await decoder.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? ''))
    throw new Error('figure_format_invalid');
  for (const width of [1000, 800, 600]) {
    const output = await decoder
      .clone()
      .resize({ width, height: Math.round(width * 0.6), fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    if (output.length <= 300_000) return `data:image/webp;base64,${output.toString('base64')}`;
  }
  throw new Error('figure_size_limit');
}
export { scholarCandidates } from './briefing-scholar-alerts';
