import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import {
  createTrustedRenderer,
  rendererContentSecurityPolicy,
} from '../../src/main/renderer-trust';

type PagePixelMetrics = Readonly<{
  canvasWidth: number;
  canvasHeight: number;
  canvasCssWidth: string;
  canvasCssHeight: string;
  lightPixels: number;
  darkPixels: number;
  bluePixels: number;
  greenPixels: number;
  redPixels: number;
}>;

type PreviewMetrics = Readonly<{
  initialPage: PagePixelMetrics;
  secondPage: PagePixelMetrics;
  thirdPage: PagePixelMetrics;
  initialCounter: string;
  scrolledCounter: string;
  nextCounter: string;
  previousCounter: string;
  pageCount: number;
  scrollClientHeight: number;
  scrollHeight: number;
  scrolledPageTwoTop: number;
  nextPageThreeTop: number;
  previousPageTwoTop: number;
  maximumMountedCanvases: number;
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
      const waitFor = (read, failure) => new Promise((resolveWait, rejectWait) => {
        const poll = () => {
          const fixtureError = document.body.dataset.fixtureError;
          const alert = document.querySelector('[role="alert"]');
          if (fixtureError) {
            rejectWait(new Error(fixtureError));
            return;
          }
          if (alert) {
            rejectWait(new Error('pdf_preview_alert:' + (alert.textContent || 'unknown')));
            return;
          }
          const value = read();
          if (value) {
            requestAnimationFrame(() => requestAnimationFrame(() => resolveWait(value)));
            return;
          }
          if (performance.now() >= deadline) {
            rejectWait(new Error(failure));
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
      const pixelsFor = (canvas) => {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('pdf_preview_canvas_context_missing');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let lightPixels = 0;
        let darkPixels = 0;
        let bluePixels = 0;
        let greenPixels = 0;
        let redPixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          if (red > 245 && green > 245 && blue > 245) lightPixels += 1;
          if (red < 30 && green < 30 && blue < 30) darkPixels += 1;
          if (blue > 180 && blue > red + 80 && blue > green + 80) bluePixels += 1;
          if (green > 150 && green > red + 70 && green > blue + 70) greenPixels += 1;
          if (red > 180 && red > green + 70 && red > blue + 70) redPixels += 1;
        }
        return {
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          canvasCssWidth: canvas.style.width,
          canvasCssHeight: canvas.style.height,
          lightPixels,
          darkPixels,
          bluePixels,
          greenPixels,
          redPixels,
        };
      };
      const renderedPage = (pageNumber) => {
        const preview = document.querySelector('.manuscript-pdf-preview');
        const page = document.querySelector(
          '.manuscript-pdf-page[data-page-number="' + pageNumber + '"]'
        );
        const canvas = page?.querySelector('canvas');
        if (!(preview instanceof HTMLElement) || preview.dataset.currentPage !== String(pageNumber) ||
            !(canvas instanceof HTMLCanvasElement) || canvas.hidden ||
            canvas.width < 1 || canvas.height < 1) return null;
        return pixelsFor(canvas);
      };
      const currentCounter = () =>
        document.querySelector('.manuscript-pdf-page-counter')?.textContent?.trim() || '';
      const mountedCanvases = () =>
        document.querySelectorAll('.manuscript-pdf-page canvas').length;
      const scrollPageToTop = (scroll, page) => {
        const scrollRect = scroll.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        scroll.scrollTo({
          left: scroll.scrollLeft,
          top: Math.max(0, scroll.scrollTop + pageRect.top - scrollRect.top - 16),
          behavior: 'auto',
        });
      };

      void (async () => {
        const initialPage = await waitFor(
          () => window.__gosuPdfPreviewSmoke?.workerUrls?.length > 0 && renderedPage(1),
          'manuscript_pdf_preview_first_page_did_not_render',
        );
        const scroll = document.querySelector('.manuscript-pdf-canvas-wrap');
        const pages = [...document.querySelectorAll('.manuscript-pdf-page')];
        const pageTwo = document.querySelector('.manuscript-pdf-page[data-page-number="2"]');
        const pageThree = document.querySelector('.manuscript-pdf-page[data-page-number="3"]');
        if (!(scroll instanceof HTMLElement) || !(pageTwo instanceof HTMLElement) ||
            !(pageThree instanceof HTMLElement)) {
          throw new Error('manuscript_pdf_preview_continuous_pages_missing');
        }
        const initialCounter = currentCounter();
        let maximumMountedCanvases = mountedCanvases();

        scrollPageToTop(scroll, pageTwo);
        const secondPage = await waitFor(
          () => renderedPage(2),
          'manuscript_pdf_preview_second_page_did_not_render_after_scroll',
        );
        const scrolledCounter = currentCounter();
        const scrolledPageTwoTop = scroll.scrollTop;
        maximumMountedCanvases = Math.max(maximumMountedCanvases, mountedCanvases());

        const next = document.querySelector('[aria-label="Next PDF page"]');
        if (!(next instanceof HTMLButtonElement) || next.disabled) {
          throw new Error('manuscript_pdf_preview_next_button_unavailable');
        }
        next.click();
        const thirdPage = await waitFor(
          () => renderedPage(3),
          'manuscript_pdf_preview_third_page_did_not_render_after_next',
        );
        const nextCounter = currentCounter();
        const nextPageThreeTop = scroll.scrollTop;
        maximumMountedCanvases = Math.max(maximumMountedCanvases, mountedCanvases());

        const previous = document.querySelector('[aria-label="Previous PDF page"]');
        if (!(previous instanceof HTMLButtonElement) || previous.disabled) {
          throw new Error('manuscript_pdf_preview_previous_button_unavailable');
        }
        previous.click();
        await waitFor(
          () => renderedPage(2),
          'manuscript_pdf_preview_second_page_did_not_render_after_previous',
        );
        const previousCounter = currentCounter();
        const previousPageTwoTop = scroll.scrollTop;
        maximumMountedCanvases = Math.max(maximumMountedCanvases, mountedCanvases());
        const smoke = window.__gosuPdfPreviewSmoke;
        const alert = document.querySelector('[role="alert"]');
        resolve({
          initialPage,
          secondPage,
          thirdPage,
          initialCounter,
          scrolledCounter,
          nextCounter,
          previousCounter,
          pageCount: pages.length,
          scrollClientHeight: scroll.clientHeight,
          scrollHeight: scroll.scrollHeight,
          scrolledPageTwoTop,
          nextPageThreeTop,
          previousPageTwoTop,
          maximumMountedCanvases,
          workerUrls: [...smoke.workerUrls],
          securityViolations: [...smoke.securityViolations],
          windowErrors: [...smoke.windowErrors],
          alertText: alert?.textContent ?? null,
        });
      })().catch(reject);
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
    invariant(metrics.initialPage.canvasWidth > 0, 'manuscript_pdf_preview_canvas_width_zero');
    invariant(metrics.initialPage.canvasHeight > 0, 'manuscript_pdf_preview_canvas_height_zero');
    invariant(
      Boolean(metrics.initialPage.canvasCssWidth),
      'manuscript_pdf_preview_canvas_css_width_missing',
    );
    invariant(
      Boolean(metrics.initialPage.canvasCssHeight),
      'manuscript_pdf_preview_canvas_css_height_missing',
    );
    invariant(
      metrics.initialPage.lightPixels > 0,
      `manuscript_pdf_preview_light_fixture_pixels_missing:${JSON.stringify(metrics)}`,
    );
    invariant(
      metrics.initialPage.darkPixels > 0,
      `manuscript_pdf_preview_dark_fixture_pixels_missing:${JSON.stringify(metrics)}`,
    );
    invariant(
      metrics.initialPage.bluePixels > 0,
      `manuscript_pdf_preview_blue_fixture_pixels_missing:${JSON.stringify(metrics)}`,
    );
    invariant(
      metrics.secondPage.greenPixels > 0,
      `manuscript_pdf_preview_green_second_page_missing:${JSON.stringify(metrics)}`,
    );
    invariant(
      metrics.thirdPage.redPixels > 0,
      `manuscript_pdf_preview_red_third_page_missing:${JSON.stringify(metrics)}`,
    );
    invariant(metrics.pageCount === 3, 'manuscript_pdf_preview_page_count_not_three');
    invariant(metrics.initialCounter === '1 / 3', 'manuscript_pdf_preview_initial_counter_wrong');
    invariant(metrics.scrolledCounter === '2 / 3', 'manuscript_pdf_preview_scroll_counter_wrong');
    invariant(metrics.nextCounter === '3 / 3', 'manuscript_pdf_preview_next_counter_wrong');
    invariant(metrics.previousCounter === '2 / 3', 'manuscript_pdf_preview_previous_counter_wrong');
    invariant(
      metrics.scrollHeight > metrics.scrollClientHeight,
      'manuscript_pdf_preview_continuous_region_not_scrollable',
    );
    invariant(metrics.scrolledPageTwoTop > 0, 'manuscript_pdf_preview_scroll_did_not_move');
    invariant(
      metrics.nextPageThreeTop > metrics.scrolledPageTwoTop,
      'manuscript_pdf_preview_next_did_not_move_to_third_page',
    );
    invariant(
      metrics.previousPageTwoTop < metrics.nextPageThreeTop,
      'manuscript_pdf_preview_previous_did_not_move_to_second_page',
    );
    invariant(
      metrics.maximumMountedCanvases <= 3,
      `manuscript_pdf_preview_render_window_unbounded:${metrics.maximumMountedCanvases}`,
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
