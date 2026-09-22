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
import * as discovery from './briefing-paper-discovery';
import * as taskDraft from './email-task-draft';
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
it('names the rate-limited or unanswered paper index instead of a generic incomplete notice', () => {
  // A lost connection is neither a login nor a CLI version problem.
  expect(sourceError(new Error('claude_code_network_unavailable'))).toContain('인터넷(DNS) 연결');
  expect(sourceError(new Error('claude_code_network_unavailable'))).not.toContain('로그인 상태');
  const arxivLimited = sourceError(
    new discovery.PapersDiscoveryIncompleteError([
      { source: 'arXiv', code: 'source_rate_limited' },
    ]),
  );
  expect(arxivLimited).toContain('arXiv가 이 네트워크의 요청을 잠시 제한');
  expect(arxivLimited).toContain('Crossref·OpenReview는 확인했지만');
  expect(arxivLimited).not.toContain('일부가 응답하지 않아');

  const mixed = sourceError(
    new discovery.PapersDiscoveryIncompleteError([
      { source: 'arXiv', code: 'source_timeout' },
      { source: 'OpenReview', code: 'source_http_503' },
    ]),
  );
  expect(mixed).toContain('arXiv·OpenReview 응답을 받지 못해');
  expect(mixed).toContain('Crossref에는 조회 기간에 맞는 새 논문이 없었습니다');

  expect(sourceError(new Error('papers_discovery_incomplete'))).toContain(
    '공개 논문 출처 일부가 응답하지 않아',
  );
});
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
  it.each(['allowed', 'foreign', 'revoked'])(
    'saves Reminders preferences only for approved owned UI scope: %s',
    async (mode) => {
      const profile = { routineId: 'r', preferences: { todoRead: false } };
      const workspace = {
        profile: async () => profile,
        owns: () => mode !== 'foreign',
        approved: () => mode !== 'revoked',
      };
      const service = new LiveSourceService(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        workspace as never,
      );
      const configure = vi.fn(async (value, _signal, guard) => {
        await guard();
        return value;
      });
      service.taskActions = { options: vi.fn(), create: vi.fn(), configure };
      try {
        const req = Object.assign(
          Readable.from([JSON.stringify({ routineId: 'r', enabled: true, listId: 'icloud' })]),
          {
            method: 'POST',
            url: '/api/briefing-agent/sources/todo/preferences',
            headers: { 'content-type': 'application/json' },
          },
        ) as IncomingMessage;
        const res = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, destroyed: false };
        await service.handle(req, res as unknown as ServerResponse, new AbortController().signal);
        expect(res.writeHead.mock.calls[0]![0]).toBe(mode === 'allowed' ? 200 : 400);
        expect(configure).toHaveBeenCalledTimes(mode === 'allowed' ? 1 : 0);
        expect(service.taskActions.create).not.toHaveBeenCalled();
      } finally {
        service.close();
      }
    },
  );
  it('allows reviewed UI task creation without granting AI access to existing tasks', async () => {
    const profile = { routineId: 'r', preferences: { todoRead: false } };
    const read = vi.fn(async () => {
      throw Error('no AI task read grant');
    });
    const workspace = {
      profile: async () => profile,
      owns: () => true,
      approved: () => true,
      assertTodoRead: read,
    };
    const service = new LiveSourceService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      workspace as never,
    );
    const create = vi.fn(async (_input, _signal, guard) => {
      await guard();
      return {
        taskId: '22222222-2222-4222-8222-222222222222',
        reminderState: 'skipped' as const,
        message: 'Saved',
      };
    });
    service.taskActions = { options: vi.fn(), create };
    try {
      const body = {
        routineId: 'r',
        sourceKey: 'email',
        requestId: '22222222-2222-4222-8222-222222222222',
        projectId: null,
        title: 'Review',
        notes: 'Review details',
        dueDate: null,
        reminderListId: null,
      };
      const req = Object.assign(Readable.from([JSON.stringify(body)]), {
        method: 'POST',
        url: '/api/briefing-agent/sources/todo/create',
        headers: { 'content-type': 'application/json' },
      }) as IncomingMessage;
      const res = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, destroyed: false };
      await service.handle(req, res as unknown as ServerResponse, new AbortController().signal);
      expect(res.writeHead.mock.calls[0]![0]).toBe(200);
      expect(create).toHaveBeenCalledOnce();
      expect(read).not.toHaveBeenCalled();
      expect(profile.preferences.todoRead).toBe(false);
    } finally {
      service.close();
    }
  });
  it.each(['allowed', 'foreign', 'private-denied', 'unapproved'])(
    'routes task AI drafting through owned private scope without native writes: %s',
    async (mode) => {
      const profile = {
        routineId: 'r',
        timeZone: 'Asia/Seoul',
        preferences: defaultAssistantPreferences(),
      };
      const workspace = {
        profile: async () => profile,
        owns: () => mode !== 'foreign',
        approved: () => mode !== 'unapproved',
        canPrivateAi: async () => mode !== 'private-denied',
        assertTodoRead: async () => {
          throw Error('Task drafting must not require existing-task AI read permission');
        },
        requiresPerRequestConfirmation: () => false,
      };
      const service = new LiveSourceService(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        workspace as never,
        undefined,
        vi.fn(async () => modelFixture()),
      );
      const draft = vi.spyOn(taskDraft, 'draftEmailTask').mockResolvedValue({
        draft: { title: 'Review material', notes: 'Review', dueDate: null },
        notice: 'No deadline',
      });
      const create = vi.fn(),
        options = vi.fn();
      service.taskActions = { create, options };
      try {
        const req = Object.assign(
          Readable.from([JSON.stringify({ routineId: 'r', title: 'Mail', text: 'Please review' })]),
          {
            method: 'POST',
            url: '/api/briefing-agent/sources/todo/draft',
            headers: { 'content-type': 'application/json' },
          },
        ) as IncomingMessage;
        const res = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, destroyed: false };
        await service.handle(req, res as unknown as ServerResponse, new AbortController().signal);
        expect(res.writeHead.mock.calls[0]![0]).toBe(mode === 'allowed' ? 200 : 400);
        expect(draft).toHaveBeenCalledTimes(mode === 'allowed' ? 1 : 0);
        expect(create).not.toHaveBeenCalled();
        expect(options).not.toHaveBeenCalled();
      } finally {
        draft.mockRestore();
        service.close();
      }
    },
  );
  it.each(['foreign', 'revoked'] as const)(
    'blocks task integration before native calls for %s access',
    async (mode) => {
      const workspace = {
        profile: async () => ({ routineId: 'r' }),
        owns: () => mode !== 'foreign',
        approved: () => mode !== 'revoked',
        assertTodoRead: async () => {
          if (mode === 'revoked') throw Error('assistant_todo_permission_required');
        },
      };
      const service = new LiveSourceService(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        workspace as never,
      );
      const options = vi.fn(),
        create = vi.fn();
      service.taskActions = { options, create };
      try {
        const req = Object.assign(Readable.from([JSON.stringify({ routineId: 'r' })]), {
          method: 'POST',
          url: '/api/briefing-agent/sources/todo/authorize',
          headers: { 'content-type': 'application/json' },
        }) as IncomingMessage;
        const res = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, destroyed: false };
        await service.handle(req, res as unknown as ServerResponse, new AbortController().signal);
        expect(options).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
        expect(res.writeHead.mock.calls[0]![0]).toBe(400);
      } finally {
        service.close();
      }
    },
  );
  it('suppresses project and reminder catalog data if the owned profile changes during the read', async () => {
    const workspace = {
      profile: vi
        .fn()
        .mockResolvedValueOnce({ routineId: 'r' })
        .mockResolvedValueOnce({ routineId: 'r' })
        .mockResolvedValue({ routineId: 'changed' }),
      owns: () => true,
      approved: () => true,
      assertTodoRead: async () => undefined,
    };
    const service = new LiveSourceService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      workspace as never,
    );
    service.taskActions = {
      options: vi.fn(async () => ({
        projects: [{ id: 'secret-project', name: 'Private project' }],
        authorized: false,
        lists: [],
        defaultListId: '',
      })),
      create: vi.fn(),
    };
    try {
      const req = Object.assign(Readable.from([JSON.stringify({ routineId: 'r' })]), {
        method: 'POST',
        url: '/api/briefing-agent/sources/todo/options',
        headers: { 'content-type': 'application/json' },
      }) as IncomingMessage;
      const res = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, destroyed: false };
      await service.handle(req, res as unknown as ServerResponse, new AbortController().signal);
      expect(res.writeHead.mock.calls[0]![0]).toBe(400);
      expect(res.end.mock.calls[0]![0]).not.toContain('Private project');
    } finally {
      service.close();
    }
  });
  it.each([false, true])(
    'finds Scholar papers outside incremental mail results even when ordinary Mail fails=%s',
    async (mailFails) => {
      const mail = new AppleMailConnection();
      vi.spyOn(mail, 'assertScope').mockImplementation(() => undefined);
      vi.spyOn(mail, 'restorePolicyGrant').mockResolvedValue(undefined);
      const scope = {
        accountId: 'a',
        mailboxId: 'b',
        days: 3,
        limit: 100,
        subject: '',
        sender: '',
        unreadOnly: false,
        bodyPreview: true,
      };
      const alert: LiveItem = {
        id: 'previously-summarized-email',
        kind: 'email',
        title: 'Google Scholar alert',
        text: 'A new research paper\nhttps://arxiv.org/abs/2609.11111v1\nAn evidence excerpt.',
        source: 'Mail',
        readScope: 'mail-preview',
        details: ['scholaralerts-noreply@google.com'],
      };
      const collect = vi
        .spyOn(mail, 'collect')
        .mockImplementation(async (_r, _scope, _s, _progress, plan, search) => {
          if (search) {
            expect(plan).toBeUndefined();
            expect(search.query).toBe('scholar');
            return { items: [alert], note: 'Targeted scope' };
          }
          if (mailFails) throw new Error('mail_timeout_metadata');
          return { items: [], note: 'Already summarized email excluded' };
        });
      const profile = { timeZone: 'Asia/Seoul' };
      const workspace = {
        profile: async () => profile,
        assertMail: vi.fn(async () => undefined),
        requiresPerRequestConfirmation: () => false,
      };
      const service = new LiveSourceService(
        mail,
        {
          papers: async () => {
            throw new Error('papers_discovery_incomplete');
          },
          cities: async () => [],
          weather: async () => [],
        },
        async () => undefined,
        undefined,
        undefined,
        workspace as never,
      );
      try {
        const result = await service.collect(
          {
            routineId: 'r',
            interest: { keywords: [], excluded: [] },
            live: { ...defaultLiveSettings(), mail: scope },
          },
          new AbortController().signal,
          vi.fn(),
          false,
        );
        expect(result.find((r) => r.kind === 'papers')).toMatchObject({
          status: 'ready',
          items: [
            expect.objectContaining({
              kind: 'papers',
              privateOrigin: 'mail',
              discoverySource: 'google-scholar-alert',
            }),
          ],
        });
        expect(result.find((r) => r.kind === 'email')?.items).toEqual([]);
        expect(collect).toHaveBeenCalledTimes(2);
        expect(
          collect.mock.calls.every((c) => JSON.stringify(c[1]) === JSON.stringify(scope)),
        ).toBe(true);
        expect(workspace.assertMail).toHaveBeenCalledTimes(4);
      } finally {
        service.close();
      }
    },
  );
  it('tries a Mail that stopped answering once more within a run, but does not wait again for one that never answered', async () => {
    const mail = new AppleMailConnection();
    vi.spyOn(mail, 'assertScope').mockImplementation(() => undefined);
    vi.spyOn(mail, 'restorePolicyGrant').mockResolvedValue(undefined);
    const scope = {
      accountId: 'a',
      mailboxId: 'b',
      days: 3,
      limit: 100,
      subject: '',
      sender: '',
      unreadOnly: false,
      bodyPreview: true,
    };
    const item: LiveItem = {
      id: 'new-mail',
      kind: 'email',
      title: 'Meeting moved',
      text: 'The meeting is now at three.',
      source: 'Mail',
      readScope: 'mail-preview',
      details: ['colleague@example.test'],
    };
    let outcomes: (string | number)[] = [];
    const collect = vi
      .spyOn(mail, 'collect')
      .mockImplementation(async (_r, _scope, _s, _progress, _plan, search) => {
        if (search) return { items: [], note: 'Scholar' };
        const outcome = outcomes.shift();
        if (typeof outcome === 'string') throw new Error(outcome);
        return { items: [item], note: 'Read', ...(outcome ? { delayedAccounts: outcome } : {}) };
      });
    const workspace = {
      profile: async () => ({ timeZone: 'Asia/Seoul' }),
      assertMail: vi.fn(async () => undefined),
      requiresPerRequestConfirmation: () => false,
    };
    const service = new LiveSourceService(
      mail,
      { papers: async () => [], cities: async () => [], weather: async () => [] },
      async () => undefined,
      undefined,
      undefined,
      workspace as never,
    );
    service.mailRetryPauseMs = 0;
    const run = async (next: (string | number)[]) => {
      outcomes = next;
      collect.mockClear();
      const onDelayed = vi.fn(),
        progress = vi.fn();
      const result = await service.collect(
        {
          routineId: 'r',
          interest: { keywords: [], excluded: [] },
          live: { ...defaultLiveSettings(), mail: scope },
        },
        new AbortController().signal,
        progress,
        false,
        undefined,
        undefined,
        { retry: true, onDelayed },
      );
      const ordinary = collect.mock.calls.filter((call) => !call[5]).length,
        scholar = collect.mock.calls.length - ordinary;
      return {
        email: result.find((r) => r.kind === 'email')!,
        ordinary,
        scholar,
        onDelayed,
        progress,
      };
    };
    try {
      // Mail answered and then stopped: the second reader gets through and nothing is left over.
      const recovered = await run(['mail_timeout_metadata']);
      expect(recovered.email).toMatchObject({ status: 'ready', items: [{ id: 'new-mail' }] });
      expect(recovered).toMatchObject({ ordinary: 2, scholar: 1 });
      expect(recovered.onDelayed).not.toHaveBeenCalled();
      expect(recovered.progress).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'email',
          detail: expect.stringContaining('한 번 더 시도'),
        }),
      );

      // Mail never answered for its whole waiting time: no second wait and no Scholar search
      // against the same silent Mail; the run is told so it can look again soon.
      const silent = await run(['mail_timeout_account']);
      expect(silent).toMatchObject({ ordinary: 1, scholar: 0 });
      expect(silent.email.status).toBe('failed');
      expect(silent.email.error).toContain('Apple Mail이 5분 동안 응답하지 않아');
      expect(silent.onDelayed).toHaveBeenCalledOnce();

      // Still failing after the one retry, or one account left unread: told as well.
      const stillDown = await run(['mail_timeout_mailbox', 'mail_unavailable']);
      expect(stillDown).toMatchObject({ ordinary: 2, scholar: 1 });
      expect(stillDown.email.error).toContain('Apple Mail을 조회하지 못했습니다');
      expect(stillDown.onDelayed).toHaveBeenCalledOnce();
      const partly = await run([1]);
      expect(partly.email).toMatchObject({ status: 'ready' });
      expect(partly.email).not.toHaveProperty('delayedAccounts');
      expect(partly.onDelayed).toHaveBeenCalledOnce();

      // A changed mailbox is not a slow Mail: no retry and no early follow-up.
      const changed = await run(['mail_account_refresh_required']);
      expect(changed).toMatchObject({ ordinary: 1 });
      expect(changed.onDelayed).not.toHaveBeenCalled();
    } finally {
      service.close();
    }
  });
  it('words a Mail timeout by the stage it reached, with the right particle', async () => {
    const { sourceError } = await import('./live-source-service');
    expect(sourceError(new Error('mail_timeout_mailbox'))).toContain('메일함 응답이 지연되고');
    expect(sourceError(new Error('mail_timeout_metadata'))).toContain('메일 목록 읽기가 지연되고');
    expect(sourceError(new Error('mail_timeout_body'))).toContain('본문 읽기가 지연되고');
    expect(sourceError(new Error('mail_timeout_account'))).toContain('5분 동안 응답하지 않아');
    expect(sourceError(new Error('mail_timeout_account'))).not.toContain('응답가');
  });
  it('routes default recurring collection through multi-source discovery, not chat-only search', async () => {
    const spy = vi.spyOn(discovery, 'searchCollectionPapers').mockResolvedValue([]);
    const service = new LiveSourceService();
    try {
      await service.collect(
        {
          routineId: 'recovery-test',
          live: {
            ...defaultLiveSettings(),
            weather: null,
            mail: null,
            papers: { enabled: true, days: 10, limit: 3, author: '' },
          },
          interest: {
            keywords: [{ term: 'neural networks', weight: 5, synonyms: [] }],
            excluded: [],
          },
        },
        new AbortController().signal,
        () => undefined,
        false,
      );
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      service.close();
      spy.mockRestore();
    }
  });
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
  it('names the provider failure instead of blaming the network, and keeps the stable code', () => {
    const invalid = sourceError(new Error('claude_code_result_invalid'));
    expect(invalid).toContain('claude_code_result_invalid');
    expect(invalid).toContain('실행기');
    expect(invalid).not.toContain('네트워크');
    expect(sourceError(new Error('claude_code_not_connected'))).toContain('Claude Code');
    expect(sourceError(new Error('claude_code_auth_required'))).toContain('로그인');
    // An unknown internal code is still reported; free-form provider text never is.
    expect(sourceError(new Error('some_unmapped_internal_code'))).toContain(
      'some_unmapped_internal_code',
    );
    expect(sourceError(new Error('Private provider sentence with spaces'))).not.toContain(
      'Private provider sentence',
    );
  });
});
