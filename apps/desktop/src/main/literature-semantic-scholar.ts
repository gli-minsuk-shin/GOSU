import {
  literatureFingerprint,
  LiteratureProviderError,
  normalizeArxivCanonicalId,
} from './literature-crossref';
import type { LiteratureProviderCandidate } from './literature-crossref';
import { normalizeDoi } from './literature-transfer';

const SEMANTIC_SCHOLAR_ORIGIN = 'https://api.semanticscholar.org';
const SEMANTIC_SCHOLAR_PAPER_SEARCH = '/graph/v1/paper/search';
const SEMANTIC_SCHOLAR_PAPER_BULK_SEARCH = '/graph/v1/paper/search/bulk';
const SEMANTIC_SCHOLAR_AUTHOR_BATCH = '/graph/v1/author/batch';
const SEMANTIC_SCHOLAR_MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const SEMANTIC_SCHOLAR_DEFAULT_TIMEOUT_MS = 12_000;
const SEMANTIC_SCHOLAR_REQUEST_INTERVAL_MS = 1_000;
const SEMANTIC_SCHOLAR_MAX_BACKOFF_MS = 30_000;
const SEMANTIC_SCHOLAR_FIELDS = [
  'paperId',
  'externalIds',
  'url',
  'title',
  'abstract',
  'venue',
  'year',
  'publicationDate',
  'authors',
  'fieldsOfStudy',
  's2FieldsOfStudy',
  'publicationTypes',
  'citationCount',
  'influentialCitationCount',
].join(',');

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type SemanticScholarOptions = Readonly<{
  fetch?: Fetch;
  timeoutMs?: number;
  apiKey?: string | undefined;
}>;

export type SemanticScholarSearchOptions = Readonly<{
  signal?: AbortSignal | undefined;
  fromYear?: number | undefined;
  toYear?: number | undefined;
  sort?: 'relevance' | 'citation' | 'published' | undefined;
  authorQuery?: string | undefined;
  venueQuery?: string | undefined;
}>;

export type SemanticScholarCandidate = Readonly<{
  candidate: LiteratureProviderCandidate;
  authorIds: readonly string[];
  influentialCitationCount: number | null;
  publicationDate: string | null;
}>;

export type SemanticScholarAuthorMetric = Readonly<{
  authorId: string;
  hIndex: number | null;
  citationCount: number | null;
}>;

function boundedText(value: unknown, maximumLength: number) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, maximumLength) : undefined;
}

function boundedInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function httpsUrl(value: unknown) {
  const candidate = boundedText(value, 2_048);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString().slice(0, 2_048) : undefined;
  } catch {
    return undefined;
  }
}

function stringList(value: unknown, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => boundedText(item, maximumLength))
    .filter((item): item is string => item !== undefined)
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, maximumItems);
}

