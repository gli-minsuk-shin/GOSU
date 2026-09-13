import { normalizeCrossrefWork } from '../desktop/src/main/literature-crossref';
import type { LiveItem } from './src/live-types';

/** Parse identifiers, never infer that a long natural-language question is a title. */
export function paperIdentifier(raw: string): { kind: 'doi' | 'arxiv'; id: string } | undefined {
  let text = raw.trim();
  if (/^https?:/i.test(text)) {
    const url = new URL(text);
    if (url.username || url.password || url.port || url.search || url.hash) return;
    if (['doi.org', 'dx.doi.org'].includes(url.hostname))
      text = decodeURIComponent(url.pathname.slice(1));
    else if (['arxiv.org', 'www.arxiv.org'].includes(url.hostname))
      text = decodeURIComponent(url.pathname.replace(/^\/(abs|pdf|html)\//, '')).replace(
        /\.pdf$/,
        '',
      );
    else return;
  }
  text = text.replace(/^(doi|arxiv):\s*/i, '');
  const arxivDoi = /^10\.48550\/arxiv\.(.+)$/i.exec(text);
  if (arxivDoi) text = arxivDoi[1]!;
  if (/^(\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(v[1-9]\d*)?$/i.test(text))
    return { kind: 'arxiv', id: text };
  if (/^10\.\d{4,9}\/[^\s?#]+$/i.test(text) && text.length <= 300)
    return { kind: 'doi', id: text.toLowerCase() };
  return;
}

// Deposit/creation timestamps are NOT publication dates. A year alone is not an exact day.
export function crossrefPublication(raw: { [key: string]: unknown }): {
  year?: number;
  publishedAt?: string;
} {
  for (const key of ['published-online', 'published-print', 'published', 'issued']) {
    const value = raw[key] as { 'date-parts'?: number[][] } | undefined;
    const parts = value?.['date-parts']?.[0];
    if (!parts || !Number.isInteger(parts[0]) || parts[0]! < 1000 || parts[0]! > 3000) continue;
    const [year, month, day] = parts;
    const date = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1));
    return {
      year: year!,
      ...(parts.length >= 3 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
        ? { publishedAt: date.toISOString() }
        : {}),
    };
  }
  return {};
}

export function parseCrossrefPapers(
  raw: string,
  doi?: string,
): { item: LiveItem; year?: number; venue?: string }[] {
  const envelope = JSON.parse(raw) as { message?: unknown };
  const message = envelope.message;
  if (!message || typeof message !== 'object') throw new Error('paper_metadata_invalid');
  const values = doi ? [message] : (message as { items?: unknown }).items;
  if (!Array.isArray(values) || values.length > 100) throw new Error('paper_metadata_invalid');
  return values.flatMap((raw) => {
    const candidate = normalizeCrossrefWork(raw);
    if (
      !candidate?.doi ||
      !['journal-article', 'proceedings-article', 'posted-content'].includes(
        candidate.workType ?? '',
      )
    )
      return [];
    if (doi && candidate.doi.toLowerCase() !== doi.toLowerCase()) return [];
    const publication = crossrefPublication(raw);
    return [
      {
        ...publication,
        ...(candidate.containerTitle ? { venue: candidate.containerTitle } : {}),
        item: {
          id: `doi:${candidate.doi.toLowerCase()}`,
          kind: 'papers' as const,
          title: candidate.title,
          text: candidate.abstractText ?? '',
          source: 'Crossref · 출판사 서지정보',
          sourceUrl: `https://doi.org/${candidate.doi}`,
          ...(publication.publishedAt ? { publishedAt: publication.publishedAt } : {}),
          bibliography: {
            authors: candidate.authors.slice(0, 30),
            ...(candidate.containerTitle ? { venue: candidate.containerTitle } : {}),
            source: 'Crossref',
          },
          readScope: candidate.abstractText ? ('abstract' as const) : ('paper-metadata' as const),
          details: [
            candidate.abstractText
              ? '등록된 초록 · 원문 미확인'
              : '서지정보만 확인 · 초록과 원문 미확보',
          ],
        },
      },
    ];
  });
}
