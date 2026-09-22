import { describe, expect, it, vi } from 'vitest';
import { Temporal } from 'temporal-polyfill';
import { createBriefingHostReads, hostCalendarWindow } from './briefing-host-reads';
import type { AssistantProfile } from './briefing-workspace-store';

const profile = {
  routineId: 'r1',
  name: 'Personal',
  timeZone: 'Asia/Seoul',
  live: { mail: { accounts: ['a'], days: 3, limit: 20 } },
  preferences: { mailRead: true, mailAi: true, calendarRead: true, calendarIds: ['cal-1'] },
} as unknown as AssistantProfile;

const paper = (id: string, isPrivate = false) => ({
  historyId: `h-${id}`,
  savedAt: '2026-09-18T00:00:00Z',
  private: isPrivate,
  item: {
    id,
    title: `Paper ${id}`,
    summary: 'Short summary.',
    readScope: 'abstract',
    sourceUrl: 'https://arxiv.org/abs/1',
    researchQuestion: 'RQ',
    strengths: 'S',
    limitations: 'L',
    methodsAndAssumptions: 'M',
    reportedResults: 'R',
    detail: 'D',
  },
});

const briefing = (id: string, isPrivate = false) => ({
  id,
  routineId: 'r1',
  runId: 'run-1',
  createdAt: '2026-09-19T00:00:00Z',
  private: isPrivate,
  answer: 'Answer '.repeat(200),
  items: [
    {
      id: `${id}-item`,
      kind: 'email',
      title: 'Committee schedule',
      summary: 'Pick a slot. '.repeat(200),
      readScope: 'mail-preview',
      importance: 'high',
      action: 'reply',
      sourceUrl: '',
    },
  ],
});

function setup(overrides: Record<string, unknown> = {}) {
  const consent = vi.fn(async () => undefined);
  const assert = vi.fn(async () => undefined);
  const deps = {
    profile: vi.fn(async () => profile as AssistantProfile | null),
    assert,
    privateAllowed: () => true,
    requiresConfirmation: () => false,
    consent,
    calendar: vi.fn(async () => ({
      events: Array.from({ length: 40 }, (_value, index) => ({
        id: `e${index}`,
        title: `Event ${index}`,
        start: '2026-09-20T01:00:00Z',
        end: '2026-09-20T02:00:00Z',
        allDay: false,
        location: 'x'.repeat(400),
      })),
    })),
    mail: vi.fn(async () => ({
      note: 'unread only',
      items: Array.from({ length: 9 }, (_value, index) => ({
        id: `m${index}`,
        title: `Mail ${index}`,
        text: 'body '.repeat(600),
        mailUnread: true,
        details: ['sender@example.test'],
        publishedAt: '2026-09-19T01:00:00Z',
        kind: 'email',
        source: 'mail',
        readScope: 'mail-preview',
      })),
    })),
    briefings: vi.fn(async () => [briefing('h1')]),
    briefingRecord: vi.fn(async () => briefing('h1')),
    savedPapers: vi.fn(async () => ({ papers: [paper('p1'), paper('p2')], privateOmitted: false })),
    ...overrides,
  };
  return { deps, reads: createBriefingHostReads(deps as never), consent, assert };
}
const signal = new AbortController().signal;

