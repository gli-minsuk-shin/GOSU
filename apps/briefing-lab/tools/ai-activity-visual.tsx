import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectSidebar } from '../../desktop/src/renderer/src/project-sidebar';
import { useSidebarAiActivity } from '../../desktop/src/renderer/src/sidebar-ai-activity';
import {
  DEFAULT_PROJECT_NAVIGATION_STATE,
  type ProjectNavigationState,
} from '../../desktop/src/renderer/src/project-navigation-state';
import type { WorkspaceTabId } from '../../desktop/src/renderer/src/workspace-views';
import '../../desktop/src/renderer/src/styles.css';
const projects = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Research Alpha',
    slug: 'research-alpha',
    version: 1,
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Research Beta',
    slug: 'research-beta',
    version: 1,
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
  },
];
const noop = () => {};
function Preview() {
  const ai = useSidebarAiActivity();
  const [navigation, setNavigation] = useState<ProjectNavigationState>({
    ...DEFAULT_PROJECT_NAVIGATION_STATE,
    expandedProjectIds: [projects[0]!.id],
  });
  const [activeProjectId, setProject] = useState(projects[0]!.id);
  const [tab, setTab] = useState<WorkspaceTabId>('model-lab');
  const [view, setView] = useState<'history' | 'papers' | 'manage' | 'assistant'>('history');
  const [width, setWidth] = useState(280);
  const scopes = [
    'assistant',
    'briefing',
    'papers',
    `project:${projects[0]!.id}:chat`,
    `project:${projects[0]!.id}:model-lab`,
    `project:${projects[1]!.id}:model-lab`,
  ];
  const start = (scope: string) =>
    ai.report(scope, {
      type: 'gosu-ai-activity',
      workload: 'model-lab',
      runId: 'preview',
      phase: 'running',
    });
  const finish = (scope: string) =>
    ai.report(scope, {
      type: 'gosu-ai-activity',
      workload: 'model-lab',
      runId: 'preview',
      phase: 'completed',
    });
  useEffect(() => {
    document.documentElement.style.colorScheme = 'light';
    start(scopes[0]!);
    start(scopes[3]!);
    finish(scopes[3]!);
    start(scopes[4]!);
    start(scopes[5]!);
    finish(scopes[5]!);
  }, []);
  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--surface)' }}>
      <aside className="desktop-nav" style={{ width, flex: '0 0 auto', height: '100vh' }}>
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProjectId}
          activeTab={tab}
          navigationState={navigation}
          settingsActive={false}
          aiActivity={ai.activity}
          onAcknowledgeAi={ai.acknowledge}
          briefingView={view}
          onNavigationStateChange={setNavigation}
          onSelectProject={setProject}
          onSelectProjectTab={(id, t) => {
            setProject(id);
            setTab(t);
          }}
          onSelectGlobalTab={setTab}
          onOpenAssistant={() => {
            setTab('briefing-lab');
            setView('assistant');
          }}
          onSelectBriefingView={(v) => {
            setTab('briefing-lab');
            setView(v);
          }}
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
      <main style={{ padding: 28, overflow: 'auto' }}>
        <h2>AI 작업 상태 · 합성 화면</h2>
        <p>윤곽 별: 작업 중 / 채운 별: 완료 · 항목을 누르면 완료 표시 해제</p>
        <p>실제 계정·LLM·프로젝트 작업은 실행하지 않습니다.</p>
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <button
            onClick={() => {
              document.documentElement.style.colorScheme = 'light';
            }}
          >
            라이트
          </button>
          <button
            onClick={() => {
              document.documentElement.style.colorScheme = 'dark';
            }}
          >
            다크
          </button>
          <button onClick={() => setWidth(width === 280 ? 332 : 280)}>사이드바 너비</button>
        </div>
        {scopes.map((scope) => (
          <div key={scope} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <span style={{ minWidth: 190 }}>
              {scope.startsWith('project:')
                ? `${scope.includes(projects[0]!.id) ? 'Alpha' : 'Beta'} · ${scope.split(':').at(-1)}`
                : scope}
            </span>
            <button onClick={() => start(scope)}>시작</button>
            <button onClick={() => finish(scope)}>완료</button>
            <button onClick={() => ai.reset(scope)}>지우기</button>
          </div>
        ))}
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
