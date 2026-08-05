import type {
  LiteratureProvider,
  LiteratureRankingSignals,
  LiteratureRecord,
  LiteratureReviewStatus,
} from '../shared/literature-contracts';
import { literatureFingerprint as transferFingerprint, normalizeDoi } from './literature-transfer';

const CROSSREF_WORKS_ENDPOINT = 'https://api.crossref.org/v1/works';
const CROSSREF_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const CROSSREF_DEFAULT_TIMEOUT_MS = 15_000;
const CROSSREF_PUBLIC_INTERVAL_MS = 250;
const CROSSREF_POLITE_INTERVAL_MS = 125;
const CROSSREF_DEFAULT_BACKOFF_MS = 2_000;
const CROSSREF_MAX_BACKOFF_MS = 30_000;
const CROSSREF_SELECTED_FIELDS = [
  'DOI',
  'title',
  'author',
  'container-title',
  'published-print',
  'published-online',
  'published',
  'issued',
  'created',
  'subject',
  'type',
  'is-referenced-by-count',
  'URL',
].join(',');

export type LiteratureProviderCandidate = Readonly<{
  provider: LiteratureProvider;
  providerId?: string | undefined;
  doi?: string | undefined;
  fingerprint: string;
  title: string;
  authors: readonly string[];
  containerTitle?: string | undefined;
  publishedYear?: number | undefined;
  topics: readonly string[];
  workType?: string | undefined;
  citationCount?: number | undefined;
  sourceUrl?: string | undefined;
  citationKey?: string | undefined;
  reviewStatus?: LiteratureReviewStatus | undefined;
  manualAnnotations?: LiteratureRecord['manualAnnotations'] | undefined;
  discovery?: LiteratureRankingSignals | undefined;
}>;

export class LiteratureProviderError extends Error {
  constructor(
    readonly code: 'cancelled' | 'timeout' | 'unavailable' | 'invalid_response' | 'rate_limited',
  ) {
    super(code);
    this.name = 'LiteratureProviderError';
  }
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CrossrefOptions = Readonly<{
  fetch?: Fetch;
  timeoutMs?: number;
  contactEmail?: string | undefined;
  userAgent?: string | undefined;
}>;

export type CrossrefSearchOptions = Readonly<{
  signal?: AbortSignal | undefined;
  fromYear?: number | undefined;
  toYear?: number | undefined;
  sort?: 'relevance' | 'citation' | 'published' | undefined;
}>;

export function literatureFingerprint(
  title: string,
  authors: readonly string[],
  publishedYear: number | undefined,
) {
  return transferFingerprint({ title, authors, publishedYear });
}

function text(value: unknown, maximumLength: number) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, maximumLength) : undefined;
}

function firstText(value: unknown, maximumLength: number) {
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    const normalized = text(candidate, maximumLength);
    if (normalized) return normalized;
  }
  return undefined;
}

function httpsUrl(value: unknown) {
  const candidate = text(value, 2048);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString().slice(0, 2048) : undefined;
  } catch {
    return undefined;
  }
}

function crossrefAuthors(value: unknown) {
  if (!Array.isArray(value)) return [];
  const authors: string[] = [];
  for (const raw of value.slice(0, 100)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const author = raw as Record<string, unknown>;
    const organization = text(author.name, 300);
    const given = text(author.given, 150);
    const family = text(author.family, 150);
    const name = organization ?? [given, family].filter(Boolean).join(' ').trim();
    if (name && !authors.includes(name)) authors.push(name);
  }
  return authors;
}

function crossrefYear(item: Record<string, unknown>) {
  for (const key of ['published-print', 'published-online', 'published', 'issued'] as const) {
    const date = item[key];
    if (typeof date !== 'object' || date === null || Array.isArray(date)) continue;
    const parts = (date as Record<string, unknown>)['date-parts'];
    const year = Array.isArray(parts) && Array.isArray(parts[0]) ? parts[0][0] : undefined;
    if (typeof year === 'number' && Number.isSafeInteger(year) && year >= 1000 && year <= 3000) {
      return year;
    }
  }
  const created = item.created;
  if (typeof created === 'object' && created !== null && !Array.isArray(created)) {
    const timestamp = text((created as Record<string, unknown>)['date-time'], 64);
    const year = timestamp ? new Date(timestamp).getUTCFullYear() : Number.NaN;
    if (Number.isSafeInteger(year) && year >= 1000 && year <= 3000) return year;
  }
  return undefined;
}

export function normalizeCrossrefWork(value: unknown): LiteratureProviderCandidate | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const title = firstText(item.title, 2_000);
  if (!title) return null;
  const authors = crossrefAuthors(item.author);
  const publishedYear = crossrefYear(item);
  const doi = normalizeDoi(text(item.DOI, 512)) ?? undefined;
  const sourceUrl = httpsUrl(item.URL);
  const providerId = doi ?? sourceUrl;
  const rawSubjects = Array.isArray(item.subject) ? item.subject : [];
  const topics = rawSubjects
    .map((subject) => text(subject, 240))
    .filter((subject): subject is string => subject !== undefined)
    .filter((subject, index, all) => all.indexOf(subject) === index)
    .slice(0, 50);
  const rawCitationCount = item['is-referenced-by-count'];
  const citationCount =
    typeof rawCitationCount === 'number' &&
    Number.isSafeInteger(rawCitationCount) &&
    rawCitationCount >= 0
      ? rawCitationCount
      : undefined;
  return {
    provider: 'crossref',
    ...(providerId ? { providerId } : {}),
    ...(doi ? { doi } : {}),
    fingerprint: literatureFingerprint(title, authors, publishedYear),
    title,
    authors,
    ...(firstText(item['container-title'], 1_000)
      ? { containerTitle: firstText(item['container-title'], 1_000) }
      : {}),
    ...(publishedYear ? { publishedYear } : {}),
    topics,
    ...(text(item.type, 120) ? { workType: text(item.type, 120) } : {}),
    ...(citationCount === undefined ? {} : { citationCount }),
    ...(sourceUrl ? { sourceUrl } : doi ? { sourceUrl: `https://doi.org/${doi}` } : {}),
  };
}