describe('briefing reads for the GOSU host', () => {
  it('reads the approved calendar window and bounds what the chat sees', async () => {
    const { reads, deps } = setup();
    const result = (await reads.calendar({}, '프로젝트 채팅(FM-LM)', signal)) as {
      events: unknown[];
      limited: boolean;
      from: string;
      to: string;
      note: string;
    };
    expect(result.events).toHaveLength(30);
    expect(result.limited).toBe(true);
    expect(result.note).toContain('cannot create or change events');
    expect(JSON.stringify(result.events[0])).toContain('x'.repeat(300));
    expect(JSON.stringify(result.events[0])).not.toContain('x'.repeat(301));
    // Two days from the start of today in the routine timezone, upper bound exclusive.
    const window = hostCalendarWindow(
      'Asia/Seoul',
      {},
      Temporal.Instant.from('2026-09-20T13:00:00Z'),
    );
    expect(window).toEqual({ start: '2026-09-19T15:00:00Z', end: '2026-09-21T15:00:00Z' });
    expect(hostCalendarWindow('Asia/Seoul', { from: '2026-09-21', to: '2026-09-23' })).toEqual({
      start: '2026-09-20T15:00:00Z',
      end: '2026-09-22T15:00:00Z',
    });
    expect(() =>
      hostCalendarWindow('Asia/Seoul', { from: '2026-09-21', to: '2026-09-21' }),
    ).toThrow('assistant_calendar_range');
    expect(() =>
      hostCalendarWindow('Asia/Seoul', { from: '2026-01-01', to: '2026-12-31' }),
    ).toThrow('assistant_calendar_range');
    expect(deps.assert).toHaveBeenCalledWith('calendar', profile);
  });

  it('searches the saved mailbox scope and marks the content untrusted', async () => {
    const { reads, deps } = setup();
    const result = (await reads.mail(
      { query: 'committee', sender: 'chair@example.test' },
      '프로젝트 채팅(FM-LM)',
      signal,
    )) as { messages: { summary: string }[]; note: string; trust: string; scope: string };
    expect(deps.mail).toHaveBeenCalledWith(
      profile,
      { query: 'committee', sender: 'chair@example.test' },
      signal,
    );
    expect(result.messages).toHaveLength(6);
    expect(result.messages[0]!.summary).toHaveLength(1800);
    expect(result.note).toBe('unread only');
    expect(result.trust).toBe('untrusted_mail_content');
    expect(result.scope).toContain('not an exhaustive mailbox search');
  });

  it('reads saved briefings and paper summaries, in short and full form', async () => {
    const { reads } = setup();
    const list = (await reads.briefings({ query: 'committee' }, 'p', signal)) as {
      briefings: { answer: string; items: { summary: string; kind: string }[] }[];
    };
    expect(list.briefings[0]!.answer).toHaveLength(800);
    expect(list.briefings[0]!.items[0]!.kind).toBe('email');
    expect(list.briefings[0]!.items[0]!.summary).toHaveLength(600);
    const full = (await reads.briefings({ historyId: 'h1' }, 'p', signal)) as {
      briefings: { answer: string; items: { summary: string; importance?: string }[] }[];
    };
    expect(full.briefings[0]!.answer.length).toBeGreaterThan(800);
    expect(full.briefings[0]!.items[0]!.importance).toBe('high');
    const papers = (await reads.papers({ query: '' }, 'p', signal)) as {
      papers: { paperId: string; researchQuestion?: string }[];
      total: number;
    };
    expect(papers.papers.map((entry) => entry.paperId)).toEqual(['p1', 'p2']);
    expect(papers.papers[0]!.researchQuestion).toBeUndefined();
    const one = (await reads.papers({ historyId: 'h-p2', paperId: 'p2' }, 'p', signal)) as {
      papers: { paperId: string; researchQuestion?: string }[];
    };
    expect(one.papers).toHaveLength(1);
    expect(one.papers[0]!.researchQuestion).toBe('RQ');
  });

  it('keeps every Briefing permission, confirmation and private-record rule', async () => {
    // A permission that is off in Briefing Lab has no routine to read.
    const off = setup({ profile: vi.fn(async () => null) });
    await expect(off.reads.calendar({}, 'p', signal)).rejects.toThrow(
      'assistant_calendar_permission_required',
    );
    await expect(off.reads.mail({}, 'p', signal)).rejects.toThrow(
      'assistant_mail_permission_required',
    );
    expect(off.deps.calendar).not.toHaveBeenCalled();
    // "Ask every time" confirms before the read, naming the caller.
    const asking = setup({ requiresConfirmation: () => true });
    await asking.reads.mail({}, '프로젝트 채팅(FM-LM)', signal);
    expect(asking.consent).toHaveBeenCalledWith(
      '프로젝트 채팅(FM-LM)이(가) Briefing에 설정된 Apple Mail 범위를 읽습니다. 이번 요청에만 허용할까요?',
      signal,
    );
    const denied = setup({
      requiresConfirmation: () => true,
      consent: vi.fn(async () => {
        throw new Error('native_consent_denied');
      }),
    });
    await expect(denied.reads.calendar({}, 'p', signal)).rejects.toThrow('native_consent_denied');
    expect(denied.deps.calendar).not.toHaveBeenCalled();
    // Private briefings need the saved private-AI permission.
    const privateRecords = setup({
      privateAllowed: () => false,
      briefings: vi.fn(async () => [briefing('h1', true)]),
    });
    await expect(privateRecords.reads.briefings({}, 'p', signal)).rejects.toThrow(
      'assistant_private_ai_required',
    );
    // A settings change during the read fails the call.
    const changed = setup({
      assert: vi.fn(async () => {
        throw new Error('assistant_settings_changed');
      }),
    });
    await expect(changed.reads.calendar({}, 'p', signal)).rejects.toThrow(
      'assistant_settings_changed',
    );
    // A cancelled turn reads nothing.
    const controller = new AbortController();
    controller.abort();
    const cancelled = setup();
    await expect(cancelled.reads.papers({}, 'p', controller.signal)).rejects.toThrow(
      'source_cancelled',
    );
    expect(cancelled.deps.savedPapers).not.toHaveBeenCalled();
  });

  it('reports which reads are available and whether each one asks first', async () => {
    const { reads } = setup();
    expect(await reads.status()).toEqual({
      calendar: true,
      mail: true,
      briefings: true,
      papers: true,
      routineName: 'Personal',
      asksEachTime: false,
    });
    const mailOff = setup({
      profile: vi.fn(async (kind: string) => (kind === 'mail' ? null : profile)),
      requiresConfirmation: () => true,
    });
    expect(await mailOff.reads.status()).toMatchObject({ mail: false, asksEachTime: true });
  });
});
