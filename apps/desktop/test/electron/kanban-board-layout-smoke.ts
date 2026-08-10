import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { app, BrowserWindow } from 'electron';

type RectMetrics = Readonly<{
  left: number;
  right: number;
  width: number;
}>;

type BoardMetrics = Readonly<{
  viewportWidth: number;
  content: RectMetrics;
  workspace: RectMetrics;
  board: RectMetrics;
  clientWidth: number;
  scrollWidth: number;
  scrollLeft: number;
  overflowX: string;
  columnWidths: readonly number[];
  columns: readonly RectMetrics[];
}>;

type LayoutScenario = Readonly<{
  name: 'standard-sidebar' | 'maximum-sidebar' | 'narrow-extra-large';
  width: number;
  height: number;
  sidebarWidth: number;
  textSize: 'default' | 'extra-large';
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function columnMarkup() {
  const names = ['Backlog', 'Planned', 'In Progress', 'Review', 'Done'];
  return names
    .map(
      (name, index) => `<section class="kanban-column">
        <header>
          <div>
            <div class="column-title-row"><strong>${name}</strong></div>
            <small>${index === 0 ? 'Ready to plan' : 'Research workflow'}</small>
          </div>
          <span>${index + 1}</span>
        </header>
        <div class="column-empty">${index === 4 ? 'Completed work' : 'No tasks'}</div>
      </section>`,
    )
    .join('');
}

function fixtureMarkup(styles: string) {
  return `<!doctype html>
<html data-text-size="default">
  <head>
    <meta charset="utf-8" />
    <style>
      ${styles.replaceAll('</style>', '<\\/style>')}
      *, *::before, *::after {
        animation-duration: 0s !important;
        transition-duration: 0s !important;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <main class="desktop-shell" style="--project-sidebar-width: 280px">
        <header class="titlebar"><span class="logo">G</span><strong>GOSU</strong><span>Board layout smoke</span></header>
        <aside class="desktop-nav" aria-label="Projects">
          <small>Projects</small>
          <div class="project-switcher"><strong>Board layout fixture</strong></div>
        </aside>
        <section class="desktop-content">
          <div class="kanban-workspace">
            <header class="kanban-command-bar">
              <div class="kanban-title-block">
                <span>PROJECT BOARD</span>
                <h2>Board</h2>
                <p>Five-column research workflow</p>
              </div>
              <div class="kanban-view-actions"><button class="secondary-button">Settings</button></div>
            </header>
            <div class="kanban-board" role="region" tabindex="0" aria-label="Board columns">
              ${columnMarkup()}
            </div>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

const scenarios: readonly LayoutScenario[] = [
  {
    name: 'standard-sidebar',
    width: 1440,
    height: 860,
    sidebarWidth: 280,
    textSize: 'default',
  },
  {
    name: 'maximum-sidebar',
    width: 1440,
    height: 860,
    sidebarWidth: 440,
    textSize: 'default',
  },
  {
    name: 'narrow-extra-large',
    width: 1060,
    height: 780,
    sidebarWidth: 420,
    textSize: 'extra-large',
  },
] as const;

async function nextLayout(window: BrowserWindow) {
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  `);
}

async function measureScenario(window: BrowserWindow, scenario: LayoutScenario) {
  window.setContentSize(scenario.width, scenario.height);
  await window.webContents.executeJavaScript(`
    (() => {
      document.documentElement.dataset.textSize = ${JSON.stringify(scenario.textSize)};
      const shell = document.querySelector('.desktop-shell');
      if (!(shell instanceof HTMLElement)) throw new Error('missing_desktop_shell');
      shell.style.setProperty('--project-sidebar-width', ${JSON.stringify(
        `${scenario.sidebarWidth}px`,
      )});
    })()
  `);
  await nextLayout(window);

  return (await window.webContents.executeJavaScript(`
    (() => {
      const content = document.querySelector('.desktop-content');
      const workspace = document.querySelector('.kanban-workspace');
      const board = document.querySelector('.kanban-board');
      const columns = Array.from(document.querySelectorAll('.kanban-column'));
      if (!(content instanceof HTMLElement)) throw new Error('missing_desktop_content');
      if (!(workspace instanceof HTMLElement)) throw new Error('missing_kanban_workspace');
      if (!(board instanceof HTMLElement)) throw new Error('missing_kanban_board');
      if (columns.length !== 5 || columns.some((column) => !(column instanceof HTMLElement))) {
        throw new Error('expected_five_kanban_columns');
      }

      board.scrollLeft = board.scrollWidth;
      const rectangle = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      };
      const style = getComputedStyle(board);
      return {
        viewportWidth: window.innerWidth,
        content: rectangle(content),
        workspace: rectangle(workspace),
        board: rectangle(board),
        clientWidth: board.clientWidth,
        scrollWidth: board.scrollWidth,
        scrollLeft: board.scrollLeft,
        overflowX: style.overflowX,
        columnWidths: columns.map((column) => column.getBoundingClientRect().width),
        columns: columns.map(rectangle),
      };
    })()
  `)) as BoardMetrics;
}

