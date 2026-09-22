import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { defaultModelRouting } from '@gosu/contracts';
import { BriefingGeneration } from './briefing-generation';
import {
  BriefingGenerationStore,
  generationScheduled,
  nextGenerationDueAt,
} from './briefing-generation-store';
import { BriefingGuidanceStore } from './briefing-guidance-store';
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
    readIndex?: ConstructorParameters<typeof AppleMailConnection>[3];
    providerId?: 'codex' | 'claude-code';
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
  const mail = new AppleMailConnection(mailNative, undefined, undefined, options.readIndex);
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
    ...(options.providerId ? { providerId: options.providerId } : {}),
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
    // The resolver answers with the model it was asked for, as the real catalog lookup does.
    async (preferences) =>
      ({ modelId: preferences.modelId || 'fixture-model' }) as Awaited<
        ReturnType<typeof assistantModel>
      >,
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
    const html = renderToStaticMarkup(
      createElement(BriefingHistoryFeed, { history, deferBody: false }),
    );
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

it('refreshes added, edited and deleted same-day calendar events without losing the old agenda on failure', async () => {
  const f = await sourceFixture();
  const agenda = async () =>
    groupBriefingHistory(await f.workspace.history('four'))[0]!.snapshot!.calendar!;
  try {
    await f.run();
    const added = {
      ...f.nativeEvent,
      nativeId: 'new-event',
      title: 'New meeting',
      start: '2026-09-12T05:00:00Z',
      end: '2026-09-12T06:00:00Z',
    };
    f.calendarNative.mockResolvedValue({ events: [f.nativeEvent, added], limited: false });
    await f.run();
    expect((await agenda()).map((e) => e.title)).toEqual(['Fixture meeting', 'New meeting']);
    f.calendarNative.mockResolvedValue({
      events: [{ ...added, title: 'Updated meeting' }],
      limited: false,
    });
    await f.run();
    expect((await agenda()).map((e) => e.title)).toEqual(['Updated meeting']);
    f.calendarNative.mockRejectedValueOnce(new Error('calendar_unavailable'));
    await f.run();
    expect((await agenda()).map((e) => e.title)).toEqual(['Updated meeting']);
    f.calendarNative.mockResolvedValue({ events: [], limited: false });
    await f.run();
    expect(await agenda()).toEqual([]);
    expect(f.providers.weather).toHaveBeenCalledOnce();
    expect(f.analyzer).toHaveBeenCalledTimes(2);
  } finally {
    f.service.close();
  }
});
it('keeps first daily weather, refreshes calendar, avoids duplicate summaries, and appends fresh email/paper on the next briefing', async () => {
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
    expect(f.calendarNative).toHaveBeenCalledTimes(3);
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
    const html = renderToStaticMarkup(
      createElement(BriefingHistoryFeed, { history, deferBody: false }),
    );
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
    // No summary could be written, but the mail that arrived is not invisible: subject, sender and
    // received time are kept with an empty summary (2026-09-21: "요약만 빠지게. 그래야 사용자가
    // 적어도 이메일이 온건 알 수 있잖아"). Papers are not kept this way.
    expect(group!.items).toHaveLength(1);
    expect(group!.items[0]).toMatchObject({
      kind: 'email',
      title: 'Fixture email',
      summary: '',
      importance: 'uncertain',
      mailSender: expect.stringContaining('sender@example.test'),
      receivedAt: expect.any(String),
    });
  } finally {
    f.service.close();
  }
});

it('warns about a mailbox interval the read could not reach and closes it once a later read does', async () => {
  const f = await sourceFixture();
  try {
    const base = f.mailNative.getMockImplementation()!;
    let reached = false;
    f.mailNative.mockImplementation(async (request, signal, progress) => {
      const value = (await base(request, signal, progress)) as Record<string, unknown>;
      if (request.action !== 'read') return value;
      return {
        ...value,
        coverage: {
          ordered: true,
          floorReached: reached,
          stoppedBy: reached ? 'floor' : 'budget',
          newest: new Date(Date.now() - 60_000).toISOString(),
          oldest: new Date(Date.now() - 3_600_000).toISOString(),
          floor: request.stopAt ?? request.since,
          examined: 2,
          known: 0,
        },
      };
    });
    const first = await f.run();
    expect(first).toMatchObject({ state: 'complete', mailCoverageGaps: 1 });
    expect(first.error).toContain('메일 미확인 구간');
    reached = true;
    const second = await f.run();
    const read = f.mailNative.mock.calls.filter(([q]) => q.action === 'read').at(-1)![0];
    // The next read is floored at the recorded gap (minus overlap), never below the days window.
    expect(read.action === 'read' && read.stopAt).toBeTruthy();
    expect(second.mailCoverageGaps ?? 0).toBe(0);
  } finally {
    f.service.close();
  }
});

