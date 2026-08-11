import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import {
  createTrustedRenderer,
  rendererContentSecurityPolicy,
} from '../../src/main/renderer-trust';

type PreviewMetrics = Readonly<{
  canvasWidth: number;
  canvasHeight: number;
  canvasCssWidth: string;
  canvasCssHeight: string;
  lightPixels: number;
  darkPixels: number;
  bluePixels: number;
  workerUrls: readonly string[];
  securityViolations: readonly string[];
  windowErrors: readonly string[];
  alertText: string | null;
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForRenderedPreview(window: BrowserWindow) {
  return (await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = performance.now() + 15000;
      const poll = () => {
        const fixtureError = document.body.dataset.fixtureError;
        const alert = document.querySelector('[role="alert"]');
        const canvas = document.querySelector('.manuscript-pdf-preview canvas');
        const smoke = window.__gosuPdfPreviewSmoke;
        if (fixtureError) {
          reject(new Error(fixtureError));
          return;
        }
        if (alert) {
          reject(new Error('pdf_preview_alert:' + (alert.textContent || 'unknown')));
          return;
        }
        if (canvas instanceof HTMLCanvasElement && !canvas.hidden &&
            canvas.width > 0 && canvas.height > 0 && smoke?.workerUrls?.length > 0) {
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('pdf_preview_canvas_context_missing'));
            return;
          }
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let lightPixels = 0;
          let darkPixels = 0;
          let bluePixels = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            const red = pixels[offset];
            const green = pixels[offset + 1];
            const blue = pixels[offset + 2];
            if (red > 245 && green > 245 && blue > 245) lightPixels += 1;
            if (red < 30 && green < 30 && blue < 30) darkPixels += 1;
            if (blue > 180 && blue > red + 80 && blue > green + 80) bluePixels += 1;
          }
          if (lightPixels > 0 && darkPixels > 0 && bluePixels > 0) {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({
              canvasWidth: canvas.width,
              canvasHeight: canvas.height,
              canvasCssWidth: canvas.style.width,
              canvasCssHeight: canvas.style.height,
              lightPixels,
              darkPixels,
              bluePixels,
              workerUrls: [...smoke.workerUrls],
              securityViolations: [...smoke.securityViolations],
              windowErrors: [...smoke.windowErrors],
              alertText: alert?.textContent ?? null,
            })));
            return;
          }
        }
        if (performance.now() >= deadline) {
          reject(new Error('manuscript_pdf_preview_did_not_render'));
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    })
  `)) as PreviewMetrics;
}

async function run() {
  const rendererRoot = resolve(process.cwd(), 'out/manuscript-pdf-preview-smoke/renderer');
  const rendererEntry = resolve(rendererRoot, 'manuscript-pdf-preview-smoke.html');
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

  const consoleIssues: string[] = [];
  let renderProcessFailure: string | null = null;
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on('console-message', (details) => {
    const message = details.message;
    if (
      details.level === 'error' ||
      /(content security policy|refused to|worker|pdf\.worker)/i.test(message)
    ) {
      consoleIssues.push(`${details.level}:${message}`);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    renderProcessFailure = `${details.reason}:${details.exitCode}`;
  });

  try {
    await window.loadURL(trustedRenderer.entryUrl);
    const metrics = await waitForRenderedPreview(window);
    const rendererRootUrl = pathToFileURL(`${rendererRoot}${sep}`).href;

    invariant(entryCspApplied, 'manuscript_pdf_preview_production_csp_not_applied');
    invariant(
      contentSecurityPolicy.includes("script-src 'self'") &&
        !contentSecurityPolicy.includes("script-src 'self' 'unsafe-inline'"),
      'manuscript_pdf_preview_csp_not_production_strict',
    );
    invariant(metrics.canvasWidth > 0, 'manuscript_pdf_preview_canvas_width_zero');
    invariant(metrics.canvasHeight > 0, 'manuscript_pdf_preview_canvas_height_zero');
    invariant(Boolean(metrics.canvasCssWidth), 'manuscript_pdf_preview_canvas_css_width_missing');
    invariant(Boolean(metrics.canvasCssHeight), 'manuscript_pdf_preview_canvas_css_height_missing');
    invariant(
      metrics.lightPixels > 0,
      `manuscript_pdf_preview_light_fixture_pixels_missing:${JSON.stringify(metrics)}`,
    );
    invariant(
      metrics.darkPixels > 0,
      `manuscript_pdf_preview_dark_fixture_pixels_missing:${JSON.stringify(metrics)}`,
    );
    invariant(
      metrics.bluePixels > 0,
      `manuscript_pdf_preview_blue_fixture_pixels_missing:${JSON.stringify(metrics)}`,
    );
    invariant(metrics.workerUrls.length > 0, 'manuscript_pdf_preview_worker_not_created');
    invariant(
      metrics.workerUrls.every((url) => url.startsWith('file:') && url.startsWith(rendererRootUrl)),
      `manuscript_pdf_preview_worker_not_bundled_file:${metrics.workerUrls.join(',')}`,
    );
    invariant(
      metrics.securityViolations.length === 0,
      `manuscript_pdf_preview_csp_violation:${metrics.securityViolations.join('|')}`,
    );
    invariant(
      metrics.windowErrors.length === 0,
      `manuscript_pdf_preview_renderer_error:${metrics.windowErrors.join('|')}`,
    );
    invariant(
      consoleIssues.length === 0,
      `manuscript_pdf_preview_console_error:${consoleIssues.join('|')}`,
    );
    invariant(
      renderProcessFailure === null,
      `manuscript_pdf_preview_process_gone:${renderProcessFailure}`,
    );
    invariant(metrics.alertText === null, `manuscript_pdf_preview_alert:${metrics.alertText}`);
    console.log('Manuscript production PDF.js renderer smoke test passed');
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'manuscript_pdf_preview_smoke_failed');
    app.exit(1);
  });
