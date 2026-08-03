import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_SYNC_BASE_URL,
  parseLocalSyncBaseUrl,
  pnpmInvocation,
  probeSync,
  syncHealthUrl,
  terminateProcessTree,
  waitForSync,
} from './local-runtime.mjs';

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));
const baseUrl = parseLocalSyncBaseUrl(process.env.GOSU_SYNC_API_URL ?? DEFAULT_SYNC_BASE_URL);
const healthUrl = syncHealthUrl(baseUrl.toString());
const { command, prefixArgs } = pnpmInvocation();
const managedChildren = new Map();
const startupAbortController = new AbortController();
let shuttingDown = false;

function terminateManagedChildren(signal) {
  for (const child of managedChildren.values()) terminateProcessTree(child, signal);
}

function startProcess(label, args, extraEnvironment = {}) {
  if (shuttingDown || startupAbortController.signal.aborted) {
    throw new Error('Local runtime startup cancelled');
  }

  const child = spawn(command, [...prefixArgs, ...args], {
    cwd: workspaceRoot,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...extraEnvironment },
    stdio: 'inherit',
  });
  managedChildren.set(label, child);

  child.once('error', (error) => {
    console.error(`[GOSU] ${label} failed to start: ${error.message}`);
    void shutdown(1);
  });
  child.once('exit', (code, signal) => {
    managedChildren.delete(label);
    if (!shuttingDown) {
      console.error(
        `[GOSU] ${label} exited unexpectedly (${signal ?? `code ${String(code ?? 1)}`}).`,
      );
      void shutdown(code ?? 1);
    }
  });

  return child;
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  startupAbortController.abort();

  const children = [...managedChildren.values()];
  terminateManagedChildren('SIGTERM');
  await Promise.race([
    Promise.all(
      children.map(
        (child) =>
          new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) resolve();
            else child.once('exit', resolve);
          }),
      ),
    ),
    delay(3_000),
  ]);
  for (const child of children) terminateProcessTree(child, 'SIGKILL');
  process.exitCode = exitCode;
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));
process.once('SIGHUP', () => void shutdown(0));
process.once('exit', () => terminateManagedChildren('SIGTERM'));

async function main() {
  console.log(`[GOSU] Local Sync endpoint: ${baseUrl.origin}`);
  const existing = await probeSync(healthUrl, { signal: startupAbortController.signal });
  if (shuttingDown || startupAbortController.signal.aborted) return;
  let ownsSyncProcess = false;

  if (existing.kind === 'occupied') {
    throw new Error(`Sync API port conflict: ${existing.detail}`);
  }
  if (existing.kind !== 'ready') {
    ownsSyncProcess = true;
    console.log('[GOSU] Starting the local in-memory Sync API…');
    startProcess('Sync API', ['--filter', '@gosu/sync-api', 'dev'], {
      GOSU_ALLOWED_ORIGINS: 'http://127.0.0.1:3000,http://localhost:5173',
      GOSU_AUTH_MODE: 'development',
      GOSU_SYNC_API_HOST: baseUrl.hostname === '[::1]' ? '::1' : baseUrl.hostname,
      GOSU_SYNC_API_PORT: baseUrl.port || '4000',
      NODE_ENV: 'development',
    });
    await waitForSync(healthUrl, { signal: startupAbortController.signal });
  }

  if (shuttingDown || startupAbortController.signal.aborted) return;

  console.log(
    ownsSyncProcess
      ? '[GOSU] Sync API is ready. Starting the desktop app…'
      : '[GOSU] Reusing the healthy local Sync API. Starting the desktop app…',
  );
  startProcess('Desktop', ['--filter', '@gosu/desktop', 'dev'], {
    GOSU_SYNC_API_URL: baseUrl.origin,
    NODE_ENV: 'development',
  });
}

main().catch((error) => {
  if (shuttingDown) return;
  console.error(`[GOSU] ${error instanceof Error ? error.message : String(error)}`);
  void shutdown(1);
});