it('keeps later summaries when one AI batch times out and reports the failed batch', async () => {
  const f = await sourceFixture();
  try {
    const summarize = f.analyzer.getMockImplementation()!;
    // The first batch (email) times out; the paper batch after it must still be summarized.
    f.analyzer
      .mockRejectedValueOnce(new Error('routine_timeout'))
      .mockImplementation((...args) => summarize(...args));
    const job = await f.run();
    expect(f.analyzer).toHaveBeenCalledTimes(2);
    expect(job).toMatchObject({ state: 'complete', summaryFailures: 1 });
    expect(job.addedSummaries?.papers).toBeGreaterThan(0);
    expect(job.error).toContain('요약 실패');
    expect(job.error).toContain('시간이 초과');
    // The email of the failed batch is in today's briefing without a summary, and the run says so.
    expect(job.error).toContain('이메일 1통은 제목·보낸 사람·받은 시각만 브리핑에 남겼습니다');
    const emails = async () =>
      groupBriefingHistory(await owner(() => f.workspace.history('four')))[0]!.items.filter(
        (item) => item.kind === 'email',
      );
    expect(await emails()).toEqual([
      expect.objectContaining({ title: 'Fixture email', summary: '', importance: 'uncertain' }),
    ]);
    // It does not count as summarized: no notification claims it, and the next run summarizes it.
    expect(job.addedSummaries?.email ?? 0).toBe(0);
    vi.setSystemTime(new Date('2026-09-12T01:00:00Z'));
    const next = await f.run();
    expect(next.addedSummaries?.email).toBe(1);
    const after = await emails();
    // One entry for the mail, now with its summary: the empty one was replaced, not duplicated.
    expect(after).toHaveLength(1);
    expect(after[0]!.summary).toContain('Reply to the invitation before Friday.');
  } finally {
    f.service.close();
  }
});

it('never keeps a sign-in code mail as an unsummarized entry, and keeps nothing for a cancelled run', async () => {
  const f = await sourceFixture();
  try {
    f.nativeMessages.push({
      ...f.nativeMessages[0]!,
      id: '2',
      title: 'Your one-time passcode for Example',
      preview: 'Use 123456 to sign in.',
      date: new Date(Date.now() - 60_000).toISOString(),
    });
    const summarize = f.analyzer.getMockImplementation()!;
    f.analyzer
      .mockRejectedValueOnce(new Error('routine_timeout'))
      .mockImplementation((...args) => summarize(...args));
    await f.run();
    const titles = async () =>
      groupBriefingHistory(await owner(() => f.workspace.history('four')))[0]!
        .items.filter((item) => item.kind === 'email')
        .map((item) => item.title);
    // The ordinary mail is shown without a summary; the code mail (its subject can hold the secret)
    // is not written anywhere.
    expect(await titles()).toEqual(['Fixture email']);
    expect(JSON.stringify(await owner(() => f.workspace.history('four')))).not.toContain(
      'one-time passcode',
    );
  } finally {
    f.service.close();
  }
  const cancelled = await sourceFixture();
  try {
    // The user stops the run while the email batch is being summarized: nothing is kept for it.
    cancelled.analyzer.mockImplementationOnce(async (_input, _items, _interest, signal) => {
      await owner(() => cancelled.engine.cancel('four'));
      if (signal.aborted) throw new Error('source_cancelled');
      throw new Error('expected the run to be cancelled');
    });
    const job = await cancelled.run();
    expect(job.state).toBe('cancelled');
    const groups = groupBriefingHistory(await owner(() => cancelled.workspace.history('four')));
    expect(groups.flatMap((group) => group.items).filter((item) => item.kind === 'email')).toEqual(
      [],
    );
  } finally {
    cancelled.service.close();
  }
});

it('summarizes email batches three at a time and saves every batch', async () => {
  const f = await sourceFixture();
  try {
    // The first read of an account is capped at three messages; the concurrency applies after it.
    await f.run();
    vi.setSystemTime(new Date('2026-09-12T01:00:00Z'));
    for (let i = 2; i <= 14; i++)
      f.nativeMessages.push({
        ...f.nativeMessages[0]!,
        id: String(i),
        title: `Fixture email ${i}`,
        date: new Date(Date.now() - i * 60_000).toISOString(),
      });
    const summarize = f.analyzer.getMockImplementation()!;
    f.analyzer.mockClear();
    let inFlight = 0,
      peak = 0;
    let release!: () => void;
    const threeRunning = new Promise<void>((resolve) => (release = resolve));
    f.analyzer.mockImplementation(async (...args) => {
      peak = Math.max(peak, ++inFlight);
      if (inFlight >= 3) release();
      // Each call waits until three run together. A fixed 30 ms hold measured the machine instead:
      // under load the third batch started after the first had finished, and the peak read 2.
      await Promise.race([threeRunning, new Promise((resolve) => setTimeout(resolve, 3000))]);
      inFlight--;
      return summarize(...args);
    });
    const job = await f.run();
    const emailCalls = f.analyzer.mock.calls.filter(([, items]) =>
      items.every((item) => item.kind === 'email'),
    );
    expect(emailCalls.map(([, items]) => items.length).sort()).toEqual([1, 6, 6]);
    expect(peak).toBe(3);
    expect(job).toMatchObject({ state: 'complete', addedSummaries: { email: 13 } });
    const [group] = groupBriefingHistory(await f.workspace.history('four'));
    expect(group!.items.filter((item) => item.kind === 'email')).toHaveLength(14);
  } finally {
    f.service.close();
  }
});

