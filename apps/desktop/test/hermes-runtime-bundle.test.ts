import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GOSU_HERMES_ACP_PROTOCOL_VERSION,
  GOSU_HERMES_RUNTIME_MANIFEST_NAME,
  GOSU_HERMES_RUNTIME_SCHEMA_VERSION,
  GOSU_HERMES_SEALED_SHIM_PROTOCOL_VERSION,
  GOSU_HERMES_SOURCE_REVISION,
  GOSU_HERMES_VERSION,
  hashHermesRuntimeFileRecords,
  materializeHermesRuntimeArchive,
  verifyHermesRuntimeBundle,
  type HermesRuntimeBundleFile,
} from '../src/main/hermes-runtime-bundle';
import { createNodeHermesProjectChatPlatform } from '../src/main/hermes-project-chat-adapter';

const temporaryDirectories: string[] = [];
const run = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-hermes-bundle-test-'));
  temporaryDirectories.push(root);
  const pythonRelativePath = 'python/bin/python3.11';
  const projectRelativePath = 'hermes-agent/pyproject.toml';
  const runAgentRelativePath = 'hermes-agent/run_agent.py';
  const contents = new Map([
    [pythonRelativePath, '#!/bin/sh\nexit 0\n'],
    [projectRelativePath, `[project]\nversion = "${GOSU_HERMES_VERSION}"\n`],
    [runAgentRelativePath, 'class AIAgent: pass\n'],
  ]);
  for (const [path, content] of contents) {
    const absolutePath = join(root, path);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, content);
  }
  await chmod(join(root, pythonRelativePath), 0o755);
  const files: HermesRuntimeBundleFile[] = [...contents]
    .map(([path, content]) => ({
      path,
      byteSize: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'),
      executable: path === pythonRelativePath,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schemaVersion: GOSU_HERMES_RUNTIME_SCHEMA_VERSION,
    runtimeKind: 'hermes-agent' as const,
    hermesVersion: GOSU_HERMES_VERSION,
    sourceRevision: GOSU_HERMES_SOURCE_REVISION,
    acpProtocolVersion: GOSU_HERMES_ACP_PROTOCOL_VERSION,
    sealedShimProtocolVersion: GOSU_HERMES_SEALED_SHIM_PROTOCOL_VERSION,
    platform: process.platform,
    arch: process.arch,
    pythonRelativePath,
    hermesRootRelativePath: 'hermes-agent',
    files,
    treeSha256: hashHermesRuntimeFileRecords(files),
  };
  await writeFile(
    join(root, GOSU_HERMES_RUNTIME_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { root, manifest, pythonRelativePath, projectRelativePath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('bundled Hermes runtime boundary', () => {
  it('verifies the exact platform, file set, executable bit, and SHA-256 tree', async () => {
    const runtime = await fixture();
    const resolvedRoot = await realpath(runtime.root);
    await expect(verifyHermesRuntimeBundle(runtime.root)).resolves.toMatchObject({
      runtimeDirectory: resolvedRoot,
      pythonPath: join(resolvedRoot, runtime.pythonRelativePath),
      rootPath: join(resolvedRoot, 'hermes-agent'),
      manifest: runtime.manifest,
    });
  });

  it('fails closed instead of accepting a modified bundled file', async () => {
    const runtime = await fixture();
    await writeFile(
      join(runtime.root, runtime.projectRelativePath),
      '[project]\nversion="latest"\n',
    );
    await expect(verifyHermesRuntimeBundle(runtime.root)).rejects.toThrow(
      'hermes_runtime_file_invalid',
    );
  });

  it('prefers the verified bundle and does not consult a mutable PATH installation', async () => {
    const runtime = await fixture();
    const resolvedRoot = await realpath(runtime.root);
    const platform = createNodeHermesProjectChatPlatform({
      bundledRuntimeDirectory: runtime.root,
      allowCustomLocalRuntime: true,
      pathEnvironment: '/attacker/bin',
      homeDirectory: '/Users/researcher',
    });
    await expect(platform.findHermesInstallation()).resolves.toMatchObject({
      source: 'bundled',
      version: GOSU_HERMES_VERSION,
      pythonPath: join(resolvedRoot, runtime.pythonRelativePath),
      rootPath: join(resolvedRoot, 'hermes-agent'),
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('never falls back to a custom installation when an existing bundle is invalid', async () => {
    const runtime = await fixture();
    await writeFile(join(runtime.root, runtime.projectRelativePath), 'tampered');
    const platform = createNodeHermesProjectChatPlatform({
      bundledRuntimeDirectory: runtime.root,
      allowCustomLocalRuntime: true,
      pathEnvironment: '/usr/local/bin',
      homeDirectory: '/Users/researcher',
    });
    await expect(platform.findHermesInstallation()).rejects.toThrow(
      'hermes_bundled_runtime_invalid',
    );
  });

  it('does not search PATH when packaged mode disallows a custom runtime', async () => {
    const home = await mkdtemp(join(tmpdir(), 'gosu-hermes-custom-test-'));
    temporaryDirectories.push(home);
    const launcherDirectory = join(home, '.local', 'bin');
    const root = join(home, '.hermes', 'hermes-agent');
    const pythonPath = join(root, 'venv', 'bin', 'python');
    await mkdir(launcherDirectory, { recursive: true });
    await mkdir(join(root, 'venv', 'bin'), { recursive: true });
    await writeFile(pythonPath, '#!/bin/sh\nexit 0\n');
    await chmod(pythonPath, 0o755);
    await writeFile(join(root, 'run_agent.py'), 'class AIAgent: pass\n');
    const launcherPath = join(launcherDirectory, 'hermes');
    await writeFile(
      launcherPath,
      `#!/usr/bin/env bash\nunset PYTHONPATH\nunset PYTHONHOME\nexec "${pythonPath}" "${join(root, 'hermes')}" "$@"\n`,
    );
    await chmod(launcherPath, 0o755);
    const platform = createNodeHermesProjectChatPlatform({
      bundledRuntimeDirectory: join(home, 'missing-bundle'),
      allowCustomLocalRuntime: false,
      pathEnvironment: launcherDirectory,
      homeDirectory: home,
    });
    await expect(platform.findHermesInstallation()).resolves.toBeNull();
  });

  it('extracts the signed resource archive into a hash-keyed verified cache', async () => {
    const runtime = await fixture();
    const archiveDirectory = await mkdtemp(join(tmpdir(), 'gosu-hermes-archive-test-'));
    temporaryDirectories.push(archiveDirectory);
    const archivePath = join(archiveDirectory, 'hermes-runtime.zip');
    const cacheDirectory = join(archiveDirectory, 'cache');
    await run('/usr/bin/ditto', ['-c', '-k', '--norsrc', runtime.root, archivePath]);

    const first = await materializeHermesRuntimeArchive({ archivePath, cacheDirectory });
    expect(first.runtimeDirectory).toMatch(/\/cache\/[a-f0-9]{64}$/u);
    await writeFile(join(first.runtimeDirectory, runtime.projectRelativePath), 'tampered');
    const recovered = await materializeHermesRuntimeArchive({ archivePath, cacheDirectory });
    await expect(verifyHermesRuntimeBundle(recovered.runtimeDirectory)).resolves.toMatchObject({
      manifest: runtime.manifest,
    });
  });
});
