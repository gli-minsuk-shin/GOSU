import { describe, it, expect, vi } from 'vitest';
import {
  createBriefingPaperSearcher,
  PapersDiscoveryIncompleteError,
  rankRecentPapers,
} from './briefing-paper-discovery';
import { SourceRateLimitError } from './live-public-http';
import type { LiveItem } from './src/live-types';
import { savedPaperKey } from './src/paper-library-index';
const now = '2026-09-14T03:00:00Z';
const profile = {
  keywords: [{ term: 'neural networks', weight: 5, synonyms: ['deep learning'] }],
  excluded: ['advertising'],
};
const options = { enabled: true, days: 10, limit: 2, author: '' };
const item = (id: string, date = '2026-09-13T00:00:00Z'): LiveItem => ({
  id,
  kind: 'papers',
  title: 'Neural networks for science',
  text: 'A bounded abstract.',
  source: 'Test',
  sourceUrl: `https://doi.org/10.1234/${id}`,
  readScope: 'abstract',
  details: [],
  publishedAt: date,
  bibliography: { authors: ['Alice Researcher'], source: 'Test' },
});
const crossref = (ids = ['one', 'two', 'three']) =>
  JSON.stringify({
    message: {
      items: ids.map((id) => ({
        DOI: `10.1234/${id}`,
        type: 'journal-article',
        title: ['Neural networks for science'],
        abstract: '<p>A bounded abstract.</p>',
        author: [{ given: 'Alice', family: 'Researcher' }],
        published: { 'date-parts': [[2026, 9, 13]] },
      })),
    },
  });
