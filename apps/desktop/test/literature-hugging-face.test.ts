import { describe, expect, it, vi } from 'vitest';

import {
  HuggingFaceLiteratureProvider,
  normalizeHuggingFacePaper,
} from '../src/main/literature-hugging-face';

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Hugging Face Papers literature provider', () => {
  it('uses the public bounded paper-search endpoint and keeps provider provenance', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse([
        {
          paper: {
            id: '2504.10808',
            title: '  A   Hugging Face paper fixture  ',
            publishedAt: '2025-04-15T02:06:05.000Z',
            authors: [{ name: 'Ada Researcher' }, { name: 'Grace Scientist' }],
            upvotes: 12,
            summary: 'This provider summary is deliberately not persisted.',
            ai_keywords: ['unverified keyword'],
          },
        },
      ]),
    );
    const provider = new HuggingFaceLiteratureProvider({ fetch });

    const papers = await provider.search('tabular-foundation model', 999, {
      fromYear: 2024,
      toYear: 2026,
    });

    const [request, init] = fetch.mock.calls[0]!;
    const url = new URL(request.toString());
    expect(url.origin).toBe('https://huggingface.co');
    expect(url.pathname).toBe('/api/papers/search');
    expect(url.searchParams.get('q')).toBe('tabular foundation model');
    expect(url.searchParams.get('limit')).toBe('120');
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
    expect(papers).toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({
          provider: 'hugging-face',
          providerId: '2504.10808',
          canonicalId: 'arxiv:2504.10808',
          title: 'A Hugging Face paper fixture',
          authors: ['Ada Researcher', 'Grace Scientist'],
          containerTitle: 'arXiv',
          publishedYear: 2025,
          topics: [],
          sourceUrl: 'https://huggingface.co/papers/2504.10808',
        }),
        upvotes: 12,
      }),
    ]);
    expect(JSON.stringify(papers)).not.toContain('deliberately not persisted');
    expect(JSON.stringify(papers)).not.toContain('unverified keyword');
  });

  it('normalizes malformed records conservatively and applies year filters locally', async () => {
    expect(normalizeHuggingFacePaper({ paper: { id: 'one' } })).toBeNull();
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse([
        {
          paper: {
            id: '2201.00001',
            title: 'Old paper',
            publishedAt: '2022-01-01T00:00:00.000Z',
            authors: [],
          },
        },
        {
          paper: {
            id: '2501.00001',
            title: 'Current paper',
            publishedAt: '2025-01-01T00:00:00.000Z',
            authors: [],
          },
        },
      ]),
    );
    const provider = new HuggingFaceLiteratureProvider({ fetch });

    const papers = await provider.search('bounded years', 20, { fromYear: 2024, toYear: 2026 });

    expect(papers.map(({ candidate }) => candidate.providerId)).toEqual(['2501.00001']);
  });

  it('maps throttling and cancellation to typed provider failures', async () => {
    const throttled = new HuggingFaceLiteratureProvider({
      fetch: vi.fn(async () => new Response('{}', { status: 429 })),
    });
    await expect(throttled.search('rate limited', 10)).rejects.toMatchObject({
      code: 'rate_limited',
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      new HuggingFaceLiteratureProvider({ fetch: vi.fn() }).search('cancelled', 10, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});
