import { createRoot } from 'react-dom/client';
import { BriefingHistoryFeed } from '../src/briefing-history-view';
import type { BriefingHistory } from '../briefing-workspace-store';
import '../src/styles.css';
import '../src/workspace.css';
const history: BriefingHistory = {
  id: 'synthetic',
  routineId: 'fixture',
  createdAt: '2026-09-14T00:00:00Z',
  kind: 'briefing',
  answer: '',
  private: false,
  items: [],
  snapshot: {
    collectedAt: '2026-09-14T00:00:00Z',
    routineName: '합성 검증',
    timeZone: 'Asia/Seoul',
    sources: [
      {
        kind: 'papers',
        status: 'failed',
        count: 0,
        notice: '조회 실패로 새 논문 여부를 확인하지 못했습니다.',
        error:
          '공개 논문 출처 일부가 응답하지 않아 새 논문 여부를 확인하지 못했습니다. 기존 요약은 유지합니다.',
      },
    ],
  },
};
createRoot(document.getElementById('root')!).render(
  <main className="briefing-workspace-panel" style={{ maxWidth: 900, margin: '12px auto' }}>
    <p>합성 검증 · 실제 조회/AI 호출 없음</p>
    <BriefingHistoryFeed history={[history]} />
  </main>,
);
