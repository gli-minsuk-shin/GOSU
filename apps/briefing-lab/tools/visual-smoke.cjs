/* eslint-disable @typescript-eslint/no-require-imports -- This unbundled Electron main entry intentionally uses CommonJS to load Electron's builtin module. */
const { mkdtempSync } = require('node:fs');
const { mkdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');

// This runner uses only its own disposable file-origin fixture storage, never GOSU data.
const temporaryUserData = mkdtempSync(resolve(tmpdir(), 'gosu-briefing-visual-'));
app.setPath('userData', temporaryUserData);
app.setPath('sessionData', temporaryUserData);
app.on('window-all-closed', () => undefined);
const entry = resolve(__dirname, '../dist/index.html');
const screenshotDirectory = resolve(__dirname, '../../../tmp/screenshots');

const results = [];

function invariant(value, message) {
  if (!value) throw new Error(message);
}
async function settle(window) {
  await window.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}
async function click(window, selector, text) {
  await window.webContents.executeJavaScript(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = ${text === undefined ? 'candidates[0]' : `candidates.find(element => element.textContent.trim() === ${JSON.stringify(text)})`};
    if (!target || target.disabled) throw new Error('briefing_click_target_missing:' + ${JSON.stringify(selector + (text ? `:${text}` : ''))});
    target.click();
  })()`);
  await settle(window);
}
async function checkLayout(window, label) {
  const metrics = await window.webContents.executeJavaScript(`(() => {
    const selectors = ['.briefing-app', '.briefing-workspace', '.briefing-main', '.briefing-main-scroll', '.briefing-sidebar', '.briefing-sidebar-scroll', '.briefing-details', '.briefing-details-scroll'];
    return {
      width: innerWidth,
      rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panes: selectors.flatMap(selector => {
        const element = document.querySelector(selector);
        return element ? [{ selector, width: element.getBoundingClientRect().width, horizontalOverflow: element.scrollWidth - element.clientWidth }] : [];
      }),
      cards: document.querySelectorAll('.briefing-card').length,
    };
  })()`);
  invariant(
    metrics.rootOverflow <= 1 && metrics.panes.every((pane) => pane.horizontalOverflow <= 1),
    `briefing_horizontal_overflow:${label}:${JSON.stringify(metrics)}`,
  );
  return metrics;
}
async function capture(window, label) {
  await settle(window);
  await mkdir(screenshotDirectory, { recursive: true });
  const screenshotPath = resolve(screenshotDirectory, `briefing-lab-${label}.png`);
  await writeFile(screenshotPath, (await window.webContents.capturePage()).toPNG());
  const metrics = await checkLayout(window, label);
  results.push({ label, screenshotPath, metrics });
}
async function collapse(window, side, collapsed) {
  const isCollapsed = await window.webContents.executeJavaScript(
    `document.querySelector('.briefing-workspace').classList.contains('${side}-collapsed')`,
  );
  if (isCollapsed !== collapsed)
    await click(
      window,
      side === 'left' ? '.briefing-sidebar > header button' : '.briefing-details > header button',
    );
}
async function keyboardResize(window, side, key) {
  const selector = `.briefing-splitter.${side}`;
  const before = await window.webContents.executeJavaScript(
    `Number(document.querySelector('${selector}').getAttribute('aria-valuenow'))`,
  );
  await window.webContents.executeJavaScript(`document.querySelector('${selector}').focus()`);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
  await settle(window);
  const after = await window.webContents.executeJavaScript(
    `Number(document.querySelector('${selector}').getAttribute('aria-valuenow'))`,
  );
  invariant(after === before + 16, `briefing_keyboard_resize_failed:${side}:${before}:${after}`);
}

async function run() {
  const browserSession = session.fromPartition(`gosu-briefing-visual-${Date.now()}`);
  const externalRequests = [];
  const errors = [];
  const permissions = [];
  let cspApplied = false;
  const entryUrl = pathToFileURL(entry).href;
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    const external = !details.url.startsWith('file:');
    if (external) externalRequests.push(details.url);
    callback({ cancel: external });
  });
  browserSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url === entryUrl) cspApplied = true;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    });
  });
  browserSession.setPermissionRequestHandler((_contents, permission, callback) => {
    permissions.push(permission);
    callback(false);
  });
  const window = new BrowserWindow({
    show: false,
    width: 1360,
    height: 900,
    useContentSize: true,
    webPreferences: {
      session: browserSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('console-message', (details) => {
    // The app polls its own backend at /api/briefing-agent/session. There is no backend behind a
    // file: origin, and this harness sets connect-src 'none' on purpose, so the refusal is the
    // harness working rather than the app misbehaving: the URL is same-origin `file:`, nothing
    // leaves the machine, and `externalRequests` stays the assertion that would catch it if it did.
    // Narrow on purpose -- every other console error, including any other CSP violation, is fatal.
    // Chromium reports the one refusal twice, with different wording, so both are matched.
    const ownSessionPoll =
      details.message.includes('/api/briefing-agent/session') &&
      (details.message.includes('connect-src') || details.message.includes('Refused to connect'));
    if (
      !ownSessionPoll &&
      (details.level === 'error' || details.message.includes('Content Security Policy'))
    ) {
      errors.push(details.message);
      process.stderr.write(`${details.message}\n`);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  try {
    await window.loadFile(entry);
    // The sidebar's fixed navigation is what tells us the app mounted. It used to wait for two
    // `.briefing-routine-button` rows; that sidebar was redesigned away, the class survives only as
    // dead CSS, and this gate timed out on every run -- so not one assertion below had executed.
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      const poll = () => {
        if (document.querySelectorAll('.briefing-sidebar-primary-button').length >= 3) return resolve(true);
        if (performance.now() > deadline) return reject(new Error('briefing_app_did_not_render'));
        requestAnimationFrame(poll);
      }; poll();
    })`);
    invariant(cspApplied, 'briefing_csp_not_applied');
    // "Opening starts no work" is asserted at the end, by zero external requests and zero
    // unexpected console errors. It used to be asserted by reading saved runs out of localStorage,
    // which proved nothing: the smoke read the legacy fixture key, the app writes `workspace.v2`,
    // and opening the app writes nothing at all -- so `null?.runs?.length ?? 0 === 0` always held.
    await capture(window, 'initial-1360');

    // The splitter is keyboard-operable and moves by exactly one step. The right pane starts
    // collapsed and a collapsed pane renders a spacer instead of a splitter, so it is opened first.
    await keyboardResize(window, 'left', 'Right');
    await collapse(window, 'right', false);
    await keyboardResize(window, 'right', 'Left');
    await capture(window, 'resized-1360');

    await collapse(window, 'left', true);
    await capture(window, 'left-collapsed-1360');
    await collapse(window, 'right', true);
    await capture(window, 'both-collapsed-1360');
    await collapse(window, 'left', false);
    await collapse(window, 'right', false);

    // 논문 요약 with its conversation open: the one screen where a pane holds a composer. A panel
    // that is in the tree but below the fold is the failure this cannot see any other way -- it is
    // how a chat input ended up under the viewport once already.
    await window.webContents.executeJavaScript(`(() => {
      const target = [...document.querySelectorAll('.briefing-sidebar-primary-button')]
        .find((b) => b.textContent.includes('논문 요약'));
      if (!target || target.disabled) throw new Error('briefing_papers_tab_missing');
      target.click();
    })()`);
    await settle(window);
    await capture(window, 'papers-1360');
    const composer = await window.webContents.executeJavaScript(`(() => {
      const box = document.querySelector('.briefing-details-scroll .briefing-chat-input-box')
        ?? document.querySelector('.briefing-chat-input-box');
      if (!box) return null;
      const rect = box.getBoundingClientRect();
      return { bottom: Math.round(rect.bottom), viewport: window.innerHeight, scrollY };
    })()`);
    // Asserted, not guarded: a conditional here would go quietly vacuous the day the composer
    // stops rendering, which is the same silence that let this whole file rot.
    invariant(composer !== null, 'briefing_composer_missing');
    invariant(
      composer.scrollY === 0 && composer.bottom <= composer.viewport + 1,
      `briefing_composer_below_fold:${JSON.stringify(composer)}`,
    );

    // A reload must not start work, and the policy must still be in force afterwards.
    cspApplied = false;
    await new Promise((resolve) => {
      window.webContents.once('did-finish-load', resolve);
      window.reload();
    });
    await settle(window);
    invariant(cspApplied, 'briefing_csp_not_applied_after_reload');
    // Same for the reload: what matters is that nothing was requested, which the final check covers.

    // Narrow windows: the layout check runs at each width, so a pane that overflows is caught.
    for (const width of [900, 600, 400]) {
      window.setContentSize(width, 900);
      await collapse(window, 'right', true);
      await collapse(window, 'left', width < 760);
      await capture(window, `papers-${width}`);
      await collapse(window, 'right', false);
      await capture(window, `details-open-${width}`);
      await collapse(window, 'right', true);
      if (width < 760) {
        await collapse(window, 'left', false);
        await capture(window, `sidebar-open-${width}`);
        await collapse(window, 'left', true);
      }
    }
    window.setContentSize(1360, 900);
    await collapse(window, 'left', false);
    await collapse(window, 'right', false);

    invariant(
      externalRequests.length === 0 && permissions.length === 0 && errors.length === 0,
      `briefing_unexpected_runtime_activity:${JSON.stringify({ externalRequests, permissions, errors })}`,
    );
    process.stdout.write(
      `Briefing Lab visual smoke passed: ${results.length} screenshots; CSP applied before and after reload, no run on open or reload, composer above the fold, 0 overflow at 1360/900/600/400, 0 external requests, 0 permission requests, 0 renderer/CSP errors.\n${JSON.stringify(results)}\n`,
    );
  } finally {
    window.destroy();
    await browserSession.clearStorageData();
  }
}

app
  .whenReady()
  .then(run)
  .then(async () => {
    await rm(temporaryUserData, { recursive: true, force: true });
    app.quit();
  })
  .catch(async (error) => {
    console.error(error);
    await rm(temporaryUserData, { recursive: true, force: true });
    app.exit(1);
  });