async function readBoundedJson(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > CROSSREF_MAX_RESPONSE_BYTES) {
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
      if (length > CROSSREF_MAX_RESPONSE_BYTES) {
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
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return CROSSREF_DEFAULT_BACKOFF_MS;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return CROSSREF_DEFAULT_BACKOFF_MS;
  return Math.max(250, Math.min(milliseconds, CROSSREF_MAX_BACKOFF_MS));
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

export class CrossrefLiteratureProvider {
  readonly providerId = 'crossref' as const;
  readonly policyId = 'crossref-basic' as const;
  readonly policyVersion = 1;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;
  private readonly contactEmail: string | undefined;
  private readonly userAgent: string | undefined;
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  private rateLimitUntil = 0;

  constructor(options: CrossrefOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.max(
      1,
      Math.min(options.timeoutMs ?? CROSSREF_DEFAULT_TIMEOUT_MS, 60_000),
    );
    this.contactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(options.contactEmail ?? '')
      ? options.contactEmail
      : undefined;
    this.userAgent = text(options.userAgent, 256);
  }

  search(query: string, limit: number, options: CrossrefSearchOptions = {}) {
    const task = this.queue.catch(() => undefined).then(() => this.execute(query, limit, options));
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async execute(query: string, limit: number, options: CrossrefSearchOptions) {
    const { signal } = options;
    if (signal?.aborted) throw new LiteratureProviderError('cancelled');
    await waitUntil(Math.max(this.nextRequestAt, this.rateLimitUntil), signal);
    if (signal?.aborted) throw new LiteratureProviderError('cancelled');
    this.nextRequestAt =
      Date.now() + (this.contactEmail ? CROSSREF_POLITE_INTERVAL_MS : CROSSREF_PUBLIC_INTERVAL_MS);
    const normalizedQuery = query.replace(/\s+/gu, ' ').trim().slice(0, 1_000);
    if (!normalizedQuery) throw new LiteratureProviderError('invalid_response');
    const rows = Math.max(1, Math.min(Math.trunc(limit), 50));
    const url = new URL(CROSSREF_WORKS_ENDPOINT);
    url.searchParams.set('query.bibliographic', normalizedQuery);
    url.searchParams.set('rows', rows.toString());
    url.searchParams.set('select', CROSSREF_SELECTED_FIELDS);
    if (options.sort === 'citation') {
      url.searchParams.set('sort', 'is-referenced-by-count');
      url.searchParams.set('order', 'desc');
    } else if (options.sort === 'published') {
      url.searchParams.set('sort', 'published');
      url.searchParams.set('order', 'desc');
    }
    const fromYear = validFilterYear(options.fromYear);
    const toYear = validFilterYear(options.toYear);
    if (options.fromYear !== undefined && fromYear === undefined) {
      throw new LiteratureProviderError('invalid_response');
    }
    if (options.toYear !== undefined && toYear === undefined) {
      throw new LiteratureProviderError('invalid_response');
    }
    if (fromYear !== undefined && toYear !== undefined && fromYear > toYear) {
      throw new LiteratureProviderError('invalid_response');
    }
    const filters = [
      fromYear === undefined ? undefined : `from-pub-date:${fromYear}`,
      toYear === undefined ? undefined : `until-pub-date:${toYear}`,
    ].filter((filter): filter is string => filter !== undefined);
    if (filters.length > 0) url.searchParams.set('filter', filters.join(','));
    if (this.contactEmail) url.searchParams.set('mailto', this.contactEmail);

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort('crossref_timeout'), this.timeoutMs);
    timer.unref?.();
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.contactEmail || this.userAgent) {
        headers['User-Agent'] =
          this.userAgent ?? `GOSU Literature (mailto:${this.contactEmail ?? 'not-configured'})`;
      }
      const response = await this.fetch(url, {
        method: 'GET',
        redirect: 'error',
        headers,
        signal: controller.signal,
      });
      if (response.status === 429) {
        this.rateLimitUntil = Date.now() + retryAfterMilliseconds(response);
        throw new LiteratureProviderError('rate_limited');
      }
      if (!response.ok) throw new LiteratureProviderError('unavailable');
      const body = await readBoundedJson(response);
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new LiteratureProviderError('invalid_response');
      }
      const message = (body as Record<string, unknown>).message;
      if (typeof message !== 'object' || message === null || Array.isArray(message)) {
        throw new LiteratureProviderError('invalid_response');
      }
      const items = (message as Record<string, unknown>).items;
      if (!Array.isArray(items)) throw new LiteratureProviderError('invalid_response');
      return items
        .slice(0, rows)
        .map(normalizeCrossrefWork)
        .filter((item) => item !== null);
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

function validFilterYear(value: number | undefined) {
  return value === undefined || !Number.isSafeInteger(value) || value < 1000 || value > 3000
    ? undefined
    : value;
}
