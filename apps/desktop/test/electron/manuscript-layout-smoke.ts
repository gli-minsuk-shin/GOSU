import { resolve } from 'node:path';

import { app, BrowserWindow } from 'electron';

type FixtureState = 'unlinked' | 'connected' | 'error';

type RectMetrics = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}>;

type StateMetrics = Readonly<{
  viewportWidth: number;
  viewportHeight: number;
  sidebar: RectMetrics;
  content: RectMetrics;
  workspace: RectMetrics;
  contentClientWidth: number;
  contentScrollWidth: number;
  contentClientHeight: number;
  contentScrollHeight: number;
  contentScrollTop: number;
  contentOverflowX: string;
  contentOverflowY: string;
  workspaceClientWidth: number;
  workspaceScrollWidth: number;
  horizontallyContainedControls: boolean;
  minimumControlHeight: number;
  stateMarkerCount: number;
  responsiveColumns: number;
  responsiveItemsStacked: boolean;
  retryContained: boolean;
}>;

const VIEWPORT_WIDTH = 1060;
const VIEWPORT_HEIGHT = 700;
const SIDEBAR_WIDTH = 440;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function nearlyEqual(left: number, right: number, tolerance = 1.1) {
  return Math.abs(left - right) <= tolerance;
}

function containedHorizontally(child: RectMetrics, parent: RectMetrics) {
  return child.left >= parent.left - 1 && child.right <= parent.right + 1;
}

