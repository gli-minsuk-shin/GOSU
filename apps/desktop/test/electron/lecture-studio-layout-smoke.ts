import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import {
  createTrustedRenderer,
  rendererContentSecurityPolicy,
} from '../../src/main/renderer-trust';

type RectMetrics = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}>;

type ArtifactActionMetrics = Readonly<{
  bar: RectMetrics;
  scrollWidth: number;
  clientWidth: number;
  buttons: readonly Readonly<{
    rect: RectMetrics;
    label: string;
    title: string;
    text: string;
    svgCount: number;
  }>[];
}>;

type LayoutMetrics = Readonly<{
  initial: RectMetrics;
  leftCollapsed: RectMetrics;
  bothCollapsed: RectMetrics;
  restored: RectMetrics;
  initialScrollTop: number;
  leftCollapsedScrollTop: number;
  bothCollapsedScrollTop: number;
  restoredScrollTop: number;
  initialCounter: string;
  restoredCounter: string;
  previewIdentityPreserved: boolean;
  restoredLeftCollapsed: boolean;
  restoredChatCollapsed: boolean;
  leftToggleWidth: number;
  chatToggleWidth: number;
  artifactActions: ArtifactActionMetrics;
  contentScrollWidth: number;
  contentClientWidth: number;
  narrow: Readonly<{
    content: RectMetrics;
    layout: RectMetrics;
    preview: RectMetrics;
    sessionDrawer: RectMetrics;
    chatDrawer: RectMetrics;
    hideSessions: RectMetrics;
    hideAssistant: RectMetrics;
    showSessions: RectMetrics;
    showAssistant: RectMetrics;
    chatPosition: string;
    sessionPosition: string;
    contentScrollWidth: number;
    contentClientWidth: number;
    previewIdentityPreserved: boolean;
    pageCounter: string;
    artifactActions: ArtifactActionMetrics;
  }>;
  securityViolations: readonly string[];
  windowErrors: readonly string[];
}>;

const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 900;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function nearlyEqual(left: number, right: number, tolerance = 1.5) {
  return Math.abs(left - right) <= tolerance;
}

