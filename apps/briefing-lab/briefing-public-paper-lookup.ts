import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { z } from 'zod';
import type { InterestProfile, LiveSettings } from '@gosu/briefing-core';
import type { LiveItem } from './src/live-types';
import { searchPapers, type PaperSearchMode } from './live-public-sources';
import {
  assertPublicSourceUrl,
  publicSourceBytes,
  publicSourceText,
  sourceFailureReceipt,
  SourceReadError,
} from './live-public-http';
import { paperIdentifier, parseCrossrefPapers } from './briefing-paper-identifiers';
import { parsePaperHtml } from './briefing-paper-evidence';
import { extractProjectChatPdf } from '../desktop/src/main/project-chat-pdf-extractor';

export const PaperLookupRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(300),
    mode: z.enum(['title', 'topic', 'recent']).optional(),
    year: z.number().int().min(1900).max(2100).optional(),
  })
  .strict();
export type PaperLookupOptions = Omit<z.infer<typeof PaperLookupRequestSchema>, 'query'>;
type Attempt = {
  provider: string;
  status: 'ready' | 'empty' | 'failed';
  detail?: ReturnType<typeof sourceFailureReceipt>;
  code?: string;
};
export type PublicPaperResult = {
  items: LiveItem[];
  status: 'ready' | 'partial' | 'failed' | 'empty';
  coverage: string;
  attempts: Attempt[];
  cacheReused: boolean;
};
export type PublicPaperReading = {
  status: 'ready' | 'partial';
  sourceUrl: string;
  title: string;
  readScope: 'pdf-text-excerpt' | 'html-excerpt' | 'abstract';
  excerpt: string;
  totalCharacters: number;
  nextOffset: number | null;
  pageCount?: number;
  pagesRead?: number;
  note: string;
  attempts: Attempt[];
  fetchedAt?: string;
  cacheReused?: boolean;
  equations?: { id: string; latex: string }[];
  figures?: { id: string; caption: string; assetUrl: string }[];
};
type Record = {
  item: LiveItem;
  pdfUrl?: string;
  year?: number;
  venue?: string;
  bodyAt?: number;
  body?: Omit<PublicPaperReading, 'excerpt' | 'nextOffset'> & { excerpt: string };
};
const visualReferences = (original: NonNullable<LiveItem['paper']>) => ({
  equations: original.equations.filter((e) => e.latex.length <= 2000).slice(0, 8),
  figures: original.figures
    .slice(0, 4)
    .map(({ id, caption, assetUrl }) => ({ id, caption: caption.slice(0, 600), assetUrl })),
});
const defaults = {
  read: publicSourceText,
  bytes: publicSourceBytes,
  arxiv: searchPapers,
  extract: extractProjectChatPdf,
  now: Date.now,
  searchTimeoutMs: 12000,
};
const normalizedTitle = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const titleWords = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const hasPhrase = (haystack: string, needle: string) =>
  /[a-z0-9]/i.test(needle)
    ? ` ${titleWords(haystack)} `.includes(` ${titleWords(needle)} `)
    : titleWords(haystack).includes(titleWords(needle));
export const samePaperTitle = (a: string, b: string) =>
  !!titleWords(a) && titleWords(a) === titleWords(b);
const value = (raw: unknown): unknown =>
  raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