async function waitForState(window: BrowserWindow, state: FixtureState) {
  const selector = {
    unlinked: '.manuscript-connect-form',
    connected: '.manuscript-status-grid',
    error: '.error-banner[role="alert"]',
  }[state];

  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const poll = () => {
        if (document.querySelector(${JSON.stringify(selector)})) {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
          return;
        }
        if (performance.now() >= deadline) {
          reject(new Error(${JSON.stringify(`manuscript_${state}_fixture_did_not_render`)}));
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    })
  `);
}

async function measureState(window: BrowserWindow, state: FixtureState) {
  const fixturePath = resolve(
    process.cwd(),
    'out/manuscript-layout-smoke/renderer/manuscript-layout-smoke.html',
  );
  await window.loadFile(fixturePath, { query: { state } });
  await waitForState(window, state);

  return (await window.webContents.executeJavaScript(`
    (async () => {
      const sidebar = document.querySelector('.desktop-nav');
      const content = document.querySelector('.desktop-content');
      const workspace = document.querySelector('.manuscript-workspace');
      if (!(sidebar instanceof HTMLElement) || !(content instanceof HTMLElement) ||
          !(workspace instanceof HTMLElement)) {
        throw new Error('missing_manuscript_geometry_element');
      }

      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return {
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          left: value.left,
          width: value.width,
          height: value.height,
        };
      };
      const workspaceRect = rect(workspace);
      const controls = [...workspace.querySelectorAll('button, input')].filter(
        (element) => element instanceof HTMLElement && !element.hidden,
      );
      const controlRects = controls.map(rect);
      const stateSelector = ${JSON.stringify({
        unlinked: '.manuscript-connect-form',
        connected: '.manuscript-status-grid',
        error: '.error-banner[role="alert"]',
      })}[${JSON.stringify(state)}];
      const responsiveContainer = document.querySelector(
        ${JSON.stringify(state)} === 'connected'
          ? '.manuscript-status-grid'
          : ${JSON.stringify(state)} === 'unlinked'
            ? '.manuscript-form-grid'
            : '.manuscript-create-form'
      );
      if (!(responsiveContainer instanceof HTMLElement)) {
        throw new Error('missing_manuscript_responsive_container');
      }
      const responsiveItems = [...responsiveContainer.children].filter(
        (element) => element instanceof HTMLElement,
      );
      const itemRects = responsiveItems.map(rect);
      const firstItem = itemRects[0];
      const responsiveItemsStacked = itemRects.slice(1).every(
        (item) => Math.abs(item.left - firstItem.left) <= 1.1 && item.top >= firstItem.bottom - 1,
      );
      const gridTemplateColumns = getComputedStyle(responsiveContainer).gridTemplateColumns
        .split(' ')
        .filter(Boolean);
      const retry = document.querySelector('.error-banner button');
      const retryContained = !(retry instanceof HTMLElement) ||
        containedBy(rect(retry), rect(retry.parentElement));

      content.scrollTop = content.scrollHeight;
      content.scrollLeft = content.scrollWidth;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const contentStyle = getComputedStyle(content);
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        sidebar: rect(sidebar),
        content: rect(content),
        workspace: workspaceRect,
        contentClientWidth: content.clientWidth,
        contentScrollWidth: content.scrollWidth,
        contentClientHeight: content.clientHeight,
        contentScrollHeight: content.scrollHeight,
        contentScrollTop: content.scrollTop,
        contentOverflowX: contentStyle.overflowX,
        contentOverflowY: contentStyle.overflowY,
        workspaceClientWidth: workspace.clientWidth,
        workspaceScrollWidth: workspace.scrollWidth,
        horizontallyContainedControls: controlRects.every(
          (control) => control.left >= workspaceRect.left - 1 && control.right <= workspaceRect.right + 1,
        ),
        minimumControlHeight: Math.min(...controlRects.map((control) => control.height)),
        stateMarkerCount: document.querySelectorAll(stateSelector).length,
        responsiveColumns: gridTemplateColumns.length,
        responsiveItemsStacked,
        retryContained,
      };

      function containedBy(child, parent) {
        return child.left >= parent.left - 1 && child.right <= parent.right + 1 &&
          child.top >= parent.top - 1 && child.bottom <= parent.bottom + 1;
      }
    })()
  `)) as StateMetrics;
}

function verifyState(state: FixtureState, metrics: StateMetrics) {
  const prefix = `manuscript_${state}`;
  invariant(metrics.viewportWidth === VIEWPORT_WIDTH, `${prefix}_viewport_width_changed`);
  invariant(metrics.viewportHeight === VIEWPORT_HEIGHT, `${prefix}_viewport_height_changed`);
  invariant(nearlyEqual(metrics.sidebar.width, SIDEBAR_WIDTH), `${prefix}_sidebar_width_changed`);
  invariant(nearlyEqual(metrics.content.left, SIDEBAR_WIDTH), `${prefix}_content_left_shifted`);
  invariant(
    containedHorizontally(metrics.workspace, metrics.content),
    `${prefix}_workspace_escaped_content`,
  );
  invariant(metrics.contentOverflowX === 'hidden', `${prefix}_horizontal_overflow_not_clipped`);
  invariant(metrics.contentOverflowY === 'auto', `${prefix}_vertical_scroll_not_enabled`);
  invariant(
    metrics.contentScrollWidth <= metrics.contentClientWidth + 1,
    `${prefix}_content_overflowed_horizontally:${metrics.contentScrollWidth}:${metrics.contentClientWidth}`,
  );
  invariant(
    metrics.workspaceScrollWidth <= metrics.workspaceClientWidth + 1,
    `${prefix}_workspace_overflowed_horizontally:${metrics.workspaceScrollWidth}:${metrics.workspaceClientWidth}`,
  );
  invariant(metrics.horizontallyContainedControls, `${prefix}_control_escaped_horizontally`);
  invariant(metrics.minimumControlHeight >= 33, `${prefix}_control_hit_target_too_short`);
  invariant(metrics.stateMarkerCount === 1, `${prefix}_state_marker_missing_or_duplicated`);
  invariant(metrics.responsiveColumns === 1, `${prefix}_responsive_grid_not_single_column`);
  invariant(metrics.responsiveItemsStacked, `${prefix}_responsive_items_not_stacked`);
  invariant(
    metrics.contentScrollHeight > metrics.contentClientHeight,
    `${prefix}_content_did_not_need_vertical_scroll`,
  );
  invariant(metrics.contentScrollTop > 0, `${prefix}_content_could_not_scroll_vertically`);
  invariant(metrics.retryContained, `${prefix}_retry_button_escaped_error_banner`);
}

async function run() {
  const window = new BrowserWindow({
    show: false,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    for (const state of ['unlinked', 'connected', 'error'] as const) {
      verifyState(state, await measureState(window, state));
    }
    console.log('Manuscript minimum-window geometry smoke test passed');
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'manuscript_layout_smoke_failed');
    app.exit(1);
  });
