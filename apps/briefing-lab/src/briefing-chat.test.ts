import { expect, it } from 'vitest';
import {
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
