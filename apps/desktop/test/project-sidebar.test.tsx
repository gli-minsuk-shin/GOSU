import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { SidebarIcon } from '../src/renderer/src/sidebar-icon';
import { describe, expect, it, vi } from 'vitest';

import {
  ProjectSidebar,
  ProjectSidebarToggle,
  type ProjectSidebarProps,
} from '../src/renderer/src/project-sidebar';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../src/renderer/src/project-navigation-state';
import type { PortfolioProjectRecord } from '../src/renderer/src/project-portfolio-model';

it('preserves the bubble and green sparkle artwork at the same 18px size as neighboring icons', () => {
  const html = renderToStaticMarkup(<SidebarIcon name="assistant" />);
  expect(html.match(/<circle /g)).toHaveLength(3);
  for (const cx of [7, 11, 15]) expect(html).toContain(`cx="${cx}" cy="14"`);
  expect(html).toContain('M6 5h12a4');
  expect(html).toContain('data-assistant-bubble="true"');
  expect(html).toContain('data-assistant-sparkle="true"');
  expect(html).toContain('M17.25 .75C18.2 4.7 19.3 5.8 23.25 6.75');
  expect(html).toContain('fill="var(--green, currentColor)"');
  expect(html).toContain('paint-order="stroke"');
  expect(html).toContain('sidebar-nav-icon-assistant-slot');
  const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.sidebar-nav-icon-assistant\s*\{\s*width: 18px;\s*height: 18px;/u);
  expect(html).not.toContain('<animate');
  expect(renderToStaticMarkup(<SidebarIcon name="chat" />)).not.toContain('data-assistant-sparkle');
  expect(html).toContain('viewBox="0 0 24 24"');
});

const baseProject: PortfolioProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Active Alpha',
  slug: 'active-alpha',
  version: 1,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const projects: readonly PortfolioProjectRecord[] = [
  baseProject,
  {
    ...baseProject,
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Hidden Beta',
    slug: 'hidden-beta',
  },
  {
    ...baseProject,
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Archived Gamma',
    slug: 'archived-gamma',
    archivedAt: '2026-08-04T01:00:00.000Z',
  },
  {
    ...baseProject,
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Trashed Delta',
    slug: 'trashed-delta',
    trashedAt: '2026-08-04T02:00:00.000Z',
  },
];

