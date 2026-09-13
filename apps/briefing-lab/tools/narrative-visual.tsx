import { createRoot } from 'react-dom/client';
import { BriefingNarrative } from '../src/briefing-narrative';
import { BriefingGenerationProgress } from '../src/briefing-generation-progress';
import '../src/styles.css';
import '../src/workspace.css';
const items = [
  {
    id: 'paper',
    title: 'GraphNet: Sparse Learning',
    summary: '**sparsity**를 분석합니다.',
    keywords: ['sparsity', 'GraphNet'],
    readScope: 'abstract',
    importance: 'high',
    relevance: '',
  },
  {
    id: 'mail',
    title: 'OpenReview 연구 세미나 안내',
    summary: '**참석 여부 회신**이 필요합니다.',
    readScope: 'mail-preview',
    importance: 'high',
    relevance: '',
  },
];
const texts = [
  'OpenReview 연구 세미나 안내는 9월 20일까지 참석 여부 회신이 필요합니다. 등록은 선택 사항이며, 일정이 겹치는지 먼저 확인하세요.',
  'GraphNet: Sparse Learning은 sparsity를 활용해 계산량을 줄이는 방법을 보고합니다. 다만 비교 조건이 제한되어 일반적인 성능 우위로 단정할 수 없습니다.',
  '**실험 조건 확인**을 먼저 진행하고, 추가 자료는 필요할 때 검토하세요. 별도의 마감일은 보고되지 않았습니다.',
];
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 920, margin: '24px auto', padding: 16, fontSize: 13 }}>
    <header className="briefing-main-header">
      <h1>개인 연구 브리핑 · 화면 검증용</h1>
      <BriefingGenerationProgress
        job={{
          id: 'visual',
          routineId: 'visual',
          runId: null,
          state: 'running',
          detail: '새 논문을 요약하고 있습니다.',
          newCount: 6,
          startedAt: new Date(Date.now() - 75000).toISOString(),
          updatedAt: new Date().toISOString(),
          error: null,
          progress: { stage: 'summarize', completed: 6, total: 10 },
        }}
      />
    </header>
    <section className="briefing-assistant-summary briefing-history-summary">
      <header className="briefing-assistant-summary-header">
        <div>
          <span className="briefing-section-caption">AI ASSISTANT SUMMARY</span>
          <h3>먼저 확인할 내용</h3>
        </div>
      </header>
      <details className="briefing-summary-narrative" open>
        <summary>전체 요약 문장 보기</summary>
        <div className="briefing-narrative-body">
          {texts.map((text) => (
            <BriefingNarrative key={text} text={text} items={items} />
          ))}
        </div>
      </details>
    </section>
  </main>,
);
