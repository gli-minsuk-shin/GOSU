import { useCallback, useEffect, useState } from 'react';
import {
  FULL_DISK_ACCESS_DISMISSED_KEY,
  type FullDiskAccessState,
} from '../../shared/full-disk-access';
import { describeError } from './ui-primitives';

const dismissed = () => {
  try {
    return window.localStorage?.getItem(FULL_DISK_ACCESS_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

/** Checked when the app starts and again on request; macOS applies a new grant after a restart. */
export function useFullDiskAccess() {
  const [state, setState] = useState<FullDiskAccessState | null>(null),
    [failure, setFailure] = useState<string | null>(null);
  const check = useCallback(() => {
    const read = window.gosu?.briefingLab?.fullDiskAccess;
    if (!read) return;
    void read().then(
      (value) => {
        setState(value);
        setFailure(null);
      },
      (error: unknown) => setFailure(describeError(error)),
    );
  }, []);
  useEffect(check, [check]);
  return { state, failure, check };
}

/**
 * Shown while Full Disk Access is missing, until the user closes it: what it is for, that one
 * approval survives GOSU updates, and a button straight to the right System Settings pane. GOSU
 * cannot switch it on itself.
 */
export function FullDiskAccessNotice({
  state,
  failure,
  onCheck,
}: Readonly<{ state: FullDiskAccessState | null; failure: string | null; onCheck: () => void }>) {
  const [hidden, setHidden] = useState(dismissed);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  if (state !== 'missing' || hidden) return null;
  return (
    <div className="notice" role="status" aria-label="전체 디스크 접근 권한 안내">
      <span>
        Apple Mail을 빠르게 읽으려면 macOS의 <strong>전체 디스크 접근 권한</strong>이 필요합니다.
        지금은 꺼져 있어 메일을 느린 방식으로 읽습니다. 시스템 설정 → 개인정보 보호 및 보안 → 전체
        디스크 접근 권한에서 GOSU를 켠 뒤 GOSU를 다시 시작하세요. 한 번 허용하면 GOSU를 업데이트해도
        유지됩니다.
        {(failure || openFailure) && ` (${failure ?? openFailure})`}
      </span>
      <div className="notice-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() =>
            void window.gosu.briefingLab
              .openPrivacy('full-disk')
              .then(() => setOpenFailure(null))
              .catch((error: unknown) => setOpenFailure(describeError(error)))
          }
        >
          시스템 설정 열기
        </button>
        <button type="button" className="ghost-button" onClick={onCheck}>
          다시 확인
        </button>
        <button
          type="button"
          className="ghost-button"
          title="이 안내를 다시 보지 않습니다. 권한은 설정 → Briefing Lab의 ‘전체 디스크 접근 권한’에서 언제든 열 수 있습니다."
          onClick={() => {
            try {
              window.localStorage?.setItem(FULL_DISK_ACCESS_DISMISSED_KEY, '1');
            } catch {
              // Private storage is unavailable: the notice simply returns at the next start.
            }
            setHidden(true);
          }}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
