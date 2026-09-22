import './chat-suggestion-settings.css';

/**
 * Whether an AI chat opens its suggested questions by itself. The suggestions are written in the
 * page, not by a model, so turning them off calls nothing and saves nothing; it is only about what
 * the chat shows when it opens.
 */
export function ChatSuggestionSettings({
  autoSuggestions,
  onChange,
}: {
  autoSuggestions: boolean;
  onChange: (autoSuggestions: boolean) => void;
}) {
  return (
    <article className="settings-card">
      <h3>AI 대화 추천 질문</h3>
      <label className="chat-suggestion-switch">
        <input
          type="checkbox"
          checked={autoSuggestions}
          onChange={(event) => onChange(event.target.checked)}
        />{' '}
        AI 대화를 열 때 추천 질문을 자동으로 보여주기
      </label>
      <p>
        AI 비서와 논문 요약 대화에 적용됩니다. 끄면 대화를 열 때 추천 질문이 나오지 않고, 입력창
        옆의 추천 질문 버튼으로 직접 열 수 있습니다.
      </p>
      <small>
        기본값 켜짐 · 앱 재시작·업데이트 후 유지. 추천 질문은 화면에 적힌 문장이므로 이 설정은 AI
        호출이나 사용량과 무관합니다.
      </small>
    </article>
  );
}