it('finishes the briefing when a sign-in code mail is among the new mail, and does not retry it', async () => {
  // The real failure: one "one-time passcode" mail made its batch unsaveable, the run took that for
  // a storage failure, stopped every other batch and never reached the papers. The mail stayed
  // unhandled, so the same thing happened at every run until it aged out of the read window.
  const f = await sourceFixture();
  try {
    f.nativeMessages.push({
      ...f.nativeMessages[0]!,
      id: '2',
      title: 'Your one-time passcode for Example',
      preview: 'Use 123456 to sign in.',
      date: new Date(Date.now() - 60_000).toISOString(),
    });
    const quick = vi.fn<NonNullable<typeof f.service.quickBriefingRunner>>(
      async () =>
        ({
          answer: JSON.stringify({ headline: '새 메일 1통', points: ['Fixture email'] }),
          model: 'fixture-quick-model',
          providerId: 'codex',
          reasoning: null,
          nextDates: [],
        }) as unknown as Awaited<ReturnType<NonNullable<typeof f.service.quickBriefingRunner>>>,
    );
    f.service.quickBriefingRunner = quick;
    const job = await f.run();
    expect(job).toMatchObject({ state: 'complete', addedSummaries: { email: 1, papers: 1 } });
    // A completed run reports its notices in the same line as other warnings.
    expect(job.error).toContain('인증 코드·일회용 비밀번호·비밀번호 재설정 메일 1통');
    expect(job.error).not.toContain('briefing_memory_unavailable');
    // Neither the detailed summary nor the quick briefing ever saw the code mail.
    const sent = f.analyzer.mock.calls.flatMap(([, items]) => items.map((item) => item.title));
    expect(sent).toContain('Fixture email');
    expect(sent).not.toContain('Your one-time passcode for Example');
    const payload = JSON.stringify(quick.mock.calls[0]![3]!.structuredJob!.prompt);
    expect(payload).not.toContain('123456');
    expect(payload).not.toContain('one-time passcode');
    const [group] = groupBriefingHistory(await f.workspace.history('four'));
    expect(group!.items.filter((item) => item.kind === 'email').map((i) => i.title)).toEqual([
      'Fixture email',
    ]);
    // It counts as handled: the next briefing does not pick it up again.
    vi.setSystemTime(new Date('2026-09-12T01:00:00Z'));
    f.analyzer.mockClear();
    const next = await f.run();
    expect(next).toMatchObject({ state: 'complete', error: null });
    expect(f.analyzer.mock.calls.flatMap(([, items]) => items.map((i) => i.title))).not.toContain(
      'Your one-time passcode for Example',
    );
  } finally {
    f.service.close();
  }
});

it('runs a routine scheduled by its delivery times alone, without an interval', async () => {
  // The run's own guard still required an interval, so such a routine stopped at every automatic
  // run with "설정 또는 권한 확인이 필요해…" although nothing had changed.
  const f = await sourceFixture();
  try {
    const schedule = {
      frequency: 'daily' as const,
      interval: 1,
      anchorDate: '2026-09-01',
      timeZone: 'Asia/Seoul',
      times: ['10:00'],
      weekdays: [],
      monthDay: 1,
    };
    await owner(() => f.engine.configure('four', 0, new AbortController().signal, schedule));
    // 2026-09-12 10:00 KST is 01:00Z.
    vi.setSystemTime(new Date('2026-09-12T01:00:30Z'));
    await f.engine.tick();
    await f.engine.wait('four');
    const status = await owner(() => f.engine.status('four'));
    expect(status.scheduleError).toBeNull();
    expect(status.job).toMatchObject({ state: 'complete', error: null });
  } finally {
    f.service.close();
  }
});

it('runs a scheduled briefing through the real generation, not only a manual one', async () => {
  // The scheduler stores the schedule digest (generationProfileDigest, "v2:…"); the run's own guard
  // compared it with a different digest (generationRunDigest), so every scheduled run failed.
  const f = await sourceFixture();
  try {
    await owner(() => f.engine.configure('four', 1, new AbortController().signal));
    vi.setSystemTime(new Date(Date.now() + 3600000 + 1000));
    await f.engine.tick();
    await f.engine.wait('four');
    const status = await owner(() => f.engine.status('four'));
    expect(status.scheduleError).toBeNull();
    expect(status.job).toMatchObject({ state: 'complete', error: null });
  } finally {
    f.service.close();
  }
});

