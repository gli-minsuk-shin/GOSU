import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ProjectSidebar, type ProjectSidebarProps } from '../src/renderer/src/project-sidebar';
import {
  DEFAULT_PROJECT_NAVIGATION_STATE,
  orderedSidebarProjects,
  reorderSidebarProject,
  saveProjectNavigationState,
  loadProjectNavigationState,
  pruneProjectNavigationState,
  parseProjectNavigationState,
} from '../src/renderer/src/project-navigation-state';
const projects = ['a', 'b', 'c'].map((id) => ({
  id,
  name: `Project ${id}`,
  slug: id,
  version: 1,
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:00Z',
}));
let view: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => view?.unmount());
  vi.unstubAllGlobals();
});
it('persists upward/downward ordering without changing expansion, hidden state or project data', () => {
  const state = {
    ...DEFAULT_PROJECT_NAVIGATION_STATE,
    expandedProjectIds: ['b'],
    hiddenProjectIds: ['hidden'],
    projectOrder: ['a', 'hidden', 'b', 'c'],
  };
  const next = reorderSidebarProject(state, ['a', 'hidden', 'b', 'c'], 'c', 'a', 'before');
  expect(next.projectOrder).toEqual(['c', 'a', 'hidden', 'b']);
  expect(next.expandedProjectIds).toEqual(['b']);
  expect(next.hiddenProjectIds).toEqual(['hidden']);
  const down = reorderSidebarProject(next, ['a', 'hidden', 'b', 'c'], 'c', 'b', 'after');
  expect(down.projectOrder).toEqual(['a', 'hidden', 'b', 'c']);
  let stored = '';
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  };
  expect(saveProjectNavigationState(storage, next)).toBe(true);
  expect(loadProjectNavigationState(storage)).toEqual(next);
  expect(orderedSidebarProjects(projects, next).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  expect(projects.map((p) => p.id)).toEqual(['a', 'b', 'c']);
});
it('appends new projects, prunes only deleted IDs, normalizes stored duplicates and preserves legacy defaults', () => {
  expect(parseProjectNavigationState(DEFAULT_PROJECT_NAVIGATION_STATE)).toEqual(
    DEFAULT_PROJECT_NAVIGATION_STATE,
  );
  const state = parseProjectNavigationState({
    ...DEFAULT_PROJECT_NAVIGATION_STATE,
    projectOrder: ['b', 'b', 42, 'a', 'deleted'],
  });
  expect(orderedSidebarProjects(projects, state).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  expect(pruneProjectNavigationState(state, new Set(['a', 'b'])).projectOrder).toEqual(['b', 'a']);
  expect(reorderSidebarProject(state, ['a', 'b'], 'unknown', 'b', 'after')).toBe(state);
  expect(reorderSidebarProject(state, ['a', 'b'], 'b', 'b', 'before')).toBe(state);
});
async function fixture(disabled = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const change = vi.fn(),
    select = vi.fn();
  const props = {
    projects,
    activeProjectId: 'b',
    activeTab: 'chat',
    settingsActive: false,
    disabled,
    navigationState: { ...DEFAULT_PROJECT_NAVIGATION_STATE, expandedProjectIds: ['b'] },
    onNavigationStateChange: change,
    onSelectProject: select,
  } as unknown as ProjectSidebarProps;
  await act(() => {
    view = create(<ProjectSidebar {...props} />);
  });
  const row = (id: string) => view!.root.findByProps({ 'data-project-id': id });
  const button = (id: string) => row(id).findByProps({ className: 'project-folder-button' });
  const event = (y = 0) => ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    clientY: y,
    dataTransfer: { effectAllowed: '', dropEffect: '', setData: vi.fn() },
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) },
  });
  return { props, change, select, row, button, event };
}
it('shows before/after insertion feedback and drops a project without selecting or collapsing it', async () => {
  const f = await fixture();
  await act(() => f.button('c').props.onDragStart(f.event()));
  const entry = f.event(5);
  await act(() => f.row('a').props.onDragEnter(entry));
  expect(entry.preventDefault).toHaveBeenCalledOnce();
  expect(f.row('a').props['data-drop-position']).toBe('before');
  await act(() => f.row('a').props.onDrop(f.event(5)));
  expect(f.change).toHaveBeenCalledWith(
    expect.objectContaining({ projectOrder: ['c', 'a', 'b'], expandedProjectIds: ['b'] }),
  );
  expect(f.select).not.toHaveBeenCalled();
  expect(f.row('a').props['data-drop-position']).toBeUndefined();
  f.change.mockClear();
  await act(() => f.button('a').props.onDragStart(f.event()));
  await act(() => f.row('c').props.onDragOver(f.event(35)));
  expect(f.row('c').props['data-drop-position']).toBe('after');
  await act(() => f.row('c').props.onDrop(f.event(35)));
  expect(f.change).toHaveBeenCalledWith(expect.objectContaining({ projectOrder: ['b', 'c', 'a'] }));
});
it('ignores external file drags and cancelled drags', async () => {
  const f = await fixture();
  await act(() => f.row('b').props.onDrop(f.event()));
  expect(f.change).not.toHaveBeenCalled();
  await act(() => f.button('a').props.onDragStart(f.event()));
  await act(() => f.button('a').props.onDragEnd());
  await act(() => f.row('b').props.onDrop(f.event()));
  expect(f.change).not.toHaveBeenCalled();
});
it('disables drag while unavailable and clears a drag when the group disappears', async () => {
  const f = await fixture(true);
  expect(f.button('a').props.draggable).toBe(false);
  await act(() => f.button('a').props.onDragStart(f.event()));
  await act(() => f.row('b').props.onDrop(f.event()));
  expect(f.change).not.toHaveBeenCalled();
  await act(() => view!.update(<ProjectSidebar {...f.props} disabled={false} />));
  await act(() => f.button('a').props.onDragStart(f.event()));
  await act(() =>
    view!.update(
      <ProjectSidebar
        {...f.props}
        disabled={false}
        navigationState={{ ...f.props.navigationState, activeGroupExpanded: false }}
      />,
    ),
  );
  await act(() => view!.update(<ProjectSidebar {...f.props} disabled={false} />));
  await act(() => f.row('b').props.onDrop(f.event()));
  expect(f.change).not.toHaveBeenCalled();
});
it('provides menu controls as an alternative and renders the saved order', async () => {
  const f = await fixture();
  const menus = f.row('b').findAllByProps({ role: 'menuitem' });
  await act(() => menus[0]!.props.onClick());
  expect(f.change).toHaveBeenCalledWith(expect.objectContaining({ projectOrder: ['b', 'a', 'c'] }));
  await act(() =>
    view!.update(<ProjectSidebar {...f.props} navigationState={f.change.mock.calls[0]![0]} />),
  );
  expect(
    view!.root
      .findAllByProps({ className: 'project-folder-row' })
      .map((r) => r.props['data-project-id']),
  ).toEqual(['b', 'a', 'c']);
});
