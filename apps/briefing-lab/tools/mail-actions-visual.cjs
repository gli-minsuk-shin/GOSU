/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Electron visual fixture. */
const { app, BrowserWindow, session } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'mail-actions-visual-')));
app.whenReady().then(async () => {
  const fixtureSession = session.fromPartition('mail-actions-fixture');
  fixtureSession.webRequest.onBeforeRequest((d, cb) =>
    cb({ cancel: !/^(file:|data:)/.test(d.url) }),
  );
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 900,
    webPreferences: { session: fixtureSession, sandbox: true },
  });
  const settle = () =>
    window.webContents.executeJavaScript(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
    );
  const click = (text) =>
    window.webContents.executeJavaScript(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('missing button');b.click()})()`,
    );
  try {
    for (const mode of ['mail', 'calendar', 'permission', 'delete'])
      for (const width of [1000, 460]) {
        window.setSize(width, 900);
        await window.loadFile(
          resolve(__dirname, '../../../tmp/mail-actions-visual/mail-actions-visual.html'),
          {
            query:
              mode === 'delete'
                ? { calendar: '1', delete: '1' }
                : mode === 'permission'
                  ? { calendar: '1', permission: '1' }
                  : mode === 'calendar'
                    ? { calendar: '1' }
                    : {},
          },
        );
        await settle();
        if (mode === 'mail') await click('＋ 일정 생성');
        if (mode === 'permission') await click('Calendar 접근 다시 허용');
        await settle();
        const valid = await window.webContents.executeJavaScript(
          `document.querySelector('[role="dialog"]') && document.querySelector('.briefing-event-fields select').value === 'fixture' && document.body.textContent.includes('장소') && document.querySelector('textarea') && !window.mailActionCalls.some(p=>p.endsWith('/calendar/apply')) && document.documentElement.scrollWidth<=innerWidth+1`,
        );
        if (!valid) throw Error('dialog review/overflow failure');
        const dir = resolve(__dirname, '../../../tmp/screenshots');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          resolve(dir, mode + '-calendar-review-' + width + '.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        await click(mode === 'delete' ? '삭제' : '일정 생성');
        await settle();
        if (
          !(await window.webContents.executeJavaScript(
            `window.mailActionCalls.filter(p=>p.endsWith('/calendar/apply')).length===1 && document.body.textContent.includes(${JSON.stringify(mode === 'delete' ? '일정 삭제됨' : '일정 등록됨')})`,
          ))
        )
          throw Error('confirmation failure');
      }
    console.log(
      'Calendar visual smoke: 8/8 create/delete/permission cases, single-click operation, no external requests.',
    );
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
