import { contextRemaining, type ContextUsage } from './context-usage';
import './context-usage-meter.css';
const n = (value: number | null | undefined) =>
  value === null || value === undefined ? '미제공' : value.toLocaleString('ko-KR');
export function ContextUsageMeter({
  usage,
  busy,
}: {
  usage?: ContextUsage | undefined;
  busy: boolean;
}) {
  if (!usage) return <small className="briefing-context-empty">토큰 사용량 · 요청 후 표시</small>;
  const { limit, used, remaining, reported } = contextRemaining(usage);
  const percent = limit && used !== null ? Math.min(100, Math.round((used / limit) * 100)) : null;
  return (
    <details className="briefing-context-meter">
      <summary>
        <span>
          {busy ? '현재 요청' : '최근 요청'} {reported ? '문맥 ' : '시작 문맥 추정 약 '}
          {n(used)} / {limit ? n(limit) : '한도 미확인'}
          {percent !== null ? ` · ${percent}%` : ''}
        </span>
        <span>{used === null ? '재측정 대기' : reported ? '실측' : '추정'} ⌄</span>
      </summary>
      {percent !== null && <progress aria-label="문맥 사용률" value={percent} max={100} />}
      <dl>
        {usage.requestedWindowTokens && (
          <div>
            <dt>요청한 문맥 한도</dt>
            <dd>{n(usage.requestedWindowTokens)} 토큰</dd>
          </div>
        )}
        {usage.modelMaximumWindowTokens && (
          <div>
            <dt>자동 감지된 제공자 최대값</dt>
            <dd>{n(usage.modelMaximumWindowTokens)} 토큰</dd>
          </div>
        )}
        {usage.modelDefaultWindowTokens && (
          <div>
            <dt>모델 기본 문맥</dt>
            <dd>{n(usage.modelDefaultWindowTokens)} 토큰</dd>
          </div>
        )}
        {usage.requestedWindowTokens && (
          <div>
            <dt>실행에 적용된 한도</dt>
            <dd>
              {n(usage.native?.contextWindowTokens)}
              {usage.native?.contextWindowTokens ? ' 토큰' : ' · 제공자 보고 대기'}
            </dd>
          </div>
        )}
        {usage.maintenance && (
          <div>
            <dt>문맥 정리 {usage.maintenance.calls}회 · 입력 / 출력</dt>
            <dd>
              {n(usage.maintenance.inputTokens)} / {n(usage.maintenance.outputTokens)}
            </dd>
          </div>
        )}
        <div>
          <dt>응답 여유분 제외 잔여</dt>
          <dd>{n(remaining)} 토큰</dd>
        </div>
        <div>
          <dt>한도 기준</dt>
          <dd>
            {usage.native?.contextWindowTokens
              ? '실행 제공자 보고'
              : usage.windowSource === 'fallback'
                ? '미확인 · 안전 예산 사용'
                : '모델/실행 설정 · 실제 보고 우선'}
          </dd>
        </div>
        <div>
          <dt>대화 문맥</dt>
          <dd>
            원문 {usage.includedMessages} / 전체 {usage.totalMessages}개 · 요약{' '}
            {usage.compressedMessages}개 · 생략 {usage.omittedMessages}개
          </dd>
        </div>
        <div>
          <dt>답변 호출 입력 / 출력</dt>
          <dd>
            {n(usage.native?.inputTokens)} / {n(usage.native?.outputTokens)}
          </dd>
        </div>
        <div>
          <dt>캐시 입력 / 추론 출력</dt>
          <dd>
            {n(usage.native?.cachedInputTokens)} / {n(usage.native?.reasoningTokens)}
          </dd>
        </div>
        <div>
          <dt>응답 / 도구 여유분</dt>
          <dd>
            {n(usage.outputReserveTokens)} / {n(usage.toolReserveTokens)}
          </dd>
        </div>
      </dl>
      <small>
        누적 호출 토큰은 현재 문맥 크기와 다릅니다. 구독 잔여량이 아닙니다. 문맥 정리의 추가 모델
        호출은 별도 행에 표시하며, 미제공 값을 0으로 계산하지 않습니다.
      </small>
    </details>
  );
}
