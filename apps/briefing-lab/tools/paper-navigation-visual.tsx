import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectSidebar } from '../../desktop/src/renderer/src/project-sidebar';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../../desktop/src/renderer/src/project-navigation-state';
import { BriefingHistoryItem } from '../src/briefing-history-view';
import '../../desktop/src/renderer/src/styles.css';
import '../../desktop/src/renderer/src/notification-center.css';
import '../src/styles.css';
import '../src/workspace.css';
const noop = () => {};
window.fetch = async () => {
  throw Error('No backend requests permitted in this synthetic view');
};
function Preview() {
  const [view, setView] = useState<'history' | 'papers' | 'manage'>('history');
  return (
    <main style={{ display: 'grid', gridTemplateColumns: '230px minmax(0,1fr)', height: '100vh' }}>
      <aside className="desktop-nav" style={{ gridColumn: 1, gridRow: 1, maxHeight: 'none' }}>
        <h2>GOSU · 검증용</h2>
        <ProjectSidebar
          projects={[]}
          activeProjectId=""
          activeTab="briefing-lab"
          briefingView={view}
          onSelectBriefingView={setView}
          settingsActive={false}
          navigationState={DEFAULT_PROJECT_NAVIGATION_STATE}
          onNavigationStateChange={noop}
          onSelectProject={noop}
          onSelectProjectTab={noop}
          onSelectGlobalTab={() => setView('history')}
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
      <section style={{ padding: 24, overflow: 'auto' }}>
        <h1>{view === 'papers' ? '논문 요약' : '개인 연구 브리핑'}</h1>
        <p>독립 메뉴와 제목 옆 링크 · 합성 화면</p>
        <BriefingHistoryItem
          item={{
            id: 'p',
            kind: 'papers',
            title: 'Synthetic Study of Reliable Research Workflows',
            sourceUrl: 'https://example.org/paper/version2',
            summary: '요약을 펼치지 않아도 제목 옆에서 원문 링크를 열 수 있습니다.',
            importance: 'high',
            relevance: '',
            readScope: 'abstract',
            keywords: ['Research workflow'],
          }}
        />
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
