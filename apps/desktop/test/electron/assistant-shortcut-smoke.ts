import { app, BrowserWindow, Menu } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { installAssistantShortcutInput } from '../../src/main/assistant-shortcut-input';
import { DEFAULT_ASSISTANT_SHORTCUT } from '../../src/shared/assistant-shortcut';
import { trackMainRendererReadiness } from '../../src/main/renderer-navigation-ready';

async function smoke() {
  const directory = await mkdtemp(join(tmpdir(), 'gosu-shortcut-smoke-'));
  app.setPath('userData', directory);
  await app.whenReady();
  const window = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  let current = DEFAULT_ASSISTANT_SHORTCUT,
    opened = 0,
    menuOpened = 0;
  let ready = false,
    legacyReady = false;
  const disposeReadiness = trackMainRendererReadiness(window.webContents, (value) => {
    ready = value;
  });
  window.webContents.on('did-start-loading', () => {
    legacyReady = false;
  });
  window.webContents.on('did-finish-load', () => {
    legacyReady = true;
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Test',
        submenu: [
          {
            label: 'Assistant',
            accelerator: current,
            click: () => {
              menuOpened++;
            },
          },
        ],
      },
    ]),
  );
  const dispose = installAssistantShortcutInput(
    window.webContents,
    () => current,
    () => {
      if (!ready) return;
      opened++;
      void window.webContents.executeJavaScript('document.getElementById("chat").focus()');
    },
  );
  try {
    await window.loadURL(
      'data:text/html,' +
        encodeURIComponent('<input id="chat"><iframe srcdoc="<input id=inside>"></iframe>'),
    );
    window.show();
    window.focus();
    window.webContents.focus();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
    const press = async (keyCode: string) => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['meta', 'shift'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['meta', 'shift'] });
      await settle();
    };
    await press('Space');
    assert.equal(opened, 1);
    assert.equal(await window.webContents.executeJavaScript('document.activeElement.id'), 'chat');
    await window.webContents.executeJavaScript(
      'new Promise(resolve => { const f=document.querySelector("iframe"); f.onload=resolve; f.srcdoc="<input id=inside>Reloaded"; })',
    );
    assert.equal(legacyReady, false, 'reproduces the old loading gate stuck after iframe reload');
    assert.equal(ready, true);
    await window.webContents.executeJavaScript(
      'document.querySelector("iframe").contentDocument.querySelector("input").focus()',
    );
    await press('Space');
    assert.equal(opened, 2);
    assert.equal(await window.webContents.executeJavaScript('document.activeElement.id'), 'chat');
    current = 'CommandOrControl+Shift+A';
    await press('Space');
    assert.equal(opened, 2);
    await press('A');
    assert.equal(opened, 3);
    assert.equal(menuOpened, 0);
    console.log(
      'Shortcut native smoke passed: main input, iframe input, repeated focus, live preference, no duplicate menu delivery.',
    );
  } finally {
    dispose();
    disposeReadiness();
    window.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}
void smoke().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