function sidebarElement(overrides: Partial<ProjectSidebarProps> = {}) {
  const props: ProjectSidebarProps = {
    projects,
    activeProjectId: baseProject.id,
    activeTab: 'chat',
    navigationState: {
      ...DEFAULT_PROJECT_NAVIGATION_STATE,
      expandedProjectIds: [baseProject.id],
      hiddenProjectIds: ['22222222-2222-4222-8222-222222222222'],
      hiddenGroupExpanded: true,
      archivedGroupExpanded: true,
    },
    settingsActive: false,
    busyProjectIds: new Set([baseProject.id]),
    onNavigationStateChange: vi.fn(),
    onSelectProject: vi.fn(),
    onSelectProjectTab: vi.fn(),
    onSelectGlobalTab: vi.fn(),
    onHideProject: vi.fn(),
    onShowProject: vi.fn(),
    onShowAllProjects: vi.fn(),
    onArchiveProject: vi.fn(),
    onRestoreProject: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onOpenSettings: vi.fn(),
    onNewProject: vi.fn(),
    ...overrides,
  };
  return <ProjectSidebar {...props} />;
}
function renderSidebar(overrides: Partial<ProjectSidebarProps> = {}) {
  return renderToStaticMarkup(sidebarElement(overrides));
}
it('shows Critical Review work on Review rather than the ordinary chat icon', () => {
  const html = renderSidebar({
    aiActivity: { [`project:${baseProject.id}:review`]: { running: ['r'], completed: false } },
  });
  const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1] ?? '');
  expect(buttons.find((b) => b.includes('data-sidebar-icon="review"'))).toContain(
    'sidebar-ai-star is-running',
  );
  expect(buttons.find((b) => b.includes('data-sidebar-icon="chat"'))).not.toContain(
    'sidebar-ai-star',
  );
});
it('renders running and completed stars without resizing the base icon, and acknowledges the clicked section', async () => {
  const scope = `project:${baseProject.id}:model-lab`;
  const onAcknowledgeAi = vi.fn();
  const aiActivity = {
    assistant: { running: ['a'], completed: false },
    [scope]: { running: [], completed: true },
  };
  const html = renderSidebar({ aiActivity, busyProjectIds: new Set() });
  expect(html).toContain('sidebar-ai-star is-running');
  expect(html).toContain('sidebar-ai-star is-completed');
  expect(html).toContain('data-sidebar-icon="model-lab"');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let ui!: ReturnType<typeof create>;
  await act(() => {
    ui = create(sidebarElement({ aiActivity, busyProjectIds: new Set(), onAcknowledgeAi }));
  });
  await act(() =>
    ui.root
      .findAllByType('button')
      .find((b) => b.findAllByProps({ 'data-sidebar-icon': 'model-lab' }).length)!
      .props.onClick(),
  );
  expect(onAcknowledgeAi).toHaveBeenCalledWith(scope);
  await act(() => ui.unmount());
  vi.unstubAllGlobals();
  const css = readFileSync(
    new URL('../src/renderer/src/sidebar-ai-activity.css', import.meta.url),
    'utf8',
  );
  expect(css).toContain('prefers-reduced-motion: reduce');
  expect(css).toContain('stroke-dashoffset: -1');
  // Work in progress is a bright, glowing, pulsing star with two sparks, large enough to notice.
  expect(css).toMatch(/\.sidebar-ai-star \{[^}]*width: 14px;[^}]*height: 14px;/);
  expect(css).toMatch(
    /\.sidebar-ai-star\.is-running \{[^}]*drop-shadow[^}]*animation: sidebar-ai-pulse 1\.15s/,
  );
  expect(css).toMatch(/\.sidebar-ai-star\.is-running path \{[^}]*fill: currentColor;/);
  expect(css).toMatch(
    /\.sidebar-ai-star\.is-running::before,\s*\.sidebar-ai-star\.is-running::after \{[^}]*clip-path: polygon/,
  );
  expect(css).toMatch(/@keyframes sidebar-ai-pulse \{[\s\S]*?scale\(1\.28\)/);
});
it('keeps a collapsed project activity visible without repeating it on the expanded project row', () => {
  const aiActivity = {
    [`project:${baseProject.id}:model-lab`]: { running: ['a'], completed: false },
  };
  const html = renderSidebar({
    aiActivity,
    busyProjectIds: new Set(),
    navigationState: { ...DEFAULT_PROJECT_NAVIGATION_STATE, expandedProjectIds: [] },
  });
  expect(html).toContain('sidebar-ai-star is-running');
  expect(html).not.toContain('data-sidebar-icon="model-lab"');
});
it('shows the star after the row name, glows yellow when finished, and clears through the row click', async () => {
  const aiActivity = {
    briefing: { running: [], completed: true },
    papers: { running: ['p'], completed: false },
    assistant: { running: [], completed: true },
  };
  const html = renderSidebar({ aiActivity, busyProjectIds: new Set() });
  const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1] ?? '');
  const briefing = buttons.find((b) => b.includes('data-sidebar-icon="briefing-lab"'))!;
  expect(briefing).toMatch(/<span>Briefing Lab<\/span><span class="sidebar-ai-star is-completed"/);
  expect(briefing.slice(0, briefing.indexOf('<span>Briefing Lab</span>'))).not.toContain(
    'sidebar-ai-star',
  );
  const papers = buttons.find((b) => b.includes('data-sidebar-icon="literature"'))!;
  expect(papers.indexOf('sidebar-ai-star is-running')).toBeGreaterThan(
    papers.indexOf('</svg></span>'),
  );
  // The icon-only assistant button has no name, so its star stays on the icon.
  const assistant = buttons.find((b) => b.includes('data-sidebar-icon="assistant"'))!;
  expect(assistant).toMatch(/<\/svg><span class="sidebar-ai-star is-completed"/);

  const css = readFileSync(
    new URL('../src/renderer/src/sidebar-ai-activity.css', import.meta.url),
    'utf8',
  );
  expect(css).toMatch(/\.sidebar-ai-star\.is-completed \{[^}]*color: #f2b705;[^}]*drop-shadow/);
  expect(css).toMatch(/\.sidebar-ai-star \{[^}]*pointer-events: none;/);

  const onAcknowledgeAi = vi.fn();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(sidebarElement({ aiActivity, busyProjectIds: new Set(), onAcknowledgeAi }));
    });
    await act(() =>
      ui.root.findByProps({ 'aria-label': 'Briefing Lab', type: 'button' }).props.onClick(),
    );
    expect(onAcknowledgeAi).toHaveBeenCalledWith('briefing');
  } finally {
    await act(() => ui?.unmount());
    vi.unstubAllGlobals();
  }
});
it('uses independent Briefing and paper rows, navigates directly, and selects only the current row', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const select = vi.fn(),
    global = vi.fn();
  let ui!: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(
        sidebarElement({
          activeTab: 'briefing-lab',
          briefingView: 'papers',
          onSelectBriefingView: select,
          onSelectGlobalTab: global,
        }),
      );
    });
    const group = ui.root.findByProps({ 'aria-label': 'Personal workspace' });
    const buttons = group.findAllByType('button');
    expect(buttons).toHaveLength(4);
    expect(buttons[2]!.props['aria-expanded']).toBeUndefined();
    expect(buttons[2]!.props['aria-current']).toBeUndefined();
    expect(buttons[3]!.props['aria-current']).toBe('page');
    await act(() => buttons[2]!.props.onClick());
    expect(select).toHaveBeenLastCalledWith('history');
    await act(() => buttons[3]!.props.onClick());
    expect(select).toHaveBeenLastCalledWith('papers');
    expect(global).not.toHaveBeenCalled();
    expect(ui.root.findAllByProps({ className: 'briefing-subnavigation' })).toHaveLength(0);
    expect(renderSidebar()).not.toContain('루틴 관리');
  } finally {
    await act(() => ui.unmount());
    vi.unstubAllGlobals();
  }
});

