import { DOMParser } from '@xmldom/xmldom';
import { z } from 'zod';
import type { InterestProfile, LiveSettings, WeatherLocation } from '@gosu/briefing-core';
import { publicSourceText, SourceRateLimitError } from './live-public-http';
import { setTimeout as delay } from 'node:timers/promises';
import type { LiveItem } from './src/live-types';
import { savedPaperKey } from './src/paper-library-index';

type Reader = typeof publicSourceText;
export const CityQuerySchema = z.object({ query: z.string().trim().min(2).max(120) }).strict();
export async function findWeatherCities(
  query: string,
  signal: AbortSignal,
  read: Reader = publicSourceText,
): Promise<WeatherLocation[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({
    name: CityQuerySchema.parse({ query }).query,
    count: '8',
    language: 'ko',
    format: 'json',
  }).toString();
  const raw = z
    .object({
      results: z
        .array(
          z.object({
            id: z.number().int().positive(),
            name: z.string(),
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            country: z.string().optional(),
            admin1: z.string().optional(),
            timezone: z.string(),
          }),
        )
        .max(8)
        .optional(),
    })
    .parse(JSON.parse(await read(url, signal)));
  return (raw.results ?? []).map((item) => ({
    id: item.id,
    name: [item.name, item.admin1].filter(Boolean).join(', '),
    latitude: item.latitude,
    longitude: item.longitude,
    country: item.country ?? '',
    timeZone: item.timezone,
  }));
}
const weatherLabel = (code: number | null) => {
  if (code === 0) return '맑음';
  if (code !== null && code <= 3) return '구름';
  if (code === 45 || code === 48) return '안개';
  if (code !== null && code >= 95) return '뇌우';
  if (code !== null && code >= 71 && code <= 77) return '눈';
  if (code === 85 || code === 86) return '눈 소나기';
  if (code !== null && code >= 51 && code <= 82) return '비';
  return '상태 미제공';
};
const measurement = z.number().finite().nullable();
export async function readWeather(
  city: WeatherLocation,
  signal: AbortSignal,
  read: Reader = publicSourceText,
): Promise<LiveItem[]> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    current: 'temperature_2m,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weather_code',
    timeformat: 'unixtime',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: city.timeZone,
    forecast_days: '3',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
  }).toString();
  const value = z
    .object({
      timezone: z.string(),
      current: z.object({
        time: z.union([z.string(), z.number()]),
        temperature_2m: measurement,
        weather_code: measurement,
        wind_speed_10m: measurement,
      }),
      daily: z.object({
        time: z
          .array(z.union([z.string(), z.number()]))
          .min(1)
          .max(7),
        temperature_2m_max: z.array(measurement),
        temperature_2m_min: z.array(measurement),
        precipitation_probability_max: z.array(measurement),
      }),
      hourly: z
        .object({
          time: z.array(z.number()).max(192),
          temperature_2m: z.array(measurement),
          apparent_temperature: z.array(measurement),
          precipitation_probability: z.array(measurement),
          weather_code: z.array(measurement),
        })
        .optional(),
    })
    .parse(JSON.parse(await read(url, signal)));
  const number = (v: number | null | undefined, unit: string) =>
    v == null ? '미제공' : `${v}${unit}`;
  const localDate = (time: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: value.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(time * 1000));
  const today =
    typeof value.current.time === 'number'
      ? localDate(value.current.time)
      : value.current.time.slice(0, 10);
  const currentTime =
    typeof value.current.time === 'number'
      ? new Date(value.current.time * 1000).toISOString()
      : value.current.time;
  return [
    {
      id: `weather:${city.id}`,
      kind: 'weather',
      title: `${city.name} · ${weatherLabel(value.current.weather_code)}`,
      text: `현재 ${number(value.current.temperature_2m, '°C')} · 바람 ${number(value.current.wind_speed_10m, ' km/h')}`,
      source: 'Open-Meteo (CC BY 4.0)',
      sourceUrl: 'https://open-meteo.com/',
      readScope: 'forecast',
      weather: {
        city: city.name,
        timeZone: value.timezone,
        localDate: today,
        currentTime,
        temperature: value.current.temperature_2m,
        code: value.current.weather_code,
        wind: value.current.wind_speed_10m,
        hours: (value.hourly?.time ?? [])
          .flatMap((time, index) =>
            localDate(time) === today
              ? [
                  {
                    time,
                    temperature: value.hourly!.temperature_2m[index] ?? null,
                    apparent: value.hourly!.apparent_temperature[index] ?? null,
                    precipitation: value.hourly!.precipitation_probability[index] ?? null,
                    code: value.hourly!.weather_code[index] ?? null,
                  },
                ]
              : [],
          )
          .slice(0, 25),
      },
      details: [
        `기상 모델 기준 ${currentTime} (${value.timezone}) · 현장 관측값이 아닌 예보/모델 값`,
        ...value.daily.time.map(
          (day, index) =>
            `${typeof day === 'number' ? localDate(day) : day} · 최저 ${number(value.daily.temperature_2m_min[index], '°C')} / 최고 ${number(value.daily.temperature_2m_max[index], '°C')} · 강수확률 ${number(value.daily.precipitation_probability_max[index], '%')}`,
        ),
      ],
    },
  ];
}

