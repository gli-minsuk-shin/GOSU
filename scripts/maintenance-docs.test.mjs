import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const { version } = JSON.parse(await read('apps/desktop/package.json'));
const documents = [
  'docs/README.md',
  'docs/MAINTENANCE_GUIDE.md',
  'docs/RELEASE_RUNBOOK.md',
  `docs/releases/${version}.md`,
];

test('current app version has a release record and durable agent entrypoints', async () => {
  assert.match(
    await read(`docs/releases/${version}.md`),
    new RegExp(`^# GOSU ${version.replaceAll('.', '\\.')}`, 'u'),
  );
  const agents = await read('AGENTS.md');
  for (const path of documents.slice(0, 3))
    assert.ok(agents.includes(path), `AGENTS entry missing: ${path}`);
  assert.ok((await read('README.md')).includes('docs/MAINTENANCE_GUIDE.md'));
});

test('maintenance links point to existing repository sources, tests and docs', async () => {
  for (const document of documents) {
    const content = await read(document);
    const targets = [...content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/gu)].map((match) => match[1]);
    assert.ok(targets.length >= 2, `${document} has no usable navigation`);
    for (const target of targets) {
      if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
      const path = resolve(root, dirname(document), decodeURIComponent(target.split('#')[0]));
      const within = relative(root, path);
      assert.ok(
        !isAbsolute(within) && !within.startsWith('..'),
        `Link leaves repo: ${document}: ${target}`,
      );
      assert.ok((await stat(path)).isFile(), `Missing link: ${document}: ${target}`);
    }
  }
});
