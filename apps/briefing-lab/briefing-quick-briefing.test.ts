import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  QUICK_BRIEFING_INSTRUCTIONS,
  QUICK_BRIEFING_UPDATE_INSTRUCTIONS,
  draftQuickBriefing,
  mergeQuickBriefingUpdate,
  quickBriefingInstructions,
  quickBriefingPayload,
} from './briefing-quick-briefing';
import { BriefingQuickFirst } from './src/briefing-quick-first';
import type { LiveItem } from './src/live-types';

const mail = (index: number, readScope: LiveItem['readScope']): LiveItem => ({
  id: `m${index}`,
  kind: 'email',
  title: `Subject ${index}`,
  text: `Preview ${index} `.repeat(40),
  source: 'Apple Mail · 읽기 전용',
  publishedAt: new Date(Date.UTC(2026, 8, 17, 0, index)).toISOString(),
  mailUnread: true,
  mailAccount: { id: 'a', name: 'Gmail', addresses: [] },
  readScope,
  details: [`Sender ${index}`, '읽지 않음'],
});

it('sends newest mail metadata first, bounded, with previews only from read bodies', () => {
  const emails = Array.from({ length: 90 }, (_, i) =>
    mail(i, i % 2 ? 'mail-preview' : 'mail-metadata'),
  );
  const payload = quickBriefingPayload({
    emails,
    papers: [],
    agenda: [],
    timeZone: 'Asia/Seoul',
    now: Date.UTC(2026, 8, 17, 3),
  });
  expect(payload.newEmailCount).toBe(90);
  expect(payload.emails).toHaveLength(80);
  expect(payload.emails[0]).toMatchObject({
    subject: 'Subject 89',
    sender: 'Sender 89',
    account: 'Gmail',
  });
  expect(payload.emails[0]!.preview!.length).toBeLessThanOrEqual(200);
  expect(payload.emails[1]!.preview).toBeNull();
  expect(QUICK_BRIEFING_INSTRUCTIONS).toContain('UNTRUSTED DATA');
});

it('passes the user guidance and keeps mail from a listed address even beyond the newest 80', () => {
  const emails = Array.from({ length: 90 }, (_, i) => mail(i, 'mail-metadata'));
  emails[0] = { ...emails[0]!, details: ['연구처 <office@research.yonsei.ac.kr>', '읽지 않음'] };
  const payload = quickBriefingPayload({
    emails,
    papers: [],
    agenda: [],
    timeZone: 'Asia/Seoul',
    now: Date.UTC(2026, 8, 17, 3),
    guidance: [{ id: 'g', text: 'yonsei.ac.kr 메일은 반드시 먼저 알려줘' }],
  });
  expect(payload.userGuidance).toEqual(['yonsei.ac.kr 메일은 반드시 먼저 알려줘']);
  expect(payload.emails).toHaveLength(80);
  const kept = payload.emails.find((e) => e.subject === 'Subject 0');
  expect(kept).toMatchObject({ matchesUserGuidance: true });
  expect(payload.emails.filter((e) => 'matchesUserGuidance' in e)).toHaveLength(1);
  // Still newest first.
  expect(payload.emails[0]!.subject).toBe('Subject 89');
  expect(payload.emails.at(-1)!.subject).toBe('Subject 0');
  expect(quickBriefingInstructions(true)).toContain('userGuidance');
  expect(quickBriefingInstructions(false)).toBe(QUICK_BRIEFING_INSTRUCTIONS);
  const plain = quickBriefingPayload({
    emails,
    papers: [],
    agenda: [],
    timeZone: 'Asia/Seoul',
    now: Date.UTC(2026, 8, 17, 3),
  });
  expect(plain).not.toHaveProperty('userGuidance');
});

const morning = {
  createdAt: '2026-09-21T00:05:00.000Z',
  headline: '새 메일 12통 · 학과장 회신이 먼저입니다.',
  points: ['**학과장** 예산 회신 요청 (오늘 마감)', '세미나 일정 변경 안내', '뉴스레터 5건'],
};

