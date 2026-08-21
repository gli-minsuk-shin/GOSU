import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const GOSU_HERMES_RUNTIME_SCHEMA_VERSION = 1 as const;
export const GOSU_HERMES_VERSION = '0.19.1' as const;
export const GOSU_HERMES_SOURCE_REVISION = 'a4a91610b05acc75b4d76c077a5cd89c1ee066ba' as const;
export const GOSU_HERMES_ACP_PROTOCOL_VERSION = 1 as const;
export const GOSU_HERMES_SEALED_SHIM_PROTOCOL_VERSION = 2 as const;
export const GOSU_HERMES_RUNTIME_DIRECTORY_NAME = 'hermes-runtime';
export const GOSU_HERMES_RUNTIME_MANIFEST_NAME = 'gosu-hermes-runtime.json';

const MAX_MANIFEST_BYTES = 8 * 1_024 * 1_024;
const MAX_RUNTIME_FILES = 20_000;
const MAX_RUNTIME_BYTES = 1_024 * 1_024 * 1_024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type HermesRuntimeBundleFile = Readonly<{
  path: string;
  byteSize: number;
  sha256: string;
  executable: boolean;
}>;

export type HermesRuntimeBundleManifest = Readonly<{
  schemaVersion: typeof GOSU_HERMES_RUNTIME_SCHEMA_VERSION;
  runtimeKind: 'hermes-agent';
  hermesVersion: typeof GOSU_HERMES_VERSION;
  sourceRevision: typeof GOSU_HERMES_SOURCE_REVISION;
  acpProtocolVersion: typeof GOSU_HERMES_ACP_PROTOCOL_VERSION;
  sealedShimProtocolVersion: typeof GOSU_HERMES_SEALED_SHIM_PROTOCOL_VERSION;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  pythonRelativePath: string;
  hermesRootRelativePath: string;
  files: readonly HermesRuntimeBundleFile[];
  treeSha256: string;
}>;

export type VerifiedHermesRuntimeBundle = Readonly<{
  runtimeDirectory: string;
  manifestPath: string;
  manifestSha256: string;
  manifest: HermesRuntimeBundleManifest;
  pythonPath: string;
  rootPath: string;
}>;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function safeRelativePath(value: unknown, code: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_024) {
    throw new Error(code);
  }
  if (
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

function safeInteger(value: unknown, maximum: number, code: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(code);
  }
  return value as number;
}

