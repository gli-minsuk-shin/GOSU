/* eslint-disable @typescript-eslint/no-require-imports -- Isolated native File bridge regression. */
const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync } = require('node:fs');
const { writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createServer } = require('node:http');
const dir = mkdtempSync(join(tmpdir(), 'gosu-native-drop-test-'));
app.setPath('userData', dir);
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  let window, server;
  try {
    const file = join(dir, 'fixture.txt'),
      preload = join(dir, 'preload.cjs');
    await writeFile(file, 'Synthetic attachment only');
    await writeFile(
      preload,
      `const {contextBridge,ipcRenderer,webUtils}=require('electron');contextBridge.exposeInMainWorld('dropTest',{receive(files){ipcRenderer.send('native-drop-result',{path:webUtils.getPathForFile(files[0]),isFile:files[0] instanceof File})}});`,
    );
    server = createServer((_req, res) =>
      res.end(
        `<script>addEventListener('message',e=>parent.postMessage({files:e.data.files},'*'))</script>`,
      ),
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = join(dir, 'parent.html');
    await writeFile(
      page,
      `<input type="file" onchange="document.querySelector('iframe').contentWindow.postMessage({files:Array.from(this.files)},'${origin}')"><iframe sandbox="allow-scripts allow-same-origin" src="${origin}"></iframe><script>addEventListener('message',e=>{if(e.origin===${JSON.stringify(origin)} && e.source===document.querySelector('iframe').contentWindow) window.dropTest.receive(e.data.files)})</script>`,
    );
    window = new BrowserWindow({
      show: false,
      webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('native_drop_timeout')), 15000);
      ipcMain.once('native-drop-result', (_event, value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    window.webContents.debugger.attach('1.3');
    const frames = new Set();
    window.webContents.debugger.on('message', (_e, method, params) => {
      if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe')
        frames.add(params.sessionId);
    });
    await window.webContents.debugger.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    await window.loadFile(page);
    const findInput = (node) =>
      node.nodeName === 'INPUT'
        ? node.nodeId
        : [...(node.children || []), ...(node.contentDocument ? [node.contentDocument] : [])]
            .map(findInput)
            .find(Boolean);
    let selected = false;
    for (const sessionId of [undefined, ...frames]) {
      const doc = await window.webContents.debugger.sendCommand(
        'DOM.getDocument',
        { depth: -1, pierce: true },
        sessionId,
      );
      const nodeId = findInput(doc.root);
      if (nodeId) {
        await window.webContents.debugger.sendCommand(
          'DOM.setFileInputFiles',
          { nodeId, files: [file] },
          sessionId,
        );
        selected = true;
        break;
      }
    }
    if (!selected) throw new Error('native_input_not_found');
    const receipt = await result;
    if (receipt.path !== file || !receipt.isFile)
      throw new Error('native_file_backing_lost_across_iframe');
    process.stdout.write(
      'Native disk-backed File survived loopback iframe → file parent → isolated preload; synthetic-only fixture passed.\n',
    );
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await rm(dir, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
