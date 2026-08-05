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
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixtureMarkup(styles: string) {
  const headings = Array.from({ length: 11 }, (_, index) => `<th>Column ${index + 1}</th>`).join(
    '',
  );
  const rows = Array.from({ length: 25 }, (_, row) => {
    const cells = Array.from(
      { length: 11 },
      (_, column) => `<td>Evidence ${row + 1}.${column + 1} with bounded fixture metadata</td>`,
    ).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root {
        --surface: #ffffff;
        --surface-soft: #f2f5f0;
        --line: #ccd3ca;
        --line-strong: #9da69a;
        --muted: #667064;
        --text: #182017;
        --green: #4d7b00;
        --font-control: 14px;
      }
      ${styles.replaceAll('</style>', '<\\/style>')}
    </style>
  </head>
  <body>
    <main id="root">
      <div class="literature-workspace">
        <section class="literature-library-card">
          <div class="literature-table-scroll" role="region" tabindex="0">
            <table class="literature-table">
              <thead><tr>${headings}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  </body>
</html>`;
}

async function run() {
  const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8');
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 760,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(fixtureMarkup(styles))}`,
    );
    const metrics = (await window.webContents.executeJavaScript(`
      (() => {
        const element = document.querySelector('.literature-table-scroll');
        if (!(element instanceof HTMLElement)) throw new Error('missing_scroll_region');
        element.scrollLeft = element.scrollWidth;
        element.scrollTop = element.scrollHeight;
        const style = getComputedStyle(element);
        return {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          scrollLeft: element.scrollLeft,
          scrollTop: element.scrollTop,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        };
      })()
    `)) as ScrollMetrics;

    invariant(metrics.overflowX === 'auto', 'literature_horizontal_overflow_not_enabled');
    invariant(metrics.overflowY === 'auto', 'literature_vertical_overflow_not_enabled');
    invariant(metrics.scrollWidth > metrics.clientWidth, 'literature_table_did_not_overflow_width');
    invariant(
      metrics.scrollHeight > metrics.clientHeight,
      'literature_table_did_not_overflow_height',
    );
    invariant(metrics.scrollLeft > 0, 'literature_table_could_not_scroll_horizontally');
    invariant(metrics.scrollTop > 0, 'literature_table_could_not_scroll_vertically');
    console.log('literature evidence table two-axis scroll smoke test passed');
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'literature_scroll_smoke_failed');
    app.exit(1);
  });
