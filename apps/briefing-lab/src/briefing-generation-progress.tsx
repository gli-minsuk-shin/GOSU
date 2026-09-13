import { useEffect, useState } from 'react';
import type { GenerationStatus } from './briefing-generation-contract';
const stages = {
  collect: '자료 조회',
  calendar: '일정 확인',
  summarize: 'AI 요약',
  finalize: '마무리',
};
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
  return (
    <details className="briefing-generation-progress" aria-label="브리핑 생성 진행 상황">
      <summary aria-label="브리핑 진행 상세 펼치기 또는 접기">
        <strong>{p ? stages[p.stage] : '브리핑 준비'}</strong>
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
