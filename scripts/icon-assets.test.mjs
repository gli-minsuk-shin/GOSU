import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const desktopRoot = join(repositoryRoot, 'apps', 'desktop');

test('packages the GOSU icon instead of the Electron default', async () => {
  const packageJson = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
  const png = await readFile(join(desktopRoot, 'build', 'icon.png'));
  const icns = await readFile(join(desktopRoot, 'build', 'icon.icns'));

  assert.equal(packageJson.build.mac.icon, 'build/icon.icns');
  assert.equal(packageJson.build.dmg.icon, 'build/icon.icns');

  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);

  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
});
