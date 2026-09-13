import { createHash } from 'node:crypto';
import type { LiveItem } from './src/live-types';
import { isExplicitCommercialPaperCandidate } from './briefing-paper-ad-filter';

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
const entities = (s: string) =>
  s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 40);
function scholarBibliography(citation?: string) {
  const parts = citation?.split(/\s[-–—]\s/);
  return {
    source: 'Google Scholar 알림',
    authors: parts?.[0] ? [parts[0].slice(0, 500)] : [],
    ...(parts?.[1] ? { venue: `${parts.slice(1).join(' — ').slice(0, 970)} (알림 기재)` } : {}),
  };
}
/** Recognition is a heuristic, never sender authentication or permission to read more mail. */
export function isScholarAlert(mail: LiveItem) {
  return (
    mail.kind === 'email' &&
    /(?:scholaralerts(?:-noreply)?@google\.com)|google scholar|구글 학술검색/i.test(
      `${mail.details[0] ?? ''} ${mail.title}`,
    )
  );
}
const publisherHosts = new Set([
  'doi.org',
  'dx.doi.org',
  'arxiv.org',
  'openreview.net',
  'proceedings.mlr.press',
  'jmlr.org',
  'www.jmlr.org',
  'nature.com',
  'www.nature.com',
  'link.springer.com',
  'www.sciencedirect.com',
  'sciencedirect.com',
  'onlinelibrary.wiley.com',
  'ieeexplore.ieee.org',
  'dl.acm.org',
  'journals.aps.org',
  'academic.oup.com',
  'projecteuclid.org',
  'epubs.siam.org',
]);
function paperLink(raw: string) {
  try {
    let value = entities(raw).replace(/[.,;]+$/, '');
    while (
      value.endsWith(')') &&
      (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)
    )
      value = value.slice(0, -1);
    let url = new URL(value);
    if (url.username || url.password) return null;
    const viaScholar = url.hostname === 'scholar.google.com' && url.pathname === '/scholar_url';
    if (viaScholar) url = new URL(url.searchParams.get('url') ?? '');
    if (url.username || url.password || url.port || !/^https?:$/.test(url.protocol)) return null;
    if (url.hostname === 'arxiv.org') {
      const id = url.pathname.match(
        /^\/(?:abs|html|pdf)\/((?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})(?:v[1-9]\d*)?)(?:\.pdf)?$/,
      )?.[1];
      return id
        ? {
            id: id.replace(/v\d+$/, ''),
            url: `https://arxiv.org/abs/${id}`,
            fallback: `arXiv ${id}`,
          }
        : null;
    }
    if (url.hostname === 'doi.org' || url.hostname === 'dx.doi.org') {
      const doi = decodeURIComponent(url.pathname.slice(1)).toLowerCase();
      return /^10\.\d{4,9}\/\S+$/.test(doi)
        ? { id: `doi:${digest(doi)}`, url: `https://doi.org/${doi}`, fallback: `DOI ${doi}` }
        : null;
    }
    if (
      url.protocol !== 'https:' ||
      (!viaScholar && !publisherHosts.has(url.hostname)) ||
      /^(?:localhost|\[|\d+\.)/.test(url.hostname) ||
      /\.(?:local|localhost)$/.test(url.hostname) ||
      /(?:^|\.)google\.[a-z.]+$/.test(url.hostname) ||
      /\/(?:unsubscribe|alerts?|settings?|preferences?|accounts?)(?:\/|$)/i.test(url.pathname)
    )
      return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^utm_|^(?:gclid|fbclid|scisig)$/i.test(key)) url.searchParams.delete(key);
    return {
      id: `scholar-paper:${digest(url.href)}`,
      url: url.href,
      fallback: 'Scholar 알림의 논문',
    };
  } catch {
    return null;
  }
}
function articleTitle(value: string) {
  const title = normalize(value).replace(/^\[(?:PDF|HTML)\]\s*/i, '');
  return title.length >= 8 &&
    title.length <= 500 &&
    !/https?:|unsubscribe|google scholar|구독 취소|알림 설정|view all|all versions|related articles|cited by|^new (?:articles|results)|^updates|^(?:full text|view article)$/i.test(
      title,
    ) &&
    !/(?: - | — | – ).*\b(?:19|20)\d{2}\b|\.$/.test(title)
    ? title
    : null;
}
/** Local extraction only: never request Scholar redirects, trackers, publishers or attachments. */
export function scholarCandidates(emails: readonly LiveItem[]) {
  const found = new Map<string, LiveItem>();
  for (const mail of emails) {
    if (!isScholarAlert(mail) || mail.readScope !== 'mail-preview') continue;
    const body = entities(
      mail.text
        .slice(0, 24000)
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(
          /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
          (_all, href: string, text: string) => `\n\n${text.replace(/<[^>]+>/g, '')}\n${href}\n`,
        )
        .replace(/<\/(?:p|div|h[1-6]|li)>|<br\s*\/?\s*>/gi, '\n\n')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/\r\n?/g, '\n')
      .replace(
        /(?:^|\n)(?:unsubscribe|cancel (?:this )?alert|this message was sent|구독 취소|알림 취소)[\s\S]*$/i,
        '',
      );
    const links = [...body.matchAll(/https?:\/\/[^\s<>"\]]+/g)].flatMap((m) => {
      const link = paperLink(m[0]);
      if (!link) return [];
      const blockStart = body.lastIndexOf('\n\n', m.index) + 2;
      const start = blockStart === 1 ? 0 : blockStart;
      const lines = [...body.slice(start, m.index).matchAll(/[^\n]+/g)];
      const titleLine = [...lines].reverse().find((line) => articleTitle(line[0]));
      const title = titleLine ? articleTitle(titleLine[0])! : link.fallback;
      return [
        {
          ...link,
          title,
          start: titleLine ? start + titleLine.index : start,
          end: m.index + m[0].length,
        },
      ];
    });
    // Mail.content may keep visible citations but omit HTML hrefs.
    const lines = [...body.matchAll(/[^\n]+/g)].map((line) => ({
      text: normalize(line[0]),
      at: line.index,
    }));
    const citations = lines.flatMap((line, index) => {
      const previous = lines[index - 1];
      return previous &&
        /.+\s[-–—]\s.+\b(?:19|20)\d{2}\b/.test(line.text) &&
        articleTitle(previous.text)
        ? [{ title: articleTitle(previous.text)!, authors: line.text, start: previous.at }]
        : [];
    });
    const nextEntry = (start: number) =>
      Math.min(
        body.length,
        ...links.filter((l) => l.start > start).map((l) => l.start),
        ...citations.filter((c) => c.start > start).map((c) => c.start),
      );
    for (let index = 0; index < links.length; index++) {
      const link = links[index]!;
      const next = links
        .slice(index + 1)
        .find((item) => item.id !== link.id && item.start > link.start);
      const end = Math.min(
        next?.start ?? body.length,
        ...citations.filter((c) => c.start > link.start).map((c) => c.start),
      );
      const excerpt = normalize(
        body
          .slice(link.start, end)
          .replace(/https?:\/\/[^\s<>"\]]+/g, (raw) => paperLink(raw)?.url ?? ''),
      );
      if (
        isExplicitCommercialPaperCandidate(
          link.title,
          excerpt,
          publisherHosts.has(new URL(link.url).hostname),
        )
      )
        continue;
      if (!found.has(link.id))
        found.set(link.id, {
          id: link.id,
          kind: 'papers',
          title: link.title,
          text: excerpt.slice(0, 1800) || link.title,
          source: 'Google Scholar 알림',
          bibliography: scholarBibliography(
            citations.find((c) => c.title.toLowerCase() === link.title.toLowerCase())?.authors,
          ),
          sourceUrl: link.url,
          readScope: 'mail-preview',
          privateOrigin: 'mail',
          discoverySource: 'google-scholar-alert',
          details: [
            '조회한 알림 본문에서 추출한 논문 후보입니다. 알림 발췌만으로 원문 전체를 읽었다고 판단하지 않습니다. 발신 진위는 검증하지 않았습니다.',
          ],
        });
    }
    for (let index = 0; index < citations.length; index++) {
      const citation = citations[index]!;
      if (
        links.some((link) => normalize(link.title).toLowerCase() === citation.title.toLowerCase())
      )
        continue;
      const id = `scholar-citation:${digest(normalize(`${citation.title}\n${citation.authors}`).toLowerCase())}`;
      if (!found.has(id))
        found.set(id, {
          id,
          kind: 'papers',
          title: citation.title,
          text: normalize(
            body
              .slice(citation.start, nextEntry(citation.start))
              .replace(/https?:\/\/[^\s<>"\]]+/g, (raw) => paperLink(raw)?.url ?? ''),
          ).slice(0, 1800),
          source: 'Google Scholar 알림',
          bibliography: scholarBibliography(citation.authors),
          readScope: 'mail-preview',
          privateOrigin: 'mail',
          discoverySource: 'google-scholar-alert',
          details: [
            '알림의 제목·저자·연도 구조에서 추출한 후보입니다. 원문 링크와 전체 내용을 확인하지 못했으며, 알림 발췌만 사용합니다. 발신 진위는 검증하지 않았습니다.',
          ],
        });
    }
    if (found.size >= 12) break;
  }
  return [...found.values()].slice(0, 12);
}
