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

type ApprovalMetrics = Readonly<{
  viewportWidth: number;
  viewportHeight: number;
  backdrop: RectMetrics;
  dialog: RectMetrics;
  body: RectMetrics;
  footer: RectMetrics;
  deny: RectMetrics;
  allow: RectMetrics;
  backdropPosition: string;
  dialogRole: string | null;
  dialogModal: string | null;
  bodyOverflowY: string;
  bodyClientHeight: number;
  bodyScrollHeight: number;
  bodyScrollTop: number;
  commandClientHeight: number;
  commandScrollHeight: number;
  commandScrollTop: number;
  fileClientHeight: number;
  fileScrollHeight: number;
  fileScrollTop: number;
  footerPosition: string;
  footerTopBeforeScroll: number;
  footerTopAfterScroll: number;
  denyHit: boolean;
  allowHit: boolean;
  denyDisabled: boolean;
  allowDisabled: boolean;
  denyPointerEvents: string;
  allowPointerEvents: string;
  queueText: string;
  cardCount: number;
  resolutionCount: number;
  backgroundHitIsBackdrop: boolean;
  backgroundInert: boolean;
  safeDefaultFocused: boolean;
  focusTrapWrapped: boolean;
}>;

type QueueMetrics = Readonly<{
  queueText: string;
  serverText: string;
  cardCount: number;
  denyVisible: boolean;
  allowVisible: boolean;
  denyHit: boolean;
  allowHit: boolean;
  resolutionCount: number;
  resolutionLog: string;
}>;

type DismissedMetrics = Readonly<{
  dialogClosed: boolean;
  backgroundRestored: boolean;
  priorFocusRestored: boolean;
  resolutionCount: number;
  resolutionLog: string;
  escapePrevented: boolean;
}>;

const MINIMUM_WIDTH = 1060;
const MINIMUM_HEIGHT = 700;

type Scenario = Readonly<{
  name: 'minimum' | 'wide';
  width: number;
  height: number;
}>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function nearlyEqual(left: number, right: number, tolerance = 1.1) {
  return Math.abs(left - right) <= tolerance;
}

function containedInViewport(rect: RectMetrics, width: number, height: number) {
  return rect.top >= -1 && rect.left >= -1 && rect.right <= width + 1 && rect.bottom <= height + 1;
}

function containedBy(child: RectMetrics, parent: RectMetrics) {
  return (
    child.top >= parent.top - 1 &&
    child.left >= parent.left - 1 &&
    child.right <= parent.right + 1 &&
    child.bottom <= parent.bottom + 1
  );
}

