import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { app, BrowserWindow } from 'electron';

type RectMetrics = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}>;

type ChatGeometry = Readonly<{
  workspace: RectMetrics;
  rail: RectMetrics;
  shell: RectMetrics;
  toolbar: RectMetrics;
  toolbarDetails: RectMetrics;
  toolbarSummary: RectMetrics;
  compactIdentity: RectMetrics;
  badges: RectMetrics;
  providerBoundary: RectMetrics;
  detailsToggle: RectMetrics;
  transcript: RectMetrics;
  composer: RectMetrics;
  projectNameClientWidth: number;
  projectNameScrollWidth: number;
  projectNameOverflow: string;
  projectNameTextOverflow: string;
  projectNameWhiteSpace: string;
  transcriptClientHeight: number;
  transcriptScrollHeight: number;
  transcriptScrollTop: number;
  messageMetaCount: number;
  messageMetaMaxHeight: number;
  messageMetaOverflowCount: number;
  messageActionGroupMaxHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}>;

type ScenarioMetrics = Readonly<{
  expanded: ChatGeometry;
  headerCollapsed: ChatGeometry;
  headerExpandedAgain: ChatGeometry;
  railCollapsed: ChatGeometry;
  collapseToggleFocused: boolean;
  expandToggleFocused: boolean;
}>;

