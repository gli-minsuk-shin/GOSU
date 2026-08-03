import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SYNC_BASE_URL,
  parseLocalSyncBaseUrl,
  probeSync,
  syncHealthUrl,
} from './local-runtime.mjs';

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));
const checks = [];

function record(level, label, detail) {
  checks.push({ level, label, detail });
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
record(nodeMajor >= 22 ? 'OK' : 'FAIL', 'Node.js', `v${process.versions.node} (requires >=22)`);
record(
  process.platform === 'darwin' ? 'OK' : 'WARN',
  'Platform',
  `${process.platform}/${process.arch} (the packaged MVP targets macOS)`,
);

for (const [label, relativePath] of [
  ['Workspace dependencies', 'node_modules/.pnpm'],
  ['Electron runtime', 'apps/desktop/node_modules/electron'],
  ['Codex App Server package', 'apps/desktop/node_modules/@openai/codex'],
]) {
  try {
    await access(resolve(workspaceRoot, relativePath));
    record('OK', label, 'installed');
  } catch {
    record('FAIL', label, 'missing; run pnpm install --frozen-lockfile');
  }
}

try {
  const baseUrl = parseLocalSyncBaseUrl(process.env.GOSU_SYNC_API_URL ?? DEFAULT_SYNC_BASE_URL);
  const result = await probeSync(syncHealthUrl(baseUrl.toString()));
  record(
    result.kind === 'ready' ? 'OK' : result.kind === 'occupied' ? 'FAIL' : 'OK',
    'Local Sync port',
    result.kind === 'ready'
      ? `healthy at ${baseUrl.origin}`
      : result.kind === 'occupied'
        ? result.detail
        : `available for launcher at ${baseUrl.origin}`,
  );
} catch (error) {
  record('FAIL', 'Local Sync URL', error instanceof Error ? error.message : String(error));
}

console.log('GOSU local app doctor\n');
for (const check of checks) {
  console.log(`${check.level.padEnd(4)} ${check.label.padEnd(25)} ${check.detail}`);
}

const failures = checks.filter((check) => check.level === 'FAIL');
if (failures.length) {
  console.error(`\n${failures.length} blocking check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nReady. Run: pnpm app:dev');
}
