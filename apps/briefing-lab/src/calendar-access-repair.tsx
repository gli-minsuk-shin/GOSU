import { useState } from 'react';
import { sourceRequest } from './live-client';
import { isGosuEmbedded } from './desktop-bridge';
export function CalendarAccessRepair({ onRestored }: { onRestored: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="briefing-calendar-access-repair">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await sourceRequest('/calendar/authorize', {}, new AbortController().signal);
            onRestored();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Calendar 권한 확인 실패');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'macOS 승인 기다리는 중…' : 'Calendar 접근 다시 허용'}
      </button>
      {isGosuEmbedded() && (
        <button
          type="button"
          onClick={() => window.parent.postMessage({ type: 'gosu-open-calendar-privacy' }, '*')}
        >
          macOS Calendar 권한 설정
        </button>
      )}
      <small>기존 캘린더 선택은 유지됩니다. macOS 승인 창에서 직접 허용해주세요.</small>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
