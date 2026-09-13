// Explicit opt-in native inference. Sources and saved state are synthetic/disposable only.
// Never reads Apple Mail/Calendar, user briefing history or private research keywords.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { createRoutineTransport } from '../briefing-native';
import { analyzeBriefing } from '../briefing-analysis';
import { LiveSourceService } from '../live-source-service';
import { AppleMailConnection } from '../live-mail';
import { BriefingMemoryStore } from '../briefing-memory-store';
import { BriefingWorkspaceStore } from '../briefing-workspace-store';
import { CalendarService } from '../calendar-service';
import { briefingClientContext } from '../briefing-client-context';
import { PAPER_TEMPLATE_FIELDS } from '../src/briefing-intelligence';
import type { AutomaticSummaryJobStatus } from '../src/automatic-summary-client';
import type { LiveItem } from '../src/live-types';

const discovery = createRoutineTransport('codex');
const model = await discovery
  .catalog()
  .then((catalog) => {
    const found = catalog.models.find((item) => item.modelId === 'gpt-5.6-luna');
    if (!found || !found.reasoningOptions.some((option) => option.id === 'low'))
      throw new Error('schema_smoke_model_unavailable');
    return found;
  })
  .finally(() => discovery.dispose());
const mails: LiveItem[] = Array.from({ length: 6 }, (_, index) => ({
  id: `synthetic-mail-${index + 1}`,
  kind: 'email',
  title: `Synthetic office reminder ${index + 1}`,
  text: `This is synthetic test message ${index + 1}. Please confirm attendance by September 10 at 17:00. The meeting is in room ${301 + index}.`,
  source: 'Synthetic test source',
  readScope: 'mail-preview',
  details: [],
}));
const paper: LiveItem = {
  id: 'synthetic-paper',
  kind: 'papers',
  title: 'Synthetic centered linear regression example',
  text: 'This synthetic research example asks whether centering features changes a linear regression fit. It compares centered and uncentered data under a squared error objective and assumes independent samples. It reports no measured results and no convergence guarantee.',
  source: 'Synthetic test source',
  readScope: 'abstract',
  details: [],
};
class SyntheticMail extends AppleMailConnection {
  override assertScope() {}
  override async restorePolicyGrant() {}
  override async collect() {
    return { items: structuredClone(mails), note: 'Synthetic test only; no account access' };
  }
}
const directory = await mkdtemp(join(tmpdir(), 'gosu-summary-schema-smoke-'));
const key = randomBytes(32);
const workspace = new BriefingWorkspaceStore(directory, async () => key);
const memory = new BriefingMemoryStore(directory, async () => key);
let analyzerCalls = 0;
const analyze: typeof analyzeBriefing = async (...args) => {
  analyzerCalls++;
  return analyzeBriefing(...args);
};
const service = new LiveSourceService(
  new SyntheticMail(),
  { cities: async () => [], weather: async () => [], papers: async () => [paper] },
  async () => {
    throw new Error('unexpected_consent_in_synthetic_scope');
  },
  analyze,
  memory,
  workspace,
  new CalendarService(),
  async () => model,
);
const client = randomBytes(32).toString('hex');
const owner = <T>(action: () => T) => briefingClientContext.run(client, action);
const scope = {
  accountId: 'synthetic',
  mailboxId: 'synthetic',
  days: 1,
  limit: 6,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: true,
};
const live = { ...defaultLiveSettings(), mail: scope };
async function api(path: string, body: unknown) {
  const request = Object.assign(Readable.from([JSON.stringify(body)]), {
    method: 'POST',
    url: `/api/briefing-agent/sources${path}`,
    headers: { 'content-type': 'application/json' },
  }) as IncomingMessage;
  let status = 0,
    payload = '';
  const response = {
    writeHead: (value: number) => {
      status = value;
    },
    end: (value?: string) => {
      payload = value ?? '';
    },
    destroyed: false,
  };
  await owner(() =>
    service.handle(request, response as unknown as ServerResponse, new AbortController().signal),
  );
  const result = JSON.parse(payload) as AutomaticSummaryJobStatus;
  if (status >= 400) throw new Error(result.error ?? 'schema_smoke_request_failed');
  return result;
}
async function complete(job: AutomaticSummaryJobStatus) {
  const deadline = Date.now() + 240000;
  let last = '';
  while (job.state === 'running') {
    if (Date.now() > deadline) throw new Error('schema_smoke_deadline');
    await delay(300);
    job = await api('/assistant/auto-summary/status', {
      routineId: 'synthetic-recovery',
      jobId: job.id,
    });
    const progress = JSON.stringify({
      state: job.state,
      percent: job.percent,
      kind: job.kind,
      detail: job.detail,
    });
    if (progress !== last) {
      console.log(progress);
      last = progress;
    }
  }
  if (job.state !== 'complete') throw new Error(job.error ?? 'schema_smoke_failed');
  return job;
}
try {
  await owner(() =>
    workspace.save(
      {
        routineId: 'synthetic-recovery',
        name: 'Synthetic recovery check',
        timeZone: 'Asia/Seoul',
        live,
        interest: { keywords: [], excluded: [] },
        preferences: {
          ...defaultAssistantPreferences(),
          mailRead: true,
          mailAi: true,
          autoPaperSummary: true,
          providerId: 'codex',
          modelId: model.modelId,
          reasoning: 'low',
        },
      },
      async () => undefined,
    ),
  );
  const collected = await owner(() =>
    service.collect(
      { routineId: 'synthetic-recovery', live, interest: { keywords: [], excluded: [] } },
      new AbortController().signal,
      () => undefined,
    ),
  );
  const input = { routineId: 'synthetic-recovery', receiptId: collected[0]!.receiptId! };
  const result = await complete(await api('/assistant/auto-summary/start', input));
  if (
    result.percent !== 100 ||
    result.completed !== 7 ||
    result.results.map((batch) => batch.kind).join(',') !== 'email,papers'
  )
    throw new Error('schema_smoke_coverage');
  for (const batch of result.results)
    for (const item of batch.items)
      for (const field of PAPER_TEMPLATE_FIELDS)
        if (batch.kind === 'email' ? item[field] !== '' : !item[field]?.trim())
          throw new Error('schema_smoke_template');
  const calls = analyzerCalls;
  const reused = await complete(
    await api('/assistant/auto-summary/start', { ...input, force: true }),
  );
  if (
    analyzerCalls !== calls ||
    reused.results.some(
      (batch) =>
        batch.cache?.generatedItemIds.length ||
        batch.cache?.reusedItemIds.length !== batch.items.length,
    )
  )
    throw new Error('schema_smoke_cache');
  console.log(
    JSON.stringify({
      passed: true,
      model: model.modelId,
      reasoning: 'low',
      completed: result.completed,
      total: result.total,
      percent: result.percent,
      batches: result.results.map((batch) => ({
        kind: batch.kind,
        items: batch.items.length,
        invocation: batch.invocation,
      })),
      cachedCompleted: reused.completed,
      extraAnalyzerCalls: analyzerCalls - calls,
      userDataRead: false,
      userStateChanged: false,
    }),
  );
} finally {
  service.close();
  await rm(directory, { recursive: true, force: true });
}
