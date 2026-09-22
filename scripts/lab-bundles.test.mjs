import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { replaceLabBundle, verifyPackagedLabBundles } from './lab-bundles.mjs';

async function temporaryDirectory(context) {
  const directory = await mkdtemp(join(tmpdir(), 'gosu-lab-bundles-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeFiles(directory, files) {
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(directory, name)), { recursive: true });
    await writeFile(join(directory, name), text);
  }
}

// An ASAR archive is a size pickle, a pickled JSON header, then the file bytes that the
// header's offsets point into.
async function writeAsar(asarPath, files) {
  const header = { files: {} };
  const contents = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const segments = name.split('/');
    let directory = header;
    for (const segment of segments.slice(0, -1)) {
      directory.files[segment] ??= { files: {} };
      directory = directory.files[segment];
    }
    const bytes = Buffer.from(text);
    directory.files[segments.at(-1)] = { size: bytes.length, offset: String(offset) };
    contents.push(bytes);
    offset += bytes.length;
  }
  const json = Buffer.from(JSON.stringify(header));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(8 + paddedLength, 4);
  prefix.writeUInt32LE(4 + paddedLength, 8);
  prefix.writeUInt32LE(json.length, 12);
  await writeFile(
    asarPath,
    Buffer.concat([prefix, json, Buffer.alloc(paddedLength - json.length), ...contents]),
  );
}

const currentBriefingLab = {
  'out/briefing-lab/index.html':
    '<script type="module" crossorigin src="./assets/index-BRIEF.js"></script>\n' +
    '<link rel="stylesheet" crossorigin href="./assets/index-BRIEF.css">',
  'out/briefing-lab/assets/index-BRIEF.js': 'briefing',
  'out/briefing-lab/assets/index-BRIEF.css': '.briefing {}',
};

test('replaces the desktop copy so bundles from earlier builds do not remain', async (context) => {
  const root = await temporaryDirectory(context);
  const source = join(root, 'model-lab', 'dist');
  const target = join(root, 'desktop', 'out', 'model-lab');
  await writeFiles(source, {
    'index.html': '<script type="module" src="./assets/index-NEW.js"></script>',
    'assets/index-NEW.js': 'new build',
  });
  await writeFiles(target, {
    'index.html': '<script type="module" src="./assets/index-OLD.js"></script>',
    'assets/index-OLD.js': 'earlier build',
    'assets/index-OLD.css': 'earlier build',
  });

  await replaceLabBundle(source, target);

  assert.deepEqual(await readdir(join(target, 'assets')), ['index-NEW.js']);
  assert.equal(
    await readFile(join(target, 'index.html'), 'utf8'),
    '<script type="module" src="./assets/index-NEW.js"></script>',
  );
});

test('keeps the existing desktop copy when the lab build output is missing', async (context) => {
  const root = await temporaryDirectory(context);
  const source = join(root, 'model-lab', 'dist');
  const target = join(root, 'desktop', 'out', 'model-lab');
  await writeFiles(target, { 'index.html': 'working copy' });

  await assert.rejects(replaceLabBundle(source, target), (error) => {
    assert.match(error.message, /Lab bundle is not built/);
    assert.ok(error.message.includes(join(source, 'index.html')));
    return true;
  });
  assert.equal(await readFile(join(target, 'index.html'), 'utf8'), 'working copy');
});

test('fails when packaged lab assets include bundles that no page loads', async (context) => {
  const asarPath = join(await temporaryDirectory(context), 'app.asar');
  await writeAsar(asarPath, {
    'out/main/index.js': 'main',
    'out/model-lab/index.html':
      '<script type="module" crossorigin src="./assets/index-NEW.js"></script>\n' +
      '<link rel="stylesheet" crossorigin href="./assets/index-NEW.css">',
    'out/model-lab/assets/index-NEW.js': 'current build',
    'out/model-lab/assets/index-NEW.css': '.current {}',
    'out/model-lab/assets/index-OLD.js': 'earlier build with module-detail-copilot__saved',
    'out/model-lab/assets/index-OLD.css': '.module-detail-copilot__saved {}',
    'out/model-lab/assets/layout.worker-OLD.mjs': 'earlier worker',
    ...currentBriefingLab,
  });

  await assert.rejects(verifyPackagedLabBundles(asarPath), (error) => {
    assert.match(error.message, /3 lab assets that no page or referenced chunk loads/);
    assert.ok(error.message.includes('out/model-lab/assets/index-OLD.css'));
    assert.ok(error.message.includes('out/model-lab/assets/index-OLD.js'));
    assert.ok(error.message.includes('out/model-lab/assets/layout.worker-OLD.mjs'));
    assert.ok(!error.message.includes('index-NEW'));
    assert.ok(!error.message.includes('index-BRIEF'));
    return true;
  });
});

