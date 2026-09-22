import { createRoot } from 'react-dom/client';
import { ApprovalPolicySettings } from '../../desktop/src/renderer/src/approval-policy-settings';
import '../../desktop/src/renderer/src/styles.css';
let policy = { version: 1 as const, reuseApprovedScopes: true };
Object.assign(window, {
  gosu: {
    briefingLab: {
      getApprovalPolicy: async () => policy,
      setApprovalPolicy: async (value: typeof policy) => (policy = value),
    },
  },
});
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 780, padding: 24, margin: '24px auto' }}>
    <p>합성 화면 검증 · 실제 권한 변경 없음</p>
    <ApprovalPolicySettings />
  </main>,
);