const text = (raw: unknown) => (typeof value(raw) === 'string' ? String(value(raw)).trim() : '');
const hashId = (url: string) => `public-paper:${createHash('sha256').update(url).digest('hex')}`;
function html(raw: string) {
  if (raw.length > 8_000_000 || /<!ENTITY/i.test(raw)) throw new Error('paper_html_invalid');
  return new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: () => undefined,
      fatalError: () => {
        throw new Error('paper_html_invalid');
      },
    },
  }).parseFromString(raw, 'text/html');
}
function safePdf(raw: string, base: string) {
  try {
    const url = new URL(raw, base);
    assertPublicSourceUrl(url);
    return ['openreview.net', 'proceedings.mlr.press'].includes(url.hostname) &&
      (url.pathname.endsWith('.pdf') || url.pathname === '/pdf')
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function parseOpenReviewPapers(raw: string, query: string, mode: PaperSearchMode): Record[] {
  const data = z
    .object({
      notes: z
        .array(
          z.object({
            id: z.string().regex(/^[\w-]{1,80}$/),
            forum: z.string().optional(),
            replyto: z.string().nullable().optional(),
            pdate: z.number().nullable().optional(),
            content: z.record(z.string(), z.unknown()),
          }),
        )
        .max(100),
    })
    .parse(JSON.parse(raw));
  return data.notes.flatMap((note) => {
    if (note.replyto || (note.forum && note.forum !== note.id)) return [];
    const title = text(note.content.title),
      abstract = text(note.content.abstract),
      venue = text(note.content.venue);
    if (!title || (mode === 'title' && !samePaperTitle(title, query))) return [];
    const sourceUrl = `https://openreview.net/forum?id=${note.id}`;
    const authors = value(note.content.authors);
    const year = Number((venue + ' ' + text(note.content.venueid)).match(/\b(19|20)\d{2}\b/)?.[0]);
    const pdfUrl = safePdf(text(note.content.pdf), 'https://openreview.net');
    const item: LiveItem = {
      id: hashId(sourceUrl),
      kind: 'papers',
      title: title.slice(0, 2000),
      text: abstract.slice(0, 16000),
      source: 'OpenReview · 공개 자료',
      sourceUrl,
      readScope: abstract ? 'abstract' : 'paper-metadata',
      details: ['OpenReview 공개 원문 메타데이터 · arXiv 재요청 없음', venue || '게재 상태 미확인'],
      bibliography: {
        authors: Array.isArray(authors)
          ? authors
              .filter((a): a is string => typeof a === 'string')
              .slice(0, 30)
              .map((a) => a.slice(0, 500))
          : [],
        source: 'OpenReview',
        ...(venue ? { venue: venue.slice(0, 1000) } : {}),
      },
      ...(note.pdate && note.pdate < Date.now() + 60000
        ? { publishedAt: new Date(note.pdate).toISOString() }
        : {}),
    };
    return [
      {
        item,
        ...(pdfUrl ? { pdfUrl } : {}),
        ...(Number.isFinite(year) && year ? { year } : {}),
        ...(venue ? { venue } : {}),
      },
    ];
  });
}
export function pmlrVolumes(raw: string, year: number, venue: string) {
  const alias = /\bICML\b/i.test(venue)
    ? /international conference on machine learning|\bICML\b/i
    : /\bAISTATS\b/i.test(venue)
      ? /artificial intelligence and statistics|\bAISTATS\b/i
      : /\bCOLT\b/i.test(venue)
        ? /learning theory|\bCOLT\b/i
        : /\bCoRL\b/i.test(venue)
          ? /robot learning|\bCoRL\b/i
          : null;
  if (!alias) return [];
  return [
    ...new Set(
      Array.from(html(raw).getElementsByTagName('a')).flatMap((a) => {
        const label = a.parentNode?.textContent ?? '',
          link = new URL(a.getAttribute('href') || '', 'https://proceedings.mlr.press');
        return link.hostname === 'proceedings.mlr.press' &&
          /^\/v\d+\/?$/.test(link.pathname) &&
          label.includes(String(year)) &&
          alias.test(label)
          ? [`https://proceedings.mlr.press${link.pathname.replace(/\/$/, '')}/`]
          : [];
      }),
    ),
  ].slice(0, 2);
}
export function pmlrTitleLink(raw: string, volume: string, title: string) {
  const page = html(raw);
  for (const paper of Array.from(page.getElementsByTagName('div'))) {
    if (!(paper.getAttribute('class') ?? '').split(/\s+/).includes('paper')) continue;
    const heading = Array.from(paper.getElementsByTagName('p')).find((p) =>
      (p.getAttribute('class') ?? '').split(/\s+/).includes('title'),
    );
    if (!heading || !samePaperTitle(heading.textContent ?? '', title)) continue;
    for (const anchor of Array.from(paper.getElementsByTagName('a'))) {
      try {
        const url = new URL(anchor.getAttribute('href') ?? '', volume);
        if (url.hostname === 'proceedings.mlr.press' && /^\/v\d+\/[\w-]+\.html$/.test(url.pathname))
          return url.href;
      } catch {
        /* Ignore malformed links, never fetch them. */
      }
    }
  }
  for (const anchor of Array.from(page.getElementsByTagName('a'))) {
    if (!samePaperTitle(anchor.textContent ?? '', title)) continue;
    const url = new URL(anchor.getAttribute('href') ?? '', volume);
    if (url.hostname === 'proceedings.mlr.press' && /^\/v\d+\/[\w-]+\.html$/.test(url.pathname))
      return url.href;
  }
  return undefined;
}
export function parsePmlrPaper(raw: string, url: string, title?: string): Record {
  const page = html(raw),
    metas = Array.from(page.getElementsByTagName('meta'));
  const values = (name: string) =>
    metas
      .filter((m) => m.getAttribute('name') === name)
      .map((m) => (m.getAttribute('content') ?? '').trim());
  const actualTitle = values('citation_title')[0];
  if (!actualTitle || (title && !samePaperTitle(title, actualTitle)))
    throw new Error('paper_identity_mismatch');
  const abstract =
    Array.from(page.getElementsByTagName('div'))
      .find((n) => n.getAttribute('id') === 'abstract')
      ?.textContent?.trim() ?? '';
  const pdfUrl = safePdf(values('citation_pdf_url')[0] ?? '', url);
  if (pdfUrl && !new URL(pdfUrl).pathname.startsWith(new URL(url).pathname.replace(/\.html$/, '')))
    throw new Error('paper_identity_mismatch');
  const venue =
    values('citation_conference_title')[0] ?? values('citation_journal_title')[0] ?? 'PMLR';
  const date = values('citation_publication_date')[0]?.replace(/\//g, '-');
  const item: LiveItem = {
    id: hashId(url),
    kind: 'papers',
    title: actualTitle,
    text: abstract.slice(0, 16000),
    source: 'PMLR · 공식 출판본',
    sourceUrl: url,
    readScope: abstract ? 'abstract' : 'paper-metadata',
    details: ['공식 출판 페이지에서 제목 일치 확인'],
    bibliography: { authors: values('citation_author').slice(0, 30), venue, source: 'PMLR' },
    ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
      ? { publishedAt: new Date(date).toISOString() }
      : {}),
  };
  return { item, ...(pdfUrl ? { pdfUrl } : {}), venue };
}
export function dataCiteArxivPaper(raw: string, title: string): LiveItem | undefined {
  const data = z
    .object({
      data: z
        .array(
          z.object({
            id: z.string(),
            attributes: z.object({
              titles: z.array(z.object({ title: z.string() })),
              descriptions: z
                .array(
                  z.object({ description: z.string(), descriptionType: z.string().optional() }),
                )
                .optional(),
              version: z.string().nullable().optional(),
            }),
          }),
        )
        .max(20),
    })
    .parse(JSON.parse(raw));
  for (const record of data.data) {
    const id = record.id.match(/^10\.48550\/arxiv\.(\d{4}\.\d{4,5})(?:v\d+)?$/i)?.[1];
    if (!id || !record.attributes.titles.some((t) => samePaperTitle(t.title, title))) continue;
    const version =
      record.attributes.version && /^[1-9]\d{0,2}$/.test(record.attributes.version)
        ? `v${record.attributes.version}`
        : '';
    return {
      id: `arxiv:${id}${version}`,
      kind: 'papers',
      title,
      text:
        record.attributes.descriptions
          ?.find((d) => d.descriptionType === 'Abstract')
          ?.description.slice(0, 16000) ?? '',
      source: 'DataCite · arXiv DOI 메타데이터',
      sourceUrl: `https://arxiv.org/abs/${id}${version}`,
      readScope: 'abstract',
      details: ['DataCite DOI와 제목 일치 확인 · arXiv 검색 API 재호출 없음'],
    };
  }
  return undefined;
}

export class PublicPaperLookup {
  private records = new Map<string, Record>();
  private cache = new Map<string, { at: number; result: PublicPaperResult }>();
  private pmlrIndex?: { at: number; text: string };
  private dependencies: typeof defaults;
  constructor(overrides: Partial<typeof defaults> = {}) {
    this.dependencies = { ...defaults, ...overrides };
  }
  private retain(record: Record) {
    const previous = this.records.get(record.item.id);
    if (
      previous?.body &&
      previous.item.sourceUrl === record.item.sourceUrl &&
      samePaperTitle(previous.item.title, record.item.title)
    ) {
      record.body = previous.body;
      if (previous.bodyAt !== undefined) record.bodyAt = previous.bodyAt;
    }
    if (this.records.size >= 128) this.records.delete(this.records.keys().next().value!);
    this.records.set(record.item.id, record);
  }
  async search(
    query: string,
    interest: InterestProfile,
    options: LiveSettings['papers'],
    signal: AbortSignal,
    input: PaperLookupOptions = {},
  ): Promise<PublicPaperResult> {
    PaperLookupRequestSchema.parse({ query, ...input });
    if (signal.aborted) throw new Error('source_cancelled');
    const identifier = paperIdentifier(query);
    const mode = input.mode ?? 'topic';
    const key = JSON.stringify([
      identifier
        ? `${identifier.kind}:${identifier.id}`
        : mode === 'title'
          ? titleWords(query)
          : query.trim(),
      identifier ? 'identifier' : mode,
      input.year ?? null,
      mode === 'recent' ? [interest, options] : null,
    ]);
    const cached = this.cache.get(key);
    if (
      cached &&
      cached.result.items.every((i) => this.records.has(i.id)) &&
      this.dependencies.now() - cached.at <
        (mode === 'recent' ? 120000 : mode === 'topic' && !identifier ? 600000 : 86400000)
    )
      return {
        ...structuredClone(cached.result),
        attempts: [],
        cacheReused: true,
        coverage: '이전에 확인한 공개 논문 자료 재사용 · 새 외부 요청 없음',
      };
    if (signal.aborted) throw new Error('source_cancelled');
    const attempts: Attempt[] = [];
    const failure = (provider: string, error: unknown) => {
      if (signal.aborted) throw new Error('source_cancelled');
      attempts.push({
        provider,
        status: 'failed',
        detail: sourceFailureReceipt(error),
        code:
          error instanceof Error && /^(source_|paper_)/.test(error.message)
            ? error.message
            : 'source_unavailable',
      });
    };
    let records: Record[] = [];
    const eligible = (record: Record) => {
      const published = record.item.publishedAt ? Date.parse(record.item.publishedAt) : NaN;
      const year =
        record.year ??
        (Number.isFinite(published) ? new Date(published).getUTCFullYear() : undefined);
      return (
        (!input.year || year === input.year) &&
        (mode !== 'title' || samePaperTitle(record.item.title, query)) &&
        (mode !== 'recent' ||
          (Number.isFinite(published) &&
            published <= this.dependencies.now() &&
            published >= this.dependencies.now() - options.days * 86400000 &&
            !interest.excluded.some((term) =>
              hasPhrase(`${record.item.title} ${record.item.text}`, term),
            ) &&
            (!options.author.trim() ||
              record.item.bibliography?.authors.some((author) =>
                hasPhrase(author, options.author),
              ))))
      );
    };
    // Independent providers run concurrently. A slow endpoint cannot consume the entire tool budget.
    const attempt = async (
      provider: string,
      host: string,
      run: (s: AbortSignal) => Promise<Record[]>,
    ) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const stopped = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('source_cancelled'));
        signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => {
          reject(new SourceReadError('source_timeout', host, 'timeout'));
          controller.abort();
        }, this.dependencies.searchTimeoutMs);
      });
      try {
        if (signal.aborted) throw new Error('source_cancelled');
        const found = (await Promise.race([run(controller.signal), stopped])).filter(
          (r) => identifier || /^https?:/i.test(query) || eligible(r),
        );
        attempts.push({ provider, status: found.length ? 'ready' : 'empty' });
        return found;
      } catch (error) {
        failure(provider, error);
        return [];
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    };
    if (identifier?.kind === 'doi')
      records = await attempt('Crossref', 'api.crossref.org', async (s) =>
        parseCrossrefPapers(
          await this.dependencies.read(
            new URL(`https://api.crossref.org/works/${encodeURIComponent(identifier.id)}`),
            s,
          ),
          identifier.id,
        ),
      );
    if (identifier?.kind === 'arxiv')
      records = await attempt('arXiv article', 'arxiv.org', async (s) => {
        const url = `https://arxiv.org/abs/${identifier.id}`;
        const raw = await this.dependencies.read(new URL(url), s);
        const record = parsePmlrPaper(raw, url);
        record.item.source = 'arXiv · 논문 메타데이터';
        record.item.bibliography = {
          authors: record.item.bibliography?.authors ?? [],
          source: 'arXiv',
          venue: 'arXiv · preprint',
        };
        record.venue = 'arXiv';
        record.item.text = Array.from(html(raw).getElementsByTagName('blockquote'))
          .filter((e) => (e.getAttribute('class') ?? '').split(/\s+/).includes('abstract'))
          .map((e) => e.textContent ?? '')
          .join(' ')
          .trim()
          .slice(0, 16000);
        record.item.readScope = record.item.text ? 'abstract' : 'paper-metadata';
        record.item.details = ['arXiv 식별자로 논문 페이지 확인 · 검색 API 호출 없음'];
        record.pdfUrl = `https://arxiv.org/pdf/${identifier.id}`;
        return [record];
      });
    try {
      const url = new URL(query);
      if (url.hostname === 'proceedings.mlr.press' && /^\/v\d+\/[\w-]+\.html$/.test(url.pathname))
        records = await attempt('PMLR', 'proceedings.mlr.press', async (s) => [
          parsePmlrPaper(await this.dependencies.read(url, s), url.href),
        ]);
    } catch (error) {
      if (!(error instanceof TypeError)) failure('PMLR', error);
    }
    if (!identifier && !/^https?:/i.test(query)) {
      const buckets = await Promise.all([
        attempt('arXiv', 'export.arxiv.org', async (s) =>
          (
            await this.dependencies.arxiv(
              { ...interest, keywords: [{ term: query, weight: 5, synonyms: [] }] },
              { ...options, limit: 6, enabled: true },
              s,
              undefined,
              new Date(this.dependencies.now()).toISOString(),
              new Set(),
              mode,
            )
          ).map((item) => ({ item })),
        ),
        attempt('Crossref', 'api.crossref.org', async (s) => {
          const url = new URL('https://api.crossref.org/works');
          url.searchParams.set(mode === 'title' ? 'query.bibliographic' : 'query', query);
          url.searchParams.set('rows', '20');
          if (input.year)
            url.searchParams.set(
              'filter',
              `from-pub-date:${input.year}-01-01,until-pub-date:${input.year}-12-31`,
            );
          else if (mode === 'recent')
            url.searchParams.set(
              'filter',
              `from-pub-date:${new Date(this.dependencies.now() - options.days * 86400000).toISOString().slice(0, 10)}`,
            );
          return parseCrossrefPapers(await this.dependencies.read(url, s));
        }),
        attempt('OpenReview', 'api2.openreview.net', async (s) => {
          const url = new URL('https://api2.openreview.net/notes/search');
          url.search = new URLSearchParams({
            term: query,
            content: 'title',
            source: 'forum',
            limit: '20',
          }).toString();
          return parseOpenReviewPapers(await this.dependencies.read(url, s), query, mode);
        }),
      ]);
      // Interleave providers rather than letting a single provider fill the whole result list.
      const seen = new Set<string>();
      for (let index = 0; index < 20; index++)
        for (const bucket of buckets) {
          const record = bucket[index];
          if (!record || seen.has(record.item.id)) continue;
          seen.add(record.item.id);
          records.push(record);
        }
    }
    if (!records.length && mode === 'title' && !identifier && !/^https?:/i.test(query))
      try {
        const url = new URL('https://api.datacite.org/dois');
        url.search = new URLSearchParams({
          query: `titles.title:"${query.replace(/["\\]/g, ' ')}"`,
          'page[size]': '5',
        }).toString();
        const item = dataCiteArxivPaper(await this.dependencies.read(url, signal), query);
        if (item && eligible({ item })) records = [{ item }];
        attempts.push({ provider: 'DataCite', status: records.length ? 'ready' : 'empty' });
      } catch (error) {
        failure('DataCite', error);
      }
    if (!attempts.length && !records.length) throw new Error('paper_identifier_unsupported');
    for (const record of records.slice(0, 6)) this.retain(record);
    const failed = attempts.some((a) => a.status === 'failed');
    const result: PublicPaperResult = {
      items: records.slice(0, 6).map((r) => r.item),
      status: records.length ? (failed ? 'partial' : 'ready') : failed ? 'failed' : 'empty',
      attempts,
      cacheReused: false,
      coverage:
        mode === 'recent'
          ? '최근 논문 조회 · 설정된 기간 유지 · 공개일 미확인 대체 결과 제외'
          : '논문 식별/주제 검색 · 브리핑 기간·저자·제외어 필터 미적용 · 일부 출처의 실패는 논문 부재를 뜻하지 않음',
    };
    if (records.length) {
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { at: this.dependencies.now(), result: structuredClone(result) });
    }
    return result;
  }
  async read(item: LiveItem, signal: AbortSignal, offset = 0): Promise<PublicPaperReading> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 60000)
      throw new Error('paper_offset_invalid');
    const record = this.records.get(item.id);
    if (
      !record ||
      record.item.sourceUrl !== item.sourceUrl ||
      !samePaperTitle(record.item.title, item.title)
    )
      throw new Error('paper_not_discovered');
    if (signal.aborted) throw new Error('source_cancelled');
    if (
      record.body?.status === 'partial' &&
      this.dependencies.now() - (record.bodyAt ?? 0) >= 120000
    )
      delete record.body;
    const cacheReused = !!record.body;
    if (!record.body) {
      const attempts: Attempt[] = [];
      const fail = (provider: string, error: unknown) => {
        if (signal.aborted) throw new Error('source_cancelled');
        attempts.push({
          provider,
          status: 'failed',
          detail: sourceFailureReceipt(error),
          code:
            error instanceof Error && /^(source_|paper_)/.test(error.message)
              ? error.message
              : 'paper_read_unavailable',
        });
      };
      let candidate = record;
      // A DOI identifies the published work; independently found preprints stay explicitly labelled.
      if (item.sourceUrl?.startsWith('https://doi.org/'))
        try {
          const url = new URL('https://api2.openreview.net/notes/search');
          url.search = new URLSearchParams({
            term: item.title,
            content: 'title',
            source: 'forum',
            limit: '20',
          }).toString();
          const alternatives = parseOpenReviewPapers(
            await this.dependencies.read(url, signal),
            item.title,
            'title',
          );
          // Do not guess which of several same-title works is the requested article.
          const verified = alternatives.filter((r) =>
            r.item.bibliography?.authors.some((a) =>
              item.bibliography?.authors.some((b) => samePaperTitle(a, b)),
            ),
          );
          if (verified.length === 1) candidate = verified[0]!;
        } catch (error) {
          fail('OpenReview original discovery', error);
        }
      if (candidate.year && candidate.venue)
        try {
          if (!this.pmlrIndex || this.dependencies.now() - this.pmlrIndex.at > 86400000)
            this.pmlrIndex = {
              at: this.dependencies.now(),
              text: await this.dependencies.read(new URL('https://proceedings.mlr.press/'), signal),
            };
          for (const volume of pmlrVolumes(this.pmlrIndex.text, candidate.year, candidate.venue)) {
            const link = pmlrTitleLink(
              await this.dependencies.read(new URL(volume), signal),
              volume,
              item.title,
            );
            if (link) {
              candidate = parsePmlrPaper(
                await this.dependencies.read(new URL(link), signal),
                link,
                item.title,
              );
              break;
            }
          }
        } catch (error) {
          fail('PMLR', error);
        }
      if (!record.body && item.sourceUrl?.startsWith('https://arxiv.org/abs/'))
        try {
          const sourceUrl = item.sourceUrl.replace('/abs/', '/html/');
          const original = parsePaperHtml(
            await this.dependencies.read(new URL(sourceUrl), signal),
            sourceUrl,
          );
          record.body = {
            status: 'ready',
            title: item.title,
            sourceUrl,
            readScope: 'html-excerpt',
            excerpt: original.excerpt,
            totalCharacters: original.excerpt.length,
            note: original.note,
            attempts,
            ...visualReferences(original),
          };
        } catch (error) {
          fail('공개 arXiv HTML', error);
        }
      const pdfCandidates = candidate === record ? [record] : [candidate, record];
      if (item.sourceUrl?.startsWith('https://arxiv.org/abs/') && !record.pdfUrl)
        pdfCandidates.push({ ...record, pdfUrl: item.sourceUrl.replace('/abs/', '/pdf/') });
      for (const source of pdfCandidates) {
        if (record.body) break;
        if (!source.pdfUrl) continue;
        try {
          const bytes = await this.dependencies.bytes(new URL(source.pdfUrl), signal);
          if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
            throw new Error('paper_pdf_invalid');
          const pdf = await this.dependencies.extract(new Uint8Array(bytes), 60000);
          if (signal.aborted) throw new Error('source_cancelled');
          if (
            !pdf.textAvailable ||
            !normalizedTitle(
              pdf.pages
                .slice(0, 2)
                .map((p) => p.text)
                .join(' '),
            ).includes(normalizedTitle(item.title))
          )
            throw new Error('paper_identity_mismatch');
          const excerpt = pdf.pages
            .map((p) => `[Page ${p.pageNumber}]\n${p.text}`)
            .join('\n')
            .slice(0, 60000);
          attempts.push({ provider: source.item.source, status: 'ready' });
          record.body = {
            status: 'ready',
            title: item.title,
            sourceUrl: source.pdfUrl,
            readScope: 'pdf-text-excerpt',
            excerpt,
            totalCharacters: excerpt.length,
            pageCount: pdf.pageCount,
            pagesRead: pdf.pages.length,
            note: `공개 PDF의 선택 가능한 텍스트를 최대 60,000자 읽었습니다. ${pdf.pages.length}/${pdf.pageCount}페이지 처리 · 그림·스캔·레이아웃은 추출하지 않았습니다. 논문 전체 검증이나 게재 확정이 아닙니다. DOI 출판본과 공개 사본의 버전은 다를 수 있습니다.`,
            attempts,
          };
          break;
        } catch (error) {
          fail(source.item.source, error);
        }
      }
      if (
        !record.body &&
        (item.sourceUrl?.startsWith('https://openreview.net/forum?') ||
          item.sourceUrl?.startsWith('https://doi.org/'))
      )
        try {
          const url = new URL('https://api.datacite.org/dois');
          url.search = new URLSearchParams({
            query: `titles.title:"${item.title.replace(/["\\]/g, ' ')}"`,
            'page[size]': '5',
          }).toString();
          const preprint = dataCiteArxivPaper(
            await this.dependencies.read(url, signal),
            item.title,
          );
          if (preprint) {
            const sourceUrl = preprint.sourceUrl!.replace('/abs/', '/html/');
            const original = parsePaperHtml(
              await this.dependencies.read(new URL(sourceUrl), signal),
              sourceUrl,
            );
            attempts.push({
              provider: 'DataCite → 공개 arXiv HTML (검색 API 아님)',
              status: 'ready',
            });
            record.body = {
              status: 'ready',
              title: item.title,
              sourceUrl,
              readScope: 'html-excerpt',
              excerpt: original.excerpt,
              totalCharacters: original.excerpt.length,
              note: `${original.note} DataCite에서 확인한 프리프린트 버전이며 OpenReview 투고본/출판본과 다를 수 있습니다.`,
              attempts,
              ...visualReferences(original),
            };
          } else attempts.push({ provider: 'DataCite', status: 'empty' });
        } catch (error) {
          fail('DataCite / 공개 HTML', error);
        }
      record.body ??= {
        status: 'partial',
        title: item.title,
        sourceUrl: item.sourceUrl ?? '',
        readScope: 'abstract',
        excerpt: item.text,
        totalCharacters: item.text.length,
        note: '공개 초록/메타데이터만 확보했습니다. 확인된 내용은 요약하되 방법·결과·한계의 미확인 부분은 구분해야 합니다. PDF를 읽었다고 주장하지 마세요.',
        attempts,
      };
      record.bodyAt = this.dependencies.now();
    }
    const body = record.body;
    if (signal.aborted) throw new Error('source_cancelled');
    return {
      ...body,
      fetchedAt: new Date(record.bodyAt ?? this.dependencies.now()).toISOString(),
      cacheReused,
      excerpt: body.excerpt.slice(offset, offset + 20000),
      nextOffset: offset + 20000 < body.excerpt.length ? offset + 20000 : null,
    };
  }
}