test('accepts packaged chunks that only a referenced chunk loads', async (context) => {
  const asarPath = join(await temporaryDirectory(context), 'app.asar');
  await writeAsar(asarPath, {
    'out/model-lab/index.html':
      '<script type="module" crossorigin src="./assets/index-ENTRY.js"></script>\n' +
      '<link rel="stylesheet" crossorigin href="./assets/index-ENTRY.css">',
    'out/model-lab/assets/index-ENTRY.js':
      'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/graph-LAZY.js","assets/graph-LAZY.css"])))=>i.map(i=>d[i]);',
    'out/model-lab/assets/index-ENTRY.css': '@font-face{src:url(./KaTeX_Main-Regular-FONT.woff2)}',
    'out/model-lab/assets/graph-LAZY.js':
      'new Worker(new URL("layout-WORKER.mjs",import.meta.url))',
    'out/model-lab/assets/graph-LAZY.css': '.graph {}',
    'out/model-lab/assets/layout-WORKER.mjs': 'self.onmessage = () => {};',
    'out/model-lab/assets/KaTeX_Main-Regular-FONT.woff2': 'font',
    ...currentBriefingLab,
  });

  await verifyPackagedLabBundles(asarPath);
});

test('fails when a lab bundle is missing from the package', async (context) => {
  const asarPath = join(await temporaryDirectory(context), 'app.asar');
  await writeAsar(asarPath, {
    'out/model-lab/index.html': '<script type="module" src="./assets/index-ONLY.js"></script>',
    'out/model-lab/assets/index-ONLY.js': 'model lab',
  });

  await assert.rejects(verifyPackagedLabBundles(asarPath), (error) => {
    assert.match(error.message, /does not package out\/briefing-lab\/index\.html/);
    return true;
  });
});

test('reports the total and a bounded list when many stale bundles are packaged', async (context) => {
  const asarPath = join(await temporaryDirectory(context), 'app.asar');
  const staleBundles = {};
  for (let build = 10; build < 24; build += 1) {
    staleBundles[`out/briefing-lab/assets/index-STALE${build}.js`] = 'earlier build';
  }
  await writeAsar(asarPath, {
    'out/model-lab/index.html': '<script type="module" src="./assets/index-ONLY.js"></script>',
    'out/model-lab/assets/index-ONLY.js': 'model lab',
    ...currentBriefingLab,
    ...staleBundles,
  });

  await assert.rejects(verifyPackagedLabBundles(asarPath), (error) => {
    assert.match(error.message, /packages 14 lab assets/);
    assert.ok(error.message.includes('out/briefing-lab/assets/index-STALE10.js'));
    assert.ok(error.message.includes('out/briefing-lab/assets/index-STALE21.js'));
    assert.ok(!error.message.includes('index-STALE22.js'));
    assert.ok(!error.message.includes('index-STALE23.js'));
    assert.match(error.message, /\.\.\. and 2 more$/);
    return true;
  });
});

const currentModelLab = {
  'out/model-lab/index.html': '<script type="module" src="./assets/index-ONLY.js"></script>',
  'out/model-lab/assets/index-ONLY.js': 'model lab',
};

// Stands in for the packaged executable: answers the startup smoke without Electron.
async function packagedApp(context, archiveFiles) {
  const appPath = join(await temporaryDirectory(context), 'GOSU.app');
  const executable = join(appPath, 'Contents', 'MacOS', 'GOSU');
  await writeFiles(appPath, {
    'Contents/MacOS/GOSU': '#!/bin/sh\necho GOSU_PACKAGED_STARTUP_READY\n',
  });
  await chmod(executable, 0o755);
  await mkdir(join(appPath, 'Contents', 'Resources'));
  await writeAsar(join(appPath, 'Contents', 'Resources', 'app.asar'), archiveFiles);
  return appPath;
}

function verifyPackagedApp(appPath) {
  const verifier = fileURLToPath(new URL('./verify-packaged-app-startup.mjs', import.meta.url));
  return new Promise((resolveResult) => {
    execFile(process.execPath, [verifier, appPath], (error, stdout, stderr) => {
      resolveResult({ exitCode: error ? error.code : 0, stdout, stderr });
    });
  });
}

test('packaging verification rejects an app that ships bundles from earlier builds', async (context) => {
  const appPath = await packagedApp(context, {
    ...currentModelLab,
    'out/model-lab/assets/index-OLD.js': 'earlier build',
    ...currentBriefingLab,
  });

  const result = await verifyPackagedApp(appPath);

  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('out/model-lab/assets/index-OLD.js'));
  assert.ok(!result.stdout.includes('startup smoke passed'));
});

test('packaging verification passes an app whose lab bundles are all referenced', async (context) => {
  const appPath = await packagedApp(context, { ...currentModelLab, ...currentBriefingLab });

  const result = await verifyPackagedApp(appPath);

  assert.deepEqual([result.exitCode, result.stderr], [0, '']);
  assert.ok(result.stdout.includes('startup smoke passed'));
});
