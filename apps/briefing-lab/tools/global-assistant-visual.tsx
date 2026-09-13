import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectSidebar } from '../../desktop/src/renderer/src/project-sidebar';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../../desktop/src/renderer/src/project-navigation-state';
import '../../desktop/src/renderer/src/styles.css';
const noop = () => {};
function Preview() {
  const [view, setView] = useState<'history' | 'assistant'>('history');
  const frame = useRef<HTMLIFrameElement>(null);
  const navigate = (next: 'history' | 'assistant') => {
    setView(next);
    frame.current?.contentWindow?.postMessage(
      { type: 'gosu-briefing-navigation', view: next },
      location.origin,
    );
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', height: '100vh' }}>
      <aside
        className="desktop-nav"
        style={{ gridRow: 1, gridColumn: 1, display: 'flex', maxHeight: 'none' }}
      >
        <h2>GOSU · 검증용</h2>
        <ProjectSidebar
          projects={[]}
          activeProjectId=""
          activeTab="briefing-lab"
          briefingView={view}
          settingsActive={false}
          navigationState={DEFAULT_PROJECT_NAVIGATION_STATE}
          onOpenAssistant={() => navigate('assistant')}
          onSelectGlobalTab={() => navigate('history')}
          onNavigationStateChange={noop}
          onSelectProject={noop}
          onSelectProjectTab={noop}
          onHideProject={noop}
          onShowProject={noop}
          onShowAllProjects={noop}
          onArchiveProject={noop}
          onRestoreProject={noop}
          onOpenProjectSettings={noop}
          onOpenSettings={noop}
          onNewProject={noop}
        />
      </aside>
      <section
        className="desktop-content desktop-content-model-lab desktop-content-assistant"
        style={{ gridColumn: 2, gridRow: 1 }}
      >
        <div className="global-briefing-view" data-view={view}>
          <iframe
            ref={frame}
            onLoad={() => navigate(view)}
            title="검증용 비서"
            src="./workspace-visual.html?embedded=gosu"
          />
        </div>
      </section>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
