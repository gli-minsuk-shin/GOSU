import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('keeps Electron package artifacts out of the desktop Turbo cache', async () => {
  const turboConfig = JSON.parse(await readFile(resolve(repositoryRoot, 'turbo.json'), 'utf8'));
  const desktopBuild = turboConfig.tasks?.['@gosu/desktop#build'];

  assert.deepEqual(desktopBuild?.dependsOn, ['^build']);
  assert.deepEqual(desktopBuild?.outputs, ['out/**']);
});
