import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EmailPreparedActionsSchema } from './email-prepared-actions';
import {
  chatTaskDraft,
  formatBriefingEventRange,
  formatBriefingEvidence,
  hasExistingCalendarEvent,
} from './briefing-chat';

const proposal = {
  title: '학부 수통 강의',
  start: '2026-09-09T13:00:00+09:00',
  end: '2026-09-09T14:00:00+09:00',
  allDay: false,
  timeZone: 'Asia/Seoul',
  location: '',
  notes: '',
  alarmMinutes: null,
  sourceId: 'event-1',
  evidence: '',
  reason: '',
};

it('formats Calendar proposal times and evidence for people, not ISO transport strings', () => {
  expect(formatBriefingEventRange(proposal.start, proposal.end, proposal.timeZone)).toMatch(
    /9[.월]\s*9/,
  );
  expect(formatBriefingEventRange(proposal.start, proposal.end, proposal.timeZone)).toContain(
    '13:00',
  );
  expect(formatBriefingEventRange(proposal.start, proposal.end, proposal.timeZone)).toContain(
    '14:00',
  );
  expect(
    formatBriefingEvidence(
      '캘린더에 2026-09-09T04:00:00Z~2026-09-09T05:00:00Z로 등록됨',
      'Asia/Seoul',
    ),
  ).toContain('13:00');
});

it('detects an existing Calendar event so the UI can suppress duplicate-add actions', () => {
  expect(
    hasExistingCalendarEvent(
      [{ id: 'event-1', title: '학부 수통 강의', kind: 'calendar' }],
      proposal,
    ),
  ).toBe(true);
  expect(
    hasExistingCalendarEvent([{ id: 'event-2', title: '다른 일정', kind: 'calendar' }], proposal),
  ).toBe(false);
});

it('turns a chat task proposal into the reviewed to-do dialog draft, and offers it on the card', () => {
  const task = {
    title: '리뷰 답장 작성',
    description: '리뷰어 2의 질문에 답한다.',
    deadline: '2026-09-22T18:00:00+09:00',
    target: 'kanban' as const,
    sourceId: null,
  };
  const draft = chatTaskDraft(task, 'Asia/Seoul');
  expect(draft).toMatchObject({
    title: '리뷰 답장 작성',
    notes: '리뷰어 2의 질문에 답한다.',
    dueDate: '2026-09-22',
    dueAt: '2026-09-22T18:00:00+09:00',
    timeZone: 'Asia/Seoul',
  });
  // It is a valid prepared task, so the dialog opens without another AI call.
  expect(EmailPreparedActionsSchema.parse({ event: null, task: draft }).task).toEqual(draft);
  expect(chatTaskDraft({ ...task, deadline: '다음 주' }, 'Asia/Seoul')).toMatchObject({
    dueDate: null,
    dueAt: null,
  });
  expect(chatTaskDraft({ ...task, deadline: '2026-09-22' }, 'Asia/Seoul')).toMatchObject({
    dueDate: '2026-09-22',
    dueAt: null,
  });
  expect(chatTaskDraft({ ...task, title: 'x' }, 'Asia/Seoul').title).toBe('할 일: x');
  const source = readFileSync(new URL('./briefing-chat.tsx', import.meta.url), 'utf8');
  expect(source).toMatch(
    /<BriefingTodoButton[\s\S]*?preparedTask=\{chatTaskDraft\(t, routine\.schedule\.timeZone\)\}/u,
  );
});
