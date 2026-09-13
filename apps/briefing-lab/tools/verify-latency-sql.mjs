// Independent SQL cross-check against the raw measured trials, not the JS aggregates.
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory = resolve('tmp/briefing-latency-2026-09-10');
const rows = (await readFile(resolve(directory, 'trials.jsonl'), 'utf8'))
  .trim()
  .split('\n')
  .map(JSON.parse);
const labels = {
  'email-summary': '이메일 3건 요약',
  'email-chat': '중요 메일 질문',
  'calendar-chat': '이틀 일정 질문',
};
const db = new DatabaseSync(':memory:');
db.exec(
  'CREATE TABLE bench_trials(sequence INTEGER, scenario TEXT, variant TEXT, scenarioLabel TEXT, condition TEXT, repetition INTEGER, seconds REAL, outputTokens INTEGER, cachedTokens INTEGER, inputTokens INTEGER, toolCalls INTEGER, model TEXT, reasoning TEXT, passed INTEGER, inputChars INTEGER)',
);
const insert = db.prepare('INSERT INTO bench_trials VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
rows.forEach((r, i) =>
  insert.run(
    i + 1,
    r.scenario,
    r.variant,
    labels[r.scenario],
    r.variant === 'baseline' ? '개선 전' : '개선 후',
    r.repetition,
    r.wallMs / 1000,
    r.usage.outputTokens,
    r.usage.cachedInputTokens,
    r.usage.inputTokens,
    r.toolCalls.length,
    r.model,
    r.reasoning,
    r.quality.pass ? 1 : 0,
    r.inputChars,
  ),
);
const conditions = db.prepare(await readFile(resolve(directory, 'compare.sql'), 'utf8')).all();
const trials = db.prepare(await readFile(resolve(directory, 'trials.sql'), 'utf8')).all();
const analysis = JSON.parse(await readFile(resolve(directory, 'analysis.json'), 'utf8'));
for (const row of conditions) {
  const original = analysis.groups.find(
    (g) => g.scenario === row.scenario && g.variant === row.variant,
  );
  for (const field of [
    'n',
    'medianSeconds',
    'meanSeconds',
    'minSeconds',
    'maxSeconds',
    'medianOutputTokens',
    'medianInputTokens',
    'medianCachedInputTokens',
    'qualityPassed',
  ])
    if (Math.abs(original[field] - row[field]) > 1e-9) throw new Error('SQL_discrepancy:' + field);
}
db.close();
await writeFile(
  resolve(directory, 'verified-datasets.json'),
  JSON.stringify({ conditions, trials }, null, 2),
);
console.log(
  JSON.stringify({
    verified: true,
    groups: conditions.length,
    trials: trials.length,
    checks: conditions.length * 9,
  }),
);
