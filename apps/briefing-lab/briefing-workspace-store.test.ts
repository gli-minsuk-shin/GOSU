import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { randomUUID } from 'node:crypto';
const dirs: string[] = [];
it('repairs content-less email summaries instead of treating them as completed ingestion or daily summaries', async () => {
  const { store } = await fixture();
  await owner(() => store.save(profile(), async () => undefined));
  const id = 'a'.repeat(64),
    runId = randomUUID();
  const save = (summary: string, hour: string) =>
    store.saveBriefing(
      'r',
      {
        overview: 'Overview',
        items: [
          {
            id,
            summary,
            importance: 'uncertain',
            importanceReason: 'Priority is uncertain',
            relevance: '',
            action: '',
            evidenceQuote: 'Source',
            equationIds: [],
            figureIds: [],
            memorySuggestion: null,
          },
        ],
      },
      [
        {
          id,
          kind: 'email',
          title: 'Mail',
          readScope: 'mail-preview',
          publishedAt: '2026-09-11T00:00:00Z',
          mailAccount: { id: 'a', name: 'Account', addresses: [] },
        },
      ],
      false,
      undefined,
      undefined,
      runId,
      {
        [id]: {
          version: 1,
          sourceDigest: 'b'.repeat(64),
          contextDigest: 'c'.repeat(64),
          summarizedAt: `2026-09-11T${hour}:00:00Z`,
          reused: false,
        },
      },
    );
  await save('중요도를 판단할 수 없습니다.', '01');
  expect((await owner(() => store.mailReadPlan('r', scope))).excludeKeys).toHaveLength(0);
  expect(await store.dailyItemKeys('r', runId)).toHaveLength(0);
  await save('학과에서 9월 16일 세미나 참석 신청을 안내했습니다.', '02');
  expect((await owner(() => store.mailReadPlan('r', scope))).excludeKeys).toHaveLength(1);
  expect(await store.dailyItemKeys('r', runId)).toHaveLength(1);
});
it('lets old cross-account Message-ID candidates through the normal read plan once without expanding scope', async () => {
  const { store } = await fixture();
  const multi = { ...scope, additionalAccounts: [{ accountId: 'b', mailboxId: 'box-b' }] };
  const p = profile();
  await owner(() => store.save({ ...p, live: { ...p.live, mail: multi } }, async () => undefined));
  const save = (checked: boolean) =>
    store.saveBriefing(
      'r',
      {
        overview: 'Summary',
        items: ['a', 'b'].map((id) => ({
          id: id.repeat(64),
          summary: 'Same preview',
          importance: 'medium' as const,
          importanceReason: '',
          relevance: '',
          action: '',
          evidenceQuote: 'Source',
          equationIds: [],
          figureIds: [],
          memorySuggestion: null,
        })),
      },
      ['a', 'b'].map((id) => ({
        id: id.repeat(64),
        title: 'Same subject',
        kind: 'email',
        readScope: 'mail-preview',
        mailAccount: { id, name: id, addresses: [] },
        publishedAt: '2026-09-11T00:00:00Z',
        mailMessageUrl: 'message://%3Csame%40example.test%3E',
        ...(checked ? { mailDuplicateCheckedAt: '2026-09-11T01:00:00Z' } : {}),
      })),
    );
  await save(false);
  const pending = await owner(() => store.mailReadPlan('r', multi));
  expect(pending.recheckCount).toBe(2);
  expect(pending.excludeKeys).toHaveLength(0);
  await save(true);
  const finished = await owner(() => store.mailReadPlan('r', multi));
  expect(finished.recheckCount).toBeUndefined();
  expect(finished.excludeKeys).toHaveLength(2);
});
it('retains verified copies encrypted and skips every successfully summarized account copy after restart', async () => {
  const { store, dir } = await fixture();
  await owner(() => store.save(profile(), async () => undefined));
  const copies = ['a', 'b'].map((a) => ({
    id: a.repeat(64),
    title: 'Mail',
    receivedAt: '2026-09-11T00:00:00Z',
    account: { id: a, name: a, addresses: [] },
  }));
  const proof = {
    version: 1 as const,
    digest: 'c'.repeat(64),
    previewDigest: 'd'.repeat(64),
    length: 100,
  };
  await store.saveBriefing(
    'r',
    {
      overview: 'Overview',
      items: [
        {
          id: copies[0]!.id,
          summary: 'Saved summary',
          importance: 'medium',
          importanceReason: '',
          relevance: '',
          action: '',
          evidenceQuote: 'Mail',
          equationIds: [],
          figureIds: [],
          memorySuggestion: null,
        },
      ],
    },
    [
      {
        id: copies[0]!.id,
        title: 'Mail',
        kind: 'email',
        readScope: 'mail-preview',
        mailAccount: copies[0]!.account,
        publishedAt: copies[0]!.receivedAt,
        mailContentProof: proof,
        mailCopies: copies,
      },
    ],
  );
  const reopened = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
  expect((await reopened.history('r'))[0]!.items[0]!.mailCopies).toHaveLength(2);
  expect((await reopened.history('r'))[0]!.items[0]!.mailContentProof).toEqual(proof);
  const plan = await owner(() => reopened.mailReadPlan('r', scope));
  expect(plan.excludeKeys).toHaveLength(2);
});
it('persists Scholar discovery provenance as private paper metadata across restart', async () => {
  const { store, dir } = await fixture();
  await store.saveBriefing(
    'r',
    {
      overview: 'Alert overview',
      items: [
        {
          id: 's',
          summary: 'Alert excerpt',
          importance: 'medium',
          importanceReason: '',
          relevance: '',
          action: '',
          evidenceQuote: 'excerpt',
          equationIds: [],
          figureIds: [],
          memorySuggestion: null,
        },
      ],
    },
    [
      {
        id: 's',
        kind: 'papers',
        title: 'Scholar paper',
        readScope: 'mail-preview',
        privateOrigin: 'mail',
        discoverySource: 'google-scholar-alert',
      },
    ],
  );
  const reopened = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
  const history = await reopened.history('r');
  expect(history[0]?.private).toBe(true);
  expect(history[0]?.items[0]).toMatchObject({
    kind: 'papers',
    discoverySource: 'google-scholar-alert',
  });
});
it('persists controlled tags and reuses them across summaries and restart while preserving raw keywords', async () => {
  const { store, dir } = await fixture();
  const save = (id: string, keywords: string[]) =>
    store.saveBriefing(
      'r',
      {
        overview: 'Saved',
        items: [
          {
            id,
            summary: 'Original summary',
            keywords,
            importance: 'high',
            importanceReason: '',
            relevance: '',
            action: '',
            evidenceQuote: 'source',
            equationIds: [],
            figureIds: [],
            memorySuggestion: null,
          },
        ],
      },
      [{ id, title: 'Paper', kind: 'papers', readScope: 'abstract' }],
    );
  await save('a', ['LLM', 'large language models']);
  await save('b', ['대규모 언어 모델', 'New concept', 'Another candidate']);
  const reopened = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
  const h = await reopened.history('r');
  expect(h[0]?.items[0]?.tags).toEqual(['Large language models', 'New concept']);
  expect(h[0]?.items[0]?.keywords).toEqual([
    '대규모 언어 모델',
    'New concept',
    'Another candidate',
  ]);
  expect(h[1]?.items[0]?.tags).toEqual(['Large language models']);
  expect(h[0]?.items[0]?.summary).toBe('Original summary');
});
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const scope = {
  accountId: 'a',
  mailboxId: 'box',
  days: 3,
  limit: 10,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: true,
};
const profile = () => ({
  routineId: 'r',
  name: 'Research',
  timeZone: 'Asia/Seoul',
  live: { ...defaultLiveSettings(), mail: scope },
  interest: { keywords: [], excluded: [] },
  preferences: {
    ...defaultAssistantPreferences(),
    mailRead: true,
    mailAi: true,
    calendarRead: true,
    calendarIds: ['cal'],
  },
});
const owner = <T>(f: () => T) => briefingClientContext.run('a'.repeat(64), f);
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-workspace-test-'));
  dirs.push(dir);
  return { dir, store: new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7)) };
}
it('archives full weather and displayed agenda encrypted without mail bodies or calendar notes, and rejects revoked commits', async () => {
  const { dir, store } = await fixture();
  const p = await owner(() => store.save(profile(), async () => undefined));
  const runId = randomUUID(),
    signal = new AbortController().signal;
  const weather = {
    city: 'Saved city',
    timeZone: 'Asia/Seoul',
    localDate: '2026-09-09',
    currentTime: '2026-09-09T00:00:00Z',
    temperature: 20,
    code: 3,
    wind: 5,
    hours: Array.from({ length: 24 }, (_, i) => ({
      time: 1788912000 + i * 3600,
      temperature: 20,
      apparent: 20,
      precipitation: i,
      code: 3,
    })),
  };
  await store.saveCollection(
    'r',
    runId,
    [
      {
        kind: 'weather',
        status: 'ready',
        fetchedAt: '2026-09-09T00:00:00Z',
        items: [
          {
            id: 'weather',
            kind: 'weather',
            title: 'Weather',
            text: '',
            source: 'fixture',
            readScope: 'forecast',
            details: [],
            weather,
          },
        ],
        note: '',
      },
      {
        kind: 'email',
        status: 'ready',
        fetchedAt: '2026-09-09T00:00:00Z',
        items: [
          {
            id: 'mail',
            kind: 'email',
            title: 'Private mail title',
            text: 'NEVER_ARCHIVE_RAW_BODY',
            source: 'fixture',
            readScope: 'mail-preview',
            details: [],
          },
        ],
        note: '',
      },
    ],
    p,
    signal,
  );
  await store.saveAgendaSnapshot(
    'r',
    runId,
    [
      {
        title: 'Saved meeting',
        start: '2026-09-09T01:00:00Z',
        end: '2026-09-09T02:00:00Z',
        timeZone: 'Asia/Seoul',
        allDay: false,
        location: 'Room',
        ...{ notes: 'NEVER_ARCHIVE_NOTES', id: 'private-id' },
      },
    ],
    p,
    signal,
  );
  const saved = await new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7)).history('r');
  expect(saved[0]!.snapshot!.weather!.hours).toHaveLength(24);
  expect(saved[0]!.snapshot!.calendar![0]!.title).toBe('Saved meeting');
  expect(saved[0]!.private).toBe(true);
  expect(JSON.stringify(saved)).not.toMatch(/NEVER_ARCHIVE|Private mail title/);
  expect(saved[0]!.snapshot!.calendar![0]!.id).toBe('private-id');
  expect(await readFile(join(dir, 'workspace.v1.enc.json'), 'utf8')).not.toContain('private-id');
  expect(await readFile(join(dir, 'workspace.v1.enc.json'), 'utf8')).not.toContain('Saved city');
  await owner(() =>
    store.save(
      { ...profile(), preferences: { ...profile().preferences, calendarRead: false } },
      async () => undefined,
    ),
  );
  await expect(store.saveAgendaSnapshot('r', runId, [], p, signal)).rejects.toThrow(
    'settings_changed',
  );
});
it('preserves all prior briefing runs and batches after new runs and encrypted restart', async () => {
  const { store, dir } = await fixture();
  for (let i = 0; i < 61; i++) {
    const id = randomUUID();
    await store.saveCollection('r', id, [], null, new AbortController().signal);
    await store.saveBriefing('r', { overview: `Batch ${i}`, items: [] }, [], false, null, 0, id);
  }
  const history = await store.history('r', '', 600);
  expect(new Set(history.map((h) => h.runId)).size).toBe(61);
  expect(history).toHaveLength(122);
  expect(history.filter((h) => h.snapshot)).toHaveLength(61);
  expect(history.some((h) => h.answer === 'Batch 0')).toBe(true);
  const reopened = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
  expect(await reopened.history('r', '', 600)).toEqual(history);
});
it('pages beyond 600 records without deleting older briefings', async () => {
  const { store } = await fixture();
  for (let n = 0; n < 603; n++)
    await store.saveBriefing('r', { overview: `Record ${n}`, items: [] }, []);
  const recent = await store.history('r', '', 600);
  const older = await store.history('r', '', 600, 600);
  expect(recent).toHaveLength(600);
  expect(older.map((h) => h.answer)).toEqual(['Record 2', 'Record 1', 'Record 0']);
  expect(recent[0]?.answer).toBe('Record 602');
  expect(await store.history('other', '', 600, 600)).toEqual([]);
});
it('persists approved scope encrypted, binds to browser, and reuses after restart without per-turn approval', async () => {
  const { dir, store } = await fixture(),
    approve = vi.fn(async () => undefined);
  await owner(() => store.save(profile(), approve));
  const second = new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7));
  await owner(() => second.assertMail('r', scope, true, 'codex'));
  await owner(() => second.save(profile(), approve));
  expect(approve).toHaveBeenCalledOnce();
  await expect(
    briefingClientContext.run('b'.repeat(64), () => second.assertMail('r', scope)),
  ).rejects.toThrow('permission');
  expect(await readFile(join(dir, 'workspace.v1.enc.json'), 'utf8')).not.toContain('Research');
  expect((await stat(join(dir, 'workspace.v1.enc.json'))).mode & 0o777).toBe(0o600);
});
it('does not inherit global project access from old private-AI grants and requires explicit scope approval', async () => {
  const { store } = await fixture();
  await owner(async () => {
    await store.save(profile(), async () => {});
    const original = await store.profile('r');
    expect(original?.preferences.projectRead).toBeUndefined();
    const next = { ...profile(), preferences: { ...profile().preferences, projectRead: true } };
    await expect(
      store.save(next, async () => {
        throw new Error('declined');
      }),
    ).rejects.toThrow('declined');
    expect((await store.profile('r'))?.approvedScope).toBe(original?.approvedScope);
    expect((await store.profile('r'))?.preferences.projectRead).toBeUndefined();
    const approve = vi.fn(async () => {});
    await store.save(next, approve);
    expect(approve).toHaveBeenCalledWith(expect.stringContaining('모든 활성 프로젝트'));
    const saved = await store.profile('r');
    expect(saved?.preferences.projectRead).toBe(true);
    expect(saved?.approvedScope).not.toBe(original?.approvedScope);
    await store.save(next, approve);
    expect(approve).toHaveBeenCalledOnce();
  });
});
it('requires confirmation for wider mail scope, added calendar, or changed AI provider; stopping immediately revokes', async () => {
  const { store } = await fixture(),
    approve = vi.fn(async () => undefined);
  await owner(async () => {
    await store.save(profile(), approve);
    const wider = profile();
    wider.live.mail.days = 10;
    await store.save(wider, approve);
    expect(approve).toHaveBeenCalledTimes(2);
    const off = {
      ...wider,
      preferences: { ...wider.preferences, mailRead: false, mailAi: false, calendarRead: false },
    };
    await store.save(off, approve);
    expect(approve).toHaveBeenCalledTimes(2);
    await expect(store.assertMail('r', scope, true, 'codex')).rejects.toThrow();
    expect(await store.canPrivateAi('r', 'codex')).toBe(false);
    await expect(store.assertCalendar('r', ['cal'])).rejects.toThrow();
  });
});
it('does not apply denied approval or accept private scope from another client without approval', async () => {
  const { store } = await fixture();
  await owner(() => store.save(profile(), async () => undefined));
  await expect(
    briefingClientContext.run('b'.repeat(64), () =>
      store.save({ ...profile(), name: 'changed' }, async () => {
        throw new Error('denied');
      }),
    ),
  ).rejects.toThrow('denied');
  expect((await store.profile('r'))?.name).toBe('Research');
});
it('atomically claims one pending calendar action and preserves uncertain outcome across restarts', async () => {
  const { store, dir } = await fixture();
  const action = await store.action({
    routineId: 'r',
    kind: 'create',
    eventId: null,
    fingerprint: null,
    draft: {
      calendarId: 'cal',
      title: 'Review',
      start: '2026-09-09T01:00:00Z',
      end: '2026-09-09T02:00:00Z',
      timeZone: 'Asia/Seoul',
      allDay: false,
      location: '',
      notes: '',
      alarmMinutes: 10,
    },
  });
  const results = await Promise.allSettled([
    store.transition(action.id, 'pending', 'applying'),
    store.transition(action.id, 'pending', 'applying'),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  await store.transition(action.id, 'applying', 'unknown');
  expect(
    (
      await new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7)).getAction(
        action.id,
        'r',
      )
    )?.state,
  ).toBe('unknown');
  expect(await store.getAction(action.id, 'other')).toBeNull();
});
it('persists expandable paper detail, keywords and exact equations while excluding email research framing', async () => {
  const { store, dir } = await fixture();
  const base = {
    summary: 'Compact summary',
    importance: 'high' as const,
    importanceReason: 'Read first',
    relevance: 'Research relation',
    action: 'Reply by Friday',
    evidenceQuote: 'Source',
    equationIds: ['e1'],
    equationExplanations: [{ equationId: 'e1', explanation: 'Loss definition' }],
    figureIds: [],
    memorySuggestion: null,
    keywords: ['Optimization'],
    detail: 'A longer source-backed method explanation',
    researchQuestion: 'Does the method improve convergence?',
    strengths: 'Clear optimization setup.',
    limitations: 'The source does not establish external validity.',
    methodsAndAssumptions: 'It assumes the stated loss is differentiable.',
    reportedResults: 'The paper reports faster convergence.',
  };
  await store.saveBriefing(
    'r',
    {
      overview: 'Overview',
      items: [
        { ...base, id: 'p' },
        { ...base, id: 'm' },
      ],
    },
    [
      {
        id: 'p',
        kind: 'papers',
        title: 'Paper',
        readScope: 'abstract',
        paper: {
          readScope: 'html-excerpt',
          excerpt: 'Source',
          equations: [{ id: 'e1', latex: 'L=x^2' }],
          figures: [],
          sourceUrl: 'https://arxiv.org/html/test',
          note: 'Partial source',
        },
      },
      {
        id: 'm',
        kind: 'email',
        title: 'Mail',
        readScope: 'mail-preview',
        mailMessageUrl: 'message://%3Cstored-message%40example.test%3E',
        mailAccount: { id: 'saved-account', name: 'Google', addresses: ['work@example.test'] },
        mailUnread: false,
        publishedAt: '2026-09-08T04:22:00Z',
      },
    ],
  );
  const history = await new BriefingWorkspaceStore(dir, async () => Buffer.alloc(32, 7)).history(
    'r',
  );
  expect(history[0]?.items[0]).toMatchObject({
    kind: 'papers',
    keywords: ['Optimization'],
    detail: base.detail,
    researchQuestion: base.researchQuestion,
    limitations: base.limitations,
    equations: [{ latex: 'L=x^2', explanation: 'Loss definition' }],
  });
  expect(history[0]?.items[1]).toMatchObject({
    kind: 'email',
    relevance: '',
    detail: '',
    equations: [],
    mailMessageUrl: 'message://%3Cstored-message%40example.test%3E',
    mailAccount: { id: 'saved-account', name: 'Google', addresses: ['work@example.test'] },
    receivedAt: '2026-09-08T04:22:00Z',
    mailUnread: false,
  });
  expect(await readFile(join(dir, 'workspace.v1.enc.json'), 'utf8')).not.toContain(
    'stored-message',
  );
  expect(await readFile(join(dir, 'workspace.v1.enc.json'), 'utf8')).not.toContain(
    'work@example.test',
  );
});