const literal = (text: string) =>
  `"${text
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()}"`;
export type PaperSearchMode = 'recent' | 'title' | 'topic';
export function arxivQuery(
  profile: InterestProfile,
  options: LiveSettings['papers'],
  now: string,
  mode: PaperSearchMode = 'recent',
) {
  const terms = [
    ...new Set(
      profile.keywords
        .flatMap((k) => [k.term, ...k.synonyms])
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (!terms.length) throw new Error('papers_keywords_required');
  const date = (d: Date) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const from = date(new Date(Date.parse(now) - options.days * 86400000));
  const expression = `(${terms.map((term) => `${mode === 'title' ? 'ti' : 'all'}:${literal(term)}`).join(' OR ')})${mode === 'recent' ? ` AND submittedDate:[${from} TO ${date(new Date(now))}]${options.author.trim() ? ` AND au:${literal(options.author)}` : ''}` : ''}`;
  if (expression.length > 2000) throw new Error('papers_query_too_large');
  return expression;
}
const ATOM = 'http://www.w3.org/2005/Atom';
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function matches(haystack: string, term: string) {
  const needle = normalize(term);
  if (!needle) return false;
  if (!/[a-z0-9]/i.test(needle)) return haystack.includes(needle);
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`,
    'u',
  ).test(haystack);
}
export function parseArxiv(
  xml: string,
  profile: InterestProfile,
  options: LiveSettings['papers'],
  now: string,
  summarized: ReadonlySet<string> = new Set(),
  mode: PaperSearchMode = 'recent',
): LiveItem[] {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('papers_invalid_response');
  const doc = new DOMParser({
    errorHandler: {
      warning: () => {
        throw new Error('papers_invalid_response');
      },
      error: () => {
        throw new Error('papers_invalid_response');
      },
      fatalError: () => {
        throw new Error('papers_invalid_response');
      },
    },
  }).parseFromString(xml, 'application/xml');
  if (doc.documentElement.namespaceURI !== ATOM || doc.documentElement.localName !== 'feed')
    throw new Error('papers_invalid_response');
  const entries = Array.from(doc.getElementsByTagNameNS(ATOM, 'entry'));
  const records = new Map<string, LiveItem>();
  for (const entry of entries.slice(0, 100)) {
    const field = (name: string) =>
      entry.getElementsByTagNameNS(ATOM, name)[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const id = field('id').match(
      /^https?:\/\/arxiv\.org\/abs\/((?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})(?:v\d+)?)$/,
    )?.[1];
    if (!id) throw new Error('papers_invalid_response');
    const canonical = id.replace(/v\d+$/, '');
    if (records.has(canonical)) continue;
    const published = field('published'),
      title = field('title').slice(0, 2000),
      abstract = field('summary').slice(0, 16000);
    if (!title || !Number.isFinite(Date.parse(published)))
      throw new Error('papers_invalid_response');
    if (
      (mode === 'recent' && Date.parse(published) < Date.parse(now) - options.days * 86400000) ||
      Date.parse(published) > Date.parse(now) + 60000
    )
      continue;
    const t = normalize(title),
      a = normalize(abstract);
    if (mode === 'recent' && profile.excluded.some((term) => matches(t, term) || matches(a, term)))
      continue;
    let score = 0;
    const matchedKeywords: string[] = [];
    for (const keyword of profile.keywords) {
      const terms = [keyword.term, ...keyword.synonyms];
      const tm = terms.some((term) => matches(t, term)),
        am = terms.some((term) => matches(a, term));
      if (tm || am) {
        score += keyword.weight * ((tm ? 3 : 0) + (am ? 1 : 0));
        matchedKeywords.push(keyword.term);
      }
    }
    const authors = Array.from(entry.getElementsByTagNameNS(ATOM, 'author'))
      .slice(0, 30)
      .map((author) => author.getElementsByTagNameNS(ATOM, 'name')[0]?.textContent ?? '')
      .filter(Boolean);
    records.set(canonical, {
      id: canonical,
      kind: 'papers',
      title,
      text: abstract || '초록이 제공되지 않았습니다.',
      source: 'arXiv',
      sourceUrl: `https://arxiv.org/abs/${id}`,
      publishedAt: published,
      bibliography: {
        authors: authors.map((name) => name.slice(0, 500)),
        source: 'arXiv',
        ...(entry
          .getElementsByTagNameNS('http://arxiv.org/schemas/atom', 'journal_ref')[0]
          ?.textContent?.trim()
          ? {
              venue: entry
                .getElementsByTagNameNS('http://arxiv.org/schemas/atom', 'journal_ref')[0]!
                .textContent!.trim()
                .slice(0, 1000),
            }
          : {}),
      },
      readScope: abstract ? 'abstract' : 'paper-metadata',
      details: [authors.join(', '), `수정일 ${field('updated')} · preprint · 전문/실험 검증 아님`],
      score,
      matchedKeywords,
    });
  }
  return [...records.values()]
    .sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!) ||
        a.id.localeCompare(b.id),
    )
    .filter((item) => !summarized.has(savedPaperKey(item)))
    .slice(0, options.limit);
}
const ARXIV_CACHE_TTL_MS = 120_000;
export function createPaperSearcher(read: Reader = publicSourceText, clock = Date.now) {
  // Cache raw public evidence, not a ranking computed for another research profile.
  const cache = new Map<string, { xml: string; fetchedAt: number; window: number }>();
  let queue = Promise.resolve(),
    nextRequestAt = 0,
    retryAt = 0;
  return async (
    profile: InterestProfile,
    options: LiveSettings['papers'],
    signal: AbortSignal,
    now = new Date().toISOString(),
    summarized: ReadonlySet<string> = new Set(),
    mode: PaperSearchMode = 'recent',
  ) => {
    const query = arxivQuery(profile, options, now, mode);
    const key = JSON.stringify([profile, options, mode]);
    const cached = () => {
      if (signal.aborted) throw new Error('source_cancelled');
      const entry = cache.get(key);
      if (
        !entry ||
        clock() - entry.fetchedAt >= ARXIV_CACHE_TTL_MS ||
        Math.abs(Date.parse(now) - entry.window) >= ARXIV_CACHE_TTL_MS
      )
        return null;
      return parseArxiv(entry.xml, profile, options, now, summarized, mode).map((item) => ({
        ...item,
        source: 'arXiv · 최근 조회 재사용',
        details: [...item.details, '최근 2분 안에 가져온 원문 검색 결과입니다.'],
      }));
    };
    const hit = cached();
    if (hit) return hit;
    if (clock() < retryAt) throw new SourceRateLimitError(retryAt, 'export.arxiv.org', 'cooldown');
    const execute = async () => {
      const hit = cached();
      if (hit) return hit;
      if (clock() < retryAt)
        throw new SourceRateLimitError(retryAt, 'export.arxiv.org', 'cooldown');
      if (clock() < nextRequestAt) await delay(nextRequestAt - clock(), undefined, { signal });
      if (signal.aborted) throw new Error('source_cancelled');
      nextRequestAt = clock() + 3100;
      const url = new URL('https://export.arxiv.org/api/query');
      url.search = new URLSearchParams({
        search_query: query,
        start: '0',
        max_results: String(Math.min(60, options.limit * 3)),
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      }).toString();
      try {
        const xml = await read(url, signal);
        if (signal.aborted) throw new Error('source_cancelled');
        const items = parseArxiv(xml, profile, options, now, summarized, mode);
        for (const [id, entry] of cache)
          if (clock() - entry.fetchedAt >= ARXIV_CACHE_TTL_MS) cache.delete(id);
        if (cache.size >= 24) cache.delete(cache.keys().next().value!);
        cache.set(key, { xml, fetchedAt: clock(), window: Date.parse(now) });
        return items;
      } catch (error) {
        if (error instanceof Error && error.message === 'source_rate_limited') {
          retryAt = error instanceof SourceRateLimitError ? error.retryAt : clock() + 120_000;
          throw error instanceof SourceRateLimitError
            ? error
            : new SourceRateLimitError(retryAt, 'export.arxiv.org', 'unknown');
        }
        throw error;
      }
    };
    const pending = queue.then(execute);
    queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
}
const sharedPaperSearch = createPaperSearcher();
export function searchPapers(
  profile: InterestProfile,
  options: LiveSettings['papers'],
  signal: AbortSignal,
  read: Reader = publicSourceText,
  now = new Date().toISOString(),
  summarized: ReadonlySet<string> = new Set(),
  mode: PaperSearchMode = 'recent',
) {
  return (read === publicSourceText ? sharedPaperSearch : createPaperSearcher(read))(
    profile,
    options,
    signal,
    now,
    summarized,
    mode,
  );
}
