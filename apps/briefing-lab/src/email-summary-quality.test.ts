import { expect, it } from 'vitest';
import { isPriorityOnlyEmailSummary, latestSummaryItems } from './email-summary-quality';
it('rejects priority boilerplate without rejecting concrete content or uncertain priorities', () => {
  for (const s of [
    '   ',
    '중요도를 판단할 수 없습니다.',
    '**중요도 판단 보류**',
    '중요도 판별 안됨',
    '제공된 정보만으로는 중요도를 판단하기 어렵습니다.',
    'Priority is unknown.',
  ])
    expect(isPriorityOnlyEmailSummary(s), s).toBe(true);
  for (const s of [
    '학과에서 세미나 참석 신청을 안내했습니다. 회신 기한은 없습니다.',
    '보고서가 첨부되었다는 안내입니다. 중요도는 판단할 수 없습니다.',
    '중요도 분류 모델의 실험 결과를 전달했습니다.',
  ])
    expect(isPriorityOnlyEmailSummary(s), s).toBe(false);
});
it('selects the latest correction instead of repeatedly reprocessing an older bad summary', () => {
  const old = { id: 'm', kind: 'email', readScope: 'mail-preview', summary: '중요도 판단 보류' };
  const fixed = {
    ...old,
    summary: '세미나 참석 신청 안내입니다.',
    provenance: { summarizedAt: '2026-09-11T02:00:00Z' },
  };
  expect(
    latestSummaryItems([
      { createdAt: '2026-09-11T00:00:00Z', items: [old] },
      { createdAt: '2026-09-11T01:00:00Z', items: [fixed] },
    ]),
  ).toEqual([fixed]);
});