export function parseHermesRuntimeBundleManifest(
  value: unknown,
  expectedPlatform: NodeJS.Platform = process.platform,
  expectedArch: NodeJS.Architecture = process.arch,
): HermesRuntimeBundleManifest {
  const manifest = record(value, 'hermes_runtime_manifest_invalid');
  if (
    !exactKeys(manifest, [
      'acpProtocolVersion',
      'arch',
      'files',
      'hermesRootRelativePath',
      'hermesVersion',
      'platform',
      'pythonRelativePath',
      'runtimeKind',
      'schemaVersion',
      'sealedShimProtocolVersion',
      'sourceRevision',
      'treeSha256',
    ]) ||
    manifest.schemaVersion !== GOSU_HERMES_RUNTIME_SCHEMA_VERSION ||
    manifest.runtimeKind !== 'hermes-agent' ||
    manifest.hermesVersion !== GOSU_HERMES_VERSION ||
    manifest.sourceRevision !== GOSU_HERMES_SOURCE_REVISION ||
    manifest.acpProtocolVersion !== GOSU_HERMES_ACP_PROTOCOL_VERSION ||
    manifest.sealedShimProtocolVersion !== GOSU_HERMES_SEALED_SHIM_PROTOCOL_VERSION ||
    manifest.platform !== expectedPlatform ||
    manifest.arch !== expectedArch ||
    typeof manifest.treeSha256 !== 'string' ||
    !SHA256_PATTERN.test(manifest.treeSha256) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.files.length > MAX_RUNTIME_FILES
  ) {
    throw new Error('hermes_runtime_manifest_incompatible');
  }

  const pythonRelativePath = safeRelativePath(
    manifest.pythonRelativePath,
    'hermes_runtime_python_path_invalid',
  );
  const hermesRootRelativePath = safeRelativePath(
    manifest.hermesRootRelativePath,
    'hermes_runtime_root_path_invalid',
  );
  const paths = new Set<string>();
  let totalBytes = 0;
  const files = manifest.files.map((candidate) => {
    const file = record(candidate, 'hermes_runtime_file_invalid');
    if (
      !exactKeys(file, ['byteSize', 'executable', 'path', 'sha256']) ||
      typeof file.executable !== 'boolean' ||
      typeof file.sha256 !== 'string' ||
      !SHA256_PATTERN.test(file.sha256)
    ) {
      throw new Error('hermes_runtime_file_invalid');
    }
    const path = safeRelativePath(file.path, 'hermes_runtime_file_path_invalid');
    if (path === GOSU_HERMES_RUNTIME_MANIFEST_NAME || paths.has(path)) {
      throw new Error('hermes_runtime_file_path_invalid');
    }
    paths.add(path);
    const byteSize = safeInteger(file.byteSize, MAX_RUNTIME_BYTES, 'hermes_runtime_size_invalid');
    totalBytes += byteSize;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_RUNTIME_BYTES) {
      throw new Error('hermes_runtime_size_invalid');
    }
    return { path, byteSize, sha256: file.sha256, executable: file.executable };
  });
  if (
    !paths.has(pythonRelativePath) ||
    !paths.has(posix.join(hermesRootRelativePath, 'pyproject.toml'))
  ) {
    throw new Error('hermes_runtime_required_file_missing');
  }

  const canonicalFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
  if (canonicalFiles.some((file, index) => file.path !== files[index]?.path)) {
    throw new Error('hermes_runtime_file_order_invalid');
  }
  const treeSha256 = hashHermesRuntimeFileRecords(canonicalFiles);
  if (treeSha256 !== manifest.treeSha256) throw new Error('hermes_runtime_tree_hash_invalid');

  return {
    schemaVersion: GOSU_HERMES_RUNTIME_SCHEMA_VERSION,
    runtimeKind: 'hermes-agent',
    hermesVersion: GOSU_HERMES_VERSION,
    sourceRevision: GOSU_HERMES_SOURCE_REVISION,
    acpProtocolVersion: GOSU_HERMES_ACP_PROTOCOL_VERSION,
    sealedShimProtocolVersion: GOSU_HERMES_SEALED_SHIM_PROTOCOL_VERSION,
    platform: expectedPlatform,
    arch: expectedArch,
    pythonRelativePath,
    hermesRootRelativePath,
    files: canonicalFiles,
    treeSha256,
  };
}

export function hashHermesRuntimeFileRecords(files: readonly HermesRuntimeBundleFile[]) {
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

async function sha256File(path: string) {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolvePromise);
    stream.once('error', rejectPromise);
  });
  return hash.digest('hex');
}

async function listRuntimeFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const relativePath = relative(root, path).split(sep).join('/');
    if (relativePath === GOSU_HERMES_RUNTIME_MANIFEST_NAME) continue;
    if (entry.isSymbolicLink()) throw new Error('hermes_runtime_symlink_not_allowed');
    if (entry.isDirectory()) {
      result.push(...(await listRuntimeFiles(root, path)));
      continue;
    }
    if (!entry.isFile()) throw new Error('hermes_runtime_file_type_invalid');
    result.push(relativePath);
    if (result.length > MAX_RUNTIME_FILES) throw new Error('hermes_runtime_file_limit_exceeded');
  }
  return result;
}

