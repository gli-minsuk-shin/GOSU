import { useEffect, useState } from 'react';
import type { GenerationStatus } from './briefing-generation-contract';
const stages = {
  collect: '자료 조회',
  calendar: '일정 확인',
  summarize: 'AI 요약',
  finalize: '마무리',
};
const kindLabels = { email: ['이메일', '통'], papers: ['논문', '편'] } as const;
const quickLabels = { running: '작성 중', saved: '표시됨', failed: '실패 · 자세한 요약은 계속' };
/** One line per summary kind: what waits, which batches run now, what is saved or failed. */
export function summaryKindLine(entry: NonNullable<GenerationStatus['summaryKinds']>[number]) {
  const [label, unit] = kindLabels[entry.kind];
  const failed = entry.failed ? ` · 실패 ${entry.failed}${unit}` : '';
  if (entry.state === 'waiting')
    return `${label} 요약 · ${entry.total}${unit} 대기${entry.kind === 'papers' ? ' (이메일 요약 후 시작)' : ''}`;
  if (entry.state === 'done')
    return `${label} 요약 완료 · ${entry.saved}/${entry.total}${unit} 저장${failed}`;
  return `${label} 요약 중 · ${entry.saved}/${entry.total}${unit} 저장${entry.running.length ? ` · 지금 ${entry.running.join(', ')}번째` : ''}${failed}`;
}
export function BriefingGenerationProgress({ job }: { job: GenerationStatus }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(job.startedAt)) / 1000));
  const elapsed = seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
  const p = job.progress;
  const total = p?.stage === 'summarize' ? p.total : null;
  const done = Math.min(p?.completed ?? 0, total ?? 0);
  const active = job.summaryKinds?.find((entry) => entry.state === 'running');
  return (
    <details className="briefing-generation-progress" aria-label="브리핑 생성 진행 상황">
      <summary
        aria-label="브리핑 진행 상세 펼치기 또는 접기"
        title={`${p ? stages[p.stage] : '브리핑 준비'}${p?.stage === 'summarize' && active ? ` · ${kindLabels[active.kind][0]}` : ''}${total ? ` · ${done}/${total}개 저장` : ''} · 경과 ${elapsed}`}
      >
        <strong>
          {p ? stages[p.stage] : '브리핑 준비'}
          {p?.stage === 'summarize' && active ? ` · ${kindLabels[active.kind][0]}` : ''}
        </strong>
        {total ? (
          <span>
            {done}/{total}개 저장
          </span>
        ) : null}
        <span>경과 {elapsed}</span>
        <svg className="briefing-progress-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="briefing-progress-detail">
        <progress
          aria-label={total ? 'AI 요약 진행률' : '브리핑 작업 진행 중'}
          max={total || 1}
          value={total ? done : undefined}
        />
        <p role="status">{job.detail}</p>
        {(job.quickBriefingState || job.summaryKinds?.length) && (
          <ul className="briefing-progress-kinds" aria-label="요약 종류별 진행">
            {job.quickBriefingState && (
              <li data-state={job.quickBriefingState}>
                빠른 1차 브리핑 · {quickLabels[job.quickBriefingState]}
              </li>
            )}
            {job.summaryKinds?.map((entry) => (
              <li key={entry.kind} data-state={entry.state}>
                {summaryKindLine(entry)}
              </li>
            ))}
          </ul>
        )}
        <small>
          {total
            ? `${done}/${total}개 요약 저장 · ${total - done}개 남음`
            : p?.stage === 'finalize'
              ? '완료 상태를 확인하고 있습니다.'
              : '처리할 자료를 확인하고 있습니다.'}
        </small>
        <small>
          {seconds >= 60 ? '응답을 기다리고 있습니다. ' : ''}남은 시간은 자료 조회와 AI 응답에 따라
          달라집니다. 저장된 결과는 먼저 표시됩니다.
        </small>
      </div>
    </details>
  );
}
