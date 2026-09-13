// Reproducible descriptive comparison; three trials are not a significance/production-SLA claim.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory = resolve(process.argv[2] ?? 'tmp/briefing-latency-2026-09-10');
const rows = (await readFile(resolve(directory, 'trials.jsonl'), 'utf8'))
  .trim()
  .split('\n')
  .map(JSON.parse);
const seen = new Set();
for (const row of rows) {
  const key = `${row.scenario}:${row.variant}:${row.repetition}`;
  if (seen.has(key)) throw new Error(`duplicate_trial:${key}`);
  seen.add(key);
  if (
    row.model !== 'gpt-5.6-luna' ||
    row.reasoning !== 'medium' ||
    !row.syntheticSources ||
    row.applicationSummaryCache !== 'disabled'
  )
    throw new Error(`incomparable_trial:${key}`);
  if (!Number.isFinite(row.wallMs) || row.wallMs <= 0) throw new Error(`invalid_time:${key}`);
}
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const scenarios = ['email-summary', 'email-chat', 'calendar-chat'];
const variants = ['baseline', 'optimized'];
const groups = scenarios.flatMap((scenario) =>
  variants.map((variant) => {
    const set = rows.filter((r) => r.scenario === scenario && r.variant === variant);
    if (set.length !== 3 || set.some((r) => !r.success))
      throw new Error(`incomplete_group:${scenario}:${variant}`);
    if (new Set(set.map((r) => r.promptHash)).size !== 1)
      throw new Error('within_variant_prompt_changed');
    const output = set.map((r) => r.usage?.outputTokens).filter(Number.isFinite);
    const input = set.map((r) => r.usage?.inputTokens).filter(Number.isFinite);
    const cached = set.map((r) => r.usage?.cachedInputTokens).filter(Number.isFinite);
    return {
      scenario,
      variant,
      n: set.length,
      medianSeconds: median(set.map((r) => r.wallMs)) / 1000,
      meanSeconds: mean(set.map((r) => r.wallMs)) / 1000,
      minSeconds: Math.min(...set.map((r) => r.wallMs)) / 1000,
      maxSeconds: Math.max(...set.map((r) => r.wallMs)) / 1000,
      medianFirstOutputSeconds: median(set.map((r) => r.firstOutputMs)) / 1000,
      medianCompletionTailSeconds: median(set.map((r) => r.wallMs - r.firstOutputMs)) / 1000,
      medianSetupSeconds:
        median(set.map((r) => (r.timing.catalog ?? 0) + (r.timing.startThread ?? 0))) / 1000,
      medianOutputTokens: output.length ? median(output) : null,
      medianInputTokens: input.length ? median(input) : null,
      medianCachedInputTokens: cached.length ? median(cached) : null,
      usageRows: output.length,
      qualityPassed: set.filter((r) => r.quality?.pass).length,
      toolCalls: set.map((r) => r.toolCalls.length),
      inputChars: set[0].inputChars,
    };
  }),
);
const comparisons = scenarios.map((scenario) => {
  const before = groups.find((g) => g.scenario === scenario && g.variant === 'baseline');
  const after = groups.find((g) => g.scenario === scenario && g.variant === 'optimized');
  const paired = rows
    .filter((r) => r.scenario === scenario && r.variant === 'baseline')
    .map((b) => {
      const a = rows.find(
        (r) =>
          r.scenario === scenario && r.variant === 'optimized' && r.repetition === b.repetition,
      );
      return {
        repetition: b.repetition,
        beforeSeconds: b.wallMs / 1000,
        afterSeconds: a.wallMs / 1000,
        savedSeconds: (b.wallMs - a.wallMs) / 1000,
        improvement: (b.wallMs - a.wallMs) / b.wallMs,
      };
    });
  return {
    scenario,
    before,
    after,
    medianImprovement: (before.medianSeconds - after.medianSeconds) / before.medianSeconds,
    meanImprovement: (before.meanSeconds - after.meanSeconds) / before.meanSeconds,
    medianPairedImprovement: median(paired.map((p) => p.improvement)),
    paired,
    outputTokenReduction: before.medianOutputTokens
      ? (before.medianOutputTokens - after.medianOutputTokens) / before.medianOutputTokens
      : null,
  };
});
const result = {
  generatedAt: new Date().toISOString(),
  model: 'gpt-5.6-luna',
  reasoning: 'medium',
  trialCount: rows.length,
  start: rows[0].startedAt,
  end: rows.at(-1).startedAt,
  groups,
  comparisons,
  qualityFailures: rows
    .filter((r) => !r.quality?.pass)
    .map((r) => ({
      scenario: r.scenario,
      variant: r.variant,
      repetition: r.repetition,
      checks: r.quality?.checks,
    })),
  limitations: [
    'Synthetic evidence; actual Apple Mail/Calendar fetching, UI rendering and application cache hits are not timed.',
    'Native transport startup and completion are included. Model first-output time is not the user-visible answer time.',
    'Three sequential repeats per condition, not randomized traffic or a statistical significance/SLA claim.',
    'Provider prompt caching and upstream scheduling vary; native reported token/cache counts are preserved.',
    'All trials retained, including baseline quality failures. Faster incomplete answers are not treated as quality-equivalent.',
  ],
};
await writeFile(resolve(directory, 'analysis.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
