import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { BriefingGeneration } from './briefing-generation';
import { BriefingGenerationStore } from './briefing-generation-store';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveSourceService } from './live-source-service';
import { AppleMailConnection, type runAppleMail } from './live-mail';
import { CalendarService } from './calendar-service';
import type { runCalendarNative } from './calendar-native';
import { BriefingMemoryStore } from './briefing-memory-store';
import type { analyzeBriefing } from './briefing-analysis';
import type { assistantModel } from './briefing-assistant';
import type { LiveItem } from './src/live-types';
import { mailSummaryKey } from './briefing-mail-ingestion';
import { BriefingHistoryFeed, groupBriefingHistory } from './src/briefing-history-view';
vi.mock('./briefing-paper-evidence', () => ({
  enrichPaper: vi.fn(async (item: LiveItem) => item),
  loadPaperFigure: vi.fn(async () => {
    throw Error('Unexpected figure fetch');
  }),
}));
const dirs: string[] = [];
const owner = <T>(fn: () => T) => briefingClientContext.run('e'.repeat(64), fn);
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

// Exercise the production collect -> Calendar -> analyze -> encrypted history -> renderer path.
// Only external native/provider boundaries are fixtures; do not mock generateDaily/saveBriefing.
async function sourceFixture(
  options: {
    noCity?: boolean;
    mailRead?: boolean;
    mailAi?: boolean;
    calendarRead?: boolean;
    failedSource?: 'weather' | 'calendar' | 'email' | 'papers';
  } = {},
) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-12T00:00:00.000Z'));
  const network = vi.fn(async () => {
    throw Error('Tests must not access network');
  });
  vi.stubGlobal('fetch', network);
  const dir = await mkdtemp(join(tmpdir(), 'briefing-four-sources-'));
  dirs.push(dir);
  const key = async () => Buffer.alloc(32, 9);
  const workspace = new BriefingWorkspaceStore(dir, key);
  const nativeMessages = [
    {
      id: '1',
      title: 'Fixture email',
      sender: 'Sender <sender@example.test>',
      date: new Date().toISOString(),
      unread: true,
      preview: 'Please reply before Friday.',
      bodyUnavailable: false,
    },
  ];
  const mailNative = vi.fn<typeof runAppleMail>(async (request) => {
    if (request.action === 'discover')
      return {
        limited: false,
        accounts: [
          {
            id: 'native-account',
            name: 'Fixture account',
            mailboxes: [{ path: ['Inbox'], name: 'Inbox' }],
            limited: false,
            unavailable: false,
          },
        ],
      };
    if (request.action !== 'read') throw Error('Unexpected Mail mutation');
    if (options.failedSource === 'email') throw Error('mail_read_timeout');
    const messages = nativeMessages.filter(
      (m) =>
        !request.excludeKeys?.includes(
          mailSummaryKey(
            createHash('sha256')
              .update(JSON.stringify([request.accountId, request.path, m.id]))
              .digest('hex'),
            m.date,
            m.title,
          ),
        ),
    );
    return {
      account: {
        id: 'native-account',
        name: 'Fixture account',
        addresses: ['reader@example.test'],
      },
      messages,
      scanned: nativeMessages.length,
      capped: false,
      skipped: nativeMessages.length - messages.length,
    };
  });
  const mail = new AppleMailConnection(mailNative);
  const account = (await mail.discover(new AbortController().signal)).accounts[0]!;
  mailNative.mockClear();
  const nativeEvent = {
    nativeId: 'fixture-event',
    modifiedAt: new Date().toISOString(),
    calendarId: 'fixture-calendar',
    title: 'Fixture meeting',
    start: '2026-09-12T01:00:00Z',
    end: '2026-09-12T02:00:00Z',
    allDay: false,
    timeZone: 'Asia/Seoul',
    location: 'Room A',
    notes: '',
    alarmMinutes: 10,
    recurring: false,
    hasAttendees: false,
  };
  const calendarNative = vi.fn<typeof runCalendarNative>(async (request) => {
    expect(request).toMatchObject({ action: 'events' });
    if (options.failedSource === 'calendar') throw Error('calendar_permission_required');
    return { events: [nativeEvent], limited: false };
  });
  const paper: LiveItem = {
    id: '2609.00001',
    kind: 'papers',
    title: 'Fixture paper',
    text: 'A controlled experiment improves accuracy.',
    source: 'arXiv',
    sourceUrl: 'https://arxiv.org/abs/2609.00001v1',
    readScope: 'abstract',
    details: [],
    publishedAt: new Date().toISOString(),
    bibliography: { authors: ['Fixture Author'], venue: 'Fixture Journal', source: 'arXiv' },
  };
  const weather: LiveItem = {
    id: 'forecast',
    kind: 'weather',
    title: 'Fixture forecast',
    text: '',
    source: 'Fixture',
    readScope: 'forecast',
    details: [],
    weather: {
      city: 'Fixture city',
      timeZone: 'Asia/Seoul',
      localDate: '2026-09-12',
      currentTime: new Date().toISOString(),
      temperature: 21,
      code: 1,
      wind: 2,
      hours: [0, 20, 60].map((precipitation, index) => ({
        time: Date.now() + index * 3600000,
        temperature: 21 + index,
        apparent: 21 + index,
        precipitation,
        code: 1,
      })),
    },
  };
  const providers = {
    cities: vi.fn(async () => []),
    weather: vi.fn(async () => {
      if (options.failedSource === 'weather') throw Error('weather_timeout');
      return [weather];
    }),
    papers: vi.fn(async () => {
      if (options.failedSource === 'papers') throw Error('paper_request_failed');
      return [paper];
    }),
  };
  const preferences = {
    ...defaultAssistantPreferences(),
    mailRead: options.mailRead ?? true,
    mailAi: options.mailAi ?? true,
    calendarRead: options.calendarRead ?? true,
    calendarIds: ['fixture-calendar'],
  };
  const profile = await owner(() =>
    workspace.save(
      {
        routineId: 'four',
        name: 'Four source fixture',
        timeZone: 'Asia/Seoul',
        live: {
          ...defaultLiveSettings(),
          weather: options.noCity
            ? null
            : {
                id: 1,
                name: 'Fixture city',
                latitude: 37,
                longitude: 127,
                country: 'KR',
                timeZone: 'Asia/Seoul',
              },
          mail: {
            accountId: account.id,
            mailboxId: account.mailboxes[0]!.id,
            days: 3,
            limit: 50,
            subject: '',
            sender: '',
            unreadOnly: false,
            bodyPreview: true,
          },
          papers: { ...defaultLiveSettings().papers, scholarAlerts: false },
        },
        interest: { keywords: [], excluded: [] },
        preferences,
      },
      async () => undefined,
    ),
  );
  const analyzer = vi.fn<typeof analyzeBriefing>(async (_input, items) => ({
    overview: 'Fixture overview',
    invocation: { providerId: 'codex', model: 'fixture-model', reasoning: null },
    memoryUsed: [],
    items: items.map((item) => ({
      id: item.id,
      summary:
        item.kind === 'email'
          ? 'Reply to the invitation before Friday.'
          : 'The controlled experiment reports improved accuracy.',
      importance: 'high' as const,
      importanceReason: 'Source evidence',
      relevance: '',
      action: 'Review source',
      evidenceQuote: item.text,
      researchQuestion: 'Fixture question',
      strengths: 'Fixture strength',
      limitations: 'Fixture limitation',
      methodsAndAssumptions: 'Fixture method',
      reportedResults: 'Fixture result',
      equationIds: [],
      figureIds: [],
      memorySuggestion: null,
    })),
  }));
  const service = new LiveSourceService(
    mail,
    providers,
    async () => undefined,
    analyzer,
    new BriefingMemoryStore(dir, key),
    workspace,
    new CalendarService(calendarNative),
    async () => ({ modelId: 'fixture-model' }) as Awaited<ReturnType<typeof assistantModel>>,
  );
  const engine = service.enableGeneration(new BriefingGenerationStore(dir, key), false);
  const run = async () => {
    await owner(() => engine.start('four'));
    await engine.wait('four');
    expect(network).not.toHaveBeenCalled();
    return (await owner(() => engine.status('four'))).job!;
  };
  return {
    dir,
    key,
    workspace,
    profile,
    engine,
    service,
    run,
    providers,
    analyzer,
    mailNative,
    calendarNative,
    nativeMessages,
    paper,
    weather,
    nativeEvent,
  };
}

