import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BriefingHistoryItem } from '../src/briefing-history-view';
import type { FeedbackDecision } from '../src/briefing-insight-card';
import '../src/styles.css';
import '../src/workspace.css';
function Preview() {
  const [choice, setChoice] = useState<FeedbackDecision>(null);
  return (
    <main style={{ padding: 30, maxWidth: 900, margin: 'auto' }}>
      <h2>합성 피드백 토글 · 실제 데이터 변경 없음</h2>
      <BriefingHistoryItem
        item={{
          id: 'qa',
          kind: 'email',
          title: '합성 연구 자료',
          readScope: 'mail-preview',
          summary: '관심 선택을 다시 누르면 해제됩니다.',
          importance: 'medium',
          relevance: '',
        }}
        feedbackChoice={choice}
        onFeedback={async (value) => setChoice(value)}
      />
      <p role="status">저장된 선택: {choice ?? '없음'}</p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