function semanticScholarAuthors(value: unknown) {
  if (!Array.isArray(value)) return { names: [] as string[], ids: [] as string[] };
  const names: string[] = [];
  const ids: string[] = [];
  for (const raw of value.slice(0, 100)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const author = raw as Record<string, unknown>;
    const name = boundedText(author.name, 300);
    const id = boundedText(author.authorId, 128);
    if (name && !names.includes(name)) names.push(name);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return { names, ids };
}

function semanticScholarTopics(item: Record<string, unknown>) {
  const direct = stringList(item.fieldsOfStudy, 50, 240);
  const categorized = Array.isArray(item.s2FieldsOfStudy)
    ? item.s2FieldsOfStudy
        .map((raw) =>
          typeof raw === 'object' && raw !== null && !Array.isArray(raw)
            ? boundedText((raw as Record<string, unknown>).category, 240)
            : undefined,
        )
        .filter((topic): topic is string => topic !== undefined)
    : [];
  return [...direct, ...categorized]
    .filter((topic, index, all) => all.indexOf(topic) === index)
    .slice(0, 50);
}

export function normalizeSemanticScholarPaper(value: unknown): SemanticScholarCandidate | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const title = boundedText(item.title, 2_000);
  const providerId = boundedText(item.paperId, 2_048);
  if (!title || !providerId) return null;
  const authors = semanticScholarAuthors(item.authors);
  const year = boundedInteger(item.year);
  const publishedYear = year && year >= 1000 && year <= 3000 ? year : undefined;
  const externalIds =
    typeof item.externalIds === 'object' &&
    item.externalIds !== null &&
    !Array.isArray(item.externalIds)
      ? (item.externalIds as Record<string, unknown>)
      : {};
  const doi = normalizeDoi(boundedText(externalIds.DOI, 512)) ?? undefined;
  const canonicalId = normalizeArxivCanonicalId(boundedText(externalIds.ArXiv, 512));
  const sourceUrl = httpsUrl(item.url) ?? (doi ? `https://doi.org/${doi}` : undefined);
  const workTypes = stringList(item.publicationTypes, 4, 120);
  const publicationDate = boundedText(item.publicationDate, 32) ?? null;
  const abstractText = boundedText(item.abstract, 12_000);
  return {
    candidate: {
      provider: 'semantic-scholar',
      providerId,
      ...(canonicalId ? { canonicalId } : {}),
      ...(doi ? { doi } : {}),
      fingerprint: literatureFingerprint(title, authors.names, publishedYear),
      title,
      authors: authors.names,
      ...(boundedText(item.venue, 1_000) ? { containerTitle: boundedText(item.venue, 1_000) } : {}),
      ...(publishedYear ? { publishedYear } : {}),
      ...(abstractText ? { abstractText } : {}),
      topics: semanticScholarTopics(item),
      ...(workTypes[0] ? { workType: workTypes.join(', ').slice(0, 120) } : {}),
      ...(boundedInteger(item.citationCount) === undefined
        ? {}
        : { citationCount: boundedInteger(item.citationCount) }),
      ...(sourceUrl ? { sourceUrl } : {}),
    },
    authorIds: authors.ids,
    influentialCitationCount: boundedInteger(item.influentialCitationCount) ?? null,
    publicationDate,
  };
}

async function readBoundedJson(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > SEMANTIC_SCHOLAR_MAX_RESPONSE_BYTES) {
    throw new LiteratureProviderError('invalid_response');
  }
  if (!response.body) throw new LiteratureProviderError('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > SEMANTIC_SCHOLAR_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new LiteratureProviderError('invalid_response');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new LiteratureProviderError('invalid_response');
  }
}

function retryAfterMilliseconds(response: Response) {
  const seconds = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds <= 0) return 2_000;
  return Math.max(250, Math.min(seconds * 1_000, SEMANTIC_SCHOLAR_MAX_BACKOFF_MS));
}

async function waitUntil(timestamp: number, signal?: AbortSignal) {
  const delay = timestamp - Date.now();
  if (delay <= 0) return;
  if (signal?.aborted) throw new LiteratureProviderError('cancelled');
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    };
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(new LiteratureProviderError('cancelled'));
    };
    const timer = setTimeout(finish, delay);
    timer.unref?.();
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function validYear(value: number | undefined) {
  return value !== undefined && Number.isSafeInteger(value) && value >= 1000 && value <= 3000
    ? value
    : undefined;
}

function yearFilter(fromYear: number | undefined, toYear: number | undefined) {
  const from = validYear(fromYear);
  const to = validYear(toYear);
  if (fromYear !== undefined && from === undefined)
    throw new LiteratureProviderError('invalid_response');
  if (toYear !== undefined && to === undefined)
    throw new LiteratureProviderError('invalid_response');
  if (from !== undefined && to !== undefined && from > to) {
    throw new LiteratureProviderError('invalid_response');
  }
  if (from !== undefined && to !== undefined) return `${from}-${to}`;
  if (from !== undefined) return `${from}-`;
  if (to !== undefined) return `-${to}`;
  return undefined;
}

export class SemanticScholarLiteratureProvider {
  readonly providerId = 'semantic-scholar' as const;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  private rateLimitUntil = 0;

  constructor(options: SemanticScholarOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.max(
      1,
      Math.min(options.timeoutMs ?? SEMANTIC_SCHOLAR_DEFAULT_TIMEOUT_MS, 60_000),
    );
    this.apiKey = boundedText(options.apiKey, 512);
  }

