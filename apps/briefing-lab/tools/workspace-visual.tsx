// Isolated visual fixture. Every source/provider/calendar response is synthetic; no backend route.
import { useState } from 'react';
import { mountBriefingRoot } from '../src/root-mount';
import { BriefingApp } from '../src/briefing-app';
import { initialWorkspace } from '../src/fixtures';
import { initialRealWorkspace } from '../src/workspace-defaults';
import { sharedPaperView } from '../src/shared-paper-view';
import type { PaperSummaryRecord } from '../src/paper-summary-contract';
import { defaultLiveSettings, defaultAssistantPreferences } from '@gosu/briefing-core';
import { createCodexModelCatalog } from '@gosu/contracts';
import type { CalendarEvent } from '../src/workspace-contracts';
import type { LiveItem, WeatherSeries } from '../src/live-types';
import type { BriefingHistory } from '../briefing-workspace-store';
import type { RemovedBriefing } from '../src/briefing-history-removal';
import type { GenerationView } from '../src/briefing-generation-contract';
let fixtureGenerationCount = 0;
let fixtureGeneration: GenerationView = {
  intervalHours: 0,
  nextDueAt: null,
  scheduleError: null,
  job: null,
};
import type { PaperClassification, PaperCategory } from '../src/paper-classification';
const fixtureClassifications = new Map<string, PaperClassification>();
const fixtureClassificationKey = (index: number) => index.toString(16).padStart(64, 'a');
let fixtureHistory: BriefingHistory[] = [];
const fixtureTrash = new Map<string, RemovedBriefing>();
const now = '2026-09-09T00:00:00Z';
const paperSaveScenario = new URLSearchParams(location.search).has('paper-save');
const savedChatPapers: PaperSummaryRecord[] = [];
const emptyWorkspaceScenario = new URLSearchParams(location.search).get('workspace') === 'empty';
const mailSettingsScenario =
  new URLSearchParams(location.search).has('mail-settings') ||
  new URLSearchParams(location.search).has('settings-proposal');
const uncertainMark = new URLSearchParams(location.search).get('mail-mark') === 'uncertain';
const onboardingScenario = new URLSearchParams(location.search).has('mail-onboarding');
const onboardingNotice =
  '첫 연결에서는 한꺼번에 많은 메일이 표시되지 않도록 전체 최대 3개만 가져옵니다. 연결 확인 후 다음 브리핑부터 설정한 전체 최대 50개를 조회합니다. 기존 요약은 Briefing History에서 볼 수 있습니다.';
const fixtureMailAccounts = [
  { id: 'fixture-work-account', name: 'Google', addresses: ['work@example.test'] },
  { id: 'fixture-personal-account', name: 'Google', addresses: ['personal@example.test'] },
];
const fixtureReceivedAt = '2026-09-07T23:20:00Z';
const fixtureRefreshes = new Map<string, string>();
const cacheMode = new URLSearchParams(location.search).get('cache');
const rainScenario = new URLSearchParams(location.search).get('rain');
const scholarScenario = new URLSearchParams(location.search).get('scholar') === '1';
const mailLayoutStress = new URLSearchParams(location.search).get('mail-layout') === 'long';
const longMailTitle =
  '[검증용] 공동 연구 계획 검토 및 다음 학기 협업 일정 안내 / Request for review of the proposed research collaboration and upcoming workshop schedule';