export async function verifyHermesRuntimeBundle(
  runtimeDirectory: string,
  expectedPlatform: NodeJS.Platform = process.platform,
  expectedArch: NodeJS.Architecture = process.arch,
): Promise<VerifiedHermesRuntimeBundle> {
  const inputDirectoryStat = await lstat(runtimeDirectory);
  if (!inputDirectoryStat.isDirectory() || inputDirectoryStat.isSymbolicLink()) {
    throw new Error('hermes_runtime_directory_invalid');
  }
  const resolvedDirectory = await realpath(runtimeDirectory);
  const directoryStat = await lstat(resolvedDirectory);
  if (!directoryStat.isDirectory()) {
    throw new Error('hermes_runtime_directory_invalid');
  }
  const manifestPath = join(resolvedDirectory, GOSU_HERMES_RUNTIME_MANIFEST_NAME);
  const manifestStat = await lstat(manifestPath);
  if (
    !manifestStat.isFile() ||
    manifestStat.isSymbolicLink() ||
    manifestStat.size > MAX_MANIFEST_BYTES
  ) {
    throw new Error('hermes_runtime_manifest_invalid');
  }
  const manifestBytes = await readFile(manifestPath);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('hermes_runtime_manifest_invalid');
  }
  const manifest = parseHermesRuntimeBundleManifest(manifestValue, expectedPlatform, expectedArch);
  const actualPaths = (await listRuntimeFiles(resolvedDirectory)).sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    actualPaths.length !== manifest.files.length ||
    actualPaths.some((path, index) => path !== manifest.files[index]?.path)
  ) {
    throw new Error('hermes_runtime_file_set_invalid');
  }
  for (const file of manifest.files) {
    const path = resolve(resolvedDirectory, file.path);
    if (!path.startsWith(`${resolvedDirectory}${sep}`))
      throw new Error('hermes_runtime_path_escape');
    const fileStat = await lstat(path);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== file.byteSize) {
      throw new Error('hermes_runtime_file_invalid');
    }
    if (file.executable && (fileStat.mode & 0o111) === 0) {
      throw new Error('hermes_runtime_executable_invalid');
    }
    if ((await sha256File(path)) !== file.sha256)
      throw new Error('hermes_runtime_file_hash_invalid');
  }
  const pythonPath = resolve(resolvedDirectory, manifest.pythonRelativePath);
  const rootPath = resolve(resolvedDirectory, manifest.hermesRootRelativePath);
  await access(pythonPath, constants.X_OK);
  const [pythonRealPath, rootRealPath] = await Promise.all([
    realpath(pythonPath),
    realpath(rootPath),
  ]);
  if (
    !pythonRealPath.startsWith(`${resolvedDirectory}${sep}`) ||
    (rootRealPath !== resolvedDirectory && !rootRealPath.startsWith(`${resolvedDirectory}${sep}`))
  ) {
    throw new Error('hermes_runtime_path_escape');
  }
  return {
    runtimeDirectory: resolvedDirectory,
    manifestPath,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    manifest,
    pythonPath,
    rootPath,
  };
}

export async function materializeHermesRuntimeArchive(input: {
  archivePath: string;
  cacheDirectory: string;
}): Promise<VerifiedHermesRuntimeBundle> {
  const archiveStat = await lstat(input.archivePath);
  if (
    !archiveStat.isFile() ||
    archiveStat.isSymbolicLink() ||
    archiveStat.size === 0 ||
    archiveStat.size > MAX_RUNTIME_BYTES
  ) {
    throw new Error('hermes_runtime_archive_invalid');
  }
  const archiveSha256 = await sha256File(input.archivePath);
  await mkdir(input.cacheDirectory, { recursive: true, mode: 0o700 });
  const cacheRootStat = await lstat(input.cacheDirectory);
  if (!cacheRootStat.isDirectory() || cacheRootStat.isSymbolicLink()) {
    throw new Error('hermes_runtime_cache_invalid');
  }
  const cacheRoot = await realpath(input.cacheDirectory);
  const target = join(cacheRoot, archiveSha256);
  try {
    return await verifyHermesRuntimeBundle(target);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
    if (code !== 'ENOENT') await rm(target, { recursive: true, force: true });
  }

  const staging = await mkdtemp(join(cacheRoot, '.staging-'));
  try {
    await run('/usr/bin/ditto', ['-x', '-k', input.archivePath, staging], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    await verifyHermesRuntimeBundle(staging);
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    return await verifyHermesRuntimeBundle(target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