it('finishes the briefing when Mail never answers, and reads the mail ten minutes later instead of at the next interval', async () => {
  // 2026-09-21: Mail was swapped out on a Mac that was out of memory when GOSU started. The email
  // section stayed "조회 미완료" until the next interval, four hours later.
  const f = await sourceFixture();
  try {
    await owner(() => f.engine.configure('four', 4, new AbortController().signal));
    vi.setSystemTime(new Date(Date.now() + 4 * 3600000 + 1000));
    f.mailNative.mockRejectedValueOnce(Error('mail_timeout_account'));
    await f.engine.tick();
    await f.engine.wait('four');
    let status = await owner(() => f.engine.status('four'));
    expect(status.job).toMatchObject({ state: 'complete', emailSourceState: 'failed' });
    expect(status.job?.error).toContain('Apple Mail이 5분 동안 응답하지 않아');
    expect(status.job?.error).toContain('자동으로 다시 확인합니다');
    expect(Date.parse(status.nextDueAt!) - Date.now()).toBe(10 * 60_000);
    // The paper was still summarized; only the email waits.
    expect(f.analyzer.mock.calls.flatMap(([, items]) => items.map((i) => i.kind))).toEqual([
      'papers',
    ]);

    vi.setSystemTime(new Date(Date.parse(status.nextDueAt!) + 1000));
    await f.engine.tick();
    await f.engine.wait('four');
    status = await owner(() => f.engine.status('four'));
    expect(status.job).toMatchObject({ state: 'complete', error: null, emailSourceState: 'ready' });
    expect(f.analyzer.mock.calls.flatMap(([, items]) => items.map((i) => i.kind))).toEqual([
      'papers',
      'email',
    ]);
    expect(Date.parse(status.nextDueAt!) - Date.now()).toBeGreaterThan(3 * 3600000);
  } finally {
    f.service.close();
  }
});

it('summarizes on the model Settings → Agent assigns, whatever provider the routine stored', async () => {
  // 2026-09-21: the role models were on Codex while the routine still stored Claude. 0.58.130 failed
  // the whole run, 0.58.133 ran the stored model and said so; the user asked for Settings → Agent to
  // be the only place that decides, so the assigned model runs and nothing is left to explain.
  const f = await sourceFixture();
  try {
    const policy = defaultModelRouting();
    const other = {
      providerId: 'claude-code' as const,
      modelId: 'other-provider-model',
      reasoningOptionId: 'low',
    };
    policy.fast = { ...other };
    policy.lightweight = { ...other };
    policy.strong = { ...other };
    f.service.modelRouting = async () => policy;
    const job = await f.run();
    expect(job).toMatchObject({ state: 'complete' });
    expect(f.analyzer.mock.calls.length).toBeGreaterThan(0);
    for (const [input] of f.analyzer.mock.calls)
      expect(input).toMatchObject({
        providerId: 'claude-code',
        modelId: 'other-provider-model',
        reasoning: 'low',
      });
    expect(job.error ?? '').not.toContain('역할 모델');
    // The routine's stored selection is left alone: it is the fallback while a role has no model.
    expect((await owner(() => f.workspace.profile('four')))!.preferences.providerId).toBe('codex');
  } finally {
    f.service.close();
  }
});

// Every model a user can assign to the briefing role must run the email summary, whichever provider
// the routine stored before Briefing lost its own model picker.
const ROLE_MODELS = [
  { providerId: 'codex', modelId: 'gpt-5.6-luna', reasoningOptionId: 'low' },
  { providerId: 'codex', modelId: 'gpt-6-astra', reasoningOptionId: null },
  { providerId: 'claude-code', modelId: 'claude-haiku-4-5', reasoningOptionId: 'off' },
  { providerId: 'claude-code', modelId: 'claude-sonnet-5', reasoningOptionId: 'medium' },
  { providerId: 'claude-code', modelId: 'claude-opus-5', reasoningOptionId: 'xhigh' },
] as const;
it.each(
  (['codex', 'claude-code'] as const).flatMap((routineProvider) =>
    ROLE_MODELS.map((role) => ({ routineProvider, role })),
  ),
)(
  'summarizes email with the role model $role.modelId on a routine that stored $routineProvider',
  async ({ routineProvider, role }) => {
    const f = await sourceFixture({ providerId: routineProvider });
    try {
      const policy = defaultModelRouting();
      policy.fast = { ...role };
      policy.lightweight = { ...role };
      policy.strong = { ...role };
      f.service.modelRouting = async () => policy;
      const job = await f.run();
      expect(job.state).toBe('complete');
      expect(job.summaryFailures ?? 0).toBe(0);
      const emailCalls = f.analyzer.mock.calls.filter(([, items]) =>
        items.some((item) => item.kind === 'email'),
      );
      expect(emailCalls.length).toBeGreaterThan(0);
      for (const [input] of emailCalls)
        expect(input).toMatchObject({
          providerId: role.providerId,
          modelId: role.modelId,
          reasoning: role.reasoningOptionId,
        });
      const history = await owner(() => f.workspace.history('four'));
      expect(JSON.stringify(history)).toContain('Reply to the invitation before Friday.');
      expect(job.error ?? '').not.toContain('역할 모델');
    } finally {
      f.service.close();
    }
  },
);

it("keeps the routine's stored model while Settings → Agent assigns none, and refuses other providers", async () => {
  const f = await sourceFixture({ providerId: 'claude-code' });
  try {
    f.service.modelRouting = async () => defaultModelRouting();
    const job = await f.run();
    expect(job.state).toBe('complete');
    for (const [input] of f.analyzer.mock.calls) expect(input.providerId).toBe('claude-code');
    // A provider nobody chose (not stored, not assigned in Settings → Agent) gets no private data.
    expect(await owner(() => f.workspace.canPrivateAi('four', 'claude-code'))).toBe(true);
    expect(await owner(() => f.workspace.canPrivateAi('four', 'codex'))).toBe(false);
    const policy = defaultModelRouting();
    policy.fast = { providerId: 'codex', modelId: 'gpt-5.6-luna', reasoningOptionId: 'low' };
    f.service.modelRouting = async () => policy;
    expect(await owner(() => f.workspace.canPrivateAi('four', 'codex'))).toBe(true);
  } finally {
    f.service.close();
  }
});

