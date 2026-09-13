// Explicit network smoke; public example values only. Does not read/save user settings or mail.
import { findWeatherCities, readWeather, searchPapers } from '../live-public-sources';
const signal = new AbortController().signal;
const cities = await findWeatherCities(process.argv[2] ?? 'Seoul', signal);
if (!cities[0]) throw new Error('city_smoke_empty');
const weather = await readWeather(cities[0], signal);
console.log(
  JSON.stringify({
    source: 'Open-Meteo',
    city: cities[0].name,
    items: weather.length,
    readScope: weather[0]?.readScope,
  }),
);
const papers = await searchPapers(
  {
    keywords: [{ term: process.argv[3] ?? 'neural networks', weight: 5, synonyms: [] }],
    excluded: [],
  },
  { enabled: true, days: 3650, limit: 3, author: '' },
  signal,
);
console.log(
  JSON.stringify({
    source: 'arXiv',
    items: papers.length,
    ids: papers.map((p) => p.id),
    scopes: papers.map((p) => p.readScope),
  }),
);
if (!papers.length) throw new Error('paper_smoke_empty');
