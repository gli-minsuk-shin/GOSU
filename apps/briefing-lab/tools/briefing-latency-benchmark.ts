// Opt-in real Luna inference on fixed synthetic evidence. Never reads or mutates user sources.
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { analyzeBriefing, validateInsights } from '../briefing-analysis';
import { runBriefingAssistant } from '../briefing-assistant';
import { createRoutineTransport, runRoutineWithGosuLanguage } from '../briefing-native';
import type { AssistantProfile, BriefingWorkspaceStore } from '../briefing-workspace-store';
import type { LiveItem } from '../src/live-types';
import { AssistantAnswerSchema } from '../src/workspace-contracts';

const MODEL = 'gpt-5.6-luna',
  REASONING = 'medium',
  NOW = '2026-09-10T00:00:00.000Z';
const directory = resolve(
  process.env.BRIEFING_LATENCY_OUTPUT_DIR ?? 'tmp/briefing-latency-2026-09-10',
);
const mode = process.argv[2] ?? 'capture';
type Runner = typeof runRoutineWithGosuLanguage;
type Job = NonNullable<NonNullable<Parameters<Runner>[3]>['structuredJob']>;
type StoredJob = Omit<Job, 'executeTool'>;
const emails: LiveItem[] = [
  {
    id: 'm1',
    kind: 'email',
    title: '미팅 참석 회신 요청',
    text: '학과 사무실: 9월 11일 오후 5시까지 참석 여부를 회신해 주세요. 미팅 장소는 302호로 변경되었습니다.',
    source: 'Synthetic',
    readScope: 'mail-preview',
    details: [],
    publishedAt: '2026-09-10T00:10:00Z',
    mailAccount: { id: 'work', name: '연구용', addresses: ['work@example.test'] },
  },
  {
    id: 'm2',
    kind: 'email',
    title: '구독 갱신 안내',
    text: '자료실 구독은 9월 15일 만료됩니다. 계속 이용하려면 담당자에게 갱신을 요청하세요. 자동 갱신이나 자동 결제는 없습니다.',
    source: 'Synthetic',
    readScope: 'mail-preview',
    details: [],
    publishedAt: '2026-09-09T23:30:00Z',
    mailAccount: { id: 'personal', name: '개인용', addresses: ['personal@example.test'] },
  },
  {
    id: 'm3',
    kind: 'email',
    title: '주간 뉴스레터',
    text: '이번 주 공개 강연 소식입니다. 참여는 선택 사항이며 답장이나 신청 마감은 없습니다.',
    source: 'Synthetic',
    readScope: 'mail-preview',
    details: [],
    publishedAt: '2026-09-09T22:40:00Z',
    mailAccount: { id: 'work', name: '연구용', addresses: ['work@example.test'] },
  },
];
const calendar = [
  {
    id: 'c1',
    title: '연구 미팅',
    start: '2026-09-10T01:00:00Z',
    end: '2026-09-10T02:00:00Z',
    allDay: false,
    location: '302호',
    timeZone: 'Asia/Seoul',
  },
  {
    id: 'c2',
    title: '논문 검토',
    start: '2026-09-10T05:00:00Z',
    end: '2026-09-10T06:00:00Z',
    allDay: false,
    location: '연구실',
    timeZone: 'Asia/Seoul',
  },
  {
    id: 'c3',
    title: '공동연구 세미나',
    start: '2026-09-11T00:00:00Z',
    end: '2026-09-11T01:00:00Z',
    allDay: false,
    location: '온라인',
    timeZone: 'Asia/Seoul',
  },
];
const profile = {
  routineId: 'latency-synthetic',
  name: 'Synthetic benchmark',
  timeZone: 'Asia/Seoul',
  preferences: {
    ...defaultAssistantPreferences(),
    providerId: 'codex',
    modelId: MODEL,
    reasoning: REASONING,
    mailRead: true,
    mailAi: true,
    calendarRead: true,
    calendarIds: ['synthetic'],
  },
  live: {
    ...defaultLiveSettings(),
    mail: {
      accountId: 'work',
      mailboxId: 'inbox',
      days: 3,
      limit: 15,
      subject: '',
      sender: '',
      unreadOnly: false,
      bodyPreview: true,
    },
  },
  interest: { keywords: [], excluded: [] },
  approvedScope: 'synthetic-only',
  updatedAt: NOW,
} as AssistantProfile;
const workspace = {
  profile: async () => profile,
  owns: () => true,
  canPrivateAi: async () => true,
  history: async () => [],
  summaryHistory: async () => [],
} as unknown as BriefingWorkspaceStore;
const scenarioNames = ['email-summary', 'email-chat', 'calendar-chat'] as const;
type Scenario = (typeof scenarioNames)[number];
const prompts: Record<Scenario, string> = {
  'email-summary': '이 메일 3건을 각각 요약하고 중요도와 다음 행동을 알려줘.',
  'email-chat': '최근 메일 중 중요한 내용 찾아줘. 받은 계정과 수신 시각도 알려줘.',
  'calendar-chat': '9월 10일과 11일 일정을 날짜별로 정리해줘. 일정 추가는 하지 마.',
};
const blankInsight = (item: LiveItem) => ({
  id: item.id,
  summary: '캡처용',
  importance: 'medium' as const,
  importanceReason: '확인',
  action: '확인',
  evidenceQuote: item.title,
  memorySuggestion: null,
  keywords: [],
  detail: '',
  researchQuestion: '',
  strengths: '',
  limitations: '',
  methodsAndAssumptions: '',
  reportedResults: '',
  relevance: '',
  equationIds: [],
  equationExplanations: [],
  figureIds: [],
});
async function capture(scenario: Scenario): Promise<Job> {
  let captured: Job | undefined;
  const runner: Runner = async (input, _signal, _progress, options) => {
    captured = options!.structuredJob!;
    if (scenario !== 'email-summary')
      captured = {
        ...captured,
        prompt: JSON.stringify({ ...JSON.parse(captured.prompt), now: NOW }),
      };
    return {
      answer: JSON.stringify(
        scenario === 'email-summary'
          ? { overview: '캡처용', items: emails.map(blankInsight) }
          : { answer: '캡처용', events: [], tasks: [] },
      ),
      providerId: input.providerId,
      model: MODEL,
      reasoning: REASONING,
      proposal: null,
      nextDates: [],
    };
  };
  const signal = AbortSignal.timeout(30000);
  if (scenario === 'email-summary') {
    await analyzeBriefing(
      {
        routineId: profile.routineId,
        receiptId: '11111111-1111-4111-8111-111111111111',
        itemIds: emails.map((i) => i.id),
        providerId: 'codex',
        modelId: MODEL,
        reasoning: REASONING,
        includeMail: true,
        memory: [],
      },
      emails,
      profile.interest,
      signal,
      () => undefined,
      runner,
    );
  } else {
    await runBriefingAssistant(
      { routineId: profile.routineId, prompt: prompts[scenario], history: [] },
      profile,
      workspace,
      {
        papers: async () => {
          throw new Error('unexpected_public_search');
        },
        mail: async (query) => ({
          items: emails.filter((i) => !query || (i.title + ' ' + i.text).includes(query)),
          note: '고정 검증 데이터 3건. 실제 메일 계정에 접근하지 않았습니다.',
        }),
        calendar: async (start, end) => ({
          events: calendar.filter(
            (e) =>
              Date.parse(e.start) >= Date.parse(start) && Date.parse(e.start) < Date.parse(end),
          ),
          limited: false,
        }),
      },
      signal,
      () => undefined,
      runner,
    );
  }
  if (!captured) throw new Error('capture_failed');
  return captured;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function grade(scenario: Scenario, raw: unknown) {
  const checks: Record<string, boolean> = {};
  if (scenario === 'email-summary') {
    const parsed = raw as { overview: string; items: Record<string, unknown>[] };
    const normalized = {
      ...parsed,
      items: parsed.items.map((i) => ({
        ...blankInsight(emails.find((e) => e.id === i.id)!),
        ...i,
      })),
    };
    const valid = validateInsights(normalized, emails);
    checks.exactCoverage = valid.items.length === 3;
    checks.actionAndDate =
      /11/.test(valid.items.find((i) => i.id === 'm1')!.action) &&
      /(17|5)/.test(valid.items.find((i) => i.id === 'm1')!.action);
    checks.noNewsletterObligation = valid.items.find((i) => i.id === 'm3')!.importance === 'low';
    checks.expiryPreserved = /15/.test(JSON.stringify(valid.items.find((i) => i.id === 'm2')));
  } else {
    const valid = AssistantAnswerSchema.parse(raw);
    checks.noWrites = valid.events.length === 0 && valid.tasks.length === 0;
    if (scenario === 'calendar-chat') {
      checks.exactTitles = calendar.every((e) => valid.answer.includes(e.title));
      checks.localTimes =
        /(10[:시]|오전\s*10)/.test(valid.answer) &&
        /(14[:시]|오후\s*2)/.test(valid.answer) &&
        /(9[:시]|09:|오전\s*9)/.test(valid.answer);
      checks.dated = /10/.test(valid.answer) && /11/.test(valid.answer);
    } else {
      checks.mainAction =
        valid.answer.includes('회신') && /11/.test(valid.answer) && /(17|5)/.test(valid.answer);
      checks.accounts = ['work@example.test', 'personal@example.test'].every((t) =>
        valid.answer.includes(t),
      );
      checks.receivedAt = /(9:10|09:10|9시\s*10)/.test(valid.answer);
      checks.boldTitle = valid.answer.includes('**미팅 참석 회신 요청**');
    }
  }
  return { checks, pass: Object.values(checks).every(Boolean) };
}
async function trial(
  scenario: Scenario,
  variant: 'baseline' | 'optimized',
  repetition: number,
  baseline: Record<Scenario, StoredJob>,
) {
  const current = await capture(scenario);
  const job =
    variant === 'baseline' ? { ...baseline[scenario], executeTool: current.executeTool } : current;
  const started = performance.now();
  const timing: Record<string, number> = {};
  const toolCalls: { name: string; args: unknown; ms: number }[] = [];
  let firstOutputMs: number | null = null,
    usage: unknown = null;
  const executeTool = job.executeTool;
  const record: Record<string, unknown> = {
    scenario,
    variant,
    repetition,
    startedAt: new Date().toISOString(),
    model: MODEL,
    reasoning: REASONING,
    promptHash: hash(job.instructions + job.prompt + JSON.stringify(job.schema)),
    inputChars: job.instructions.length + job.prompt.length + JSON.stringify(job.schema).length,
    syntheticSources: true,
    applicationSummaryCache: 'disabled',
  };
  console.log(JSON.stringify({ event: 'started', scenario, variant, repetition }));
  try {
    const result = await runRoutineWithGosuLanguage(
      {
        prompt: prompts[scenario],
        providerId: 'codex',
        modelId: MODEL,
        reasoning: REASONING,
        history: [],
        previousProposal: null,
      },
      AbortSignal.timeout(180000),
      () => undefined,
      {
        timeoutMs: 180000,
        structuredJob: {
          ...job,
          ...(executeTool
            ? {
                executeTool: async (name: string, args: unknown, signal: AbortSignal) => {
                  const t = performance.now();
                  try {
                    return await executeTool(name, args, signal);
                  } finally {
                    toolCalls.push({ name, args, ms: performance.now() - t });
                  }
                },
              }
            : {}),
        },
        factory: (provider) => {
          const engine = createRoutineTransport(provider);
          for (const key of ['catalog', 'startThread'] as const) {
            const original = engine[key].bind(engine) as (...args: unknown[]) => Promise<unknown>;
            Object.assign(engine, {
              [key]: async (...args: unknown[]) => {
                const t = performance.now();
                try {
                  return await original(...args);
                } finally {
                  timing[key] = (timing[key] ?? 0) + performance.now() - t;
                }
              },
            });
          }
          engine.on('notification', (event: unknown) => {
            const e = event as {
              method?: string;
              params?: { tokenUsage?: { total?: unknown; last?: unknown } };
            };
            if (e.method === 'item/agentMessage/delta' && firstOutputMs === null)
              firstOutputMs = performance.now() - started;
            if (e.method === 'thread/tokenUsage/updated')
              usage = e.params?.tokenUsage?.total ?? e.params?.tokenUsage?.last ?? null;
          });
          return engine;
        },
      },
    );
    if (result.model !== MODEL || result.reasoning !== REASONING)
      throw new Error('requested_model_not_used');
    const raw = JSON.parse(result.answer);
    Object.assign(record, {
      wallMs: performance.now() - started,
      firstOutputMs,
      timing,
      toolCalls,
      usage,
      outputChars: result.answer.length,
      answer: raw,
      quality: grade(scenario, raw),
      success: true,
    });
  } catch (error) {
    Object.assign(record, {
      wallMs: performance.now() - started,
      firstOutputMs,
      timing,
      toolCalls,
      usage,
      success: false,
      error: error instanceof Error ? error.message : 'benchmark_failed',
    });
  }
  await appendFile(resolve(directory, 'trials.jsonl'), JSON.stringify(record) + '\n');
  console.log(JSON.stringify({ ...record, answer: undefined }));
  if (!record.success) throw new Error('benchmark_trial_failed');
}
await mkdir(directory, { recursive: true });
const engine = createRoutineTransport('codex');
try {
  const model = (await engine.catalog()).models.find((m) => m.modelId === MODEL);
  if (!model || !model.reasoningOptions.some((r) => r.id === REASONING))
    throw new Error('exact_luna_medium_unavailable');
  console.log(
    JSON.stringify({ event: 'model_verified', model: model.modelId, reasoning: REASONING }),
  );
} finally {
  await engine.dispose();
}
const baselinePath = resolve(directory, 'baseline-jobs.json');
if (mode === 'capture' || mode === 'capture-optimized') {
  const jobs = {} as Record<Scenario, StoredJob>;
  for (const scenario of scenarioNames) {
    const { executeTool: _tool, ...job } = await capture(scenario);
    jobs[scenario] = job;
  }
  const sources = await Promise.all(
    ['briefing-analysis.ts', 'briefing-assistant.ts', 'briefing-native.ts'].map(async (file) => ({
      file,
      sha256: hash(await readFile(resolve('apps/briefing-lab', file), 'utf8')),
    })),
  );
  const snapshotPath =
    mode === 'capture' ? baselinePath : resolve(directory, 'optimized-jobs.json');
  await writeFile(
    snapshotPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        model: MODEL,
        reasoning: REASONING,
        synthetic: true,
        prompts,
        sources,
        jobs,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ event: 'prompt_snapshot_frozen', path: snapshotPath }));
} else {
  if (process.env.BRIEFING_LATENCY_LIVE !== '1') throw new Error('explicit_live_opt_in_required');
  const { jobs } = JSON.parse(await readFile(baselinePath, 'utf8')) as {
    jobs: Record<Scenario, StoredJob>;
  };
  if (mode === 'baseline')
    for (const scenario of scenarioNames) await trial(scenario, 'baseline', 1, jobs);
  else if (mode === 'compare')
    for (let repetition = 1; repetition <= 3; repetition++)
      for (const scenario of scenarioNames) {
        const order: ('baseline' | 'optimized')[] =
          repetition === 1
            ? ['optimized']
            : repetition % 2 === 0
              ? ['optimized', 'baseline']
              : ['baseline', 'optimized'];
        for (const variant of order) await trial(scenario, variant, repetition, jobs);
      }
  else throw new Error('mode_invalid');
}
