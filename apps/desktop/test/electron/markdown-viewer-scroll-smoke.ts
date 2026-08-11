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
    content: RectMetrics;
    layout: RectMetrics;
    tree: RectMetrics;
    details: RectMetrics;
    treeScroll: RectMetrics;
    firstFolder: RectMetrics;
    lastFolder: RectMetrics;
    sidebarTools: RectMetrics;
    sidebarToolsToggle: RectMetrics;
    sidebarToolsBody: RectMetrics;
    compactSearch: RectMetrics;
    compactSearchForm: RectMetrics;
    compactSearchLabel: RectMetrics;
    compactSearchControls: RectMetrics;
    compactSearchInput: RectMetrics;
    compactSearchButton: RectMetrics;
    sidebarToolsLastControl: RectMetrics;
    viewport: RectMetrics;
    reader: RectMetrics;
    readerHeader: RectMetrics;
    readerBody: RectMetrics;
    toggle: RectMetrics;
    detailsDisplay: string;
    contentScrollTop: number;
    treeScrollTop: number;
    sidebarToolsOpen: boolean;
    noteListClientHeight: number;
    noteListScrollHeight: number;
    detailsClientHeight: number;
    detailsScrollHeight: number;
    sidebarToolsBodyClientHeight: number;
    sidebarToolsBodyScrollHeight: number;
    sidebarToolsBodyScrollTop: number;
    sidebarToolsBodyOverflowY: string;
    sidebarToolsBodyClientWidth: number;
    sidebarToolsBodyScrollWidth: number;
    compactSearchClientWidth: number;
    compactSearchScrollWidth: number;
    compactSearchFormColumns: string;
    compactSearchControlColumns: string;
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
  name: 'stacked' | 'minimum' | 'minimum-wide-sidebar' | 'wide';
  width: number;
  height: number;
  projectSidebarWidth: number;
  textSize: 'default' | 'extra-large';
}>;

type CompactNotesScenarioMetrics = Readonly<{
  expanded: CompactNotesGeometry;
  searchVisible: CompactNotesGeometry;
  toolsExpanded: CompactNotesGeometry;
  toolsReopened: CompactNotesGeometry;
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
  const longFolderName = `Literature — ${'Long research folder name '.repeat(8)}with evidence`;

  return folders
    .map(
      (folder, folderIndex) => `<button
          class="local-notes-tree-row directory"
          role="treeitem"
          aria-expanded="false"
          data-top-level-folder
        >
          <span class="local-notes-tree-disclosure"></span>
          <span class="local-notes-tree-icon"></span>
          <span class="local-notes-tree-label"${folderIndex === 0 ? ' data-long-tree-name' : ''}>${
            folderIndex === 0 ? longFolderName : folder
          }</span>
        </button>`,
    )
    .join('');
}

