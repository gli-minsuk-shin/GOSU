const { readFileSync, mkdtempSync } = require('node:fs');
const { mkdir, writeFile, rm } = require('node:fs/promises');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, session } = require('electron');

const root = resolve(__dirname, '../../../..');
const temporary = mkdtempSync(resolve(tmpdir(), 'gosu-typography-'));
app.setPath('userData', temporary);
app.setPath('sessionData', temporary);
app.on('window-all-closed', () => undefined);
const shared = readFileSync(resolve(root, 'packages/ui/src/typography.css'), 'utf8');
const css = (path) =>
  readFileSync(resolve(root, path), 'utf8').replace("@import '@gosu/ui/typography.css';", shared);
const desktopCss = css('apps/desktop/src/renderer/src/styles.css');
const modelCss = css('apps/model-lab/src/styles.css');
const shots = resolve(root, 'tmp/screenshots/typography');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const escapeAttribute = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

function markup(language) {
  const ko = language === 'ko';
  const prose = ko
    ? '설계 의도와 수식, 코드가 일치하는지 확인합니다. 모델의 변경 사항은 근거와 함께 설명합니다.'
    : 'Review the design, equations, and code together. Explain model changes with supporting evidence.';
  const child = `<!doctype html><html><head><meta charset="utf-8"><style>${modelCss}</style><style>
    html,body{height:100%;min-height:0;overflow:hidden}body{padding:16px;background:var(--model-surface)}
    main{height:100%;overflow:auto}.model-tree-folder-copy{margin:14px 0}.model-chat{border:0}.chat-message{margin:12px 0}.model-chat__composer-row{margin-top:12px}
  </style></head><body><main><h2>Model Lab</h2><div class="model-tree-folder-copy"><strong data-role="nav">Bottleneck autoencoder</strong><small>5 modules · 19,736 parameters</small></div>
  <section class="model-chat"><article class="chat-message"><header><strong data-role="meta">GOSU</strong><span data-role="caption">09:30</span></header><div class="model-chat-markdown"><p data-role="body">${prose}</p><p>H₁ = Xᵀ(y − XH₁) / N</p></div></article><label>${ko ? '모델' : 'Model'}<select data-role="control"><option>GPT-6-Astra</option></select></label><div class="model-chat__composer-row"><button class="attachment-button" type="button">Files</button><textarea aria-label="Model draft">Keep this model draft</textarea><button class="model-chat__send-button" type="button">Send</button></div></section>
  <section class="module-detail-notes"><h3>${ko ? '모듈 설명' : 'Module explanation'}</h3><p>${prose}</p></section></main></body></html>`;
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><style>${desktopCss}</style><style>
    .fixture{height:100vh;display:grid;grid-template-rows:auto minmax(0,1fr);padding:20px;gap:16px}
    .fixture>header{display:flex;gap:18px;align-items:center;flex-wrap:wrap}.fixture>header h1{margin:0}
    .fixture-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;min-height:0}
    .fixture-pane{border:1px solid var(--line);border-radius:16px;padding:18px;overflow:auto;background:var(--surface);min-width:0}
    .fixture-pane h2{margin-top:0}.fixture-pane .chat-message{margin:12px 0;width:100%;max-width:100%}.fixture-pane .chat-composer{display:block;margin-top:12px}
    .fixture-pane select,.fixture-pane textarea{width:100%}.fixture-pane table{width:100%;border-collapse:collapse;margin:16px 0}.fixture-pane th,.fixture-pane td{padding:9px;border:1px solid var(--line);text-align:left}
    iframe{width:100%;height:100%;min-width:0;border:1px solid var(--line);border-radius:16px;background:white}
    .fixture-note{font-size:var(--font-meta);color:var(--muted)}
  </style></head><body><main class="fixture"><header><h1>GOSU · ${ko ? '글자 크기 일관성' : 'Typography consistency'}</h1><span class="fixture-note">${ko ? '격리된 테스트 화면 · 계정 접근 없음' : 'Isolated fixture · no account access'}</span></header><div class="fixture-grid"><section class="fixture-pane"><aside style="width:220px;max-width:100%"><div class="connection"><i></i><span>Obsidian</span><b>Project folder ready</b></div></aside><h2>Project Chat</h2><article class="chat-message assistant"><header><strong data-role="meta">GOSU</strong><span data-role="caption">09:30</span></header><div class="message-copy"><p data-role="body">${prose}</p><p>H₁ = Xᵀ(y − XH₁) / N</p></div></article><label>${ko ? '모델' : 'Model'}<select data-role="control"><option>GPT-6-Astra</option></select></label><div class="chat-composer"><textarea aria-label="Chat draft">Keep this project draft</textarea></div><h2>Literature</h2><table class="literature-table"><thead><tr><th>${ko ? '논문' : 'Paper'}</th><th>${ko ? '연도' : 'Year'}</th></tr></thead><tbody>${Array.from({ length: 8 }, (_, i) => `<tr><td data-role="table">${ko ? '신경망과 최적화 연구' : 'Neural networks and optimization'} ${i + 1}</td><td>2026</td></tr>`).join('')}</tbody></table><p class="fixture-note">${ko ? '본문·입력·설명은 역할에 맞는 공통 크기를 사용합니다.' : 'Body, inputs and metadata follow shared role sizes.'}</p></section><iframe title="Model Lab typography" srcdoc="${escapeAttribute(child)}"></iframe></div></main></body></html>`;
}

async function run() {
  await app.whenReady();
  await mkdir(shots, { recursive: true });
  const partition = session.fromPartition(`typography-${Date.now()}`);
  let external = 0;
  partition.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/u.test(details.url)) {
      external++;
      callback({ cancel: true });
    } else callback({});
  });
  const window = new BrowserWindow({
    show: false,
    width: 1360,
    height: 980,
    useContentSize: true,
    webPreferences: {
      session: partition,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  const results = [];
  try {
    for (const language of ['ko', 'en']) {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(markup(language))}`);
      await window.webContents.executeJavaScript(
        `new Promise((resolve,reject)=>{let n=0;const check=()=>{const child=document.querySelector('iframe')?.contentDocument;if(child?.querySelector('[data-role="body"]'))return resolve(true);if(n++>180)return reject(Error('iframe_unavailable'));requestAnimationFrame(check)};check()})`,
      );
      for (const size of ['compact', 'default', 'large', 'extra-large'])
        for (const width of [1120, 1360]) {
          window.setContentSize(width, 980);
          const metrics = await window.webContents.executeJavaScript(
            `new Promise(resolve=>{const size=${JSON.stringify(size)};document.documentElement.dataset.textSize=size;document.documentElement.dataset.appearance=${JSON.stringify(language === 'ko' ? 'light' : 'dark')};const child=document.querySelector('iframe').contentDocument;child.documentElement.dataset.textSize=size;requestAnimationFrame(()=>requestAnimationFrame(()=>{const roles=(doc)=>Object.fromEntries(['body','meta','caption','control'].map(role=>[role,parseFloat(doc.defaultView.getComputedStyle(doc.querySelector('[data-role="'+role+'"]')).fontSize)]));resolve({desktop:roles(document),model:roles(child),connectionGap:document.querySelector(".connection b").getBoundingClientRect().left-document.querySelector(".connection > span").getBoundingClientRect().right,connectionOverflow:document.querySelector(".connection b").scrollWidth-document.querySelector(".connection b").clientWidth,rootOverflow:document.documentElement.scrollWidth-innerWidth,panes:[...document.querySelectorAll('.fixture-pane')].map(p=>p.scrollWidth-p.clientWidth),childOverflow:child.documentElement.scrollWidth-child.documentElement.clientWidth,draft:document.querySelector('textarea').value,modelDraft:child.querySelector('textarea').value,table:parseFloat(getComputedStyle(document.querySelector('[data-role="table"]')).fontSize)})}))})`,
          );
          const base = { compact: 10, default: 12, large: 14, 'extra-large': 16 }[size];
          assert(
            metrics.desktop.body === base && metrics.model.body === base,
            `body_mismatch:${JSON.stringify(metrics)}`,
          );
          assert(
            JSON.stringify(metrics.desktop) === JSON.stringify(metrics.model),
            `role_mismatch:${JSON.stringify(metrics)}`,
          );
          assert(
            metrics.desktop.caption === Math.max(9, base - 1) &&
              metrics.desktop.meta === Math.max(9, base - 1) &&
              metrics.desktop.control === base,
            'preset_role_size_mismatch',
          );
          assert(metrics.table === base, 'table_body_mismatch');
          assert(
            metrics.connectionGap >= 5 && metrics.connectionOverflow <= 1,
            'connection_labels_overlap',
          );
          assert(
            metrics.rootOverflow <= 1 &&
              metrics.childOverflow <= 1 &&
              metrics.panes.every((n) => n <= 1),
            `overflow:${JSON.stringify(metrics)}`,
          );
          assert(
            metrics.draft === 'Keep this project draft' &&
              metrics.modelDraft === 'Keep this model draft',
            'draft_lost_on_resize',
          );
          const screenshot = resolve(shots, `${language}-${size}-${width}.png`);
          await writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
          results.push({ language, size, width, metrics, screenshot });
        }
    }
    assert(external === 0, 'unexpected_external_request');
    process.stdout.write(
      `Typography visual smoke passed: ${results.length}/16 variants, matching roles, readable floors, intact drafts, no overflow or external requests.\n`,
    );
    await writeFile(resolve(shots, 'results.json'), JSON.stringify(results, null, 2));
  } finally {
    window.destroy();
  }
}
run()
  .then(
    () => {
      app.exit(0);
    },
    (error) => {
      process.stderr.write(`${error.stack}\n`);
      app.exit(1);
    },
  )
  .finally(() => rm(temporary, { recursive: true, force: true }).catch(() => undefined));
