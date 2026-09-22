import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Turbo hashes a package's own files only, so a build helper imported from outside the
// package has to be a global dependency or a cached desktop build outlives its change.
test('rebuilds the desktop app when a build helper outside its package changes', async () => {
  const turboConfig = JSON.parse(await readFile(resolve(repositoryRoot, 'turbo.json'), 'utf8'));
  const desktopDirectory = resolve(repositoryRoot, 'apps/desktop');
  const buildConfig = await readFile(resolve(desktopDirectory, 'electron.vite.config.ts'), 'utf8');
  const outsideImports = [...buildConfig.matchAll(/from '(\.\.\/\.\.\/[^']+)'/g)].map((match) =>
    resolve(desktopDirectory, match[1]),
  );
  assert.ok(outsideImports.length > 0, 'expected the lab bundle helper import');

  for (const helperPath of outsideImports) {
    const declarationPath = helperPath.replace(/\.mjs$/, '.d.mts');
    const cacheInputs = [helperPath];
    if (
      await access(declarationPath).then(
        () => true,
        () => false,
      )
    ) {
      cacheInputs.push(declarationPath);
    }
    for (const cacheInput of cacheInputs) {
      const repositoryPath = relative(repositoryRoot, cacheInput);
      assert.ok(
        turboConfig.globalDependencies.includes(repositoryPath),
        `turbo.json globalDependencies is missing ${repositoryPath}`,
      );
    }
  }
});

test('keeps Electron package artifacts out of the desktop Turbo cache', async () => {
  const turboConfig = JSON.parse(await readFile(resolve(repositoryRoot, 'turbo.json'), 'utf8'));
  const desktopBuild = turboConfig.tasks?.['@gosu/desktop#build'];

  assert.deepEqual(desktopBuild?.dependsOn, ['^build']);
  assert.deepEqual(desktopBuild?.outputs, ['out/**']);
});
