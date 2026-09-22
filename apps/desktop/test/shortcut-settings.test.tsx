import { expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { ShortcutSettings } from '../src/renderer/src/shortcut-settings';
import { DEFAULT_ASSISTANT_SHORTCUT } from '../src/shared/assistant-shortcut';
it('selects a shortcut without recording keystrokes, explicitly saves and restores the default', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const save = vi.fn(async (v: string) => v);
  vi.stubGlobal('window', {
    gosu: {
      app: {
        getAssistantShortcut: async () => DEFAULT_ASSISTANT_SHORTCUT,
        setAssistantShortcut: save,
      },
    },
  });
  let view: ReturnType<typeof create> | undefined;
  try {
    await act(() => {
      view = create(<ShortcutSettings />);
    });
    expect(view!.root.findAllByType('input')).toHaveLength(0);
    await act(() =>
      view!.root
        .findByProps({ 'aria-label': '단축키 키' })
        .props.onChange({ target: { value: 'A' } }),
    );
    expect(save).not.toHaveBeenCalled();
    await act(() => view!.root.findAllByType('button')[0]!.props.onClick());
    expect(save).toHaveBeenLastCalledWith('CommandOrControl+Shift+A');
    await act(() => view!.root.findAllByType('button')[1]!.props.onClick());
    expect(save).toHaveBeenLastCalledWith(DEFAULT_ASSISTANT_SHORTCUT);
    await act(() =>
      view!.root
        .findByProps({ 'aria-label': '단축키 키' })
        .props.onChange({ target: { value: 'Q' } }),
    );
    expect(view!.root.findAllByType('button')[0]!.props.disabled).toBe(true);
    expect(view!.root.findByProps({ role: 'alert' })).toBeDefined();
  } finally {
    await act(() => view?.unmount());
    vi.unstubAllGlobals();
  }
});
it('keeps the old selection on a failed save and exposes a retry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const save = vi
    .fn()
    .mockRejectedValueOnce(Error('disk'))
    .mockImplementation(async (v) => v);
  vi.stubGlobal('window', {
    gosu: {
      app: {
        getAssistantShortcut: async () => DEFAULT_ASSISTANT_SHORTCUT,
        setAssistantShortcut: save,
      },
    },
  });
  let view: ReturnType<typeof create> | undefined;
  try {
    await act(() => {
      view = create(<ShortcutSettings />);
    });
    await act(() =>
      view!.root
        .findByProps({ 'aria-label': '단축키 보조키' })
        .props.onChange({ target: { value: 'CommandOrControl+Alt' } }),
    );
    await act(() => view!.root.findAllByType('button')[0]!.props.onClick());
    expect(view!.root.findByProps({ role: 'alert' }).children.join('')).toContain(
      '기존 설정은 유지',
    );
    expect(view!.root.findAllByType('button')[0]!.props.disabled).toBe(false);
    await act(() => view!.root.findAllByType('button')[0]!.props.onClick());
    expect(save).toHaveBeenLastCalledWith('CommandOrControl+Alt+Space');
  } finally {
    await act(() => view?.unmount());
    vi.unstubAllGlobals();
  }
});

it('sets Calendar, To-do and Briefing Lab shortcuts, turns one off, and refuses a chord in use', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const defaults = {
    calendar: 'CommandOrControl+Shift+C',
    tasks: 'CommandOrControl+Shift+T',
    briefing: 'CommandOrControl+Shift+B',
    briefingRun: 'CommandOrControl+Shift+Enter',
  };
  const saveScreens = vi.fn(async (value: typeof defaults) => value);
  vi.stubGlobal('window', {
    gosu: {
      app: {
        getAssistantShortcut: async () => DEFAULT_ASSISTANT_SHORTCUT,
        setAssistantShortcut: vi.fn(),
        getAppShortcuts: async () => defaults,
        setAppShortcuts: saveScreens,
      },
    },
  });
  let view: ReturnType<typeof create> | undefined;
  try {
    await act(() => {
      view = create(<ShortcutSettings />);
    });
    const text = () => JSON.stringify(view!.toJSON());
    expect(text()).toContain('캘린더');
    expect(text()).toContain('⌘ + ⇧ + T');
    const saveButton = () =>
      view!.root.findAllByType('button').find((b) => b.children.join('') === '화면 단축키 저장')!;
    expect(saveButton().props.disabled).toBe(true);
    // Another key for To-do, Briefing Lab off.
    await act(() =>
      view!.root
        .findByProps({ 'aria-label': '할 일 단축키 키' })
        .props.onChange({ target: { value: 'D' } }),
    );
    await act(() =>
      view!.root
        .findByProps({ 'aria-label': 'Briefing Lab 단축키 사용' })
        .props.onChange({ target: { checked: false } }),
    );
    await act(() => saveButton().props.onClick());
    expect(saveScreens).toHaveBeenLastCalledWith({
      calendar: 'CommandOrControl+Shift+C',
      tasks: 'CommandOrControl+Shift+D',
      briefing: null,
      briefingRun: 'CommandOrControl+Shift+Enter',
    });
    // "새 브리핑 실행" is a row of its own (an action, not "… 열기"), shows ⇧⌘Enter, offers Enter
    // as a key, and can be moved to another chord.
    expect(text()).toContain('새 브리핑 실행');
    expect(text()).not.toContain('새 브리핑 실행 열기');
    expect(text()).toContain('⌘ + ⇧ + Enter');
    const runKey = view!.root.findByProps({ 'aria-label': '새 브리핑 실행 단축키 키' });
    expect(runKey.props.value).toBe('Enter');
    expect(runKey.findAllByType('option').map((o) => o.props.value)).toContain('Enter');
    await act(() => runKey.props.onChange({ target: { value: 'R' } }));
    await act(() => saveButton().props.onClick());
    expect(saveScreens).toHaveBeenLastCalledWith(
      expect.objectContaining({ briefingRun: 'CommandOrControl+Shift+R' }),
    );
    // The Calendar chord cannot be reused for To-do, nor can the assistant's.
    await act(() =>
      view!.root
        .findByProps({ 'aria-label': '할 일 단축키 키' })
        .props.onChange({ target: { value: 'C' } }),
    );
    // Both rows say which screen they collide with.
    const alerts = view!.root.findAllByProps({ role: 'alert' }).map((a) => a.children.join(''));
    expect(alerts).toHaveLength(2);
    expect(alerts.join(' ')).toContain('할 일 단축키와 같습니다');
    expect(alerts.join(' ')).toContain('캘린더 단축키와 같습니다');
    expect(saveButton().props.disabled).toBe(true);
    await act(() =>
      view!.root
        .findByProps({ 'aria-label': '할 일 단축키 키' })
        .props.onChange({ target: { value: 'Space' } }),
    );
    expect(view!.root.findByProps({ role: 'alert' }).children.join('')).toContain('AI 비서');
  } finally {
    await act(() => view?.unmount());
    vi.unstubAllGlobals();
  }
});
