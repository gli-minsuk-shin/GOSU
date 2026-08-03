import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const preloadPath = join(repositoryRoot, 'apps', 'desktop', 'out', 'preload', 'index.js');
const source = await readFile(preloadPath, 'utf8');
const requiredModules = [...source.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)].map(
  (match) => match[2],
);
const unsupportedModules = [...new Set(requiredModules)].filter(
  (moduleName) => moduleName !== 'electron',
);

if (unsupportedModules.length > 0) {
  throw new Error(
    `Sandboxed preload contains external require calls: ${unsupportedModules.join(', ')}`,
  );
}

console.log('sandboxed preload bundle verification passed');
