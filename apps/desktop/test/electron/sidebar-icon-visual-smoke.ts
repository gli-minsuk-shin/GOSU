import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import {
  createTrustedRenderer,
  rendererContentSecurityPolicy,
} from '../../src/main/renderer-trust';

type IconMetrics = Readonly<{
  icons: readonly Readonly<{
    name: string;
    width: number;
    height: number;
    slotWidth: number;
    slotHeight: number;
    alignmentError: number;
    strokeWidth: string;
    strokeLinecap: string;
    strokeLinejoin: string;
    fill: string;
    stroke: string;
    slotColor: string;
    decorative: boolean;
  }>[];
  sidebarWidth: number;
  overflow: number;
  projectCount: number;
  hasFolderGlyph: boolean;
  projectTitlesAligned: boolean;
  groupIconsAligned: boolean;
  busyIndicatorPresent: boolean;
}>;

const EXPECTED_ICONS = [
  'assistant',
  'search',
  'notifications',
  'calendar',
  'tasks',
  'briefing-lab',
  'chat',
  'model-lab',
  'repository',
  'manuscript',
  'review',
  'board',
  'objective',
  'experiments',
  'literature',
  'notes',
  'lecture',
  'connections',
  'usage',
  'settings',
];

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function nextFrame(window: BrowserWindow) {
  await window.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}

async function click(window: BrowserWindow, selector: string) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) throw new Error('missing_control:' + ${JSON.stringify(selector)});
    element.click();
  })()`);
  await nextFrame(window);
}

async function readMetrics(window: BrowserWindow): Promise<IconMetrics> {
  return window.webContents.executeJavaScript(`(() => {
    const nav = document.querySelector('.sidebar-icon-visual-nav');
    const icons = [...nav.querySelectorAll('.sidebar-nav-icon-graphic')].map(icon => {
      const slot = icon.parentElement;
      const row = icon.closest('button');
      const rect = icon.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const style = getComputedStyle(icon);
      return {
        name: icon.dataset.sidebarIcon,
        width: rect.width, height: rect.height,
        slotWidth: slotRect.width, slotHeight: slotRect.height,
        alignmentError: Math.max(
          Math.abs(rect.top + rect.height / 2 - rowRect.top - rowRect.height / 2),
          Math.abs(rect.left + rect.width / 2 - slotRect.left - slotRect.width / 2)
        ),
        strokeWidth: style.strokeWidth, strokeLinecap: style.strokeLinecap,
        strokeLinejoin: style.strokeLinejoin, fill: style.fill, stroke: style.stroke,
        slotColor: getComputedStyle(slot).color,
        decorative: icon.getAttribute('aria-hidden') === 'true' &&
          icon.getAttribute('focusable') === 'false' &&
          icon.getAttribute('viewBox') === '0 0 24 24',
      };
    });
    const titles = [...nav.querySelectorAll('.project-folder-button strong')];
    const groups = [...nav.querySelectorAll('.project-folder-children, .project-global-navigation')];
    return {
      icons,
      sidebarWidth: nav.getBoundingClientRect().width,
      overflow: nav.scrollWidth - nav.clientWidth,
      projectCount: titles.length,
      hasFolderGlyph: Boolean(nav.querySelector('.project-folder-icon')) || /[▰▱]/u.test(nav.textContent),
      projectTitlesAligned: titles.every(title => Math.abs(
        title.getBoundingClientRect().left - titles[0].getBoundingClientRect().left
      ) <= 0.5),
      groupIconsAligned: groups.every(group => {
        const slots = [...group.querySelectorAll('.sidebar-nav-icon')];
        return slots.every(slot => Math.abs(
          slot.getBoundingClientRect().left - slots[0].getBoundingClientRect().left
        ) <= 0.5);
      }),
      busyIndicatorPresent: Boolean(nav.querySelector('.project-running-indicator')),
    };
  })()`);
}

async function checkNavigation(window: BrowserWindow) {
  const fm = '[aria-label="FM-LM sections"]';
  for (const name of EXPECTED_ICONS.filter(
    (name) => name !== 'review' && name !== 'notifications' && name !== 'assistant',
  )) {
    const parent = ['tasks', 'calendar', 'briefing-lab'].includes(name)
      ? '.project-personal-tools'
      : name === 'search'
        ? '.project-quick-actions'
        : [
              'chat',
              'model-lab',
              'repository',
              'manuscript',
              'board',
              'objective',
              'experiments',
              'literature',
              'notes',
            ].includes(name)
          ? fm
          : '.project-global-navigation';
    await click(window, `${parent} button:has([data-sidebar-icon="${name}"])`);
    const active = await window.webContents.executeJavaScript(
      'document.querySelector("output").dataset.activeTab',
    );
    invariant(active === name, `sidebar_navigation_failed:${name}`);
    const markedActive = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(`${parent} button[aria-current="page"]:has([data-sidebar-icon="${name}"])`)}))`,
    );
    invariant(markedActive, `sidebar_active_state_missing:${name}`);
  }

  await click(window, '.project-folder-button[title="Better GBDT"]');
  invariant(
    await window.webContents.executeJavaScript(
      'Boolean(document.querySelector(\'[aria-label="Better GBDT sections"]\'))',
    ),
    'better_gbdt_disclosure_did_not_expand',
  );
  await click(
    window,
    '[aria-label="Better GBDT sections"] button:has([data-sidebar-icon="model-lab"])',
  );
  invariant(
    await window.webContents.executeJavaScript(
      'document.querySelector("output").dataset.activeProject === "22222222-2222-4222-8222-222222222222"',
    ),
    'better_gbdt_model_lab_did_not_select_project',
  );
  await click(window, '.project-folder-button[title="Better GBDT"]');
  invariant(
    await window.webContents.executeJavaScript(
      '!document.querySelector(\'[aria-label="Better GBDT sections"]\')',
    ),
    'better_gbdt_disclosure_did_not_collapse',
  );
  await click(window, '.project-folder-button[title="FM-LM"]');
  invariant(
    await window.webContents.executeJavaScript(
      '!document.querySelector(\'[aria-label="FM-LM sections"]\')',
    ),
    'fm_lm_disclosure_did_not_collapse',
  );
  await click(window, '.project-folder-button[title="FM-LM"]');
  await click(window, `${fm} button:has([data-sidebar-icon="chat"])`);
  await click(window, 'summary[aria-label="Actions for FM-LM"]');
  invariant(
    await window.webContents.executeJavaScript(
      'document.querySelector(\'summary[aria-label="Actions for FM-LM"]\').parentElement.open',
    ),
    'project_actions_menu_did_not_open',
  );
  await click(window, 'summary[aria-label="Actions for FM-LM"]');
}

