import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import {
  createTrustedRenderer,
  rendererContentSecurityPolicy,
} from '../../src/main/renderer-trust';

// Must run before ready. Never reuse the installed application's preferences or browser storage.
const userData = mkdtempSync(resolve(tmpdir(), 'gosu-language-visual-'));
app.setPath('userData', userData);
app.setPath('sessionData', userData);
// Do not let closing the fixture window short-circuit a failed assertion with exit code 0.
app.on('window-all-closed', () => undefined);

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function nextFrame(window: BrowserWindow) {
  await window.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}

type Metrics = {
  language: string;
  sidebarWidth: number;
  sidebarOverflow: number;
  documentOverflow: number;
  contentOverflow: number;
  settingsHeading: string;
  chatLabel: string;
  settingsLabel: string;
  projectName: string;
  sameInput: boolean;
  sameMarkdown: boolean;
  draft: string;
  code: string;
  mathCount: number;
  getCalls: number;
  setCalls: number;
};

async function readMetrics(window: BrowserWindow): Promise<Metrics> {
  return window.webContents.executeJavaScript(`(() => {
    const nav = document.querySelector('.language-visual-nav');
    const content = document.querySelector('.language-visual-content');
    const draft = document.querySelector('[data-testid="preserved-draft"]');
    const markdown = document.querySelector('[data-testid="preserved-markdown"]');
    return {
      language: document.documentElement.lang,
      sidebarWidth: nav.getBoundingClientRect().width,
      sidebarOverflow: nav.scrollWidth - nav.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      contentOverflow: content.scrollWidth - content.clientWidth,
      settingsHeading: content.querySelector('.settings-card-heading h2').textContent,
      chatLabel: nav.querySelector('button:has([data-sidebar-icon="chat"])').textContent.trim(),
      settingsLabel: nav.querySelector('button:has([data-sidebar-icon="settings"])').textContent.replace('⌘,', '').trim(),
      projectName: nav.querySelector('.project-folder-button strong').textContent,
      sameInput: draft === window.__languageVisualInput,
      sameMarkdown: markdown.innerHTML === window.__languageVisualMarkdown,
      draft: draft.value,
      code: markdown.querySelector('code').textContent.trim(),
      mathCount: markdown.querySelectorAll('.katex').length,
      ...window.__languageVisualReceipt,
    };
  })()`);
}

