const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdirSync, writeFileSync, mkdtempSync } = require('node:fs');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const root = resolve(__dirname, '../../../..');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'gosu-settings-density-')));
const css = readFileSync(resolve(root, 'apps/desktop/src/renderer/src/styles.css'), 'utf8').replace(
  "@import '@gosu/ui/typography.css';",
  readFileSync(resolve(root, 'packages/ui/src/typography.css'), 'utf8'),
);
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { sandbox: true },
  });
  const output = resolve(root, 'tmp/screenshots/settings-density');
  mkdirSync(output, { recursive: true });
  try {
    for (const theme of ['light', 'dark']) {
      await window.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<!doctype html><html data-appearance="${theme}"><style>${css}</style><body><main class="desktop-content"><header class="page-heading"><div><h1>설정</h1><p>작업 환경을 원하는 방식으로 조정하세요.</p></div></header><section class="settings-shell" style="height:650px"><nav class="settings-category-nav" style="height:100%">${['Briefing Lab', '화면 설정', '보드 기본값', 'AI 에이전트', '프로젝트'].map((name, i) => `<button class="${i === 1 ? 'active' : ''}"><i>◦</i><strong>${name}</strong><span>연결과 표시 환경 관리</span></button>`).join('')}</nav><div class="settings-category-content"><section class="settings-card"><h2>화면 설정</h2><label>글자 크기<select><option>기본 · 12px</option></select></label><p>본문은 편안하게, 보조 정보는 또렷하게 표시합니다.</p><small>기존 글자 크기 선택은 유지됩니다.</small></section><section class="settings-card"><h2>프로젝트 채팅</h2><article class="chat-message"><header><strong>GOSU</strong><span>15:30</span></header><div class="message-copy"><p>논문의 핵심 결과와 다음 작업을 정리했습니다.</p><p><strong>중요한 내용</strong>은 강조하고, 자세한 설명은 읽기 쉬운 간격으로 보여줍니다.</p></div></article></section></div></section></main></body></html>`,
          ),
      );
      const metrics = await window.webContents.executeJavaScript(
        `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const buttons=[...document.querySelectorAll('nav button')].map(x=>x.getBoundingClientRect());resolve({heights:buttons.map(x=>x.height),gap:buttons[1].top-buttons[0].bottom,title:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),caption:parseFloat(getComputedStyle(document.querySelector('small')).fontSize),overflow:document.documentElement.scrollWidth-innerWidth})})))`,
      );
      if (
        metrics.heights.some((h) => h > 65 || h < 48) ||
        metrics.gap !== 2 ||
        metrics.title !== 18 ||
        metrics.caption !== 11 ||
        metrics.overflow > 1
      )
        throw Error(JSON.stringify(metrics));
      writeFileSync(
        resolve(output, `${theme}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    console.log(
      'Settings density visual smoke: 2/2 themes passed; bounded rows, 2px gaps, 18px title, 11px caption, no overflow.',
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
