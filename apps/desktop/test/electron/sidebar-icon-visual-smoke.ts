import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import {
  createTrustedRenderer,
  rendererContentSecurityPolicy,
} from '../../src/main/renderer-trust';

type IconMetrics = Readonly<{
  search: Readonly<{ width: number; height: number; centerY: number }>;
  lecture: Readonly<{ width: number; height: number; centerY: number }>;
  searchRowCenterY: number;
  lectureRowCenterY: number;
  violations: readonly string[];
  errors: readonly string[];
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
  const rendererRoot = resolve(process.cwd(), 'out/sidebar-icon-visual-smoke/renderer');
  const rendererEntry = resolve(rendererRoot, 'sidebar-icon-visual-smoke.html');
  const screenshotPath = process.env.GOSU_SIDEBAR_SCREENSHOT?.trim()
    ? resolve(process.env.GOSU_SIDEBAR_SCREENSHOT)
    : resolve(process.cwd(), '../../tmp/screenshots/sidebar-icon-visual.png');
  const trustedRenderer = createTrustedRenderer({
    developmentUrl: undefined,
    isPackaged: true,
    productionEntryPath: rendererEntry,
  });
  const contentSecurityPolicy = rendererContentSecurityPolicy(trustedRenderer);
  let entryCspApplied = false;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url === trustedRenderer.entryUrl) entryCspApplied = true;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy],
      },
    });
  });

  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    useContentSize: true,
    backgroundColor: '#f7faf4',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  try {
    await window.loadURL(trustedRenderer.entryUrl);
    const metrics = (await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        window.__sidebarIconVisual = { violations: [], errors: [] };
        window.addEventListener('securitypolicyviolation', (event) => {
          window.__sidebarIconVisual.violations.push(
            event.violatedDirective + ':' + event.blockedURI
          );
        });
        window.addEventListener('error', (event) => {
          window.__sidebarIconVisual.errors.push(event.message || 'window_error');
        });
        const deadline = performance.now() + 10000;
        const poll = () => {
          const search = document.querySelector('.sidebar-nav-icon-search');
          const lecture = document.querySelector('.sidebar-nav-icon-lecture');
          const searchRow = search?.closest('button');
          const lectureRow = lecture?.closest('button');
          if (search instanceof SVGElement && lecture instanceof SVGElement &&
              searchRow instanceof HTMLButtonElement && lectureRow instanceof HTMLButtonElement) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const searchRect = search.getBoundingClientRect();
              const lectureRect = lecture.getBoundingClientRect();
              const searchRowRect = searchRow.getBoundingClientRect();
              const lectureRowRect = lectureRow.getBoundingClientRect();
              resolve({
                search: {
                  width: searchRect.width,
                  height: searchRect.height,
                  centerY: searchRect.top + searchRect.height / 2,
                },
                lecture: {
                  width: lectureRect.width,
                  height: lectureRect.height,
                  centerY: lectureRect.top + lectureRect.height / 2,
                },
                searchRowCenterY: searchRowRect.top + searchRowRect.height / 2,
                lectureRowCenterY: lectureRowRect.top + lectureRowRect.height / 2,
                violations: [...window.__sidebarIconVisual.violations],
                errors: [...window.__sidebarIconVisual.errors],
              });
            }));
            return;
          }
          if (performance.now() >= deadline) {
            reject(new Error('sidebar_icons_did_not_render'));
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      })
    `)) as IconMetrics;

    invariant(entryCspApplied, 'sidebar_icon_visual_csp_not_applied');
    invariant(
      trustedRenderer.entryUrl.startsWith(pathToFileURL(`${rendererRoot}${sep}`).href),
      'sidebar_icon_visual_not_loaded_from_production_bundle',
    );
    invariant(metrics.search.width === 20 && metrics.search.height === 20, 'search_icon_size_wrong');
    invariant(
      metrics.lecture.width === 17 && metrics.lecture.height === 17,
      'lecture_icon_size_wrong',
    );
    invariant(
      Math.abs(metrics.search.centerY - metrics.searchRowCenterY) <= 0.5,
      'search_icon_not_centered',
    );
    invariant(
      Math.abs(metrics.lecture.centerY - metrics.lectureRowCenterY) <= 0.5,
      'lecture_icon_not_centered',
    );
    invariant(metrics.violations.length === 0, 'sidebar_icon_visual_csp_violation');
    invariant(metrics.errors.length === 0, 'sidebar_icon_visual_renderer_error');

    await mkdir(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    await writeFile(screenshotPath, image.toPNG());
    process.stdout.write(
      `Sidebar icon visual smoke passed\n${JSON.stringify({ screenshotPath, metrics })}\n`,
    );
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'sidebar_icon_visual_smoke_failed');
    app.exit(1);
  });