describe('recurring public paper recovery', () => {
  it('reports which index failed and why when nothing recent remains, also from the reused pool', async () => {
    const arxiv = vi.fn().mockRejectedValue(new SourceRateLimitError(Date.now() + 120000));
    const read = vi.fn(async (u: URL) =>
      u.hostname === 'api.crossref.org' ? crossref([]) : JSON.stringify({ notes: [] }),
    );
    const search = createBriefingPaperSearcher({ arxiv, read });
    const first = await search(profile, options, new AbortController().signal, now).catch(
      (error: unknown) => error,
    );
    expect(first).toBeInstanceOf(PapersDiscoveryIncompleteError);
    expect((first as PapersDiscoveryIncompleteError).failures).toEqual([
      { source: 'arXiv', code: 'source_rate_limited' },
    ]);

    const summarizedSearch = createBriefingPaperSearcher({
      arxiv: vi.fn().mockRejectedValue(new SourceRateLimitError(Date.now() + 120000)),
      read: async (u: URL) =>
        u.hostname === 'api.crossref.org' ? crossref(['one']) : JSON.stringify({ notes: [] }),
    });
    const found = await summarizedSearch(profile, options, new AbortController().signal, now);
    const reused = await summarizedSearch(
      profile,
      options,
      new AbortController().signal,
      now,
      new Set(found.map(savedPaperKey)),
    ).catch((error: unknown) => error);
    expect(reused).toBeInstanceOf(PapersDiscoveryIncompleteError);
    expect((reused as PapersDiscoveryIncompleteError).failures).toEqual([
      { source: 'arXiv', code: 'source_rate_limited' },
    ]);
  });
  it('does not turn exhausted partial cached evidence into a false empty success', async () => {
    const search = createBriefingPaperSearcher({
      arxiv: async () => {
        throw new Error('source_timeout');
      },
      read: async (u) =>
        u.hostname === 'api.crossref.org' ? crossref(['one']) : JSON.stringify({ notes: [] }),
    });
    const first = await search(profile, options, new AbortController().signal, now);
    await expect(
      search(
        profile,
        options,
        new AbortController().signal,
        now,
        new Set(first.map(savedPaperKey)),
      ),
    ).rejects.toThrow('papers_discovery_incomplete');
  });
  it('keeps real alternative evidence when arXiv reports 429, without retrying it', async () => {
    const arxiv = vi.fn().mockRejectedValue(new SourceRateLimitError(Date.now() + 120000));
    const read = vi.fn(async (url: URL) =>
      url.hostname === 'api.crossref.org' ? crossref() : JSON.stringify({ notes: [] }),
    );
    const search = createBriefingPaperSearcher({ arxiv, read });
    const result = await search(profile, options, new AbortController().signal, now);
    expect(result).toHaveLength(2);
    expect(result[0]?.source).toContain('Crossref');
    expect(arxiv).toHaveBeenCalledTimes(1);
    expect(read.mock.calls.map(([url]) => url.hostname)).toEqual([
      'api.crossref.org',
      'api2.openreview.net',
    ]);
    expect(result[0]?.details.join(' ')).toContain('일부 출처 응답 실패');
    const crossrefUrl = read.mock.calls.find(([url]) => url.hostname === 'api.crossref.org')![0];
    expect(crossrefUrl.searchParams.get('sort')).toBe('relevance');
    expect(crossrefUrl.searchParams.get('filter')).toContain('from-pub-date:2026-09-04');
  });
  it('bounds a stalled endpoint and cancels its transport while retaining successful results', async () => {
    let aborted = false;
    const arxiv = vi.fn(
      (_p, _o, s: AbortSignal) =>
        new Promise<LiveItem[]>(() =>
          s.addEventListener('abort', () => {
            aborted = true;
          }),
        ),
    );
    const search = createBriefingPaperSearcher({
      arxiv,
      timeoutMs: 10,
      read: async (u) =>
        u.hostname === 'api.crossref.org' ? crossref() : JSON.stringify({ notes: [] }),
    });
    expect(await search(profile, options, new AbortController().signal, now)).toHaveLength(2);
    expect(aborted).toBe(true);
  });
  it('does not call unavailable sources again when reusing a fresh candidate pool; excludes summaries before limit', async () => {
    const arxiv = vi.fn().mockResolvedValue([]);
    const read = vi.fn(async (u) =>
      u.hostname === 'api.crossref.org' ? crossref() : JSON.stringify({ notes: [] }),
    );
    const search = createBriefingPaperSearcher({ arxiv, read });
    const first = await search(profile, options, new AbortController().signal, now);
    const second = await search(
      profile,
      options,
      new AbortController().signal,
      now,
      new Set(first.map(savedPaperKey)),
    );
    expect(second).toHaveLength(1);
    expect(first.some((i) => i.id === second[0]?.id)).toBe(false);
    expect(arxiv).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('distinguishes failed/unknown from a successful empty window and never caches failure', async () => {
    const arxiv = vi.fn().mockRejectedValue(new Error('source_timeout'));
    const read = vi.fn().mockResolvedValue(JSON.stringify({ notes: [] }));
    const search = createBriefingPaperSearcher({ arxiv, read });
    await expect(search(profile, options, new AbortController().signal, now)).rejects.toThrow(
      'papers_discovery_incomplete',
    );
    await expect(search(profile, options, new AbortController().signal, now)).rejects.toThrow(
      'papers_discovery_incomplete',
    );
    expect(arxiv).toHaveBeenCalledTimes(2);
    expect(
      await createBriefingPaperSearcher({
        arxiv: async () => [],
        read: async (u) =>
          u.hostname === 'api.crossref.org' ? crossref([]) : JSON.stringify({ notes: [] }),
      })(profile, options, new AbortController().signal, now),
    ).toEqual([]);
  });
  it('preserves date, author, exclusions, synonyms, relevance and exact-identifier deduplication', () => {
    const missingDate = item('missing');
    delete missingDate.publishedAt;
    const candidates = [
      item('good'),
      item('good'),
      item('old', '2026-08-01T00:00:00Z'),
      item('future', '2026-10-01T00:00:00Z'),
      missingDate,
      { ...item('unrelated'), title: 'Unrelated subject' },
      { ...item('ad'), title: 'Neural networks advertising' },
      { ...item('synonym'), title: 'Deep learning for science' },
      { ...item('author'), bibliography: { authors: ['Bob'], source: 'Test' } },
    ];
    expect(
      rankRecentPapers(
        candidates,
        profile,
        { ...options, limit: 10, author: 'Alice' },
        now,
        new Set(),
      ).map((i) => i.id),
    ).toEqual(['good', 'synonym']);
  });
  it('propagates cancellation and does not retain cancelled results', async () => {
    const controller = new AbortController();
    const arxiv = vi.fn().mockImplementation(async () => {
      controller.abort();
      return [item('late')];
    });
    const search = createBriefingPaperSearcher({ arxiv, read: async () => crossref() });
    await expect(search(profile, options, controller.signal, now)).rejects.toThrow(
      'source_cancelled',
    );
  });
});
