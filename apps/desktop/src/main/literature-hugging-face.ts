import {
  literatureFingerprint,
  LiteratureProviderError,
  normalizeArxivCanonicalId,
} from './literature-crossref';
import type { LiteratureProviderCandidate } from './literature-crossref';
import type { SemanticScholarSearchOptions } from './literature-semantic-scholar';

const HUGGING_FACE_ORIGIN = 'https://huggingface.co';
const HUGGING_FACE_PAPER_SEARCH = '/api/papers/search';
const HUGGING_FACE_MAX_QUERY_LENGTH = 250;
const HUGGING_FACE_MAX_RESULTS = 120;
const HUGGING_FACE_MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const HUGGING_FACE_DEFAULT_TIMEOUT_MS = 12_000;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type HuggingFaceOptions = Readonly<{
  fetch?: Fetch;
  timeoutMs?: number;
}>;

export type HuggingFacePaperCandidate = Readonly<{
  candidate: LiteratureProviderCandidate;
  upvotes: number | null;
}>;

function boundedText(value: unknown, maximumLength: number) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, maximumLength) : undefined;
}

function boundedInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function paperAuthors(value: unknown) {
  if (!Array.isArray(value)) return [];
  const authors: string[] = [];
  for (const raw of value.slice(0, 100)) {
    const author = objectValue(raw);
    if (!author) continue;
    const name = boundedText(author.name, 300);
    if (name && !authors.includes(name)) authors.push(name);
  }
  return authors;
}

function publishedYear(value: unknown) {
  const timestamp = boundedText(value, 64);
  if (!timestamp) return undefined;
  const year = new Date(timestamp).getUTCFullYear();
  return Number.isSafeInteger(year) && year >= 1000 && year <= 3000 ? year : undefined;
}

export function normalizeHuggingFacePaper(value: unknown): HuggingFacePaperCandidate | null {
  const result = objectValue(value);
  if (!result) return null;
  const paper = objectValue(result.paper) ?? result;
  const rawProviderId = boundedText(paper.id, 2_048);
  const title = boundedText(paper.title, 2_000) ?? boundedText(result.title, 2_000);
  const canonicalId = normalizeArxivCanonicalId(rawProviderId);
  if (!rawProviderId || !canonicalId || !title) return null;
  const providerId = canonicalId.slice('arxiv:'.length);
  const authors = paperAuthors(paper.authors);
  const year = publishedYear(paper.publishedAt ?? result.publishedAt);
  const sourceUrl = new URL(`/papers/${encodeURIComponent(providerId)}`, HUGGING_FACE_ORIGIN);
  return {
    candidate: {
      provider: 'hugging-face',
      providerId,
      canonicalId,
      fingerprint: literatureFingerprint(title, authors, year),
      title,
      authors,
      containerTitle: 'arXiv',
      ...(year === undefined ? {} : { publishedYear: year }),
      topics: [],
      workType: 'preprint',
      sourceUrl: sourceUrl.toString(),
    },
    upvotes: boundedInteger(paper.upvotes) ?? null,
  };
}

async function readBoundedJson(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > HUGGING_FACE_MAX_RESPONSE_BYTES) {
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
      if (length > HUGGING_FACE_MAX_RESPONSE_BYTES) {
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

export class HuggingFaceLiteratureProvider {
  readonly providerId = 'hugging-face' as const;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;

  constructor(options: HuggingFaceOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.max(
      1,
      Math.min(options.timeoutMs ?? HUGGING_FACE_DEFAULT_TIMEOUT_MS, 60_000),
    );
  }

  async search(query: string, limit: number, options: SemanticScholarSearchOptions = {}) {
    const normalizedQuery = query.replace(/-/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (!normalizedQuery) throw new LiteratureProviderError('invalid_response');
    const rows = Math.max(1, Math.min(Math.trunc(limit), HUGGING_FACE_MAX_RESULTS));
    const url = new URL(HUGGING_FACE_PAPER_SEARCH, HUGGING_FACE_ORIGIN);
    url.searchParams.set('q', normalizedQuery.slice(0, HUGGING_FACE_MAX_QUERY_LENGTH));
    url.searchParams.set('limit', rows.toString());
    const body = await this.request(url, options.signal);
    if (!Array.isArray(body)) throw new LiteratureProviderError('invalid_response');
    return body
      .slice(0, rows)
      .map(normalizeHuggingFacePaper)
      .filter((paper): paper is HuggingFacePaperCandidate => paper !== null)
      .filter(({ candidate }) => {
        const year = candidate.publishedYear;
        if (options.fromYear !== undefined && (year === undefined || year < options.fromYear)) {
          return false;
        }
        if (options.toYear !== undefined && (year === undefined || year > options.toYear)) {
          return false;
        }
        return true;
      });
  }

  private async request(url: URL, signal?: AbortSignal) {
    if (signal?.aborted) throw new LiteratureProviderError('cancelled');
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort('hugging_face_timeout'), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status === 429) throw new LiteratureProviderError('rate_limited');
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
