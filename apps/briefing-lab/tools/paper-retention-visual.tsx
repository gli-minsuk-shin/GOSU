import { createRoot } from 'react-dom/client';
import { BriefingHistoryFeed } from '../src/briefing-history-view';
import type { BriefingHistory } from '../briefing-workspace-store';
import '../src/styles.css';
import '../src/workspace.css';
const savedAt = '2026-09-13T00:00:00Z';
const refreshedAt = '2026-09-13T01:00:00Z';
const history: BriefingHistory[] = [
  {
    id: 'fixture',
    routineId: 'fixture',
    runId: 'fixture-run',
    kind: 'briefing',
    private: false,
    createdAt: savedAt,
    answer: '저장된 논문을 확인하세요. 새 조회 실패와 저장본은 별개입니다.',
    items: [
      {
        id: 'paper',
        kind: 'papers',
        title: 'Saved research paper · 합성 검증',
        summary: '첫 번째 브리핑에서 저장한 요약입니다. 재조회나 재요약 없이 표시합니다.',
        importance: 'high',
        relevance: '',
        readScope: 'abstract',
        addedAt: savedAt,
        sourceUrl: 'https://arxiv.org/abs/2609.00001v1',
      },
    ],
    snapshot: {
      collectedAt: savedAt,
      routineName: '두 번째 브리핑 · 합성 검증',
      timeZone: 'Asia/Seoul',
      daily: { date: '2026-09-13', updatedAt: refreshedAt },
      newItemsSince: refreshedAt,
      visiblePaperKeys: [],
      sources: [
        {
          kind: 'papers',
          status: 'failed',
          count: 0,
          error: 'arXiv 요청 제한 · 새 논문 조회를 완료하지 못했습니다.',
        },
      ],
    },
  },
];
createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 16, maxWidth: 1000, margin: 'auto' }}>
    <BriefingHistoryFeed history={history} />
  </main>,
);