async function chooseLanguage(window: BrowserWindow, language: 'en' | 'ko') {
  await window.webContents.executeJavaScript(`(() => {
    const option = document.querySelector('.preference-options button:has(strong[lang="${language}"])');
    if (!option || option.disabled) throw new Error('language_option_unavailable');
    option.click();
  })()`);
  await nextFrame(window);
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 5000;
    const poll = () => {
      if (document.documentElement.lang === '${language}' && !document.querySelector('.preference-options button:disabled')) return resolve(true);
      if (performance.now() > deadline) return reject(new Error('language_not_applied:${language}'));
      requestAnimationFrame(poll);
    };
    poll();
  })`);
}

async function run() {
  const rendererEntry = resolve(
    process.cwd(),
    'out/application-language-visual-smoke/renderer/application-language-visual-smoke.html',
  );
  const screenshots = process.env.GOSU_LANGUAGE_SCREENSHOT_DIR?.trim()
    ? resolve(process.env.GOSU_LANGUAGE_SCREENSHOT_DIR)
    : resolve(process.cwd(), '../../tmp/screenshots/application-language');
  const trusted = createTrustedRenderer({
    developmentUrl: undefined,
    isPackaged: true,
    productionEntryPath: rendererEntry,
  });
  const browserSession = session.fromPartition(`gosu-language-visual-${Date.now()}`);
  let cspApplied = false;
  const violations: string[] = [];
  const errors: string[] = [];
  browserSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url === trusted.entryUrl) cspApplied = true;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [rendererContentSecurityPolicy(trusted)],
      },
    });
  });
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1120,
    useContentSize: true,
    backgroundColor: '#f3f6f2',
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.on('console-message', (details) => {
    if (details.message.includes('Content Security Policy')) violations.push(details.message);
  });
  window.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  const results: {
    theme: string;
    sidebarWidth: number;
    language: string;
    screenshotPath: string;
    metrics: Metrics;
  }[] = [];
  try {
    await window.loadURL(trusted.entryUrl);
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      const poll = () => {
        if (document.querySelector('.preference-options button') && document.querySelectorAll('.katex').length === 2) return resolve(true);
        if (performance.now() > deadline) return reject(new Error('language_fixture_did_not_render'));
        requestAnimationFrame(poll);
      };
      poll();
    })`);
    invariant(cspApplied, 'language_fixture_csp_not_applied');
    await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('[data-testid="preserved-draft"]');
      window.__languageVisualInput = input;
      window.__languageVisualMarkdown = document.querySelector('[data-testid="preserved-markdown"]').innerHTML;
      input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    })()`);
    await window.webContents.insertText('\n직접 입력 / Settings / Linear_2d(H)');
    await nextFrame(window);
    const expectedDraft = (await readMetrics(window)).draft;
    invariant(
      expectedDraft.includes('직접 입력 / Settings / Linear_2d(H)'),
      'native_typing_failed',
    );
    for (const theme of ['light', 'dark']) {
      for (const sidebarWidth of [332, 260]) {
        await window.webContents.executeJavaScript(
          `document.documentElement.dataset.appearance = '${theme}'; document.documentElement.style.setProperty('--visual-sidebar-width', '${sidebarWidth}px');`,
        );
        for (const language of ['ko', 'en'] as const) {
          const before = await readMetrics(window);
          await chooseLanguage(window, language);
          const metrics = await readMetrics(window);
          invariant(metrics.setCalls === before.setCalls + 1, 'language_set_was_not_called_once');
          invariant(metrics.language === language, 'html_language_incorrect');
          invariant(
            metrics.settingsHeading === (language === 'ko' ? '앱 언어' : 'Application language'),
            'settings_heading_not_translated',
          );
          invariant(
            metrics.chatLabel === (language === 'ko' ? '프로젝트 채팅' : 'Project chat'),
            'sidebar_chat_not_translated',
          );
          invariant(
            metrics.settingsLabel === (language === 'ko' ? '설정' : 'Settings'),
            'sidebar_settings_not_translated',
          );
          invariant(metrics.projectName === 'FM-LM / Settings', 'user_project_name_translated');
          invariant(
            metrics.sameInput && metrics.draft === expectedDraft,
            'typed_draft_reset_or_translated',
          );
          invariant(metrics.sameMarkdown && metrics.mathCount === 2, 'source_or_formula_changed');
          invariant(
            metrics.code ===
              'H1_new = X.T @ (y - X @ H1) / N\nH3 = torch.cat([H1_new, H2], dim=-1)',
            'python_code_changed',
          );
          invariant(metrics.sidebarWidth === sidebarWidth, 'fixture_sidebar_width_incorrect');
          invariant(
            metrics.sidebarOverflow <= 1 &&
              metrics.documentOverflow <= 1 &&
              metrics.contentOverflow <= 1,
            'language_layout_horizontal_overflow',
          );
          const screenshotPath = resolve(
            screenshots,
            `settings-${language}-${theme}-${sidebarWidth}.png`,
          );
          await mkdir(dirname(screenshotPath), { recursive: true });
          await writeFile(screenshotPath, (await window.webContents.capturePage()).toPNG());
          results.push({ theme, sidebarWidth, language, screenshotPath, metrics });
        }
      }
    }
    invariant(
      !violations.length && !errors.length,
      `language_visual_runtime_errors:${JSON.stringify({ violations, errors })}`,
    );
    process.stdout.write(
      `Application language visual smoke passed: ${results.length}/8 variants\n${JSON.stringify(results)}\n`,
    );
  } finally {
    window.destroy();
    await browserSession.clearStorageData();
  }
}

app
  .whenReady()
  .then(run)
  .then(async () => {
    await rm(userData, { recursive: true, force: true });
    app.quit();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : 'language_visual_smoke_failed');
    await rm(userData, { recursive: true, force: true });
    app.exit(1);
  });
