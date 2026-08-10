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
  searchCardHeight: number;
  tableTopRatio: number;
  visibleTableHeightRatio: number;
  fullyVisibleRows: number;
  containedHorizontally: boolean;
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
      (_, column) => `<td>Evidence ${row + 1}.${column + 1}</td>`,
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
      <div class="desktop-shell" style="--project-sidebar-width: 280px">
        <header class="titlebar"><strong>GOSU</strong></header>
        <aside class="desktop-nav" aria-label="Project navigation">Literature</aside>
        <section class="desktop-content desktop-content-literature">
          <div class="literature-workspace">
            <section class="literature-search-card" aria-label="Search literature">
              <header class="literature-library-heading"><strong>Search literature</strong></header>
              <form class="literature-search-form">
                <label class="literature-search-query">Research question<input value="agentic research" /></label>
                <button class="primary-button" type="button">Search again</button>
                <details class="literature-search-options">
                  <summary>Tags &amp; year filters</summary>
                  <div>
                    <label>Topic tags<input value="agents" /></label>
                    <label>Keyword tags<input value="evaluation" /></label>
                    <label>From year<input placeholder="Any" /></label>
                    <label>To year<input placeholder="Any" /></label>
                  </div>
                </details>
              </form>
              <div class="literature-search-secondary">
                <details class="literature-search-guidance">
                  <summary>Search guidance · ranking policy v3</summary>
                  <div><p>Long policy details stay collapsed until requested.</p></div>
                </details>
              </div>
            </section>
            <section class="literature-library-card">
              <header class="literature-library-toolbar">
                <div class="literature-library-heading"><strong>Evidence table</strong><span>88 saved</span></div>
                <div class="literature-library-actions">
                  <button class="secondary-button">Import</button><button class="secondary-button">Export</button>
                </div>
              </header>
              <p class="literature-ai-availability"><strong>AI organization:</strong> Auto</p>
              <div class="literature-layer-grid" aria-label="Discovery layer view">
                <button class="literature-layer-card active"><span>Total</span><strong>88</strong></button>
                <button class="literature-layer-card"><span>Core</span><strong>8</strong></button>
                <button class="literature-layer-card"><span>Rising</span><strong>20</strong></button>
                <button class="literature-layer-card"><span>Broad</span><strong>60</strong></button>
              </div>
              <div class="literature-filter-bar">
                <label><span>Filter</span><input placeholder="Filter evidence table" /></label>
                <label><span>Tag</span><select><option>All tags</option></select></label>
                <label><span>Layer</span><select><option>All layers</option></select></label>
                <label><span>Status</span><select><option>All statuses</option></select></label>
              </div>
              <div class="literature-table-navigation"><span>Scroll table</span><div><button>Columns →</button></div></div>
              <div class="literature-table-scroll" role="region" tabindex="0">
                <table class="literature-table">
                  <thead><tr>${headings}</tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </section>
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
    width: 1180,
    height: 820,
    useContentSize: true,
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
        const content = document.querySelector('.desktop-content-literature');
        const searchCard = document.querySelector('.literature-search-card');
        if (!(element instanceof HTMLElement)) throw new Error('missing_scroll_region');
        if (!(content instanceof HTMLElement)) throw new Error('missing_literature_content');
        if (!(searchCard instanceof HTMLElement)) throw new Error('missing_search_card');
        const contentRect = content.getBoundingClientRect();
        const tableRect = element.getBoundingClientRect();
        const searchRect = searchCard.getBoundingClientRect();
        const visibleTop = Math.max(tableRect.top, contentRect.top, 0);
        const visibleBottom = Math.min(tableRect.bottom, contentRect.bottom, window.innerHeight);
        const visibleTableHeight = Math.max(0, visibleBottom - visibleTop);
        const fullyVisibleRows = Array.from(element.querySelectorAll('tbody tr')).filter((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top >= visibleTop && rect.bottom <= visibleBottom;
        }).length;
        const geometry = {
          searchCardHeight: searchRect.height,
          tableTopRatio: (tableRect.top - contentRect.top) / contentRect.height,
          visibleTableHeightRatio: visibleTableHeight / contentRect.height,
          fullyVisibleRows,
          containedHorizontally:
            tableRect.left >= contentRect.left - 1 && tableRect.right <= contentRect.right + 1,
        };
        element.scrollLeft = element.scrollWidth;
        element.scrollTop = element.scrollHeight;
        const style = getComputedStyle(element);
        return {
          ...geometry,
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
    invariant(
      metrics.searchCardHeight <= 220,
      `literature_search_card_not_compact:${metrics.searchCardHeight}`,
    );
    invariant(
      metrics.tableTopRatio <= 0.58,
      `literature_table_starts_too_low:${metrics.tableTopRatio}`,
    );
    invariant(
      metrics.visibleTableHeightRatio >= 0.35,
      `literature_table_visible_area_too_short:${metrics.visibleTableHeightRatio}`,
    );
    invariant(
      metrics.fullyVisibleRows >= 6,
      `literature_too_few_rows_visible_without_page_scroll:${metrics.fullyVisibleRows}`,
    );
    invariant(metrics.containedHorizontally, 'literature_table_escaped_content_width');
    invariant(metrics.scrollWidth > metrics.clientWidth, 'literature_table_did_not_overflow_width');
    invariant(
      metrics.scrollHeight > metrics.clientHeight,
      'literature_table_did_not_overflow_height',
    );
    invariant(metrics.scrollLeft > 0, 'literature_table_could_not_scroll_horizontally');
    invariant(metrics.scrollTop > 0, 'literature_table_could_not_scroll_vertically');
    console.log('literature compact layout and two-axis table scroll smoke test passed');
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
