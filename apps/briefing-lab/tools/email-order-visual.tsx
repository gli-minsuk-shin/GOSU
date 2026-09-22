import { createRoot } from 'react-dom/client';
import { BriefingHistoryFeed } from '../src/briefing-history-view';
import type { BriefingHistory } from '../briefing-workspace-store';
import '../src/styles.css';
import '../src/workspace.css';
let calls = 0;
window.fetch = async (input) => {
  const path = String(input);
  let data: unknown;
  if (path.endsWith('/session')) data = { token: 'fixture', clientToken: 'a'.repeat(64) };
  else if (path.endsWith('/mail/read-sender')) {
    data = { sender: '복구된 연구지원팀 <recovered@example.test>' };
    document.getElementById('calls')!.textContent =
      `헤더 조회 ${++calls}회 · AI 호출 0회 (합성 테스트)`;
  } else throw Error('Unexpected fixture request');
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
};
const time = '2026-09-14T03:00:00Z';
const history: BriefingHistory = {
  id: 'h',
  routineId: 'r',
  createdAt: time,
  kind: 'briefing',
  answer: '중요도와 수신 시각을 기준으로 먼저 확인할 이메일을 정리합니다.',
  private: true,
  items: [
    {
      id: 'low',
      title: '일반 소식 — 가장 최근 수신이지만 중요도 낮음',
      importance: 'low',
      receivedAt: '2026-09-14T03:00:00Z',
      mailSender: 'Newsletter Desk <news@example.test>',
    },
    {
      id: 'old-high',
      title: '연구 검토 요청 — 중요도 높음, 이전 수신',
      importance: 'high',
      receivedAt: '2026-09-13T02:00:00Z',
      mailSender: '아주 긴 이름의 공동연구 협력 및 학술지원 사무국 <long-sender@example.test>',
    },
    {
      id: 'new-high',
      title: '공동연구 자료 확인 — 중요도 높음, 최신 수신',
      importance: 'high',
      receivedAt: '2026-09-14T01:00:00Z',
      mailSender: '홍길동 교수 <professor@example.test>',
    },
    {
      id: 'legacy',
      title: '저장된 이전 이메일 — 발신자 한 번 확인',
      importance: 'medium',
      receivedAt: '2026-09-13T01:00:00Z',
    },
  ].map((item) => ({
    ...item,
    kind: 'email',
    readScope: 'mail-preview',
    summary:
      '자료와 질문 목록을 검토해 달라는 안내입니다. 주요 변경 사항과 필요한 회신을 확인하세요.',
    relevance: '',
    mailAccount: { id: 'work', name: '연구 계정', addresses: ['researcher@example.test'] },
    mailMessageUrl: `message://%3C${item.id}%40example.test%3E`,
    mailUnread: false,
  })),
};
createRoot(document.getElementById('root')!).render(
  <main
    className="briefing-workspace-panel"
    style={{ margin: '12px auto', maxWidth: 1080, padding: 14 }}
  >
    <output id="calls">헤더 조회 0회 · AI 호출 0회 (합성 테스트)</output>
    <BriefingHistoryFeed history={[history]} />
  </main>,
);
