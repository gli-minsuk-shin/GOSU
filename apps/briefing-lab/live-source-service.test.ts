import { describe, it, expect, vi } from 'vitest';
import {
  LiveSourceService,
  automaticSummaryPlan,
  sourceError,
  AutomaticSummaryBatchSchema,
} from './live-source-service';
import { AppleMailConnection } from './live-mail';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import type { LiveItem } from './src/live-types';
import type { analyzeBriefing } from './briefing-analysis';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { briefingClientContext } from './briefing-client-context';
import type { assistantModel } from './briefing-assistant';
import { CalendarService } from './calendar-service';
import { summarySourceDigest, summaryContextDigest } from './briefing-summary-cache';
const modelFixture = (): Awaited<ReturnType<typeof assistantModel>> => ({
  schemaVersion: 1,
  catalogVersion: 'fixture',
  modalities: ['text'],
  modelId: 'fixture-model',
  providerId: 'codex',
  displayName: 'Fixture model',
  isDefault: true,
  reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
});
vi.mock('./briefing-workspace-store', () => ({
  BriefingWorkspaceStore: class {
    async history() {
      return [];
    }
    async profile() {
      return null;
    }
    async canPrivateAi() {
      return false;
    }
    async saveBriefing() {
      return 'history-test';
    }
  },
}));
vi.mock('./briefing-memory-store', () => ({
  BriefingMemoryStore: class {
    async related() {
      return [];
    }
    async record() {
      return { saved: 0, revision: 1 };
    }
  },
}));
describe('live source execution', () => {
  it('includes Scholar alert papers by default within the existing single mail read, deduplicates arXiv, and keeps private-AI gating', async () => {
    const mail = new AppleMailConnection();
    vi.spyOn(mail, 'assertScope').mockImplementation(() => undefined);
    const email: LiveItem = {
      id: 'alert',
      kind: 'email',
      title: 'Google Scholar alert',
      text: 'Shared paper title\nhttps://arxiv.org/abs/2609.11111v1\nShared excerpt.\n\nNew paper title\nhttps://doi.org/10.1234/new\nNew excerpt.\n\n[Advertisement] Exclusive offer\nhttps://scholar.google.com/scholar_url?url=https%3A%2F%2Fshop.example.test%2Foffer\nShop now. 50% off.',
      source: 'Mail',
      readScope: 'mail-preview',
      details: ['scholaralerts-noreply@google.com'],
    };
    const collect = vi
      .spyOn(mail, 'collect')
      .mockResolvedValue({ items: [email], note: 'Existing approved scope' });
    const publicPaper: LiveItem = {
      id: '2609.11111',
      kind: 'papers',
      title: 'Public paper title',
      text: 'Verified public abstract',
      source: 'arXiv',
      sourceUrl: 'https://arxiv.org/abs/2609.11111v1',
      readScope: 'abstract',
      details: [],
    };
    const papers = vi.fn(async () => [publicPaper]);
    const service = new LiveSourceService(
      mail,
      { papers, cities: async () => [], weather: async () => [] },
      async () => undefined,
    );
    const input = {
      routineId: 'r',
      interest: { keywords: [], excluded: [] },
      live: {
        ...defaultLiveSettings(),
        mail: {
          accountId: 'a',
          mailboxId: 'b',
          days: 3,
          limit: 10,
          subject: '',
          sender: '',
          unreadOnly: false,
          bodyPreview: true,
        },
      },
    };
    const result = await service.collect(input, new AbortController().signal, vi.fn());
    const combined = result.find((r) => r.kind === 'papers')!;
    expect(combined.items).toHaveLength(2);
    expect(result.find((r) => r.kind === 'email')?.items).toEqual([email]);
    expect(combined.items[0]).toEqual(publicPaper);
    expect(combined.items[1]?.privateOrigin).toBe('mail');
    expect(collect).toHaveBeenCalledOnce();
    expect(collect.mock.calls[0]?.[1]).toEqual(input.live.mail);
    expect(
      automaticSummaryPlan(combined.items, { ...defaultAssistantPreferences(), mailAi: false })
        .selected,
    ).toEqual([publicPaper]);
    const optedOut = await service.collect(
      { ...input, live: { ...input.live, papers: { ...input.live.papers, scholarAlerts: false } } },
      new AbortController().signal,
      vi.fn(),
    );
    expect(optedOut.find((r) => r.kind === 'papers')?.items).toEqual([publicPaper]);
    const metadataOnly = await service.collect(
      { ...input, live: { ...input.live, mail: { ...input.live.mail, bodyPreview: false } } },
      new AbortController().signal,
      vi.fn(),
    );
    expect(metadataOnly.find((r) => r.kind === 'papers')?.items).toEqual([publicPaper]);
    papers.mockRejectedValueOnce(new Error('source_rate_limited'));
    const fallback = await service.collect(input, new AbortController().signal, vi.fn());
    expect(fallback.find((r) => r.kind === 'papers')).toMatchObject({
      status: 'ready',
      items: expect.arrayContaining([
        expect.objectContaining({ discoverySource: 'google-scholar-alert' }),
      ]),
      error: expect.any(String),
    });
    service.close();
  });
  it('suppresses collected private mail/Scholar data if its read grant is revoked before delivery', async () => {
    const mail = new AppleMailConnection();
    vi.spyOn(mail, 'assertScope')
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw new Error('mail_scope_required');
      });
    vi.spyOn(mail, 'collect').mockResolvedValue({
      items: [
        {
          id: 'alert',
          kind: 'email',
          title: 'Google Scholar alert',
          text: 'Paper title\nhttps://arxiv.org/abs/2609.11111v1',
          source: 'Mail',
          readScope: 'mail-preview',
          details: [],
        },
      ],
      note: '',
    });
    const service = new LiveSourceService(
      mail,
      { papers: async () => [], cities: async () => [], weather: async () => [] },
      async () => undefined,
    );
    await expect(
      service.collect(
        {
          routineId: 'r',
          interest: { keywords: [], excluded: [] },
          live: {
            ...defaultLiveSettings(),
            mail: {
              accountId: 'a',
              mailboxId: 'b',
              days: 3,
              limit: 10,
              subject: '',
              sender: '',
              unreadOnly: false,
              bodyPreview: true,
            },
          },
        },
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow('mail_scope_required');
    expect((service as unknown as { receipts: Map<string, unknown> }).receipts.size).toBe(0);
    service.close();
  });
  it('plans background analysis in email-first order, with papers second and private paper alerts gated', () => {
    const prefs = {
      autoPaperSummary: true,
      mailRead: true,
      mailAi: true,
      mailBodyPreview: true,
      calendarRead: false,
      calendarIds: [],
      providerId: 'codex' as const,
      modelId: null,
      reasoning: null,
      confirmationPolicy: 'always' as const,
    };
    const items = [
      {
        id: 'paper',
        kind: 'papers' as const,
        title: 'paper',
        text: '',
        source: 'arXiv',
        readScope: 'abstract' as const,
        details: [],
      },
      {
        id: 'mail',
        kind: 'email' as const,
        title: 'mail',
        text: '',
        source: 'Mail',
        readScope: 'mail-preview' as const,
        details: [],
      },
      {
        id: 'scholar',
        kind: 'papers' as const,
        title: 'alert',
        text: '',
        source: 'Mail',
        readScope: 'mail-preview' as const,
        details: [],
        privateOrigin: 'mail' as const,
      },
    ];
    const plan = automaticSummaryPlan(items, prefs);
    expect(plan.kinds).toEqual(['email', 'papers']);
    expect(plan.selected.map((item) => item.id)).toEqual(['paper', 'mail', 'scholar']);
    expect(
      automaticSummaryPlan(items, { ...prefs, mailAi: false }).selected.map((item) => item.id),
    ).toEqual(['paper']);
  });
  it('keeps a server-owned automatic summary running after the start request is gone and reconnects by job id', async () => {
    let feedbackRevision = 0;
    const paper: LiveItem = {
      id: 'background-paper',
      kind: 'papers',
      title: 'Public paper',
      text: 'Evidence',
      source: 'arXiv',
      readScope: 'abstract',
      details: [],
    };
    const workspace = {
      profile: vi.fn(async () => null),
      saveBriefing: vi.fn(async () => 'history'),
      canPrivateAi: vi.fn(async () => false),
    };
    const analyzer = vi.fn(async () => ({
      overview: 'Summary',
      items: [
        {
          id: paper.id,
          summary: 'Summary',
          importance: 'medium' as const,
          importanceReason: 'Reason',
          relevance: 'Relevant',
          action: 'Read',
          evidenceQuote: 'Evidence',
          equationIds: [],
          figureIds: [],
          memorySuggestion: null,
        },
      ],
      invocation: { providerId: 'codex', model: 'fixture', reasoning: 'high' },
      memoryUsed: [],
    }));
    const modelResolver = vi.fn(async () => ({
      modelId: 'fixture-model',
      providerId: 'codex',
      displayName: 'Fixture model',
      isDefault: true,
      reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
    })) as unknown as typeof assistantModel;
    const service = new LiveSourceService(
      new AppleMailConnection(),
      { cities: async () => [], weather: async () => [], papers: async () => [paper] },
      vi.fn(async () => undefined),
      analyzer,
      {
        related: async () => [],
        status: async () => ({ feedbackProfileRevision: feedbackRevision }),
        record: async () => ({ saved: 1, revision: 1 }),
      } as never,
      workspace as never,
      new CalendarService(),
      modelResolver,
    );
    const receipt = (
      await service.collect(
        {
          routineId: 'background',
          live: {
            weather: null,
            papers: { enabled: true, days: 30, limit: 1, author: '' },
            mail: null,
          },
          interest: { keywords: [], excluded: [] },
        },
        new AbortController().signal,
        vi.fn(),
      )
    )[0]!.receiptId!;
    const invoke = async (path: string, body: unknown) => {
      const request = Object.assign(Readable.from([JSON.stringify(body)]), {
        method: 'POST',
        url: `/api/briefing-agent/sources${path}`,
        headers: { 'content-type': 'application/json' },
      }) as IncomingMessage;
      let payload = '';
      const response = {
        writeHead: vi.fn(),
        end: (value?: string) => {
          payload = value ?? '';
        },
        destroyed: false,
      };
      await briefingClientContext.run('a'.repeat(64), () =>
        service.handle(
          request,
          response as unknown as ServerResponse,
          new AbortController().signal,
        ),
      );
      return JSON.parse(payload);
    };
    const started = await invoke('/assistant/auto-summary/start', {
      routineId: 'background',
      receiptId: receipt,
    });
    expect(started.state).toBe('running');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const status = await invoke('/assistant/auto-summary/status', {
      routineId: 'background',
      jobId: started.id,
    });
    expect(status.state).toBe('complete');
    expect(status.results).toHaveLength(1);
    expect(analyzer).toHaveBeenCalledOnce();
    const same = await invoke('/assistant/auto-summary/start', {
      routineId: 'background',
      receiptId: receipt,
    });
    expect(same.id).toBe(started.id);
    feedbackRevision++;
    const changed = await invoke('/assistant/auto-summary/start', {
      routineId: 'background',
      receiptId: receipt,
    });
    expect(changed.id).not.toBe(started.id);
    expect(changed.feedbackProfileRevision).toBe(1);
    service.close();
  });
  it('enforces a saved preference for email body preview when writing routine settings', async () => {
    const workspace = {
      approved: vi.fn(() => false),
      save: vi.fn(async (payload: unknown) => ({
        ...(payload as Record<string, unknown>),
        approvedScope: null,
        updatedAt: '2026-09-09T00:00:00Z',
        owners: [],
      })),
    };
    const service = new LiveSourceService(
      new AppleMailConnection(),
      undefined,
      vi.fn(async () => undefined),
      vi.fn(async () => ({
        overview: 'test',
        items: [],
        invocation: { providerId: 'codex', model: 'fixture', reasoning: null },
        memoryUsed: [],
      })),
      { related: async () => [], record: async () => ({ saved: 0, revision: 1 }) } as never,
      workspace as never,
      new CalendarService(),
      vi.fn(async () => modelFixture()),
    );
    const invoke = async (body: unknown) => {
      const request = Object.assign(Readable.from([JSON.stringify(body)]), {
        method: 'POST',
        url: '/api/briefing-agent/sources/assistant/settings/save',
        headers: { 'content-type': 'application/json' },
      }) as IncomingMessage;
      const response = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, destroyed: false };
      await service.handle(
        request,
        response as unknown as ServerResponse,
        new AbortController().signal,
      );
      return JSON.parse(response.end.mock.calls[0]![0] as string);
    };
    const scope = {
      accountId: 'a',
      mailboxId: 'inbox-a',
      days: 3,
      limit: 10,
      subject: '',
      sender: '',
      unreadOnly: false,
      bodyPreview: false,
    };
    const body = {
      routineId: 'r',
      name: 'Routine',
      timeZone: 'Asia/Seoul',
      live: {
        ...defaultLiveSettings(),
        mail: scope,
      },
      interest: { keywords: [], excluded: [] },
    };
    const saved = await invoke(body);
    const savedProfile = (workspace.save as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as {
      live: { mail: { bodyPreview: boolean } };
    };
    expect(saved.preferences.mailBodyPreview).toBe(true);
    expect(savedProfile.live.mail.bodyPreview).toBe(true);
    expect(saved.preferences).toMatchObject(defaultAssistantPreferences());
    expect(workspace.save).toHaveBeenCalledOnce();
    service.close();
  });
  it('accepts the final six-item batch offset for one hundred emails without widening per-batch analysis', () => {
    const input = {
      routineId: 'r',
      receiptId: '11111111-1111-4111-8111-111111111111',
      kind: 'email',
      offset: 96,
    };
    expect(AutomaticSummaryBatchSchema.parse(input).offset).toBe(96);
    expect(AutomaticSummaryBatchSchema.safeParse({ ...input, offset: 101 }).success).toBe(false);
  });
  it('does not let an unpermitted email source prevent permitted public paper work in the same receipt', () => {
    const prefs = {
      autoPaperSummary: true,
      mailRead: true,
      mailAi: false,
      mailBodyPreview: true,
      calendarRead: false,
      calendarIds: [],
      providerId: 'codex' as const,
      modelId: null,
      reasoning: null,
      confirmationPolicy: 'always' as const,
    };
    const plan = automaticSummaryPlan(
      [
        {
          id: 'mail',
          kind: 'email' as const,
          title: 'mail',
          text: '',
          source: 'Mail',
          readScope: 'mail-preview' as const,
          details: [],
        },
        {
          id: 'paper',
          kind: 'papers' as const,
          title: 'paper',
          text: '',
          source: 'arXiv',
          readScope: 'abstract' as const,
          details: [],
        },
      ],
      prefs,
    );
    expect(plan.kinds).toEqual(['papers']);
    expect(plan.selected.map((item) => item.id)).toEqual(['paper']);
  });
  it('routes batched discovery and exact-scope status without invoking consent or collecting messages', async () => {
    const mail = new AppleMailConnection();
    const discovery = { accounts: [], limited: false };
    const discover = vi.spyOn(mail, 'discover').mockResolvedValue(discovery);
    const state = vi
      .spyOn(mail, 'status')
      .mockReturnValue({ state: 'disconnected', expiresAt: null });
    const collect = vi.spyOn(mail, 'collect'),
      consent = vi.fn(async () => undefined);
    const service = new LiveSourceService(mail, undefined, consent);
    const invoke = async (path: string, body: unknown) => {
      const req = Object.assign(Readable.from([JSON.stringify(body)]), {
        method: 'POST',
        url: `/api/briefing-agent/sources${path}`,
        headers: { 'content-type': 'application/json' },
      }) as IncomingMessage;
      const res = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, destroyed: false };
      await service.handle(req, res as unknown as ServerResponse, new AbortController().signal);
      expect(res.writeHead.mock.calls[0]![0]).toBe(200);
      return JSON.parse(res.end.mock.calls[0]![0] as string);
    };
    expect(await invoke('/mail/discover?refresh=1', {})).toEqual(discovery);
    const scope = {
      accountId: 'a',
      mailboxId: 'box',
      days: 3,
      limit: 10,
      subject: '',
      sender: '',
      unreadOnly: false,
      bodyPreview: false,
    };
    expect(await invoke('/mail/status', { routineId: 'r', scope })).toEqual({
      state: 'disconnected',
      expiresAt: null,
    });
    expect(discover).toHaveBeenCalledOnce();
    expect(state).toHaveBeenCalledWith('r', scope);
    expect(collect).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
    service.close();
  });
  it('binds analysis to an unexpired routine receipt and rejects invented items without calling LLM', async () => {
    const paper: LiveItem = {
      id: 'p',
      kind: 'papers',
      title: 'Public paper',
      text: 'Evidence',
      readScope: 'abstract',
      details: [],
      source: 'test',
    };
    const analyzer = vi.fn<typeof analyzeBriefing>(async () => ({
      overview: 'Summary',
      items: [],
      invocation: { providerId: 'codex', model: 'resolved', reasoning: 'high' },
      memoryUsed: [],
    }));
    const consent = vi.fn(async () => undefined);
    const service = new LiveSourceService(
      new AppleMailConnection(),
      { cities: async () => [], weather: async () => [], papers: async () => [paper] },
      consent,
      analyzer,
    );
    const signal = new AbortController().signal;
    const results = await service.collect(
      { routineId: 'r', live: defaultLiveSettings(), interest: { keywords: [], excluded: [] } },
      signal,
      vi.fn(),
    );
    const request = {
      routineId: 'r',
      receiptId: results[0]!.receiptId!,
      itemIds: ['p'],
      providerId: 'codex',
      modelId: 'test',
      reasoning: null,
      includeMail: false,
      memory: [],
    };
    await expect(
      service.analyze({ ...request, routineId: 'other' }, signal, vi.fn()),
    ).rejects.toThrow('receipt');
    await expect(
      service.analyze({ ...request, itemIds: ['invented'] }, signal, vi.fn()),
    ).rejects.toThrow('id_invalid');
    expect(analyzer).not.toHaveBeenCalled();
    await expect(service.analyze(request, signal, vi.fn())).rejects.toThrow('id_invalid');
    expect(analyzer).toHaveBeenCalledOnce();
    expect(consent).not.toHaveBeenCalled();
    service.close();
    await expect(service.analyze(request, signal, vi.fn())).rejects.toThrow('receipt');
  });
  it('재요약 없이 history의 이전 브리핑 결과를 그대로 재사용한다', async () => {
    const serviceMail = new AppleMailConnection();
    const paper: LiveItem = {
      id: 'cached-paper',
      kind: 'papers',
      title: 'Cached Paper',
      source: 'arXiv',
      text: 'Prior text',
      readScope: 'abstract',
      details: [],
      paper: {
        readScope: 'abstract',
        excerpt: 'Prior excerpt',
        equations: [{ id: 'e1', latex: 'E=mc^2' }],
        figures: [],
        sourceUrl: 'https://arxiv.org/abs/2401.00001',
        note: 'Prior note',
      },
    };
    const workspace = {
      profile: vi.fn(async () => null),
      canPrivateAi: vi.fn(async () => false),
      saveBriefing: vi.fn(async () => 'history-cached'),
      record: vi.fn(async () => ({ saved: 1, revision: 1 })) as never,
      summaryHistory: vi.fn(async () => [
        {
          id: 'h1',
          feedbackProfileRevision: 0,
          routineId: 'r',
          createdAt: '2026-09-09T00:00:00.000Z',
          kind: 'briefing',
          answer: '요약',
          private: false,
          items: [
            {
              id: 'cached-paper',
              title: 'Cached Paper',
              sourceUrl: 'https://arxiv.org/abs/2401.00001',
              readScope: 'abstract',
              summary: '이미 요약된 캐시',
              provenance: {
                version: 1,
                sourceDigest: summarySourceDigest(paper),
                contextDigest: summaryContextDigest(paper, { keywords: [], excluded: [] }),
                summarizedAt: '2026-09-09T00:00:00.000Z',
                reused: false,
              },
              importance: 'high',
              importanceReason: '연구 우선순위 높음',
              relevance: '높음',
              kind: 'papers',
              action: '읽기',
              detail: '이전 상세 요약',
              keywords: ['AI'],
              equations: [{ latex: 'E=mc^2', explanation: '에너지와 질량의 관계' }],
            },
          ],
        },
      ]),
    };
    const analyzer = vi.fn<typeof analyzeBriefing>(async () => {
      throw new Error('not expected');
    });
    const service = new LiveSourceService(
      serviceMail,
      { cities: async () => [], weather: async () => [], papers: async () => [paper] },
      vi.fn(async () => undefined),
      analyzer,
      {
        related: async () => [],
        feedbackProfile: async () => ({ feedbackProfileRevision: 0 }),
        record: async () => ({ saved: 1, revision: 1 }),
      } as never,
      workspace as never,
      new CalendarService(),
      vi.fn(async () => modelFixture()),
    );
    const results = await service.collect(
      {
        routineId: 'r',
        live: { ...defaultLiveSettings(), mail: null },
        interest: { keywords: [], excluded: [] },
      },
      new AbortController().signal,
      vi.fn(),
    );
    const request = {
      routineId: 'r',
      receiptId: results[0]!.receiptId!,
      itemIds: ['cached-paper'],
      providerId: 'codex',
      modelId: 'fixture-model',
      reasoning: 'high',
      includeMail: false,
      memory: [],
    };
    const analysis = await service.analyze(request, new AbortController().signal, vi.fn());
    expect(analyzer).not.toHaveBeenCalled();
    expect(analysis.overview).toContain('이미 요약된 캐시');
    expect(analysis.items).toHaveLength(1);
    expect(analysis.items[0]!.summary).toBe('이미 요약된 캐시');
    expect(analysis.cache).toMatchObject({ reusedItemIds: ['cached-paper'], generatedItemIds: [] });
    expect(workspace.saveBriefing).toHaveBeenCalledOnce();
    service.close();
  });
  it('이전 요약 매칭이 깨지면 캐시를 무시하고 분석을 수행한다', async () => {
    const serviceMail = new AppleMailConnection();
    const paper: LiveItem = {
      id: 'cached-paper',
      kind: 'papers',
      title: 'Cached Paper',
      source: 'arXiv',
      text: 'Prior text',
      readScope: 'abstract',
      details: [],
      paper: {
        readScope: 'abstract',
        excerpt: 'Prior excerpt',
        equations: [{ id: 'e1', latex: 'E=mc^2' }],
        figures: [],
        sourceUrl: 'https://arxiv.org/abs/2401.00001',
        note: 'Prior note',
      },
    };
    const workspace = {
      profile: vi.fn(async () => null),
      canPrivateAi: vi.fn(async () => false),
      saveBriefing: vi.fn(async () => 'history'),
      summaryHistory: vi.fn(async () => [
        {
          id: 'h1',
          feedbackProfileRevision: 0,
          routineId: 'r',
          createdAt: '2026-09-09T00:00:00.000Z',
          kind: 'briefing',
          answer: '요약',
          private: false,
          items: [
            {
              id: 'cached-paper',
              title: '다른 제목',
              sourceUrl: 'https://arxiv.org/abs/2401.00001',
              readScope: 'abstract',
              summary: '이미 요약된 캐시',
              importance: 'high',
              importanceReason: '연구 우선순위 높음',
              relevance: '높음',
              kind: 'papers',
              action: '읽기',
              detail: '이전 상세 요약',
              keywords: ['AI'],
              equations: [{ latex: 'E=mc^2', explanation: '에너지와 질량의 관계' }],
            },
          ],
        },
      ]),
    } as never;
    const analyzer = vi.fn<typeof analyzeBriefing>(async () => ({
      overview: 'new',
      items: [
        {
          id: paper.id,
          summary: 'fresh',
          importance: 'medium',
          importanceReason: 'fresh',
          relevance: '연구 관련',
          action: '새로 요약',
          evidenceQuote: 'Prior text',
          equationIds: ['e1'],
          figureIds: [],
          memorySuggestion: null,
        },
      ],
      invocation: { providerId: 'codex', model: 'fixture-model', reasoning: 'high' },
      memoryUsed: [],
    }));
    const service = new LiveSourceService(
      serviceMail,
      { cities: async () => [], weather: async () => [], papers: async () => [paper] },
      vi.fn(async () => undefined),
      analyzer,
      {
        related: async () => [],
        feedbackProfile: async () => ({ feedbackProfileRevision: 0 }),
        record: async () => ({ saved: 1, revision: 1 }),
      } as never,
      workspace,
      new CalendarService(),
      vi.fn(async () => modelFixture()),
    );
    const results = await service.collect(
      { routineId: 'r', live: defaultLiveSettings(), interest: { keywords: [], excluded: [] } },
      new AbortController().signal,
      vi.fn(),
    );
    const request = {
      routineId: 'r',
      receiptId: results[0]!.receiptId!,
      itemIds: ['cached-paper'],
      providerId: 'codex',
      modelId: 'fixture-model',
      reasoning: 'high',
      includeMail: false,
      memory: [],
    };
    const analysis = await service.analyze(request, new AbortController().signal, vi.fn());
    expect(analyzer).toHaveBeenCalledOnce();
    expect(analysis.items[0]!.summary).toBe('fresh');
    service.close();
  });
  it('캐시와 분석 대상이 섞인 경우 캐시된 이메일은 건너뛰고 논문만 분석한다', async () => {
    const paper: LiveItem = {
      id: 'paper-1',
      kind: 'papers',
      title: 'Cached Paper',
      source: 'arXiv',
      text: 'Paper body',
      readScope: 'abstract',
      details: [],
      paper: {
        readScope: 'abstract',
        excerpt: 'Paper excerpt',
        equations: [{ id: 'eq1', latex: 'y = mx + b' }],
        figures: [],
        sourceUrl: 'https://arxiv.org/abs/2401.11111',
        note: 'Paper note',
      },
    };
    const workspace = {
      profile: vi.fn(async () => null),
      canPrivateAi: vi.fn(async () => true),
      saveBriefing: vi.fn(async () => 'history-id'),
      summaryHistory: vi.fn(async () => [
        {
          id: 'h1',
          feedbackProfileRevision: 0,
          routineId: 'r',
          createdAt: '2026-09-09T00:00:00.000Z',
          kind: 'briefing',
          answer: '요약',
          private: true,
          items: [
            {
              id: 'mail-1',
              title: 'Cached Mail',
              sourceUrl: 'message://mail-1',
              readScope: 'mail-preview',
              summary: '이미 요약된 메일',
              provenance: {
                version: 1,
                sourceDigest: summarySourceDigest({
                  id: 'mail-1',
                  kind: 'email',
                  title: 'Cached Mail',
                  source: 'Mail',
                  text: 'Mail body',
                  readScope: 'mail-preview',
                  details: [],
                }),
                contextDigest: summaryContextDigest(
                  { kind: 'email' } as LiveItem,
                  { keywords: [], excluded: [] },
                  {
                    accountId: 'a',
                    mailboxId: 'b',
                    days: 3,
                    limit: 10,
                    subject: '',
                    sender: '',
                    unreadOnly: false,
                    bodyPreview: true,
                  },
                ),
                summarizedAt: '2026-09-09T00:00:00.000Z',
                reused: false,
              },
              importance: 'high',
              importanceReason: '중요한 업무 요청',
              relevance: '',
              kind: 'email',
              action: '회신',
            },
          ],
        },
      ]),
    } as never;
    const analyzer = vi.fn<typeof analyzeBriefing>(async () => ({
      overview: 'new',
      items: [
        {
          id: paper.id,
          summary: 'fresh paper',
          importance: 'medium',
          importanceReason: '논문 업데이트',
          relevance: '연구 관련',
          action: '검토',
          evidenceQuote: 'Paper body',
          equationIds: ['eq1'],
          figureIds: [],
          memorySuggestion: null,
        },
      ],
      invocation: { providerId: 'codex', model: 'fixture-model', reasoning: 'high' },
      memoryUsed: [],
    }));
    const mail = new AppleMailConnection();
    vi.spyOn(mail, 'assertScope').mockImplementation(() => undefined);
    vi.spyOn(mail, 'collect').mockResolvedValue({
      items: [
        {
          id: 'mail-1',
          kind: 'email',
          title: 'Cached Mail',
          source: 'Mail',
          text: 'Mail body',
          readScope: 'mail-preview',
          details: [],
        },
      ],
      note: 'mail',
    });
    const service = new LiveSourceService(
      mail,
      {
        cities: async () => [],
        weather: async () => [],
        papers: async () => [paper],
      },
      vi.fn(async () => undefined),
      analyzer,
      {
        related: async () => [],
        feedbackProfile: async () => ({ feedbackProfileRevision: 0 }),
        record: async () => ({ saved: 1, revision: 1 }),
      } as never,
      workspace,
      new CalendarService(),
      vi.fn(async () => modelFixture()),
    );
    const results = await service.collect(
      {
        routineId: 'r',
        live: {
          ...defaultLiveSettings(),
          mail: {
            accountId: 'a',
            mailboxId: 'b',
            days: 3,
            limit: 10,
            subject: '',
            sender: '',
            unreadOnly: false,
            bodyPreview: true,
          },
        },
        interest: { keywords: [], excluded: [] },
      },
      new AbortController().signal,
      vi.fn(),
    );
    const request = {
      routineId: 'r',
      receiptId: results[0]!.receiptId!,
      itemIds: ['mail-1', 'paper-1'],
      providerId: 'codex',
      modelId: 'fixture-model',
      reasoning: 'high',
      includeMail: true,
      memory: [],
    };
    const analysis = await service.analyze(request, new AbortController().signal, vi.fn());
    expect(analyzer).toHaveBeenCalledOnce();
    expect(analysis.items).toHaveLength(2);
    expect(analysis.items[0]!.summary).toBe('이미 요약된 메일');
    expect(analysis.items[1]!.summary).toBe('fresh paper');
    service.close();
  });
  it('requires separate private-analysis opt-in and native confirmation, and rechecks mail revocation after inference', async () => {
    const mail = new AppleMailConnection();
    const scopeCheck = vi.spyOn(mail, 'assertScope').mockImplementation(() => undefined);
    vi.spyOn(mail, 'collect').mockResolvedValue({
      items: [
        {
          id: 'mail',
          kind: 'email',
          title: 'Synthetic mail',
          text: 'Private fixture only',
          readScope: 'mail-preview',
          details: [],
          source: 'test',
        },
      ],
      note: 'test',
    });
    const analyzer = vi.fn<typeof analyzeBriefing>(async () => ({
      overview: 'Summary',
      items: [],
      invocation: { providerId: 'codex', model: 'resolved', reasoning: null },
      memoryUsed: [],
    }));
    const consent = vi.fn(async () => undefined);
    const service = new LiveSourceService(
      mail,
      { cities: async () => [], weather: async () => [], papers: async () => [] },
      consent,
      analyzer,
    );
    const signal = new AbortController().signal;
    const results = await service.collect(
      {
        routineId: 'r',
        live: {
          ...defaultLiveSettings(),
          mail: {
            accountId: 'a',
            mailboxId: 'b',
            days: 3,
            limit: 10,
            subject: '',
            sender: '',
            unreadOnly: false,
            bodyPreview: true,
          },
        },
        interest: { keywords: [], excluded: [] },
      },
      signal,
      vi.fn(),
    );
    const request = {
      routineId: 'r',
      receiptId: results[0]!.receiptId!,
      itemIds: ['mail'],
      providerId: 'codex',
      modelId: 'test',
      reasoning: null,
      includeMail: false,
      memory: [],
    };
    await expect(service.analyze(request, signal, vi.fn())).rejects.toThrow('consent_required');
    expect(analyzer).not.toHaveBeenCalled();
    consent.mockRejectedValueOnce(new Error('native_consent_denied'));
    await expect(
      service.analyze({ ...request, includeMail: true }, signal, vi.fn()),
    ).rejects.toThrow('consent_denied');
    expect(analyzer).not.toHaveBeenCalled();
    analyzer.mockImplementationOnce(async () => {
      scopeCheck.mockImplementation(() => {
        throw new Error('mail_scope_required');
      });
      return {
        overview: 'late result',
        items: [],
        invocation: { providerId: 'codex', model: 'resolved', reasoning: null },
        memoryUsed: [],
      };
    });
    await expect(
      service.analyze({ ...request, includeMail: true }, signal, vi.fn()),
    ).rejects.toThrow('scope_required');
    service.close();
  });
  it('uses the supplied saved profile and isolates provider failures without fixture fallback', async () => {
    const profile = { keywords: [{ term: 'optimization', weight: 5, synonyms: [] }], excluded: [] };
    const papers = vi.fn(async () => []),
      weather = vi.fn(async () => {
        throw new Error('source_timeout');
      });
    const service = new LiveSourceService(new AppleMailConnection(), {
      cities: async () => [],
      papers,
      weather,
    });
    const progress = vi.fn();
    const signal = new AbortController().signal;
    const result = await service.collect(
      {
        routineId: 'r',
        interest: profile,
        live: {
          ...defaultLiveSettings(),
          weather: {
            id: 1,
            name: 'Chosen city',
            latitude: 37,
            longitude: 127,
            country: 'KR',
            timeZone: 'Asia/Seoul',
          },
        },
      },
      signal,
      progress,
    );
    expect((papers.mock.calls as unknown[][])[0]![0]).toEqual(profile);
    expect(result.map((r) => r.status)).toEqual(['failed', 'empty']);
    expect(result[0]!.error).toContain('초과');
    expect(progress).toHaveBeenCalledTimes(4);
  });
  it('provides actionable permission errors and no raw upstream output', () => {
    expect(sourceError(new Error('mail_permission_denied'))).toContain('자동화');
    expect(sourceError(new Error('routine_output_schema_invalid'))).toContain('응답 형식');
    expect(sourceError(new Error('routine_output_schema_invalid'))).not.toContain('항목 수');
    expect(sourceError(new Error('private provider output'))).not.toContain(
      'private provider output',
    );
  });
});
