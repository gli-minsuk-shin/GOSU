import { defaultLiveSettings } from '@gosu/briefing-core';
import { PublicPaperLookup } from './briefing-public-paper-lookup';
import type { LiveItem } from './src/live-types';

export async function resolvePaperSaveSource(
  url: string,
  title: string,
  signal: AbortSignal,
  lookup: Pick<PublicPaperLookup, 'search' | 'read'> = new PublicPaperLookup(),
): Promise<LiveItem> {
  const openReview = url.startsWith('https://openreview.net/forum?');
  const result = await lookup.search(
    openReview ? title : url,
    { keywords: [], excluded: [] },
    defaultLiveSettings().papers,
    signal,
    openReview ? { mode: 'title' } : {},
  );
  const source = result.items.find(
    (item) =>
      item.sourceUrl === url ||
      (url.startsWith('https://doi.org/') && item.sourceUrl?.toLowerCase() === url.toLowerCase()),
  );
  if (!source) throw new Error('논문 식별을 확인하지 못했습니다. 저장하지 않았습니다.');
  const body = await lookup.read(source, signal);
  if ((body.excerpt || source.text).trim().length < 20)
    throw new Error(
      '논문 본문이나 초록을 확보하지 못했습니다. 서지정보만으로 요약을 만들지 않습니다.',
    );
  return {
    ...source,
    paper: {
      readScope: body.readScope,
      excerpt: body.excerpt,
      sourceUrl: body.sourceUrl,
      note: body.note,
      equations: body.equations ?? [],
      figures: body.figures ?? [],
    },
  };
}
