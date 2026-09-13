import { uiText, useUiText } from '@gosu/ui/language';
import type {
  AgentAddOnId,
  AgentAddOnPreference,
  AgentAddOnStatus,
} from '../../shared/agent-addon-contracts';
type AgentAddOnPreferences = Readonly<Record<AgentAddOnId, AgentAddOnPreference>>;
// Legacy type retained for historical data, not a selectable provider.
export type HermesProjectChatConnectionUiState = Readonly<{
  phase: 'disabled' | 'checking' | 'ready' | 'unavailable';
  status: AgentAddOnStatus | null;
}>;
export type AgentProviderConnectionUiState = HermesProjectChatConnectionUiState;
export type CodexConnectionControls = {
  status: string;
  busy: boolean;
  onConnect: () => void;
  onLogin: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
};
export function enabledAgentAddOnIds(preferences: AgentAddOnPreferences): readonly AgentAddOnId[] {
  return preferences['claude-code'] === 'connect-local' ? ['claude-code'] : [];
}
export function AgentAddOnsSection({
  preferences,
  onChange,
  codexConnection,
  claudeCodeConnection = { phase: 'disabled', status: null },
  onRefreshClaudeCodeConnection = async () => undefined,
}: {
  preferences: AgentAddOnPreferences;
  onChange: (preferences: AgentAddOnPreferences) => void;
  codexConnection?: CodexConnectionControls | undefined;
  hermesConnection?: HermesProjectChatConnectionUiState;
  onRefreshHermesConnection?: () => Promise<unknown>;
  claudeCodeConnection?: AgentProviderConnectionUiState;
  onRefreshClaudeCodeConnection?: () => Promise<unknown>;
}) {
  useUiText();
  const connected = claudeCodeConnection.status?.connected === true;
  const checking = claudeCodeConnection.phase === 'checking';
  const selectClaude = () => {
    if (preferences['claude-code'] === 'connect-local') void onRefreshClaudeCodeConnection();
    else onChange({ ...preferences, 'claude-code': 'connect-local' });
  };
  return (
    <article className="settings-card">
      <div className="settings-card-heading">
        <span>AI CONNECTIONS</span>
        <h2>{uiText('AI 연결')}</h2>
        <p>
          {uiText(
            'Codex와 Claude 연결 및 모델 목록을 관리합니다. 로그인 정보는 각 제공자의 로컬 도구에서 관리합니다.',
          )}
        </p>
      </div>
      <div className="ai-provider-connections">
        <section className="ai-provider-connection" aria-label="Codex 연결">
          <header>
            <h3>Codex</h3>
            <span role="status">
              {codexConnection?.status ?? uiText('연결 화면에서 상태 확인')}
            </span>
          </header>
          <p>ChatGPT {uiText('구독 로그인 · 기존 Codex 인증 사용')}</p>
          <div className="codex-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={!codexConnection || codexConnection.busy}
              onClick={codexConnection?.onConnect}
            >
              {uiText('연결 / 재연결')}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!codexConnection || codexConnection.busy}
              onClick={codexConnection?.onRefresh}
            >
              {uiText('모델 새로고침')}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!codexConnection || codexConnection.busy}
              onClick={codexConnection?.onLogin}
            >
              {uiText('ChatGPT 로그인')}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!codexConnection || codexConnection.busy}
              onClick={codexConnection?.onDisconnect}
            >
              {uiText('로그아웃')}
            </button>
          </div>
        </section>
        <section className="ai-provider-connection" aria-label="Claude 연결">
          <header>
            <h3>Claude</h3>
            <span role="status">
              {checking
                ? uiText('연결 확인 중…')
                : connected
                  ? uiText('연결됨')
                  : claudeCodeConnection.phase === 'unavailable'
                    ? uiText('연결 확인 필요')
                    : uiText('연결 안 됨')}
            </span>
          </header>
          <p>
            {uiText(
              'Claude.ai 구독 · 이 Mac의 Claude Code 로그인 사용. 연결 해제는 Claude 계정에서 로그아웃하지 않습니다.',
            )}
          </p>
          <div className="codex-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={checking}
              onClick={selectClaude}
            >
              {uiText('연결 / 재연결')}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={checking || preferences['claude-code'] !== 'connect-local'}
              onClick={() => void onRefreshClaudeCodeConnection()}
            >
              {uiText('모델 새로고침')}
            </button>
            <a
              className="secondary-button"
              href="https://docs.anthropic.com/en/docs/claude-code/getting-started"
              target="_blank"
              rel="noreferrer"
            >
              {uiText('Claude 로그인 안내')} ↗
            </a>
            <button
              type="button"
              className="ghost-button"
              disabled={checking || preferences['claude-code'] === 'disabled'}
              onClick={() => onChange({ ...preferences, 'claude-code': 'disabled' })}
            >
              {uiText('연결 해제')}
            </button>
          </div>
        </section>
      </div>
    </article>
  );
}
