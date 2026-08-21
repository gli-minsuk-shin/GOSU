import { describe, expect, it, vi } from 'vitest';

import {
  SemanticScholarLiteratureProvider,
  normalizeSemanticScholarPaper,
} from '../src/main/literature-semantic-scholar';

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Semantic Scholar literature provider', () => {
  it('uses fixed endpoints, bounded metadata and abstracts, and year filters', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        data: [
          {
            paperId: 'paper-1',
            externalIds: {
              DOI: 'https://doi.org/10.1000/S2.1',
              ArXiv: '2504.10808v2',
            },
            url: 'https://www.semanticscholar.org/paper/paper-1',
            title: '  A   semantic scholar fixture  ',
            venue: 'Fixture Conference',
            year: 2025,
            publicationDate: '2025-06-01',
            authors: [{ authorId: 'author-1', name: 'Ada Researcher' }],
            fieldsOfStudy: ['Computer Science'],
            s2FieldsOfStudy: [{ category: 'Machine Learning' }],
            publicationTypes: ['JournalArticle'],
            citationCount: 42,
            influentialCitationCount: 7,
            abstract: 'A provider-supplied abstract for keyword extraction.',
          },
        ],
      }),
    );
    const provider = new SemanticScholarLiteratureProvider({
      fetch,
      apiKey: 'fixture-api-key',
    });

    const papers = await provider.search('graph-neural networks', 500, {
      authorQuery: 'Ada Researcher',
      venueQuery: 'Fixture Conference',
      fromYear: 2020,
      toYear: 2026,
    });

    const [request, init] = fetch.mock.calls[0]!;
    const url = new URL(request.toString());
    expect(url.origin).toBe('https://api.semanticscholar.org');
    expect(url.pathname).toBe('/graph/v1/paper/search');
    expect(url.searchParams.get('query')).toBe('graph neural networks');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('year')).toBe('2020-2026');
    expect(url.searchParams.get('fields')).toContain('influentialCitationCount');
    expect(url.searchParams.get('fields')).toContain('abstract');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('fixture-api-key');
    expect(papers[0]).toMatchObject({
      candidate: {
        provider: 'semantic-scholar',
        providerId: 'paper-1',
        canonicalId: 'arxiv:2504.10808',
        doi: '10.1000/s2.1',
        title: 'A semantic scholar fixture',
        authors: ['Ada Researcher'],
        publishedYear: 2025,
        citationCount: 42,
        abstractText: 'A provider-supplied abstract for keyword extraction.',
      },
      authorIds: ['author-1'],
      influentialCitationCount: 7,
    });
  });

  it('normalizes only HTTPS links and falls back to a DOI URL', () => {
    const paper = normalizeSemanticScholarPaper({
      paperId: 'paper-http',
      externalIds: { DOI: '10.1000/secure' },
      url: 'http://insecure.example/paper',
      title: 'Secure source fallback',
      authors: [],
    });

    expect(paper?.candidate.sourceUrl).toBe('https://doi.org/10.1000/secure');
  });

  it.each([
    ['citation', 'citationCount:desc'],
    ['published', 'publicationDate:desc'],
  ] as const)('uses the bounded bulk-search lane for %s sorting', async (sort, expectedSort) => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ data: [] }),
    );
    const provider = new SemanticScholarLiteratureProvider({ fetch });

    await provider.search('foundation models', 100, { sort });

    const [request] = fetch.mock.calls[0]!;
    const url = new URL(request.toString());
    expect(url.pathname).toBe('/graph/v1/paper/search/bulk');
    expect(url.searchParams.get('sort')).toBe(expectedSort);
    expect(url.searchParams.has('limit')).toBe(false);
  });

  it('stops reading a chunked response as soon as the bounded byte limit is exceeded', async () => {
    let emitted = 0;
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (emitted >= 7) {
                controller.close();
                return;
              }
              emitted += 1;
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const provider = new SemanticScholarLiteratureProvider({ fetch });

    await expect(provider.search('oversized response', 10)).rejects.toEqual(
      expect.objectContaining({ code: 'invalid_response' }),
    );
    expect(emitted).toBe(7);
  });

  it('maps provider throttling to a typed rate-limit failure', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('{}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
        }),
    );
    const provider = new SemanticScholarLiteratureProvider({ fetch });

    await expect(provider.search('rate limited', 10)).rejects.toEqual(
      expect.objectContaining({ code: 'rate_limited' }),
    );
  });

  it('batches unique author IDs at the fixed author endpoint and parses bounded metrics', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse([
        { authorId: 'author-1', hIndex: 75, citationCount: 12_345, name: 'Ignored name' },
        { authorId: 'author-2', hIndex: 12, citationCount: 400 },
        null,
      ]),
    );
    const provider = new SemanticScholarLiteratureProvider({ fetch });
    const ids = [
      'author-1',
      'author-1',
      ...Array.from({ length: 205 }, (_, index) => `author-${index}`),
    ];

    const metrics = await provider.authorMetrics(ids);

    const [request, init] = fetch.mock.calls[0]!;
    const url = new URL(request.toString());
    const body = JSON.parse(String(init?.body)) as { ids: string[] };
    expect(url.origin).toBe('https://api.semanticscholar.org');
    expect(url.pathname).toBe('/graph/v1/author/batch');
    expect(url.searchParams.get('fields')).toBe('authorId,hIndex,citationCount');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(body.ids).toHaveLength(200);
    expect(new Set(body.ids).size).toBe(200);
    expect(metrics.get('author-1')).toEqual({
      authorId: 'author-1',
      hIndex: 75,
      citationCount: 12_345,
    });
    expect(metrics.get('author-2')?.hIndex).toBe(12);
  });
});