async function exerciseLayout(window: BrowserWindow) {
  return (await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = performance.now() + 20000;
      const waitFor = (read, failure) => new Promise((resolveWait, rejectWait) => {
        const poll = () => {
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
      const settle = () => new Promise((resolveSettle) =>
        setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolveSettle)), 240)
      );
      const pageCounter = () =>
        document.querySelector('.pdf-preview-page-counter')?.textContent?.trim() || '';
      const artifactActions = () => {
        const bar = document.querySelector('.lecture-artifact-actions');
        if (!(bar instanceof HTMLElement)) {
          throw new Error('lecture_studio_artifact_actions_missing');
        }
        const buttons = [...bar.querySelectorAll('[data-lecture-artifact-action]')];
        if (!buttons.every((button) => button instanceof HTMLButtonElement)) {
          throw new Error('lecture_studio_artifact_action_button_invalid');
        }
        return {
          bar: rect(bar),
          scrollWidth: bar.scrollWidth,
          clientWidth: bar.clientWidth,
          buttons: buttons.map((button) => ({
            rect: rect(button),
            label: button.getAttribute('aria-label') || '',
            title: button.getAttribute('title') || '',
            text: button.textContent?.trim() || '',
            svgCount: button.querySelectorAll('svg[aria-hidden="true"]').length,
          })),
        };
      };
      void (async () => {
        await waitFor(
          () => document.querySelector('.lecture-preview') &&
            document.querySelector('[aria-label="Hide lecture sessions"]') &&
            document.querySelector('[aria-label="Hide lecture assistant"]'),
          'lecture_studio_layout_fixture_did_not_render',
        );
        const notesPdf = [...document.querySelectorAll('[role="tab"]')].find(
          (tab) => tab.textContent?.trim() === 'Notes PDF'
        );
        if (!(notesPdf instanceof HTMLButtonElement)) {
          throw new Error('lecture_studio_notes_pdf_tab_missing');
        }
        notesPdf.click();
        await waitFor(
          () => document.querySelector('.pdf-preview-page[data-page-number="2"] canvas'),
          'lecture_studio_pdf_preview_did_not_render',
        );
        const preview = document.querySelector('.lecture-preview');
        const scroll = document.querySelector('.pdf-preview-scroll');
        const pageTwo = document.querySelector('.pdf-preview-page[data-page-number="2"]');
        const content = document.querySelector('.desktop-content-lecture');
        if (!(preview instanceof HTMLElement) || !(scroll instanceof HTMLElement) ||
            !(pageTwo instanceof HTMLElement) || !(content instanceof HTMLElement)) {
          throw new Error('lecture_studio_layout_geometry_missing');
        }
        preview.dataset.layoutSmokeIdentity = 'preserve-me';
        const scrollRect = scroll.getBoundingClientRect();
        const pageRect = pageTwo.getBoundingClientRect();
        scroll.scrollTo({
          top: Math.max(0, scroll.scrollTop + pageRect.top - scrollRect.top - 16),
          behavior: 'auto',
        });
        await waitFor(() => pageCounter() === '2 / 3', 'lecture_studio_pdf_page_two_not_active');
        const initial = rect(preview);
        const initialArtifactActions = artifactActions();
        const initialScrollTop = scroll.scrollTop;
        const initialCounter = pageCounter();

        const hideSessions = document.querySelector('[aria-label="Hide lecture sessions"]');
        if (!(hideSessions instanceof HTMLButtonElement)) {
          throw new Error('lecture_studio_hide_sessions_missing');
        }
        hideSessions.click();
        await waitFor(
          () => document.querySelector('.lecture-studio-layout.studio-rail-collapsed'),
          'lecture_studio_sessions_did_not_collapse',
        );
        await settle();
        const leftCollapsed = rect(preview);
        const leftCollapsedScrollTop = scroll.scrollTop;

        const hideAssistant = document.querySelector('[aria-label="Hide lecture assistant"]');
        if (!(hideAssistant instanceof HTMLButtonElement)) {
          throw new Error('lecture_studio_hide_assistant_missing');
        }
        hideAssistant.click();
        await waitFor(
          () => document.querySelector('.lecture-studio-layout.studio-rail-collapsed.chat-collapsed'),
          'lecture_studio_assistant_did_not_collapse',
        );
        await settle();
        const bothCollapsed = rect(preview);
        const bothCollapsedScrollTop = scroll.scrollTop;

        const showSessions = document.querySelector('[aria-label="Show lecture sessions"]');
        const showAssistant = document.querySelector('[aria-label="Show lecture assistant"]');
        if (!(showSessions instanceof HTMLButtonElement) ||
            !(showAssistant instanceof HTMLButtonElement)) {
          throw new Error('lecture_studio_restore_controls_missing');
        }
        const leftToggleWidth = showSessions.getBoundingClientRect().width;
        const chatToggleWidth = showAssistant.getBoundingClientRect().width;
        showSessions.click();
        await waitFor(
          () => {
            const layout = document.querySelector('.lecture-studio-layout');
            return layout && !layout.classList.contains('studio-rail-collapsed') &&
              layout.classList.contains('chat-collapsed');
          },
          'lecture_studio_sessions_did_not_restore',
        );
        const currentShowAssistant = document.querySelector(
          '[aria-label="Show lecture assistant"]'
        );
        if (!(currentShowAssistant instanceof HTMLButtonElement)) {
          throw new Error('lecture_studio_current_restore_assistant_missing');
        }
        currentShowAssistant.click();
        await waitFor(
          () => {
            const layout = document.querySelector('.lecture-studio-layout');
            return layout && !layout.classList.contains('studio-rail-collapsed') &&
              !layout.classList.contains('chat-collapsed');
          },
          'lecture_studio_panels_did_not_restore',
        );
        await settle();
        const currentPreview = document.querySelector('.lecture-preview');
        const restored = rect(currentPreview);
        const restoredLeftCollapsed = Boolean(
          document.querySelector('.lecture-studio-layout.studio-rail-collapsed'),
        );
        const restoredChatCollapsed = Boolean(
          document.querySelector('.lecture-studio-layout.chat-collapsed'),
        );

        content.style.width = '720px';
        content.style.maxWidth = '720px';
        await settle();
        const narrowLayout = document.querySelector('.lecture-studio-layout');
        const narrowPreview = document.querySelector('.lecture-preview');
        const sessionDrawer = document.querySelector('.lecture-studio-rail:not(.collapsed)');
        const chatDrawer = document.querySelector('.lecture-chat:not(.collapsed)');
        const narrowHideSessions = document.querySelector(
          '[aria-label="Hide lecture sessions"]'
        );
        const narrowHideAssistant = document.querySelector(
          '[aria-label="Hide lecture assistant"]'
        );
        if (!(narrowLayout instanceof HTMLElement) ||
            !(narrowPreview instanceof HTMLElement) ||
            !(sessionDrawer instanceof HTMLElement) ||
            !(chatDrawer instanceof HTMLElement) ||
            !(narrowHideSessions instanceof HTMLButtonElement) ||
            !(narrowHideAssistant instanceof HTMLButtonElement)) {
          throw new Error('lecture_studio_narrow_drawer_geometry_missing');
        }
        const narrowContentRect = rect(content);
        const narrowLayoutRect = rect(narrowLayout);
        const narrowPreviewRect = rect(narrowPreview);
        const sessionDrawerRect = rect(sessionDrawer);
        const chatDrawerRect = rect(chatDrawer);
        const narrowHideSessionsRect = rect(narrowHideSessions);
        const narrowHideAssistantRect = rect(narrowHideAssistant);
        const chatPosition = getComputedStyle(chatDrawer).position;
        const sessionPosition = getComputedStyle(sessionDrawer).position;
        const narrowArtifactActions = artifactActions();

        narrowHideAssistant.click();
        await waitFor(
          () => document.querySelector('.lecture-studio-layout.chat-collapsed'),
          'lecture_studio_narrow_chat_did_not_collapse',
        );
        await settle();
        const narrowShowAssistant = document.querySelector(
          '[aria-label="Show lecture assistant"]'
        );
        if (!(narrowShowAssistant instanceof HTMLButtonElement)) {
          throw new Error('lecture_studio_narrow_show_assistant_missing');
        }
        const narrowShowAssistantRect = rect(narrowShowAssistant);

        narrowHideSessions.click();
        await waitFor(
          () => document.querySelector('.lecture-studio-layout.studio-rail-collapsed'),
          'lecture_studio_narrow_sessions_did_not_collapse',
        );
        await settle();
        const narrowShowSessions = document.querySelector(
          '[aria-label="Show lecture sessions"]'
        );
        if (!(narrowShowSessions instanceof HTMLButtonElement)) {
          throw new Error('lecture_studio_narrow_show_sessions_missing');
        }
        const narrowShowSessionsRect = rect(narrowShowSessions);
        resolve({
          initial,
          leftCollapsed,
          bothCollapsed,
          restored,
          initialScrollTop,
          leftCollapsedScrollTop,
          bothCollapsedScrollTop,
          restoredScrollTop: scroll.scrollTop,
          initialCounter,
          restoredCounter: pageCounter(),
          previewIdentityPreserved:
            currentPreview === preview && currentPreview?.dataset.layoutSmokeIdentity === 'preserve-me',
          restoredLeftCollapsed,
          restoredChatCollapsed,
          leftToggleWidth,
          chatToggleWidth,
          artifactActions: initialArtifactActions,
          contentScrollWidth: content.scrollWidth,
          contentClientWidth: content.clientWidth,
          narrow: {
            content: narrowContentRect,
            layout: narrowLayoutRect,
            preview: narrowPreviewRect,
            sessionDrawer: sessionDrawerRect,
            chatDrawer: chatDrawerRect,
            hideSessions: narrowHideSessionsRect,
            hideAssistant: narrowHideAssistantRect,
            showSessions: narrowShowSessionsRect,
            showAssistant: narrowShowAssistantRect,
            chatPosition,
            sessionPosition,
            contentScrollWidth: content.scrollWidth,
            contentClientWidth: content.clientWidth,
            previewIdentityPreserved:
              narrowPreview === preview &&
              narrowPreview.dataset.layoutSmokeIdentity === 'preserve-me',
            pageCounter: pageCounter(),
            artifactActions: narrowArtifactActions,
          },
          securityViolations: [...(window.__gosuLectureStudioLayoutSmoke?.securityViolations ?? [])],
          windowErrors: [...(window.__gosuLectureStudioLayoutSmoke?.windowErrors ?? [])],
        });
      })().catch(reject);
    })
  `)) as LayoutMetrics;
}

async function run() {
  const rendererRoot = resolve(process.cwd(), 'out/lecture-studio-layout-smoke/renderer');
  const rendererEntry = resolve(rendererRoot, 'lecture-studio-layout-smoke.html');
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
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') consoleIssues.push(details.message);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    renderProcessFailure = `${details.reason}:${details.exitCode}`;
  });

  try {
    await window.loadURL(trustedRenderer.entryUrl);
    await window.webContents.executeJavaScript(`
      window.__gosuLectureStudioLayoutSmoke = { securityViolations: [], windowErrors: [] };
      window.addEventListener('securitypolicyviolation', (event) => {
        window.__gosuLectureStudioLayoutSmoke.securityViolations.push(
          event.violatedDirective + ':' + event.blockedURI
        );
      });
      window.addEventListener('error', (event) => {
        window.__gosuLectureStudioLayoutSmoke.windowErrors.push(
          event.message || 'renderer_window_error'
        );
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__gosuLectureStudioLayoutSmoke.windowErrors.push(String(event.reason));
      });
    `);
    const metrics = await exerciseLayout(window);
    const rendererRootUrl = pathToFileURL(`${rendererRoot}${sep}`).href;

    invariant(entryCspApplied, 'lecture_studio_layout_production_csp_not_applied');
    invariant(
      trustedRenderer.entryUrl.startsWith(rendererRootUrl),
      'lecture_studio_layout_renderer_not_loaded_from_bundle',
    );
    invariant(metrics.initial.width >= 420, 'lecture_studio_initial_preview_too_narrow');
    invariant(
      metrics.leftCollapsed.width > metrics.initial.width + 100,
      'lecture_studio_preview_did_not_expand_after_session_collapse',
    );
    invariant(
      metrics.bothCollapsed.width > metrics.leftCollapsed.width + 200,
      'lecture_studio_preview_did_not_expand_after_chat_collapse',
    );
    invariant(
      nearlyEqual(metrics.initial.top, metrics.leftCollapsed.top),
      'lecture_studio_top_shifted_left',
    );
    invariant(
      nearlyEqual(metrics.initial.top, metrics.bothCollapsed.top),
      'lecture_studio_top_shifted_both',
    );
    invariant(
      nearlyEqual(metrics.initial.top, metrics.restored.top),
      'lecture_studio_top_shifted_restore',
    );
    invariant(
      nearlyEqual(metrics.initial.left, metrics.restored.left),
      'lecture_studio_left_not_restored',
    );
    invariant(
      nearlyEqual(metrics.initial.width, metrics.restored.width),
      'lecture_studio_width_not_restored',
    );
    invariant(
      nearlyEqual(metrics.initial.height, metrics.restored.height),
      'lecture_studio_height_not_restored',
    );
    invariant(metrics.previewIdentityPreserved, 'lecture_studio_preview_was_remounted');
    invariant(metrics.initialCounter === '2 / 3', 'lecture_studio_initial_pdf_page_not_two');
    invariant(metrics.restoredCounter === '2 / 3', 'lecture_studio_pdf_page_changed_during_resize');
    for (const [label, scrollTop] of [
      ['left', metrics.leftCollapsedScrollTop],
      ['both', metrics.bothCollapsedScrollTop],
      ['restored', metrics.restoredScrollTop],
    ] as const) {
      invariant(
        Math.abs(scrollTop - metrics.initialScrollTop) <= 30,
        `lecture_studio_pdf_scroll_changed_${label}:${metrics.initialScrollTop}:${scrollTop}`,
      );
    }
    invariant(
      !metrics.restoredLeftCollapsed && !metrics.restoredChatCollapsed,
      'lecture_studio_panels_remained_collapsed',
    );
    invariant(metrics.leftToggleWidth >= 34, 'lecture_studio_left_toggle_too_small');
    invariant(metrics.chatToggleWidth >= 34, 'lecture_studio_chat_toggle_too_small');
    for (const [layout, actions] of [
      ['wide', metrics.artifactActions],
      ['narrow', metrics.narrow.artifactActions],
    ] as const) {
      invariant(actions.buttons.length === 3, `lecture_studio_${layout}_artifact_action_count`);
      invariant(
        actions.scrollWidth <= actions.clientWidth + 1,
        `lecture_studio_${layout}_artifact_actions_overflowed`,
      );
      const expectedLabels = ['Export PDF', 'Open PDF in default app', 'Show PDF in Finder'];
      for (const [index, button] of actions.buttons.entries()) {
        invariant(
          button.label === expectedLabels[index],
          `lecture_studio_${layout}_artifact_action_label:${index}:${button.label}`,
        );
        invariant(
          button.title === button.label,
          `lecture_studio_${layout}_artifact_action_tooltip:${index}`,
        );
        invariant(
          button.text === '',
          `lecture_studio_${layout}_artifact_action_visible_text:${index}:${button.text}`,
        );
        invariant(button.svgCount === 1, `lecture_studio_${layout}_artifact_action_icon:${index}`);
        invariant(
          button.rect.width >= 34 && button.rect.width <= 44 && button.rect.height >= 34,
          `lecture_studio_${layout}_artifact_action_size:${index}`,
        );
        invariant(
          button.rect.left >= actions.bar.left - 1 && button.rect.right <= actions.bar.right + 1,
          `lecture_studio_${layout}_artifact_action_clipped:${index}`,
        );
      }
      const buttonTops = actions.buttons.map(({ rect: buttonRect }) => buttonRect.top);
      invariant(
        Math.max(...buttonTops) - Math.min(...buttonTops) <= 1.5,
        `lecture_studio_${layout}_artifact_actions_wrapped`,
      );
    }
    invariant(
      metrics.contentScrollWidth <= metrics.contentClientWidth + 1,
      'lecture_studio_layout_overflowed_horizontally',
    );
    invariant(
      metrics.narrow.content.width >= 619 && metrics.narrow.content.width <= 721,
      `lecture_studio_narrow_content_width_wrong:${metrics.narrow.content.width}`,
    );
    invariant(
      metrics.narrow.contentScrollWidth <= metrics.narrow.contentClientWidth + 1,
      `lecture_studio_narrow_content_overflowed:${metrics.narrow.contentScrollWidth}:${metrics.narrow.contentClientWidth}`,
    );
    invariant(
      metrics.narrow.chatPosition === 'absolute',
      `lecture_studio_narrow_chat_not_drawer:${metrics.narrow.chatPosition}`,
    );
    invariant(
      metrics.narrow.sessionPosition === 'absolute',
      `lecture_studio_narrow_sessions_not_drawer:${metrics.narrow.sessionPosition}`,
    );
    invariant(
      nearlyEqual(metrics.narrow.chatDrawer.top, metrics.narrow.layout.top) &&
        nearlyEqual(metrics.narrow.chatDrawer.bottom, metrics.narrow.layout.bottom),
      'lecture_studio_narrow_chat_not_full_height_overlay',
    );
    invariant(
      metrics.narrow.chatDrawer.left < metrics.narrow.preview.right &&
        metrics.narrow.chatDrawer.right <= metrics.narrow.layout.right + 1,
      'lecture_studio_narrow_chat_did_not_overlay_preview',
    );
    invariant(
      metrics.narrow.sessionDrawer.left >= metrics.narrow.layout.left - 1 &&
        metrics.narrow.sessionDrawer.right > metrics.narrow.preview.left,
      'lecture_studio_narrow_sessions_did_not_overlay_preview',
    );
    for (const [label, control] of [
      ['hide-sessions', metrics.narrow.hideSessions],
      ['hide-assistant', metrics.narrow.hideAssistant],
      ['show-sessions', metrics.narrow.showSessions],
      ['show-assistant', metrics.narrow.showAssistant],
    ] as const) {
      invariant(
        control.left >= metrics.narrow.content.left - 1 &&
          control.right <= metrics.narrow.content.right + 1 &&
          control.top >= metrics.narrow.content.top - 1 &&
          control.bottom <= metrics.narrow.content.bottom + 1,
        `lecture_studio_narrow_control_inaccessible:${label}`,
      );
      invariant(
        control.width >= 34 && control.height >= 34,
        `lecture_studio_narrow_control_too_small:${label}`,
      );
    }
    invariant(
      metrics.narrow.previewIdentityPreserved,
      'lecture_studio_narrow_preview_was_remounted',
    );
    invariant(
      metrics.narrow.pageCounter === '2 / 3',
      `lecture_studio_narrow_pdf_page_changed:${metrics.narrow.pageCounter}`,
    );
    invariant(metrics.securityViolations.length === 0, 'lecture_studio_layout_csp_violation');
    invariant(metrics.windowErrors.length === 0, 'lecture_studio_layout_renderer_error');
    invariant(
      consoleIssues.length === 0,
      `lecture_studio_layout_console_error:${consoleIssues.join('|')}`,
    );
    invariant(
      renderProcessFailure === null,
      `lecture_studio_layout_process_gone:${renderProcessFailure}`,
    );
    console.log('Lecture Studio three-column collapse and preview-state smoke test passed');
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'lecture_studio_layout_smoke_failed');
    app.exit(1);
  });