function compactResearchNotesFixtureMarkup(styles: string, scenario: CompactNotesScenario) {
  const selectedPath = `Literature/${'Selected research note path '.repeat(8)}canonical review.md`;

  return `<!doctype html>
<html data-text-size="${scenario.textSize}">
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
    <main class="desktop-shell" style="--project-sidebar-width: ${scenario.projectSidebarWidth}px">
      <header class="titlebar"><strong>GOSU</strong><span>Research Notes compact tree</span></header>
      <aside class="desktop-nav"></aside>
      <section class="desktop-content desktop-content-document desktop-content-notes">
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
              <div class="research-notes-tree-scroll">
                <div class="local-notes-tree" role="tree" aria-label="Research Notes files">
                  ${researchNotesTreeMarkup()}
                </div>
              </div>
              <section class="research-notes-sidebar-tools">
                <button
                  type="button"
                  class="research-notes-sidebar-tools-toggle"
                  aria-controls="fixture-research-notes-sidebar-tools-body"
                  aria-expanded="false"
                ><span class="research-notes-sidebar-tools-chevron"></span><span>Search &amp; settings</span></button>
                <div id="fixture-research-notes-sidebar-tools-body" class="research-notes-sidebar-tools-body" hidden>
                  <section class="search-view compact" aria-label="Workspace search">
                    <form class="search-form" role="search">
                      <label for="fixture-research-notes-search">Search Research Notes</label>
                      <div class="search-form-controls">
                        <input id="fixture-research-notes-search" type="search" value="" placeholder="Title, path, content, or tag" />
                        <button type="submit" class="primary-button">Searching…</button>
                      </div>
                    </form>
                  </section>
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
                  <p class="note-agent-disclosure">Access is project-specific and stays off until explicitly authorized. Listing and bounded excerpts may be sent to the configured model while Research Notes bodies remain local.</p>
                </div>
              </section>
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

function verifyHorizontallyContained(
  child: RectMetrics,
  container: RectMetrics,
  scenario: string,
  label: string,
) {
  invariant(child.left >= container.left - 1, `${scenario}_${label}_escaped_left`);
  invariant(child.right <= container.right + 1, `${scenario}_${label}_escaped_right`);
}

function verifyCompactSearch(metrics: CompactNotesGeometry, scenario: string) {
  invariant(
    metrics.compactSearch.top >= metrics.sidebarToolsBody.top - 1 &&
      metrics.compactSearch.bottom <= metrics.sidebarToolsBody.bottom + 1,
    `${scenario}_compact_search_not_fully_visible_search_${metrics.compactSearch.top}_${metrics.compactSearch.bottom}_${metrics.compactSearch.height}_body_${metrics.sidebarToolsBody.top}_${metrics.sidebarToolsBody.bottom}_${metrics.sidebarToolsBody.height}`,
  );
  verifyHorizontallyContained(
    metrics.compactSearch,
    metrics.sidebarToolsBody,
    scenario,
    'compact_search',
  );
  verifyContained(
    metrics.compactSearchForm,
    metrics.compactSearch,
    scenario,
    'compact_search_form',
  );
  verifyContained(
    metrics.compactSearchLabel,
    metrics.compactSearchForm,
    scenario,
    'compact_search_label',
  );
  verifyContained(
    metrics.compactSearchControls,
    metrics.compactSearchForm,
    scenario,
    'compact_search_controls',
  );
  verifyContained(
    metrics.compactSearchInput,
    metrics.compactSearchControls,
    scenario,
    'compact_search_input',
  );
  verifyContained(
    metrics.compactSearchButton,
    metrics.compactSearchControls,
    scenario,
    'compact_search_button',
  );
  verifyHorizontallyContained(
    metrics.compactSearchButton,
    metrics.sidebarToolsBody,
    scenario,
    'compact_search_button_body',
  );
  invariant(
    metrics.compactSearchLabel.bottom <= metrics.compactSearchControls.top - 4,
    `${scenario}_compact_search_label_did_not_clear_controls`,
  );
  invariant(
    nearlyEqual(metrics.compactSearchButton.bottom, metrics.compactSearchInput.bottom, 1),
    `${scenario}_compact_search_controls_are_not_bottom_aligned`,
  );
  invariant(
    metrics.sidebarToolsBodyScrollWidth <= metrics.sidebarToolsBodyClientWidth + 1,
    `${scenario}_settings_body_has_hidden_inline_overflow`,
  );
  invariant(
    metrics.compactSearchScrollWidth <= metrics.compactSearchClientWidth + 1,
    `${scenario}_compact_search_has_hidden_inline_overflow`,
  );
  invariant(
    metrics.compactSearchFormColumns.split(' ').length === 1,
    `${scenario}_compact_search_form_is_not_single_column_${metrics.compactSearchFormColumns}`,
  );
  invariant(
    metrics.compactSearchControlColumns.split(' ').length === 2,
    `${scenario}_compact_search_controls_are_not_two_columns_${metrics.compactSearchControlColumns}`,
  );
}

function verifyCompactNotesScroll(
  metrics: CompactNotesGeometry,
  scenario: string,
  textSize: CompactNotesScenario['textSize'],
) {
  verifyMetrics('notes', textSize, metrics);
  verifyContained(metrics.readerHeader, metrics.reader, scenario, 'reader_header');
  verifyContained(metrics.readerBody, metrics.reader, scenario, 'reader_body');
}

function verifySettingsChromeContained(
  metrics: CompactNotesGeometry,
  scenario: string,
  state: 'closed' | 'open',
) {
  verifyContained(metrics.sidebarTools, metrics.details, scenario, `${state}_settings_details`);
  verifyContained(metrics.sidebarTools, metrics.tree, scenario, `${state}_settings_note_list`);
  verifyContained(metrics.sidebarTools, metrics.layout, scenario, `${state}_settings_layout`);
  verifyContained(metrics.sidebarTools, metrics.viewport, scenario, `${state}_settings_viewport`);
  verifyContained(
    metrics.sidebarToolsToggle,
    metrics.sidebarTools,
    scenario,
    `${state}_settings_summary`,
  );
  invariant(
    metrics.sidebarToolsToggle.height >= 38,
    `${scenario}_${state}_settings_summary_clipped`,
  );
}

function verifyCompactNotesScenario(
  scenario: CompactNotesScenario,
  metrics: CompactNotesScenarioMetrics,
) {
  const prefix = `notes_compact_${scenario.name}`;
  const stacked = scenario.width <= 860;
  const expectedTopInset = stacked ? 14 : 18;

  invariant(
    nearlyEqual(metrics.expanded.layout.top - metrics.expanded.content.top, expectedTopInset),
    `${prefix}_top_inset_is_not_compact`,
  );
  invariant(metrics.expanded.contentScrollTop === 0, `${prefix}_page_scrolled_on_entry`);
  invariant(metrics.expanded.treeScrollTop === 0, `${prefix}_folder_tree_scrolled_on_entry`);
  invariant(!metrics.expanded.sidebarToolsOpen, `${prefix}_secondary_tools_open_on_entry`);
  invariant(metrics.expanded.sidebarTools.height <= 44, `${prefix}_secondary_tools_too_tall`);
  verifySettingsChromeContained(metrics.expanded, prefix, 'closed');
  invariant(
    metrics.expanded.noteListScrollHeight <= metrics.expanded.noteListClientHeight + 1,
    `${prefix}_closed_note_list_hidden_overflow`,
  );
  invariant(
    metrics.expanded.detailsScrollHeight <= metrics.expanded.detailsClientHeight + 1,
    `${prefix}_closed_details_hidden_overflow`,
  );
  invariant(
    metrics.expanded.firstFolder.top - metrics.expanded.tree.top <= 100,
    `${prefix}_first_folder_not_near_sidebar_top`,
  );
  verifyContained(
    metrics.expanded.firstFolder,
    metrics.expanded.treeScroll,
    prefix,
    'first_folder',
  );
  verifyContained(metrics.expanded.lastFolder, metrics.expanded.treeScroll, prefix, 'last_folder');

  invariant(metrics.toolsExpanded.sidebarToolsOpen, `${prefix}_secondary_tools_did_not_open`);
  verifyCompactSearch(metrics.searchVisible, prefix);
  invariant(metrics.toolsReopened.sidebarToolsOpen, `${prefix}_secondary_tools_did_not_reopen`);
  invariant(
    metrics.toolsReopened.sidebarToolsBodyScrollTop === 0,
    `${prefix}_secondary_tools_did_not_restore_search_on_reopen`,
  );
  verifyCompactSearch(metrics.toolsReopened, `${prefix}_reopened`);
  verifySettingsChromeContained(metrics.toolsExpanded, prefix, 'open');
  invariant(
    metrics.toolsExpanded.sidebarTools.height <= 421,
    `${prefix}_secondary_tools_exceeded_absolute_cap`,
  );
  if (stacked) {
    invariant(
      metrics.toolsExpanded.sidebarTools.height <= 191 &&
        metrics.toolsExpanded.sidebarTools.height <= metrics.toolsExpanded.details.height - 94,
      `${prefix}_secondary_tools_exceeded_stacked_tree_reserve`,
    );
  } else {
    invariant(
      metrics.toolsExpanded.sidebarTools.height <= metrics.toolsExpanded.details.height * 0.46 + 2,
      `${prefix}_secondary_tools_exceeded_relative_cap`,
    );
  }
  invariant(
    metrics.toolsExpanded.treeScroll.height >= 90,
    `${prefix}_folder_tree_lost_all_open_state_space_${metrics.toolsExpanded.treeScroll.height}_${metrics.toolsExpanded.details.height}_${metrics.toolsExpanded.sidebarTools.height}`,
  );
  invariant(
    metrics.toolsExpanded.sidebarToolsBodyScrollHeight >
      metrics.toolsExpanded.sidebarToolsBodyClientHeight,
    `${prefix}_secondary_tools_did_not_own_scroll_range_${metrics.toolsExpanded.sidebarToolsBodyClientHeight}_${metrics.toolsExpanded.sidebarToolsBodyScrollHeight}_${metrics.toolsExpanded.sidebarTools.height}_${metrics.toolsExpanded.details.height}`,
  );
  invariant(
    metrics.toolsExpanded.sidebarToolsBodyScrollTop > 0,
    `${prefix}_secondary_tools_could_not_scroll`,
  );
  invariant(
    metrics.toolsExpanded.sidebarToolsBodyOverflowY === 'auto',
    `${prefix}_secondary_tools_body_scroll_not_enabled`,
  );
  invariant(
    metrics.toolsExpanded.sidebarToolsLastControl.bottom <=
      metrics.toolsExpanded.sidebarToolsBody.bottom + 1 &&
      metrics.toolsExpanded.sidebarToolsLastControl.bottom >=
        metrics.toolsExpanded.sidebarToolsBody.top,
    `${prefix}_secondary_tools_last_control_unreachable`,
  );
  invariant(metrics.toolsExpanded.contentScrollTop === 0, `${prefix}_tools_scrolled_page`);

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

  if (!stacked) {
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

  verifySettingsChromeContained(metrics.expandedAgain, prefix, 'closed');
  verifyCompactNotesScroll(metrics.expanded, `${prefix}_expanded`, scenario.textSize);
  verifyCompactNotesScroll(metrics.collapsed, `${prefix}_collapsed`, scenario.textSize);
  verifyCompactNotesScroll(metrics.expandedAgain, `${prefix}_restored`, scenario.textSize);
}

async function measureCompactNotesScenario(
  window: BrowserWindow,
  styles: string,
  scenario: CompactNotesScenario,
) {
  await window.setSize(scenario.width, scenario.height);
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(compactResearchNotesFixtureMarkup(styles, scenario))}`,
  );

  return (await window.webContents.executeJavaScript(`
    (async () => {
      const content = document.querySelector('.desktop-content-notes');
      const layout = document.querySelector('.notes-layout');
      const tree = document.querySelector('.note-list');
      const details = document.querySelector('.research-notes-tree-details');
      const treeScroll = document.querySelector('.research-notes-tree-scroll');
      const sidebarTools = document.querySelector('.research-notes-sidebar-tools');
      const sidebarToolsToggle = document.querySelector('.research-notes-sidebar-tools-toggle');
      const sidebarToolsBody = document.querySelector('.research-notes-sidebar-tools-body');
      const compactSearch = document.querySelector('.search-view.compact');
      const compactSearchForm = compactSearch?.querySelector('.search-form');
      const compactSearchLabel = compactSearchForm?.querySelector('label');
      const compactSearchControls = compactSearchForm?.querySelector('.search-form-controls');
      const compactSearchInput = compactSearchForm?.querySelector('input');
      const compactSearchButton = compactSearchForm?.querySelector('button');
      const sidebarToolsLastControl = document.querySelector('.note-agent-disclosure');
      const folderRows = Array.from(document.querySelectorAll('[data-top-level-folder]'));
      const firstFolder = folderRows.at(0);
      const lastFolder = folderRows.at(-1);
      const toggle = document.querySelector('#fixture-research-notes-tree-toggle');
      const treeRoot = document.querySelector('[data-tree-root]');
      const reader = document.querySelector('.note-reader');
      const readerHeader = document.querySelector('.note-reader > header');
      const readerBody = document.querySelector('[data-scroll-region]');
      const readerPath = document.querySelector('[data-reader-path]');
      const longTreeName = document.querySelector('[data-long-tree-name]');
      const wide = document.querySelector('[data-wide-content]');
      const elements = [content, layout, tree, details, treeScroll, sidebarTools, sidebarToolsToggle, sidebarToolsBody, compactSearch, compactSearchForm, compactSearchLabel, compactSearchControls, compactSearchInput, compactSearchButton, sidebarToolsLastControl, firstFolder, lastFolder, toggle, treeRoot, reader, readerHeader, readerBody, readerPath, longTreeName, wide];
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
      let toolsOpen = false;
      const renderTools = () => {
        sidebarTools.classList.toggle('open', toolsOpen);
        sidebarToolsBody.hidden = !toolsOpen;
        sidebarToolsToggle.setAttribute('aria-expanded', String(toolsOpen));
      };
      sidebarToolsToggle.addEventListener('click', () => {
        toolsOpen = !toolsOpen;
        renderTools();
        if (toolsOpen) sidebarToolsBody.scrollTop = 0;
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
      const read = (scrollSidebarTools = false) => {
        readerBody.scrollTop = readerBody.scrollHeight;
        wide.scrollLeft = wide.scrollWidth;
        if (scrollSidebarTools) sidebarToolsBody.scrollTop = sidebarToolsBody.scrollHeight;
        const regionStyle = getComputedStyle(readerBody);
        const wideStyle = getComputedStyle(wide);
        const treeNameStyle = getComputedStyle(longTreeName);
        const readerPathStyle = getComputedStyle(readerPath);
        const sidebarToolsBodyStyle = getComputedStyle(sidebarToolsBody);
        const compactSearchFormStyle = getComputedStyle(compactSearchForm);
        const compactSearchControlsStyle = getComputedStyle(compactSearchControls);
        return {
          content: rect(content),
          layout: rect(layout),
          tree: rect(tree),
          details: rect(details),
          treeScroll: rect(treeScroll),
          firstFolder: rect(firstFolder),
          lastFolder: rect(lastFolder),
          sidebarTools: rect(sidebarTools),
          sidebarToolsToggle: rect(sidebarToolsToggle),
          sidebarToolsBody: rect(sidebarToolsBody),
          compactSearch: rect(compactSearch),
          compactSearchForm: rect(compactSearchForm),
          compactSearchLabel: rect(compactSearchLabel),
          compactSearchControls: rect(compactSearchControls),
          compactSearchInput: rect(compactSearchInput),
          compactSearchButton: rect(compactSearchButton),
          sidebarToolsLastControl: rect(sidebarToolsLastControl),
          viewport: {
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
            left: 0,
            width: window.innerWidth,
            height: window.innerHeight,
          },
          reader: rect(reader),
          readerHeader: rect(readerHeader),
          readerBody: rect(readerBody),
          toggle: rect(toggle),
          detailsDisplay: getComputedStyle(details).display,
          contentScrollTop: content.scrollTop,
          treeScrollTop: treeScroll.scrollTop,
          sidebarToolsOpen: toolsOpen,
          noteListClientHeight: tree.clientHeight,
          noteListScrollHeight: tree.scrollHeight,
          detailsClientHeight: details.clientHeight,
          detailsScrollHeight: details.scrollHeight,
          sidebarToolsBodyClientHeight: sidebarToolsBody.clientHeight,
          sidebarToolsBodyScrollHeight: sidebarToolsBody.scrollHeight,
          sidebarToolsBodyScrollTop: sidebarToolsBody.scrollTop,
          sidebarToolsBodyOverflowY: sidebarToolsBodyStyle.overflowY,
          sidebarToolsBodyClientWidth: sidebarToolsBody.clientWidth,
          sidebarToolsBodyScrollWidth: sidebarToolsBody.scrollWidth,
          compactSearchClientWidth: compactSearch.clientWidth,
          compactSearchScrollWidth: compactSearch.scrollWidth,
          compactSearchFormColumns: compactSearchFormStyle.gridTemplateColumns,
          compactSearchControlColumns: compactSearchControlsStyle.gridTemplateColumns,
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

      sidebarToolsToggle.click();
      await nextFrame();
      const searchVisible = read();
      const toolsExpanded = read(true);
      sidebarToolsToggle.click();
      await nextFrame();
      sidebarToolsToggle.click();
      await nextFrame();
      const toolsReopened = read();
      sidebarToolsToggle.click();
      await nextFrame();

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
        searchVisible,
        toolsExpanded,
        toolsReopened,
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
      {
        name: 'stacked',
        width: 860,
        height: 700,
        projectSidebarWidth: 280,
        textSize: 'extra-large',
      },
      {
        name: 'minimum',
        width: 1060,
        height: 700,
        projectSidebarWidth: 280,
        textSize: 'extra-large',
      },
      {
        name: 'minimum-wide-sidebar',
        width: 1060,
        height: 700,
        projectSidebarWidth: 440,
        textSize: 'extra-large',
      },
      {
        name: 'wide',
        width: 1480,
        height: 930,
        projectSidebarWidth: 280,
        textSize: 'default',
      },
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
