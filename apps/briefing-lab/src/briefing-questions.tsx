import { useState } from 'react';
export const DEFAULT_BRIEFING_QUESTIONS = [
  '최근 메일 중 중요한 내용 찾아줘',
  '내 연구 주제의 새 논문 찾아줘',
  '이전 브리핑에서 마감일 관련 내용 찾아줘',
  '오늘과 내일 일정 알려줘',
  '최근 메일에서 캘린더에 넣을 일정을 추천해줘',
] as const;
export function BriefingQuestionSettings({
  value,
  onChange,
}: {
  value: readonly string[] | undefined;
  onChange: (questions: string[]) => void;
}) {
  const questions = value ?? DEFAULT_BRIEFING_QUESTIONS;
  const [draft, setDraft] = useState('');
  const candidate = draft.trim();
  const duplicate = questions.some((q) => q.trim().toLowerCase() === candidate.toLowerCase());
  const add = () => {
    if (!candidate || duplicate || questions.length >= 12) return;
    onChange([...questions, candidate]);
    setDraft('');
  };
  return (
    <section
      className="briefing-settings-section briefing-question-settings"
      aria-label="추천 질문 설정"
    >
      <header>
        <div>
          <h2>AI 비서 추천 질문</h2>
          <p>사이드바를 열 때 표시할 질문입니다. 추가·삭제 후 아래 ‘설정 저장’을 눌러주세요.</p>
        </div>
      </header>
      <ul className="briefing-question-list">
        {questions.map((question, index) => (
          <li key={`${index}:${question}`}>
            <span>{question}</span>
            <button
              type="button"
              className="briefing-question-delete"
              aria-label={`추천 질문 삭제: ${question}`}
              title="추천 질문 삭제"
              onClick={() => onChange(questions.filter((_, i) => i !== index))}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      {!questions.length && <p className="briefing-muted">등록된 추천 질문이 없습니다.</p>}
      <div className="briefing-question-add">
        <input
          aria-label="새 추천 질문"
          placeholder="자주 묻는 질문을 입력하세요"
          maxLength={300}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="briefing-button"
          aria-label="추천 질문 추가"
          disabled={!candidate || duplicate || questions.length >= 12}
          onClick={add}
        >
          + 추가
        </button>
      </div>
      <small className="briefing-muted">
        {questions.length}/12개 · 질문당 최대 300자 · 이 루틴의 브라우저 설정에 저장됩니다.
      </small>
    </section>
  );
}
