import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const HERMES_RUNTIME_VERSION = '0.19.1';
export const HERMES_RUNTIME_SOURCE_REVISION = 'a4a91610b05acc75b4d76c077a5cd89c1ee066ba';
export const HERMES_RUNTIME_MANIFEST_NAME = 'gosu-hermes-runtime.json';
export const HERMES_RUNTIME_INPUT_NAME = 'gosu-hermes-runtime-input.json';
const MAX_FILES = 20_000;
const MAX_BYTES = 1024 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FORBIDDEN_SEGMENTS = new Set(['.git', '.hg', '.svn', 'node_modules']);
const FORBIDDEN_NAMES = new Set([
  '.env',
  'auth.json',
  'config.yaml',
  'config.yml',
  'session.db',
  'sessions.db',
]);

function safeRelativePath(value, code) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    value.includes('\\') ||
    value.includes('\0') ||
    isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(code);
  }
  return value;
}

function assertSafeRuntimePath(path) {
  const segments = path.split('/');
  const name = segments.at(-1)?.toLowerCase() ?? '';
  if (
    segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment)) ||
    FORBIDDEN_NAMES.has(name) ||
    name.endsWith('.sqlite') ||
    name.endsWith('.sqlite3') ||
    name.endsWith('.db-wal') ||
    name.endsWith('.db-shm')
  ) {
    throw new Error(`hermes_runtime_forbidden_path:${path}`);
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolvePromise);
    stream.once('error', rejectPromise);
  });
  return hash.digest('hex');
}

export function hashHermesRuntimeRecords(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(String(file.byteSize));
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\0');
    hash.update(file.executable ? '1' : '0');
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function collectFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = join(current, entry.name);
    const path = relative(root, absolutePath).split(sep).join('/');
    if (path === HERMES_RUNTIME_MANIFEST_NAME || path === HERMES_RUNTIME_INPUT_NAME) continue;
    assertSafeRuntimePath(path);
    if (entry.isSymbolicLink()) throw new Error(`hermes_runtime_symlink_not_allowed:${path}`);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, absolutePath)));
      continue;
    }
    if (!entry.isFile()) throw new Error(`hermes_runtime_file_type_invalid:${path}`);
    const stat = await lstat(absolutePath);
    files.push({
      path,
      absolutePath,
      byteSize: stat.size,
      sha256: await sha256File(absolutePath),
      executable: (stat.mode & 0o111) !== 0,
    });
    if (files.length > MAX_FILES) throw new Error('hermes_runtime_file_limit_exceeded');
  }
  return files;
}

function parseInput(value, expectedPlatform, expectedArch) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('hermes_runtime_input_invalid');
  }
  const keys = Object.keys(value).sort().join(',');
  if (
    keys !==
      'arch,hermesRootRelativePath,hermesVersion,platform,pythonRelativePath,schemaVersion,sourceRevision' ||
    value.schemaVersion !== 1 ||
    value.hermesVersion !== HERMES_RUNTIME_VERSION ||
    value.sourceRevision !== HERMES_RUNTIME_SOURCE_REVISION ||
    value.platform !== expectedPlatform ||
    value.arch !== expectedArch
  ) {
    throw new Error('hermes_runtime_input_incompatible');
  }
  return {
    pythonRelativePath: safeRelativePath(
      value.pythonRelativePath,
      'hermes_runtime_python_path_invalid',
    ),
    hermesRootRelativePath: safeRelativePath(
      value.hermesRootRelativePath,
      'hermes_runtime_root_path_invalid',
    ),
  };
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(code);
  }
}