it('generates all four sources into one durable briefing with real summaries and renderable weather/agenda', async () => {
  const f = await sourceFixture();
  try {
    expect(await f.run()).toMatchObject({
      state: 'complete',
      error: null,
      newCount: 2,
      addedSummaries: { email: 1, papers: 1 },
    });
    expect(f.providers.weather).toHaveBeenCalledOnce();
    expect(f.providers.papers).toHaveBeenCalledOnce();
    expect(f.calendarNative).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'events',
        calendarIds: ['fixture-calendar'],
        start: '2026-09-11T15:00:00Z',
        end: '2026-09-13T15:00:00Z',
      }),
      expect.any(AbortSignal),
    );
    expect(f.mailNative.mock.calls.filter(([q]) => q.action === 'read')).toHaveLength(1);
    expect(f.analyzer).toHaveBeenCalledTimes(2);
    expect(f.analyzer.mock.calls.flatMap(([, items]) => items.map((i) => i.kind)).sort()).toEqual([
      'email',
      'papers',
    ]);
    const reopened = new BriefingWorkspaceStore(f.dir, f.key);
    const notices = await reopened.desktopNotificationData();
    expect(notices.briefings).toHaveLength(1);
    expect(notices.briefings[0]).toMatchObject({
      newEmails: 1,
      importantEmails: 1,
      unclassifiedEmails: 0,
      newPapers: 1,
      partial: false,
    });
    expect(JSON.stringify(notices.briefings)).not.toContain('Fixture email');
    const completed = (await owner(() => f.engine.status('four'))).job!;
    await owner(() =>
      f.workspace.recordBriefingNotification(f.profile, completed, new AbortController().signal),
    );
    expect((await reopened.desktopNotificationData()).briefings).toHaveLength(1);
    const history = await reopened.history('four');
    const groups = groupBriefingHistory(history);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.snapshot?.weather).toEqual(f.weather.weather);
    expect(groups[0]!.snapshot?.sources).toHaveLength(3);
    for (const kind of ['weather', 'email', 'papers'])
      expect(groups[0]!.snapshot?.sources).toContainEqual(
        expect.objectContaining({ kind, status: 'ready', count: 1 }),
      );
    expect(groups[0]!.snapshot?.calendar?.[0]).toMatchObject({
      title: 'Fixture meeting',
      start: f.nativeEvent.start,
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(groups[0]!.items.find((i) => i.kind === 'email')).toMatchObject({
      summary: 'Reply to the invitation before Friday.',
      mailAccount: { addresses: ['reader@example.test'] },
      receivedAt: f.nativeMessages[0]!.date,
    });
    expect(groups[0]!.items.find((i) => i.kind === 'papers')).toMatchObject({
      researchQuestion: 'Fixture question',
      strengths: 'Fixture strength',
      limitations: 'Fixture limitation',
      methodsAndAssumptions: 'Fixture method',
      reportedResults: 'Fixture result',
    });
    const html = renderToStaticMarkup(createElement(BriefingHistoryFeed, { history }));
    expect(html).toContain('시간별 기온과 강수확률 예보. 3개 시간대.');
    expect(html).toContain('weather-precipitation-bar is-zero');
    expect(html).toContain('강수확률 0%');
    for (const text of [
      'Fixture city',
      'Fixture meeting',
      'Fixture email',
      'Fixture paper',
      '21',
      'Reply to the invitation before Friday.',
      'Fixture method',
    ])
      expect(html).toContain(text);
    const encrypted = await readFile(join(f.dir, 'workspace.v1.enc.json'), 'utf8');
    expect(encrypted).not.toContain('Fixture email');
    expect(encrypted).not.toContain('reader@example.test');
  } finally {
    f.service.close();
  }
});
it('reads notification counts and only approved calendar metadata without another Mail/LLM call', async () => {
  const f = await sourceFixture();
  try {
    await f.run();
    const mailCalls = f.mailNative.mock.calls.length,
      modelCalls = f.analyzer.mock.calls.length;
    const one = await f.service.notificationSnapshot();
    expect(one.briefings[0]?.newEmails).toBe(1);
    expect(one.calendar[0]).toMatchObject({ routineId: 'four', title: 'Fixture meeting' });
    expect(JSON.stringify(one.calendar)).not.toContain('notes');
    const calendarCalls = f.calendarNative.mock.calls.length;
    await f.service.notificationSnapshot();
    expect(f.calendarNative).toHaveBeenCalledTimes(calendarCalls);
    expect(f.mailNative).toHaveBeenCalledTimes(mailCalls);
    expect(f.analyzer).toHaveBeenCalledTimes(modelCalls);
  } finally {
    f.service.close();
  }
});
it('counts newly read but unanalyzed mail as unclassified, not as no new mail', async () => {
  const f = await sourceFixture({ mailAi: false });
  try {
    await f.run();
    expect((await f.workspace.desktopNotificationData()).briefings[0]).toMatchObject({
      newEmails: 1,
      importantEmails: 0,
      unclassifiedEmails: 1,
    });
    expect(
      f.analyzer.mock.calls.flatMap(([, items]) => items).some((item) => item.kind === 'email'),
    ).toBe(false);
  } finally {
    f.service.close();
  }
});
it('does not recount prior emails on an empty refresh, even if the clock has not advanced', async () => {
  const f = await sourceFixture();
  try {
    await f.run();
    await f.run();
    const events = (await f.workspace.desktopNotificationData()).briefings;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ newEmails: 1, importantEmails: 1 });
    expect(events[1]).toMatchObject({
      newEmails: 0,
      importantEmails: 0,
      unclassifiedEmails: 0,
      newPapers: 0,
    });
  } finally {
    f.service.close();
  }
});
it('does not perform background calendar reads for per-request approval scopes', async () => {
  const f = await sourceFixture();
  try {
    await owner(() =>
      f.workspace.save(
        { ...f.profile, preferences: { ...f.profile.preferences, confirmationPolicy: 'ask' } },
        async () => undefined,
      ),
    );
    const count = f.calendarNative.mock.calls.length;
    const snapshot = await f.service.notificationSnapshot();
    expect(snapshot.calendarState).toBe('confirmation-required');
    expect(snapshot.calendar).toEqual([]);
    expect(f.calendarNative).toHaveBeenCalledTimes(count);
  } finally {
    f.service.close();
  }
});

