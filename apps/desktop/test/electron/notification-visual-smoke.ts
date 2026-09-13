import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
const temporary = mkdtempSync(resolve(tmpdir(), 'gosu-notification-visual-'));
app.setPath('userData', temporary);
app.setPath('sessionData', temporary);
app.on('window-all-closed', () => undefined);
const invariant = (value: unknown, message: string) => {
  if (!value) throw Error(message);
};
const frame = (window: BrowserWindow) =>
  window.webContents.executeJavaScript(
    'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
  );
async function click(window: BrowserWindow, selector: string) {
  await window.webContents.executeJavaScript(
    `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled)throw Error('missing_button:'+${JSON.stringify(selector)});node.click()})()`,
  );
  await frame(window);
}
async function run() {
  await app.whenReady();
  const shots = resolve(process.cwd(), '../../tmp/screenshots/notifications');
  await mkdir(shots, { recursive: true });
  const context = session.fromPartition(`notification-fixture-${Date.now()}`);
  let external = 0;
  context.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/u.test(details.url)) {
      external++;
      callback({ cancel: true });
    } else callback({});
  });
  const window = new BrowserWindow({
    show: false,
    width: 1180,
    height: 900,
    useContentSize: true,
    webPreferences: {
      session: context,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const errors: string[] = [];
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error' && !details.message.includes('Content Security Policy'))
      errors.push(details.message);
  });
  const entry = resolve(
    process.cwd(),
    'out/notification-visual-smoke/renderer/notification-visual-smoke.html',
  );
  const results = [];
  try {
    for (const theme of ['light', 'dark'])
      for (const sidebar of [220, 332]) {
        await window.loadFile(entry);
        await window.webContents.executeJavaScript(
          `localStorage.removeItem('gosu:notification-inbox:v1')`,
        );
        await window.loadFile(entry);
        await window.webContents.executeJavaScript(
          `new Promise((resolve,reject)=>{let n=0;const check=()=>{if(document.querySelector('.notification-bell'))return resolve(true);if(n++>200)return reject(Error('missing_fixture'));requestAnimationFrame(check)};check()})`,
        );
        await window.webContents.executeJavaScript(
          `document.documentElement.dataset.appearance='${theme}';document.documentElement.style.setProperty('--fixture-sidebar-width','${sidebar}px')`,
        );
        await click(window, '.project-quick-action[aria-label="Search"]');
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('output').dataset.tab==='search'`,
          ),
          'search_navigation_failed',
        );
        await click(window, '.project-personal-tool[aria-label="To-do list"]');
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('output').dataset.tab==='tasks'`,
          ),
          'tasks_navigation_failed',
        );
        const initial = await window.webContents.executeJavaScript(
          `(()=>{const quick=document.querySelector('.project-quick-actions').getBoundingClientRect();const heading=document.querySelector('.project-navigation-heading').getBoundingClientRect();return{badge:document.querySelector('.notification-count')?.textContent,above:quick.bottom<=heading.top+1,duplicates:document.querySelectorAll('.project-global-navigation [data-sidebar-icon="tasks"],.project-global-navigation [data-sidebar-icon="search"]').length}})()`,
        );
        invariant(
          initial.badge === '99+' && initial.above && initial.duplicates === 0,
          'shortcut_or_count_failure',
        );
        await click(window, '.notification-bell');
        const geometry = await window.webContents.executeJavaScript(
          `(()=>{const panel=document.querySelector('.notification-popover'),nav=document.querySelector('.desktop-nav'),list=document.querySelector('.notification-list-scroll');const r=panel.getBoundingClientRect();return{open:panel.matches(':popover-open'),width:r.width,right:r.right,bottom:r.bottom,navRight:nav.getBoundingClientRect().right,viewportWidth:innerWidth,viewportHeight:innerHeight,topLayer:panel.contains(document.elementFromPoint(r.right-15,r.top+25)),overflow:document.documentElement.scrollWidth-innerWidth,rows:panel.querySelectorAll('li').length,scrollable:list.scrollHeight>list.clientHeight}})()`,
        );
        invariant(
          geometry.open && geometry.topLayer && geometry.right > geometry.navRight + 40,
          'popover_clipped_by_sidebar',
        );
        invariant(
          geometry.right <= geometry.viewportWidth &&
            geometry.bottom <= geometry.viewportHeight &&
            geometry.overflow <= 1,
          'popover_outside_viewport',
        );
        invariant(
          geometry.rows === 40 && geometry.scrollable,
          'notification_list_not_bounded_or_scrollable',
        );
        await writeFile(
          resolve(shots, `${theme}-${sidebar}-unread.png`),
          (await window.webContents.capturePage()).toPNG(),
        );
        await click(window, '.notification-open-item');
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('output').dataset.tab==='tasks'&&document.querySelector('output').dataset.task.length>0&&document.querySelector('output').dataset.status==='planned'`,
          ),
          'open_changed_task_or_wrong_target',
        );
        await window.loadFile(entry);
        await frame(window);
        await window.webContents.executeJavaScript(
          `document.documentElement.dataset.appearance='${theme}';document.documentElement.style.setProperty('--fixture-sidebar-width','${sidebar}px')`,
        );
        await frame(window);
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('.notification-bell').getAttribute('aria-label').includes('119')`,
          ),
          'read_receipt_not_persisted',
        );
        await click(window, '.notification-bell');
        await click(window, '.notification-toolbar > button');
        invariant(
          await window.webContents.executeJavaScript(
            `!document.querySelector('.notification-count')&&document.querySelector('.notification-empty')!==null`,
          ),
          'mark_all_did_not_clear_badge',
        );
        await click(window, '.notification-toolbar [role="group"] button:nth-child(2)');
        await click(window, '.notification-item footer button:last-child');
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('.notification-panel-footer button')!==null`,
          ),
          'hidden_restore_missing',
        );
        await click(window, '.notification-panel-footer button');
        await click(window, '.notification-close');
        await click(window, '.notification-bell');
        await window.webContents.executeJavaScript(
          `document.querySelector('.notification-popover').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
        );
        await frame(window);
        invariant(
          await window.webContents.executeJavaScript(
            `!document.querySelector('.notification-popover').matches(':popover-open')&&document.activeElement===document.querySelector('.notification-bell')`,
          ),
          'escape_or_focus_failed',
        );
        await click(window, '.notification-bell');
        await click(window, '#suppress-fixture');
        invariant(
          await window.webContents.executeJavaScript(
            `!document.querySelector('.notification-popover').matches(':popover-open')&&document.querySelector('.notification-bell').disabled`,
          ),
          'approval_suppression_failed',
        );
        await click(window, '#suppress-fixture');
        await click(window, '.notification-bell');
        window.webContents.sendInputEvent({
          type: 'mouseDown',
          x: 1100,
          y: 850,
          button: 'left',
          clickCount: 1,
        });
        window.webContents.sendInputEvent({
          type: 'mouseUp',
          x: 1100,
          y: 850,
          button: 'left',
          clickCount: 1,
        });
        await frame(window);
        invariant(
          await window.webContents.executeJavaScript(
            `!document.querySelector('.notification-popover').matches(':popover-open')`,
          ),
          'outside_click_did_not_dismiss',
        );
        await click(window, '#resolve-fixture');
        await click(window, '#ko-fixture');
        await click(window, '.notification-bell');
        invariant(
          await window.webContents.executeJavaScript(
            `!document.querySelector('.notification-count')&&document.querySelector('.notification-popover').textContent.includes('알림')`,
          ),
          'resolved_or_language_failed',
        );
        await writeFile(
          resolve(shots, `${theme}-${sidebar}-read.png`),
          (await window.webContents.capturePage()).toPNG(),
        );
        await click(window, '#chat-fixture');
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('.notification-count')?.textContent==='1'&&document.querySelector('.notification-open-item strong')?.textContent.includes('응답 완료')`,
          ),
          'chat_completion_notification_missing',
        );
        await click(window, '.notification-open-item');
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('output').dataset.tab==='chat'&&!document.querySelector('.notification-count')`,
          ),
          'chat_notification_navigation_failed',
        );
        results.push({ theme, sidebar, geometry });
        await click(window, '#personal-fixture');
        await click(window, '.notification-bell');
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('.notification-popover').textContent.includes('12개')&&document.querySelector('.notification-popover').textContent.includes('중요 3개')&&document.querySelector('.notification-popover').textContent.includes('연구 미팅')`,
          ),
          'personal_notification_counts_missing',
        );
        await writeFile(
          resolve(shots, `${theme}-${sidebar}-personal.png`),
          (await window.webContents.capturePage()).toPNG(),
        );
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.notification-open-item')).find(n=>n.textContent.includes('연구 미팅')).click()`,
        );
        await frame(window);
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('output').dataset.tab==='calendar'`,
          ),
          'calendar_navigation_missing',
        );
        await click(window, '.notification-bell');
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.notification-open-item')).find(n=>n.textContent.includes('12개')).click()`,
        );
        await frame(window);
        invariant(
          await window.webContents.executeJavaScript(
            `document.querySelector('output').dataset.tab==='briefing-lab'`,
          ),
          'briefing_navigation_missing',
        );
      }
    invariant(
      external === 0 && errors.length === 0,
      `unexpected_external_or_renderer_error:${errors.join(',')}`,
    );
    await writeFile(resolve(shots, 'results.json'), JSON.stringify(results, null, 2));
    process.stdout.write(
      `Notifications visual smoke passed: ${results.length}/4 variants; 12 screenshots; 120 deadlines, calendar/briefing counts and navigation, 99+ badge, read persistence, hide/restore, resolved tasks, native popover containment, scrolling and approval suppression. No external requests.\n`,
    );
  } finally {
    window.destroy();
  }
}
run().then(
  async () => {
    await rm(temporary, { recursive: true, force: true });
    app.exit(0);
  },
  (error) => {
    process.stderr.write(`${error.stack}\n`);
    app.exit(1);
  },
);