function verifyWideScenario(metrics: BoardMetrics, scenario: LayoutScenario) {
  const tolerance = 2;
  invariant(
    Math.abs(metrics.viewportWidth - scenario.width) <= tolerance,
    `${scenario.name}_unexpected_viewport_width_${metrics.viewportWidth}`,
  );
  invariant(metrics.columns.length === 5, `${scenario.name}_missing_columns`);
  invariant(
    metrics.scrollWidth <= metrics.clientWidth + tolerance,
    `${scenario.name}_board_should_fit_without_horizontal_scroll_${metrics.clientWidth}_${metrics.scrollWidth}`,
  );
  invariant(metrics.scrollLeft <= tolerance, `${scenario.name}_board_scrolled_despite_fitting`);
  invariant(
    metrics.workspace.right <= metrics.content.right + tolerance,
    `${scenario.name}_workspace_clipped_by_desktop_content`,
  );
  invariant(
    metrics.board.right <= metrics.content.right + tolerance,
    `${scenario.name}_board_clipped_by_desktop_content`,
  );
  invariant(
    metrics.columns.every(
      (column) =>
        column.left >= metrics.board.left - tolerance &&
        column.right <= metrics.board.right + tolerance,
    ),
    `${scenario.name}_column_outside_board_viewport`,
  );
  invariant(
    metrics.columnWidths.every((width) => width >= 145),
    `${scenario.name}_columns_compressed_below_usable_width_${metrics.columnWidths.join('_')}`,
  );
}

function verifyNarrowScenario(metrics: BoardMetrics, scenario: LayoutScenario) {
  const tolerance = 2;
  const finalColumn = metrics.columns.at(-1);
  invariant(finalColumn !== undefined, `${scenario.name}_missing_final_column`);
  invariant(metrics.overflowX === 'auto', `${scenario.name}_horizontal_scroll_not_enabled`);
  invariant(
    metrics.scrollWidth > metrics.clientWidth + 120,
    `${scenario.name}_board_did_not_create_a_useful_scroll_range_${metrics.clientWidth}_${metrics.scrollWidth}`,
  );
  invariant(metrics.scrollLeft > 80, `${scenario.name}_horizontal_scroll_did_not_advance`);
  invariant(
    finalColumn.left >= metrics.board.left - tolerance &&
      finalColumn.right <= metrics.board.right + tolerance,
    `${scenario.name}_final_column_not_visible_after_scroll`,
  );
  invariant(
    metrics.workspace.right <= metrics.content.right + tolerance,
    `${scenario.name}_workspace_clipped_by_desktop_content`,
  );
  invariant(
    metrics.board.right <= metrics.content.right + tolerance,
    `${scenario.name}_scroll_region_clipped_by_desktop_content`,
  );
}

async function run() {
  const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8');
  const initialScenario = scenarios[0]!;
  const window = new BrowserWindow({
    show: false,
    width: initialScenario.width,
    height: initialScenario.height,
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

    for (const scenario of scenarios) {
      const metrics = await measureScenario(window, scenario);
      if (scenario.name === 'narrow-extra-large') verifyNarrowScenario(metrics, scenario);
      else verifyWideScenario(metrics, scenario);
    }

    console.log('kanban board responsive fit and horizontal scroll smoke test passed');
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'kanban_board_layout_smoke_failed');
    app.exit(1);
  });