it('keeps first daily weather/calendar, avoids duplicate summaries, and appends fresh email/paper on the next briefing', async () => {
  const f = await sourceFixture();
  try {
    await f.run();
    vi.setSystemTime(new Date('2026-09-12T01:00:00Z'));
    expect(await f.run()).toMatchObject({ newCount: 0, error: null });
    expect(f.analyzer).toHaveBeenCalledTimes(2);
    f.nativeMessages.push({
      ...f.nativeMessages[0]!,
      id: '2',
      title: 'Second email',
      date: new Date().toISOString(),
    });
    f.providers.papers.mockResolvedValue([
      f.paper,
      {
        ...f.paper,
        id: '2609.00002',
        title: 'Second paper',
        sourceUrl: 'https://arxiv.org/abs/2609.00002v1',
      },
    ]);
    expect(await f.run()).toMatchObject({ newCount: 2, addedSummaries: { email: 1, papers: 1 } });
    expect(f.providers.weather).toHaveBeenCalledOnce();
    expect(f.calendarNative).toHaveBeenCalledOnce();
    const history = await f.workspace.history('four');
    expect(history.flatMap((h) => h.items.map((i) => i.title)).sort()).toEqual([
      'Fixture email',
      'Fixture paper',
      'Second email',
      'Second paper',
    ]);
    const groups = groupBriefingHistory(history);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.title).sort()).toEqual([
      'Fixture email',
      'Fixture paper',
      'Second email',
      'Second paper',
    ]);
    // Same-day saved papers stay visible once, without being summarized again.
    expect(f.analyzer).toHaveBeenCalledTimes(4);
  } finally {
    f.service.close();
  }
});

