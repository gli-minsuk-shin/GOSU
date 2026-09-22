import React from 'react';
import { createRoot } from 'react-dom/client';
import { BriefingGenerationControls } from '../src/briefing-generation-controls';
import '../src/styles.css';
import '../src/workspace.css';
let running = new URLSearchParams(location.search).has('running');
let intervalHours = 4;
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.endsWith('/session'))
    return new Response(JSON.stringify({ token: 'fixture', clientToken: 'a'.repeat(64) }));
  if (path.endsWith('/generation/start')) running = true;
  else if (path.endsWith('/generation/cancel')) running = false;
  else if (path.endsWith('/generation/schedule'))
    intervalHours = JSON.parse(String(init.body)).intervalHours;
  else if (!path.endsWith('/generation/status')) throw Error('Unexpected fixture request');
  return new Response(
    JSON.stringify({
      intervalHours,
      nextDueAt: '2026-09-14T07:00:00Z',
      scheduleError: null,
      job: {
        id: 'fixture',
        routineId: 'r',
        runId: null,
        state: running ? 'running' : 'complete',
        detail: running
          ? '메일 목록 읽기 · 16개 확인'
          : '일부 자료 확인 필요 · 0개 추가 · 기존 브리핑 유지',
        newCount: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: running
          ? null
          : '공개 논문 출처 일부가 응답하지 않아 새 논문 여부를 확인하지 못했습니다. arXiv뿐 아니라 Crossref·OpenReview도 확인했으며, 기존 요약은 유지합니다. 잠시 후 다시 조회해주세요.',
        progress: { stage: 'collect', completed: 0, total: null },
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
createRoot(document.getElementById('root')).render(
  <main
    style={{
      maxWidth: new URLSearchParams(location.search).has('narrow') ? 380 : 1000,
      margin: '20px auto',
    }}
  >
    <header className="briefing-main-header">
      <div>
        <h1>개인 연구 브리핑</h1>
      </div>
      <div className="briefing-main-actions">
        <BriefingGenerationControls
          routineId="r"
          leadingControls={
            <span className="briefing-collapse-control">
              <button className="briefing-icon-button briefing-collapse-all" aria-label="모두 접기">
                ↟
              </button>
            </span>
          }
        />
      </div>
    </header>
    <article
      style={{
        marginTop: 12,
        padding: 20,
        minHeight: 380,
        border: '1px solid #d6e0cc',
        borderRadius: 14,
        background: 'white',
      }}
    >
      <h2>브리핑 본문 · 합성 화면</h2>
      <p>완료된 조회 안내 없이 본문 공간을 확보합니다.</p>
    </article>
  </main>,
);