export async function prepareHermesRuntime({
  sourceDirectory,
  destinationDirectory,
  expectedPlatform = process.platform,
  expectedArch = process.arch,
}) {
  const source = await realpath(sourceDirectory);
  const input = parseInput(
    await readJson(join(source, HERMES_RUNTIME_INPUT_NAME), 'hermes_runtime_input_invalid'),
    expectedPlatform,
    expectedArch,
  );
  const sourceFiles = (await collectFiles(source)).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const totalBytes = sourceFiles.reduce((sum, file) => sum + file.byteSize, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_BYTES) {
    throw new Error('hermes_runtime_size_invalid');
  }
  const paths = new Set(sourceFiles.map((file) => file.path));
  const projectPath = posix.join(input.hermesRootRelativePath, 'pyproject.toml');
  if (!paths.has(input.pythonRelativePath) || !paths.has(projectPath)) {
    throw new Error('hermes_runtime_required_file_missing');
  }
  const pythonFile = sourceFiles.find((file) => file.path === input.pythonRelativePath);
  if (!pythonFile?.executable) throw new Error('hermes_runtime_python_not_executable');
  const projectText = await readFile(join(source, projectPath), 'utf8');
  if (
    !new RegExp(
      `^version\\s*=\\s*["']${HERMES_RUNTIME_VERSION.replaceAll('.', '\\.')}["']`,
      'mu',
    ).test(projectText)
  ) {
    throw new Error('hermes_runtime_version_mismatch');
  }

  const destination = resolve(destinationDirectory);
  const staging = `${destination}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const file of sourceFiles) {
      const target = join(staging, file.path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(file.absolutePath, target, constants.COPYFILE_EXCL);
      await chmod(target, file.executable ? 0o755 : 0o644);
    }
    const files = sourceFiles.map(({ path, byteSize, sha256, executable }) => ({
      path,
      byteSize,
      sha256,
      executable,
    }));
    const manifest = {
      schemaVersion: 1,
      runtimeKind: 'hermes-agent',
      hermesVersion: HERMES_RUNTIME_VERSION,
      sourceRevision: HERMES_RUNTIME_SOURCE_REVISION,
      acpProtocolVersion: 1,
      sealedShimProtocolVersion: 2,
      platform: expectedPlatform,
      arch: expectedArch,
      pythonRelativePath: input.pythonRelativePath,
      hermesRootRelativePath: input.hermesRootRelativePath,
      files,
      treeSha256: hashHermesRuntimeRecords(files),
    };
    await writeFile(
      join(staging, HERMES_RUNTIME_MANIFEST_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o644 },
    );
    await verifyHermesRuntimeBundle(staging, { expectedPlatform, expectedArch });
    await rm(destination, { recursive: true, force: true });
    await mkdir(dirname(destination), { recursive: true });
    await import('node:fs/promises').then(({ rename }) => rename(staging, destination));
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyHermesRuntimeBundle(
  runtimeDirectory,
  { expectedPlatform = process.platform, expectedArch = process.arch } = {},
) {
  const rootStat = await lstat(runtimeDirectory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('hermes_runtime_directory_invalid');
  }
  const root = await realpath(runtimeDirectory);
  const manifestBytes = await readFile(join(root, HERMES_RUNTIME_MANIFEST_NAME));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const input = parseInput(
    {
      schemaVersion: manifest.schemaVersion,
      hermesVersion: manifest.hermesVersion,
      sourceRevision: manifest.sourceRevision,
      platform: manifest.platform,
      arch: manifest.arch,
      pythonRelativePath: manifest.pythonRelativePath,
      hermesRootRelativePath: manifest.hermesRootRelativePath,
    },
    expectedPlatform,
    expectedArch,
  );
  if (
    manifest.runtimeKind !== 'hermes-agent' ||
    manifest.acpProtocolVersion !== 1 ||
    manifest.sealedShimProtocolVersion !== 2 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.files.length > MAX_FILES ||
    typeof manifest.treeSha256 !== 'string' ||
    !SHA256_PATTERN.test(manifest.treeSha256)
  ) {
    throw new Error('hermes_runtime_manifest_invalid');
  }
  const actual = (await collectFiles(root)).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (actual.length !== manifest.files.length) throw new Error('hermes_runtime_file_set_invalid');
  for (let index = 0; index < actual.length; index += 1) {
    const observed = actual[index];
    const expected = manifest.files[index];
    if (
      observed.path !== expected?.path ||
      observed.byteSize !== expected.byteSize ||
      observed.sha256 !== expected.sha256 ||
      observed.executable !== expected.executable
    ) {
      throw new Error('hermes_runtime_file_hash_invalid');
    }
  }
  if (hashHermesRuntimeRecords(manifest.files) !== manifest.treeSha256) {
    throw new Error('hermes_runtime_tree_hash_invalid');
  }
  await access(join(root, input.pythonRelativePath), constants.X_OK);
  return {
    root,
    manifest,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  };
}

export async function archiveHermesRuntimeBundle(runtimeDirectory, archivePath) {
  await verifyHermesRuntimeBundle(runtimeDirectory);
  const output = resolve(archivePath);
  await rm(output, { force: true });
  await mkdir(dirname(output), { recursive: true });
  await run('/usr/bin/ditto', ['-c', '-k', '--norsrc', runtimeDirectory, output], {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  return output;
}

export async function verifyHermesRuntimeArchive(archivePath) {
  const archiveStat = await lstat(archivePath);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink() || archiveStat.size > MAX_BYTES) {
    throw new Error('hermes_runtime_archive_invalid');
  }
  const extractionRoot = await mkdtemp(join(dirname(resolve(archivePath)), '.verify-hermes-'));
  try {
    await run('/usr/bin/ditto', ['-x', '-k', archivePath, extractionRoot], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    return await verifyHermesRuntimeBundle(extractionRoot);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}
