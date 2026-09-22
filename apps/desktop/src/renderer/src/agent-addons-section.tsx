import { useState } from 'react';
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
export type ClaudeCodeLoginControls = {
  phase: 'idle' | 'signing-in' | 'failed';
  message: string | null;
  onLogin: () => void;
  onCancel: () => void;
  onOpenSignInPage: () => void;
  onSubmitCode: (code: string) => void;
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
  claudeCodeLogin,
}: {
  preferences: AgentAddOnPreferences;
  onChange: (preferences: AgentAddOnPreferences) => void;
  codexConnection?: CodexConnectionControls | undefined;
  hermesConnection?: HermesProjectChatConnectionUiState;
  onRefreshHermesConnection?: () => Promise<unknown>;
  claudeCodeConnection?: AgentProviderConnectionUiState;
  onRefreshClaudeCodeConnection?: () => Promise<unknown>;
  claudeCodeLogin?: ClaudeCodeLoginControls | undefined;
}) {
  useUiText();
  const [loginCode, setLoginCode] = useState('');
  const connected = claudeCodeConnection.status?.connected === true;
  const signingIn = claudeCodeLogin?.phase === 'signing-in';
  const checking = claudeCodeConnection.phase === 'checking' || signingIn;
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
              {signingIn
                ? uiText('로그인 진행 중…')
                : checking
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
          {claudeCodeLogin?.message ? (
            <p role="status" aria-label="Claude 로그인 상태">
              {uiText(claudeCodeLogin.message)}
            </p>
          ) : null}
          {signingIn ? (
            <form
              className="codex-actions"
              aria-label="Claude 인증 코드 입력"
              onSubmit={(event) => {
                event.preventDefault();
                const code = loginCode.trim();
                if (!code) return;
                claudeCodeLogin?.onSubmitCode(code);
                setLoginCode('');
              }}
            >
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label="Claude 인증 코드"
                placeholder={uiText('브라우저의 Authentication code 붙여넣기')}
                value={loginCode}
                onChange={(event) => setLoginCode(event.target.value)}
              />
              <button type="submit" className="secondary-button" disabled={!loginCode.trim()}>
                {uiText('코드 입력')}
              </button>
            </form>
          ) : null}
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
            {signingIn ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={claudeCodeLogin?.onOpenSignInPage}
                >
                  {uiText('로그인 페이지 다시 열기')}
                </button>
                <button type="button" className="ghost-button" onClick={claudeCodeLogin?.onCancel}>
                  {uiText('로그인 취소')}
                </button>
              </>
            ) : claudeCodeLogin ? (
              <button
                type="button"
                className="secondary-button"
                disabled={checking}
                onClick={claudeCodeLogin.onLogin}
              >
                {uiText('Claude 로그인')}
              </button>
            ) : (
              <a
                className="secondary-button"
                href="https://docs.anthropic.com/en/docs/claude-code/getting-started"
                target="_blank"
                rel="noreferrer"
              >
                {uiText('Claude 로그인 안내')} ↗
              </a>
            )}
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
