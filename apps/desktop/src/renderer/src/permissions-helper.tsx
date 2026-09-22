import { useEffect, useRef, useState } from 'react';
import {
  PERMISSIONS_HELPER_SEEN_KEY,
  type FullDiskAccessState,
} from '../../shared/full-disk-access';
import { describeError } from './ui-primitives';
import './permissions-helper.css';

type PrivacyPane = 'full-disk' | 'automation' | 'calendar';

/** True until the helper was shown once on this Mac; a Mac without storage simply sees it again. */
export function permissionsHelperPending() {
  try {
    return window.localStorage?.getItem(PERMISSIONS_HELPER_SEEN_KEY) !== '1';
  } catch {
    return false;
  }
}
export function markPermissionsHelperSeen() {
  try {
    window.localStorage?.setItem(PERMISSIONS_HELPER_SEEN_KEY, '1');
  } catch {
    // Without storage the helper returns at the next start; nothing else depends on this flag.
  }
}

const FULL_DISK_STATE: Record<FullDiskAccessState, readonly [string, 'ok' | 'todo' | 'idle']> = {
  granted: ['허용됨', 'ok'],
  missing: ['꺼져 있음', 'todo'],
  'not-needed': ['필요 없음 · 이 Mac에서 Mail을 쓰지 않음', 'idle'],
  unknown: ['확인하지 못함', 'idle'],
};

/**
 * The macOS permissions GOSU uses, what each is for, its state where macOS lets GOSU know it, and a
 * button to the right System Settings pane. Only the user can grant them; nothing here changes a
 * setting. Shown once at the first start and reachable from Settings → Briefing Lab afterwards.
 */
export function PermissionsHelper({
  fullDiskAccess,
  onCheck,
  onClose,
}: Readonly<{
  fullDiskAccess: FullDiskAccessState | null;
  onCheck: () => void;
  onClose: () => void;
}>) {
  const [failure, setFailure] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  const open = (pane: PrivacyPane) =>
    void window.gosu.briefingLab
      .openPrivacy(pane)
      .then(() => setFailure(null))
      .catch((error: unknown) => setFailure(describeError(error)));
  const [fullDiskText, fullDiskTone] = fullDiskAccess
    ? FULL_DISK_STATE[fullDiskAccess]
    : (['확인 중…', 'idle'] as const);
  return (
    <div className="permissions-helper-backdrop">
      <aside
        className="permissions-helper"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permissions-helper-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <header>
          <div>
            <span>GOSU 시작하기</span>
            <h2 id="permissions-helper-title">macOS 권한 도우미</h2>
            <p>
              아래 권한은 사용자만 켤 수 있습니다. 버튼을 누르면 시스템 설정의 해당 화면이 열립니다.
              한 번 허용하면 GOSU를 업데이트해도 유지됩니다.
            </p>
          </div>
          <button
            ref={close}
            type="button"
            className="icon-button"
            aria-label="권한 도우미 닫기"
            title="닫기"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <ol className="permissions-helper-list">
          <li data-tone={fullDiskTone}>
            <div>
              <strong>전체 디스크 접근 권한</strong>
              <em>{fullDiskText}</em>
              <p>
                Briefing이 Apple Mail의 색인을 직접 읽어 새 메일을 몇 초 안에 찾습니다. 꺼져 있으면
                느린 방식으로 읽어 몇 분이 걸릴 수 있습니다. 목록에서 GOSU를 켠 뒤{' '}
                <b>GOSU를 다시 시작</b>해야 적용됩니다.
              </p>
            </div>
            <div className="permissions-helper-actions">
              <button type="button" className="primary-button" onClick={() => open('full-disk')}>
                시스템 설정 열기
              </button>
              <button type="button" className="ghost-button" onClick={onCheck}>
                다시 확인
              </button>
            </div>
          </li>
          <li data-tone="idle">
            <div>
              <strong>자동화 · Mail 제어</strong>
              <em>처음 메일을 읽을 때 macOS가 묻습니다</em>
              <p>
                Briefing이 Apple Mail에서 메일 본문을 읽고 원본 메일을 열 때 씁니다. 그때 ‘허용’을
                누르면 됩니다. 거부했거나 메일 조회가 막혀 있다면 여기서 GOSU → Mail을 켜세요.
              </p>
            </div>
            <div className="permissions-helper-actions">
              <button type="button" className="secondary-button" onClick={() => open('automation')}>
                시스템 설정 열기
              </button>
            </div>
          </li>
          <li data-tone="idle">
            <div>
              <strong>캘린더</strong>
              <em>Briefing 설정에서 ‘Apple Calendar 연결’을 누를 때 macOS가 묻습니다</em>
              <p>
                오늘·내일 일정 브리핑과, 확인 후 일정을 추가하는 데 씁니다. 거부했다면 여기서 GOSU의
                캘린더 접근을 켜세요.
              </p>
            </div>
            <div className="permissions-helper-actions">
              <button type="button" className="secondary-button" onClick={() => open('calendar')}>
                시스템 설정 열기
              </button>
            </div>
          </li>
        </ol>
        {failure && (
          <p className="permissions-helper-failure" role="alert">
            시스템 설정을 열지 못했습니다: {failure}
          </p>
        )}
        <footer>
          <small>이 도우미는 설정 → Briefing Lab의 ‘권한 도우미’에서 다시 열 수 있습니다.</small>
          <button type="button" className="primary-button" onClick={onClose}>
            완료
          </button>
        </footer>
      </aside>
    </div>
  );
}
