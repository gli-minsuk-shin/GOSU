import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefingGenerationProgress } from './briefing-generation-progress';
import { GenerationStatusSchema, type GenerationStatus } from './briefing-generation-contract';
const job: GenerationStatus = {
  id: '11111111-1111-4111-8111-111111111111',
  routineId: 'r',
  runId: null,
  state: 'running',
  detail: '논문 요약 중',
  newCount: 6,
  startedAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-10T00:01:00Z',
  error: null,
};
afterEach(() => vi.useRealTimers());
it('defaults to a compact native disclosure while retaining all detailed status inside', () => {
  const html = renderToStaticMarkup(
    <BriefingGenerationProgress
      job={{ ...job, progress: { stage: 'summarize', completed: 6, total: 10 } }}
    />,
  );
  expect(html).toMatch(/^<details /);
  expect(html).not.toContain(' open=');
  const summary = html.split('</summary>')[0];
  expect(summary).toContain('6/10개 저장');
  expect(summary).toContain('브리핑 진행 상세 펼치기 또는 접기');
  expect(summary).not.toContain(job.detail);
  expect(html.split('</summary>')[1]).toContain(job.detail);
  expect(html).toContain('briefing-progress-detail');
});
it('shows only saved summary counts with a scoped progress bar and elapsed time', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T00:01:15Z'));
  const html = renderToStaticMarkup(
    <BriefingGenerationProgress
      job={{ ...job, progress: { stage: 'summarize', completed: 6, total: 10 } }}
    />,
  );
  expect(html).toContain('경과 1분 15초');
  expect(html).toContain('6/10개 요약 저장 · 4개 남음');
  expect(html).toContain('max="10" value="6"');
  expect(html).toContain('AI 요약 진행률');
});
it('uses indeterminate progress for unknown work and retains legacy stored jobs', () => {
  expect(GenerationStatusSchema.parse(job)).toEqual(job);
  const html = renderToStaticMarkup(<BriefingGenerationProgress job={job} />);
  expect(html).not.toContain('value=');
  expect(html).toContain('남은 시간은 자료 조회와 AI 응답에 따라 달라집니다');
});
it('keeps finalization distinct from completed scientific summaries', () => {
  const html = renderToStaticMarkup(
    <BriefingGenerationProgress
      job={{ ...job, progress: { stage: 'finalize', completed: 0, total: null } }}
    />,
  );
  expect(html).toContain('마무리');
  expect(html).toContain('완료 상태를 확인');
  expect(html).not.toContain('100%');
});
