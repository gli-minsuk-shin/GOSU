import { expect, it } from 'vitest';
import { recoverLegacyEmailTask } from './legacy-email-task';
const source = {
  title: '[학과] 2027-1학기 과목개설조사 (회신기한: 9/21일 (월) 12:00)',
  summary: '9월 21일 12시까지 회신하세요.',
  receivedAt: '2026-09-14T02:00:00Z',
  timeZone: 'Asia/Seoul',
};
it('recovers the screenshot-shaped deadline using receipt year, not the semester year', () => {
  expect(recoverLegacyEmailTask(source)).toMatchObject({
    dueDate: '2026-09-21',
    dueAt: '2026-09-21T03:00:00Z',
    timeZone: 'Asia/Seoul',
  });
});
it.each([
  { title: '안내', summary: '곧 회신해주세요.' },
  { title: '회신 기한 9/21 12:00', summary: '회신 기한 9/22 12:00' },
  { title: '회신 기한 9/21 12:00', summary: '회신 기한 9/21 15:00' },
  { title: '회신 기한 2/30 12:00', summary: '' },
  { title: '회의 9/21 12:00', summary: '행사 안내입니다.' },
  { title: '회신 기한 9/21 (화) 12:00', summary: '' },
  { title: '회신 기한 1/1 12:00', summary: '' },
  { title: '회신 기한 https://example.org/2026/09/21', summary: '' },
])('does not invent or choose ambiguous deadlines', (v) =>
  expect(recoverLegacyEmailTask({ ...source, ...v })).toBeNull(),
);
it('preserves date-only deadlines and refuses an unanchored year', () => {
  expect(recoverLegacyEmailTask({ ...source, title: '회신 기한 9/21', summary: '' })).toMatchObject(
    { dueDate: '2026-09-21', dueAt: null },
  );
  expect(recoverLegacyEmailTask({ ...source, receivedAt: undefined })).toBeNull();
});
it('handles explicit afternoon and a midnight UTC date boundary', () => {
  expect(
    recoverLegacyEmailTask({ ...source, title: '제출 기한 9/21 오후 3시 30분', summary: '' })
      ?.dueAt,
  ).toBe('2026-09-21T06:30:00Z');
  expect(
    recoverLegacyEmailTask({ ...source, title: '제출 기한 9/21 00:15', summary: '' })?.dueAt,
  ).toBe('2026-09-20T15:15:00Z');
});
