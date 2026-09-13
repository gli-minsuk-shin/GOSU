import { expect, it, vi } from 'vitest';
import {
  PublicPaperLookup,
  parseOpenReviewPapers,
  parsePmlrPaper,
  pmlrVolumes,
  pmlrTitleLink,
  dataCiteArxivPaper,
  samePaperTitle,
} from './briefing-public-paper-lookup';
import {
  SourceRateLimitError,
  SourceReadError,
  assertPublicSourceUrl,
  sourceFailureReceipt,
} from './live-public-http';
import { arxivQuery, parseArxiv, createPaperSearcher } from './live-public-sources';
import { briefingToolFailure } from './briefing-tool-policy';
import { sourceError } from './live-source-service';
import { paperIdentifier, parseCrossrefPapers } from './briefing-paper-identifiers';
import { resolvePaperSaveSource } from './paper-save-source';
it('passes verified public PDF evidence to ingestion and rejects a substituted identity', async () => {
  const url = 'https://proceedings.mlr.press/v100/fixture.html';
  const item = {
    id: 'publisher-record',
    kind: 'papers' as const,
    title: 'Synthetic publisher paper',
    sourceUrl: url,
    source: 'PMLR',
    text: '',
    readScope: 'paper-metadata' as const,
    details: [],
  };
  const lookup = {
    search: vi.fn(async () => ({
      items: [item],
      status: 'ready' as const,
      attempts: [],
      cacheReused: false,
      coverage: '',
    })),
    read: vi.fn(async () => ({
      status: 'ready' as const,
      readScope: 'pdf-text-excerpt' as const,
      title: item.title,
      sourceUrl: 'https://proceedings.mlr.press/v100/fixture.pdf',
      excerpt: 'Verified public PDF methods and reported results.',
      totalCharacters: 48,
      nextOffset: null,
      note: 'PDF text only',
      attempts: [],
    })),
  };
  expect((await resolvePaperSaveSource(url, item.title, signal(), lookup)).paper?.readScope).toBe(
    'pdf-text-excerpt',
  );
  await expect(
    resolvePaperSaveSource(
      'https://proceedings.mlr.press/v100/other.html',
      item.title,
      signal(),
      lookup,
    ),
  ).rejects.toThrow('논문 식별');
  expect(lookup.read).toHaveBeenCalledOnce();
});
const title = 'Towards Constituting Mathematical Structures for Learning to Optimize';
const interest = { keywords: [{ term: title, weight: 5, synonyms: [] }], excluded: ['optimize'] };
const options = { enabled: true, days: 30, limit: 6, author: 'Unrelated Author' };
const note = (name = title) => ({
  id: 'fixtureNote',
  forum: 'fixtureNote',
  pdate: Date.parse('2023-05-29T00:00:00Z'),
  content: {
    title: { value: name },
    abstract: { value: 'Verified public abstract.' },
    venue: { value: 'ICML 2023 Poster' },
    pdf: { value: '/pdf/' + 'a'.repeat(40) + '.pdf' },
    authors: { value: ['Author A'] },
  },
});
const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2305.18577</id><title>${title}</title><summary>Abstract</summary><published>2023-05-29T00:00:00Z</published></entry></feed>`;
const publisherPage = `<html><head><meta name="citation_title" content="${title}"/><meta name="citation_author" content="Author A"/><meta name="citation_pdf_url" content="https://proceedings.mlr.press/v202/liu23e/liu23e.pdf"/></head><body><div id="abstract">Publisher abstract</div></body></html>`;
const publisherIndex =
  '<ul><li><a href="v202">Volume 202</a> International Conference on Machine Learning, 2023</li></ul>';
const volume = `<div class="paper"><p class="title">${title}</p><p class="links"><a href="liu23e.html">abs</a></p></div>`;
const signal = () => new AbortController().signal;
it('parses identifiers conservatively and rejects arbitrary remote routes', () => {
  expect(paperIdentifier('arXiv:1706.03762v7')).toEqual({ kind: 'arxiv', id: '1706.03762v7' });
  expect(paperIdentifier('https://arxiv.org/pdf/1706.03762v7.pdf')).toEqual({
    kind: 'arxiv',
    id: '1706.03762v7',
  });
  expect(paperIdentifier('https://doi.org@evil.test/10.1234/foo')).toBeUndefined();
  expect(paperIdentifier('https://doi.org/10.1234/foo?redirect=http://127.0.0.1')).toBeUndefined();
  expect(() =>
    assertPublicSourceUrl(new URL('https://api.crossref.org/works/10.1234%2Fexample')),
  ).not.toThrow();
  for (const url of [
    'https://api.crossref.org/members',
    'https://arxiv.org/user/login',
    'http://api.crossref.org/works',
    'https://api.crossref.org/works/10.1234%2Fexample/agency',
  ])
    expect(() => assertPublicSourceUrl(new URL(url))).toThrow('source_url_denied');
});
it('isolates a hanging provider and propagates user cancellation without caching a late result', async () => {
  const read = async (url: URL) =>
    url.hostname === 'api.crossref.org'
      ? JSON.stringify({ message: { items: [crossref('Bounded search')] } })
      : JSON.stringify({ notes: [] });
  const lookup = new PublicPaperLookup({
    read,
    arxiv: () => new Promise(() => undefined),
    searchTimeoutMs: 10,
  });
  const result = await lookup.search('Bounded search', interest, options, signal(), {
    mode: 'title',
  });
  expect(result.items).toHaveLength(1);
  expect(result.attempts.find((a) => a.provider === 'arXiv')?.detail).toMatchObject({
    phase: 'timeout',
    httpStatus: null,
  });
  const controller = new AbortController();
  const cancelled = lookup.search('Another question', interest, options, controller.signal);
  controller.abort();
  await expect(cancelled).rejects.toThrow('source_cancelled');
});
it('enforces an explicitly requested year instead of relabelling older records', async () => {
  const lookup = new PublicPaperLookup({
    arxiv: async () => [],
    read: async (url) => {
      if (url.hostname === 'api.crossref.org')
        return JSON.stringify({ message: { items: [crossref('Old result')] } });
      if (url.hostname === 'api2.openreview.net') return JSON.stringify({ notes: [] });
      return JSON.stringify({ data: [] });
    },
  });
  expect(
    (await lookup.search('Old result', interest, options, signal(), { mode: 'title', year: 2026 }))
      .items,
  ).toEqual([]);
});
it('resolves arbitrary arXiv IDs without the search API and falls back from missing HTML to a title-verified PDF', async () => {
  const arxiv = vi.fn();
  const lookup = new PublicPaperLookup({
    arxiv,
    read: async (url) => {
      if (url.pathname.startsWith('/html/'))
        throw new SourceReadError('source_http_404', url.hostname, 'http', 404);
      return '<html><head><meta name="citation_title" content="Synthetic identifier paper"/><meta name="citation_author" content="Ada Example"/></head><body><blockquote class="abstract">Verified abstract</blockquote></body></html>';
    },
    bytes: async () => Buffer.from('%PDF-fixture'),
    extract: async () => ({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: 'Synthetic identifier paper. Methods and results.' }],
      extractedCharacters: 50,
      textAvailable: true,
      truncated: false,
    }),
  });
  const result = await lookup.search(
    'https://arxiv.org/abs/2401.01234v2',
    interest,
    options,
    signal(),
  );
  expect(result.items[0]?.text).toBe('Verified abstract');
  expect(result.items[0]?.bibliography?.venue).not.toContain('PMLR');
  const body = await lookup.read(result.items[0]!, signal());
  expect(body.readScope).toBe('pdf-text-excerpt');
  expect(body.sourceUrl).toBe('https://arxiv.org/pdf/2401.01234v2');
  expect(arxiv).not.toHaveBeenCalled();
});
it('does not substitute a different DOI or fabricate an abstract/publication date', () => {
  expect(
    parseCrossrefPapers(JSON.stringify({ message: crossref('Wrong DOI') }), '10.1234/different'),
  ).toEqual([]);
  const result = parseCrossrefPapers(
    JSON.stringify({
      message: {
        items: [
          {
            ...crossref('Metadata only'),
            abstract: undefined,
            'published-online': undefined,
            created: { 'date-time': '2026-09-14' },
          },
        ],
      },
    }),
  );
  expect(result[0]?.item.readScope).toBe('paper-metadata');
  expect(result[0]?.item.publishedAt).toBeUndefined();
});
const crossref = (title: string, doi = '10.1234/example', type = 'journal-article') => ({
  DOI: doi,
  title: [title],
  type,
  author: [{ given: 'Ada', family: 'Example' }],
  'container-title': ['Synthetic Journal'],
  'published-online': { 'date-parts': [[1995, 6, 2]] },
  abstract: '<jats:p>Measured results from a public abstract.</jats:p>',
});
it.each(['Attention', 'Bayesian economics and policy', 'Genetic mechanisms of tissue repair'])(
  'finds generic cross-discipline titles while other providers fail: %s',
  async (name) => {
    const lookup = new PublicPaperLookup({
      arxiv: async () => {
        throw new SourceRateLimitError(Date.now() + 120000);
      },
      read: async (url) => {
        if (url.hostname === 'api.crossref.org')
          return JSON.stringify({
            message: { items: [crossref('Unrelated title'), crossref(name)] },
          });
        throw new SourceReadError('source_timeout', url.hostname, 'timeout');
      },
    });
    const result = await lookup.search(name, interest, options, signal(), { mode: 'title' });
    expect(result.items.map((p) => p.title)).toEqual([name]);
    expect(result.items[0]?.bibliography?.venue).toBe('Synthetic Journal');
    expect(result.status).toBe('partial');
  },
);
it('does not mistake a long topic query for an exact title', async () => {
  const arxiv = vi.fn().mockResolvedValue([]);
  const lookup = new PublicPaperLookup({
    arxiv,
    read: async (url) =>
      url.hostname === 'api.crossref.org'
        ? JSON.stringify({ message: { items: [crossref('Robust estimation')] } })
        : JSON.stringify({ notes: [] }),
  });
  const result = await lookup.search(
    'robust methods for estimation with missing observations in longitudinal datasets',
    interest,
    options,
    signal(),
  );
  expect(arxiv.mock.calls[0]?.[6]).toBe('topic');
  expect(result.items[0]?.title).toBe('Robust estimation');
});
it('resolves DOI identity without irrelevant title searches and caches it across DOI spellings', async () => {
  const arxiv = vi.fn();
  const read = vi.fn(async (url: URL) => {
    expect(url.pathname).toBe('/works/10.1234%2Fexample');
    return JSON.stringify({ message: crossref('A short title') });
  });
  const lookup = new PublicPaperLookup({ arxiv, read });
  expect(
    (await lookup.search('https://doi.org/10.1234/example', interest, options, signal())).items[0]
      ?.title,
  ).toBe('A short title');
  expect(
    (await lookup.search('doi:10.1234/EXAMPLE', interest, options, signal())).cacheReused,
  ).toBe(true);
  expect(arxiv).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledOnce();
});
it('keeps incomplete dates and non-papers out of recent results, without manufacturing publication dates', async () => {
  const lookup = new PublicPaperLookup({
    arxiv: async () => [],
    read: async (url) =>
      url.hostname === 'api.crossref.org'
        ? JSON.stringify({
            message: {
              items: [
                crossref('Dataset', '10.1234/data', 'dataset'),
                { ...crossref('Year only'), 'published-online': { 'date-parts': [[2026]] } },
              ],
            },
          })
        : JSON.stringify({ notes: [] }),
  });
  expect(
    (await lookup.search('Example', interest, options, signal(), { mode: 'recent' })).items,
  ).toEqual([]);
  const result = await lookup.search('Year only', interest, options, signal(), { mode: 'title' });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]?.publishedAt).toBeUndefined();
});
it('removes briefing date/author/exclusion filters only for named-title/topic lookup', () => {
  expect(arxivQuery(interest, options, '2026-09-13T00:00:00Z', 'title')).toBe(`(ti:"${title}")`);
  expect(arxivQuery(interest, options, '2026-09-13T00:00:00Z')).toContain('submittedDate:');
  expect(
    parseArxiv(xml, interest, options, '2026-09-13T00:00:00Z', new Set(), 'title'),
  ).toHaveLength(1);
  expect(parseArxiv(xml, interest, options, '2026-09-13T00:00:00Z')).toHaveLength(0);
});
it('uses exact OpenReview matches after 429 and reuses public evidence without more arXiv/LLM calls', async () => {
  const arxiv = vi.fn().mockRejectedValue(new SourceRateLimitError(Date.now() + 120000));
  const read = vi
    .fn()
    .mockResolvedValue(JSON.stringify({ notes: [note('A similar but different paper'), note()] }));
  const lookup = new PublicPaperLookup({ arxiv, read });
  const first = await lookup.search(title, interest, options, signal(), { mode: 'title' });
  expect(first.status).toBe('partial');
  expect(first.items).toHaveLength(1);
  expect(first.items[0]?.title).toBe(title);
  expect(first.attempts[0]?.detail).toMatchObject({
    phase: 'http',
    httpStatus: 429,
    requestSent: true,
  });
  expect(arxiv.mock.calls[0]?.[6]).toBe('title');
  expect(
    (await lookup.search(title, interest, options, signal(), { mode: 'title' })).cacheReused,
  ).toBe(true);
  expect(arxiv).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledTimes(2); // OpenReview + independent Crossref, no cache re-fetch.
  await expect(lookup.read({ ...first.items[0]!, id: 'forged' }, signal())).rejects.toThrow(
    'paper_not_discovered',
  );
});
it('prefers the verified PMLR PDF, enforces title identity and caches extracted text', async () => {
  const arxiv = vi.fn().mockRejectedValue(new SourceRateLimitError(Date.now() + 120000));
  const read = vi.fn(async (url: URL) =>
    url.hostname === 'api2.openreview.net'
      ? JSON.stringify({ notes: [note()] })
      : url.pathname === '/'
        ? publisherIndex
        : url.pathname === '/v202/'
          ? volume
          : publisherPage,
  );
  const bytes = vi.fn(async () => Buffer.from('%PDF-fixture'));
  const extract = vi.fn(async () => ({
    pageCount: 2,
    pages: [{ pageNumber: 1, text: title + ' ' + 'Methods and results. '.repeat(1600) }],
    extractedCharacters: 32000,
    textAvailable: true,
    truncated: true,
  }));
  const lookup = new PublicPaperLookup({ arxiv, read, bytes, extract });
  const result = await lookup.search(title, interest, options, signal(), { mode: 'title' });
  const first = await lookup.read(result.items[0]!, signal());
  expect(first.readScope).toBe('pdf-text-excerpt');
  expect(first.sourceUrl).toBe('https://proceedings.mlr.press/v202/liu23e/liu23e.pdf');
  expect(first.nextOffset).toBe(20000);
  const next = await lookup.read(result.items[0]!, signal(), first.nextOffset!);
  expect(next.excerpt.length).toBeGreaterThan(0);
  expect(bytes).toHaveBeenCalledOnce();
  expect(extract).toHaveBeenCalledOnce();
});
it('tries OpenReview PDF if PMLR fails and never labels an unrelated PDF as the requested paper', async () => {
  const lookup = new PublicPaperLookup({
    arxiv: vi.fn().mockResolvedValue([]),
    read: vi.fn(async (url: URL) => {
      if (url.hostname === 'api2.openreview.net') return JSON.stringify({ notes: [note()] });
      throw new SourceReadError('source_http_503', url.hostname, 'http', 503);
    }),
    bytes: vi.fn(async () => Buffer.from('%PDF-fixture')),
    extract: vi.fn(async () => ({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: 'Different unrelated paper' }],
      extractedCharacters: 25,
      textAvailable: true,
      truncated: false,
    })),
  });
  const result = await lookup.search(title, interest, options, signal(), { mode: 'title' });
  const body = await lookup.read(result.items[0]!, signal());
  expect(body.status).toBe('partial');
  expect(body.readScope).toBe('abstract');
  expect(body.attempts.some((a) => a.code === 'paper_identity_mismatch')).toBe(true);
});
it('distinguishes upstream 429, skipped cooldown and local timeout without resetting cooldown', async () => {
  const until = Date.now() + 120000,
    read = vi.fn().mockRejectedValue(new SourceRateLimitError(until));
  const search = createPaperSearcher(read);
  await expect(search(interest, options, signal())).rejects.toMatchObject({ phase: 'http' });
  let cooldown: unknown;
  try {
    await search(interest, options, signal());
  } catch (error) {
    cooldown = error;
  }
  expect(sourceFailureReceipt(cooldown)).toMatchObject({
    phase: 'cooldown',
    httpStatus: null,
    requestSent: false,
  });
  expect(sourceError(cooldown)).toContain('이번 요청은 서버에 보내지 않았습니다');
  expect(read).toHaveBeenCalledOnce();
  const timeout = new SourceReadError('source_timeout', 'export.arxiv.org', 'timeout');
  expect(briefingToolFailure(timeout)).toMatchObject({
    category: 'timeout',
    source: { phase: 'timeout', httpStatus: null },
  });
  expect(sourceError(timeout)).toContain('확인된 것은 아닙니다');
});
it('allows only bounded public publisher routes and rejects redirects/private/arbitrary PDF locations', () => {
  for (const url of [
    'https://proceedings.mlr.press/',
    'https://proceedings.mlr.press/v202/',
    'https://proceedings.mlr.press/v202/liu23e.html',
    'https://proceedings.mlr.press/v202/liu23e/liu23e.pdf',
    'https://openreview.net/pdf/' + 'a'.repeat(40) + '.pdf',
  ])
    expect(() => assertPublicSourceUrl(new URL(url))).not.toThrow();
  for (const url of [
    'https://127.0.0.1/private.pdf',
    'https://proceedings.mlr.press/api/secrets',
    'https://evil.test/paper.pdf',
    'https://openreview.net/attachment?id=a&name=private',
    'https://proceedings.mlr.press/v202/liu23e.html?redirect=http://localhost',
  ])
    expect(() => assertPublicSourceUrl(new URL(url))).toThrow('source_url_denied');
  expect(pmlrVolumes(publisherIndex, 2023, 'ICML 2023')).toEqual([
    'https://proceedings.mlr.press/v202/',
  ]);
  expect(pmlrTitleLink(volume, 'https://proceedings.mlr.press/v202/', title)).toContain('liu23e');
  expect(() =>
    parsePmlrPaper(publisherPage, 'https://proceedings.mlr.press/v202/liu23e.html', 'Different'),
  ).toThrow('paper_identity_mismatch');
  expect(
    parseOpenReviewPapers(JSON.stringify({ notes: [note('Almost right')] }), title, 'title'),
  ).toEqual([]);
  expect(samePaperTitle('AB A', 'A BA')).toBe(false);
});
it('uses DOI-verified public HTML after a challenge without following or solving the challenge', async () => {
  const metadata = JSON.stringify({
    data: [
      {
        id: '10.48550/arxiv.2410.01700',
        attributes: {
          titles: [{ title }],
          version: '1',
          descriptions: [{ descriptionType: 'Abstract', description: 'DOI abstract' }],
        },
      },
    ],
  });
  expect(dataCiteArxivPaper(metadata, title)?.sourceUrl).toBe('https://arxiv.org/abs/2410.01700v1');
  expect(dataCiteArxivPaper(metadata, 'Wrong title')).toBeUndefined();
  const read = vi.fn(async (url: URL) => {
    if (url.hostname === 'api2.openreview.net') return JSON.stringify({ notes: [note()] });
    if (url.hostname === 'api.datacite.org') return metadata;
    if (url.hostname === 'arxiv.org')
      return '<html><p class="ltx_p">Original methods and results.</p><math alttext="x^2"></math><figure><img src="figure.png"/><figcaption>Evidence caption</figcaption></figure></html>';
    throw new SourceReadError('source_http_503', url.hostname, 'http', 503);
  });
  const bytes = vi
    .fn()
    .mockRejectedValue(
      new SourceReadError('source_challenge_required', 'openreview.net', 'http', 302),
    );
  const lookup = new PublicPaperLookup({ arxiv: vi.fn().mockResolvedValue([]), read, bytes });
  const result = await lookup.search(title, interest, options, signal(), { mode: 'title' });
  const body = await lookup.read(result.items[0]!, signal());
  expect(body).toMatchObject({
    status: 'ready',
    readScope: 'html-excerpt',
    sourceUrl: 'https://arxiv.org/html/2410.01700v1',
    equations: [{ id: 'eq-0', latex: 'x^2' }],
  });
  expect(body.figures).toHaveLength(1);
  expect(body.note).toContain('버전');
  expect(read.mock.calls.every(([url]) => !url.pathname.includes('challenge'))).toBe(true);
  const second = await lookup.read(result.items[0]!, signal());
  expect(second.cacheReused).toBe(true);
  expect(bytes).toHaveBeenCalledOnce();
});
it('keeps recent-search date, author and excluded-topic conditions on fallback sources', async () => {
  const fresh = { ...note(), pdate: Date.now() };
  const lookup = new PublicPaperLookup({
    arxiv: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue(JSON.stringify({ notes: [fresh] })),
  });
  expect(
    (await lookup.search(title, interest, options, signal(), { mode: 'recent' })).items,
  ).toHaveLength(0);
  expect(
    (
      await lookup.search(
        title,
        { ...interest, excluded: [] },
        { ...options, author: 'Author A' },
        signal(),
        { mode: 'recent' },
      )
    ).items,
  ).toHaveLength(1);
});
