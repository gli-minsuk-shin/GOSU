import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { app, BrowserWindow, session } from 'electron';

import {
  createTrustedRenderer,
  rendererContentSecurityPolicy,
} from '../../src/main/renderer-trust';

// Isolate all browser storage from GOSU before Electron becomes ready.
const userData = mkdtempSync(resolve(tmpdir(), 'gosu-tool-activity-visual-'));
app.setPath('userData', userData);
app.setPath('sessionData', userData);
app.on('window-all-closed', () => undefined);

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function settle(window: BrowserWindow) {
  await window.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}

async function click(window: BrowserWindow, selector: string) {
  await window.webContents.executeJavaScript(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error('fixture_click_target_missing:' + ${JSON.stringify(selector)});
    target.click();
  })()`);
  await settle(window);
}

type Metrics = {
  language: string;
  paneWidth: number;
  documentOverflow: number;
  paneOverflow: number;
  activityOverflow: number;
  overflowingChildren: string[];
  rowCount: number;
  callIds: string[];
  heading: string;
  count: string;
  noteState: string | null;
  noteStatus: string;
  noteText: string;
  noteDetailsOpen: boolean;
  sameNoteRow: boolean;
  showAllExpanded: string | null;
  detailsText: string;
};

async function metrics(window: BrowserWindow): Promise<Metrics> {
  return window.webContents.executeJavaScript(`(() => {
    const pane = document.querySelector('.tool-activity-visual-pane');
    const activity = document.querySelector('.project-tool-activity');
    const note = activity.querySelector('li[data-call-id="read-note"]');
    const rows = [...activity.querySelectorAll('li[data-call-id]')];
    return {
      language: document.documentElement.lang,
      paneWidth: pane.getBoundingClientRect().width,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      paneOverflow: pane.scrollWidth - pane.clientWidth,
      activityOverflow: activity.scrollWidth - activity.clientWidth,
      overflowingChildren: [...activity.querySelectorAll('li, details, summary, code, dd, .project-tool-activity-context')]
        .filter(element => element.clientWidth > 0 && element.scrollWidth - element.clientWidth > 1)
        .map(element => element.className || element.tagName),
      rowCount: rows.length,
      callIds: rows.map(row => row.dataset.callId),
      heading: activity.querySelector('.project-tool-activity-heading strong').textContent,
      count: activity.querySelector('.project-tool-activity-heading span').textContent,
      noteState: note?.dataset.activityState ?? null,
      noteStatus: note?.querySelector('.project-tool-activity-status').textContent ?? '',
      noteText: note?.textContent ?? '',
      noteDetailsOpen: note?.querySelector('details').open ?? false,
      sameNoteRow: note === window.__toolActivityVisualNote,
      showAllExpanded: activity.querySelector('.project-tool-activity-toggle')?.getAttribute('aria-expanded') ?? null,
      detailsText: note?.querySelector('.project-tool-activity-details').textContent ?? '',
    };
  })()`);
}

function noOverflow(value: Metrics, variant: string) {
  invariant(
    value.documentOverflow <= 1 &&
      value.paneOverflow <= 1 &&
      value.activityOverflow <= 1 &&
      value.overflowingChildren.length === 0,
    `tool_activity_horizontal_overflow:${variant}:${JSON.stringify(value)}`,
  );
}

async function run() {
  const rendererEntry = resolve(
    process.cwd(),
    'out/project-tool-activity-visual-smoke/renderer/project-tool-activity-visual-smoke.html',
  );
  const screenshots = process.env.GOSU_TOOL_ACTIVITY_SCREENSHOT_DIR?.trim()
    ? resolve(process.env.GOSU_TOOL_ACTIVITY_SCREENSHOT_DIR)
    : resolve(process.cwd(), '../../tmp/screenshots/project-tool-activity');
  const trusted = createTrustedRenderer({
    developmentUrl: undefined,
    isPackaged: true,
    productionEntryPath: rendererEntry,
  });
  const browserSession = session.fromPartition(`gosu-tool-activity-visual-${Date.now()}`);
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
    width: 940,
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
    else if (details.level === 'error') errors.push(details.message);
  });
  window.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  const results: {
    theme: string;
    paneWidth: number;
    language: string;
    screenshotPath: string;
    completedScreenshotPath: string;
    initial: Metrics;
    completed: Metrics;
    expanded: Metrics;
  }[] = [];
  const capture = async (name: string) => {
    const screenshotPath = resolve(screenshots, name);
    await mkdir(dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, (await window.webContents.capturePage()).toPNG());
    return screenshotPath;
  };
  try {
    await window.loadURL(trusted.entryUrl);
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      const poll = () => {
        if (document.querySelectorAll('.project-tool-activity li[data-call-id]').length === 4) return resolve(true);
        if (performance.now() > deadline) return reject(new Error('tool_activity_fixture_did_not_render'));
        requestAnimationFrame(poll);
      };
      poll();
    })`);
    invariant(cspApplied, 'tool_activity_fixture_csp_not_applied');
    for (const theme of ['light', 'dark']) {
      for (const paneWidth of [900, 400]) {
        window.setContentSize(paneWidth + 40, 1120);
        await window.webContents.executeJavaScript(
          `document.documentElement.dataset.appearance = '${theme}'; window.scrollTo(0, 0);`,
        );
        for (const language of ['en', 'ko'] as const) {
          const variant = `${language}-${theme}-${paneWidth}`;
          await click(window, '[data-testid="reset"]');
          await click(window, `[data-testid="language-${language}"]`);
          await window.webContents.executeJavaScript(`(() => {
            const note = document.querySelector('[data-call-id="read-note"]');
            window.__toolActivityVisualNote = note;
            document.querySelectorAll('.project-tool-activity details').forEach(detail => { detail.open = false; });
          })()`);
          await click(window, '[data-call-id="read-note"] summary');
          const initial = await metrics(window);
          invariant(initial.language === language, `tool_activity_language_not_applied:${variant}`);
          invariant(
            initial.paneWidth === paneWidth,
            `tool_activity_pane_width_incorrect:${variant}`,
          );
          invariant(
            initial.rowCount === 4 && new Set(initial.callIds).size === 4,
            `tool_activity_duplicate_rows:${variant}`,
          );
          invariant(initial.count.includes('4'), `tool_activity_call_count_incorrect:${variant}`);
          invariant(initial.noteState === 'running', `tool_activity_read_not_running:${variant}`);
          invariant(
            initial.noteDetailsOpen && initial.detailsText.includes('4000'),
            `tool_activity_detail_did_not_expand:${variant}`,
          );
          invariant(
            initial.noteText.includes('training-design.md'),
            `tool_activity_target_missing:${variant}`,
          );
          invariant(
            language === 'ko'
              ? initial.heading !== 'Tool activity' && /[가-힣]/u.test(initial.heading)
              : initial.heading === 'Tool activity',
            `tool_activity_heading_not_translated:${variant}`,
          );
          noOverflow(initial, variant);
          const screenshotPath = await capture(`tool-activity-${variant}-running.png`);
          await click(window, '[data-testid="complete"]');
          const completed = await metrics(window);
          invariant(
            completed.rowCount === 4 && completed.sameNoteRow,
            `tool_activity_completion_duplicated_or_replaced_row:${variant}`,
          );
          invariant(
            completed.noteState === 'received' && completed.noteStatus !== initial.noteStatus,
            `tool_activity_completion_not_applied:${variant}`,
          );
          invariant(
            completed.noteText.includes('3420') &&
              completed.noteDetailsOpen &&
              completed.noteText.includes('training-design.md'),
            `tool_activity_completion_lost_metadata:${variant}`,
          );
          noOverflow(completed, `${variant}-completed`);
          const completedScreenshotPath = await capture(`tool-activity-${variant}-completed.png`);
          await click(window, '[data-testid="more"]');
          const recent = await metrics(window);
          invariant(
            recent.rowCount === 6 &&
              recent.count.includes('8') &&
              recent.showAllExpanded === 'false',
            `tool_activity_recent_calls_incorrect:${variant}`,
          );
          await click(window, '.project-tool-activity-toggle');
          const expanded = await metrics(window);
          invariant(
            expanded.rowCount === 8 && expanded.showAllExpanded === 'true',
            `tool_activity_show_all_failed:${variant}`,
          );
          noOverflow(expanded, `${variant}-all-calls`);
          await click(window, '.project-tool-activity-toggle');
          invariant(
            (await metrics(window)).rowCount === 6,
            `tool_activity_collapse_failed:${variant}`,
          );
          results.push({
            theme,
            paneWidth,
            language,
            screenshotPath,
            completedScreenshotPath,
            initial,
            completed,
            expanded,
          });
        }
      }
    }
    invariant(
      !violations.length && !errors.length,
      `tool_activity_visual_runtime_errors:${JSON.stringify({ violations, errors })}`,
    );
    process.stdout.write(
      `Project tool activity visual smoke passed: ${results.length}/8 variants\n${JSON.stringify(results)}\n`,
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
    console.error(error instanceof Error ? error.message : 'tool_activity_visual_smoke_failed');
    await rm(userData, { recursive: true, force: true });
    app.exit(1);
  });