it('continues the briefing already sent earlier the same day instead of starting over', async () => {
  // The morning run stays a plain briefing: same instructions, no previousBriefing.
  expect(quickBriefingInstructions(false)).toBe(QUICK_BRIEFING_INSTRUCTIONS);
  const first = quickBriefingPayload({
    emails: [mail(1, 'mail-preview')],
    papers: [],
    agenda: [],
    timeZone: 'Asia/Seoul',
    now: Date.UTC(2026, 8, 21, 0, 0),
  });
  expect('previousBriefing' in first).toBe(false);
  // A later run is told what the recipient already read, at what local time, and to update it.
  const payload = quickBriefingPayload({
    emails: [mail(2, 'mail-preview')],
    papers: [],
    agenda: [],
    timeZone: 'Asia/Seoul',
    now: Date.UTC(2026, 8, 21, 4, 0),
    previous: morning,
  });
  expect(payload.previousBriefing).toEqual({
    at: '09:05',
    headline: morning.headline,
    points: morning.points,
  });
  expect(quickBriefingInstructions(false, true)).toContain(QUICK_BRIEFING_UPDATE_INSTRUCTIONS);
  expect(QUICK_BRIEFING_UPDATE_INSTRUCTIONS).toContain('do not start over');
  expect(QUICK_BRIEFING_UPDATE_INSTRUCTIONS).toContain('carriedPoints');

  const run = vi.fn(
    async (_input: unknown, _signal: unknown, _progress: unknown, options: unknown) => {
      const job = (
        options as { structuredJob: { instructions: string; schema: { properties: object } } }
      ).structuredJob;
      expect(job.instructions).toContain('previousBriefing is the briefing this recipient already');
      expect(Object.keys(job.schema.properties).sort()).toEqual([
        'carriedPoints',
        'headline',
        'newPoints',
      ]);
      return {
        answer: JSON.stringify({
          headline: '09:05 이후 새 메일 1통 · 학과장이 마감을 내일로 미뤘습니다.',
          newPoints: ['**학과장** 예산 회신 마감이 내일로 변경'],
          carriedPoints: ['세미나 일정 변경 안내', '뉴스레터 5건'],
        }),
        model: 'fixture',
      };
    },
  );
  const draft = await draftQuickBriefing(
    {
      emails: [mail(2, 'mail-preview')],
      papers: [],
      agenda: [],
      timeZone: 'Asia/Seoul',
      now: Date.UTC(2026, 8, 21, 4, 0),
      previous: morning,
    },
    { providerId: 'codex', modelId: 'fixture', reasoning: null },
    new AbortController().signal,
    async () => undefined,
    run as never,
  );
  expect(draft).toMatchObject({
    points: ['**학과장** 예산 회신 마감이 내일로 변경', '세미나 일정 변경 안내', '뉴스레터 5건'],
    newPoints: 1,
    previousAt: morning.createdAt,
  });
});

it('never lets an update erase the earlier briefing, and keeps it within eight lines', () => {
  // A model that forgets to carry anything over does not delete the morning's lines.
  expect(
    mergeQuickBriefingUpdate({ headline: 'h', newPoints: ['새 항목'], carriedPoints: [] }, morning),
  ).toEqual({
    headline: 'h',
    points: ['새 항목', ...morning.points],
    previousAt: morning.createdAt,
    newPoints: 1,
  });
  // Nothing new: the earlier lines stand, none of them marked new.
  expect(
    mergeQuickBriefingUpdate({ headline: 'h', newPoints: [], carriedPoints: [] }, morning),
  ).toMatchObject({ points: morning.points, newPoints: 0 });
  // A repeated line is kept once, and new lines win the eight places.
  const crowded = mergeQuickBriefingUpdate(
    {
      headline: 'h',
      newPoints: ['a', 'b', 'c', 'd', 'e', 'f'],
      carriedPoints: ['a', 'p', 'q', 'r', 's'],
    },
    morning,
  );
  expect(crowded.points).toEqual(['a', 'b', 'c', 'd', 'e', 'p', 'q', 'r']);
  expect(crowded.newPoints).toBe(5);
});

it('marks what is new in the saved update and says which briefing it continues', () => {
  const html = renderToStaticMarkup(
    createElement(BriefingQuickFirst, {
      timeZone: 'Asia/Seoul',
      value: {
        createdAt: '2026-09-21T04:00:00.000Z',
        model: 'fixture',
        headline: '09:05 이후 새 메일 1통',
        points: ['학과장 마감 변경', '세미나 일정 변경 안내'],
        emailCount: 13,
        paperCount: 0,
        previousAt: morning.createdAt,
        newPoints: 1,
      },
    }),
  );
  expect(html).toContain('오늘 누적');
  expect(html).toContain('브리핑에 이어서 업데이트');
  expect(html).toMatch(/<li class="is-new"><span class="briefing-quick-first-new">새로<\/span>/u);
  expect(html).toContain('<li class="is-carried">');
  // A first briefing of the day looks as before.
  const plain = renderToStaticMarkup(
    createElement(BriefingQuickFirst, {
      value: { ...morning, model: 'fixture', emailCount: 12, paperCount: 0 },
    }),
  );
  expect(plain).not.toContain('새로');
  expect(plain).not.toContain('오늘 누적');
  // The run reads today's record before drafting and saves the whole day's counts.
  const service = readFileSync(new URL('./live-source-service.ts', import.meta.url), 'utf8');
  expect(service).toContain(
    'const previous = await this.workspace.dailyQuickBriefing(profile.routineId, options.runId);',
  );
  expect(service).toContain('emailCount: options.emails.length + (previous?.emailCount ?? 0),');
});