it('keeps the first saved paper visible after arXiv rate limiting on the second generation, without reanalysis', async () => {
  const f = await sourceFixture();
  try {
    await f.run();
    const first = groupBriefingHistory(await f.workspace.history('four'))[0]!.items.find(
      (i) => i.kind === 'papers',
    )!;
    vi.setSystemTime(new Date('2026-09-12T01:00:00Z'));
    f.providers.papers.mockRejectedValue(new Error('source_rate_limited'));
    const job = await f.run();
    expect(job.newCount).toBe(0);
    expect(f.analyzer).toHaveBeenCalledTimes(2);
    f.providers.papers.mockClear();
    const reopened = new BriefingWorkspaceStore(f.dir, f.key);
    const history = await reopened.history('four');
    const group = groupBriefingHistory(history)[0]!;
    expect(group.items.find((i) => i.kind === 'papers')).toEqual(first);
    expect(group.snapshot?.sources).toContainEqual(
      expect.objectContaining({ kind: 'papers', status: 'failed' }),
    );
    const html = renderToStaticMarkup(createElement(BriefingHistoryFeed, { history }));
    expect(html).toContain('Fixture paper');
    expect(html).toContain('Fixture question');
    expect(html).not.toContain('briefing-new-badge');
    expect(f.providers.papers).not.toHaveBeenCalled();
    expect(f.analyzer).toHaveBeenCalledTimes(2);
  } finally {
    f.service.close();
  }
});