it('shows a metadata-only quick first briefing while the detailed summaries continue', async () => {
  const f = await sourceFixture();
  try {
    const quick = vi.fn<NonNullable<typeof f.service.quickBriefingRunner>>(
      async () =>
        ({
          answer: JSON.stringify({
            headline: '새 메일 1통 · **Sender**에게 금요일 전 답장이 필요해 보입니다(추정).',
            points: ['오늘 10시 Fixture meeting', '새 논문 1편'],
          }),
          model: 'fixture-quick-model',
          providerId: 'codex',
          reasoning: null,
          nextDates: [],
        }) as unknown as Awaited<ReturnType<NonNullable<typeof f.service.quickBriefingRunner>>>,
    );
    f.service.quickBriefingRunner = quick;
    const job = await f.run();
    expect(job).toMatchObject({ state: 'complete', error: null });
    expect(job.quickBriefingAt).toEqual(expect.any(String));
    expect(quick).toHaveBeenCalledOnce();
    const [request, , , options] = quick.mock.calls[0]!;
    expect(request).toMatchObject({ providerId: 'codex', modelId: 'fixture-model' });
    const payload = JSON.parse(options!.structuredJob!.prompt);
    expect(payload).toMatchObject({
      newEmailCount: 1,
      emails: [{ subject: 'Fixture email', sender: 'Sender <sender@example.test>' }],
      papers: ['Fixture paper'],
      agenda: [{ title: 'Fixture meeting' }],
    });
    expect(options!.timeoutMs).toBeLessThanOrEqual(120_000);
    expect(options!.structuredJob!.thinking).toBe('disabled');
    // The detailed summaries still ran for every item.
    expect(job.addedSummaries).toMatchObject({ email: 1, papers: 1 });
    const history = await f.workspace.history('four');
    const [group] = groupBriefingHistory(history);
    expect(group!.snapshot?.quickBriefing).toMatchObject({ emailCount: 1, paperCount: 1 });
    const html = renderToStaticMarkup(createElement(BriefingHistoryFeed, { history }));
    expect(html).toContain('빠른 1차 브리핑');
    expect(html).toContain('금요일 전 답장이 필요해 보입니다');
    // Each open source section can be closed from its left accent bar.
    expect(html).toContain('aria-label="이메일 섹션 접기"');
    expect(html).toContain('aria-label="연구 논문 섹션 접기"');

    // A failed quick briefing is a warning; the detailed summaries are unaffected.
    vi.setSystemTime(new Date('2026-09-12T01:00:00Z'));
    f.nativeMessages.push({
      ...f.nativeMessages[0]!,
      id: '2',
      title: 'Second email',
      date: new Date().toISOString(),
    });
    quick.mockRejectedValueOnce(new Error('routine_timeout'));
    const second = await f.run();
    expect(second).toMatchObject({ state: 'complete', addedSummaries: { email: 1 } });
    expect(second.error).toContain('빠른 1차 브리핑을 만들지 못했습니다');
  } finally {
    f.service.close();
  }
});

it('gives the routine guidance to the quick briefing and the detailed email summary', async () => {
  const f = await sourceFixture();
  try {
    f.service.guidance = new BriefingGuidanceStore(f.dir, f.key);
    await f.service.guidance.add('four', 'example.test 메일은 반드시 요약에 포함');
    const quick = vi.fn<NonNullable<typeof f.service.quickBriefingRunner>>(
      async () =>
        ({
          answer: JSON.stringify({ headline: '새 메일 1통', points: [] }),
          model: 'fixture-quick-model',
          providerId: 'codex',
          reasoning: null,
          nextDates: [],
        }) as unknown as Awaited<ReturnType<NonNullable<typeof f.service.quickBriefingRunner>>>,
    );
    f.service.quickBriefingRunner = quick;
    const job = await f.run();
    expect(job).toMatchObject({ state: 'complete', error: null });
    const options = quick.mock.calls[0]![3]!;
    const payload = JSON.parse(options.structuredJob!.prompt);
    expect(payload.userGuidance).toEqual(['example.test 메일은 반드시 요약에 포함']);
    expect(payload.emails[0]).toMatchObject({ matchesUserGuidance: true });
    expect(options.structuredJob!.instructions).toContain('userGuidance');
    const emailCall = f.analyzer.mock.calls.find(([, items]) =>
      items.every((item) => item.kind === 'email'),
    )!;
    expect(emailCall[10]?.map((g) => g.text)).toEqual(['example.test 메일은 반드시 요약에 포함']);
  } finally {
    f.service.close();
  }
});

