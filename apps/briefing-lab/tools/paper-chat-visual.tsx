import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BriefingHistoryItem } from '../src/briefing-history-view';
import { BriefingChat } from '../src/briefing-chat';
import { PAPER_CHAT_REFERENCE, type PaperChatReference } from '../src/paper-chat-reference';
import { initialRealWorkspace } from '../src/workspace-defaults';
import '../src/styles.css';
import '../src/workspace.css';
const routine = initialRealWorkspace('2026-09-13T00:00:00Z').routines[0]!;
function Preview() {
  const [reference, setReference] = useState<PaperChatReference>();
  useEffect(() => {
    const choose = (event: Event) => setReference((event as CustomEvent).detail);
    window.addEventListener(PAPER_CHAT_REFERENCE, choose);
    return () => window.removeEventListener(PAPER_CHAT_REFERENCE, choose);
  }, []);
  return (
    <main
      style={{
        padding: 16,
        display: 'grid',
        gap: 16,
        gridTemplateColumns: reference ? '1fr 340px' : '1fr',
      }}
    >
      <section>
        <h2>논문 요약 · 합성 화면 검증</h2>
        {['high', 'medium'].map((importance, index) => (
          <BriefingHistoryItem
            key={importance}
            item={{
              id: String(index),
              kind: 'papers',
              title: index ? 'Robust Bayesian Learning' : 'Sparse Models for Scientific Discovery',
              summary: '저장된 연구 방법과 한계에 대한 합성 요약입니다.',
              importance,
              relevance: '',
              readScope: 'abstract',
              keywords: ['Bayesian', 'Sparse models'],
            }}
            paperReference={{
              routineId: routine.id,
              historyId: 'fixture',
              paperId: String(index),
              title: index ? 'Robust Bayesian Learning' : 'Sparse Models for Scientific Discovery',
            }}
          />
        ))}
      </section>
      {reference && (
        <aside style={{ minWidth: 0, height: 600 }}>
          <BriefingChat routine={routine} paperReference={reference} onSettings={() => {}} />
        </aside>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
