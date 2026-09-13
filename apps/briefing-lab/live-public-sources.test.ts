import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  arxivQuery,
  parseArxiv,
  findWeatherCities,
  readWeather,
  searchPapers,
  createPaperSearcher,
} from './live-public-sources';
import {
  assertPublicSourceUrl,
  isPublicV4,
  SourceRateLimitError,
  sourceRetryAt,
} from './live-public-http';
afterEach(() => vi.useRealTimers());
const now = '2026-09-09T00:00:00.000Z';
const profile = {
  keywords: [{ term: 'neural networks', weight: 5, synonyms: ['deep learning'] }],
  excluded: ['astronomy'],
};
const options = { enabled: true, days: 30, limit: 10, author: '' };
const atom = (entries: string) => `<feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
const entry = (id: string, title: string, summary: string, date = '2026-09-08T00:00:00Z') =>
  `<entry><id>http://arxiv.org/abs/${id}</id><title>${title}</title><summary>${summary}</summary><published>${date}</published><updated>${date}</updated><author><name>Alice</name></author></entry>`;
describe('real public source contracts', () => {
  it('preserves supplied author and journal reference metadata without guessing a venue', () => {
    const xml = atom(
      entry('2609.00001', 'neural networks', 'Evidence').replace(
        '</entry>',
        '<arxiv:journal_ref xmlns:arxiv="http://arxiv.org/schemas/atom">Fixture Proceedings 2026</arxiv:journal_ref></entry>',
      ),
    );
    const result = parseArxiv(xml, profile, options, now);
    expect(result[0]?.bibliography).toEqual({
      authors: ['Alice'],
      venue: 'Fixture Proceedings 2026',
      source: 'arXiv',
    });
  });
  it('reuses a successful request immediately and across minute changes before applying the network throttle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const read = vi.fn(async () => atom(entry('2609.00001', 'neural networks', 'Evidence')));
    const search = createPaperSearcher(read);
    const signal = new AbortController().signal;
    const first = await search(profile, options, signal);
    first[0]!.title = 'client edit';
    const next = await search(profile, options, signal);
    expect(next[0]!.title).toBe('neural networks');
    expect(next[0]!.source).toContain('재사용');
    vi.setSystemTime(Date.parse(now) + 61000);
    expect(await search(profile, options, signal)).toHaveLength(1);
    expect(read).toHaveBeenCalledOnce();
    vi.setSystemTime(Date.parse(now) + 121000);
    await search(profile, options, signal);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('re-ranks changed profiles and deduplicates concurrent identical source requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const read = vi.fn(async () =>
      atom(entry('2609.00001', 'neural networks astronomy', 'Evidence')),
    );
    const search = createPaperSearcher(read),
      signal = new AbortController().signal;
    await Promise.all([search(profile, options, signal), search(profile, options, signal)]);
    expect(read).toHaveBeenCalledOnce();
    const changed = search({ ...profile, excluded: [] }, options, signal);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await changed).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('respects Retry-After across different queries and never caches failures or retries during cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const retryAt = sourceRetryAt('300');
    const read = vi
      .fn()
      .mockRejectedValueOnce(new SourceRateLimitError(retryAt))
      .mockResolvedValue(atom(''));
    const search = createPaperSearcher(read),
      signal = new AbortController().signal;
    await expect(search(profile, options, signal)).rejects.toMatchObject({ retryAt });
    await expect(search({ ...profile, excluded: [] }, options, signal)).rejects.toMatchObject({
      retryAt,
    });
    expect(read).toHaveBeenCalledOnce();
    vi.setSystemTime(retryAt);
    expect(await search(profile, options, signal)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('does not return cached data after cancellation or cache a malformed source response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const read = vi.fn().mockResolvedValueOnce('<html/>').mockResolvedValue(atom(''));
    const search = createPaperSearcher(read),
      signal = new AbortController().signal;
    await expect(search(profile, options, signal)).rejects.toThrow('invalid_response');
    vi.setSystemTime(Date.parse(now) + 3100);
    await search(profile, options, signal);
    await expect(search(profile, options, AbortSignal.abort())).rejects.toThrow('cancelled');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('uses saved research keywords, synonyms and exact time range, escaping query syntax', () => {
    const query = arxivQuery(profile, options, now);
    expect(query).toContain('all:"neural networks" OR all:"deep learning"');
    expect(query).toContain('submittedDate:[202608100000 TO 202609090000]');
    expect(arxivQuery(profile, { ...options, author: 'A" OR all:*' }, now)).toContain(
      'au:"A OR all"',
    );
    expect(() => arxivQuery({ ...profile, keywords: [] }, options, now)).toThrow(
      'keywords_required',
    );
  });
  it('parses real Atom, deduplicates versions and ranks/excludes using title and abstract', () => {
    const xml = atom(
      entry('2609.00001v2', 'A paper', 'neural networks') +
        entry('2609.00002v1', 'neural networks architecture', 'deep learning') +
        entry('2609.00001v1', 'duplicate', 'neural networks') +
        entry('2609.00003', 'astronomy neural networks', 'excluded'),
    );
    const rows = parseArxiv(xml, profile, options, now);
    expect(rows.map((row) => row.id)).toEqual(['2609.00002', '2609.00001']);
    expect(rows[0]!.score).toBe(20);
    expect(rows[1]!.sourceUrl).toBe('https://arxiv.org/abs/2609.00001v2');
    expect(rows[0]!.readScope).toBe('abstract');
  });
  it('distinguishes valid empty data, old entries and malformed/hostile XML', () => {
    expect(parseArxiv(atom(''), profile, options, now)).toEqual([]);
    expect(
      parseArxiv(
        atom(entry('2501.00001', 'neural networks', '', '2025-01-01T00:00:00Z')),
        profile,
        options,
        now,
      ),
    ).toEqual([]);
    for (const xml of [
      '<html/>',
      '<!DOCTYPE feed><feed/>',
      atom(entry('bad', 'bad', 'bad')),
      'x'.repeat(2000001),
    ])
      expect(() => parseArxiv(xml, profile, options, now)).toThrow();
  });
  it('builds an allowlisted arXiv request, passes cancellation and never includes mail content', async () => {
    const signal = new AbortController().signal,
      read = vi.fn(async () => atom(''));
    await searchPapers(profile, options, signal, read, now);
    expect(read.mock.calls[0]).toBeDefined();
    expect(String((read.mock.calls as unknown[][])[0]![0])).toContain('export.arxiv.org/api/query');
  });
  it('returns city candidates and requested city forecast with source/model time', async () => {
    const signal = new AbortController().signal;
    const cities = await findWeatherCities('Seoul', signal, async () =>
      JSON.stringify({
        results: [
          {
            id: 1,
            name: 'Seoul',
            latitude: 37.5,
            longitude: 127,
            country: 'Korea',
            timezone: 'Asia/Seoul',
          },
        ],
      }),
    );
    const rows = await readWeather(cities[0]!, signal, async () =>
      JSON.stringify({
        timezone: 'Asia/Seoul',
        current: {
          time: '2026-09-09T09:00',
          temperature_2m: 24,
          weather_code: 0,
          wind_speed_10m: null,
        },
        daily: {
          time: ['2026-09-09'],
          temperature_2m_max: [29],
          temperature_2m_min: [20],
          precipitation_probability_max: [null],
        },
      }),
    );
    expect(rows[0]!.text).toContain('24°C');
    expect(rows[0]!.text).toContain('미제공');
    expect(rows[0]!.details.join(' ')).toContain('강수확률 미제공');
    expect(rows[0]!.readScope).toBe('forecast');
  });
  it('fails closed on private IP, alternate paths, credentials and redirects to arbitrary hosts', () => {
    for (const address of [
      '127.0.0.1',
      '10.2.3.4',
      '172.16.0.1',
      '192.168.0.2',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
    ])
      expect(isPublicV4(address)).toBe(false);
    expect(isPublicV4('8.8.8.8')).toBe(true);
    for (const url of [
      'http://export.arxiv.org/api/query',
      'https://localhost/api/query',
      'https://export.arxiv.org/other',
      'https://user:pass@api.open-meteo.com/v1/forecast',
      'https://api.open-meteo.com:444/v1/forecast',
    ])
      expect(() => assertPublicSourceUrl(new URL(url))).toThrow();
  });
});