async function waitForFixture(window: BrowserWindow) {
  await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      const poll = () => {
        if (document.querySelector('[data-smoke-ready="true"]') && document.querySelector('.ssh-approval-dialog')) {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
          return;
        }
        if (performance.now() >= deadline) {
          reject(new Error('ssh_approval_fixture_did_not_render'));
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    })
  `);
}

async function readInitialMetrics(window: BrowserWindow) {
  return (await window.webContents.executeJavaScript(`
    (async () => {
      const backdrop = document.querySelector('.ssh-approval-backdrop');
      const dialog = document.querySelector('.ssh-approval-dialog');
      const body = document.querySelector('.ssh-approval-dialog-body');
      const footer = document.querySelector('.ssh-approval-dialog-footer');
      const command = document.querySelector('[aria-label="Requested SSH operation"]');
      const file = document.querySelector('[aria-label="Exact approved SSH file content"]');
      const deny = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Deny');
      const allow = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Allow once');
      const queue = document.querySelector('.ssh-approval-queue-count');
      const resolution = document.querySelector('[data-resolution-count]');
      const shell = document.querySelector('.desktop-shell');
      if (!(backdrop instanceof HTMLElement) || !(dialog instanceof HTMLElement) ||
          !(body instanceof HTMLElement) || !(footer instanceof HTMLElement) ||
          !(command instanceof HTMLElement) || !(file instanceof HTMLElement) ||
          !(deny instanceof HTMLButtonElement) ||
          !(allow instanceof HTMLButtonElement) || !(queue instanceof HTMLElement) ||
          !(resolution instanceof HTMLElement) || !(shell instanceof HTMLElement)) {
        throw new Error('missing_ssh_approval_geometry_element');
      }
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height };
      };
      const hit = (button) => {
        const value = button.getBoundingClientRect();
        const target = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
        return target === button || button.contains(target);
      };
      const footerTopBeforeScroll = footer.getBoundingClientRect().top;
      body.scrollTop = body.scrollHeight;
      command.scrollTop = command.scrollHeight;
      file.scrollTop = file.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const footerTopAfterScroll = footer.getBoundingClientRect().top;
      const backdropStyle = getComputedStyle(backdrop);
      const bodyStyle = getComputedStyle(body);
      const footerStyle = getComputedStyle(footer);
      const denyStyle = getComputedStyle(deny);
      const allowStyle = getComputedStyle(allow);
      const backgroundTarget = document.elementFromPoint(3, Math.floor(window.innerHeight / 2));
      const safeDefaultFocused = document.activeElement === deny;
      deny.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      const reverseWrapped = document.activeElement === allow;
      allow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      const forwardWrapped = document.activeElement === deny;
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        backdrop: rect(backdrop),
        dialog: rect(dialog),
        body: rect(body),
        footer: rect(footer),
        deny: rect(deny),
        allow: rect(allow),
        backdropPosition: backdropStyle.position,
        dialogRole: dialog.getAttribute('role'),
        dialogModal: dialog.getAttribute('aria-modal'),
        bodyOverflowY: bodyStyle.overflowY,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        bodyScrollTop: body.scrollTop,
        commandClientHeight: command.clientHeight,
        commandScrollHeight: command.scrollHeight,
        commandScrollTop: command.scrollTop,
        fileClientHeight: file.clientHeight,
        fileScrollHeight: file.scrollHeight,
        fileScrollTop: file.scrollTop,
        footerPosition: footerStyle.position,
        footerTopBeforeScroll,
        footerTopAfterScroll,
        denyHit: hit(deny),
        allowHit: hit(allow),
        denyDisabled: deny.disabled,
        allowDisabled: allow.disabled,
        denyPointerEvents: denyStyle.pointerEvents,
        allowPointerEvents: allowStyle.pointerEvents,
        queueText: queue.textContent?.trim() ?? '',
        cardCount: dialog.querySelectorAll('.ssh-approval-card').length,
        resolutionCount: Number(resolution.dataset.resolutionCount ?? '-1'),
        backgroundHitIsBackdrop: backgroundTarget === backdrop,
        backgroundInert: shell.inert && shell.getAttribute('aria-hidden') === 'true',
        safeDefaultFocused,
        focusTrapWrapped: reverseWrapped && forwardWrapped,
      };
    })()
  `)) as ApprovalMetrics;
}

async function resolveVisibleRequest(window: BrowserWindow, label: 'Deny' | 'Allow once') {
  return (await window.webContents.executeJavaScript(`
    (async () => {
      const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
      if (!(button instanceof HTMLButtonElement)) throw new Error('missing_ssh_approval_action');
      const before = Number(document.querySelector('[data-resolution-count]')?.getAttribute('data-resolution-count') ?? '-1');
      button.click();
      const deadline = performance.now() + 2000;
      while (Number(document.querySelector('[data-resolution-count]')?.getAttribute('data-resolution-count') ?? '-1') === before) {
        if (performance.now() >= deadline) throw new Error('ssh_approval_action_did_not_resolve');
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const dialog = document.querySelector('.ssh-approval-dialog');
      const queue = document.querySelector('.ssh-approval-queue-count');
      const server = document.querySelector('.ssh-approval-card > div:first-child > strong');
      const deny = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Deny');
      const allow = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Allow once');
      const resolution = document.querySelector('[data-resolution-count]');
      if (!(dialog instanceof HTMLElement) || !(queue instanceof HTMLElement) ||
          !(server instanceof HTMLElement) || !(deny instanceof HTMLButtonElement) ||
          !(allow instanceof HTMLButtonElement) || !(resolution instanceof HTMLElement)) {
        throw new Error('queued_ssh_approval_actions_missing');
      }
      const visibleAndHit = (candidate) => {
        const rect = candidate.getBoundingClientRect();
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return rect.width > 0 && rect.height > 0 && (target === candidate || candidate.contains(target));
      };
      return {
        queueText: queue.textContent?.trim() ?? '',
        serverText: server.textContent?.trim() ?? '',
        cardCount: dialog.querySelectorAll('.ssh-approval-card').length,
        denyVisible: deny.getBoundingClientRect().width > 0 && deny.getBoundingClientRect().height > 0,
        allowVisible: allow.getBoundingClientRect().width > 0 && allow.getBoundingClientRect().height > 0,
        denyHit: visibleAndHit(deny),
        allowHit: visibleAndHit(allow),
        resolutionCount: Number(resolution.dataset.resolutionCount ?? '-1'),
        resolutionLog: resolution.dataset.resolutionLog ?? '',
      };
    })()
  `)) as QueueMetrics;
}

async function dismissFinalRequestWithEscape(window: BrowserWindow) {
  return (await window.webContents.executeJavaScript(`
    (async () => {
      const dialog = document.querySelector('.ssh-approval-dialog');
      if (!(dialog instanceof HTMLElement)) throw new Error('missing_final_ssh_approval_dialog');
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      const escapePrevented = !dialog.dispatchEvent(escape);
      const deadline = performance.now() + 2000;
      while (document.querySelector('.ssh-approval-dialog')) {
        if (performance.now() >= deadline) throw new Error('final_ssh_approval_did_not_close');
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const shell = document.querySelector('.desktop-shell');
      const send = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Send');
      const resolution = document.querySelector('[data-resolution-count]');
      if (!(shell instanceof HTMLElement) || !(send instanceof HTMLButtonElement) ||
          !(resolution instanceof HTMLElement)) {
        throw new Error('missing_dismissed_ssh_approval_state');
      }
      return {
        dialogClosed: document.querySelector('.ssh-approval-dialog') === null,
        backgroundRestored: !shell.inert && shell.getAttribute('aria-hidden') === null,
        priorFocusRestored: document.activeElement === send,
        resolutionCount: Number(resolution.dataset.resolutionCount ?? '-1'),
        resolutionLog: resolution.dataset.resolutionLog ?? '',
        escapePrevented,
      };
    })()
  `)) as DismissedMetrics;
}

function verifyInitial(metrics: ApprovalMetrics, scenario: Scenario) {
  const prefix = `ssh_approval_${scenario.name}`;
  invariant(metrics.viewportWidth === scenario.width, `${prefix}_viewport_width_changed`);
  invariant(
    metrics.viewportHeight > 0 && metrics.viewportHeight <= scenario.height,
    `${prefix}_invalid_viewport_height`,
  );
  invariant(metrics.backdropPosition === 'fixed', 'ssh_approval_backdrop_not_fixed');
  invariant(nearlyEqual(metrics.backdrop.top, 0), 'ssh_approval_backdrop_missed_top');
  invariant(nearlyEqual(metrics.backdrop.left, 0), 'ssh_approval_backdrop_missed_left');
  invariant(
    nearlyEqual(metrics.backdrop.right, metrics.viewportWidth),
    'ssh_approval_backdrop_missed_right',
  );
  invariant(
    nearlyEqual(metrics.backdrop.bottom, metrics.viewportHeight),
    'ssh_approval_backdrop_missed_bottom',
  );
  invariant(metrics.backgroundHitIsBackdrop, 'ssh_approval_backdrop_does_not_cover_background');
  invariant(metrics.backgroundInert, 'ssh_approval_background_not_inert');
  invariant(metrics.dialogRole === 'alertdialog', 'ssh_approval_dialog_role_missing');
  invariant(metrics.dialogModal === 'true', 'ssh_approval_dialog_modal_semantics_missing');
  invariant(
    containedInViewport(metrics.dialog, metrics.viewportWidth, metrics.viewportHeight),
    `${prefix}_dialog_escaped_viewport`,
  );
  invariant(
    nearlyEqual(metrics.dialog.left + metrics.dialog.width / 2, metrics.viewportWidth / 2, 1.5),
    `${prefix}_dialog_not_horizontally_centered`,
  );
  invariant(
    nearlyEqual(metrics.dialog.top + metrics.dialog.height / 2, metrics.viewportHeight / 2, 1.5),
    `${prefix}_dialog_not_vertically_centered`,
  );
  invariant(containedBy(metrics.body, metrics.dialog), 'ssh_approval_body_escaped_dialog');
  invariant(containedBy(metrics.footer, metrics.dialog), 'ssh_approval_footer_escaped_dialog');
  invariant(
    containedInViewport(metrics.deny, metrics.viewportWidth, metrics.viewportHeight),
    'ssh_approval_deny_escaped_viewport',
  );
  invariant(
    containedInViewport(metrics.allow, metrics.viewportWidth, metrics.viewportHeight),
    'ssh_approval_allow_escaped_viewport',
  );
  invariant(containedBy(metrics.deny, metrics.footer), 'ssh_approval_deny_escaped_footer');
  invariant(containedBy(metrics.allow, metrics.footer), 'ssh_approval_allow_escaped_footer');
  invariant(metrics.footerPosition === 'sticky', 'ssh_approval_footer_not_sticky');
  invariant(
    nearlyEqual(metrics.footerTopBeforeScroll, metrics.footerTopAfterScroll),
    'ssh_approval_footer_moved_with_body_scroll',
  );
  invariant(metrics.bodyOverflowY === 'auto', 'ssh_approval_body_scroll_not_enabled');
  invariant(
    metrics.bodyScrollHeight > metrics.bodyClientHeight,
    'ssh_approval_long_body_did_not_overflow',
  );
  invariant(metrics.bodyScrollTop > 0, 'ssh_approval_body_could_not_scroll');
  invariant(
    metrics.commandScrollHeight > metrics.commandClientHeight,
    'ssh_approval_long_command_did_not_overflow',
  );
  invariant(metrics.commandScrollTop > 0, 'ssh_approval_long_command_could_not_scroll');
  invariant(
    metrics.fileScrollHeight > metrics.fileClientHeight,
    `${prefix}_long_file_content_did_not_overflow`,
  );
  invariant(metrics.fileScrollTop > 0, `${prefix}_long_file_content_could_not_scroll`);
  invariant(metrics.denyHit && metrics.allowHit, 'ssh_approval_action_is_occluded');
  invariant(!metrics.denyDisabled && !metrics.allowDisabled, 'ssh_approval_action_is_disabled');
  invariant(
    metrics.denyPointerEvents !== 'none' && metrics.allowPointerEvents !== 'none',
    'ssh_approval_action_rejects_pointer_input',
  );
  invariant(
    metrics.queueText === 'Reviewing 1 of 3',
    'ssh_approval_initial_queue_semantics_missing',
  );
  invariant(metrics.cardCount === 1, 'ssh_approval_queue_rendered_multiple_cards');
  invariant(metrics.resolutionCount === 0, 'ssh_approval_resolved_without_user_action');
  invariant(metrics.safeDefaultFocused, `${prefix}_safe_deny_default_not_focused`);
  invariant(metrics.focusTrapWrapped, `${prefix}_keyboard_focus_escaped_dialog`);
}

function verifyQueue(
  metrics: QueueMetrics,
  expectedCount: number,
  expectedQueueText: string,
  expectedServer: string,
  expectedDecision: 'allow_once' | 'deny',
) {
  invariant(metrics.queueText === expectedQueueText, 'ssh_approval_queue_count_did_not_advance');
  invariant(metrics.serverText === expectedServer, 'ssh_approval_queue_order_changed');
  invariant(metrics.cardCount === 1, 'ssh_approval_queue_hid_actions_with_multiple_cards');
  invariant(metrics.denyVisible && metrics.allowVisible, 'ssh_approval_queued_actions_not_visible');
  invariant(metrics.denyHit && metrics.allowHit, 'ssh_approval_queued_actions_not_clickable');
  invariant(metrics.resolutionCount === expectedCount, 'ssh_approval_resolution_count_mismatch');
  const log = JSON.parse(metrics.resolutionLog) as Array<{ decision?: string }>;
  invariant(log.at(-1)?.decision === expectedDecision, 'ssh_approval_resolution_decision_mismatch');
}

async function run() {
  const window = new BrowserWindow({
    show: false,
    width: MINIMUM_WIDTH,
    height: MINIMUM_HEIGHT,
    minWidth: MINIMUM_WIDTH,
    minHeight: MINIMUM_HEIGHT,
    backgroundColor: '#080a09',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const scenarios: readonly Scenario[] = [
    { name: 'minimum', width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT },
    { name: 'wide', width: 1480, height: 930 },
  ];

  try {
    for (const scenario of scenarios) {
      window.setSize(scenario.width, scenario.height);
      await window.loadFile(
        resolve(
          process.cwd(),
          'out/ssh-approval-dialog-smoke/renderer/ssh-approval-dialog-smoke.html',
        ),
      );
      await waitForFixture(window);
      verifyInitial(await readInitialMetrics(window), scenario);

      if (scenario.name === 'minimum') {
        const afterAllow = await resolveVisibleRequest(window, 'Allow once');
        verifyQueue(afterAllow, 1, 'Reviewing 1 of 2', 'Fixture GPU server 2', 'allow_once');

        const afterDeny = await resolveVisibleRequest(window, 'Deny');
        verifyQueue(afterDeny, 2, '1 pending', 'Fixture GPU server 3', 'deny');

        const dismissed = await dismissFinalRequestWithEscape(window);
        invariant(dismissed.dialogClosed, 'ssh_approval_final_dialog_stayed_open');
        invariant(dismissed.backgroundRestored, 'ssh_approval_background_not_restored');
        invariant(dismissed.priorFocusRestored, 'ssh_approval_prior_focus_not_restored');
        invariant(dismissed.escapePrevented, 'ssh_approval_escape_was_not_captured');
        invariant(dismissed.resolutionCount === 3, 'ssh_approval_escape_resolution_missing');
        const resolutionLog = JSON.parse(dismissed.resolutionLog) as Array<{
          decision?: string;
        }>;
        invariant(resolutionLog.at(-1)?.decision === 'deny', 'ssh_approval_escape_did_not_deny');
      }
    }

    console.log('SSH approval dialog viewport and action visibility smoke test passed');
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'ssh_approval_dialog_smoke_failed');
    app.exit(1);
  });
