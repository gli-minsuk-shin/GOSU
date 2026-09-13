import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { uiText, useUiText, type UiLanguage } from '@gosu/ui/language';
import {
  ApplicationLanguageSettings,
  useApplicationLanguageSync,
} from '../../src/renderer/src/application-language-ui';
import { ProjectSidebar } from '../../src/renderer/src/project-sidebar';
import { DEFAULT_PROJECT_NAVIGATION_STATE } from '../../src/renderer/src/project-navigation-state';
import type { PortfolioProjectRecord } from '../../src/renderer/src/project-portfolio-model';
import { MarkdownDocument } from '../../src/renderer/src/markdown-document';
import 'katex/dist/katex.min.css';
import '../../src/renderer/src/styles.css';

// This renderer has no preload or real IPC: preferences exist only in this disposable fixture.
let preference = { language: 'en' as UiLanguage, configured: true };
const subscribers = new Set<(value: typeof preference) => void>();
const receipt = { getCalls: 0, setCalls: 0 };
Object.assign(window, {
  gosu: {
    applicationLanguage: {
      get: async () => {
        receipt.getCalls++;
        return { ...preference };
      },
      set: async (language: UiLanguage) => {
        if (language !== 'en' && language !== 'ko') throw new Error('invalid_fixture_language');
        receipt.setCalls++;
        preference = { language, configured: true };
        subscribers.forEach((listener) => listener({ ...preference }));
        return { ...preference };
      },
      onChanged: (listener: (value: typeof preference) => void) => {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
    },
  },
  __languageVisualReceipt: receipt,
});

const source = [
  String.raw`# FM-LM / Settings

User-authored explanation: Keep the name Settings and the model equation unchanged.

$$
H_{1,\mathrm{new}} = X^{\top}(y-XH_1)/N
$$

$$
H_3 = \operatorname{concat}(H_{1,\mathrm{new}}, H_2)
$$

`,
  '```python',
  'H1_new = X.T @ (y - X @ H1) / N',
  'H3 = torch.cat([H1_new, H2], dim=-1)',
  '```',
].join('\n');

const projects: readonly PortfolioProjectRecord[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'FM-LM / Settings',
    slug: 'fm-lm-settings',
    version: 1,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Better GBDT',
    slug: 'better-gbdt',
    version: 1,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  },
];

function Fixture() {
  useUiText();
  useApplicationLanguageSync();
  const [navigationState, setNavigationState] = useState({
    ...DEFAULT_PROJECT_NAVIGATION_STATE,
    activeGroupExpanded: true,
    expandedProjectIds: [projects[0].id],
  });
  const [draft, setDraft] = useState('Unsaved model draft: H3 = concat(H1_new, H2)');
  return (
    <main className="language-visual-shell">
      <header className="titlebar language-visual-titlebar">
        <div className="logo">G</div>
        <strong>GOSU</strong>
        <span>{uiText('Settings')}</span>
      </header>
      <aside className="desktop-nav language-visual-nav">
        <ProjectSidebar
          projects={projects}
          activeProjectId={projects[0].id}
          activeTab="chat"
          navigationState={navigationState}
          settingsActive
          onNavigationStateChange={setNavigationState}
          onSelectProject={() => undefined}
          onSelectProjectTab={() => undefined}
          onSelectGlobalTab={() => undefined}
          onHideProject={() => undefined}
          onShowProject={() => undefined}
          onShowAllProjects={() => undefined}
          onArchiveProject={() => undefined}
          onRestoreProject={() => undefined}
          onOpenProjectSettings={() => undefined}
          onOpenSettings={() => undefined}
          onNewProject={() => undefined}
        />
      </aside>
      <section className="language-visual-content">
        <ApplicationLanguageSettings />
        <article className="settings-card language-visual-preserved">
          <div className="settings-card-heading">
            <span>{uiText('Model pseudocode')}</span>
            <h2>FM-LM / Settings</h2>
          </div>
          <textarea
            data-testid="preserved-draft"
            aria-label="User draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div data-testid="preserved-markdown">
            <MarkdownDocument
              notePath="Settings.md"
              source={source}
              vaultFiles={[]}
              loadVaultImages={false}
              onOpenNote={() => undefined}
            />
          </div>
        </article>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('language_visual_root_missing');
createRoot(root).render(<Fixture />);
