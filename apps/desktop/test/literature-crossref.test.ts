import { describe, expect, it, vi } from 'vitest';

import {
  CrossrefLiteratureProvider,
  LiteratureProviderError,
  normalizeCrossrefWork,
} from '../src/main/literature-crossref';

function crossrefResponse(items: readonly unknown[], headers?: HeadersInit) {
  return new Response(JSON.stringify({ status: 'ok', message: { items } }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('Crossref literature provider', () => {
  it('normalizes bounded bibliographic fields and a plain-text provider abstract without raw bodies', () => {
    const normalized = normalizeCrossrefWork({
      DOI: 'https://doi.org/10.1000/Fixture.1',
      title: ['  A   useful paper  '],
      author: [{ given: 'Ada', family: 'Lovelace' }, { name: 'Fixture Consortium' }],
      'container-title': ['Journal of Fixtures'],
      published: { 'date-parts': [[2025, 3, 2]] },
      subject: ['Machine Learning', 'Machine Learning', 'Evaluation'],
      type: 'journal-article',
      'is-referenced-by-count': 42,
      URL: 'https://doi.org/10.1000/Fixture.1',
      abstract: '<jats:p>A bounded <jats:bold>provider abstract</jats:bold>.</jats:p>',
      unexpected: { private: 'RAW PROVIDER BODY' },
    });

    expect(normalized).toMatchObject({
      provider: 'crossref',
      providerId: '10.1000/fixture.1',
      doi: '10.1000/fixture.1',
      title: 'A useful paper',
      authors: ['Ada Lovelace', 'Fixture Consortium'],
      containerTitle: 'Journal of Fixtures',
      publishedYear: 2025,
      topics: ['Machine Learning', 'Evaluation'],
      workType: 'journal-article',
      citationCount: 42,
      abstractText: 'A bounded provider abstract.',
    });
    expect(JSON.stringify(normalized)).not.toContain('RAW PROVIDER BODY');
    expect(normalized?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('uses a fixed Crossref origin, clamps rows, and adds contact metadata only when configured', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      crossrefResponse([]),
    );
    const provider = new CrossrefLiteratureProvider({ fetch });

    await provider.search('transformers & safety', 500, {
      authorQuery: 'Ada Lovelace',
      venueQuery: 'Journal of Fixtures',
      fromYear: 2020,
      toYear: 2026,
    });

    const [request, init] = fetch.mock.calls[0]!;
    const url = new URL(request.toString());
    expect(url.origin).toBe('https://api.crossref.org');
    expect(url.pathname).toBe('/v1/works');
    expect(url.searchParams.get('query.bibliographic')).toBe('transformers & safety');
    expect(url.searchParams.get('query.author')).toBe('Ada Lovelace');
    expect(url.searchParams.get('query.container-title')).toBe('Journal of Fixtures');
    expect(url.searchParams.get('rows')).toBe('50');
    expect(url.searchParams.get('select')).toContain('is-referenced-by-count');
    expect(url.searchParams.get('select')).toContain('abstract');
    expect(url.searchParams.get('filter')).toBe('from-pub-date:2020,until-pub-date:2026');
    expect(url.searchParams.has('mailto')).toBe(false);
    expect(new Headers(init?.headers).has('user-agent')).toBe(false);

    const configuredFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      crossrefResponse([]),
    );
    await new CrossrefLiteratureProvider({
      fetch: configuredFetch,
      contactEmail: 'research@example.invalid',
      userAgent: 'GOSU-Test/1',
    }).search('fixtures', 1);
    const [configuredRequest, configuredInit] = configuredFetch.mock.calls[0]!;
    expect(new URL(configuredRequest.toString()).searchParams.get('mailto')).toBe(
      'research@example.invalid',
    );
    expect(new Headers(configuredInit?.headers).get('user-agent')).toBe('GOSU-Test/1');
  });

  it('runs requests one at a time and allows queued work to be cancelled', async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      call += 1;
      if (call === 1) await first;
      return crossrefResponse([]);
    });
    const provider = new CrossrefLiteratureProvider({ fetch });
    const running = provider.search('first', 10);
    const controller = new AbortController();
    const queued = provider.search('second', 10, { signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    releaseFirst();

    await expect(running).resolves.toEqual([]);
    await expect(queued).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureProviderError>>({ code: 'cancelled' }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('paces public requests and honors bounded Retry-After backoff', async () => {
    vi.useFakeTimers();
    try {
      let requestCount = 0;
      const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
        requestCount += 1;
        return requestCount === 1
          ? new Response('', { status: 429, headers: { 'retry-after': '1' } })
          : crossrefResponse([]);
      });
      const provider = new CrossrefLiteratureProvider({ fetch });

      await expect(provider.search('first', 10)).rejects.toEqual(
        expect.objectContaining<Partial<LiteratureProviderError>>({ code: 'rate_limited' }),
      );
      const next = provider.search('second', 10);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(next).resolves.toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps timeout and oversized response failures without exposing response content', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
          }),
      );
      const provider = new CrossrefLiteratureProvider({ fetch, timeoutMs: 25 });
      const request = provider.search('timeout fixture', 10);
      await vi.advanceTimersByTimeAsync(26);
      await expect(request).rejects.toEqual(
        expect.objectContaining<Partial<LiteratureProviderError>>({ code: 'timeout' }),
      );
    } finally {
      vi.useRealTimers();
    }

    const oversized = new CrossrefLiteratureProvider({
      fetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
        crossrefResponse([], { 'content-length': String(4 * 1024 * 1024 + 1) }),
      ),
    });
    await expect(oversized.search('oversized fixture', 10)).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureProviderError>>({ code: 'invalid_response' }),
    );

    const rateLimited = new CrossrefLiteratureProvider({
      fetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(new Response('private provider message', { status: 429 })),
      ),
    });
    await expect(rateLimited.search('rate limit fixture', 10)).rejects.toEqual(
      expect.objectContaining<Partial<LiteratureProviderError>>({ code: 'rate_limited' }),
    );
  });
});
