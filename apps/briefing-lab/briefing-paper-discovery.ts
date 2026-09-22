import type { InterestProfile, LiveSettings } from '@gosu/briefing-core';
import type { LiveItem } from './src/live-types';
import { searchPapers, arxivQuery } from './live-public-sources';
import { publicSourceText, SourceReadError } from './live-public-http';
import { parseCrossrefPapers } from './briefing-paper-identifiers';
import { parseOpenReviewPapers } from './briefing-public-paper-lookup';
import { savedPaperKey } from './src/paper-library-index';

const normalized = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const matches = (text: string, term: string) =>
  !!normalized(term) && ` ${normalized(text)} `.includes(` ${normalized(term)} `);
export function rankRecentPapers(
  items: LiveItem[],
  profile: InterestProfile,
  options: LiveSettings['papers'],
  now: string,
  summarized: ReadonlySet<string>,
) {
  const seen = new Set<string>();
  return items
    .flatMap((item) => {
      const date = Date.parse(item.publishedAt ?? ''),
        end = Date.parse(now);
      const key = savedPaperKey(item);
      if (
        !Number.isFinite(date) ||
        date > end ||
        date < end - options.days * 86400000 ||
        seen.has(key) ||
        summarized.has(key)
      )
        return [];
      if (
        profile.excluded.some((term) => matches(`${item.title} ${item.text}`, term)) ||
        (options.author.trim() &&
          !item.bibliography?.authors.some((a) => matches(a, options.author)))
      )
        return [];
      let score = 0;
      const matchedKeywords: string[] = [];
      for (const keyword of profile.keywords) {
        const terms = [keyword.term, ...keyword.synonyms];
        const title = terms.some((t) => matches(item.title, t)),
          abstract = terms.some((t) => matches(item.text, t));
        if (title || abstract) {
          score += keyword.weight * ((title ? 3 : 0) + (abstract ? 1 : 0));
          matchedKeywords.push(keyword.term);
        }
      }
      if (!score) return [];
      seen.add(key);
      return [{ ...item, score, matchedKeywords }];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, options.limit);
}

export type PaperDiscoveryFailure = Readonly<{ source: string; code: string }>;

/** No ranked paper and at least one index failed; keeps which index failed and why. */
export class PapersDiscoveryIncompleteError extends Error {
  constructor(readonly failures: readonly PaperDiscoveryFailure[]) {
    super('papers_discovery_incomplete');
  }
}

/** Independent public indexes; never retry a blocked arXiv host or widen the saved date scope. */
export function createBriefingPaperSearcher({
  arxiv = searchPapers,
  read = publicSourceText,
  timeoutMs = 12000,
  clock = Date.now,
} = {}) {
  const cache = new Map<
    string,
    { at: number; items: LiveItem[]; partial: boolean; failures: PaperDiscoveryFailure[] }
  >();
  return async (
    profile: InterestProfile,
    options: LiveSettings['papers'],
    signal: AbortSignal,
    now = new Date(clock()).toISOString(),
    summarized: ReadonlySet<string> = new Set(),
  ): Promise<LiveItem[]> => {
    arxivQuery(profile, options, now); // Preserve existing profile validation.
    if (signal.aborted) throw new Error('source_cancelled');
    const key = JSON.stringify([profile, options]);
    const hit = cache.get(key);
    if (hit && clock() - hit.at < 120000) {
      const items = rankRecentPapers(structuredClone(hit.items), profile, options, now, summarized);
      if (!items.length && hit.partial) throw new PapersDiscoveryIncompleteError(hit.failures);
      return items.map((i) => ({
        ...i,
        details: [...i.details, '최근 검색 결과 재사용 · 추가 검색 요청 없음'],
      }));
    }
    const failures: PaperDiscoveryFailure[] = [];
    const attempt = async (name: string, run: (signal: AbortSignal) => Promise<LiveItem[]>) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort: (() => void) | undefined;
      const stopped = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new Error('source_cancelled'));
        signal.addEventListener('abort', rejectAbort, { once: true });
        timer = setTimeout(() => {
          reject(new SourceReadError('source_timeout', name, 'timeout'));
          controller.abort();
        }, timeoutMs);
      });
      try {
        if (signal.aborted) throw new Error('source_cancelled');
        return await Promise.race([run(controller.signal), stopped]);
      } catch (error) {
        if (signal.aborted) throw new Error('source_cancelled', { cause: error });
        failures.push({
          source: name,
          code: error instanceof Error ? error.message : 'source_unavailable',
        });
        return [];
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (rejectAbort) signal.removeEventListener('abort', rejectAbort);
      }
    };
    // Bounded independent queries, not a single AND expression which could exclude every paper.
    const terms = [...profile.keywords]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((k) => k.term);
    const buckets = await Promise.all([
      attempt('arXiv', (s) =>
        arxiv(profile, { ...options, limit: 60 }, s, undefined, now, new Set()),
      ),
      ...terms.flatMap((term) => [
        attempt('Crossref', async (s) => {
          const url = new URL('https://api.crossref.org/works');
          url.search = new URLSearchParams({
            query: term,
            rows: '60',
            sort: 'relevance',
            order: 'desc',
            filter: `from-pub-date:${new Date(Date.parse(now) - options.days * 86400000).toISOString().slice(0, 10)},until-pub-date:${now.slice(0, 10)}`,
          }).toString();
          return parseCrossrefPapers(await read(url, s)).map((r) => r.item);
        }),
        attempt('OpenReview', async (s) => {
          const url = new URL('https://api2.openreview.net/notes/search');
          url.search = new URLSearchParams({
            term,
            content: 'title',
            source: 'forum',
            limit: '60',
          }).toString();
          return parseOpenReviewPapers(await read(url, s), term, 'recent').map((r) => r.item);
        }),
      ]),
    ]);
    if (signal.aborted) throw new Error('source_cancelled');
    const all = buckets.flat();
    const items = rankRecentPapers(all, profile, options, now, summarized);
    if (!items.length && failures.length) throw new PapersDiscoveryIncompleteError(failures);
    const note = `arXiv·Crossref·OpenReview 검색 · 대체 출처는 상위 ${terms.length}개 키워드 중심의 제한된 후보 조회 · 기간·저자·제외어 유지${failures.length ? ' · 일부 출처 응답 실패, 확보한 결과만 표시' : ''}`;
    const evidence = all.map((i) => ({ ...i, details: [...i.details, note] }));
    if (!failures.length || items.length) {
      if (cache.size >= 24) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: clock(), items: evidence, partial: failures.length > 0, failures });
    }
    return rankRecentPapers(evidence, profile, options, now, summarized);
  };
}
export const searchBriefingPapers = createBriefingPaperSearcher();
export const searchCollectionPapers: typeof searchPapers = (
  profile,
  options,
  signal,
  read,
  now,
  summarized,
  mode = 'recent',
) =>
  mode === 'recent' && !read
    ? searchBriefingPapers(profile, options, signal, now, summarized)
    : searchPapers(profile, options, signal, read, now, summarized, mode);
