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

type RectMetrics = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}>;

type CompactNotesGeometry = ScrollMetrics &
  Readonly<{
    layout: RectMetrics;
    tree: RectMetrics;
    reader: RectMetrics;
    readerHeader: RectMetrics;
    readerBody: RectMetrics;
    toggle: RectMetrics;
    detailsDisplay: string;
    toggleExpanded: string | null;
    toggleLabel: string | null;
    longTreeNameClientWidth: number;
    longTreeNameScrollWidth: number;
    longTreeNameOverflow: string;
    longTreeNameTextOverflow: string;
    longTreeNameWhiteSpace: string;
    readerPathClientWidth: number;
    readerPathScrollWidth: number;
    readerPathOverflow: string;
    readerPathTextOverflow: string;
    readerPathWhiteSpace: string;
  }>;

type CompactNotesScenario = Readonly<{
  name: 'stacked' | 'wide';
  width: number;
  height: number;
}>;

type CompactNotesScenarioMetrics = Readonly<{
  expanded: CompactNotesGeometry;
  collapsed: CompactNotesGeometry;
  expandedAgain: CompactNotesGeometry;
  collapseToggleFocused: boolean;
  restoreToggleFocused: boolean;
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

function researchNotesTreeMarkup() {
  const folders = ['Literature', 'Papers', 'Experiments', 'Project Progress', 'Idea Development'];
  const longFilename = `${'Long research note filename '.repeat(8)}with equations and evidence.md`;

  return folders
    .map(
      (folder, folderIndex) => `<div>
        <button class="local-notes-tree-row directory" role="treeitem" aria-expanded="true">
          <span class="local-notes-tree-disclosure expanded"></span>
          <span class="local-notes-tree-icon"></span>
          <span class="local-notes-tree-label">${folder}</span>
        </button>
        ${Array.from(
          { length: 5 },
          (_, fileIndex) => `<button
            class="local-notes-tree-row file${folderIndex === 0 && fileIndex === 0 ? ' selected' : ''}"
            role="treeitem"
            style="padding-inline-start: 26px"
          >
            <span class="local-notes-tree-disclosure"></span>
            <span class="local-notes-tree-icon"></span>
            <span class="local-notes-tree-label"${folderIndex === 0 && fileIndex === 0 ? ' data-long-tree-name' : ''}>${
              folderIndex === 0 && fileIndex === 0
                ? longFilename
                : `${folder} research note ${fileIndex + 1}.md`
            }</span>
          </button>`,
        ).join('')}
      </div>`,
    )
    .join('');
}

function compactResearchNotesFixtureMarkup(styles: string) {
  const selectedPath = `Literature/${'Selected research note path '.repeat(8)}canonical review.md`;

  return `<!doctype html>
<html data-text-size="extra-large">
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
    <main class="desktop-shell" style="--project-sidebar-width: 280px">
      <header class="titlebar"><strong>GOSU</strong><span>Research Notes compact tree</span></header>
      <aside class="desktop-nav"></aside>
      <section class="desktop-content desktop-content-document">
        <section class="notes-layout">
          <aside class="note-list" aria-label="Markdown files">
            <header class="research-notes-tree-header">
              <strong data-tree-root title="GOSU/Maximum width research project fixture">GOSU/Maximum width research project fixture</strong>
              <button
                id="fixture-research-notes-tree-toggle"
                type="button"
                class="ghost-button research-notes-folder-tree-toggle"
                aria-controls="fixture-research-notes-tree-details"
                aria-expanded="true"
                aria-label="Hide Research Notes folder tree"
                title="Hide folder tree"
              >‹</button>
            </header>
            <div id="fixture-research-notes-tree-details" class="research-notes-tree-details">
              <button type="button" class="secondary-button">Change Vault</button>
              <section class="research-notes-managed-summary">
                <span>MANAGED PROJECT FOLDERS</span>
                <ul><li>Literature</li><li>Papers</li><li>Experiments</li></ul>
              </section>
              <section class="local-notes-project-access authorized">
                <span>RESEARCH NOTES AGENT ACCESS</span>
                <strong>Authorized for this project</strong>
                <p>This project folder can be read through bounded chat tools.</p>
              </section>
              <div class="local-notes-tree" role="tree" aria-label="Research Notes files">
                ${researchNotesTreeMarkup()}
              </div>
            </div>
          </aside>
          <article class="note-reader">
            <header>
              <span data-reader-path>${selectedPath}</span>
              <div class="note-reader-mode"><button class="active">Rendered</button><button>Source</button></div>
            </header>
            <div class="note-reader-body" data-scroll-region>${longDocument()}</div>
          </article>
        </section>
      </section>
    </main>
  </body>
</html>`;
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

function nearlyEqual(left: number, right: number, tolerance = 1.1) {
  return Math.abs(left - right) <= tolerance;
}

function sameRect(left: RectMetrics, right: RectMetrics, prefix: string) {
  invariant(nearlyEqual(left.top, right.top), `${prefix}_top_shifted`);
  invariant(nearlyEqual(left.right, right.right), `${prefix}_right_shifted`);
  invariant(nearlyEqual(left.bottom, right.bottom), `${prefix}_bottom_shifted`);
  invariant(nearlyEqual(left.left, right.left), `${prefix}_left_shifted`);
  invariant(nearlyEqual(left.width, right.width), `${prefix}_width_shifted`);
  invariant(nearlyEqual(left.height, right.height), `${prefix}_height_shifted`);
}

function verifyContained(
  child: RectMetrics,
  container: RectMetrics,
  scenario: string,
  label: string,
) {
  invariant(child.top >= container.top - 1, `${scenario}_${label}_escaped_top`);
  invariant(child.left >= container.left - 1, `${scenario}_${label}_escaped_left`);
  invariant(child.right <= container.right + 1, `${scenario}_${label}_escaped_right`);
  invariant(child.bottom <= container.bottom + 1, `${scenario}_${label}_escaped_bottom`);
}

function verifyCompactNotesScroll(metrics: CompactNotesGeometry, scenario: string) {
  verifyMetrics('notes', 'extra-large', metrics);
  verifyContained(metrics.readerHeader, metrics.reader, scenario, 'reader_header');
  verifyContained(metrics.readerBody, metrics.reader, scenario, 'reader_body');
}

function verifyCompactNotesScenario(
  scenario: CompactNotesScenario,
  metrics: CompactNotesScenarioMetrics,
) {
  const prefix = `notes_compact_${scenario.name}`;

  sameRect(metrics.expanded.layout, metrics.collapsed.layout, `${prefix}_layout`);
  invariant(metrics.collapsed.detailsDisplay === 'none', `${prefix}_details_remain_visible`);
  invariant(metrics.collapsed.toggleExpanded === 'false', `${prefix}_toggle_not_collapsed`);
  invariant(
    metrics.collapsed.toggleLabel === 'Show Research Notes folder tree',
    `${prefix}_restore_toggle_label_missing`,
  );
  verifyContained(metrics.collapsed.toggle, metrics.collapsed.tree, prefix, 'restore_toggle');
  invariant(metrics.collapseToggleFocused, `${prefix}_toggle_lost_focus_after_collapse`);
  invariant(metrics.restoreToggleFocused, `${prefix}_toggle_lost_focus_after_restore`);

  sameRect(metrics.expanded.layout, metrics.expandedAgain.layout, `${prefix}_restored_layout`);
  sameRect(metrics.expanded.tree, metrics.expandedAgain.tree, `${prefix}_restored_tree`);
  sameRect(metrics.expanded.reader, metrics.expandedAgain.reader, `${prefix}_restored_reader`);
  invariant(metrics.expandedAgain.toggleExpanded === 'true', `${prefix}_toggle_not_restored`);

  if (scenario.name === 'wide') {
    invariant(metrics.collapsed.tree.width <= 46, `${prefix}_tree_is_not_compact`);
    invariant(
      metrics.collapsed.reader.width > metrics.expanded.reader.width + 150,
      `${prefix}_reader_did_not_expand_horizontally`,
    );
    invariant(
      nearlyEqual(metrics.expanded.reader.top, metrics.collapsed.reader.top),
      `${prefix}_reader_top_shifted`,
    );
    invariant(
      nearlyEqual(metrics.expanded.reader.right, metrics.collapsed.reader.right),
      `${prefix}_reader_right_shifted`,
    );
    invariant(
      nearlyEqual(metrics.expanded.reader.bottom, metrics.collapsed.reader.bottom),
      `${prefix}_reader_bottom_shifted`,
    );
  } else {
    invariant(metrics.collapsed.tree.height <= 46, `${prefix}_tree_is_not_compact`);
    invariant(
      metrics.collapsed.reader.height > metrics.expanded.reader.height + 100,
      `${prefix}_reader_did_not_expand_vertically`,
    );
    invariant(
      nearlyEqual(metrics.expanded.reader.left, metrics.collapsed.reader.left),
      `${prefix}_reader_left_shifted`,
    );
    invariant(
      nearlyEqual(metrics.expanded.reader.right, metrics.collapsed.reader.right),
      `${prefix}_reader_right_shifted`,
    );
    invariant(
      nearlyEqual(metrics.expanded.reader.bottom, metrics.collapsed.reader.bottom),
      `${prefix}_reader_bottom_shifted`,
    );
  }

  invariant(
    metrics.expanded.longTreeNameScrollWidth > metrics.expanded.longTreeNameClientWidth,
    `${prefix}_long_tree_filename_did_not_overflow`,
  );
  invariant(
    metrics.expanded.longTreeNameOverflow === 'hidden',
    `${prefix}_long_tree_filename_overflow_not_hidden`,
  );
  invariant(
    metrics.expanded.longTreeNameTextOverflow === 'ellipsis',
    `${prefix}_long_tree_filename_missing_ellipsis`,
  );
  invariant(
    metrics.expanded.longTreeNameWhiteSpace === 'nowrap',
    `${prefix}_long_tree_filename_wrapped`,
  );
  invariant(
    metrics.collapsed.readerPathScrollWidth > metrics.collapsed.readerPathClientWidth,
    `${prefix}_long_reader_path_did_not_overflow_${metrics.collapsed.readerPathClientWidth}_${metrics.collapsed.readerPathScrollWidth}_reader_${metrics.collapsed.reader.width}_header_${metrics.collapsed.readerHeader.width}`,
  );
  invariant(
    metrics.collapsed.readerPathOverflow === 'hidden',
    `${prefix}_long_reader_path_overflow_not_hidden`,
  );
  invariant(
    metrics.collapsed.readerPathTextOverflow === 'ellipsis',
    `${prefix}_long_reader_path_missing_ellipsis`,
  );
  invariant(
    metrics.collapsed.readerPathWhiteSpace === 'nowrap',
    `${prefix}_long_reader_path_wrapped`,
  );

  verifyCompactNotesScroll(metrics.expanded, `${prefix}_expanded`);
  verifyCompactNotesScroll(metrics.collapsed, `${prefix}_collapsed`);
  verifyCompactNotesScroll(metrics.expandedAgain, `${prefix}_restored`);
}

async function measureCompactNotesScenario(
  window: BrowserWindow,
  styles: string,
  scenario: CompactNotesScenario,
) {
  await window.setSize(scenario.width, scenario.height);
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(compactResearchNotesFixtureMarkup(styles))}`,
  );

  return (await window.webContents.executeJavaScript(`
    (async () => {
      const layout = document.querySelector('.notes-layout');
      const tree = document.querySelector('.note-list');
      const details = document.querySelector('.research-notes-tree-details');
      const toggle = document.querySelector('#fixture-research-notes-tree-toggle');
      const treeRoot = document.querySelector('[data-tree-root]');
      const reader = document.querySelector('.note-reader');
      const readerHeader = document.querySelector('.note-reader > header');
      const readerBody = document.querySelector('[data-scroll-region]');
      const readerPath = document.querySelector('[data-reader-path]');
      const longTreeName = document.querySelector('[data-long-tree-name]');
      const wide = document.querySelector('[data-wide-content]');
      const elements = [layout, tree, details, toggle, treeRoot, reader, readerHeader, readerBody, readerPath, longTreeName, wide];
      if (elements.some((element) => !(element instanceof HTMLElement))) {
        throw new Error('missing_research_notes_compact_geometry_element');
      }

      let collapsed = false;
      const render = () => {
        layout.classList.toggle('folder-tree-collapsed', collapsed);
        tree.classList.toggle('collapsed', collapsed);
        details.hidden = collapsed;
        treeRoot.hidden = collapsed;
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Show Research Notes folder tree' : 'Hide Research Notes folder tree');
        toggle.setAttribute('title', collapsed ? 'Show folder tree' : 'Hide folder tree');
        toggle.textContent = collapsed ? '›' : '‹';
      };
      toggle.addEventListener('click', () => {
        collapsed = !collapsed;
        render();
      });

      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
      const read = () => {
        readerBody.scrollTop = readerBody.scrollHeight;
        wide.scrollLeft = wide.scrollWidth;
        const regionStyle = getComputedStyle(readerBody);
        const wideStyle = getComputedStyle(wide);
        const treeNameStyle = getComputedStyle(longTreeName);
        const readerPathStyle = getComputedStyle(readerPath);
        return {
          layout: rect(layout),
          tree: rect(tree),
          reader: rect(reader),
          readerHeader: rect(readerHeader),
          readerBody: rect(readerBody),
          toggle: rect(toggle),
          detailsDisplay: getComputedStyle(details).display,
          toggleExpanded: toggle.getAttribute('aria-expanded'),
          toggleLabel: toggle.getAttribute('aria-label'),
          clientWidth: readerBody.clientWidth,
          scrollWidth: readerBody.scrollWidth,
          clientHeight: readerBody.clientHeight,
          scrollHeight: readerBody.scrollHeight,
          scrollLeft: readerBody.scrollLeft,
          scrollTop: readerBody.scrollTop,
          overflowX: regionStyle.overflowX,
          overflowY: regionStyle.overflowY,
          wideClientWidth: wide.clientWidth,
          wideScrollWidth: wide.scrollWidth,
          wideScrollLeft: wide.scrollLeft,
          wideOverflowX: wideStyle.overflowX,
          longTreeNameClientWidth: longTreeName.clientWidth,
          longTreeNameScrollWidth: longTreeName.scrollWidth,
          longTreeNameOverflow: treeNameStyle.overflow,
          longTreeNameTextOverflow: treeNameStyle.textOverflow,
          longTreeNameWhiteSpace: treeNameStyle.whiteSpace,
          readerPathClientWidth: readerPath.clientWidth,
          readerPathScrollWidth: readerPath.scrollWidth,
          readerPathOverflow: readerPathStyle.overflow,
          readerPathTextOverflow: readerPathStyle.textOverflow,
          readerPathWhiteSpace: readerPathStyle.whiteSpace,
        };
      };

      await nextFrame();
      const expanded = read();

      toggle.focus();
      toggle.click();
      await nextFrame();
      const collapsedMetrics = read();
      const collapseToggleFocused = document.activeElement === toggle;

      toggle.click();
      await nextFrame();
      const expandedAgain = read();
      const restoreToggleFocused = document.activeElement === toggle;

      return {
        expanded,
        collapsed: collapsedMetrics,
        expandedAgain,
        collapseToggleFocused,
        restoreToggleFocused,
      };
    })()
  `)) as CompactNotesScenarioMetrics;
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
    for (const scenario of [
      { name: 'stacked', width: 820, height: 780 },
      { name: 'wide', width: 1480, height: 930 },
    ] as const) {
      verifyCompactNotesScenario(
        scenario,
        await measureCompactNotesScenario(window, styles, scenario),
      );
    }
    console.log(
      'Markdown viewers scroll and Research Notes compact tree geometry smoke test passed',
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
    console.error(error instanceof Error ? error.message : 'markdown_viewer_scroll_smoke_failed');
    app.exit(1);
  });
