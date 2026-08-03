import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PLUTIL = '/usr/bin/plutil';
const UNUSED_PERMISSION_DESCRIPTIONS = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];
const APP_TRANSPORT_SECURITY = {
  NSAllowsArbitraryLoads: false,
  NSAllowsLocalNetworking: true,
  NSExceptionDomains: {
    '127.0.0.1': {
      NSIncludesSubdomains: false,
      NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
    },
    localhost: {
      NSIncludesSubdomains: false,
      NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
    },
  },
};

async function plistHasKey(infoPlist, key) {
  try {
    await run(PLUTIL, ['-extract', key, 'raw', '-o', '-', infoPlist]);
    return true;
  } catch {
    return false;
  }
}

export async function hardenMacInfoPlist(infoPlist) {
  await run(PLUTIL, ['-lint', infoPlist]);
  for (const key of UNUSED_PERMISSION_DESCRIPTIONS) {
    if (await plistHasKey(infoPlist, key)) {
      await run(PLUTIL, ['-remove', key, infoPlist]);
    }
  }
  await run(PLUTIL, [
    '-replace',
    'NSAppTransportSecurity',
    '-json',
    JSON.stringify(APP_TRANSPORT_SECURITY),
    infoPlist,
  ]);
  await run(PLUTIL, ['-lint', infoPlist]);
}

export async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const productName = context.packager.appInfo.productFilename;
  const infoPlist = join(context.appOutDir, `${productName}.app`, 'Contents', 'Info.plist');
  await hardenMacInfoPlist(infoPlist);
}

export default afterPack;