type Scenario = Readonly<{
  name: 'minimum' | 'wide';
  width: number;
  height: number;
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function transcriptMarkup() {
  return Array.from(
    { length: 32 },
    (_, index) => `<article class="chat-message ${index % 2 === 0 ? 'user' : 'assistant'}">
      <header><strong>${index % 2 === 0 ? 'YOU' : 'GOSU'}</strong><span>Turn ${index + 1}</span></header>
      <div class="message-copy"><p>Long project discussion ${index + 1}. This rendered turn keeps the transcript locally scrollable while the surrounding Project Chat workspace remains geometrically stable.</p></div>
      <footer class="chat-message-meta">
        <div class="message-provenance">Codex · fixture-model · reasoning high</div>
        <div class="chat-message-branch" role="group" aria-label="Message history actions">
          ${index % 2 === 0 ? '<button class="ghost-button" aria-label="Edit this message in a new chat branch">✎ Edit &amp; branch</button>' : ''}
          <button class="ghost-button" aria-label="Create a new chat branch from this message">⑂ Branch</button>
        </div>
      </footer>
    </article>`,
  ).join('');
}

function sessionMarkup() {
  return Array.from(
    { length: 12 },
    (_, index) => `<div class="project-chat-session-row${index === 0 ? ' active' : ''}">
      <button class="project-chat-session-item${index === 0 ? ' active' : ''}">
        <span class="project-chat-session-title"><i>◇</i><strong>Experiment session ${index + 1}</strong>${index === 0 ? '<b>●</b>' : ''}</span>
        <small>Updated research conversation ${index + 1}</small>
      </button>
      <button class="project-chat-session-rename-trigger" aria-label="Rename session ${index + 1}">✎</button>
    </div>`,
  ).join('');
}

function resourceMarkup() {
  return Array.from(
    { length: 3 },
    (_, index) => `<article class="chat-ssh-resource">
      <div class="chat-ssh-resource-heading">
        <div><strong>8xRTX3080-${index + 1}</strong><span>/workspace/research/phase-${index + 1}</span></div>
        <button class="ghost-button">Refresh usage</button>
      </div>
      <section class="ssh-resource-summary compact">
        <strong>GPU ${38 + index * 11}% · CPU ${22 + index * 7}% · RAM ${41 + index * 5}%</strong>
      </section>
    </article>`,
  ).join('');
}

function fixtureMarkup(styles: string) {
  const projectName = `GOSU-${'A'.repeat(115)}`;
  invariant(projectName.length === 120, 'fixture_project_name_must_be_120_characters');

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
    <div id="root">
      <main class="desktop-shell" style="--project-sidebar-width: 420px">
        <header class="titlebar"><span class="logo">G</span><strong>GOSU</strong><span>Project Chat compact geometry</span></header>
        <aside class="desktop-nav" aria-label="Projects">
          <small>Projects</small>
          <div class="project-switcher"><strong>Maximum-width project sidebar fixture</strong></div>
        </aside>
        <section class="desktop-content desktop-content-chat">
          <div class="project-chat-workspace" style="--project-chat-session-rail-width: 320px">
            <aside class="project-chat-session-rail" aria-label="Project chat sessions">
              <header>
                <div class="project-chat-session-heading">
                  <div class="project-chat-session-heading-copy"><span>Sessions</span><strong>12</strong></div>
                  <button class="ghost-button project-chat-session-collapse-toggle" aria-label="Hide project chat sessions">‹</button>
                </div>
                <div class="project-chat-session-actions">
                  <button>Rename</button><button>+ New chat</button>
                </div>
              </header>
              <div class="project-chat-session-list">${sessionMarkup()}</div>
            </aside>
            <section class="project-chat-shell" aria-label="Fixture project chat">
              <header class="chat-toolbar">
                <div class="chat-toolbar-summary" hidden>
                  <div class="chat-toolbar-summary-identity"><span class="chat-orbit">G</span><div><strong>Project Copilot</strong><span data-project-name>${projectName}</span></div></div>
                  <div class="chat-toolbar-summary-badges"><span>Hermes configured model with long provider metadata</span><span>Model default reasoning</span><span>Hermes ACP · no native tools</span><span>3 linked servers</span></div>
                </div>
                <div class="chat-toolbar-details" id="fixture-chat-toolbar-details">
                  <div class="chat-identity">
                    <span class="chat-orbit">G</span>
                    <div><strong>GOSU Project Copilot</strong><span>Board, Objective, Research Notes, Literature, Repository, and approved servers are available.</span></div>
                  </div>
                  <div class="chat-model-controls">
                    <label>Model<select><option>Auto · provider recommended</option></select></label>
                    <label>Reasoning<select><option>High</option></select></label>
                    <button class="ghost-button chat-refresh">Refresh</button>
                    <button class="secondary-button chat-agent-toggle">Agent controls</button>
                  </div>
                  <div class="chat-provider-boundary" role="note">
                    <strong>Hermes · verified ACP agent mode</strong>
                    <span>Uses verified Hermes ACP with no native tools. Codex can explicitly delegate a bounded task to a fresh Hermes primary ACP agent. Terminal, files, web, native delegation, MCP, GOSU tools, and attachments remain disabled at the minimum supported window width and extra-large text size.</span>
                  </div>
                  <div class="chat-ssh-setup-notice">
                    <div><strong>SSH server registered — project access is not granted yet</strong><span>Choose one specific remote project folder before Project Chat can use this server.</span></div>
                    <button class="secondary-button">Grant to project…</button>
                  </div>
                  <section class="chat-ssh-resources" aria-label="Linked server resources">
                    <header><strong>Linked server resources</strong><span>Visible only to this project</span></header>
                    <div class="chat-ssh-resource-list">${resourceMarkup()}</div>
                  </section>
                </div>
                <button
                  id="fixture-chat-details-toggle"
                  class="ghost-button chat-details-toggle"
                  aria-controls="fixture-chat-toolbar-details"
                  aria-expanded="true"
                  aria-label="Hide chat details"
                >Minimize</button>
              </header>
              <div class="chat-transcript-region">
                <div class="chat-transcript">${transcriptMarkup()}</div>
              </div>
              <div class="chat-compose-area">
                <div class="chat-context-note"><span>LOCAL CONTEXT</span>Board + Objective · Research Notes · linked servers</div>
                <div class="chat-composer">
                  <button class="chat-attach-button">＋<span>Files</span></button>
                  <textarea aria-label="Message">Continue the experiment and summarize the result.</textarea>
                  <button class="primary-button chat-send">Send<span>Enter</span></button>
                </div>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>`;
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

function verifyViewportContainment(metrics: ChatGeometry, scenario: string) {
  invariant(metrics.composer.left >= -1, `${scenario}_composer_escaped_viewport_left`);
  invariant(metrics.composer.top >= -1, `${scenario}_composer_escaped_viewport_top`);
  invariant(
    metrics.composer.right <= metrics.viewportWidth + 1,
    `${scenario}_composer_escaped_viewport_right`,
  );
  invariant(
    metrics.composer.bottom <= metrics.viewportHeight + 1,
    `${scenario}_composer_escaped_viewport_bottom`,
  );
  verifyContained(metrics.composer, metrics.shell, scenario, 'composer');
}

function verifyScenario(scenario: Scenario, metrics: ScenarioMetrics) {
  const prefix = scenario.name;

  for (const [state, geometry] of [
    ['expanded', metrics.expanded],
    ['headerCollapsed', metrics.headerCollapsed],
    ['headerExpandedAgain', metrics.headerExpandedAgain],
    ['railCollapsed', metrics.railCollapsed],
  ] as const) {
    invariant(geometry.messageMetaCount === 32, `${prefix}_${state}_message_meta_missing`);
    invariant(
      geometry.messageMetaOverflowCount === 0,
      `${prefix}_${state}_message_meta_overflowed`,
    );
    invariant(
      geometry.messageActionGroupMaxHeight <= 26,
      `${prefix}_${state}_message_actions_too_tall_${geometry.messageActionGroupMaxHeight}`,
    );
    invariant(
      geometry.messageMetaMaxHeight <= (scenario.name === 'wide' ? 30 : 60),
      `${prefix}_${state}_message_meta_too_tall_${geometry.messageMetaMaxHeight}`,
    );
  }

  for (const [state, geometry] of [
    ['expanded', metrics.expanded],
    ['expandedAgain', metrics.headerExpandedAgain],
  ] as const) {
    verifyContained(
      geometry.providerBoundary,
      geometry.toolbarDetails,
      `${prefix}_${state}`,
      'provider_boundary',
    );
    invariant(
      nearlyEqual(geometry.providerBoundary.left, geometry.toolbarDetails.left),
      `${prefix}_${state}_provider_boundary_not_full_width_left`,
    );
    invariant(
      nearlyEqual(geometry.providerBoundary.right, geometry.toolbarDetails.right),
      `${prefix}_${state}_provider_boundary_not_full_width_right`,
    );
  }

  sameRect(
    metrics.expanded.workspace,
    metrics.headerCollapsed.workspace,
    `${prefix}_header_workspace`,
  );
  sameRect(metrics.expanded.shell, metrics.headerCollapsed.shell, `${prefix}_header_shell`);
  invariant(
    metrics.headerCollapsed.transcript.height > metrics.expanded.transcript.height + 80,
    `${prefix}_header_collapse_did_not_expand_transcript_${metrics.expanded.transcript.height}_to_${metrics.headerCollapsed.transcript.height}`,
  );

  invariant(
    metrics.headerCollapsed.transcriptScrollHeight > metrics.headerCollapsed.transcriptClientHeight,
    `${prefix}_transcript_did_not_overflow`,
  );
  invariant(
    metrics.headerCollapsed.transcriptScrollTop > 0,
    `${prefix}_transcript_could_not_scroll`,
  );
  invariant(metrics.collapseToggleFocused, `${prefix}_toggle_lost_focus_after_collapse`);
  invariant(metrics.expandToggleFocused, `${prefix}_toggle_lost_focus_after_expansion`);
  sameRect(
    metrics.expanded.workspace,
    metrics.headerExpandedAgain.workspace,
    `${prefix}_expanded_again_workspace`,
  );
  sameRect(
    metrics.expanded.shell,
    metrics.headerExpandedAgain.shell,
    `${prefix}_expanded_again_shell`,
  );
  invariant(
    nearlyEqual(metrics.expanded.transcript.height, metrics.headerExpandedAgain.transcript.height),
    `${prefix}_expanded_again_transcript_height_changed`,
  );

  verifyContained(
    metrics.headerCollapsed.toolbarSummary,
    metrics.headerCollapsed.toolbar,
    `${prefix}_collapsed`,
    'toolbar_summary',
  );
  verifyContained(
    metrics.headerCollapsed.compactIdentity,
    metrics.headerCollapsed.toolbarSummary,
    `${prefix}_collapsed`,
    'compact_identity',
  );
  verifyContained(
    metrics.headerCollapsed.badges,
    metrics.headerCollapsed.toolbarSummary,
    `${prefix}_collapsed`,
    'toolbar_badges',
  );
  verifyContained(
    metrics.headerCollapsed.detailsToggle,
    metrics.headerCollapsed.toolbar,
    `${prefix}_collapsed`,
    'details_toggle',
  );
  invariant(
    metrics.headerCollapsed.compactIdentity.width <= 221,
    `${prefix}_compact_identity_is_not_bounded`,
  );
  invariant(
    metrics.headerCollapsed.projectNameScrollWidth > metrics.headerCollapsed.projectNameClientWidth,
    `${prefix}_long_project_name_did_not_truncate`,
  );
  invariant(
    metrics.headerCollapsed.projectNameOverflow === 'hidden',
    `${prefix}_long_project_name_overflow_not_hidden`,
  );
  invariant(
    metrics.headerCollapsed.projectNameTextOverflow === 'ellipsis',
    `${prefix}_long_project_name_missing_ellipsis`,
  );
  invariant(
    metrics.headerCollapsed.projectNameWhiteSpace === 'nowrap',
    `${prefix}_long_project_name_wrapped`,
  );

  sameRect(
    metrics.headerCollapsed.workspace,
    metrics.railCollapsed.workspace,
    `${prefix}_rail_workspace`,
  );

  if (scenario.name === 'wide') {
    invariant(
      metrics.railCollapsed.shell.width > metrics.headerCollapsed.shell.width + 100,
      'wide_rail_collapse_did_not_expand_shell',
    );
    invariant(
      nearlyEqual(metrics.headerCollapsed.shell.top, metrics.railCollapsed.shell.top),
      'wide_rail_shell_top_shifted',
    );
    invariant(
      nearlyEqual(metrics.headerCollapsed.shell.right, metrics.railCollapsed.shell.right),
      'wide_rail_shell_right_shifted',
    );
    invariant(
      nearlyEqual(metrics.headerCollapsed.shell.bottom, metrics.railCollapsed.shell.bottom),
      'wide_rail_shell_bottom_shifted',
    );
  } else {
    invariant(
      metrics.railCollapsed.rail.height < metrics.headerCollapsed.rail.height - 20,
      'minimum_rail_collapse_did_not_reduce_height',
    );
    invariant(
      nearlyEqual(metrics.headerCollapsed.shell.left, metrics.railCollapsed.shell.left),
      'minimum_rail_shell_left_shifted',
    );
    invariant(
      nearlyEqual(metrics.headerCollapsed.shell.right, metrics.railCollapsed.shell.right),
      'minimum_rail_shell_right_shifted',
    );
    invariant(
      nearlyEqual(metrics.headerCollapsed.shell.bottom, metrics.railCollapsed.shell.bottom),
      'minimum_rail_shell_bottom_shifted',
    );
  }

  for (const [state, geometry] of [
    ['headerCollapsed', metrics.headerCollapsed],
    ['railCollapsed', metrics.railCollapsed],
  ] as const) {
    verifyViewportContainment(geometry, `${prefix}_${state}`);
    verifyContained(
      geometry.detailsToggle,
      geometry.toolbar,
      `${prefix}_${state}`,
      'details_toggle',
    );
    invariant(
      geometry.transcriptScrollHeight > geometry.transcriptClientHeight,
      `${prefix}_${state}_transcript_did_not_overflow`,
    );
    invariant(geometry.transcriptScrollTop > 0, `${prefix}_${state}_transcript_could_not_scroll`);
  }
}

async function measureScenario(window: BrowserWindow, scenario: Scenario) {
  await window.setSize(scenario.width, scenario.height);
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      fixtureMarkup(readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')),
    )}`,
  );

  return (await window.webContents.executeJavaScript(`
    (async () => {
      const workspace = document.querySelector('.project-chat-workspace');
      const rail = document.querySelector('.project-chat-session-rail');
      const shell = document.querySelector('.project-chat-shell');
      const toolbar = document.querySelector('.chat-toolbar');
      const summary = document.querySelector('.chat-toolbar-summary');
      const details = document.querySelector('.chat-toolbar-details');
      const providerBoundary = document.querySelector('.chat-provider-boundary');
      const compactIdentity = document.querySelector('.chat-toolbar-summary-identity');
      const badges = document.querySelector('.chat-toolbar-summary-badges');
      const projectName = document.querySelector('[data-project-name]');
      const detailsToggle = document.querySelector('#fixture-chat-details-toggle');
      const transcript = document.querySelector('.chat-transcript');
      const composer = document.querySelector('.chat-compose-area');
      const elements = [workspace, rail, shell, toolbar, summary, details, compactIdentity, badges, providerBoundary, projectName, detailsToggle, transcript, composer];
      if (elements.some((element) => !(element instanceof HTMLElement))) {
        throw new Error('missing_project_chat_geometry_element');
      }

      let detailsCollapsed = false;
      const renderDetailsState = () => {
        shell.classList.toggle('chat-details-collapsed', detailsCollapsed);
        toolbar.classList.toggle('collapsed', detailsCollapsed);
        details.hidden = detailsCollapsed;
        summary.hidden = !detailsCollapsed;
        detailsToggle.textContent = detailsCollapsed ? 'Show details' : 'Minimize';
        detailsToggle.setAttribute('aria-expanded', String(!detailsCollapsed));
        detailsToggle.setAttribute('aria-label', detailsCollapsed ? 'Show chat details' : 'Hide chat details');
      };
      detailsToggle.addEventListener('click', () => {
        detailsCollapsed = !detailsCollapsed;
        renderDetailsState();
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
        transcript.scrollTop = transcript.scrollHeight;
        const projectNameStyle = getComputedStyle(projectName);
        const messageMetaRows = [...document.querySelectorAll('.chat-message-meta')];
        const messageActionGroups = [...document.querySelectorAll('.chat-message-branch')];
        return {
          workspace: rect(workspace),
          rail: rect(rail),
          shell: rect(shell),
          toolbar: rect(toolbar),
          toolbarDetails: rect(details),
          toolbarSummary: rect(summary),
          compactIdentity: rect(compactIdentity),
          badges: rect(badges),
          providerBoundary: rect(providerBoundary),
          detailsToggle: rect(detailsToggle),
          transcript: rect(transcript),
          composer: rect(composer),
          projectNameClientWidth: projectName.clientWidth,
          projectNameScrollWidth: projectName.scrollWidth,
          projectNameOverflow: projectNameStyle.overflow,
          projectNameTextOverflow: projectNameStyle.textOverflow,
          projectNameWhiteSpace: projectNameStyle.whiteSpace,
          transcriptClientHeight: transcript.clientHeight,
          transcriptScrollHeight: transcript.scrollHeight,
          transcriptScrollTop: transcript.scrollTop,
          messageMetaCount: messageMetaRows.length,
          messageMetaMaxHeight: Math.max(...messageMetaRows.map((element) => element.getBoundingClientRect().height)),
          messageMetaOverflowCount: messageMetaRows.filter((element) => element.scrollWidth > element.clientWidth + 1).length,
          messageActionGroupMaxHeight: Math.max(...messageActionGroups.map((element) => element.getBoundingClientRect().height)),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      };

      await nextFrame();
      const expanded = read();

      detailsToggle.focus();
      detailsToggle.click();
      await nextFrame();
      const headerCollapsed = read();
      const collapseToggleFocused = document.activeElement === detailsToggle;

      detailsToggle.click();
      await nextFrame();
      const headerExpandedAgain = read();
      const expandToggleFocused = document.activeElement === detailsToggle;

      detailsToggle.click();
      await nextFrame();

      workspace.classList.add('session-rail-collapsed');
      rail.classList.add('collapsed');
      const railActions = rail.querySelector('.project-chat-session-actions');
      const railList = rail.querySelector('.project-chat-session-list');
      if (!(railActions instanceof HTMLElement) || !(railList instanceof HTMLElement)) {
        throw new Error('missing_project_chat_session_details');
      }
      railActions.hidden = true;
      railList.hidden = true;
      await nextFrame();
      const railCollapsed = read();

      return {
        expanded,
        headerCollapsed,
        headerExpandedAgain,
        railCollapsed,
        collapseToggleFocused,
        expandToggleFocused,
      };
    })()
  `)) as ScenarioMetrics;
}

async function run() {
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

  const scenarios: readonly Scenario[] = [
    { name: 'minimum', width: 1060, height: 700 },
    { name: 'wide', width: 1480, height: 930 },
  ];

  try {
    for (const scenario of scenarios) {
      verifyScenario(scenario, await measureScenario(window, scenario));
    }
    console.log('Project Chat compact chrome geometry smoke test passed');
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'project_chat_compact_smoke_failed');
    app.exit(1);
  });