describe('folder-style project sidebar', () => {
  it('places search/notifications then named shared personal tools before Projects', () => {
    const html = renderSidebar();
    expect(html.indexOf('aria-label="Workspace shortcuts"')).toBeLessThan(
      html.indexOf('class="project-navigation-heading"'),
    );
    expect(html).toContain('aria-label="Search"');
    expect(html).toContain('aria-label="To-do list"');
    const personal = html.slice(
      html.indexOf('class="project-personal-tools"'),
      html.indexOf('class="project-navigation-heading"'),
    );
    expect(personal.indexOf('Calendar')).toBeLessThan(personal.indexOf('To-do list'));
    expect(personal.indexOf('To-do list')).toBeLessThan(personal.indexOf('Briefing Lab'));
    expect(html.slice(0, html.indexOf('class="project-personal-tools"'))).not.toContain(
      'data-sidebar-icon="tasks"',
    );
    expect(html).toContain('aria-label="Notifications, 0 unread"');
    const global = html.slice(html.indexOf('class="project-global-navigation"'));
    expect(global).not.toContain('data-sidebar-icon="search"');
    expect(global).not.toContain('data-sidebar-icon="tasks"');
  });
  it('exposes one Model Lab tab in each project folder immediately below Project chat', () => {
    const html = renderSidebar({ projects: [baseProject], activeTab: 'model-lab' });
    expect(html.match(/>Model Lab</g)).toHaveLength(1);
    expect(html.indexOf('>Project chat<')).toBeLessThan(html.indexOf('>Model Lab<'));
    expect(html.indexOf('>Model Lab<')).toBeLessThan(html.indexOf('>Repository<'));
  });
  it('keeps an accessible titlebar control available in both sidebar states', () => {
    const expanded = renderToStaticMarkup(
      <ProjectSidebarToggle collapsed={false} onToggle={vi.fn()} />,
    );
    const collapsed = renderToStaticMarkup(<ProjectSidebarToggle collapsed onToggle={vi.fn()} />);

    expect(expanded).toContain('aria-label="Hide project sidebar"');
    expect(expanded).toContain('aria-controls="workspace-sidebar"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(collapsed).toContain('aria-label="Show project sidebar"');
    expect(collapsed).toContain('aria-expanded="false"');
  });

  it('uses one accessible outline SVG family for every destination and no decorative project glyph', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
    const html = renderSidebar();

    expect(styles).toMatch(/\.sidebar-toggle-button\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/su);
    expect(styles).toMatch(
      /\.sidebar-toggle-button svg\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;[^}]*stroke-width:\s*1\.6;/su,
    );
    expect(styles).toMatch(/\.sidebar-nav-icon\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;/su);
    expect(styles).toMatch(
      /\.sidebar-nav-icon-graphic\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*fill:\s*none;[^}]*stroke:\s*currentColor;[^}]*stroke-width:\s*1\.7;[^}]*stroke-linecap:\s*round;[^}]*stroke-linejoin:\s*round;/su,
    );
    expect(styles).toMatch(
      /\.project-folder-chevron \.collapse-chevron,[^}]*\.project-group-toggle > \.collapse-chevron\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/su,
    );
    const expectedIcons = [
      'assistant',
      'search',
      'notifications',
      'calendar',
      'tasks',
      'briefing-lab',
      'literature',
      'chat',
      'model-lab',
      'repository',
      'manuscript',
      'review',
      'board',
      'objective',
      'experiments',
      'literature',
      'notes',
      'lecture',
      'connections',
      'usage',
      'settings',
    ];
    const icons = [...html.matchAll(/<svg\b[^>]*data-sidebar-icon="([^"]+)"[^>]*>/gu)];
    expect(icons.map((match) => match[1])).toEqual(expectedIcons);
    for (const [markup, name] of icons) {
      expect(markup).toContain(`class="sidebar-nav-icon-graphic sidebar-nav-icon-${name}"`);
      expect(markup).toContain('viewBox="0 0 24 24"');
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('focusable="false"');
    }
    expect(html.match(/class="sidebar-nav-icon(?: [^"]*)?"/gu)).toHaveLength(expectedIcons.length);
    expect(html).not.toContain('project-folder-icon');
    expect(styles).not.toContain('.project-folder-icon');
    expect(html).not.toMatch(/[◈▰▱▦⌁▤◇⚙⌕▹]/u);
    expect(html).toContain('Actions for Active Alpha');
    expect(html).toContain('AI working');
    expect(html).toContain('class="collapse-chevron"');
    expect(html).toContain('aria-label="Active projects"');
  });

  it('smoothly collapses the desktop sidebar without moving content between grid rows', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.desktop-shell\s*\{[^}]*--sidebar-width:\s*var\(--project-sidebar-width, 280px\);[^}]*--titlebar-height:\s*46px;[^}]*grid-template:\s*var\(--titlebar-height\) minmax\(0, 1fr\) \/ var\(--sidebar-width\) minmax\(\s*0,\s*1fr\s*\);[^}]*transition:\s*grid-template-columns 240ms/su,
    );
    expect(styles).toMatch(
      /\.desktop-shell\.sidebar-collapsed\s*\{\s*--sidebar-width:\s*0px;\s*\}/su,
    );
    expect(styles).toMatch(
      /\.desktop-content\s*\{\s*grid-row:\s*2;\s*grid-column:\s*2;[^}]*scrollbar-gutter:\s*stable;/su,
    );
    expect(styles).toMatch(
      /\.desktop-shell\.sidebar-collapsed \.desktop-nav\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*visibility:\s*hidden;/su,
    );
    expect(styles).not.toContain('.desktop-nav[hidden]');
  });

  it('uses one compact titlebar height across desktop and responsive layouts', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.titlebar\s*\{[^}]*grid-row:\s*1;[^}]*grid-column:\s*1 \/ -1;[^}]*height:\s*var\(--titlebar-height\);/su,
    );
    expect(styles).toMatch(
      /\.titlebar \.logo\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*border-radius:\s*7px;/su,
    );
    expect(styles).toMatch(
      /@media \(max-width: 860px\)[\s\S]*?grid-template:\s*var\(--titlebar-height\) auto minmax\(0, 1fr\) \/ 1fr;[\s\S]*?grid-template:\s*var\(--titlebar-height\) minmax\(0, 1fr\) \/ 1fr;[\s\S]*?\.desktop-nav\s*\{[^}]*max-height:\s*min\(320px, 40vh\);/u,
    );
    expect(styles).not.toMatch(/grid-template:\s*58px/u);
  });

  it('pins window chrome and delegates scrolling to the sidebar and page panes', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /html,\s*body,\s*#root\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su,
    );
    expect(styles).toMatch(
      /\.desktop-shell\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su,
    );
    expect(styles).not.toMatch(/\.desktop-shell\s*\{[^}]*min-height:\s*100vh;/su);
    expect(styles).toMatch(
      /\.desktop-nav\s*\{[^}]*grid-row:\s*2;[^}]*grid-column:\s*1;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*scrollbar-gutter:\s*stable;/su,
    );
    expect(styles).toMatch(
      /\.desktop-content\s*\{[^}]*grid-row:\s*2;[^}]*grid-column:\s*2;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*scrollbar-gutter:\s*stable;/su,
    );
  });

  it('keeps responsive collapse behavior and respects reduced-motion preferences', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.desktop-shell,\s*\.desktop-nav,\s*\.notes-layout,\s*\.project-chat-workspace,\s*\.research-notes-sidebar-tools-chevron,\s*\.resize-handle::after\s*\{\s*transition:\s*none;/su,
    );
    expect(styles).toMatch(
      /@media \(max-width: 860px\)[\s\S]*?\.desktop-shell\.sidebar-collapsed \.desktop-nav\s*\{\s*display:\s*none;/u,
    );
  });

  it('exposes a mouse and keyboard accessible persisted sidebar resize separator', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
    const source = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("label={uiText('Resize projects sidebar')}");
    expect(source).toContain("'--project-sidebar-width': `${projectNavigation.sidebarWidth}px`");
    expect(source).toContain('saveProjectNavigationState(window.localStorage, projectNavigation)');
    expect(styles).toMatch(
      /\.project-sidebar-resize-handle\s*\{[^}]*position:\s*absolute;[^}]*left:\s*calc\(var\(--sidebar-width\) - 5px\);/su,
    );
    expect(styles).toMatch(/\.desktop-shell\.sidebar-resizing\s*\{\s*transition:\s*none;/su);
  });

  it('stacks the session rail before two maximized sidebars can consume the chat pane', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.project-chat-workspace\s*\{\s*grid-template:\s*auto minmax\(0, 1fr\) \/ 1fr;\s*\}[\s\S]*?\.project-chat-session-resize-handle\s*\{\s*display:\s*none;/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.project-chat-session-list\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/u,
    );
    expect(861).toBeLessThanOrEqual(1180);
    expect(styles).not.toContain('min(var(--project-sidebar-width, 280px), 34vw)');
    expect(styles).not.toContain('min(var(--project-chat-session-rail-width, 184px), 32%)');
  });

  it('takes a collapsed sidebar out of keyboard and accessibility navigation', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    const toggleHandler = source.match(
      /const toggleProjectSidebarVisibility = useCallback\(\(\) => \{(?<body>[\s\S]*?)\n {2}\}, \[updateProjectNavigation\]\);/u,
    )?.groups?.body;

    expect(source).toContain('aria-hidden={projectNavigation.sidebarCollapsed}');
    expect(source).toContain('inert={projectNavigation.sidebarCollapsed ? true : undefined}');
    expect(toggleHandler).toBeDefined();
    expect(toggleHandler).toContain('sidebarToggleRef.current?.focus()');
    expect(toggleHandler).toContain('updateProjectNavigation(next)');
    expect(toggleHandler?.indexOf('sidebarToggleRef.current?.focus()')).toBeLessThan(
      toggleHandler?.indexOf('updateProjectNavigation(next)') ?? 0,
    );
  });

  it('shows active project folders and the expanded project sections', () => {
    const html = renderSidebar();

    expect(html).toContain('Projects');
    expect(html).toContain('aria-label="Create a new project"');
    expect(html).toContain('Active Alpha');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Project chat');
    expect(html).toContain('Manuscript');
    expect(html.match(/Manuscript/gu)).toHaveLength(1);
    expect(html).toContain('Board');
    expect(html).toContain('Goal &amp; Metrics');
    expect(html).toContain('Literature');
    expect(html).toContain('Experiments');
    expect(html).not.toContain('References');
    expect(html).toContain('AI working');
    expect(html).toContain('Hide locally');
    expect(html).toContain('before hiding this project');
    expect(html).toContain('Move to archive');
    expect(html).toContain('Project settings');
    expect(html).not.toContain('Trashed Delta');
  });

  it('opens the project actions (with "Move to archive") on right-click, and archives from there', async () => {
    // 2026-09-21: the user asked for an archive feature that already existed behind the ••• menu
    // under the label "보관". Right-click now opens that menu and the wording says "아카이브".
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onArchiveProject = vi.fn();
    let ui!: ReturnType<typeof create>;
    await act(() => {
      ui = create(sidebarElement({ onArchiveProject }));
    });
    const row = ui.root
      .findAllByProps({ className: 'project-folder-button' })
      .find((b) => JSON.stringify(b.props.title).includes('Active Alpha'))!;
    expect(row.props.title).toContain('Right-click for actions');
    const menu = { open: false };
    const event = {
      preventDefault: vi.fn(),
      currentTarget: { parentElement: { querySelector: vi.fn(() => menu) } },
    };
    await act(() => row.props.onContextMenu(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.currentTarget.parentElement.querySelector).toHaveBeenCalledWith(
      'details.project-folder-menu',
    );
    expect(menu.open).toBe(true);
    const archive = ui.root
      .findAllByProps({ role: 'menuitem' })
      .find((b) => b.props.children === 'Move to archive')!;
    await act(() => archive.props.onClick());
    expect(onArchiveProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Active Alpha' }),
    );
    await act(() => ui.unmount());
    vi.unstubAllGlobals();
    const messages = readFileSync(
      new URL('../../../packages/ui/src/desktop-messages.ts', import.meta.url),
      'utf8',
    );
    expect(messages).toContain("['Move to archive', '아카이브로 이동']");
    expect(messages).toContain("['Archived', '아카이브']");
    const app = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    // The confirmation is translated and says where the project went.
    expect(app).toContain('Restore it from “Archived” at the bottom of the project list.');
    expect(app).not.toContain('`Archived ${project.name}.`');
  });

  it('keeps hidden and archived projects recoverable in separate groups', () => {
    const html = renderSidebar();

    expect(html).toContain('Hidden projects');
    expect(html).toContain('Hidden Beta');
    expect(html).toContain('Show all');
    expect(html).toContain('Archived');
    expect(html).toContain('Archived Gamma');
    expect(html).toContain('Restore');
  });

  it('keeps Tasks, Lecture Studio, Connections, Usage, and Settings global while Research Notes stays project-scoped', () => {
    const html = renderSidebar();
    const projectNotesPosition = html.indexOf('Research Notes');
    const workspaceNavigationPosition = html.indexOf('<small>Workspace</small>');

    expect(html).toContain('Workspace');
    expect(html).toContain('To-do list');
    expect(html).toContain('Connections');
    expect(html).toContain('Usage');
    expect(html).toContain('Lecture notes &amp; slides');
    expect(html).toContain('Research Notes');
    expect(html).toContain('Settings');
    expect(html.match(/Research Notes/gu)).toHaveLength(1);
    expect(projectNotesPosition).toBeGreaterThan(-1);
    expect(projectNotesPosition).toBeLessThan(workspaceNavigationPosition);
    expect(html.indexOf('aria-label="To-do list"')).toBeLessThan(workspaceNavigationPosition);
    expect(html.indexOf('aria-label="Search"')).toBeLessThan(
      html.indexOf('aria-label="To-do list"'),
    );
    expect(html.indexOf('Lecture notes &amp; slides')).toBeGreaterThan(workspaceNavigationPosition);
    expect(html.indexOf('Connections')).toBeLessThan(html.indexOf('Usage'));
    expect(html.indexOf('Usage')).toBeLessThan(html.indexOf('Settings'));
  });

  it('marks Usage active without marking Settings active', () => {
    const html = renderSidebar({ activeTab: 'usage' });
    const workspaceNavigationPosition = html.indexOf('<small>Workspace</small>');
    const workspaceHtml = html.slice(workspaceNavigationPosition);

    expect(workspaceHtml).toMatch(
      /class="active" aria-current="page"><span class="sidebar-nav-icon" aria-hidden="true"><svg class="sidebar-nav-icon-graphic sidebar-nav-icon-usage"/u,
    );
    expect(workspaceHtml.match(/aria-current="page"/gu)).toHaveLength(1);
  });

  it('marks the workspace Tasks destination active without selecting the project Board child', () => {
    const html = renderSidebar({ activeTab: 'tasks' });
    const workspaceNavigationPosition = html.indexOf('<small>Workspace</small>');
    const workspaceHtml = html.slice(workspaceNavigationPosition);
    const projectHtml = html.slice(0, workspaceNavigationPosition);

    expect(workspaceHtml).not.toContain('data-sidebar-icon="tasks"');
    expect(projectHtml).toMatch(
      /class="project-personal-tool active" aria-current="page" aria-label="To-do list"/u,
    );
    expect(projectHtml).toContain('<span class="sidebar-row-label"><span>Board</span>');
    expect(projectHtml).not.toMatch(/class="active"[^>]*>[^<]*(?:<[^>]+>)*Board<\/button>/u);
  });

  it('does not render project children while the active group is minimized', () => {
    const html = renderSidebar({
      navigationState: {
        ...DEFAULT_PROJECT_NAVIGATION_STATE,
        expandedProjectIds: [baseProject.id],
        activeGroupExpanded: false,
      },
    });

    expect(html).toContain('Projects');
    expect(html).not.toContain('Active Alpha');
    expect(html).not.toContain('Project chat');
    expect(html).not.toContain('Research Notes');
  });

  it('marks the selected project Research Notes destination active', () => {
    const html = renderSidebar({ activeTab: 'notes' });

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Research Notes');
  });
});
