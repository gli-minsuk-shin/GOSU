import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentAddOnsSection } from '../../desktop/src/renderer/src/agent-addons-section';
import type {
  AgentAddOnId,
  AgentAddOnPreference,
} from '../../desktop/src/shared/agent-addon-contracts';
import '../../desktop/src/renderer/src/styles.css';
function Preview() {
  const [preferences, setPreferences] = useState<
    Readonly<Record<AgentAddOnId, AgentAddOnPreference>>
  >({ openclaw: 'disabled', hermes: 'disabled', 'claude-code': 'disabled' });
  const [status, setStatus] = useState('검증용 · 연결됨');
  return (
    <main style={{ padding: 20, maxWidth: 900, margin: 'auto' }}>
      <p>연결 설정 · 합성 화면 검증 (실제 로그인 없음)</p>
      <AgentAddOnsSection
        preferences={preferences}
        onChange={setPreferences}
        codexConnection={{
          status,
          busy: false,
          onConnect: () => setStatus('검증용 · 연결됨'),
          onRefresh: () => setStatus('검증용 · 모델 확인 완료'),
          onLogin: () => setStatus('검증용 · 로그인 선택'),
          onDisconnect: () => setStatus('검증용 · 로그아웃'),
        }}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
