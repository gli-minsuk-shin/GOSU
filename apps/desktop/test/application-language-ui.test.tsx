import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUiLanguage, setUiLanguage, useUiText } from '@gosu/ui/language';
import {
  ApplicationLanguageSettings,
  UI_LANGUAGE_CACHE_KEY,
  useApplicationLanguageSync,
} from '../src/renderer/src/application-language-ui';
import { ProjectSidebar, type ProjectSidebarProps } from '../src/renderer/src/project-sidebar';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../src/renderer/src/project-navigation-state';

const renderers: ReactTestRenderer[] = [];
let saved: Map<string, string>;
let get: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;
let change: ((value: { language: 'en' | 'ko'; configured: boolean }) => void) | undefined;
let fakeDocument: EventTarget & { visibilityState: string; documentElement: { lang: string } };
const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Settings',
  slug: 'settings',
  version: 1,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
};
const noop = () => undefined;
const sidebarProps: ProjectSidebarProps = {
  projects: [project],
  activeProjectId: project.id,
  activeTab: 'chat',
  navigationState: { ...DEFAULT_PROJECT_NAVIGATION_STATE, expandedProjectIds: [project.id] },
  settingsActive: false,
  onNavigationStateChange: noop,
  onSelectProject: noop,
  onSelectProjectTab: noop,
  onSelectGlobalTab: noop,
  onHideProject: noop,
  onShowProject: noop,
  onShowAllProjects: noop,
  onArchiveProject: noop,
  onRestoreProject: noop,
  onOpenProjectSettings: noop,
  onOpenSettings: noop,
  onNewProject: noop,
};
function Harness() {
  useApplicationLanguageSync();
  const t = useUiText();
  const [draft, setDraft] = useState('English draft H_3 = concat(H_1, H_2)');
  return (
    <main>
      <ApplicationLanguageSettings />
      <ProjectSidebar {...sidebarProps} />
      <textarea
        aria-label={t('Message GOSU project copilot')}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </main>
  );
}
async function mount() {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Harness />);
  });
  renderers.push(renderer);
  return renderer;
}
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
beforeEach(() => {
  setUiLanguage('en');
  saved = new Map();
  change = undefined;
  get = vi.fn().mockResolvedValue({ language: 'en', configured: false });
  set = vi.fn(async (language: 'en' | 'ko') => ({ language, configured: true }));
  fakeDocument = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    documentElement: { lang: 'en' },
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      gosu: {
        applicationLanguage: {
          get,
          set,
          onChanged: (listener: typeof change) => {
            change = listener;
            return () => {
              change = undefined;
            };
          },
        },
      },
      localStorage: {
        getItem: (key: string) => saved.get(key) ?? null,
        setItem: (key: string, value: string) => saved.set(key, value),
      },
      setInterval,
      clearInterval,
    }),
  );
});
afterEach(async () => {
  await act(() => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
  setUiLanguage('en');
  vi.unstubAllGlobals();
});
describe('application language settings', () => {
  it('persists a selection before switching the UI and preserves project names and draft state', async () => {
    const renderer = await mount();
    const textarea = renderer.root.findByType('textarea');
    await act(() =>
      textarea.props.onChange({ target: { value: '한국어 / English / H[:, d:] = tanh(H)' } }),
    );
    const button = renderer.root
      .findAllByType('button')
      .find((node) => node.findAllByType('strong').some((strong) => strong.props.lang === 'ko'))!;
    await act(async () => {
      await button.props.onClick();
    });
    expect(set).toHaveBeenCalledWith('ko');
    expect(getUiLanguage()).toBe('ko');
    expect(saved.get(UI_LANGUAGE_CACHE_KEY)).toBe('ko');
    expect(fakeDocument.documentElement.lang).toBe('ko');
    expect(text(renderer)).toContain('프로젝트 채팅');
    expect(text(renderer)).toContain('언어 설정이 저장되었습니다');
    expect(
      renderer.root
        .findByProps({ title: 'Settings', className: 'project-folder-button' })
        .findByType('strong').children,
    ).toEqual(['Settings']);
    expect(renderer.root.findByType('textarea').props.value).toBe(
      '한국어 / English / H[:, d:] = tanh(H)',
    );
    const english = renderer.root
      .findAllByType('button')
      .find((node) => node.findAllByType('strong').some((strong) => strong.props.lang === 'en'))!;
    await act(async () => {
      await english.props.onClick();
    });
    expect(text(renderer)).toContain('Project chat');
    expect(fakeDocument.documentElement.lang).toBe('en');
  });
  it('leaves the previous language unchanged when persistence fails', async () => {
    const renderer = await mount();
    set.mockRejectedValueOnce(new Error('disk_full'));
    const korean = renderer.root
      .findAllByType('button')
      .find((node) => node.findAllByType('strong').some((strong) => strong.props.lang === 'ko'))!;
    await act(async () => {
      await korean.props.onClick();
    });
    expect(getUiLanguage()).toBe('en');
    expect(text(renderer)).toContain('The previous setting is unchanged.');
  });
  it('receives shared changes without resetting the draft and ignores an older in-flight read', async () => {
    let resolve!: (value: { language: 'en'; configured: boolean }) => void;
    get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const renderer = await mount();
    await act(() => change?.({ language: 'ko', configured: true }));
    await act(() => resolve({ language: 'en', configured: false }));
    expect(getUiLanguage()).toBe('ko');
    expect(text(renderer)).toContain('프로젝트 채팅');
    expect(renderer.root.findByType('textarea').props.value).toBe(
      'English draft H_3 = concat(H_1, H_2)',
    );
  });
});