it('reproduces no-city/mail-read-off/no-new-paper configuration without falsely asserting four-source success', async () => {
  const f = await sourceFixture({ noCity: true, mailRead: false });
  try {
    f.providers.papers.mockResolvedValue([]);
    f.calendarNative.mockResolvedValue({ events: [], limited: false });
    expect(await f.run()).toMatchObject({ newCount: 0 });
    expect(f.providers.weather).not.toHaveBeenCalled();
    expect(f.mailNative).not.toHaveBeenCalled();
    expect(f.analyzer).not.toHaveBeenCalled();
    const [group] = groupBriefingHistory(await f.workspace.history('four'));
    expect(group!.snapshot?.weather).toBeUndefined();
    expect(group!.snapshot?.calendar).toEqual([]);
    expect(group!.snapshot?.sources).toEqual([
      expect.objectContaining({ kind: 'papers', status: 'empty', count: 0 }),
    ]);
    expect(group!.items).toEqual([]);
    expect((await f.workspace.profile('four'))!.preferences.mailRead).toBe(false);
  } finally {
    f.service.close();
  }
});

it.each(['weather', 'calendar', 'email', 'papers'] as const)(
  'preserves the other sources and reports a %s failure rather than an empty success',
  async (failedSource) => {
    const f = await sourceFixture({ failedSource });
    try {
      const job = await f.run();
      expect(job.error).toBeTruthy();
      expect(job.detail).toContain('일부 자료 확인 필요');
      expect((await f.workspace.desktopNotificationData()).briefings[0]).toMatchObject({
        partial: true,
        emailSourceState: failedSource === 'email' ? 'failed' : 'ready',
        newEmails: failedSource === 'email' ? 0 : 1,
      });
      const [group] = groupBriefingHistory(await f.workspace.history('four'));
      expect(Boolean(group!.snapshot?.weather)).toBe(failedSource !== 'weather');
      expect(Boolean(group!.snapshot?.calendar?.length)).toBe(failedSource !== 'calendar');
      expect(group!.items.some((i) => i.kind === 'email')).toBe(failedSource !== 'email');
      expect(group!.items.some((i) => i.kind === 'papers')).toBe(failedSource !== 'papers');
      if (failedSource !== 'calendar')
        expect(group!.snapshot?.sources.find((s) => s.kind === failedSource)).toMatchObject({
          status: 'failed',
          count: 0,
          error: expect.any(String),
        });
    } finally {
      f.service.close();
    }
  },
);

