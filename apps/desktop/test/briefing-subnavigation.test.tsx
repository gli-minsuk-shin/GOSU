import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { ProjectSidebar, type ProjectSidebarProps } from '../src/renderer/src/project-sidebar';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../src/renderer/src/project-navigation-state';
it('expands Briefing children in the main sidebar and selects papers without a second sidebar', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onSelectBriefingView = vi.fn();
  const onOpenAssistant = vi.fn();
  const props = {
    projects: [],
    activeProjectId: '',
    activeTab: 'briefing-lab',
    settingsActive: false,
    navigationState: DEFAULT_PROJECT_NAVIGATION_STATE,
    onSelectGlobalTab: vi.fn(),
    onSelectBriefingView,
    onOpenAssistant,
  } as unknown as ProjectSidebarProps;
  let ui: ReturnType<typeof create>;
  try {
    await act(() => {
      ui = create(<ProjectSidebar {...props} />);
    });
    const parent = ui!.root.findByProps({ 'aria-label': 'Briefing Lab' });
    const quick = ui!.root
      .findByProps({ className: 'project-quick-actions' })
      .findAllByType('button');
    expect(quick[0]!.props['aria-label']).toBe('AI 비서');
    await act(() => quick[0]!.props.onClick());
    expect(onOpenAssistant).toHaveBeenCalledOnce();
    expect(parent.props['aria-expanded']).toBe(false);
    await act(() => parent.props.onClick());
    expect(parent.props['aria-expanded']).toBe(true);
    const children = ui!.root
      .findByProps({ 'aria-label': 'Briefing Lab 하위 세션' })
      .findAllByType('button');
    expect(children).toHaveLength(3);
    await act(() => children[1]!.props.onClick());
    expect(onSelectBriefingView).toHaveBeenCalledWith('papers');
    await act(() => parent.props.onClick());
    expect(ui!.root.findAllByProps({ 'aria-label': 'Briefing Lab 하위 세션' })).toHaveLength(0);
  } finally {
    await act(() => ui!?.unmount());
    vi.unstubAllGlobals();
  }
});
