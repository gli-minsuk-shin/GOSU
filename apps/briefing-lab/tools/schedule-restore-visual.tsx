import { createRoot } from 'react-dom/client';
import { BriefingGenerationControls } from '../src/briefing-generation-controls';
import '../src/styles.css';
import '../src/workspace.css';
let respond!: () => void;
const ready = new Promise<void>((resolve) => {
  respond = resolve;
});
window.fetch = async (input) => {
  const path = String(input);
  if (path.endsWith('/session'))
    return new Response(JSON.stringify({ token: 'fixture', clientToken: 'e'.repeat(64) }));
  if (!path.endsWith('/generation/status')) throw Error('No mutations in this fixture');
  await ready;
  return new Response(
    JSON.stringify({
      intervalHours: 4,
      nextDueAt: '2026-09-14T08:00:00Z',
      scheduleError: null,
      job: null,
    }),
  );
};
createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 24, maxWidth: 1000, margin: '20px auto' }}>
    <p>합성 화면 검증 · 실제 설정 변경/브리핑 생성 없음</p>
    <button onClick={() => respond()}>저장된 설정 응답</button>
    <section style={{ marginTop: 16, padding: 20, background: 'white', borderRadius: 16 }}>
      <h2>개인 연구 브리핑</h2>
      <BriefingGenerationControls routineId="fixture" />
    </section>
  </main>,
);