it('saves the valid summaries of a batch, retries the rejected mail next time and reports progress per kind', async () => {
  const f = await sourceFixture();
  try {
    f.nativeMessages.push({
      ...f.nativeMessages[0]!,
      id: '2',
      title: 'Second email',
      date: new Date(Date.now() - 60_000).toISOString(),
    });
    const summarize = f.analyzer.getMockImplementation()!;
    let rejectedId = '';
    f.analyzer.mockImplementationOnce(async (input, items, ...rest) => {
      const result = await summarize(input, items, ...rest);
      const second = items.find((item) => item.title === 'Second email')!;
      rejectedId = second.id;
      return {
        ...result,
        items: result.items.filter((entry) => entry.id !== second.id),
        rejectedItems: [{ id: second.id, code: 'briefing_analysis_quote_unverified' }],
      };
    });
    const job = await f.run();
    expect(job).toMatchObject({
      state: 'complete',
      summaryRejectedItems: 1,
      addedSummaries: { email: 1, papers: 1 },
    });
    expect(job.error).toContain('1통 요약 검증 실패');
    expect(job.summaryKinds).toEqual([
      { kind: 'email', total: 2, saved: 1, failed: 1, running: [], state: 'done' },
      { kind: 'papers', total: 1, saved: 1, failed: 0, running: [], state: 'done' },
    ]);
    let [group] = groupBriefingHistory(await f.workspace.history('four'));
    // The rejected mail is shown without a summary; the valid one keeps its summary.
    expect(
      group!.items
        .filter((item) => item.kind === 'email')
        .map((item) => [item.title, Boolean(item.summary)])
        .sort(),
    ).toEqual([
      ['Fixture email', true],
      ['Second email', false],
    ]);

    // The rejected mail was not marked handled, so the next briefing reads and summarizes it again.
    vi.setSystemTime(new Date('2026-09-12T01:00:00Z'));
    const next = await f.run();
    expect(next.addedSummaries?.email).toBe(1);
    expect(f.analyzer.mock.calls.at(-1)?.[1].map((item) => item.id)).toContain(rejectedId);
    [group] = groupBriefingHistory(await f.workspace.history('four'));
    const emails = group!.items.filter((item) => item.kind === 'email');
    expect(emails).toHaveLength(2);
    expect(emails.every((item) => item.summary.trim())).toBe(true);
  } finally {
    f.service.close();
  }
});

it('warns in the run header when Mail was read without its index', async () => {
  const f = await sourceFixture({
    readIndex: () => {
      throw new Error('mail_index_permission_required');
    },
  });
  try {
    const job = await f.run();
    expect(job).toMatchObject({ state: 'complete', mailIndexFallback: true });
    expect(job.error).toContain('전체 디스크 접근 권한');
    expect(f.mailNative.mock.calls.filter(([q]) => q.action === 'read')).toHaveLength(1);
  } finally {
    f.service.close();
  }
});

