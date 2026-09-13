import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
export function localSigningOptions(appPath, identity) {
  const app = resolve(appPath);
  if (
    !/^[a-f0-9]{40}$/i.test(identity) ||
    !app.endsWith('/GOSU.app') ||
    app === '/Applications/GOSU.app'
  )
    throw Error('Specify a staged GOSU.app and an exact certificate fingerprint.');
  return {
    app,
    identity,
    platform: 'darwin',
    type: 'development',
    // Use the explicit self-signed certificate, not automatic Developer ID discovery.
    // Cryptographic signature verification remains strict; OS trust is never changed.
    identityValidation: false,
    strictVerify: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: (path) => ({
      entitlements: path.includes('/CalendarBridge.app')
        ? []
        : resolve(root, 'apps/desktop/build/entitlements.mac.plist'),
      hardenedRuntime: false,
      timestamp: 'none',
    }),
  };
}
export async function signLocalMac(app, identity) {
  const options = localSigningOptions(app, identity);
  const desktopRequire = createRequire(resolve(root, 'apps/desktop/package.json'));
  const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'));
  const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'));
  const { signAsync } = libraryRequire('@electron/osx-sign');
  await signAsync(options);
  const run = promisify(execFile);
  for (const target of [
    options.app,
    resolve(options.app, 'Contents/Resources/CalendarBridge.app'),
  ]) {
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
    const { stdout, stderr } = await run('/usr/bin/codesign', ['-d', '-r-', target]);
    const signature = stdout + stderr;
    if (
      !signature.toLowerCase().includes(identity.toLowerCase()) ||
      /designated => cdhash/.test(signature)
    )
      throw Error('Certificate identity was not retained for the app and Calendar helper.');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4)
    throw Error('Usage: node scripts/sign-local-mac.mjs <staged GOSU.app> <certificate SHA-1>');
  await signLocalMac(process.argv[2], process.argv[3]);
  console.log('Local certificate signing and strict app/helper verification passed.');
}
