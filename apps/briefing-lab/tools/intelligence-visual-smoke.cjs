/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Electron visual harness. */
const { app, BrowserWindow, session } = require('electron');
const { mkdtempSync } = require('node:fs');
const { mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const temporary = mkdtempSync(resolve(tmpdir(), 'briefing-intelligence-visual-'));
app.setPath('userData', temporary);
app.setPath('sessionData', temporary);
app.on('window-all-closed', () => undefined);
async function run() {
  const entry = resolve(
    __dirname,
    '../../../tmp/briefing-intelligence/visual-build/intelligence-visual.html',
  );
  const directory = resolve(__dirname, '../../../tmp/screenshots');
  await mkdir(directory, { recursive: true });
  const browserSession = session.fromPartition('briefing-intelligence-isolated');
  const external = [],
    errors = [];
  browserSession.webRequest.onBeforeRequest((details, cb) => {
    const blocked = !/^(file:|data:)/.test(details.url);
    if (blocked) external.push(details.url);
    cb({ cancel: blocked });
  });
  browserSession.setPermissionRequestHandler((_web, _permission, cb) => cb(false));
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1050,
    useContentSize: true,
    webPreferences: {
      session: browserSession,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const result = [];
  for (const mode of ['public', 'weather', 'mail'])
    for (const width of [1000, 420]) {
      window.setContentSize(width, mode === 'weather' ? 1120 : 1050);
      await window.loadFile(entry, { query: { mode } });
      await window.webContents.executeJavaScript('document.fonts.ready');
      await window.webContents.executeJavaScript(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
      );
      const metrics = await window.webContents.executeJavaScript(
        `({overflow:document.documentElement.scrollWidth-innerWidth, cards:document.querySelectorAll('.briefing-weather-card,.briefing-mail-connection').length, badCards:[...document.querySelectorAll('.briefing-weather-card,.briefing-insight-card,.briefing-mail-connection')].filter(e=>e.scrollWidth>e.clientWidth+1).length, math:document.querySelectorAll('.katex').length, figures:document.querySelectorAll('.briefing-paper-figure img').length})`,
      );
      if (metrics.overflow > 1 || metrics.badCards || !metrics.cards)
        throw new Error(JSON.stringify(metrics));
      const path = resolve(directory, `briefing-intelligence-${mode}-${width}.png`);
      await writeFile(path, (await window.webContents.capturePage()).toPNG());
      result.push({ path, ...metrics });
      if (mode === 'public' && width === 1000) {
        await window.webContents.executeJavaScript(
          `document.querySelector('.briefing-paper-figure')?.scrollIntoView({block:'center'});`,
        );
        const detail = resolve(directory, 'briefing-intelligence-paper-figure.png');
        await writeFile(detail, (await window.webContents.capturePage()).toPNG());
        result.push({ path: detail });
      }
    }
  if (external.length || errors.length) throw new Error(JSON.stringify({ external, errors }));
  window.destroy();
  console.log(
    JSON.stringify({ passed: true, screenshots: result, externalRequests: 0, rendererErrors: 0 }),
  );
}
app
  .whenReady()
  .then(run)
  .then(async () => {
    await rm(temporary, { recursive: true, force: true });
    app.quit();
  })
  .catch(async (e) => {
    console.error(e);
    await rm(temporary, { recursive: true, force: true });
    app.exit(1);
  });
