import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setUiLanguage, useUiText } from '@gosu/ui/language';
import { ProjectSidebar } from '../../src/renderer/src/project-sidebar';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../../src/renderer/src/project-navigation-state';
import { useNotificationInbox } from '../../src/renderer/src/use-notification-inbox';
import {
  buildWorkspaceNotifications,
  type WorkspaceNotification,
} from '../../src/renderer/src/workspace-notifications';
import type { WorkspaceTabId } from '../../src/renderer/src/workspace-views';
import type { ProjectRecord, WorkspaceTask } from '../../src/shared/workspace-contracts';
import '../../src/renderer/src/styles.css';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = new Date().toISOString();
const fixtureDay = (offset: number) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const projects: ProjectRecord[] = [
  {
    id: id(1),
    name: 'FM-LM · Fixture',
    slug: 'fixture',
    version: 1,
    createdAt: date,
    updatedAt: date,
  },
  {
    id: id(2),
    name: 'Better GBDT · Fixture',
    slug: 'fixture-two',
    version: 1,
    createdAt: date,
    updatedAt: date,
  },
];
const tasks: WorkspaceTask[] = Array.from({ length: 120 }, (_, i) => ({
  id: id(i + 10),
  projectId: projects[i % 2]!.id,
  title:
    i === 0
      ? 'Review the evaluation plan · 모델 검증 계획과 긴 마감 제목의 줄바꿈 확인'
      : `Fixture task ${i + 1}`,
  status: 'planned',
  dueDate: fixtureDay(i === 0 ? -1 : i % 2 ? 0 : 1),
  version: 1,
  createdAt: date,
  updatedAt: date,
}));
function Fixture() {
  useUiText();
  const [tab, setTab] = useState<WorkspaceTabId>('chat');
  const [projectId, setProjectId] = useState(projects[0]!.id);
  const [selectedTask, setSelectedTask] = useState('');
  const [resolved, setResolved] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [personal, setPersonal] = useState(false);
  const [nav, setNav] = useState({
    ...DEFAULT_PROJECT_NAVIGATION_STATE,
    activeGroupExpanded: true,
    expandedProjectIds: [projects[0]!.id],
  });
  const { inbox, mark, recordTurn, storageError } = useNotificationInbox();
  const items = buildWorkspaceNotifications({
    projects,
    tasks: resolved ? tasks.map((task) => ({ ...task, status: 'done' as const })) : tasks,
    inbox,
    now: new Date(),
    personal: personal
      ? {
          calendarState: 'ready',
          calendarLimited: false,
          calendar: [
            {
              routineId: 'fixture',
              id: 'calendar-fixture',
              calendarId: 'calendar',
              title: '연구 미팅 · 실험 결과 검토',
              start: new Date(Date.now() + 10 * 60_000).toISOString(),
              end: new Date(Date.now() + 70 * 60_000).toISOString(),
              allDay: false,
              timeZone: 'Asia/Seoul',
              alarmMinutes: 15,
            },
          ],
          briefings: [
            {
              id: id(500),
              routineId: 'fixture',
              runId: id(501),
              createdAt: date,
              newEmails: 12,
              importantEmails: 3,
              unclassifiedEmails: 2,
              newPapers: 4,
              emailSourceState: 'ready',
              partial: false,
            },
          ],
        }
      : undefined,
  });
  const open = (item: WorkspaceNotification) => {
    if (item.target.kind === 'task') {
      setTab('tasks');
      setSelectedTask(item.target.taskId);
      setProjectId(item.target.projectId);
    } else if (item.target.kind === 'chat') setTab('chat');
    else if (item.target.kind === 'calendar') setTab('calendar');
    else if (item.target.kind === 'briefing') setTab('briefing-lab');
  };
  return (
    <main
      className="desktop-shell"
      style={
        { '--project-sidebar-width': 'var(--fixture-sidebar-width,220px)' } as React.CSSProperties
      }
    >
      <header className="titlebar">
        <div className="logo">G</div>
        <strong>GOSU</strong>
        <span>Notification visual fixture · no real tasks or accounts</span>
      </header>
      <aside className="desktop-nav">
        <ProjectSidebar
          projects={projects}
          activeProjectId={projectId}
          activeTab={tab}
          navigationState={nav}
          settingsActive={false}
          onNavigationStateChange={setNav}
          onSelectProject={setProjectId}
          onSelectProjectTab={(_project, tab) => setTab(tab)}
          onSelectGlobalTab={setTab}
          onHideProject={() => undefined}
          onShowProject={() => undefined}
          onShowAllProjects={() => undefined}
          onArchiveProject={() => undefined}
          onRestoreProject={() => undefined}
          onOpenProjectSettings={() => undefined}
          onOpenSettings={() => undefined}
          onNewProject={() => undefined}
          notifications={{ items, inbox, onMark: mark, onOpen: open, storageError, suppressed }}
        />
      </aside>
      <section className="desktop-content">
        <h1>Workspace notification center</h1>
        <p>Search · Tasks · Notifications</p>
        <p>Only generated fixture tasks are used. Notifications never change the source task.</p>
        <output
          id="notification-fixture-location"
          data-tab={tab}
          data-task={selectedTask}
          data-status={resolved ? 'done' : 'planned'}
        >
          {tab} {selectedTask}
        </output>
        <div className="fixture-controls">
          <button id="personal-fixture" onClick={() => setPersonal(true)}>
            Fixture calendar and briefing
          </button>
          <button id="resolve-fixture" onClick={() => setResolved(true)}>
            Resolve fixture tasks
          </button>
          <button id="suppress-fixture" onClick={() => setSuppressed((value) => !value)}>
            Toggle approval suppression
          </button>
          <button id="ko-fixture" onClick={() => setUiLanguage('ko')}>
            한국어
          </button>
          <button id="en-fixture" onClick={() => setUiLanguage('en')}>
            English
          </button>
          <button
            id="chat-fixture"
            onClick={() =>
              recordTurn(
                {
                  type: 'turn.completed',
                  projectId: projects[0]!.id,
                  sessionId: id(3),
                  turnId: 'fixture-response',
                  status: 'complete',
                },
                false,
              )
            }
          >
            Fixture chat completion
          </button>
        </div>
        <button id="outside-fixture">Outside notification panel</button>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