it('retains collected weather and Calendar when the summary model fails', async () => {
  const f = await sourceFixture();
  try {
    f.analyzer.mockRejectedValue(new Error('routine_model_unavailable'));
    expect(await f.run()).toMatchObject({ state: 'failed', error: expect.any(String) });
    expect((await f.workspace.desktopNotificationData()).briefings).toEqual([]);
    const [group] = groupBriefingHistory(await f.workspace.history('four'));
    expect(group!.snapshot?.weather).toEqual(f.weather.weather);
    expect(group!.snapshot?.calendar).toHaveLength(1);
    expect(group!.items).toEqual([]);
  } finally {
    f.service.close();
  }
});

it('does not read Calendar or send email to AI when those individual permissions are off', async () => {
  const f = await sourceFixture({ calendarRead: false, mailAi: false });
  try {
    expect(await f.run()).toMatchObject({ error: null });
    expect(f.calendarNative).not.toHaveBeenCalled();
    expect(f.mailNative.mock.calls.some(([q]) => q.action === 'read')).toBe(true);
    expect(f.analyzer.mock.calls.flatMap(([, items]) => items.map((i) => i.kind))).toEqual([
      'papers',
    ]);
    expect((await f.workspace.profile('four'))!.preferences).toMatchObject({
      calendarRead: false,
      mailAi: false,
    });
  } finally {
    f.service.close();
  }
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'generation-test-'));
  dirs.push(dir);
  const key = async () => Buffer.alloc(32, 8),
    workspace = new BriefingWorkspaceStore(dir, key),
    store = new BriefingGenerationStore(dir, key);
  const profile = await owner(() =>
    workspace.save(
      {
        routineId: 'r',
        name: 'Fixture',
        timeZone: 'Asia/Seoul',
        live: defaultLiveSettings(),
        interest: { keywords: [], excluded: [] },
        preferences: defaultAssistantPreferences(),
      },
      async () => undefined,
    ),
  );
  let now = Date.parse('2026-09-10T00:00:00Z');
  const run = vi.fn(async (_p, _signal, update) => {
    update({ newCount: 1 });
  });
  const make = () =>
    new BriefingGeneration(
      workspace,
      run,
      (e) => (e instanceof Error ? e.message : 'failed'),
      new BriefingGenerationStore(dir, key),
      () => now,
    );
  const engine = make();
  return {
    dir,
    workspace,
    store,
    engine,
    make,
    profile,
    run,
    advance: (hours: number) => {
      now += hours * 3600000;
    },
  };
}
it('persists encrypted interval/authority, runs after restart without a browser, and coalesces missed hours into one execution', async () => {
  const f = await fixture();
  const result = await owner(() => f.engine.configure('r', 2, new AbortController().signal));
  expect(result.intervalHours).toBe(2);
  expect(JSON.stringify(result)).not.toContain('ownerToken');
  expect(await readFile(join(f.dir, 'generation.v1.enc.json'), 'utf8')).not.toContain(
    'e'.repeat(64),
  );
  await f.engine.tick();
  expect(f.run).not.toHaveBeenCalled();
  f.advance(2);
  const restarted = f.make();
  await restarted.tick();
  await restarted.wait('r');
  expect(f.run).toHaveBeenCalledOnce();
  expect(f.run.mock.calls[0]?.[0].routineId).toBe('r');
  f.advance(10);
  await restarted.tick();
  await restarted.wait('r');
  await restarted.tick();
  expect(f.run).toHaveBeenCalledTimes(2);
  expect((await owner(() => restarted.status('r'))).job?.state).toBe('complete');
  restarted.close();
});
it('deduplicates manual double clicks and aborts an active job when automatic generation is disabled', async () => {
  const f = await fixture();
  f.run.mockImplementationOnce(
    async (_p, signal) =>
      new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('source_cancelled')), {
          once: true,
        }),
      ),
  );
  const [a, b] = await owner(() => Promise.all([f.engine.start('r'), f.engine.start('r')]));
  expect(a.job?.id).toBe(b.job?.id);
  expect(f.run).toHaveBeenCalledOnce();
  await owner(() => f.engine.configure('r', 0, new AbortController().signal));
  await f.engine.wait('r');
  expect((await owner(() => f.engine.status('r'))).job?.state).toBe('cancelled');
});
it('reports added email and paper summary counts separately on completion', async () => {
  const f = await fixture();
  f.run.mockImplementationOnce(async (_p, _signal, update) =>
    update({ newCount: 3, addedSummaries: { email: 2, papers: 1 } }),
  );
  await owner(() => f.engine.start('r'));
  await f.engine.wait('r');
  expect((await owner(() => f.engine.status('r'))).job?.detail).toBe(
    '요약 추가 완료 · 이메일 2개 · 새 논문 1개',
  );
  f.engine.close();
});
it('exports desktop configuration without copying authority or granting the new client access', async () => {
  const f = await fixture();
  const configuration = await f.workspace.desktopConfiguration();
  expect(configuration.routines[0]?.id).toBe('r');
  expect(JSON.stringify(configuration)).not.toContain('owners');
  expect(JSON.stringify(configuration)).not.toContain('approvedScope');
  expect(JSON.stringify(configuration)).not.toContain('e'.repeat(64));
  expect(
    await briefingClientContext.run('f'.repeat(64), async () =>
      f.workspace.owns((await f.workspace.profile('r'))!),
    ),
  ).toBe(false);
  f.engine.close();
});
it('requires approval for Todo access and persists private task snapshots without completing tasks', async () => {
  const f = await fixture();
  await expect(owner(() => f.workspace.assertTodoRead('r'))).rejects.toThrow(
    'assistant_todo_permission_required',
  );
  const approve = vi.fn(async (_message: string) => {});
  const profile = await owner(() =>
    f.workspace.save(
      { ...f.profile, preferences: { ...f.profile.preferences, todoRead: true } },
      approve,
    ),
  );
  expect(approve).toHaveBeenCalledOnce();
  expect(approve.mock.calls[0]?.[0]).toContain('GOSU 할 일 조회');
  const daily = await owner(() => f.workspace.dailyRun(profile, new AbortController().signal));
  const todos = {
    items: [{ id: 't', title: 'Fixture', projectName: 'Test', status: 'planned' }],
    limited: false,
    fetchedAt: '2026-09-11T00:00:00Z',
  };
  await owner(() =>
    f.workspace.saveTodoSnapshot('r', daily.runId, todos, profile, new AbortController().signal),
  );
  const reopened = new BriefingWorkspaceStore(f.dir, async () => Buffer.alloc(32, 8));
  const saved = (await reopened.history('r')).find((h) => h.runId === daily.runId)!;
  expect(saved.private).toBe(true);
  expect(saved.snapshot?.todos?.items[0]?.status).toBe('planned');
  await expect(
    briefingClientContext.run('f'.repeat(64), () => reopened.assertTodoRead('r')),
  ).rejects.toThrow();
  f.engine.close();
});
it('requires ownership and always-allow policy, and pauses schedules after settings change without using old authority', async () => {
  const f = await fixture();
  await expect(f.engine.configure('r', 1, new AbortController().signal)).rejects.toThrow(
    'assistant_client_required',
  );
  await owner(() => f.engine.configure('r', 1, new AbortController().signal));
  await owner(() =>
    f.workspace.save(
      { ...f.profile, preferences: { ...f.profile.preferences, confirmationPolicy: 'ask' } },
      async () => undefined,
    ),
  );
  f.advance(2);
  await f.engine.tick();
  expect(f.run).not.toHaveBeenCalled();
  const status = await owner(() => f.engine.status('r'));
  expect(status.intervalHours).toBe(0);
  expect(status.scheduleError).toContain('설정 또는 권한');
  await expect(
    owner(() => f.engine.configure('r', 2, new AbortController().signal)),
  ).rejects.toThrow('generation_always_required');
  expect((await f.store.record('r'))?.ownerToken).toBeNull();
});
it('keeps partial-source failures distinct from a successful empty briefing', async () => {
  const f = await fixture();
  f.run.mockImplementationOnce(async (_p, _signal, update) => update({ error: 'Source failed' }));
  await owner(() => f.engine.start('r'));
  await f.engine.wait('r');
  const result = await owner(() => f.engine.status('r'));
  expect(result.job?.detail).toContain('일부 자료 확인 필요');
  expect(result.job?.detail).not.toContain('새 항목 없음');
});
