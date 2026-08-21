import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  HERMES_RUNTIME_INPUT_NAME,
  HERMES_RUNTIME_SOURCE_REVISION,
  HERMES_RUNTIME_VERSION,
} from './hermes-runtime-bundle.mjs';

const run = promisify(execFile);
const EXPECTED_UV_LOCK_SHA256 = '960cda43f7981a88370226c1d7f5d4c50c5c111ab64a5515549f2dc1c4115b07';
const EXCLUDED_SOURCE_DIRECTORIES = new Set([
  '.git',
  '.github',
  '.venv',
  'apps',
  'contributors',
  'docs',
  'node_modules',
  'tests',
  'tests-js',
  'ui-tui',
  'venv',
  'website',
]);

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function copyTree(sourceRoot, destinationRoot, { excludeTopLevel = new Set() } = {}) {
  const allowedSymlinkRoot = await realpath(sourceRoot);
  async function visit(source, destination, depth) {
    const sourceStat = await lstat(source);
    if (sourceStat.isSymbolicLink()) {
      const target = await realpath(resolve(dirname(source), await readlink(source)));
      if (target !== allowedSymlinkRoot && !target.startsWith(`${allowedSymlinkRoot}${sep}`)) {
        throw new Error(`hermes_runtime_symlink_escape:${source}`);
      }
      const targetStat = await stat(target);
      if (!targetStat.isFile()) throw new Error(`hermes_runtime_nonfile_symlink:${source}`);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(target, destination);
      await chmod(destination, (targetStat.mode & 0o111) !== 0 ? 0o755 : 0o644);
      return;
    }
    if (sourceStat.isDirectory()) {
      await mkdir(destination, { recursive: true });
      for (const entry of await readdir(source)) {
        if (depth === 0 && excludeTopLevel.has(entry)) continue;
        if (entry === '__pycache__' || entry.endsWith('.pyc')) continue;
        await visit(join(source, entry), join(destination, entry), depth + 1);
      }
      return;
    }
    if (!sourceStat.isFile()) throw new Error(`hermes_runtime_file_type_invalid:${source}`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, (sourceStat.mode & 0o111) !== 0 ? 0o755 : 0o644);
  }
  await visit(sourceRoot, destinationRoot, 0);
}

async function verifiedSourceCheckout(path) {
  const root = await realpath(path);
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    run('git', ['-C', root, 'rev-parse', 'HEAD']),
    run('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=no']),
  ]);
  if (revision.trim() !== HERMES_RUNTIME_SOURCE_REVISION || status.trim() !== '') {
    throw new Error('hermes_source_checkout_not_reviewed');
  }
  if ((await sha256(join(root, 'uv.lock'))) !== EXPECTED_UV_LOCK_SHA256) {
    throw new Error('hermes_source_lock_hash_mismatch');
  }
  return root;
}

const checkoutInput = process.env.GOSU_HERMES_SOURCE_CHECKOUT?.trim();
const destinationInput = process.env.GOSU_HERMES_BUNDLE_SOURCE?.trim();
if (!checkoutInput || !destinationInput) {
  throw new Error(
    'Set GOSU_HERMES_SOURCE_CHECKOUT to the reviewed Hermes checkout and GOSU_HERMES_BUNDLE_SOURCE to an empty staging target.',
  );
}

const checkout = await verifiedSourceCheckout(checkoutInput);
const destination = resolve(destinationInput);
if (
  basename(destination) !== 'hermes-runtime-source' ||
  destination === checkout ||
  relative(checkout, destination).split(sep)[0] !== '..'
) {
  throw new Error('hermes_bundle_destination_invalid');
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

const { stdout: managedPython } = await run('uv', [
  'python',
  'find',
  '--managed-python',
  '3.11.12',
]);
const managedPythonPath = await realpath(managedPython.trim());
const managedPythonRoot = dirname(dirname(managedPythonPath));
await copyTree(managedPythonRoot, join(destination, 'python'));
await copyTree(checkout, join(destination, 'hermes-agent'), {
  excludeTopLevel: EXCLUDED_SOURCE_DIRECTORIES,
});

const requirementsPath = join(destination, '.requirements.txt');
try {
  const { stdout: requirements } = await run(
    'uv',
    ['export', '--frozen', '--no-dev', '--no-emit-project', '--format', 'requirements-txt'],
    { cwd: checkout, maxBuffer: 16 * 1024 * 1024 },
  );
  await writeFile(requirementsPath, requirements, { mode: 0o600 });
  await run(
    'uv',
    [
      'pip',
      'install',
      '--python',
      join(destination, 'python', 'bin', basename(managedPythonPath)),
      '--break-system-packages',
      '--require-hashes',
      '--no-config',
      '--no-cache',
      '--requirements',
      requirementsPath,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
} finally {
  await rm(requirementsPath, { force: true });
}

await writeFile(
  join(destination, HERMES_RUNTIME_INPUT_NAME),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      hermesVersion: HERMES_RUNTIME_VERSION,
      sourceRevision: HERMES_RUNTIME_SOURCE_REVISION,
      platform: process.platform,
      arch: process.arch,
      pythonRelativePath: `python/bin/${basename(managedPythonPath)}`,
      hermesRootRelativePath: 'hermes-agent',
    },
    null,
    2,
  )}\n`,
  { mode: 0o644 },
);

console.log(
  `built reviewed Hermes ${HERMES_RUNTIME_VERSION} source bundle at ${destination}; run prepare-hermes-runtime.mjs to hash and stage it`,
);