  search(query: string, limit: number, options: SemanticScholarSearchOptions = {}) {
    const normalizedQuery = query.replace(/-/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 1_000);
    const rows = Math.max(1, Math.min(Math.trunc(limit), 100));
    const bulkSort =
      options.sort === 'citation'
        ? 'citationCount:desc'
        : options.sort === 'published'
          ? 'publicationDate:desc'
          : undefined;
    const url = new URL(
      bulkSort ? SEMANTIC_SCHOLAR_PAPER_BULK_SEARCH : SEMANTIC_SCHOLAR_PAPER_SEARCH,
      SEMANTIC_SCHOLAR_ORIGIN,
    );
    url.searchParams.set('query', normalizedQuery);
    if (!bulkSort) url.searchParams.set('limit', rows.toString());
    if (bulkSort) url.searchParams.set('sort', bulkSort);
    url.searchParams.set('fields', SEMANTIC_SCHOLAR_FIELDS);
    const years = yearFilter(options.fromYear, options.toYear);
    if (years) url.searchParams.set('year', years);
    return this.enqueue(async () => {
      if (!normalizedQuery) throw new LiteratureProviderError('invalid_response');
      const body = await this.request(url, { method: 'GET' }, options.signal);
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new LiteratureProviderError('invalid_response');
      }
      const data = (body as Record<string, unknown>).data;
      if (!Array.isArray(data)) throw new LiteratureProviderError('invalid_response');
      return data
        .slice(0, rows)
        .map(normalizeSemanticScholarPaper)
        .filter((paper): paper is SemanticScholarCandidate => paper !== null)
        .filter((paper) => {
          const authorNeedle = boundedText(options.authorQuery, 500)?.toLocaleLowerCase();
          const venueNeedle = boundedText(options.venueQuery, 500)?.toLocaleLowerCase();
          return (
            (!authorNeedle ||
              paper.candidate.authors.some((author) =>
                author.toLocaleLowerCase().includes(authorNeedle),
              )) &&
            (!venueNeedle ||
              (paper.candidate.containerTitle ?? '').toLocaleLowerCase().includes(venueNeedle))
          );
        });
    }, options.signal);
  }

  authorMetrics(authorIds: readonly string[], signal?: AbortSignal) {
    const ids = authorIds
      .map((id) => boundedText(id, 128))
      .filter((id): id is string => id !== undefined)
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, 200);
    if (ids.length === 0) return Promise.resolve(new Map<string, SemanticScholarAuthorMetric>());
    const url = new URL(SEMANTIC_SCHOLAR_AUTHOR_BATCH, SEMANTIC_SCHOLAR_ORIGIN);
    url.searchParams.set('fields', 'authorId,hIndex,citationCount');
    return this.enqueue(async () => {
      const body = await this.request(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        },
        signal,
      );
      if (!Array.isArray(body)) throw new LiteratureProviderError('invalid_response');
      const metrics = new Map<string, SemanticScholarAuthorMetric>();
      for (const raw of body.slice(0, ids.length)) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
        const author = raw as Record<string, unknown>;
        const authorId = boundedText(author.authorId, 128);
        if (!authorId) continue;
        metrics.set(authorId, {
          authorId,
          hIndex: boundedInteger(author.hIndex) ?? null,
          citationCount: boundedInteger(author.citationCount) ?? null,
        });
      }
      return metrics;
    }, signal);
  }

  private enqueue<Result>(operation: () => Promise<Result>, signal?: AbortSignal) {
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (signal?.aborted) throw new LiteratureProviderError('cancelled');
        await waitUntil(Math.max(this.nextRequestAt, this.rateLimitUntil), signal);
        this.nextRequestAt = Date.now() + SEMANTIC_SCHOLAR_REQUEST_INTERVAL_MS;
        return operation();
      });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async request(url: URL, init: RequestInit, signal?: AbortSignal) {
    if (signal?.aborted) throw new LiteratureProviderError('cancelled');
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort('semantic_scholar_timeout'), this.timeoutMs);
    timer.unref?.();
    try {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (this.apiKey) headers.set('x-api-key', this.apiKey);
      const response = await this.fetch(url, {
        ...init,
        headers,
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 429) {
        this.rateLimitUntil = Date.now() + retryAfterMilliseconds(response);
        throw new LiteratureProviderError('rate_limited');
      }
      if (!response.ok) throw new LiteratureProviderError('unavailable');
      return await readBoundedJson(response);
    } catch (error) {
      if (error instanceof LiteratureProviderError) throw error;
      if (controller.signal.aborted) {
        throw new LiteratureProviderError(signal?.aborted ? 'cancelled' : 'timeout');
      }
      throw new LiteratureProviderError('unavailable');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
}