const events: CalendarEvent[] = [
  '연구 미팅',
  '논문 초안 검토',
  '실험 결과 정리',
  'Optimization 세미나',
  '공동연구 진행 확인',
].map((title, i) => ({
  id: `e${i}`,
  fingerprint: `f${i}`,
  calendarId: 'fixture',
  title: `[검증용] ${title}`,
  start: `2026-09-${i < 3 ? '09' : '10'}T${String(9 + i * 2).padStart(2, '0')}:00:00+09:00`,
  end: `2026-09-${i < 3 ? '09' : '10'}T${String(10 + i * 2).padStart(2, '0')}:00:00+09:00`,
  timeZone: 'Asia/Seoul',
  allDay: false,
  location: '연구실',
  notes: '실제 일정이 아닙니다.',
  alarmMinutes: 10,
  recurring: false,
  hasAttendees: false,
}));
const paper: LiveItem = {
  id: 'paper',
  kind: 'papers',
  title: '[검증용] Learning to optimize with stable gradients',
  text: 'Synthetic abstract for UI verification only.',
  source: 'UI fixture',
  sourceUrl: 'https://arxiv.org/',
  readScope: 'abstract',
  details: [],
  matchedKeywords: ['optimization', 'neural networks'],
  score: 30,
};
const weather: WeatherSeries = {
  city: '서울 · 합성 예보',
  timeZone: 'Asia/Seoul',
  localDate: '2026-09-09',
  currentTime: now,
  temperature: 24,
  code: rainScenario === 'zero' ? 3 : 63,
  wind: 8,
  hours: Array.from({ length: rainScenario ? 24 : 12 }, (_, i) => ({
    time: Date.parse(now) / 1000 + (i - (rainScenario ? 9 : 0)) * 3600,
    temperature: 22 + Math.sin(i / 4) * 6,
    apparent: 24,
    precipitation:
      rainScenario === 'zero' ? 0 : rainScenario === 'mixed' ? [0, null, 0, 25, 60, 0][i % 6]! : 60,
    code: rainScenario === 'zero' ? 3 : 63,
  })),
};
const insight = {
  id: 'paper',
  summary:
    '학습형 최적화에서 **gradient 안정성**을 다루는 합성 UI 요약입니다. 실제 논문 분석 결과가 아닙니다.',
  keywords: ['Learned optimization', 'Gradient stability', 'Adaptive step size'],
  detail:
    '### 핵심 아이디어\n목적함수의 gradient를 사용해 상태를 갱신하는 간단한 검증용 모델입니다. 학습한 보정 항과 data-consistency 항의 역할을 구분해서 설명하는 화면을 확인합니다.\n\n### 방법과 가정\n아래 첫 수식은 평균 제곱 오차, 두 번째는 gradient를 이용한 한 단계의 갱신입니다. 실제 논문의 수렴성이나 실험 성능을 주장하지 않습니다.\n\n### 결과와 한계\n수식이 정확히 읽히는지, 여러 수식이 세로로 표시되는지 확인하기 위한 합성 자료입니다. 실험 비교표나 실제 runtime 증거는 제공되지 않았습니다.',
  importance: 'high',
  researchQuestion:
    '학습형 최적화의 **gradient 안정성**을 어떻게 유지할까요? 합성 화면 검증용 질문입니다.',
  strengths: '**방법과 목적함수의 역할**을 구분해 설명합니다. 실제 성능을 주장하지 않습니다.',
  limitations: '합성 자료이므로 **실험 성능이나 일반화 결과는 없습니다**.',
  methodsAndAssumptions:
    '**미분 가능한 목적함수**와 한 단계의 gradient 갱신을 가정한 화면 검증입니다.',
  reportedResults: '수식·요약·스크롤 레이아웃만 검증하며 연구 결과를 보고하지 않습니다.',
  importanceReason: '연구 주제 연관',
  relevance: 'Optimization과 neural networks 실험 설계에 연결되는 내용을 이 위치에서 설명합니다.',
  action: '원문 확인',
  evidenceQuote: paper.text,
  equationIds: ['e-loss', 'e-step'],
  equationExplanations: [
    {
      equationId: 'e-loss',
      explanation:
        'N은 표본 수이며 각 예측 오차를 제곱해 평균합니다. 모형이 줄이려는 목적함수의 정의입니다.',
    },
    {
      equationId: 'e-step',
      explanation:
        'η는 step size이며 현재 gradient의 반대 방향으로 매개변수 θ를 갱신합니다. 수렴성은 이 식만으로 보장되지 않습니다.',
    },
  ],
  figureIds: [],
  memorySuggestion: null,
};
const native = {
  providerId: 'codex',
  model: 'UI fixture · not an LLM response',
  reasoning: 'high',
};
const summary = {
  overview: '검증용 브리핑 · 논문 자동 요약과 일정 카드를 한눈에 확인합니다.',
  items: [
    insight,
    {
      ...insight,
      id: 'paper2',
      equationIds: [],
      equationExplanations: [],
      keywords: ['Conditional models', 'FiLM'],
      importance: 'medium',
    },
    {
      ...insight,
      id: 'paper3',
      equationIds: [],
      equationExplanations: [],
      keywords: ['Uncertainty', 'Calibration'],
      importance: 'low',
    },
    {
      ...insight,
      id: 'mail',
      summary:
        '행정팀에서 **내일 오후 5시까지** 참석 여부 회신을 요청했습니다. 회의 장소가 **302호로 변경**되었습니다.',
      importance: 'high',
      importanceReason: '명시적인 **회신 기한**과 장소 변경이 있습니다.',
      action: '**내일 오후 5시까지** **참석 여부를 회신**하고 변경된 장소를 확인하세요.',
      relevance: '',
      detail: '',
      keywords: [],
      equationIds: [],
      equationExplanations: [],
    },
  ],
  evidence: [
    {
      id: 'paper',
      paper: {
        readScope: 'html-excerpt',
        excerpt: '',
        equations: [
          { id: 'e-loss', latex: 'L(\\theta)=\\frac{1}{N}\\sum_{i=1}^{N}(y_i-f_\\theta(x_i))^2' },
          { id: 'e-step', latex: '\\theta_{t+1}=\\theta_t-\\eta\\nabla_\\theta L(\\theta_t)' },
        ],
        figures: [],
        sourceUrl: 'https://arxiv.org/',
        note: '합성 수식으로 UI만 검증합니다. 실제 논문을 분석한 결과가 아닙니다.',
      },
    },
  ],
  memoryUsed: [],
  invocation: native,
  memorySave: { state: 'saved', saved: 1, revision: 1, warning: '' },
};
if (new URLSearchParams(location.search).get('tags') === 'aliases') {
  const aliases = [
    ['LLM', 'large-language-model', '대규모 언어 모델', 'Optimization', 'optimisation'],
    ['LLMs', '최적화', 'diffusion models', '확산 모델'],
    ['Diffusion models', '확산모델', 'Optimization'],
  ];
  summary.items
    .filter((i) => i.id !== 'mail')
    .forEach((i, n) => {
      i.keywords = aliases[n]!;
    });
}
if (new URLSearchParams(location.search).get('tags') === 'grid') {
  // Stress only the synthetic tag-picker layout, never the user's vocabulary/store.
  const topics = [
    'Causal inference',
    'Bayesian inference',
    'Graph neural networks',
    'Model compression',
    'Distributed learning',
    'Robust optimization',
    'Representation learning',
    'Active learning',
    'Time series',
    'Optimal transport',
    'Privacy preserving learning',
    'Multimodal reasoning',
  ];
  topics.forEach((topic, index) =>
    summary.items.push({
      ...insight,
      id: `tag-layout-${index}`,
      keywords: [
        topic,
        `Synthetic topic ${index + 1}`,
        'Long label for responsive grid layout testing',
      ],
      equationIds: [],
      equationExplanations: [],
    }),
  );
}
let fixtureJob: Record<string, unknown> | null = null;
const fixtureFeedback: Record<string, 'important' | 'not-interested'> = {};
let fixturePreferences = {
  ...defaultAssistantPreferences(),
  mailRead: true,
  mailAi: true,
  calendarRead: true,
  calendarIds: ['fixture'],
};
const stream = (result: unknown) =>
  new Response(JSON.stringify({ type: 'result', result }) + '\n', {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
window.fetch = async (input, init) => {
  const url = String(input),
    body = JSON.parse(String(init?.body || '{}'));
  const json = (data: unknown) => {
    if (url.endsWith('/history/list')) {
      const page = data as { history: BriefingHistory[] };
      fixtureHistory = page.history;
      data = {
        ...page,
        history: page.history.filter(
          (h) =>
            ![...fixtureTrash.values()].some(
              (r) =>
                r.routineId === h.routineId &&
                (r.runId ? r.runId === h.runId : r.historyId === h.id),
            ),
        ),
      };
    }
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  };
  if (url.endsWith('/history/delete')) {
    const anchor = fixtureHistory.find(
      (h) =>
        h.routineId === body.routineId &&
        (body.historyId ? h.id === body.historyId : h.runId === body.runId),
    );
    if (!anchor || body.confirmed !== true) return json({ error: '합성 브리핑 대상 없음' });
    const deletionId = crypto.randomUUID();
    const runId = anchor.runId ?? null;
    fixtureTrash.set(deletionId, {
      id: deletionId,
      routineId: anchor.routineId,
      historyId: anchor.id,
      runId,
      createdAt: anchor.createdAt,
      deletedAt: now,
      timeZone: 'Asia/Seoul',
      routineName: 'UI 검증용 · 실제 자료 아님',
    });
    return json({
      deletionId,
      routineId: anchor.routineId,
      runId,
      historyIds: fixtureHistory
        .filter(
          (h) =>
            h.routineId === anchor.routineId && (runId ? h.runId === runId : h.id === anchor.id),
        )
        .map((h) => h.id),
    });
  }
  if (url.endsWith('/history/deleted'))
    return json({
      removed: [...fixtureTrash.values()].filter((r) => r.routineId === body.routineId),
    });
  if (url.endsWith('/history/restore')) {
    const record = fixtureTrash.get(body.deletionId);
    if (!record || record.routineId !== body.routineId)
      return json({ error: '합성 삭제 기록 없음' });
    fixtureTrash.delete(record.id);
    return json({
      deletionId: record.id,
      routineId: record.routineId,
      runId: record.runId,
      historyIds: fixtureHistory
        .filter(
          (h) =>
            h.routineId === record.routineId &&
            (record.runId ? h.runId === record.runId : h.id === record.historyId),
        )
        .map((h) => h.id),
    });
  }
  if (url.endsWith('/generation/status')) return json(fixtureGeneration);
  if (url.endsWith('/generation/schedule')) {
    fixtureGeneration = {
      ...fixtureGeneration,
      intervalHours: body.intervalHours,
      nextDueAt: body.intervalHours
        ? new Date(Date.now() + body.intervalHours * 3600000).toISOString()
        : null,
    };
    return json(fixtureGeneration);
  }
  if (url.endsWith('/generation/start')) {
    fixtureGenerationCount++;
    fixtureGeneration = {
      ...fixtureGeneration,
      job: {
        id: crypto.randomUUID(),
        routineId: body.routineId,
        runId: '6c51094a-7641-41ab-80d8-32c78f1d2220',
        state: new URLSearchParams(location.search).has('generation-running')
          ? 'running'
          : 'complete',
        detail: new URLSearchParams(location.search).has('generation-running')
          ? '논문 7–10번째 요약 중'
          : '새 항목 2개 추가 완료',
        progress: { stage: 'summarize', completed: 6, total: 10 },
        newCount: 2,
        startedAt: new Date(Date.now() - 75000).toISOString(),
        updatedAt: new Date(Date.parse(now) + fixtureGenerationCount * 7200000).toISOString(),
        error: null,
      },
    };
    return json(fixtureGeneration);
  }
  if (url.endsWith('/generation/cancel')) return json(fixtureGeneration);
  if (url.endsWith('/mail/discover'))
    return json({
      limited: false,
      accounts: [
        {
          id: 'work',
          name: 'Research',
          addresses: ['research@example.test'],
          mailboxes: [
            { id: 'work-inbox', name: '받은 편지함' },
            { id: 'work-alerts', name: 'Research / Scholar alerts' },
          ],
          limited: false,
          unavailable: false,
        },
        {
          id: 'personal',
          name: 'Personal',
          addresses: ['personal@example.test'],
          mailboxes: [{ id: 'personal-inbox', name: '받은 편지함' }],
          limited: false,
          unavailable: false,
        },
        {
          id: 'offline',
          name: 'Unavailable · 검증용',
          mailboxes: [],
          limited: false,
          unavailable: true,
        },
      ],
    });
  if (url.endsWith('/mail/status'))
    return json({
      state: 'configured',
      expiresAt: null,
      approved: true,
      mailRead: true,
      mailAi: false,
    });
  if (url.endsWith('/papers/shared/save')) {
    if (body.confirmed !== true) return json({ error: 'confirmation_required' });
    const alreadySaved = savedChatPapers.length > 0;
    if (!alreadySaved)
      savedChatPapers.push({
        ...body.candidate,
        id: 'd'.repeat(64),
        savedAt: now,
        origin: 'Briefing Lab',
      });
    return json({ id: savedChatPapers[0]!.id, savedAt: now, alreadySaved });
  }
  if (url.endsWith('/assistant/chat') && paperSaveScenario)
    return stream({
      answer:
        '# 검증용 논문 분석\n\n## 연구 질문\n반복 최적화의 안정성을 검토합니다.\n\n## 강점\n가정과 결과를 구분합니다.\n\n## 약점과 한계\n실험 결과가 없는 합성 자료입니다.\n\n## 방법과 가정\n미분 가능한 목적함수를 가정합니다.\n\n## 보고된 결과\n실제 성능 주장은 없습니다.\n\n<!-- gosu-paper-save-offer -->',
      events: [],
      tasks: [],
      sources: [],
      invocation: native,
      writesPerformed: 0,
    });
  if (emptyWorkspaceScenario && (url.endsWith('/history/list') || url.endsWith('/papers/saved')))
    return json({ history: [], papers: [], feedback: {} });
  if (url.endsWith('/session')) return json({ token: 'fixture', clientToken: 'a'.repeat(64) });
  if (url.endsWith('/mail/open')) return json({ status: 'requested' }); // Synthetic: never launches Mail.
  if (url.endsWith('/models'))
    return json({
      providers: [
        {
          providerId: 'codex',
          catalog: createCodexModelCatalog([
            { id: 'fixture', model: 'fixture', displayName: 'UI fixture', isDefault: true },
            {
              id: 'fixture-fast',
              model: 'fixture-fast',
              displayName: 'UI Fast model',
              isDefault: false,
              supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }],
            },
          ]),
          error: null,
        },
      ],
    });
  if (url.endsWith('/assistant/conversation/get'))
    return json({
      messages: [
        {
          role: 'user',
          text: '[검증용] 업데이트 전 질문을 기억해줘.',
          createdAt: '2026-09-13T00:00:00Z',
        },
        {
          role: 'assistant',
          text: '[검증용] 저장된 대화를 복원했습니다. 다음 질문에서 이어갈 수 있습니다.',
          createdAt: '2026-09-13T00:00:01Z',
          invocation: { providerId: 'codex', model: 'fixture', reasoning: 'high' },
        },
      ],
    });
  if (url.endsWith('/assistant/settings/get'))
    return json({ preferences: fixturePreferences, approved: true });
  if (url.endsWith('/assistant/model/save')) {
    fixturePreferences = { ...fixturePreferences, ...body.selection };
    return json({ saved: true, selection: body.selection });
  }
  if (url.endsWith('/collect'))
    return stream([
      {
        kind: 'weather',
        status: 'ready',
        fetchedAt: now,
        receiptId: '6c51094a-7641-41ab-80d8-32c78f1d2222',
        items: [
          {
            id: 'w',
            kind: 'weather',
            title: 'Weather fixture',
            source: 'fixture',
            readScope: 'forecast',
            text: '',
            details: [],
            weather,
          },
        ],
        note: 'Synthetic forecast',
      },
      {
        kind: 'papers',
        status: 'ready',
        fetchedAt: now,
        receiptId: '6c51094a-7641-41ab-80d8-32c78f1d2222',
        items: [
          paper,
          {
            ...paper,
            id: 'paper2',
            ...(scholarScenario
              ? { discoverySource: 'google-scholar-alert', privateOrigin: 'mail' }
              : {}),
            title: '[검증용] Feature-wise conditioning for neural optimization',
          },
          {
            ...paper,
            id: 'paper3',
            title: '[검증용] Uncertainty calibration in structured prediction',
          },
        ],
        note: 'Synthetic paper',
      },
      {
        kind: 'email',
        status: 'ready',
        fetchedAt: now,
        receiptId: '6c51094a-7641-41ab-80d8-32c78f1d2222',
        items: [
          {
            id: 'mail',
            kind: 'email',
            title: mailLayoutStress ? longMailTitle : '[검증용] 내일 미팅 참석 여부 회신 요청',
            mailAccount: fixtureMailAccounts[0],
            mailUnread: true,
            publishedAt: fixtureReceivedAt,
            mailMessageUrl: 'message://%3Cfixture-no-real-message%40example.test%3E',
            text: 'Synthetic email, no account read.',
            source: 'Apple Mail · 합성 자료',
            readScope: 'mail-preview',
            details: [],
          },
        ],
        note: '실제 메일을 읽지 않는 UI 검증입니다.',
        ...(onboardingScenario ? { notice: onboardingNotice } : {}),
      },
    ]);
  if (url.endsWith('/auto-analyze'))
    return stream({
      ...summary,
      items: summary.items.filter((i) =>
        body.kind === 'email' ? i.id === 'mail' : i.id !== 'mail',
      ),
    });
  if (url.endsWith('/auto-summary/start')) {
    if (fixtureJob && !body.force) return json(fixtureJob);
    fixtureJob = {
      id: '6c51094a-7641-41ab-80d8-32c78f1d3333',
      routineId: 'fixture',
      receiptId: '6c51094a-7641-41ab-80d8-32c78f1d2222',
      state: 'running',
      percent: 0,
      completed: 0,
      total: 4,
      kind: 'email',
      range: '1/1',
      detail: '이메일 요약 준비 중',
      results: [],
      error: null,
      updatedAt: Date.now(),
    };
    return json(fixtureJob);
  }
  if (url.endsWith('/auto-summary/status')) {
    const cacheFor = (kind: 'email' | 'papers') => {
      if (cacheMode !== 'all' && cacheMode !== 'mixed') return {};
      const ids = summary.items
        .filter((item) => (kind === 'email' ? item.id === 'mail' : item.id !== 'mail'))
        .map((item) => item.id);
      const reuse = cacheMode === 'all' || kind === 'email';
      return {
        cache: {
          feedbackProfileRevision: 7,
          reusedItemIds: reuse ? ids : [],
          generatedItemIds: reuse ? [] : ids,
        },
      };
    };
    const emailResult = {
      ...summary,
      ...cacheFor('email'),
      items: summary.items.filter((item) => item.id === 'mail'),
      kind: 'email',
    };
    const paperResult = {
      ...summary,
      ...cacheFor('papers'),
      items: summary.items.filter((item) => item.id !== 'mail'),
      kind: 'papers',
    };
    fixtureJob = {
      ...(fixtureJob ?? {}),
      state: 'complete',
      percent: 100,
      completed: 4,
      total: 4,
      kind: 'done',
      range: '4/4',
      detail: '이메일 요약 후 논문 요약까지 완료',
      results: [emailResult, paperResult],
      updatedAt: Date.now(),
    };
    return json(fixtureJob);
  }
  if (url.endsWith('/auto-summary/cancel')) {
    fixtureJob = {
      ...(fixtureJob ?? {}),
      state: 'cancelled',
      detail: '사용자가 요약을 중단했습니다.',
    };
    return json(fixtureJob);
  }
  if (url.endsWith('/assistant/chat'))
    return stream({
      contextUsage: {
        windowTokens: 828400,
        windowSource: 'configured',
        estimatedInputTokens: 9000,
        outputReserveTokens: 99408,
        toolReserveTokens: 124260,
        totalMessages: 2,
        includedMessages: 2,
        compressedMessages: 0,
        omittedMessages: 0,
        native: {
          inputTokens: 7286,
          outputTokens: 15,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 7301,
          contextTokens: 7301,
          contextWindowTokens: 828400,
        },
      },
      ...(new URLSearchParams(location.search).has('settings-proposal')
        ? { settingsProposal: { mailDays: 10, mailLimit: 100 } }
        : {}),
      answer:
        `[검증용] 미팅 참석 여부 회신 요청과 ${paper.title}, [검증용] 연구 지원 소식을 확인하세요.\n\n` +
        Array.from(
          { length: 9 },
          (_, i) =>
            `### ${i + 1}. 검증용 브리핑 대화\n이 답변은 스크롤과 수식 렌더링을 확인하는 합성 데이터입니다. $L=\\frac{1}{N}\\sum_i (y_i-\\hat y_i)^2$`,
        ).join('\n\n'),
      events: [
        {
          title: '검증용 연구 리뷰',
          start: events[0]!.start,
          end: events[0]!.end,
          allDay: false,
          timeZone: 'Asia/Seoul',
          location: '연구실',
          notes: '',
          alarmMinutes: 10,
          sourceId: 'paper',
          evidence: 'UI fixture',
          reason: '미팅 전에 **검토할 논문 준비**가 필요하다는 합성 제안입니다.',
        },
      ],
      tasks: [
        {
          title: '논문 검토',
          description: 'GOSU 연동용 초안 화면 검증',
          deadline: null,
          target: 'kanban',
          sourceId: 'paper',
        },
      ],
      sources: [
        { id: 'paper', title: paper.title, url: paper.sourceUrl, kind: 'paper' },
        {
          id: 'mail',
          title: mailLayoutStress ? longMailTitle : '[검증용] 미팅 참석 여부 회신 요청',
          kind: 'email',
          mailAccount: fixtureMailAccounts[0],
          receivedAt: fixtureReceivedAt,
        },
        { id: 'news', title: '[검증용] 연구 지원 소식', kind: 'news' },
      ],
      invocation: {
        ...native,
        model: fixturePreferences.modelId || native.model,
        reasoning: fixturePreferences.reasoning || native.reasoning,
      },
      writesPerformed: 0,
    });
  if (url.endsWith('/calendar/catalog') || url.endsWith('/calendar/authorize'))
    return json({
      calendars: [
        {
          id: 'fixture',
          name: 'UI 검증용 Calendar',
          source: 'Synthetic · no account access',
          writable: true,
          color: '#527d0b',
        },
      ],
    });
  if (
    url.endsWith('/calendar/events') &&
    new URLSearchParams(location.search).has('calendar-density')
  ) {
    const base = Date.parse(body.start);
    return json({
      limited: false,
      events: [1, 0, 4, 0, 2, 14].flatMap((count, week) =>
        Array.from({ length: count }, (_, i) => {
          const start = base + (week * 7 + 5) * 86400000 + (8 + (i % 10)) * 3600000;
          return {
            ...events[0],
            id: `dense-${week}-${i}`,
            fingerprint: `f-${week}-${i}`,
            title: `[검증용] ${i === 0 ? '종일 행사' : `연구 일정 ${i}`}`,
            start: new Date(start).toISOString(),
            end: new Date(start + (i === 0 ? 86400000 : 3600000)).toISOString(),
            allDay: i === 0,
          };
        }),
      ),
    });
  }
  if (url.endsWith('/calendar/events') || url.endsWith('/calendar/agenda'))
    return json({ events, limited: false, referenceAt: now });
  if (url.endsWith('/calendar/prepare'))
    return json({ action: { id: 'fixture-only', kind: body.kind } });
  if (url.endsWith('/calendar/apply')) return json({ id: 'fixture-only' });
  if (url.endsWith('/memory/status'))
    return json({ state: 'ready', count: 1, automatic: 1, revision: 1, lastSavedAt: now });
  if (url.endsWith('/history/feedback') || url.endsWith('/memory/feedback')) {
    fixtureFeedback[body.itemId] = body.decision;
    return json({ decision: body.decision, feedbackProfileRevision: 1 });
  }
  if (url.endsWith('/memory/feedback/choices')) return json({ choices: fixtureFeedback });
  if (url.endsWith('/mail/mark-read'))
    return json(
      uncertainMark
        ? {
            status: 'unconfirmed',
            error:
              '읽음 처리 결과를 아직 확인하지 못했습니다. 이미 반영됐을 수 있습니다. 옆의 상태 확인 버튼으로 다시 확인해주세요.',
          }
        : { status: 'read', markedAt: '2026-09-10T05:00:00Z' },
    );
  if (url.endsWith('/mail/read-status'))
    return json({ status: 'read', markedAt: '2026-09-10T05:00:00Z' });
  if (url.endsWith('/papers/classify') || url.endsWith('/papers/classification/edit')) {
    const manual = url.endsWith('/edit');
    const targets = manual ? [body.target] : body.targets;
    const saved: string[] = [];
    for (const t of targets as { key: string; expectedRevision: number }[]) {
      const current = fixtureClassifications.get(t.key);
      if (!manual && current?.source === 'user') continue;
      fixtureClassifications.set(t.key, {
        taxonomyVersion: 1,
        categoryId: manual ? (body.categoryId as PaperCategory) : 'statistics',
        source: manual ? 'user' : 'ai',
        reason: '저장된 요약의 주요 연구 질문과 추정 방법을 기준으로 분류했습니다.',
        classifiedAt: '2026-09-10T13:00:00Z',
        revision: (current?.revision ?? 0) + 1,
        summaryDigest: 'a'.repeat(64),
      });
      saved.push(t.key);
    }
    return json({ saved, skipped: targets.length - saved.length });
  }
  if (url.endsWith('/papers/saved'))
    return json({
      feedback: fixtureFeedback,
      papers: [
        ...savedChatPapers.map(sharedPaperView),
        ...summary.items
          .filter((i) => i.id !== 'mail')
          .map((i, index) => ({
            historyId: `papers-${index}`,
            classificationKey: fixtureClassificationKey(index),
            savedAt: '2026-09-08T00:00:00Z',
            item: {
              ...i,
              title: `${paper.title} · ${i.id}`,
              kind: 'papers',
              classification: fixtureClassifications.get(fixtureClassificationKey(index)),
              ...(index < 2 ? { paperPublishedAt: `2026-09-0${6 + index}T00:00:00.000Z` } : {}),
              ...(scholarScenario && i.id === 'paper2'
                ? { discoverySource: 'google-scholar-alert' }
                : {}),
              readScope: 'abstract',
              sourceUrl: paper.sourceUrl,
              equations: [{ latex: 'x^2', explanation: '검증용 저장 수식' }],
              provenance: {
                version: 1,
                sourceDigest: 'a'.repeat(64),
                contextDigest: 'b'.repeat(64),
                summarizedAt:
                  fixtureRefreshes.get(`papers-${index}:${i.id}`) ?? '2026-09-08T00:00:00Z',
                reused: true,
                reuseBasis: 'paper-version',
                personalizationStale: index === 1,
              },
            },
          })),
      ],
    });
  if (url.endsWith('/summary/refresh')) {
    fixtureRefreshes.set(`${body.historyId}:${body.itemId}`, '2026-09-09T07:30:00.000Z');
    return new Response(
      `${JSON.stringify({ type: 'result', result: { ...summary, historyId: body.historyId, items: summary.items.filter((i) => i.id === body.itemId) } })}\n`,
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  }
  if (url.endsWith('/history/list'))
    return json({
      feedback: fixtureFeedback,
      history: [0, 1].flatMap((dayOffset) => {
        const at = new Date(Date.parse(now) - dayOffset * 86400000).toISOString();
        const runId = `6c51094a-7641-41ab-80d8-32c78f1d222${dayOffset}`;
        const base = {
          routineId: body.routineId,
          runId,
          createdAt: at,
          kind: 'briefing',
          private: false,
        };
        const items = summary.items.map((item) => ({
          ...item,
          title:
            item.id === 'mail'
              ? mailLayoutStress
                ? longMailTitle
                : '[검증용] 미팅 참석 여부 회신 요청'
              : `${paper.title} · ${item.id}`,
          kind: item.id === 'mail' ? 'email' : 'papers',
          ...(scholarScenario && item.id === 'paper2'
            ? { discoverySource: 'google-scholar-alert' }
            : {}),
          ...(item.id === 'mail'
            ? {
                id: dayOffset ? 'mail-personal' : 'mail',
                mailAccount: fixtureMailAccounts[dayOffset],
                mailUnread: dayOffset === 0,
                receivedAt: new Date(
                  Date.parse(fixtureReceivedAt) - dayOffset * 86400000,
                ).toISOString(),
              }
            : {}),
          ...(item.id === 'mail' && !dayOffset
            ? { mailMessageUrl: 'message://%3Cfixture-no-real-message%40example.test%3E' }
            : {}),
          readScope: item.id === 'mail' ? 'mail-preview' : 'abstract',
          ...(item.id !== 'mail'
            ? {
                paperPublishedAt: '2026-09-06T00:00:00Z',
                bibliography: {
                  authors: ['A. Researcher', 'B. Scientist'],
                  source: 'arXiv',
                  venue: 'Fixture Conference Proceedings 2026',
                },
              }
            : {}),
          provenance: {
            version: 1,
            sourceDigest: 'a'.repeat(64),
            contextDigest: 'b'.repeat(64),
            summarizedAt:
              fixtureRefreshes.get(
                `${item.id === 'mail' ? 'email' : 'papers'}-${dayOffset}:${item.id === 'mail' && dayOffset ? 'mail-personal' : item.id}`,
              ) ?? new Date(Date.parse(at) - 86400000).toISOString(),
            reused: !fixtureRefreshes.has(
              `${item.id === 'mail' ? 'email' : 'papers'}-${dayOffset}:${item.id === 'mail' && dayOffset ? 'mail-personal' : item.id}`,
            ),
          },
          equations:
            item.id === 'paper'
              ? summary.evidence[0]!.paper.equations.map((eq) => ({
                  latex: eq.latex,
                  explanation: '화면 검증용 수식',
                }))
              : [],
        }));
        if (!dayOffset && fixtureGenerationCount)
          for (let n = 1; n <= fixtureGenerationCount; n++) {
            for (const kind of ['email', 'papers']) {
              const source = items.find((i) => i.kind === kind)!;
              const addedAt = new Date(Date.parse(now) + n * 7200000).toISOString();
              items.push({
                ...source,
                id: `${kind}-new-${n}`,
                title: `[검증용] ${n}차 업데이트 · ${kind === 'email' ? '새 연구 메일' : '새 논문 요약'}`,
                addedAt,
                provenance: { ...source.provenance, summarizedAt: addedAt },
              } as typeof source);
            }
          }
        return [
          {
            ...base,
            id: `snapshot-${dayOffset}`,
            answer: '',
            items: [],
            snapshot: {
              collectedAt: at,
              ...(!dayOffset && fixtureGenerationCount
                ? { daily: { date: at.slice(0, 10), updatedAt: fixtureGeneration.job!.updatedAt } }
                : {}),
              routineName: 'UI 검증용 · 실제 자료 아님',
              timeZone: 'Asia/Seoul',
              weather: {
                ...weather,
                currentTime: at,
                localDate: at.slice(0, 10),
                hours: weather.hours.map((h) => ({ ...h, time: h.time - dayOffset * 86400 })),
              },
              calendar: events.slice(0, 3),
              ...(new URLSearchParams(location.search).has('todos')
                ? {
                    todos: {
                      fetchedAt: at,
                      limited: false,
                      items: [
                        {
                          id: 'todo1',
                          title: '[검증용] 연구 초안 검토',
                          projectName: '연구 프로젝트',
                          status: 'in_progress',
                          dueDate: '2026-09-09',
                        },
                        {
                          id: 'todo2',
                          title: '[검증용] 미팅 자료 준비',
                          projectName: '공동 연구',
                          status: 'planned',
                          dueDate: '2026-09-10',
                        },
                      ],
                    },
                  }
                : {}),
              ...(new URLSearchParams(location.search).has('new-papers-only') && !dayOffset
                ? { visiblePaperKeys: [] }
                : {}),
              sources: [
                { kind: 'weather', status: 'ready', count: 1 },
                {
                  kind: 'email',
                  status: 'ready',
                  count: 1,
                  ...(onboardingScenario && !dayOffset ? { notice: onboardingNotice } : {}),
                },
                new URLSearchParams(location.search).has('new-papers-only') && !dayOffset
                  ? {
                      kind: 'papers',
                      status: 'empty',
                      count: 0,
                      notice:
                        '이번 조회 범위에 새 논문이 없습니다. 이전 논문은 보관함에서 볼 수 있습니다.',
                    }
                  : { kind: 'papers', status: 'ready', count: 3 },
              ],
            },
          },
          {
            ...base,
            id: `email-${dayOffset}`,
            answer: `[검증용] ${dayOffset ? '이전' : '최신'} 브리핑 · 참석 여부 회신과 일정 확인이 우선입니다.`,
            items: items.filter((i) => i.kind === 'email'),
          },
          {
            ...base,
            id: `papers-${dayOffset}`,
            answer: '[검증용] 연구 관심사에 따른 논문 검토 요약입니다.',
            items: items.filter((i) => i.kind === 'papers'),
          },
        ];
      }),
    });
  if (url.endsWith('/assistant/settings/save')) return json({ saved: true });
  return json({ history: [] });
};
function Fixture() {
  if (new URLSearchParams(location.search).get('embedded') === 'gosu')
    document.documentElement.dataset.gosuEmbedded = 'true';
  const [workspace, setWorkspace] = useState(() => {
    if (emptyWorkspaceScenario) return initialRealWorkspace(now);
    const w = initialWorkspace(now);
    w.routines[0] = {
      ...w.routines[0]!,
      name: 'UI 검증용 · 실제 자료 아님',
      live: {
        ...defaultLiveSettings(),
        assistant: fixturePreferences,
        ...(mailSettingsScenario
          ? {
              mail: {
                accountId: 'work',
                mailboxId: 'work-inbox',
                accountName: 'Research · research@example.test',
                mailboxName: '받은 편지함',
                days: 3,
                limit: onboardingScenario ? 50 : 10,
                subject: '',
                sender: '',
                unreadOnly: false,
                bodyPreview: true,
              },
            }
          : {}),
      },
    };
    return w;
  });
  return <BriefingApp workspace={workspace} onChange={setWorkspace} onRun={() => undefined} />;
}
mountBriefingRoot(document.getElementById('root')!, <Fixture />, import.meta.hot?.data);
