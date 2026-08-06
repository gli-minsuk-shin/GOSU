import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { app, BrowserWindow } from 'electron';

type ScrollMetrics = Readonly<{
  clientWidth: number;
  scrollWidth: number;
  clientHeight: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  overflowX: string;
  overflowY: string;
  wideClientWidth: number;
  wideScrollWidth: number;
  wideScrollLeft: number;
  wideOverflowX: string;
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function longDocument() {
  const paragraphs = Array.from(
    { length: 48 },
    (_, index) =>
      `<p>Research paragraph ${index + 1}. This fixture keeps enough rendered Markdown content to require a real vertical scroll range inside the viewer.</p>`,
  ).join('');
  const code = Array.from(
    { length: 90 },
    (_, index) => `metric_${String(index).padStart(3, '0')} = ${index};`,
  ).join(' ');
  return `<div class="markdown-document">
    <h1>Scrollable research note</h1>
    ${paragraphs}
    <pre data-wide-content><code>${code}</code></pre>
  </div>`;
}

function fixtureMarkup(
  styles: string,
  surface: 'notes' | 'repository',
  textSize: 'default' | 'extra-large',
) {
  const viewer =
    surface === 'notes'
      ? `<section class="notes-layout">
          <aside class="note-list"><header><strong>GOSU/Fixture</strong></header><p>Fixture.md</p></aside>
          <article class="note-reader">
            <header><span>Fixture.md</span></header>
            <div class="note-reader-body" data-scroll-region>${longDocument()}</div>
          </article>
        </section>`
      : `<section class="repository-workspace">
          <header class="repository-toolbar card">
            <div class="repository-identity">
              <span class="eyebrow">Repository</span><strong>fixture/repository</strong>
              <code>main</code><span>3 local changes</span>
            </div>
            <div class="repository-toolbar-actions">
              <button>Refresh</button><button>Fetch</button><button>Pull</button><button>Push</button>
            </div>
          </header>
          <nav class="repository-tabs"><button class="active">Files</button></nav>
          <div class="repository-split card">
            <aside class="repository-browser"><div class="repository-tree">Fixture.md</div></aside>
            <article class="repository-preview" data-scroll-region>
              <header><strong>Fixture.md</strong><span>fixture</span></header>
              ${longDocument()}
            </article>
          </div>
        </section>`;

  return `<!doctype html>
<html data-text-size="${textSize}">
  <head>
    <meta charset="utf-8" />
    <style>${styles.replaceAll('</style>', '<\\/style>')}</style>
  </head>
  <body>
    <main class="desktop-shell" style="--project-sidebar-width: 420px">
      <header class="titlebar"><strong>GOSU</strong></header>
      <aside class="desktop-nav"></aside>
      <section class="desktop-content desktop-content-document">
        <div class="notice error"><span>A bounded project warning remains visible.</span><div class="notice-actions"><button>Dismiss</button></div></div>
        <header class="page-heading">
          <div><span class="eyebrow">FIXTURE</span><h1>Markdown viewer</h1><p>Geometry smoke test</p></div>
        </header>
        ${viewer}
      </section>
    </main>
  </body>
</html>`;
}

async function readMetrics(window: BrowserWindow) {
  return (await window.webContents.executeJavaScript(`
    (() => {
      const region = document.querySelector('[data-scroll-region]');
      const wide = document.querySelector('[data-wide-content]');
      if (!(region instanceof HTMLElement)) throw new Error('missing_markdown_scroll_region');
      if (!(wide instanceof HTMLElement)) throw new Error('missing_wide_markdown_content');
      region.scrollTop = region.scrollHeight;
      wide.scrollLeft = wide.scrollWidth;
      const regionStyle = getComputedStyle(region);
      const wideStyle = getComputedStyle(wide);
      return {
        clientWidth: region.clientWidth,
        scrollWidth: region.scrollWidth,
        clientHeight: region.clientHeight,
        scrollHeight: region.scrollHeight,
        scrollLeft: region.scrollLeft,
        scrollTop: region.scrollTop,
        overflowX: regionStyle.overflowX,
        overflowY: regionStyle.overflowY,
        wideClientWidth: wide.clientWidth,
        wideScrollWidth: wide.scrollWidth,
        wideScrollLeft: wide.scrollLeft,
        wideOverflowX: wideStyle.overflowX,
      };
    })()
  `)) as ScrollMetrics;
}

function verifyMetrics(
  surface: 'notes' | 'repository',
  textSize: 'default' | 'extra-large',
  metrics: ScrollMetrics,
) {
  const scenario = `${surface}_${textSize}`;
  invariant(metrics.overflowY === 'auto', `${scenario}_vertical_overflow_not_enabled`);
  invariant(metrics.clientHeight > 200, `${scenario}_viewer_height_not_allocated`);
  invariant(metrics.scrollHeight > metrics.clientHeight, `${scenario}_document_did_not_overflow`);
  invariant(metrics.scrollTop > 0, `${scenario}_viewer_could_not_scroll_vertically`);
  invariant(
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `${scenario}_wide_content_escaped_viewer`,
  );
  invariant(metrics.wideOverflowX === 'auto', `${scenario}_code_horizontal_overflow_not_enabled`);
  invariant(
    metrics.wideScrollWidth > metrics.wideClientWidth,
    `${scenario}_code_did_not_overflow_horizontally`,
  );
  invariant(metrics.wideScrollLeft > 0, `${scenario}_code_could_not_scroll_horizontally`);
}

async function run() {
  const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8');
  const window = new BrowserWindow({
    show: false,
    width: 1060,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    for (const textSize of ['default', 'extra-large'] as const) {
      for (const surface of ['notes', 'repository'] as const) {
        await window.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(fixtureMarkup(styles, surface, textSize))}`,
        );
        verifyMetrics(surface, textSize, await readMetrics(window));
      }
    }
    console.log('Markdown viewers vertical and local horizontal scroll smoke test passed');
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'markdown_viewer_scroll_smoke_failed');
    app.exit(1);
  });
