// Opt-in real native inference on synthetic paper/email only. Never reads accounts or saves memory.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRoutineTransport } from '../briefing-native';
import { analyzeBriefing } from '../briefing-analysis';
import type { LiveItem } from '../src/live-types';
const paper: LiveItem = {
  id: 'paper',
  kind: 'papers',
  title: 'Synthetic least-squares optimization example',
  source: 'Synthetic smoke fixture',
  text: 'This synthetic example defines a least-squares objective and its gradient update. It includes no experimental results or convergence guarantee.',
  readScope: 'abstract',
  details: [],
  paper: {
    readScope: 'html-excerpt',
    excerpt:
      'Let X have N rows and p columns, y have N entries, and theta have p entries. Minimize mean squared prediction error. The gradient is twice X transpose times the residual divided by N. Eta is a positive step size. This is a toy definition, not a claim of novelty or measured performance.',
    equations: [
      { id: 'e1', latex: 'L(\\theta)=\\frac{1}{N}\\lVert X\\theta-y\\rVert_2^2' },
      { id: 'e2', latex: '\\nabla L(\\theta)=\\frac{2}{N}X^\\top(X\\theta-y)' },
      { id: 'e3', latex: '\\theta_{t+1}=\\theta_t-\\eta\\nabla L(\\theta_t)' },
    ],
    figures: [],
    sourceUrl: 'https://example.org/synthetic',
    note: 'Synthetic source. No actual paper claims.',
  },
};
const mail: LiveItem = {
  id: 'mail',
  kind: 'email',
  title: 'Synthetic office RSVP reminder',
  source: 'Synthetic mail fixture',
  text: 'The office asks for an RSVP by September 10 at 17:00. The meeting room changed to 302. No research connection is stated.',
  readScope: 'mail-preview',
  details: [],
};
const engine = createRoutineTransport('codex');
let model;
try {
  const catalog = await engine.catalog();
  model = catalog.models.find((m) => m.isDefault) ?? catalog.models[0];
} finally {
  await engine.dispose();
}
if (!model) throw new Error('model_unavailable');
const result = await analyzeBriefing(
  {
    routineId: 'source-specific-smoke',
    receiptId: randomUUID(),
    itemIds: ['paper', 'mail'],
    providerId: 'codex',
    modelId: model.modelId,
    reasoning: model.reasoningOptions.find((r) => r.id === 'medium')?.id ?? null,
    includeMail: true,
    memory: [],
  },
  [paper, mail],
  { keywords: [{ term: 'optimization', weight: 5, synonyms: [] }], excluded: [] },
  AbortSignal.timeout(180000),
  (detail) => console.log(detail),
);
const p = result.items.find((i) => i.id === 'paper')!,
  m = result.items.find((i) => i.id === 'mail')!;
if (
  !p.keywords?.length ||
  !p.detail?.length ||
  !p.equationExplanations?.length ||
  m.relevance ||
  m.detail ||
  m.equationIds.length ||
  !m.action
)
  throw new Error('source_specific_validation_failed');
const output = resolve('tmp/briefing-intelligence/source-specific-summary-result.json');
await mkdir(resolve('tmp/briefing-intelligence'), { recursive: true });
await writeFile(output, JSON.stringify({ synthetic: true, result }, null, 2));
console.log(
  JSON.stringify({
    passed: true,
    invocation: result.invocation,
    keywords: p.keywords,
    detailLength: p.detail.length,
    equations: p.equationIds.length,
    mailResearchRelevance: m.relevance,
    mailAction: m.action,
    privateMailRead: false,
    output,
  }),
);
