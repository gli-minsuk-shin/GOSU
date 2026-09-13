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
const storageKey = 'gosu.briefing-lab.fixture-workspace.v1';
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
async function field(window, label, value) {
  await window.webContents.executeJavaScript(`(() => {
    const wrapper = [...document.querySelectorAll('.briefing-field')].find(element => element.querySelector(':scope > span')?.textContent.trim() === ${JSON.stringify(label)});
    const input = wrapper?.querySelector('input, select');
    if (!input) throw new Error('briefing_field_missing:' + ${JSON.stringify(label)});
    const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
  await settle(window);
}
async function workspace(window) {
  return window.webContents.executeJavaScript(
    `JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}) || 'null')`,
  );
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
      fixture: document.querySelector('.briefing-fixture-banner')?.textContent,
      cards: document.querySelectorAll('.briefing-card').length,
      cardLabels: [...document.querySelectorAll('.briefing-card-date')].map(element => element.textContent),
    };
  })()`);
  invariant(
    metrics.rootOverflow <= 1 && metrics.panes.every((pane) => pane.horizontalOverflow <= 1),
    `briefing_horizontal_overflow:${label}:${JSON.stringify(metrics)}`,
  );
  invariant(
    metrics.fixture.includes('샘플 미리보기') &&
      metrics.fixture.includes('LLM') &&
      metrics.fixture.includes('샘플 화면은 실제 자료를 조회하지'),
    `briefing_fixture_boundary_missing:${label}`,
  );
  invariant(
    metrics.cardLabels.every((value) => value.includes('샘플')),
    `briefing_unlabelled_fixture_cards:${label}`,
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
async function checkIndependentScroll(window) {
  const selectors = [
    '.briefing-main-scroll',
    '.briefing-sidebar-scroll',
    '.briefing-details-scroll',
  ];
  for (const target of selectors) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const selectors = ${JSON.stringify(selectors)};
      selectors.forEach(selector => { document.querySelector(selector).scrollTop = 0; });
      const target = document.querySelector(${JSON.stringify(target)});
      const max = target.scrollHeight - target.clientHeight;
      target.scrollTop = Math.min(150, max);
      return { max, target: target.scrollTop, others: selectors.filter(selector => selector !== ${JSON.stringify(target)}).map(selector => document.querySelector(selector).scrollTop), document: scrollY };
    })()`);
    invariant(
      state.max > 0 &&
        state.target > 0 &&
        state.others.every((value) => value === 0) &&
        state.document === 0,
      `briefing_scroll_not_independent:${target}:${JSON.stringify(state)}`,
    );
  }
  await window.webContents.executeJavaScript(
    `for (const selector of ${JSON.stringify(selectors)}) document.querySelector(selector).scrollTop = 0;`,
  );
  await settle(window);
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
    if (details.level === 'error' || details.message.includes('Content Security Policy')) {
      errors.push(details.message);
      process.stderr.write(`${details.message}\n`);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  try {
    await window.loadFile(entry);
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      const poll = () => {
        if (document.querySelectorAll('.briefing-routine-button').length === 2) return resolve(true);
        if (performance.now() > deadline) return reject(new Error('briefing_fixture_did_not_render'));
        requestAnimationFrame(poll);
      }; poll();
    })`);
    invariant(cspApplied, 'briefing_csp_not_applied');
    invariant(
      ((await workspace(window))?.runs?.length ?? 0) === 0,
      'briefing_open_started_automatic_run',
    );
    await capture(window, 'initial-1360');
    await click(window, '.briefing-tabs button', '루틴 설정');
    await field(window, '전달 시각', '07:45, 18:15');
    await field(window, '반복 간격', '2');
    await window.webContents.executeJavaScript(`(() => {
      const weather = [...document.querySelectorAll('.briefing-source-options label')].find(node => node.textContent.includes('날씨'));
      weather.querySelector('input').click();
    })()`);
    await click(window, '[aria-label="최신 논문 섹션 위로"]');
    await click(window, '.briefing-settings-footer .briefing-primary', '설정 저장');
    let saved = await workspace(window);
    invariant(
      saved.routines.find((item) => item.kind === 'personal').schedule.times.join(',') ===
        '07:45,18:15',
      'briefing_personal_schedule_not_saved',
    );
    invariant(
      saved.routines.find((item) => item.kind === 'funding').schedule.times.join(',') === '09:00',
      'briefing_personal_save_changed_funding',
    );
    invariant(saved.runs.length === 0, 'briefing_save_started_automatic_run');
    invariant(
      saved.routines[0].sectionOrder.slice(0, 3).join(',') === 'weather,papers,email',
      'briefing_section_order_not_saved',
    );
    await capture(window, 'settings-1360');
    await click(window, '.briefing-main-header .briefing-primary');
    saved = await workspace(window);
    invariant(
      saved.runs.length === 1 && saved.runs[0].mode === 'fixture',
      'briefing_manual_personal_run_missing',
    );
    invariant(
      saved.runs[0].items.every(
        (item) =>
          item.evidence.readScope === 'fixture' &&
          item.evidence.kind !== 'funding' &&
          (item.evidence.kind !== 'todo' || item.evidence.deadline),
      ),
      'briefing_fixture_evidence_boundary_invalid',
    );
    await capture(window, 'personal-1360');
    const groupMetrics = await window.webContents.executeJavaScript(`({
      order: [...document.querySelectorAll('.briefing-content-section')].map(node => node.dataset.sectionKind),
      collapsed: [...document.querySelectorAll('.briefing-content-section')].every(node => !node.open),
      tiles: document.querySelectorAll('.briefing-section-tile').length,
    })`);
    invariant(
      groupMetrics.order.join(',') === 'weather,papers,email,todo,calendar' &&
        groupMetrics.collapsed &&
        groupMetrics.tiles === 5,
      'briefing_grouped_overview_incorrect',
    );
    await click(window, '[aria-label="최신 논문 3건 보기"]');
    invariant(
      await window.webContents.executeJavaScript(
        `document.querySelector('.briefing-content-section.papers').open`,
      ),
      'briefing_section_jump_did_not_expand',
    );
    await capture(window, 'papers-expanded-1360');
    await click(window, '.briefing-section-controls button', '모두 접기');
    await capture(window, 'grouped-overview-1360');
    invariant(
      await window.webContents.executeJavaScript(`(() => {
      const groups = [...document.querySelectorAll('.briefing-content-section')];
      return groups.at(-1).getBoundingClientRect().bottom <= document.querySelector('.briefing-main-scroll').getBoundingClientRect().bottom + 1;
    })()`),
      'briefing_summary_groups_do_not_fit_overview',
    );
    await click(window, '.briefing-tabs button', '루틴 설정');
    await window.webContents.executeJavaScript(
      `document.querySelector('.briefing-section-order').closest('section').scrollIntoView({block:'start'})`,
    );
    await capture(window, 'section-order-1360');
    await click(window, '.briefing-tabs button:first-child');
    await keyboardResize(window, 'left', 'Right');
    await keyboardResize(window, 'right', 'Left');
    await capture(window, 'resized-1360');
    // Repeated manual samples create enough local-only history to exercise all three scroll panes.
    for (let index = 0; index < 11; index++)
      await click(window, '.briefing-main-header .briefing-primary');
    await click(window, '.briefing-section-controls button', '모두 펼치기');
    window.setContentSize(1360, 600);
    await settle(window);
    await checkIndependentScroll(window);
    window.setContentSize(1360, 900);
    await settle(window);
    await collapse(window, 'left', true);
    await capture(window, 'left-collapsed-1360');
    await collapse(window, 'right', true);
    await capture(window, 'both-collapsed-1360');
    await collapse(window, 'left', false);
    await collapse(window, 'right', false);
    await click(window, '.briefing-routine-button strong', '연구과제 브리핑');
    await click(window, '.briefing-tabs button', '루틴 설정');
    await field(window, '반복 주기', 'monthly');
    await field(window, '매월 날짜', '31');
    await field(window, '전달 시각', '10:30');
    await click(window, '.briefing-add-site > summary');
    await field(window, '사이트 이름', 'QA 사용자 등록 공고');
    await field(window, '사이트 국가', 'US');
    const manualUrl = `https://funding.example.org/calls/${'neural-networks-optimization-'.repeat(8)}`;
    await field(window, '공고 페이지 HTTPS 주소', manualUrl);
    await click(window, '.briefing-add-site button', '사이트를 초안에 추가');
    await click(window, '.briefing-settings-footer .briefing-primary', '설정 저장');
    saved = await workspace(window);
    const funding = saved.routines.find((item) => item.kind === 'funding');
    invariant(
      funding.schedule.frequency === 'monthly' &&
        funding.schedule.monthDay === 31 &&
        funding.schedule.times[0] === '10:30',
      'briefing_funding_schedule_not_saved',
    );
    invariant(
      funding.sources.some((source) => source.origin === 'user' && source.url === manualUrl),
      'briefing_manual_url_not_saved',
    );
    invariant(
      saved.routines.find((item) => item.kind === 'personal').schedule.times.join(',') ===
        '07:45,18:15',
      'briefing_funding_save_changed_personal',
    );
    await click(window, '.briefing-main-header .briefing-primary');
    saved = await workspace(window);
    const fundingRun = saved.runs.at(-1);
    invariant(
      fundingRun.routineId === funding.id && fundingRun.status === 'partial',
      'briefing_unsupported_source_not_partial',
    );
    invariant(
      fundingRun.items.every((item) => item.evidence.kind === 'funding') &&
        fundingRun.sourceResults.some(
          (source) =>
            source.label === 'QA 사용자 등록 공고' &&
            source.status === 'unsupported' &&
            source.count === 0,
        ),
      'briefing_manual_source_fabricated_results',
    );
    await capture(window, 'funding-1360');
    const expectedRuns = saved.runs.length;
    await new Promise((resolve) => {
      window.webContents.once('did-finish-load', resolve);
      window.reload();
    });
    await settle(window);
    invariant(
      (await workspace(window)).runs.length === expectedRuns,
      'briefing_reload_started_or_lost_runs',
    );
    for (const width of [900, 600, 400]) {
      window.setContentSize(width, 900);
      await collapse(window, 'right', true);
      await collapse(window, 'left', width < 760);
      await capture(window, `funding-${width}`);
      await click(window, '.briefing-tabs button', '루틴 설정');
      await capture(window, `settings-${width}`);
      await collapse(window, 'right', false);
      await capture(window, `details-open-${width}`);
      await collapse(window, 'right', true);
      if (width < 760) {
        await collapse(window, 'left', false);
        await capture(window, `routines-open-${width}`);
        await collapse(window, 'left', true);
      }
      await click(window, '.briefing-tabs button:first-child');
    }
    window.setContentSize(1360, 900);
    await collapse(window, 'left', false);
    await collapse(window, 'right', false);
    await click(window, '.briefing-tabs button', '루틴 설정');
    // Confirmation is stubbed only inside this isolated fixture window, never the real app.
    await window.webContents.executeJavaScript('window.confirm = () => true; void 0;');
    await click(window, '.briefing-settings-footer .danger', '루틴 삭제');
    const archivedWorkspace = await workspace(window);
    invariant(
      archivedWorkspace.routines.length === 1 &&
        archivedWorkspace.runs.length === expectedRuns &&
        archivedWorkspace.runs.some((item) => item.id === fundingRun.id),
      'briefing_delete_lost_history',
    );
    await click(window, '.briefing-archive-button');
    const archivedMetrics = await window.webContents.executeJavaScript(`({
      heading: document.querySelector('.briefing-main-header h1').textContent,
      metadata: document.querySelector('.briefing-archive-metadata').textContent,
      runButton: Boolean(document.querySelector('.briefing-main-header .briefing-primary')),
      settingsTabs: Boolean(document.querySelector('.briefing-tabs')),
      hideButtons: document.querySelectorAll('.briefing-card button').length,
      cards: document.querySelectorAll('.briefing-card').length,
    })`);
    invariant(
      archivedMetrics.heading === fundingRun.routineName &&
        archivedMetrics.metadata.includes('읽기 전용') &&
        archivedMetrics.metadata.includes('10:30') &&
        !archivedMetrics.metadata.includes('07:45') &&
        !archivedMetrics.runButton &&
        !archivedMetrics.settingsTabs &&
        archivedMetrics.hideButtons === 0 &&
        archivedMetrics.cards === fundingRun.items.length,
      `briefing_archive_not_readonly_or_snapshot_scoped:${JSON.stringify(archivedMetrics)}`,
    );
    await capture(window, 'archive-readonly-1360');
    await click(window, '.briefing-sidebar footer button', 'AI로 새 루틴');
    await capture(window, 'routine-ai-1360');
    window.setContentSize(400, 900);
    await collapse(window, 'left', true);
    await capture(window, 'routine-ai-400');
    invariant(
      externalRequests.length === 0 && permissions.length === 0 && errors.length === 0,
      `briefing_unexpected_runtime_activity:${JSON.stringify({ externalRequests, permissions, errors })}`,
    );
    process.stdout.write(
      `Briefing Lab visual smoke passed: ${results.length} screenshots; independent schedules, manual-only samples, reload, sidebar resize/collapse, independent scroll, 0 overflow, 0 external requests, 0 permission requests, 0 renderer/CSP errors.\n${JSON.stringify(results)}\n`,
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