it('does not read Calendar or send email to AI when those individual permissions are off', async () => {
  const f = await sourceFixture({ calendarRead: false, mailAi: false });
  const quick = vi.fn();
  f.service.quickBriefingRunner = quick;
  try {
    expect(await f.run()).toMatchObject({ error: null });
    expect(quick).not.toHaveBeenCalled();
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
  const run = vi.fn<ConstructorParameters<typeof BriefingGeneration>[1]>(
    async (_p, _signal, update) => {
      update({ newCount: 1 });
    },
  );
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
it('runs at the routine delivery times, next to the interval, and once after a missed time', async () => {
  const f = await fixture();
  // 08:00 and 18:00 every day in the routine's timezone, as the routine settings hold them.
  const schedule = {
    frequency: 'daily' as const,
    interval: 1,
    anchorDate: '2026-09-01',
    timeZone: 'Asia/Seoul',
    times: ['08:00', '18:00'],
    weekdays: [],
    monthDay: 1,
  };
  // 2026-09-10T00:00Z is 09:00 KST, so the next delivery time is 18:00 KST (09:00Z).
  const saved = await owner(() =>
    f.engine.configure('r', 0, new AbortController().signal, schedule),
  );
  expect(saved.routineSchedule).toEqual(schedule);
  expect(saved.intervalHours).toBe(0);
  expect(saved.nextDueAt).toBe('2026-09-10T09:00:00.000Z');
  await f.engine.tick();
  expect(f.run).not.toHaveBeenCalled();
  f.advance(9);
  await f.engine.tick();
  await f.engine.wait('r');
  expect(f.run).toHaveBeenCalledOnce();
  expect((await owner(() => f.engine.status('r'))).nextDueAt).toBe('2026-09-10T23:00:00.000Z');

  // Adding the interval keeps the times: whichever comes first runs next.
  const both = await owner(() => f.engine.configure('r', 4, new AbortController().signal));
  expect(both.routineSchedule).toEqual(schedule);
  expect(both.nextDueAt).toBe('2026-09-10T13:00:00.000Z');
  f.advance(4);
  await f.engine.tick();
  await f.engine.wait('r');
  expect(f.run).toHaveBeenCalledTimes(2);
  expect((await owner(() => f.engine.status('r'))).nextDueAt).toBe('2026-09-10T17:00:00.000Z');

  // A whole day asleep runs once on the next check, not once per missed time.
  f.advance(24);
  await f.engine.tick();
  await f.engine.wait('r');
  await f.engine.tick();
  expect(f.run).toHaveBeenCalledTimes(3);

  // Turning the times off leaves the interval, and turning both off stops everything.
  const intervalOnly = await owner(() =>
    f.engine.configure('r', 4, new AbortController().signal, null),
  );
  expect(intervalOnly.routineSchedule).toBeNull();
  expect(intervalOnly.nextDueAt).not.toBeNull();
  const off = await owner(() => f.engine.configure('r', 0, new AbortController().signal, null));
  expect(off.nextDueAt).toBeNull();
  f.advance(48);
  await f.engine.tick();
  expect(f.run).toHaveBeenCalledTimes(3);
  f.engine.close();
});
it('looks at a Mail that did not answer again ten minutes later, once, and never resumes a schedule the user has not', async () => {
  const f = await fixture();
  await owner(() => f.engine.configure('r', 4, new AbortController().signal));
  // 2026-09-21: Mail was swapped out when GOSU started and the email section stayed empty until
  // the next interval, four hours later.
  f.run.mockImplementation(async () => ({ emailKeys: [], retryMailInMs: 10 * 60_000 }));
  f.advance(4);
  await f.engine.tick();
  await f.engine.wait('r');
  let status = await owner(() => f.engine.status('r'));
  expect(status.nextDueAt).toBe('2026-09-10T04:10:00.000Z');
  expect(status.job).toMatchObject({ state: 'complete' });
  expect(status.job?.error).toContain('Apple Mail은 13:10쯤 자동으로 다시 확인합니다.');

  // The follow-up still finds Mail silent: the ordinary interval continues, not another ten minutes.
  f.advance(10 / 60);
  await f.engine.tick();
  await f.engine.wait('r');
  expect(f.run).toHaveBeenCalledTimes(2);
  status = await owner(() => f.engine.status('r'));
  expect(status.nextDueAt).toBe('2026-09-10T08:10:00.000Z');
  expect(status.job?.error ?? '').not.toContain('다시 확인합니다');

  // A later failure gets its own single follow-up, and a run that reads Mail needs none.
  f.advance(4);
  await f.engine.tick();
  await f.engine.wait('r');
  expect((await owner(() => f.engine.status('r'))).nextDueAt).toBe('2026-09-10T08:20:00.000Z');
  f.run.mockImplementation(async () => ({ emailKeys: [] }));
  f.advance(10 / 60);
  await f.engine.tick();
  await f.engine.wait('r');
  expect((await owner(() => f.engine.status('r'))).nextDueAt).toBe('2026-09-10T12:20:00.000Z');

  // A manual run of a routine nothing runs automatically plans nothing.
  await owner(() => f.engine.configure('r', 0, new AbortController().signal, null));
  f.run.mockImplementation(async () => ({ emailKeys: [], retryMailInMs: 10 * 60_000 }));
  await owner(() => f.engine.start('r'));
  await f.engine.wait('r');
  status = await owner(() => f.engine.status('r'));
  expect(status.nextDueAt).toBeNull();
  expect(status.job?.error ?? '').not.toContain('다시 확인합니다');
  f.engine.close();
});
it('refuses routine-time scheduling while requests need per-request confirmation', async () => {
  const f = await fixture();
  await owner(() =>
    f.workspace.save(
      {
        ...f.profile,
        preferences: { ...f.profile.preferences, confirmationPolicy: 'ask' },
      },
      async () => undefined,
    ),
  );
  await expect(
    owner(() =>
      f.engine.configure('r', 0, new AbortController().signal, {
        frequency: 'daily',
        interval: 1,
        anchorDate: '2026-09-01',
        timeZone: 'Asia/Seoul',
        times: ['08:00'],
        weekdays: [],
        monthDay: 1,
      }),
    ),
  ).rejects.toThrow('generation_always_required');
  expect((await owner(() => f.engine.status('r'))).routineSchedule).toBeNull();
  f.engine.close();
});

it('keeps the saved interval across new approved clients and model/UI preference updates', async () => {
  const f = await fixture();
  await owner(() => f.engine.configure('r', 4, new AbortController().signal));
  await briefingClientContext.run('f'.repeat(64), () =>
    f.workspace.save(
      { ...f.profile, preferences: { ...f.profile.preferences, modelId: 'new-model' } },
      async () => undefined,
    ),
  );
  f.advance(4);
  const restarted = f.make();
  await restarted.tick();
  await restarted.wait('r');
  expect(f.run).toHaveBeenCalledOnce();
  expect((await owner(() => restarted.status('r'))).intervalHours).toBe(4);
  restarted.close();
  f.engine.close();
});
it('migrates an exact legacy schedule after an approved client was appended', async () => {
  const f = await fixture();
  await owner(() => f.engine.configure('r', 2, new AbortController().signal));
  const p = (await f.workspace.profile('r'))!;
  const old = createHash('sha256')
    .update(
      JSON.stringify([p.timeZone, p.live, p.interest, p.preferences, p.approvedScope, p.owners]),
    )
    .digest('hex');
  await f.store.update('r', (r) => {
    r.profileDigest = old;
  });
  await briefingClientContext.run('f'.repeat(64), () =>
    f.workspace.save({ ...p }, async () => undefined),
  );
  f.advance(2);
  await f.engine.tick();
  await f.engine.wait('r');
  expect(f.run).toHaveBeenCalledOnce();
  expect((await f.store.record('r'))?.profileDigest).toMatch(/^v2:/);
  f.engine.close();
});
it('does not erase the interval on a transient startup/storage error and resumes on the next retry', async () => {
  const f = await fixture();
  await owner(() => f.engine.configure('r', 4, new AbortController().signal));
  f.advance(4);
  vi.spyOn(f.workspace, 'profile').mockRejectedValueOnce(
    new Error('temporary_keychain_unavailable'),
  );
  await f.engine.tick();
  expect((await f.store.record('r'))?.intervalHours).toBe(4);
  expect(f.run).not.toHaveBeenCalled();
  f.advance(1 / 60);
  await f.engine.tick();
  await f.engine.wait('r');
  expect(f.run).toHaveBeenCalledOnce();
  expect((await f.store.record('r'))?.scheduleError).toBeNull();
  f.engine.close();
});
it('preserves explicit off after restart and never treats a real source permission change as a harmless update', async () => {
  const f = await fixture();
  await owner(() => f.engine.configure('r', 4, new AbortController().signal));
  await owner(() =>
    f.workspace.save(
      {
        ...f.profile,
        preferences: {
          ...f.profile.preferences,
          calendarRead: true,
          calendarIds: ['new-calendar'],
        },
      },
      async () => undefined,
    ),
  );
  f.advance(4);
  await f.engine.tick();
  expect(f.run).not.toHaveBeenCalled();
  expect(await f.store.record('r')).toMatchObject({ intervalHours: 4, nextDueAt: null });
  await owner(() => f.engine.configure('r', 0, new AbortController().signal));
  const reopened = f.make();
  f.advance(48);
  await reopened.tick();
  expect((await owner(() => reopened.status('r'))).intervalHours).toBe(0);
  expect(f.run).not.toHaveBeenCalled();
  reopened.close();
  f.engine.close();
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
  expect(status.intervalHours).toBe(1);
  expect(status.scheduleError).toContain('설정 또는 권한');
  // The pause names the actual reason: per-request confirmation, not a vague "check settings".
  expect(status.scheduleError).toContain('요청마다 확인');
  await expect(
    owner(() => f.engine.configure('r', 2, new AbortController().signal)),
  ).rejects.toThrow('generation_always_required');
  expect((await f.store.record('r'))?.ownerToken).toBe('e'.repeat(64));
  expect((await f.store.record('r'))?.nextDueAt).toBeNull();
});
it('names the approved scope items when a schedule pauses after the AI provider changes', async () => {
  const f = await fixture();
  await owner(() => f.engine.configure('r', 1, new AbortController().signal));
  const provider = f.profile.preferences.providerId === 'codex' ? 'claude-code' : 'codex';
  await owner(() =>
    f.workspace.save(
      { ...f.profile, preferences: { ...f.profile.preferences, providerId: provider } },
      async () => undefined,
    ),
  );
  f.advance(2);
  await f.engine.tick();
  expect(f.run).not.toHaveBeenCalled();
  const status = await owner(() => f.engine.status('r'));
  expect(status.scheduleError).toContain('AI 제공자');
  expect(status.scheduleError).toContain('같은 간격을 다시 선택');
  expect(status.scheduleError).not.toContain('요청마다 확인');
  f.engine.close();
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

it('picks the earliest of the routine time and the interval, and nothing when both are off', () => {
  const now = Date.parse('2026-09-20T02:00:00Z'); // 11:00 KST
  const daily = {
    frequency: 'daily' as const,
    interval: 1,
    anchorDate: '2026-09-01',
    timeZone: 'Asia/Seoul',
    times: ['08:00', '18:00'],
    weekdays: [],
    monthDay: 1,
  };
  // 18:00 KST today is 09:00Z; a 12-hour interval would be 14:00Z, so the routine time wins.
  expect(nextGenerationDueAt({ intervalHours: 12, routineSchedule: daily }, now)).toBe(
    '2026-09-20T09:00:00.000Z',
  );
  expect(nextGenerationDueAt({ intervalHours: 4, routineSchedule: daily }, now)).toBe(
    '2026-09-20T06:00:00.000Z',
  );
  expect(nextGenerationDueAt({ intervalHours: 0, routineSchedule: daily }, now)).toBe(
    '2026-09-20T09:00:00.000Z',
  );
  // Weekly Monday 09:00 KST from a Sunday: the next Monday, not today.
  const weekly = { ...daily, frequency: 'weekly' as const, times: ['09:00'], weekdays: [1] };
  expect(nextGenerationDueAt({ intervalHours: 0, routineSchedule: weekly }, now)).toBe(
    '2026-09-21T00:00:00.000Z',
  );
  expect(nextGenerationDueAt({ intervalHours: 0, routineSchedule: null }, now)).toBeNull();
  expect(generationScheduled({ intervalHours: 0, routineSchedule: null })).toBe(false);
  expect(generationScheduled({ intervalHours: 0, routineSchedule: daily })).toBe(true);
});
