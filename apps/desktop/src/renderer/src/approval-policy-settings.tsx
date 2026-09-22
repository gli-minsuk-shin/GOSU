import { useEffect, useState } from 'react';
import type { ApprovalPolicy } from '../../shared/approval-policy';
import './approval-policy-settings.css';
export function ApprovalPolicySettings() {
  const [policy, setPolicy] = useState<ApprovalPolicy | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const api = window.gosu?.briefingLab;
    if (!api?.getApprovalPolicy) return;
    void api
      .getApprovalPolicy()
      .then((p) => {
        if (active) setPolicy(p);
      })
      .catch(() => {
        if (active) setError('승인 설정을 읽지 못했습니다. 기존 권한은 유지합니다.');
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <article className="settings-card">
      <h3>작업 승인</h3>
      <label className="approved-scope-switch">
        <input
          type="checkbox"
          checked={policy?.reuseApprovedScopes ?? false}
          disabled={!policy || busy}
          onChange={async (e) => {
            if (!policy) return;
            const next = { ...policy, reuseApprovedScopes: e.target.checked };
            setBusy(true);
            setError('');
            try {
              setPolicy(await window.gosu.briefingLab.setApprovalPolicy(next));
            } catch {
              setError('저장하지 못했습니다. 기존 설정을 유지합니다.');
            } finally {
              setBusy(false);
            }
          }}
        />{' '}
        이미 승인한 범위는 다시 묻지 않기
      </label>
      <p>
        AI 비서·Project Chat·Model Lab·Briefing에서 승인된 메일·일정 범위와 프로젝트 서버 작업
        폴더를 재사용합니다. 새 계정·폴더 권한을 추가하지 않으며, 연결 해제나 개별 철회는 그대로
        적용합니다.
      </p>
      <small>
        기본값 켜짐 · 앱 재시작/업데이트 후 유지. root·사용자 미확인 서버는 별도 Trusted access가
        필요합니다. macOS 권한창과 전송·삭제 등 작업 자체의 확인은 별개입니다. 작업 폴더 지정은 OS
        샌드박스가 아닙니다.
      </small>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
