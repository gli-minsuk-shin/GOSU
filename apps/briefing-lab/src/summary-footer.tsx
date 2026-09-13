import { useRef, useState } from 'react';
import type { SummaryProvenance } from './summary-provenance';

export function SummaryFooter({
  provenance,
  publishedAt,
  savedAt,
  onRefresh,
  disabled = false,
  compactRefresh = false,
}: {
  provenance?: SummaryProvenance | undefined;
  publishedAt?: string | undefined;
  savedAt?: string | undefined;
  onRefresh?: ((progress: (detail: string) => void) => Promise<void>) | undefined;
  disabled?: boolean;
  compactRefresh?: boolean;
}) {
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const date =
    provenance?.summarizedAt ??
    (provenance?.version === 2 ? provenance.savedAt : undefined) ??
    savedAt;
  const validDate = date && Number.isFinite(Date.parse(date));
  const refresh = async () => {
    if (!onRefresh || lock.current || disabled) return;
    lock.current = true;
    setPending(true);
    setError('');
    setStatus('원자료 확인 중…');
    try {
      await onRefresh(setStatus);
      setStatus('');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : '다시 요약하지 못했습니다. 기존 요약을 유지합니다.',
      );
      setStatus('');
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <footer className="briefing-summary-footer">
      <div>
        {publishedAt && Number.isFinite(Date.parse(publishedAt)) && (
          <small title="원자료가 제공한 최초 공개 날짜입니다. 조회일이나 요약일과 다릅니다.">
            최초 공개{' '}
            <time dateTime={publishedAt}>
              {new Intl.DateTimeFormat('ko-KR', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              }).format(new Date(publishedAt))}
            </time>
          </small>
        )}
        <small
          title={
            provenance?.reuseBasis === 'paper-version'
              ? '저장된 동일 논문 버전의 요약입니다. 현재 원문을 다시 조회하지 않았습니다.'
              : '앱이 실제 읽은 내용·범위·출처를 대조합니다. 미리보기 밖의 메일 본문이나 읽지 않은 논문 전체의 동일함을 보증하지 않습니다.'
          }
        >
          {provenance?.reused ? '기존 요약 · ' : ''}
          {validDate ? (
            <>
              <time dateTime={date}>
                {new Intl.DateTimeFormat('ko-KR', {
                  timeZone: 'Asia/Seoul',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(new Date(date))}
              </time>
              {provenance?.summarizedAt ? ' 요약' : ' 저장 · 요약 시각 미기록'}
            </>
          ) : (
            '요약 시각 미기록'
          )}
        </small>
        {onRefresh && (
          <button
            type="button"
            className="briefing-summary-refresh"
            aria-label="원문 다시 확인하고 재요약"
            onClick={() => void refresh()}
            disabled={pending || disabled}
            title="기존 요약을 사용하지 않고 원자료를 다시 확인해 새로 요약합니다. arXiv 조회·LLM 사용량이 발생할 수 있습니다."
          >
            <span aria-hidden="true">↻</span>{' '}
            <span className={compactRefresh ? 'briefing-sr-only' : undefined}>
              {pending ? '다시 요약 중…' : '다시 요약'}
            </span>
          </button>
        )}
      </div>
      {provenance?.reuseBasis === 'paper-version' && (
        <small>
          원문 재조회 없음
          {provenance.personalizationStale ? ' · 연구 연결·우선순위는 요약 당시 기준' : ''}
        </small>
      )}
      {status && <small role="status">{status}</small>}
      {error && <small role="alert">{error}</small>}
    </footer>
  );
}