async function run() {
  const rendererRoot = resolve(process.cwd(), 'out/sidebar-icon-visual-smoke/renderer');
  const rendererEntry = resolve(rendererRoot, 'sidebar-icon-visual-smoke.html');
  const requestedPath = process.env.GOSU_SIDEBAR_SCREENSHOT?.trim()
    ? resolve(process.env.GOSU_SIDEBAR_SCREENSHOT)
    : resolve(process.cwd(), '../../tmp/screenshots/sidebar-icon-visual.png');
  const screenshotBase = requestedPath.slice(
    0,
    requestedPath.length - extname(requestedPath).length,
  );
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
  const window = new BrowserWindow({
    show: false,
    width: 1180,
    height: 1080,
    useContentSize: true,
    backgroundColor: '#f3f6f2',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const results: { theme: string; width: number; screenshotPath: string; metrics: IconMetrics }[] =
    [];
  try {
    await window.loadURL(trustedRenderer.entryUrl);
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      const poll = () => {
        if (document.querySelector('[data-sidebar-icon="settings"]')) return resolve(true);
        if (performance.now() > deadline) return reject(new Error('sidebar_icons_did_not_render'));
        requestAnimationFrame(poll);
      };
      poll();
    })`);
    invariant(entryCspApplied, 'sidebar_icon_visual_csp_not_applied');
    invariant(
      trustedRenderer.entryUrl.startsWith(pathToFileURL(`${rendererRoot}${sep}`).href),
      'sidebar_icon_visual_not_loaded_from_production_bundle',
    );
    await window.webContents.executeJavaScript(`
      window.__sidebarIconVisual = { violations: [], errors: [] };
      window.addEventListener('securitypolicyviolation', event => window.__sidebarIconVisual.violations.push(event.violatedDirective));
      window.addEventListener('error', event => window.__sidebarIconVisual.errors.push(event.message));
    `);

    for (const theme of ['light', 'dark']) {
      for (const width of [260, 332]) {
        await window.webContents.executeJavaScript(`
          document.documentElement.dataset.appearance = ${JSON.stringify(theme)};
          document.documentElement.style.setProperty('--visual-sidebar-width', '${width}px');
        `);
        await nextFrame(window);
        await checkNavigation(window);
        const metrics = await readMetrics(window);
        const sparkle = await window.webContents.executeJavaScript(`(() => {
          const path = document.querySelector('[data-assistant-sparkle]');
          const bounds = path.getBBox();
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
            fill: getComputedStyle(path).fill,
            slotColor: getComputedStyle(path.closest('.sidebar-nav-icon')).color };
        })()`);
        invariant(sparkle.width === 12 && sparkle.height === 12, 'assistant_sparkle_too_small');
        const bubble = await window.webContents.executeJavaScript(`(() => {
          const path = document.querySelector('[data-assistant-bubble]');
          const bounds = path.getBBox();
          const glyph = path.closest('svg').getBoundingClientRect();
          const button = path.closest('button').getBoundingClientRect();
          return { width: bounds.width, height: bounds.height,
            fitsButton: glyph.left - 2 >= button.left && glyph.top - 2 >= button.top && glyph.right + 2 <= button.right && glyph.bottom + 2 <= button.bottom };
        })()`);
        invariant(bubble.width === 20 && bubble.height === 18, 'assistant_chat_bubble_was_shrunk');
        invariant(bubble.fitsButton, 'assistant_badge_halo_outside_button');
        invariant(
          sparkle.x >= 0 &&
            sparkle.y >= 0 &&
            sparkle.x + sparkle.width < 24 &&
            sparkle.y + sparkle.height < 24,
          'assistant_sparkle_clipped',
        );
        invariant(sparkle.fill !== sparkle.slotColor, 'assistant_sparkle_lacks_accent');
        invariant(
          JSON.stringify(metrics.icons.map((icon) => icon.name)) === JSON.stringify(EXPECTED_ICONS),
          'sidebar_icon_coverage_mismatch',
        );
        invariant(metrics.sidebarWidth === width, 'sidebar_fixture_width_wrong');
        invariant(metrics.overflow <= 1, 'sidebar_horizontal_overflow');
        invariant(
          metrics.projectCount === 6 && !metrics.hasFolderGlyph,
          'project_titles_have_decorative_icons',
        );
        invariant(
          metrics.projectTitlesAligned && metrics.groupIconsAligned,
          'sidebar_rows_not_aligned',
        );
        invariant(metrics.busyIndicatorPresent, 'project_busy_indicator_lost');
        for (const icon of metrics.icons) {
          invariant(
            icon.width === 18 &&
              icon.height === 18 &&
              icon.slotWidth === 22 &&
              icon.slotHeight === 22,
            `icon_size_wrong:${icon.name}`,
          );
          invariant(icon.alignmentError <= 0.5, `icon_not_centered:${icon.name}`);
          invariant(
            icon.strokeWidth === '1.7px' &&
              icon.strokeLinecap === 'round' &&
              icon.strokeLinejoin === 'round' &&
              icon.fill === 'none',
            `icon_style_wrong:${icon.name}`,
          );
          invariant(
            icon.stroke === icon.slotColor,
            `icon_does_not_inherit_slot_color:${icon.name}`,
          );
          invariant(icon.decorative, `icon_accessibility_wrong:${icon.name}`);
        }
        const screenshotPath = `${screenshotBase}-${theme}-${width}.png`;
        await click(window, 'button[aria-label="Calendar"]');
        await click(window, 'button[aria-label="To-do list"]');
        await click(window, 'button[aria-label="이전 세션으로 돌아가기"]');
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('output').dataset.activeTab === 'calendar'`,
          ),
          'session_back_failed',
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('button[aria-label="Briefing Lab"][aria-expanded="false"]')?.click()`,
        );
        await nextFrame(window);
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelectorAll('.briefing-subnavigation button').length === 3`,
          ),
          'briefing_children_missing',
        );
        await click(window, '.project-quick-action[aria-label="AI 비서"]');
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('output').dataset.activeTab === 'briefing-lab' && document.querySelector('.project-quick-action[aria-label="AI 비서"]').classList.contains('active') && document.querySelector('[data-assistant-sparkle]') !== null`,
          ),
          'assistant_sparkle_navigation_failed',
        );
        await mkdir(dirname(screenshotPath), { recursive: true });
        await writeFile(screenshotPath, (await window.webContents.capturePage()).toPNG());
        const assistantButtonRect = await window.webContents.executeJavaScript(`(() => {
          const r = document.querySelector('[data-sidebar-icon="assistant"]').closest('button').getBoundingClientRect();
          return { x: Math.floor(r.x) - 4, y: Math.floor(r.y) - 4, width: Math.ceil(r.width) + 8, height: Math.ceil(r.height) + 8 };
        })()`);
        await writeFile(
          `${screenshotBase}-assistant-${theme}-${width}.png`,
          (await window.webContents.capturePage(assistantButtonRect)).toPNG(),
        );
        results.push({ theme, width, screenshotPath, metrics });
      }
    }
    const errors = await window.webContents.executeJavaScript('window.__sidebarIconVisual');
    invariant(
      errors.violations.length === 0 && errors.errors.length === 0,
      'sidebar_visual_renderer_or_csp_error',
    );
    process.stdout.write(
      `Sidebar icon visual smoke passed: ${results.length}/4 variants\n${JSON.stringify(results)}\n`,
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
    console.error(error instanceof Error ? error.message : 'sidebar_icon_visual_smoke_failed');
    app.exit(1);
  });
