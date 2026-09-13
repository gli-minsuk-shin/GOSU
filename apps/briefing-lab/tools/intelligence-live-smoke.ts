// Explicit opt-in smoke: only public example sources, native subscription, no private mail/memory.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRoutineTransport } from '../briefing-native';
import { analyzeBriefing } from '../briefing-analysis';
import { findWeatherCities, readWeather, searchPapers } from '../live-public-sources';
import { enrichPaper, loadPaperFigure } from '../briefing-paper-evidence';
const signal = new AbortController().signal;
const interest = {
  keywords: [{ term: 'diffusion models', weight: 5, synonyms: [] }],
  excluded: [],
};
const cities = await findWeatherCities('Seoul', signal);
const weather = await readWeather(cities[0]!, signal);
const papers = await searchPapers(
  interest,
  { enabled: true, days: 3650, limit: 3, author: '' },
  signal,
);
if (!papers.length || !weather[0]?.weather?.hours.length) throw new Error('public_sources_empty');
const enriched = await Promise.all(papers.map((p) => enrichPaper(p, signal)));
console.log(
  JSON.stringify({
    weatherHours: weather[0].weather.hours.length,
    papers: enriched.map((p) => ({
      id: p.id,
      scope: p.paper?.readScope,
      equations: p.paper?.equations.length,
      figures: p.paper?.figures.length,
    })),
  }),
);
const selected =
  enriched.find((p) => p.paper?.figures.length) ??
  enriched.find((p) => p.paper?.equations.length) ??
  enriched[0]!;
const providerId = process.argv.includes('--claude') ? 'claude-code' : 'codex';
const engine = createRoutineTransport(providerId);
let catalog;
try {
  catalog = await engine.catalog();
} finally {
  await engine.dispose();
}
const model = catalog.models.find((m) => m.isDefault) ?? catalog.models[0];
if (!model) throw new Error('no_native_model');
const result = await analyzeBriefing(
  {
    routineId: 'public-smoke',
    receiptId: randomUUID(),
    itemIds: [selected.id],
    providerId,
    modelId: model.modelId,
    reasoning: null,
    includeMail: false,
    memory: [],
  },
  [selected],
  interest,
  signal,
  (detail) => console.log(detail),
);
const insight = result.items[0]!;
for (const id of insight.figureIds) {
  const figure = selected.paper?.figures.find((f) => f.id === id);
  if (figure) {
    try {
      figure.imageData = await loadPaperFigure(figure.assetUrl, selected.paper!.sourceUrl, signal);
    } catch (error) {
      console.log(
        JSON.stringify({
          figureId: id,
          unavailable: error instanceof Error ? error.message : 'unknown',
        }),
      );
    }
  }
}
const directory = resolve('tmp/briefing-intelligence');
await mkdir(directory, { recursive: true });
await writeFile(
  resolve(directory, 'public-result.json'),
  JSON.stringify({
    weather: weather[0].weather,
    item: { ...selected, paper: selected.paper ? { ...selected.paper, excerpt: '' } : undefined },
    insight,
    result: { invocation: result.invocation, memoryUsed: result.memoryUsed },
  }),
);
console.log(
  JSON.stringify({
    passed: true,
    invocation: result.invocation,
    summary: insight.summary,
    equations: insight.equationIds,
    figures: insight.figureIds,
    actualImages: selected.paper?.figures.filter((f) => f.imageData).length,
    output: resolve(directory, 'public-result.json'),
  }),
);
