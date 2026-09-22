import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../desktop/src/renderer/src/styles.css';
import '../../desktop/src/renderer/src/notification-center.css';
import '../../desktop/src/renderer/src/project-model-lab-view.css';
function Preview() {
  const [metrics, setMetrics] = useState('');
  const [shown, setShown] = useState(true),
    frame = useRef<HTMLIFrameElement>(null),
    host = useRef<HTMLElement>(null),
    request = useRef(0);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && e.data?.type === 'fixture-scroll-metrics')
        setMetrics(
          `내부 ${e.data.top} · 문서 ${e.data.documentTop} · 바깥 ${host.current?.scrollTop ?? 0}`,
        );
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  const runId = '6c51094a-7641-41ab-80d8-32c78f1d2221';
  const navigate = (notification = false) => {
    setShown(true);
    requestAnimationFrame(() => {
      if (host.current) {
        host.current.scrollTop = 0;
        host.current.scrollLeft = 0;
      }
      frame.current?.contentWindow?.postMessage(
        {
          type: 'gosu-briefing-navigation',
          view: 'history',
          ...(notification
            ? {
                briefingTarget: {
                  routineId: 'personal-research',
                  runId,
                  requestId: ++request.current,
                },
              }
            : {}),
        },
        location.origin,
      );
    });
  };
  return (
    <main
      style={{
        display: 'grid',
        gridTemplateColumns: '190px minmax(0,1fr)',
        gridTemplateRows: '64px minmax(0,1fr)',
        height: '100vh',
      }}
    >
      <header
        style={{
          gridColumn: '1 / -1',
          padding: 12,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <strong>알림 진입 · 합성 검증</strong>
        <button onClick={() => navigate(true)}>알림에서 이전 브리핑 열기</button>
        <button onClick={() => navigate()}>Briefing 탭</button>
        <button
          onClick={() =>
            frame.current?.contentWindow?.postMessage({ type: 'fixture-scroll-down' }, '*')
          }
        >
          내부 아래로 스크롤
        </button>
        <button onClick={() => setShown(false)}>다른 세션</button>
        <button
          onClick={() =>
            frame.current?.contentWindow?.postMessage({ type: 'fixture-legacy-scroll' }, '*')
          }
        >
          이전 방식 재현
        </button>
        <small>{metrics}</small>
      </header>
      <aside style={{ padding: 20, gridRow: 2 }}>
        Calendar
        <br />
        To-do list
        <br />
        Briefing Lab
      </aside>
      <section ref={host} className="desktop-content desktop-content-model-lab">
        <div className="global-briefing-view" hidden={!shown}>
          <iframe
            ref={frame}
            src="./workspace-visual.html?embedded=gosu&notification-scroll-qa=1"
            title="브리핑 검증 프레임"
            onLoad={() =>
              frame.current?.contentWindow?.postMessage(
                { type: 'gosu-briefing-navigation', view: 'history' },
                location.origin,
              )
            }
          />
        </div>
        {!shown && <p>다른 세션 · 기존 iframe 유지</p>}
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
