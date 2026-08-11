import { spawn } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const readyMarker = 'GOSU_PACKAGED_STARTUP_READY';
const outputLimitBytes = 64 * 1024;
const startupTimeoutMs = 20_000;
const inheritedEnvironmentKeys = [
  'CI',
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'SHELL',
  'TMP',
  'TEMP',
  'TMPDIR',
  '__CF_USER_TEXT_ENCODING',
];

function smokeEnvironment() {
  const environment = { GOSU_PACKAGED_STARTUP_SMOKE: '1' };
  for (const key of inheritedEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function appendBounded(chunks, chunk, state) {
  if (state.bytes >= outputLimitBytes) return;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const retained = buffer.subarray(0, outputLimitBytes - state.bytes);
  chunks.push(retained);
  state.bytes += retained.length;
}

async function newestMacApp(targetPath) {
  const resolvedTarget = resolve(targetPath);
  if (basename(resolvedTarget).endsWith('.app')) return resolvedTarget;

  const entries = await readdir(resolvedTarget, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
      .map(async (entry) => {
        const appPath = join(resolvedTarget, entry.name, 'GOSU.app');
        try {
          return { appPath, modifiedAt: (await stat(appPath)).mtimeMs };
        } catch {
          return null;
        }
      }),
  );
  const available = candidates
    .filter((candidate) => candidate !== null)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (available.length === 0) {
    throw new Error(`No packaged GOSU.app found beneath ${resolvedTarget}`);
  }
  return available[0].appPath;
}

async function verifyPackagedStartup(appPath) {
  const executable = join(appPath, 'Contents', 'MacOS', 'GOSU');
  await access(executable);

  await new Promise((resolvePromise, rejectPromise) => {
    const stdout = [];
    const stderr = [];
    const stdoutState = { bytes: 0 };
    const stderrState = { bytes: 0 };
    let settled = false;
    const child = spawn(
      executable,
      ['--gosu-packaged-startup-smoke', '--disable-error-dialogs', '--disable-gpu'],
      {
        env: smokeEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`Packaged GOSU startup timed out after ${startupTimeoutMs}ms`));
    }, startupTimeoutMs);

    child.stdout.on('data', (chunk) => appendBounded(stdout, chunk, stdoutState));
    child.stderr.on('data', (chunk) => appendBounded(stderr, chunk, stderrState));
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => {
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0 || signal !== null || !stdoutText.includes(readyMarker)) {
        finish(
          new Error(
            `Packaged GOSU failed startup smoke (code=${String(code)}, signal=${String(signal)}).\n${stderrText || stdoutText}`,
          ),
        );
        return;
      }
      finish();
    });
  });
}

const targetPath = process.argv[2];
if (!targetPath) throw new Error('Usage: verify-packaged-app-startup.mjs <app-or-dist-path>');
const appPath = await newestMacApp(targetPath);
await verifyPackagedStartup(appPath);
console.log(`packaged GOSU startup smoke passed: ${appPath}`);
